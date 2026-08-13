"""Sensor models: what the instruments report, and how much to trust it.

The central idea of this module -- and one of the reasons the project exists --
is that **an instrumentation fault is not a machine fault**. A frozen flow
transmitter and a blocked line look similar on a trend and are completely
different problems: one needs a technician with a screwdriver, the other needs
the plant shut down. So the fault modes here sit strictly on the measurement
path. `Sensor.measure` takes the true process value and returns a reading; it
has no way to reach back into the physics, by construction.

Fault modes, all drawn from real transmitter failures:

    freeze   output sticks at its last value (dead scan, latched DAC)
    bias     constant offset (calibration lost, zero shifted)
    drift    offset growing with time (ageing element, fouling)
    noise    same mean, much larger variance (loose screen, EMI)
    dropout  intermittent loss of signal (broken loop, bad terminal)

Quality follows the reasoning in `config/sensor_parameters`: a degraded but
present signal is UNCERTAIN, a missing signal is BAD. Only BAD is allowed to
act on the process, through the invalid-sensor interlock.
"""

from __future__ import annotations

from enum import Enum

import numpy as np

from ..config.sensor_parameters import SENSORS, SensorSpec
from ..contracts import SensorQuality


class SensorFaultMode(str, Enum):
    NONE = "none"
    FREEZE = "freeze"
    BIAS = "bias"
    DRIFT = "drift"
    NOISE = "noise"
    DROPOUT = "dropout"


#: Modes an API caller may request.
INJECTABLE_MODES: tuple[str, ...] = tuple(m.value for m in SensorFaultMode if m is not SensorFaultMode.NONE)


class Sensor:
    """One modelled transmitter, with its own random stream and fault state."""

    def __init__(self, spec: SensorSpec, rng: np.random.Generator) -> None:
        self.spec = spec
        self._rng = rng
        self.mode = SensorFaultMode.NONE
        self.severity = 0.0
        self._last_output: float | None = None
        self._frozen_at: float | None = None
        self._drift = 0.0
        self._dropout_remaining_s = 0.0

    # -- fault injection --------------------------------------------------

    def arm(self, mode: str, severity: float = 1.0) -> None:
        try:
            resolved = SensorFaultMode(mode)
        except ValueError as exc:  # pragma: no cover - guarded by the API layer
            raise ValueError(f"unknown sensor fault mode {mode!r}; expected one of {INJECTABLE_MODES}") from exc
        self.mode = resolved
        self.severity = min(max(float(severity), 0.0), 1.0)
        self._drift = 0.0
        self._dropout_remaining_s = 0.0
        # Freeze latches whatever the instrument last reported; if it has not
        # read yet it will latch on the next measurement.
        self._frozen_at = self._last_output if resolved is SensorFaultMode.FREEZE else None

    def clear(self) -> None:
        self.mode = SensorFaultMode.NONE
        self.severity = 0.0
        self._frozen_at = None
        self._drift = 0.0
        self._dropout_remaining_s = 0.0

    # -- measurement ------------------------------------------------------

    def measure(self, true_value: float, dt: float) -> tuple[float, SensorQuality]:
        """Convert a process value into a reading plus a quality flag."""
        spec = self.spec
        quality = SensorQuality.GOOD

        if self.mode is SensorFaultMode.DROPOUT:
            if self._dropout_remaining_s > 0.0:
                self._dropout_remaining_s -= dt
            elif self._rng.random() < spec.dropout_probability * self.severity:
                self._dropout_remaining_s = spec.dropout_hold_s
            if self._dropout_remaining_s > 0.0:
                # Broken loop: the transmitter reads below its range and the
                # value carries no information at all.
                self._last_output = spec.range_min
                return spec.range_min, SensorQuality.BAD
            quality = SensorQuality.UNCERTAIN

        if self.mode is SensorFaultMode.FREEZE:
            if self._frozen_at is None:
                self._frozen_at = self._clean(true_value)
            self._last_output = self._frozen_at
            return self._frozen_at, SensorQuality.UNCERTAIN

        value = self._clean(true_value)

        if self.mode is SensorFaultMode.NOISE:
            extra = spec.noise_sigma * (spec.noise_fault_multiplier - 1.0) * self.severity
            value += float(self._rng.normal(0.0, max(extra, 0.0)))
            quality = SensorQuality.UNCERTAIN
        elif self.mode is SensorFaultMode.BIAS:
            value += spec.bias_amount * self.severity
            quality = SensorQuality.UNCERTAIN
        elif self.mode is SensorFaultMode.DRIFT:
            self._drift += spec.drift_rate_per_s * self.severity * dt
            value += self._drift
            if abs(self._drift) > spec.drift_uncertain_sigma * spec.noise_sigma:
                quality = SensorQuality.UNCERTAIN

        value = self._condition(value)
        self._last_output = value
        return value, quality

    # -- internals --------------------------------------------------------

    def _clean(self, true_value: float) -> float:
        """A healthy reading: white noise, quantisation, range clamp."""
        spec = self.spec
        if abs(true_value) <= spec.zero_deadband:
            # Pulse-counting instruments report exactly nothing at standstill
            # rather than dithering about zero.
            return 0.0
        return self._condition(true_value + float(self._rng.normal(0.0, spec.noise_sigma)))

    def _condition(self, value: float) -> float:
        spec = self.spec
        if spec.resolution > 0.0:
            value = round(value / spec.resolution) * spec.resolution
        return min(max(value, spec.range_min), spec.range_max)


class SensorBus:
    """All instruments on the skid, owned by exactly one session.

    The random generator is seeded per session so two visitors watching the
    same machine see independent noise, and so a single session replays
    identically.
    """

    def __init__(self, seed: int) -> None:
        rng = np.random.default_rng(seed)
        self._sensors: dict[str, Sensor] = {
            tag: Sensor(spec, np.random.default_rng(rng.integers(0, 2**32))) for tag, spec in SENSORS.items()
        }
        self._quality: dict[str, SensorQuality] = {tag: SensorQuality.GOOD for tag in SENSORS}

    def read(self, tag: str, true_value: float, dt: float) -> float:
        sensor = self._sensors[tag]
        value, quality = sensor.measure(true_value, dt)
        self._quality[tag] = quality
        return value

    def arm(self, tag: str, mode: str, severity: float = 1.0) -> None:
        if tag not in self._sensors:
            raise ValueError(f"unknown sensor tag {tag!r}; expected one of {sorted(self._sensors)}")
        self._sensors[tag].arm(mode, severity)

    def clear(self, tag: str | None = None) -> None:
        for name, sensor in self._sensors.items():
            if tag is None or name == tag:
                sensor.clear()
                self._quality[name] = SensorQuality.GOOD

    @property
    def quality(self) -> dict[str, str]:
        """Tag -> SensorQuality value, ready for the Telemetry contract."""
        return {tag: quality.value for tag, quality in self._quality.items()}

    def bad_tags(self) -> list[str]:
        return [tag for tag, quality in self._quality.items() if quality is SensorQuality.BAD]

    def faulted_tags(self) -> dict[str, str]:
        return {
            tag: sensor.mode.value for tag, sensor in self._sensors.items() if sensor.mode is not SensorFaultMode.NONE
        }
