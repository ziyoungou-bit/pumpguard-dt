/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Projected from backend/app/config/pump_parameters.py by
 * scripts/export_parameters.py. That module is the single source of truth for
 * every physical constant in this project; this file exists only so the browser
 * can evaluate the same physics with no backend reachable.
 *
 * To change a number, change it in pump_parameters.py and re-run:
 *
 *     python scripts/export_parameters.py
 *
 * backend/tests/test_parameters_export.py fails if this file is stale, so the
 * two sides cannot drift apart the way they did when they were hand-copied.
 */

/** Litres per minute in one cubic metre per second. */
export const LPM_PER_M3S = 60000

export const FLUID = {
  density: 998.2,
  gravity: 9.80665,
  vapour_pressure: 2339.0,
  atmospheric_pressure: 101325.0,
} as const

export const PUMP = {
  tag: 'P-101',
  rated_speed_rpm: 1450.0,
  shutoff_head_m: 12.0,
  duty_flow_lpm: 110.0,
  duty_head_m: 8.0,
  bep_flow_lpm: 121.0,
  impeller_diameter_m: 0.105,
  suction_diameter_m: 0.025,
  discharge_diameter_m: 0.02,
  impeller_vanes: 6,
  bep_efficiency: 0.48736713078337035,
} as const

export const MOTOR = {
  tag: 'MTR-101',
  rated_power_w: 370.0,
  rated_speed_rpm: 1450.0,
  synchronous_speed_rpm: 1500.0,
  supply_frequency_hz: 50.0,
  poles: 4,
  rated_voltage_v: 230.0,
  phases: 1,
  power_factor: 0.82,
  efficiency: 0.72,
  rated_current_a: 2.72,
  service_factor: 1.15,
} as const

export const CIRCUIT = {
  static_head_m: 2.0,
  pipe_resistance: 1408300.0,
  valve_resistance_open: 99174.0,
  valve_resistance_closed: 132230000.0,
  suction_resistance: 147440.0,
  suction_lift_m: 1.2,
  reservoir_level_m: 0.8,
} as const

export const BEARING = {
  designation: '6205',
  rolling_elements: 9,
  ball_diameter_mm: 7.94,
  pitch_diameter_mm: 39.04,
  contact_angle_deg: 0.0,
} as const

export const THERMAL = {
  ambient_c: 23.0,
  motor_rise_at_rated_c: 42.0,
  motor_time_constant_s: 420.0,
  bearing_rise_at_rated_c: 28.0,
  bearing_time_constant_s: 300.0,
  dry_run_extra_rise_c: 55.0,
  dry_run_time_constant_s: 180.0,
} as const

export const ASSET_TAGS = {
  motor: 'MTR-101',
  pump: 'P-101',
  accelerometer: 'ACC-101',
  motor_temperature: 'TT-101',
  bearing_temperature: 'TT-102',
  suction_pressure: 'PT-101',
  discharge_pressure: 'PT-102',
  flow: 'FT-101',
  current: 'CT-101',
  speed: 'RPM-101',
} as const

/**
 * a in H = H0 - a Q^2, m/(m^3/s)^2, derived from the two catalogue points.
 * Derived on the Python side so both languages get the identical float.
 */
export const HEAD_COEFFICIENT = 1190082.6446280992

/**
 * n_s = N sqrt(Q_BEP) / (H_BEP / i)^0.75, N in rpm, Q in m^3/s, i = 1.
 * The definition in Commission Regulation (EU) No 547/2012, Annex III.
 * See PumpParameters.specific_speed_nq.
 */
export const SPECIFIC_SPEED_NS = 14.876483861946936

/** Head on the rated curve at the BEP flow, metres. H0 - a Q_BEP^2. */
export const BEP_HEAD_M = 7.160000000000001

export const VIBRATION = {
  zone_a_b_mm_s: 0.71,
  zone_b_c_mm_s: 1.8,
  zone_c_d_mm_s: 4.5,
  band_low_hz: 10.0,
  band_high_hz: 1000.0,
  trip_mm_s: 4.5,
} as const

export const TEMPERATURE = {
  motor_warning_c: 65.0,
  motor_alarm_c: 75.0,
  motor_trip_c: 90.0,
  bearing_warning_c: 55.0,
  bearing_alarm_c: 65.0,
  bearing_trip_c: 80.0,
} as const

export const ACQUISITION_BLOCK = {
  name: 'acquisition',
  sampling_rate_hz: 5120.0,
  block_size: 4096,
  purpose: 'feature extraction and ML input; 1.25 Hz resolution',
  resolution_hz: 1.25,
  duration_s: 0.8,
} as const

export const DISPLAY_BLOCK = {
  name: 'display',
  sampling_rate_hz: 2560.0,
  block_size: 8192,
  purpose: 'browser-side spectrum; 0.3125 Hz resolution, separates 2x from line frequency',
  resolution_hz: 0.3125,
  duration_s: 3.2,
} as const

/**
 * Alarm setpoints, keyed exactly as backend/app/config/alarm_thresholds.py
 * names them. The UI must not restate a limit: every threshold it draws,
 * colours or compares against comes from here.
 */
export const ALARM_LIMITS = {
  flow_low: {
    tag: 'FT-101',
    unit: 'L/min',
    direction: 'low',
    warning: 77.0,
    alarm: 50.0,
    trip: 22.0,
    deadband: 5.5,
  },
  suction_pressure_low: {
    tag: 'PT-101',
    unit: 'kPa',
    direction: 'low',
    warning: 70.0,
    alarm: 55.0,
    trip: 40.0,
    deadband: 3.0,
  },
  discharge_pressure_high: {
    tag: 'PT-102',
    unit: 'kPa',
    direction: 'high',
    warning: 215.0,
    alarm: 235.0,
    trip: 260.0,
    deadband: 4.0,
  },
  motor_current_high: {
    tag: 'CT-101',
    unit: 'A',
    direction: 'high',
    warning: 2.72,
    alarm: 3.13,
    trip: 3.7,
    deadband: 0.08,
  },
  motor_current_low: {
    tag: 'CT-101',
    unit: 'A',
    direction: 'low',
    warning: 1.6,
    alarm: 1.2,
    trip: 0.9,
    deadband: 0.08,
  },
  motor_temperature_high: {
    tag: 'TT-101',
    unit: 'C',
    direction: 'high',
    warning: 65.0,
    alarm: 75.0,
    trip: 90.0,
    deadband: 2.0,
  },
  bearing_temperature_high: {
    tag: 'TT-102',
    unit: 'C',
    direction: 'high',
    warning: 55.0,
    alarm: 65.0,
    trip: 80.0,
    deadband: 2.0,
  },
  vibration_high: {
    tag: 'ACC-101',
    unit: 'mm/s',
    direction: 'high',
    warning: 1.8,
    alarm: 4.5,
    trip: 4.5,
    deadband: 0.4,
  },
  npsh_margin_low: {
    tag: 'P-101',
    unit: 'm',
    direction: 'low',
    warning: 1.5,
    alarm: 0.5,
    trip: -0.5,
    deadband: 0.3,
  },
} as const

/**
 * Frames per second the backend emits, and the tick interval that follows.
 * The browser-side replay used to carry a hardcoded 0.5 s, so the two
 * halves disagreed about how fast the machine was being observed and
 * every window computed from it -- including the history buffer's stated
 * '30 minutes' -- was wrong by a factor of 2.5.
 */
export const TELEMETRY_RATE_HZ = 5.0
export const TICK_INTERVAL_S = 0.2
