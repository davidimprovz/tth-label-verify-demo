import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { StickyNote, X } from "lucide-react"
import type { ReviewItem } from "../lib/review"
import type { ReviewSession } from "../lib/useReviewSession"

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * On-image note affordance (design §2, step 6 / decision 4). A SIMPLE per-label
 * note shown in the bottom-left corner of the label image — NOT positional
 * click-to-drop pins. `item.notes` stays a plain string.
 *
 * Closed with no note  → a small "note" button.
 * Closed with a note    → a button carrying a gold dot indicator.
 * Open                  → a compact textarea + save/close.
 *
 * Open state is controlled by App so the `N` hotkey can toggle it; positioned
 * top-left so it never overlaps VerdictOverlay's top-right StatusPill. The
 * closed affordance shows a "Add a note" label on hover/focus.
 */
export function ImageNoteLayer({
  item,
  session,
  open,
  onOpenChange,
}: {
  item: ReviewItem
  session: ReviewSession
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const reduce = useReducedMotion()
  const [draft, setDraft] = useState(item.notes)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasNote = item.notes.trim().length > 0

  // Sync the draft to the item's note whenever the editor opens or the selected
  // label changes, so the textarea always reflects the persisted note.
  useEffect(() => {
    if (open) setDraft(item.notes)
  }, [open, item.id, item.notes])

  // Move focus into the textarea when the editor opens.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => textareaRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [open])

  const save = () => {
    session.patch(item.id, { notes: draft.trim() })
    onOpenChange(false)
  }
  const cancel = () => {
    setDraft(item.notes)
    onOpenChange(false)
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute left-3 top-3">
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.div
              key="editor"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="glass w-[min(20rem,calc(100vw-4rem))] rounded-xl border-2 border-gold/35 p-3.5 shadow-seal"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-gold/70">
                  <StickyNote aria-hidden className="h-3.5 w-3.5" /> Note
                </span>
                <button
                  type="button"
                  onClick={cancel}
                  aria-label="Close note"
                  className="rounded p-0.5 text-parchment/60 transition-colors hover:text-parchment"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter saves; Escape cancels. Stop propagation so the
                  // global hotkey handler doesn't act while typing.
                  e.stopPropagation()
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    save()
                  }
                  if (e.key === "Escape") {
                    e.preventDefault()
                    cancel()
                  }
                }}
                rows={3}
                placeholder="Add a note for this label…"
                className="w-full resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 font-sans text-sm text-parchment placeholder:text-parchment/30 focus:border-gold/60 focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-md px-3 py-1.5 font-sans text-xs font-semibold text-parchment/60 transition-colors hover:text-parchment"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  className="rounded-md bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] px-3 py-1.5 font-sans text-xs font-bold text-navy-900"
                >
                  Save
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="affordance"
              type="button"
              onClick={() => onOpenChange(true)}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.2, ease: EASE }}
              aria-label={hasNote ? "Edit note" : "Add a note"}
              className="glass relative inline-flex h-11 items-center gap-2 rounded-full border-2 border-gold/35 px-4 text-gold-soft shadow-seal transition-colors hover:border-gold/70 hover:text-gold"
            >
              <StickyNote aria-hidden className="h-5 w-5 shrink-0" />
              <span className="whitespace-nowrap font-sans text-sm font-semibold">
                {hasNote ? "Edit note" : "Add a note"}
              </span>
              {/* Subtle indicator that a note exists while the editor is closed. */}
              {hasNote && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-navy-900 bg-gold"
                />
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
