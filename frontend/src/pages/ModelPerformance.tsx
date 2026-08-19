/**
 * Model Performance.
 *
 * This page is intentionally uncomfortable: it shows the classifier's measured
 * boundary conditions from generated metrics rather than only the favourable
 * headline numbers.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { MODEL_PERFORMANCE } from '../lib/modelPerformance.generated'
import { Card, PageHeading, ProvenanceNote, StatusBadge, StatTile } from '../components/ui'

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`
const num = (value: number, digits = 3) => value.toFixed(digits)

const metrics = MODEL_PERFORMANCE
const grouped = metrics.grouped_split
const labels = grouped.confusion_matrix.labels
const matrix = grouped.confusion_matrix.matrix
const normalized = grouped.confusion_matrix.row_normalized
const anomaly = metrics.anomaly_detector
const threshold = anomaly.threshold_055

function normalSensorFaultCell() {
  const normalIndex = labels.indexOf('normal')
  const sensorFaultIndex = labels.indexOf('sensor_fault')
  return {
    count: matrix[normalIndex]?.[sensorFaultIndex] ?? 0,
    percent: normalized[normalIndex]?.[sensorFaultIndex] ?? 0,
  }
}

const normalSensorFault = normalSensorFaultCell()
const rocPoint = { fpr: threshold.fpr, tpr: threshold.tpr }

function ClassificationTable() {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs font-semibold text-slate-500 uppercase">
          <tr>
            <th className="py-2 pr-4">Class</th>
            <th className="py-2 pr-4 text-right">Precision</th>
            <th className="py-2 pr-4 text-right">Recall</th>
            <th className="py-2 pr-4 text-right">F1</th>
            <th className="py-2 pr-4 text-right">Support</th>
            <th className="py-2 text-right">Class accuracy</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {grouped.per_class_accuracy.map((row) => (
            <tr key={row.label}>
              <td className="py-2 pr-4 font-medium text-slate-900">{row.label}</td>
              <td className="numeric py-2 pr-4 text-right">{pct(row.precision)}</td>
              <td className="numeric py-2 pr-4 text-right">{pct(row.recall)}</td>
              <td className="numeric py-2 pr-4 text-right">{pct(row.f1_score)}</td>
              <td className="numeric py-2 pr-4 text-right">{row.support}</td>
              <td className="numeric py-2 text-right">{pct(row.accuracy)}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <td className="py-2 pr-4 text-slate-900">Macro avg</td>
            <td className="numeric py-2 pr-4 text-right">{pct(grouped.precision_macro)}</td>
            <td className="numeric py-2 pr-4 text-right">{pct(grouped.recall_macro)}</td>
            <td className="numeric py-2 pr-4 text-right">{pct(grouped.f1_macro)}</td>
            <td className="numeric py-2 pr-4 text-right">{grouped.per_class['macro avg'].support}</td>
            <td className="py-2 text-right text-slate-500">unweighted mean</td>
          </tr>
          <tr className="bg-slate-50 font-semibold">
            <td className="py-2 pr-4 text-slate-900">Weighted avg</td>
            <td className="numeric py-2 pr-4 text-right">{pct(grouped.precision_weighted)}</td>
            <td className="numeric py-2 pr-4 text-right">{pct(grouped.recall_weighted)}</td>
            <td className="numeric py-2 pr-4 text-right">{pct(grouped.f1_weighted)}</td>
            <td className="numeric py-2 pr-4 text-right">{grouped.per_class['weighted avg'].support}</td>
            <td className="py-2 text-right text-slate-500">support weighted</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function ConfusionMatrix() {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-center text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white p-2 text-left text-slate-500">True \ Predicted</th>
            {labels.map((label) => (
              <th key={label} className="p-2 font-semibold text-slate-600">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((truth, rowIndex) => (
            <tr key={truth}>
              <th className="sticky left-0 bg-white p-2 text-left font-semibold text-slate-700">
                {truth}
              </th>
              {labels.map((prediction, columnIndex) => {
                const value = matrix[rowIndex][columnIndex]
                const rowPct = normalized[rowIndex][columnIndex]
                const highlighted = truth === 'normal' && prediction === 'sensor_fault'
                return (
                  <td
                    key={prediction}
                    className={`border border-slate-200 p-2 ${highlighted ? 'bg-amber-100 text-amber-950' : 'bg-white'}`}
                  >
                    <div className="numeric font-semibold">{value}</div>
                    <div className="numeric text-[11px] text-slate-500">{pct(rowPct)}</div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RocChart() {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={anomaly.roc_curve} margin={{ top: 12, right: 28, bottom: 24, left: 4 }}>
          <CartesianGrid stroke="#e1e0d9" />
          <XAxis
            dataKey="fpr"
            type="number"
            domain={[0, 1]}
            tickFormatter={(value) => pct(Number(value), 0)}
            label={{ value: 'False positive rate', position: 'insideBottom', offset: -12 }}
          />
          <YAxis
            dataKey="tpr"
            type="number"
            domain={[0, 1]}
            tickFormatter={(value) => pct(Number(value), 0)}
          />
          <Tooltip
            formatter={(value) => (typeof value === 'number' ? pct(value) : String(value ?? ''))}
            labelFormatter={() => 'ROC point'}
          />
          <Line type="monotone" dataKey="tpr" name="TPR" stroke="#2a78d6" dot={false} strokeWidth={2} />
          <ReferenceDot
            x={rocPoint.fpr}
            y={rocPoint.tpr}
            r={5}
            fill="#eb6834"
            stroke="#7c2d12"
            label={{ value: 'threshold 0.55', position: 'top', fill: '#7c2d12', fontSize: 11 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SeverityTable() {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {metrics.severity_accuracy.map((row) => (
        <div key={row.severity} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">severity {row.severity.toFixed(1)}</p>
          <p className="numeric mt-2 text-2xl font-semibold text-slate-900">{pct(row.accuracy)}</p>
          <p className="mt-1 text-xs text-slate-500">support {row.support}</p>
        </div>
      ))}
    </div>
  )
}

export function ModelPerformance() {
  return (
    <div className="space-y-5">
      <PageHeading
        title="Model Performance"
        description="Held-out classifier and anomaly-detector evidence. The page shows the boundary conditions and failure modes, not just favourable headline metrics."
      />

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label="Grouped accuracy" value={pct(grouped.accuracy, 2)} unit="held-out runs" />
        <StatTile label="Macro F1" value={pct(grouped.f1_macro, 2)} unit="unweighted" />
        <StatTile label="Anomaly ROC AUC" value={num(anomaly.roc_auc, 4)} unit="Isolation Forest" />
        <StatTile label="normal -> sensor_fault" value={`${normalSensorFault.count}`} unit={pct(normalSensorFault.percent)} />
      </div>

      <Card
        title="Confusion matrix"
        subtitle="Rows are true classes and columns are predicted classes. Each cell shows count and row-normalised percentage."
      >
        <ConfusionMatrix />
      </Card>

      <Card
        title="Classification metrics"
        subtitle="Grouped accuracy is one global held-out score. Per-class accuracy is the diagonal cell divided by that class support, so it exposes which class is failing."
      >
        <ClassificationTable />
      </Card>

      <Card title="Anomaly detector" subtitle="Isolation Forest trained on normal rows only, evaluated against held-out normal vs fault rows.">
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <RocChart />
          <div className="space-y-3">
            <StatusBadge status={{ tone: 'warn', label: 'threshold shown', detail: 'The 0.55 operating point is marked on the ROC curve.' }} />
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase">Threshold 0.55</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">TPR</dt>
                <dd className="numeric text-right font-semibold">{pct(threshold.tpr)}</dd>
                <dt className="text-slate-500">FPR</dt>
                <dd className="numeric text-right font-semibold">{pct(threshold.fpr)}</dd>
                <dt className="text-slate-500">TP / FP</dt>
                <dd className="numeric text-right font-semibold">{threshold.tp} / {threshold.fp}</dd>
                <dt className="text-slate-500">TN / FN</dt>
                <dd className="numeric text-right font-semibold">{threshold.tn} / {threshold.fn}</dd>
              </dl>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Accuracy by injected severity" subtitle="Low severity is where early prediction would matter most, and the model is least reliable there.">
        <SeverityTable />
      </Card>

      <Card title="Limitations" subtitle="These statements are part of the evidence, not a disclaimer hidden away from the score.">
        <div className="space-y-3">
          {metrics.limitations.map((item) => (
            <div key={item} className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </Card>

      <ProvenanceNote>
        Generated at {metrics.generated_at}. Training rows {metrics.dataset.train_rows}, held-out rows {metrics.dataset.test_rows}. {metrics.caveat}
      </ProvenanceNote>
    </div>
  )
}

