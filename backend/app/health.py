"""Visitor-facing health index.

This module is the Python counterpart of `frontend/src/lib/health.ts`. The
front end owns the rendered breakdown, but the backend must score the same
telemetry the same way for API fallback and ML diagnosis payloads.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config.alarm_thresholds import ALARM_LIMITS, VIBRATION
from .config.pump_parameters import PUMP
from .contracts import AssetState, Telemetry

NPSH_MARGIN_GUIDELINE_M = next(limit for limit in ALARM_LIMITS if limit.key == "npsh_margin_low").alarm
BEARING_TEMPERATURE_LIMIT_C = next(
    limit for limit in ALARM_LIMITS if limit.key == "bearing_temperature_high"
).alarm
EFFICIENCY_PENALTY_ONSET_FRACTION = 0.89


@dataclass(frozen=True)
class HealthTerm:
    label: str
    penalty: float


@dataclass(frozen=True)
class HealthBreakdown:
    terms: tuple[HealthTerm, ...]
    health: float
    scored: bool
    guard: str | None


def health_breakdown(telemetry: Telemetry) -> HealthBreakdown:
    """The transparent penalty sum used for visitor-facing health."""
    if telemetry.asset_state != AssetState.RUNNING.value:
        return HealthBreakdown(
            terms=(),
            health=100.0,
            scored=False,
            guard="Health is not scored unless the asset is RUNNING (stopped guard).",
        )

    efficiency_fraction = (
        telemetry.pump_efficiency / PUMP.bep_efficiency if PUMP.bep_efficiency > 0.0 else 0.0
    )
    terms = (
        HealthTerm("Vibration", vibration_health_penalty(telemetry.vibration_rms_mm_s)),
        HealthTerm(
            "Efficiency",
            max(0.0, (EFFICIENCY_PENALTY_ONSET_FRACTION - efficiency_fraction) * 37.0),
        ),
        HealthTerm(
            "NPSH margin",
            (
                (NPSH_MARGIN_GUIDELINE_M - telemetry.npsh_margin_m) * 14.0
                if telemetry.npsh_margin_m < NPSH_MARGIN_GUIDELINE_M
                else 0.0
            ),
        ),
        HealthTerm(
            "Bearing temperature",
            max(0.0, (telemetry.bearing_temperature_c - BEARING_TEMPERATURE_LIMIT_C) * 1.4),
        ),
    )
    total = sum(term.penalty for term in terms)
    return HealthBreakdown(
        terms=terms,
        health=max(5.0, min(100.0, 100.0 - total)),
        scored=True,
        guard=None,
    )


def health_index(telemetry: Telemetry, anomaly_score: float = 0.0) -> float:
    _ = anomaly_score
    return health_breakdown(telemetry).health


def health_terms(telemetry: Telemetry, anomaly_score: float = 0.0) -> dict[str, float]:
    _ = anomaly_score
    return {term.label: term.penalty for term in health_breakdown(telemetry).terms}


def vibration_health_penalty(rms_mm_s: float) -> float:
    rms = max(0.0, float(rms_mm_s))
    in_zone_a = min(rms, VIBRATION.zone_a_b_mm_s)
    in_zone_b = min(max(rms - VIBRATION.zone_a_b_mm_s, 0.0), VIBRATION.zone_b_c_mm_s - VIBRATION.zone_a_b_mm_s)
    in_zone_c = min(max(rms - VIBRATION.zone_b_c_mm_s, 0.0), VIBRATION.zone_c_d_mm_s - VIBRATION.zone_b_c_mm_s)
    in_zone_d = max(rms - VIBRATION.zone_c_d_mm_s, 0.0)
    return 4.0 * in_zone_a + 11.0 * in_zone_b + 22.0 * in_zone_c + 40.0 * in_zone_d


def severity_label(index: float) -> str:
    if index >= 85.0:
        return "none"
    if index >= 65.0:
        return "minor"
    if index >= 40.0:
        return "moderate"
    return "severe"


__all__ = [
    "HealthBreakdown",
    "HealthTerm",
    "health_breakdown",
    "health_index",
    "health_terms",
    "severity_label",
    "vibration_health_penalty",
]
