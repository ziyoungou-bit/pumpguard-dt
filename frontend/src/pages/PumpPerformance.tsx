/**
 * Pump Performance.
 *
 * The point of this page is that flow is not a number someone chose -- it is
 * where the pump curve crosses the system curve. Closing the valve raises the
 * system resistance K, which steepens the system curve, which slides the
 * intersection up and to the left. Head rises, flow falls, efficiency drops
 * away from BEP. The sliders make that visible.
 *
 * Model, not measurement. The four panels and the operating-point tiles are
 * solved here from (speed, valve, suction restriction) rather than read off the
 * live telemetry, so that the marked point is literally the intersection of the
 * two curves drawn above it. That is the page's whole claim, and reading the
 * point from one source while drawing the curves from another is how the claim
 * quietly stops being true. What the plant is actually doing is shown beside
 * it, labelled as measured, so the two can be compared rather than confused.
 *
 * The speed control is page-local on purpose: it sweeps the characteristic for
 * analysis and does not command the machine. Commanding speed belongs on the
 * SCADA page, where the interlocks are.
 */

import { useMemo, useState } from 'react'
import { useAppState } from '../state/AppState'
import {
  ANNEX_III_C_ESOB_1450_MEI_040,
  ANNEX_I_OVERLOAD,
  ANNEX_I_PART_LOAD,
  BEP_HEAD_M,
  CIRCUIT,
  CURVE_MAX_FLOW_LPM,
  MOTOR,
  PUMP,
  SPECIFIC_SPEED_NS,
  annexIIIMinimumEfficiency,
  bepFlowLpm,
  cavitationOnsetFlowLpm,
  curveSeries,
  lpmToM3s,
  motorSlip,
  npshAvailableM,
  npshRequiredM,
  pumpEfficiency,
  runoutFlowLpm,
  solveOperatingPoint,
  systemResistance,
} from '../lib/pumpPhysics'
import { fmt, fmtUnit } from '../lib/format'
import { Card, DefinitionRow, Formula, Notice, PageHeading, RangeSlider, StatTile } from '../components/ui'
import {
  EfficiencyCurveChart,
  NpshCurveChart,
  PowerCurveChart,
  PumpCurveChart,
} from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

/**
 * Speed sweep range. The lower bound is 300 rpm rather than zero because below
 * roughly 250 rpm this pump cannot lift the 2 m static head at all, and a
 * slider whose bottom third is a flat "no flow" region teaches nothing. Going
 * there is still possible -- and still handled -- via the no-intersection case.
 */
const SPEED_MIN_RPM = 300
const SPEED_MAX_RPM = 1600

