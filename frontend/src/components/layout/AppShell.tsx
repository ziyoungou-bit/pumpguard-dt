/**
 * Application shell: persistent header, navigation, and the routed page area.
 *
 * The header carries the three facts a viewer must never have to hunt for:
 * what state the asset is in, how healthy it is, and -- most importantly --
 * where the numbers came from. The DATA SOURCE badge is deliberately the
 * loudest element in the header.
 */

import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Boxes,
  Compass,
  Gauge,
  LayoutDashboard,
  LineChart,
  Loader2,
  Menu,
  Radio,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Stethoscope,
  ToyBrick,
  Waves,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { useAppState, dataSourceLabel, datasetClock } from '../../state/AppState'
import { useUiPrefs } from '../../state/UiPrefs'
import { assetStateStatus, healthStatus } from '../../lib/status'
import { StatusBadge, ToneIcon } from '../ui'
import { GuidedTour } from '../GuidedTour'

interface NavItem {
  to: string
  label: string
  icon: typeof Gauge
  /** Hidden in Recruiter Mode: engineer-facing depth rather than the story. */
  advanced?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/digital-twin', label: 'Digital Twin', icon: Boxes },
  { to: '/app/vibration', label: 'Vibration Analysis', icon: Waves },
  { to: '/app/pump-performance', label: 'Pump Performance', icon: Gauge },
  { to: '/app/energy', label: 'Energy: VSD vs Throttle', icon: Zap },
  { to: '/app/diagnosis', label: 'Fault Diagnosis', icon: Stethoscope },
  { to: '/app/simulation', label: 'Simulation Lab', icon: ToyBrick, advanced: true },
  { to: '/app/scada', label: 'SCADA Control', icon: SlidersHorizontal },
  { to: '/app/trends', label: 'Trends', icon: LineChart },
  { to: '/app/alarms', label: 'Alarms', icon: AlertTriangle },
  { to: '/app/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/app/engineering', label: 'Engineering', icon: Activity, advanced: true },
  { to: '/app/model-performance', label: 'Model Performance', icon: BrainCircuit },
  { to: '/app/architecture', label: 'Architecture', icon: Compass },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
]

function ConnectionIndicator() {
  const { connection, demoMode, wakingUp, waitingSeconds, reconnectAttempts } = useAppState()
  if (connection === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-state-ok">
        <Radio className="h-3.5 w-3.5" aria-hidden />
        Live stream connected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
      <Radio className="h-3.5 w-3.5" aria-hidden />
      {wakingUp
        ? `Backend waking up -- ${waitingSeconds} s`
        : demoMode === 'interactive'
          ? 'Backend unreachable -- browser-side model'
          : `Backend unreachable -- retry ${reconnectAttempts}`}
    </span>
  )
}

/**
 * Cold-start banner.
 *
 * The API runs on a free Render instance that sleeps after about 15 minutes
 * idle and takes close to a minute to wake. A visitor arriving during that
 * window used to be told "the backend is not reachable" from the first second,
 * which is true and useless: it reads as broken rather than as starting, and
 * the honest wait is shorter than the patience that message buys. So the wait
 * is named, timed, and given an end.
 *
 * The recording keeps playing underneath. That is the other half of the fix --
 * there is never a screen of zeros to mistake for a failed load.
 */
