// Wire types mirroring the backend contract (backend/models/verification.py).

export type BeverageType = "spirits" | "wine" | "beer"

/** Per-field verdict status. Backend may also emit "error" inside batch events. */
export type Status = "pass" | "review" | "fail"

/** Application-supplied field values to verify against the label. */
export interface ExpectedFields {
  beverage_type: BeverageType
  brand_name: string
  class_type: string
  alcohol_content: string
  net_contents: string
  producer_name: string
  producer_address?: string | null
  country_of_origin?: string | null
  is_import: boolean
}

/** Verdict for a single field check. */
export interface FieldResult {
  field: string
  status: Status
  confidence: number
  expected: string | null
  found: string | null
  reason: string
}

/** A single OCR text box in ORIGINAL-image pixel coordinates (for the overlay). */
export interface OcrBox {
  /** Quad corners [[x, y], ...], clockwise from top-left, in original pixels. */
  points: [number, number][]
  text: string
  confidence: number | null
}

/** Aggregate verdict across all graded fields. */
export interface VerificationResult {
  overall: "pass" | "review"
  fields: FieldResult[]
  latency_ms: number | null
  tier_used: string | null
  ocr_boxes?: OcrBox[] | null
}

/** One SSE event from the batch stream as a label completes. */
export interface BatchItemEvent {
  id: string
  filename: string
  status: Status | "error"
  result: VerificationResult | { error: string }
}

/** Terminal SSE event once every label has finished. */
export interface BatchDoneEvent {
  done: true
  count: number
  total: number
}

/** The synthetic pseudo-field surfaced by the auto-triage hook. */
export const IMAGE_QUALITY_FIELD = "image_quality"

/** The hero field — the Government Warning verbatim-match check. */
export const GOVERNMENT_WARNING_FIELD = "government_warning"

/** Human-readable labels for the canonical field keys. */
export const FIELD_LABELS: Record<string, string> = {
  brand_name: "Brand Name",
  class_type: "Class / Type",
  alcohol_content: "Alcohol Content",
  net_contents: "Net Contents",
  producer_name: "Producer / Bottler",
  producer_address: "Producer Address",
  country_of_origin: "Country of Origin",
  government_warning: "Government Warning",
  image_quality: "Image Quality",
}

export function fieldLabel(field: string): string {
  return (
    FIELD_LABELS[field] ??
    field
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  )
}
