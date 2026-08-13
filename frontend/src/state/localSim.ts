/**
 * Browser-side SCADA state machine and plant model, used ONLY when the backend
 * is unreachable.
 *
 * Without it, a recruiter opening the site cold would find the SCADA and
 * Simulation Lab pages inert -- buttons that do nothing are worse than no
 * buttons. With it, the control logic, the interlocks and the fault injection
 * all still demonstrate, driven by the same frame model as the recorded demo.
 *
 * The state machine mirrors the states in the contract's AssetState. Transitions
 * that are refused return a reason, because "why is START blocked?" is exactly
 * what the SCADA page has to be able to answer.
 *
 *   OFF ---START--> STARTING --(ramp complete)--> RUNNING
 *   RUNNING ---STOP--> STOPPING --(ramp complete)--> OFF
 *   any ---E-STOP--> E_STOP ---RESET--> OFF
 *   RUNNING --(trip condition)--> FAULT ---RESET--> OFF
 *   OFF <--MAINTENANCE--> MAINTENANCE
 */

import type { Telemetry } from '../types/contracts'
import { AssetState, DataSource, FaultType } from '../types/contracts'
import { computeFrame } from '../lib/frameModel'
import { MOTOR, THERMAL } from '../lib/pumpPhysics'
import { seededRandom } from '../lib/vibration'

export type ScadaCommand =
  | 'start'
  | 'stop'
  | 'reset'
  | 'estop'
  | 'auto'
  | 'manual'
  | 'maintenance'

export interface LocalSimState {
  asset_state: string
  rpm: number
  rpm_setpoint: number
  valve_opening: number
  fault_state: string
  severity: number
  /** Sensor noise multiplier, 0..1, from the Simulation Lab. */
  noise: number
  auto_mode: boolean
  elapsed_s: number
  operating_hours: number
  motor_temperature_c: number
  bearing_temperature_c: number
  /** Why the last refused command was refused. Empty when nothing was refused. */
  blocked_reason: string
  started_at_ms: number
}

export function initialLocalSimState(): LocalSimState {
  return {
    asset_state: AssetState.OFF,
    rpm: 0,
    rpm_setpoint: MOTOR.rated_speed_rpm,
    valve_opening: 1,
    fault_state: FaultType.NORMAL,
    severity: 0,
    noise: 0.05,
    auto_mode: true,
    elapsed_s: 0,
    operating_hours: 1284.5,
    motor_temperature_c: THERMAL.ambient_c,
    bearing_temperature_c: THERMAL.ambient_c,
    blocked_reason: '',
    started_at_ms: Date.now(),
  }
}

const RAMP_RPM_PER_S = 380

/** Interlock check. Returns the reason a command would be refused, or null. */
export function commandBlockedReason(state: LocalSimState, command: ScadaCommand): string | null {
  switch (command) {
    case 'start':
      if (state.asset_state === AssetState.E_STOP)
        return 'Emergency stop is latched. RESET is required before START.'
      if (state.asset_state === AssetState.FAULT)
        return 'Asset is in FAULT. Clear the cause and RESET before START.'
      if (state.asset_state === AssetState.MAINTENANCE)
        return 'Asset is in MAINTENANCE mode. Exit maintenance before START.'
      if (state.asset_state === AssetState.RUNNING) return 'Asset is already RUNNING.'
      if (state.asset_state === AssetState.STARTING) return 'Start sequence is already in progress.'
      if (state.asset_state === AssetState.STOPPING)
        return 'Stop sequence in progress. Wait for OFF before restarting.'
      return null
    case 'stop':
      if (state.asset_state === AssetState.OFF) return 'Asset is already OFF.'
      if (state.asset_state === AssetState.E_STOP)
        return 'Emergency stop is latched. RESET is required.'
      return null
    case 'reset':
      if (state.asset_state === AssetState.RUNNING)
        return 'RESET is not permitted while the asset is RUNNING.'
      if (state.asset_state === AssetState.STARTING)
        return 'RESET is not permitted during the start sequence.'
      return null
    case 'estop':
      return null
    case 'maintenance':
      if (state.asset_state !== AssetState.OFF && state.asset_state !== AssetState.MAINTENANCE)
        return 'MAINTENANCE mode can only be entered from OFF.'
      return null
    case 'auto':
    case 'manual':
      if (state.asset_state === AssetState.E_STOP)
        return 'Mode cannot be changed while emergency stop is latched.'
      return null
    default:
      return null
  }
}

