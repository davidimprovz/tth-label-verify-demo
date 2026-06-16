"""VLM label reader (async refinement tier, Phase 2).

Reads a label with a vision model over an OpenAI-compatible chat API, via
``ChatOpenAI.with_structured_output(LabelFields)``. The server is vLLM in the
cloud and a host Ollama in local dev (both speak ``/v1``) — point
``OLLAMA_BASE_URL`` at either. Used by ``services.refine`` to re-read the
Government Warning + fields the OCR tier couldn't recover.

Conforms to the ``LabelReader`` protocol but, unlike the OCR tier, it returns the
structured ``fields`` directly (and a text serialization for any text-based use).
It reads the **original color** image (NOT the grayscale CLAHE OCR image).

Hard-won config (see eval/vlm_latency_decision.md):
- model defaults to the **instruct** tag (`qwen3-vl:2b-instruct`) — the bare
  thinking tag can't disable thinking in Ollama and grinds on multi-field prompts.
- ``num_ctx`` MUST be capped (qwen3-vl defaults to 128K-256K → ~17GB KV cache).

Lazy-imports langchain so the module loads even when the optional ``vlm`` deps
aren't installed; ``is_available()`` gates real use.
"""

from __future__ import annotations

import base64
import logging
import time
from pathlib import Path

import numpy as np

from backend import settings
from backend.models.label_fields import LabelFields
from backend.models.verification import ExpectedFields
from backend.services.preprocess import PreprocessResult
from backend.services.readers.base import ReaderOutput

logger = logging.getLogger("ttb_label_verifier")

_PROMPT = (
    "You are reading a U.S. alcohol beverage label. Extract these fields exactly "
    "as printed; if a field is not visible, return null — do NOT guess. Fields: "
    "beverage_type (spirits, wine, or beer), brand_name, class_type, "
    "alcohol_content, net_contents, producer_name, producer_address, "
    "country_of_origin, and government_warning_text (the full Government Warning "
    "statement verbatim, INCLUDING the leading 'GOVERNMENT WARNING:' header, or "
    "null if absent). Also judge two visual properties of the Government Warning: "
    "government_warning_all_caps (true only if the ENTIRE warning, header and "
    "body, is in ALL CAPITAL LETTERS) and government_warning_bold (true if the "
    "warning is printed in bold). Base these on what you actually see."
)

# Longest-edge cap for the image sent to the VLM. A full-res label becomes
# thousands of Qwen3-VL vision tokens → tens of seconds of (eager) vision-encode +
# prefill. Capping here keeps the Government Warning legible (the resolution study
# shows field/warning recall holds at >=768px) while slashing inference latency.
_VLM_MAX_EDGE = 1024


def _data_url(image: bytes | str | np.ndarray) -> str:
    """Decode an image (bytes / path / BGR ndarray), downscale its longest edge to
    ``_VLM_MAX_EDGE``, and return it as a base64 PNG data URL.

    Both vLLM (cloud) and Ollama (dev) accept an OpenAI-style image data URL. The
    downscale is the single biggest VLM latency lever — full-res labels explode the
    vision-token count.
    """
    import cv2

    if isinstance(image, np.ndarray):
        arr = image
    elif isinstance(image, (bytes, bytearray)):
        arr = cv2.imdecode(np.frombuffer(bytes(image), np.uint8), cv2.IMREAD_COLOR)
    elif isinstance(image, str):
        arr = cv2.imread(str(Path(image)), cv2.IMREAD_COLOR)
    else:
        raise TypeError(f"unsupported image input type: {type(image)!r}")
    if arr is None:
        raise ValueError("could not decode image for the VLM")

    h, w = arr.shape[:2]
    longest = max(h, w)
    if longest > _VLM_MAX_EDGE:
        scale = _VLM_MAX_EDGE / longest
        arr = cv2.resize(
            arr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA
        )
    ok, buf = cv2.imencode(".png", arr)
    if not ok:
        raise ValueError("could not encode image for the VLM")
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


class VLMLabelReader:
    """A local VLM reader served by Ollama, accessed through LangChain."""

    name = "vlm"

    def __init__(self) -> None:
        self._chain = None

    def is_available(self) -> bool:
        """True only when the tier is enabled and the chain can be built."""
        if not settings.vlm_enabled():
            return False
        try:
            self._build_chain()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("event=vlm.unavailable reason=build_failed err=%s", exc)
            return False

    def _build_chain(self):
        if self._chain is None:
            from langchain_openai import ChatOpenAI

            # Served by vLLM in the cloud (OpenAI-compatible /v1). Ollama also
            # speaks /v1, so the same client works against a host Ollama in dev —
            # point OLLAMA_BASE_URL at either. num_ctx is a server arg (vLLM
            # --max-model-len), not a client option.
            llm = ChatOpenAI(
                model=settings.VLM_MODEL,
                base_url=settings.OLLAMA_BASE_URL.rstrip("/") + "/v1",
                api_key="EMPTY",  # vLLM ignores it; required by the client
                temperature=0.1,
                max_tokens=settings.VLM_NUM_PREDICT,
                timeout=settings.VLM_TIMEOUT_S,
            )
            # json_schema → vLLM guided decoding forces valid JSON regardless of
            # the model's free-form tendencies.
            self._chain = llm.with_structured_output(
                LabelFields, method="json_schema"
            ).with_retry(stop_after_attempt=2)
        return self._chain

    def read(
        self,
        image: bytes | str | np.ndarray,
        expected: ExpectedFields | None = None,
        *,
        preprocessed: PreprocessResult | np.ndarray | None = None,
    ) -> ReaderOutput:
        """Read the (original, color) ``image`` into structured ``LabelFields``.

        ``preprocessed`` is intentionally ignored — the VLM wants the original
        color image, not the grayscale OCR image.
        """
        from langchain_core.messages import HumanMessage

        try:
            chain = self._build_chain()
            message = HumanMessage(
                content=[
                    {"type": "text", "text": _PROMPT},
                    {"type": "image_url", "image_url": {"url": _data_url(image)}},
                ]
            )
            t0 = time.perf_counter()
            fields = chain.invoke([message])
            latency_ms = (time.perf_counter() - t0) * 1000.0
            if not isinstance(fields, LabelFields):
                fields = LabelFields.model_validate(fields)
            n_filled = sum(1 for v in fields.model_dump().values() if v)
            logger.info(
                "event=vlm.read model=%s latency_ms=%.0f fields_filled=%d warning=%s",
                settings.VLM_MODEL,
                latency_ms,
                n_filled,
                bool(fields.government_warning_text),
            )
            return ReaderOutput(
                text=_fields_to_text(fields),
                confidence=0.0,  # VLM gives no per-field confidence; matchers score
                tier="vlm",
                fields=fields,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("event=vlm.read.error model=%s err=%s", settings.VLM_MODEL, exc)
            return ReaderOutput(text="", confidence=0.0, tier="vlm", fields=None)


def _fields_to_text(fields: LabelFields) -> str:
    """Serialize extracted fields to newline text (so text-based callers work)."""
    return "\n".join(str(v) for v in fields.model_dump().values() if v)
