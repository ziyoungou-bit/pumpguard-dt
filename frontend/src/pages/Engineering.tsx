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
import {
  BEARING,
  CIRCUIT,
  FLUID,
  HEAD_COEFFICIENT,
  MOTOR,
  PUMP,
  bladePassFrequencyHz,
  lpmToM3s,
  npshAvailableM,
  npshRequiredM,
  systemResistance,
} from '../lib/pumpPhysics'
import { bearingDefectFrequencies } from '../lib/vibration'
import { fmt, fmtUnit } from '../lib/format'
import { Card, DefinitionRow, Formula, PageHeading, ProvenanceNote } from '../components/ui'

export function Engineering() {
  const { telemetry, valveOpening } = useAppState()

  const flowM3s = lpmToM3s(telemetry.flow_lpm)
  const K = systemResistance(valveOpening)
  const speedRatio = telemetry.rpm / PUMP.rated_speed_rpm
  const bearings = bearingDefectFrequencies({
    rolling_elements: BEARING.rolling_elements,
    ball_diameter_mm: BEARING.ball_diameter_mm,
    pitch_diameter_mm: BEARING.pitch_diameter_mm,
    contact_angle_deg: BEARING.contact_angle_deg,
    shaft_rpm: telemetry.rpm,
  })

  const e = (value: number) => `${(value / 1e7).toFixed(3)}e7`

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
              expression={`P_shaft = P_hyd / eta_pump + P_parasitic = ${fmt(telemetry.hydraulic_power_w, 2)} / ${fmt(telemetry.pump_efficiency, 3)} + drag = ${fmt(telemetry.shaft_power_w, 2)} W`}
              where={`Parasitic drag (bearings, seal, windage) is ${MOTOR.parasitic_loss_at_rated_w} W at rated speed and scales with N^3.`}
            />
            <Formula
              expression={`P_elec = P_shaft / eta_motor = ${fmt(telemetry.shaft_power_w, 2)} / ${MOTOR.efficiency} = ${fmt(telemetry.electrical_power_w, 2)} W`}
            />
            <Formula
              expression={`I = P_elec / (V x PF) = ${fmt(telemetry.electrical_power_w, 2)} / (${MOTOR.rated_voltage_v} x ${MOTOR.power_factor}) = ${fmt(telemetry.motor_current_a, 3)} A`}
              where={`Floored at the magnetising current of ${MOTOR.no_load_current_a} A -- a motor draws current with no mechanical load at all.`}
            />
          </div>
        </Card>

        <Card title="Efficiency and NPSH">
          <div className="space-y-3">
            <Formula
              expression={`eta(Q) = eta_BEP [ 1 - ((Q - Q_BEP) / span)^2 ]\n     = ${PUMP.bep_efficiency} x [ 1 - ((${fmt(telemetry.flow_lpm, 2)} - ${PUMP.bep_flow_lpm}) / ${PUMP.efficiency_span_lpm})^2 ] = ${fmt(telemetry.pump_efficiency * 100, 2)} %`}
              where="An inverted parabola about the best efficiency point -- the usual first-order shape."
            />
            <Formula
              expression={`NPSHa = (P_atm - P_vap)/(rho g) - z_lift - K_s Q^2 = ${fmt(npshAvailableM(flowM3s), 3)} m\nNPSHr = 0.6 + 1.4 (Q / Q_duty)^2 = ${fmt(npshRequiredM(telemetry.flow_lpm), 3)} m\nMargin = NPSHa - NPSHr = ${fmt(telemetry.npsh_margin_m, 3)} m`}
              where={`P_atm = ${FLUID.atmospheric_pressure} Pa, P_vap = ${FLUID.vapour_pressure} Pa at 20 C, suction lift ${CIRCUIT.suction_lift_m} m.`}
              note="A negative margin means vapour forms at the impeller eye and collapses in the volute. That is cavitation, and it removes metal."
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
              expression={`RMS = sqrt( (1/N) sum x_i^2 ) = ${fmt(telemetry.vibration_rms_mm_s, 3)} mm/s\nPeak = max |x_i| = ${fmt(telemetry.vibration_peak_mm_s, 3)} mm/s\nCrest factor = Peak / RMS = ${fmt(telemetry.crest_factor, 3)}`}
              note="A pure sine gives a crest factor of 1.414. Values well above that indicate impulsive content -- bearing defects, cavitation collapse, looseness."
            />
            <Formula
              expression={`x_peak = sqrt(2) v_rms / (2 pi f)\n       = 1.414 x ${fmt(telemetry.vibration_rms_mm_s / 1000, 6)} / (2 pi x ${fmt(Math.max(1, telemetry.rotational_frequency_hz), 2)}) = ${fmt(
                ((Math.SQRT2 * (telemetry.vibration_rms_mm_s / 1000)) /
                  (2 * Math.PI * Math.max(1, telemetry.rotational_frequency_hz))) *
                  1e6,
                1,
              )} micrometres`}
              where="Velocity RMS converted to peak displacement -- this is why the digital twin has to magnify its shake to show anything at all."
            />
            <Formula
              expression={`Health = 100 - 12 max(0, RMS - 1.8) - 60 max(0, 0.55 - eta) - 14 max(0, 0.5 - NPSH_margin) - 1.4 max(0, T_brg - 62)\n       = ${fmt(telemetry.health_index, 1)} / 100`}
              note="A transparent penalty sum, not a learned score. An unexplainable health number is not something a maintenance engineer can act on or challenge."
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
