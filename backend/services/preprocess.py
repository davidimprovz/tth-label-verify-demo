"""OpenCV preprocessing for the app's OCR tier (task 1.4).

A single ``preprocess(image)`` step that prepares a label photo for OCR and,
crucially, emits a ``difficulty_score`` and human-readable ``warnings`` that feed
the orchestrator's auto-triage hook (suggest a re-shoot when an image is too
blurry / badly skewed to read reliably).

Pipeline: decode → auto-orient (portrait) → grayscale → deskew (minAreaRect) →
denoise → contrast-normalize (CLAHE) → downscale to an OCR-optimal size.

``difficulty_score`` ∈ [0, 1] (higher = worse / harder to OCR) is a blend of:
- **blur**: variance of the Laplacian (low variance = blurry). Mapped so a sharp
  image scores ~0 and a heavily blurred one approaches 1.
- **skew**: absolute deskew angle (degrees). Mapped so 0° scores 0 and a strong
  tilt (>= ``_SKEW_SATURATE`` deg) approaches 1.

The score is the max of the two components, so either failure mode alone can
flag the image. A tiny/empty all-white image has no detectable edges *and* no
skew, so it scores low (there is nothing to read, but it is not "hard" in the
blur/skew sense — the reader simply returns empty text).

This module is the backend's own version of the OCR preprocessing; it does not
import from ``eval/`` (the bench harness keeps its own simpler variant).
"""

from __future__ import annotations

import logging
import os
import struct
from dataclasses import dataclass, field

import cv2
import numpy as np

logger = logging.getLogger("ttb_label_verifier")

# Decoded-pixel cap (audit T1.2): a 10 MiB upload can legally *declare* a
# gigapixel decode. Reject from header dims before any full decode.
MAX_DECODED_PIXELS = int(os.environ.get("TTB_MAX_IMAGE_PIXELS", str(40_000_000)))

# Backstop for formats the header parsers don't cover: OpenCV enforces this
# env ceiling itself at decode time (read lazily on first decode).
# A pre-set larger ceiling would silently reopen the OOM window for
# non-PNG/JPEG formats, so clamp anything missing/invalid/over-cap.
_existing = os.environ.get("OPENCV_IO_MAX_IMAGE_PIXELS")
if _existing is None or not _existing.isdigit() or int(_existing) > MAX_DECODED_PIXELS:
    os.environ["OPENCV_IO_MAX_IMAGE_PIXELS"] = str(MAX_DECODED_PIXELS)

# Minimum acceptable upload long edge (intake gate, D4). Below this, OCR output is
# unreliable and a verdict would be misleading, not merely uncertain — so reject
# rather than process. This is a deliberate, evidence-based exception to the app's
# soft-fail philosophy: the D2b resolution sweep (eval/cola_resolution_report.md)
# found brand recall holds to 640px with no collapse above it, making 640px the
# conservative floor. Enforced from header dims (same probe as the bomb guard),
# so the rejection is free (pre-decode).
MIN_IMAGE_LONG_EDGE = int(os.environ.get("TTB_MIN_IMAGE_LONG_EDGE", "640"))


class ImageDecodeError(ValueError):
    """Image bytes/file could not be decoded, or declares bomb-scale dims."""


class ImageTooSmallError(ImageDecodeError):
    """Image's long edge is below MIN_IMAGE_LONG_EDGE — too small to verify."""

# --- tunable thresholds -----------------------------------------------------

# Blur: variance of the Laplacian. A crisp document scan is typically in the
# hundreds–thousands; values under ~100 are visibly soft. We map the Laplacian
# variance through a smooth curve where this midpoint scores 0.5.
_BLUR_MIDPOINT = 100.0
# Below this variance the image is flagged "too blurry" in warnings.
_BLUR_WARN_VARIANCE = 60.0

# Skew: absolute angle (degrees) at which the skew component saturates to ~1.0.
_SKEW_SATURATE = 15.0
# Above this angle we add a "strong skew" warning.
_SKEW_WARN_DEG = 7.0

# Overall difficulty at/above which the orchestrator should suggest a re-shoot.
DIFFICULTY_RESHOOT_THRESHOLD = 0.66

# OCR works best on images whose long edge is in a moderate range; we downscale
# anything larger to keep latency down without hurting recognition.
_OCR_MAX_LONG_EDGE = 1600

