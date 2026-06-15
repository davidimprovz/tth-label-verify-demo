"""Tests for the Tier-0 OCR reader (task 1.5).

Uses the committed synthetic label fixture (rendered by
``tests/fixtures/generate_label.py``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.services.readers.base import LabelReader, ReaderOutput
from backend.services.readers.ocr_reader import OCRLabelReader

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_label.png"


@pytest.fixture(scope="module")
def reader() -> OCRLabelReader:
    return OCRLabelReader()


def test_reader_conforms_to_protocol(reader: OCRLabelReader):
    assert isinstance(reader, LabelReader)
    assert reader.name == "rapidocr"


def test_reads_brand_from_fixture(reader: OCRLabelReader):
    assert FIXTURE.exists(), f"missing committed fixture: {FIXTURE}"
    out = reader.read(str(FIXTURE), None)
    assert isinstance(out, ReaderOutput)
    assert out.tier == "ocr"
    assert 0.0 <= out.confidence <= 1.0
    # The rendered brand should appear in the recognized text (case-insensitive).
    assert "riverstone" in out.text.lower()


def test_word_boxes_present(reader: OCRLabelReader):
    out = reader.read(str(FIXTURE), None)
    assert out.word_boxes is not None
    assert all("text" in b and "confidence" in b for b in out.word_boxes)


def test_read_uses_supplied_preprocessed_and_skips_preprocess(
    reader: OCRLabelReader, monkeypatch
):
    # When handed an already-cleaned image, the reader must NOT preprocess again
    # and must feed the supplied cleaned ndarray to the engine.
    import backend.services.readers.ocr_reader as ocr_mod

    calls = {"preprocess": 0}

    def _spy_preprocess(image):  # pragma: no cover - should not run
        calls["preprocess"] += 1
        raise AssertionError("preprocess must not be called when preprocessed is given")

    monkeypatch.setattr(ocr_mod, "preprocess", _spy_preprocess)

    seen = {}

    def _fake_engine(img):
        seen["img"] = img
        return [], None

    monkeypatch.setattr(ocr_mod, "_get_engine", lambda: _fake_engine)

    import cv2

    fixture_img = cv2.imread(str(FIXTURE), cv2.IMREAD_GRAYSCALE)
    out = reader.read(str(FIXTURE), None, preprocessed=fixture_img)

    assert calls["preprocess"] == 0
    assert seen["img"] is fixture_img
    assert isinstance(out, ReaderOutput)
    assert out.tier == "ocr"
