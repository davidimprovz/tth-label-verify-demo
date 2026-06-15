import { useEffect, useState } from "react"

/**
 * Subscribe to a CSS media query and return whether it currently matches.
 * Used to choose the review-surface pane treatment: flanking side panels on
 * wide screens, a bottom sheet on narrow ones.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}
