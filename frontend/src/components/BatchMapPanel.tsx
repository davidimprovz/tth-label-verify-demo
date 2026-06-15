import { FileJson, Check, AlertTriangle, X } from "lucide-react"
import type { matchExpectedMap } from "../lib/parseExpectedMap"

/** Compact example of the expected_map.json shape, shown in the format helper. */
const MAP_EXAMPLE = `{
  "back_label_01.png": {
    "beverage_type": "spirits",
    "brand_name": "Astral",
    "class_type": "Tequila Blanco",
    "alcohol_content": "40% Alc./Vol.",
    "net_contents": "750 mL",
    "producer_name": "Casa Pinata",
    "country_of_origin": "Mexico",
    "is_import": true
  }
}`

/**
 * Per-label batch JSON panel (DECISION 3). Shows the import affordance and, once
 * a map is loaded, how it lines up against the staged files: matched count,
 * unmatched filenames (which would 422 on submit), and any list-count mismatch.
 * The pre-submit match check mirrors the backend's _resolve_expected rules so
 * the reviewer sees a friendly error before the request goes out.
 */
export function BatchMapPanel({
  filename,
  match,
  onImport,
  onClear,
}: {
  filename: string | null
  match: ReturnType<typeof matchExpectedMap> | null
  onImport: () => void
  onClear: () => void
}) {
  return (
    <div className="mt-4 rounded-lg border-2 border-white/12 bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold/75">
          Per-label data (JSON, optional)
        </span>
        {filename ? (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[12px] text-parchment/60 hover:text-parchment"
          >
            <X aria-hidden className="h-3.5 w-3.5" /> Clear
          </button>
        ) : null}
      </div>

      {!filename ? (
        <>
          <button
            type="button"
            onClick={onImport}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gold/45 px-3 py-2.5 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.12)]"
          >
            <FileJson aria-hidden className="h-4 w-4" />
            Import expected_map.json
          </button>

          {/* Inline format helper — collapsed by default so it doesn't clutter. */}
          <details className="mt-2">
            <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-wider text-parchment/50 transition-colors hover:text-parchment/80">
              What format? ▾
            </summary>
            <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
              <p className="font-sans text-[12px] leading-relaxed text-parchment/75">
                A JSON object mapping each image{" "}
                <span className="text-gold-soft">filename</span> to its expected
                fields:
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-parchment/85">
                {MAP_EXAMPLE}
              </pre>
              <p className="mt-2 font-sans text-[11px] leading-relaxed text-parchment/55">
                Required per entry: <span className="text-parchment/80">beverage_type</span>{" "}
                (spirits | wine | beer), brand_name, class_type, net_contents,
                producer_name. Add <span className="text-parchment/80">alcohol_content</span>{" "}
                for spirits/wine, and <span className="text-parchment/80">country_of_origin</span>{" "}
                + <span className="text-parchment/80">is_import: true</span> for imports. The
                filename must match the uploaded image exactly.
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 font-sans text-[13px] text-parchment/80">
            <FileJson aria-hidden className="h-4 w-4 text-gold/75" />
            <span className="truncate">{filename}</span>
          </p>
          {match && (
            <>
              <p className="flex items-center gap-1.5 font-sans text-[13px] text-green-bright">
                <Check aria-hidden className="h-4 w-4" />
                {match.matched.length} of {match.matched.length + match.unmatched.length} files matched
              </p>
              {match.unmatched.length > 0 && (
                <p className="flex items-start gap-1.5 font-sans text-[13px] text-amber">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  No entry for: {match.unmatched.join(", ")}
                </p>
              )}
              {match.countErrors.map((err, i) => (
                <p key={i} className="flex items-start gap-1.5 font-sans text-[13px] text-amber">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {err}
                </p>
              ))}
              {match.extra.length > 0 && (
                <p className="font-sans text-[12px] text-parchment/50">
                  Unused entries: {match.extra.join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
