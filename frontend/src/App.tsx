/**
 * Routing. The landing page sits at `/`; everything operational lives under
 * `/app/*` behind the shell, so the shell's header and navigation mount once
 * and the websocket connection is not torn down when the visitor changes page.
 */

import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Landing } from './pages/Landing'
import { Dashboard } from './pages/Dashboard'
import { VibrationAnalysis } from './pages/VibrationAnalysis'
import { PumpPerformance } from './pages/PumpPerformance'
import { EnergyComparison } from './pages/EnergyComparison'
import { FaultDiagnosis } from './pages/FaultDiagnosis'
import { SimulationLab } from './pages/SimulationLab'
import { ScadaControl } from './pages/ScadaControl'
import { Trends } from './pages/Trends'
import { Alarms } from './pages/Alarms'
import { Maintenance } from './pages/Maintenance'
import { Engineering } from './pages/Engineering'
import { Architecture } from './pages/Architecture'
import { SettingsPage } from './pages/SettingsPage'

/**
 * The digital twin pulls in three.js, @react-three/fiber and drei -- around two
 * thirds of the JavaScript in the build. It is loaded on demand so a visitor
 * landing on the dashboard does not pay for a 3D engine they may never open.
 */
const DigitalTwinPage = lazy(() =>
  import('./pages/DigitalTwinPage').then((module) => ({ default: module.DigitalTwinPage })),
)

function PageLoading({ name }: { name: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm font-medium text-slate-700">Loading {name}...</p>
      <p className="mt-1 text-xs text-slate-500">
        The 3D engine is downloading. Every other page continues to update in the background.
      </p>
    </div>
  )
}

/** Each page gets its own boundary: one broken page must not blank the shell. */
function Page({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary panelName={name}>
      <Suspense fallback={<PageLoading name={name} />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Page name="Landing page"><Landing /></Page>} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<Page name="Dashboard"><Dashboard /></Page>} />
        <Route path="digital-twin" element={<Page name="Digital Twin"><DigitalTwinPage /></Page>} />
        <Route path="vibration" element={<Page name="Vibration Analysis"><VibrationAnalysis /></Page>} />
        <Route path="pump-performance" element={<Page name="Pump Performance"><PumpPerformance /></Page>} />
        <Route path="energy" element={<Page name="Energy: throttling vs variable speed"><EnergyComparison /></Page>} />
        <Route path="diagnosis" element={<Page name="Fault Diagnosis"><FaultDiagnosis /></Page>} />
        <Route path="simulation" element={<Page name="Simulation Lab"><SimulationLab /></Page>} />
        <Route path="scada" element={<Page name="SCADA Control"><ScadaControl /></Page>} />
        <Route path="trends" element={<Page name="Trends"><Trends /></Page>} />
        <Route path="alarms" element={<Page name="Alarms"><Alarms /></Page>} />
        <Route path="maintenance" element={<Page name="Maintenance"><Maintenance /></Page>} />
        <Route path="engineering" element={<Page name="Engineering"><Engineering /></Page>} />
        <Route path="architecture" element={<Page name="Architecture"><Architecture /></Page>} />
        <Route path="settings" element={<Page name="Settings"><SettingsPage /></Page>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
