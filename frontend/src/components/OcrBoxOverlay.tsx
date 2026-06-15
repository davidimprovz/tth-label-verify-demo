import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { OcrBox } from "../lib/types"
import { fieldLabel } from "../lib/types"
import { OCR_TAG_MAX_LENGTH } from "../lib/fieldOptions"

/** Field keys offered as quick-tag suggestions when labeling a box. */
const FIELD_SUGGESTIONS = [
  "brand_name",
  "class_type",
  "alcohol_content",
  "net_contents",
  "producer_name",
  "producer_address",
  "country_of_origin",
  "government_warning",
] as const

/** Contain-fit transform: how natural-image pixels map into the rendered box. */
interface Fit {
  scale: number
  offsetX: number
  offsetY: number
  ready: boolean
}

/**
 * Renders the submitted label with the OCR text boxes overlaid and, optionally,
 * clickable for tagging. The image is shown with `object-contain`, so we derive
 * the contain-fit transform (scale + letterbox offset) from the image's natural
 * vs. rendered size and apply it to every box and editor — a single source of
 * truth that keeps boxes pinned to the text as the panel resizes.
 *
 * Clicking a box (when `interactive`) opens a small input to tag what the text
 * is (a field key like `brand_name`, with suggestions); the tag is stored via
 * `onTagsChange` so a later re-verify can feed the matcher.
 */
export function OcrBoxOverlay({
  src,
  alt,
  boxes,
  show,
  interactive = true,
  tags,
  onTagsChange,
}: {
  src: string
  alt: string
  boxes: OcrBox[]
  /** Whether the box layer is visible (toggled by the reviewer). */
  show: boolean
  /** Whether boxes are clickable for tagging. */
  interactive?: boolean
  /** Box-index → field tag, owned by the parent so it survives re-renders. */
  tags?: Record<number, string>
  onTagsChange?: (tags: Record<number, string>) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [fit, setFit] = useState<Fit>({ scale: 1, offsetX: 0, offsetY: 0, ready: false })
  // Which box is being edited (its tag input is open), or null.
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState("")

  // Recompute the contain-fit transform from the image's natural size and its
  // current rendered box. Runs on load and whenever the element resizes.
  const measure = useCallback(() => {
    const img = imgRef.current
    if (!img || !img.naturalWidth || !img.naturalHeight) return
    const boxW = img.clientWidth
    const boxH = img.clientHeight
    const scale = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight)
    setFit({
      scale,
      offsetX: (boxW - img.naturalWidth * scale) / 2,
      offsetY: (boxH - img.naturalHeight * scale) / 2,
      ready: true,
    })
  }, [])

  useLayoutEffect(() => {
    const img = imgRef.current
    if (!img) return
    const ro = new ResizeObserver(measure)
    ro.observe(img)
    if (img.complete) measure()
    return () => ro.disconnect()
  }, [measure, src])

  const toDisplay = (x: number, y: number): [number, number] => [
    x * fit.scale + fit.offsetX,
    y * fit.scale + fit.offsetY,
  ]

  const commit = (idx: number, value: string) => {
    const next = { ...(tags ?? {}) }
    const v = value.trim().slice(0, OCR_TAG_MAX_LENGTH)
    if (v) next[idx] = v
    else delete next[idx]
    onTagsChange?.(next)
    setEditing(null)
    setDraft("")
  }

  const startEdit = (idx: number) => {
    if (!interactive) return
    setDraft(tags?.[idx] ?? "")
    setEditing(idx)
  }

  return (
    <div className="relative">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={measure}
        className="mx-auto max-h-[460px] w-full rounded-lg object-contain"
      />

      {show && fit.ready && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {boxes.map((b, i) => {
            const pts = b.points.map(([x, y]) => toDisplay(x, y).join(",")).join(" ")
            const tagged = !!tags?.[i]
            return (
              <polygon
                key={i}
                points={pts}
                className={[
                  interactive ? "pointer-events-auto cursor-pointer" : "",
                  "transition-colors",
                ].join(" ")}
                fill={tagged ? "rgba(31,164,92,0.18)" : "rgba(200,169,81,0.06)"}
                stroke={tagged ? "var(--green-bright)" : "var(--gold)"}
                strokeWidth={tagged ? 2.5 : 1.5}
                onClick={() => startEdit(i)}
              >
                <title>{b.text}</title>
              </polygon>
            )
          })}
        </svg>
      )}

      {/* Tag editor — a small input anchored at the box's top-left. */}
      {show && interactive && editing != null && boxes[editing] && (
        <BoxTagEditor
          anchor={toDisplay(boxes[editing].points[0][0], boxes[editing].points[0][1])}
          text={boxes[editing].text}
          value={draft}
          onChange={setDraft}
          onCommit={() => commit(editing, draft)}
          onCancel={() => {
            setEditing(null)
            setDraft("")
          }}
        />
      )}

      {/* Persisted tag chips, drawn at each tagged box. */}
      {show &&
        Object.entries(tags ?? {}).map(([k, v]) => {
          const idx = Number(k)
          const b = boxes[idx]
          if (!b || editing === idx) return null
          const [x, y] = toDisplay(b.points[0][0], b.points[0][1])
          return (
            <span
              key={k}
              style={{ left: x, top: y }}
              className="pointer-events-none absolute -translate-y-full rounded bg-green-bright px-1.5 py-0.5 font-mono text-[10px] font-bold text-navy-900 shadow"
            >
              {fieldLabel(v)}
            </span>
          )
        })}
    </div>
  )
}

/** Inline tag input with field-key suggestions, anchored over a box corner. */
function BoxTagEditor({
  anchor,
  text,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  anchor: [number, number]
  text: string
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const [x, y] = anchor
  return (
    <div
      style={{ left: x, top: y }}
      className="absolute z-20 w-56 -translate-y-full rounded-lg border-2 border-gold/50 bg-navy-900/95 p-2 shadow-xl backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-1 truncate font-mono text-[10px] text-parchment/60" title={text}>
        “{text}”
      </p>
      <input
        autoFocus
        list="ocr-field-suggestions"
        value={value}
        placeholder="Tag as field…"
        maxLength={OCR_TAG_MAX_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit()
          else if (e.key === "Escape") onCancel()
        }}
        className="w-full rounded border-2 border-gold/40 bg-black/40 px-2 py-1 font-sans text-sm text-parchment outline-none focus:border-gold"
      />
      <datalist id="ocr-field-suggestions">
        {FIELD_SUGGESTIONS.map((f) => (
          <option key={f} value={f}>
            {fieldLabel(f)}
          </option>
        ))}
      </datalist>
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 font-sans text-xs text-parchment/60 hover:text-parchment"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onCommit}
          className="rounded bg-gold px-2 py-0.5 font-sans text-xs font-bold text-navy-900 hover:bg-gold-bright"
        >
          Save
        </button>
      </div>
    </div>
  )
}
