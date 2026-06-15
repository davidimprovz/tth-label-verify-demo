"""Tests for the verification-by-expectation field matchers (task 1.3)."""

from __future__ import annotations

from backend.services.matcher import (
    match_name,
    match_numeric,
    match_presence,
    match_producer,
    normalize,
)

# --- normalize --------------------------------------------------------------


def test_normalize_strips_smart_quotes_and_possessive():
    assert normalize("STONE’S THROW") == normalize("Stone's Throw")


def test_normalize_collapses_whitespace():
    assert normalize("  A   B\tC\n") == "a b c"


def test_normalize_is_case_insensitive():
    assert normalize("PRODUCT OF MEXICO") == normalize("product of mexico")


def test_normalize_strips_diacritics():
    # Accents must not survive normalization: "México" folds to "mexico".
    assert normalize("MÉXICO") == normalize("Mexico") == "mexico"


def test_normalize_strips_symbols_and_punctuation():
    # Hyphens, periods, commas, and other symbols are dropped (but % is kept).
    assert normalize("product-of-mexico.") == normalize("Product of Mexico")
    assert normalize("Alc. 45%") == "alc 45%"


# --- match_name -------------------------------------------------------------


def test_match_name_apostrophe_caps_passes():
    res = match_name(
        "brand_name",
        "STONE'S THROW",
        "Welcome to Stone's Throw Distillery, est. 2012",
    )
    assert res.status == "pass"
    assert res.field == "brand_name"


def test_match_name_exact_passes():
    res = match_name("class_type", "Bourbon Whiskey", "KENTUCKY BOURBON WHISKEY")
    assert res.status == "pass"


def test_match_name_case_insensitive_passes():
    # Identical text differing only in case must pass.
    res = match_name(
        "class_type",
        "Kentucky Straight Bourbon Whiskey",
        "kentucky straight bourbon whiskey",
    )
    assert res.status == "pass"


def test_match_name_class_type_symbols_and_case_passes():
    # Punctuation/symbols and case differences in class_type must not mismatch.
    res = match_name(
        "class_type",
        "Kentucky Straight Bourbon Whiskey",
        "KENTUCKY-STRAIGHT BOURBON WHISKEY.",
    )
    assert res.status == "pass"


def test_match_name_close_reviews():
    res = match_name("brand_name", "Silver Oak Cellars", "Silver Oak")
    # "Silver Oak" is an exact token subset of the expected name → pass.
    assert res.status == "pass"


def test_match_name_short_brand_no_incidental_substring():
    # A short single-token brand ("Stone") must NOT pass on incidental substring
    # hits inside unrelated longer words.
    res = match_name(
        "brand_name",
        "Stone",
        "Fine stonework and cornerstone masonry supplies",
    )
    assert res.status != "pass"


def test_match_name_short_brand_real_token_passes():
    # A real "Stone" token still passes.
    res = match_name(
        "brand_name", "Stone", "STONE BREWING CO. INDIA PALE ALE"
    )
    assert res.status == "pass"


def test_match_name_unrelated_fails():
    res = match_name("brand_name", "Stone's Throw", "Jack Daniel's Old No. 7")
    assert res.status == "fail"


# --- match_numeric: alcohol -------------------------------------------------


def test_alcohol_with_proof_crosscheck_passes():
    res = match_numeric(
        "alcohol_content",
        "45% Alc./Vol. (90 Proof)",
        "DISTILLED SPIRITS 45% ALC/VOL",
        kind="alcohol",
    )
    assert res.status == "pass"


def test_alcohol_within_tolerance_passes():
    res = match_numeric(
        "alcohol_content", "45% Alc./Vol.", "45.4% ALC/VOL", kind="alcohol"
    )
    assert res.status == "pass"


def test_alcohol_out_of_tolerance_fails():
    res = match_numeric(
        "alcohol_content", "45% Alc./Vol.", "40% ALC/VOL", kind="alcohol"
    )
    assert res.status == "fail"


def test_alcohol_absent_fails():
    res = match_numeric(
        "alcohol_content", "45% Alc./Vol.", "750 mL bourbon", kind="alcohol"
    )
    assert res.status == "fail"


def test_alcohol_expected_proof_only_vs_label_abv_passes():
    # Expected gives only proof (100 = 50% ABV); label gives ABV.
    res = match_numeric(
        "alcohol_content", "100 Proof", "50% Alc./Vol.", kind="alcohol"
    )
    assert res.status == "pass"


