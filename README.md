# TTB Label Verifier

Verifies an alcohol beverage label image against the submitted COLA application
data and returns an **accept / review** recommendation per field and overall — a
decision-support tool for TTB compliance reviewers, not an auto-approver.

## Overview

A reviewer (or a batch importer) uploads a label image plus the expected
application fields (brand, class/type, ABV, net contents, producer, origin, and
the Surgeon General's Government Warning). The app reads the label, matches each
field against what was submitted, and grades every field `pass` / `review` /
`fail`, rolling up to an overall verdict. Anything ambiguous is escalated to a
human rather than silently passed or failed — the design fails *safe* (toward
review), never silently green.

The verification path is a **hybrid cascade**:

1. **Tier-0 OCR (sync, default, always on):** RapidOCR (PP-OCRv5 / ONNX) reads the
   label; `rapidfuzz` + `pint` match each field; `warning.py` grades the
   Government Warning. p95 well under 1s on CPU.
2. **Tier-2 VLM refinement (async, optional, OFF by default):** a small
   vision-language model (`qwen3-vl:2b-instruct` via Ollama) re-reads only the
   *uncertain* fields — always the Government Warning, plus anything OCR graded
   `review`/`fail` or read with low confidence — and merges an improved verdict
   in. It can rescue a field OCR couldn't read; it cannot silently overturn a
   clean OCR pass.

Stack: **FastAPI + SSE** backend, **React / Vite** reviewer UI, OpenCV
preprocessing, all containerized.

## Setup & run

Docker only — no host installs (project rule). From the repo root:

```sh
make up        # build + start backend (:8000) and frontend (:5180)
make down      # stop the stack
make test      # run the suite inside the bench container
make licenses  # dependency-license guardrail (must stay copyleft-free)
make rebuild   # prune dangling images/volumes, then no-cache rebuild
```

| Service  | URL                     | Notes                                  |
|----------|-------------------------|----------------------------------------|
| Backend  | http://localhost:8000   | FastAPI; health at `/api/health`       |
| Frontend | http://localhost:5180   | Vite dev server (container port 5173)  |

`make up` runs `docker compose up --build`. To start just the API:
`make up-backend`.

### Flags

All flags are environment variables read by `backend/settings.py` and wired in
`docker-compose.yml`. Defaults are safe; the VLM tier is **off**.

| Variable | Default | Effect |
|---|---|---|
| `DEBUG` | `0` | `1` emits DEBUG logs to stdout (docker logs), incl. forwarded frontend logs via `/api/client-log`. |
| `TTB_MIN_IMAGE_LONG_EDGE` | `0` in compose (`640` in code) | Hard intake-reject floor. Compose ships it disabled so the UI soft-warns instead of blocking; set `640` to reject under-floor uploads. |
| `TTB_VLM_ENABLED` | `0` | Master switch for the async VLM tier. |
| `OLLAMA_BASE_URL` | _(empty)_ | Ollama server URL. The tier is inert unless this is set *and* `TTB_VLM_ENABLED=1`. |
| `TTB_VLM_MODEL` | `qwen3-vl:2b-instruct` | VLM tag (note the **instruct** tag — see below). |
| `TTB_VLM_NUM_CTX` | `8192` | Context cap (must be set; see gotcha). |
| `TTB_VLM_CONCURRENCY` | `1` | VLM inference concurrency, separate from OCR's `MAX_CONCURRENCY=4`. |
| `TTB_VLM_TIMEOUT` | `60` | VLM call timeout (s). |

**Turn the VLM tier on (Apple M2, host-native Ollama):** Docker Desktop on macOS
can't reach the Metal GPU, so Ollama runs natively on the host and the container
reaches it via `host.docker.internal` (already in compose `extra_hosts`).

```sh
# host terminal:
ollama serve
ollama pull qwen3-vl:2b-instruct
# then start the stack with the tier on:
TTB_VLM_ENABLED=1 OLLAMA_BASE_URL=http://host.docker.internal:11434 make up
```

With the tier off (default), the app is pure-OCR and behaves identically to a
build without any VLM code.

## Approach, tools, assumptions

| Layer | Choice |
|---|---|
| Sync read (Tier-0) | RapidOCR (PP-OCRv5, ONNX runtime) — Apache-2.0, CPU, no torch |
| Field matching | `rapidfuzz` (fuzzy name/brand), `pint` (ABV / net-contents units) |
| Gov. Warning | `services/warning.py` — graded fuzzy bands + critical-word check (27 CFR 16.21) |
| Async read (Tier-2) | LangChain `ChatOllama(...).with_structured_output(LabelFields)` → `qwen3-vl:2b-instruct` |
| API | FastAPI; single `POST /api/verify`, batch `POST /api/verify/batch` + SSE stream, async `POST /api/verify/refine` |
| UI | React + Vite reviewer; SSE batch consumer; clickable OCR-box overlay |
| Preprocess | OpenCV: auto-orient → grayscale → deskew → denoise → CLAHE → downscale |

**Key assumptions.** Per-field expected values come from the COLA application and
are trusted ground truth; the app verifies the *label* against them, not vice
versa. `class_type` is graded against label-literal print, not TTB's verbose
category taxonomy (registry-taxonomy grading scored an artifactual ~27% — see
study below). The Government Warning lives on whichever image carries it (usually
the back). Job state is in-process (no Redis/Celery) — adequate for a
single-container prototype.

## OCR vs VLM tradeoff

The hybrid choice is evidence-driven (`eval/vlm_latency_decision.md`,
`eval/cola_study_decision.md`). Neither tier wins outright:

| Dimension | Tier-0 OCR | VLM (`qwen3-vl:2b-instruct`) |
|---|---|---|
| Latency | p95 < 1s (CPU) | ~1.5–4s warm on M2 (GPU) |
| Cost | CPU only | needs a warm GPU |
| Failure mode | **fails safe** — returns nulls when unsure | **hallucinates** — fabricates plausible values |
| Front-label fields | strong | comparable |
| Government Warning | weak (garbles dense fine print) | **strong** (reads verbatim) |

Per-field accuracy on a balanced 4-front + 4-back set
(`eval/vlm_latency_decision.md`):

| set | OCR | qwen3-vl:2b-instruct |
|---|---|---|
| FRONT | 77% (17/22) | 73% (16/22) |
| BACK  | 31% (5/16)  | **75% (12/16)** |
| TOTAL | 58%         | **74%** |

The VLM's edge is almost entirely the **Government Warning** (qwen 5/5 vs OCR
~2/6 on a separate trial) and other back-label fields. But qwen **hallucinated** a
producer and "1234 Main Street, Miami" on a label where the field was absent —
unacceptable as the *sole* source on a compliance tool. So the VLM is a
**refinement tier**, not VLM-primary: it only touches escalated fields, its
output is matched against the expected application values (a fabricated value
mismatches → review/fail), and every VLM-sourced field is flagged in its reason
(`backend/services/refine.py`). OCR stays the fast, fail-safe default.

