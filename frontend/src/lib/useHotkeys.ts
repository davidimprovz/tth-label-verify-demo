import { useEffect, useRef } from "react"

/** A single-key → handler map (keys matched case-insensitively, plus "?", "Escape"). */
export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>

/** True when focus sits in a text-entry control where single-key shortcuts must yield. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return (el as HTMLElement).isContentEditable === true
}

/**
 * Attach a global keydown listener for single-key shortcuts. Events are ignored
 * while focus is in an input/textarea/select/[contenteditable] — EXCEPT Escape,
 * which always fires (so an overlay/field can be dismissed from anywhere).
 * Modifier combos (Ctrl/Meta/Alt) are left alone so browser shortcuts survive.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  // Keep the latest handlers without re-subscribing on every render.
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const isEscape = e.key === "Escape"
      if (isTypingTarget(document.activeElement) && !isEscape) return

      const handlers = mapRef.current
      // Match the raw key (covers "?" and "Escape") then a lowercased letter.
      const handler = handlers[e.key] ?? handlers[e.key.toLowerCase()]
      if (handler) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
