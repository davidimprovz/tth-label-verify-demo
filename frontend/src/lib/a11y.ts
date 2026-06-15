// Accessibility preferences, persisted to localStorage and applied as data-*
// attributes on <html> so the CSS override blocks in index.css take effect.
//
// High contrast is always on (a non-negotiable default for legibility). Font
// size is a 3-step scale (Standard / Large / Largest) defaulting to Large, so
// the app reads comfortably for older reviewers out of the box.

const STORAGE_KEY = "ttb.a11y"

export type FontSize = "md" | "lg" | "xl"

export interface A11yPrefs {
  fontSize: FontSize
}

/** Large by default — the app should be easy to read with no configuration. */
const DEFAULTS: A11yPrefs = { fontSize: "lg" }

const SIZES: FontSize[] = ["md", "lg", "xl"]

/** Read persisted prefs (defaults when absent / storage unavailable). */
export function loadA11yPrefs(): A11yPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<A11yPrefs> & { largeFont?: boolean }
    if (parsed.fontSize && SIZES.includes(parsed.fontSize)) {
      return { fontSize: parsed.fontSize }
    }
    // Migrate the old boolean largeFont flag onto the new scale.
    if (typeof parsed.largeFont === "boolean") {
      return { fontSize: parsed.largeFont ? "lg" : "md" }
    }
    return { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Persist prefs (best-effort). */
export function saveA11yPrefs(prefs: A11yPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable — the in-page selector still works for this session.
  }
}

/**
 * Reflect prefs onto <html> data-* attributes (drives the CSS overrides). High
 * contrast is applied unconditionally — it's the permanent default.
 */
export function applyA11yPrefs(prefs: A11yPrefs) {
  const root = document.documentElement
  root.dataset.fontscale = prefs.fontSize
  root.dataset.contrast = "high"
}
