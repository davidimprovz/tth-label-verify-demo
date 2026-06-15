"""Tests for ephemeral image handling (task 1.83).

Asserts the core "no sensitive retention" guarantee: temp files/dirs are removed
on success AND on failure (try/finally), never persisted beyond processing.
"""

from __future__ import annotations

import asyncio
import io
from pathlib import Path

import pytest

from backend.services.storage import (
    EphemeralImageDir,
    ImageTooLargeError,
    ephemeral_image,
    safe_suffix,
    stream_to_temp,
)


def test_ephemeral_image_deleted_on_success():
    seen: Path | None = None
    with ephemeral_image(b"hello", suffix=".png") as path:
        seen = path
        assert path.exists()
        assert path.read_bytes() == b"hello"
        assert path.suffix == ".png"
    assert seen is not None
    assert not seen.exists()


def test_ephemeral_image_deleted_on_failure():
    seen: Path | None = None
    with pytest.raises(RuntimeError):
        with ephemeral_image(b"data") as path:
            seen = path
            assert path.exists()
            raise RuntimeError("boom")
    assert seen is not None
    assert not seen.exists()


def test_ephemeral_dir_wipes_all_files():
    workdir = EphemeralImageDir()
    p1 = workdir.write("a.png", b"a")
    p2 = workdir.write("b.png", b"b")
    assert p1.exists() and p2.exists()
    workdir.cleanup()
    assert not workdir.dir.exists()


def test_ephemeral_dir_strips_path_traversal():
    workdir = EphemeralImageDir()
    try:
        p = workdir.write("../../etc/evil.png", b"x")
        # The file must land inside the job dir, not escape it.
        assert p.parent == workdir.dir
        assert p.name.endswith("evil.png")
    finally:
        workdir.cleanup()


def test_ephemeral_dir_unique_names_for_duplicate_filenames():
    """Two uploads with the same client basename must not collide on disk."""
    workdir = EphemeralImageDir()
    try:
        p1 = workdir.write("label.png", b"first")
        p2 = workdir.write("label.png", b"second")
        assert p1 != p2
        assert p1.read_bytes() == b"first"
        assert p2.read_bytes() == b"second"
        # Extension is preserved so readers can sniff the codec.
        assert p1.suffix == ".png" and p2.suffix == ".png"
    finally:
        workdir.cleanup()


# --- safe_suffix -------------------------------------------------------------


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("photo.PNG", ".png"),
        ("a.jpeg", ".jpeg"),
        ("scan.tiff", ".tiff"),
        (None, ".img"),
        ("noext", ".img"),
        ("evil.exe", ".img"),  # not a known image extension
        ("../../x.png", ".png"),  # path separators stripped, ext kept
        ("weird.p/n/g", ".img"),  # separators in the "extension" → reject
    ],
)
def test_safe_suffix_whitelists_image_extensions(filename, expected):
    s = safe_suffix(filename)
    assert s == expected
    assert "/" not in s and "\\" not in s


# --- stream_to_temp ----------------------------------------------------------


class _FakeUpload:
    """Minimal async-readable stand-in for Starlette's UploadFile."""

    def __init__(self, data: bytes, filename: str | None = "f.png") -> None:
        self._buf = io.BytesIO(data)
        self.filename = filename

    async def read(self, size: int = -1) -> bytes:
        return self._buf.read(size)


def _leftover_temp() -> list[Path]:
    import tempfile

    return list(Path(tempfile.gettempdir()).glob("ttb_verify_*"))


def test_stream_to_temp_writes_chunks_within_cap():
    upload = _FakeUpload(b"abcdefghij", filename="pic.png")
    path = asyncio.run(stream_to_temp(upload, max_bytes=100))
    try:
        assert path.exists()
        assert path.read_bytes() == b"abcdefghij"
        assert path.suffix == ".png"
    finally:
        path.unlink(missing_ok=True)


def test_stream_to_temp_rejects_oversized_and_leaves_no_file():
    upload = _FakeUpload(b"x" * 50, filename="big.png")
    before = set(_leftover_temp())
    with pytest.raises(ImageTooLargeError):
        asyncio.run(stream_to_temp(upload, max_bytes=10))
    # The partial temp file must be unlinked when the cap is exceeded.
    assert set(_leftover_temp()) == before


def test_stream_to_temp_rejects_empty_upload():
    upload = _FakeUpload(b"", filename="empty.png")
    before = set(_leftover_temp())
    with pytest.raises(ValueError):
        asyncio.run(stream_to_temp(upload, max_bytes=100))
    assert set(_leftover_temp()) == before


def test_ephemeral_dir_context_manager_cleans_up():
    with EphemeralImageDir() as workdir:
        workdir.write("a.png", b"a")
        d = workdir.dir
        assert d.exists()
    assert not d.exists()
