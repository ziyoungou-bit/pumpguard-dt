"""Project model-performance metrics into the frontend.

The Model Performance page is evidence, not marketing copy. It must render
numbers produced from the fitted artefacts and held-out dataset, so this script
loads backend/models/metrics.json and emits a TypeScript generated file. The
paired backend test runs this script with --check so model or dataset changes
cannot leave a stale page behind.

Usage:
    python scripts/export_model_performance.py
    python scripts/export_model_performance.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = REPO_ROOT / "backend" / "models"
DATA_DIR = REPO_ROOT / "backend" / "data"
METRICS_PATH = MODEL_DIR / "metrics.json"
OUTPUT_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "modelPerformance.generated.ts"

HEADER = """/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Projected from backend/models/metrics.json by
 * scripts/export_model_performance.py. Re-run that script after retraining or
 * regenerating the held-out metrics.
 */

"""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _assert_source_hashes_are_current(metrics: dict[str, Any]) -> None:
    expected = metrics.get("source_hashes")
    if not isinstance(expected, dict):
        raise RuntimeError("metrics.json has no source_hashes; rerun app.ml.train")
    actual = {
        "classifier_sha256": _sha256(MODEL_DIR / "fault_classifier.joblib"),
        "anomaly_sha256": _sha256(MODEL_DIR / "anomaly_detector.joblib"),
        "dataset_sha256": _sha256(DATA_DIR / "training_dataset.csv"),
        "dataset_meta_sha256": _sha256(DATA_DIR / "training_dataset_meta.json"),
    }
    if actual != expected:
        raise RuntimeError(
            "model or held-out dataset changed; rerun app.ml.train before exporting performance metrics"
        )


def _json_for_ts(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)


def render(validate_sources: bool = False) -> str:
    metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8-sig"))
    if validate_sources:
        _assert_source_hashes_are_current(metrics)
    return HEADER + "export const MODEL_PERFORMANCE = " + _json_for_ts(metrics) + " as const\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="exit 1 if the generated file is stale")
    args = parser.parse_args()

    try:
        rendered = render(validate_sources=args.check)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.check:
        current = OUTPUT_PATH.read_text(encoding="utf-8") if OUTPUT_PATH.exists() else ""
        if current != rendered:
            print(
                f"{OUTPUT_PATH.relative_to(REPO_ROOT)} is stale.\n"
                "Run: python scripts/export_model_performance.py",
                file=sys.stderr,
            )
            return 1
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

