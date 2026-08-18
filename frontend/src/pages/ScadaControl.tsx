/**
 * SCADA Control.
 *
 * The interesting part of a control page is not the buttons, it is the
 * interlocks. Every command shows whether it is currently permitted and, when it
 * is not, which state the asset is in and why the transition is refused --
 * because "the button did nothing" is the single most common complaint about
 * badly built control interfaces.
 */

import {
  BellRing,
  CircleStop,
  Hand,
  OctagonX,
  Play,
  RotateCcw,
  Wrench,
  Zap,
} from 'lucide-react'
import { useAppState } from '../state/AppState'
import type { ScadaCommand } from '../state/localSim'
import { AssetState } from '../types/contracts'
import { assetStateStatus } from '../lib/status'
import { fmt, fmtDuration, fmtUnit } from '../lib/format'
import {
  Card,
  DefinitionRow,
  Notice,
  PageHeading,
  ProvenanceNote,
  StatusBadge,
} from '../components/ui'

interface CommandSpec {
  command: ScadaCommand
  label: string
  icon: typeof Play
  variant: 'primary' | 'secondary' | 'danger'
  description: string
  /**
   * True for commands the backend controller does not implement. They exist in
   * the browser-side state machine only, so against a live backend they cannot
   * do anything. AppState short-circuits them before any request is made -- the
   * button never 404s, it just reports "requested" and nothing moves, which is
   * the failure this page's own subtitle promises not to ship. Disabled and
   * labelled instead.
   */
  browserOnly?: boolean
}

const COMMANDS: CommandSpec[] = [
  {
    command: 'start',
    label: 'START',
    icon: Play,
    variant: 'primary',
    description: 'Begin the start sequence and ramp to the speed setpoint.',
  },
  {
    command: 'stop',
    label: 'STOP',
    icon: CircleStop,
    variant: 'secondary',
    description: 'Controlled stop: ramp down and return to OFF.',
  },
  {
    command: 'reset',
    label: 'RESET',
    icon: RotateCcw,
    variant: 'secondary',
    description: 'Clear a latched fault or emergency stop and return to OFF.',
  },
  {
    command: 'auto',
    label: 'AUTO',
    icon: Zap,
    variant: 'secondary',
    description: 'Hand control to the automation layer.',
  },
  {
    command: 'manual',
    label: 'MANUAL',
    icon: Hand,
    variant: 'secondary',
    description: 'Take manual control of the setpoints.',
  },
  {
    command: 'maintenance',
    label: 'MAINTENANCE',
    icon: Wrench,
    variant: 'secondary',
    description: 'Lock the asset out for maintenance.',
    browserOnly: true,
  },
]

/**
 * The state machine, written out so the interface explains itself.
 *
 * This table is the single source of truth on this page: the command cards
 * above derive their permitted-from labels by filtering it, rather than
 * carrying a second copy of the same rules. Two independently maintained
 * copies is exactly how those labels came to contradict this table.
 *
 * The E_STOP rows match the backend, which was verified by calling it: the
 * latch is released by pressing EMERGENCY STOP again (ESTOP_RESET -> OFF), and
 * RESET under E_STOP is refused with "emergency stop active, reset it first".
 * This table previously claimed E_STOP --RESET--> OFF, which is the transition
 * the controller explicitly rejects.
 */
const TRANSITIONS: { from: string; event: string; to: string }[] = [
  { from: 'OFF', event: 'START', to: 'STARTING' },
  { from: 'STARTING', event: 'speed reached', to: 'RUNNING' },
  { from: 'RUNNING', event: 'STOP', to: 'STOPPING' },
  { from: 'STOPPING', event: 'speed zero', to: 'OFF' },
  { from: 'RUNNING', event: 'protection trip', to: 'FAULT' },
  { from: 'FAULT', event: 'RESET', to: 'OFF' },
  { from: 'any', event: 'EMERGENCY STOP', to: 'E_STOP' },
  { from: 'E_STOP', event: 'EMERGENCY STOP', to: 'OFF' },
  { from: 'OFF', event: 'MAINTENANCE', to: 'MAINTENANCE' },
  { from: 'MAINTENANCE', event: 'MAINTENANCE', to: 'OFF' },
]

