import { useEffect, useRef } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ClipboardList, UploadCloud, CheckCircle2, Sparkles } from "lucide-react"

const EASE = [0.22, 1, 0.36, 1] as const

/** Selector for the tabbable controls the focus trap cycles between. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** The 1-2-3 of the flow, kept deliberately short. */
const STEPS: { icon: typeof ClipboardList; title: string; body: string }[] = [
  {
    icon: UploadCloud,
    title: "Upload the label image(s)",
    body: "Drag in one image for a single check, or several for a batch.",
  },
  {
    icon: ClipboardList,
    title: "Add the application data",
    body: "Fill the form, or import a batch file for per-label data.",
  },
  {
    icon: CheckCircle2,
    title: "Review the verdict & decide",
    body: "The app flags matches and mismatches — you accept or reject.",
  },
]

/**
 * Friendly first-visit getting-started overlay (build step 10). Shows once on a
 * user's first visit (App gates it on the localStorage `ttb.guideSeen` flag,
 * after the splash has dismissed) and is recallable on demand from the Help
 * panel. Dismissing via "Get started" sets the flag — that doubles as the
 * "don't show again" default, so it never replays automatically.
 *
 * Centered modal on desktop, full-width bottom sheet on small screens.
 * Focus-trapped, Esc closes, respects reduced-motion.
 */
export function GettingStarted({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null
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

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onDismiss()
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
  }, [open, onDismiss])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {/* Backdrop — click to dismiss (counts as "seen"). */}
          <button
            type="button"
            aria-label="Dismiss getting started"
            onClick={onDismiss}
            className="absolute inset-0 cursor-default bg-navy-900/85 backdrop-blur-sm"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Getting started"
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="modal-surface relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 outline-none sm:rounded-2xl sm:p-7"
          >
            <div className="flex flex-col items-center text-center">
              <img
                src="/ttb-logo.svg"
                alt="TTB — Alcohol and Tobacco Tax and Trade Bureau"
                className="h-12 w-auto"
              />
              <h2 className="mt-4 font-display text-xl font-semibold text-parchment">
                Welcome
              </h2>
              <p className="mt-1.5 font-sans text-[15px] leading-relaxed text-parchment/75">
                This tool checks an alcohol label against its application data and
                flags anything that needs a human eye. Here is the gist:
              </p>
            </div>

            <ol className="mt-5 flex flex-col gap-2.5">
              {STEPS.map((step, i) => {
                const Icon = step.icon
                return (
                  <li
                    key={step.title}
                    className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/40 bg-[rgba(200,169,81,0.1)] font-mono text-sm font-bold text-gold-soft">
                      {i + 1}
                    </span>
                    <div>
                      <p className="flex items-center gap-1.5 font-sans text-[15px] font-semibold text-parchment">
                        <Icon aria-hidden className="h-4 w-4 text-gold/80" />
                        {step.title}
                      </p>
                      <p className="mt-0.5 font-sans text-sm leading-relaxed text-parchment/70">
                        {step.body}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>

            <button
              type="button"
              onClick={onDismiss}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] px-4 py-3 font-sans text-sm font-bold text-navy-900 shadow-seal transition-transform hover:scale-[1.01]"
            >
              <Sparkles aria-hidden className="h-4 w-4" />
              Get started
            </button>
            <p className="mt-2.5 text-center font-sans text-[11px] text-parchment/45">
              You can reopen this anytime from the menu under Help.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
