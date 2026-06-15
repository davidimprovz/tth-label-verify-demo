import type { ReviewItem } from "../lib/review"
import { StatusPill } from "./StatusPill"

/**
 * The at-a-glance verdict signal over the label image. The big centered mark was
 * removed (it obstructed the image); the verdict now reads from the image FRAME
 * color — tinted to match the recommendation — plus this small corner pill, so
 * the label itself is never covered. Resolved-only.
 */
export function VerdictOverlay({ item }: { item: ReviewItem | null }) {
  if (!item) return null
  const resolved = !!item.result || item.status === "error"
  if (!resolved) return null

  // pass | review | fail | error face. result.overall is only pass|review;
  // item.status carries fail/error for the harder signals.
  const pillStatus =
    item.status === "error"
      ? "error"
      : item.status === "fail"
        ? "fail"
        : item.result?.overall ?? "review"

  const announcement =
    pillStatus === "pass"
      ? "Verdict: pass"
      : pillStatus === "error"
        ? "Verification failed"
        : pillStatus === "fail"
          ? "Verdict: fail"
          : "Verdict: needs review"

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Resolved-only badge, top-right corner of the image. */}
      <div className="pointer-events-auto absolute right-3 top-3">
        <StatusPill status={pillStatus} />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
