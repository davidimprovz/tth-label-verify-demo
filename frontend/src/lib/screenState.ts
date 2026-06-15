// Derives the one-task-at-a-time screen from existing session state — a pure
// selector, no new store. The shell (App.tsx) switches its main region on this.

import type { ReviewItem } from "./review"
import type { ReviewSession } from "./useReviewSession"

/** The four mutually-exclusive surfaces of the one-task-at-a-time flow. */
export type Screen = "intake" | "processing" | "review" | "decision"

export interface ScreenState {
  screen: Screen
  /** The item the screen is about (the selected one), or null in intake. */
  item: ReviewItem | null
  /** True once the selected item has a result or has errored. */
  resolved: boolean
  /** True when more than one label is in the queue (batch run). */
  isBatch: boolean
}

/**
 * Map the session onto a single screen. For batch runs the screen reflects the
 * SELECTED item; the queue stays accessible from review/processing (a flyout in
 * a later step). Rules:
 *   intake     — no items yet
 *   processing — busy and the selected item has not resolved yet
 *   review     — selected item has a result (or errored) and no decision
 *   decision   — selected item carries a human decision
 */
export function deriveScreenState(session: ReviewSession): ScreenState {
  const { items, selected, busy } = session
  const isBatch = items.length > 1
  const resolved = !!selected?.result || selected?.status === "error"

  let screen: Screen
  if (items.length === 0) {
    screen = "intake"
  } else if (selected?.decision) {
    screen = "decision"
  } else if (resolved) {
    screen = "review"
  } else if (busy || selected?.status === "working" || selected?.status === "queued") {
    // Selected label has nothing resolved yet — still verifying (single) or
    // waiting its turn in a batch that is mid-run.
    screen = "processing"
  } else {
    // Fallback: an item exists but is neither resolved nor in flight (e.g. a
    // rehydrated queue before re-run). Treat as review so its verdict/notes show.
    screen = "review"
  }

  return { screen, item: selected, resolved, isBatch }
}
