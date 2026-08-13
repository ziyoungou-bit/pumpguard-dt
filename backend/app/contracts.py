"""THE frozen contract between every module and the frontend.

Read this before writing anything that crosses a module boundary.

Field names here are the field names on the wire, in the database, and in the
React types. No module may rename, nest or "improve" them locally. If a producer
calls it `flow_lpm` and a consumer reads `flow_rate`, the consumer gets
`undefined`, the chart draws nothing, and nothing anywhere raises an error --
which is exactly how a contract drift becomes a silent product failure.

Units are in the field name wherever there is any doubt. There is no field whose
unit has to be guessed.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

SCHEMA_VERSION = "1.0.0"


class AssetState(str, Enum):
    """SCADA state machine. Only these values ever appear in `asset_state`."""

    OFF = "OFF"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    STOPPING = "STOPPING"
    FAULT = "FAULT"
    E_STOP = "E_STOP"
    MAINTENANCE = "MAINTENANCE"


class FaultType(str, Enum):
    """Conditions the simulator can produce and the classifier can predict.

    These strings are the ML class labels, the API values and the UI keys. One
    vocabulary, so a model trained on `flow_restriction` cannot be served to a
    UI expecting `blockage`.
    """

    NORMAL = "normal"
    IMBALANCE = "imbalance"
    MISALIGNMENT = "misalignment"
    FLOW_RESTRICTION = "flow_restriction"
    CAVITATION = "cavitation"
    DRY_RUN = "dry_run"
    SENSOR_FAULT = "sensor_fault"


class SensorQuality(str, Enum):
    GOOD = "GOOD"
    UNCERTAIN = "UNCERTAIN"
    BAD = "BAD"


class AlarmSeverity(str, Enum):
    WARNING = "WARNING"
    ALARM = "ALARM"
    TRIP = "TRIP"
    CRITICAL = "CRITICAL"


class DataSource(str, Enum):
    """Shown prominently in the UI. A recruiter must never be led to believe
    simulated data came off real plant."""

    SIMULATION = "SIMULATION"
    RECORDED = "RECORDED"
    LIVE_DEVICE = "LIVE_DEVICE"


@dataclass
class Telemetry:
    """One simulation tick. This is the payload on /ws/realtime.

    Every field is a real engineering quantity with a unit. Nothing is a
    decorative number: each one is either measured by a modelled sensor or
    derived from the pump/motor physics.
    """

    timestamp: str  # ISO 8601 UTC
    elapsed_s: float

    # --- process values ---------------------------------------------------
    rpm: float  # RPM-101, rev/min
    flow_lpm: float  # FT-101, litres/min
    pump_head_m: float  # derived, metres of water
    suction_pressure_kpa: float  # PT-101, kPa absolute
    discharge_pressure_kpa: float  # PT-102, kPa absolute
    differential_pressure_kpa: float  # PT-102 - PT-101
    motor_current_a: float  # CT-101, amperes
    motor_temperature_c: float  # TT-101, degrees Celsius
    bearing_temperature_c: float  # TT-102, degrees Celsius

    # --- vibration (ACC-101), mm/s unless stated --------------------------
    vibration_x_mm_s: float
    vibration_y_mm_s: float
    vibration_z_mm_s: float
    vibration_rms_mm_s: float
    vibration_peak_mm_s: float
    crest_factor: float  # dimensionless
    amplitude_1x_mm_s: float  # at rotational frequency
    amplitude_2x_mm_s: float  # at twice rotational frequency
    high_frequency_energy: float  # mm/s, band energy above hf cut-off
    dominant_frequency_hz: float
    rotational_frequency_hz: float  # rpm / 60

    # --- performance ------------------------------------------------------
    pump_efficiency: float  # 0..1
    hydraulic_power_w: float
    shaft_power_w: float
    electrical_power_w: float

    # --- condition --------------------------------------------------------
    health_index: float  # 0..100, 100 = healthy
    anomaly_score: float  # 0..1, higher = more anomalous
    fault_state: str  # FaultType value: the TRUE injected state
    severity: float  # 0..1, injected severity
    asset_state: str  # AssetState value
    npsh_margin_m: float  # NPSHa - NPSHr; negative implies cavitation

    # --- provenance -------------------------------------------------------
    data_source: str = DataSource.SIMULATION.value
    sensor_quality: dict[str, str] = field(default_factory=dict)  # tag -> SensorQuality
    schema_version: str = SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DiagnosisEvidence:
    """One piece of reasoning behind a diagnosis, physics or model derived."""

    source: str  # "physics" | "model"
    statement: str
    measured_value: float | None = None
    unit: str = ""
    reference: str = ""  # threshold or baseline it was compared against


@dataclass
class Diagnosis:
    """Never just a label.

    A bare class name is not a diagnosis an engineer can act on or challenge.
    The physics evidence and the model evidence are kept separate so a reader
    can see where the two agree and where only the model is asserting something.
    """

    detected_condition: str  # FaultType value
    confidence: float  # 0..1, from the classifier
    health_index: float  # 0..100
    severity_label: str  # "none" | "minor" | "moderate" | "severe"
    physics_evidence: list[DiagnosisEvidence] = field(default_factory=list)
    model_evidence: list[DiagnosisEvidence] = field(default_factory=list)
    feature_importance: dict[str, float] = field(default_factory=dict)
    recommended_actions: list[str] = field(default_factory=list)
    anomaly_score: float = 0.0
    is_sensor_fault: bool = False
    # True when the classifier and the physics rules disagree; surfaced in the
    # UI rather than hidden, because disagreement is information.
    physics_model_conflict: bool = False
    schema_version: str = SCHEMA_VERSION


@dataclass
class Alarm:
    id: int
    timestamp: str
    tag: str  # e.g. "PT-101"
    description: str
    severity: str  # AlarmSeverity value
    value: float
    threshold: float
    unit: str
    state: str  # "ACTIVE" | "CLEARED"
    acknowledged: bool = False
    acknowledged_at: str = ""


#: The exact feature vector the ML model consumes, in this order.
#: Training and inference both import this list. A model trained on a different
#: order than it is served with produces confident nonsense and no error.
FEATURE_ORDER: tuple[str, ...] = (
    "rpm",
    "flow_lpm",
    "pump_head_m",
    "suction_pressure_kpa",
    "differential_pressure_kpa",
    "motor_current_a",
    "motor_temperature_c",
    "bearing_temperature_c",
    "vibration_rms_mm_s",
    "vibration_peak_mm_s",
    "crest_factor",
    "amplitude_1x_mm_s",
    "amplitude_2x_mm_s",
    "high_frequency_energy",
    "pump_efficiency",
    "npsh_margin_m",
)

#: Class order for the classifier, so probabilities can be mapped back reliably.
FAULT_CLASSES: tuple[str, ...] = tuple(f.value for f in FaultType)
