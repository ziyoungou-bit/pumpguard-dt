/**
 * The bundled RECORDED DEMO dataset.
 *
 * Purpose: this is a portfolio site that recruiters open cold. If the backend is
 * asleep, unreachable or still deploying, no screen may be empty and no chart
 * may be blank. Rather than render "Waiting for sensor", the app replays this
 * dataset and labels it "Recorded Demo" everywhere it appears. It is never
 * presented as live data.
 *
 * How it is built: a deterministic, seeded replay generated once at module load
 * from the shared frame model (src/lib/frameModel.ts), which is the same pump
 * physics the backend uses. It is "recorded" in the sense that matters -- the
 * same seed produces the same frames on every visit, so the demo is
 * reproducible rather than a fresh stream of random numbers. Generating it
 * costs a few milliseconds and avoids shipping a megabyte of JSON for the same
 * 300 seconds of data.
 *
 * Scripted scenario, chosen to exercise every page:
 *   0-10 s     OFF
 *   10-30 s    STARTING, speed ramping to 1450 rpm
 *   30-90 s    RUNNING healthy near the best efficiency point
 *   90-150 s   flow restriction developing (head up, flow down, efficiency down)
 *   150-200 s  recovery to healthy
 *   200-260 s  imbalance growing (1x rising, 2x flat)
 *   260-300 s  cavitation (NPSH margin lost, broadband HF energy up)
 */

import type { Alarm, Diagnosis, Telemetry } from '../types/contracts'
import { AssetState, DataSource, FaultType } from '../types/contracts'
import { computeFrame } from '../lib/frameModel'
import { ASSET_TAGS, MOTOR, THERMAL } from '../lib/pumpPhysics'
import { seededRandom } from '../lib/vibration'

export const DEMO_TICK_S = 0.5
const DEMO_DURATION_S = 300
const DEMO_SEED = 20260813
const DEMO_START_MS = Date.UTC(2026, 2, 14, 9, 0, 0)

interface Phase {
  from_s: number
  to_s: number
  asset_state: string
  fault_state: string
  /** Severity reached at the END of the phase; ramps linearly across it. */
  severity_end: number
  valve_opening: number
  rpm_setpoint: number
}

const PHASES: Phase[] = [
  { from_s: 0, to_s: 10, asset_state: AssetState.OFF, fault_state: FaultType.NORMAL, severity_end: 0, valve_opening: 1, rpm_setpoint: 0 },
  { from_s: 10, to_s: 30, asset_state: AssetState.STARTING, fault_state: FaultType.NORMAL, severity_end: 0, valve_opening: 1, rpm_setpoint: 1450 },
  { from_s: 30, to_s: 90, asset_state: AssetState.RUNNING, fault_state: FaultType.NORMAL, severity_end: 0, valve_opening: 1, rpm_setpoint: 1450 },
  { from_s: 90, to_s: 150, asset_state: AssetState.RUNNING, fault_state: FaultType.FLOW_RESTRICTION, severity_end: 0.72, valve_opening: 1, rpm_setpoint: 1450 },
  { from_s: 150, to_s: 200, asset_state: AssetState.RUNNING, fault_state: FaultType.NORMAL, severity_end: 0, valve_opening: 1, rpm_setpoint: 1450 },
  { from_s: 200, to_s: 260, asset_state: AssetState.RUNNING, fault_state: FaultType.IMBALANCE, severity_end: 0.68, valve_opening: 0.95, rpm_setpoint: 1450 },
  { from_s: 260, to_s: DEMO_DURATION_S + 1, asset_state: AssetState.RUNNING, fault_state: FaultType.CAVITATION, severity_end: 0.65, valve_opening: 1, rpm_setpoint: 1450 },
]

function phaseAt(elapsed: number): { phase: Phase; severity: number; progress: number } {
  const phase = PHASES.find((p) => elapsed >= p.from_s && elapsed < p.to_s) ?? PHASES[PHASES.length - 1]
  const span = Math.max(1e-6, phase.to_s - phase.from_s)
  const progress = Math.min(1, Math.max(0, (elapsed - phase.from_s) / span))
  return { phase, severity: phase.severity_end * progress, progress }
}

