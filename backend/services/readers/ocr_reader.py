"""Tier-0 OCR reader wrapping RapidOCR / PP-OCRv5 ONNX (task 1.5).

The RapidOCR model is expensive to construct (ONNX session + model load), so it
is built **once** and cached at module scope via :func:`_get_engine` — the first
call warms it, every subsequent ``OCRLabelReader()`` reuses the same warm engine.
This keeps per-request latency at the ~0.2s inference cost rather than paying the
model-load cost on every request.

The reader runs the backend's own ``preprocess`` first (deskew/denoise/contrast),
then RapidOCR, and returns the concatenated per-line text, the per-line boxes,
and the mean per-line confidence.
"""

from __future__ import annotations

import logging
import threading
import time

import numpy as np

from backend.models.verification import ExpectedFields
from backend.services.preprocess import PreprocessResult, preprocess
from backend.services.readers.base import ReaderOutput

logger = logging.getLogger("ttb_label_verifier")

TIER = "ocr"

# Module-level singleton + lock so the model loads exactly once even under
# concurrent first calls.
_engine = None
_engine_lock = threading.Lock()

# Serializes inference: reads run on worker threads (see verify_async) and the
# RapidOCR pipeline is not documented thread-safe. OCR is CPU-bound, so
# serializing costs little throughput while keeping the event loop responsive.
_infer_lock = threading.Lock()


def _get_engine():
    """Return the process-wide RapidOCR engine, constructing it once."""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR

                logger.info("event=ocr_engine_init engine=rapidocr")
                _engine = RapidOCR()
    return _engine


class OCRLabelReader:
    """RapidOCR-backed Tier-0 reader."""

    name = "rapidocr"

    def __init__(self) -> None:
        # Warm the singleton at construction so the first read isn't penalized.
        _get_engine()

    def read(
        self,
        image: bytes | str | np.ndarray,
        expected: ExpectedFields | None = None,
        *,
        preprocessed: PreprocessResult | np.ndarray | None = None,
    ) -> ReaderOutput:
        # Reuse an already-cleaned image when the orchestrator supplies one
        # (avoids preprocessing twice). Accept either a PreprocessResult or a
        # bare cleaned ndarray; otherwise preprocess here (default path).
        if preprocessed is None:
            pre = preprocess(image)
            cleaned = pre.image
            difficulty = pre.difficulty_score
        elif isinstance(preprocessed, PreprocessResult):
            cleaned = preprocessed.image
            difficulty = preprocessed.difficulty_score
        else:
            cleaned = preprocessed
            difficulty = 0.0
        engine = _get_engine()
        # RapidOCR accepts a grayscale/BGR ndarray directly.
        t_infer = time.perf_counter()
        with _infer_lock:
            result, _ = engine(cleaned)
        infer_ms = (time.perf_counter() - t_infer) * 1000.0

        lines: list[str] = []
        boxes: list[dict] = []
        confidences: list[float] = []
        for entry in result or []:
            # Each entry is [box_points, text, confidence].
            box, text, conf = entry[0], entry[1], entry[2]
            lines.append(text)
            try:
                conf_f = float(conf)
            except (TypeError, ValueError):
                conf_f = 0.0
            confidences.append(conf_f)
            boxes.append({"box": box, "text": text, "confidence": conf_f})

        mean_conf = float(np.mean(confidences)) if confidences else 0.0
        # Clamp to [0, 1] defensively.
        mean_conf = max(0.0, min(1.0, mean_conf))

        logger.info(
            "event=ocr_read tier=%s lines=%d confidence=%.3f difficulty=%.3f",
            TIER,
            len(lines),
            mean_conf,
            difficulty,
        )
        if logger.isEnabledFor(logging.DEBUG):
            text_chars = sum(len(line) for line in lines)
            logger.debug(
                "event=ocr.read engine=%s n_boxes=%d lines=%d chars=%d "
                "confidence=%.3f latency_ms=%.1f",
                self.name,
                len(boxes),
                len(lines),
                text_chars,
                mean_conf,
                infer_ms,
            )

        return ReaderOutput(
            text="\n".join(lines),
            confidence=round(mean_conf, 4),
            tier=TIER,
            word_boxes=boxes or None,
        )