**Two Ollama gotchas** that fixed the model choice (`vlm_latency_decision.md`):
(1) `qwen3-vl` defaults to a 128K–256K context → Ollama allocates a ~17GB KV
cache → ~11+ min/image, so `num_ctx` **must** be capped (8192). (2) The bare
`qwen3-vl:2b` is a *thinking* model Ollama can't quiet — it runs away in
`<think>` and returns empty; the **`-instruct`** tag has no thinking and returns
one-shot JSON in ~3.7s.

## Image handling & latency

**640px legibility study** (`eval/cola_resolution_report.md`,
`eval/cola_study_decision.md`). A resolution sweep over the deployed pipeline on
~300 front + ~150 back real COLA labels at long edges 2048→640px found brand
recall holds flat (80.0% @ 1600px → 78.0% @ 640px) with **no >15pt collapse
anywhere above 640px**. So:

- **640px is the *reject floor*, not a downscale target** — uploads below it are
  rejected (a verdict there would mislead). The post-intake downscale target is
  ~1600px (safe) / ~800px (aggressive); latency roughly halves at ≤1280px
  (1729ms @ 1600px → 803ms @ 1280px).
- The Government Warning gap is **detector-limited, not resolution-limited** —
  back-label warning recall is ~0–5% at *every* scale, so the fix is a better
  recogniser (the VLM tier), not bigger images.

