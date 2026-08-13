/**
 * Guards for the failure modes that do not throw.
 *
 * The expensive bug this project has already paid for once is a renamed field:
 * the producer writes `flow_lpm`, the consumer reads `flowRate`, the value is
 * `undefined`, the chart draws nothing and nothing anywhere raises an error.
 * TypeScript catches that between the frontend's own modules, but it cannot
 * catch it across the wire -- so the frame key list is asserted explicitly here
 * against the names in backend/app/contracts.py.
 */

import { describe, expect, it } from 'vitest'
import { DEMO_FRAMES, demoAlarms, demoDiagnosis } from '../data/recordedDemo'
import { AssetState, FaultType } from '../types/contracts'
import {
  CIRCUIT,
  PUMP,
  lpmToM3s,
  pumpHead,
  solveOperatingPoint,
  systemHead,
} from './pumpPhysics'
import { bearingDefectFrequencies, waveformStatistics } from './vibration'
import {
  applyCommand,
  commandBlockedReason,
  initialLocalSimState,
  tickLocalSim,
} from '../state/localSim'

/** Copied by hand from the Telemetry dataclass. Do not generate this list. */
const TELEMETRY_FIELDS = [
  'timestamp',
  'elapsed_s',
  'rpm',
  'flow_lpm',
  'pump_head_m',
  'suction_pressure_kpa',
  'discharge_pressure_kpa',
  'differential_pressure_kpa',
  'motor_current_a',
  'motor_temperature_c',
  'bearing_temperature_c',
  'vibration_x_mm_s',
  'vibration_y_mm_s',
  'vibration_z_mm_s',
  'vibration_rms_mm_s',
  'vibration_peak_mm_s',
  'crest_factor',
  'amplitude_1x_mm_s',
  'amplitude_2x_mm_s',
  'high_frequency_energy',
  'dominant_frequency_hz',
  'rotational_frequency_hz',
  'pump_efficiency',
  'hydraulic_power_w',
  'shaft_power_w',
  'electrical_power_w',
  'health_index',
  'anomaly_score',
  'fault_state',
  'severity',
  'asset_state',
  'npsh_margin_m',
  'data_source',
  'sensor_quality',
  'schema_version',
] as const

