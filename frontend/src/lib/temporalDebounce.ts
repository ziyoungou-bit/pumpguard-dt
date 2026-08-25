export const TEMPORAL_DEBOUNCE = {
  windowFrames: 25,
  enterProbability: 0.7,
  enterFrames: 15,
  exitFrames: 15,
} as const

export type TemporalState = {
  condition: string
  labels: string[]
  enteredFrames: number
  exitedFrames: number
}

export function updateTemporalState(state: TemporalState, instantaneous: string, instantaneousConfidence: number): TemporalState {
  const labels = [...state.labels, instantaneous].slice(-TEMPORAL_DEBOUNCE.windowFrames)
  const nonNormal = labels.filter((label) => label !== 'normal').length
  const majority = nonNormal > labels.length / 2
  const entering = instantaneous !== 'normal' && instantaneousConfidence > TEMPORAL_DEBOUNCE.enterProbability
  const exiting = instantaneous === 'normal'
  const enteredFrames = entering ? state.enteredFrames + 1 : 0
  const exitedFrames = exiting ? state.exitedFrames + 1 : 0
  let condition = state.condition
  if (condition === 'normal' && majority && enteredFrames >= TEMPORAL_DEBOUNCE.enterFrames) condition = instantaneous
  if (condition !== 'normal' && exiting && exitedFrames >= TEMPORAL_DEBOUNCE.exitFrames) condition = 'normal'
  return { condition, labels, enteredFrames, exitedFrames }
}
