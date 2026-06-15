"""Tests for the Government Warning checker (task 1.2)."""

from __future__ import annotations

from backend.services.warning import GOVERNMENT_WARNING, check_government_warning


def test_exact_canonical_text_passes():
    res = check_government_warning(GOVERNMENT_WARNING)
    assert res.field == "government_warning"
    assert res.status == "pass"


def test_altered_body_fails():
    # A meaning-changing single-word swap ("defects" -> "problems") must fail
    # even though the overall fuzzy ratio stays high (~98): the critical-word
    # check catches the substituted critical term.
    bad = GOVERNMENT_WARNING.replace("birth defects", "birth problems")
    res = check_government_warning(bad)
    assert res.status == "fail"


def test_ocr_degraded_body_reviews():
    # Wording is intact but the body is peppered with light single-character OCR
    # errors, dropping the fuzzy ratio into the [88, 97) review band. Critical
    # words remain recognizable, so this is review (needs human eyes), not fail.
    degraded = (
        GOVERNMENT_WARNING.replace("According", "Aocording")
        .replace("Surgeon", "Surgenn")
        .replace("alcoholic", "alcohojic")
        .replace("beverages", "beveragss")
        .replace("pregnancy", "pregnaney")
        .replace("because", "becausc")
        .replace("defects", "defecte")
        .replace("impairs", "irnpairs")
        .replace("machinery", "machlnery")
        .replace("problems", "problams")
    )
    res = check_government_warning(degraded)
    assert res.status == "review"


def test_title_case_header_reviews():
    text = GOVERNMENT_WARNING.replace("GOVERNMENT WARNING", "Government Warning")
    res = check_government_warning(text)
    assert res.status == "review"


def test_missing_colon_reviews():
    text = GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT WARNING")
    res = check_government_warning(text)
    assert res.status == "review"


def test_absent_warning_fails():
    res = check_government_warning("Brand X Bourbon Whiskey 750 mL 45% Alc/Vol")
    assert res.status == "fail"


def test_embedded_in_noisy_ocr_passes():
    noisy = (
        "STONE'S THROW DISTILLERY\n"
        "KENTUCKY STRAIGHT BOURBON WHISKEY\n"
        "750 mL    45% ALC./VOL. (90 PROOF)\n"
        f"{GOVERNMENT_WARNING}\n"
        "BOTTLED BY STONE'S THROW DISTILLERY, BARDSTOWN, KY\n"
    )
    res = check_government_warning(noisy)
    assert res.status == "pass"


def test_whitespace_and_linebreaks_tolerated():
    # OCR often splits the block across lines / doubles spaces.
    chopped = GOVERNMENT_WARNING.replace(". ", ".\n  ").replace(", ", ",\n")
    res = check_government_warning(chopped)
    assert res.status == "pass"


def test_reason_is_populated():
    res = check_government_warning("nothing here")
    assert res.reason  # non-empty human explanation
