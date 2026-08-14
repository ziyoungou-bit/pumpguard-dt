/**
 * Radix-2 FFT and a single-sided amplitude spectrum, in the browser.
 *
 * Why this is written out rather than pulled from a package: the whole claim of
 * the Vibration page is that the spectrum is MEASURED from a time-domain signal
 * rather than drawn. A dependency would serve that claim equally well, but the
 * normalisation is the part that goes wrong in practice and it has to be
 * explicit here anyway -- see below. The transform itself is forty lines of
 * textbook Cooley-Tukey. This module mirrors the normalisation documented in
 * backend/app/signal_processing/spectrum.py so the offline and live spectra are
 * the same quantity.
 *
 * Normalisation
 * -------------
 * For a block of N samples with window w:
 *
 *     X   = fft(x * w)
 *     S_k = 2 |X_k| / sum(w)          [engineering units, peak]
 *
 * sum(w) is the window's coherent gain times N, so dividing by it undoes both
 * the transform's N scaling and the amplitude the window threw away. For a Hann
 * window the coherent gain is 0.5, which is where the "amplitude correction
 * factor 2.0" comes from: sum(w) = 0.5 N, so S_k = 4 |X_k| / N.
 *
 * The leading factor 2 folds the negative-frequency half onto the positive
 * half. It is therefore NOT applied at DC or at Nyquist, which have no mirror
 * partner. Forgetting that exception makes DC read double, which silently
 * corrupts any band that includes it -- and a DC offset is exactly the defect
 * this page was reporting.
 *
 * Resolution is fs/N and nothing improves it. Zero padding interpolates; it
 * does not resolve. Separating 2x mechanical at 48.33 Hz from line frequency at
 * 50.0 Hz -- 1.67 Hz apart, the most confusable pair on this machine -- needs
 * df well under that, which is why the block is 8192 points rather than the
 * 512 the old direct-DFT display used.
 */

/** Hann window of length n. Coherent gain 0.5, ENBW 1.5 bins. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }
  return w
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT. `re` and `im` must have a
 * power-of-two length. Throws otherwise rather than silently returning
 * nonsense -- a spectrum that is quietly wrong is worse than no spectrum.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n !== im.length) throw new Error('fft: real and imaginary parts differ in length')
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`)

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  // Butterflies, stage by stage.
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k]
        const aIm = im[i + k]
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = aRe + bRe
        im[i + k] = aIm + bIm
        re[i + k + len / 2] = aRe - bRe
        im[i + k + len / 2] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

export interface AmplitudeSpectrum {
  /** Bin centre frequencies, DC to Nyquist inclusive. */
  frequencies_hz: Float64Array
  /** Peak amplitudes in the signal's own unit. */
  amplitudes: Float64Array
  resolution_hz: number
  sampling_rate_hz: number
  block_size: number
}

/**
 * Single-sided amplitude spectrum of a real signal.
 *
 * The block is de-meaned before windowing. That is not cosmetic: any DC offset
 * leaks through the window's sidelobes and lifts the low-frequency end of the
 * spectrum, and for a VELOCITY signal a DC term is unphysical to begin with --
 * a machine with a constant non-zero velocity is a machine that is leaving.
 */
export function amplitudeSpectrum(samples: number[], sampleRateHz: number): AmplitudeSpectrum {
  const n = samples.length
  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`amplitudeSpectrum: block size ${n} is not a power of two`)
  }

  let mean = 0
  for (const s of samples) mean += s
  mean /= n

  const window = hannWindow(n)
  let windowSum = 0
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    re[i] = (samples[i] - mean) * window[i]
    windowSum += window[i]
  }

  fftInPlace(re, im)

  const bins = n / 2 + 1
  const frequencies = new Float64Array(bins)
  const amplitudes = new Float64Array(bins)
  for (let k = 0; k < bins; k += 1) {
    const magnitude = Math.hypot(re[k], im[k])
    // Factor 2 folds the mirrored half onto this one -- except at DC and
    // Nyquist, which have no partner to fold in.
    const singleSided = k === 0 || k === n / 2 ? 1 : 2
    frequencies[k] = (k * sampleRateHz) / n
    amplitudes[k] = (singleSided * magnitude) / windowSum
  }

  return {
    frequencies_hz: frequencies,
    amplitudes,
    resolution_hz: sampleRateHz / n,
    sampling_rate_hz: sampleRateHz,
    block_size: n,
  }
}
