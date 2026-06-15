import { useEffect, useState } from "react"
import { Loader2, RotateCcw, ImageOff } from "lucide-react"
import type { ExpectedFields } from "../lib/types"
import type { ReviewItem } from "../lib/review"
import { expectedFromResult } from "../lib/review"
import type { ReviewSession } from "../lib/useReviewSession"
import { sanitizeExpected } from "../lib/fieldOptions"
import { ExpectedFieldsForm } from "./ExpectedFieldsForm"

/**
 * Editable expected-fields form for the CURRENT item plus a prominent "Try again"
 * button that re-verifies the same label image against the edited fields. Used
 * when a reviewer spots an error in the originally-submitted application data:
 * fix it here, re-run, and the verdict updates in place. Rendered inside a
 * SidePane (wide) or Flyout (narrow), so it carries no panel chrome of its own.
 *
 * Re-verify needs the original image bytes; a reloaded/persisted item lost its
 * File, so the button is disabled there with a re-upload hint.
 */
export function ApplicationDataContent({
  open,
  item,
  session,
}: {
  /** Whether the host pane is open — reseeds the form when it (re)opens. */
  open: boolean
  item: ReviewItem
  session: ReviewSession
}) {
  const [expected, setExpected] = useState<ExpectedFields>(() =>
    expectedFromResult(item.result),
  )

  // Reseed from the item's current expected data whenever the pane opens or the
  // selected item changes, so edits never bleed across labels.
  useEffect(() => {
    if (open) setExpected(expectedFromResult(item.result))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id])

  const working = item.status === "working"
  const canReverify = !!item.file && !item.needsImage && !working

  const tryAgain = async () => {
    if (!canReverify) return
    const payload: ExpectedFields = sanitizeExpected(expected)
    await session.reverify(item.id, payload)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-sans text-sm leading-relaxed text-parchment/65">
        Edit the expected application data, then re-verify against the same label
        image.
      </p>

      <ExpectedFieldsForm value={expected} onChange={setExpected} disabled={working} />

      {!item.file || item.needsImage ? (
        <p className="flex items-start gap-2 rounded-lg border-2 border-amber/40 bg-[rgba(217,154,43,0.1)] p-3 font-sans text-[13px] leading-relaxed text-amber">
          <ImageOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          The image wasn’t retained across reload — re-upload {item.filename} to
          re-verify.
        </p>
      ) : null}

      <button
        type="button"
        onClick={tryAgain}
        disabled={!canReverify}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] px-4 py-3 font-sans text-base font-bold text-navy-900 shadow-seal transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
      >
        {working ? (
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
        ) : (
          <RotateCcw aria-hidden className="h-5 w-5" />
        )}
        {working ? "Re-verifying…" : "Try again"}
      </button>
    </div>
  )
}
