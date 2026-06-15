# TTB Label Verifier

Checks an alcohol-beverage **label image** against the **expected COLA application
data** and returns an **accept / review** recommendation — per field and overall.
It is a decision-support tool for TTB compliance reviewers: anything ambiguous is
escalated to a human, never silently approved. Deployed as a two-service Cloud Run
app (a CPU API + a scale-to-zero L4 GPU) — see [Deployment](#deployment-cloud-run).

## What it does

A reviewer uploads one label (or a whole folder for a batch) plus the expected
fields — brand, class/type, alcohol content, net contents, producer, producer
address, origin, and the Surgeon General's **Government Warning**. The app reads
the label, compares each field against what was submitted, grades it
`pass` / `review` / `fail`, and rolls up to an overall verdict.

- **Fail-safe by design.** When a reader is unsure it returns *review*, never a
  silent pass. Expected values are trusted ground truth; the app verifies the
  *label* against them.
- **Per-beverage rules.** Required fields follow the commodity (spirits vs wine vs
  beer) and import status; ABV tolerances are beverage-specific (spirits ±0.3%,
  wine ±1.0–1.5%).
- **Government Warning gate.** Graded for verbatim wording plus the mandatory
  ALL-CAPS `GOVERNMENT WARNING:` lead-in (27 CFR 16.21).

## How it works

A **hybrid cascade** — a fast, fail-safe OCR verdict, optionally sharpened by an
asynchronous vision-language model (VLM):

1. **Tier-0 — OCR (synchronous, always on).** RapidOCR (PP-OCRv5 / ONNX, CPU)
   reads the label after OpenCV preprocessing (auto-orient → grayscale → deskew →
   denoise → CLAHE → downscale). `rapidfuzz` matches names/brands, `pint`
   reconciles ABV and net-contents units, and a dedicated grader scores the
   Government Warning. **p95 < 1s on CPU** — this verdict carries the latency SLA.
2. **Tier-1 — VLM refinement (asynchronous, optional).** A small vision-language
   model (`qwen3-vl:2b-instruct` via Ollama) re-reads only the *uncertain* fields —
   always the Government Warning, plus anything OCR graded `review`/`fail` or read
   with low confidence — and merges an improved verdict. It can **rescue** a field
   OCR couldn't read; it **cannot** silently overturn a clean OCR pass, and every
   VLM-sourced value is matched against the expected data and flagged in its reason.

The OCR verdict returns immediately; the refinement lands a few seconds later and
the UI swaps it in (two-phase delivery). With the VLM tier off, the app is
pure-OCR and behaves identically to a build with no VLM code.

**Stack:** FastAPI backend (serves the API *and* the built UI), React/Vite reviewer
UI, OpenCV preprocessing, Ollama for the VLM — all containerized.

| Path | What |
|---|---|
| `backend/` | FastAPI app — routers, models, services (OCR, warning grader, matcher, VLM refine) |
| `frontend/` | React/Vite reviewer UI (clickable OCR-box overlay, SSE batch consumer) |
| `tests/` | pytest suite |
| `deploy/`, `cloudbuild.yaml` | Cloud Run deploy config (on the `cloud-run` branch) |

## Running it locally

Docker only — no host installs:

```sh
make up      # build + start backend (:8000) and frontend (:5180)
make down    # stop the stack
make test    # run the test suite
```

| Service | URL |
|---|---|
| Backend (API + UI) | http://localhost:8000 — health at `/api/health` |
| Frontend (dev) | http://localhost:5180 |

The VLM tier is **off by default**. To enable it locally you need an Ollama server
with the model. On Apple Silicon, Docker can't reach the Metal GPU, so run Ollama
natively and point the container at it:

```sh
ollama serve && ollama pull qwen3-vl:2b-instruct
TTB_VLM_ENABLED=1 OLLAMA_BASE_URL=http://host.docker.internal:11434 make up
```

Key flags (environment variables, wired in `docker-compose.yml`):

| Variable | Default | Effect |
|---|---|---|
| `TTB_VLM_ENABLED` | `0` | Master switch for the async VLM tier. |
| `OLLAMA_BASE_URL` | _(empty)_ | Ollama URL; the tier is inert unless this is set *and* enabled. |
| `TTB_VLM_MODEL` | `qwen3-vl:2b-instruct` | Model tag (note the **instruct** tag — see [Tradeoffs](#design--tradeoffs)). |
| `TTB_VLM_NUM_CTX` | `8192` | Context cap (must be set — see Tradeoffs). |
| `TTB_MIN_IMAGE_LONG_EDGE` | `0` (compose) / `640` (code) | Intake reject floor; compose soft-warns instead of blocking. |
| `DEBUG` | `0` | `1` unifies front + back logs into one `docker logs` stream. |

## Deployment (Cloud Run)

Deployed as **two services**, both behind the backend's public URL:

| Service | Role | Sizing | Scaling |
|---|---|---|---|
| **backend** (CPU) | FastAPI OCR API **+ serves the built UI** | 2 vCPU / 2 GiB | `min=0` → 10 (scale-to-zero) |
| **VLM** (GPU) | Ollama + `qwen3-vl:2b-instruct`, async refinement | 4 vCPU / 16 GiB / **1× L4** | `min=0` → **1** (scale-to-zero) |

- **OCR is the SLA path** (synchronous, instant). The GPU only wakes for
  refinement and **scales to zero when idle** (≈ $0 GPU when nobody is using it).
- **Wake-on-load.** The UI pings `/api/warmup` on page load/focus, which
  **preloads the model into the GPU's VRAM** so the cold start overlaps with the
  reviewer entering data; a 5-minute heartbeat keeps it warm through a session.
- **The GPU is private.** Internal ingress only (no public URL); the backend
  reaches it over the VPC (Direct VPC egress), so nothing but the backend can call
  it. `max-instances=1` + scale-to-zero + a **$25 billing budget** cap the cost.
- **CI/CD.** `cloudbuild.yaml` builds both images and deploys on push to the
  `cloud-run` branch (the full gcloud runbook is kept local-only, out of the repo).

## Design & tradeoffs

**Why hybrid, not VLM-primary.** The two readers fail in opposite ways:

| Dimension | OCR (Tier-0) | VLM (`qwen3-vl:2b-instruct`) |
|---|---|---|
| Latency | **p95 < 1s** (CPU) | seconds (async, GPU) |
| Failure mode | **fails safe** — nulls when unsure | **hallucinates** — fabricates plausible values |
| Front-label fields | strong | comparable |
| Government Warning / back label | weak (garbles dense fine print) | **strong** (reads verbatim) |

Per-field accuracy on a balanced 4-front + 4-back set:

| set | OCR | VLM |
|---|---|---|
| FRONT | 77% | 73% |
| BACK | 31% | **75%** |
| TOTAL | 58% | **74%** |

The VLM's edge is almost entirely the **Government Warning and other back-label
fields**. But the same model also **hallucinated** a producer address on a label
where the field was absent — disqualifying as the *sole* source for a compliance
tool. So the VLM is a **refinement tier**, not the primary: it only touches
escalated fields, its output is matched against the expected values (a fabricated
value mismatches → review), and every VLM-sourced field is flagged. OCR stays the
fast, fail-safe default.

**Resolution: a reject floor, not a downscale target.** A sweep over ~450 real
COLA labels (2048→640px) found brand recall holds flat down to 640px, so **640px
is the intake reject floor** (a verdict below it would mislead) while images are
downscaled to ~1600px for speed. The Government Warning gap is
**detector-limited, not resolution-limited** — bigger images don't help; a better
recognizer (the VLM) does.

**Latency.** OCR is the synchronous verdict (p95 < 1s) and meets the ~5s budget on
its own. VLM refinement is asynchronous and off the critical path: on the deployed
L4 it is ~15–20s warm and ~60s on a cold scale-from-zero — hidden by the
wake-on-load preload and the async two-phase UI. (Warm latency reflects the
`cuda_v11` runtime the Cloud Run L4 driver requires; a faster `cuda_v12` path is a
known tuning item.)

**Ollama gotchas that shaped the choices.** (1) `qwen3-vl` defaults to a 128K+
context → Ollama allocates a ~17 GB KV cache → minutes per image, so `num_ctx`
**must** be capped (8192). (2) The bare `qwen3-vl:2b` is a *thinking* model that
runs away in `<think>` and returns empty — the **`-instruct`** tag returns one-shot
JSON. (3) On Cloud Run's L4 the `ollama:latest` CUDA-12 kernels are too new for the
driver — forcing `OLLAMA_LLM_LIBRARY=cuda_v11` fixes it.

**Self-improving by design.** The reviewer UI overlays the OCR text boxes on the
label; each box is clickable to tag its field type. Every correction a reviewer
makes is a (region → field) annotation — building a labeling dataset inside the
review loop that could later supervise a fine-tune.

## Cost

OCR compute is negligible; the only meaningful variable cost is GPU inference, and
scale-to-zero means the GPU bills **only while actively refining**. Per-inference
compute is a parameterized estimate (the brief gives a ~150k applications/yr
volume and a ~5s budget, but no cloud pricing):

| Runs / yr | OCR | VLM (~30% escalate) | **Total / yr** |
|---|---|---|---|
| 150k (the stated TTB volume) | ~$30 | ~$90 | **~$120** |

The dominant *potential* cost is keeping a GPU warm 24/7 (~$510/mo for an L4),
which **scale-to-zero avoids** — the GPU is $0 when idle and only bills during
bursts. A **$25 budget** is set on the GPU as a backstop.

## Security

This is an evaluation build. **Hardened:** the GPU is private (internal ingress,
VPC-only, single-tenant to the backend service account, `max-instances=1`, $25
budget) so it cannot be reached or abused from the internet; per-file and per-batch
upload caps; a decompression-bomb pixel guard and pre-decode dimension probe; JSON
payload caps; strict Pydantic validation; in-process job TTLs. **Still required for
production:** authentication/authorization (the public endpoints have none today),
rate limiting, secrets in a managed store, audit logging, and a formal review of
the VLM-hallucination guardrails.

## Limitations / what's next

- **No auth or rate limiting** on the public backend yet (the GPU itself is locked
  down and cost-capped).
- **Warm GPU latency** (~15–20s) can be cut by getting the `cuda_v12` runtime
  working on the L4 driver.
- **In-process job state** (no Redis/queue) — fine for a single-container
  prototype, not for horizontal scale.
- **Batch** (folder upload + SSE progress) is implemented; throughput at the
  stated 200–300-simultaneous peak is untested.