**Sectioning / cropping for inference.** Because the warning is dense back-label
fine print, the planned VLM path crops the warning region from the Tier-0 OCR
word-boxes (no extra model) and sends a high-res crop for the verbatim /
prominence check, while non-warning fields ride a downscaled full image — a
two-resolution strategy that cuts decode time by capping output tokens to the
escalated fields (`refine.py`, `vlm-async-refinement-plan.md` §2.4/2.6).

**DEBUG-gated logging for automated debugging.** Backend logs are structured
`key=value` to stdout. The frontend forwards its own logs to
`POST /api/client-log` (`frontend/src/lib/debug.ts` → `backend/main.py`), so with
`DEBUG=1` **front + back logs land unified in one `docker logs` stream** — an
agent (or human) can read the whole request path in one place. With `DEBUG=0` the
client-log sink is a cheap 204 no-op.

## Self-improving by design

The reviewer UI renders the submitted label with the OCR text boxes overlaid
(`frontend/src/components/OcrBoxOverlay.tsx`). Each box is **clickable**: a
reviewer can tag a region with its field type (`brand_name`, `government_warning`,
…) from a suggestion list. Tagged boxes are highlighted and the tags persist on
the result. This puts **labeling directly in the review loop** — every correction
a reviewer makes is a (region → field) annotation, building a correction/labeling
dataset for free. The COLA study already produced an applicant-disjoint
train/val/test split (`cola_study_decision.md` §4) so these annotations can later
supervise a fine-tune without brand leakage.

## Latency studies & proposed architecture

Studies in `eval/` (all dated, reproducible via the bench harness):

| Study | File | Finding |
|---|---|---|
| OCR engine bench | `eval/report.md` | RapidOCR p50 391ms / p95 818ms, best field-recall (59.4%); tesseract faster but ~36% recall |
| VLM model bench | `eval/report.md` | gemma p95 ~14.7s (over budget); MiniCPM-V errored on structured output |
| OCR resolution sweep | `eval/cola_resolution_report.md` | brand recall flat 640→2048px; warning detector-limited |
| VLM resolution sweep | `eval/vlm_resolution_report.md`, `eval/vlm_resolution_report_gemma.md` | warning recall holds to 768px; VLM calls ~10–30s on dev hardware |
| Model + arch decision | `eval/vlm_latency_decision.md` | `qwen3-vl:2b-instruct`, hybrid, async |

