"""Instrument specifications: noise, resolution, range and fault-mode behaviour.

Every number a sensor model uses lives here. `sensors.py` contains the
behaviour, this module contains the calibration, so a reviewer can see the
whole instrumentation story on one screen and change a noise level without
touching logic.

Noise levels are 1-sigma in engineering units and are sized against the
verified duty point of the rig (1450 rpm, valve open):

    FT-101  115.5 L/min      PT-101   92.0 kPa a
    PT-102  166.3 kPa a      CT-101   2.165 A
    TT-101  winding temp      TT-102   bearing housing surface temp
    ACC-101  ~0.75 mm/s RMS  RPM-101  1450 rev/min

They are chosen at roughly 0.3-0.6 % of the duty reading, which is what a
decent industrial transmitter actually delivers, and -- importantly -- small
enough that a healthy machine never rattles an alarm threshold.

Quality convention (this is a deliberate engineering decision, not an
implementation detail):

  * FREEZE / BIAS / DRIFT / NOISE -> SensorQuality.UNCERTAIN. The signal is
    still present and in range; only its trustworthiness is degraded. A plant
    does not trip on a suspicious reading, it flags it.
  * DROPOUT -> SensorQuality.BAD. The loop is broken (a 4-20 mA line open
    circuit reads below range), so there is no measurement at all. That is the
    only instrumentation condition allowed to act on the process, via the
    invalid-sensor interlock.
"""

from __future__ import annotations

from dataclasses import dataclass

from .pump_parameters import ASSET


@dataclass(frozen=True)
class SensorSpec:
    """Calibration of one modelled transmitter."""

    tag: str
    unit: str
    #: 1-sigma white noise on a healthy instrument, engineering units.
    noise_sigma: float
    range_min: float
    range_max: float
    #: Display/quantisation step of the transmitter, 0 disables quantisation.
    resolution: float = 0.0
    #: True values at or below this read exactly zero. Pulse-counting
    #: instruments (turbine flow meter, tachometer) report no counts rather
    #: than dithering around zero; analogue transmitters leave this at 0.
    zero_deadband: float = 0.0
    #: Rate used by the DRIFT fault mode, engineering units per second.
    drift_rate_per_s: float = 0.0
    #: Offset applied at full severity by the BIAS fault mode.
    bias_amount: float = 0.0
    #: Noise multiplier applied by the NOISE fault mode.
    noise_fault_multiplier: float = 12.0
    #: Per-tick probability of losing the signal in the DROPOUT fault mode.
    dropout_probability: float = 0.4
    #: How long a lost signal stays lost. A broken loop or a bad terminal does
    #: not heal in a hundred milliseconds, and modelling dropout as an
    #: independent coin toss per sample would make it invisible to any
    #: protection with an on-delay -- which would be a modelling artefact, not
    #: a design decision.
    dropout_hold_s: float = 5.0
    #: Accumulated drift beyond this many sigma is reported as UNCERTAIN.
    drift_uncertain_sigma: float = 5.0


SENSORS: dict[str, SensorSpec] = {
    ASSET.flow: SensorSpec(
        tag=ASSET.flow,
        unit="L/min",
        # Every figure on this instrument is the previous rig's scaled by the
        # duty-flow ratio 110/20, so the noise stays at the same 0.43 % of the
        # duty reading it was sized at. The range spans past the 190.5 L/min
        # runout flow: a transmitter that saturates below runout would clamp
        # the signal to a constant at exactly the condition it exists to see.
        noise_sigma=0.50,
        range_min=0.0,
        range_max=250.0,
        resolution=0.01,
        zero_deadband=0.28,
        drift_rate_per_s=0.11,
        bias_amount=16.5,
    ),
    ASSET.suction_pressure: SensorSpec(
        tag=ASSET.suction_pressure,
        unit="kPa",
        noise_sigma=0.20,
        range_min=0.0,
        range_max=300.0,
        resolution=0.01,
        drift_rate_per_s=0.05,
        bias_amount=8.0,
    ),
    ASSET.discharge_pressure: SensorSpec(
        tag=ASSET.discharge_pressure,
        unit="kPa",
        noise_sigma=0.30,
        range_min=0.0,
        range_max=600.0,
        resolution=0.01,
        drift_rate_per_s=0.08,
        bias_amount=12.0,
    ),
    ASSET.current: SensorSpec(
        tag=ASSET.current,
        unit="A",
        noise_sigma=0.010,
        range_min=0.0,
        # Duty is 2.17 A against a 2.72 A nameplate; 10 A spans locked-rotor
        # inrush, which is the transient this instrument must not clip.
        range_max=10.0,
        resolution=0.001,
        zero_deadband=0.005,
        drift_rate_per_s=0.002,
        bias_amount=0.25,
    ),
    ASSET.motor_temperature: SensorSpec(
        tag=ASSET.motor_temperature,
        unit="C",
        noise_sigma=0.08,
        range_min=-20.0,
        range_max=250.0,
        resolution=0.01,
        drift_rate_per_s=0.03,
        bias_amount=5.0,
    ),
    ASSET.bearing_temperature: SensorSpec(
        tag=ASSET.bearing_temperature,
        unit="C",
        noise_sigma=0.08,
        range_min=-20.0,
        range_max=250.0,
        resolution=0.01,
        drift_rate_per_s=0.03,
        bias_amount=5.0,
    ),
    ASSET.accelerometer: SensorSpec(
        tag=ASSET.accelerometer,
        unit="mm/s",
        noise_sigma=0.015,
        range_min=0.0,
        range_max=100.0,
        resolution=0.001,
        zero_deadband=0.001,
        drift_rate_per_s=0.01,
        bias_amount=0.8,
    ),
    ASSET.speed: SensorSpec(
        tag=ASSET.speed,
        unit="rev/min",
        noise_sigma=1.2,
        range_min=0.0,
        range_max=3000.0,
        resolution=1.0,
        zero_deadband=1.0,
        drift_rate_per_s=0.5,
        bias_amount=25.0,
    ),
}

#: Sensors whose loss stops the process. A pump can be run blind on
#: temperature for a while; it cannot be protected without flow, suction
#: pressure or current.
CRITICAL_SENSORS: tuple[str, ...] = (ASSET.flow, ASSET.suction_pressure, ASSET.current)
