"""Verification-by-expectation field matchers.

Each matcher takes an expected application-data value and the label's OCR text
and decides whether the value is present/correct on the label. They return a
``FieldResult`` (pass / review / fail) with a human-readable reason.

- ``match_name``     — fuzzy text match for brand / class-type / producer names.
- ``match_numeric``  — unit-aware numeric match for alcohol content and volume.
- ``match_producer`` — combined name + (optional) address match.
- ``match_presence`` — fuzzy presence check (e.g. country of origin on imports).

Numeric parsing uses ``pint`` for unit conversion and ``Decimal`` for exact
arithmetic. Fuzzy text matching uses ``rapidfuzz``.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from decimal import Decimal, InvalidOperation

from pint import UnitRegistry
from pint.errors import DimensionalityError, UndefinedUnitError
from rapidfuzz.fuzz import partial_ratio, partial_ratio_alignment, token_set_ratio

from backend.models.verification import FieldResult, Status

logger = logging.getLogger("ttb_label_verifier")


def _trunc(value: object, limit: int = 80) -> str:
    """Stringify and truncate a value for cheap DEBUG logging."""
    s = "" if value is None else str(value)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _log_field(result: FieldResult) -> FieldResult:
    """Emit a DEBUG match.field line for a result; returns it unchanged."""
    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(
            "event=match.field field=%s status=%s score=%.4f expected=%s found=%s",
            result.field,
            result.status,
            result.confidence,
            _trunc(result.expected),
            _trunc(result.found),
        )
    return result

# --- thresholds -------------------------------------------------------------

# Fuzzy text thresholds (0-100): >=90 pass, 75-<90 review, <75 fail.
NAME_PASS = 90.0
NAME_REVIEW = 75.0

# ABV tolerance in percentage points (configurable per call).
DEFAULT_ABV_TOLERANCE = Decimal("0.5")

# Volume relative tolerance (0.5%) absorbs rounding between unit systems
# (e.g. 75 cl == 750 mL exactly, but fl-oz conversions are not round numbers).
VOLUME_REL_TOLERANCE = Decimal("0.005")

# --- text normalization -----------------------------------------------------

_SMART_QUOTES = {
    "‘": "'",  # left single
    "’": "'",  # right single / apostrophe
    "“": '"',  # left double
    "”": '"',  # right double
    "′": "'",  # prime
    "″": '"',  # double prime
}
_POSSESSIVE_RE = re.compile(r"'s\b")
_PUNCT_RE = re.compile(r"[^\w\s%]")
_WS_RE = re.compile(r"\s+")


def normalize(s: str) -> str:
    """Normalize text for fuzzy comparison.

    NFKD unicode-normalize, fold smart quotes to ASCII, strip combining
    diacritical marks (so "México" == "Mexico"), lowercase, drop possessives
    ("'s"), strip punctuation (keeping ``%`` and word chars), and collapse
    whitespace.
    """
    s = s or ""
    s = unicodedata.normalize("NFKD", s)
    for fancy, plain in _SMART_QUOTES.items():
        s = s.replace(fancy, plain)
    # NFKD splits accented letters into base + combining mark (category "Mn",
    # which is a word char and would otherwise survive _PUNCT_RE); drop the marks
    # so accents never cause a false mismatch (é→e, ñ→n, ü→u, …).
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = _POSSESSIVE_RE.sub("", s)  # "stone's" -> "stone"
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s)
    return s.strip()


# --- name matching ----------------------------------------------------------


def _best_snippet(expected_norm: str, ocr_norm: str, ocr_raw: str) -> str:
    """Return the OCR substring that best aligns with the expected value."""
    if not expected_norm or not ocr_norm:
        return ""
    alignment = partial_ratio_alignment(expected_norm, ocr_norm)
    if alignment is None:
        return ocr_raw.strip()
    # Align against the normalized haystack; map back coarsely to the raw text
    # by proportional position (good enough for a human-facing snippet).
    start = alignment.dest_start
    end = alignment.dest_end
    snippet = ocr_norm[start:end].strip()
    return snippet or ocr_norm.strip()


# A short single-token expected name is prone to incidental substring matches
# inside unrelated longer words (e.g. "Stone" inside "cornerstone"/"stonework").
# For these we require an exact whole-token hit rather than trusting a high
# partial_ratio. Multi-word names carry enough signal to rely on the fuzzy score.
_SHORT_NAME_MAX_LEN = 6


def _is_short_single_token(exp_norm: str) -> bool:
    """True for a single token no longer than ``_SHORT_NAME_MAX_LEN`` chars."""
    tokens = exp_norm.split()
    return len(tokens) == 1 and len(tokens[0]) <= _SHORT_NAME_MAX_LEN


def _has_exact_token(exp_norm: str, hay_norm: str) -> bool:
    """True if the single expected token appears as a whole token in ``hay``."""
    tokens = set(hay_norm.split())
    return exp_norm in tokens


def _name_score(exp_norm: str, hay_norm: str) -> float:
    """Fuzzy score for a name, with a short-token guard against substring hits.

    For a very short single-token expected name, an incidental substring match
    inside a longer unrelated word (high ``partial_ratio``) must not count: we
    require the token to appear verbatim as a whole token in the haystack,
    otherwise the score is suppressed below the pass/review bands.
    """
    if not exp_norm or not hay_norm:
        return 0.0
    score = max(partial_ratio(exp_norm, hay_norm), token_set_ratio(exp_norm, hay_norm))
    if _is_short_single_token(exp_norm) and not _has_exact_token(exp_norm, hay_norm):
        return 0.0
    return score


def match_name(field: str, expected: str, ocr_text: str) -> FieldResult:
    """Fuzzy-match a name field (brand / class type / producer name)."""
    exp = normalize(expected)
    hay = normalize(ocr_text)
    if not exp:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=0.0,
            expected=expected,
            found=None,
            reason="No expected value supplied.",
        ))
    if not hay:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=0.99,
            expected=expected,
            found=None,
            reason="No OCR text to search.",
        ))

    score = _name_score(exp, hay)
    snippet: str | None = _best_snippet(exp, hay, ocr_text)
    confidence = round(score / 100.0, 4)

    status: Status
    if score >= NAME_PASS:
        status, reason = "pass", f"Found a close match (score {score:.0f})."
    elif score >= NAME_REVIEW:
        status, reason = "review", f"Found a partial match (score {score:.0f}); please verify."
    else:
        status, reason = "fail", f"No match found (best score {score:.0f})."
        snippet = None

    return _log_field(FieldResult(
        field=field,
        status=status,
        confidence=confidence,
        expected=expected,
        found=snippet,
        reason=reason,
    ))


# --- numeric matching -------------------------------------------------------

_UREG: UnitRegistry = UnitRegistry()

_ABV_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_PROOF_RE = re.compile(r"(\d+(?:\.\d+)?)\s*proof", re.IGNORECASE)
# Volume: a number optionally with a decimal, then a unit token.
_VOLUME_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(ml|milliliter[s]?|cl|centiliter[s]?|l|liter[s]?|litre[s]?|"
    r"fl\.?\s*oz|fluid\s+ounce[s]?|oz)\b",
    re.IGNORECASE,
)

_VOLUME_UNIT_CANON = {
    "ml": "milliliter",
    "milliliter": "milliliter",
    "milliliters": "milliliter",
    "cl": "centiliter",
    "centiliter": "centiliter",
    "centiliters": "centiliter",
    "l": "liter",
    "liter": "liter",
    "liters": "liter",
    "litre": "liter",
    "litres": "liter",
    "oz": "fluid_ounce",
    "fl oz": "fluid_ounce",
    "floz": "fluid_ounce",
    "fluid ounce": "fluid_ounce",
    "fluid ounces": "fluid_ounce",
}


def _to_decimal(num: str) -> Decimal | None:
    try:
        return Decimal(num)
    except (InvalidOperation, TypeError):
        return None


def _parse_abv(text: str) -> Decimal | None:
    m = _ABV_RE.search(text or "")
    return _to_decimal(m.group(1)) if m else None


def _parse_proof(text: str) -> Decimal | None:
    m = _PROOF_RE.search(text or "")
    return _to_decimal(m.group(1)) if m else None


def _parse_volume(text: str):
    """Return a pint Quantity for the first volume in ``text``, or None."""
    m = _VOLUME_RE.search(text or "")
    if not m:
        return None
    value = _to_decimal(m.group(1))
    if value is None:
        return None
    unit_raw = _WS_RE.sub(" ", m.group(2).lower().replace(".", "").strip())
    unit = _VOLUME_UNIT_CANON.get(unit_raw)
    if unit is None:
        return None
    try:
        return float(value) * _UREG(unit)
    except (UndefinedUnitError, DimensionalityError):
        return None


def _match_alcohol(
    field: str, expected: str, ocr_text: str, tolerance: Decimal
) -> FieldResult:
    exp_abv = _parse_abv(expected)
    exp_proof = _parse_proof(expected)

    # Cross-check the expected value's own proof against its ABV (proof = 2*ABV).
    internal_reason = ""
    internal_problem = False
    if exp_abv is not None and exp_proof is not None:
        if abs(exp_proof - (exp_abv * 2)) > Decimal("0.5"):
            internal_problem = True
            internal_reason = (
                f"Expected value is internally inconsistent: {exp_abv}% ABV implies "
                f"{exp_abv * 2} proof but states {exp_proof} proof. "
            )

    # If the expected value gives only a proof (e.g. "100 Proof"), derive the
    # ABV as proof / 2 rather than failing to parse.
    if exp_abv is None and exp_proof is not None:
        exp_abv = exp_proof / 2

    if exp_abv is None:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=0.0,
            expected=expected,
            found=None,
            reason="Could not parse an ABV percentage from the expected value.",
        ))

    found_abv = _parse_abv(ocr_text)
    # The label side may also state only a proof; fall back to proof / 2.
    if found_abv is None:
        found_proof = _parse_proof(ocr_text)
        if found_proof is not None:
            found_abv = found_proof / 2
    if found_abv is None:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=0.95,
            expected=expected,
            found=None,
            reason="No alcohol content found on the label.",
        ))

    delta = abs(found_abv - exp_abv)
    found_str = f"{found_abv}% Alc./Vol."
    if delta <= tolerance:
        if internal_problem:
            return _log_field(FieldResult(
                field=field,
                status="review",
                confidence=0.7,
                expected=expected,
                found=found_str,
                reason=internal_reason + "Label ABV matches the expected ABV.",
            ))
        return _log_field(FieldResult(
            field=field,
            status="pass",
            confidence=0.97,
            expected=expected,
            found=found_str,
            reason=f"Label ABV {found_abv}% matches expected {exp_abv}% (±{tolerance}).",
        ))

    return _log_field(FieldResult(
        field=field,
        status="fail",
        confidence=0.95,
        expected=expected,
        found=found_str,
        reason=(
            internal_reason
            + f"Label ABV {found_abv}% differs from expected {exp_abv}% by {delta} "
            f"(tolerance ±{tolerance})."
        ),
    ))


def _match_volume(field: str, expected: str, ocr_text: str) -> FieldResult:
    exp_q = _parse_volume(expected)
    if exp_q is None:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=0.0,
            expected=expected,
            found=None,
            reason="Could not parse a volume from the expected value.",
        ))

    found_q = _parse_volume(ocr_text)
    if found_q is None:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=0.95,
            expected=expected,
            found=None,
            reason="No net contents / volume found on the label.",
        ))

    exp_ml = Decimal(str(exp_q.to("milliliter").magnitude))
    found_ml = Decimal(str(found_q.to("milliliter").magnitude))
    found_str = f"{found_q.magnitude:g} {found_q.units:~}"

    if exp_ml == 0:
        rel = Decimal("1") if found_ml != 0 else Decimal("0")
    else:
        rel = abs(found_ml - exp_ml) / exp_ml

    if rel <= VOLUME_REL_TOLERANCE:
        return _log_field(FieldResult(
            field=field,
            status="pass",
            confidence=0.97,
            expected=expected,
            found=found_str,
            reason=f"Label volume equals expected ({exp_ml:g} mL).",
        ))

    return _log_field(FieldResult(
        field=field,
        status="fail",
        confidence=0.95,
        expected=expected,
        found=found_str,
        reason=(
            f"Label volume {found_ml:g} mL differs from expected {exp_ml:g} mL."
        ),
    ))


def match_numeric(
    field: str,
    expected: str,
    ocr_text: str,
    kind: str,
    tolerance: Decimal | None = None,
) -> FieldResult:
    """Unit-aware numeric match.

    ``kind="alcohol"`` parses an ABV percentage (and cross-checks proof if the
    expected value includes one). ``kind="volume"`` parses a volume and compares
    after normalizing units (mL / cl / L / fl oz).
    """
    if kind == "alcohol":
        tol = tolerance if tolerance is not None else DEFAULT_ABV_TOLERANCE
        return _match_alcohol(field, expected, ocr_text, tol)
    if kind == "volume":
        return _match_volume(field, expected, ocr_text)
    raise ValueError(f"Unknown numeric kind: {kind!r}")


# --- producer (name + address) ---------------------------------------------


def match_producer(
    expected_name: str,
    expected_address: str | None,
    ocr_text: str,
) -> FieldResult:
    """Match producer name and (optionally) address, combined into one result.

    Name is weighted higher than address. A partial address (e.g. city present
    but state cropped) must not by itself cause a fail when the name matches.
    """
    field = "producer_name"
    hay = normalize(ocr_text)
    exp_name = normalize(expected_name)

    name_score = _name_score(exp_name, hay)

    # Name is the dominant signal — a missing/wrong name fails outright.
    if name_score < NAME_REVIEW:
        return _log_field(FieldResult(
            field=field,
            status="fail",
            confidence=round(name_score / 100.0, 4),
            expected=_combine(expected_name, expected_address),
            found=None,
            reason=f"Producer name not found (best score {name_score:.0f}).",
        ))

    addr_score = None
    if expected_address:
        exp_addr = normalize(expected_address)
        addr_score = (
            max(partial_ratio(exp_addr, hay), token_set_ratio(exp_addr, hay))
            if exp_addr and hay
            else 0.0
        )

    snippet = _best_snippet(exp_name, hay, ocr_text)
    expected_combined = _combine(expected_name, expected_address)

    # Decide status. Name is the gate; address only nudges toward review when it
    # is clearly off, never to a fail on its own.
    status: Status
    if name_score >= NAME_PASS:
        if addr_score is None or addr_score >= NAME_REVIEW:
            status = "pass"
            reason = f"Producer name matches (score {name_score:.0f})."
            if addr_score is not None:
                reason += f" Address corroborated (score {addr_score:.0f})."
        else:
            status = "review"
            reason = (
                f"Producer name matches (score {name_score:.0f}) but the address "
                f"is weak/partial (score {addr_score:.0f}); please verify."
            )
    else:  # name in review band
        status = "review"
        reason = f"Producer name is a partial match (score {name_score:.0f}); please verify."

    # Confidence weights name 0.7 / address 0.3.
    if addr_score is None:
        confidence = round(name_score / 100.0, 4)
    else:
        confidence = round((0.7 * name_score + 0.3 * addr_score) / 100.0, 4)

    return _log_field(FieldResult(
        field=field,
        status=status,
        confidence=confidence,
        expected=expected_combined,
        found=snippet,
        reason=reason,
    ))


def _combine(name: str, address: str | None) -> str:
    return f"{name}, {address}" if address else name


# --- presence ---------------------------------------------------------------


def match_presence(field: str, expected: str, ocr_text: str) -> FieldResult:
    """Fuzzy presence check (e.g. country of origin on imports).

    Absent → fail. Reuses the same pass/review/fail thresholds as name matching.
    """
    return match_name(field, expected, ocr_text)