# minAreaRect needs enough foreground signal to estimate an angle reliably.
_MIN_DESKEW_PIXELS = 50
# Angles beyond this are treated as estimation noise (tall/narrow crops), not skew.
_MAX_TRUSTED_SKEW = 20.0
# Don't bother rotating for sub-pixel skews.
_MIN_APPLY_SKEW = 0.25


@dataclass
class PreprocessResult:
    """Output of :func:`preprocess`.

    - ``image``: the cleaned single-channel (grayscale) uint8 array, ready for OCR.
    - ``difficulty_score``: blur/skew difficulty in [0, 1] (higher = worse).
    - ``warnings``: human-readable strings for any threshold that was exceeded.
    - ``transform``: 2x3 forward affine mapping ORIGINAL decoded pixel coords →
      ``image`` (OCR-space) coords. Invert it to project OCR boxes back onto the
      original upload. ``None`` only for non-array inputs that skip the pipeline.
    - ``original_size``: ``(width, height)`` of the decoded original, in pixels.
    """

    image: np.ndarray
    difficulty_score: float
    warnings: list[str] = field(default_factory=list)
    transform: np.ndarray | None = None
    original_size: tuple[int, int] | None = None


# Read enough of the file head to find PNG IHDR or a JPEG SOF marker even
# behind a large EXIF block.
_HEADER_PROBE_BYTES = 65536


def _png_dims(data: bytes) -> tuple[int, int] | None:
    """(width, height) from a PNG IHDR header, or None if not a PNG."""
    if len(data) < 24 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    if data[12:16] != b"IHDR":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return int(w), int(h)


def _jpeg_dims(data: bytes) -> tuple[int, int] | None:
    """(width, height) from the first JPEG SOF marker, or None."""
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker == 0xFF:  # fill byte
            i += 1
            continue
        if marker == 0xD9:  # EOI — no SOF found
            return None
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # standalone
            i += 2
            continue
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):  # SOF
            h = int.from_bytes(data[i + 5 : i + 7], "big")
            w = int.from_bytes(data[i + 7 : i + 9], "big")
            return w, h
        i += 2 + int.from_bytes(data[i + 2 : i + 4], "big")
    return None


def _check_pixel_cap(header: bytes) -> None:
    """Raise ImageDecodeError when declared dimensions exceed MAX_DECODED_PIXELS."""
    dims = _png_dims(header) or _jpeg_dims(header)
    if dims is None:
        return  # unknown format — OpenCV's env backstop still applies
    w, h = dims
    if w * h > MAX_DECODED_PIXELS:
        raise ImageDecodeError(
            f"image declares {w}x{h} ({w * h} px) — exceeds cap {MAX_DECODED_PIXELS}"
        )


def _check_min_resolution(header: bytes) -> None:
    """Raise ImageTooSmallError when declared long edge is below the intake floor.

    Skips silently when header dims can't be parsed (unknown format) so we never
    false-reject — the decode proceeds and other guards apply.
    """
    dims = _png_dims(header) or _jpeg_dims(header)
    if dims is None:
        return
    w, h = dims
    if max(w, h) < MIN_IMAGE_LONG_EDGE:
        raise ImageTooSmallError(
            f"image is {w}x{h}px — too small to verify reliably; "
            f"please re-scan or re-photograph at a long edge of at least "
            f"{MIN_IMAGE_LONG_EDGE} pixels"
        )


def _decode(image: bytes | str | np.ndarray) -> np.ndarray:
    """Decode bytes / path / ndarray into a BGR (or grayscale) uint8 array."""
    if isinstance(image, np.ndarray):
        if image.shape[0] * image.shape[1] > MAX_DECODED_PIXELS:
            raise ImageDecodeError("ndarray image exceeds MAX_DECODED_PIXELS")
        if max(image.shape[0], image.shape[1]) < MIN_IMAGE_LONG_EDGE:
            raise ImageTooSmallError(
                f"image is {image.shape[1]}x{image.shape[0]}px — too small to "
                f"verify reliably; please re-scan or re-photograph at a long "
                f"edge of at least {MIN_IMAGE_LONG_EDGE} pixels"
            )
        return image
    if isinstance(image, (bytes, bytearray)):
        header = bytes(image[:_HEADER_PROBE_BYTES])
        _check_pixel_cap(header)
        _check_min_resolution(header)
        buf = np.frombuffer(bytes(image), dtype=np.uint8)
        try:
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        except cv2.error as exc:
            raise ImageDecodeError("image could not be decoded safely") from exc
        if img is None:
            raise ImageDecodeError("could not decode image bytes")
        return img
    if isinstance(image, str):
        # open() raises FileNotFoundError naturally for a missing file; past
        # this point a None decode means the file exists but isn't an image.
        with open(image, "rb") as fh:
            header = fh.read(_HEADER_PROBE_BYTES)
        _check_pixel_cap(header)
        _check_min_resolution(header)
        try:
            img = cv2.imread(image, cv2.IMREAD_COLOR)
        except cv2.error as exc:
            raise ImageDecodeError("image could not be decoded safely") from exc
        if img is None:
            # No temp path in the message — it would leak server internals.
            raise ImageDecodeError("could not decode image file")
        return img
    raise TypeError(f"unsupported image input type: {type(image)!r}")