function buildFrames(): Telemetry[] {
  const rand = seededRandom(DEMO_SEED)
  const frames: Telemetry[] = []
  let motorTempC: number = THERMAL.ambient_c
  let bearingTempC: number = THERMAL.ambient_c

  for (let elapsed = 0; elapsed <= DEMO_DURATION_S; elapsed += DEMO_TICK_S) {
    const { phase, severity, progress } = phaseAt(elapsed)
    // Speed ramps during STARTING so the digital twin visibly spins up.
    const rpm =
      phase.asset_state === AssetState.STARTING ? phase.rpm_setpoint * progress : phase.rpm_setpoint

    const frame = computeFrame({
      elapsed_s: elapsed,
      dt_s: DEMO_TICK_S,
      asset_state: phase.asset_state,
      rpm,
      valve_opening: phase.valve_opening,
      fault_state: phase.fault_state,
      severity,
      noise: 0,
      started_at_ms: DEMO_START_MS,
      motor_temperature_c: motorTempC,
      bearing_temperature_c: bearingTempC,
      rand,
      data_source: DataSource.RECORDED,
    })
    motorTempC = frame.motor_temperature_c
    bearingTempC = frame.bearing_temperature_c
    frames.push(frame)
  }
  return frames
}

/** The whole replay. Frames are ordered by elapsed_s, one every DEMO_TICK_S. */
export const DEMO_FRAMES: Telemetry[] = buildFrames()

export function demoFrameAt(index: number): Telemetry {
  const n = DEMO_FRAMES.length
  return DEMO_FRAMES[((index % n) + n) % n]
}

/** Valve opening that produced a given frame, for the Pump Performance page. */
export function demoValveOpening(frame: Telemetry): number {
  const { phase, severity } = phaseAt(frame.elapsed_s)
  return phase.fault_state === FaultType.FLOW_RESTRICTION
    ? Math.max(0.05, phase.valve_opening * (1 - 0.8 * severity))
    : phase.valve_opening
}

// --------------------------------------------------------------------------
// Diagnosis derived from a frame, when the backend cannot supply one
// --------------------------------------------------------------------------

function severityLabel(severity: number, health: number): string {
  if (severity < 0.05 && health > 90) return 'none'
  if (severity < 0.3) return 'minor'
  if (severity < 0.6) return 'moderate'
  return 'severe'
}

export const RECOMMENDED_ACTIONS: Record<string, string[]> = {
  [FaultType.NORMAL]: [
    'No action required. Continue routine condition monitoring.',
    'Next scheduled vibration survey in 30 days.',
  ],
  [FaultType.IMBALANCE]: [
    'Schedule single-plane balancing of the impeller at the next opportunity.',
    'Inspect the impeller for deposit build-up, erosion or a lost balance weight.',
    'Trend 1x amplitude daily until balancing is carried out.',
  ],
  [FaultType.MISALIGNMENT]: [
    'Check shaft alignment with dial indicators or a laser alignment tool.',
    'Inspect the coupling insert for wear and check the baseplate for soft foot.',
    'Re-check alignment at operating temperature, not cold.',
  ],
  [FaultType.FLOW_RESTRICTION]: [
    'Inspect the discharge valve position and the suction strainer for blockage.',
    'Compare the measured operating point against the published pump curve.',
    'Prolonged throttled operation away from BEP shortens seal and bearing life.',
  ],
  [FaultType.CAVITATION]: [
    'Raise suction pressure: open the suction valve fully and clean the strainer.',
    'Check reservoir level and suction lift against the NPSH required curve.',
    'Reduce speed or throttle the discharge until the NPSH margin is positive.',
    'Continued cavitation will pit the impeller and erode the vane leading edges.',
  ],
  [FaultType.DRY_RUN]: [
    'Stop the pump immediately -- dry running destroys the mechanical seal in minutes.',
    'Verify reservoir level and prime the suction line before restarting.',
    'Check the low-level interlock that should have prevented this.',
  ],
  [FaultType.SENSOR_FAULT]: [
    'Treat the affected channel as unreliable until it has been verified.',
    'Check sensor wiring, connector and loop power.',
    'Do not act on a diagnosis derived from a suspect channel.',
  ],
}

