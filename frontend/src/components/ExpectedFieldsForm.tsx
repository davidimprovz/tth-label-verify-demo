import type { BeverageType, ExpectedFields } from "../lib/types"
import { cn } from "../lib/cn"
import { SelectOrCustom } from "./SelectOrCustom"
import {
  COUNTRY_OPTIONS,
  FIELD_MAX_LENGTHS,
  NET_CONTENTS_OPTIONS,
} from "../lib/fieldOptions"

const BEVERAGES: { value: BeverageType; label: string }[] = [
  { value: "spirits", label: "Spirits" },
  { value: "wine", label: "Wine" },
  { value: "beer", label: "Beer / Malt" },
]

// Plain free-text fields (Net Contents + Country of Origin use dropdowns below).
const TEXT_FIELDS: { key: keyof ExpectedFields; label: string; placeholder: string }[] = [
  { key: "brand_name", label: "Brand Name", placeholder: "RIVERSTONE RESERVE" },
  { key: "class_type", label: "Class / Type", placeholder: "Kentucky Straight Bourbon Whiskey" },
  { key: "alcohol_content", label: "Alcohol Content", placeholder: "45% Alc./Vol." },
  { key: "producer_name", label: "Producer / Bottler", placeholder: "Riverstone Distilling Co." },
  { key: "producer_address", label: "Producer Address", placeholder: "Louisville, Kentucky" },
]

/** Blank expected-fields record — the starting point for a fresh intake form. */
export const EMPTY_EXPECTED: ExpectedFields = {
  beverage_type: "spirits",
  brand_name: "",
  class_type: "",
  alcohol_content: "",
  net_contents: "",
  producer_name: "",
  producer_address: "",
  country_of_origin: "",
  is_import: false,
}

const labelCls = "mb-1.5 block font-sans text-sm font-medium text-parchment/75"
const inputCls =
  "w-full rounded-lg border-2 border-white/15 bg-black/25 px-3 py-2.5 font-sans text-sm text-parchment placeholder:text-parchment/35 focus:border-gold/70 focus:outline-none"

/**
 * Editable expected-application-data form: beverage type, the graded text fields,
 * Net Contents + Country of Origin dropdowns (with custom fallback), and the
 * import toggle. Shared by the intake screen and the review-surface "Application
 * data" pane. Fully controlled via `value`/`onChange`.
 */
export function ExpectedFieldsForm({
  value,
  onChange,
  disabled = false,
}: {
  value: ExpectedFields
  onChange: (next: ExpectedFields) => void
  disabled?: boolean
}) {
  const set = <K extends keyof ExpectedFields>(k: K, v: ExpectedFields[K]) =>
    onChange({ ...value, [k]: v })

  return (
    <fieldset className="flex flex-col gap-4" disabled={disabled}>
      <div className="block">
        <span className={labelCls}>Beverage Type</span>
        <div className="grid grid-cols-3 gap-2">
          {BEVERAGES.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => set("beverage_type", b.value)}
              aria-pressed={value.beverage_type === b.value}
              className={cn(
                "rounded-lg border-2 px-2 py-2 font-sans text-sm font-medium transition-colors",
                value.beverage_type === b.value
                  ? "border-gold bg-[rgba(200,169,81,0.16)] text-gold-soft"
                  : "border-white/15 text-parchment/70 hover:border-gold/40",
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {TEXT_FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className={labelCls}>{f.label}</span>
          <input
            type="text"
            value={(value[f.key] as string) ?? ""}
            onChange={(e) => set(f.key, e.target.value as never)}
            placeholder={f.placeholder}
            maxLength={FIELD_MAX_LENGTHS[f.key]}
            className={inputCls}
          />
        </label>
      ))}

      <div className="block">
        <span className={labelCls}>Net Contents</span>
        <SelectOrCustom
          label="Net Contents"
          value={value.net_contents ?? ""}
          onChange={(v) => set("net_contents", v)}
          options={NET_CONTENTS_OPTIONS}
          placeholder="Select size…"
          customPlaceholder="e.g. 700 mL"
          maxLength={FIELD_MAX_LENGTHS.net_contents}
          disabled={disabled}
        />
      </div>

      {value.is_import && (
        <div className="block">
          <span className={labelCls}>Country of Origin</span>
          <SelectOrCustom
            label="Country of Origin"
            value={value.country_of_origin ?? ""}
            onChange={(v) => set("country_of_origin", v)}
            options={COUNTRY_OPTIONS}
            placeholder="Select country…"
            customPlaceholder="Country name"
            maxLength={FIELD_MAX_LENGTHS.country_of_origin}
            disabled={disabled}
          />
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-white/15 bg-white/[0.02] px-3 py-2.5">
        <input
          type="checkbox"
          checked={value.is_import}
          onChange={(e) => set("is_import", e.target.checked)}
          className="h-5 w-5 accent-[var(--gold-bright)]"
        />
        <span className="font-sans text-sm text-parchment/85">
          Imported product (requires country of origin)
        </span>
      </label>
    </fieldset>
  )
}
