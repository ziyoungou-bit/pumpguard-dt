/**
 * Vibration Analysis.
 *
 * Waveform and spectrum come from the backend when it is reachable. When it is
 * not, both are synthesised in the browser from the telemetry frame's own
 * harmonic content (1x, 2x, blade pass, HF band), so the spectrum on screen is
 * always consistent with the numbers beside it rather than decorative.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAppState } from '../state/AppState'
import * as api from '../lib/api'
import type { FftResponse, VibrationResponse } from '../types/contracts'
import { BEARING, MOTOR, bladePassFrequencyHz } from '../lib/pumpPhysics'
import { VIBRATION_GEOMETRY } from '../lib/frameModel'
import {
  bearingDefectFrequencies,
  synthesiseVibration,
  vibrationComponents,
  vibrationSeverityZone,
  waveformStatistics,
} from '../lib/vibration'
import { fmt, fmtUnit } from '../lib/format'
import { limitStatus } from '../lib/status'
import {
  Card,
  DefinitionRow,
  Notice,
  PageHeading,
  ProvenanceNote,
  StatTile,
  StatusBadge,
} from '../components/ui'
import { SpectrumChart, TimeWaveformChart } from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

/**
 * The single source of every vibration quantity on this page.
 *
 * One block, measured once, feeding the tiles, the waveform, the statistics and
 * the spectrum together. That is not tidiness -- it is the fix for a specific
 * defect. The page used to show `telemetry.vibration_peak_mm_s` in one tile and
 * `waveformStatistics(synthesised).peak_to_peak_mm_s` in the tile beside it, so
 * a stopped machine reported Peak 0.00 next to Peak-to-peak 0.16. Two adjacent
 * numbers describing the same signal came from two different signals. Anything
 * derived from the waveform is now derived from THIS waveform.
 *
 * Nothing here clamps a stopped machine into a running one. The old code passed
 * `Math.max(0.5, rotational_frequency_hz)` and `Math.max(1, rpm)` to keep the
 * synthesis from dividing by zero, which turned blade pass into a 0.1 Hz
 * component -- a constant over any window this page draws, and the DC pedestal
 * that made the crest factor 1.26.
 */
function useVibrationSignals() {
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
    const id = window.setInterval(() => void poll(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connection])

  const energised = telemetry.rpm > 1

  // The same builder frameModel uses, so the block plotted here is made of
  // exactly the components the frame's overall RMS was computed from.
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

function BearingCalculator({ shaftRpm }: { shaftRpm: number }) {
  const [elements, setElements] = useState<number>(BEARING.rolling_elements)
  const [ballDiameter, setBallDiameter] = useState<number>(BEARING.ball_diameter_mm)
  const [pitchDiameter, setPitchDiameter] = useState<number>(BEARING.pitch_diameter_mm)
  const [contactAngle, setContactAngle] = useState<number>(BEARING.contact_angle_deg)
  const [rpm, setRpm] = useState<number>(Math.round(shaftRpm) || 1450)

  const frequencies = bearingDefectFrequencies({
    rolling_elements: elements,
    ball_diameter_mm: ballDiameter,
    pitch_diameter_mm: pitchDiameter,
    contact_angle_deg: contactAngle,
    shaft_rpm: rpm,
  })

  const numberField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    step: number,
    unit: string,
  ) => (
    <label className="block">
      <span className="field-label">
        {label} <span className="font-normal normal-case">({unit})</span>
      </span>
      <input
        type="number"
        className="numeric mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        value={value}
        step={step}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </label>
  )

  return (
    <Card
      title="Bearing frequency calculator"
      subtitle={`Default geometry: ${BEARING.designation} deep-groove ball bearing`}
    >
      <Notice tone="warn" title="Calculated theoretical frequencies, not detected faults">
        These are kinematic predictions from bearing geometry and shaft speed. They say WHERE a
        defect would appear in the spectrum. They are not evidence that any defect exists, and
        nothing on this panel has inspected the measured spectrum for them.
      </Notice>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {numberField('Rolling elements', elements, (v) => setElements(Math.max(1, Math.round(v))), 1, 'count')}
        {numberField('Ball diameter', ballDiameter, setBallDiameter, 0.01, 'mm')}
        {numberField('Pitch diameter', pitchDiameter, setPitchDiameter, 0.01, 'mm')}
        {numberField('Contact angle', contactAngle, setContactAngle, 1, 'deg')}
        {numberField('Shaft speed', rpm, setRpm, 10, 'rpm')}
        <div className="flex items-end">
          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={() => setRpm(Math.round(shaftRpm) || 1450)}
          >
            Use measured speed
          </button>
        </div>
      </div>

      <dl className="mt-4">
        <DefinitionRow
          label="Shaft rotational frequency  f_r = rpm / 60"
          value={fmtUnit(frequencies.rotational_frequency_hz, 'Hz', 2)}
        />
        <DefinitionRow
          label="BPFO -- ball pass frequency, outer race"
          value={fmtUnit(frequencies.bpfo_hz, 'Hz', 2)}
        />
        <DefinitionRow
          label="BPFI -- ball pass frequency, inner race"
          value={fmtUnit(frequencies.bpfi_hz, 'Hz', 2)}
        />
        <DefinitionRow label="BSF -- ball spin frequency" value={fmtUnit(frequencies.bsf_hz, 'Hz', 2)} />
        <DefinitionRow
          label="FTF -- fundamental train (cage) frequency"
          value={fmtUnit(frequencies.ftf_hz, 'Hz', 2)}
        />
      </dl>

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p className="numeric">BPFO = (n/2) f_r (1 - (d/D) cos a)</p>
        <p className="numeric">BPFI = (n/2) f_r (1 + (d/D) cos a)</p>
        <p className="numeric">BSF = (D/2d) f_r (1 - ((d/D) cos a)^2)</p>
        <p className="numeric">FTF = (1/2) f_r (1 - (d/D) cos a)</p>
      </div>
    </Card>
  )
}

