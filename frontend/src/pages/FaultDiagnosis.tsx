/**
 * Fault Diagnosis.
 *
 * A bare class label is not a diagnosis anyone can act on or argue with, so the
 * page is built around the evidence rather than the label. Physics evidence and
 * model evidence sit in separate panels on purpose: a reader must be able to see
 * where the deterministic rules and the classifier agree, and where only one of
 * them is asserting something.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, FlaskConical, Ruler } from 'lucide-react'
import { useAppState } from '../state/AppState'
import type { DiagnosisEvidence } from '../types/contracts'
import { fmt, fmtPercent, humanise } from '../lib/format'
import { healthStatus, severityStatus } from '../lib/status'
import {
  Card,
  DefinitionRow,
  Meter,
  Notice,
  PageHeading,
  ProvenanceNote,
  StatusBadge,
} from '../components/ui'
import { FeatureImportanceChart } from '../components/charts'
import { ErrorBoundary } from '../components/ErrorBoundary'

function EvidenceList({ items, emptyText }: { items: DiagnosisEvidence[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">{emptyText}</p>
  }
  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={index} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
          <p className="text-sm font-medium text-slate-900">{item.statement}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-500">
            {item.measured_value !== null && item.measured_value !== undefined && (
              <span className="numeric">
                Measured: {fmt(item.measured_value, 3)} {item.unit}
              </span>
            )}
            {item.reference && <span>Compared against: {item.reference}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function FaultDiagnosis() {
  const { telemetry, diagnosis, connection, diagnosisFromApi } = useAppState()
  const [showImportance, setShowImportance] = useState(false)

  const health = healthStatus(diagnosis.health_index)
  const severity = severityStatus(diagnosis.severity_label)

  const importance = Object.entries(diagnosis.feature_importance)
    .map(([feature, value]) => ({ feature, importance: value }))
    .sort((a, b) => b.importance - a.importance)

  return (
    <div className="space-y-5">
      <PageHeading
        title="Fault Diagnosis"
        description="What the system believes is wrong, how confident it is, and -- more usefully -- the evidence behind that belief."
      />

      {diagnosis.physics_model_conflict && (
        <Notice tone="warn" title="Physics rules and the classifier disagree">
          The deterministic physics rules and the trained classifier have reached different
          conclusions on this frame. That disagreement is shown rather than resolved silently: treat
          the diagnosis as unconfirmed and read both evidence panels below before acting.
        </Notice>
      )}

      {diagnosis.is_sensor_fault && (
        <Notice tone="alarm" title="Suspected sensor fault">
          At least one channel is behaving inconsistently with the others. A diagnosis derived from
          a suspect channel should not be acted on until the instrument has been verified.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Detected condition">
          <p className="text-2xl font-semibold text-slate-900">
            {humanise(diagnosis.detected_condition)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Classified against the seven-condition vocabulary shared by the simulator, the model and
            this interface.
          </p>
        </Card>

        <Card title="Confidence">
          <p className="numeric text-3xl font-semibold text-slate-900">
            {fmtPercent(diagnosis.confidence, 0)}
          </p>
          <div className="mt-3">
            <Meter value={diagnosis.confidence * 100} tone="info" label="Classifier confidence" />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Classifier probability for the reported class. Not a probability that the machine is
            actually faulty.
          </p>
        </Card>

        <Card title="Health index">
          <div className="flex items-baseline gap-2">
            <span className="numeric text-3xl font-semibold text-slate-900">
              {fmt(diagnosis.health_index, 0)}
            </span>
            <span className="text-sm text-slate-500">/ 100</span>
          </div>
          <div className="mt-3">
            <Meter value={diagnosis.health_index} tone={health.tone} label="Health index" />
          </div>
          <div className="mt-2">
            <StatusBadge status={health} size="sm" />
          </div>
        </Card>

        <Card title="Severity">
          <StatusBadge status={severity} />
          <p className="mt-2 text-sm text-slate-600">{severity.detail}</p>
          <dl className="mt-3">
            <DefinitionRow label="Anomaly score" value={fmt(diagnosis.anomaly_score, 2)} />
            <DefinitionRow label="Injected severity" value={fmt(telemetry.severity, 2)} />
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-slate-500" aria-hidden />
              Physics evidence
            </span>
          }
          subtitle="Deterministic rules over measured quantities and published thresholds"
        >
          <EvidenceList
            items={diagnosis.physics_evidence}
            emptyText="No physics rule fired on this frame."
          />
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-slate-500" aria-hidden />
              Model evidence
            </span>
          }
          subtitle="Statements made by the trained models, not by the physics"
        >
          <EvidenceList
            items={diagnosis.model_evidence}
            emptyText="The model contributed no evidence on this frame."
          />
        </Card>
      </div>

      <Card
        title="Why this diagnosis?"
        subtitle="Relative contribution of each contract feature to the classification"
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowImportance((open) => !open)}
            aria-expanded={showImportance}
          >
            {showImportance ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
            {showImportance ? 'Hide reasoning' : 'Why this diagnosis?'}
          </button>
        }
      >
        {showImportance ? (
          importance.length > 0 ? (
            <ErrorBoundary panelName="Feature importance" compact>
              <FeatureImportanceChart data={importance} height={Math.max(200, importance.length * 34)} />
              <p className="mt-3 text-xs text-slate-500">
                Importances describe which features moved this classification, not causation. A high
                contribution from a feature does not by itself prove that feature is faulty.
              </p>
            </ErrorBoundary>
          ) : (
            <p className="text-sm text-slate-500">
              No feature importances were reported for this diagnosis.
            </p>
          )
        ) : (
          <p className="text-sm text-slate-600">
            Open this panel to see which measured features drove the classification, ranked by
            contribution.
          </p>
        )}
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
        <div className="mt-4">
          <ProvenanceNote>
            {diagnosisFromApi
              ? 'Diagnosis supplied by the backend diagnosis engine.'
              : connection === 'live'
                ? 'The backend diagnosis endpoint returned nothing; this diagnosis was derived in the browser from the current frame.'
                : 'Backend unreachable. This diagnosis was derived in the browser from the recorded demonstration frame.'}{' '}
            Recommended actions are illustrative maintenance guidance for a prototype, not a
            certified maintenance instruction.
          </ProvenanceNote>
        </div>
      </Card>
    </div>
  )
}
