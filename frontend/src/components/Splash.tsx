import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

const EASE = [0.22, 1, 0.36, 1] as const

/** Shared sessionStorage namespace so "splash seen" follows tab-open semantics. */
const SPLASH_SEEN_KEY = "ttb.splashSeen"

/** Whether the splash has already played in this tab session (refresh-safe). */
function splashAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SEEN_KEY) === "1"
  } catch {
    // No/blocked storage: fall through and play the splash once.
    return false
  }
}

/** Mark the splash as seen for the rest of this tab session. */
function markSplashSeen() {
  try {
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1")
  } catch {
    // Storage unavailable (private mode / quota) — degrade to replaying.
  }
}

/**
 * One-shot intro splash over the navy + guilloché atmosphere. Reveals the gold
 * seal, wordmark (clip-path wipe), tagline, and a gold hairline sweep, holds
 * briefly, then fades out + lifts and unmounts to reveal the app beneath.
 *
 * Reduced-motion: skips the motion choreography, shows the title statically for
 * a short beat, then dismisses. Never traps focus; fully unmounts via
 * AnimatePresence so keyboard users reach the app immediately.
 */
export function Splash({ onDone }: { onDone?: () => void } = {}) {
  const reduce = useReducedMotion()
  // Decide once, on first mount, whether the splash should play at all. If it
  // already played in this tab session (incl. a refresh) we never mount it, so
  // there is no enter/exit choreography to replay.
  const [seenAtMount] = useState(splashAlreadySeen)
  const [show, setShow] = useState(!seenAtMount)

  useEffect(() => {
    // Already seen this tab session: nothing to play — signal "done" right away
    // so any follow-on (e.g. the first-visit walkthrough) can sequence after.
    if (seenAtMount) {
      onDone?.()
      return
    }
    // First play this tab session: remember it so a refresh won't replay.
    markSplashSeen()
    // Hold the title, then trigger the exit. Shorter beat when reduced-motion;
    // the full-motion path lingers ~2.2s total (hold + ~0.55s exit).
    const hold = reduce ? 650 : 1650
    const t = setTimeout(() => setShow(false), hold)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, seenAtMount])

  // Already seen this tab session: render nothing (no replay on refresh).
  if (seenAtMount) return null

  return (
    // Fire onDone after the exit choreography finishes so a follow-on overlay
    // (the first-visit walkthrough) appears only once the splash is fully gone.
    <AnimatePresence onExitComplete={onDone}>
      {show && (
        <motion.div
          // aria-hidden so it never traps focus or interrupts the reader; it is
          // purely decorative and unmounts on its own.
          aria-hidden
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden"
          initial={{ opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          transition={{ duration: reduce ? 0.25 : 0.55, ease: EASE }}
        >
          {/* Solid navy + atmosphere so the app underneath doesn't peek. */}
          <div className="atmosphere" />
          <div className="absolute inset-0 bg-navy-900/60" />

          <div className="relative flex flex-col items-center gap-5 px-6 text-center">
            <motion.div
              initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.86 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: EASE }}
            >
              <img
                src="/ttb-logo.svg"
                alt="TTB — Alcohol and Tobacco Tax and Trade Bureau"
                className="h-16 w-auto sm:h-20"
              />
            </motion.div>

            {/* Wordmark: clip-path wipe reveal. */}
            <div className="overflow-hidden">
              <motion.h1
                initial={
                  reduce
                    ? { opacity: 1, clipPath: "inset(0 0% 0 0)" }
                    : { opacity: 0, clipPath: "inset(0 100% 0 0)", y: 8 }
                }
                animate={{ opacity: 1, clipPath: "inset(0 0% 0 0)", y: 0 }}
                transition={{ duration: 0.8, delay: reduce ? 0 : 0.35, ease: EASE }}
                className="font-display text-3xl font-semibold tracking-tight sm:text-4xl"
              >
                <span className="text-gold-gradient">Label Verification</span>
              </motion.h1>
            </div>

            {/* Gold hairline sweep beneath the title. */}
            <motion.span
              aria-hidden
              initial={reduce ? { scaleX: 1, opacity: 0.7 } : { scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 0.7 }}
              transition={{ duration: 0.7, delay: reduce ? 0 : 0.6, ease: EASE }}
              className="h-px w-44 origin-left bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent"
            />

            {/* Tagline. */}
            <motion.p
              initial={reduce ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: reduce ? 0 : 0.75, ease: EASE }}
              className="font-sans text-[11px] uppercase tracking-[0.4em] text-parchment/55"
            >
              Compliance Assist
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