def _to_gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def _estimate_skew(gray: np.ndarray) -> float:
    """Estimate skew angle (degrees) from foreground text pixels via minAreaRect.

    Returns 0.0 when there is not enough signal (e.g. a blank image).
    """
    # Foreground = dark text on light background → invert after a fast threshold.
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    inverted = cv2.bitwise_not(binary)
    coords = np.column_stack(np.where(inverted > 0))
    if coords.shape[0] < _MIN_DESKEW_PIXELS:
        return 0.0
    angle = cv2.minAreaRect(coords[:, ::-1].astype(np.float32))[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) > _MAX_TRUSTED_SKEW:
        return 0.0
    return float(angle)


def _rotate(gray: np.ndarray, angle: float) -> np.ndarray:
    h, w = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(
        gray,
        matrix,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _blur_variance(gray: np.ndarray) -> float:
    """Variance of the Laplacian — low values indicate blur."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _blur_difficulty(variance: float) -> float:
    """Map Laplacian variance → blur difficulty in [0, 1] (higher = blurrier).

    A smooth saturating curve: at the midpoint variance the score is 0.5; as
    variance → 0 the score → 1; as variance grows the score → 0.
    """
    if variance <= 0:
        return 1.0
    # difficulty = midpoint / (midpoint + variance): variance==midpoint → 0.5.
    return float(_BLUR_MIDPOINT / (_BLUR_MIDPOINT + variance))


def _skew_difficulty(angle: float) -> float:
    """Map absolute skew angle (degrees) → difficulty in [0, 1]."""
    return float(min(abs(angle) / _SKEW_SATURATE, 1.0))


def _has_signal(gray: np.ndarray) -> bool:
    """True if the image has meaningful edge content (not blank/uniform)."""
    return float(gray.std()) > 5.0


def _downscale(gray: np.ndarray) -> np.ndarray:
    h, w = gray.shape[:2]
    long_edge = max(h, w)
    if long_edge <= _OCR_MAX_LONG_EDGE:
        return gray
    scale = _OCR_MAX_LONG_EDGE / float(long_edge)
    return cv2.resize(
        gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
    )


def _forward_transform(
    dec_w: int, dec_h: int, oriented: bool, angle: float, ow: int, oh: int, scale: float
) -> np.ndarray:
    """Compose orient → deskew → downscale into one 2x3 affine.

    Maps a point in the ORIGINAL decoded image to its location in the cleaned
    OCR image, in the same order ``preprocess`` applies the steps.
    """
    M = np.eye(3, dtype=np.float64)
    # 1. Auto-orient: 90° clockwise when the decoded image was landscape.
    #    Clockwise maps (x, y) → (H-1-y, x) for an image of height H = dec_h.
    if oriented:
        M = np.array([[0.0, -1.0, dec_h - 1.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]]) @ M
    # 2. Deskew rotation about the oriented-image center (same matrix as _rotate).
    if abs(angle) >= _MIN_APPLY_SKEW:
        d = np.eye(3, dtype=np.float64)
        d[:2, :] = cv2.getRotationMatrix2D((ow / 2.0, oh / 2.0), angle, 1.0)
        M = d @ M
    # 3. Uniform downscale.
    if scale != 1.0:
        M = np.array([[scale, 0.0, 0.0], [0.0, scale, 0.0], [0.0, 0.0, 1.0]]) @ M
    return M[:2, :]


def project_boxes_to_original(
    boxes: list[dict], transform: np.ndarray | None, original_size: tuple[int, int] | None
) -> list[dict]:
    """Map OCR ``word_boxes`` (in cleaned-image space) back to original pixels.

    Inverts the preprocess ``transform`` for each quad corner and clamps to the
    original bounds. Returns ``{points: [[x, y], ...], text, confidence}`` with
    integer points. Boxes that fail to project are dropped (logged), never crash.
    """
    if not boxes or transform is None or original_size is None:
        return []
    ow, oh = original_size
    inv = cv2.invertAffineTransform(transform.astype(np.float64))
    out: list[dict] = []
    for b in boxes:
        quad = b.get("box")
        if not quad:
            continue
        try:
            pts = np.array(quad, dtype=np.float64).reshape(-1, 2)
            mapped = cv2.transform(pts.reshape(1, -1, 2), inv).reshape(-1, 2)
            mapped[:, 0] = np.clip(mapped[:, 0], 0, ow - 1)
            mapped[:, 1] = np.clip(mapped[:, 1], 0, oh - 1)
            out.append(
                {
                    "points": [[int(round(x)), int(round(y))] for x, y in mapped],
                    "text": b.get("text", ""),
                    "confidence": b.get("confidence"),
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("event=box_project_skip err=%s", exc)
    logger.debug("event=box_project in=%d out=%d", len(boxes), len(out))
    return out


def preprocess(image: bytes | str | np.ndarray) -> PreprocessResult:
    """Clean a label image for OCR and score how hard it is to read.

    Accepts encoded bytes, a filesystem path, or a decoded BGR/gray ndarray.
    See the module docstring for the difficulty-score model and warning rules.
    """
    bgr = _decode(image)
    gray = _to_gray(bgr)
    dec_h, dec_w = bgr.shape[0], bgr.shape[1]

    # Auto-orient to portrait: most labels are taller than wide once upright, and
    # a landscape capture of a portrait label is a common avoidable failure.
    oriented = gray.shape[1] > gray.shape[0]
    if oriented:
        gray = cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE)
    oh, ow = gray.shape[:2]  # oriented dims — the deskew/downscale reference frame

    warnings: list[str] = []
    blank = not _has_signal(gray)

    # --- skew ---------------------------------------------------------------
    angle = 0.0 if blank else _estimate_skew(gray)
    deskewed = gray
    if abs(angle) >= _MIN_APPLY_SKEW:
        deskewed = _rotate(gray, angle)

    # --- blur (measured on the deskewed grayscale, pre-enhancement) ---------
    variance = _blur_variance(deskewed)

    # --- difficulty score ---------------------------------------------------
    if blank:
        # No detectable content: not "hard" in the blur/skew sense.
        difficulty = 0.0
    else:
        difficulty = max(_blur_difficulty(variance), _skew_difficulty(angle))

    # --- warnings -----------------------------------------------------------
    if not blank and variance < _BLUR_WARN_VARIANCE:
        warnings.append(
            "image may be too blurry to read reliably — consider re-shooting "
            "in better focus/light"
        )
    if abs(angle) >= _SKEW_WARN_DEG:
        warnings.append(
            f"strong skew detected (~{abs(angle):.0f}°) — straighten the label "
            "and re-shoot for a cleaner read"
        )

    # --- enhance for OCR: denoise → CLAHE contrast → downscale --------------
    enhanced = cv2.fastNlMeansDenoising(deskewed, h=7)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(enhanced)
    enhanced = _downscale(enhanced)

    # Forward transform original → cleaned-image space, so callers can project
    # OCR boxes back onto the upload. Scale is uniform (downscale preserves AR).
    scale = enhanced.shape[1] / float(ow) if ow else 1.0
    transform = _forward_transform(dec_w, dec_h, oriented, angle, ow, oh, scale)

    if logger.isEnabledFor(logging.DEBUG):
        out_h, out_w = enhanced.shape[0], enhanced.shape[1]
        logger.debug(
            "event=preprocess decoded_w=%d decoded_h=%d out_w=%d out_h=%d "
            "pixels=%d blank=%s skew_deg=%.2f difficulty=%.3f cap=%d min_edge=%d",
            dec_w,
            dec_h,
            out_w,
            out_h,
            out_w * out_h,
            blank,
            angle,
            difficulty,
            MAX_DECODED_PIXELS,
            MIN_IMAGE_LONG_EDGE,
        )

    return PreprocessResult(
        image=enhanced,
        difficulty_score=round(float(difficulty), 4),
        warnings=warnings,
        transform=transform,
        original_size=(dec_w, dec_h),
    )
