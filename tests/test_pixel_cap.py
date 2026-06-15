"""Decoded-pixel cap (audit T1.2): a small *encoded* file may declare a huge
decoded size (decompression bomb). Dimensions are parsed from the header and
rejected before any full decode."""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

import backend.services.preprocess as pp

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_label.png"


def _bomb_png() -> bytes:
    """A valid PNG signature whose IHDR declares 50000x50000 pixels."""
    real = FIXTURE.read_bytes()
    return real[:16] + struct.pack(">II", 50_000, 50_000) + real[24:]


def _jpeg_header(w: int, h: int) -> bytes:
    """Minimal JPEG prefix: SOI + SOF0 declaring w x h."""
    sof = (
        b"\xff\xc0"
        + (17).to_bytes(2, "big")
        + b"\x08"
        + h.to_bytes(2, "big")
        + w.to_bytes(2, "big")
        + b"\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    )
    return b"\xff\xd8" + sof


def test_png_dims_parses_fixture():
    dims = pp._png_dims(FIXTURE.read_bytes())
    assert dims is not None
    w, h = dims
    assert w > 0 and h > 0


def test_jpeg_dims_parses_sof():
    assert pp._jpeg_dims(_jpeg_header(640, 480)) == (640, 480)


def test_preprocess_rejects_png_bomb_bytes():
    with pytest.raises(pp.ImageDecodeError, match="exceeds cap"):
        pp.preprocess(_bomb_png())


def test_preprocess_rejects_bomb_via_path(tmp_path):
    p = tmp_path / "bomb.png"
    p.write_bytes(_bomb_png())
    with pytest.raises(pp.ImageDecodeError, match="exceeds cap"):
        pp.preprocess(str(p))


def test_truncated_png_header_is_handled():
    """A bare PNG signature parses to no dims and junk bytes raise cleanly."""
    assert pp._png_dims(b"\x89PNG\r\n\x1a\n") is None
    with pytest.raises(ValueError):
        pp.preprocess(b"\x00\x01\x02junkbyte")


def test_preprocess_rejects_jpeg_bomb_bytes():
    with pytest.raises(pp.ImageDecodeError, match="exceeds cap"):
        pp.preprocess(_jpeg_header(50_000, 50_000))


def test_preprocess_rejects_oversize_ndarray(monkeypatch):
    monkeypatch.setattr(pp, "MAX_DECODED_PIXELS", 100)
    with pytest.raises(ValueError):
        pp.preprocess(np.zeros((20, 20), dtype=np.uint8))


def test_normal_fixture_still_processes():
    out = pp.preprocess(FIXTURE.read_bytes())
    assert out.image.size > 0