const FEATURE_IMPORTANCE: Record<string, Record<string, number>> = {
  [FaultType.IMBALANCE]: {
    amplitude_1x_mm_s: 0.41,
    vibration_rms_mm_s: 0.22,
    vibration_peak_mm_s: 0.12,
    amplitude_2x_mm_s: 0.09,
    bearing_temperature_c: 0.08,
    crest_factor: 0.05,
    flow_lpm: 0.03,
  },
  [FaultType.MISALIGNMENT]: {
    amplitude_2x_mm_s: 0.39,
    amplitude_1x_mm_s: 0.19,
    vibration_rms_mm_s: 0.16,
    bearing_temperature_c: 0.13,
    crest_factor: 0.08,
    motor_current_a: 0.05,
  },
  [FaultType.CAVITATION]: {
    high_frequency_energy: 0.38,
    npsh_margin_m: 0.26,
    suction_pressure_kpa: 0.14,
    crest_factor: 0.1,
    pump_head_m: 0.07,
    pump_efficiency: 0.05,
  },
  [FaultType.FLOW_RESTRICTION]: {
    flow_lpm: 0.34,
    differential_pressure_kpa: 0.24,
    pump_head_m: 0.16,
    motor_current_a: 0.13,
    pump_efficiency: 0.08,
    vibration_rms_mm_s: 0.05,
  },
  [FaultType.DRY_RUN]: {
    motor_current_a: 0.3,
    flow_lpm: 0.24,
    bearing_temperature_c: 0.18,
    npsh_margin_m: 0.13,
    pump_head_m: 0.1,
    high_frequency_energy: 0.05,
  },
  [FaultType.SENSOR_FAULT]: {
    suction_pressure_kpa: 0.44,
    differential_pressure_kpa: 0.21,
    flow_lpm: 0.15,
    pump_head_m: 0.11,
    vibration_rms_mm_s: 0.09,
  },
  [FaultType.NORMAL]: {
    vibration_rms_mm_s: 0.24,
    pump_efficiency: 0.19,
    npsh_margin_m: 0.16,
    amplitude_1x_mm_s: 0.15,
    motor_current_a: 0.14,
    bearing_temperature_c: 0.12,
  },
}

/**
 * Physics rules and the model opinion are built into SEPARATE evidence lists,
 * exactly as the contract requires, so the UI can show where they agree and
 * where only one of them is asserting something.
 */
export function demoDiagnosis(frame: Telemetry): Diagnosis {
  const condition = frame.fault_state
  const running = frame.asset_state === AssetState.RUNNING

  const physics: Diagnosis['physics_evidence'] = [
    {
      source: 'physics',
      statement: `Vibration velocity RMS is ${frame.vibration_rms_mm_s.toFixed(2)} mm/s`,
      measured_value: frame.vibration_rms_mm_s,
      unit: 'mm/s',
      reference: 'ISO 10816-3 zone B/C boundary at 1.8 mm/s',
    },
    {
      source: 'physics',
      statement: `1x amplitude ${frame.amplitude_1x_mm_s.toFixed(2)} mm/s against 2x ${frame.amplitude_2x_mm_s.toFixed(2)} mm/s`,
      measured_value: frame.amplitude_1x_mm_s,
      unit: 'mm/s',
      reference: 'Imbalance is dominated by 1x; misalignment lifts 2x',
    },
    {
      source: 'physics',
      statement: `NPSH margin is ${frame.npsh_margin_m.toFixed(2)} m (NPSHa - NPSHr)`,
      measured_value: frame.npsh_margin_m,
      unit: 'm',
      reference: 'Margin below 0.5 m risks cavitation inception',
    },
    {
      source: 'physics',
      statement: `Pump efficiency ${(frame.pump_efficiency * 100).toFixed(1)} % at ${frame.flow_lpm.toFixed(1)} L/min`,
      measured_value: frame.pump_efficiency,
      unit: '-',
      reference: 'Best efficiency point: 62 % at 22 L/min',
    },
  ]

  const model: Diagnosis['model_evidence'] = [
    {
      source: 'model',
      statement: `Classifier output: ${condition.replace(/_/g, ' ')}`,
      measured_value: null,
      unit: '',
      reference: 'Gradient-boosted classifier over the 16-feature contract vector',
    },
    {
      source: 'model',
      statement: `Anomaly score ${frame.anomaly_score.toFixed(2)} from the unsupervised detector`,
      measured_value: frame.anomaly_score,
      unit: '-',
      reference: 'Isolation Forest, alarm threshold 0.55',
    },
    {
      source: 'model',
      statement: `High-frequency band energy ${frame.high_frequency_energy.toFixed(2)} mm/s`,
      measured_value: frame.high_frequency_energy,
      unit: 'mm/s',
      reference: 'Broadband HF rise is the strongest cavitation feature',
    },
  ]

  return {
    detected_condition: condition,
    confidence:
      condition === FaultType.NORMAL ? 0.94 : Math.min(0.97, 0.55 + frame.severity * 0.5),
    health_index: frame.health_index,
    severity_label: running ? severityLabel(frame.severity, frame.health_index) : 'none',
    physics_evidence: physics,
    model_evidence: model,
    feature_importance: FEATURE_IMPORTANCE[condition] ?? FEATURE_IMPORTANCE[FaultType.NORMAL],
    recommended_actions:
      RECOMMENDED_ACTIONS[condition] ?? RECOMMENDED_ACTIONS[FaultType.NORMAL],
    anomaly_score: frame.anomaly_score,
    is_sensor_fault: condition === FaultType.SENSOR_FAULT,
    physics_model_conflict: false,
    schema_version: '1.0.0',
  }
}

