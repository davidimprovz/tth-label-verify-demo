import { motion } from "framer-motion"
import { ShieldCheck } from "lucide-react"
import type { FieldResult } from "../lib/types"
import { StatusPill } from "./StatusPill"

/**
 * Hero card for the Government Warning — the verbatim-match check that is
 * always required (27 CFR 16.21). Given dedicated emphasis above the field rows
 * with a thick gold border, larger type, and roomy padding.
 */
export function WarningCard({ field }: { field: FieldResult }) {
  const ok = field.status === "pass"
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 26 }}
      className="relative overflow-hidden rounded-xl border-2 border-gold/50 bg-gradient-to-br from-[rgba(1,58,87,0.7)] to-[rgba(0,20,31,0.7)] p-6"
    >
      <div className="pointer-events-none absolute -right-6 -top-6 opacity-[0.06]">
        <ShieldCheck className="h-32 w-32 text-gold" aria-hidden />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck aria-hidden className="h-5 w-5 text-gold" />
          <h3 className="font-display text-lg font-semibold tracking-wide text-gold-soft">
            Government Warning
          </h3>
        </div>
        <StatusPill status={field.status} size="md" />
      </div>

      <p className="relative mt-3 font-sans text-sm font-medium uppercase tracking-wider text-parchment/65">
        {ok ? "Verbatim match confirmed" : "Mandatory statement check"}
      </p>

      <div className="relative mt-3 rounded-lg border-2 border-white/12 bg-black/25 p-4">
        <p className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-parchment/90 [overflow-wrap:anywhere]">
          {field.found || field.expected || "No warning text detected."}
        </p>
      </div>

      {!ok && field.reason && (
        <p className="relative mt-3 font-sans text-sm leading-relaxed text-amber">
          {field.reason}
        </p>
      )}
    </motion.div>
  )
}
