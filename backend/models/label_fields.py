"""Structured label-field schema.

This is the single extraction contract reused by both the M0.7 benchmark
harness and the production verification pipeline. Every field is Optional so a
model that cannot find a value returns ``None`` rather than hallucinating one
(the schema is consumed via LangChain ``.with_structured_output(LabelFields)``).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LabelFields(BaseModel):
    """The nine mandatory/identifying fields extracted from an alcohol label.

    All fields are Optional. A model MUST return ``None`` for any field it
    cannot locate on the label rather than guessing.
    """

    beverage_type: str | None = Field(
        default=None,
        description="Kind of beverage: one of spirits, wine, or beer.",
    )
    brand_name: str | None = Field(
        default=None,
        description="The brand name as printed on the label.",
    )
    class_type: str | None = Field(
        default=None,
        description="Class/type designation, e.g. 'Kentucky Straight Bourbon Whiskey'.",
    )
    alcohol_content: str | None = Field(
        default=None,
        description="Alcohol content as printed, e.g. '45% Alc./Vol.' or '90 Proof'.",
    )
    net_contents: str | None = Field(
        default=None,
        description="Net contents / volume as printed, e.g. '750 mL'.",
    )
    producer_name: str | None = Field(
        default=None,
        description="Producer, bottler, or importer name.",
    )
    producer_address: str | None = Field(
        default=None,
        description="Producer/bottler/importer city and state (or full address).",
    )
    country_of_origin: str | None = Field(
        default=None,
        description="Country of origin for imported products, e.g. 'Product of Mexico'.",
    )
    government_warning_text: str | None = Field(
        default=None,
        description=(
            "The full Government Warning statement EXACTLY as printed, INCLUDING "
            "the leading 'GOVERNMENT WARNING:' header. Null if absent."
        ),
    )
    # Visual properties only a vision model can judge (OCR text carries no
    # casing-reliability or font weight). Null when not assessed.
    government_warning_all_caps: bool | None = Field(
        default=None,
        description=(
            "True if the ENTIRE Government Warning (header + body) is printed in "
            "ALL CAPITAL LETTERS. False if any part is lower/mixed case."
        ),
    )
    government_warning_bold: bool | None = Field(
        default=None,
        description="True if the Government Warning text is printed in BOLD.",
    )
