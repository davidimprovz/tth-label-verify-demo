"""Refinement tier tests: escalation selection, VLM re-read, merge guards."""

from __future__ import annotations

from backend.models.label_fields import LabelFields
from backend.models.verification import ExpectedFields, FieldResult, VerificationResult
from backend.services.readers.base import ReaderOutput
from backend.services.refine import merge, refine_with_vlm, select_escalation
from backend.services.warning import GOVERNMENT_WARNING


def _fr(field, status, conf=0.9):
    return FieldResult(
        field=field, status=status, confidence=conf, expected="X", found="X", reason=""
    )


def _result(fields):
    return VerificationResult(overall="pass", fields=fields)


def test_select_escalation_warning_plus_weak_fields():
    r = _result([
        _fr("brand_name", "pass", 0.95),       # clean pass — not escalated
        _fr("net_contents", "fail", 0.2),       # failed — escalated
        _fr("class_type", "pass", 0.4),         # low-confidence pass — escalated
        _fr("image_quality", "review", 0.0),    # triage pseudo-field — skipped
    ])
    esc = select_escalation(r)
    assert "government_warning" in esc        # always
    assert "net_contents" in esc
    assert "class_type" in esc
    assert "brand_name" not in esc
    assert "image_quality" not in esc


class _Reader:
    name = "vlm"

    def __init__(self, fields):
        self._fields = fields

    def read(self, image, expected=None, *, preprocessed=None):
        vals = self._fields.model_dump().values() if self._fields else []
        text = "\n".join(str(v) for v in vals if v)
        return ReaderOutput(text=text, confidence=0.0, tier="vlm", fields=self._fields)


_EXPECTED = ExpectedFields(
    beverage_type="spirits", brand_name="x", class_type="x",
    alcohol_content="40%", net_contents="750 mL", producer_name="x", is_import=False,
)


def test_refine_fixes_warning_and_flags_source():
    # All-caps + bold + verbatim wording → pass (casing is ignored for wording).
    refined = refine_with_vlm(
        b"img", _EXPECTED, {"government_warning"},
        _Reader(LabelFields(
            government_warning_text=GOVERNMENT_WARNING.upper(),
            government_warning_bold=True,
        )),
    )
    warn = next(r for r in refined if r.field == "government_warning")
    assert warn.status == "pass"
    assert "[refined by VLM]" in warn.reason


def test_refine_empty_when_vlm_returns_nothing():
    assert refine_with_vlm(b"img", _EXPECTED, {"government_warning"}, _Reader(None)) == []


def test_warning_fails_when_not_all_caps():
    """Verbatim wording but mixed-case (not ALL CAPS) → fail (27 CFR 16.21)."""
    # The canonical constant is mixed-case → derived all-caps is False.
    refined = refine_with_vlm(
        b"img", _EXPECTED, {"government_warning"},
        _Reader(LabelFields(
            government_warning_text=GOVERNMENT_WARNING,
            government_warning_bold=True,
        )),
    )
    warn = next(r for r in refined if r.field == "government_warning")
    assert warn.status == "fail"
    assert "ALL CAPITAL LETTERS" in warn.reason


def test_merge_supersedes_failed_field_not_clean_pass():
    ocr = _result([
        _fr("government_warning", "fail", 0.99),  # OCR couldn't read it
        _fr("brand_name", "pass", 0.95),          # clean pass — must survive
    ])
    refined = [
        FieldResult(field="government_warning", status="pass", confidence=0.9,
                    expected="...", found="...", reason="ok [refined by VLM]"),
        FieldResult(field="brand_name", status="fail", confidence=0.5,
                    expected="X", found="Y", reason="vlm disagrees [refined by VLM]"),
    ]
    merged = merge(ocr, refined)
    by = {f.field: f for f in merged.fields}
    assert by["government_warning"].status == "pass"   # rescued
    assert by["brand_name"].status == "pass"           # clean OCR pass not overturned
    assert merged.tier_used.endswith("+vlm")
