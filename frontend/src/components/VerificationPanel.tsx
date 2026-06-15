import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ImageOff, ListChecks, FilePenLine, ChevronLeft, ChevronRight, Activity, ChevronDown, ScanText, Loader2 } from "lucide-react"
import type { ReviewItem } from "../lib/review"
import { gradedFields, imageQualityField } from "../lib/review"
import { GOVERNMENT_WARNING_FIELD } from "../lib/types"
import { ProgressBar } from "./ProgressBar"
import { VerdictOverlay } from "./VerdictOverlay"
import { ImageNoteLayer } from "./ImageNoteLayer"
import { OcrBoxOverlay } from "./OcrBoxOverlay"
import type { ReviewSession } from "../lib/useReviewSession"

// Illustrative pipeline steps shown as timed cues while a verify is in flight.
// The backend resolves in <1s, so these advance on a short timer rather than
// real per-step signals.
const VERIFY_STEPS = [
  "Conditioning image",
  "Reading label text",
  "Matching fields",
  "Verifying Government Warning",
] as const

/**
 * The review surface (design §2, step 6). A centered label image with the
 * verdict mark overlaid; a plain Edit-data / Details button row sits beneath it
 * (the verdict + latency/tier/counts metadata now lives in the decision header).
 * The detailed field comparison, Government Warning card, and image-quality
 * triage banner live in an on-demand Details flyout, opened by the in-panel
 * button or the `D` hotkey (state lifted to App).
 */
