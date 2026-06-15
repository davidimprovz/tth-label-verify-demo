"""Minimum-resolution intake gate (D4).

Uploads whose declared long edge is below ``MIN_IMAGE_LONG_EDGE`` (default 640px,
the evidence-based floor from eval/cola_resolution_report.md) are rejected
pre-decode with a friendly ``ImageTooSmallError`` — a deliberate exception to the
app's soft-fail philosophy, since below the floor OCR output is unreliable and a
verdict would be misleading rather than merely uncertain.

The header-dimension probe reuses the same ``_png_dims`` / ``_jpeg_dims`` parsers
the decompression-bomb guard uses, so the check is free (no full decode). The
synthesized-header trick is borrowed from tests/test_pixel_cap.py.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

import backend.services.preprocess as pp

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_label.png"


def _png_with_dims(w: int, h: int) -> bytes:
    """A valid PNG signature whose IHDR declares w x h pixels."""
    real = FIXTURE.read_bytes()
    return real[:16] + struct.pack(">II", w, h) + real[24:]


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


# --- floor constant ----------------------------------------------------------


def test_floor_default_is_640():
    assert pp.MIN_IMAGE_LONG_EDGE == 640


# --- pre-decode rejection of tiny images -------------------------------------


def test_rejects_tiny_png_pre_decode():
    with pytest.raises(pp.ImageTooSmallError, match="too small"):
        pp.preprocess(_png_with_dims(400, 300))


def test_rejects_tiny_jpeg_pre_decode():
    with pytest.raises(pp.ImageTooSmallError, match="too small"):
        pp.preprocess(_jpeg_header(400, 300))


def test_too_small_is_decode_error_subclass():
    """ImageTooSmallError must flow through the existing ImageDecodeError 422 path."""
    assert issubclass(pp.ImageTooSmallError, pp.ImageDecodeError)


def test_too_small_message_names_dims_and_floor():
    with pytest.raises(pp.ImageTooSmallError) as exc:
        pp.preprocess(_jpeg_header(500, 200))
    msg = str(exc.value)
    assert "500x200" in msg
    assert str(pp.MIN_IMAGE_LONG_EDGE) in msg


def test_rejects_via_path(tmp_path):
    p = tmp_path / "tiny.png"
    p.write_bytes(_png_with_dims(320, 240))
    with pytest.raises(pp.ImageTooSmallError, match="too small"):
        pp.preprocess(str(p))


# --- at/above the floor passes the gate --------------------------------------


def test_at_floor_passes_gate():
    """A 640px long-edge image must not be rejected (gate is < floor, not <=)."""
    # A header at exactly the floor decodes to None (not a real image), but the
    # gate must NOT raise ImageTooSmallError — a plain decode failure is fine.
    with pytest.raises(pp.ImageDecodeError) as exc:
        pp.preprocess(_jpeg_header(640, 480))
    assert not isinstance(exc.value, pp.ImageTooSmallError)


def test_real_fixture_above_floor_processes():
    """The bundled sample is well above 640px and must process normally."""
    dims = pp._png_dims(FIXTURE.read_bytes())
    assert dims is not None and max(dims) >= pp.MIN_IMAGE_LONG_EDGE
    out = pp.preprocess(FIXTURE.read_bytes())
    assert out.image.size > 0


# --- ndarray branch ----------------------------------------------------------


def test_rejects_small_ndarray():
    with pytest.raises(pp.ImageTooSmallError, match="too small"):
        pp.preprocess(np.zeros((300, 400), dtype=np.uint8))


def test_accepts_at_floor_ndarray():
    arr = np.zeros((480, 640), dtype=np.uint8)
    out = pp.preprocess(arr)
    assert out.image.size > 0


# --- env override (module constant) ------------------------------------------


def test_env_override_respected(monkeypatch):
    """Lowering the floor lets an otherwise-too-small image through the gate."""
    monkeypatch.setattr(pp, "MIN_IMAGE_LONG_EDGE", 256)
    # 400px long edge now clears the lowered floor → no ImageTooSmallError.
    with pytest.raises(pp.ImageDecodeError) as exc:
        pp.preprocess(_jpeg_header(400, 300))
    assert not isinstance(exc.value, pp.ImageTooSmallError)


def test_env_override_raises_floor(monkeypatch):
    """Raising the floor rejects an image that would otherwise pass."""
    monkeypatch.setattr(pp, "MIN_IMAGE_LONG_EDGE", 4000)
    with pytest.raises(pp.ImageTooSmallError, match="too small"):
        pp.preprocess(FIXTURE.read_bytes())


# --- unknown format must not be false-rejected -------------------------------


def test_unknown_format_skips_gate():
    """Header dims unparseable → no ImageTooSmallError; decode proceeds/fails."""
    with pytest.raises(pp.ImageDecodeError) as exc:
        pp.preprocess(b"\x00\x01\x02junkbyte")
    assert not isinstance(exc.value, pp.ImageTooSmallError)