**Hardware caveat.** All VLM latencies were measured on an **Apple M2 / Metal**
(host-native Ollama, since Docker can't pass the Mac GPU through). These are a
*relative ranking + feasibility* signal — **not** the production SLA. M2 warm
latency was ~1.5–4s/image for the chosen 2B model; fine for a background refine,
not for a <1s sync verdict — which is exactly why refinement is async.

**Proposed architecture to go faster (and more accurate).** Run the open VLM on a
dedicated GPU in a private cloud rather than on the Mac:

- **CPU Cloud Run** service (existing): Tier-0 OCR, SLA-bearing, `min-instances=1`,
  `concurrency=4`. This serves every verdict.
- **L4 GPU Cloud Run** service (new): Ollama with `qwen3-vl:2b-instruct`
  **pre-pulled** and `OLLAMA_KEEP_ALIVE=-1` (kept warm), reached via
  `OLLAMA_BASE_URL`. Refinement is async + low-concurrency (one L4 serializes
  inference), so it can scale-to-zero between bursts (cold-start trade-off noted).

On an NVIDIA L4 the 2B model should be materially faster than M2/Metal, making
async refinement near-real-time while keeping the open model fully self-hosted
(no per-token API fees, data stays private). See
`docs/plans/2026-06-15-vlm-async-refinement-plan.md` (§2.9) and its handoff.

## Security — pre-production disclaimer

**This is a take-home / evaluation build, not production-ready.** Some hardening
exists (per-file + per-batch upload size caps with 413s, a decompression-bomb
pixel guard and pre-decode dimension probe, JSON payload size caps, strict
Pydantic validation on expected fields, in-process job TTL sweeping), but the
following must be added/reviewed before any production deployment:

- **AuthN / AuthZ** — no authentication on any endpoint (incl. `/api/client-log`).
- **Rate limiting / abuse protection** — none today.
- **Input validation review** — caps exist but need a security pass (content-type
  sniffing, polyglot files, SSRF on `OLLAMA_BASE_URL`).
- **Secrets management** — move config to a secret store; no secrets in env/images.
- **Network isolation** — lock the GPU service to the CPU service; private VPC.
- **Audit logging** — tamper-evident record of verdicts and reviewer actions.
- **VLM hallucination guardrails** — the escalation-gate + expected-value match +
  source flagging are a start; needs formal review before any auto-action.
- **CORS / TLS / security headers**, dependency scanning, and a PII review of
  uploaded label images.

## Cost analysis

> **Assumption flag.** The discovery brief
> (`github.com/treasurytakehome-rgb/instructions`) states TTB reviews **~150,000
> label applications/year**, response budget **~5s**, peak bursts of **200–300
> simultaneous** submissions. It does **not** give per-inference cost,
> CPU/GPU-seconds per run, or a target SLA in $ — so everything below is a
> **parameterized estimate**; plug in real cloud pricing and measured
> per-run seconds to firm it up. All dollar figures are illustrative
> order-of-magnitude assumptions (us-region Cloud Run, 2026).

**Assumed unit economics** (clearly assumed, not measured):

| Item | Assumption |
|---|---|
| OCR run (CPU) | ~1s CPU @ Cloud Run rates ≈ **$0.10–0.30 / 1k inferences** |
| VLM refine (L4 GPU) | ~2–4s on a warm L4 ≈ **$1–3 / 1k inferences** (only the share escalated) |
| Escalation rate | assume ~30% of labels trigger a VLM refine |

**Projected cost at scale** (OCR on every run; VLM on the assumed 30%):

| Runs / yr | OCR/yr | VLM/yr (30%) | **Total / yr** | **Total / mo** |
|---|---|---|---|---|
| 10k | ~$2 | ~$6 | **~$8** | ~$1 |
| 100k | ~$20 | ~$60 | **~$80** | ~$7 |
| **150k (stated)** | ~$30 | ~$90 | **~$120** | **~$10** |
| 1M | ~$200 | ~$600 | **~$800** | ~$67 |

These are **per-inference compute only**. The dominant fixed cost is **keeping the
app warm** (min-instances=1) so the 5s SLA holds and the GPU model stays loaded:

| Warm component | Assumed rate | / week | / month |
|---|---|---|---|
| CPU service (`min-instances=1`) | ~$0.05/hr | ~$8 | ~$35 |
| L4 GPU kept warm 24/7 | ~$0.70/hr | ~$118 | ~$510 |

So a fully-warm CPU+GPU prototype is **~$125/week ≈ $545/month** dominated by the
idle L4. **Future savings:** because refinement is async and tolerant of
cold-starts, the GPU can **scale-to-zero** between bursts (pay only for inference
+ cold-start, not 24/7 idle) — collapsing the warm-GPU line toward the
per-inference numbers above. Self-hosting an **open** model (vs a paid VLM API)
also means no per-token fees and data never leaves the private cloud — the larger
long-run saving at TTB's 150k/yr volume.

## Deployment (Cloud Run)

Two services behind a single public URL:

- **Backend** (CPU) — FastAPI OCR API that also serves the built UI. Kept warm.
- **VLM** (GPU, Nvidia L4) — Ollama refinement tier, **scale-to-zero**: it wakes
  only when the UI pings it on load/focus and drops back to zero when idle
  (≈$0 GPU while idle).

The OCR verdict is synchronous; the GPU-backed refinement lands a few seconds
later once warm, so a cold start never blocks the reviewer. `cloudbuild.yaml`
builds both images and deploys on push to `cloud-run`; the full gcloud runbook is
kept local-only (not in the repo).

## Status / what's next

The OCR tier ships and is the validated default; the VLM tier is implemented but
**off by default** pending owner approval of the model/resolution gate
(`eval/vlm_latency_decision.md`) and an L4 deploy. Open items tracked in `TODO.md`:

- Per-beverage-type TTB requirement rules (not all commodities share requirements).
- Full-folder batch uploads (hundreds of images + a manifest).
- Playwright exercise over the eval + COLA corpora to surface real issues.
- Re-scope the Government Warning metric to **per-COLA** (front ∪ back) before any
  final warning-tier adoption call (`cola_study_decision.md` §3c).
- A `cloud-run` deploy branch (Terraform for the CPU + L4 services, stripped of
  eval/docs/dev artifacts).
</content>
</invoke>
