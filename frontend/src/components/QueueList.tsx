import { motion } from "framer-motion"
import { CheckCircle2, AlertTriangle, XCircle, Loader2, CircleSlash, FileImage } from "lucide-react"
import type { ItemStatus, ReviewItem } from "../lib/review"
import { cn } from "../lib/cn"

const ICONS: Record<ItemStatus, { Icon: typeof CheckCircle2; cls: string; label: string }> = {
  queued: { Icon: FileImage, cls: "text-parchment/40", label: "Queued" },
  working: { Icon: Loader2, cls: "text-infoblue", label: "Working" },
  pass: { Icon: CheckCircle2, cls: "text-green-bright", label: "Pass" },
  review: { Icon: AlertTriangle, cls: "text-amber", label: "Review" },
  fail: { Icon: XCircle, cls: "text-red", label: "Fail" },
  error: { Icon: CircleSlash, cls: "text-red", label: "Error" },
}

/** The batch queue: every item with a live status chip (shimmer → resolved). */
export function QueueList({
  items,
  selectedId,
  onSelect,
}: {
  items: ReviewItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="flex flex-col gap-1.5" role="listbox" aria-label="Batch queue">
      {items.map((it, i) => {
        const meta = ICONS[it.status]
        const working = it.status === "working"
        const selected = it.id === selectedId
        return (
          <motion.li
            key={it.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.4) }}
            role="option"
            aria-selected={selected}
          >
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                working && "shimmer-scan",
                selected
                  ? "border-gold/60 bg-[rgba(200,169,81,0.1)]"
                  : "border-white/8 bg-white/[0.02] hover:border-gold/30 hover:bg-white/[0.04]",
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-black/30">
                <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-[12px] font-medium text-parchment/90">
                  {it.filename}
                </span>
                <span className={cn("font-mono text-[10px] uppercase tracking-wider", meta.cls)}>
                  {meta.label}
                </span>
              </span>
              <meta.Icon
                aria-hidden
                className={cn("h-4 w-4 shrink-0", meta.cls, working && "animate-spin")}
              />
            </button>
          </motion.li>
        )
      })}
    </ul>
  )
}
