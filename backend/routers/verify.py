"""HTTP API for label verification (task 1.7).

Exposes the already-built verification engine (``backend.services.verify``) over
HTTP. A single warm OCR reader is constructed at app startup (see
``backend.main`` lifespan) and shared across all requests via ``app.state`` —
readers are never built per-request.

Wire formats
------------

``POST /api/verify`` — ``multipart/form-data``:
    - ``image``: the label image file (required; missing → 422).
    - ``expected``: a JSON **string** form field whose object matches
      :class:`ExpectedFields` exactly, e.g.::

          {"beverage_type": "spirits", "brand_name": "...", "class_type": "...",
           "alcohol_content": "...", "net_contents": "...", "producer_name": "..."}

      Malformed JSON or fields that fail validation → 422.
    Response: a :class:`VerificationResult` JSON object.

``POST /api/verify/batch`` — ``multipart/form-data``:
    - ``images``: one or more label image files.
    - ``expected_map``: a JSON **string** form field mapping each image's
      *filename* → an :class:`ExpectedFields` object, e.g.::

          {"a.png": {...ExpectedFields...}, "b.png": {...}}

      For multiple uploads sharing a filename, the value may instead be a
      **list** of ExpectedFields, matched to those uploads in submission order::

          {"label.png": [{...for first label.png...}, {...for second...}]}

      Every uploaded filename must have an entry; unknown/extra → 422. Each
      upload is streamed to disk under a per-file size cap (``MAX_IMAGE_BYTES``,
      413 if exceeded); a batch over ``MAX_BATCH_IMAGES`` is rejected with 413.
      All caps are env-tunable via ``TTB_*`` variables (see cap definitions).
    Response: ``{"job_id": "<uuid>"}``. Processing starts immediately on an
    ``asyncio.Semaphore``-bounded worker pool (``MAX_CONCURRENCY``) over the
    shared reader — no cross-item barrier; each label streams out as it finishes.

``GET /api/verify/batch/{job_id}`` — Server-Sent Events (``text/event-stream``):
    One ``data:`` event per label **as it completes** (so order = completion
    order, not submission order). Each event carries a stable per-upload ``id``
    so a client can disambiguate same-named files::

        {"id": "0", "filename": "a.png", "status": "review",
         "result": {<VerificationResult>}}

    A terminal event ``{"done": true, "count": N, "total": M}`` is emitted once
    every label has finished (``count`` = events streamed, ``total`` = uploads
    accepted, so a client can detect a dropped item). Unknown ``job_id`` → 404.
    The job's in-process state (queue + temp images) is cleaned up once the
    stream is fully consumed.

Job state lives in an in-process registry on ``app.state`` — adequate for the
single-container Cloud Run prototype (no Redis/Celery; see design §3.5/§4).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from backend.models.verification import ExpectedFields, VerificationResult
from backend.services.preprocess import ImageDecodeError, ImageTooSmallError
from backend.services.storage import (
    EphemeralImageDir,
    ImageTooLargeError,
    stream_to_temp,
)
from backend.services.verify import verify_async

logger = logging.getLogger("ttb_label_verifier")

# Lazy VLM-tier singletons (reader + a concurrency gate distinct from the OCR
# pool) — created on first use so import stays cheap and the semaphore binds to
# the running loop. Only touched when the VLM tier is enabled.
_vlm_reader = None
_vlm_sem = None


def _get_vlm_reader():
    global _vlm_reader
    if _vlm_reader is None:
        from backend.services.readers.vlm_reader import VLMLabelReader

        _vlm_reader = VLMLabelReader()
    return _vlm_reader


def _get_vlm_sem() -> asyncio.Semaphore:
    global _vlm_sem
    if _vlm_sem is None:
        from backend import settings

        _vlm_sem = asyncio.Semaphore(max(1, settings.VLM_CONCURRENCY))
    return _vlm_sem


router = APIRouter(prefix="/api/verify", tags=["verify"])

def _env_int(name: str, default: int) -> int:
    """Integer env override with a safe fallback (bad values → default)."""
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


# Caps are env-tunable so a deploy can match its instance size. Defaults are
# sized for a small Cloud Run container, where /tmp is memory-backed (tmpfs):
# worst-case staged bytes = MAX_BATCH_IMAGES * MAX_IMAGE_BYTES (1000 MiB).

# Max labels verified concurrently within one batch job. Bounds the in-process
# worker pool so a large batch can't exhaust CPU/memory on the single container.
# Clamped to >= 1: 0 would deadlock the pool (Semaphore(0) never releases _DONE).
MAX_CONCURRENCY = max(1, _env_int("TTB_MAX_CONCURRENCY", 4))

# Per-file upload cap (bytes). Larger uploads are rejected with 413 before any
# verification work begins — guards against OOM/DoS from a single huge image.
MAX_IMAGE_BYTES = _env_int("TTB_MAX_IMAGE_BYTES", 10 * 1024 * 1024)  # 10 MiB

# Hard cap on labels per batch. A batch exceeding this is rejected with 413
# before anything is staged to disk. Raised to support whole-folder uploads of a
# few hundred labels; tune via TTB_MAX_BATCH_IMAGES (worst-case staged bytes =
# this * MAX_IMAGE_BYTES, so keep it sane for the host's disk/RAM).
MAX_BATCH_IMAGES = _env_int("TTB_MAX_BATCH_IMAGES", 300)

# How long an unconsumed batch job lingers in the registry before being swept.
# Without this, a job whose SSE stream is never opened would leak forever.
JOB_TTL_SECONDS = _env_int("TTB_JOB_TTL_SECONDS", 15 * 60)  # 15 minutes

# Upper bound on the raw `expected` / per-entry JSON string. ExpectedFields holds
# a handful of length-capped strings (~1.3 KB of content); 16 KiB leaves ample
# room for JSON structure/escaping while rejecting unbounded payloads up front.
MAX_EXPECTED_BYTES = _env_int("TTB_MAX_EXPECTED_BYTES", 16 * 1024)

# Upper bound on the raw `expected_map` JSON string. Scales with batch size
# (MAX_EXPECTED_BYTES per label) plus slack for filename keys/structure.
MAX_EXPECTED_MAP_BYTES = _env_int(
    "TTB_MAX_EXPECTED_MAP_BYTES", MAX_BATCH_IMAGES * MAX_EXPECTED_BYTES
)

# Sentinel pushed onto a job queue when every worker has finished.
_DONE = object()

# Live background batch-worker task handles, kept so the tasks aren't GC'd
# mid-flight; a done-callback removes each and logs any escaped exception.
_BATCH_TASKS: set[asyncio.Task] = set()


@dataclass
class BatchJob:
    """In-process state for one batch job."""

    job_id: str
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    total: int = 0
    consumed: bool = False
    workdir: EphemeralImageDir | None = None
    created_at: float = field(default_factory=time.monotonic)


@dataclass
class _BatchItem:
    """One upload within a batch: its stable id, name, staged path, expected."""

    id: str
    filename: str
    path: Path
    fields: ExpectedFields


def _registry(request: Request) -> dict[str, BatchJob]:
    """The per-app batch-job registry, lazily created on app.state."""
    reg = getattr(request.app.state, "batch_jobs", None)
    if reg is None:
        reg = {}
        request.app.state.batch_jobs = reg
    return reg


def _parse_expected(raw: str) -> ExpectedFields:
    """Parse the ``expected`` JSON string → ExpectedFields, 422 on any error."""
    if len(raw) > MAX_EXPECTED_BYTES:
        logger.debug("event=verify.expected.oversized chars=%d", len(raw))
        raise HTTPException(
            status_code=422,
            detail=f"expected payload exceeds {MAX_EXPECTED_BYTES} bytes",
        )
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422, detail=f"malformed expected JSON: {exc}"
        ) from exc
    try:
        return ExpectedFields.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=json.loads(exc.json())) from exc


@router.post("")
async def verify_label(
    request: Request,
    image: UploadFile = File(...),  # noqa: B008 — FastAPI dependency-injection idiom
    expected: str = Form(...),  # noqa: B008 — FastAPI dependency-injection idiom
) -> VerificationResult:
    """Verify one label image against expected fields. See module docstring."""
    logger.debug(
        "event=verify.request filename=%s content_type=%s expected_chars=%d",
        image.filename,
        image.content_type,
        len(expected),
    )
    try:
        fields = _parse_expected(expected)
    except HTTPException as exc:
        logger.debug("event=verify.request.invalid detail=%s", exc.detail)
        raise

    # Stream the upload to a temp file with a size cap (never buffer the whole
    # image in memory, and reject over-cap uploads before doing any OCR work).
    try:
        path = await stream_to_temp(image, max_bytes=MAX_IMAGE_BYTES)
    except ImageTooLargeError as exc:
        raise HTTPException(
            status_code=413, detail=f"image exceeds {MAX_IMAGE_BYTES} bytes"
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="empty image upload") from exc

    reader = getattr(request.app.state, "reader", None)
    try:
        result = await verify_async(str(path), fields, reader=reader)
    except ImageTooSmallError as exc:
        # Under-resolution rejection (D4): the message is already reviewer-friendly
        # and actionable, so pass it through without the "unreadable image:" prefix.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ImageDecodeError as exc:
        # Undecodable or bomb-sized images are client errors, not 500s.
        logger.debug("event=verify.decode.error filename=%s detail=%s", image.filename, exc)
        raise HTTPException(status_code=422, detail=f"unreadable image: {exc}") from exc
    finally:
        path.unlink(missing_ok=True)
    logger.info("event=api_verify overall=%s filename=%s", result.overall, image.filename)
    logger.debug(
        "event=verify.response overall=%s latency_ms=%.1f tier=%s filename=%s",
        result.overall,
        result.latency_ms,
        result.tier_used,
        image.filename,
    )
    return result


@router.post("/refine", response_model=VerificationResult)
async def verify_refine(
    request: Request,
    image: UploadFile = File(...),  # noqa: B008
    expected: str = Form(...),  # noqa: B008
) -> Any:
    """Tier-2 async refinement (phase 2). Re-verify and fold in the VLM's reading
    of the Government Warning + fields OCR couldn't recover, returning the merged
    verdict. Returns **204 No Content** (a cheap no-op, no re-OCR) when the VLM
    tier is off, so the frontend can always call it without branching and never
    pays a double read when refinement is disabled.
    """
    from backend import settings

    if not settings.vlm_enabled():
        return Response(status_code=204)

    from backend.services.refine import merge, refine_with_vlm, select_escalation

    fields = _parse_expected(expected)
    try:
        path = await stream_to_temp(image, max_bytes=MAX_IMAGE_BYTES)
    except ImageTooLargeError as exc:
        raise HTTPException(
            status_code=413, detail=f"image exceeds {MAX_IMAGE_BYTES} bytes"
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="empty image upload") from exc

    reader = getattr(request.app.state, "reader", None)
    try:
        ocr_result = await verify_async(str(path), fields, reader=reader)
        escalate = select_escalation(ocr_result)
        async with _get_vlm_sem():
            refined = await asyncio.to_thread(
                refine_with_vlm, str(path), fields, escalate, _get_vlm_reader()
            )
        merged = merge(ocr_result, refined)
        logger.info(
            "event=api_refine overall=%s->%s refined=%d filename=%s",
            ocr_result.overall,
            merged.overall,
            len(refined),
            image.filename,
        )
        return merged
    except ImageTooSmallError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ImageDecodeError as exc:
        raise HTTPException(status_code=422, detail=f"unreadable image: {exc}") from exc
    finally:
        path.unlink(missing_ok=True)


@router.post("/batch")
async def verify_batch(
    request: Request,
    images: list[UploadFile] = File(...),  # noqa: B008 — FastAPI DI idiom
    expected_map: str = Form(...),  # noqa: B008 — FastAPI DI idiom
) -> dict[str, str]:
    """Start a batch verification job; returns ``{"job_id": ...}``.

    Each upload is streamed straight to the job's private temp dir as it is read
    (image bytes are never all held in memory at once), under a per-file size cap
    and a per-batch count cap; over-cap requests are rejected with 413 before any
    work begins. Expired, never-streamed jobs are swept on each new POST.
    """
    logger.debug("event=verify.batch.request count=%d", len(images))
    registry = _registry(request)
    _sweep_expired_jobs(registry)

    # Reject over-count batches before staging anything to disk.
    if len(images) > MAX_BATCH_IMAGES:
        raise HTTPException(
            status_code=413,
            detail=f"batch exceeds MAX_BATCH_IMAGES={MAX_BATCH_IMAGES} (got {len(images)})",
        )

    raw_map = _parse_expected_map(expected_map)

    # Resolve, per upload, the ExpectedFields it should be graded against. A map
    # value may be a single object (one upload of that name) or a list (multiple
    # same-named uploads, matched in submission order) — see _resolve_expected.
    resolved = _resolve_expected(images, raw_map)

    job_id = uuid.uuid4().hex
    workdir = EphemeralImageDir()
    job = BatchJob(job_id=job_id, total=len(images), workdir=workdir)

    # Stream every upload to the job dir (chunked, size-capped). Each item gets a
    # unique on-disk path and an explicit id so same-named files never collide or
    # cross-contaminate. On any failure, wipe what we staged and bail.
    items: list[_BatchItem] = []
    try:
        for idx, (upload, fields) in enumerate(zip(images, resolved, strict=True)):
            name = upload.filename or "upload"
            try:
                path = await stream_to_temp(upload, max_bytes=MAX_IMAGE_BYTES)
            except ImageTooLargeError as exc:
                raise HTTPException(
                    status_code=413,
                    detail=f"image '{name}' exceeds {MAX_IMAGE_BYTES} bytes",
                ) from exc
            except ValueError as exc:
                raise HTTPException(
                    status_code=422, detail=f"empty image upload: '{name}'"
                ) from exc
            # Move the streamed file into the job's private dir under a unique
            # name (keeps the size-capped stream while bounding memory).
            staged = workdir.adopt(path, name)
            items.append(_BatchItem(id=f"{idx}", filename=name, path=staged, fields=fields))
    except BaseException:
        workdir.cleanup()
        raise

    registry[job_id] = job
    reader = getattr(request.app.state, "reader", None)
    task = asyncio.create_task(_run_batch(job, items, reader))
    _BATCH_TASKS.add(task)
    task.add_done_callback(_on_batch_task_done)
    logger.info("event=api_verify_batch job_id=%s count=%d", job_id, job.total)
    return {"job_id": job_id}


async def _run_batch(job: BatchJob, items: list[_BatchItem], reader) -> None:
    """Worker pool: verify each label, push results onto the job queue as done.

    Bounded by an ``asyncio.Semaphore`` so at most ``MAX_CONCURRENCY`` labels run
    at once. No cross-item barrier — each result is enqueued the moment its
    worker finishes, so the SSE stream emits in completion order. Each event
    carries the upload's stable ``id`` so a client can disambiguate same-named
    files. Temp images are wiped in ``finally`` whether the batch succeeds or
    fails.
    """
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    async def _one(item: _BatchItem) -> None:
        async with sem:
            try:
                result = await verify_async(str(item.path), item.fields, reader=reader)
                event = {
                    "id": item.id,
                    "filename": item.filename,
                    "status": result.overall,
                    "result": result.model_dump(),
                }
                logger.debug(
                    "event=verify.batch.item id=%s filename=%s status=%s latency_ms=%.1f",
                    item.id,
                    item.filename,
                    result.overall,
                    result.latency_ms,
                )
            except Exception as exc:  # one bad label must not sink the batch
                logger.warning(
                    "event=batch_item_error job_id=%s id=%s file=%s error=%s",
                    job.job_id,
                    item.id,
                    item.filename,
                    type(exc).__name__,
                    exc_info=exc,
                )
                # For an under-resolution rejection the message is already
                # reviewer-friendly and actionable — surface it on the item card.
                # Other failures stay opaque (type name only) to avoid leaking
                # server internals.
                error = (
                    str(exc)
                    if isinstance(exc, ImageTooSmallError)
                    else type(exc).__name__
                )
                event = {
                    "id": item.id,
                    "filename": item.filename,
                    "status": "error",
                    "result": {"error": error},
                }
                logger.debug(
                    "event=verify.batch.item id=%s filename=%s status=error error=%s",
                    item.id,
                    item.filename,
                    type(exc).__name__,
                )
            await job.queue.put(event)

    try:
        await asyncio.gather(*(_one(item) for item in items))
    finally:
        # Images are no longer needed once every worker has run.
        if job.workdir is not None:
            job.workdir.cleanup()
        await job.queue.put(_DONE)


@router.get("/batch/{job_id}")
async def stream_batch(request: Request, job_id: str) -> StreamingResponse:
    """Stream a batch job's results as SSE. Unknown job_id → 404."""
    registry = _registry(request)
    _sweep_expired_jobs(registry)
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"unknown job_id: {job_id}")

    async def _events():
        count = 0
        try:
            while True:
                item = await job.queue.get()
                if item is _DONE:
                    # ``total`` is what was accepted at submit time; ``count`` is
                    # what actually streamed, so a client can detect a dropped item.
                    yield _sse({"done": True, "count": count, "total": job.total})
                    break
                count += 1
                yield _sse(item)
        finally:
            # Drop the job's state once its stream is consumed (temp dir was
            # already wiped by _run_batch's finally).
            job.consumed = True
            registry.pop(job_id, None)
            logger.info("event=batch_stream_closed job_id=%s emitted=%d", job_id, count)

    return StreamingResponse(_events(), media_type="text/event-stream")


