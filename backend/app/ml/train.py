"""Offline training. Run as `python -m app.ml.train --output models`.

Nothing here executes on import: the Dockerfile runs this module once at image
build time and the running service only loads what it wrote.

The one decision in this file worth arguing about is the train/test split.

**The split is by simulation run, not by row.** Every run contributes about two
dozen frames sampled a second apart from one machine, at one operating point,
with one noise stream and one slowly-drifting thermal state. Those frames are
near-duplicates. Split them at random and almost every test row has a
near-identical twin in the training set, so the reported score measures memory,
not generalisation. Grouping by `run_id` puts a whole run on one side of the
boundary, which is the same reason a medical model is split by patient and not
by scan. `StratifiedGroupKFold` does both halves of the job: groups by run,
stratifies by class.

To make the difference concrete rather than assert it, the same forest is also
fitted on a random *row* split and its inflated accuracy is recorded in
`metrics.json` under `leakage_check`. That number is there to be disbelieved,
not quoted.

Everything measured here is measured on data from a physics simulator. It says
how well the model separates conditions this simulator produces. It is not an
industrial accuracy claim and must never be presented as one.
"""

from __future__ import annotations

import argparse
import hashlib
import math
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import StratifiedGroupKFold, train_test_split

from ..contracts import FEATURE_ORDER, FAULT_CLASSES, FaultType
from . import dataset as dataset_module
from .inference import (
    ANOMALY_FILENAME,
    CLASSIFIER_FILENAME,
    MODEL_CARD_FILENAME,
    DEFAULT_MODEL_DIR,
    ModelBundle,
)

METRICS_FILENAME = "metrics.json"

def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


#: Fixed so a rebuild of the image produces the same model as the last one.
RANDOM_STATE: int = 20260812

#: Enough trees that the vote is stable and the feature importances do not move
#: between runs; depth left unbounded because the classes are separated by
#: threshold combinations (1x high AND 2x low) that a shallow tree cannot cut.
#: `class_weight="balanced"` because the interlocks make cavitation and
#: sensor-fault runs short, so their row counts stay below the healthy classes'
#: however many runs are scheduled.
CLASSIFIER_PARAMS: dict = {
    "n_estimators": 300,
    "max_depth": None,
    "min_samples_leaf": 2,
    "class_weight": "balanced",
    "n_jobs": -1,
    "random_state": RANDOM_STATE,
}

#: Trained on healthy rows only. An anomaly detector fitted on the faults it is
#: meant to flag has already been told what a fault looks like, and cannot then
#: flag the condition nobody thought to simulate -- which is the entire reason
#: for having an unsupervised detector beside a supervised classifier.
ANOMALY_PARAMS: dict = {
    "n_estimators": 200,
    #: The healthy class is genuinely clean here (it is generated healthy), so
    #: the contamination assumption is set low rather than left to "auto".
    "contamination": 0.02,
    "random_state": RANDOM_STATE,
    "n_jobs": -1,
}

#: Fraction of runs held out. 4 folds of StratifiedGroupKFold, first fold tested.
N_SPLITS: int = 4


# --------------------------------------------------------------------------
# Split
# --------------------------------------------------------------------------


def split_by_run(frame: pd.DataFrame, n_splits: int = N_SPLITS) -> tuple[np.ndarray, np.ndarray]:
    """Row indices for train and test, grouped by run and stratified by class."""
    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_STATE)
    train_index, test_index = next(
        splitter.split(frame[list(FEATURE_ORDER)], frame["label"], groups=frame["run_id"])
    )
    return train_index, test_index


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------


def _present_classes(*label_arrays: np.ndarray) -> list[str]:
    """Class order for reports: FAULT_CLASSES order, restricted to what is present."""
    seen = set()
    for labels in label_arrays:
        seen.update(str(value) for value in labels)
    return [name for name in FAULT_CLASSES if name in seen]