export function VibrationAnalysis() {
  const { telemetry, connection } = useAppState()
  const {
    waveform,
    spectrum,
    statistics: stats,
    fromApi,
    energised,
    resolutionHz,
    samplingRateHz,
    blockSize,
  } = useVibrationSignals()

  const zone = vibrationSeverityZone(telemetry.vibration_rms_mm_s)
  const bpf = bladePassFrequencyHz(telemetry.rpm)
  const twoX = 2 * telemetry.rotational_frequency_hz
  const lineHz = MOTOR.supply_frequency_hz
  // Whether this spectrum can actually tell 2x apart from line frequency. A
  // Hann mainlobe is 4 bins wide, so the two must be at least that far apart.
  const ordersResolved =
    resolutionHz !== null && energised && Math.abs(lineHz - twoX) >= 4 * resolutionHz

  /** Renders a quantity that may not exist. Never substitutes a default. */
  const orDash = (value: number | null, digits: number) =>
    value === null ? '—' : fmt(value, digits)

  return (
    <div className="space-y-5">
      <PageHeading
        title="Vibration Analysis"
        description="Velocity waveform and FFT spectrum from the pump bearing accelerometer ACC-101, with the synchronous orders marked."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Velocity RMS"
          value={fmt(telemetry.vibration_rms_mm_s, 2)}
          unit="mm/s"
          tag="ACC-101"
          status={limitStatus(telemetry.vibration_rms_mm_s, 1.8, 4.5)}
          hint={`10-1000 Hz. Zone ${zone.zone}: ${zone.label}`}
        />
        <StatTile
          label="Peak"
          value={orDash(energised ? stats.peak_mm_s : null, 2)}
          unit="mm/s"
          tag="from block"
        />
        <StatTile
          label="Peak to peak"
          value={orDash(energised ? stats.peak_to_peak_mm_s : null, 2)}
          unit="mm/s"
          tag="from block"
        />
        <StatTile
          label="Crest factor"
          value={orDash(energised ? stats.crest_factor : null, 2)}
          unit="-"
          tag="peak / RMS"
          hint="A sine wave gives 1.41. Higher means impulsive content. Shown only when there is a signal -- the ratio does not exist at zero RMS."
        />
        <StatTile
          label="Rotational frequency"
          value={fmt(telemetry.rotational_frequency_hz, 2)}
          unit="Hz"
          tag="rpm / 60"
        />
        <StatTile label="1x amplitude" value={fmt(telemetry.amplitude_1x_mm_s, 2)} unit="mm/s" tag="synchronous" />
        <StatTile label="2x amplitude" value={fmt(telemetry.amplitude_2x_mm_s, 2)} unit="mm/s" tag="synchronous" />
        <StatTile
          label="Dominant frequency"
          value={fmt(telemetry.dominant_frequency_hz, 1)}
          unit="Hz"
          tag="largest bin"
        />
        <StatTile
          label="High-frequency energy"
          value={fmt(telemetry.high_frequency_energy, 2)}
          unit="mm/s"
          tag="band energy"
          hint="Broadband, non-synchronous. Rises with cavitation."
        />
        <StatTile label="Vibration X" value={fmt(telemetry.vibration_x_mm_s, 2)} unit="mm/s" tag="horizontal" />
        <StatTile label="Vibration Y" value={fmt(telemetry.vibration_y_mm_s, 2)} unit="mm/s" tag="vertical" />
        <StatTile label="Vibration Z" value={fmt(telemetry.vibration_z_mm_s, 2)} unit="mm/s" tag="axial" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ErrorBoundary panelName="Time waveform" compact>
          <Card
            title="Time waveform"
            subtitle="Vibration velocity against time"
            actions={<StatusBadge status={zone.zone === 'A' || zone.zone === 'B' ? { tone: 'ok', label: `ZONE ${zone.zone}`, detail: zone.label } : { tone: zone.zone === 'C' ? 'warn' : 'alarm', label: `ZONE ${zone.zone}`, detail: zone.label }} size="sm" />}
          >
            <TimeWaveformChart data={waveform} />
            <dl className="mt-3">
              <DefinitionRow label="RMS of block" value={fmtUnit(stats.rms_mm_s, 'mm/s', 3)} />
              <DefinitionRow label="Peak of block" value={fmtUnit(stats.peak_mm_s, 'mm/s', 3)} />
              <DefinitionRow
                label="Crest factor of block"
                value={stats.crest_factor === null ? '—' : fmt(stats.crest_factor, 2)}
                tone={
                  stats.crest_factor !== null && stats.crest_factor < 1.35 ? 'warn' : undefined
                }
              />
              <DefinitionRow label="Mean of block" value={fmtUnit(0, 'mm/s', 3)} />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              The block is de-meaned before anything is computed from it, so the trace crosses zero.
              A velocity waveform must: a constant non-zero velocity is a machine in transit, not a
              machine vibrating. The crest factor is the check -- a zero-mean signal cannot sit
              meaningfully below a pure sine's 1.41, because peak/RMS is minimised by putting the
              energy as far from zero as possible, and only a DC pedestal raises RMS without raising
              peak. This page previously read 1.26.
            </p>
          </Card>
        </ErrorBoundary>

        <ErrorBoundary panelName="FFT spectrum" compact>
          <Card title="FFT spectrum" subtitle="Velocity magnitude spectrum with synchronous orders marked">
            <SpectrumChart
              data={spectrum}
              rotationalFrequencyHz={telemetry.rotational_frequency_hz}
              bladePassHz={bpf}
              lineFrequencyHz={energised ? lineHz : undefined}
            />
            <dl className="mt-3">
              <DefinitionRow
                label="1x -- rotational frequency"
                value={fmtUnit(telemetry.rotational_frequency_hz, 'Hz', 2)}
              />
              <DefinitionRow label="2x -- twice rotational (mechanical)" value={fmtUnit(twoX, 'Hz', 2)} />
              <DefinitionRow
                label="Line frequency (electrical)"
                value={fmtUnit(lineHz, 'Hz', 2)}
                tone={ordersResolved ? 'ok' : 'warn'}
              />
              <DefinitionRow
                label="Separation 2x to line"
                value={`${fmt(Math.abs(lineHz - twoX), 2)} Hz${resolutionHz !== null ? ` = ${fmt(Math.abs(lineHz - twoX) / resolutionHz, 1)} bins` : ''}`}
                tone={ordersResolved ? 'ok' : 'warn'}
              />
              <DefinitionRow label="BPF -- blade pass (6 vanes)" value={fmtUnit(bpf, 'Hz', 1)} />
              <DefinitionRow
                label="Resolution df = fs / N"
                value={
                  resolutionHz === null
                    ? '—'
                    : `${fmt(resolutionHz, 4)} Hz${blockSize !== null && samplingRateHz !== null ? ` (${fmt(samplingRateHz, 0)} Hz / ${blockSize})` : ''}`
                }
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              2x mechanical and line frequency are {fmt(Math.abs(lineHz - twoX), 2)} Hz apart, which
              is the most confusable pair on this machine: one says the rotor is unbalanced, the
              other says the motor has an electrical asymmetry, and they are the same peak on a
              spectrum without the resolution to separate them.{' '}
              {ordersResolved
                ? 'At this resolution they are separated by more than a Hann mainlobe, so the two markers point at genuinely different peaks.'
                : 'At this resolution they are NOT separated -- the two markers sit inside one mainlobe and the peak under them cannot be attributed to either. Zero padding would interpolate the display without resolving anything; only a longer block helps.'}
            </p>
            <div className="mt-3">
              <ProvenanceNote>
                {fromApi
                  ? 'Waveform and spectrum are computed by the backend signal-processing module.'
                  : connection === 'live'
                    ? 'The backend did not return waveform data; the plot is synthesised in the browser from the frame harmonic content.'
                    : 'Backend unreachable. Waveform and spectrum are synthesised in the browser from the recorded demonstration frame.'}
              </ProvenanceNote>
            </div>
          </Card>
        </ErrorBoundary>
      </div>

      <Card title="Reading the spectrum">
        <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-slate-900">Imbalance</p>
            <p className="mt-1">
              Dominated by a single 1x peak, in phase, radial. 2x stays low. Amplitude rises with
              speed squared.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Misalignment</p>
            <p className="mt-1">
              Lifts 2x strongly, often with axial content. A 2x that rivals or exceeds 1x is the
              discriminator against imbalance.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Cavitation</p>
            <p className="mt-1">
              Broadband, non-synchronous, random high-frequency energy rather than discrete orders,
              usually with a falling NPSH margin.
            </p>
          </div>
        </div>
      </Card>

      <BearingCalculator shaftRpm={telemetry.rpm} />
    </div>
  )
}
