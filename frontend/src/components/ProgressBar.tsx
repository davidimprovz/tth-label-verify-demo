import { useReducedMotion } from "framer-motion"
import { cn } from "../lib/cn"

/**
 * Gold-fill progress bar on a subtle navy track with a soft moving sheen.
 *
 * Two modes:
 *   - indeterminate: a gold pulse sweeps the track (work in flight, no %).
 *   - determinate: pass `value`/`max`; the fill grows to value/max.
 *
 * Reduced-motion: the sheen sweep is suppressed (CSS handles the keyframe);
 * determinate fills still snap to width without an animated transition.
 * Numeric counts (when shown elsewhere) use Geist Mono.
 */
export function ProgressBar({
  value,
  max = 100,
  indeterminate = false,
  className,
  label,
}: {
  value?: number
  max?: number
  indeterminate?: boolean
  className?: string
  label?: string
}) {
  const reduce = useReducedMotion()
  const pct =
    indeterminate || value == null
      ? 0
      : Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy={indeterminate || undefined}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full",
        "border border-gold/15 bg-[rgba(0,20,31,0.6)]",
        className,
      )}
    >
      {indeterminate ? (
        <div
          className={cn(
            "progress-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full",
            "bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent",
          )}
        />
      ) : (
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-bright)]"
          style={{
            width: `${pct}%`,
            transition: reduce ? "none" : "width 420ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          {/* Soft moving sheen over the filled portion. */}
          <span aria-hidden className="progress-sheen absolute inset-0 rounded-full" />
        </div>
      )}
    </div>
  )
}
