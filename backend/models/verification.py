"""Verification-by-expectation domain models.

The app is GIVEN the expected application-data field values and checks whether
each is present/correct on the label's OCR'd text. These models describe that
contract: ``ExpectedFields`` (the application data to verify), ``FieldResult``
(the per-field verdict), and ``VerificationResult`` (the aggregate verdict).

A core invariant lives here: ``VerificationResult.overall`` is derived, never
trusted from the caller — if any graded field is ``fail`` or ``review`` the
overall verdict is ``review``. A failing field can never silently pass.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, field_validator, model_validator

logger = logging.getLogger("ttb_label_verifier")

BeverageType = Literal["spirits", "wine", "beer"]
Status = Literal["pass", "review", "fail"]

# Per-field length caps (chars). Mirror these in the frontend (lib/fieldOptions.ts
# FIELD_MAX_LENGTHS) so client and server agree on what's acceptable.
MAX_NAME_LEN = 200  # brand_name, class_type, producer_name, country_of_origin
MAX_ADDRESS_LEN = 300
MAX_SHORT_LEN = 60  # alcohol_content, net_contents

# Response abuse caps: a pathological image must not bloat the payload.
MAX_OCR_BOXES = 500
MAX_OCR_TEXT_LEN = 300
MAX_OCR_POINTS = 64  # a quad needs 4; allow slack for polygon OCR engines


def _strip_control(value: str) -> str:
    """Drop ASCII control chars (except tab/newline) so input can't smuggle them."""
    return "".join(c for c in value if c >= " " or c in "\t\n")


# Trimmed, control-stripped, length-bounded string types for the graded fields.
_Name = Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_NAME_LEN)]
_Address = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=MAX_ADDRESS_LEN)
]
_Short = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=MAX_SHORT_LEN)
]


class ExpectedFields(BaseModel):
    """Application-supplied field values to verify against the label."""

    beverage_type: BeverageType
    brand_name: _Name
    class_type: _Name
    alcohol_content: _Short
    net_contents: _Short
    producer_name: _Name
    producer_address: _Address | None = None
    country_of_origin: _Name | None = None
    is_import: bool = False

    @field_validator(
        "brand_name",
        "class_type",
        "alcohol_content",
        "net_contents",
        "producer_name",
        "producer_address",
        "country_of_origin",
        mode="before",
    )
    @classmethod
    def _sanitize(cls, value: object) -> object:
        """Strip ASCII control characters before length/whitespace constraints."""
        if isinstance(value, str):
            return _strip_control(value)
        return value


# Fields required on every label regardless of class. The Government Warning is
# always required (27 CFR 16.21) and is graded under the "government_warning"
# pseudo-field.
_ALWAYS_REQUIRED: frozenset[str] = frozenset(
    {
        "brand_name",
        "class_type",
        "net_contents",
        "producer_name",
        # TTB requires the responsible party's name AND address (27 CFR 5/4/7),
        # so the address is graded as its own field, not folded into the name.
        "producer_address",
        "government_warning",
    }
)


def required_fields_for(beverage_type: BeverageType, is_import: bool) -> set[str]:
    """Return the set of fields that must be graded for this product.

    Per-class rules (see docs/ttb-beverage-requirements.md, 27 CFR parts 4/5/7):
    - ``brand_name``, ``class_type``, ``net_contents``, ``producer_name``,
      ``producer_address`` and the Government Warning are always required.
    - ``alcohol_content`` is required for spirits and wine; for beer it is
      optional (malt beverages state ABV only when added flavors contribute
      alcohol — not detectable from the app's fields), so it is not required for
      beer. The numeric tolerance differs by class (spirits ±0.3, wine ±1.5/±1.0)
      and is applied by the matcher, not here.
    - ``country_of_origin`` is required only for imports.
    """
    required = set(_ALWAYS_REQUIRED)
    if beverage_type in ("spirits", "wine"):
        required.add("alcohol_content")
    if is_import:
        required.add("country_of_origin")
    return required


class FieldResult(BaseModel):
    """Verdict for a single field check."""

    field: str
    status: Status
    confidence: float
    expected: str | None
    found: str | None
    reason: str


class OcrBox(BaseModel):
    """A single OCR text box, projected into ORIGINAL-image pixel coordinates.

    ``points`` is the quad ``[[x, y], ...]`` (clockwise from top-left) the
    frontend overlays on the displayed upload; ``text`` is the recognized line.
    """

    points: list[list[int]]
    text: str
    confidence: float | None = None

    @field_validator("text")
    @classmethod
    def _cap_text(cls, value: str) -> str:
        """Truncate over-long OCR lines so one box can't bloat the response."""
        if len(value) > MAX_OCR_TEXT_LEN:
            logger.debug("event=ocr_box.text_truncated len=%d", len(value))
            return value[:MAX_OCR_TEXT_LEN]
        return value

    @field_validator("points")
    @classmethod
    def _cap_points(cls, value: list[list[int]]) -> list[list[int]]:
        """Bound the per-box point count (a quad is 4; allow polygon slack)."""
        if len(value) > MAX_OCR_POINTS:
            logger.debug("event=ocr_box.points_capped len=%d", len(value))
            return value[:MAX_OCR_POINTS]
        return value


class VerificationResult(BaseModel):
    """Aggregate verdict across all graded fields.

    ``overall`` is derived from the field statuses and cannot be overridden by
    the caller: any ``fail`` or ``review`` field forces an overall ``review``.
    """

    overall: Literal["pass", "review"]
    fields: list[FieldResult]
    latency_ms: float | None = None
    tier_used: str | None = None
    ocr_boxes: list[OcrBox] | None = None

    @field_validator("ocr_boxes")
    @classmethod
    def _cap_boxes(cls, value: list[OcrBox] | None) -> list[OcrBox] | None:
        """Cap the number of boxes so a pathological image can't bloat the response."""
        if value is not None and len(value) > MAX_OCR_BOXES:
            logger.debug("event=ocr_boxes.capped count=%d", len(value))
            return value[:MAX_OCR_BOXES]
        return value

    @model_validator(mode="after")
    def _derive_overall(self) -> VerificationResult:
        has_problem = any(f.status in ("fail", "review") for f in self.fields)
        object.__setattr__(self, "overall", "review" if has_problem else "pass")
        return self
