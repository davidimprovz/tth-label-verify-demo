"""API-layer tests for the verification endpoints (tasks 1.7 + 1.83).

Covers the single-verify endpoint, the batch start + SSE stream, input
validation (422s and 404), and the ephemeral-storage guarantee (no temp image
files left behind after single or batch processing).

These run against the real RapidOCR reader (built once via the app lifespan), so
they double as an end-to-end smoke through the verification engine. Using the
``with TestClient(app)`` form is required to trigger the lifespan that builds the
shared reader.
"""

from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import verify as verify_router
from backend.services import storage
from tests.fixtures.generate_label import (
    ALCOHOL,
    BRAND_NAME,
    CLASS_TYPE,
    NET_CONTENTS,
    PRODUCER,
    PRODUCER_CITY,
)

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_label.png"


def _expected(**overrides) -> dict:
    base = dict(
        beverage_type="spirits",
        brand_name=BRAND_NAME,
        class_type=CLASS_TYPE,
        alcohol_content=ALCOHOL,
        net_contents=NET_CONTENTS,
        producer_name=PRODUCER,
        producer_address=PRODUCER_CITY,
    )
    base.update(overrides)
    return base


def _leftover_temp_images() -> list[Path]:
    """Any ttb_verify_* temp artifacts still on disk."""
    root = Path(tempfile.gettempdir())
    return list(root.glob(f"{storage._TMP_PREFIX}*"))


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


# --- POST /api/verify --------------------------------------------------------


def test_verify_returns_result_for_matching_fields(client: TestClient):
    img = FIXTURE.read_bytes()
    resp = client.post(
        "/api/verify",
        files={"image": ("synthetic_label.png", img, "image/png")},
        data={"expected": json.dumps(_expected())},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["overall"] in ("pass", "review")
    statuses = {f["field"]: f["status"] for f in body["fields"]}
    assert "brand_name" in statuses


def test_verify_wrong_brand_fails_field_and_reviews_overall(client: TestClient):
    img = FIXTURE.read_bytes()
    resp = client.post(
        "/api/verify",
        files={"image": ("synthetic_label.png", img, "image/png")},
        data={"expected": json.dumps(_expected(brand_name="Nonexistent Phantom XYZ"))},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    statuses = {f["field"]: f["status"] for f in body["fields"]}
    assert statuses["brand_name"] == "fail"
    assert body["overall"] == "review"


def test_verify_missing_image_is_422(client: TestClient):
    resp = client.post("/api/verify", data={"expected": json.dumps(_expected())})
    assert resp.status_code == 422


def test_verify_malformed_expected_is_422(client: TestClient):
    img = FIXTURE.read_bytes()
    resp = client.post(
        "/api/verify",
        files={"image": ("synthetic_label.png", img, "image/png")},
        data={"expected": "{not valid json"},
    )
    assert resp.status_code == 422


def test_verify_invalid_expected_fields_is_422(client: TestClient):
    img = FIXTURE.read_bytes()
    # Missing required ExpectedFields keys.
    resp = client.post(
        "/api/verify",
        files={"image": ("synthetic_label.png", img, "image/png")},
        data={"expected": json.dumps({"beverage_type": "spirits"})},
    )
    assert resp.status_code == 422


def test_verify_leaves_no_temp_image(client: TestClient):
    before = set(_leftover_temp_images())
    img = FIXTURE.read_bytes()
    resp = client.post(
        "/api/verify",
        files={"image": ("synthetic_label.png", img, "image/png")},
        data={"expected": json.dumps(_expected())},
    )
    assert resp.status_code == 200
    after = set(_leftover_temp_images())
    assert after == before, f"leftover temp images: {after - before}"


# --- batch: POST /api/verify/batch + GET .../{job_id} ------------------------


def _read_sse(client: TestClient, job_id: str) -> list[dict]:
    """Consume the SSE stream for ``job_id`` into a list of parsed events."""
    events: list[dict] = []
    with client.stream("GET", f"/api/verify/batch/{job_id}") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        for line in resp.iter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[len("data:") :].strip()))
    return events


def test_batch_streams_one_event_per_label_plus_done(client: TestClient):
    img = FIXTURE.read_bytes()
    names = ["a.png", "b.png", "c.png"]
    files = [("images", (n, img, "image/png")) for n in names]
    expected_map = {n: _expected() for n in names}
    resp = client.post(
        "/api/verify/batch",
        files=files,
        data={"expected_map": json.dumps(expected_map)},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]
    assert job_id

    events = _read_sse(client, job_id)
    done = [e for e in events if e.get("done")]
    results = [e for e in events if "filename" in e]
    assert len(done) == 1
    assert done[0]["count"] == len(names)
    assert {e["filename"] for e in results} == set(names)
    for e in results:
        assert e["status"] in ("pass", "review", "error")
        assert isinstance(e["result"], dict)


