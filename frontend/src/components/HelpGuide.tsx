import { useEffect, useRef } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  X,
  LifeBuoy,
  ClipboardList,
  UploadCloud,
  ScanSearch,
  StickyNote,
  CheckCircle2,
  CircleHelp,
  Keyboard,
  Type,
  Contrast,
} from "lucide-react"
import { HOTKEY_HINTS } from "./HotkeysHelp"

const EASE = [0.22, 1, 0.36, 1] as const

/** Selector for the tabbable controls the focus trap cycles between. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** A single numbered "how to use it" step. */
const STEPS: { icon: typeof ClipboardList; title: string; body: string }[] = [
  {
    icon: ClipboardList,
    title: "Add the application data",
    body: "Fill in the short form, or import an expected_map.json to grade a whole batch — each label against its own data.",
  },
  {
    icon: UploadCloud,
    title: "Upload the label image(s)",
    body: "Drag in one label photo for a single check, or several for a batch — the mode is chosen automatically.",
  },
  {
    icon: ScanSearch,
    title: "Read the verdict",
    body: "A large mark appears over the image. Open Details to see how every field compared, line by line.",
  },
  {
    icon: StickyNote,
    title: "Add a note (optional)",
    body: "Leave a short note on the label for the record or for the next reviewer.",
  },
  {
    icon: CheckCircle2,
    title: "Accept or Reject",
    body: "You make the final call. The app only assists — it never decides for you.",
  },
]

/**
 * Built-in help / instructions panel for non-technical reviewers (build step 10).
 * A centered, focus-trapped modal styled with the same Treasury tokens as
 * HotkeysHelp, but with larger, plain-language guidance: what the app does, how
 * to use it, what the verdicts mean, and the accessibility affordances.
 *
 * Reachable from the AppMenu "Help" item. It can re-open the first-visit
 * walkthrough (`onOpenWalkthrough`) and the keyboard-shortcuts overlay
 * (`onOpenHotkeys`) so both stay reachable from one place.
 */
export function HelpGuide({
  open,
  onClose,
  onOpenWalkthrough,
  onOpenHotkeys,
}: {
  open: boolean
  onClose: () => void
  onOpenWalkthrough: () => void
  onOpenHotkeys: () => void
}) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // Capture opener + move focus into the panel on open; restore on close.
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
          className="fixed inset-0 z-40 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {/* Backdrop — click to close. */}
          <button
            type="button"
            aria-label="Close help"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-navy-900/85 backdrop-blur-sm"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Help and instructions"
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="modal-surface relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-2xl outline-none"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg border border-gold/30 bg-[rgba(200,169,81,0.08)]">
                  <LifeBuoy aria-hidden className="h-5 w-5 text-gold" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold text-parchment">
                    How this works
                  </h2>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-parchment/45">
                    A quick guide for reviewers
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close help"
                className="rounded p-1 text-parchment/60 transition-colors hover:text-parchment"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {/* What this app does */}
              <section>
                <h3 className="font-display text-base font-semibold text-gold-soft">
                  What this app does
                </h3>
                <p className="mt-1.5 font-sans text-[15px] leading-relaxed text-parchment/85">
                  It checks an alcohol label image against the expected
                  application data and flags where they match or differ. It does
                  not replace you — it highlights matches and mismatches so a
                  person can make the final decision.
                </p>
              </section>

              {/* How to use it */}
              <section>
                <h3 className="font-display text-base font-semibold text-gold-soft">
                  How to use it
                </h3>
                <ol className="mt-2.5 flex flex-col gap-2.5">
                  {STEPS.map((step, i) => {
                    const Icon = step.icon
                    return (
                      <li
                        key={step.title}
                        className="flex gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-gold/40 bg-[rgba(200,169,81,0.1)] font-mono text-sm font-bold text-gold-soft">
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
              </section>

              {/* What the verdicts mean */}
              <section>
                <h3 className="font-display text-base font-semibold text-gold-soft">
                  What the verdicts mean
                </h3>
                <div className="mt-2.5 flex flex-col gap-2.5">
                  <div className="flex gap-3 rounded-lg border border-green/30 bg-[rgba(74,124,89,0.1)] p-3">
                    <CheckCircle2
                      aria-hidden
                      className="mt-0.5 h-5 w-5 shrink-0 text-green-bright"
                    />
                    <p className="font-sans text-[15px] leading-relaxed text-parchment/85">
                      <span className="font-semibold text-parchment">PASS</span> —
                      every checked field matched the application data.
                    </p>
                  </div>
                  <div className="flex gap-3 rounded-lg border border-amber/30 bg-[rgba(196,148,58,0.1)] p-3">
                    <CircleHelp
                      aria-hidden
                      className="mt-0.5 h-5 w-5 shrink-0 text-amber"
                    />
                    <p className="font-sans text-[15px] leading-relaxed text-parchment/85">
                      <span className="font-semibold text-parchment">
                        NEEDS REVIEW
                      </span>{" "}
                      — something needs a human: a mismatch, a low-quality image,
                      or a warning. The app always errs toward review — it never
                      passes a label silently when something looks off.
                    </p>
                  </div>
                </div>
              </section>

              {/* Accessibility */}
              <section>
                <h3 className="font-display text-base font-semibold text-gold-soft">
                  Accessibility &amp; shortcuts
                </h3>
                <p className="mt-1.5 font-sans text-[15px] leading-relaxed text-parchment/85">
                  In the menu you can turn on{" "}
                  <span className="inline-flex items-center gap-1 font-semibold text-parchment">
                    <Type aria-hidden className="h-4 w-4 text-gold/80" /> Large
                    font
                  </span>{" "}
                  and{" "}
                  <span className="inline-flex items-center gap-1 font-semibold text-parchment">
                    <Contrast aria-hidden className="h-4 w-4 text-gold/80" /> High
                    contrast
                  </span>{" "}
                  for easier reading. Every action also has a keyboard shortcut.
                </p>
                <ul className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {HOTKEY_HINTS.map((hint) => (
                    <li
                      key={hint.label}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5"
                    >
                      <span className="font-sans text-[13px] text-parchment/80">
                        {hint.label}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {hint.keys.map((k) => (
                          <kbd
                            key={k}
                            className="rounded border border-gold/40 bg-[rgba(200,169,81,0.08)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gold-soft"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* Footer actions — reach the walkthrough and the hotkeys overlay. */}
            <div className="flex flex-wrap gap-2.5 border-t border-white/8 px-5 py-4">
              <button
                type="button"
                onClick={onOpenWalkthrough}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-gold/40 bg-[rgba(200,169,81,0.08)] px-3 py-2 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.16)]"
              >
                <LifeBuoy aria-hidden className="h-4 w-4" />
                Replay getting started
              </button>
              <button
                type="button"
                onClick={onOpenHotkeys}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 font-sans text-sm font-semibold text-parchment/80 transition-colors hover:border-gold/40 hover:text-parchment"
              >
                <Keyboard aria-hidden className="h-4 w-4" />
                Keyboard shortcuts
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
