// Metadata-only session persistence. Round-trips review items through
// sessionStorage so decisions/notes/results survive a reload within a tab.
//
// Object URLs and File handles do NOT survive a full reload, so `imageUrl` is
// never persisted. Rehydrated items come back with `needsImage: true` so the UI
// can offer a "re-attach image" affordance (the bundled sample re-loads free).

import type { Decision, ItemStatus, ReviewItem } from "./review"
import type { ExpectedFields, VerificationResult } from "./types"
import { SAMPLE_FILENAME, SAMPLE_IMAGE_URL } from "./sample"

/** Shared sessionStorage namespace — see Splash.tsx's "ttb.splashSeen". */
const SESSION_KEY = "ttb.session"
/** Intake form draft — survives an accidental refresh on the upload screen. */
const DRAFT_KEY = "ttb.intakeDraft"

/** The persisted shape of one item (everything except the volatile image). */
interface PersistedItem {
  id: string
  filename: string
  status: ItemStatus
  result?: VerificationResult
  decision: Decision
  rejectionReason: string
  notes: string
  reasonTouched: boolean
}

interface PersistedSession {
  items: PersistedItem[]
  selectedId: string | null
}

/** Strip the volatile image fields, keeping only serializable review metadata. */
function toPersisted(it: ReviewItem): PersistedItem {
  return {
    id: it.id,
    filename: it.filename,
    status: it.status,
    result: it.result,
    decision: it.decision,
    rejectionReason: it.rejectionReason,
    notes: it.notes,
    reasonTouched: it.reasonTouched,
  }
}

/** Persist items (minus image/File) and the selection to sessionStorage. */
export function saveSession(items: ReviewItem[], selectedId: string | null) {
  try {
    if (items.length === 0) {
      sessionStorage.removeItem(SESSION_KEY)
      return
    }
    const payload: PersistedSession = {
      items: items.map(toPersisted),
      selectedId,
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload))
  } catch {
    // Storage unavailable / quota exceeded — skip persistence silently.
  }
}

/**
 * Load a previously persisted session, rehydrating each item without its image.
 * The bundled sample keeps a usable static `imageUrl`; every other item is
 * marked `needsImage` so the UI can prompt a re-attach. Returns null when there
 * is nothing to restore.
 */
export function loadSession(): { items: ReviewItem[]; selectedId: string | null } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedSession
    if (!parsed?.items?.length) return null

    const items: ReviewItem[] = parsed.items.map((p) => {
      const isSample = p.filename === SAMPLE_FILENAME
      return {
        id: p.id,
        filename: p.filename,
        // Sample image is a static asset and re-loads for free; others lost
        // their object URL on reload.
        imageUrl: isSample ? SAMPLE_IMAGE_URL : "",
        status: p.status,
        result: p.result,
        decision: p.decision,
        rejectionReason: p.rejectionReason,
        notes: p.notes,
        reasonTouched: p.reasonTouched,
        needsImage: !isSample,
      }
    })

    return { items, selectedId: parsed.selectedId ?? items[0]?.id ?? null }
  } catch {
    // Corrupt / unavailable storage — start fresh.
    return null
  }
}

/** Clear any persisted session (e.g. on an explicit reset). */
export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

/**
 * Persist the intake form draft so an accidental refresh on the upload screen
 * doesn't wipe entered application data. Staged files can't be serialized, so
 * only the expected-fields form is kept.
 */
export function saveIntakeDraft(expected: ExpectedFields) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(expected))
  } catch {
    // Storage unavailable / quota exceeded — skip silently.
  }
}

/** Load a previously persisted intake draft, or null when none/corrupt. */
export function loadIntakeDraft(): ExpectedFields | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ExpectedFields
  } catch {
    return null
  }
}

/** Clear the intake draft — on submit, new verification, or cancel. */
export function clearIntakeDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