def _sse(payload: dict) -> str:
    """Format a dict as a single SSE ``data:`` frame."""
    return f"data: {json.dumps(payload)}\n\n"


def _parse_expected_map(raw: str) -> dict:
    """Parse the ``expected_map`` JSON string → dict, 422 on any error."""
    if len(raw) > MAX_EXPECTED_MAP_BYTES:
        logger.debug("event=verify.expected_map.oversized chars=%d", len(raw))
        raise HTTPException(
            status_code=422,
            detail=f"expected_map payload exceeds {MAX_EXPECTED_MAP_BYTES} bytes",
        )
    try:
        raw_map = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=422, detail=f"malformed expected_map JSON: {exc}"
        ) from exc
    if not isinstance(raw_map, dict):
        raise HTTPException(status_code=422, detail="expected_map must be a JSON object")
    return raw_map


def _resolve_expected(
    images: list[UploadFile], raw_map: dict
) -> list[ExpectedFields]:
    """Resolve the ExpectedFields each upload should be graded against.

    ``expected_map`` keys on filename. Its value may be either a single
    ExpectedFields object (the common one-upload-per-name case) or a **list** of
    them, which lets multiple same-named uploads each carry their own expected
    fields — consumed in submission order so two ``label.png`` files never share
    (or cross-contaminate) expectations. Any missing entry, list-length mismatch,
    or invalid fields fails the whole request with 422.
    """
    # Per-filename cursor for list-valued entries (submission-order matching).
    cursors: dict[str, int] = {}
    resolved: list[ExpectedFields] = []
    for upload in images:
        name = upload.filename or ""
        if name not in raw_map:
            raise HTTPException(
                status_code=422, detail=f"no expected fields for uploaded file '{name}'"
            )
        entry = raw_map[name]
        if isinstance(entry, list):
            i = cursors.get(name, 0)
            if i >= len(entry):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"more uploads named '{name}' than expected-fields entries "
                        f"({len(entry)})"
                    ),
                )
            cursors[name] = i + 1
            candidate = entry[i]
        else:
            candidate = entry
        try:
            resolved.append(ExpectedFields.model_validate(candidate))
        except ValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail={"file": name, "errors": json.loads(exc.json())},
            ) from exc
    return resolved


def _sweep_expired_jobs(registry: dict[str, BatchJob]) -> None:
    """Evict jobs whose stream was never opened and that have outlived the TTL.

    Cheap O(n) pass run on each new batch POST and each stream-open. Without
    it, a ``BatchJob`` whose SSE stream is never consumed would linger in the
    registry forever (its temp images are already wiped by the worker's
    ``finally`` — this reclaims only the in-memory job object).
    """
    now = time.monotonic()
    expired = [
        jid
        for jid, job in registry.items()
        if now - job.created_at > JOB_TTL_SECONDS
    ]
    for jid in expired:
        registry.pop(jid, None)
        logger.info("event=batch_job_swept job_id=%s reason=ttl", jid)


def _on_batch_task_done(task: asyncio.Task) -> None:
    """Done-callback: drop the task handle and log any escaped exception."""
    _BATCH_TASKS.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("event=batch_task_failed error=%s", type(exc).__name__, exc_info=exc)
