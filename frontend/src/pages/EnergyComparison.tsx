/**
 * Throttling versus variable speed.
 *
 * Every other page answers "what is this machine doing". This one answers the
 * question a building-services engineer is actually paid to answer: the flow
 * needs to come down, so do you close a valve or slow the pump, and what does
 * the difference cost over a year?
 *
 * Both paths are solved with the hydraulics already in lib/pumpPhysics -- the
 * same curve intersection, the same efficiency on reduced flow, the same N^3
 * drag. No coefficient is introduced here. What is introduced is the contrast
 * with the affinity-law shortcut, because that shortcut is how these business
 * cases come out optimistic and it is the most useful thing this page can say.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CIRCUIT, PUMP, lpmToM3s, pumpHead, systemHead } from '../lib/pumpPhysics'
import { annualEnergy, compareAtFlow, maxFlowLpm, type OperatingPath } from '../lib/energy'
import { fmt, fmtUnit } from '../lib/format'
import { Card, DefinitionRow, Notice, PageHeading, RangeSlider, StatTile } from '../components/ui'
import { VsdComparisonChart } from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

const MIN_TARGET_LPM = 5
const DEFAULT_HOURS_PER_YEAR = 4000
const DEFAULT_TARIFF_AUD = 0.3

function PathColumn({ path, accent }: { path: OperatingPath; accent: string }) {
  return (
    <div className={`rounded-lg border-2 p-4 ${accent}`}>
      <h3 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">{path.label}</h3>
      <dl className="mt-3">
        <DefinitionRow label="Speed N" value={fmtUnit(path.speed_rpm, 'rpm', 0)} />
        <DefinitionRow label="Valve opening" value={`${fmt(path.valve_opening * 100, 0)} %`} />
        <DefinitionRow label="Head H" value={fmtUnit(path.head_m, 'm', 2)} />
        <DefinitionRow
          label="Pump efficiency"
          value={`${fmt(path.pump_efficiency * 100, 1)} %`}
        />
        <DefinitionRow
          label="Overall (wire-to-water)"
          value={`${fmt(path.overall_efficiency * 100, 1)} %`}
        />
        <DefinitionRow label="Hydraulic power" value={fmtUnit(path.hydraulic_power_w, 'W', 1)} />
        <DefinitionRow label="Parasitic drag" value={fmtUnit(path.parasitic_power_w, 'W', 1)} />
        <DefinitionRow label="Shaft power" value={fmtUnit(path.shaft_power_w, 'W', 1)} />
        <DefinitionRow label="Electrical power" value={fmtUnit(path.electrical_power_w, 'W', 1)} />
        <DefinitionRow label="Motor current" value={fmtUnit(path.motor_current_a, 'A', 3)} />
      </dl>
    </div>
  )
}

export function EnergyComparison() {
  const maxFlow = useMemo(() => maxFlowLpm(), [])
  const [targetFlow, setTargetFlow] = useState<number>(15)
  const [hoursPerYear, setHoursPerYear] = useState<number>(DEFAULT_HOURS_PER_YEAR)
  const [tariff, setTariff] = useState<number>(DEFAULT_TARIFF_AUD)

  const clampedTarget = Math.min(maxFlow, Math.max(MIN_TARGET_LPM, targetFlow))
  const comparison = useMemo(() => compareAtFlow(clampedTarget), [clampedTarget])
  const annual = useMemo(
    () => (comparison ? annualEnergy(comparison, hoursPerYear, tariff) : null),
    [comparison, hoursPerYear, tariff],
  )

  const curve = useMemo(() => {
    if (!comparison) return []
    const points = 72
    const maxPlot = Math.ceil(maxFlow + 4)
    return Array.from({ length: points + 1 }, (_, i) => {
      const flowLpm = (maxPlot * i) / points
      const flowM3s = lpmToM3s(flowLpm)
      return {
        flow_lpm: Number(flowLpm.toFixed(2)),
        rated_pump_head_m: Number(pumpHead(flowM3s, PUMP.rated_speed_rpm).toFixed(3)),
        vsd_pump_head_m: Number(pumpHead(flowM3s, comparison.vsd.speed_rpm).toFixed(3)),
        open_system_head_m: Number(systemHead(flowM3s, 1).toFixed(3)),
        throttled_system_head_m: Number(
          systemHead(flowM3s, comparison.throttle.valve_opening).toFixed(3),
        ),
      }
    })
  }, [comparison, maxFlow])

  if (!comparison || !annual) {
    return (
      <div className="space-y-5">
        <PageHeading title="Energy: throttling vs variable speed" description="" />
        <Notice tone="warn" title="Target flow unreachable">
          This pump cannot deliver {fmt(clampedTarget, 1)} L/min against the circuit's{' '}
          {CIRCUIT.static_head_m} m static head.
        </Notice>
      </div>
    )
  }

  const headDestroyed = comparison.throttle.head_m - comparison.vsd.head_m
  const savingPct = comparison.saving_fraction * 100
  const naivePct = comparison.naive_cube_law_saving_fraction * 100

  return (
    <div className="space-y-5">
      <PageHeading
        title="Energy: throttling vs variable speed"
        description="The same flow reached two ways. Throttling climbs up the pump curve and burns the extra head across a valve; variable speed shrinks the curve to meet the duty. Both paths are solved with the hydraulics used everywhere else on this site."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card title="Duty" subtitle="What the process actually needs">
          <RangeSlider
            label="Target flow"
            value={clampedTarget}
            min={MIN_TARGET_LPM}
            max={Math.floor(maxFlow)}
            step={0.5}
            unit="L/min"
            onChange={setTargetFlow}
            help={`At ${fmt(maxFlow, 1)} L/min the valve is wide open and the pump is at rated speed, so both paths are the same machine and the saving must be zero.`}
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Electrical saving"
              value={fmt(savingPct, 1)}
              unit="%"
              tag="variable speed"
              status={
                savingPct > 25
                  ? { tone: 'ok', label: 'WORTH DOING', detail: 'Substantial saving at this duty' }
                  : savingPct > 5
                    ? { tone: 'warn', label: 'MARGINAL', detail: 'Check the payback carefully' }
                    : { tone: 'warn', label: 'NEGLIGIBLE', detail: 'Near the rated duty point' }
              }
            />
            <StatTile
              label="Head burned across the valve"
              value={fmt(headDestroyed, 2)}
              unit="m"
              tag="throttled - VSD"
              hint="Generated by the impeller, then destroyed as heat and noise in the valve."
            />
          </div>
        </Card>

        <ErrorBoundary panelName="H-Q comparison" compact>
          <Card
            title="One flow, two directions"
            subtitle="Throttling goes up and left; variable speed goes down and left"
          >
            <VsdComparisonChart
              data={curve}
              throttlePoint={{
                flow_lpm: comparison.throttle.flow_lpm,
                head_m: comparison.throttle.head_m,
              }}
              vsdPoint={{ flow_lpm: comparison.vsd.flow_lpm, head_m: comparison.vsd.head_m }}
            />
            <p className="mt-3 text-xs text-slate-500">
              The vertical gap between the two markers is {fmt(headDestroyed, 2)} m of head the
              throttled pump generates and then throws away across the valve. Closing a valve does
              not reduce what the pump does; it makes the pump work against the restriction you
              added.
            </p>
          </Card>
        </ErrorBoundary>
      </div>

      <Card title="Side by side" subtitle={`Both delivering ${fmt(clampedTarget, 1)} L/min`}>
        <div className="grid gap-4 lg:grid-cols-2">
          <PathColumn path={comparison.throttle} accent="border-orange-300 bg-orange-50/40" />
          <PathColumn path={comparison.vsd} accent="border-blue-300 bg-blue-50/40" />
        </div>
        <p className="mt-4 text-xs text-slate-500">
          The efficiency row is the part worth reading twice. Throttling leaves the pump at rated
          speed but drags the operating point away from BEP, so pump efficiency falls to{' '}
          {fmt(comparison.throttle.pump_efficiency * 100, 1)} %. Variable speed moves the BEP with
          the pump -- efficiency is read on the reduced flow Q N_rated / N -- so it stays near the
          peak at {fmt(comparison.vsd.pump_efficiency * 100, 1)} %. The drag term helps too: it
          scales with N^3, falling from {fmt(comparison.throttle.parasitic_power_w, 1)} W to{' '}
          {fmt(comparison.vsd.parasitic_power_w, 1)} W.
        </p>
      </Card>

      <Card
        title="Why the saving is smaller than the affinity laws promise"
        subtitle="The most useful number on this page"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Affinity-law estimate"
            value={fmt(naivePct, 1)}
            unit="%"
            tag="1 - (Q/Q_rated)^3"
          />
          <StatTile
            label="Actual saving"
            value={fmt(savingPct, 1)}
            unit="%"
            tag="from the solved circuit"
          />
          <StatTile
            label="Overstatement"
            value={fmt(naivePct - savingPct, 1)}
            unit="points"
            tag="optimism"
            status={
              naivePct - savingPct > 10
                ? { tone: 'warn', label: 'SIGNIFICANT', detail: 'Static head dominates' }
                : { tone: 'ok', label: 'SMALL', detail: 'Mostly friction system' }
            }
          />
        </div>
        <p className="mt-4 text-sm text-slate-600">
          P ~ N^3 with N ~ Q predicts a {fmt(naivePct, 0)} % saving. The circuit delivers{' '}
          {fmt(savingPct, 0)} %. The gap is the {CIRCUIT.static_head_m} m of static head: the
          affinity laws describe points on the <em>pump</em> curve, and the operating point only
          travels along them when the system curve passes through the origin. A pump with a
          geometric lift in front of it must still generate that lift at any speed, so speed cannot
          fall in proportion to flow and the cube never applies exactly.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          On this circuit the error is modest, because static head is only{' '}
          {fmt((CIRCUIT.static_head_m / Math.max(comparison.throttle.head_m, 0.001)) * 100, 0)} % of
          the throttled duty head. The reason to show it at all is that it grows with the static
          fraction and it grows in the optimistic direction. A mostly-friction system -- a closed
          chilled-water loop -- is where the cube law nearly holds and the savings really are
          dramatic; a tall riser, where static head is most of the duty, is where sizing a retrofit
          on the cube law promises savings the system cannot deliver. Knowing which one is in front
          of you is the job.
        </p>
      </Card>

      <Card title="Annual energy and cost" subtitle="Linear in both inputs -- no load profile is assumed">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-4">
            <RangeSlider
              label="Running hours"
              value={hoursPerYear}
              min={500}
              max={8760}
              step={100}
              unit="h/yr"
              onChange={setHoursPerYear}
              help="8760 h is continuous operation."
            />
            <RangeSlider
              label="Electricity tariff"
              value={tariff}
              min={0.1}
              max={0.6}
              step={0.01}
              unit="AUD/kWh"
              onChange={setTariff}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Throttling"
              value={fmt(annual.throttle_kwh, 1)}
              unit="kWh/yr"
              tag={`${fmt(annual.throttle_aud, 2)} AUD/yr`}
            />
            <StatTile
              label="Variable speed"
              value={fmt(annual.vsd_kwh, 1)}
              unit="kWh/yr"
              tag={`${fmt(annual.vsd_aud, 2)} AUD/yr`}
            />
            <StatTile
              label="Energy saved"
              value={fmt(annual.saved_kwh, 1)}
              unit="kWh/yr"
              tag="throttling - VSD"
            />
            <StatTile
              label="Cost saved"
              value={fmt(annual.saved_aud, 2)}
              unit="AUD/yr"
              tag={`at ${fmt(tariff, 2)} AUD/kWh`}
            />
          </div>
        </div>
        <Notice tone="info" title="Scale, stated plainly">
          This is a laboratory-scale machine: {fmt(comparison.throttle.electrical_power_w, 0)} W, so
          the annual figures are tens of dollars and no drive would ever be fitted for them. The
          physical relationships are the ones that matter, and they do not change with size. A
          building's chilled-water or condenser-water pump is three orders of magnitude larger, the
          same {fmt(savingPct, 0)} % becomes tens of thousands of kilowatt-hours, and the arithmetic
          on this page is the arithmetic behind that business case.
        </Notice>
        <p className="mt-3 text-sm text-slate-600">
          The same calculation sits behind a <strong>NABERS Energy</strong> rating for an office
          base building, where pump and fan auxiliary energy is part of the measured consumption, and
          behind the <strong>NCC Section J</strong> provisions on the specific fan and pump power a
          new or upgraded system may draw. Variable-speed drives on pumps and fans are the standard
          first move in both, and the number that decides whether the move pays for itself is the
          one this page separates from its affinity-law approximation.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          The Simulation Lab's "close the valve and watch the head rise" prompt is the qualitative
          version of this page.{' '}
          <Link to="/app/simulation" className="font-medium text-blue-700 underline">
            Open the Simulation Lab
          </Link>{' '}
          to drive the valve directly, or{' '}
          <Link to="/app/pump-performance" className="font-medium text-blue-700 underline">
            Pump Performance
          </Link>{' '}
          to see the curves this comparison is solved from.
        </p>
      </Card>
    </div>
  )
}
