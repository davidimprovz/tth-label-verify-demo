import { AnimatePresence, motion } from "framer-motion"
import { Keyboard, X } from "lucide-react"

const EASE = [0.22, 1, 0.36, 1] as const

/** One row in the shortcut legend: the key(s) and what they do. */
export interface HotkeyHint {
  keys: string[]
  label: string
}

/** The canonical reviewer keymap, shown in the help overlay. */
export const HOTKEY_HINTS: HotkeyHint[] = [
  { keys: ["U"], label: "Upload label image(s)" },
  { keys: ["A"], label: "Accept the current label" },
  { keys: ["R"], label: "Reject the current label" },
  { keys: ["N"], label: "Add / edit the note" },
  { keys: ["D"], label: "Toggle field-comparison details" },
  { keys: ["E"], label: "Edit application data & re-verify" },
  { keys: ["J", "→"], label: "Next label in the queue" },
  { keys: ["K", "←"], label: "Previous label in the queue" },
  { keys: ["?"], label: "Toggle this shortcuts help" },
  { keys: ["Esc"], label: "Close this help" },
]

/**
 * Keyboard-shortcuts help overlay. Toggled by "?" (wired in App), dismissed by
 * Escape or a backdrop click. Styled with the existing Treasury tokens; the
 * dialog content stops click propagation so only the backdrop closes it.
 */
export function HotkeysHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          className="fixed inset-0 z-40 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-navy-900/85 backdrop-blur-sm" />

          <motion.div
            className="modal-surface relative w-full max-w-md rounded-2xl p-5"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-gold/30 bg-[rgba(200,169,81,0.08)]">
                  <Keyboard aria-hidden className="h-4 w-4 text-gold" />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-parchment">
                    Keyboard shortcuts
                  </h2>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-parchment/45">
                    Single-key · ignored while typing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close shortcuts help"
                className="rounded p-1 text-parchment/60 hover:text-parchment"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>

            <ul className="flex flex-col gap-1.5">
              {HOTKEY_HINTS.map((hint) => (
                <li
                  key={hint.label}
                  className="flex items-center justify-between gap-4 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <span className="font-sans text-[13px] text-parchment/85">{hint.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {hint.keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded border border-gold/40 bg-[rgba(200,169,81,0.08)] px-2 py-0.5 font-mono text-[11px] font-semibold text-gold-soft"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
