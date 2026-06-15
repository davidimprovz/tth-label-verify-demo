"""Verification orchestrator (task 1.6).

Ties the pipeline together: preprocess → Tier-0 OCR read → run the graded field
matchers **concurrently** → aggregate into a ``VerificationResult``.

Concurrency: the matchers are synchronous (rapidfuzz/pint CPU work), so each is
dispatched to a worker thread via ``asyncio.to_thread`` and awaited together with
``asyncio.gather``. ``verify_sync`` wraps this for callers (and tests) that aren't
already in an event loop.

Auto-triage hook: ``preprocess`` emits a ``difficulty_score`` and human-readable
``warnings``. When the score crosses ``DIFFICULTY_RESHOOT_THRESHOLD`` we surface
those warnings as a synthetic ``image_quality`` ``FieldResult`` with status
``review`` so the UI can suggest a re-shoot. This is intentionally **soft**: it
never hard-fails the verification (the reviewer decides), it only nudges the
overall verdict to ``review`` via the existing derive-overall invariant.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import Callable
from decimal import Decimal

import numpy as np

from backend.models.verification import (
    ExpectedFields,
    FieldResult,
    OcrBox,
    VerificationResult,
    required_fields_for,
)
from backend.services.matcher import (
    match_name,
    match_numeric,
    match_presence,
    match_producer,
)
from backend.services.preprocess import (
    DIFFICULTY_RESHOOT_THRESHOLD,
    preprocess,
    project_boxes_to_original,
)
from backend.services.readers.base import LabelReader, ReaderOutput
from backend.services.warning import check_government_warning

logger = logging.getLogger("ttb_label_verifier")

TIER_USED = "ocr"

# Synthetic field name for the auto-triage / image-quality signal.
IMAGE_QUALITY_FIELD = "image_quality"


def _abv_tolerance(beverage_type: str, expected_abv: str | None) -> Decimal:
    """Per-class ABV match tolerance, in percentage points (27 CFR 4.36 / 5.65 /
    7.65). Spirits ±0.3; wine ±1.5 at/under 14% and ±1.0 over 14%; ±0.5 default.
    Wine's band depends on the *expected* ABV, parsed leniently from its string.
    """
    if beverage_type == "spirits":
        return Decimal("0.3")
    if beverage_type == "wine":
        m = re.search(r"\d+(?:\.\d+)?", expected_abv or "")
        if m:
            try:
                return Decimal("1.5") if Decimal(m.group(0)) <= 14 else Decimal("1.0")
            except (ValueError, ArithmeticError):
                pass
        return Decimal("1.5")
    return Decimal("0.5")


def _build_tasks(
    graded: set[str], expected: ExpectedFields, text: str
) -> list[tuple[str, Callable[[], FieldResult]]]:
    """Map each graded field to a zero-arg callable running its matcher.

    Returns ``(field, fn)`` pairs; ``fn`` is run in a thread by the caller.
    """
    tasks: list[tuple[str, Callable[[], FieldResult]]] = []
    if "brand_name" in graded:
        tasks.append(
            ("brand_name", lambda: match_name("brand_name", expected.brand_name, text))
        )
    if "class_type" in graded:
        tasks.append(
            ("class_type", lambda: match_name("class_type", expected.class_type, text))
        )
    if "producer_name" in graded:
        tasks.append(
            (
                "producer_name",
                lambda: match_producer(
                    expected.producer_name, expected.producer_address, text
                ),
            )
        )
    if "producer_address" in graded:
        # TTB requires the address as well as the name. Grade it on its own; when
        # the application data omits it, escalate to review (don't hard-fail) so a
        # missing app-data value isn't mistaken for a missing-on-label violation.
        if expected.producer_address:
            tasks.append(
                (
                    "producer_address",
                    lambda: match_name(
                        "producer_address", expected.producer_address or "", text
                    ),
                )
            )
        else:
            tasks.append(
                (
                    "producer_address",
                    lambda: FieldResult(
                        field="producer_address",
                        status="review",
                        confidence=0.0,
                        expected=None,
                        found=None,
                        reason=(
                            "Producer address is required (27 CFR 4/5/7) but was "
                            "not supplied in the application data — confirm it "
                            "appears on the label."
                        ),
                    ),
                )
            )
    if "alcohol_content" in graded:
        tasks.append(
            (
                "alcohol_content",
                lambda: match_numeric(
                    "alcohol_content",
                    expected.alcohol_content,
                    text,
                    kind="alcohol",
                    tolerance=_abv_tolerance(
                        expected.beverage_type, expected.alcohol_content
                    ),
                ),
            )
        )
    if "net_contents" in graded:
        tasks.append(
            (
                "net_contents",
                lambda: match_numeric(
                    "net_contents", expected.net_contents, text, kind="volume"
                ),
            )
        )
    if "country_of_origin" in graded:
        if expected.country_of_origin is None:
            # An import with no declared country of origin can't be matched;
            # grade it fail with a reason that names the missing declaration
            # rather than the generic "No expected value supplied" path.
            tasks.append(
                (
                    "country_of_origin",
                    lambda: FieldResult(
                        field="country_of_origin",
                        status="fail",
                        confidence=0.0,
                        expected=None,
                        found=None,
                        reason="import is missing a declared country of origin",
                    ),
                )
            )
        else:
            country: str = expected.country_of_origin
            tasks.append(
                (
                    "country_of_origin",
                    lambda: match_presence("country_of_origin", country, text),
                )
            )
    if "government_warning" in graded:
        tasks.append(("government_warning", lambda: check_government_warning(text)))
    return tasks


def _triage_field(difficulty: float, warnings: list[str]) -> FieldResult | None:
    """Build the soft image-quality FieldResult when the image looks too hard.

    Returns ``None`` when the difficulty is below threshold (no triage needed).
    Never produces a ``fail`` — only ``review`` — so a hard-to-read image is
    escalated to a human, not auto-rejected.
    """
    if difficulty < DIFFICULTY_RESHOOT_THRESHOLD:
        return None
    reason = (
        "Image quality is low (difficulty "
        f"{difficulty:.2f}); results may be unreliable. "
    )
    if warnings:
        reason += "Suggestions: " + "; ".join(warnings) + "."
    else:
        reason += "Consider re-shooting the label."
    return FieldResult(
        field=IMAGE_QUALITY_FIELD,
        status="review",
        confidence=round(float(difficulty), 4),
        expected=None,
        found=None,
        reason=reason,
    )


async def verify_async(
    image: bytes | str | np.ndarray,
    expected: ExpectedFields,
    reader: LabelReader | None = None,
) -> VerificationResult:
    """Verify a label image against expected fields (async)."""
    start = time.perf_counter()

    # 1. Preprocess (captures difficulty + warnings for the triage hook).
    #    OpenCV work is CPU-bound, so run it in a worker thread to keep the
    #    event loop responsive.
    logger.debug("event=verify.preprocess.start")
    t_pre = time.perf_counter()
    pre = await asyncio.to_thread(preprocess, image)
    logger.debug(
        "event=verify.preprocess.done difficulty=%.3f warnings=%d latency_ms=%.1f",
        pre.difficulty_score,
        len(pre.warnings),
        (time.perf_counter() - t_pre) * 1000.0,
    )

    # 2. Read (Tier-0 OCR by default; lazy import keeps OCR deps out of callers
    #    that inject their own reader, e.g. unit tests with a fake reader).
    #    Hand the reader the already-cleaned image so it doesn't preprocess a
    #    second time on the latency-critical path. OCR inference blocks for
    #    ~0.5-1s, so it also runs in a worker thread — a blocking read here
    #    would freeze SSE streams and health checks for every call.
    if reader is None:
        from backend.services.readers.ocr_reader import OCRLabelReader

        reader = OCRLabelReader()
    # No event-loop-side gate here: OCR is serialized by the reader's
    # _infer_lock, and a module-level asyncio primitive can't be shared
    # across event loops anyway.
    t_ocr = time.perf_counter()
    output: ReaderOutput = await asyncio.to_thread(
        reader.read, image, expected, preprocessed=pre
    )
    text = output.text
    logger.debug(
        "event=verify.ocr.done chars=%d confidence=%.3f latency_ms=%.1f",
        len(text),
        output.confidence,
        (time.perf_counter() - t_ocr) * 1000.0,
    )

    # 3. Determine graded fields for this product class.
    graded = required_fields_for(expected.beverage_type, expected.is_import)

    # 4. Run the matchers concurrently (sync matchers → threads). A matcher that
    #    raises must not crash the whole verify: collect exceptions and map each
    #    to a soft ``review`` so the field is escalated to a human.
    tasks = _build_tasks(graded, expected, text)
    raw: list[FieldResult | BaseException] = await asyncio.gather(
        *(asyncio.to_thread(fn) for _, fn in tasks),
        return_exceptions=True,
    )
    results: list[FieldResult] = []
    for (field_name, _), outcome in zip(tasks, raw, strict=True):
        if isinstance(outcome, BaseException):
            logger.warning(
                "event=matcher_error field=%s error=%s",
                field_name,
                type(outcome).__name__,
                exc_info=outcome,
            )
            results.append(
                FieldResult(
                    field=field_name,
                    status="review",
                    confidence=0.0,
                    expected=None,
                    found=None,
                    reason=(
                        f"matcher error: {type(outcome).__name__} "
                        "— needs manual review"
                    ),
                )
            )
        else:
            results.append(outcome)

    logger.debug("event=verify.match.done fields=%d", len(results))

    # 5. Auto-triage hook (soft, review-only).
    triage = _triage_field(pre.difficulty_score, pre.warnings)
    if triage is not None:
        results.append(triage)

    # Project OCR boxes back onto the original upload for the reviewer overlay.
    projected = project_boxes_to_original(
        output.word_boxes or [], pre.transform, pre.original_size
    )
    ocr_boxes = [OcrBox(**b) for b in projected] or None

    latency_ms = (time.perf_counter() - start) * 1000.0
    result = VerificationResult(
        overall="pass",  # overridden by the model's derive-overall validator
        fields=results,
        latency_ms=round(latency_ms, 2),
        tier_used=TIER_USED,
        ocr_boxes=ocr_boxes,
    )
    logger.info(
        "event=verify overall=%s fields=%d latency_ms=%.1f difficulty=%.3f tier=%s",
        result.overall,
        len(results),
        latency_ms,
        pre.difficulty_score,
        TIER_USED,
    )
    return result


def verify(
    image: bytes | str | np.ndarray,
    expected: ExpectedFields,
    reader: LabelReader | None = None,
) -> VerificationResult:
    """Synchronous wrapper around :func:`verify_async`.

    Safe to call from non-async code and tests. Raises if called from inside a
    running event loop (use :func:`verify_async` there instead).
    """
    return asyncio.run(verify_async(image, expected, reader))
