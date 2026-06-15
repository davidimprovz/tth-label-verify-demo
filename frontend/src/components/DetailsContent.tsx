import { useEffect, useState } from "react"
import { StickyNote, AlertTriangle } from "lucide-react"
import type { ReviewItem } from "../lib/review"
import { gradedFields, imageQualityField } from "../lib/review"
import { GOVERNMENT_WARNING_FIELD } from "../lib/types"
import type { ReviewSession } from "../lib/useReviewSession"
import { WarningCard } from "./WarningCard"
import { FieldRow } from "./FieldRow"
import { TriageBanner } from "./TriageBanner"

/**
 * The full field-by-field comparison shown in the Details pane: image-quality
 * triage, the Government Warning card, every graded field row, and the reviewer's
 * note (auto-saved on each keystroke). Rendered inside a SidePane (wide screens)
 * or the Flyout bottom sheet (narrow), so it carries no panel chrome of its own.
 */
export function DetailsContent({
  item,
  session,
}: {
  item: ReviewItem
  session?: ReviewSession
}) {
  const result = item.result
  const warning = result?.fields.find((f) => f.field === GOVERNMENT_WARNING_FIELD)
  const triage = imageQualityField(result)
  const rows = gradedFields(result).filter((f) => f.field !== GOVERNMENT_WARNING_FIELD)

  return (
    <div className="flex flex-col gap-6">
      {item.status === "error" && (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-red/60 bg-[rgba(179,64,47,0.14)] p-4">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-red px-2.5 py-1 font-sans text-xs font-bold uppercase tracking-wider text-white">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Error
          </span>
          <p className="font-sans text-base font-semibold leading-snug text-red">
            Verification failed. Edit the data and try again, or re-upload the image.
          </p>
        </div>
      )}
      {triage && <TriageBanner field={triage} />}
      {warning && <WarningCard field={warning} />}
      {rows.length > 0 ? (
        <div className="flex flex-col gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold/70">
            Field comparison
          </p>
          {rows.map((f, i) => (
            <FieldRow key={f.field} field={f} index={i} />
          ))}
        </div>
      ) : (
        !warning &&
        !triage &&
        item.status !== "error" && (
          <p className="font-sans text-base text-parchment/60">
            No field-level detail available for this label.
          </p>
        )
      )}

      {session && <DetailsNotes item={item} session={session} />}
    </div>
  )
}

/**
 * The reviewer's note, bound to `item.notes` (the same field the on-image note
 * pane edits, so a note typed in either place shows in both). Auto-saved on every
 * change — no separate save step.
 */
function DetailsNotes({ item, session }: { item: ReviewItem; session: ReviewSession }) {
  const [draft, setDraft] = useState(item.notes)

  useEffect(() => {
    setDraft(item.notes)
  }, [item.id, item.notes])

  return (
    <div className="flex flex-col gap-3 border-t-2 border-white/10 pt-6">
      <label className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-gold/70">
          <StickyNote aria-hidden className="h-4 w-4" /> Reviewer note
        </span>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            session.patch(item.id, { notes: e.target.value })
          }}
          rows={4}
          placeholder="Record why this label was rejected, or any note for the next reviewer…"
          className="w-full resize-none rounded-lg border-2 border-white/12 bg-black/25 p-3.5 font-sans text-base leading-relaxed text-parchment placeholder:text-parchment/35 focus:border-gold/60 focus:outline-none"
        />
      </label>
    </div>
  )
}
