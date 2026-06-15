import { useEffect, useState } from "react"
import { X } from "lucide-react"

/**
 * Thumbnail strip of the images staged for verification. Confirms uploads
 * actually landed (the dropzone otherwise gives no visual feedback) and lets the
 * reviewer remove any file before submitting. Object URLs are created per render
 * pass of the file list and revoked when it changes, so there's no leak.
 */
export function StagedFiles({
  files,
  onRemove,
}: {
  files: File[]
  onRemove: (index: number) => void
}) {
  const [urls, setUrls] = useState<string[]>([])

  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f))
    setUrls(next)
    return () => next.forEach((u) => URL.revokeObjectURL(u))
  }, [files])

  return (
    <div className="mt-4">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold/75">
        {files.length} {files.length === 1 ? "image" : "images"} ready
      </p>
      <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {files.map((file, i) => (
          <li
            key={`${file.name}:${file.size}:${i}`}
            className="group relative aspect-square overflow-hidden rounded-lg border-2 border-white/15 bg-black/30"
          >
            {urls[i] ? (
              <img src={urls[i]} alt={file.name} className="h-full w-full object-cover" />
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${file.name}`}
              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full border-2 border-white/30 bg-navy-900/85 text-parchment/80 opacity-0 transition-opacity hover:border-red hover:text-red focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
            <span className="absolute inset-x-0 bottom-0 truncate bg-navy-900/80 px-1.5 py-1 font-mono text-[9px] text-parchment/75">
              {file.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
