/**
 * Builds one Telemetry frame from a machine condition, using the pump physics
 * in ./pumpPhysics. Shared by two consumers:
 *
 *   - src/data/recordedDemo.ts  -- the scripted bundled replay
 *   - src/state/localSim.ts     -- the browser-side model that keeps the SCADA
 *                                  and Simulation Lab pages interactive when
 *                                  the backend cannot be reached
 *
 * It exists so those two do not each grow their own copy of the fault
 * signatures. This is a fallback path only: whenever the API is connected the
 * backend's frames are used verbatim and nothing in this file runs.
 */

import type { Telemetry } from '../types/contracts'
import { AssetState, DataSource, FaultType, SensorQuality } from '../types/contracts'
import {
  ASSET_TAGS,
  FLUID,
  MOTOR,
  PUMP,
  THERMAL,
  lpmToM3s,
  rotationalFrequencyHz,
  solveOperatingPoint,
} from './pumpPhysics'
import { componentsRms, vibrationComponents } from './vibration'
import { healthBreakdown } from './health'

/**
 * Machine geometry the vibration component model needs. Passed in rather than
 * imported inside ./vibration so that module stays free of pump specifics and
 * can be tested against any machine.
 */
export const VIBRATION_GEOMETRY = {
  vanes: PUMP.impeller_vanes,
  rated_rpm: MOTOR.rated_speed_rpm,
  supply_frequency_hz: MOTOR.supply_frequency_hz,
}

/**
 * Crest factor of a healthy block of this machine's signature, measured from
 * synthesiseVibration rather than assumed. Six components, one of them a
 * broadband band, do not give a sine's 1.41.
 */
export const HEALTHY_CREST_FACTOR = 2.25

export interface FrameInputs {
  elapsed_s: number
  dt_s: number
  asset_state: string
  rpm: number
  valve_opening: number
  fault_state: string
  severity: number
  /** Extra measurement noise, 0..1, driven by the Simulation Lab slider. */
  noise: number
  started_at_ms: number
  /** Previous tick's temperatures -- the thermal model is first-order in time. */
  motor_temperature_c: number
  bearing_temperature_c: number
  rand: () => number
  data_source: string
}

const ALL_TAGS = [
  ASSET_TAGS.accelerometer,
  ASSET_TAGS.motor_temperature,
  ASSET_TAGS.bearing_temperature,
  ASSET_TAGS.suction_pressure,
  ASSET_TAGS.discharge_pressure,
  ASSET_TAGS.flow,
  ASSET_TAGS.current,
  ASSET_TAGS.speed,
]

function sensorQuality(faultState: string, severity: number): Record<string, string> {
  const q: Record<string, string> = {}
  for (const tag of ALL_TAGS) q[tag] = SensorQuality.GOOD
  if (faultState === FaultType.SENSOR_FAULT && severity > 0.05) {
    q[ASSET_TAGS.suction_pressure] = severity > 0.5 ? SensorQuality.BAD : SensorQuality.UNCERTAIN
  }
  return q
}

