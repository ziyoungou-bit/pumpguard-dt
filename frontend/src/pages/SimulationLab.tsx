/**
 * Simulation Lab: drive the plant model and inject conditions.
 *
 * This is the page that makes the rest of the site inspectable -- a reviewer can
 * inject misalignment at 60 % severity and watch 2x climb on the spectrum, the
 * health index fall, the diagnosis change and the alarm list populate. Nothing
 * here is a canned animation; every downstream number is recomputed from the
 * physics.
 */

import { useState } from 'react'
import { Eraser, RotateCcw, Zap } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { FaultType } from '../types/contracts'
import { fmt, fmtUnit, humanise } from '../lib/format'
import { assetStateStatus } from '../lib/status'
import {
  Card,
  DefinitionRow,
  Notice,
  PageHeading,
  ProvenanceNote,
  RangeSlider,
  StatusBadge,
} from '../components/ui'

const FAULT_DESCRIPTIONS: Record<string, string> = {
  [FaultType.NORMAL]: 'Healthy machine. Baseline vibration, efficiency near BEP.',
  [FaultType.IMBALANCE]:
    'Mass eccentricity on the impeller. Drives a large synchronous 1x peak; 2x barely responds.',
  [FaultType.MISALIGNMENT]:
    'Shaft centrelines offset or angled at the coupling. Lifts 2x strongly and warms the bearing.',
  [FaultType.FLOW_RESTRICTION]:
    'Blocked strainer or throttled discharge. Raises system resistance: head up, flow down, efficiency away from BEP.',
  [FaultType.CAVITATION]:
    'Suction pressure below vapour pressure at the impeller eye. Broadband high-frequency energy, head loss, NPSH margin lost.',
  [FaultType.DRY_RUN]:
    'No liquid in the casing. Head and flow collapse, bearing and seal temperature climb fast.',
  [FaultType.SENSOR_FAULT]:
    'An instrument channel misreports while the machine itself is fine. Tests whether the diagnosis is fooled.',
}

const FAULT_OPTIONS = Object.values(FaultType)

export function SimulationLab() {
  const {
    telemetry,
    valveOpening,
    setValveOpening,
    rpmSetpoint,
    setRpmSetpoint,
    noise,
    setNoise,
    injectFault,
    clearFault,
    sendCommand,
    connection,
    demoMode,
    lastCommandFeedback,
  } = useAppState()

  const [selectedFault, setSelectedFault] = useState<string>(FaultType.IMBALANCE)
  const [severity, setSeverity] = useState(0.5)

  const state = assetStateStatus(telemetry.asset_state)

  return (
    <div className="space-y-5">
      <PageHeading
        title="Simulation Lab"
        description="Drive the model and inject conditions, then watch every other page respond. Fault signatures are physical: imbalance moves 1x, misalignment moves 2x, cavitation moves the high-frequency band."
        actions={<StatusBadge status={state} />}
      />

      {connection !== 'live' && (
        <Notice tone="warn" title="Running on the browser-side model">
          The backend could not be reached, so these controls drive a plant model running in this
          browser tab. It uses the same pump equations as the backend, but nothing is being sent to
          a server and nothing is persisted.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Operating conditions">
          <div className="space-y-5">
            <RangeSlider
              label="Speed setpoint"
              value={rpmSetpoint}
              min={0}
              max={1750}
              step={10}
              unit="rpm"
              onChange={setRpmSetpoint}
              help="Affinity laws: Q ~ N, H ~ N^2, P ~ N^3. Halving speed quarters the head."
            />
            <RangeSlider
              label="Valve opening"
              value={valveOpening * 100}
              min={5}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => setValveOpening(value / 100)}
              help="Sets the system resistance and therefore where the operating point sits on the pump curve."
            />
            <RangeSlider
              label="Sensor noise"
              value={noise * 100}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => setNoise(value / 100)}
              help="Adds measurement noise to every channel. Useful for seeing how tolerant the diagnosis is to a noisy plant."
            />
          </div>

          <dl className="mt-5">
            <DefinitionRow label="Measured speed" value={fmtUnit(telemetry.rpm, 'rpm', 0)} />
            <DefinitionRow label="Measured flow" value={fmtUnit(telemetry.flow_lpm, 'L/min', 2)} />
            <DefinitionRow label="Measured head" value={fmtUnit(telemetry.pump_head_m, 'm', 2)} />
            <DefinitionRow
              label="Vibration RMS"
              value={fmtUnit(telemetry.vibration_rms_mm_s, 'mm/s', 2)}
            />
            <DefinitionRow label="Health index" value={`${fmt(telemetry.health_index, 0)} / 100`} />
          </dl>
        </Card>

        <Card title="Fault injection">
          <label className="block">
            <span className="field-label">Fault type</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
              value={selectedFault}
              onChange={(event) => setSelectedFault(event.target.value)}
            >
              {FAULT_OPTIONS.map((fault) => (
                <option key={fault} value={fault}>
                  {humanise(fault)}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-sm text-slate-600">{FAULT_DESCRIPTIONS[selectedFault]}</p>

          <div className="mt-4">
            <RangeSlider
              label="Severity"
              value={severity * 100}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => setSeverity(value / 100)}
              help="0 % is a healthy machine; 100 % is an advanced, unmissable fault."
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => injectFault(selectedFault, severity)}
            >
              <Zap className="h-4 w-4" aria-hidden />
              Inject fault
            </button>
            <button type="button" className="btn btn-secondary" onClick={clearFault}>
              <Eraser className="h-4 w-4" aria-hidden />
              Clear fault
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => sendCommand('reset')}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset
            </button>
          </div>

          {lastCommandFeedback && (
            <p className="mt-3 text-sm text-slate-600">{lastCommandFeedback}</p>
          )}

          <dl className="mt-5">
            <DefinitionRow
              label="Injected condition (ground truth)"
              value={humanise(telemetry.fault_state)}
            />
            <DefinitionRow label="Injected severity" value={fmt(telemetry.severity, 2)} />
            <DefinitionRow label="Anomaly score" value={fmt(telemetry.anomaly_score, 2)} />
          </dl>

          <div className="mt-3">
            <ProvenanceNote>
              `fault_state` is the TRUE injected condition, which is why it can be compared against
              the diagnosis page's `detected_condition` to see whether the classifier got it right.
              A real plant has no such ground truth column.
            </ProvenanceNote>
          </div>
        </Card>
      </div>

      <Card title="What to look for">
        <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold text-slate-900">Inject imbalance</p>
            <p className="mt-1">
              Vibration Analysis: 1x rises sharply, 2x stays flat. Health falls, bearing warms.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Inject misalignment</p>
            <p className="mt-1">
              Vibration Analysis: 2x overtakes 1x. Compare the two spectra side by side.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Inject cavitation</p>
            <p className="mt-1">
              Pump Performance: NPSH margin goes negative, head falls off the curve, HF energy
              climbs.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Close the valve</p>
            <p className="mt-1">
              Pump Performance: the operating point slides up and left along the pump curve,
              efficiency drops away from BEP.
            </p>
          </div>
        </div>
      </Card>

      {demoMode === 'interactive' && connection !== 'live' && (
        <p className="text-xs text-slate-500">
          The recorded replay has been handed over to the interactive browser model because a
          control was used. Reload the page to return to the scripted recording.
        </p>
      )}
    </div>
  )
}
