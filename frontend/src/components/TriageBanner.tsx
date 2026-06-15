import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ScanLine, X } from "lucide-react"
import type { FieldResult } from "../lib/types"

/**
 * Prominent-but-non-blocking auto-triage banner shown when the result carries
 * an `image_quality` review field (blur / skew). The reviewer can dismiss or
 * override it — it never blocks the decision.
 */
export function TriageBanner({ field }: { field: FieldResult }) {
  const [dismissed, setDismissed] = useState(false)
  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.32 }}
          role="alert"
          className="overflow-hidden rounded-xl border-2 border-amber/50 bg-[rgba(217,154,43,0.12)] backdrop-blur-sm"
        >
          <div className="flex items-start gap-3.5 p-5">
            <ScanLine aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-amber" />
            <div className="min-w-0 flex-1">
              <p className="font-sans text-base font-semibold text-amber">
                Photo quality may be too low to verify reliably
              </p>
              <p className="mt-1.5 font-sans text-sm leading-relaxed text-parchment/80">
                {field.reason} Consider requesting a re-shoot — you can still
                override and decide below.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss photo-quality warning"
              className="rounded-md p-1.5 text-parchment/60 transition-colors hover:bg-white/5 hover:text-parchment"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
