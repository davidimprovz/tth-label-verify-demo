"""VLM refinement tier (Phase 2, async).

The OCR pass produces a fast verdict. This module re-reads the *uncertain* parts
with the VLM and merges an improved verdict in:

- ``select_escalation`` — which fields warrant a VLM re-read: always the
  Government Warning (OCR garbles the dense text), plus any field OCR graded
  ``review``/``fail`` or with low confidence.
- ``refine_with_vlm`` — re-read with the VLM reader and run the SAME field
  matchers against its extraction (so statuses/reasons stay consistent), for the
  escalated fields only. VLM-sourced results are flagged in their ``reason``.
- ``merge`` — fold the refined results into the OCR result. Guard: only escalated
  fields are touched (a confident OCR pass is never disturbed), so the VLM can
  rescue an unread field but can't silently overturn a clean read. The overall
  verdict is recomputed by the model validator.

VLM hallucination is bounded by this gate (only escalated fields), the flag on
every VLM-sourced value, and the fact that values are matched against the
expected data (a fabricated value usually mismatches → still review/fail).
"""

from __future__ import annotations

import logging

import numpy as np

from backend.models.verification import (
    ExpectedFields,
    FieldResult,
    VerificationResult,
    required_fields_for,
)
from backend.services.readers.base import LabelReader
from backend.services.verify import _build_tasks
from backend.services.warning import apply_format_gate, check_government_warning

logger = logging.getLogger("ttb_label_verifier")

# Below this OCR confidence a field is re-checked even if it nominally passed.
_LOW_CONF = 0.75
# The triage pseudo-field is about image quality, not a label field — never VLM it.
_SKIP_FIELDS = {"image_quality"}
# Appended to a refined field's reason so the source is never silent.
_VLM_NOTE = " [refined by VLM]"


def select_escalation(result: VerificationResult, low_conf: float = _LOW_CONF) -> set[str]:
    """Fields the VLM should re-check: always the warning + any weak OCR field."""
    escalate = {"government_warning"}
    for f in result.fields:
        if f.field in _SKIP_FIELDS:
            continue
        if f.status in ("fail", "review") or f.confidence < low_conf:
            escalate.add(f.field)
    return escalate


def refine_with_vlm(
    image: bytes | str | np.ndarray,
    expected: ExpectedFields,
    escalate: set[str],
    reader: LabelReader,
) -> list[FieldResult]:
    """Re-read with the VLM and re-run matchers for the escalated fields.

    Returns VLM-sourced ``FieldResult``s (flagged in their reason). Empty when the
    VLM is unavailable or returns nothing — the caller then keeps the OCR verdict.
    """
    out = reader.read(image, expected)
    if out.fields is None:
        logger.info("event=refine.skip reason=vlm_no_fields")
        return []
    graded = required_fields_for(expected.beverage_type, expected.is_import)
    to_check = escalate & graded
    results: list[FieldResult] = []

    # Non-warning fields: re-run their matchers against the VLM extraction.
    for field_name, fn in _build_tasks(to_check - {"government_warning"}, expected, out.text):
        try:
            results.append(_flag(fn()))
        except Exception as exc:  # noqa: BLE001
            logger.warning("event=refine.matcher_error field=%s err=%s", field_name, exc)

    # Warning: grade wording on the extracted statement, then apply the visual
    # ALL-CAPS / bold gate (27 CFR 16.21) using the VLM's booleans — properties
    # only a vision model can judge.
    if "government_warning" in to_check:
        wtext = out.fields.government_warning_text or ""
        warn = check_government_warning(wtext)
        # All-caps: derive from the extracted text (what is actually printed) —
        # the model's standalone all-caps bool proved unreliable, so we keep it
        # only to log disagreements. Bold: text can't reveal it → trust the bool.
        text_caps = _text_is_all_caps(wtext)
        vlm_caps = out.fields.government_warning_all_caps
        if vlm_caps is not None and text_caps is not None and vlm_caps != text_caps:
            logger.info("event=refine.caps_mismatch vlm=%s text=%s", vlm_caps, text_caps)
        warn = apply_format_gate(
            warn, all_caps=text_caps, bold=out.fields.government_warning_bold
        )
        results.append(_flag(warn))

    logger.info("event=refine.done escalated=%d refined=%d", len(to_check), len(results))
    return results


def _text_is_all_caps(text: str) -> bool | None:
    """True if every letter in ``text`` is uppercase; None when there are none."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return None
    return all(c.isupper() for c in letters)


def _flag(result: FieldResult) -> FieldResult:
    """Mark a result as VLM-sourced so the verdict is never silently changed."""
    return result.model_copy(update={"reason": result.reason + _VLM_NOTE})


def merge(ocr_result: VerificationResult, refined: list[FieldResult]) -> VerificationResult:
    """Fold refined (VLM) field results into the OCR result; overall recomputes.

    Only escalated fields are refined, and a clean OCR pass is never escalated, so
    a refined result supersedes its OCR counterpart safely (it can rescue an
    unread field, not overturn a confident read).
    """
    by_field: dict[str, FieldResult] = {f.field: f for f in ocr_result.fields}
    superseded = 0
    for rf in refined:
        cur = by_field.get(rf.field)
        # Don't let the VLM disturb a field OCR already passed cleanly (those
        # aren't escalated, but guard defensively against a stale escalate set).
        if cur is not None and cur.status == "pass":
            continue
        by_field[rf.field] = rf
        superseded += 1
    logger.info("event=refine.merge superseded=%d", superseded)
    return VerificationResult(
        overall="pass",  # recomputed by the model's derive-overall validator
        fields=list(by_field.values()),
        latency_ms=ocr_result.latency_ms,
        tier_used=f"{ocr_result.tier_used or 'ocr'}+vlm",
        ocr_boxes=ocr_result.ocr_boxes,
    )
