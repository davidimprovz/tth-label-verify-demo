import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import {
  UploadCloud,
  Sparkles,
  Loader2,
  ChevronDown,
  AlertTriangle,
  X,
  FolderUp,
} from "lucide-react"
import type { ExpectedFields } from "../lib/types"
import type { ReviewSession } from "../lib/useReviewSession"
import { matchExpectedMap, type ExpectedMap } from "../lib/parseExpectedMap"
import { cn } from "../lib/cn"
import { loadIntakeDraft, saveIntakeDraft, clearIntakeDraft } from "../lib/persistSession"
import { measureLongEdge, fileKey, MIN_IMAGE_LONG_EDGE } from "../lib/imageSize"
import { sanitizeExpected } from "../lib/fieldOptions"
import { ExpectedFieldsForm, EMPTY_EXPECTED } from "./ExpectedFieldsForm"
import { BatchMapPanel } from "./BatchMapPanel"
import { StagedFiles } from "./StagedFiles"

/**
 * Intake surface — upload one or more label images and the expected application
 * data, then verify. Single vs. batch mode is chosen automatically by how many
 * images are staged (one → single, many → batch). The expected-data form draft
 * survives a refresh; staged files (and their bytes) cannot persist a reload.
 *
 * `onProvideOpen` lifts the dropzone's file-picker opener to the parent so the
 * `U` hotkey can trigger it. `onCancel` returns to the home screen.
 */
