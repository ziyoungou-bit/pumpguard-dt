/**
 * Mirror of backend/app/contracts.py -- the frozen wire contract.
 *
 * RULE: field names here are copied VERBATIM from the Python dataclasses.
 * Nothing is renamed to camelCase, nothing is nested, nothing is "tidied".
 * `flow_lpm` stays `flow_lpm`. A renamed field would read back `undefined`,
 * the chart would draw nothing, and no error would be raised anywhere -- the
 * exact silent failure this contract exists to prevent.
 *
 * Enums are expressed as const objects + union types rather than TS `enum`
 * because the project builds with `erasableSyntaxOnly`, and because the wire
 * values are plain strings either way.
 */

export const SCHEMA_VERSION = '1.0.0'

// --------------------------------------------------------------------------
// Enumerations (string values identical to the Python side)
// --------------------------------------------------------------------------

export const AssetState = {
  OFF: 'OFF',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  FAULT: 'FAULT',
  E_STOP: 'E_STOP',
  MAINTENANCE: 'MAINTENANCE',
} as const
export type AssetState = (typeof AssetState)[keyof typeof AssetState]

export const FaultType = {
  NORMAL: 'normal',
  IMBALANCE: 'imbalance',
  MISALIGNMENT: 'misalignment',
  FLOW_RESTRICTION: 'flow_restriction',
  CAVITATION: 'cavitation',
  DRY_RUN: 'dry_run',
  SENSOR_FAULT: 'sensor_fault',
} as const
export type FaultType = (typeof FaultType)[keyof typeof FaultType]

export const SensorQuality = {
  GOOD: 'GOOD',
  UNCERTAIN: 'UNCERTAIN',
  BAD: 'BAD',
} as const
export type SensorQuality = (typeof SensorQuality)[keyof typeof SensorQuality]

export const AlarmSeverity = {
  WARNING: 'WARNING',
  ALARM: 'ALARM',
  TRIP: 'TRIP',
  CRITICAL: 'CRITICAL',
} as const
export type AlarmSeverity = (typeof AlarmSeverity)[keyof typeof AlarmSeverity]

export const DataSource = {
  SIMULATION: 'SIMULATION',
  RECORDED: 'RECORDED',
  LIVE_DEVICE: 'LIVE_DEVICE',
} as const
export type DataSource = (typeof DataSource)[keyof typeof DataSource]

// --------------------------------------------------------------------------
// Telemetry -- the /ws/realtime payload
// --------------------------------------------------------------------------

export interface Telemetry {
  timestamp: string // ISO 8601 UTC
  elapsed_s: number

  // --- process values ---
  rpm: number // RPM-101, rev/min
  flow_lpm: number // FT-101, litres/min
  pump_head_m: number // derived, metres of water
  suction_pressure_kpa: number // PT-101, kPa absolute
  discharge_pressure_kpa: number // PT-102, kPa absolute
  differential_pressure_kpa: number // PT-102 - PT-101
  motor_current_a: number // CT-101, amperes
  motor_temperature_c: number // TT-101, degrees Celsius
  bearing_temperature_c: number // TT-102, degrees Celsius

  // --- vibration (ACC-101), mm/s unless stated ---
  vibration_x_mm_s: number
  vibration_y_mm_s: number
  vibration_z_mm_s: number
  vibration_rms_mm_s: number
  vibration_peak_mm_s: number
  crest_factor: number // dimensionless
  amplitude_1x_mm_s: number
  amplitude_2x_mm_s: number
  high_frequency_energy: number // mm/s
  dominant_frequency_hz: number
  rotational_frequency_hz: number // rpm / 60

  // --- performance ---
  pump_efficiency: number // 0..1
  hydraulic_power_w: number
  shaft_power_w: number
  electrical_power_w: number

  // --- condition ---
  health_index: number // 0..100, 100 = healthy
  anomaly_score: number // 0..1
  fault_state: string // FaultType value, the TRUE injected state
  severity: number // 0..1
  asset_state: string // AssetState value
  npsh_margin_m: number // NPSHa - NPSHr

