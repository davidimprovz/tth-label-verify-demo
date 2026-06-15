// Option lists for the expected-data selectors (Net Contents + Country of
// Origin). Both selectors offer these as a dropdown and fall back to a typed
// custom value, so any value the registry might carry is still enterable.

import type { ExpectedFields } from "./types"

// Per-field input length caps. MUST mirror the backend (ExpectedFields in
// backend/models/verification.py) so the client and server agree on bounds.
export const FIELD_MAX_LENGTHS: Record<string, number> = {
  brand_name: 200,
  class_type: 200,
  alcohol_content: 60,
  net_contents: 60,
  producer_name: 200,
  producer_address: 300,
  country_of_origin: 200,
}

/** Cap for the OCR box-tag input (a short field key). */
export const OCR_TAG_MAX_LENGTH = 40

/** Trim and clamp a field value to its cap before submit/storage. */
export function clampField(key: string, value: string): string {
  const max = FIELD_MAX_LENGTHS[key]
  const trimmed = value.trim()
  return max ? trimmed.slice(0, max) : trimmed
}

/**
 * Build a verify-ready ExpectedFields payload: trim + length-clamp every text
 * field (mirroring the backend caps) and normalize empty/optional fields. Used
 * by both the intake form and the "Edit data" re-verify form before submit.
 */
export function sanitizeExpected(value: ExpectedFields): ExpectedFields {
  const address = clampField("producer_address", value.producer_address ?? "")
  const country = clampField("country_of_origin", value.country_of_origin ?? "")
  return {
    ...value,
    brand_name: clampField("brand_name", value.brand_name),
    class_type: clampField("class_type", value.class_type),
    alcohol_content: clampField("alcohol_content", value.alcohol_content),
    net_contents: clampField("net_contents", value.net_contents),
    producer_name: clampField("producer_name", value.producer_name),
    producer_address: address || null,
    country_of_origin: value.is_import ? country || null : null,
  }
}

/**
 * TTB standards of fill — the authorized container sizes for wine
 * (27 CFR 4.72) and distilled spirits (27 CFR 5.47a), unioned with the common
 * malt-beverage sizes. Ordered smallest → largest within each unit group so the
 * dropdown reads naturally. A typed custom value covers anything off-list.
 */
export const NET_CONTENTS_OPTIONS: string[] = [
  "50 mL",
  "100 mL",
  "187 mL",
  "200 mL",
  "250 mL",
  "355 mL",
  "375 mL",
  "500 mL",
  "700 mL",
  "720 mL",
  "750 mL",
  "900 mL",
  "1 L",
  "1.5 L",
  "1.75 L",
  "1.8 L",
  "3 L",
  "12 fl oz",
  "16 fl oz",
  "22 fl oz",
  "24 fl oz",
  "32 fl oz",
]

/** Country names for the Country of Origin selector (imports). */
export const COUNTRY_OPTIONS: string[] = [
  "Argentina",
  "Australia",
  "Austria",
  "Belgium",
  "Brazil",
  "Bulgaria",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Croatia",
  "Cuba",
  "Czech Republic",
  "Denmark",
  "Dominican Republic",
  "Ecuador",
  "England",
  "Finland",
  "France",
  "Georgia",
  "Germany",
  "Greece",
  "Guatemala",
  "Hungary",
  "Iceland",
  "India",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Lebanon",
  "Mexico",
  "Moldova",
  "Netherlands",
  "New Zealand",
  "Nicaragua",
  "Norway",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Puerto Rico",
  "Romania",
  "Russia",
  "Scotland",
  "Slovakia",
  "Slovenia",
  "South Africa",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Taiwan",
  "Thailand",
  "Trinidad and Tobago",
  "Turkey",
  "Ukraine",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Venezuela",
  "Vietnam",
  "Wales",
]