export function VerificationPanel({
  item,
  session,
  onDetailsChange,
  onAppDataChange,
  noteOpen = false,
  onNoteOpenChange,
  isBatch = false,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
  hideVerifying = false,
}: {
  item: ReviewItem | null
  session?: ReviewSession
  /** Opens the Details pane (rendered by App as a flanking SidePane/Flyout). */
  onDetailsChange?: (open: boolean) => void
  /** Opens the left "Application data" pane (edit expected fields + re-verify). */
  onAppDataChange?: (open: boolean) => void
  noteOpen?: boolean
  onNoteOpenChange?: (open: boolean) => void
  isBatch?: boolean
  /** Batch prev/next navigation, surfaced as large arrows flanking the image. */
  onPrev?: () => void
  onNext?: () => void
  canPrev?: boolean
  canNext?: boolean
  /** Suppress the in-panel "Verifying…" cue (progress shown at the top instead). */
  hideVerifying?: boolean
}) {
  // Technical inference metrics (latency, OCR tier) stay hidden until clicked —
  // a discreet disclosure below the image rather than always-on chrome.
  const [metricsOpen, setMetricsOpen] = useState(false)
  // OCR box overlay: visibility toggle + per-box field tags. Tags reset when the
  // reviewed item changes (keyed on item id below).
  const [showBoxes, setShowBoxes] = useState(false)
  const [boxTags, setBoxTags] = useState<Record<number, string>>({})
  const itemId = item?.id
  useEffect(() => {
    setBoxTags({})
    setShowBoxes(false)
  }, [itemId])
  if (!item) return <EmptyState />

  const result = item.result
  const ocrBoxes = result?.ocr_boxes ?? null
  const working = item.status === "working"
  const verdict = result?.overall
  const resolved = !!result || item.status === "error"

  // The image FRAME carries the at-a-glance signal. Once the reviewer has
  // decided, the frame matches their action (green Accept / red Reject); before
  // that it matches the recommendation tone (green pass, amber review, red
  // fail/error) for continuity with the header.
  const frameTint =
    item.decision === "accepted"
      ? "border-green-bright bg-[rgba(31,164,92,0.12)]"
      : item.decision === "rejected"
        ? "border-red bg-[rgba(179,64,47,0.12)]"
        : !resolved
          ? "border-gold/35 bg-black/30"
          : item.status === "error" || item.status === "fail"
            ? "border-red bg-[rgba(179,64,47,0.10)]"
            : verdict === "pass"
              ? "border-green-bright bg-[rgba(31,164,92,0.10)]"
              : "border-amber bg-[rgba(217,154,43,0.10)]"

  const warning = result?.fields.find((f) => f.field === GOVERNMENT_WARNING_FIELD)
  const triage = imageQualityField(result)
  const rows = gradedFields(result).filter((f) => f.field !== GOVERNMENT_WARNING_FIELD)

  const hasDetails =
    resolved && (rows.length > 0 || !!warning || !!triage || item.status === "error")

  const openDetails = () => onDetailsChange?.(true)
  const openAppData = () => onAppDataChange?.(true)
  // The edit/re-verify pane only makes sense when this panel owns the session
  // (the review surface), not the read-only processing preview.
  const canEditData = !!session && !!onAppDataChange && resolved

  return (
    <div className="flex h-full flex-col items-center gap-4 overflow-y-auto p-5">
      {/* Label image with the verdict mark overlaid; zoom-on-hover preserved. */}
      <div className="w-full max-w-xl">
        <p className="mb-2 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-gold/70">
          Submitted label
        </p>
        {/* Phase-2 cue: a deep read (Government Warning + weak fields) is in
            flight; the verdict will refine itself in place when it lands. */}
        {item.refining && (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-lg border-2 border-infoblue/40 bg-[rgba(58,124,165,0.10)] px-3 py-1.5">
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-infoblue" />
            <span className="font-sans text-xs font-semibold text-infoblue" aria-live="polite">
              Deep-checking the Government Warning…
            </span>
          </div>
        )}
        <div
          className={[
            "group relative overflow-hidden rounded-xl border-4 p-2 transition-colors duration-500",
            frameTint,
          ].join(" ")}
        >
          <div className={working ? "shimmer-scan rounded-lg" : ""}>
            {item.needsImage || !item.imageUrl ? (
              // Session was restored from sessionStorage (the verdict/notes
              // survive a reload, but object URLs do not) — prompt a re-attach
              // instead of rendering a broken image.
              <div className="mx-auto flex min-h-[240px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gold/30 px-4 py-8 text-center">
                <ImageOff aria-hidden className="h-7 w-7 text-parchment/40" />
                <p className="font-sans text-sm text-parchment/70">
                  Image not retained across reload
                </p>
                <p className="font-mono text-[11px] text-parchment/45">
                  The verdict and notes are intact — re-upload {item.filename} to view it again.
                </p>
              </div>
            ) : (
              // Always the overlay (even with no boxes yet) so the <img> element
              // is stable across the processing→review transition — it never
              // remounts/reloads, so the image holds steady while only the
              // progress bar and recommendation animate.
              <OcrBoxOverlay
                src={item.imageUrl}
                alt={`Label: ${item.filename}`}
                boxes={ocrBoxes ?? []}
                show={showBoxes}
                interactive={!!session}
                tags={boxTags}
                onTagsChange={setBoxTags}
              />
            )}
          </div>
          {/* Verdict mark over the image — appears on resolve then fades itself
              out (the tinted frame + corner pill carry the signal after). */}
          {!item.needsImage && item.imageUrl && <VerdictOverlay item={item} />}

          {/* On-image controls reveal only on hover/focus, so the label stays
              fully visible at rest. The note editor, once OPEN, stays visible
              regardless (forced via opacity) so typing isn't interrupted. */}
          {/* On-image note affordance — top-left. */}
          {session && onNoteOpenChange && (
            <div
              className={[
                "absolute inset-0 z-10 transition-opacity duration-200",
                "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                noteOpen ? "!opacity-100" : "",
              ].join(" ")}
            >
              <ImageNoteLayer
                item={item}
                session={session}
                open={noteOpen}
                onOpenChange={onNoteOpenChange}
              />
            </div>
          )}

          {/* Large prev/next arrows for batch — flank the image, reveal on hover. */}
          {isBatch && onPrev && onNext && (
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-10 flex items-center justify-between px-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
              <NavArrow dir="prev" onClick={onPrev} disabled={!canPrev} />
              <NavArrow dir="next" onClick={onNext} disabled={!canNext} />
            </div>
          )}
          {/* The Accept/Reject buttons live in the top header (RecommendationBanner),
              never over the image — only the verdict mark + note affordance here. */}
        </div>
        <p className="mt-1.5 truncate text-center font-mono text-[11px] text-parchment/50">
          {item.filename}
        </p>
        {ocrBoxes && ocrBoxes.length > 0 && (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setShowBoxes((s) => !s)}
              aria-pressed={showBoxes}
              className={[
                "inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 font-sans text-sm font-semibold transition-colors",
                showBoxes
                  ? "border-gold bg-[rgba(200,169,81,0.18)] text-gold"
                  : "border-gold/40 bg-[rgba(200,169,81,0.06)] text-gold-soft hover:bg-[rgba(200,169,81,0.14)]",
              ].join(" ")}
            >
              <ScanText aria-hidden className="h-4 w-4" />
              {showBoxes ? "Hide" : "Show"} text boxes
              <span className="font-mono text-[11px] text-parchment/55">({ocrBoxes.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* While a single verify is in flight (no result yet), show the stepped
          "Verifying…" cue beneath the image in place of the summary. */}
      {working && !verdict && !hideVerifying ? (
        <div className="w-full max-w-xl">
          <VerifyingState />
        </div>
      ) : resolved ? (
        <div className="w-full max-w-xl">
          {/* Plain button row — Edit data (left) and Details (right), no card
              chrome. The verdict itself is conveyed by the recommendation header
              and the on-image mark; its latency/tier/counts metadata now lives
              under "Recommended:" in the decision header. */}
          {(canEditData || hasDetails) && (
            <div className="flex items-center justify-between gap-2">
              {canEditData ? (
                <button
                  type="button"
                  onClick={openAppData}
                  className="inline-flex items-center gap-2 rounded-lg border-2 border-gold/45 bg-[rgba(200,169,81,0.08)] px-3.5 py-2 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.16)]"
                >
                  <FilePenLine aria-hidden className="h-4 w-4" /> Edit data
                  <kbd className="ml-1 rounded border border-gold/40 px-1.5 py-0.5 font-mono text-[10px] text-gold-soft">
                    E
                  </kbd>
                </button>
              ) : (
                <span />
              )}
              {hasDetails && (
                <button
                  type="button"
                  onClick={openDetails}
                  className="inline-flex items-center gap-2 rounded-lg border-2 border-gold/45 bg-[rgba(200,169,81,0.08)] px-3.5 py-2 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.16)]"
                >
                  <ListChecks aria-hidden className="h-4 w-4" /> Details
                  <kbd className="ml-1 rounded border border-gold/40 px-1.5 py-0.5 font-mono text-[10px] text-gold-soft">
                    D
                  </kbd>
                </button>
              )}
            </div>
          )}

          {/* Inference metrics — hidden behind a click (discreet, below the
              image). Reveals OCR latency + tier on demand. */}
          {result && (result.latency_ms != null || result.tier_used) && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setMetricsOpen((o) => !o)}
                aria-expanded={metricsOpen}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-parchment/45 transition-colors hover:text-parchment/75"
              >
                <Activity aria-hidden className="h-3.5 w-3.5" />
                Inference details
                <ChevronDown
                  aria-hidden
                  className={["h-3.5 w-3.5 transition-transform", metricsOpen ? "rotate-180" : ""].join(" ")}
                />
              </button>
              {metricsOpen && (
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-[11px] text-parchment/60">
                  <span>Latency: {result.latency_ms ?? 0} ms</span>
                  <span>OCR tier: {result.tier_used ?? "—"}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
      {/* The Details + Application-data panes are rendered by App as flanking
          SidePanes (or a Flyout on narrow screens) beside the image, so they
          never overlay it. This panel only owns the toggle buttons + the image. */}
    </div>
  )
}

/**
 * In-flight single-verify cue: indeterminate progress bar + stepped pipeline
 * status text that advances on a short timer. Steps are announced via
 * aria-live="polite" so screen readers track progress.
 */
function VerifyingState() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    // Advance through the steps, holding on the last one until the result
    // arrives and this component unmounts.
    const id = setInterval(() => {
      setStep((s) => (s < VERIFY_STEPS.length - 1 ? s + 1 : s))
    }, 220)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full border border-gold/30 bg-[rgba(200,169,81,0.08)]">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-gold" />
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/70">
            Overall verdict
          </p>
          <p className="engraved font-display text-2xl font-semibold leading-tight text-parchment/80">
            Verifying…
          </p>
        </div>
      </div>

      <div className="mt-4">
        <ProgressBar indeterminate label="Verifying label" />
      </div>

      <div className="mt-3 h-5" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-infoblue"
          >
            {VERIFY_STEPS[step]}…
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Large circular prev/next control flanking the image (batch navigation). */
function NavArrow({
  dir,
  onClick,
  disabled,
}: {
  dir: "prev" | "next"
  onClick: () => void
  disabled: boolean
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous label" : "Next label"}
      className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full border-2 border-gold/45 bg-navy-900/70 text-gold-soft shadow-[0_8px_24px_-8px_rgba(0,0,0,0.85)] backdrop-blur-md transition-all hover:scale-105 hover:border-gold/80 hover:text-gold disabled:pointer-events-none disabled:opacity-25"
    >
      <Icon aria-hidden className="h-6 w-6" />
    </button>
  )
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid h-full place-items-center p-8 text-center"
    >
      <div className="max-w-sm">
        <ImageOff aria-hidden className="mx-auto h-10 w-10 text-gold/40" />
        <h2 className="mt-4 font-display text-xl font-semibold text-parchment/80">
          No label under review
        </h2>
        <p className="mt-2 font-sans text-sm leading-relaxed text-parchment/55">
          Upload a label and its expected application data to begin.
        </p>
      </div>
    </motion.div>
  )
}
