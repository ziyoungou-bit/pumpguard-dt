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
import { BEARING, bladePassFrequencyHz } from '../lib/pumpPhysics'
import {
  bearingDefectFrequencies,
  iso10816Zone,
  synthesiseVibration,
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

  // Local synthesis is keyed on the harmonic amplitudes rather than on the whole
  // frame, so it is not rebuilt on every tick of unrelated noise.
  const synthetic = useMemo(
    () =>
      synthesiseVibration({
        rotational_frequency_hz: Math.max(0.5, telemetry.rotational_frequency_hz),
        amplitude_1x_mm_s: telemetry.amplitude_1x_mm_s,
        amplitude_2x_mm_s: telemetry.amplitude_2x_mm_s,
        high_frequency_energy: telemetry.high_frequency_energy,
        broadband_noise_mm_s: 0.08,
        blade_pass_hz: bladePassFrequencyHz(Math.max(1, telemetry.rpm)),
        blade_pass_amplitude_mm_s: 0.22,
        seed: 4242,
      }),
    [
      telemetry.rotational_frequency_hz,
      telemetry.amplitude_1x_mm_s,
      telemetry.amplitude_2x_mm_s,
      telemetry.high_frequency_energy,
      telemetry.rpm,
    ],
  )

  const waveform = apiWaveform?.waveform ?? synthetic.waveform
  const spectrum = apiSpectrum?.spectrum ?? synthetic.spectrum
  const fromApi = apiWaveform !== null && apiSpectrum !== null

  return { waveform, spectrum, fromApi }
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
  const { waveform, spectrum, fromApi } = useVibrationSignals()

  const stats = useMemo(
    () => waveformStatistics(waveform.map((point) => point.amplitude_mm_s)),
    [waveform],
  )
  const zone = iso10816Zone(telemetry.vibration_rms_mm_s)
  const bpf = bladePassFrequencyHz(Math.max(1, telemetry.rpm))

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
          hint={`ISO 10816-3 zone ${zone.zone}: ${zone.label}`}
        />
        <StatTile label="Peak" value={fmt(telemetry.vibration_peak_mm_s, 2)} unit="mm/s" tag="ACC-101" />
        <StatTile
          label="Peak to peak"
          value={fmt(stats.peak_to_peak_mm_s, 2)}
          unit="mm/s"
          tag="from waveform"
        />
        <StatTile
          label="Crest factor"
          value={fmt(telemetry.crest_factor, 2)}
          unit="-"
          tag="peak / RMS"
          hint="A sine wave gives 1.41. Higher means impulsive content."
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
              <DefinitionRow label="RMS of displayed block" value={fmtUnit(stats.rms_mm_s, 'mm/s', 3)} />
              <DefinitionRow label="Peak of displayed block" value={fmtUnit(stats.peak_mm_s, 'mm/s', 3)} />
              <DefinitionRow
                label="Crest factor of displayed block"
                value={fmt(stats.crest_factor, 2)}
              />
            </dl>
          </Card>
        </ErrorBoundary>

        <ErrorBoundary panelName="FFT spectrum" compact>
          <Card title="FFT spectrum" subtitle="Velocity magnitude spectrum with synchronous orders marked">
            <SpectrumChart
              data={spectrum}
              rotationalFrequencyHz={Math.max(0.5, telemetry.rotational_frequency_hz)}
              bladePassHz={bpf}
            />
            <dl className="mt-3">
              <DefinitionRow
                label="1x -- rotational frequency"
                value={fmtUnit(telemetry.rotational_frequency_hz, 'Hz', 2)}
              />
              <DefinitionRow
                label="2x -- twice rotational"
                value={fmtUnit(2 * telemetry.rotational_frequency_hz, 'Hz', 2)}
              />
              <DefinitionRow
                label="BPF -- blade pass (6 vanes)"
                value={fmtUnit(bpf, 'Hz', 1)}
              />
            </dl>
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
