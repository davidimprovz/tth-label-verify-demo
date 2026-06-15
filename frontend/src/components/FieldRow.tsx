import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import type { FieldResult } from "../lib/types"
import { fieldLabel } from "../lib/types"
import { StatusPill } from "./StatusPill"

/**
 * One per-field comparison row: field name, Expected → Found, and a single clear
 * status pill. Deliberately spare — larger type, thicker borders, generous
 * spacing, and no competing chrome (the confidence read-out is dropped so each
 * row carries one unambiguous PASS/REVIEW/FAIL marker). Cascades in via the
 * parent's stagger.
 */
export function FieldRow({ field, index }: { field: FieldResult; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 280, damping: 28 }}
      className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl border-2 border-gold/20 bg-white/[0.03] px-5 py-4"
    >
      <div className="min-w-0">
        <div className="font-sans text-base font-semibold text-gold-soft">
          {fieldLabel(field.field)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-sm">
          <span className="min-w-0 break-words text-parchment/60 [overflow-wrap:anywhere]" title="Expected">
            {field.expected ?? "—"}
          </span>
          <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-parchment/35" />
          <span
            className={[
              "min-w-0 break-words [overflow-wrap:anywhere]",
              field.status === "pass" ? "text-parchment" : "text-parchment/90",
            ].join(" ")}
            title="Found on label"
          >
            {field.found || "—"}
          </span>
        </div>
        {field.status !== "pass" && field.reason && (
          <p className="mt-2 font-sans text-sm leading-relaxed text-parchment/60">
            {field.reason}
          </p>
        )}
      </div>

      <StatusPill status={field.status} size="md" />
    </motion.div>
  )
}
