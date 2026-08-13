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
  Boxes,
  Compass,
  Gauge,
  LayoutDashboard,
  LineChart,
  Menu,
  Radio,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Stethoscope,
  ToyBrick,
  Waves,
  Wrench,
  X,
} from 'lucide-react'
import { useAppState, dataSourceLabel } from '../../state/AppState'
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
  { to: '/app/diagnosis', label: 'Fault Diagnosis', icon: Stethoscope },
  { to: '/app/simulation', label: 'Simulation Lab', icon: ToyBrick, advanced: true },
  { to: '/app/scada', label: 'SCADA Control', icon: SlidersHorizontal },
  { to: '/app/trends', label: 'Trends', icon: LineChart },
  { to: '/app/alarms', label: 'Alarms', icon: AlertTriangle },
  { to: '/app/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/app/engineering', label: 'Engineering', icon: Activity, advanced: true },
  { to: '/app/architecture', label: 'Architecture', icon: Compass },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
]

function ConnectionIndicator() {
  const { connection, demoMode, connecting, reconnectAttempts } = useAppState()
  if (connection === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
        <Radio className="h-3.5 w-3.5" aria-hidden />
        Live stream connected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <Radio className="h-3.5 w-3.5" aria-hidden />
      {connecting
        ? 'Connecting to backend...'
        : demoMode === 'interactive'
          ? 'Backend unreachable -- browser-side model'
          : `Backend unreachable -- retry ${reconnectAttempts}`}
    </span>
  )
}

/**
 * The provenance badge. It states SIMULATION when the backend simulator is
 * feeding us and RECORDED DEMO when the bundled dataset is. There is no code
 * path that makes it say anything else.
 */
function DataSourceBadge() {
  const { telemetry, connection } = useAppState()
  const label = dataSourceLabel(connection, telemetry)
  const isRecorded = label === 'RECORDED DEMO'
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${
        isRecorded ? 'border-amber-400 bg-amber-50' : 'border-blue-300 bg-blue-50'
      }`}
      title={
        isRecorded
          ? 'The backend could not be reached. A bundled recorded dataset is being replayed.'
          : 'Values are produced by a physics simulation, not a physical machine.'
      }
    >
      <ToneIcon tone={isRecorded ? 'warn' : 'info'} className="h-4 w-4" />
      <div className="leading-tight">
        <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Data source
        </p>
        <p
          className={`text-xs font-bold tracking-wide ${
            isRecorded ? 'text-amber-900' : 'text-blue-900'
          }`}
        >
          {label}
        </p>
      </div>
    </div>
  )
}

function Header({ onToggleNav }: { onToggleNav: () => void }) {
  const { telemetry } = useAppState()
  const state = assetStateStatus(telemetry.asset_state)
  const health = healthStatus(telemetry.health_index)

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
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
          <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-900 text-sm font-bold text-white">
            PG
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-semibold text-slate-900">PumpGuard DT</span>
            <span className="block text-[10px] tracking-wide text-slate-500 uppercase">
              MTR-101 / P-101
            </span>
          </span>
        </NavLink>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Asset state
            </span>
            <StatusBadge status={state} />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              Health
            </span>
            <span className="numeric text-sm font-semibold text-slate-900">
              {telemetry.health_index.toFixed(0)}
              <span className="text-xs font-normal text-slate-500"> / 100</span>
            </span>
            <StatusBadge status={health} size="sm" />
          </div>

          <DataSourceBadge />
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-1">
        <ConnectionIndicator />
        <span className="hidden text-xs text-slate-500 sm:block">
          Simulated asset -- engineering portfolio prototype
        </span>
      </div>
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
      } w-full shrink-0 border-b border-slate-200 bg-white lg:block lg:w-60 lg:border-r lg:border-b-0`}
      aria-label="Main navigation"
    >
      <ul className="sticky top-28 max-h-[calc(100vh-7rem)] overflow-y-auto p-2">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
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
        <main className="min-w-0 flex-1 p-4 lg:p-6" key={location.pathname}>
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
      className="fixed inset-0 z-10 bg-slate-900/10 lg:hidden"
      onClick={onClose}
    >
      <X className="sr-only" />
    </button>
  )
}
