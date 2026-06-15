import { AnimatePresence, motion } from "framer-motion"
import type { ReviewItem } from "../lib/review"
import type { ReviewSession } from "../lib/useReviewSession"

/**
 * The prefilled, editable rejection reason. Rendered ONLY inside the right-hand
 * "Rejection note" Flyout (opened on Reject) — never inline on the review
 * surface. The Flyout already supplies the titled, glass-panel chrome, so this
 * is a bare labeled textarea (no redundant inner card). Editing flips
 * reasonTouched; the prefill itself is built in useReviewSession on resolve.
 */
export function RejectionReasonEditor({
  item,
  session,
}: {
  item: ReviewItem | null
  session: ReviewSession
}) {
  return (
    <AnimatePresence initial={false}>
      {item && item.decision === "rejected" && (
        <motion.label
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="block"
        >
          <span className="mb-1.5 flex items-center justify-between">
            <span className="font-sans text-[11px] font-medium text-parchment/65">
              Rejection reason
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-parchment/40">
              {item.reasonTouched ? "Edited" : "Pre-filled"}
            </span>
          </span>
          <textarea
            value={item.rejectionReason}
            onChange={(e) =>
              session.patch(item.id, {
                rejectionReason: e.target.value,
                reasonTouched: true,
              })
            }
            rows={6}
            placeholder="Reasons populate automatically from failing checks; edit as needed."
            className="w-full resize-none rounded-lg border border-white/10 bg-black/25 p-3 font-mono text-[12px] leading-relaxed text-parchment placeholder:text-parchment/30 focus:border-red/60 focus:outline-none"
          />
        </motion.label>
      )}
    </AnimatePresence>
  )
}
