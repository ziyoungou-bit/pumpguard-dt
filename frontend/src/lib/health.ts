/**
 * The health index, as a list of named terms rather than as a number.
 *
 * Why a breakdown type instead of a function returning a float. The Engineering
 * page promises that a reader can check the arithmetic by hand, and it was not
 * keeping that promise: it printed a formula string that had been typed out
 * beside the implementation and had drifted from it, and the implementation
 * carried guards -- efficiency forced to zero at zero speed, health not scored
 * at all unless the machine is running -- that appeared nowhere in the printed
 * version. So the page showed
 *
 *     Health = 100 - 12 max(0, RMS - 1.8) - 60 max(0, 0.55 - eta) - ... = 100.0
 *
 * for a stopped machine, where substituting eta = 0 gives 67. The reader who
 * does the substitution concludes the page is lying, and on that page they are
 * the reader who matters most.
 *
 * The fix is not a better string. It is that there is only one artefact: this
 * module computes the terms, frameModel sums them, and Engineering renders the
 * same objects. A term cannot be displayed differently from how it was applied
 * because there is no second place to write it down.
 */

import { ZONE_A_B_MM_S, ZONE_B_C_MM_S, ZONE_C_D_MM_S, vibrationHealthPenalty } from './vibration'
import { ALARM_LIMITS } from './pumpParameters.generated'

/** Below this the suction margin is inside normal engineering practice. */
export const NPSH_MARGIN_GUIDELINE_M = ALARM_LIMITS.npsh_margin_low.alarm
/**
 * Bearing temperature above which grease life starts to be consumed fast.
 * Uses the alarm setpoint from the backend's single source of truth.
 */
export const BEARING_TEMPERATURE_LIMIT_C = ALARM_LIMITS.bearing_temperature_high.alarm
/**
 * Efficiency is penalised below this FRACTION of the BEP efficiency, not below
 * an absolute figure. An absolute threshold silently becomes an always-on
 * penalty the moment the machine's peak efficiency is corrected -- which is
 * exactly what happened when eta_BEP moved from 62 % to 42 %.
 */
export const EFFICIENCY_PENALTY_ONSET_FRACTION = 0.89

export interface HealthTerm {
  label: string
  /** The term as written, with this frame's numbers already substituted. */
  expression: string
  /** Points subtracted. Always >= 0. */
  penalty: number
}

export interface HealthBreakdown {
  /** Every term, including the ones scoring zero -- a hidden zero is a lie. */
  terms: HealthTerm[]
  /** 0..100 after clamping. */
  health: number
  /**
   * False when a guard suppressed scoring entirely. The reader is told which
   * guard and why rather than being shown a 100 with no explanation.
   */
  scored: boolean
  guard: string | null
}

export interface HealthInputs {
  running: boolean
  vibration_rms_mm_s: number
  pump_efficiency: number
  bep_efficiency: number
  npsh_margin_m: number
  bearing_temperature_c: number
}

const f = (value: number, digits = 2) => value.toFixed(digits)

export function healthBreakdown(input: HealthInputs): HealthBreakdown {
  if (!input.running) {
    // Stopped guard, stated rather than hidden. A machine that is not turning
    // has no vibration to judge, no operating point to be efficient at and no
    // suction margin to lose. Scoring it would report a fault-free machine as
    // damaged purely for being switched off.
    return {
      terms: [],
      health: 100,
      scored: false,
      guard: 'Health is not scored unless the asset is RUNNING (stopped guard).',
    }
  }

  const efficiencyFraction =
    input.bep_efficiency > 0 ? input.pump_efficiency / input.bep_efficiency : 0

  const terms: HealthTerm[] = [
    {
      label: 'Vibration',
      expression:
        `piecewise(RMS = ${f(input.vibration_rms_mm_s)} mm/s): ` +
        `4/mm/s to ${ZONE_A_B_MM_S}, 11 to ${ZONE_B_C_MM_S}, 22 to ${ZONE_C_D_MM_S}, 40 beyond`,
      penalty: vibrationHealthPenalty(input.vibration_rms_mm_s),
    },
    {
      label: 'Efficiency',
      expression:
        `37 max(0, ${EFFICIENCY_PENALTY_ONSET_FRACTION} - eta/eta_BEP) = ` +
        `37 max(0, ${EFFICIENCY_PENALTY_ONSET_FRACTION} - ${f(input.pump_efficiency, 3)}/${f(input.bep_efficiency, 2)}) = ` +
        `37 max(0, ${EFFICIENCY_PENALTY_ONSET_FRACTION} - ${f(efficiencyFraction, 3)})`,
      penalty: Math.max(0, (EFFICIENCY_PENALTY_ONSET_FRACTION - efficiencyFraction) * 37),
    },
    {
      label: 'NPSH margin',
      expression: `14 max(0, ${NPSH_MARGIN_GUIDELINE_M} - ${f(input.npsh_margin_m)})`,
      penalty:
        input.npsh_margin_m < NPSH_MARGIN_GUIDELINE_M
          ? (NPSH_MARGIN_GUIDELINE_M - input.npsh_margin_m) * 14
          : 0,
    },
    {
      label: 'Bearing temperature',
      expression: `1.4 max(0, ${f(input.bearing_temperature_c, 1)} - ${BEARING_TEMPERATURE_LIMIT_C})`,
      penalty: Math.max(0, (input.bearing_temperature_c - BEARING_TEMPERATURE_LIMIT_C) * 1.4),
    },
  ]

  const total = terms.reduce((sum, term) => sum + term.penalty, 0)
  return {
    terms,
    // Floored at 5 rather than 0: a machine still running and still reporting
    // is not in a zero-information state, and a bar pinned to the bottom hides
    // the difference between bad and worse.
    health: Math.max(5, Math.min(100, 100 - total)),
    scored: true,
    guard: null,
  }
}
