"""VLM label reader (async refinement tier, Phase 2).

Reads a label with a local vision model served by Ollama, via LangChain
``ChatOllama.with_structured_output(LabelFields)``. Used by ``services.refine`` to
re-read the Government Warning + fields the OCR tier couldn't recover.

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

_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


def _data_url(image: bytes | str | np.ndarray) -> str:
    """Encode an image (bytes / path / BGR ndarray) as a base64 data URL.

    LangChain forwards the data URL to Ollama (stripping the prefix). We send the
    color image as-is; field-aware downscaling is layered on by the caller.
    """
    if isinstance(image, np.ndarray):
        import cv2

        ok, buf = cv2.imencode(".png", image)
        if not ok:
            raise ValueError("could not encode ndarray image")
        b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    if isinstance(image, (bytes, bytearray)):
        b64 = base64.b64encode(bytes(image)).decode("utf-8")
        return f"data:image/png;base64,{b64}"
    if isinstance(image, str):
        p = Path(image)
        mime = _MIME_BY_SUFFIX.get(p.suffix.lower(), "image/png")
        b64 = base64.b64encode(p.read_bytes()).decode("utf-8")
        return f"data:{mime};base64,{b64}"
    raise TypeError(f"unsupported image input type: {type(image)!r}")


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
            from langchain_ollama import ChatOllama

            llm = ChatOllama(
                model=settings.VLM_MODEL,
                base_url=settings.OLLAMA_BASE_URL,
                temperature=0.1,
                num_ctx=settings.VLM_NUM_CTX,
                num_predict=settings.VLM_NUM_PREDICT,
                client_kwargs={"timeout": settings.VLM_TIMEOUT_S},
            )
            self._chain = llm.with_structured_output(LabelFields).with_retry(
                stop_after_attempt=2
            )
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
                    {"type": "image_url", "image_url": _data_url(image)},
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