def test_batch_unknown_job_id_is_404(client: TestClient):
    resp = client.get("/api/verify/batch/does-not-exist")
    assert resp.status_code == 404


def test_batch_missing_expected_for_file_is_422(client: TestClient):
    img = FIXTURE.read_bytes()
    resp = client.post(
        "/api/verify/batch",
        files=[("images", ("a.png", img, "image/png"))],
        data={"expected_map": json.dumps({"other.png": _expected()})},
    )
    assert resp.status_code == 422


def test_batch_leaves_no_temp_images_after_completion(client: TestClient):
    before = set(_leftover_temp_images())
    img = FIXTURE.read_bytes()
    names = ["x.png", "y.png"]
    files = [("images", (n, img, "image/png")) for n in names]
    expected_map = {n: _expected() for n in names}
    resp = client.post(
        "/api/verify/batch",
        files=files,
        data={"expected_map": json.dumps(expected_map)},
    )
    job_id = resp.json()["job_id"]
    _read_sse(client, job_id)  # drain to completion
    after = set(_leftover_temp_images())
    assert after == before, f"leftover temp artifacts: {after - before}"


# --- upload-size + batch-count caps (fix 2) ----------------------------------


def _oversized_png() -> bytes:
    """Bytes guaranteed to exceed MAX_IMAGE_BYTES."""
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * (verify_router.MAX_IMAGE_BYTES + 1)


def test_single_verify_oversized_image_is_rejected(client: TestClient):
    resp = client.post(
        "/api/verify",
        files={"image": ("huge.png", _oversized_png(), "image/png")},
        data={"expected": json.dumps(_expected())},
    )
    assert resp.status_code in (413, 422), resp.text


def test_batch_oversized_image_is_rejected(client: TestClient):
    big = _oversized_png()
    resp = client.post(
        "/api/verify/batch",
        files=[("images", ("huge.png", big, "image/png"))],
        data={"expected_map": json.dumps({"huge.png": _expected()})},
    )
    assert resp.status_code in (413, 422), resp.text


def test_batch_exceeding_max_images_is_rejected(client: TestClient):
    img = FIXTURE.read_bytes()
    n = verify_router.MAX_BATCH_IMAGES + 1
    names = [f"label_{i}.png" for i in range(n)]
    files = [("images", (nm, img, "image/png")) for nm in names]
    expected_map = {nm: _expected() for nm in names}
    resp = client.post(
        "/api/verify/batch",
        files=files,
        data={"expected_map": json.dumps(expected_map)},
    )
    assert resp.status_code in (413, 422), resp.text


def test_batch_over_count_leaves_no_temp_images(client: TestClient):
    """An over-count batch is rejected before any image is staged to disk."""
    before = set(_leftover_temp_images())
    img = FIXTURE.read_bytes()
    n = verify_router.MAX_BATCH_IMAGES + 1
    names = [f"label_{i}.png" for i in range(n)]
    files = [("images", (nm, img, "image/png")) for nm in names]
    expected_map = {nm: _expected() for nm in names}
    client.post(
        "/api/verify/batch",
        files=files,
        data={"expected_map": json.dumps(expected_map)},
    )
    after = set(_leftover_temp_images())
    assert after == before, f"leftover temp artifacts: {after - before}"


# --- job-registry TTL sweep (fix 3) ------------------------------------------


def test_expired_unstreamed_job_is_swept(client: TestClient):
    """A job whose SSE stream is never opened must be evicted once it expires."""
    img = FIXTURE.read_bytes()
    # Submit a first batch but never open its stream -> it lingers in the registry.
    resp = client.post(
        "/api/verify/batch",
        files=[("images", ("orphan.png", img, "image/png"))],
        data={"expected_map": json.dumps({"orphan.png": _expected()})},
    )
    stale_id = resp.json()["job_id"]
    registry = app.state.batch_jobs
    assert stale_id in registry

    # Age the stale job past the TTL by rewriting its creation timestamp.
    registry[stale_id].created_at -= verify_router.JOB_TTL_SECONDS + 1

    # A new batch POST triggers the sweep, which should evict the stale job.
    resp2 = client.post(
        "/api/verify/batch",
        files=[("images", ("fresh.png", img, "image/png"))],
        data={"expected_map": json.dumps({"fresh.png": _expected()})},
    )
    fresh_id = resp2.json()["job_id"]
    assert stale_id not in registry, "expired unstreamed job was not swept"
    assert fresh_id in registry
    _read_sse(client, fresh_id)  # drain the fresh job so it cleans up


