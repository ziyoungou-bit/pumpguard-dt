/**
 * Maintenance.
 *
 * Turns the diagnosis into the thing a maintenance planner actually needs: a
 * condition, the evidence for it, an action, and a work order. The work order is
 * clearly stamped as a demonstration artefact -- a document that looks like a
 * real work order but is not one is a genuinely dangerous thing to leave lying
 * around a portfolio.
 */

import { useState } from 'react'
import { ClipboardList, FileText } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { fmt, fmtDateTime, fmtPercent, fmtUnit, humanise } from '../lib/format'
import { healthStatus, severityStatus } from '../lib/status'
import { ASSET_TAGS } from '../lib/pumpPhysics'
import { iso10816Zone } from '../lib/vibration'
import {
  Card,
  DefinitionRow,
  Meter,
  Notice,
  PageHeading,
  ProvenanceNote,
  StatusBadge,
} from '../components/ui'

interface WorkOrder {
  reference: string
  raisedAt: string
  condition: string
  severityLabel: string
  healthIndex: number
  actions: string[]
  evidence: string[]
  operatingHours: number
}

export function Maintenance() {
  const { telemetry, diagnosis, operatingHours } = useAppState()
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null)

  const health = healthStatus(diagnosis.health_index)
  const severity = severityStatus(diagnosis.severity_label)
  const zone = iso10816Zone(telemetry.vibration_rms_mm_s)

  const generate = () => {
    const now = new Date()
    setWorkOrder({
      reference: `DEMO-WO-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
        now.getDate(),
      ).padStart(2, '0')}-${String(Math.floor(now.getTime() / 1000) % 10000).padStart(4, '0')}`,
      raisedAt: now.toISOString(),
      condition: diagnosis.detected_condition,
      severityLabel: diagnosis.severity_label,
      healthIndex: diagnosis.health_index,
      actions: diagnosis.recommended_actions,
      evidence: [
        ...diagnosis.physics_evidence.map((item) => `Physics: ${item.statement}`),
        ...diagnosis.model_evidence.map((item) => `Model: ${item.statement}`),
      ],
      operatingHours,
    })
  }

  return (
    <div className="space-y-5">
      <PageHeading
        title="Maintenance"
        description="Condition-based maintenance view: what the asset's condition implies, what to do about it, and a demonstration work order."
        actions={
          <button type="button" className="btn btn-primary" onClick={generate}>
            <ClipboardList className="h-4 w-4" aria-hidden />
            Generate Work Order
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Asset condition">
          <p className="text-xl font-semibold text-slate-900">
            {humanise(diagnosis.detected_condition)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={severity} size="sm" />
            <StatusBadge status={health} size="sm" />
          </div>
          <dl className="mt-3">
            <DefinitionRow label="Confidence" value={fmtPercent(diagnosis.confidence, 0)} />
            <DefinitionRow label="Anomaly score" value={fmt(diagnosis.anomaly_score, 2)} />
            <DefinitionRow
              label="Vibration zone"
              value={`ISO 10816-3 zone ${zone.zone}`}
              tone={zone.zone === 'A' || zone.zone === 'B' ? 'ok' : zone.zone === 'C' ? 'warn' : 'alarm'}
            />
          </dl>
        </Card>

        <Card title="Health index">
          <div className="flex items-baseline gap-2">
            <span className="numeric text-4xl font-semibold text-slate-900">
              {fmt(diagnosis.health_index, 0)}
            </span>
            <span className="text-sm text-slate-500">/ 100</span>
          </div>
          <div className="mt-3">
            <Meter value={diagnosis.health_index} tone={health.tone} label="Health index" />
          </div>
          <p className="mt-2 text-sm text-slate-600">{health.detail}</p>
        </Card>

        <Card title="Operating data">
          <dl>
            <DefinitionRow label="Operating hours" value={fmtUnit(operatingHours, 'h', 1)} />
            <DefinitionRow label="Asset state" value={telemetry.asset_state} />
            <DefinitionRow label="Speed" value={fmtUnit(telemetry.rpm, 'rpm', 0)} />
            <DefinitionRow
              label="Bearing temperature"
              value={fmtUnit(telemetry.bearing_temperature_c, 'degC', 1)}
            />
            <DefinitionRow
              label="Vibration RMS"
              value={fmtUnit(telemetry.vibration_rms_mm_s, 'mm/s', 2)}
            />
            <DefinitionRow label="Motor tag" value={ASSET_TAGS.motor} />
            <DefinitionRow label="Pump tag" value={ASSET_TAGS.pump} />
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Evidence" subtitle="Physics and model statements behind the condition">
          <ul className="space-y-2">
            {[...diagnosis.physics_evidence, ...diagnosis.model_evidence].map((item, index) => (
              <li key={index} className="flex gap-2 text-sm">
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                  {item.source}
                </span>
                <span className="text-slate-700">{item.statement}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recommended actions">
          <ol className="space-y-2">
            {diagnosis.recommended_actions.map((action, index) => (
              <li key={index} className="flex gap-3 text-sm text-slate-700">
                <span className="numeric mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {index + 1}
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {workOrder && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-500" aria-hidden />
              Work order {workOrder.reference}
            </span>
          }
          actions={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setWorkOrder(null)}
            >
              Discard
            </button>
          }
        >
          <Notice tone="warn" title="Prototype / Demonstration Only">
            This document is generated by a portfolio prototype. It is not a maintenance
            instruction, it has no authorisation, and it references a simulated asset that does not
            exist. Do not use it as a template for real maintenance work.
          </Notice>

          <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <DefinitionRow label="Reference" value={workOrder.reference} />
            <DefinitionRow label="Raised" value={fmtDateTime(workOrder.raisedAt)} />
            <DefinitionRow label="Asset" value={`${ASSET_TAGS.motor} / ${ASSET_TAGS.pump}`} />
            <DefinitionRow label="Condition" value={humanise(workOrder.condition)} />
            <DefinitionRow label="Severity" value={workOrder.severityLabel.toUpperCase()} />
            <DefinitionRow
              label="Health index at raise"
              value={`${fmt(workOrder.healthIndex, 0)} / 100`}
            />
            <DefinitionRow
              label="Operating hours"
              value={fmtUnit(workOrder.operatingHours, 'h', 1)}
            />
            <DefinitionRow label="Data source" value="Simulation / recorded demonstration" />
          </dl>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Work to be carried out
              </h3>
              <ol className="mt-2 space-y-1.5">
                {workOrder.actions.map((action, index) => (
                  <li key={index} className="text-sm text-slate-700">
                    {index + 1}. {action}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Supporting evidence
              </h3>
              <ul className="mt-2 space-y-1.5">
                {workOrder.evidence.map((line, index) => (
                  <li key={index} className="text-sm text-slate-700">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <ProvenanceNote>
        Operating hours are accumulated by the simulation while the asset is running and reset when
        the page is reloaded. There is no maintenance history database in this prototype.
      </ProvenanceNote>
    </div>
  )
}
