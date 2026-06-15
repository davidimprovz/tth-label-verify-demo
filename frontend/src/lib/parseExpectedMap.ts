// Parse + validate an imported `expected_map.json` for batch verification. The
// map keys each uploaded *filename* → an ExpectedFields object (or a list, for
// same-named files in submission order) — EXACTLY the shape the backend
// /api/verify/batch endpoint consumes (see backend _resolve_expected). We
// validate client-side against the actual uploaded filenames so the reviewer
// gets a friendly pre-submit error instead of a raw 422.

import { coerceBool } from "./parseExpected"
import type { BeverageType, ExpectedFields } from "./types"

/** A parsed map: filename → fields (single or per-occurrence list). */
export type ExpectedMap = Record<string, ExpectedFields | ExpectedFields[]>

export interface ParseMapResult {
  map?: ExpectedMap
  /** Hard parse/shape errors — block import entirely. */
  errors: string[]
}

const BEVERAGES: BeverageType[] = ["spirits", "wine", "beer"]

/** Coerce + validate one raw entry into a normalised ExpectedFields. */
function toFields(raw: unknown, where: string, errors: string[]): ExpectedFields | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${where}: each entry must be a JSON object of expected fields.`)
    return null
  }
  const o = raw as Record<string, unknown>
  const bevRaw = String(o.beverage_type ?? "").trim().toLowerCase()
  if (!BEVERAGES.includes(bevRaw as BeverageType)) {
    errors.push(`${where}: beverage_type "${bevRaw}" must be spirits|wine|beer.`)
    return null
  }
  const str = (k: string) => (o[k] == null ? "" : String(o[k]))
  return {
    beverage_type: bevRaw as BeverageType,
    brand_name: str("brand_name"),
    class_type: str("class_type"),
    alcohol_content: str("alcohol_content"),
    net_contents: str("net_contents"),
    producer_name: str("producer_name"),
    producer_address: o.producer_address == null ? null : String(o.producer_address),
    country_of_origin: o.country_of_origin == null ? null : String(o.country_of_origin),
    is_import: coerceBool(o.is_import),
  }
}

/**
 * Parse the raw JSON text of an imported expected_map. Validates the top-level
 * shape (object of filename → fields | fields[]) and each entry's fields. Does
 * NOT check it against the uploaded files — that's `matchExpectedMap`.
 */
export function parseExpectedMapText(text: string): ParseMapResult {
  const trimmed = text.trim()
  if (!trimmed) return { errors: ["The imported file is empty."] }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : "parse error"}`] }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { errors: ["Expected a JSON object mapping each filename to its expected fields."] }
  }

  const errors: string[] = []
  const map: ExpectedMap = {}
  for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(entry)) {
      const list: ExpectedFields[] = []
      entry.forEach((item, i) => {
        const f = toFields(item, `"${name}"[${i}]`, errors)
        if (f) list.push(f)
      })
      map[name] = list
    } else {
      const f = toFields(entry, `"${name}"`, errors)
      if (f) map[name] = f
    }
  }
  if (errors.length) return { errors }
  return { map, errors: [] }
}

/** How an imported map lines up against the actually-uploaded files. */
export interface MapMatch {
  /** Filenames present in BOTH the uploads and the map. */
  matched: string[]
  /** Uploaded filenames with NO entry in the map (would 422 on submit). */
  unmatched: string[]
  /** Map keys not present among the uploads (harmless, surfaced as info). */
  extra: string[]
  /** Per-name list/count mismatch messages (more uploads than list entries). */
  countErrors: string[]
  /** True when every uploaded file is graded by the map. */
  ok: boolean
}

/**
 * Match a parsed map against the uploaded files' names. Mirrors the backend's
 * resolution rules: every uploaded filename must have an entry; a list-valued
 * entry must hold at least as many items as there are uploads of that name.
 */
export function matchExpectedMap(files: File[], map: ExpectedMap): MapMatch {
  const uploadCounts: Record<string, number> = {}
  for (const f of files) uploadCounts[f.name] = (uploadCounts[f.name] ?? 0) + 1

  const matched: string[] = []
  const unmatched: string[] = []
  const countErrors: string[] = []

  for (const [name, count] of Object.entries(uploadCounts)) {
    const entry = map[name]
    if (entry === undefined) {
      unmatched.push(name)
      continue
    }
    if (Array.isArray(entry) && entry.length < count) {
      countErrors.push(
        `"${name}": ${count} file(s) uploaded but only ${entry.length} expected-fields entr${entry.length === 1 ? "y" : "ies"}.`,
      )
      continue
    }
    matched.push(name)
  }

  const extra = Object.keys(map).filter((k) => uploadCounts[k] === undefined)

  return {
    matched,
    unmatched,
    extra,
    countErrors,
    ok: unmatched.length === 0 && countErrors.length === 0,
  }
}
