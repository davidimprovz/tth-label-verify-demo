// Review-session domain helpers shared across components: queue item shape,
// rejection-reason prefill, and decision state.

import type { ExpectedFields, FieldResult, VerificationResult } from "./types"
import { IMAGE_QUALITY_FIELD, fieldLabel } from "./types"

export type ItemStatus = "queued" | "working" | "pass" | "review" | "fail" | "error"

/** Reviewer's human-in-the-loop decision for a label. */
export type Decision = "accepted" | "rejected" | undefined

/** One label under review — single mode has exactly one; batch has many. */
export interface ReviewItem {
  id: string
  filename: string
  /** Object URL for the label image preview (revoked on teardown). */
  imageUrl: string
  /**
   * The original uploaded image bytes, retained in memory so the label can be
   * re-verified against edited expected fields without a re-upload. Not
   * serialized — a File cannot survive a reload, so a rehydrated item has none
   * (and re-verify is disabled until the image is re-attached).
   */
  file?: File
  status: ItemStatus
  result?: VerificationResult
  /** Reviewer decision + notes (persisted per item across selection changes). */
  decision: Decision
  rejectionReason: string
  notes: string
  /** True once the reviewer has edited the prefilled rejection reason. */
  reasonTouched: boolean
  /**
   * True when the item was rehydrated from sessionStorage and its image (an
   * object URL / File) did not survive the reload. The UI can surface a
   * "re-attach image" affordance; the verdict, reason, and notes still render.
   */
  needsImage?: boolean
  /** True while the async VLM refinement phase is in flight (UI shows a cue). */
  refining?: boolean
}

/**
 * The at-a-glance call for the reviewer, derived from the verdict. An overall
 * "pass" recommends Accept; anything else (review / fail / error / unresolved)
 * recommends manual Review. Tone drives the banner color-coding.
 */
export type Recommendation = {
  kind: "accept" | "review"
  label: string
  tone: "green" | "amber" | "red"
}

export function deriveRecommendation(item: ReviewItem | null): Recommendation | null {
  if (!item) return null
  const resolved = !!item.result || item.status === "error"
  if (!resolved) return null
  if (item.status === "error" || item.status === "fail") {
    return { kind: "review", label: "Recommended: Review", tone: "red" }
  }
  if (item.result?.overall === "pass") {
    return { kind: "accept", label: "Recommended: Accept", tone: "green" }
  }
  return { kind: "review", label: "Recommended: Review", tone: "amber" }
}

/** Map a backend overall/status string onto the queue item status. */
export function toItemStatus(s: string): ItemStatus {
  if (s === "pass") return "pass"
  if (s === "review") return "review"
  if (s === "fail") return "fail"
  if (s === "error") return "error"
  return "working"
}

/** The auto-triage image-quality field, if the result carries one. */
export function imageQualityField(
  result: VerificationResult | undefined,
): FieldResult | undefined {
  return result?.fields.find((f) => f.field === IMAGE_QUALITY_FIELD)
}

/** Fields that are not the image-quality pseudo-field, for the comparison rows. */
export function gradedFields(result: VerificationResult | undefined): FieldResult[] {
  if (!result) return []
  return result.fields.filter((f) => f.field !== IMAGE_QUALITY_FIELD)
}

/** Field keys carried as plain text values on the expected-fields form. */
const EXPECTED_TEXT_KEYS = [
  "brand_name",
  "class_type",
  "alcohol_content",
  "net_contents",
  "producer_name",
  "producer_address",
  "country_of_origin",
] as const

/**
 * Reconstruct an editable ExpectedFields record from a graded result so the
 * "Application data" pane can seed its form with what was originally submitted.
 * The result only carries each field's expected text (not beverage_type), so
 * those default to a spirits/non-import baseline; country_of_origin presence
 * implies an import.
 */
export function expectedFromResult(
  result: VerificationResult | undefined,
): ExpectedFields {
  const byKey = new Map((result?.fields ?? []).map((f) => [f.field, f.expected]))
  const text = (k: (typeof EXPECTED_TEXT_KEYS)[number]) => byKey.get(k) ?? ""
  const country = text("country_of_origin")
  return {
    beverage_type: "spirits",
    brand_name: text("brand_name"),
    class_type: text("class_type"),
    alcohol_content: text("alcohol_content"),
    net_contents: text("net_contents"),
    producer_name: text("producer_name"),
    producer_address: text("producer_address") || null,
    country_of_origin: country || null,
    is_import: !!country,
  }
}

/**
 * Build a rejection-reason draft from the failing / review checks so the
 * reviewer starts from a populated, editable summary rather than a blank box.
 */
export function buildRejectionReason(result: VerificationResult | undefined): string {
  if (!result) return ""
  const problems = result.fields.filter(
    (f) => f.status === "fail" || f.status === "review",
  )
  if (problems.length === 0) return ""
  const lines = problems.map((f) => {
    const label = fieldLabel(f.field)
    const base = `• ${label}: ${f.reason}`
    if (f.expected != null && f.found != null && f.field !== IMAGE_QUALITY_FIELD) {
      return `${base} (expected “${f.expected}”, found “${f.found || "—"}”)`
    }
    return base
  })
  return `Label flagged for the following ${problems.length === 1 ? "issue" : "issues"}:\n${lines.join("\n")}`
}
