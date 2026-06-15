import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { FilePlus2, ListChecks } from "lucide-react"
import { AppMenu } from "./AppMenu"
import { applyA11yPrefs, loadA11yPrefs, saveA11yPrefs } from "../lib/a11y"

/** Compact batch status shown in the nav when a batch is in review/processing. */
export interface BatchNav {
  done: number
  total: number
  onBrowseAll: () => void
}

/**
 * Treasury-style top bar: gold seal + wordmark, a status indicator, a visible
 * "New verification" action (in the app view), and the hamburger menu (AppMenu)
 * holding Home, accessibility toggles, and Help. The wordmark doubles as a Home
 * link. Minimal on mobile so the always-visible affordance count stays low.
 */
export function TopBar({
  view,
  onHome,
  onNewVerification,
  onHelp,
  busy,
  batch = null,
  leaveLocked = false,
}: {
  view: "home" | "app"
  onHome: () => void
  onNewVerification: () => void
  onHelp: () => void
  busy?: boolean
  /** When set, a compact batch progress indicator sits centered in the nav. */
  batch?: BatchNav | null
  /** Batch in progress with labels still unreviewed — "New"/Home are gated. */
  leaveLocked?: boolean
}) {
  // Own the accessibility prefs; reflect them onto <html> and persist on change.
  const [prefs, setPrefs] = useState(loadA11yPrefs)

  useEffect(() => {
    applyA11yPrefs(prefs)
    saveA11yPrefs(prefs)
  }, [prefs])

  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex items-center justify-between gap-3 border-b-2 border-gold/25 px-4 py-3 sm:px-5"
    >
      {/* Compact batch progress — centered in the nav so it never clutters the
          content/center view. Desktop only; small screens use Browse all. */}
      {batch && (
        <div className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 items-center gap-3 lg:flex">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/70">
            Batch
          </span>
          <span className="font-mono text-[11px] text-parchment/70">
            {batch.done} of {batch.total}
          </span>
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/12">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-bright)] transition-[width] duration-500"
              style={{ width: `${batch.total > 0 ? (batch.done / batch.total) * 100 : 0}%` }}
            />
          </span>
          <button
            type="button"
            onClick={batch.onBrowseAll}
            className="flex items-center gap-1.5 rounded-lg border-2 border-gold/45 bg-[rgba(200,169,81,0.08)] px-2.5 py-1 font-sans text-xs font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.16)]"
          >
            <ListChecks aria-hidden className="h-4 w-4" /> Browse all
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onHome}
        aria-label="Home"
        className="flex min-w-0 items-center gap-3 rounded-lg text-left sm:gap-4"
      >
        <img
          src="/ttb-logo.svg"
          alt="TTB — Alcohol and Tobacco Tax and Trade Bureau"
          className="h-8 w-auto shrink-0 sm:h-10"
        />
        <div className="hidden min-w-0 border-l-2 border-gold/30 pl-3 sm:block sm:pl-4">
          <h1 className="truncate font-display text-base font-semibold leading-none tracking-tight sm:text-lg">
            <span className="text-gold-gradient">Label Verification</span>
          </h1>
          <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.28em] text-parchment/55">
            Compliance Assist
          </p>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-3">
        {/* System-status indicator — desktop only. Green "Ready" at rest; amber
            "Working…" while a verify is in flight. */}
        <div className="hidden items-center gap-2 md:flex">
          <span
            className={[
              "h-1.5 w-1.5 animate-pulse rounded-full",
              busy ? "bg-amber" : "bg-green-bright",
            ].join(" ")}
          />
          <span
            className={[
              "font-mono text-[10px] uppercase tracking-[0.2em]",
              busy ? "text-amber" : "text-parchment/50",
            ].join(" ")}
          >
            {busy ? "Working…" : "Ready"}
          </span>
        </div>

        {/* Visible "New verification" — only in the working area (on the landing
            screen the big "Verify a label" CTA already covers this). */}
        {view === "app" && (
          <button
            type="button"
            onClick={onNewVerification}
            aria-disabled={leaveLocked}
            title={leaveLocked ? "Review every label in the batch first" : undefined}
            className={[
              "hidden items-center gap-2 rounded-lg border-2 px-3 py-1.5 font-sans text-sm font-semibold transition-colors sm:flex",
              leaveLocked
                ? "cursor-not-allowed border-gold/20 bg-transparent text-parchment/35"
                : "border-gold/45 bg-[rgba(200,169,81,0.08)] text-gold-soft hover:bg-[rgba(200,169,81,0.16)]",
            ].join(" ")}
          >
            <FilePlus2 aria-hidden className="h-4 w-4" /> New
          </button>
        )}

        <AppMenu
          prefs={prefs}
          onPrefsChange={setPrefs}
          onHome={onHome}
          onNewVerification={onNewVerification}
          onHelp={onHelp}
        />
      </div>
    </motion.header>
  )
}
