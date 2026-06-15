import { type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check, X } from "lucide-react"
import { cn } from "../lib/cn"

const EASE = [0.22, 1, 0.36, 1] as const
/** Resting width of an opened pane (px). Inner content is fixed at this width so
 *  text doesn't reflow while the container width tweens open/closed. */
const PANE_PX = 384
/** How far the inner edge fades to transparent (px) — a soft seam, no hard line. */
const FADE_PX = 56

/**
 * A review-surface side panel that grows OUT of the image's edge into the gutter
 * toward the screen edge (it animates its width from 0), so it never overlays the
 * label image — the image stays visible for reference. It is an in-flow flex
 * sibling of the image, not a fixed overlay.
 *
 * The inner edge (facing the image) has no border; instead the whole panel is
 * masked so it fades to transparent over the inner strip — it dissolves into the
 * image rather than meeting it with a sharp seam, and so never visually obstructs
 * the centered content even when both panes are open. Closing is via a primary
 * "Done" check button (or X). Wide screens only; narrow screens use the Flyout.
 */
export function SidePane({
  open,
  onClose,
  title,
  side,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  side: "left" | "right"
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  const fadeDir = side === "right" ? "to right" : "to left"
  const mask = `linear-gradient(${fadeDir}, transparent 0, #000 ${FADE_PX}px)`
  // Pad the content clear of the fade on the inner side.
  const pad = side === "right" ? "pl-14 pr-5" : "pr-14 pl-5"

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          role="region"
          aria-label={title}
          initial={reduce ? { opacity: 0 } : { width: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { width: PANE_PX, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { width: 0, opacity: 0 }}
          transition={{ duration: 0.62, ease: EASE }}
          className={cn(
            "relative z-20 flex min-h-0 shrink-0 flex-col self-stretch overflow-hidden",
            side === "right" ? "rounded-r-2xl" : "rounded-l-2xl",
          )}
          style={{
            background: "rgba(1, 32, 50, 0.82)",
            backdropFilter: "blur(16px) saturate(120%)",
            WebkitBackdropFilter: "blur(16px) saturate(120%)",
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        >
          <div className="flex h-full flex-col" style={{ width: PANE_PX }}>
            <header className={cn("flex items-center justify-between gap-3 border-b-2 border-white/10 py-4", pad)}>
              <h2 className="font-display text-lg font-semibold text-parchment">{title}</h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 rounded-lg border-2 border-green-bright/55 bg-[rgba(31,164,92,0.16)] px-3 py-1.5 font-sans text-sm font-semibold text-green-bright transition-colors hover:bg-[rgba(31,164,92,0.3)]"
                >
                  <Check aria-hidden className="h-4 w-4" /> Done
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={`Close ${title}`}
                  className="rounded-lg p-1.5 text-parchment/55 transition-colors hover:text-parchment"
                >
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </div>
            </header>
            <div className={cn("min-h-0 flex-1 overflow-y-auto py-5", pad)}>{children}</div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
