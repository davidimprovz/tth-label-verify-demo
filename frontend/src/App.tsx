import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { AlertCircle, RotateCcw, X } from "lucide-react"
import { useReviewSession } from "./lib/useReviewSession"
import { useHotkeys } from "./lib/useHotkeys"
import { deriveScreenState } from "./lib/screenState"
import { parseExpectedMapText, type ExpectedMap } from "./lib/parseExpectedMap"
import { TopBar } from "./components/TopBar"
import { Home } from "./components/Home"
import { IntakeScreen } from "./components/IntakeScreen"
import { VerificationPanel } from "./components/VerificationPanel"
import { RejectionReasonEditor } from "./components/AcceptancePanel"
import { DecisionTab } from "./components/DecisionTab"
import { ProgressBar } from "./components/ProgressBar"
import { DetailsContent } from "./components/DetailsContent"
import { ApplicationDataContent } from "./components/ApplicationDataPane"
import { QueueList } from "./components/QueueList"
import { Splash } from "./components/Splash"
import { HotkeysHelp } from "./components/HotkeysHelp"
import { HelpGuide } from "./components/HelpGuide"
import { GettingStarted } from "./components/GettingStarted"
import { Flyout } from "./components/Flyout"
import { SidePane } from "./components/SidePane"
import { guideSeen, markGuideSeen } from "./lib/guide"
import { clearIntakeDraft } from "./lib/persistSession"
import { useMediaQuery } from "./lib/useMediaQuery"
import { dlog } from "./lib/debug"

const RESOLVED = new Set(["pass", "review", "fail", "error"])

// Top-level view: the branded landing ("home") vs. the working area ("app").
// Persisted per-tab so an accidental refresh returns to where the reviewer was.
type View = "home" | "app"
const VIEW_KEY = "ttb.view"
function loadView(hasItems: boolean): View {
  try {
    const v = sessionStorage.getItem(VIEW_KEY)
    if (v === "app" || v === "home") return v
  } catch {
    // storage unavailable — fall through
  }
  // No stored view: stay in the app if a session was restored, else land home.
  return hasItems ? "app" : "home"
}
function saveView(v: View) {
  try {
    sessionStorage.setItem(VIEW_KEY, v)
  } catch {
    // ignore
  }
}

const surface = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
}

/**
 * One-task-at-a-time reviewer (design §2). The main region switches on the
 * derived screen-state: intake → processing → review/decision. The batch queue
 * stays accessible alongside the review/processing surfaces (it moves into a
 * flyout in a later step).
 */