describe('telemetry contract', () => {
  it('every recorded frame carries exactly the contract field names', () => {
    for (const frame of DEMO_FRAMES) {
      expect(Object.keys(frame).sort()).toEqual([...TELEMETRY_FIELDS].sort())
    }
  })

  it('no numeric field is undefined or NaN in any frame', () => {
    for (const frame of DEMO_FRAMES) {
      for (const key of TELEMETRY_FIELDS) {
        const value = (frame as unknown as Record<string, unknown>)[key]
        expect(value).toBeDefined()
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('reports RECORDED provenance, never SIMULATION or LIVE_DEVICE', () => {
    for (const frame of DEMO_FRAMES) {
      expect(frame.data_source).toBe('RECORDED')
    }
  })

  it('uses only the contract vocabulary for states and fault classes', () => {
    const states = Object.values(AssetState) as string[]
    const faults = Object.values(FaultType) as string[]
    for (const frame of DEMO_FRAMES) {
      expect(states).toContain(frame.asset_state)
      expect(faults).toContain(frame.fault_state)
    }
  })

  it('keeps the health index inside 0..100 and the anomaly score inside 0..1', () => {
    for (const frame of DEMO_FRAMES) {
      expect(frame.health_index).toBeGreaterThanOrEqual(0)
      expect(frame.health_index).toBeLessThanOrEqual(100)
      expect(frame.anomaly_score).toBeGreaterThanOrEqual(0)
      expect(frame.anomaly_score).toBeLessThanOrEqual(1)
    }
  })

  it('exercises more than one condition, so the demo is not a flat line', () => {
    const conditions = new Set(DEMO_FRAMES.map((frame) => frame.fault_state))
    expect(conditions.size).toBeGreaterThan(2)
  })
})

describe('diagnosis and alarms derived from a frame', () => {
  const frame = DEMO_FRAMES[DEMO_FRAMES.length - 1]

  it('keeps physics evidence and model evidence in separate lists', () => {
    const diagnosis = demoDiagnosis(frame)
    expect(diagnosis.physics_evidence.length).toBeGreaterThan(0)
    expect(diagnosis.model_evidence.length).toBeGreaterThan(0)
    expect(diagnosis.physics_evidence.every((item) => item.source === 'physics')).toBe(true)
    expect(diagnosis.model_evidence.every((item) => item.source === 'model')).toBe(true)
  })

  it('always offers at least one recommended action', () => {
    for (const fault of Object.values(FaultType)) {
      const diagnosis = demoDiagnosis({ ...frame, fault_state: fault })
      expect(diagnosis.recommended_actions.length).toBeGreaterThan(0)
    }
  })

  it('gives every alarm a value, a threshold and a unit', () => {
    for (const alarm of demoAlarms(frame)) {
      expect(Number.isFinite(alarm.value)).toBe(true)
      expect(Number.isFinite(alarm.threshold)).toBe(true)
      expect(alarm.unit.length).toBeGreaterThan(0)
      expect(['ACTIVE', 'CLEARED']).toContain(alarm.state)
    }
  })
})

describe('pump hydraulics', () => {
  it('solves the operating point at the intersection of the two curves', () => {
    const point = solveOperatingPoint(PUMP.rated_speed_rpm, 1)
    const flowM3s = lpmToM3s(point.flow_lpm)
    expect(pumpHead(flowM3s, PUMP.rated_speed_rpm)).toBeCloseTo(systemHead(flowM3s, 1), 6)
  })

  it('lands the fully-open duty point near the best efficiency point', () => {
    const point = solveOperatingPoint(PUMP.rated_speed_rpm, 1)
    expect(point.flow_lpm).toBeGreaterThan(18)
    expect(point.flow_lpm).toBeLessThan(24)
  })

  it('moves the operating point up the pump curve as the valve closes', () => {
    const open = solveOperatingPoint(PUMP.rated_speed_rpm, 1)
    const throttled = solveOperatingPoint(PUMP.rated_speed_rpm, 0.3)
    expect(throttled.flow_lpm).toBeLessThan(open.flow_lpm)
    expect(throttled.pump_head_m).toBeGreaterThan(open.pump_head_m)
    expect(throttled.pump_head_m).toBeLessThanOrEqual(PUMP.shutoff_head_m)
  })

  it('follows the affinity law H ~ N^2 on the shutoff head', () => {
    expect(pumpHead(0, PUMP.rated_speed_rpm / 2)).toBeCloseTo(PUMP.shutoff_head_m / 4, 6)
  })

  it('produces no flow when the pump cannot lift the static head', () => {
    expect(solveOperatingPoint(300, 1).flow_lpm).toBe(0)
    expect(CIRCUIT.static_head_m).toBeGreaterThan(0)
  })
})

describe('vibration mathematics', () => {
  it('satisfies the BPFO + BPFI = n * f_r identity', () => {
    const f = bearingDefectFrequencies({
      rolling_elements: 9,
      ball_diameter_mm: 7.94,
      pitch_diameter_mm: 39.04,
      contact_angle_deg: 0,
      shaft_rpm: 1450,
    })
    expect(f.bpfo_hz + f.bpfi_hz).toBeCloseTo(9 * f.rotational_frequency_hz, 8)
    expect(f.bpfi_hz).toBeGreaterThan(f.bpfo_hz)
    expect(f.ftf_hz).toBeCloseTo(f.bpfo_hz / 9, 8)
  })

  it('gives a sine wave a crest factor of sqrt(2)', () => {
    const samples = Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * i) / 256))
    const stats = waveformStatistics(samples)
    expect(stats.crest_factor).toBeCloseTo(Math.SQRT2, 2)
    expect(stats.peak_to_peak_mm_s).toBeCloseTo(2 * stats.peak_mm_s, 2)
  })

  it('returns zeroes rather than NaN for degenerate geometry', () => {
    const f = bearingDefectFrequencies({
      rolling_elements: 0,
      ball_diameter_mm: 0,
      pitch_diameter_mm: 0,
      contact_angle_deg: 0,
      shaft_rpm: 0,
    })
    expect(Object.values(f).every((value) => Number.isFinite(value))).toBe(true)
  })
})

describe('SCADA state machine', () => {
  it('refuses START from E_STOP and says why', () => {
    const stopped = applyCommand(initialLocalSimState(), 'estop')
    expect(stopped.asset_state).toBe(AssetState.E_STOP)
    expect(commandBlockedReason(stopped, 'start')).toMatch(/emergency stop/i)
  })

  it('does not corrupt state when START is pressed repeatedly', () => {
    let state = applyCommand(initialLocalSimState(), 'start')
    expect(state.asset_state).toBe(AssetState.STARTING)
    for (let i = 0; i < 5; i += 1) state = applyCommand(state, 'start')
    expect(state.asset_state).toBe(AssetState.STARTING)
    expect(state.blocked_reason).toMatch(/already in progress|already RUNNING/i)
  })

  it('reaches RUNNING through STARTING and returns to OFF through STOPPING', () => {
    let state = applyCommand(initialLocalSimState(), 'start')
    for (let i = 0; i < 40 && state.asset_state !== AssetState.RUNNING; i += 1) {
      state = tickLocalSim(state, 0.5).state
    }
    expect(state.asset_state).toBe(AssetState.RUNNING)

    state = applyCommand(state, 'stop')
    for (let i = 0; i < 40 && state.asset_state !== AssetState.OFF; i += 1) {
      state = tickLocalSim(state, 0.5).state
    }
    expect(state.asset_state).toBe(AssetState.OFF)
    expect(state.rpm).toBe(0)
  })

  it('blocks MAINTENANCE unless the asset is OFF', () => {
    const running = applyCommand(initialLocalSimState(), 'start')
    expect(commandBlockedReason(running, 'maintenance')).toMatch(/only be entered from OFF/i)
  })

  it('produces contract-shaped frames from the local model', () => {
    const { frame } = tickLocalSim(applyCommand(initialLocalSimState(), 'start'), 0.5)
    expect(Object.keys(frame).sort()).toEqual([...TELEMETRY_FIELDS].sort())
  })
})
