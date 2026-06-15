import type { ExpectedFields } from "./types"

/**
 * Expected fields for the bundled demo label (public/sample-label.png), which
 * is a copy of the backend's synthetic test fixture. Values match exactly so a
 * one-click "Try the sample" run resolves to a clean PASS without any upload.
 */
export const SAMPLE_EXPECTED: ExpectedFields = {
  beverage_type: "spirits",
  brand_name: "RIVERSTONE RESERVE",
  class_type: "Kentucky Straight Bourbon Whiskey",
  alcohol_content: "45% Alc./Vol. (90 Proof)",
  net_contents: "750 mL",
  producer_name: "Riverstone Distilling Co.",
  producer_address: "Louisville, Kentucky",
  country_of_origin: null,
  is_import: false,
}

export const SAMPLE_IMAGE_URL = "/sample-label.png"
export const SAMPLE_FILENAME = "sample-label.png"

/** Fetch the bundled sample image as a File so it can be POSTed like an upload. */
export async function loadSampleFile(): Promise<File> {
  const res = await fetch(SAMPLE_IMAGE_URL)
  const blob = await res.blob()
  return new File([blob], SAMPLE_FILENAME, { type: blob.type || "image/png" })
}
