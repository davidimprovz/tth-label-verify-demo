"""Government Warning checker (27 CFR 16.21).

Verifies that the canonical Surgeon General Government Warning appears on the
label's OCR'd text, with the correct wording and an ALL-CAPS verbatim header.

Body grading uses **graded fuzzy bands** rather than a strict verbatim match,
because real OCR introduces light character-level noise that must not turn a
correct warning into a false ``fail`` — while genuinely altered wording must
still fail. We compare the normalized body against the normalized canonical body
with ``rapidfuzz.fuzz.ratio`` (full-length similarity, NOT ``partial_ratio`` —
trailing label noise is handled by locating the warning block, not by partial
matching) and grade:

- ratio >= 97                      → body verbatim.
- 88 <= ratio < 97                 → body present but OCR-degraded → at most
                                     ``review`` ("needs review").
- ratio < 88                       → altered/incomplete wording → ``fail``.

A high fuzzy ratio alone cannot distinguish a meaning-changing single-word swap
(e.g. "birth defects" -> "birth problems", which still scores ~98 on the ~260
char body) from benign OCR noise. So we add a complementary **critical-word
check**: each safety-critical term (defects / pregnancy / machinery) must still
have a close token present in the body; a substituted critical word forces a
``fail`` regardless of the overall ratio.

The header ALL-CAPS + colon checks are graded **separately** from the body so a
degraded body cannot mask a real header-format issue, and a header-format issue
on an otherwise-verbatim body stays ``review``. The final status is the worst of
{body band, header band}.

Verdicts:
- ``pass``   — verbatim body wording AND an ALL-CAPS "GOVERNMENT WARNING:"
               header.
- ``review`` — body wording present but OCR-degraded, OR header formatting is
               off (title-case header / missing colon). Needs human eyes, not a
               wording violation. This aligns with the cascade /
               human-in-the-loop design: ambiguous-but-plausible cases are
               escalated rather than auto-failed.
- ``fail``   — the warning is missing, its body wording is altered, or a
               safety-critical word was substituted.

Scope note: **bold/prominence detection is out of scope here.** OCR text carries
no font weight, so this checker cannot assess whether the warning is bold or
sufficiently prominent. 27 CFR 16.21 also requires the statement to be bold and
conspicuous; that prominence/placement check is best-effort and can be layered
on later by the caller using layout bounding boxes. This function only validates
wording and header capitalization from plain text.
"""

from __future__ import annotations

import logging
import re

from rapidfuzz.fuzz import ratio
from rapidfuzz.process import extractOne

from backend.models.verification import FieldResult

logger = logging.getLogger("ttb_label_verifier")

GOVERNMENT_WARNING = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not "
    "drink alcoholic beverages during pregnancy because of the risk of birth "
    "defects. (2) Consumption of alcoholic beverages impairs your ability to "
    "drive a car or operate machinery, and may cause health problems."
)

_FIELD = "government_warning"

# Header literal (without the colon) used for the all-caps / verbatim check.
_HEADER = "GOVERNMENT WARNING"

# Canonical body once the header is removed, used for word-for-word comparison.
_CANONICAL_BODY = GOVERNMENT_WARNING[len(_HEADER) :]  # starts at ":"

_WS_RE = re.compile(r"\s+")
# Match the header case-insensitively, optionally followed by a colon, so we can
# locate the warning block inside noisy OCR and inspect the original casing.
_HEADER_RE = re.compile(r"government\s+warning\s*:?", re.IGNORECASE)

# Graded fuzzy-ratio bands (0-100) for the body vs the canonical body.
_BODY_VERBATIM = 97.0  # >= this → verbatim
_BODY_DEGRADED = 88.0  # [this, _BODY_VERBATIM) → OCR-degraded, review

# Safety-critical words that must survive intact. A high overall ratio cannot
# catch a meaning-changing single-word swap, so each of these must still have a
# close token in the body. Threshold separates OCR noise (>=80) from genuine
# substitutions (<=50); 70 sits cleanly in the gap.
_CRITICAL_WORDS = ("defects", "pregnancy", "machinery")
_CRITICAL_MIN = 70.0


