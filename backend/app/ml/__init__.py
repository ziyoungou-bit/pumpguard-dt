"""Machine-learning layer: dataset generation, training, serving, diagnosis.

Four modules with one direction of dependency:

    dataset.py    drives the simulator to produce labelled training data
        |             (offline; imports app.simulation)
        v
    train.py      fits and persists the artefacts   (offline; run as __main__)
        |
        v
    inference.py  loads the artefacts and predicts  (online; no simulator)
        |
        v
    diagnosis.py  physics rules + model -> contracts.Diagnosis
    explain.py    feature importance and per-prediction contributions

Nothing in this package trains on import. `inference` loads persisted artefacts
and, if they are absent, degrades to a physics-only mode so the API still boots.

Only `inference` and `diagnosis` are re-exported here: they are the serving
surface the API layer needs. `dataset` and `train` are offline tools and pull
the whole simulator in, so they are imported by path when they are wanted.
"""

from __future__ import annotations

from .diagnosis import diagnose, health_index
from .explain import feature_importance, prediction_contributions
from .inference import (
    FeatureOrderMismatch,
    InferenceService,
    feature_vector,
    get_service,
)

__all__ = [
    "FeatureOrderMismatch",
    "InferenceService",
    "diagnose",
    "feature_importance",
    "feature_vector",
    "get_service",
    "health_index",
    "prediction_contributions",
]
