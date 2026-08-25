import { describe, expect, it } from 'vitest'
import { updateTemporalState, type TemporalState } from './temporalDebounce'

const initialState = (): TemporalState => ({
  condition: 'normal',
  labels: [],
  enteredFrames: 0,
  exitedFrames: 0,
})

describe('temporal diagnosis debounce', () => {
  it('enters after 15 high-confidence non-normal ticks and exits after 15 normal ticks', () => {
    let state = initialState()

    for (let tick = 0; tick < 14; tick += 1) {
      state = updateTemporalState(state, 'sensor_fault', 0.71)
      expect(state.condition).toBe('normal')
    }

    state = updateTemporalState(state, 'sensor_fault', 0.71)
    expect(state.condition).toBe('sensor_fault')

    for (let tick = 0; tick < 14; tick += 1) {
      state = updateTemporalState(state, 'normal', 0.51)
      expect(state.condition).toBe('sensor_fault')
    }

    state = updateTemporalState(state, 'normal', 0.51)
    expect(state.condition).toBe('normal')
  })
})
