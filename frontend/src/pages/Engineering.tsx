/**
 * Engineering.
 *
 * The formulas, with the current numbers substituted into them. The intent is
 * that a mechanical engineer reading this page can check the platform's
 * arithmetic by hand -- which is the only reason to trust any of the other
 * pages. Nothing here is decorative LaTeX: every expression is the one the code
 * actually evaluates.
 */

import { useAppState } from '../state/AppState'
import { AssetState } from '../types/contracts'
import { healthBreakdown } from '../lib/health'
import {
  BEARING,
  CIRCUIT,
  FLUID,
  HEAD_COEFFICIENT,
  MOTOR,
  PUMP,
  SPECIFIC_SPEED_NS,
  bladePassFrequencyHz,
  lpmToM3s,
  npshAvailableM,
  npshRequiredM,
  systemResistance,
} from '../lib/pumpPhysics'
import { bearingDefectFrequencies } from '../lib/vibration'
import { useVibrationSignals } from '../lib/vibrationSignals'
import { fmt, fmtUnit, humanise } from '../lib/format'
import { Card, DefinitionRow, Formula, PageHeading, ProvenanceNote } from '../components/ui'

export function Engineering() {
  const { telemetry, valveOpening } = useAppState()
  // The same waveform block the Vibration page measures its statistics from.
  // Peak and crest factor below are taken from THESE samples, not from the
  // telemetry scalars, which carry an assumed crest factor rather than a
  // measured maximum.
  const vibration = useVibrationSignals()

  const flowM3s = lpmToM3s(telemetry.flow_lpm)
  const K = systemResistance(valveOpening)
  const speedRatio = telemetry.rpm / PUMP.rated_speed_rpm
  // Reduced flow and its BEP ratio, shown explicitly so the efficiency formula
  // on this page can be followed one substitution at a time.
  const reducedFlowLpm =
    telemetry.rpm > 0 ? (telemetry.flow_lpm * PUMP.rated_speed_rpm) / telemetry.rpm : 0
  const x = reducedFlowLpm / PUMP.bep_flow_lpm
  // The reported margin is not simply NPSHa - NPSHr: a cavitation or dry-run
  // fault subtracts a further allowance in the frame model. Printing only the
  // two curve terms and then a margin that includes a third, unnamed one is the
  // same defect as an unprinted guard -- the reader subtracts and gets a
  // different answer, and concludes the page is wrong rather than incomplete.
  const npshFaultAdjustmentM =
    telemetry.npsh_margin_m -
    (npshAvailableM(flowM3s) - npshRequiredM(telemetry.flow_lpm, telemetry.rpm))
  // The same breakdown the frame was scored from, not a retyped copy of it.
  const health = healthBreakdown({
    running: telemetry.asset_state === AssetState.RUNNING,
    vibration_rms_mm_s: telemetry.vibration_rms_mm_s,
    pump_efficiency: telemetry.pump_efficiency,
    bep_efficiency: PUMP.bep_efficiency,
    npsh_margin_m: telemetry.npsh_margin_m,
    bearing_temperature_c: telemetry.bearing_temperature_c,
  })
  const bearings = bearingDefectFrequencies({
    rolling_elements: BEARING.rolling_elements,
    ball_diameter_mm: BEARING.ball_diameter_mm,
    pitch_diameter_mm: BEARING.pitch_diameter_mm,
    contact_angle_deg: BEARING.contact_angle_deg,
    shaft_rpm: telemetry.rpm,
  })

  const e = (value: number) => `${(value / 1e6).toFixed(3)}e6`

  return (
    <div className="space-y-5">
      <PageHeading
        title="Engineering"
        description="Every equation the platform evaluates, with the current operating point substituted in. Check the arithmetic by hand -- that is what this page is for."
      />

      <Card title="Pump characteristic" subtitle="Quadratic fit to a centrifugal characteristic near BEP">
        <div className="space-y-3">
          <Formula
            expression={`H_p(Q) = H0(N) - a Q^2\nH0(N) = H0_rated (N / N_rated)^2 = ${PUMP.shutoff_head_m} x (${fmt(telemetry.rpm, 0)} / ${PUMP.rated_speed_rpm})^2 = ${fmt(PUMP.shutoff_head_m * speedRatio ** 2, 3)} m\na = (H0 - H_duty) / Q_duty^2 = (${PUMP.shutoff_head_m} - ${PUMP.duty_head_m}) / (${PUMP.duty_flow_lpm}/60000)^2 = ${e(HEAD_COEFFICIENT)} m/(m3/s)^2`}
            where={`Q = ${fmt(telemetry.flow_lpm, 2)} L/min = ${flowM3s.toExponential(3)} m3/s, giving H_p = ${fmt(telemetry.pump_head_m, 3)} m`}
            note="a is speed-invariant in this form: H ~ N^2 and Q ~ N leave H/Q^2 constant, which is the affinity laws expressed in the coefficient."
          />
          <Formula
            expression={`H_s(Q) = H_static + K(valve) Q^2\nK = pipe_resistance + valve_resistance(opening) = ${e(CIRCUIT.pipe_resistance)} + ${e(K - CIRCUIT.pipe_resistance)} = ${e(K)}`}
            where={`H_static = ${CIRCUIT.static_head_m} m, valve ${fmt(valveOpening * 100, 0)} % open`}
            note="Valve resistance is interpolated on 1/opening^2, because a valve's resistance rises roughly as the inverse square of its flow area. A linear ramp would make the first 10 % of travel do almost all of the work."
          />
          <Formula
            expression={`H_p(Q*) = H_s(Q*)  =>  Q* = sqrt( (H0 - H_static) / (a + K) )\nQ* = sqrt( (${fmt(PUMP.shutoff_head_m * speedRatio ** 2, 3)} - ${CIRCUIT.static_head_m}) / (${e(HEAD_COEFFICIENT)} + ${e(K)}) ) = ${flowM3s.toExponential(3)} m3/s = ${fmt(telemetry.flow_lpm, 2)} L/min`}
            where="Both curves are quadratic in Q, so the intersection is closed-form and needs no iteration."
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Power chain">
          <div className="space-y-3">
            <Formula
              expression={`P_hyd = rho g Q H = ${FLUID.density} x ${FLUID.gravity} x ${flowM3s.toExponential(3)} x ${fmt(telemetry.pump_head_m, 3)} = ${fmt(telemetry.hydraulic_power_w, 2)} W`}
              where="Useful power delivered to the liquid."
            />
            <Formula
              expression={`P_shaft = P_hyd / eta_pump = ${fmt(telemetry.hydraulic_power_w, 2)} / ${fmt(telemetry.pump_efficiency, 3)} = ${fmt(telemetry.shaft_power_w, 2)} W`}
              where="eta_pump is the OVERALL pump efficiency of EU 547/2012 Annex I(4): hydraulic power out over shaft power in. Disc friction, wear-ring leakage and mechanical loss are already inside that denominator. A separate parasitic drag term used to be added here, which charged the same losses twice."
            />
            <Formula
              expression={`P_elec = P_shaft / eta_motor = ${fmt(telemetry.shaft_power_w, 2)} / ${MOTOR.efficiency} = ${fmt(telemetry.electrical_power_w, 2)} W`}
            />
            <Formula
              expression={`I = P_elec / (V x PF) = ${fmt(telemetry.electrical_power_w, 2)} / (${MOTOR.rated_voltage_v} x ${MOTOR.power_factor}) = ${fmt(telemetry.motor_current_a, 3)} A`}
              where="One formula, no floor and no quadrature term. The magnetising current used to be added in quadrature on the backend and applied as a floor in the browser, so the two halves reported different currents and the arithmetic printed on this line did not close."
            />
          </div>
        </Card>

        <Card title="Efficiency and NPSH">
          <div className="space-y-3">
            <Formula
              expression={`Q_red = Q N_rated / N = ${fmt(telemetry.flow_lpm, 2)} x ${PUMP.rated_speed_rpm} / ${fmt(telemetry.rpm, 0)} = ${fmt(reducedFlowLpm, 2)} L/min\nx = Q_red / Q_BEP = ${fmt(reducedFlowLpm, 2)} / ${PUMP.bep_flow_lpm} = ${fmt(x, 4)}\neta(Q) = eta_BEP [ 2x - x^2 ] = ${fmt(PUMP.bep_efficiency, 4)} x [ 2(${fmt(x, 4)}) - ${fmt(x, 4)}^2 ] = ${fmt(telemetry.pump_efficiency * 100, 2)} %`}
              where={`eta_BEP is not a figure chosen for this machine. n_s = N sqrt(Q_BEP) / H_BEP^0.75 = ${fmt(SPECIFIC_SPEED_NS, 3)}, and the minimum-efficiency correlation of Commission Regulation (EU) No 547/2012 Annex III evaluated at that n_s returns ${fmt(PUMP.bep_efficiency * 100, 2)} %. The Pump Performance page shows the evaluation term by term.`}
              note="Efficiency is looked up on the REDUCED flow, not the absolute flow. Affinity laws map every point on the characteristic onto a homologous point at another speed with eta invariant, so what fixes efficiency is where the pump sits on its own curve -- and Q N_rated / N is exactly that coordinate. The parabola vanishes at Q = 0 and at 2 Q_BEP; it has no width parameter and no floor."
            />
            <Formula
              expression={
                `NPSHa = (P_atm - P_vap)/(rho g) + z_s - K_s Q^2 = ${fmt(npshAvailableM(flowM3s), 3)} m\n` +
                `NPSHr = (N/N_rated)^2 [ 0.6 + 1.4 (Q_red / Q_duty)^2 ] = ${fmt(npshRequiredM(telemetry.flow_lpm, telemetry.rpm), 3)} m\n` +
                `NPSHa - NPSHr = ${fmt(npshAvailableM(flowM3s) - npshRequiredM(telemetry.flow_lpm, telemetry.rpm), 3)} m\n` +
                (Math.abs(npshFaultAdjustmentM) > 0.001
                  ? `fault adjustment  ${fmt(npshFaultAdjustmentM, 3)} m (${humanise(telemetry.fault_state)} at severity ${fmt(telemetry.severity, 2)})\n`
                  : `fault adjustment  0.000 m (no suction-side fault active)\n`) +
                `Reported margin = ${fmt(telemetry.npsh_margin_m, 3)} m`
              }
              where={`P_atm = ${FLUID.atmospheric_pressure} Pa, P_vap = ${FLUID.vapour_pressure} Pa at 20 C. z_s = -(suction_lift - reservoir_level) = -(${CIRCUIT.suction_lift_m} - ${CIRCUIT.reservoir_level_m}) = ${fmt(-(CIRCUIT.suction_lift_m - CIRCUIT.reservoir_level_m), 1)} m.`}
              note="z_s is the NET static head at the flange: the pump stands 1.2 m above the reservoir floor but the liquid stands 0.8 m deep, so the lift actually seen is 0.4 m. NPSHr carries the (N/N_rated)^2 factor for the same reason efficiency carries the reduced flow -- it is a homologous quantity. A negative margin means vapour forms at the impeller eye and collapses in the volute. That is cavitation, and it removes metal."
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rotational orders">
          <div className="space-y-3">
            <Formula
              expression={`f_r = rpm / 60 = ${fmt(telemetry.rpm, 0)} / 60 = ${fmt(telemetry.rotational_frequency_hz, 3)} Hz`}
              where="The reference frequency for every synchronous diagnosis."
            />
            <Formula
              expression={`1x = f_r = ${fmt(telemetry.rotational_frequency_hz, 2)} Hz  ->  ${fmt(telemetry.amplitude_1x_mm_s, 3)} mm/s\n2x = 2 f_r = ${fmt(2 * telemetry.rotational_frequency_hz, 2)} Hz  ->  ${fmt(telemetry.amplitude_2x_mm_s, 3)} mm/s\n2x/1x ratio = ${fmt(telemetry.amplitude_2x_mm_s / Math.max(1e-6, telemetry.amplitude_1x_mm_s), 2)}`}
              note="Imbalance is a 1x phenomenon. A 2x/1x ratio approaching or exceeding 1 points to misalignment instead."
            />
            <Formula
              expression={`f_BPF = vanes x f_r = ${PUMP.impeller_vanes} x ${fmt(telemetry.rotational_frequency_hz, 2)} = ${fmt(bladePassFrequencyHz(telemetry.rpm), 1)} Hz`}
              where="Blade pass frequency, the hydraulic excitation from each vane passing the volute tongue."
            />
          </div>
        </Card>

        <Card title="Vibration statistics">
          <div className="space-y-3">
            <Formula
              expression={
                `RMS = sqrt( (1/N) sum x_i^2 ) = ${fmt(vibration.statistics.rms_mm_s, 3)} mm/s\n` +
                `Peak = max |x_i| = ${fmt(vibration.statistics.peak_mm_s, 3)} mm/s\n` +
                `Crest factor = Peak / RMS = ${
                  vibration.statistics.crest_factor === null
                    ? '— (RMS is zero; the ratio does not exist)'
                    : fmt(vibration.statistics.crest_factor, 3)
                }`
              }
              where={`Measured over the ${vibration.waveform.length}-sample block ${vibration.fromApi ? 'returned by the backend' : 'synthesised in the browser from this frame'} -- the same block the Vibration page plots, taken from one shared source so the two pages cannot disagree.`}
              note="A pure sine gives a crest factor of 1.414. Values well above that indicate impulsive content -- bearing defects, cavitation collapse, looseness. These three lines used to read telemetry.vibration_peak_mm_s and telemetry.crest_factor, which are not a measured maximum: the backend builds the overall RMS from component amplitudes and multiplies it by an ASSUMED crest factor, so on a healthy machine the ratio was pinned to 1.414 by construction while this very caption explained that a value of 1.414 means something. `max |x_i|` now takes an actual maximum."
            />
            <Formula
              expression={`x_peak,sine = sqrt(2) v_rms / (2 pi f)\n              = 1.414 x ${fmt(telemetry.vibration_rms_mm_s / 1000, 6)} / (2 pi x ${fmt(Math.max(1, telemetry.rotational_frequency_hz), 2)}) = ${fmt(
                ((Math.SQRT2 * (telemetry.vibration_rms_mm_s / 1000)) /
                  (2 * Math.PI * Math.max(1, telemetry.rotational_frequency_hz))) *
                  1e6,
                1,
              )} micrometres`}
              where="Equivalent sinusoidal peak displacement -- this is why the digital twin has to magnify its shake to show anything at all."
              note="The sqrt(2) here is not the crest factor of the measured block and does not have to agree with the line above. It is the RMS-to-amplitude ratio of the single sinusoid that would carry this much velocity at the shaft frequency, which is the standard way to state a displacement equivalent for a broadband velocity reading. Using the block's real crest factor instead would answer a different question: the largest instantaneous excursion, at whichever frequency produced it."
            />
            <Formula
              expression={
                health.scored
                  ? `Health = 100 - ${health.terms.map((t) => t.label.toLowerCase()).join(' - ')}\n` +
                    health.terms
                      .map((t) => `  ${t.label.padEnd(21)} ${t.expression} = ${fmt(t.penalty, 2)}`)
                      .join('\n') +
                    `\n  ${'total penalty'.padEnd(21)} ${fmt(
                      health.terms.reduce((sum, t) => sum + t.penalty, 0),
                      2,
                    )}\n       = ${fmt(health.health, 1)} / 100`
                  : `Health = 100 (not scored)\n  ${health.guard}`
              }
              where={
                health.scored
                  ? 'Every term is listed, including the ones scoring zero. A term hidden because it happens to be zero is a term the reader cannot check.'
                  : undefined
              }
              note="A transparent penalty sum, not a learned score. These are the same term objects the frame was scored from, rendered rather than retyped -- the page cannot print a formula the model did not use."
            />
            <Formula
              expression={`Guards in force, stated rather than hidden:\n  eta = 0                      when N = 0            (stopped guard)\n  Health = 100, not scored     when state != RUNNING (stopped guard)\n  Q* = 0                       when H0(N) <= H_static (no intersection)\n  crest factor = undefined     when RMS = 0          (shown as a dash)`}
              where={`This asset is ${telemetry.asset_state}, so ${health.scored ? 'health IS scored' : 'health is NOT scored'} on this frame.`}
              note="Substituting a stopped machine into the health sum gives 67, not 100, because eta is zero. The page used to print 100 next to a formula that produced 67 -- and the reader who checks is the reader worth convincing. The guard is the answer; hiding it was the defect."
            />
          </div>
        </Card>
      </div>

      <Card
        title="Bearing defect frequencies"
        subtitle={`${BEARING.designation} deep-groove ball bearing at ${fmt(telemetry.rpm, 0)} rpm`}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Formula
            expression={`BPFO = (n/2) f_r (1 - (d/D) cos a)\nBPFI = (n/2) f_r (1 + (d/D) cos a)\nBSF  = (D/2d) f_r (1 - ((d/D) cos a)^2)\nFTF  = (1/2) f_r (1 - (d/D) cos a)`}
            where={`n = ${BEARING.rolling_elements}, d = ${BEARING.ball_diameter_mm} mm, D = ${BEARING.pitch_diameter_mm} mm, a = ${BEARING.contact_angle_deg} deg`}
            note="Kinematic predictions from geometry and speed. They locate where a defect WOULD appear; they are not a detection."
          />
          <dl>
            <DefinitionRow label="f_r" value={fmtUnit(bearings.rotational_frequency_hz, 'Hz', 2)} />
            <DefinitionRow label="BPFO" value={fmtUnit(bearings.bpfo_hz, 'Hz', 2)} />
            <DefinitionRow label="BPFI" value={fmtUnit(bearings.bpfi_hz, 'Hz', 2)} />
            <DefinitionRow label="BSF" value={fmtUnit(bearings.bsf_hz, 'Hz', 2)} />
            <DefinitionRow label="FTF" value={fmtUnit(bearings.ftf_hz, 'Hz', 2)} />
          </dl>
        </div>
      </Card>

      <Card title="Asset parameters" subtitle="Every constant the model uses">
        <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
          <dl>
            <DefinitionRow label="Pump tag" value={PUMP.tag} />
            <DefinitionRow label="Rated speed" value={fmtUnit(PUMP.rated_speed_rpm, 'rpm', 0)} />
            <DefinitionRow label="Shutoff head" value={fmtUnit(PUMP.shutoff_head_m, 'm', 1)} />
            <DefinitionRow label="Duty point" value={`${PUMP.duty_flow_lpm} L/min @ ${PUMP.duty_head_m} m`} />
            <DefinitionRow label="BEP" value={`${PUMP.bep_flow_lpm} L/min @ ${fmt(PUMP.bep_efficiency * 100, 0)} %`} />
            <DefinitionRow label="Impeller diameter" value={fmtUnit(PUMP.impeller_diameter_m * 1000, 'mm', 0)} />
            <DefinitionRow label="Impeller vanes" value={String(PUMP.impeller_vanes)} />
          </dl>
          <dl>
            <DefinitionRow label="Motor tag" value={MOTOR.tag} />
            <DefinitionRow label="Rated power" value={fmtUnit(MOTOR.rated_power_w, 'W', 0)} />
            <DefinitionRow label="Poles / supply" value={`${MOTOR.poles} pole, ${MOTOR.supply_frequency_hz} Hz`} />
            <DefinitionRow label="Synchronous speed" value={fmtUnit(MOTOR.synchronous_speed_rpm, 'rpm', 0)} />
            <DefinitionRow
              label="Slip at rated"
              value={`${fmt(((MOTOR.synchronous_speed_rpm - MOTOR.rated_speed_rpm) / MOTOR.synchronous_speed_rpm) * 100, 1)} %`}
            />
            <DefinitionRow label="Rated current" value={fmtUnit(MOTOR.rated_current_a, 'A', 2)} />
            <DefinitionRow label="Motor efficiency" value={`${fmt(MOTOR.efficiency * 100, 0)} %`} />
          </dl>
          <dl>
            <DefinitionRow label="Static head" value={fmtUnit(CIRCUIT.static_head_m, 'm', 1)} />
            <DefinitionRow label="Pipe resistance" value={`${e(CIRCUIT.pipe_resistance)} m/(m3/s)2`} />
            <DefinitionRow label="Suction lift" value={fmtUnit(CIRCUIT.suction_lift_m, 'm', 1)} />
            <DefinitionRow label="Fluid" value={`Water, ${FLUID.density} kg/m3 at 20 C`} />
            <DefinitionRow label="Bearing" value={BEARING.designation} />
            <DefinitionRow label="Rolling elements" value={String(BEARING.rolling_elements)} />
          </dl>
        </div>
        <div className="mt-3">
          <ProvenanceNote>
            These constants mirror backend/app/config/pump_parameters.py. The backend owns them; this
            page is a client-side copy used to render the formulas and to keep the offline
            demonstration physically coherent.
          </ProvenanceNote>
        </div>
      </Card>
    </div>
  )
}
