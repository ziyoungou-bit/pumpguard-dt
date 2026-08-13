"""Why the model said that.

Two questions, two answers.

*Which measurements does this model rely on in general?* -- the forest's built-in
Gini importances, averaged over its trees.

*Why this frame, specifically?* -- the contribution of each feature to this one
prediction, computed by walking the decision path of every tree and attributing
the change in class proportion at each split to the feature that made the split.
Summed over the path and averaged over the forest, the contributions plus the
forest's base rate reconstruct the predicted probability exactly, so the
explanation is an identity rather than an approximation:

    P(class | x) = base_rate(class) + sum_over_features contribution(feature)

This is the Saabas method used by the `treeinterpreter` package, reimplemented
here in about thirty lines against the public `decision_path` API. That is a
deliberate choice not to add a dependency: SHAP would give theoretically better
(Shapley-consistent) attributions, but it is a heavy dependency with its own
compiled extensions, and for a forest of axis-aligned splits the path
decomposition answers "why this diagnosis" perfectly well.

Global importances carry the usual caveat and it is repeated in every payload:
impurity importance is biased toward high-cardinality continuous features and
says what the model uses, not what causes the fault.
"""

from __future__ import annotations

import numpy as np

from ..contracts import FEATURE_ORDER, Telemetry
from .inference import InferenceService, feature_vector, get_service


def feature_importance(
    service: InferenceService | None = None, top_n: int | None = None
) -> dict[str, float]:
    """Global impurity importance per feature, largest first.

    Returns an empty mapping in physics-only mode; callers must handle that
    rather than assume a model is loaded.
    """
    service = service or get_service()
    if service.classifier is None:
        return {}
    importances = np.asarray(service.classifier.estimator.feature_importances_, dtype=float)
    ranked = sorted(
        zip(FEATURE_ORDER, importances), key=lambda item: item[1], reverse=True
    )
    if top_n is not None:
        ranked = ranked[:top_n]
    return {name: float(value) for name, value in ranked}


def prediction_contributions(
    telemetry: Telemetry,
    service: InferenceService | None = None,
    target_class: str | None = None,
    top_n: int | None = 6,
) -> dict[str, float]:
    """Per-feature contribution to this frame's predicted probability.

    Positive values pushed the probability of `target_class` (the predicted
    class by default) up, negative values pushed it down. The magnitudes are
    probability, so they can be read directly: +0.30 on `amplitude_1x_mm_s`
    means that feature supplied thirty points of the final probability.
    """
    service = service or get_service()
    if service.classifier is None:
        return {}

    forest = service.classifier.estimator
    classes = list(service.classifier.classes)
    if target_class is None:
        target_class = service.predict(telemetry)[0]
    if target_class not in classes:
        return {}
    class_index = classes.index(target_class)

    row = feature_vector(telemetry).reshape(1, -1)
    contributions = np.zeros(len(FEATURE_ORDER), dtype=float)
    for tree in forest.estimators_:
        contributions += _tree_contributions(tree, row, class_index)
    contributions /= len(forest.estimators_)

    ranked = sorted(
        zip(FEATURE_ORDER, contributions), key=lambda item: abs(item[1]), reverse=True
    )
    if top_n is not None:
        ranked = ranked[:top_n]
    return {name: float(value) for name, value in ranked}


def _tree_contributions(tree, row: np.ndarray, class_index: int) -> np.ndarray:
    """Saabas path decomposition for one tree.

    At every internal node on the path, the class proportion changes from the
    node's value to the chosen child's value. That change is attributed to the
    feature the node split on.
    """
    structure = tree.tree_
    path = tree.decision_path(row)
    nodes = path.indices[path.indptr[0] : path.indptr[1]]

    contributions = np.zeros(len(FEATURE_ORDER), dtype=float)
    for parent, child in zip(nodes[:-1], nodes[1:]):
        feature = structure.feature[parent]
        if feature < 0:  # a leaf has no split feature
            continue
        contributions[feature] += _proportion(structure, child, class_index) - _proportion(
            structure, parent, class_index
        )
    return contributions


def _proportion(structure, node: int, class_index: int) -> float:
    """Proportion of `class_index` at a node.

    Normalised defensively: scikit-learn stores class fractions in `value` from
    1.3 onward and weighted counts before that, and this must be right under
    either, because a silently unnormalised value would scale every contribution
    by the node's sample count.
    """
    values = structure.value[node][0]
    total = float(values.sum())
    if total <= 0.0:
        return 0.0
    return float(values[class_index]) / total


IMPORTANCE_CAVEAT = (
    "Impurity-based importance: it reports which measurements this forest splits on, "
    "not which quantity physically causes the fault, and it is biased toward continuous "
    "features with many distinct values."
)

CONTRIBUTION_BASIS = (
    "Decision-path contribution (Saabas): the probability this feature's splits added to or "
    "removed from the prediction for this frame. Contributions plus the forest's base rate "
    "equal the predicted probability exactly. It explains the model's reasoning, not the "
    "machine's physics."
)


__all__ = [
    "CONTRIBUTION_BASIS",
    "IMPORTANCE_CAVEAT",
    "feature_importance",
    "prediction_contributions",
]
