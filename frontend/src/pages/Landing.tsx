/**
 * Landing page.
 *
 * Its single most important job, above looking good, is that nobody can come
 * away believing this is live plant data. The provenance block sits above the
 * fold, in the same visual weight as everything else -- not in small print at
 * the bottom.
 */

import { Link } from 'react-router-dom'
import { ArrowRight, Boxes, Compass, GitBranch, Info } from 'lucide-react'
import { GITHUB_URL } from '../lib/env'
import { PUMP } from '../lib/pumpPhysics'
import { Chip } from '../components/ui'

const TECHNOLOGY_CHIPS = [
  'Mechanical Engineering',
  'Rotating Machinery',
  'Pump Physics',
  'Vibration Analysis',
  'Machine Learning',
  'Digital Twin',
  'PLC/SCADA',
  'FastAPI',
  'React',
]

const CONTEXT = [
  { key: 'SYSTEM', value: 'Motor-Centrifugal Pump System' },
  { key: 'DATA SOURCE', value: 'Simulation' },
  { key: 'PROJECT TYPE', value: 'Engineering Portfolio Prototype' },
  { key: 'MODE', value: 'Interactive Demo' },
]

const CAPABILITIES = [
  {
    title: 'Physics-based pump model',
    body: 'Flow is solved as the intersection of the pump characteristic and the system curve, not drawn from a random number generator. Head, efficiency, shaft power and NPSH all follow from that one operating point.',
  },
  {
    title: 'Vibration signal analysis',
    body: 'Time waveform and FFT spectrum with 1x and 2x markers, RMS, peak, crest factor and band energy -- the quantities a rotating-machinery engineer actually reads.',
  },
  {
    title: 'Diagnosis you can challenge',
    body: 'Physics evidence and model evidence are shown side by side with feature importances. Where the rules and the classifier disagree, the interface says so.',
  },
  {
    title: 'Industrial control logic',
    body: 'A SCADA state machine with real interlocks: start, stop, reset, emergency stop, maintenance lock-out, and an explanation of why any refused command was refused.',
  },
]

