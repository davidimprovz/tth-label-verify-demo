"""VLMLabelReader unit tests with a mocked Ollama chain (no server needed)."""

from __future__ import annotations

import numpy as np

from backend.models.label_fields import LabelFields
from backend.services.readers.vlm_reader import VLMLabelReader, _fields_to_text


def _img() -> np.ndarray:
    return np.zeros((64, 64, 3), dtype=np.uint8)


def test_read_returns_structured_fields(monkeypatch):
    """A successful chain invoke yields fields + a text serialization."""
    reader = VLMLabelReader()
    fields = LabelFields(
        beverage_type="spirits",
        brand_name="Astral",
        government_warning_text="GOVERNMENT WARNING: ...",
    )

    class _Chain:
        def invoke(self, _messages):
            return fields

    monkeypatch.setattr(reader, "_build_chain", lambda: _Chain())
    out = reader.read(_img())
    assert out.tier == "vlm"
    assert out.fields is fields
    assert "Astral" in out.text
    assert "GOVERNMENT WARNING" in out.text


def test_read_error_returns_none_fields(monkeypatch):
    """A chain failure degrades to empty output, never raises."""
    reader = VLMLabelReader()

    class _Chain:
        def invoke(self, _messages):
            raise RuntimeError("ollama down")

    monkeypatch.setattr(reader, "_build_chain", lambda: _Chain())
    out = reader.read(_img())
    assert out.fields is None
    assert out.text == ""
    assert out.tier == "vlm"


def test_unavailable_when_flag_off(monkeypatch):
    """is_available is False unless the tier is switched on."""
    monkeypatch.setattr("backend.settings.VLM_ENABLED", False)
    assert VLMLabelReader().is_available() is False


def test_fields_to_text_skips_nulls():
    text = _fields_to_text(LabelFields(brand_name="X", class_type=None))
    assert text == "X"