export function computeFrame(i: FrameInputs): Telemetry {
  const running = i.asset_state === AssetState.RUNNING
  const rpm = running || i.asset_state === AssetState.STARTING ? i.rpm : 0
  const severity = running ? i.severity : 0
  const fault = running ? i.fault_state : FaultType.NORMAL

  // Flow restriction acts on the valve, which is where it physically acts:
  // it moves the operating point up the pump curve rather than subtracting flow.
  const effectiveValve =
    fault === FaultType.FLOW_RESTRICTION
      ? Math.max(0.05, i.valve_opening * (1 - 0.8 * severity))
      : i.valve_opening

  const dryRun = fault === FaultType.DRY_RUN
  const op = solveOperatingPoint(rpm, effectiveValve)

  const cavitating = fault === FaultType.CAVITATION
  const cavitationLoss = cavitating ? 0.22 * severity : 0
  // A dry-running pump develops essentially no head and moves no liquid.
  const dryLoss = dryRun ? 0.95 * severity : 0
  const headM = op.pump_head_m * (1 - cavitationLoss) * (1 - dryLoss)
  const flowLpm = op.flow_lpm * (1 - cavitationLoss * 0.6) * (1 - dryLoss)
  const efficiency = Math.max(0, op.pump_efficiency * (1 - cavitationLoss) * (1 - dryLoss))
  const flowM3s = lpmToM3s(flowLpm)

  const noiseScale = 1 + 6 * i.noise
  const jitter = (amplitude: number) => (i.rand() - 0.5) * amplitude * noiseScale

  const suctionKpa =
    101.325 -
    (rpm > 0 ? 11.8 : 0) -
    (cavitating ? 9.5 * severity : 0) -
    (dryRun ? 4.0 * severity : 0) +
    jitter(0.4)
  const dischargeKpa = suctionKpa + headM * FLUID.density * FLUID.gravity * 1e-3 + jitter(0.6)

  // First-order thermal rise toward a load-dependent steady state.
  // SHAFT power over the rating, not electrical. A motor's rated power is its
  // shaft output, so dividing electrical input by it double-counts the motor's
  // own losses and overstates the load by 1/eta_motor. This port used
  // electrical while the backend used shaft, which ran the offline demo about
  // 10 C hotter than the live system for the same machine.
  const loadFraction = Math.min(1.4, op.shaft_power_w / MOTOR.rated_power_w)
  const motorTarget = THERMAL.ambient_c + THERMAL.motor_rise_at_rated_c * loadFraction
  const bearingTarget =
    THERMAL.ambient_c +
    THERMAL.bearing_rise_at_rated_c * loadFraction +
    (fault === FaultType.IMBALANCE ? 9 * severity : 0) +
    (fault === FaultType.MISALIGNMENT ? 12 * severity : 0) +
    (dryRun ? THERMAL.dry_run_extra_rise_c * severity : 0)
  const motorTempC =
    i.motor_temperature_c + ((motorTarget - i.motor_temperature_c) * i.dt_s) / (rpm > 0 ? 420 : 900)
  const bearingTempC =
    i.bearing_temperature_c +
    ((bearingTarget - i.bearing_temperature_c) * i.dt_s) / (dryRun ? 180 : rpm > 0 ? 300 : 700)

  // --- vibration signature -------------------------------------------------
  const fr = rotationalFrequencyHz(rpm)
  const speedScale = rpm / MOTOR.rated_speed_rpm
  let a1x = rpm > 0 ? 0.55 * speedScale : 0.02
  let a2x = rpm > 0 ? 0.18 * speedScale : 0.01
  let hfEnergy = rpm > 0 ? 0.12 : 0.0

  switch (fault) {
    case FaultType.IMBALANCE:
      // Imbalance is a synchronous 1x phenomenon; 2x barely responds.
      a1x += 3.1 * severity
      a2x += 0.25 * severity
      break
    case FaultType.MISALIGNMENT:
      // Misalignment lifts 2x strongly -- that ratio is the discriminator.
      a1x += 0.8 * severity
      a2x += 2.4 * severity
      break
    case FaultType.CAVITATION:
      // Cavitation is broadband and non-synchronous.
      hfEnergy += 1.9 * severity
      a1x += 0.3 * severity
      break
    case FaultType.FLOW_RESTRICTION:
      a1x += 0.35 * severity
      hfEnergy += 0.25 * severity
      break
    case FaultType.DRY_RUN:
      hfEnergy += 0.9 * severity
      a1x += 0.5 * severity
      break
    default:
      break
  }

  const noiseFloor = (rpm > 0 ? 0.09 : 0.01) * noiseScale
  // The frame's overall RMS must be computed from the SAME component set the
  // Vibration page plots and measures, or the tile and the block statistics
  // describe two different signals. Vane pass and line frequency were missing
  // from this sum while being present in the plotted block, which is why those
  // two numbers could never be made to agree.
  const components = vibrationComponents(
    rpm,
    {
      amplitude_1x_mm_s: a1x,
      amplitude_2x_mm_s: a2x,
      high_frequency_energy: hfEnergy,
      broadband_noise_mm_s: noiseFloor,
      // Vane passing is hydraulic: it collapses with the liquid on a dry run.
      vane_pass_scale: dryRun ? 1 - dryLoss : 1,
    },
    VIBRATION_GEOMETRY,
  )
  const rms = componentsRms(components)
  // Calibrated against synthesiseVibration, not assumed. The baseline used to be
  // sqrt(2) -- the crest factor of a single sine -- but this machine's healthy
  // signature is six components including a broadband band, and a block of it
  // measures about 2.25. Reporting 1.41 here while the Vibration page measured
  // 2.27 from the same components is the same class of defect as the vane-pass
  // pedestal: two numbers with one name. vibration.test.ts asserts that this
  // constant still matches what the synthesis produces.
  const crest =
    HEALTHY_CREST_FACTOR + (cavitating || dryRun ? 1.5 * severity : 0.25 * severity) + i.rand() * 0.08
  const peak = rms * crest

  const npshMargin =
    op.npsh_margin_m - (cavitating ? 3.4 * severity : 0) - (dryRun ? 6.0 * severity : 0)

  // --- condition -----------------------------------------------------------
  // Health is a transparent penalty sum, computed by ./health so that the
  // Engineering page can render the SAME terms it was scored from rather than a
  // hand-typed copy of them. It is deliberately not a learned score: an
  // unexplainable health number is not something an engineer can act on.
  const { health } = healthBreakdown({
    running,
    vibration_rms_mm_s: rms,
    pump_efficiency: efficiency,
    bep_efficiency: PUMP.bep_efficiency,
    npsh_margin_m: npshMargin,
    bearing_temperature_c: bearingTempC,
  })
  const anomaly = Math.min(1, Math.max(0, (100 - health) / 70))

  const dominant = hfEnergy > Math.max(a1x, a2x) ? 640 : a2x > a1x ? 2 * fr : fr
  const hydraulic = FLUID.density * FLUID.gravity * flowM3s * headM

  const round = (v: number, d = 2) => Number(v.toFixed(d))

  return {
    timestamp: new Date(i.started_at_ms + i.elapsed_s * 1000).toISOString(),
    elapsed_s: round(i.elapsed_s, 1),
    rpm: round(rpm + jitter(2), 1),
    flow_lpm: round(Math.max(0, flowLpm + jitter(0.15))),
    pump_head_m: round(Math.max(0, headM), 3),
    suction_pressure_kpa: round(suctionKpa),
    discharge_pressure_kpa: round(dischargeKpa),
    differential_pressure_kpa: round(dischargeKpa - suctionKpa),
    motor_current_a: round(op.motor_current_a + jitter(0.01), 3),
    motor_temperature_c: round(motorTempC),
    bearing_temperature_c: round(bearingTempC),
    vibration_x_mm_s: round(rms * 0.92, 3),
    vibration_y_mm_s: round(rms * 1.06, 3),
    vibration_z_mm_s: round(rms * 0.61, 3),
    vibration_rms_mm_s: round(rms, 3),
    vibration_peak_mm_s: round(peak, 3),
    crest_factor: round(crest, 3),
    amplitude_1x_mm_s: round(a1x, 3),
    amplitude_2x_mm_s: round(a2x, 3),
    high_frequency_energy: round(hfEnergy, 3),
    dominant_frequency_hz: round(dominant),
    rotational_frequency_hz: round(fr, 3),
    pump_efficiency: round(efficiency, 4),
    hydraulic_power_w: round(hydraulic),
    shaft_power_w: round(op.shaft_power_w),
    electrical_power_w: round(op.electrical_power_w),
    health_index: round(health, 1),
    anomaly_score: round(anomaly, 3),
    fault_state: fault,
    severity: round(severity, 3),
    asset_state: i.asset_state,
    npsh_margin_m: round(npshMargin, 3),
    data_source: i.data_source ?? DataSource.RECORDED,
    sensor_quality: sensorQuality(fault, severity),
    schema_version: '1.0.0',
  }
}