def evaluate(y_true: np.ndarray, y_predicted: np.ndarray) -> dict:
    """Headline scores, per-class scores and the confusion matrix."""
    labels = _present_classes(y_true, y_predicted)
    matrix = confusion_matrix(y_true, y_predicted, labels=labels)
    report = classification_report(
        y_true, y_predicted, labels=labels, output_dict=True, zero_division=0
    )
    per_class_rows: list[dict[str, float | int | str]] = []
    for index, label in enumerate(labels):
        support = int(matrix[index].sum())
        correct = int(matrix[index, index])
        scores = report[label]
        per_class_rows.append(
            {
                "label": label,
                "precision": float(scores["precision"]),
                "recall": float(scores["recall"]),
                "f1_score": float(scores["f1-score"]),
                "support": support,
                "accuracy": float(correct / support) if support else 0.0,
            }
        )
    return {
        "accuracy": float(accuracy_score(y_true, y_predicted)),
        "precision_macro": float(precision_score(y_true, y_predicted, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_true, y_predicted, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_true, y_predicted, average="macro", zero_division=0)),
        "precision_weighted": float(
            precision_score(y_true, y_predicted, average="weighted", zero_division=0)
        ),
        "recall_weighted": float(recall_score(y_true, y_predicted, average="weighted", zero_division=0)),
        "f1_weighted": float(f1_score(y_true, y_predicted, average="weighted", zero_division=0)),
        "per_class": report,
        "per_class_accuracy": per_class_rows,
        "confusion_matrix": {
            "labels": labels,
            "rows_are_true": True,
            "matrix": matrix.tolist(),
            "row_normalized": [
                [float(value / row.sum()) if row.sum() else 0.0 for value in row]
                for row in matrix
            ],
        },
    }



def _roc_curve_points(
    fpr: np.ndarray,
    tpr: np.ndarray,
    thresholds: np.ndarray,
    max_points: int = 160,
) -> list[dict[str, float]]:
    """Enough ROC points to render the curve without checking in thousands of rows."""
    total = len(fpr)
    if total <= max_points:
        selected = range(total)
    else:
        selected = sorted({0, total - 1, *np.linspace(0, total - 1, max_points - 2, dtype=int)})
    return [
        {"fpr": float(fpr[index]), "tpr": float(tpr[index]), "threshold": float(thresholds[index])}
        for index in selected
    ]

def _severity_bucket(value: float) -> float:
    """Round injected severity to the nearest 0.2 bucket used in the page."""
    return min(1.0, max(0.0, math.floor(value * 5.0 + 0.5) / 5.0))


def _severity_accuracy(severity: np.ndarray, y_true: np.ndarray, y_pred: np.ndarray) -> list[dict]:
    buckets = [round(index / 5.0, 1) for index in range(6)]
    bucketed = np.asarray([_severity_bucket(float(value)) for value in severity], dtype=float)
    rows: list[dict] = []
    for bucket in buckets:
        mask = bucketed == bucket
        support = int(mask.sum())
        correct = int((y_true[mask] == y_pred[mask]).sum()) if support else 0
        rows.append(
            {
                "severity": float(bucket),
                "accuracy": float(correct / support) if support else 0.0,
                "support": support,
            }
        )
    return rows


def print_metrics(metrics: dict) -> None:
    """Human-readable summary, printed by the build so the log carries the score."""
    grouped = metrics["grouped_split"]
    print("\n=== Fault classifier, split by simulation run ===")
    print(f"  train rows {metrics['dataset']['train_rows']}  test rows {metrics['dataset']['test_rows']}")
    print(f"  accuracy   {grouped['accuracy']:.4f}")
    print(
        f"  macro      precision {grouped['precision_macro']:.4f}  "
        f"recall {grouped['recall_macro']:.4f}  F1 {grouped['f1_macro']:.4f}"
    )
    print("\n  per class:")
    print(f"    {'class':18s} {'precision':>9s} {'recall':>9s} {'f1':>9s} {'support':>8s}")
    for name in grouped["confusion_matrix"]["labels"]:
        scores = grouped["per_class"][name]
        print(
            f"    {name:18s} {scores['precision']:9.4f} {scores['recall']:9.4f} "
            f"{scores['f1-score']:9.4f} {int(scores['support']):8d}"
        )

    print("\n  confusion matrix (rows = true, columns = predicted):")
    labels = grouped["confusion_matrix"]["labels"]
    print(f"    {'':18s}" + "".join(f"{name[:8]:>9s}" for name in labels))
    for name, row in zip(labels, grouped["confusion_matrix"]["matrix"]):
        print(f"    {name:18s}" + "".join(f"{value:9d}" for value in row))

    leakage = metrics["leakage_check"]
    print(
        f"\n  leakage check: random ROW split accuracy {leakage['row_split_accuracy']:.4f} "
        f"vs grouped {grouped['accuracy']:.4f} "
        f"(+{leakage['inflation']:.4f} of pure leakage; the grouped number is the real one)"
    )

    anomaly = metrics["anomaly_detector"]
    print("\n=== Anomaly detector (isolation forest, healthy rows only) ===")
    print(
        f"  normalised score  healthy mean {anomaly['healthy_mean_score']:.4f}  "
        f"faulty mean {anomaly['faulty_mean_score']:.4f}  ROC AUC {anomaly['roc_auc']:.4f}"
    )
    print("\n  Measured on SYNTHETIC simulator data only. Not an industrial accuracy claim.\n")


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------


