/**
 * Vibration mathematics used by the Vibration Analysis and Engineering pages.
 *
 * Bearing defect frequencies use the standard kinematic relations for a
 * rolling-element bearing with a stationary outer race (Harris, Rolling Bearing
 * Analysis). They are KINEMATIC PREDICTIONS from geometry and shaft speed --
 * they say where a defect WOULD show up, never that a defect is present. Every
 * surface that displays them must say so.
 *
 *   f_r   = rpm / 60
 *   BPFO  = (n/2) * f_r * (1 - (d/D) cos a)
 *   BPFI  = (n/2) * f_r * (1 + (d/D) cos a)
 *   BSF   = (D/(2d)) * f_r * (1 - ((d/D) cos a)^2)
 *   FTF   = (1/2) * f_r * (1 - (d/D) cos a)
 */

import { amplitudeSpectrum } from './fft'

export interface BearingGeometryInput {
  rolling_elements: number
  ball_diameter_mm: number
  pitch_diameter_mm: number
  contact_angle_deg: number
  shaft_rpm: number
}

export interface BearingDefectFrequencies {
  rotational_frequency_hz: number
  bpfo_hz: number
  bpfi_hz: number
  bsf_hz: number
  ftf_hz: number
}

export function bearingDefectFrequencies(input: BearingGeometryInput): BearingDefectFrequencies {
  const { rolling_elements: n, ball_diameter_mm: d, pitch_diameter_mm: D, shaft_rpm } = input
  const fr = shaft_rpm / 60
  if (!(D > 0) || !(n > 0) || !Number.isFinite(fr)) {
    return { rotational_frequency_hz: 0, bpfo_hz: 0, bpfi_hz: 0, bsf_hz: 0, ftf_hz: 0 }
  }
  const cosA = Math.cos((input.contact_angle_deg * Math.PI) / 180)
  const ratio = (d / D) * cosA
  return {
    rotational_frequency_hz: fr,
    bpfo_hz: (n / 2) * fr * (1 - ratio),
    bpfi_hz: (n / 2) * fr * (1 + ratio),
    bsf_hz: (D / (2 * d)) * fr * (1 - ratio * ratio),
    ftf_hz: 0.5 * fr * (1 - ratio),
  }
}

// --------------------------------------------------------------------------
// Waveform statistics
// --------------------------------------------------------------------------

export interface WaveformStatistics {
  rms_mm_s: number
  peak_mm_s: number
  peak_to_peak_mm_s: number
  /**
   * peak / RMS, or null when RMS is zero and the ratio does not exist.
   *
   * Null rather than a number, deliberately. The previous version returned 0
   * here and the page displayed a neighbouring frame's 1.41 instead, which is
   * the value a pure sine gives -- so an undefined ratio was rendered as the
   * single most reassuring number it could possibly have been. A quantity that
   * does not exist must be displayed as not existing.
   */
  crest_factor: number | null
}

export function waveformStatistics(samples: number[]): WaveformStatistics {
  if (samples.length === 0) {
    return { rms_mm_s: 0, peak_mm_s: 0, peak_to_peak_mm_s: 0, crest_factor: null }
  }
  let sumSquares = 0
  let min = samples[0]
  let max = samples[0]
  for (const s of samples) {
    sumSquares += s * s
    if (s < min) min = s
    if (s > max) max = s
  }
  const rms = Math.sqrt(sumSquares / samples.length)
  const peak = Math.max(Math.abs(min), Math.abs(max))
  return {
    rms_mm_s: rms,
    peak_mm_s: peak,
    peak_to_peak_mm_s: max - min,
    crest_factor: rms > 1e-9 ? peak / rms : null,
  }
}

// --------------------------------------------------------------------------
// Local waveform / spectrum synthesis for the recorded-demo fallback
// --------------------------------------------------------------------------

/**
 * Deterministic pseudo-random generator (mulberry32). Seeded so the recorded
 * demo replays identically on every visit -- a "recorded" dataset that changed
 * between page loads would not be a recording.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SyntheticVibration {
  waveform: { t_s: number; amplitude_mm_s: number }[]
  spectrum: { frequency_hz: number; amplitude_mm_s: number }[]
  /** Statistics of the block that was actually transformed, not of the plot. */
  statistics: WaveformStatistics
  resolution_hz: number
  sampling_rate_hz: number
  block_size: number
}