function ColdStartBanner() {
  const { connection, wakingUp, waitingSeconds, coldStartWindowSeconds } = useAppState()
  if (connection === 'live' || !wakingUp) return null
  const progress = Math.min(100, (waitingSeconds / coldStartWindowSeconds) * 100)
  return (
    <div className="border-b border-state-warn-line bg-state-warn-bg px-4 py-2.5" role="status" aria-live="polite">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-state-warn" aria-hidden />
        <p className="text-sm font-medium text-state-warn-on-bg">
          Backend waking up -- cold start takes up to 60 s
        </p>
        <p className="text-xs text-state-warn-note">
          The API sleeps when idle on its free tier. Meanwhile you are watching the bundled
          recording, not live data. Retrying automatically ({waitingSeconds} s elapsed).
        </p>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-state-warn-line-soft"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Backend cold start progress"
        >
          <div
            className="h-full rounded-full bg-state-warn-fill transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The provenance badge. SIMULATION when the backend simulator is feeding us,
 * REPLAY MODE when the bundled recording is, BROWSER MODEL when the plant model
 * in this tab is. There is no code path that makes it say anything else, and no
 * path on which an offline page is styled like a live one.
 */
function DataSourceBadge() {
  const { telemetry, connection, demoMode } = useAppState()
  const label = dataSourceLabel(connection, telemetry, demoMode)
  const isOffline = connection !== 'live'
  const isReplay = isOffline && demoMode === 'replay'
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${
        isOffline ? 'border-state-warn-line-strong bg-state-warn-bg' : 'border-accent-line bg-accent-soft'
      }`}
      title={
        isReplay
          ? 'The backend could not be reached. A bundled recorded dataset is being replayed. Timestamps are dataset time, not your clock.'
          : isOffline
            ? 'The backend could not be reached. The plant model is running in this browser tab and responds to the controls.'
            : 'Values are produced by a physics simulation, not a physical machine.'
      }
    >
      <ToneIcon tone={isOffline ? 'warn' : 'info'} className="h-4 w-4" />
      <div className="leading-tight">
        <p className="text-[10px] font-semibold tracking-wider text-ink-label uppercase">
          Data source
        </p>
        <p
          className={`text-xs font-bold tracking-wide ${
            isOffline ? 'text-state-warn-on-bg' : 'text-accent-on-bg-strong'
          }`}
        >
          {label}
        </p>
      </div>
      {isReplay && (
        <span
          className="numeric ml-1 rounded border border-state-warn-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-state-warn-on-bg"
          title="Position in the recording. Dataset time, not your local clock."
        >
          t+{datasetClock(telemetry.elapsed_s)}
        </span>
      )}
    </div>
  )
}

function Header({ onToggleNav }: { onToggleNav: () => void }) {
  const { telemetry } = useAppState()
  const state = assetStateStatus(telemetry.asset_state)
  const health = healthStatus(telemetry.health_index)

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      {/* The one piece of brand decoration in the application shell: a 2px
        * accent rule across the full width, sitting above everything the header
        * carries. Deliberately not a blurred/translucent header -- the three.js
        * canvas scrolls underneath this bar, and backdrop-blur over a live WebGL
        * surface costs real frames to produce an effect nobody can see on a
        * header that is already opaque. */}
      <div
        className="h-0.5 w-full bg-linear-to-r from-brand-rule-from via-brand-rule-via to-brand-rule-to"
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <button
          type="button"
          className="btn btn-secondary px-2 py-1.5 lg:hidden"
          onClick={onToggleNav}
          aria-label="Toggle navigation"
        >
          <Menu className="h-4 w-4" aria-hidden />
        </button>

        <NavLink to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-ink text-sm font-bold text-ink-inverse">
            PG
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-semibold text-ink">PumpGuard DT</span>
            <span className="block text-[10px] tracking-wide text-ink-label uppercase">
              MTR-101 / P-101
            </span>
          </span>
        </NavLink>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-ink-label uppercase">
              Asset state
            </span>
            <StatusBadge status={state} />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-ink-label uppercase">
              Health
            </span>
            <span className="numeric text-sm font-semibold text-ink">
              {telemetry.health_index.toFixed(0)}
              <span className="text-xs font-normal text-ink-label"> / 100</span>
            </span>
            <StatusBadge status={health} size="sm" />
          </div>

          <DataSourceBadge />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line-divider px-4 py-1">
        <ConnectionIndicator />
        <span className="hidden text-xs text-ink-label sm:block">
          Simulated asset -- engineering portfolio prototype
        </span>
      </div>
      <ColdStartBanner />
    </header>
  )
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { recruiterMode } = useUiPrefs()
  const items = NAV_ITEMS.filter((item) => !(recruiterMode && item.advanced))

  return (
    <nav
      className={`${
        open ? 'block' : 'hidden'
      } w-full shrink-0 border-b border-line bg-surface lg:block lg:w-60 lg:border-r lg:border-b-0`}
      aria-label="Main navigation"
    >
      <ul className="sticky top-28 max-h-[calc(100vh-7rem)] overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? /* 3px gradient marker down the left edge. It is redundant
                       * with the tint and with aria-current, which is the point:
                       * the active row should be findable in a 15-item list at a
                       * glance, not only by hue. */
                      'bg-accent-soft text-accent-on-bg before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-linear-to-b before:from-nav-active-from before:to-nav-active-to'
                    : 'text-ink-body hover:bg-line-divider hover:text-ink'
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="flex min-h-screen flex-col">
      <Header onToggleNav={() => setNavOpen((open) => !open)} />
      <div className="flex flex-1 flex-col lg:flex-row">
        <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        {/* key= remounts the subtree on every route change, which is what gives
          * the fade something to fade. Opacity only and 150ms: a page turn
          * should settle, not travel. */}
        <main
          className="animate-page-in min-w-0 flex-1 p-4 motion-reduce:animate-none lg:p-6"
          key={location.pathname}
        >
          <Outlet />
        </main>
      </div>
      <GuidedTour />
      <MobileNavScrim open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  )
}

function MobileNavScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <button
      type="button"
      aria-label="Close navigation"
      className="fixed inset-0 z-10 bg-ink/10 lg:hidden"
      onClick={onClose}
    >
      <X className="sr-only" />
    </button>
  )
}
