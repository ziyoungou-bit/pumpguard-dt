/**
 * The single source of every vibration quantity the UI displays.
 *
 * One block, measured once, feeding the tiles, the waveform, the statistics and
 * the spectrum together. That is not tidiness -- it is the fix for a specific
 * defect. The Vibration page used to show `telemetry.vibration_peak_mm_s` in one
 * tile and `waveformStatistics(synthesised).peak_to_peak_mm_s` in the tile
 * beside it, so a stopped machine reported Peak 0.00 next to Peak-to-peak 0.16.
 * Two adjacent numbers describing the same signal came from two different
 * signals. Anything derived from the waveform is now derived from THIS waveform.
 *
 * This hook lived inside VibrationAnalysis.tsx while the Engineering page kept
 * printing `telemetry.vibration_peak_mm_s` and `telemetry.crest_factor` under a
 * heading that read `Peak = max |x_i|`. Those two fields are not a measured
 * maximum: the backend synthesises the overall RMS from component amplitudes
 * and then multiplies it by an ASSUMED crest factor, so on a healthy machine
 * the ratio was pinned to 1.414 by construction while the caption underneath
 * explained that values above 1.414 indicate impulsive content. The page was
 * asserting the reader could check the arithmetic while showing a peak nothing
 * had taken the maximum of. Sharing the block is the fix, so the two pages
 * cannot drift apart again.
 *
 * Nothing here clamps a stopped machine into a running one. An older version
 * passed `Math.max(0.5, rotational_frequency_hz)` and `Math.max(1, rpm)` to keep
 * the synthesis from dividing by zero, which turned blade pass into a 0.1 Hz
 * component -- a constant over any window the page draws, and the DC pedestal
 * that made the crest factor 1.26.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAppState } from '../state/AppState'
import * as api from './api'
import type { FftResponse, VibrationResponse } from '../types/contracts'
import { VIBRATION_GEOMETRY } from './frameModel'
import { synthesiseVibration, vibrationComponents, waveformStatistics } from './vibration'

/** Backend poll interval for the waveform and spectrum blocks, milliseconds. */
const BLOCK_POLL_MS = 2000

export function useVibrationSignals() {
  const { telemetry, connection } = useAppState()
  const [apiWaveform, setApiWaveform] = useState<VibrationResponse | null>(null)
  const [apiSpectrum, setApiSpectrum] = useState<FftResponse | null>(null)

  useEffect(() => {
    if (connection !== 'live') {
      setApiWaveform(null)
      setApiSpectrum(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      const [waveform, spectrum] = await Promise.all([api.getVibration(), api.getFft()])
      if (cancelled) return
      setApiWaveform(waveform && Array.isArray(waveform.waveform) ? waveform : null)
      setApiSpectrum(spectrum && Array.isArray(spectrum.spectrum) ? spectrum : null)
    }
    void poll()
    const id = window.setInterval(() => void poll(), BLOCK_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connection])

  const energised = telemetry.rpm > 1

  // The same builder frameModel uses, so the block is made of exactly the
  // components the frame's overall RMS was computed from.
  const components = useMemo(
    () =>
      vibrationComponents(
        telemetry.rpm,
        {
          amplitude_1x_mm_s: telemetry.amplitude_1x_mm_s,
          amplitude_2x_mm_s: telemetry.amplitude_2x_mm_s,
          high_frequency_energy: telemetry.high_frequency_energy,
          broadband_noise_mm_s: telemetry.rpm > 1 ? 0.09 : 0.01,
        },
        VIBRATION_GEOMETRY,
      ),
    [
      telemetry.rpm,
      telemetry.amplitude_1x_mm_s,
      telemetry.amplitude_2x_mm_s,
      telemetry.high_frequency_energy,
    ],
  )

  const synthetic = useMemo(
    () => synthesiseVibration({ ...components, seed: 4242 }),
    [components],
  )

  const fromApi = apiWaveform !== null && apiSpectrum !== null
  const waveform = apiWaveform?.waveform ?? synthetic.waveform
  const spectrum = apiSpectrum?.spectrum ?? synthetic.spectrum

  // When the backend supplies the block, its statistics must be measured from
  // ITS samples, not carried over from the local synthesis.
  const statistics = useMemo(
    () =>
      fromApi
        ? waveformStatistics((apiWaveform?.waveform ?? []).map((p) => p.amplitude_mm_s))
        : synthetic.statistics,
    [fromApi, apiWaveform, synthetic],
  )

  return {
    waveform,
    spectrum,
    statistics,
    fromApi,
    energised,
    resolutionHz: fromApi ? (apiSpectrum?.resolution_hz ?? null) : synthetic.resolution_hz,
    samplingRateHz: fromApi
      ? (apiSpectrum?.sampling_rate_hz ?? null)
      : synthetic.sampling_rate_hz,
    blockSize: fromApi ? null : synthetic.block_size,
  }
}
