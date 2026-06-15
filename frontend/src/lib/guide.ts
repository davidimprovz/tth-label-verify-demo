// First-visit getting-started flag, persisted to localStorage (mirrors the
// lib/a11y.ts try/catch pattern). Distinct from the splash's per-tab
// sessionStorage flag: `ttb.guideSeen` persists across tabs/sessions so the
// walkthrough only ever auto-shows on a user's very first visit. The Help menu
// can still reopen it on demand regardless of this flag.

const GUIDE_SEEN_KEY = "ttb.guideSeen"

/** Whether the getting-started walkthrough has been seen on this device. */
export function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === "1"
  } catch {
    // Storage unavailable (private mode / quota) — treat as already seen so we
    // never nag a user who can't persist the dismissal.
    return true
  }
}

/** Mark the walkthrough as seen so it won't auto-show on future visits. */
export function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, "1")
  } catch {
    // Best-effort; if it fails the in-session dismissal still hides it.
  }
}
