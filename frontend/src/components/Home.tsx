import { motion } from "framer-motion"
import { ArrowRight, LifeBuoy, ShieldCheck } from "lucide-react"

/**
 * Branded landing screen — the default view on load. Sets the context (what the
 * tool does) and offers a single primary action into the verification flow, plus
 * a link into the built-in guide. Deliberately uncluttered so a first-time,
 * non-technical reviewer knows exactly where to start.
 */
export function Home({
  onStart,
  onHelp,
}: {
  onStart: () => void
  onHelp: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="grid w-full flex-1 place-items-center p-4"
    >
      <div className="glass w-full max-w-lg rounded-2xl border-2 border-gold/30 p-8 text-center sm:p-10">
        <img
          src="/ttb-logo.svg"
          alt="TTB — Alcohol and Tobacco Tax and Trade Bureau"
          className="mx-auto h-14 w-auto sm:h-16"
        />
        <h1 className="mt-6 font-display text-3xl font-semibold text-parchment sm:text-4xl">
          <span className="text-gold-gradient">Label Verification</span>
        </h1>
        <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.28em] text-parchment/55">
          Compliance Assist
        </p>
        <p className="mx-auto mt-5 max-w-md font-sans text-base leading-relaxed text-parchment/75">
          Check alcohol-beverage labels against their expected application data —
          brand, class/type, alcohol content, net contents, and the Government
          Warning — and get an accept / review recommendation in seconds.
        </p>

        <button
          type="button"
          onClick={onStart}
          className="mt-8 inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] px-6 py-4 font-sans text-lg font-bold text-navy-900 shadow-seal transition-transform hover:scale-[1.01]"
        >
          <ShieldCheck aria-hidden className="h-5 w-5" />
          Verify a label
          <ArrowRight aria-hidden className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onHelp}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-white/15 px-6 py-3 font-sans text-base font-semibold text-parchment/75 transition-colors hover:border-gold/40 hover:text-parchment"
        >
          <LifeBuoy aria-hidden className="h-5 w-5" />
          Help &amp; getting started
        </button>
      </div>
    </motion.div>
  )
}
