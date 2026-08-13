/**
 * Dashboard: the one screen that answers "what is this machine doing right now?"
 *
 * Every reading carries its unit and its instrument tag. Nothing is a bare
 * number, because a bare number on a condition-monitoring screen is an
 * invitation to misread it.
 */

import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { assetStateStatus, healthStatus, limitStatus, severityStatus } from '../lib/status'
import { fmt, fmtPercent, fmtUnit, fmtClock, humanise } from '../lib/format'
import { ASSET_TAGS, MOTOR } from '../lib/pumpPhysics'
import { iso10816Zone } from '../lib/vibration'
import { Card, DefinitionRow, Meter, PageHeading, ProvenanceNote, StatTile, StatusBadge } from '../components/ui'
import { TrendChart } from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

export function Dashboard() {
  const { telemetry, diagnosis, history, connection, alarms } = useAppState()
  const state = assetStateStatus(telemetry.asset_state)
  const health = healthStatus(telemetry.health_index)
  const severity = severityStatus(diagnosis.severity_label)
  const zone = iso10816Zone(telemetry.vibration_rms_mm_s)
  const activeAlarms = alarms.filter((alarm) => alarm.state === 'ACTIVE')

  const trendWindow = history.slice(-240)

  return (
    <div className="space-y-5">
      <PageHeading
        title="Dashboard"
        description="Live condition of the MTR-101 / P-101 motor-pump set. All values are engineering quantities with units; none are decorative."
      />

      {/* --- headline condition -------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Asset state">
          <div className="flex items-center gap-3">
            <StatusBadge status={state} />
          </div>
          <p className="mt-2 text-sm text-slate-600">{state.detail}</p>
          <dl className="mt-3">
            <DefinitionRow label="Speed" value={fmtUnit(telemetry.rpm, 'rpm', 0)} />
            <DefinitionRow
              label="Rotational frequency"
              value={fmtUnit(telemetry.rotational_frequency_hz, 'Hz', 2)}
            />
            <DefinitionRow label="Last update" value={fmtClock(telemetry.timestamp)} />
            <DefinitionRow
              label="Active alarms"
              value={String(activeAlarms.length)}
              tone={activeAlarms.length > 0 ? 'alarm' : 'ok'}
            />
          </dl>
        </Card>

        <Card title="Health index">
          <div className="flex items-baseline gap-2">
            <span className="numeric text-4xl font-semibold text-slate-900">
              {fmt(telemetry.health_index, 0)}
            </span>
            <span className="text-sm text-slate-500">/ 100</span>
            <span className="ml-auto">
              <StatusBadge status={health} />
            </span>
          </div>
          <div className="mt-3">
            <Meter value={telemetry.health_index} tone={health.tone} label="Health index" />
          </div>
          <p className="mt-2 text-sm text-slate-600">{health.detail}</p>
          <dl className="mt-3">
            <DefinitionRow label="Anomaly score" value={fmt(telemetry.anomaly_score, 2)} />
            <DefinitionRow
              label="Vibration zone"
              value={`ISO 10816-3 zone ${zone.zone}`}
              tone={zone.zone === 'A' || zone.zone === 'B' ? 'ok' : zone.zone === 'C' ? 'warn' : 'alarm'}
            />
          </dl>
        </Card>

        <Card
          title="Current diagnosis"
          actions={
            <Link to="/app/diagnosis" className="btn btn-secondary px-2 py-1 text-xs">
              Evidence
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        >
          <p className="text-lg font-semibold text-slate-900">
            {humanise(diagnosis.detected_condition)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={severity} size="sm" />
            <span className="text-xs text-slate-600">
              Confidence {fmtPercent(diagnosis.confidence, 0)}
            </span>
          </div>
          {diagnosis.physics_model_conflict && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              Physics rules and the classifier disagree -- see the diagnosis page.
            </p>
          )}
          <p className="mt-3 text-sm text-slate-600">
            {diagnosis.recommended_actions[0] ?? 'No recommended action.'}
          </p>
        </Card>
      </div>

      {/* --- process values ------------------------------------------------- */}
      <Card title="Process values" subtitle="Instrument tag shown against each reading">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Speed"
            value={fmt(telemetry.rpm, 0)}
            unit="rpm"
            tag={ASSET_TAGS.speed}
          />
          <StatTile
            label="Flow"
            value={fmt(telemetry.flow_lpm, 1)}
            unit="L/min"
            tag={ASSET_TAGS.flow}
          />
          <StatTile label="Pump head" value={fmt(telemetry.pump_head_m, 2)} unit="m" tag="derived" />
          <StatTile
            label="Differential pressure"
            value={fmt(telemetry.differential_pressure_kpa, 1)}
            unit="kPa"
            tag="PT-102 - PT-101"
          />
          <StatTile
            label="Suction pressure"
            value={fmt(telemetry.suction_pressure_kpa, 1)}
            unit="kPa abs"
            tag={ASSET_TAGS.suction_pressure}
          />
          <StatTile
            label="Discharge pressure"
            value={fmt(telemetry.discharge_pressure_kpa, 1)}
            unit="kPa abs"
            tag={ASSET_TAGS.discharge_pressure}
          />
          <StatTile
            label="Motor current"
            value={fmt(telemetry.motor_current_a, 2)}
            unit="A"
            tag={ASSET_TAGS.current}
            status={limitStatus(telemetry.motor_current_a, MOTOR.rated_current_a, MOTOR.rated_current_a * 1.15)}
          />
          <StatTile
            label="NPSH margin"
            value={fmt(telemetry.npsh_margin_m, 2)}
            unit="m"
            tag="derived"
            status={
              telemetry.npsh_margin_m < 0
                ? { tone: 'alarm', label: 'CAVITATING', detail: 'NPSHa below NPSHr' }
                : telemetry.npsh_margin_m < 0.5
                  ? { tone: 'warn', label: 'LOW MARGIN', detail: 'Below 0.5 m' }
                  : { tone: 'ok', label: 'ADEQUATE', detail: 'Above 0.5 m' }
            }
          />
          <StatTile
            label="Motor temperature"
            value={fmt(telemetry.motor_temperature_c, 1)}
            unit="degC"
            tag={ASSET_TAGS.motor_temperature}
            status={limitStatus(telemetry.motor_temperature_c, 70, 78)}
          />
          <StatTile
            label="Bearing temperature"
            value={fmt(telemetry.bearing_temperature_c, 1)}
            unit="degC"
            tag={ASSET_TAGS.bearing_temperature}
            status={limitStatus(telemetry.bearing_temperature_c, 55, 62)}
          />
          <StatTile
            label="Vibration RMS"
            value={fmt(telemetry.vibration_rms_mm_s, 2)}
            unit="mm/s"
            tag={ASSET_TAGS.accelerometer}
            status={limitStatus(telemetry.vibration_rms_mm_s, 1.8, 4.5)}
            hint={`Zone ${zone.zone}: ${zone.label}`}
          />
          <StatTile
            label="Pump efficiency"
            value={fmt(telemetry.pump_efficiency * 100, 1)}
            unit="%"
            tag="derived"
          />
          <StatTile
            label="Hydraulic power"
            value={fmt(telemetry.hydraulic_power_w, 1)}
            unit="W"
            tag="rho g Q H"
          />
          <StatTile
            label="Shaft power"
            value={fmt(telemetry.shaft_power_w, 1)}
            unit="W"
            tag="derived"
          />
          <StatTile
            label="Electrical power"
            value={fmt(telemetry.electrical_power_w, 1)}
            unit="W"
            tag="derived"
          />
          <StatTile
            label="1x amplitude"
            value={fmt(telemetry.amplitude_1x_mm_s, 2)}
            unit="mm/s"
            tag={ASSET_TAGS.accelerometer}
          />
        </div>
        <div className="mt-3">
          <ProvenanceNote>
            {connection === 'live'
              ? 'Values are streaming from the backend physics simulation over the realtime websocket.'
              : 'The backend is not reachable. These values are a bundled recorded demonstration dataset, replayed in the browser.'}
          </ProvenanceNote>
        </div>
      </Card>

      {/* --- short-window trends -------------------------------------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ErrorBoundary panelName="Vibration trend" compact>
          <Card title="Vibration RMS" subtitle="Last 2 minutes">
            <TrendChart
              data={trendWindow}
              dataKey="vibration_rms_mm_s"
              name="Vibration RMS"
              unit="mm/s"
              warningLevel={4.5}
            />
          </Card>
        </ErrorBoundary>
        <ErrorBoundary panelName="Flow trend" compact>
          <Card title="Flow" subtitle="Last 2 minutes">
            <TrendChart data={trendWindow} dataKey="flow_lpm" name="Flow" unit="L/min" />
          </Card>
        </ErrorBoundary>
      </div>
    </div>
  )
}