/**
 * Sampling for the browser-side block.
 *
 * 2560 Hz over 8192 samples: 3.2 s of data at 0.3125 Hz resolution. The
 * resolution is what drives the choice. The most confusable pair on this
 * machine is 2x mechanical at 2 x 1450/60 = 48.33 Hz against line frequency at
 * 50.0 Hz -- 1.67 Hz apart, which is 5.3 bins here and comfortably separated by
 * a Hann mainlobe, but only 1.3 bins at the 1.25 Hz the old 512-point display
 * block would have given. Mistaking one for the other is the difference between
 * "the rotor is unbalanced" and "the motor has an electrical asymmetry", so the
 * block is sized to tell them apart rather than to be cheap.
 */
export const VIBRATION_SAMPLE_RATE_HZ = 2560
export const VIBRATION_BLOCK_SIZE = 8192

/** Seconds of waveform drawn on the chart. Plotting 8192 points is pointless. */
const WAVEFORM_DISPLAY_S = 0.25

/** Lines making up the broadband high-frequency band. See the synthesis loop. */
const HF_LINES = 24

/**
 * Baseline amplitudes at rated speed, mm/s RMS, for the two components the
 * telemetry frame does not carry.
 *
 * Both scale with speed rather than being constants, which is the whole reason
 * the DC-offset defect was possible: a fixed amplitude cannot fall to zero when
 * the machine stops, so it survives being multiplied by a stopped machine and
 * becomes a pedestal.
 *
 *   vane pass  hydraulic, so it disappears with the flow: ~ (N/N_rated)^2
 *   line       electrical, present whenever the motor is energised and
 *              independent of shaft speed, which is exactly what makes it
 *              separable from 2x mechanical on a spectrum with the resolution
 *              to do it
 */
export const VANE_PASS_AT_RATED_MM_S = 0.12
export const LINE_FREQUENCY_AT_RATED_MM_S = 0.05

/**
 * The complete component set of one vibration block.
 *
 * This type is the single source that closes the cross-source gap on the
 * Vibration page. The frame's reported RMS used to be computed from 1x, 2x, the
 * HF band and the noise floor, while the plotted block additionally contained
 * vane passing -- so the tile and the block statistics were measuring two
 * different signals and could not agree however carefully they were rounded.
 * Both sides now build this object and derive everything from it.
 */
export interface VibrationComponents {
  rotational_frequency_hz: number
  amplitude_1x_mm_s: number
  amplitude_2x_mm_s: number
  high_frequency_energy: number
  broadband_noise_mm_s: number
  blade_pass_hz: number
  blade_pass_amplitude_mm_s: number
  line_frequency_hz: number
  line_amplitude_mm_s: number
}

/**
 * Overall velocity RMS of a component set, 10-1000 Hz.
 *
 * Uncorrelated components add in quadrature. That is the definition of overall
 * RMS and it is why every component has to be in this sum: leaving one out does
 * not make the machine quieter, it makes the reported number wrong.
 */
export function componentsRms(c: VibrationComponents): number {
  return Math.sqrt(
    c.amplitude_1x_mm_s ** 2 +
      c.amplitude_2x_mm_s ** 2 +
      c.high_frequency_energy ** 2 +
      c.blade_pass_amplitude_mm_s ** 2 +
      c.line_amplitude_mm_s ** 2 +
      c.broadband_noise_mm_s ** 2,
  )
}

/**
 * Builds the component set for a machine turning at `rpm`.
 *
 * The two speed-dependent amplitudes are derived here and nowhere else. Every
 * one of them goes to zero when the shaft stops, which is the property the old
 * code lacked: a hardcoded vane-pass amplitude survived a stopped machine and,
 * evaluated at the 0.1 Hz that a `Math.max(1, rpm)` sentinel produced, became a
 * DC pedestal rather than a tone.
 */
