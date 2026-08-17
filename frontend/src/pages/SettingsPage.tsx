/**
 * Settings.
 *
 * Presentation preferences and a transparent account of where the data on
 * screen is coming from. No credentials, no secrets and no writable
 * configuration -- there is nothing here that could change how the backend
 * behaves.
 */

import { Compass } from 'lucide-react'
import { useAppState, dataSourceLabel } from '../state/AppState'
import { useUiPrefs } from '../state/UiPrefs'
import { API_BASE_URL, WS_URL } from '../lib/env'
import { fmtDateTime } from '../lib/format'
import { Card, DefinitionRow, Notice, PageHeading, Toggle } from '../components/ui'

export function SettingsPage() {
  const { connection, demoMode, telemetry, sessionId, reconnectAttempts, history } = useAppState()
  const { recruiterMode, setRecruiterMode, startTour, tourCompleted } = useUiPrefs()

  return (
    <div className="space-y-5">
      <PageHeading
        title="Settings"
        description="Presentation preferences and connection provenance."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Presentation">
          <div className="space-y-4">
            <Toggle
              checked={recruiterMode}
              onChange={setRecruiterMode}
              label="Recruiter Mode"
              description="Hides the engineer-facing depth -- Simulation Lab and the Engineering formula sheet -- so the walkthrough stays on the story rather than the internals."
            />
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-900">Guided tour</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Five steps: Digital Twin, Vibration, Pump Physics, AI Diagnosis, SCADA.
                {tourCompleted ? ' You have already completed or skipped it.' : ''}
              </p>
              <button type="button" className="btn btn-secondary mt-2" onClick={startTour}>
                <Compass className="h-4 w-4" aria-hidden />
                Restart guided tour
              </button>
            </div>
          </div>
        </Card>

        <Card title="Connection">
          <dl>
            <DefinitionRow
              label="Data source"
              value={dataSourceLabel(connection, telemetry)}
              tone={connection === 'live' ? 'info' : 'warn'}
            />
            <DefinitionRow
              label="Stream"
              value={connection === 'live' ? 'Websocket connected' : 'Websocket not connected'}
              tone={connection === 'live' ? 'ok' : 'warn'}
            />
            {connection !== 'live' && (
              <DefinitionRow
                label="Fallback mode"
                value={demoMode === 'interactive' ? 'Browser-side plant model' : 'Recorded replay'}
              />
            )}
            <DefinitionRow label="Reconnect attempts" value={String(reconnectAttempts)} />
            {/*
              Shown only when a session actually exists. The row used to read
              "Session id: Not issued" offline, which looks like an unfinished
              field -- it is not: api.ts records the id the backend returns and
              every subsequent request carries it. There is genuinely no session
              to name when the browser is running its own plant model, and an
              absent row says that better than a placeholder does.
            */}
            {sessionId !== undefined && (
              <DefinitionRow label="Session id" value={sessionId} />
            )}
            <DefinitionRow label="API base URL" value={API_BASE_URL} />
            <DefinitionRow label="Websocket URL" value={WS_URL} />
            <DefinitionRow label="Frames buffered" value={String(history.length)} />
            <DefinitionRow label="Frame schema version" value={telemetry.schema_version} />
            <DefinitionRow label="Latest frame" value={fmtDateTime(telemetry.timestamp)} />
          </dl>
        </Card>
      </div>

      <Card title="Where the numbers come from">
        {connection === 'live' ? (
          <Notice tone="info" title="Backend simulation">
            The websocket is connected and every value on screen is produced by the backend physics
            simulation of the MTR-101 / P-101 set. It is simulated data. No physical asset exists.
          </Notice>
        ) : (
          <Notice tone="warn" title="Recorded demonstration dataset">
            The backend could not be reached, so the application is replaying a bundled recorded
            dataset generated from the same pump equations. It is labelled RECORDED DEMO everywhere
            it appears and is never presented as live.
            {demoMode === 'interactive'
              ? ' Because a control has been used, the replay has handed over to a plant model running in this browser tab.'
              : ''}
          </Notice>
        )}
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          There is no configuration on this page that alters the backend. The API and websocket
          addresses are read from build-time environment variables and are shown here only so the
          deployment can be identified.
        </p>
      </Card>
    </div>
  )
}
