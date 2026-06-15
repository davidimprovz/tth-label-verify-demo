"""Tests for the verification orchestrator (task 1.6).

Two layers:
- Fast deterministic tests using a fake reader (no OCR) to exercise the
  aggregation, parallelism, per-class field selection, and the triage hook.
- Integration tests using the committed synthetic label fixture through the real
  RapidOCR reader.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from backend.models.verification import ExpectedFields, VerificationResult
from backend.services.readers.base import ReaderOutput
from backend.services.verify import IMAGE_QUALITY_FIELD, verify
from backend.services.warning import GOVERNMENT_WARNING
from tests.fixtures.generate_label import (
    ALCOHOL,
    BRAND_NAME,
    CLASS_TYPE,
    NET_CONTENTS,
    PRODUCER,
    PRODUCER_CITY,
)

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_label.png"
KNOB_CREEK = Path("data/eval/real/knob_creek_back_01.png")

# Text a perfect reader would extract from the synthetic fixture.
_CLEAN_TEXT = "\n".join(
    [
        BRAND_NAME,
        CLASS_TYPE,
        ALCOHOL,
        NET_CONTENTS,
        PRODUCER,
        PRODUCER_CITY,
        GOVERNMENT_WARNING,
    ]
)


class FakeReader:
    """A LabelReader that returns canned text, bypassing OCR."""

    name = "fake"

    def __init__(self, text: str, confidence: float = 0.95) -> None:
        self._text = text
        self._confidence = confidence

    def read(self, image, expected, *, preprocessed=None) -> ReaderOutput:
        return ReaderOutput(
            text=self._text, confidence=self._confidence, tier="ocr"
        )


def _expected(**overrides) -> ExpectedFields:
    base = dict(
        beverage_type="spirits",
        brand_name=BRAND_NAME,
        class_type=CLASS_TYPE,
        alcohol_content=ALCOHOL,
        net_contents=NET_CONTENTS,
        producer_name=PRODUCER,
        producer_address=PRODUCER_CITY,
    )
    base.update(overrides)
    return ExpectedFields(**base)


def _low_quality_image() -> np.ndarray:
    # A sharp but content-sparse (non-blank, low-quality) dummy so preprocess
    # doesn't add triage noise in the fake-reader tests (difficulty stays low).
    # Long edge >= MIN_IMAGE_LONG_EDGE so the D4 intake gate doesn't reject it
    # (this represents a normal label, not a genuinely-too-small upload).
    img = np.full((640, 480), 255, dtype=np.uint8)
    img[40:60, 40:440] = 0
    img[120:140, 40:440] = 0
    return img


# --- fast deterministic tests (fake reader) ---------------------------------


def test_clean_label_passes_all_fields():
    res = verify(_low_quality_image(), _expected(), reader=FakeReader(_CLEAN_TEXT))
    assert isinstance(res, VerificationResult)
    assert res.overall == "pass"
    assert res.latency_ms is not None and res.latency_ms >= 0
    assert res.tier_used == "ocr"
    statuses = {f.field: f.status for f in res.fields}
    for fld in (
        "brand_name",
        "class_type",
        "alcohol_content",
        "net_contents",
        "producer_name",
        "government_warning",
    ):
        assert statuses[fld] == "pass", (fld, statuses[fld])
    # No country_of_origin for a domestic spirit.
    assert "country_of_origin" not in statuses


def test_wrong_brand_fails_that_field_and_reviews_overall():
    res = verify(
        _low_quality_image(),
        _expected(brand_name="Completely Different Whiskey"),
        reader=FakeReader(_CLEAN_TEXT),
    )
    statuses = {f.field: f.status for f in res.fields}
    assert statuses["brand_name"] == "fail"
    assert res.overall == "review"


def test_import_requires_country_of_origin():
    text = _CLEAN_TEXT + "\nProduct of Scotland"
    res = verify(
        _low_quality_image(),
        _expected(is_import=True, country_of_origin="Scotland"),
        reader=FakeReader(text),
    )
    statuses = {f.field: f.status for f in res.fields}
    assert "country_of_origin" in statuses
    assert statuses["country_of_origin"] == "pass"


def test_beer_does_not_require_alcohol_content():
    text = "\n".join([BRAND_NAME, "India Pale Ale", NET_CONTENTS, PRODUCER, GOVERNMENT_WARNING])
    res = verify(
        _low_quality_image(),
        _expected(beverage_type="beer", class_type="India Pale Ale"),
        reader=FakeReader(text),
    )
    statuses = {f.field: f.status for f in res.fields}
    assert "alcohol_content" not in statuses


def test_low_quality_image_adds_triage_review():
    # A heavily blurred image should cross the reshoot threshold and add the
    # synthetic image_quality field as review — without hard-failing.
    sharp = _low_quality_image()
    import cv2

    blurred = cv2.GaussianBlur(sharp, (0, 0), sigmaX=8.0)
    res = verify(blurred, _expected(), reader=FakeReader(_CLEAN_TEXT))
    triage = [f for f in res.fields if f.field == IMAGE_QUALITY_FIELD]
    assert triage, "expected an image_quality triage field"
    assert triage[0].status == "review"
    assert res.overall == "review"


def test_high_quality_image_has_no_triage_field():
    res = verify(_low_quality_image(), _expected(), reader=FakeReader(_CLEAN_TEXT))
    assert all(f.field != IMAGE_QUALITY_FIELD for f in res.fields)


def test_matcher_exception_grades_field_review_not_crash(monkeypatch):
    # A matcher that raises must NOT crash verify: the offending field is graded
    # ``review`` (manual review) and the overall verdict drops to ``review``.
    import backend.services.verify as verify_mod

    def _boom(*args, **kwargs):
        raise RuntimeError("matcher blew up")

    # brand_name's task calls match_name via the verify module namespace.
    monkeypatch.setattr(verify_mod, "match_name", _boom)

    res = verify(_low_quality_image(), _expected(), reader=FakeReader(_CLEAN_TEXT))
    assert isinstance(res, VerificationResult)
    statuses = {f.field: f.status for f in res.fields}
    assert statuses["brand_name"] == "review"
    brand = next(f for f in res.fields if f.field == "brand_name")
    assert "matcher error" in brand.reason
    assert "RuntimeError" in brand.reason
    assert res.overall == "review"


def test_import_missing_country_of_origin_fails_with_clear_reason():
    res = verify(
        _low_quality_image(),
        _expected(is_import=True, country_of_origin=None),
        reader=FakeReader(_CLEAN_TEXT),
    )
    coo = next(f for f in res.fields if f.field == "country_of_origin")
    assert coo.status == "fail"
    assert "country of origin" in coo.reason


# --- integration tests (real OCR) -------------------------------------------


def test_verify_synthetic_fixture_passes():
    assert FIXTURE.exists(), f"missing committed fixture: {FIXTURE}"
    res = verify(str(FIXTURE), _expected())
    assert res.latency_ms is not None
    statuses = {f.field: f.status for f in res.fields}
    # Each graded field should be pass or review (not fail) on the clean render.
    for fld in ("brand_name", "alcohol_content", "net_contents", "government_warning"):
        assert statuses[fld] in ("pass", "review"), (fld, statuses[fld])
    assert res.overall in ("pass", "review")


def test_verify_synthetic_wrong_brand_fails():
    res = verify(str(FIXTURE), _expected(brand_name="Nonexistent Phantom Label XYZ"))
    statuses = {f.field: f.status for f in res.fields}
    assert statuses["brand_name"] == "fail"
    assert res.overall == "review"


@pytest.mark.skipif(not KNOB_CREEK.exists(), reason="real image fixture not present")
def test_knob_creek_real_image_rejected_below_floor():
    """The knob_creek fixture (387px long edge) sits below the D4 intake floor,
    so a real sub-floor image is rejected at intake rather than OCR'd into an
    unreliable verdict."""
    import pytest as _pytest

    from backend.services.preprocess import ImageTooSmallError

    expected = ExpectedFields(
        beverage_type="spirits",
        brand_name="Knob Creek",
        class_type="Kentucky Straight Bourbon Whiskey",
        alcohol_content="50% Alc./Vol. (100 Proof)",
        net_contents="750 mL",
        producer_name="Knob Creek Distillery",
    )
    with _pytest.raises(ImageTooSmallError, match="too small"):
        verify(str(KNOB_CREEK), expected)