def train(
    output_dir: Path | str = DEFAULT_MODEL_DIR,
    data_dir: Path | str = dataset_module.DEFAULT_DATA_DIR,
    reuse_dataset: bool = False,
) -> dict:
    """Generate (or reuse) the dataset, fit both models, persist everything."""
    if reuse_dataset:
        frame, data_metadata = dataset_module.load_dataset(data_dir)
        print(f"reusing dataset at {Path(data_dir) / dataset_module.DATASET_FILENAME}")
    else:
        print("generating dataset from the simulator ...")
        frame, data_metadata = dataset_module.generate(data_dir)

    print(f"dataset: {len(frame)} rows from {frame['run_id'].nunique()} runs")
    for label, count in sorted(data_metadata["class_counts"].items()):
        print(f"  {label:18s} {count:6d} rows")

    features = frame[list(FEATURE_ORDER)].to_numpy(dtype=float)
    labels = frame["label"].to_numpy(dtype=object)

    train_index, test_index = split_by_run(frame)
    x_train, x_test = features[train_index], features[test_index]
    y_train, y_test = labels[train_index], labels[test_index]
    severity_test = frame.iloc[test_index]["severity"].to_numpy(dtype=float)

    classifier = RandomForestClassifier(**CLASSIFIER_PARAMS).fit(x_train, y_train)
    y_grouped_pred = classifier.predict(x_test)
    grouped_metrics = evaluate(y_test, y_grouped_pred)

    # The comparison the split argument rests on: identical model, identical
    # data, only the split changed.
    row_x_train, row_x_test, row_y_train, row_y_test = train_test_split(
        features, labels, test_size=len(test_index) / len(frame), random_state=RANDOM_STATE, stratify=labels
    )
    row_split_accuracy = float(
        accuracy_score(row_y_test, RandomForestClassifier(**CLASSIFIER_PARAMS).fit(row_x_train, row_y_train).predict(row_x_test))
    )

    anomaly_bundle, anomaly_metrics = _fit_anomaly_detector(x_train, y_train, x_test, y_test)

    metrics = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_is_synthetic": True,
        "caveat": (
            "All scores are measured on synthetic data produced by this project's own physics "
            "simulator. They describe how separable the simulated conditions are, not how the "
            "model would perform on a real pump. This is not an industrial accuracy claim."
        ),
        "dataset": {
            "rows": int(len(frame)),
            "runs": int(frame["run_id"].nunique()),
            "class_counts": data_metadata["class_counts"],
            "runs_per_class": data_metadata["runs_per_class_realised"],
            "train_rows": int(len(train_index)),
            "test_rows": int(len(test_index)),
            "train_runs": int(frame.iloc[train_index]["run_id"].nunique()),
            "test_runs": int(frame.iloc[test_index]["run_id"].nunique()),
        },
        "split": {
            "strategy": "StratifiedGroupKFold on run_id, stratified by class; fold 1 of 4 held out",
            "why": (
                "Frames inside one run are consecutive ticks of one machine at one operating "
                "point and are near-duplicates. A random row split puts near-identical twins on "
                "both sides and measures memorisation."
            ),
        },
        "grouped_split": grouped_metrics,
        "severity_accuracy": _severity_accuracy(severity_test, y_test, y_grouped_pred),
        "leakage_check": {
            "row_split_accuracy": row_split_accuracy,
            "grouped_split_accuracy": grouped_metrics["accuracy"],
            "inflation": row_split_accuracy - grouped_metrics["accuracy"],
            "note": "The row-split number is the leaked one. It is recorded to be disbelieved.",
        },
        "anomaly_detector": anomaly_metrics,
        "limitations": [
            "Training and test data both come from the same physics simulator, and the features are generated by the same equations. The classifier learns the simulator output distribution, not pump physics. These scores are capability ceilings, not field-performance predictions.",
            "Empirically, when the duty point changed from 20 L/min to 110 L/min, the original model predicted every frame in the new distribution as anomalous until retrained. A model that learned pump physics would not collapse that way under a pure operating-point shift.",
            "normal and sensor_fault overlap in feature space; the committed misdiagnosis rate remains 45%. Healthy operation can still be reported as sensor_fault.",
            "Fault Diagnosis currently uses browser-side physics rather than the backend classifier for the visible fallback because the classifier has this boundary.",
            "The physics_model_conflict flag exists to expose disagreement between physics evidence and model evidence instead of hiding it.",
        ],
    }

    _persist(output_dir, classifier, anomaly_bundle, metrics, data_metadata)
    print_metrics(metrics)
    return metrics