def test_alcohol_expected_proof_only_vs_label_proof_passes():
    # Both sides give only proof; derive ABV = proof / 2 on each side.
    res = match_numeric(
        "alcohol_content", "100 Proof", "100 Proof", kind="alcohol"
    )
    assert res.status == "pass"


def test_alcohol_internally_inconsistent_proof_reviews_or_fails():
    # Expected claims 45% but says 80 proof (=40%); inconsistent input.
    res = match_numeric(
        "alcohol_content",
        "45% Alc./Vol. (80 Proof)",
        "45% ALC/VOL",
        kind="alcohol",
    )
    # Expected is internally inconsistent but the label ABV matches the stated
    # ABV, so the result is flagged for human review (not an outright fail).
    assert res.status == "review"


# --- match_numeric: volume --------------------------------------------------


def test_volume_ml_spacing_passes():
    res = match_numeric("net_contents", "750 mL", "NET CONTENTS 750ML", kind="volume")
    assert res.status == "pass"


def test_volume_cl_equivalent_passes():
    res = match_numeric("net_contents", "75 cl", "750 mL", kind="volume")
    assert res.status == "pass"


def test_volume_liter_equivalent_passes():
    res = match_numeric("net_contents", "1 L", "1000 mL", kind="volume")
    assert res.status == "pass"


def test_volume_floz_no_space_passes():
    # "fl.oz" with a period and no space must parse to fluid ounces.
    res = match_numeric("net_contents", "5 fl.oz", "NET 5 FL.OZ", kind="volume")
    assert res.status == "pass"


def test_volume_floz_spacing_variants_parse():
    # All fl-oz spellings parse and compare equal to the expected 5 fl oz.
    for label in ("5 fl.oz", "5 fl. oz", "5 floz", "5 fl oz"):
        res = match_numeric("net_contents", "5 fl oz", label, kind="volume")
        assert res.status == "pass", label


def test_volume_mismatch_fails():
    res = match_numeric("net_contents", "750 mL", "375 mL", kind="volume")
    assert res.status == "fail"


def test_volume_absent_fails():
    res = match_numeric("net_contents", "750 mL", "45% ALC/VOL", kind="volume")
    assert res.status == "fail"


# --- match_producer ---------------------------------------------------------


def test_producer_name_and_full_address_passes():
    res = match_producer(
        "Stone's Throw Distillery",
        "Bardstown, KY",
        "BOTTLED BY STONE'S THROW DISTILLERY, BARDSTOWN, KY 40004",
    )
    assert res.status == "pass"
    assert res.field == "producer_name"


def test_producer_partial_address_not_fail():
    # Name exact and the city ("Bardstown") is present (only the state is
    # cropped), so the address still corroborates → pass.
    res = match_producer(
        "Stone's Throw Distillery",
        "Bardstown, KY",
        "BOTTLED BY STONE'S THROW DISTILLERY, BARDSTOWN",
    )
    assert res.status == "pass"


def test_producer_name_missing_fails():
    res = match_producer(
        "Stone's Throw Distillery",
        "Bardstown, KY",
        "PRODUCED BY SOME OTHER COMPANY, LOUISVILLE, KY",
    )
    assert res.status == "fail"


def test_producer_no_address_provided_uses_name_only():
    res = match_producer(
        "Stone's Throw Distillery",
        None,
        "BOTTLED BY STONE'S THROW DISTILLERY",
    )
    assert res.status == "pass"


# --- match_presence ---------------------------------------------------------


def test_presence_country_found_passes():
    res = match_presence(
        "country_of_origin", "Product of Mexico", "PRODUCT OF MEXICO  100% AGAVE"
    )
    assert res.status == "pass"


def test_presence_country_case_accent_and_symbol_insensitive_passes():
    # Goal example: expected "Product of Mexico" vs found "PRODUCT OF MÉXICO."
    # (caps + accent + trailing period) must still pass.
    res = match_presence(
        "country_of_origin", "Product of Mexico", "PRODUCT OF MÉXICO."
    )
    assert res.status == "pass"


def test_presence_country_absent_fails():
    res = match_presence(
        "country_of_origin", "Product of Mexico", "DISTILLED AND BOTTLED IN KENTUCKY"
    )
    assert res.status == "fail"
