"""TTB Label Verifier — FastAPI application.

Exposes the health probe plus the verification API (``backend.routers.verify``):
single ``POST /api/verify``, batch start ``POST /api/verify/batch``, and the SSE
results stream ``GET /api/verify/batch/{job_id}``.

A single warm OCR reader is constructed once in the lifespan startup and shared
across all requests via ``app.state.reader`` — readers are never built
per-request (the RapidOCR model load is expensive; see ``ocr_reader``).
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from backend import settings
from backend.routers import verify as verify_router

# Map a client log level to the stdlib logging level (warn → warning).
_CLIENT_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}

client_logger = logging.getLogger("ttb_client")


class ClientLogEntry(BaseModel):
    """One forwarded frontend log entry. Permissive — unknown fields ignored."""

    model_config = ConfigDict(extra="ignore")

    level: str = "info"
    event: str = ""
    data: object | None = None
    ts: str | None = None


def _configure_logging() -> logging.Logger:
    """Configure stdlib logging with a key=value formatter.

    Root level is DEBUG when ``settings.DEBUG`` is set, else INFO, so all the
    DEBUG-gated logging across the request path is emitted to stdout (docker
    logs) when the operator flips ``DEBUG=1``.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "ts=%(asctime)s level=%(levelname)s logger=%(name)s msg=%(message)s"
        )
    )
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if settings.DEBUG else logging.INFO)
    # Avoid duplicate handlers under reload/repeated imports.
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        root.addHandler(handler)
    app_logger = logging.getLogger("ttb_label_verifier")
    app_logger.info(f"event=logging_configured debug={settings.DEBUG}")
    return app_logger


logger = _configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build the warm OCR reader once and share it across requests.

    Constructing ``OCRLabelReader`` warms the process-wide RapidOCR singleton, so
    the first request doesn't pay the model-load cost. Stored on ``app.state`` and
    injected into every ``verify_async`` call by the router.
    """
    from backend.services.readers.ocr_reader import OCRLabelReader

    logger.info("event=startup msg=building_shared_reader")
    app.state.reader = OCRLabelReader()
    app.state.batch_jobs = {}
    logger.info("event=startup status=ready")
    yield
    logger.info("event=shutdown")


app = FastAPI(title="TTB Label Verifier", version="0.1.0", lifespan=lifespan)
app.include_router(verify_router.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness/readiness probe."""
    logger.debug("event=health_check status=ok")
    return {"status": "ok"}


@app.get("/api/config")
def config() -> dict[str, bool]:
    """Expose runtime flags to the frontend (``debug`` gates logs; ``vlm`` tells
    the UI whether to request the async refinement phase after the OCR verdict)."""
    return {"debug": settings.DEBUG, "vlm": settings.vlm_enabled()}


@app.post("/api/warmup")
async def warmup() -> dict[str, bool]:
    """Wake the GPU VLM service early (the frontend pings this on page load / focus)
    so its Cloud Run scale-from-zero cold start overlaps with the reviewer entering
    data, hiding the GPU spin-up. Best-effort and returns immediately; a no-op when
    the VLM tier is off. The frontend never reaches the GPU service directly.
    """
    import asyncio
    import urllib.request

    if not settings.vlm_enabled():
        return {"warming": False}

    def _ping() -> None:
        try:
            with urllib.request.urlopen(settings.OLLAMA_BASE_URL, timeout=3) as resp:
                resp.read(1)
        except Exception:  # noqa: BLE001 — the connection attempt alone wakes it
            pass

    # Fire-and-forget so the request returns at once; the cold start proceeds async.
    asyncio.create_task(asyncio.to_thread(_ping))
    logger.debug("event=warmup target=%s", settings.OLLAMA_BASE_URL)
    return {"warming": True}


@app.post("/api/client-log")
async def client_log(request: Request) -> Response:
    """Accept forwarded frontend logs (single entry or a list).

    A cheap no-op returning 204 when DEBUG is off; when on, each entry is logged
    via the ``ttb_client`` logger at its mapped level. Never raises on bad input
    — malformed entries are skipped. No auth required.
    """
    if not settings.DEBUG:
        return Response(status_code=204)

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 — bad body must not raise, just skip
        return Response(status_code=204)

    raw_entries = payload if isinstance(payload, list) else [payload]
    for raw in raw_entries:
        try:
            entry = ClientLogEntry.model_validate(raw)
        except Exception:  # noqa: BLE001 — skip a malformed entry, keep the rest
            continue
        level = _CLIENT_LEVELS.get(entry.level.lower(), logging.INFO)
        try:
            data_repr = json.dumps(entry.data)
        except (TypeError, ValueError):
            data_repr = repr(entry.data)
        client_logger.log(level, f"event=client.{entry.event} data={data_repr}")

    return Response(status_code=204)


# Serve the built React UI (Cloud Run single-service) when present. Mounted LAST
# at "/" so it only catches non-API paths; in local dev (no built dist) the Vite
# server serves the UI instead and this mount is skipped.
_frontend_dist = os.environ.get("TTB_FRONTEND_DIST")
if _frontend_dist and os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
    logger.info("event=startup frontend_served_from=%s", _frontend_dist)
