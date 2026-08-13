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
  crest_factor: number
}

export function waveformStatistics(samples: number[]): WaveformStatistics {
  if (samples.length === 0) {
    return { rms_mm_s: 0, peak_mm_s: 0, peak_to_peak_mm_s: 0, crest_factor: 0 }
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
    crest_factor: rms > 1e-9 ? peak / rms : 0,
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
}

/**
 * Builds a velocity waveform from named harmonic components and its magnitude
 * spectrum. Used only for the offline demo and for illustrating the analysis on
 * the Engineering page; when the backend is reachable its /api/vibration and
 * /api/fft results are used instead.
 */
export function synthesiseVibration(params: {
  rotational_frequency_hz: number
  amplitude_1x_mm_s: number
  amplitude_2x_mm_s: number
  high_frequency_energy: number
  broadband_noise_mm_s: number
  blade_pass_hz: number
  blade_pass_amplitude_mm_s: number
  seed: number
  sample_rate_hz?: number
  samples?: number
}): SyntheticVibration {
  const sampleRate = params.sample_rate_hz ?? 2048
  const n = params.samples ?? 512
  const rand = seededRandom(params.seed)
  const fr = params.rotational_frequency_hz

  const waveform: { t_s: number; amplitude_mm_s: number }[] = []
  const samples: number[] = []
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate
    let v = 0
    v += params.amplitude_1x_mm_s * Math.SQRT2 * Math.sin(2 * Math.PI * fr * t)
    v += params.amplitude_2x_mm_s * Math.SQRT2 * Math.sin(4 * Math.PI * fr * t + 0.7)
    v +=
      params.blade_pass_amplitude_mm_s *
      Math.SQRT2 *
      Math.sin(2 * Math.PI * params.blade_pass_hz * t + 1.3)
    // High-frequency band modelled as a modulated carrier well above 1x.
    v +=
      params.high_frequency_energy *
      Math.sin(2 * Math.PI * 640 * t) *
      (1 + 0.5 * Math.sin(2 * Math.PI * fr * t))
    v += (rand() - 0.5) * 2 * params.broadband_noise_mm_s
    waveform.push({ t_s: Number(t.toFixed(5)), amplitude_mm_s: Number(v.toFixed(4)) })
    samples.push(v)
  }

  // Magnitude spectrum by direct DFT over a reduced bin set: the display only
  // needs ~200 bins to 1 kHz, so a full FFT implementation would be dead weight.
  const maxHz = 1000
  const bins = 200
  const spectrum: { frequency_hz: number; amplitude_mm_s: number }[] = []
  for (let b = 0; b <= bins; b += 1) {
    const f = (maxHz * b) / bins
    let re = 0
    let im = 0
    for (let i = 0; i < n; i += 1) {
      const phase = (2 * Math.PI * f * i) / sampleRate
      re += samples[i] * Math.cos(phase)
      im -= samples[i] * Math.sin(phase)
    }
    const magnitude = (2 * Math.sqrt(re * re + im * im)) / n
    spectrum.push({
      frequency_hz: Number(f.toFixed(1)),
      amplitude_mm_s: Number((magnitude / Math.SQRT2).toFixed(4)),
    })
  }

  return { waveform, spectrum }
}

/** ISO 10816-3 style severity banding for small machines, velocity RMS mm/s. */
export function iso10816Zone(rmsMmS: number): { zone: string; label: string } {
  if (rmsMmS <= 0.71) return { zone: 'A', label: 'Newly commissioned' }
  if (rmsMmS <= 1.8) return { zone: 'B', label: 'Unrestricted long-term operation' }
  if (rmsMmS <= 4.5) return { zone: 'C', label: 'Restricted operation' }
  return { zone: 'D', label: 'Damage may occur' }
}
