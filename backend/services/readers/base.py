"""``LabelReader`` protocol + shared ``ReaderOutput`` (task 1.5).

A ``LabelReader`` turns a label image into text the verification matchers can
search. M1 ships a single Tier-0 OCR reader; later milestones add segmentation
and VLM readers behind a fallback gate. They all conform to this protocol so the
orchestrator can swap tiers without changing its logic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import numpy as np

from backend.models.label_fields import LabelFields
from backend.models.verification import ExpectedFields
from backend.services.preprocess import PreprocessResult


@dataclass
class ReaderOutput:
    """What a reader returns for one image.

    - ``text``: the recognized text (lines joined with newlines).
    - ``word_boxes``: per-line/word boxes ``[{"box", "text", "confidence"}]`` when
      the reader provides geometry, else ``None``.
    - ``confidence``: mean recognition confidence in [0, 1].
    - ``tier``: which reader/tier produced this (e.g. ``"ocr"``).
    - ``fields``: structured field values when a reader extracts them directly
      (the VLM tier); ``None`` for text-only readers (OCR).
    """

    text: str
    confidence: float
    tier: str
    word_boxes: list[dict] | None = field(default=None)
    fields: LabelFields | None = field(default=None)


@runtime_checkable
class LabelReader(Protocol):
    """A swappable label-reading tier."""

    name: str

    def read(
        self,
        image: bytes | str | np.ndarray,
        expected: ExpectedFields | None,
        *,
        preprocessed: PreprocessResult | np.ndarray | None = None,
    ) -> ReaderOutput:
        """Read ``image`` and return text + confidence + tier.

        ``expected`` is an optional hint a smarter tier may use to localize
        fields; the Tier-0 OCR reader ignores it.

        ``preprocessed`` is an optional already-cleaned image (a
        ``PreprocessResult`` or a cleaned ndarray). When supplied the reader
        SKIPS its internal preprocess and uses it — this avoids double
        preprocessing on the latency-critical path. When ``None`` the reader
        preprocesses ``image`` itself (the default for direct callers).
        """
        ...