/**
 * The event each command raises, so a card can find its own rows in
 * TRANSITIONS. AUTO and MANUAL map to null deliberately: they hand control
 * between the operator and the automation layer without moving the asset
 * state, so they have no row and no permitted-from set. Printing a state name
 * beside them would be inventing a rule the state machine does not contain.
 */
const COMMAND_EVENT: Record<ScadaCommand, string | null> = {
  start: 'START',
  stop: 'STOP',
  reset: 'RESET',
  estop: 'EMERGENCY STOP',
  maintenance: 'MAINTENANCE',
  auto: null,
  manual: null,
}

/** States a command is legal from, read off the state machine table itself. */
function permittedFrom(command: ScadaCommand): string[] {
  const event = COMMAND_EVENT[command]
  if (event === null) return []
  return TRANSITIONS.filter((t) => t.event === event).map((t) => t.from)
}

export function ScadaControl() {
  const {
    telemetry,
    sendCommand,
    isCommandBlocked,
    alarms,
    acknowledgeAlarm,
    autoMode,
    operatingHours,
    lastCommandFeedback,
    connection,
  } = useAppState()

  const state = assetStateStatus(telemetry.asset_state)
  const unacknowledged = alarms.filter((alarm) => alarm.state === 'ACTIVE' && !alarm.acknowledged)

  return (
    <div className="space-y-5">
      <PageHeading
        title="SCADA Control"
        description="Control state machine for MTR-101 / P-101 with the interlocks that govern it."
        actions={<StatusBadge status={state} />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title="Commands" subtitle="A refused command explains itself rather than doing nothing">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMMANDS.map((spec) => {
              // Unavailable against a live backend when the controller has no
              // such command. Offline the browser state machine implements it,
              // so it stays live there rather than being disabled everywhere.
              const unavailable = Boolean(spec.browserOnly) && connection === 'live'
              const blocked = unavailable ? null : isCommandBlocked(spec.command)
              const active =
                (spec.command === 'auto' && autoMode) ||
                (spec.command === 'manual' && !autoMode) ||
                (spec.command === 'maintenance' &&
                  telemetry.asset_state === AssetState.MAINTENANCE)

              // Straight off the state machine table below -- see permittedFrom.
              const permitted = permittedFrom(spec.command)

              return (
                <div key={spec.command} className="rounded-lg border border-slate-200 p-3">
                  <button
                    type="button"
                    className={`btn w-full ${
                      spec.variant === 'primary'
                        ? 'btn-primary'
                        : spec.variant === 'danger'
                          ? 'btn-danger'
                          : 'btn-secondary'
                    } ${active ? 'ring-2 ring-blue-400' : ''}`}
                    onClick={() => sendCommand(spec.command)}
                    disabled={unavailable || Boolean(blocked)}
                  >
                    <spec.icon className="h-4 w-4" aria-hidden />
                    {spec.label}
                  </button>
                  <p className="mt-2 text-xs text-slate-600">{spec.description}</p>
                  {unavailable ? (
                    <p className="mt-1.5 text-xs font-medium text-slate-500">
                      {spec.label} is modelled in the browser-side simulation only; not implemented
                      in the backend controller.
                    </p>
                  ) : blocked ? (
                    <p className="mt-1.5 text-xs font-medium text-amber-800">Blocked: {blocked}</p>
                  ) : permitted.length > 0 ? (
                    <p className="mt-1.5 text-xs font-medium text-green-700">
                      Permitted from {permitted.join(', ')}
                      {active ? ' -- currently selected' : ''}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs font-medium text-slate-500">
                      Control mode{active ? ' -- currently selected' : ''}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-4 rounded-lg border-2 border-red-300 bg-red-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-red-900">EMERGENCY STOP</p>
                <p className="mt-0.5 text-xs text-red-800">
                  Removes drive power immediately and latches. Always permitted, from any state.
                  RESET is required afterwards.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-danger px-6 py-3 text-base font-bold"
                onClick={() => sendCommand('estop')}
              >
                <OctagonX className="h-5 w-5" aria-hidden />
                E-STOP
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Alarm acknowledge</p>
              <p className="mt-0.5 text-xs text-slate-600">
                {unacknowledged.length === 0
                  ? 'No unacknowledged active alarms.'
                  : `${unacknowledged.length} active alarm${unacknowledged.length === 1 ? '' : 's'} awaiting acknowledgement.`}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={unacknowledged.length === 0}
              onClick={() => unacknowledged.forEach((alarm) => acknowledgeAlarm(alarm.id))}
            >
              <BellRing className="h-4 w-4" aria-hidden />
              Acknowledge all
            </button>
          </div>

          {lastCommandFeedback && (
            <p className="mt-3 text-sm text-slate-700">Last command: {lastCommandFeedback}</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Controller status">
            <dl>
              <DefinitionRow label="Current state" value={state.label} tone={state.tone} />
              <DefinitionRow label="State meaning" value={state.detail} />
              <DefinitionRow label="Control mode" value={autoMode ? 'AUTO' : 'MANUAL'} />
              <DefinitionRow label="Speed" value={fmtUnit(telemetry.rpm, 'rpm', 0)} />
              <DefinitionRow label="Flow" value={fmtUnit(telemetry.flow_lpm, 'L/min', 1)} />
              <DefinitionRow label="Motor current" value={fmtUnit(telemetry.motor_current_a, 'A', 2)} />
              <DefinitionRow label="Health index" value={`${fmt(telemetry.health_index, 0)} / 100`} />
              <DefinitionRow label="Operating hours" value={fmtUnit(operatingHours, 'h', 1)} />
              <DefinitionRow label="Elapsed this run" value={fmtDuration(telemetry.elapsed_s)} />
            </dl>
          </Card>

          {telemetry.asset_state === AssetState.E_STOP && (
            <Notice tone="alarm" title="Emergency stop latched">
              Drive power is removed and the state is latched. Nothing will restart the asset until
              RESET is issued.
            </Notice>
          )}
          {telemetry.asset_state === AssetState.FAULT && (
            <Notice tone="alarm" title="Protection trip">
              A protection limit was exceeded. Investigate the cause -- see the Alarms page -- then
              RESET before attempting to start.
            </Notice>
          )}
          {telemetry.asset_state === AssetState.MAINTENANCE && (
            <Notice tone="warn" title="Maintenance lock-out">
              The asset is locked out for maintenance. START is refused until maintenance mode is
              exited.
            </Notice>
          )}
        </div>
      </div>

      <Card title="State machine" subtitle="Every transition the controller implements">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="table-cell font-semibold text-slate-900">From state</th>
                <th className="table-cell font-semibold text-slate-900">Event</th>
                <th className="table-cell font-semibold text-slate-900">To state</th>
              </tr>
            </thead>
            <tbody>
              {TRANSITIONS.map((transition, index) => {
                const current =
                  transition.from === telemetry.asset_state || transition.from === 'any'
                return (
                  <tr
                    key={index}
                    className={`border-b border-slate-100 ${current ? 'bg-blue-50' : ''}`}
                  >
                    <td className="table-cell numeric">{transition.from}</td>
                    <td className="table-cell">{transition.event}</td>
                    <td className="table-cell numeric">{transition.to}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Rows available from the current state ({telemetry.asset_state}) are highlighted.
        </p>
        <div className="mt-3">
          <ProvenanceNote>
            {connection === 'live'
              ? 'Commands are sent to the backend controller over the REST API.'
              : 'Backend unreachable: these commands drive the state machine running in this browser tab. No command leaves the page.'}{' '}
            This is a prototype control interface for demonstration. It is not a safety system and
            must not be used to control real plant.
          </ProvenanceNote>
        </div>
      </Card>
    </div>
  )
}