export function vibrationComponents(
  rpm: number,
  measured: {
    amplitude_1x_mm_s: number
    amplitude_2x_mm_s: number
    high_frequency_energy: number
    broadband_noise_mm_s: number
    /** Vane passing collapses with the liquid; 1 normally, ->0 on a dry run. */
    vane_pass_scale?: number
  },
  geometry: { vanes: number; rated_rpm: number; supply_frequency_hz: number },
): VibrationComponents {
  const turning = rpm > 1
  const speedRatio = rpm / geometry.rated_rpm
  const fr = rpm / 60
  return {
    rotational_frequency_hz: fr,
    amplitude_1x_mm_s: measured.amplitude_1x_mm_s,
    amplitude_2x_mm_s: measured.amplitude_2x_mm_s,
    high_frequency_energy: measured.high_frequency_energy,
    broadband_noise_mm_s: measured.broadband_noise_mm_s,
    blade_pass_hz: geometry.vanes * fr,
    // Hydraulic, so it follows the head: ~ (N/N_rated)^2, and absent at rest.
    blade_pass_amplitude_mm_s: turning
      ? VANE_PASS_AT_RATED_MM_S * speedRatio * speedRatio * (measured.vane_pass_scale ?? 1)
      : 0,
    line_frequency_hz: geometry.supply_frequency_hz,
    // Electrical, so it is present whenever the motor is energised and is
    // independent of shaft speed -- which is exactly what makes it separable
    // from 2x mechanical on a spectrum with the resolution to do it.
    line_amplitude_mm_s: turning ? LINE_FREQUENCY_AT_RATED_MM_S : 0,
  }
}

export interface VibrationSynthesisParams {
  rotational_frequency_hz: number
  amplitude_1x_mm_s: number
  amplitude_2x_mm_s: number
  high_frequency_energy: number
  broadband_noise_mm_s: number
  blade_pass_hz: number
  blade_pass_amplitude_mm_s: number
  /** Motor supply frequency, Hz. Drawn separately from the shaft orders. */
  line_frequency_hz: number
  line_amplitude_mm_s: number
  seed: number
  sample_rate_hz?: number
  samples?: number
}

/**
 * Builds a velocity waveform from named harmonic components, then MEASURES its
 * spectrum with a real FFT. Used for the offline demo and for illustrating the
 * analysis on the Engineering page; when the backend is reachable its
 * /api/vibration and /api/fft results are used instead.
 *
 * Two properties are enforced rather than hoped for:
 *
 * 1. The block is de-meaned. A velocity waveform must cross zero -- a constant
 *    non-zero velocity is a machine in transit, not a machine vibrating. The
 *    previous version did not enforce this and produced a waveform sitting
 *    entirely between 0.2 and 0.4 mm/s, with a crest factor of 1.26. That
 *    number is its own proof of the defect: a zero-mean signal cannot have a
 *    crest factor meaningfully below a pure sine's sqrt(2) = 1.414, because
 *    peak/RMS is minimised by putting the energy as far from zero as possible.
 *    Only a DC pedestal can raise RMS without raising peak. The cause was a
 *    hardcoded 0.22 mm/s blade-pass component evaluated at a blade-pass
 *    frequency of 0.1 Hz -- a stopped machine forced to 1 rpm by a sentinel --
 *    which over a 0.25 s window is not a tone at all, it is a constant.
 *
 * 2. Every component's amplitude is passed in. Nothing is invented here. A
 *    hardcoded amplitude cannot fall to zero when the machine stops, which is
 *    how the constant above survived being multiplied by a stopped machine.
 */