def _collapse_ws(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def _normalize_body(text: str) -> str:
    """Lowercase + whitespace-collapse for word-for-word body comparison."""
    return _collapse_ws(text).lower()


def _critical_words_intact(norm_body: str) -> bool:
    """True if every safety-critical word still has a close token in the body.

    Catches meaning-changing substitutions (e.g. "defects" -> "problems") that
    a high overall fuzzy ratio would otherwise let through, while tolerating
    light OCR corruption of those same words (e.g. "defecte").
    """
    tokens = norm_body.split()
    if not tokens:
        return False
    for word in _CRITICAL_WORDS:
        best = extractOne(word, tokens, scorer=ratio)
        if best is None or best[1] < _CRITICAL_MIN:
            return False
    return True


def apply_format_gate(
    result: FieldResult, *, all_caps: bool | None, bold: bool | None
) -> FieldResult:
    """Fail a warning result when it is not ALL CAPS / not bold (27 CFR 16.21).

    These are visual properties only a vision model can judge — OCR text carries
    no font weight and unreliable casing — so the booleans come from the VLM tier.
    ``None`` means "not assessed" and leaves the result unchanged. The all-caps
    rule is a hard fail (per requirement); bold likewise.
    """
    problems = []
    if all_caps is False:
        problems.append("must be in ALL CAPITAL LETTERS")
    if bold is False:
        problems.append("must be bold")
    if not problems:
        return result
    return result.model_copy(
        update={
            "status": "fail",
            "confidence": max(result.confidence, 0.9),
            "reason": (
                "Government Warning " + " and ".join(problems) + " (27 CFR 16.21)."
            ),
        }
    )


def check_government_warning(ocr_text: str) -> FieldResult:
    """Verify the Government Warning in (possibly noisy) OCR text.

    See module docstring for the verdict rules and the bold/prominence scope
    limitation.
    """
    text = ocr_text or ""

    match = _HEADER_RE.search(text)
    if match is None:
        logger.debug("event=warning.check status=fail reason=header_not_found")
        return FieldResult(
            field=_FIELD,
            status="fail",
            confidence=0.99,
            expected=GOVERNMENT_WARNING,
            found=None,
            reason="Government Warning statement not found on the label.",
        )

    header_text = match.group(0)
    # Everything from the matched header to the end of the OCR text is the
    # candidate warning block. Trailing label noise is tolerated because the
    # canonical body comparison only consumes the canonical span.
    block = text[match.start() :]

    # The body is whatever follows the matched header within the block. Strip a
    # leading colon so the comparison is colon-agnostic (header colon presence is
    # graded separately below as a formatting check).
    body = block[len(header_text) :].lstrip().lstrip(":")
    norm_body = _normalize_body(body)
    norm_canonical_body = _normalize_body(_CANONICAL_BODY.lstrip(":"))

    # Display snippet: header + the canonical-length span of the body. The body
    # has had its leading colon stripped, so use the colon-stripped canonical
    # length (fixes the prior off-by-colon over-slice that pulled in extra text).
    snippet_len = len(header_text) + len(body[: len(_CANONICAL_BODY.lstrip(":"))])
    found_snippet = _collapse_ws(block[:snippet_len])

    # --- body band (full-length fuzzy ratio + critical-word guard) ----------
    # Compare the canonical-length *prefix* of the body against the canonical
    # body. This keeps the comparison full-length (so trailing noise inside the
    # warning span still lowers the score) while ignoring unrelated label lines
    # that follow the warning — i.e. trailing block noise is handled by location,
    # not by partial matching.
    norm_body_span = norm_body[: len(norm_canonical_body)]
    body_ratio = ratio(norm_body_span, norm_canonical_body)
    critical_ok = _critical_words_intact(norm_body_span)
    logger.debug(
        "event=warning.check body_ratio=%.1f critical_ok=%s header_caps=%s has_colon=%s",
        body_ratio,
        critical_ok,
        _HEADER in _collapse_ws(header_text),
        ":" in header_text,
    )

    if not critical_ok:
        # A safety-critical word was substituted (caught regardless of the
        # overall ratio). This is a genuine wording violation.
        return FieldResult(
            field=_FIELD,
            status="fail",
            confidence=0.9,
            expected=GOVERNMENT_WARNING,
            found=_collapse_ws(block),
            reason=(
                "Government Warning wording is altered: a required safety-critical "
                "term (birth defects / pregnancy / machinery) is missing or "
                "substituted, violating 27 CFR 16.21."
            ),
        )

    if body_ratio < _BODY_DEGRADED:
        # Wording is genuinely altered/incomplete.
        return FieldResult(
            field=_FIELD,
            status="fail",
            confidence=0.9,
            expected=GOVERNMENT_WARNING,
            found=_collapse_ws(block),
            reason=(
                "Government Warning wording does not match the required "
                f"27 CFR 16.21 statement (similarity {body_ratio:.0f}%)."
            ),
        )

    body_verbatim = body_ratio >= _BODY_VERBATIM

    # --- header band (graded separately so it can't be masked by the body) --
    header_caps_ok = _HEADER in _collapse_ws(header_text)
    has_colon = ":" in header_text
    header_ok = header_caps_ok and has_colon

    # Final status = worst of {body band, header band}.
    if body_verbatim and header_ok:
        return FieldResult(
            field=_FIELD,
            status="pass",
            confidence=0.99,
            expected=GOVERNMENT_WARNING,
            found=found_snippet,
            reason="Verbatim wording with ALL-CAPS 'GOVERNMENT WARNING:' header.",
        )

    # Build a reason explaining whichever band(s) landed in review.
    problems = []
    if not body_verbatim:
        problems.append(
            "warning present but text could not be confirmed verbatim — needs "
            f"review (similarity {body_ratio:.0f}%)"
        )
    if not header_caps_ok:
        problems.append("header is not ALL CAPS")
    if not has_colon:
        problems.append("header is missing its colon")

    return FieldResult(
        field=_FIELD,
        status="review",
        confidence=0.8,
        expected=GOVERNMENT_WARNING,
        found=found_snippet if not body_verbatim else _collapse_ws(header_text),
        reason="; ".join(problems) + ". Required header is 'GOVERNMENT WARNING:'.",
    )