def _fit_anomaly_detector(
    x_train: np.ndarray, y_train: np.ndarray, x_test: np.ndarray, y_test: np.ndarray
) -> tuple[ModelBundle, dict]:
    """Isolation forest on the healthy training rows, plus its 0..1 calibration."""
    healthy = y_train == FaultType.NORMAL.value
    detector = IsolationForest(**ANOMALY_PARAMS).fit(x_train[healthy])

    healthy_scores = detector.decision_function(x_train[healthy])
    faulty_scores = detector.decision_function(x_train[~healthy])
    # Anchors for the 0..1 mapping: the healthy end is where all but the most
    # marginal healthy rows sit, the faulty end where all but the mildest faults
    # sit. Percentiles rather than min/max so one outlying row cannot set the
    # whole scale.
    reference = (float(np.percentile(healthy_scores, 95)), float(np.percentile(faulty_scores, 5)))

    span = reference[0] - reference[1]
    normalised = np.clip((reference[0] - detector.decision_function(x_test)) / span, 0.0, 1.0)
    is_fault = (y_test != FaultType.NORMAL.value).astype(int)
    fpr, tpr, thresholds = roc_curve(is_fault, normalised)
    threshold = 0.55
    predicted_positive = (normalised >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(is_fault, predicted_positive, labels=[0, 1]).ravel()

    metrics = {
        "trained_on": "NORMAL rows of the training split only",
        "training_rows": int(healthy.sum()),
        "score_reference": {"healthy_end": reference[0], "faulty_end": reference[1]},
        "healthy_mean_score": float(normalised[is_fault == 0].mean()),
        "faulty_mean_score": float(normalised[is_fault == 1].mean()),
        "roc_auc": float(roc_auc_score(is_fault, normalised)),
        "roc_curve": _roc_curve_points(fpr, tpr, thresholds),
        "threshold_055": {
            "threshold": threshold,
            "tp": int(tp),
            "fp": int(fp),
            "tn": int(tn),
            "fn": int(fn),
            "tpr": float(tp / (tp + fn)) if (tp + fn) else 0.0,
            "fpr": float(fp / (fp + tn)) if (fp + tn) else 0.0,
        },
        "parameters": {key: value for key, value in ANOMALY_PARAMS.items()},
    }
    bundle = ModelBundle(
        estimator=detector,
        feature_order=tuple(FEATURE_ORDER),
        classes=(FaultType.NORMAL.value,),
        score_reference=reference,
    )
    return bundle, metrics


def _persist(
    output_dir: Path | str,
    classifier: RandomForestClassifier,
    anomaly_bundle: ModelBundle,
    metrics: dict,
    data_metadata: dict,
) -> None:
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)

    classifier_bundle = ModelBundle(
        estimator=classifier,
        feature_order=tuple(FEATURE_ORDER),
        classes=tuple(str(name) for name in classifier.classes_),
    )
    # Compressed: a 300-tree forest is 19 MB raw and 3.9 MB at level 3, with no
    # measurable difference in load time, and the artefact is copied into every
    # container image.
    classifier_path = target / CLASSIFIER_FILENAME
    anomaly_path = target / ANOMALY_FILENAME
    metrics_path = target / METRICS_FILENAME
    joblib.dump(classifier_bundle, classifier_path, compress=3)
    joblib.dump(anomaly_bundle, anomaly_path, compress=3)
    data_dir = Path(data_metadata.get("dataset_path", "data/training_dataset.csv")).parent
    dataset_path = data_dir / dataset_module.DATASET_FILENAME
    dataset_meta_path = data_dir / dataset_module.METADATA_FILENAME
    metrics["source_hashes"] = {
        "classifier_sha256": _sha256(classifier_path),
        "anomaly_sha256": _sha256(anomaly_path),
        "dataset_sha256": _sha256(dataset_path),
        "dataset_meta_sha256": _sha256(dataset_meta_path),
    }

    model_card = {
        "name": "PumpGuard DT fault classifier and anomaly detector",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "feature_order": list(FEATURE_ORDER),
        "class_order": list(classifier_bundle.classes),
        "contract_class_vocabulary": list(FAULT_CLASSES),
        "classifier": {"type": "RandomForestClassifier", "parameters": CLASSIFIER_PARAMS},
        "anomaly_detector": {
            "type": "IsolationForest",
            "parameters": ANOMALY_PARAMS,
            "trained_on": "NORMAL rows only",
            "score_reference": list(anomaly_bundle.score_reference or ()),
        },
        "split": metrics["split"],
        "headline_metrics": {
            "accuracy": metrics["grouped_split"]["accuracy"],
            "f1_macro": metrics["grouped_split"]["f1_macro"],
            "anomaly_roc_auc": metrics["anomaly_detector"]["roc_auc"],
        },
        "dataset_metadata": data_metadata,
        "library_versions": {
            "scikit-learn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "joblib": joblib.__version__,
        },
        "intended_use": (
            "Demonstration of a condition-monitoring pipeline on a simulated motor-pump set. "
            "Diagnostic support only: the physics rules in app.ml.diagnosis are reported "
            "separately and a disagreement between them and this model is surfaced, not hidden."
        ),
        "performance_is_on_synthetic_data_only": True,
        "limitations": [
            "Trained and evaluated exclusively on output from this project's own simulator. "
            "The reported scores are NOT an industrial accuracy claim and no statement about "
            "real-pump performance can be derived from them.",
            "The feature vector carries no control-valve position, so a legitimately throttled "
            "pump and a partly blocked line present very similar hydraulics.",
            "A frozen transmitter is not represented: it is only detectable across time, and "
            "this model sees one frame. Sensor quality flags cover it in app.ml.diagnosis.",
            "Vibration features come from the simulator's amplitude-domain estimate. If the "
            "signal-processing feature hook is attached to SimulationSession, the vibration "
            "feature distribution changes and this model must be retrained.",
        ],
    }
    (target / MODEL_CARD_FILENAME).write_text(json.dumps(model_card, indent=2), encoding="utf-8")
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"\nwrote artefacts to {target.resolve()}")


def _main() -> None:  # pragma: no cover - entry point
    parser = argparse.ArgumentParser(description="Train the PumpGuard DT fault models.")
    parser.add_argument("--output", default=str(DEFAULT_MODEL_DIR), help="directory for the artefacts")
    parser.add_argument(
        "--data", default=str(dataset_module.DEFAULT_DATA_DIR), help="directory for the dataset"
    )
    parser.add_argument(
        "--reuse-dataset",
        action="store_true",
        help="use the dataset already on disk instead of regenerating it",
    )
    args = parser.parse_args()
    train(args.output, args.data, args.reuse_dataset)


if __name__ == "__main__":  # pragma: no cover
    _main()


__all__ = ["CLASSIFIER_PARAMS", "ANOMALY_PARAMS", "evaluate", "split_by_run", "train"]

