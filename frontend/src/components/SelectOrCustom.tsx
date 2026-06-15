import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "../lib/cn"

const CUSTOM = "__custom__"

/**
 * Accessible dropdown that offers a fixed option list plus a "Custom…" escape
 * hatch revealing a free-text input. Used for Country of Origin and Net Contents
 * where a known list covers most cases but the registry can carry anything.
 *
 * Fully controlled via `value`/`onChange`. A value that isn't in `options` is
 * treated as a custom entry (the text input shows, pre-filled), so editing an
 * imported/extracted value never loses it.
 */
export function SelectOrCustom({
  value,
  onChange,
  options,
  placeholder = "Select…",
  customPlaceholder = "Type a value",
  disabled = false,
  label,
  maxLength,
}: {
  value: string
  onChange: (next: string) => void
  options: string[]
  placeholder?: string
  customPlaceholder?: string
  disabled?: boolean
  /** aria-label for both controls (the visible field label sits in the parent). */
  label: string
  /** Length cap for the custom free-text input. */
  maxLength?: number
}) {
  // The dropdown sits in "custom" mode when there's a value not on the list.
  const valueOnList = value === "" || options.includes(value)
  const [custom, setCustom] = useState(!valueOnList)

  const selectId = useId()
  const selectValue = custom ? CUSTOM : value

  const onSelect = (next: string) => {
    if (next === CUSTOM) {
      setCustom(true)
      onChange("")
      return
    }
    setCustom(false)
    onChange(next)
  }

  const field =
    "w-full rounded-lg border-2 border-white/15 bg-black/25 px-3 py-2.5 font-sans text-sm text-parchment focus:border-gold/70 focus:outline-none disabled:opacity-50"

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <select
          id={selectId}
          aria-label={label}
          value={selectValue}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
          className={cn(field, "cursor-pointer appearance-none pr-10")}
        >
          <option value="">{placeholder}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gold/70"
        />
      </div>
      {custom && (
        <input
          type="text"
          aria-label={`${label} (custom)`}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          maxLength={maxLength}
          className={field}
        />
      )}
    </div>
  )
}
