// API client for the verification backend. Requests go through the Vite dev
// proxy (vite.config.ts), so relative /api paths resolve to backend:8000.

import type {
  BatchDoneEvent,
  BatchItemEvent,
  ExpectedFields,
  VerificationResult,
} from "./types"

const BASE = "/api"

/** Verify a single label image against expected fields. Multipart POST. */
export async function verifySingle(
  image: File | Blob,
  expected: ExpectedFields,
  filename = "label.png",
): Promise<VerificationResult> {
  const form = new FormData()
  form.append("image", image, filename)
  form.append("expected", JSON.stringify(expected))

  const res = await fetch(`${BASE}/verify`, { method: "POST", body: form })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`verify failed: ${res.status} ${detail}`.trim())
  }
  return (await res.json()) as VerificationResult
}

/**
 * Phase-2 refinement: re-verify with the async VLM tier and get the merged
 * verdict (Government Warning + fields OCR couldn't recover). A no-op on the
 * backend when the tier is off — it returns the plain OCR verdict.
 */
export async function refineSingle(
  image: File | Blob,
  expected: ExpectedFields,
  filename = "label.png",
): Promise<VerificationResult | null> {
  const form = new FormData()
  form.append("image", image, filename)
  form.append("expected", JSON.stringify(expected))

  const res = await fetch(`${BASE}/verify/refine`, { method: "POST", body: form })
  if (res.status === 204) return null // tier off — no-op, keep the OCR verdict
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`refine failed: ${res.status} ${detail}`.trim())
  }
  return (await res.json()) as VerificationResult
}

/**
 * Start a batch verification job. `expectedMap` keys each file's *name* to its
 * ExpectedFields (or a list, for same-named files in submission order).
 * Returns the job id used to open the SSE results stream.
 */
export async function startBatch(
  files: File[],
  expectedMap: Record<string, ExpectedFields | ExpectedFields[]>,
): Promise<string> {
  const form = new FormData()
  for (const f of files) form.append("images", f, f.name)
  form.append("expected_map", JSON.stringify(expectedMap))

  const res = await fetch(`${BASE}/verify/batch`, { method: "POST", body: form })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`batch start failed: ${res.status} ${detail}`.trim())
  }
  const body = (await res.json()) as { job_id: string }
  return body.job_id
}

/**
 * Subscribe to a batch job's SSE stream. Calls `onItem` for each label as it
 * resolves (completion order) and `onDone` once every label has finished.
 * Returns a disposer that closes the EventSource.
 *
 * EventSource only issues GET requests, which is exactly what the stream
 * endpoint expects, and it rides the same Vite proxy as the POSTs above.
 */
export function subscribeBatch(
  jobId: string,
  handlers: {
    onItem: (event: BatchItemEvent) => void
    onDone: (event: BatchDoneEvent) => void
    onError?: (err: Event) => void
  },
): () => void {
  const source = new EventSource(`${BASE}/verify/batch/${jobId}`)

  source.onmessage = (msg) => {
    let payload: unknown
    try {
      payload = JSON.parse(msg.data)
    } catch {
      return
    }
    if (payload && typeof payload === "object" && "done" in payload) {
      handlers.onDone(payload as BatchDoneEvent)
      source.close()
      return
    }
    handlers.onItem(payload as BatchItemEvent)
  }

  source.onerror = (err) => {
    // After the terminal event the server closes the stream; EventSource then
    // surfaces an error as it tries to reconnect. We've already closed on
    // `done`, so only forward errors while the stream is still open.
    if (source.readyState !== EventSource.CLOSED) {
      handlers.onError?.(err)
      source.close()
    }
  }

  return () => source.close()
}