export function synthesiseVibration(params: VibrationSynthesisParams): SyntheticVibration {
  const sampleRate = params.sample_rate_hz ?? VIBRATION_SAMPLE_RATE_HZ
  const n = params.samples ?? VIBRATION_BLOCK_SIZE
  const rand = seededRandom(params.seed)
  const fr = params.rotational_frequency_hz

  // High-frequency band lines, drawn once so the block is reproducible. Spread
  // across 480-960 Hz, which is the velocity-domain proxy band this model uses
  // for what a real analyser would examine in acceleration.
  const hfRand = seededRandom(params.seed ^ 0x5f3759df)
  const hfFrequencies = new Float64Array(HF_LINES)
  const hfPhases = new Float64Array(HF_LINES)
  for (let k = 0; k < HF_LINES; k += 1) {
    hfFrequencies[k] = 480 + 480 * hfRand()
    hfPhases[k] = 2 * Math.PI * hfRand()
  }

  const samples: number[] = new Array(n)
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate
    let v = 0
    // Amplitudes arrive as RMS; sqrt(2) converts each to the peak of its sine.
    v += params.amplitude_1x_mm_s * Math.SQRT2 * Math.sin(2 * Math.PI * fr * t)
    v += params.amplitude_2x_mm_s * Math.SQRT2 * Math.sin(4 * Math.PI * fr * t + 0.7)
    v +=
      params.blade_pass_amplitude_mm_s *
      Math.SQRT2 *
      Math.sin(2 * Math.PI * params.blade_pass_hz * t + 1.3)
    // Electrical component at line frequency. Independent of shaft speed, which
    // is precisely what makes it separable from 2x on a spectrum with enough
    // resolution -- and indistinguishable from it on one without.
    v +=
      params.line_amplitude_mm_s *
      Math.SQRT2 *
      Math.sin(2 * Math.PI * params.line_frequency_hz * t + 2.1)
    // High-frequency band. Modelled as a spread of incommensurate lines with
    // fixed pseudo-random phases, amplitude-modulated at vane pass -- NOT as a
    // single coherent carrier. Bubble implosion and rubbing are showers of
    // unsynchronised impacts; there is no discrete "cavitation frequency". The
    // distinction is measurable rather than cosmetic: a coherent carrier adds
    // its full amplitude to the peak on every cycle, which pushed the crest
    // factor of a healthy machine to 2.4, well above what a real one reads.
    const modulation = 1 + 0.5 * Math.sin(2 * Math.PI * fr * t)
    let hf = 0
    for (let k = 0; k < HF_LINES; k += 1) {
      hf += Math.sin(2 * Math.PI * hfFrequencies[k] * t + hfPhases[k])
    }
    v += params.high_frequency_energy * Math.SQRT2 * (hf / Math.sqrt(HF_LINES)) * modulation
    v += (rand() - 0.5) * 2 * params.broadband_noise_mm_s
    samples[i] = v
  }

  // Force zero mean. Any residual offset here is unphysical for velocity, and
  // it would leak through the window sidelobes into the low-frequency bins.
  let mean = 0
  for (const s of samples) mean += s
  mean /= n
  for (let i = 0; i < n; i += 1) samples[i] -= mean

  const displaySamples = Math.min(n, Math.round(WAVEFORM_DISPLAY_S * sampleRate))
  const waveform = new Array(displaySamples)
  for (let i = 0; i < displaySamples; i += 1) {
    waveform[i] = {
      t_s: Number((i / sampleRate).toFixed(5)),
      amplitude_mm_s: Number(samples[i].toFixed(4)),
    }
  }

  const measured = amplitudeSpectrum(samples, sampleRate)
  const maxHz = 1000
  const spectrum: { frequency_hz: number; amplitude_mm_s: number }[] = []
  for (let k = 0; k < measured.frequencies_hz.length; k += 1) {
    const f = measured.frequencies_hz[k]
    if (f > maxHz) break
    spectrum.push({
      frequency_hz: Number(f.toFixed(3)),
      // Peak amplitude out of the transform, shown as RMS to match the tiles.
      amplitude_mm_s: Number((measured.amplitudes[k] / Math.SQRT2).toFixed(4)),
    })
  }

  return {
    waveform,
    spectrum,
    statistics: waveformStatistics(samples),
    resolution_hz: measured.resolution_hz,
    sampling_rate_hz: sampleRate,
    block_size: n,
  }
}

/**
 * Velocity RMS severity bands, mm/s, measured over 10-1000 Hz.
 *
 * The band edges 0.71 / 1.8 / 4.5 are the ISO 20816-1 Class I (small machines,
 * rigid support) zone boundaries and are used unchanged.
 *
 * Scope, stated because it matters: this asset develops about 51 W at the
 * shaft. ISO 20816-3 applies above 15 kW and ISO 20816-7 (rotodynamic pumps)
 * above roughly 1 kW, so this machine falls below the scope of every ISO
 * vibration-severity standard. The limits are applied BY ANALOGY, not by
 * certification. Naming a standard that does not cover the machine would be
 * the kind of borrowed authority this project exists to avoid.
 */
export function vibrationSeverityZone(rmsMmS: number): { zone: string; label: string } {
  if (rmsMmS <= 0.71) return { zone: 'A', label: 'Newly commissioned' }
  if (rmsMmS <= 1.8) return { zone: 'B', label: 'Unrestricted long-term operation' }
  if (rmsMmS <= 4.5) return { zone: 'C', label: 'Restricted operation' }
  return { zone: 'D', label: 'Damage may occur' }
}