// --------------------------------------------------------------------------
// Alarms derived from the current frame
// --------------------------------------------------------------------------

interface AlarmRule {
  tag: string
  description: string
  severity: string
  unit: string
  threshold: number
  read: (f: Telemetry) => number
  active: (f: Telemetry) => boolean
}

const ALARM_RULES: AlarmRule[] = [
  {
    tag: ASSET_TAGS.accelerometer,
    description: 'Vibration velocity RMS above ISO 10816-3 zone C',
    severity: 'ALARM',
    unit: 'mm/s',
    threshold: 4.5,
    read: (f) => f.vibration_rms_mm_s,
    active: (f) => f.vibration_rms_mm_s > 4.5,
  },
  {
    tag: ASSET_TAGS.accelerometer,
    description: 'Vibration velocity RMS above ISO 10816-3 zone B',
    severity: 'WARNING',
    unit: 'mm/s',
    threshold: 1.8,
    read: (f) => f.vibration_rms_mm_s,
    active: (f) => f.vibration_rms_mm_s > 1.8,
  },
  {
    tag: ASSET_TAGS.suction_pressure,
    description: 'NPSH margin low -- cavitation risk',
    severity: 'ALARM',
    unit: 'm',
    threshold: 0.5,
    read: (f) => f.npsh_margin_m,
    active: (f) => f.npsh_margin_m < 0.5 && f.asset_state === AssetState.RUNNING,
  },
  {
    tag: ASSET_TAGS.bearing_temperature,
    description: 'Bearing temperature high',
    severity: 'WARNING',
    unit: 'degC',
    threshold: 62,
    read: (f) => f.bearing_temperature_c,
    active: (f) => f.bearing_temperature_c > 62,
  },
  {
    tag: ASSET_TAGS.motor_temperature,
    description: 'Motor winding temperature high',
    severity: 'ALARM',
    unit: 'degC',
    threshold: 78,
    read: (f) => f.motor_temperature_c,
    active: (f) => f.motor_temperature_c > 78,
  },
  {
    tag: ASSET_TAGS.flow,
    description: 'Flow below minimum continuous stable flow',
    severity: 'WARNING',
    unit: 'L/min',
    threshold: 8,
    read: (f) => f.flow_lpm,
    active: (f) => f.asset_state === AssetState.RUNNING && f.flow_lpm < 8,
  },
  {
    tag: ASSET_TAGS.current,
    description: 'Motor current above service factor',
    severity: 'TRIP',
    unit: 'A',
    threshold: Number((MOTOR.rated_current_a * 1.15).toFixed(2)),
    read: (f) => f.motor_current_a,
    active: (f) => f.motor_current_a > MOTOR.rated_current_a * 1.15,
  },
  {
    tag: ASSET_TAGS.speed,
    description: 'Emergency stop actuated',
    severity: 'CRITICAL',
    unit: 'rpm',
    threshold: 0,
    read: (f) => f.rpm,
    active: (f) => f.asset_state === AssetState.E_STOP,
  },
]

export function demoAlarms(frame: Telemetry): Alarm[] {
  return ALARM_RULES.map((rule, index) => ({
    id: index + 1,
    timestamp: frame.timestamp,
    tag: rule.tag,
    description: rule.description,
    severity: rule.severity,
    value: Number(rule.read(frame).toFixed(2)),
    threshold: rule.threshold,
    unit: rule.unit,
    state: rule.active(frame) ? 'ACTIVE' : 'CLEARED',
    acknowledged: false,
    acknowledged_at: '',
  }))
}
