"""Backend settings parsed from the environment.

``DEBUG`` controls log verbosity. The ``VLM_*`` settings configure the optional
async VLM refinement tier (Phase 2) — it is OFF by default: with ``TTB_VLM_ENABLED``
unset (or no ``OLLAMA_BASE_URL``) the app is pure-OCR and behaves exactly as before.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("ttb_label_verifier")

# Truthy env values (case-insensitive). Anything else → False.
_TRUTHY = {"1", "true", "yes", "on"}


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def _int(name: str, default: int) -> int:
    """Parse an int env var, falling back to ``default`` on missing/invalid."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("event=settings.bad_int name=%s value=%r default=%d", name, raw, default)
        return default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("event=settings.bad_float name=%s value=%r default=%s", name, raw, default)
        return default


DEBUG: bool = _flag("DEBUG")

# --- VLM refinement tier (async, optional) ---------------------------------
# Master switch. The tier is only active when this is truthy AND OLLAMA_BASE_URL
# is set, so an accidental flag flip without a server is a no-op (logged).
VLM_ENABLED: bool = _flag("TTB_VLM_ENABLED")
OLLAMA_BASE_URL: str = os.environ.get("OLLAMA_BASE_URL", "").strip()
# Non-thinking instruct tag — the bare qwen3-vl:2b can't disable thinking in
# Ollama and grinds on multi-field prompts (see eval/vlm_latency_decision.md).
VLM_MODEL: str = os.environ.get("TTB_VLM_MODEL", "qwen3-vl:2b-instruct").strip()
# qwen3-vl defaults to a 128K-256K context → ~17GB KV cache → grind. MUST cap.
VLM_NUM_CTX: int = _int("TTB_VLM_NUM_CTX", 8192)
VLM_NUM_PREDICT: int = _int("TTB_VLM_NUM_PREDICT", 1024)
# Refinement runs off the sync path; keep concurrency low so it never starves the
# OCR workers (distinct from the OCR MAX_CONCURRENCY).
VLM_CONCURRENCY: int = _int("TTB_VLM_CONCURRENCY", 1)
VLM_TIMEOUT_S: float = _float("TTB_VLM_TIMEOUT", 60.0)


def vlm_enabled() -> bool:
    """True only when the VLM tier is switched on AND has a server to talk to."""
    if VLM_ENABLED and not OLLAMA_BASE_URL:
        logger.warning("event=vlm.disabled reason=OLLAMA_BASE_URL_unset")
    return VLM_ENABLED and bool(OLLAMA_BASE_URL)
