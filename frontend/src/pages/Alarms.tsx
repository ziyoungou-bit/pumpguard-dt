/**
 * Alarm list.
 *
 * An alarm row is only useful if it carries the value that caused it and the
 * threshold it crossed -- "Vibration high" on its own tells an engineer nothing.
 * Both are columns here, with the unit, so a reader can judge the alarm rather
 * than merely receive it.
 */

import { useMemo, useState } from 'react'
import { BellRing, Check } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { alarmSeverityStatus } from '../lib/status'
import { fmtDateTime, fmtClock } from '../lib/format'
import { Card, PageHeading, ProvenanceNote, StatusBadge } from '../components/ui'

type StateFilter = 'all' | 'active' | 'cleared' | 'unacknowledged'

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  TRIP: 1,
  ALARM: 2,
  WARNING: 3,
}

export function Alarms() {
  const { alarms, acknowledgeAlarm, connection } = useAppState()
  const [stateFilter, setStateFilter] = useState<StateFilter>('active')
  const [severityFilter, setSeverityFilter] = useState<string>('all')

  const severities = useMemo(
    () => Array.from(new Set(alarms.map((alarm) => alarm.severity))),
    [alarms],
  )

  const filtered = useMemo(() => {
    return alarms
      .filter((alarm) => {
        if (stateFilter === 'active') return alarm.state === 'ACTIVE'
        if (stateFilter === 'cleared') return alarm.state === 'CLEARED'
        if (stateFilter === 'unacknowledged') return alarm.state === 'ACTIVE' && !alarm.acknowledged
        return true
      })
      .filter((alarm) => severityFilter === 'all' || alarm.severity === severityFilter)
      .sort((a, b) => {
        if (a.state !== b.state) return a.state === 'ACTIVE' ? -1 : 1
        return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
      })
  }, [alarms, stateFilter, severityFilter])

  const activeCount = alarms.filter((alarm) => alarm.state === 'ACTIVE').length
  const unacknowledgedCount = alarms.filter(
    (alarm) => alarm.state === 'ACTIVE' && !alarm.acknowledged,
  ).length

  const filterButton = (value: StateFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setStateFilter(value)}
      aria-pressed={stateFilter === value}
      className={`btn px-3 py-1.5 text-xs ${stateFilter === value ? 'btn-primary' : 'btn-secondary'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-5">
      <PageHeading
        title="Alarms"
        description="Threshold alarms evaluated against the current frame, with the measured value and the limit that produced them."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            disabled={unacknowledgedCount === 0}
            onClick={() =>
              alarms
                .filter((alarm) => alarm.state === 'ACTIVE' && !alarm.acknowledged)
                .forEach((alarm) => acknowledgeAlarm(alarm.id))
            }
          >
            <BellRing className="h-4 w-4" aria-hidden />
            Acknowledge all ({unacknowledgedCount})
          </button>
        }
      />

      <Card title="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <span className="field-label mr-1">State</span>
          {filterButton('active', `Active (${activeCount})`)}
          {filterButton('unacknowledged', `Unacknowledged (${unacknowledgedCount})`)}
          {filterButton('cleared', 'Cleared')}
          {filterButton('all', `All (${alarms.length})`)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="field-label mr-1">Severity</span>
          <button
            type="button"
            onClick={() => setSeverityFilter('all')}
            aria-pressed={severityFilter === 'all'}
            className={`btn px-3 py-1.5 text-xs ${
              severityFilter === 'all' ? 'btn-primary' : 'btn-secondary'
            }`}
          >
            All
          </button>
          {severities.map((severity) => (
            <button
              key={severity}
              type="button"
              onClick={() => setSeverityFilter(severity)}
              aria-pressed={severityFilter === severity}
              className={`btn px-3 py-1.5 text-xs ${
                severityFilter === severity ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              {severity}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={`Alarm list (${filtered.length})`}
        subtitle="Sorted with active alarms first, then by severity"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="table-cell font-semibold text-slate-900">Timestamp</th>
                <th className="table-cell font-semibold text-slate-900">Tag</th>
                <th className="table-cell font-semibold text-slate-900">Description</th>
                <th className="table-cell font-semibold text-slate-900">Severity</th>
                <th className="table-cell text-right font-semibold text-slate-900">Value</th>
                <th className="table-cell text-right font-semibold text-slate-900">Threshold</th>
                <th className="table-cell font-semibold text-slate-900">State</th>
                <th className="table-cell font-semibold text-slate-900">Acknowledged</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td className="table-cell text-slate-600" colSpan={8}>
                    No alarms match this filter. {activeCount === 0
                      ? 'The asset currently has no active alarms.'
                      : `There ${activeCount === 1 ? 'is' : 'are'} ${activeCount} active alarm${activeCount === 1 ? '' : 's'} under a different filter.`}
                  </td>
                </tr>
              ) : (
                filtered.map((alarm) => {
                  const severity = alarmSeverityStatus(alarm.severity)
                  return (
                    <tr
                      key={alarm.id}
                      className={`border-b border-slate-100 ${
                        alarm.state === 'ACTIVE' ? '' : 'text-slate-500'
                      }`}
                    >
                      <td className="table-cell numeric whitespace-nowrap">
                        {fmtClock(alarm.timestamp)}
                      </td>
                      <td className="table-cell numeric font-semibold">{alarm.tag}</td>
                      <td className="table-cell">{alarm.description}</td>
                      <td className="table-cell">
                        <StatusBadge status={severity} size="sm" />
                      </td>
                      <td className="table-cell numeric text-right whitespace-nowrap">
                        {alarm.value} {alarm.unit}
                      </td>
                      <td className="table-cell numeric text-right whitespace-nowrap">
                        {alarm.threshold} {alarm.unit}
                      </td>
                      <td className="table-cell">
                        <StatusBadge
                          status={
                            alarm.state === 'ACTIVE'
                              ? { tone: 'alarm', label: 'ACTIVE', detail: 'Condition present now' }
                              : { tone: 'ok', label: 'CLEARED', detail: 'Condition no longer present' }
                          }
                          size="sm"
                        />
                      </td>
                      <td className="table-cell">
                        {alarm.acknowledged ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            {alarm.acknowledged_at ? fmtDateTime(alarm.acknowledged_at) : 'Yes'}
                          </span>
                        ) : alarm.state === 'ACTIVE' ? (
                          <button
                            type="button"
                            className="btn btn-secondary px-2 py-1 text-xs"
                            onClick={() => acknowledgeAlarm(alarm.id)}
                          >
                            Acknowledge
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Not required</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ProvenanceNote>
        Alarms are evaluated against the current telemetry frame each tick, so a cleared alarm
        disappears from the active list as soon as the condition goes away. There is no persisted
        alarm journal in this prototype.
        {connection === 'live'
          ? ' The list is supplied by the backend when its alarm endpoint responds.'
          : ' The backend is unreachable, so alarms are evaluated in the browser against the recorded demonstration frame.'}
      </ProvenanceNote>
    </div>
  )
}