def test_stream_404s_for_expired_job(client: TestClient):
    """An expired, never-streamed job is swept at stream-open and 404s."""
    job = verify_router.BatchJob(job_id="expired-job")
    job.created_at = time.monotonic() - verify_router.JOB_TTL_SECONDS - 1
    client.app.state.batch_jobs["expired-job"] = job

    resp = client.get("/api/verify/batch/expired-job")
    assert resp.status_code == 404
    assert "expired-job" not in client.app.state.batch_jobs


# --- duplicate-filename disambiguation (fix 4) -------------------------------


def test_batch_duplicate_filenames_no_cross_contamination(client: TestClient):
    """Two uploads named identically must each grade against their OWN expected.

    Both use the same fixture image but different expected brand names: one
    correct, one wrong. The correct one's brand_name must pass/review; the wrong
    one's brand_name must fail. Each event must carry a distinct ``id``.
    """
    img = FIXTURE.read_bytes()
    # Two multipart parts share the basename "label.png".
    files = [
        ("images", ("label.png", img, "image/png")),
        ("images", ("label.png", img, "image/png")),
    ]
    # The map value for a duplicated filename is a LIST of expected fields, one
    # per same-named upload, matched in submission order: slot 0 correct brand,
    # slot 1 wrong brand. Each upload must grade against its own slot.
    expected_map = {
        "label.png": [
            _expected(),  # correct brand
            _expected(brand_name="Nonexistent Phantom XYZ"),  # wrong brand
        ]
    }
    resp = client.post(
        "/api/verify/batch",
        files=files,
        data={"expected_map": json.dumps(expected_map)},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    events = _read_sse(client, job_id)
    results = [e for e in events if "id" in e]
    done = [e for e in events if e.get("done")]
    assert len(results) == 2, f"expected 2 results, got {results}"
    # Distinct ids — the client can disambiguate same-named files.
    ids = {e["id"] for e in results}
    assert len(ids) == 2, f"ids not distinct: {[e['id'] for e in results]}"
    assert all(e["filename"] == "label.png" for e in results)

    # No cross-contamination: exactly one brand_name pass-ish and one fail.
    brand_statuses = []
    for e in results:
        fields = {f["field"]: f["status"] for f in e["result"]["fields"]}
        brand_statuses.append(fields["brand_name"])
    assert sorted(brand_statuses) == ["fail", "pass"] or sorted(brand_statuses) == [
        "fail",
        "review",
    ], f"brand statuses show contamination: {brand_statuses}"

    # done event carries total alongside count (fix 7).
    assert len(done) == 1
    assert done[0]["count"] == 2
    assert done[0]["total"] == 2


def test_verify_too_small_image_is_422_with_friendly_detail(client: TestClient):
    """A sub-floor upload is rejected (422) with a friendly, jargon-free detail (D4)."""
    import struct

    real = FIXTURE.read_bytes()
    tiny = real[:16] + struct.pack(">II", 400, 300) + real[24:]
    resp = client.post(
        "/api/verify",
        files={"image": ("tiny.png", tiny, "image/png")},
        data={"expected": json.dumps(_expected())},
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "too small" in detail
    assert "400x300" in detail
    # The minimum is named so the reviewer knows what to do.
    from backend.services import preprocess as pp

    assert str(pp.MIN_IMAGE_LONG_EDGE) in detail
    # No internal-jargon prefix on the friendly message.
    assert not detail.startswith("unreadable image:")


def test_batch_too_small_image_yields_per_item_error(client: TestClient):
    """A too-small image in a batch fails that item only, batch completes (D4)."""
    import struct

    real = FIXTURE.read_bytes()
    tiny = real[:16] + struct.pack(">II", 400, 300) + real[24:]
    good = FIXTURE.read_bytes()
    files = [
        ("images", ("tiny.png", tiny, "image/png")),
        ("images", ("good.png", good, "image/png")),
    ]
    expected_map = {"tiny.png": _expected(), "good.png": _expected()}
    resp = client.post(
        "/api/verify/batch",
        files=files,
        data={"expected_map": json.dumps(expected_map)},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    events = _read_sse(client, job_id)
    results = {e["filename"]: e for e in events if "filename" in e}
    done = [e for e in events if e.get("done")]
    assert len(done) == 1, "batch must complete despite the bad item"
    assert results["tiny.png"]["status"] == "error"
    # Friendly message reaches the per-item event.
    assert "too small" in results["tiny.png"]["result"]["error"]
    # The good item still processed.
    assert results["good.png"]["status"] in ("pass", "review")


def test_verify_bomb_image_is_422(client: TestClient):
    """A bomb-dimension PNG is a client error (422), never a 500/OOM."""
    import struct

    real = FIXTURE.read_bytes()
    bomb = real[:16] + struct.pack(">II", 50_000, 50_000) + real[24:]
    resp = client.post(
        "/api/verify",
        files={"image": ("bomb.png", bomb, "image/png")},
        data={"expected": json.dumps(_expected())},
    )
    assert resp.status_code == 422
