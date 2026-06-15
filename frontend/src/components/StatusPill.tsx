import { motion } from "framer-motion"
import { CheckCircle2, AlertTriangle, XCircle, CircleSlash } from "lucide-react"
import type { Status } from "../lib/types"
import { cn } from "../lib/cn"

type PillStatus = Status | "error"

const STYLES: Record<
  PillStatus,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  pass: {
    label: "PASS",
    cls: "text-green-bright border-green-bright/50 bg-[rgba(31,164,92,0.12)]",
    Icon: CheckCircle2,
  },
  review: {
    label: "REVIEW",
    cls: "text-amber border-amber/50 bg-[rgba(217,154,43,0.12)]",
    Icon: AlertTriangle,
  },
  fail: {
    label: "FAIL",
    cls: "text-red border-red/50 bg-[rgba(179,64,47,0.14)]",
    Icon: XCircle,
  },
  error: {
    label: "ERROR",
    cls: "text-red border-red/50 bg-[rgba(179,64,47,0.14)]",
    Icon: CircleSlash,
  },
}

/**
 * Status conveyed by icon + word (never color alone) for WCAG compliance.
 * Animates in with a small spring when first mounted.
 */
export function StatusPill({
  status,
  size = "md",
  className,
}: {
  status: PillStatus
  size?: "sm" | "md"
  className?: string
}) {
  const { label, cls, Icon } = STYLES[status]
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-mono font-semibold uppercase tracking-wider",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {label}
    </motion.span>
  )
}
