"""Tests for the verification-by-expectation domain models (task 1.1)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.models.verification import (
    ExpectedFields,
    FieldResult,
    VerificationResult,
    required_fields_for,
)


def _expected(**overrides) -> ExpectedFields:
    base = dict(
        beverage_type="spirits",
        brand_name="Stone's Throw",
        class_type="Kentucky Straight Bourbon Whiskey",
        alcohol_content="45% Alc./Vol.",
        net_contents="750 mL",
        producer_name="Stone's Throw Distillery",
    )
    base.update(overrides)
    return ExpectedFields(**base)


# --- ExpectedFields ---------------------------------------------------------


def test_expected_fields_defaults():
    ef = _expected()
    assert ef.is_import is False
    assert ef.producer_address is None
    assert ef.country_of_origin is None


def test_expected_fields_rejects_bad_beverage_type():
    with pytest.raises(ValidationError):
        _expected(beverage_type="cider")


def test_expected_fields_serialization_roundtrip():
    ef = _expected(producer_address="Bardstown, KY", country_of_origin="USA")
    dumped = ef.model_dump()
    assert dumped["brand_name"] == "Stone's Throw"
    assert ExpectedFields(**dumped) == ef


# --- required_fields_for ----------------------------------------------------

ALWAYS = {
    "brand_name",
    "class_type",
    "net_contents",
    "producer_name",
    "government_warning",
}


def test_required_spirits_domestic():
    req = required_fields_for("spirits", is_import=False)
    assert ALWAYS <= req
    assert "alcohol_content" in req
    assert "country_of_origin" not in req


def test_required_wine_requires_alcohol():
    req = required_fields_for("wine", is_import=False)
    assert "alcohol_content" in req


def test_required_beer_alcohol_optional():
    req = required_fields_for("beer", is_import=False)
    assert ALWAYS <= req
    assert "alcohol_content" not in req


def test_required_import_adds_country_of_origin():
    req = required_fields_for("spirits", is_import=True)
    assert "country_of_origin" in req


def test_required_domestic_no_country_of_origin():
    req = required_fields_for("beer", is_import=False)
    assert "country_of_origin" not in req


# --- FieldResult ------------------------------------------------------------


def test_field_result_serialization():
    fr = FieldResult(
        field="brand_name",
        status="pass",
        confidence=0.97,
        expected="Stone's Throw",
        found="Stone's Throw",
        reason="exact match",
    )
    d = fr.model_dump()
    assert d["status"] == "pass"
    assert d["field"] == "brand_name"


def test_field_result_rejects_bad_status():
    with pytest.raises(ValidationError):
        FieldResult(
            field="brand_name",
            status="ok",
            confidence=1.0,
            expected=None,
            found=None,
            reason="",
        )


# --- VerificationResult overall derivation ---------------------------------


def _fr(field: str, status: str) -> FieldResult:
    return FieldResult(
        field=field,
        status=status,
        confidence=1.0,
        expected=None,
        found=None,
        reason="",
    )


def test_overall_pass_when_all_pass():
    vr = VerificationResult(
        overall="pass",
        fields=[_fr("brand_name", "pass"), _fr("net_contents", "pass")],
    )
    assert vr.overall == "pass"


def test_overall_review_when_one_fail():
    # Even if caller mistakenly says "pass", a fail forces "review".
    vr = VerificationResult(
        overall="pass",
        fields=[_fr("brand_name", "pass"), _fr("alcohol_content", "fail")],
    )
    assert vr.overall == "review"


def test_overall_review_when_one_review():
    vr = VerificationResult(
        overall="pass",
        fields=[_fr("brand_name", "pass"), _fr("class_type", "review")],
    )
    assert vr.overall == "review"


def test_overall_never_silently_passes_a_fail():
    vr = VerificationResult(
        overall="review",
        fields=[_fr("government_warning", "fail")],
    )
    assert vr.overall == "review"


def test_verification_result_optional_telemetry():
    vr = VerificationResult(overall="pass", fields=[_fr("brand_name", "pass")])
    assert vr.latency_ms is None
    assert vr.tier_used is None
    vr2 = VerificationResult(
        overall="pass",
        fields=[_fr("brand_name", "pass")],
        latency_ms=12.5,
        tier_used="ocr",
    )
    assert vr2.latency_ms == 12.5
    assert vr2.tier_used == "ocr"