export function IntakeScreen({
  session,
  onProvideOpen,
  onCancel,
  expectedMap,
  mapFilename,
  onImportMap,
  onClearMap,
}: {
  session: ReviewSession
  onProvideOpen?: (open: () => void) => void
  onCancel?: () => void
  /** Imported per-label batch map (DECISION 3), parsed in App; null when none. */
  expectedMap?: ExpectedMap | null
  mapFilename?: string | null
  /** Open the JSON file picker (App owns the hidden input). */
  onImportMap?: () => void
  /** Discard the imported map. */
  onClearMap?: () => void
}) {
  // Restore the form draft from the prior session so an accidental refresh
  // doesn't wipe entered data (item: refresh-persistence).
  const [expected, setExpected] = useState<ExpectedFields>(() => loadIntakeDraft() ?? EMPTY_EXPECTED)
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [showForm, setShowForm] = useState(true)
  // Files whose long edge is below the 640px floor — flagged at upload time so
  // the reviewer learns before verifying, not after. Keyed by name+size.
  const [tooSmall, setTooSmall] = useState<Set<string>>(new Set())
  const measuredRef = useRef<Set<string>>(new Set())

  // Persist the form draft on every change (cleared on submit / new verification).
  useEffect(() => {
    saveIntakeDraft(expected)
  }, [expected])

  // Measure each newly-staged image and flag any below the 640px floor.
  useEffect(() => {
    const pending = files.filter((f) => !measuredRef.current.has(fileKey(f)))
    if (pending.length === 0) return
    let cancelled = false
    Promise.all(
      pending.map(async (f) => ({ key: fileKey(f), edge: await measureLongEdge(f) })),
    ).then((results) => {
      if (cancelled) return
      setTooSmall((prev) => {
        const next = new Set(prev)
        for (const { key, edge } of results) {
          measuredRef.current.add(key)
          if (edge > 0 && edge < MIN_IMAGE_LONG_EDGE) next.add(key)
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [files])

  const hasTooSmall = files.some((f) => tooSmall.has(fileKey(f)))

  // Append newly-selected/dropped files (deduped by name+size) so picking images
  // across several selections accumulates instead of replacing.
  const addFiles = useCallback((incoming: File[]) => {
    if (!incoming.length) return
    setProcessing(true)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(f)
        }
      }
      return merged
    })
    setShowForm(true)
    setTimeout(() => setProcessing(false), 400)
  }, [])

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // Plain hidden file input + native drag handlers (react-dropzone's open() was
  // silently failing in some browsers — this is bulletproof).
  const inputRef = useRef<HTMLInputElement>(null)
  // Folder picker (whole-directory batch). `webkitdirectory` isn't in the React
  // input types, so set it on the element via a ref rather than JSX.
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setDragActive] = useState(false)
  const openPicker = useCallback(() => inputRef.current?.click(), [])
  const openFolderPicker = useCallback(() => folderInputRef.current?.click(), [])

  useEffect(() => {
    const el = folderInputRef.current
    if (el) {
      el.setAttribute("webkitdirectory", "")
      el.setAttribute("directory", "")
    }
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // A folder selection includes every file; keep only images.
    addFiles(Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/")))
    // Reset so re-selecting the same file/folder fires change again.
    e.target.value = ""
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    addFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")))
  }

  // Expose the file-picker opener to the parent (for the U hotkey).
  useEffect(() => {
    onProvideOpen?.(openPicker)
  }, [onProvideOpen, openPicker])

  const batchMode = files.length > 1
  // An imported per-label map only applies in batch; it carries each file's own
  // expected data, so the shared form is not required for submit.
  const usingMap = batchMode && !!expectedMap

  // How the imported map lines up against the staged files (matched/unmatched).
  const mapMatch = useMemo(
    () => (expectedMap ? matchExpectedMap(files, expectedMap) : null),
    [expectedMap, files],
  )

  // A low-resolution image is allowed (it just gets a soft warning, not a block).
  const canSubmit = usingMap
    ? files.length > 0 && !!mapMatch?.ok
    : files.length > 0 && expected.brand_name.trim().length > 0

  const submit = () => {
    if (!canSubmit) return
    clearIntakeDraft()
    // Batch + imported map: grade each file against its own data.
    if (usingMap && expectedMap) {
      session.verifyBatchWithMap(files, expectedMap)
      return
    }
    const payload: ExpectedFields = sanitizeExpected(expected)
    if (batchMode) session.verifyBatch(files, payload)
    else session.verifyOne(files[0], payload)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="grid w-full place-items-center p-4"
    >
      <div className="glass w-full max-w-xl rounded-2xl border-2 border-gold/30 p-6 sm:p-8">
        <div className="text-center">
          <h2 className="font-display text-2xl font-semibold text-parchment">
            Verify a label
          </h2>
          <p className="mt-2 font-sans text-sm leading-relaxed text-parchment/65">
            Upload one label (or several for a batch) and its expected application
            data, then verify.
          </p>
        </div>

        {/* Dropzone */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setDragActive(false)
          }}
          className={cn(
            "mt-6 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
            isDragActive
              ? "border-gold bg-[rgba(200,169,81,0.08)]"
              : "border-white/20 bg-white/[0.02] hover:border-gold/50",
          )}
        >
          {/* Visually-hidden (NOT display:none) so a native <label> click opens
              the dialog in every browser — Safari/macOS will not open a file
              dialog from a programmatic .click() on a display:none input. */}
          <input
            ref={inputRef}
            id="intake-file-input"
            type="file"
            accept="image/*"
            multiple
            onChange={onInputChange}
            className="sr-only"
            aria-label="Upload label images"
          />
          {/* Whole-folder picker (batch). webkitdirectory is set via ref above. */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            onChange={onInputChange}
            className="sr-only"
            aria-label="Upload a folder of label images"
          />
          {processing ? (
            <Loader2 aria-hidden className="mx-auto h-9 w-9 animate-spin text-gold/80" />
          ) : (
            <UploadCloud aria-hidden className="mx-auto h-9 w-9 text-gold/80" />
          )}
          <p className="mt-2 font-sans text-base text-parchment/85" aria-live="polite">
            {files.length === 0 ? "Drag label image(s) here" : "Drag more, or"}
          </p>
          {/* A label tied to the input — native, no JS — is the bulletproof
              trigger; the U hotkey still calls inputRef.click() (works now that
              the input is sr-only, not display:none). */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <label
              htmlFor="intake-file-input"
              className="inline-block cursor-pointer rounded-lg border-2 border-gold/45 px-4 py-2 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.12)]"
            >
              Browse files
            </label>
            <button
              type="button"
              onClick={openFolderPicker}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-gold/45 px-4 py-2 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.12)]"
            >
              <FolderUp aria-hidden className="h-4 w-4" /> Select folder
            </button>
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-parchment/45">
            One image = single · several = batch · PNG / JPG
          </p>
        </div>

        {/* Staged-file thumbnails — confirms uploads landed and lets the reviewer
            drop any before verifying. */}
        {files.length > 0 && <StagedFiles files={files} onRemove={removeFile} />}

        {/* A single soft warning if any image is low-resolution — not a block. */}
        {hasTooSmall && (
          <div className="mt-3 flex items-center gap-3 rounded-xl border-2 border-amber/60 bg-[rgba(217,154,43,0.14)] p-4">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber px-2.5 py-1 font-sans text-xs font-bold uppercase tracking-wider text-navy-900">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Warning
            </span>
            <p className="font-sans text-base font-semibold leading-snug text-amber">
              Low resolution (under {MIN_IMAGE_LONG_EDGE}px) — verification may be
              less reliable. You can still proceed.
            </p>
          </div>
        )}

        {/* Per-label batch JSON import (DECISION 3) — appears automatically once a
            batch (>1 file) is staged. Each label can carry its own expected data;
            a full match supersedes the shared form below. */}
        {batchMode && (
          <BatchMapPanel
            filename={mapFilename ?? null}
            match={mapMatch}
            onImport={() => onImportMap?.()}
            onClear={() => onClearMap?.()}
          />
        )}

        {/* Application-data form — collapsible, open by default. Hidden once an
            imported map fully covers the batch (it supersedes the shared form). */}
        {!usingMap && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowForm((s) => !s)}
              aria-expanded={showForm}
              className="flex w-full items-center justify-between rounded-lg border-2 border-white/12 bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:border-gold/40"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold/75">
                Application data {batchMode ? "(applied to every label)" : ""}
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-5 w-5 text-parchment/50 transition-transform",
                  showForm && "rotate-180",
                )}
              />
            </button>

            {showForm && (
              <div className="mt-4">
                <ExpectedFieldsForm
                  value={expected}
                  onChange={setExpected}
                  disabled={session.busy}
                />
              </div>
            )}
          </div>
        )}

        {/* Submit + Cancel */}
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || session.busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] px-4 py-3 font-sans text-base font-bold text-navy-900 shadow-seal transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
        >
          {session.busy ? (
            <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles aria-hidden className="h-5 w-5" />
          )}
          {session.busy
            ? "Verifying…"
            : usingMap
              ? `Verify ${files.length} labels from ${mapFilename ?? "imported data"}`
              : batchMode
                ? `Verify ${files.length} labels`
                : "Verify label"}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-white/15 px-4 py-2.5 font-sans text-sm font-semibold text-parchment/70 transition-colors hover:border-white/30 hover:text-parchment"
          >
            Cancel
          </button>
        )}

        {files.length > 0 && !canSubmit && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-center font-sans text-[13px] text-parchment/55">
            <X aria-hidden className="h-3.5 w-3.5 text-amber" />
            {batchMode && expectedMap
              ? "Every uploaded file needs a matching entry in the imported data."
              : "Add the expected brand name to verify."}
          </p>
        )}
      </div>
    </motion.div>
  )
}
