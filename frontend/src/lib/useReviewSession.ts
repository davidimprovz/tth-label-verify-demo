import { useCallback, useEffect, useRef, useState } from "react"
import { refineSingle, startBatch, subscribeBatch, verifySingle } from "./api"
import { buildRejectionReason, toItemStatus, type ReviewItem } from "./review"
import { clearSession, loadSession, saveSession } from "./persistSession"
import { dlog, derror } from "./debug"
import { loadSampleFile, SAMPLE_EXPECTED, SAMPLE_FILENAME, SAMPLE_IMAGE_URL } from "./sample"
import type { ExpectedMap } from "./parseExpectedMap"
import type { ExpectedFields, VerificationResult } from "./types"

let _seq = 0
const nextId = () => `local-${_seq++}`

/** Advance the id sequence past any rehydrated ids so new items never collide. */
function bumpSeqPast(ids: string[]) {
  for (const id of ids) {
    const n = Number(id.replace(/^local-/, ""))
    if (Number.isFinite(n) && n >= _seq) _seq = n + 1
  }
}

function newItem(file: File, imageUrl?: string): ReviewItem {
  return {
    id: nextId(),
    filename: file.name,
    imageUrl: imageUrl ?? URL.createObjectURL(file),
    // Retain the bytes so the label can be re-verified after editing the
    // expected fields (see `reverify`); dropped on reload since a File is not
    // serializable.
    file,
    status: "queued",
    decision: undefined,
    rejectionReason: "",
    notes: "",
    reasonTouched: false,
  }
}

/**
 * Owns the whole reviewer session: the queue of items, which one is selected,
 * the in-flight verification (single POST or batch SSE), and the per-item
 * human decision state. Components read/dispatch through the returned handle.
 */