export default function App() {
  const session = useReviewSession()
  const { selected, items, selectedId } = session
  const { screen, isBatch } = deriveScreenState(session)
  // Wide screens get flanking side panes (Edit/Details grow out of the image
  // edge); narrow screens fall back to the Flyout bottom sheet.
  const lgUp = useMediaQuery("(min-width: 1280px)")
  // Home (landing) vs. app (working area). Initialized from storage so a refresh
  // mid-review returns to the app rather than the landing.
  const [view, setView] = useState<View>(() => loadView(items.length > 0))
  useEffect(() => {
    saveView(view)
  }, [view])
  // Two help surfaces: the rich instructions panel (HelpGuide) and the compact
  // keyboard-shortcuts overlay (HotkeysHelp). The menu "Help" opens HelpGuide;
  // the `?` hotkey keeps opening HotkeysHelp (HelpGuide also links to both).
  const [helpOpen, setHelpOpen] = useState(false) // HotkeysHelp
  const [helpGuideOpen, setHelpGuideOpen] = useState(false) // HelpGuide
  // First-visit getting-started walkthrough. Auto-shows once after the splash
  // on a user's first visit (localStorage `ttb.guideSeen`); recallable from Help.
  const [guideOpen, setGuideOpen] = useState(false)
  const [splashDone, setSplashDone] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Left "Application data" pane — edit expected fields + re-verify (Change 2).
  const [appDataOpen, setAppDataOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  // Right-hand annotation flyout — opened on Reject to capture/edit the
  // (prefilled) rejection reason. Mutually exclusive with the Details flyout.
  const [rejectNoteOpen, setRejectNoteOpen] = useState(false)
  // Mobile/tablet queue sheet — the batch queue is inline only at lg+; below
  // that it collapses into a bottom-sheet flyout opened by a "Queue" button.
  const [queueOpen, setQueueOpen] = useState(false)

  // The detail flyout only makes sense once the selected item has resolved.
  const selectedResolved = !!selected?.result || selected?.status === "error"

  // Close the detail flyout when switching labels (batch) so it never carries a
  // prior item's detail, and whenever the selection leaves a resolved state.
  useEffect(() => {
    setDetailsOpen(false)
    setAppDataOpen(false)
    setNoteOpen(false)
    setRejectNoteOpen(false)
  }, [selectedId])

  // First-visit walkthrough: once the splash has fully dismissed, show the
  // getting-started overlay only if it has never been seen on this device
  // (localStorage flag, distinct from the splash's per-tab sessionStorage). This
  // sequencing avoids stacking the overlay on top of the splash animation.
  useEffect(() => {
    if (splashDone && !guideSeen()) setGuideOpen(true)
  }, [splashDone])

  // Dismissing the walkthrough records the localStorage flag so it never
  // auto-replays; reopening from Help does not clear the flag.
  const dismissGuide = useCallback(() => {
    markGuideSeen()
    setGuideOpen(false)
  }, [])

  // The intake dropzone owns the file-picker opener; it hands it up here so the
  // U hotkey can trigger it.
  const openPickerRef = useRef<(() => void) | null>(null)
  const provideOpen = useCallback((open: () => void) => {
    openPickerRef.current = open
  }, [])

  // Import application data (JSON) — a per-label expected_map.json for batch
  // (DECISION 3). The parsed map lives here so both the hidden menu input and
  // the in-IntakeScreen button feed the same state; IntakeScreen matches it
  // against the staged files and submits via verifyBatchWithMap.
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const [expectedMap, setExpectedMap] = useState<ExpectedMap | null>(null)
  const [mapFilename, setMapFilename] = useState<string | null>(null)
  const importJson = useCallback(() => jsonInputRef.current?.click(), [])

  const onJsonFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input so re-selecting the same file fires change again.
    e.target.value = ""
    if (!file) return
    const text = await file.text()
    const { map, errors } = parseExpectedMapText(text)
    if (!map) {
      session.setError(`Could not import ${file.name}: ${errors[0] ?? "invalid map"}`)
      setExpectedMap(null)
      setMapFilename(null)
      return
    }
    setExpectedMap(map)
    setMapFilename(file.name)
  }, [session])

  // Shared teardown for "new verification" and "home": clear the session, the
  // imported map, the intake draft, and every transient overlay.
  const teardown = useCallback(() => {
    session.reset()
    clearIntakeDraft()
    setExpectedMap(null)
    setMapFilename(null)
    setHelpOpen(false)
    setHelpGuideOpen(false)
    setGuideOpen(false)
    setDetailsOpen(false)
    setAppDataOpen(false)
    setNoteOpen(false)
    setRejectNoteOpen(false)
    setQueueOpen(false)
  }, [session])

  // "New verification": tear down and return to a fresh intake screen.
  const newVerification = useCallback(() => {
    teardown()
    setView("app")
  }, [teardown])

  // "Home": tear down and return to the landing screen.
  const goHome = useCallback(() => {
    teardown()
    setView("home")
  }, [teardown])

  // Start from the landing screen — open a fresh intake.
  const startVerification = useCallback(() => {
    setView("app")
  }, [])

  // Batch gate: the reviewer must decide every label before they may leave
  // (start a new verification or cancel/Home). Single mode is never gated.
  const reviewRemaining = items.filter((it) => it.decision === undefined).length
  const allReviewed = items.length > 0 && reviewRemaining === 0
  const canLeave = !isBatch || allReviewed
  // Transient "finish reviewing first" nudge shown when a leave is blocked.
  const [leaveBlocked, setLeaveBlocked] = useState(false)
  useEffect(() => {
    if (!leaveBlocked) return
    const id = window.setTimeout(() => setLeaveBlocked(false), 3200)
    return () => window.clearTimeout(id)
  }, [leaveBlocked])

  // Guard the two "leave" exits so batch can't be abandoned mid-review.
  const requestNewVerification = useCallback(() => {
    if (!canLeave) {
      setLeaveBlocked(true)
      return
    }
    newVerification()
  }, [canLeave, newVerification])
  const requestGoHome = useCallback(() => {
    if (!canLeave) {
      setLeaveBlocked(true)
      return
    }
    goHome()
  }, [canLeave, goHome])

  // Auto-advance to a fresh verification once review is complete — a single
  // label decided (accept OR reject), or every label in a batch decided — so the
  // reviewer isn't left on a dead screen. It's cancelable: a Cancel on the cue
  // keeps them on the current result.
  const reviewComplete =
    view === "app" && (isBatch ? allReviewed : selected?.decision != null)
  const [advanceCanceled, setAdvanceCanceled] = useState(false)
  // Re-arm whenever review is no longer complete (new verification / undone
  // decision), so a prior Cancel never sticks across review units.
  useEffect(() => {
    if (!reviewComplete) setAdvanceCanceled(false)
  }, [reviewComplete])
  // On a reject, hold the auto-advance until the reviewer has finished with the
  // rejection note (closed it via Done or Cancel) so it never interrupts them
  // mid-annotation.
  const autoAdvancing = reviewComplete && !advanceCanceled && !rejectNoteOpen
  useEffect(() => {
    if (!autoAdvancing) return
    const id = window.setTimeout(() => newVerification(), 4000)
    return () => window.clearTimeout(id)
  }, [autoAdvancing, newVerification])

  // Contextual label for the auto-advance cue.
  const advanceLabel = isBatch
    ? "Batch reviewed"
    : selected?.decision === "rejected"
      ? "Rejected"
      : "Accepted"

  // Record a human decision on the selected label — only once it has resolved
  // (mirrors AcceptancePanel's gate so hotkeys can't decide a pending item).
  const decide = useCallback(
    (decision: "accepted" | "rejected") => {
      if (!selected) return
      const resolved = !!selected.result || selected.status === "error"
      if (!resolved) return
      session.patch(selected.id, { decision })
      dlog("decision", { filename: selected.filename, decision, verdict: selected.result?.overall })
      // On reject, fly the right-hand annotation pane out so the reviewer can
      // confirm/edit the prefilled rejection reason. Keep it exclusive with the
      // Details flyout (both slide from the right).
      if (decision === "rejected") {
        setDetailsOpen(false)
        setRejectNoteOpen(true)
      }
      // Batch only (DECISION 5): advance to the next undecided label. Skip the
      // advance on reject so the just-opened annotation pane stays on this label.
      else if (isBatch) session.advanceToNextUnreviewed(selected.id)
    },
    [selected, session, isBatch],
  )

  // Step through the queue, clamped to its bounds.
  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      const cur = items.findIndex((it) => it.id === selectedId)
      const base = cur < 0 ? 0 : cur
      const next = Math.min(items.length - 1, Math.max(0, base + delta))
      session.select(items[next].id)
    },
    [items, selectedId, session],
  )

  useHotkeys({
    u: () => openPickerRef.current?.(),
    a: () => decide("accepted"),
    r: () => decide("rejected"),
    // Open the on-image note editor for the selected label (review/decision only).
    n: () => {
      if (selected && (screen === "review" || screen === "decision")) {
        setNoteOpen((o) => !o)
      }
    },
    // Toggle the detail flyout — only meaningful once a verdict has resolved.
    d: () => {
      if (selectedResolved) {
        setRejectNoteOpen(false)
        setDetailsOpen((o) => !o)
      }
    },
    // Toggle the left "Application data" pane (edit + re-verify) — resolved only.
    e: () => {
      if (selectedResolved && (screen === "review" || screen === "decision")) {
        setAppDataOpen((o) => !o)
      }
    },
    j: () => step(1),
    ArrowRight: () => step(1),
    k: () => step(-1),
    ArrowLeft: () => step(-1),
    "?": () => setHelpOpen((o) => !o),
    Escape: () => {
      setHelpOpen(false)
      setHelpGuideOpen(false)
      setDetailsOpen(false)
      setAppDataOpen(false)
      setNoteOpen(false)
      setRejectNoteOpen(false)
      setQueueOpen(false)
      // Esc on the walkthrough counts as dismissal (records the seen flag).
      if (guideOpen) dismissGuide()
    },
  })

  const done = items.filter((it) => RESOLVED.has(it.status)).length
  const total = items.length

  // Batch prev/next bounds for the on-image navigation arrows.
  const curIndex = items.findIndex((it) => it.id === selectedId)
  const canPrev = curIndex > 0
  const canNext = curIndex >= 0 && curIndex < items.length - 1

  return (
    <div className="relative min-h-screen">
      <Splash onDone={() => setSplashDone(true)} />
      <HotkeysHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <HelpGuide
        open={helpGuideOpen}
        onClose={() => setHelpGuideOpen(false)}
        onOpenWalkthrough={() => {
          setHelpGuideOpen(false)
          setGuideOpen(true)
        }}
        onOpenHotkeys={() => {
          setHelpGuideOpen(false)
          setHelpOpen(true)
        }}
      />
      <GettingStarted open={guideOpen} onDismiss={dismissGuide} />
      <div className="atmosphere" aria-hidden />

      {/* Viewport-bounded shell: the nav stays put (always visible) and each
          screen scrolls internally rather than the whole page. */}
      <div className="relative z-10 flex h-[100dvh] flex-col overflow-hidden">
        <TopBar
          view={view}
          onHome={requestGoHome}
          onNewVerification={requestNewVerification}
          onHelp={() => setHelpGuideOpen(true)}
          busy={session.busy}
          leaveLocked={!canLeave}
          batch={
            isBatch && view === "app"
              ? { done, total, onBrowseAll: () => setQueueOpen(true) }
              : null
          }
        />

        {/* Transient nudges (fixed, non-blocking). */}
        <AnimatePresence>
          {leaveBlocked && (
            <motion.div
              key="leave-blocked"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              role="status"
              className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-lg border-2 border-amber/60 bg-navy-900/95 px-4 py-2.5 font-sans text-sm font-semibold text-amber shadow-xl backdrop-blur"
            >
              Review all labels before leaving — {reviewRemaining} left
            </motion.div>
          )}
          {autoAdvancing && (
            <motion.div
              key="auto-advance"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-label={`${advanceLabel} — new verification starting`}
              // Centered modal over a blurred backdrop. Clicking the backdrop
              // cancels (keeps the reviewer on the current result).
              onClick={() => setAdvanceCanceled(true)}
              className="fixed inset-0 z-50 grid place-items-center bg-navy-900/60 p-4 backdrop-blur-sm"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="w-[24rem] max-w-full overflow-hidden rounded-2xl border-2 border-gold/40 bg-navy-900/95 shadow-2xl"
              >
                <div className="flex items-center gap-3 px-5 py-4">
                  <RotateCcw aria-hidden className="h-5 w-5 shrink-0 text-gold" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold/70">
                      {advanceLabel}
                    </p>
                    <p className="font-sans text-base font-medium text-parchment/90">
                      New verification starting…
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdvanceCanceled(true)}
                    className="shrink-0 rounded-lg border-2 border-gold/40 px-3.5 py-2 font-sans text-sm font-semibold text-gold-soft transition-colors hover:bg-[rgba(200,169,81,0.14)]"
                  >
                    Cancel
                  </button>
                </div>
                {/* Draining countdown — mirrors the 4s auto-advance timer. */}
                <motion.span
                  className="block h-1 origin-left bg-gradient-to-r from-[var(--gold)] to-[var(--gold-bright)]"
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: 4, ease: "linear" }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden input — entry point for "Import application data" (JSON): a
            per-label expected_map.json wired through onJsonFile → parse →
            IntakeScreen → verifyBatchWithMap. */}
        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onJsonFile}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />

        {/* Error toast */}
        <AnimatePresence>
          {session.error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              role="alert"
              className="mx-5 mt-3 flex items-center gap-3 rounded-lg border border-red/50 bg-[rgba(179,64,47,0.15)] px-4 py-2.5 backdrop-blur-sm"
            >
              <AlertCircle aria-hidden className="h-4 w-4 shrink-0 text-red" />
              <span className="flex-1 font-sans text-sm text-parchment/90">{session.error}</span>
              <button
                type="button"
                onClick={session.clearError}
                aria-label="Dismiss error"
                className="rounded p-1 text-parchment/60 hover:text-parchment"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex min-h-0 flex-1 flex-col p-4">
          <AnimatePresence mode="wait">
            {view === "home" ? (
              <motion.div key="home" {...surface} className="flex flex-1 overflow-y-auto">
                <Home onStart={startVerification} onHelp={() => setHelpGuideOpen(true)} />
              </motion.div>
            ) : screen === "intake" ? (
              <motion.div key="intake" {...surface} className="flex flex-1 items-start justify-center overflow-y-auto">
                <IntakeScreen
                  session={session}
                  onProvideOpen={provideOpen}
                  onCancel={goHome}
                  expectedMap={expectedMap}
                  mapFilename={mapFilename}
                  onImportMap={importJson}
                  onClearMap={() => {
                    setExpectedMap(null)
                    setMapFilename(null)
                  }}
                />
              </motion.div>
            ) : (
              // processing | review | decision — ONE stable work surface. The
              // image (VerificationPanel) stays mounted across the transition;
              // only the top progress bar and the recommendation header fade,
              // so the label never flashes out and back in.
              <motion.div key="work" {...surface} className="mx-auto flex min-h-0 w-full max-w-[90rem] flex-1 flex-col gap-4">
                <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-4">
                  {/* Top slot: progress bar while verifying → recommendation on
                      resolve. Sequenced so progress fades out, then the verdict
                      fades in — the image beneath holds steady. */}
                  <div className="w-full max-w-2xl shrink-0">
                    <AnimatePresence mode="wait">
                      {screen === "processing" ? (
                        <motion.div
                          key="progress"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                        >
                          <ProgressBar indeterminate label="Verifying label" />
                        </motion.div>
                      ) : selected ? (
                        <motion.div
                          key="decision"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <DecisionTab item={selected} session={session} onDecide={decide} />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>

                  <div className="flex min-h-0 w-full flex-1 items-stretch justify-center gap-0">
                    {lgUp && selected && screen !== "processing" && (
                      <SidePane
                        side="left"
                        open={appDataOpen}
                        onClose={() => setAppDataOpen(false)}
                        title="Application data"
                      >
                        <ApplicationDataContent open={appDataOpen} item={selected} session={session} />
                      </SidePane>
                    )}

                    <section aria-label="Verification" className="flex min-h-0 w-full max-w-2xl flex-col overflow-hidden">
                      <VerificationPanel
                        item={selected}
                        session={screen === "processing" ? undefined : session}
                        hideVerifying
                        onDetailsChange={(o) => {
                          // Details and the reject-annotation share the right edge.
                          if (o) setRejectNoteOpen(false)
                          setDetailsOpen(o)
                        }}
                        onAppDataChange={setAppDataOpen}
                        noteOpen={noteOpen}
                        onNoteOpenChange={setNoteOpen}
                        isBatch={isBatch}
                        onPrev={() => step(-1)}
                        onNext={() => step(1)}
                        canPrev={canPrev}
                        canNext={canNext}
                      />
                    </section>

                    {lgUp && selected && screen !== "processing" && (
                      <SidePane
                        side="right"
                        open={detailsOpen || rejectNoteOpen}
                        onClose={() => {
                          setDetailsOpen(false)
                          setRejectNoteOpen(false)
                        }}
                        title={rejectNoteOpen ? "Rejection note" : "Field comparison"}
                      >
                        {rejectNoteOpen ? (
                          <RejectionReasonEditor item={selected} session={session} />
                        ) : (
                          <DetailsContent item={selected} session={session} />
                        )}
                      </SidePane>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Narrow-screen fallback: the same Edit / Details / Rejection panes as a
            bottom-sheet Flyout (wide screens use the flanking SidePanes above). */}
        {!lgUp && (
          <>
            {selected && (
              <Flyout
                open={appDataOpen}
                onClose={() => setAppDataOpen(false)}
                title="Application data"
                side="left"
                showDone
              >
                <ApplicationDataContent open={appDataOpen} item={selected} session={session} />
              </Flyout>
            )}
            {selected && (
              <Flyout
                open={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                title="Field comparison"
                side="right"
                showDone
              >
                <DetailsContent item={selected} session={session} />
              </Flyout>
            )}
            <Flyout
              open={rejectNoteOpen}
              onClose={() => setRejectNoteOpen(false)}
              title="Rejection note"
              side="right"
              showDone
            >
              <RejectionReasonEditor item={selected} session={session} />
            </Flyout>
          </>
        )}

        {/* Batch queue as a left-hand flyout — a click-navigable overview of the
            whole lot, reachable at any size via the "Browse all" button. The
            same QueueList renders inside; selecting closes it. */}
        {isBatch && (
          <Flyout
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
            title="Batch queue"
            side="left"
            flushVertical
          >
            <QueueList
              items={items}
              selectedId={selectedId}
              onSelect={(id) => {
                session.select(id)
                setQueueOpen(false)
              }}
            />
          </Flyout>
        )}
      </div>
    </div>
  )
}

