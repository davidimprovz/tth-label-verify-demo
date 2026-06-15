"""Tests for the OCR preprocessing pipeline (task 1.4).

Uses synthetic OpenCV/numpy images so no committed binary fixture is needed for
the preprocessing unit tests (the OCR/orchestrator tests use a rendered label).
"""

from __future__ import annotations

import cv2
import numpy as np

from backend.services.preprocess import (
    DIFFICULTY_RESHOOT_THRESHOLD,
    PreprocessResult,
    preprocess,
)


def _text_image(angle: float = 0.0) -> np.ndarray:
    """White canvas with several dark horizontal text-like bars, optional skew.

    Sized above the D4 intake floor (MIN_IMAGE_LONG_EDGE) so the gate treats it
    as a normal label, not a too-small upload.
    """
    img = np.full((720, 960), 255, dtype=np.uint8)
    for row in range(60, 640, 60):
        cv2.rectangle(img, (90, row), (860, row + 28), 0, -1)
    if angle:
        h, w = img.shape
        matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        img = cv2.warpAffine(
            img, matrix, (w, h), borderValue=255, flags=cv2.INTER_CUBIC
        )
    return img


def test_returns_preprocess_result_with_fields():
    res = preprocess(_text_image())
    assert isinstance(res, PreprocessResult)
    assert res.image is not None and res.image.ndim == 2
    assert 0.0 <= res.difficulty_score <= 1.0
    assert isinstance(res.warnings, list)


def test_skewed_image_is_deskewed():
    # A clearly skewed image should be rotated back so its dominant text lines
    # are near-horizontal. We re-estimate skew on the output via projection
    # variance: a deskewed image has sharper row-sum structure.
    skewed = _text_image(angle=8.0)
    res = preprocess(skewed)
    # The strong-skew warning should fire on the input.
    assert any("skew" in w for w in res.warnings)
    # After deskew, the horizontal bands should produce strong row contrast:
    # binarize and measure variance of row-means (peaks at text rows).
    out = res.image
    _, binary = cv2.threshold(out, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    row_means = binary.mean(axis=1)
    # A well-deskewed banded image has high row-mean variance (clear stripes).
    assert row_means.var() > 1000.0


def test_blurred_image_scores_higher_than_sharp():
    sharp = _text_image()
    blurred = cv2.GaussianBlur(sharp, (0, 0), sigmaX=4.0)
    sharp_score = preprocess(sharp).difficulty_score
    blurred_score = preprocess(blurred).difficulty_score
    assert blurred_score > sharp_score


def test_heavy_blur_triggers_warning_and_high_difficulty():
    sharp = _text_image()
    blurred = cv2.GaussianBlur(sharp, (0, 0), sigmaX=8.0)
    res = preprocess(blurred)
    assert any("blurry" in w for w in res.warnings)
    assert res.difficulty_score >= DIFFICULTY_RESHOOT_THRESHOLD


def test_tiny_image_rejected_by_intake_gate():
    """Sub-floor images are rejected at intake (D4), not processed."""
    import pytest

    from backend.services.preprocess import ImageTooSmallError

    white = np.full((20, 20), 255, dtype=np.uint8)
    with pytest.raises(ImageTooSmallError, match="too small"):
        preprocess(white)


def test_blank_at_floor_low_difficulty_no_warnings():
    """A blank image at/above the floor still scores low and warns nothing."""
    white = np.full((640, 640), 255, dtype=np.uint8)
    res = preprocess(white)
    assert res.difficulty_score < 0.2
    assert res.warnings == []


def test_landscape_input_is_oriented_portrait():
    landscape = np.full((720, 960), 255, dtype=np.uint8)
    cv2.rectangle(landscape, (50, 50), (900, 90), 0, -1)
    res = preprocess(landscape)
    # Output should be portrait (taller than wide) after auto-orient.
    assert res.image.shape[0] >= res.image.shape[1]
