import { motion, AnimatePresence } from "framer-motion"
import { CircleCheck, AlertTriangle, Check, X, RotateCcw } from "lucide-react"
import type { ReviewItem } from "../lib/review"
import { deriveRecommendation, gradedFields } from "../lib/review"
import type { ReviewSession } from "../lib/useReviewSession"
import { cn } from "../lib/cn"

/**
 * The single decision surface at the top of the review pane — one wide tab split
 * down the middle.
 *
 *   Left half  → the system RECOMMENDATION (always tinted: green Accept, amber/
 *                red Review). At rest, only this half is colored.
 *   Right half → the reviewer's ACTION. Undecided shows Accept / Reject
 *                buttons; once clicked, the half fills with the RECORDED action
 *                — green "Accepted" or red "Rejected". On reject the parent flies
 *                a right-hand annotation pane out to capture the rejection reason.
 *
 * The A / R hotkeys (wired in App) call the same `onDecide`, so this stays the
 * one decision path. Batch auto-advance is handled by the parent's onDecide.
 */
export function DecisionTab({
  item,
  session,
  onDecide,
}: {
  item: ReviewItem | null
  session: ReviewSession
  /** Records the decision + parent side effects (patch, advance, annotate). */
  onDecide?: (decision: "accepted" | "rejected") => void
}) {
  const rec = deriveRecommendation(item)
  if (!item || !rec) return null

  const resolved = !!item.result || item.status === "error"
  const decision = item.decision

  // Supporting metadata folded up under the recommendation: latency, OCR tier,
  // and the pass/review/fail tallies (relocated here from the old verdict card).
  const result = item.result
  const graded = gradedFields(result)
  const counts = {
    pass: graded.filter((f) => f.status === "pass").length,
    review: graded.filter((f) => f.status === "review").length,
    fail: graded.filter((f) => f.status === "fail").length,
  }

  const recTone =
    rec.tone === "green"
      ? "text-green-bright"
      : rec.tone === "red"
        ? "text-red"
        : "text-amber"
  const RecMark = rec.kind === "accept" ? CircleCheck : AlertTriangle

  const decide = (d: "accepted" | "rejected") => {
    if (!resolved) return
    onDecide?.(d)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass grid grid-cols-2 overflow-hidden rounded-2xl border-2 border-gold/30"
    >
      {/* Left half — the recommendation, always tinted. The pass/review/fail
          tallies sit beneath it; the technical inference metrics (latency, tier)
          are hidden behind a click below the image, not shown here. */}
      <div className="flex flex-col items-center justify-center gap-1.5 border-r-2 border-gold/25 px-5 py-5 text-center">
        <span className="flex items-center gap-3">
          <RecMark aria-hidden className={cn("h-7 w-7 shrink-0 sm:h-8 sm:w-8", recTone)} />
          <span
            className={cn(
              "engraved font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl",
              recTone,
            )}
          >
            {rec.label}
          </span>
        </span>

        {result && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span className="text-green-bright">{counts.pass} pass</span>
            {counts.review > 0 && <span className="text-amber">{counts.review} review</span>}
            {counts.fail > 0 && <span className="text-red">{counts.fail} fail</span>}
          </div>
        )}
      </div>

      {/* Right half — the user's action. Fills green/red once recorded. */}
      <div className="relative flex items-center justify-center px-4 py-4">
        <AnimatePresence mode="wait" initial={false}>
          {decision ? (
            <motion.div
              key={decision}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className={cn(
                "absolute inset-0 flex items-center justify-center gap-3",
                decision === "accepted"
                  ? "bg-gradient-to-r from-[rgba(31,164,92,0.18)] to-[rgba(31,164,92,0.34)] text-green-bright"
                  : "bg-gradient-to-r from-[rgba(179,64,47,0.18)] to-[rgba(179,64,47,0.36)] text-red",
              )}
            >
              {decision === "accepted" ? (
                <Check aria-hidden className="h-7 w-7" />
              ) : (
                <X aria-hidden className="h-7 w-7" />
              )}
              <span className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                {decision === "accepted" ? "Accepted" : "Rejected"}
              </span>
              {/* Let the reviewer change their mind — reopen the choice. Given a
                  clear outlined-button treatment so it reads at a glance. */}
              <button
                type="button"
                onClick={() => session.patch(item.id, { decision: undefined })}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-parchment/35 bg-navy-900/40 px-2.5 py-1 font-sans text-xs font-semibold text-parchment/90 transition-colors hover:border-parchment/60 hover:bg-navy-900/60 hover:text-parchment"
              >
                <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Change
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="choose"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex w-full items-center gap-3"
            >
              <motion.button
                type="button"
                disabled={!resolved}
                onClick={() => decide("accepted")}
                whileHover={resolved ? { y: -2 } : undefined}
                whileTap={resolved ? { scale: 0.97 } : undefined}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-green-bright/70 bg-[rgba(31,164,92,0.22)] px-3 py-2.5 font-sans text-base font-bold text-green-bright transition-colors hover:bg-[rgba(31,164,92,0.36)] disabled:opacity-40"
              >
                <Check aria-hidden className="h-5 w-5" /> Accept
                <kbd className="rounded border-2 border-current/40 px-1.5 py-0.5 font-mono text-[10px] opacity-75">A</kbd>
              </motion.button>
              <motion.button
                type="button"
                disabled={!resolved}
                onClick={() => decide("rejected")}
                whileHover={resolved ? { y: -2 } : undefined}
                whileTap={resolved ? { scale: 0.97 } : undefined}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red/75 bg-[rgba(179,64,47,0.24)] px-3 py-2.5 font-sans text-base font-bold text-red transition-colors hover:bg-[rgba(179,64,47,0.4)] disabled:opacity-40"
              >
                <X aria-hidden className="h-5 w-5" /> Reject
                <kbd className="rounded border-2 border-current/40 px-1.5 py-0.5 font-mono text-[10px] opacity-75">R</kbd>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
