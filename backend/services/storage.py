"""Ephemeral image handling (task 1.83).

Uploaded label images are sensitive and MUST NOT be persisted beyond the
lifetime of a single request/job. This module provides small context managers
that materialize uploaded bytes into a private temp file (some readers/codecs
prefer a path) and **guarantee deletion** — on success AND on failure — via
``try/finally``.

Two shapes:

- :func:`ephemeral_image` — one upload, one temp file, deleted on exit.
- :class:`EphemeralImageDir` — a private temp *directory* for a batch job; all
  files inside it are removed when the job's stream is consumed or it fails.

Nothing here writes to a database or a durable path; the only on-disk artifacts
live under the OS temp dir and are unlinked before the call returns. This honors
the "no sensitive retention" constraint from the design (§ requirements).
"""

from __future__ import annotations

import itertools
import logging
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Protocol

logger = logging.getLogger("ttb_label_verifier")

_TMP_PREFIX = "ttb_verify_"

# Chunk size for streaming uploads to disk without buffering the whole file.
_CHUNK = 1 << 20  # 1 MiB

# Whitelist of image extensions we will pass to ``mkstemp(suffix=...)``. Anything
# outside this set (or containing a path separator) falls back to ``.img`` so a
# client filename can never inject a path component into the temp-file suffix.
_IMAGE_EXTENSIONS: frozenset[str] = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}
)


class ImageTooLargeError(Exception):
    """Raised when an upload exceeds the configured per-file byte cap."""


class _AsyncReadable(Protocol):
    """The slice of Starlette's ``UploadFile`` that :func:`stream_to_temp` needs."""

    filename: str | None

    async def read(self, size: int = -1) -> bytes: ...


def safe_suffix(filename: str | None) -> str:
    """Derive a safe temp-file suffix from an upload filename.

    Returns a whitelisted image extension (lowercased, with leading dot) or
    ``.img`` when the filename has no extension, an unknown extension, or any
    path separator inside the candidate extension. This guarantees the value
    handed to ``mkstemp(suffix=...)`` contains no path components.
    """
    if not filename or "." not in filename:
        return ".img"
    ext = "." + filename.rsplit(".", 1)[-1].lower()
    if "/" in ext or "\\" in ext or os.sep in ext:
        return ".img"
    return ext if ext in _IMAGE_EXTENSIONS else ".img"


async def stream_to_temp(upload: _AsyncReadable, *, max_bytes: int) -> Path:
    """Stream an upload to a private temp file in chunks, enforcing a size cap.

    Reads the upload in fixed chunks and writes each straight to disk so the full
    image is never buffered in memory (bounds batch memory for large jobs). If
    the running total exceeds ``max_bytes`` the partial temp file is removed and
    :class:`ImageTooLargeError` is raised. An empty upload raises ``ValueError``.

    Returns the path to the written temp file; the caller owns its deletion.
    """
    fd, name = tempfile.mkstemp(prefix=_TMP_PREFIX, suffix=safe_suffix(upload.filename))
    path = Path(name)
    total = 0
    try:
        with os.fdopen(fd, "wb") as fh:
            while True:
                chunk = await upload.read(_CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ImageTooLargeError(
                        f"upload exceeds {max_bytes} bytes (filename={upload.filename!r})"
                    )
                fh.write(chunk)
        if total == 0:
            raise ValueError(f"empty image upload (filename={upload.filename!r})")
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


@contextmanager
def ephemeral_image(data: bytes, *, suffix: str = ".img") -> Iterator[Path]:
    """Write ``data`` to a private temp file, yield its path, delete on exit.

    The file is removed in a ``finally`` block so it is cleaned up whether the
    body succeeds or raises.
    """
    fd, name = tempfile.mkstemp(prefix=_TMP_PREFIX, suffix=suffix)
    path = Path(name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        yield path
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("event=ephemeral_cleanup_failed path=%s error=%s", path, exc)


class EphemeralImageDir:
    """A private temp directory holding a batch job's images, wiped on close.

    Use as a context manager around the whole batch job; :meth:`write` stages one
    upload and returns its path. :meth:`cleanup` (also called on context exit)
    removes the entire directory and everything in it.
    """

    def __init__(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix=_TMP_PREFIX))
        self._counter = itertools.count()

    def write(self, filename: str, data: bytes) -> Path:
        """Stage one upload under a unique on-disk basename inside the job dir.

        Each write gets a monotonic index prefix so two uploads sharing a client
        basename (e.g. two ``label.png``) land on distinct files instead of
        overwriting each other. Path components in the client filename are
        stripped first (defense against path traversal).
        """
        base = Path(filename).name or "upload"
        path = self.dir / f"{next(self._counter):04d}_{base}"
        path.write_bytes(data)
        return path

    def adopt(self, src: Path, filename: str) -> Path:
        """Move an already-written temp file into the job dir under a unique name.

        Lets the caller stream an upload to a standalone temp file first (chunked,
        size-capped) and then relocate it here without re-buffering the bytes.
        Same uniqueness/traversal guarantees as :meth:`write`.
        """
        base = Path(filename).name or "upload"
        dest = self.dir / f"{next(self._counter):04d}_{base}"
        os.replace(src, dest)
        return dest

    def cleanup(self) -> None:
        """Remove the job directory and all staged images. Idempotent."""
        import shutil

        try:
            shutil.rmtree(self.dir, ignore_errors=True)
        finally:
            logger.info("event=ephemeral_dir_cleanup dir=%s", self.dir)

    def __enter__(self) -> EphemeralImageDir:
        return self

    def __exit__(self, *exc: object) -> None:
        self.cleanup()
