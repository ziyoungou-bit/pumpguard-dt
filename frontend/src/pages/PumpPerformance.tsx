/**
 * Pump Performance.
 *
 * The point of this page is that flow is not a number someone chose -- it is
 * where the pump curve crosses the system curve. Closing the valve raises the
 * system resistance K, which steepens the system curve, which slides the
 * intersection up and to the left. Head rises, flow falls, efficiency drops
 * away from BEP. The slider makes that visible.
 */

import { useMemo } from 'react'
import { useAppState } from '../state/AppState'
import {
  CIRCUIT,
  PUMP,
  curveSeries,
  lpmToM3s,
  npshAvailableM,
  npshRequiredM,
  systemResistance,
} from '../lib/pumpPhysics'
import { fmt, fmtUnit } from '../lib/format'
import { Card, DefinitionRow, Notice, PageHeading, RangeSlider, StatTile } from '../components/ui'
import { EfficiencyCurveChart, PumpCurveChart } from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

export function PumpPerformance() {
  const { telemetry, valveOpening, setValveOpening, connection } = useAppState()

  const speedRpm = Math.max(1, telemetry.rpm)
  const curve = useMemo(() => curveSeries(speedRpm, valveOpening), [speedRpm, valveOpening])

  const flowM3s = lpmToM3s(telemetry.flow_lpm)
  const npshA = npshAvailableM(flowM3s)
  const npshR = npshRequiredM(telemetry.flow_lpm)

  const marginStatus =
    telemetry.npsh_margin_m < 0
      ? { tone: 'alarm' as const, label: 'CAVITATING', detail: 'NPSHa is below NPSHr' }
      : telemetry.npsh_margin_m < 0.5
        ? { tone: 'warn' as const, label: 'LOW MARGIN', detail: 'Below the 0.5 m guideline' }
        : { tone: 'ok' as const, label: 'ADEQUATE', detail: 'Above the 0.5 m guideline' }

  const flowDeviationPct =
    PUMP.bep_flow_lpm > 0 ? ((telemetry.flow_lpm - PUMP.bep_flow_lpm) / PUMP.bep_flow_lpm) * 100 : 0

  return (
    <div className="space-y-5">
      <PageHeading
        title="Pump Performance"
        description="The operating point is the intersection of the pump characteristic and the system characteristic. Everything else on this page follows from it."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ErrorBoundary panelName="Pump and system curves" compact>
          <Card
            title="Pump curve and system curve"
            subtitle={`At ${fmt(speedRpm, 0)} rpm with the valve ${fmt(valveOpening * 100, 0)} % open`}
          >
            <PumpCurveChart
              data={curve}
              operatingFlowLpm={telemetry.flow_lpm}
              operatingHeadM={telemetry.pump_head_m}
            />
            <div className="mt-4">
              <EfficiencyCurveChart
                data={curve}
                operatingFlowLpm={telemetry.flow_lpm}
                operatingEfficiencyPct={telemetry.pump_efficiency * 100}
                bepFlowLpm={PUMP.bep_flow_lpm}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Head and efficiency are plotted separately rather than on a shared pair of axes. A
              dual-axis plot invites a comparison between two unrelated scales, and the point where
              the curves appear to cross means nothing.
            </p>
          </Card>
        </ErrorBoundary>

        <div className="space-y-4">
          <Card title="Control valve">
            <RangeSlider
              label="Valve opening"
              value={valveOpening * 100}
              min={5}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => setValveOpening(value / 100)}
              help="Closing the valve raises system resistance K, steepening the system curve and moving the operating point up the pump curve."
            />
            <dl className="mt-4">
              <DefinitionRow
                label="System resistance K"
                value={`${(systemResistance(valveOpening) / 1e7).toFixed(2)}e7 m/(m3/s)2`}
              />
              <DefinitionRow
                label="Static head H_static"
                value={fmtUnit(CIRCUIT.static_head_m, 'm', 1)}
              />
              <DefinitionRow label="Shutoff head H0" value={fmtUnit(PUMP.shutoff_head_m, 'm', 1)} />
              <DefinitionRow
                label="Deviation from BEP flow"
                value={`${flowDeviationPct >= 0 ? '+' : ''}${fmt(flowDeviationPct, 1)} %`}
                tone={Math.abs(flowDeviationPct) > 30 ? 'warn' : 'ok'}
              />
            </dl>
            {connection !== 'live' && (
              <p className="mt-3 text-xs text-slate-500">
                The backend is unreachable, so the valve is driven by the browser-side plant model.
                The response you see is computed from the same equations the backend uses.
              </p>
            )}
          </Card>

          <Card title="NPSH">
            <dl>
              <DefinitionRow label="NPSH available" value={fmtUnit(npshA, 'm', 2)} />
              <DefinitionRow label="NPSH required" value={fmtUnit(npshR, 'm', 2)} />
              <DefinitionRow
                label="Margin (NPSHa - NPSHr)"
                value={fmtUnit(telemetry.npsh_margin_m, 'm', 2)}
                tone={marginStatus.tone}
              />
            </dl>
            {telemetry.npsh_margin_m < 0.5 && (
              <div className="mt-3">
                <Notice tone={telemetry.npsh_margin_m < 0 ? 'alarm' : 'warn'} title={marginStatus.label}>
                  {telemetry.npsh_margin_m < 0
                    ? 'Available suction head has fallen below what the pump requires. Vapour bubbles will form at the impeller eye and collapse in the volute -- this pits the impeller.'
                    : 'The suction margin is thin. Any further rise in suction losses or fall in reservoir level will start cavitation.'}
                </Notice>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title="Operating point" subtitle="All quantities derived from the intersection">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Flow" value={fmt(telemetry.flow_lpm, 2)} unit="L/min" tag="FT-101" />
          <StatTile label="Head" value={fmt(telemetry.pump_head_m, 2)} unit="m" tag="derived" />
          <StatTile
            label="Pump efficiency"
            value={fmt(telemetry.pump_efficiency * 100, 1)}
            unit="%"
            tag="derived"
          />
          <StatTile
            label="NPSH margin"
            value={fmt(telemetry.npsh_margin_m, 2)}
            unit="m"
            tag="derived"
            status={marginStatus}
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
            tag="P_hyd / eta + drag"
          />
          <StatTile
            label="Electrical power"
            value={fmt(telemetry.electrical_power_w, 1)}
            unit="W"
            tag="P_shaft / eta_motor"
          />
          <StatTile
            label="Differential pressure"
            value={fmt(telemetry.differential_pressure_kpa, 1)}
            unit="kPa"
            tag="PT-102 - PT-101"
          />
        </div>
      </Card>
    </div>
  )
}