export function Landing() {
  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-white">
      {/*
       * Decorative hero glow. Ornamental only: aria-hidden, non-interactive,
       * carries no state, and bounded to the top of the page so the drifting
       * layers never sit behind the data-heavy sections further down.
       */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem]" aria-hidden>
        <div className="absolute -top-24 -left-24 h-80 w-80 animate-drift-a rounded-full bg-hero-glow-a/35 blur-3xl motion-reduce:animate-none" />
        <div className="absolute -top-20 left-1/3 h-96 w-96 animate-drift-b rounded-full bg-hero-glow-b/45 blur-3xl motion-reduce:animate-none" />
        <div className="absolute top-10 -right-20 h-72 w-72 animate-drift-c rounded-full bg-hero-glow-c/30 blur-3xl motion-reduce:animate-none" />
      </div>

      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded bg-slate-900 text-sm font-bold text-white">
              PG
            </span>
            <span className="text-sm font-semibold text-slate-900">PumpGuard DT</span>
          </div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-secondary"
          >
            <GitBranch className="h-4 w-4" aria-hidden />
            GitHub
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <p className="animate-rise text-xs font-semibold tracking-[0.2em] text-blue-700 uppercase [animation-delay:60ms] motion-reduce:animate-none">
          Condition Monitoring &middot; Digital Twin &middot; Predictive Maintenance
        </p>
        <h1 className="animate-rise mt-3 bg-linear-to-r from-title-from to-title-to bg-clip-text pb-1 text-4xl font-bold tracking-tight text-transparent [animation-delay:120ms] motion-reduce:animate-none sm:text-5xl">
          PumpGuard DT
        </h1>
        <p className="animate-rise mt-3 text-lg font-medium text-slate-700 [animation-delay:180ms] motion-reduce:animate-none sm:text-xl">
          AI-Powered Digital Twin &amp; Predictive Maintenance Platform
        </p>
        <p className="animate-rise mt-5 max-w-3xl text-base leading-relaxed text-slate-600 [animation-delay:240ms] motion-reduce:animate-none">
          A portfolio-scale motor&ndash;pump condition monitoring platform integrating mechanical
          modelling, vibration analysis, machine learning, digital twins and industrial control
          logic.
        </p>

        {/* Provenance. Placed before the call to action on purpose.
         * Its amber warning colours are deliberately left untouched -- this
         * block carries meaning, so it gets the entrance stagger and nothing
         * else: no gradient, no glow, no hover state. */}
        <div className="animate-rise mt-8 flex max-w-3xl gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 [animation-delay:300ms] motion-reduce:animate-none">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">This is simulated data, not a real machine.</p>
            <p className="mt-1">
              Every value in this application is produced by a physics simulation of a laboratory
              scale motor&ndash;pump set. No physical asset, plant, or customer data is involved
              anywhere in the system.
            </p>
          </div>
        </div>

        <div className="animate-rise mt-8 flex flex-wrap gap-3 [animation-delay:360ms] motion-reduce:animate-none">
          <Link
            to="/app/dashboard"
            className="btn btn-primary bg-linear-to-r from-accent to-accent-on-bg-strong px-5 py-2.5 text-base transition duration-300 hover:shadow-lg hover:shadow-accent/40 hover:brightness-110"
          >
            <Boxes className="h-5 w-5" aria-hidden />
            Launch Interactive Demo
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link to="/app/architecture" className="btn btn-secondary px-5 py-2.5 text-base">
            <Compass className="h-5 w-5" aria-hidden />
            Engineering Architecture
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-secondary px-5 py-2.5 text-base"
          >
            <GitBranch className="h-5 w-5" aria-hidden />
            GitHub
          </a>
        </div>

        {/* Context block */}
        <dl className="animate-rise mt-12 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 [animation-delay:420ms] motion-reduce:animate-none sm:grid-cols-2 lg:grid-cols-4">
          {CONTEXT.map((item) => (
            <div
              key={item.key}
              /* No lift or drop shadow here on purpose: the parent <dl> needs
               * overflow-hidden for its gap-px grid lines and rounded corners,
               * which would clip both. A tint plus the top highlight reads as a
               * hover response without fighting the container. */
              className="relative bg-white p-4 transition-colors duration-300 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-card-highlight before:to-transparent before:opacity-0 before:transition-opacity before:duration-300 hover:bg-surface-sunken hover:before:opacity-100"
            >
              <dt className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                {item.key}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{item.value}</dd>
            </div>
          ))}
        </dl>

        {/* Technology chips */}
        <section className="animate-rise mt-12 [animation-delay:480ms] motion-reduce:animate-none">
          <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            Disciplines and technologies
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {TECHNOLOGY_CHIPS.map((chip) => (
              <Chip key={chip}>{chip}</Chip>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((item, index) => (
            <article
              key={item.title}
              /* Delay has to be inline: Tailwind only sees statically written
               * arbitrary values, so a template-built class would never compile. */
              style={{ animationDelay: `${540 + index * 80}ms` }}
              className="animate-rise relative rounded-lg border border-slate-200 p-5 transition duration-300 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-linear-to-r before:from-transparent before:via-card-highlight before:to-transparent before:opacity-0 before:transition-opacity before:duration-300 hover:-translate-y-0.5 hover:border-accent-line hover:shadow-lg hover:before:opacity-100 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
            </article>
          ))}
        </section>

        <section className="animate-rise mt-12 rounded-lg border border-slate-200 bg-slate-50 p-5 [animation-delay:860ms] motion-reduce:animate-none">
          <h2 className="text-sm font-semibold text-slate-900">The asset being modelled</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            A single-stage end-suction centrifugal pump (P-101) driven by a 4-pole single-phase
            induction motor (MTR-101), of the size used on a laboratory test rig:{' '}
            {PUMP.duty_flow_lpm} L/min at {PUMP.duty_head_m} m head, {PUMP.rated_speed_rpm} rpm.
            That scale is deliberate -- the numbers stay checkable by hand, so the model can be
            argued with rather than merely believed.
          </p>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500 sm:px-6">
          <p>
            PumpGuard DT &mdash; engineering portfolio prototype. Simulated data throughout. Not a
            certified condition-monitoring product and not intended for use on real plant.
          </p>
        </div>
      </footer>
    </div>
  )
}