export function useReviewSession() {
  // Hydrate metadata-only state from sessionStorage on first mount so a reload
  // restores decisions/notes/results (images are re-attached on demand).
  const [restored] = useState(loadSession)
  const [items, setItems] = useState<ReviewItem[]>(() => {
    if (restored) bumpSeqPast(restored.items.map((it) => it.id))
    return restored?.items ?? []
  })
  const [selectedId, setSelectedId] = useState<string | null>(
    restored?.selectedId ?? null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disposeRef = useRef<(() => void) | null>(null)
  const urlsRef = useRef<Set<string>>(new Set())

  // Track object URLs so they can be revoked on unmount (avoid leaks).
  useEffect(() => {
    const urls = urlsRef.current
    return () => {
      disposeRef.current?.()
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  // Persist metadata (minus image/File) on every queue/selection change so a
  // reload restores the session. saveSession clears storage when empty.
  useEffect(() => {
    saveSession(items, selectedId)
  }, [items, selectedId])

  const trackUrl = (url: string) => urlsRef.current.add(url)

  const patch = useCallback((id: string, p: Partial<ReviewItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)))
  }, [])

  const reset = useCallback(() => {
    disposeRef.current?.()
    disposeRef.current = null
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    urlsRef.current.clear()
    clearSession()
    setItems([])
    setSelectedId(null)
    setError(null)
    setBusy(false)
  }, [])

  /** Apply a resolved result to an item, prefilling its rejection reason. */
  const applyResult = useCallback(
    (id: string, status: string, result: VerificationResult | undefined) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? {
                ...it,
                status: toItemStatus(status),
                result,
                rejectionReason: it.reasonTouched
                  ? it.rejectionReason
                  : buildRejectionReason(result),
              }
            : it,
        ),
      )
    },
    [],
  )

  // Phase-2 async refinement: after the instant OCR verdict, if the VLM tier is
  // on, re-verify in the background and swap in the merged verdict (the
  // Government Warning + fields OCR missed). Best-effort: a failure leaves the
  // OCR verdict untouched. `refining` flags the in-flight state for the UI cue.
  const maybeRefine = useCallback(
    async (id: string, file: File, expected: ExpectedFields, filename: string) => {
      // Always attempt the refine — the backend returns 204 (no-op) when the VLM
      // tier is off, so we never depend on a one-time boot-time config flag (which
      // could be stale if the tab loaded before the tier was enabled).
      patch(id, { refining: true })
      dlog("refine.start", { filename })
      try {
        const merged = await refineSingle(file, expected, filename)
        if (merged) {
          applyResult(id, merged.overall, merged)
          dlog("refine.result", { filename, overall: merged.overall, tier: merged.tier_used })
        }
      } catch (e) {
        derror("refine.error", e)
      } finally {
        patch(id, { refining: false })
      }
    },
    [applyResult, patch],
  )

  // ---- Single verification -------------------------------------------------
  const verifyOne = useCallback(
    async (file: File, expected: ExpectedFields, previewUrl?: string) => {
      reset()
      setBusy(true)
      const item = newItem(file, previewUrl)
      trackUrl(item.imageUrl)
      item.status = "working"
      setItems([item])
      setSelectedId(item.id)
      dlog("verify.start", { filename: file.name, size: file.size, brand: expected.brand_name })
      try {
        const result = await verifySingle(file, expected, file.name)
        applyResult(item.id, result.overall, result)
        dlog("verify.result", {
          filename: file.name,
          overall: result.overall,
          latency_ms: result.latency_ms,
          tier: result.tier_used,
        })
        // Kick off the async refinement (non-blocking) so the OCR verdict shows
        // instantly and the refined one swaps in when ready.
        void maybeRefine(item.id, file, expected, file.name)
      } catch (e) {
        patch(item.id, { status: "error" })
        setError(e instanceof Error ? e.message : "Verification failed")
        derror("verify.error", e)
      } finally {
        setBusy(false)
      }
    },
    [applyResult, maybeRefine, patch, reset],
  )

  /**
   * Re-verify an existing item against edited expected fields, reusing its
   * retained original image File. The reviewer uses this when they spot an error
   * in the expected application data: edit the fields, re-run on the same label.
   * The new verdict/overlay/recommendation replace the prior result in place.
   * No-op (with a friendly error) if the File didn't survive a reload.
   */
  const reverify = useCallback(
    async (id: string, expected: ExpectedFields) => {
      const target = items.find((it) => it.id === id)
      if (!target?.file) {
        setError("Re-upload the image before re-verifying — it was not retained across reload.")
        return
      }
      patch(id, { status: "working" })
      dlog("reverify.start", { filename: target.filename, brand: expected.brand_name })
      try {
        const result = await verifySingle(target.file, expected, target.filename)
        applyResult(id, result.overall, result)
        dlog("reverify.result", {
          filename: target.filename,
          overall: result.overall,
          latency_ms: result.latency_ms,
        })
        void maybeRefine(id, target.file, expected, target.filename)
      } catch (e) {
        patch(id, { status: "error" })
        setError(e instanceof Error ? e.message : "Re-verification failed")
        derror("reverify.error", e)
      }
    },
    [items, applyResult, maybeRefine, patch],
  )

  /** Load + verify the bundled demo label in one click. */
  const runSample = useCallback(async () => {
    try {
      setBusy(true)
      const file = await loadSampleFile()
      await verifyOne(file, SAMPLE_EXPECTED, SAMPLE_IMAGE_URL)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sample")
      setBusy(false)
    }
  }, [verifyOne])

  // ---- Batch verification (SSE) -------------------------------------------

  /**
   * Stage the queue, POST the batch with `expectedMap`, and wire the SSE stream.
   * Shared by both batch entry points; the only thing that differs between them
   * is how `expectedMap` is built (one shared profile vs. an imported per-file
   * map). `expectedMap` is passed straight through to `startBatch`, whose keys
   * the backend matches on filename (see _resolve_expected).
   */
  const runBatch = useCallback(
    async (files: File[], expectedMap: ExpectedMap) => {
      reset()
      setBusy(true)
      // Stage queue items immediately so the reviewer sees the whole batch.
      const staged = files.map((f) => newItem(f))
      staged.forEach((it) => trackUrl(it.imageUrl))
      setItems(staged)
      setSelectedId(staged[0]?.id ?? null)

      // Map each upload's *index* → its local item id so SSE events (which carry
      // the submission-order id "0","1",...) resolve onto the right card.
      const byIndex = staged.map((it) => it.id)

      dlog("batch.start", { count: files.length })
      try {
        const jobId = await startBatch(files, expectedMap)
        dlog("batch.accepted", { jobId, count: files.length })
        // Mark all as working once the job is accepted.
        setItems((prev) => prev.map((it) => ({ ...it, status: "working" })))

        disposeRef.current = subscribeBatch(jobId, {
          onItem: (ev) => {
            const idx = Number(ev.id)
            const localId = byIndex[idx]
            if (localId == null) return
            const result =
              ev.result && "overall" in ev.result
                ? (ev.result as VerificationResult)
                : undefined
            applyResult(localId, ev.status, result)
            dlog("batch.item", { idx, filename: ev.filename, status: ev.status })
          },
          onDone: () => {
            setBusy(false)
            dlog("batch.done", { count: files.length })
          },
          onError: () => {
            setError("Batch stream interrupted")
            setBusy(false)
            derror("batch.error", { jobId })
          },
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Batch failed to start")
        setItems((prev) => prev.map((it) => ({ ...it, status: "error" })))
        setBusy(false)
        derror("batch.start_error", e)
      }
    },
    [applyResult, reset],
  )

  /**
   * Batch with one shared beverage profile applied to every file (the fallback
   * path when no per-label map is imported). Builds a filename → fields map,
   * using a list for any duplicated filename so the backend matches each upload
   * in submission order.
   */
  const verifyBatch = useCallback(
    (files: File[], expected: ExpectedFields) => {
      const expectedMap: ExpectedMap = {}
      const counts: Record<string, number> = {}
      for (const f of files) counts[f.name] = (counts[f.name] ?? 0) + 1
      for (const name of Object.keys(counts)) {
        expectedMap[name] =
          counts[name] > 1 ? Array(counts[name]).fill(expected) : expected
      }
      return runBatch(files, expectedMap)
    },
    [runBatch],
  )

  /**
   * Batch where each file is graded against its OWN imported expected fields
   * (DECISION 3). `expectedMap` is the parsed/validated import — it goes
   * unchanged to startBatch, so each backend label is resolved against its
   * filename's entry. Callers should have validated filename coverage first
   * (see matchExpectedMap), but the backend still enforces it (422).
   */
  const verifyBatchWithMap = useCallback(
    (files: File[], expectedMap: ExpectedMap) => runBatch(files, expectedMap),
    [runBatch],
  )

  /**
   * Auto-advance (DECISION 5): after a decision is recorded in batch, move the
   * selection to the next item with no decision yet, scanning forward from the
   * current position and wrapping. If none remain unreviewed, stay put. The
   * decision was already written via `patch`, so we read it from `items` in
   * scope and update only the selection.
   */
  const advanceToNextUnreviewed = useCallback(
    (fromId: string) => {
      if (items.length <= 1) return
      const cur = items.findIndex((it) => it.id === fromId)
      const base = cur < 0 ? 0 : cur
      for (let off = 1; off <= items.length; off++) {
        const cand = items[(base + off) % items.length]
        if (cand.decision === undefined && cand.id !== fromId) {
          setSelectedId(cand.id)
          return
        }
      }
      // None remain unreviewed — stay put.
    },
    [items],
  )

  const selected = items.find((it) => it.id === selectedId) ?? null

  return {
    items,
    selected,
    selectedId,
    busy,
    error,
    select: setSelectedId,
    patch,
    verifyOne,
    reverify,
    verifyBatch,
    verifyBatchWithMap,
    advanceToNextUnreviewed,
    runSample,
    reset,
    setError,
    clearError: () => setError(null),
    sampleFilename: SAMPLE_FILENAME,
  }
}

export type ReviewSession = ReturnType<typeof useReviewSession>
