/**
 * Digital Twin page: the 3D scene plus the sensor detail panel.
 *
 * Selection state is held here rather than inside the canvas so the detail
 * panel is ordinary DOM -- readable, selectable and accessible, which nothing
 * drawn inside a WebGL canvas is.
 */

import { Suspense, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { AssetState } from '../types/contracts'
import { SENSOR_MARKERS, TwinScene, VIBRATION_MAGNIFICATION } from '../components/twin/TwinScene'
import { Card, DefinitionRow, Notice, PageHeading, ProvenanceNote, StatusBadge } from '../components/ui'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { assetStateStatus, limitStatus, sensorQualityStatus } from '../lib/status'
import { fmt, fmtUnit } from '../lib/format'

function CanvasFallback({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
      <p className="text-sm font-medium text-slate-700">{message}</p>
      <p className="max-w-md text-xs text-slate-500">
        The rest of this page -- sensor readings, quality flags and alarm limits -- is unaffected
        and continues to update.
      </p>
    </div>
  )
}

export function DigitalTwinPage() {
  const { telemetry, valveOpening, connection } = useAppState()
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const selected = SENSOR_MARKERS.find((marker) => marker.tag === selectedTag) ?? null
  const state = assetStateStatus(telemetry.asset_state)
  const running =
    telemetry.asset_state === AssetState.RUNNING || telemetry.asset_state === AssetState.STARTING

  return (
    <div className="space-y-5">
      <PageHeading
        title="Digital Twin"
        description="A geometric twin of the MTR-101 / P-101 set driven by the live telemetry stream. The shaft and coupling turn at the measured speed and stop when the asset stops."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          title="Motor-pump assembly"
          subtitle="Drag to orbit, scroll to zoom, click a sensor marker to inspect it"
          bodyClassName="p-0"
          actions={<StatusBadge status={state} size="sm" />}
        >
          <div className="h-[480px] w-full overflow-hidden rounded-b-lg">
            <ErrorBoundary panelName="3D digital twin">
              <Suspense fallback={<CanvasFallback message="Preparing the 3D scene..." />}>
                <TwinScene
                  telemetry={telemetry}
                  valveOpening={valveOpening}
                  selectedTag={selectedTag}
                  onSelectTag={setSelectedTag}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Sensor detail">
            {selected ? (
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="numeric text-base font-semibold text-slate-900">{selected.tag}</h3>
                  <StatusBadge
                    status={sensorQualityStatus(telemetry.sensor_quality?.[selected.tag])}
                    size="sm"
                  />
                </div>
                <p className="mt-0.5 text-sm text-slate-600">{selected.label}</p>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="numeric text-3xl font-semibold text-slate-900">
                    {fmt(selected.read(telemetry), selected.digits)}
                  </span>
                  <span className="text-sm text-slate-500">{selected.unit}</span>
                </div>
                <dl className="mt-3">
                  <DefinitionRow
                    label="Alarm limit (high)"
                    value={fmtUnit(selected.alarmLimit, selected.unit, selected.digits)}
                  />
                  <DefinitionRow
                    label="Status against limit"
                    value={
                      limitStatus(
                        selected.read(telemetry),
                        selected.alarmLimit * 0.85,
                        selected.alarmLimit,
                      ).label
                    }
                    tone={
                      limitStatus(
                        selected.read(telemetry),
                        selected.alarmLimit * 0.85,
                        selected.alarmLimit,
                      ).tone
                    }
                  />
                  <DefinitionRow
                    label="Signal quality"
                    value={sensorQualityStatus(telemetry.sensor_quality?.[selected.tag]).label}
                  />
                </dl>
                <button
                  type="button"
                  className="btn btn-secondary mt-3 w-full"
                  onClick={() => setSelectedTag(null)}
                >
                  Clear selection
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <MousePointerClick className="h-4 w-4" aria-hidden />
                  No sensor selected
                </div>
                <p className="text-sm text-slate-600">
                  Click a marker in the scene, or pick one from the list below, to see its reading,
                  unit, signal quality and alarm limit.
                </p>
                <ul className="mt-1 grid w-full grid-cols-2 gap-1.5">
                  {SENSOR_MARKERS.map((marker) => (
                    <li key={marker.tag}>
                      <button
                        type="button"
                        onClick={() => setSelectedTag(marker.tag)}
                        className="numeric w-full rounded border border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {marker.tag}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Animation provenance">
            <Notice tone="warn" title="Visual vibration magnification">
              The shake in the scene is exaggerated by roughly {VIBRATION_MAGNIFICATION}x. At{' '}
              {fmt(telemetry.vibration_rms_mm_s, 2)} mm/s and{' '}
              {fmt(telemetry.rotational_frequency_hz, 1)} Hz the true peak displacement is about{' '}
              {fmt(
                ((Math.SQRT2 * (telemetry.vibration_rms_mm_s / 1000)) /
                  (2 * Math.PI * Math.max(1, telemetry.rotational_frequency_hz))) *
                  1e6,
                0,
              )}{' '}
              micrometres -- invisible at this scale. It is a visual aid, not true displacement.
            </Notice>
            <dl className="mt-3">
              <DefinitionRow label="Shaft speed" value={fmtUnit(telemetry.rpm, 'rpm', 0)} />
              <DefinitionRow
                label="Rotation in scene"
                value={running ? `${fmt(telemetry.rotational_frequency_hz, 1)} rev/s` : 'Stopped'}
                tone={running ? 'ok' : 'idle'}
              />
              <DefinitionRow
                label="Valve opening"
                value={`${fmt(valveOpening * 100, 0)} %`}
              />
              <DefinitionRow
                label="Motor body tint"
                value={`${fmt(telemetry.motor_temperature_c, 1)} degC`}
              />
            </dl>
            <div className="mt-3">
              <ProvenanceNote>
                Motor colour warms with winding temperature as an indication only -- it is not a
                thermal image and carries no absolute scale.
                {connection === 'live'
                  ? ''
                  : ' The telemetry driving this scene is the bundled recorded demonstration dataset.'}
              </ProvenanceNote>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
