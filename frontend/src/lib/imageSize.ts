// Client-side image-dimension check so an under-resolution upload is flagged
// immediately, rather than only surfacing after the backend rejects it.
//
// Mirrors the backend intake floor (TTB_MIN_IMAGE_LONG_EDGE, default 640): an
// image whose long edge is below this is too small to verify reliably.

export const MIN_IMAGE_LONG_EDGE = 640

/**
 * Measure an image file's longest edge (px) in the browser. Resolves 0 if the
 * file can't be decoded as an image, so callers can choose not to block on it.
 */
export function measureLongEdge(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(Math.max(img.naturalWidth, img.naturalHeight))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    img.src = url
  })
}

/** Stable key for a staged file (name+size), matching IntakeScreen's dedupe. */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}`
}