  // --- provenance ---
  data_source: string // DataSource value
  sensor_quality: Record<string, string> // tag -> SensorQuality
  schema_version: string
}

// --------------------------------------------------------------------------
// Diagnosis
// --------------------------------------------------------------------------

export interface DiagnosisEvidence {
  source: string // "physics" | "model"
  statement: string
  measured_value: number | null
  unit: string
  reference: string
}

export interface Diagnosis {
  detected_condition: string // FaultType value
  confidence: number // 0..1
  health_index: number // 0..100
  severity_label: string // "none" | "minor" | "moderate" | "severe"
  physics_evidence: DiagnosisEvidence[]
  model_evidence: DiagnosisEvidence[]
  feature_importance: Record<string, number>
  recommended_actions: string[]
  anomaly_score: number
  is_sensor_fault: boolean
  physics_model_conflict: boolean
  schema_version: string
}

// --------------------------------------------------------------------------
// Alarm
// --------------------------------------------------------------------------

export interface Alarm {
  id: number
  timestamp: string
  tag: string // e.g. "PT-101"
  description: string
  severity: string // AlarmSeverity value
  value: number
  threshold: number
  unit: string
  state: string // "ACTIVE" | "CLEARED"
  acknowledged: boolean
  acknowledged_at: string
}

// --------------------------------------------------------------------------
// Derived / endpoint-shaped payloads
// --------------------------------------------------------------------------

/** GET /api/pump-curve */
export interface PumpCurvePoint {
  flow_lpm: number
  pump_head_m: number
  system_head_m: number
  pump_efficiency: number
}

export interface PumpCurveResponse {
  curve: PumpCurvePoint[]
  operating_point: {
    flow_lpm: number
    pump_head_m: number
    pump_efficiency: number
  }
  valve_opening: number
  rpm: number
}

/** GET /api/vibration -- time waveform */
export interface VibrationWaveformPoint {
  t_s: number
  amplitude_mm_s: number
}

export interface VibrationResponse {
  waveform: VibrationWaveformPoint[]
  sample_rate_hz: number
  vibration_rms_mm_s: number
  vibration_peak_mm_s: number
  crest_factor: number
  rotational_frequency_hz: number
}

/** GET /api/fft -- spectrum */
export interface SpectrumBin {
  frequency_hz: number
  amplitude_mm_s: number
}

export interface FftResponse {
  spectrum: SpectrumBin[]
  rotational_frequency_hz: number
  amplitude_1x_mm_s: number
  amplitude_2x_mm_s: number
  dominant_frequency_hz: number
  high_frequency_energy: number
  /**
   * Analysis parameters of the block this spectrum was measured from.
   *
   * Carried with the data because resolution is a property OF the data, not of
   * the viewer, and whether two nearby orders can be told apart is a question
   * only these numbers can answer. 2x mechanical and line frequency sit 1.67 Hz
   * apart on this machine; without df on the wire the UI would have to guess
   * whether the peak it is labelling is one, the other, or both.
   */
  resolution_hz: number
  sampling_rate_hz: number
  block_size: number
}

/** GET /api/bearing-frequencies -- theoretical, never "detected faults" */
export interface BearingFrequencies {
  designation: string
  shaft_rpm: number
  rotational_frequency_hz: number
  bpfo_hz: number
  bpfi_hz: number
  bsf_hz: number
  ftf_hz: number
}

/** GET /api/history */
export interface HistoryPoint {
  elapsed_s: number
  timestamp: string
  value: number
}

export interface HistoryResponse {
  signal: string
  window: string
  unit: string
  points: HistoryPoint[]
}

/** GET /api/status */
export interface SystemStatus {
  asset_state: string
  data_source: string
  session_id?: string
  operating_hours: number
  rpm_setpoint: number
  valve_opening: number
  auto_mode: boolean
  injected_fault: string
  injected_severity: number
  blocked_reason?: string
  schema_version: string
}
