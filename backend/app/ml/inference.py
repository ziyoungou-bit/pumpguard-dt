"""Serving: load the trained artefacts once, answer per request.

Three properties this module exists to guarantee.

**It never trains.** Training is a build step (see the Dockerfile). Training on
first request would add tens of seconds to a cold start and, worse, each process
would fit its own forest, so two instances would disagree about the same input.

**It never brings the backend down.** If the artefacts are missing -- the build's
training step failed, or someone is running from a fresh checkout -- the service
loads in physics-only mode. `is_available` is False, `predict` returns
`(None, 0.0, {})` and `diagnosis.py` falls back to its rules. A monitoring
product that refuses to boot because its model is missing is worse than one that
says so and keeps showing measurements.

**It never serves a model against the wrong columns.** A forest handed its
features in a different order does not raise: it produces confident nonsense,
indefinitely. So the feature order is persisted inside the artefact and checked
against `contracts.FEATURE_ORDER` on load, and a mismatch raises
`FeatureOrderMismatch` rather than being repaired or warned about.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from ..contracts import FEATURE_ORDER, Telemetry

DEFAULT_MODEL_DIR = Path("models")
CLASSIFIER_FILENAME = "fault_classifier.joblib"
ANOMALY_FILENAME = "anomaly_detector.joblib"
MODEL_CARD_FILENAME = "model_card.json"


class FeatureOrderMismatch(RuntimeError):
    """The persisted feature order is not `contracts.FEATURE_ORDER`.

    Raised loudly and never recovered from. The alternative -- reordering the
    incoming vector to match the model -- would silently serve a model trained
    on a different definition of the world.
    """


def feature_vector(telemetry: Telemetry) -> np.ndarray:
    """One telemetry frame as the model's input row, in `FEATURE_ORDER`.

    The single place a Telemetry becomes a feature vector, imported by the
    dataset generator and by serving alike, so training and inference cannot
    drift apart in column order or in dtype.
    """
    return np.asarray([getattr(telemetry, name) for name in FEATURE_ORDER], dtype=float)


@dataclass(frozen=True)
class ModelBundle:
    """A persisted estimator together with the contract it was fitted against."""

    estimator: Any
    feature_order: tuple[str, ...]
    classes: tuple[str, ...] = ()
    #: Decision-function values of the isolation forest at the healthy and the
    #: faulty end of the training data, used to normalise the anomaly score.
    #: Empty for the classifier bundle.
    score_reference: tuple[float, float] | None = None

    def validate(self) -> None:
        if tuple(self.feature_order) != tuple(FEATURE_ORDER):
            raise FeatureOrderMismatch(
                "persisted feature order does not match contracts.FEATURE_ORDER; "
                f"model was fitted on {tuple(self.feature_order)!r}, "
                f"the contract is {tuple(FEATURE_ORDER)!r}"
            )


class InferenceService:
    """Loaded artefacts plus the two questions the API asks of them.

    Construct once per process (`get_service()`), then call per request.
    """

    def __init__(self, model_dir: Path | str = DEFAULT_MODEL_DIR) -> None:
        self.model_dir = Path(model_dir)
        self.classifier: ModelBundle | None = None
        self.anomaly: ModelBundle | None = None
        self.load_error: str = ""
        self._load()

    # -- loading ----------------------------------------------------------

    def _load(self) -> None:
        classifier_path = self.model_dir / CLASSIFIER_FILENAME
        anomaly_path = self.model_dir / ANOMALY_FILENAME
        if not classifier_path.exists():
            self.load_error = f"no classifier at {classifier_path}; running physics-only"
            return

        # A FeatureOrderMismatch is deliberately not caught: a wrong-order model
        # is a defect, not a degraded mode, and must stop the deployment.
        bundle = joblib.load(classifier_path)
        bundle.validate()
        self.classifier = bundle

        if anomaly_path.exists():
            anomaly = joblib.load(anomaly_path)
            anomaly.validate()
            self.anomaly = anomaly
        else:
            self.load_error = f"no anomaly detector at {anomaly_path}; anomaly score unavailable"

    @property
    def is_available(self) -> bool:
        """True when a classifier is loaded and predictions are real."""
        return self.classifier is not None

    @property
    def classes(self) -> tuple[str, ...]:
        return self.classifier.classes if self.classifier else ()

    # -- prediction -------------------------------------------------------

    def predict(self, telemetry: Telemetry) -> tuple[str | None, float, dict[str, float]]:
        """Predicted condition, its probability, and the full class distribution.

        Returns `(None, 0.0, {})` in physics-only mode. Callers must handle that
        rather than assume a label is always available.
        """
        if self.classifier is None:
            return None, 0.0, {}
        probabilities = self.classifier.estimator.predict_proba(
            feature_vector(telemetry).reshape(1, -1)
        )[0]
        distribution = {
            str(name): float(value) for name, value in zip(self.classifier.classes, probabilities)
        }
        best = max(distribution, key=distribution.__getitem__)
        return best, distribution[best], distribution

    def anomaly_score(self, telemetry: Telemetry) -> float:
        """Unsupervised novelty, 0 = as healthy as the training normals, 1 = far outside.

        The isolation forest's decision function is unbounded and its units mean
        nothing to a reader, so it is mapped onto 0..1 against two references
        measured at training time: the healthy end is the 95th percentile of the
        decision function over training NORMAL rows, the faulty end is the 5th
        percentile over training FAULT rows. Both are stored in the artefact, so
        the mapping is a property of the fitted model and not a magic constant.
        """
        if self.anomaly is None or self.anomaly.score_reference is None:
            return 0.0
        healthy_end, faulty_end = self.anomaly.score_reference
        score = float(self.anomaly.estimator.decision_function(feature_vector(telemetry).reshape(1, -1))[0])
        span = healthy_end - faulty_end
        if span <= 0.0:
            return 0.0
        return float(np.clip((healthy_end - score) / span, 0.0, 1.0))


@lru_cache(maxsize=4)
def get_service(model_dir: str = str(DEFAULT_MODEL_DIR)) -> InferenceService:
    """The process-wide service. Cached, so the artefacts are read from disk once.

    Call it during API startup to pay the load cost before the first request;
    the cache makes every later call free.
    """
    return InferenceService(model_dir)


__all__ = [
    "ANOMALY_FILENAME",
    "CLASSIFIER_FILENAME",
    "DEFAULT_MODEL_DIR",
    "MODEL_CARD_FILENAME",
    "FeatureOrderMismatch",
    "InferenceService",
    "ModelBundle",
    "feature_vector",
    "get_service",
]
