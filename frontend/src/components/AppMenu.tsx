import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  Menu,
  X,
  FilePlus2,
  Home as HomeIcon,
  Type,
  LifeBuoy,
} from "lucide-react"
import { cn } from "../lib/cn"
import type { A11yPrefs, FontSize } from "../lib/a11y"

const FONT_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "md", label: "Standard" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Largest" },
]

const EASE = [0.22, 1, 0.36, 1] as const

/** Selector for the tabbable controls the dropdown focus trap cycles between. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Hamburger menu housed in the TopBar (design §2, note 2). Collapses secondary
 * navigation/actions out of the always-visible bar: Home, New verification, the
 * a11y toggles (large font / high contrast), and Help. (Application-data import
 * lives in the verification layout, not here.)
 *
 * Implemented as a focus-trapped dropdown anchored under the hamburger button.
 * Esc closes, an outside click closes, and Tab is trapped while open. Focus
 * moves into the panel on open and returns to the trigger on close.
 */
export function AppMenu({
  prefs,
  onPrefsChange,
  onHome,
  onNewVerification,
  onHelp,
}: {
  prefs: A11yPrefs
  onPrefsChange: (next: A11yPrefs) => void
  onHome: () => void
  onNewVerification: () => void
  onHelp: () => void
}) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Move focus into the panel on open; restore it to the trigger on close.
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      const panel = panelRef.current
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel)?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  // Esc closes, outside click closes, Tab is trapped while open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
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
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("pointerdown", onPointerDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("pointerdown", onPointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Run an action then close (returning focus to the trigger).
  const run = (fn: () => void) => () => {
    fn()
    close()
  }

  // Setting the text size keeps the menu open so the effect is visible.
  const setFontSize = (fontSize: FontSize) => () => onPrefsChange({ fontSize })

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        className={cn(
          "grid h-10 w-10 place-items-center rounded-lg border transition-colors",
          open
            ? "border-gold bg-[rgba(200,169,81,0.16)] text-gold-soft"
            : "border-white/10 text-parchment/70 hover:border-gold/40 hover:text-parchment",
        )}
      >
        {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="menu"
            aria-label="Application menu"
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute right-0 top-12 z-50 w-64 origin-top-right rounded-2xl p-2 outline-none shadow-[0_28px_70px_-24px_rgba(0,0,0,0.9)]"
            style={{
              background: "linear-gradient(180deg, #06303f 0%, #02141d 100%)",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
            }}
          >
            <p className="px-3 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-gold/70">
              Navigate
            </p>
            <MenuItem icon={<HomeIcon className="h-4 w-4" />} onClick={run(onHome)}>
              Home
            </MenuItem>
            <MenuItem icon={<FilePlus2 className="h-4 w-4" />} onClick={run(onNewVerification)}>
              New verification
            </MenuItem>

            <div className="my-1.5 h-px bg-white/8" />

            <p className="flex items-center gap-2 px-3 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-gold/70">
              <Type className="h-4 w-4" /> Text size
            </p>
            <div className="grid grid-cols-3 gap-1.5 px-2 pb-1">
              {FONT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={setFontSize(o.value)}
                  aria-pressed={prefs.fontSize === o.value}
                  className={cn(
                    "rounded-lg px-2 py-2 font-sans text-xs font-semibold transition-colors",
                    prefs.fontSize === o.value
                      ? "bg-[rgba(200,169,81,0.22)] text-gold-soft"
                      : "bg-white/[0.05] text-parchment/70 hover:bg-white/[0.1]",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="my-1.5 h-px bg-white/8" />

            <MenuItem icon={<LifeBuoy className="h-4 w-4" />} onClick={run(onHelp)}>
              Help &amp; getting started
            </MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** A single menu row — ≥40px tap target, optional checkmark for toggles. */
function MenuItem({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: ReactNode
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-sans text-sm text-parchment/85 transition-colors hover:bg-white/[0.04]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span className="shrink-0 text-parchment/55">{icon}</span>
      <span className="flex-1">{children}</span>
    </button>
  )
}