/**
 * Applies a command. A refused command changes nothing except `blocked_reason`,
 * so pressing START five times cannot corrupt the state -- it just re-states why
 * it is blocked.
 */
export function applyCommand(state: LocalSimState, command: ScadaCommand): LocalSimState {
  const blocked = commandBlockedReason(state, command)
  if (blocked) return { ...state, blocked_reason: blocked }

  switch (command) {
    case 'start':
      return { ...state, asset_state: AssetState.STARTING, blocked_reason: '' }
    case 'stop':
      return { ...state, asset_state: AssetState.STOPPING, blocked_reason: '' }
    case 'reset':
      return {
        ...state,
        asset_state: AssetState.OFF,
        fault_state: FaultType.NORMAL,
        severity: 0,
        blocked_reason: '',
      }
    case 'estop':
      return { ...state, asset_state: AssetState.E_STOP, rpm: 0, blocked_reason: '' }
    case 'maintenance':
      return {
        ...state,
        asset_state:
          state.asset_state === AssetState.MAINTENANCE ? AssetState.OFF : AssetState.MAINTENANCE,
        blocked_reason: '',
      }
    case 'auto':
      return { ...state, auto_mode: true, blocked_reason: '' }
    case 'manual':
      return { ...state, auto_mode: false, blocked_reason: '' }
    default:
      return state
  }
}

const rand = seededRandom(987654321)

/** Advances the plant by dt seconds and produces the resulting frame. */
export function tickLocalSim(
  state: LocalSimState,
  dtS: number,
): { state: LocalSimState; frame: Telemetry } {
  let { rpm, asset_state } = state

  if (asset_state === AssetState.STARTING) {
    rpm = Math.min(state.rpm_setpoint, rpm + RAMP_RPM_PER_S * dtS)
    if (rpm >= state.rpm_setpoint - 1) {
      rpm = state.rpm_setpoint
      asset_state = AssetState.RUNNING
    }
  } else if (asset_state === AssetState.RUNNING) {
    rpm += (state.rpm_setpoint - rpm) * Math.min(1, dtS * 1.5)
  } else if (asset_state === AssetState.STOPPING) {
    rpm = Math.max(0, rpm - RAMP_RPM_PER_S * dtS)
    if (rpm <= 1) {
      rpm = 0
      asset_state = AssetState.OFF
    }
  } else {
    rpm = Math.max(0, rpm - RAMP_RPM_PER_S * 2 * dtS)
  }

  const elapsed = state.elapsed_s + dtS
  const frame = computeFrame({
    elapsed_s: elapsed,
    dt_s: dtS,
    asset_state,
    rpm,
    valve_opening: state.valve_opening,
    fault_state: state.fault_state,
    severity: state.severity,
    noise: state.noise,
    started_at_ms: state.started_at_ms,
    motor_temperature_c: state.motor_temperature_c,
    bearing_temperature_c: state.bearing_temperature_c,
    rand,
    data_source: DataSource.RECORDED,
  })

  // Protection trip: the same limits the alarm list uses, so an alarm the UI
  // shows as TRIP actually trips the machine instead of just colouring a row.
  let nextState = asset_state
  if (asset_state === AssetState.RUNNING) {
    if (frame.motor_temperature_c > 95 || frame.vibration_rms_mm_s > 11) {
      nextState = AssetState.FAULT
    }
  }

  return {
    state: {
      ...state,
      asset_state: nextState,
      rpm,
      elapsed_s: elapsed,
      motor_temperature_c: frame.motor_temperature_c,
      bearing_temperature_c: frame.bearing_temperature_c,
      operating_hours:
        state.operating_hours + (nextState === AssetState.RUNNING ? dtS / 3600 : 0),
    },
    frame: nextState === asset_state ? frame : { ...frame, asset_state: nextState },
  }
}
