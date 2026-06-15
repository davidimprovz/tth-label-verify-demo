import { useEffect, useRef, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Check, X } from "lucide-react"

const EASE = [0.22, 1, 0.36, 1] as const

/** Selector for the tabbable controls a focus trap should cycle between. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Reusable focus-trapped sheet that slides in from the right on desktop and up
 * from the bottom (full-width) on mobile. Esc and a backdrop click close it;
 * focus is trapped inside while open and returned to the opener on close.
 * `role="dialog"` + `aria-modal` for assistive tech. Respects reduced-motion.
 */
export function Flyout({
  open,
  onClose,
  title,
  children,
  side = "right",
  showDone = false,
  flushVertical = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Which edge the drawer slides in from on desktop. Defaults to the right. */
  side?: "left" | "right"
  /** Show a primary "Done" check button in the header (alongside the X). */
  showDone?: boolean
  /** Drop the top/bottom borders on the desktop drawer (full-height edges). */
  flushVertical?: boolean
}) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  // The element that had focus before opening, restored on close.
  const openerRef = useRef<HTMLElement | null>(null)

  // Capture the opener and move focus into the panel when it opens; restore
  // focus to the opener when it closes.
  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null
      // Defer until the panel has mounted so the query finds its controls.
      const id = window.setTimeout(() => {
        const panel = panelRef.current
        if (!panel) return
        const first = panel.querySelector<HTMLElement>(FOCUSABLE)
        ;(first ?? panel).focus()
      }, 0)
      return () => window.clearTimeout(id)
    }
    openerRef.current?.focus?.()
  }, [open])

  // Esc to close + Tab focus trap while open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (nodes.length === 0) {
        e.preventDefault()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 z-50 flex ${side === "left" ? "justify-start" : "justify-end"}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {/* Backdrop — click to close. */}
          <button
            type="button"
            aria-label={`Close ${title}`}
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-navy-900/70 backdrop-blur-sm"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { x: side === "left" ? "-100%" : "100%", opacity: 0.6 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: side === "left" ? "-100%" : "100%", opacity: 0.6 }}
            transition={{ duration: 0.32, ease: EASE }}
            className={[
              "modal-surface relative z-10 flex flex-col outline-none",
              // Mobile: full-width bottom sheet. Desktop: full-height side drawer
              // anchored to the screen edge (not the content container).
              "absolute inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl border-2 border-gold/35",
              "sm:inset-y-0 sm:bottom-auto sm:max-h-none sm:w-[32rem] sm:max-w-[94vw]",
              // Square off the outer (screen) edge; round only the inner edge so
              // the drawer reads as part of the screen border.
              side === "left"
                ? "sm:left-0 sm:right-auto sm:rounded-l-none sm:rounded-r-2xl sm:border-l-0"
                : "sm:right-0 sm:rounded-r-none sm:rounded-l-2xl sm:border-r-0",
              // Full-height drawers can shed their top/bottom borders, which
              // otherwise hug the screen edges and read as clutter.
              flushVertical && "sm:border-t-0 sm:border-b-0",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3 border-b-2 border-white/10 px-6 py-4">
              <h2 className="font-display text-lg font-semibold text-parchment">{title}</h2>
              <div className="flex items-center gap-1.5">
                {showDone && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center gap-1.5 rounded-lg border-2 border-green-bright/55 bg-[rgba(31,164,92,0.16)] px-3 py-1.5 font-sans text-sm font-semibold text-green-bright transition-colors hover:bg-[rgba(31,164,92,0.3)]"
                  >
                    <Check aria-hidden className="h-4 w-4" /> Done
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={`Close ${title}`}
                  className="rounded p-1.5 text-parchment/60 transition-colors hover:text-parchment"
                >
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