export function PumpPerformance() {
  const { telemetry, valveOpening, setValveOpening, connection } = useAppState()

  // Explicit <number>: PUMP is `as const`, so the initialiser would otherwise
  // narrow the state to the literal type 1450 and reject every other speed.
  const [speedRpm, setSpeedRpm] = useState<number>(PUMP.rated_speed_rpm)
  const [suctionRestriction, setSuctionRestriction] = useState(0)

  const curve = useMemo(
    () => curveSeries(speedRpm, valveOpening, suctionRestriction),
    [speedRpm, valveOpening, suctionRestriction],
  )
  const point = useMemo(
    () => solveOperatingPoint(speedRpm, valveOpening, suctionRestriction),
    [speedRpm, valveOpening, suctionRestriction],
  )

  const npshA = npshAvailableM(lpmToM3s(point.flow_lpm), suctionRestriction)
  const npshR = npshRequiredM(point.flow_lpm, speedRpm)
  const slip = motorSlip(speedRpm)
  const bepFlow = bepFlowLpm(speedRpm)
  const runout = runoutFlowLpm(speedRpm)
  const onsetFlow = cavitationOnsetFlowLpm(speedRpm, suctionRestriction)
  const onsetInRange = onsetFlow !== null && onsetFlow <= CURVE_MAX_FLOW_LPM

  const marginStatus =
    point.npsh_margin_m < 0
      ? { tone: 'alarm' as const, label: 'CAVITATING', detail: 'NPSHa is below NPSHr' }
      : point.npsh_margin_m < 0.5
        ? { tone: 'warn' as const, label: 'LOW MARGIN', detail: 'Below the 0.5 m guideline' }
        : { tone: 'ok' as const, label: 'ADEQUATE', detail: 'Above the 0.5 m guideline' }

  const flowDeviationPct = bepFlow > 0 ? ((point.flow_lpm - bepFlow) / bepFlow) * 100 : 0

  // -- Commission Regulation (EU) No 547/2012, evaluated here ----------------
  //
  // The rated point is solved separately from the page's sliders because the
  // regulation's scope criteria are written against the RATED duty, not against
  // whatever the operator is currently sweeping the speed to.
  const ratedPoint = useMemo(() => solveOperatingPoint(PUMP.rated_speed_rpm, 1), [])
  const bepFlowM3h = (PUMP.bep_flow_lpm * 60) / 1000
  const ratedFlowM3h = (PUMP.duty_flow_lpm * 60) / 1000
  const annexIII = annexIIIMinimumEfficiency(SPECIFIC_SPEED_NS, bepFlowM3h)

  /**
   * Article 2(2) and 2(3) scope criteria. Every one of them is stated in terms
   * of the RATED flow -- substituting the BEP flow here would be reading the
   * regulation's own definitions off the wrong point, and at 1.1 x duty it
   * would pass a machine the criterion was meant to catch.
   */
  const scopeChecks = [
    {
      criterion: 'Specific speed n_s between 6 and 80',
      value: fmt(SPECIFIC_SPEED_NS, 3),
      ok: SPECIFIC_SPEED_NS >= 6 && SPECIFIC_SPEED_NS <= 80,
    },
    {
      criterion: 'Rated flow at least 6 m3/h',
      value: `${fmt(ratedFlowM3h, 3)} m3/h`,
      ok: ratedFlowM3h >= 6,
    },
    {
      criterion: 'Shaft power at most 150 kW',
      value: `${fmt(ratedPoint.shaft_power_w, 0)} W`,
      ok: ratedPoint.shaft_power_w <= 150_000,
    },
    {
      criterion: 'Head at most 90 m at 1450 rpm',
      value: `${fmt(ratedPoint.pump_head_m, 2)} m`,
      ok: ratedPoint.pump_head_m <= 90,
    },
  ]

  /**
   * The part-load and overload cross-check.
   *
   * The regulation requires a pump to hold 0.947 of its BEP minimum at 75 % of
   * BEP flow and 0.985 of it at 110 %. This site's efficiency model is the
   * parabola eta/eta_BEP = 2x - x^2, chosen as a curve SHAPE for reasons that
   * have nothing to do with 547/2012. Both ratios are computed rather than
   * written down, so the comparison stays honest if either side changes.
   */
  const partLoadCheck = [ANNEX_I_PART_LOAD, ANNEX_I_OVERLOAD].map((annex) => {
    const modelled =
      pumpEfficiency(annex.flowFraction * PUMP.bep_flow_lpm, PUMP.rated_speed_rpm) /
      PUMP.bep_efficiency
    return {
      label: `${fmt(annex.flowFraction * 100, 0)} % of BEP flow`,
      regulation: annex.efficiencyFactor,
      modelled,
      deltaPoints: (modelled - annex.efficiencyFactor) * 100,
    }
  })

  return (
    <div className="space-y-5">
      <PageHeading
        title="Pump Performance"
        description="The operating point is the intersection of the pump characteristic and the system characteristic. Everything else on this page follows from it."
      />

      <Card
        title="P-101 characteristic"
        subtitle="Derived from the rated duty point, never typed in"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Specific speed n_s"
            value={fmt(SPECIFIC_SPEED_NS, 2)}
            unit=""
            tag="N sqrt(Q_BEP) / H_BEP^0.75"
            hint={`at the BEP, not the duty point`}
          />
          <StatTile
            label="Peak efficiency"
            value={fmt(PUMP.bep_efficiency * 100, 2)}
            unit="%"
            tag="EU 547/2012 Annex III"
            hint={`at ${fmt(bepFlow, 1)} L/min`}
          />
          <StatTile
            label="Synchronous speed"
            value={fmt(MOTOR.synchronous_speed_rpm, 0)}
            unit="rpm"
            tag={`${MOTOR.poles} pole, ${MOTOR.supply_frequency_hz} Hz`}
          />
          <StatTile
            label="Slip"
            value={fmt(slip * 100, 1)}
            unit="%"
            tag="(Ns - N) / Ns"
            hint={`at ${fmt(speedRpm, 0)} rpm`}
          />
        </div>
        <Formula
          expression={
            `n_s = N sqrt(Q_BEP) / (H_BEP / i)^0.75 = ${fmt(PUMP.rated_speed_rpm, 0)} x sqrt(` +
            `${lpmToM3s(PUMP.bep_flow_lpm).toExponential(3)}) / ${fmt(BEP_HEAD_M, 3)}^0.75 = ` +
            `${fmt(SPECIFIC_SPEED_NS, 3)}   [Q in m3/s, i = 1]\n` +
            `x = ln(n_s) = ${fmt(annexIII.x, 4)}\n` +
            `y = ln(Q_BEP) = ln(${fmt(bepFlowM3h, 3)}) = ${fmt(annexIII.y, 4)}   [Q in m3/h]\n` +
            `(eta_BEP)min,requ = 88.59x + 13.46y - 11.48x^2 - 0.85y^2 - 0.38xy - C\n` +
            `                  = ${fmt(annexIII.efficiency * 100, 2)} %   [C = ${ANNEX_III_C_ESOB_1450_MEI_040}, ESOB, 1450 rpm, MEI >= 0.40]`
          }
          where="Commission Regulation (EU) No 547/2012, Annex III. OJ L 165/34, 26.6.2012."
          note="Note the unit trap, which is the regulation's and not this page's: n_s is defined with Q in m3/s while y is the natural log of Q in m3/h. The two flows are named separately above and are never folded into one variable -- unifying them moves eta_BEP by about 14 points. What this correlation returns is a MINIMUM efficiency, not a measured one; using it as the modelled eta_BEP is the deliberate alternative to inventing a catalogue figure, and it errs on the conservative side."
        />
        <div className="mt-4">
          <h4 className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
            Scope of the regulation, checked rather than assumed
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Article 2(2) and 2(3). Each criterion is stated against the RATED flow, so that is what
            is tested here -- substituting the BEP flow, which is 10 % higher, would read the
            regulation's own definitions off the wrong point.
          </p>
          <dl className="mt-2">
            {scopeChecks.map((check) => (
              <DefinitionRow
                key={check.criterion}
                label={check.criterion}
                value={`${check.value}  ${check.ok ? 'OK' : 'OUT OF SCOPE'}`}
              />
            ))}
          </dl>
        </div>
      </Card>

      <Card
        title="Part-load and overload, cross-checked against the regulation"
        subtitle="Two independent statements about the same curve"
      >
        <p className="text-xs text-slate-500">
          Annex I also fixes what a compliant pump must reach away from its best point: 0.947 of the
          BEP minimum at {fmt(ANNEX_I_PART_LOAD.flowFraction * 100, 0)} % of BEP flow, and 0.985 of
          it at {fmt(ANNEX_I_OVERLOAD.flowFraction * 100, 0)} %. This site models efficiency as the
          parabola eta(Q)/eta_BEP = 2x - x^2, a curve SHAPE chosen for reasons that have nothing to
          do with 547/2012 -- it vanishes at Q = 0 and at 2 Q_BEP and has no free parameter to tune.
        </p>
        <dl className="mt-3">
          {partLoadCheck.map((row) => (
            <DefinitionRow
              key={row.label}
              label={row.label}
              value={`model ${fmt(row.modelled, 4)} vs regulation ${fmt(row.regulation, 3)}  (${row.deltaPoints >= 0 ? '+' : ''}${fmt(row.deltaPoints, 1)} points)`}
            />
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          The parabola reproduces both of the regulation's derating factors to within one point,
          having been picked with no reference to them. That agreement is evidence the curve shape
          is the right one, not a result of fitting it -- and it is the reason the same parabola is
          trusted at operating points the regulation says nothing about.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ErrorBoundary panelName="Pump and system curves" compact>
          <Card
            title="Pump, system, efficiency, power and NPSH"
            subtitle={`Modelled at ${fmt(speedRpm, 0)} rpm with the valve ${fmt(valveOpening * 100, 0)} % open. All five panels share one flow axis.`}
          >
            {point.no_intersection && (
              <div className="mb-4">
                <Notice tone="warn" title="No intersection">
                  At {fmt(speedRpm, 0)} rpm the shutoff head is{' '}
                  {fmt(PUMP.shutoff_head_m * Math.pow(speedRpm / PUMP.rated_speed_rpm, 2), 3)} m,
                  below the {fmt(CIRCUIT.static_head_m, 1)} m static head. The pump cannot lift the
                  column, so it churns at zero flow. This is the correct answer, not an error --
                  flow is clamped to zero rather than reported as NaN.
                </Notice>
              </div>
            )}
            <PumpCurveChart
              data={curve}
              operatingFlowLpm={point.flow_lpm}
              operatingHeadM={point.pump_head_m}
              noIntersection={point.no_intersection}
            />
            <div className="mt-4">
              <EfficiencyCurveChart
                data={curve}
                operatingFlowLpm={point.flow_lpm}
                operatingEfficiencyPct={point.pump_efficiency * 100}
                bepFlowLpm={bepFlow}
                peakEfficiencyPct={PUMP.bep_efficiency * 100}
              />
            </div>
            <div className="mt-4">
              <PowerCurveChart
                data={curve}
                operatingFlowLpm={point.flow_lpm}
                operatingShaftPowerW={point.shaft_power_w}
              />
            </div>
            <div className="mt-4">
              <NpshCurveChart
                data={curve}
                operatingFlowLpm={point.flow_lpm}
                onsetFlowLpm={onsetFlow}
                maxFlowLpm={CURVE_MAX_FLOW_LPM}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Head, efficiency, power and NPSH are plotted as stacked panels sharing one flow axis
              rather than on shared y-axes. A dual-axis plot invites a comparison between two
              unrelated scales, and the point where the curves appear to cross means nothing. The
              dashed vertical line is the operating flow, drawn on every panel so one machine state
              reads across all four.
            </p>
          </Card>
        </ErrorBoundary>

        <div className="space-y-4">
          <Card title="Speed">
            <RangeSlider
              label="Analysis speed"
              value={speedRpm}
              min={SPEED_MIN_RPM}
              max={SPEED_MAX_RPM}
              step={10}
              unit="rpm"
              onChange={setSpeedRpm}
              help="Sweeps the characteristic for analysis. It does not command the machine -- speed commands belong on the SCADA page, behind the interlocks."
            />
            <dl className="mt-4">
              <DefinitionRow
                label="Synchronous speed"
                value={fmtUnit(MOTOR.synchronous_speed_rpm, 'rpm', 0)}
              />
              <DefinitionRow
                label="Slip (Ns - N) / Ns"
                value={`${fmt(slip * 100, 1)} %`}
                tone={slip < 0 ? 'warn' : undefined}
              />
              <DefinitionRow label="BEP flow at this speed" value={fmtUnit(bepFlow, 'L/min', 1)} />
              <DefinitionRow label="Runout flow" value={fmtUnit(runout, 'L/min', 1)} />
              <DefinitionRow label="Measured RPM-101" value={fmtUnit(telemetry.rpm, 'rpm', 0)} />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Q_BEP scales with N by the affinity law, so the BEP marker moves with the slider
              instead of staying nailed to {PUMP.bep_flow_lpm} L/min. Above{' '}
              {fmt(MOTOR.synchronous_speed_rpm, 0)} rpm the slip goes negative, which a motor cannot
              do on its own -- that region is a VSD over-speed, shown because the hydraulics are
              still valid there.
            </p>
          </Card>

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
                value={`${(systemResistance(valveOpening) / 1e6).toFixed(3)}e6 m/(m3/s)2`}
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

          <Card title="Suction condition">
            <RangeSlider
              label="Suction restriction"
              value={suctionRestriction * 100}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => setSuctionRestriction(value / 100)}
              help="A partly clogged strainer or foot valve. It raises suction friction only, which is the physical route to cavitation -- not a flag that switches a fault on."
            />
            <dl className="mt-4">
              <DefinitionRow label="NPSH available" value={fmtUnit(npshA, 'm', 2)} />
              <DefinitionRow label="NPSH required" value={fmtUnit(npshR, 'm', 2)} />
              <DefinitionRow
                label="Margin (NPSHa - NPSHr)"
                value={fmtUnit(point.npsh_margin_m, 'm', 2)}
                tone={marginStatus.tone}
              />
              <DefinitionRow
                label="Cavitation onset flow"
                value={onsetFlow === null ? '—' : fmtUnit(onsetFlow, 'L/min', 1)}
                tone={onsetInRange ? 'warn' : undefined}
              />
            </dl>
            {!onsetInRange && (
              <p className="mt-3 text-xs text-slate-500">
                {onsetFlow === null
                  ? 'The suction head is already below NPSHr at zero flow: this pump cannot be run at all in this condition.'
                  : `At clean suction the two curves cross at ${fmt(onsetFlow, 1)} L/min, beyond this pump's runout of ${fmt(runout, 1)} L/min. Flow alone cannot cavitate this rig -- the route in is suction restriction, which is why the fault is modelled there and not as a flag. Raise the slider above about 20 % to bring the crossing onto the chart.`}
              </p>
            )}
            {point.npsh_margin_m < 0.5 && (
              <div className="mt-3">
                <Notice tone={point.npsh_margin_m < 0 ? 'alarm' : 'warn'} title={marginStatus.label}>
                  {point.npsh_margin_m < 0
                    ? 'Available suction head has fallen below what the pump requires. Vapour bubbles will form at the impeller eye and collapse in the volute -- this pits the impeller, and the collapse is broadband mechanical excitation, which is how a hydraulic condition becomes a vibration signature.'
                    : 'The suction margin is thin. Any further rise in suction losses or fall in reservoir level will start cavitation.'}
                </Notice>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Operating point"
        subtitle="Solved from the two curves above -- this is the model, not a sensor reading"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Flow" value={fmt(point.flow_lpm, 2)} unit="L/min" tag="Q*" />
          <StatTile label="Head" value={fmt(point.pump_head_m, 2)} unit="m" tag="H_p(Q*)" />
          <StatTile
            label="Pump efficiency"
            value={fmt(point.pump_efficiency * 100, 1)}
            unit="%"
            tag="eta(Q N_rated / N)"
          />
          <StatTile
            label="NPSH margin"
            value={fmt(point.npsh_margin_m, 2)}
            unit="m"
            tag="NPSHa - NPSHr"
            status={marginStatus}
          />
          <StatTile
            label="Hydraulic power"
            value={fmt(point.hydraulic_power_w, 1)}
            unit="W"
            tag="rho g Q H"
          />
          <StatTile
            label="Shaft power"
            value={fmt(point.shaft_power_w, 1)}
            unit="W"
            tag="P_hyd / eta_pump"
            hint={`eta_pump is the overall pump efficiency of EU 547/2012 Annex I(4): disc friction, leakage and mechanical loss are already inside it, so nothing is added on top.`}
          />
          <StatTile
            label="Electrical power"
            value={fmt(point.electrical_power_w, 1)}
            unit="W"
            tag="P_shaft / eta_motor"
          />
          <StatTile
            label="Motor current"
            value={fmt(point.motor_current_a, 3)}
            unit="A"
            tag="P_elec / (V x PF)"
          />
        </div>
      </Card>

      <Card
        title="Measured"
        subtitle="What the plant is actually doing right now, for comparison with the model above"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Speed" value={fmt(telemetry.rpm, 0)} unit="rpm" tag="RPM-101" />
          <StatTile label="Flow" value={fmt(telemetry.flow_lpm, 2)} unit="L/min" tag="FT-101" />
          <StatTile label="Head" value={fmt(telemetry.pump_head_m, 2)} unit="m" tag="derived" />
          <StatTile
            label="Differential pressure"
            value={fmt(telemetry.differential_pressure_kpa, 1)}
            unit="kPa"
            tag="PT-102 - PT-101"
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          The model panels are solved at the analysis speed set on this page, which is why they do
          not track this row when the machine is stopped or running at another speed. Keeping the
          two apart is deliberate: a curve drawn at one speed with a point plotted from another is
          the kind of quiet mismatch that makes a whole page untrustworthy.
        </p>
      </Card>
    </div>
  )
}
