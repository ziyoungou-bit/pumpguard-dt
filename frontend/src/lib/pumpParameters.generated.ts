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
  duty_flow_lpm: 20.0,
  duty_head_m: 8.0,
  bep_flow_lpm: 22.0,
  bep_efficiency: 0.42,
  impeller_diameter_m: 0.105,
  suction_diameter_m: 0.025,
  discharge_diameter_m: 0.02,
  impeller_vanes: 6,
} as const

export const MOTOR = {
  tag: 'MTR-101',
  rated_power_w: 120.0,
  rated_speed_rpm: 1450.0,
  synchronous_speed_rpm: 1500.0,
  supply_frequency_hz: 50.0,
  poles: 4,
  rated_voltage_v: 230.0,
  phases: 1,
  power_factor: 0.82,
  efficiency: 0.72,
  no_load_current_a: 0.42,
  rated_current_a: 0.95,
  service_factor: 1.15,
  parasitic_loss_at_rated_w: 9.0,
} as const

export const CIRCUIT = {
  static_head_m: 2.0,
  pipe_resistance: 42600000.0,
  valve_resistance_open: 3000000.0,
  valve_resistance_closed: 4000000000.0,
  suction_resistance: 4500000.0,
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
export const HEAD_COEFFICIENT = 36000000.0

/**
 * n_q = N sqrt(Q) / H^0.75 at the rated duty point, N in rpm, Q in m^3/s.
 * See PumpParameters.specific_speed_nq for why this number sets eta_BEP.
 */
export const SPECIFIC_SPEED_NQ = 5.565316716512929
