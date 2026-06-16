# TTB Label Verifier

Checks an alcohol-beverage **label image** against the **expected COLA application
data** and returns an **accept / review** recommendation — per field and overall.
It is a decision-support tool for TTB compliance reviewers: anything ambiguous is
escalated to a human, never silently approved.

It runs **two-phase inference with open models** — a lightweight CPU **OCR** pass
for the instant verdict, plus an open **VLM** (Qwen3-VL) refinement for the hard
fields — entirely **self-hosted in a closed/private network** (no third-party
inference API; the GPU has no public endpoint). The footprint is deliberately
minimalist and **very low cost**: a scale-to-zero GPU that bills ~$0 when idle, so
the whole thing runs on the order of a few dollars a week (≈$120/yr at the stated
~150k-applications/yr TTB volume). Deployed as a two-service Cloud Run app (a CPU
API + a scale-to-zero L4 GPU) — see [Deployment](#deployment-cloud-run).

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
   model (`Qwen3-VL-2B-Instruct`) re-reads only the *uncertain* fields — always the
   Government Warning, plus anything OCR graded `review`/`fail` or read with low
   confidence — and merges an improved verdict. It can **rescue** a field OCR
   couldn't read; it **cannot** silently overturn a clean OCR pass, and every
   VLM-sourced value is matched against the expected data and flagged in its reason.

The VLM tier is **inference-engine-agnostic** — the backend talks to it over the
**OpenAI-compatible** chat API, so it points at a self-hosted **Ollama locally** and
a self-hosted **vLLM in the cloud** with nothing but a base-URL swap. (The
"OpenAI-compatible" wire format is just the API shape; no third-party inference
service is ever called — the model runs on our own GPU.)

The OCR verdict returns immediately; the refinement lands a few seconds later and
the UI swaps it in (two-phase delivery). With the VLM tier off, the app is
pure-OCR and behaves identically to a build with no VLM code.

**Stack:** FastAPI backend (serves the API *and* the built UI), React/Vite reviewer
UI, OpenCV preprocessing, a self-hosted OpenAI-compatible VLM server (Ollama
locally, vLLM in the cloud) — all containerized.

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
| `OLLAMA_BASE_URL` | _(empty)_ | VLM server base URL; the tier is inert unless this is set *and* enabled. |
| `TTB_VLM_MODEL` | `qwen3-vl:2b-instruct` | Model id (Ollama tag locally; the served vLLM model id in the cloud). |
| `TTB_VLM_NUM_CTX` | `8192` | Context cap for the local Ollama path (see Tradeoffs). |
| `TTB_MIN_IMAGE_LONG_EDGE` | `0` (compose) / `640` (code) | Intake reject floor; compose soft-warns instead of blocking. |
| `DEBUG` | `0` | `1` unifies front + back logs into one `docker logs` stream. |

## Deployment (Cloud Run)

Deployed as **two services**, both behind the backend's public URL:

| Service | Role | Sizing | Scaling |
|---|---|---|---|
| **backend** (CPU) | FastAPI OCR API **+ serves the built UI** | 2 vCPU / 2 GiB | `min=0` → 10 (scale-to-zero) |
| **VLM** (GPU) | self-hosted **vLLM** serving `Qwen3-VL-2B-Instruct-FP8` (OpenAI-compatible), async refinement | 4 vCPU / 16 GiB / **1× L4** | `min=0` → **1** (scale-to-zero) |

- **OCR is the SLA path** (synchronous, instant). The GPU only wakes for
  refinement and **scales to zero when idle** (≈ $0 GPU when nobody is using it).
- **Wake-on-load.** The UI pings `/api/warmup` on page load/focus, which wakes the
  GPU so the cold start overlaps with the reviewer entering data; a 5-minute
  heartbeat keeps it warm through a session.
- **The GPU is private and self-contained.** Internal ingress only (no public URL);
  the backend reaches it over the VPC (Direct VPC egress), so nothing but the
  backend can call it. The model is baked into the image and served **fully offline**
  (no runtime calls to any third party). `max-instances=1` + scale-to-zero + a
  **$25 billing budget** cap the cost.
- **CI/CD.** `cloudbuild.yaml` builds both images and deploys on push to the
  `cloud-run` branch (the full gcloud runbook is kept local-only, out of the repo).

## Design & tradeoffs

**Why hybrid, not VLM-primary.** The two readers fail in opposite ways:

| Dimension | OCR (Tier-0) | VLM (`Qwen3-VL-2B-Instruct`) |
|---|---|---|
| Latency | **p95 < 1s** (CPU) | a few seconds (async, GPU) |
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
fields**. But the same model also **hallucinates** on illegible input (e.g. a
producer address on a label where the field is absent, or a garbled warning on a
sub-640px scan) — disqualifying as the *sole* source for a compliance tool. So the
VLM is a **refinement tier**, not the primary: it only touches escalated fields, its
output is matched against the expected values (a fabricated value mismatches →
review), and every VLM-sourced field is flagged. OCR stays the fast, fail-safe
default.

**Resolution: a reject floor, not a downscale target.** A sweep over ~450 real COLA
labels (2048→640px) found brand recall holds flat down to 640px, so **640px is the
intake reject floor** (a verdict below it would mislead) while images are downscaled
for speed. The Government Warning gap is **detector-limited, not
resolution-limited** — bigger images don't help; a better recognizer (the VLM) does.

**Latency.** OCR is the synchronous verdict (**p95 < 1s**) and meets the ~5s budget
on its own — it carries the latency SLA. VLM refinement is asynchronous and off the
critical path:

- **Local dev (M2 / Ollama, 4-bit):** ~3.7s warm.
- **Cloud (L4 / vLLM, FP8):** **~2.5–4s warm** (pure inference ~2.5s), and ~60–90s
  on a cold scale-from-zero — hidden by the wake-on-load preload and the async
  two-phase UI.

Getting the cloud number there took real tuning (see gotcha 3): FP8 weights, leaving
`torch.compile`/CUDA-graphs **on** (eager mode measured only ~22 tok/s vs ~80 tok/s
compiled), capping vision tokens, and a small `max-model-len`.

**One OpenAI-compatible client, two self-hosted servers.** Both Ollama and vLLM
expose an OpenAI-style `/v1/chat/completions` endpoint, so the backend uses a single
client and just points at a different base URL per environment — **no third-party
inference service is ever in the loop**:

- **Local dev (Apple M2 / Metal): Ollama** (`qwen3-vl:2b-instruct`), run host-native
  because Docker can't reach Metal.
- **Cloud prod (Cloud Run / Nvidia L4): vLLM** (`vllm/vllm-openai`), model
  `Qwen/Qwen3-VL-2B-Instruct-FP8`, baked into the image and served offline.

**Gotchas that shaped the choices.**

1. **`num_ctx` must be capped (local Ollama).** `qwen3-vl` defaults to a 128K+
   context → Ollama allocates a ~17 GB KV cache → minutes per image, so `num_ctx`
   **must** be capped (8192).
2. **Use the `-instruct` tag (local Ollama).** The bare `qwen3-vl:2b` is a *thinking*
   model that runs away in `<think>` and returns empty — the **`-instruct`** tag
   returns one-shot JSON.
3. **Ollama can't serve the GPU on Cloud Run, so the cloud uses vLLM.** Cloud Run's
   L4 driver is CUDA 12.2; `ollama:latest`'s CUDA-12 kernels are an *invalid kernel
   image* on it and it has dropped its CUDA-11 GPU runner (→ CPU fallback, ~20s+). We
   serve the cloud VLM with **vLLM** via CUDA forward-compatibility
   (`VLLM_ENABLE_CUDA_COMPATIBILITY=1`, supported because the L4 is a datacenter GPU),
   in **FP8** with `torch.compile` left on — ~3–4s warm.

**Validation (measured on the live deployment, not just claimed).**

- **Latency:** timed end-to-end against the deployed L4 across several real back
  labels → **~2.5s pure inference, ~3–4s warm** (matching the M2 baseline); cold
  scale-from-zero ~60–90s, hidden by the async tier + wake-on-load preload. The
  tuning path: Ollama/CPU-fallback ~20s → vLLM BF16 14–34s → FP8+eager ~60s →
  **FP8+compile ~3s**.
- **FP8 accuracy:** spot-checked the Government Warning on real back labels — read
  **verbatim** on legible scans (e.g. izkali, clover_hill); the only misreads were
  on a sub-640px image (below the intake reject floor), and the hybrid's
  expected-value match graded those → review, never a silent pass.

**Self-improving by design.** The reviewer UI overlays the OCR text boxes on the
label; each box is clickable to tag its field type. Every correction a reviewer
makes is a (region → field) annotation — building a labeling dataset inside the
review loop that could later supervise a fine-tune.

## Cost

OCR compute is negligible; the only meaningful variable cost is GPU inference, and
scale-to-zero means the GPU bills **only while actively refining**. Per-inference
compute is a parameterized estimate (the brief gives a ~150k applications/yr volume
and a ~5s budget, but no cloud pricing):

| Runs / yr | OCR | VLM (~30% escalate) | **Total / yr** |
|---|---|---|---|
| 150k (the stated TTB volume) | ~$30 | ~$90 | **~$120** |

The dominant *potential* cost is keeping a GPU warm 24/7 (~$510/mo for an L4), which
**scale-to-zero avoids** — the GPU is $0 when idle and only bills during bursts. A
**$25 budget** is set on the GPU as a backstop.

## Security

This is an evaluation build. **Hardened:** the GPU is private and self-contained
(internal ingress, VPC-only, single-tenant to the backend service account, model
served fully offline, `max-instances=1`, $25 budget) so it cannot be reached or
abused from the internet; per-file and per-batch upload caps; a decompression-bomb
pixel guard and pre-decode dimension probe; JSON payload caps; strict Pydantic
validation; in-process job TTLs. **Still required for production:**
authentication/authorization (the public endpoints have none today), rate limiting,
secrets in a managed store, audit logging, and a formal review of the
VLM-hallucination guardrails.

## Limitations / what's next

- **No auth or rate limiting** on the public backend yet (the GPU itself is locked
  down and cost-capped).
- **GPU cold start** (~60–90s on a scale-from-zero) is hidden by the wake-on-load
  preload but still affects the very first refine after full idle; baking the
  `torch.compile` cache into the image (or `min-instances=1`) would remove it.
- **In-process job state** (no Redis/queue) — fine for a single-container prototype,
  not for horizontal scale.
- **Batch** (folder upload + SSE progress) is implemented; throughput at the stated
  200–300-simultaneous peak is untested.
