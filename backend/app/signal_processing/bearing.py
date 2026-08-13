"""Theoretical rolling-element bearing defect frequencies.

READ THIS BEFORE USING ANYTHING IN THIS MODULE.

Everything here is *calculated from bearing geometry and shaft speed*. Nothing
here inspects a measurement, and nothing here can tell you a bearing is damaged.
A BPFO of 86.6 Hz means "if this bearing had an outer-race defect, the impacts
would repeat at 86.6 Hz" -- it does not mean 86.6 Hz was seen in the spectrum,
and it does not mean the outer race is defective. Detection would require
finding energy at these frequencies (envelope analysis of the raw
acceleration), which is a separate step this module deliberately does not do.

The returned payload carries `basis` and `disclaimer` fields so that this
distinction survives the trip through the API into the UI. A frequency table
labelled only "BPFO / BPFI / BSF / FTF" on a condition-monitoring screen reads
as a diagnosis to most people, and that would be a dishonest screen.

Kinematics
----------
Standard rigid-cage, pure-rolling formulas (Harris, *Rolling Bearing
Analysis*; identical forms appear in every CM handbook). With `n` rolling
elements, ball diameter `d`, pitch diameter `D`, contact angle `theta` and
shaft rotational frequency `f_r`, writing `r = (d/D) cos(theta)`:

    BPFO = (n/2) * f_r * (1 - r)        outer race defect
    BPFI = (n/2) * f_r * (1 + r)        inner race defect
    BSF  = (D/(2d)) * f_r * (1 - r^2)   ball (rolling element) defect
    FTF  = (1/2) * f_r * (1 - r)        cage / fundamental train

Assumptions these formulas embed, and which make them approximate on a real
machine: no skidding of the rolling elements, constant contact angle, no
clearance effects. Real bearings slip by 1-2 %, so measured defect frequencies
sit slightly *below* these values. Never treat a 1 % mismatch as evidence of
anything.

Two identities that fall straight out of the formulas and are worth knowing as
sanity checks:

    BPFO + BPFI = n * f_r
    BPFO        = n * FTF
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any

from ..config.pump_parameters import BEARING, BearingGeometry

#: Stamped onto every payload so a consumer cannot mistake these for detections.
CALCULATION_BASIS = "THEORETICAL_KINEMATIC"

DISCLAIMER = (
    "Theoretical frequencies calculated from bearing geometry and shaft speed. "
    "These are the frequencies at which a defect would produce impacts. They are "
    "NOT measurements and do NOT indicate that any defect is present."
)


@dataclass(frozen=True)
class BearingFrequencies:
    """Calculated defect frequencies for one bearing at one shaft speed.

    Every frequency is in Hz. The geometry is echoed back so a UI can show what
    the numbers were derived from -- a bare frequency with no visible geometry
    invites the reader to assume it was measured.
    """

    designation: str
    shaft_frequency_hz: float
    rotational_speed_rpm: float

    bpfo_hz: float  # ball pass frequency, outer race
    bpfi_hz: float  # ball pass frequency, inner race
    bsf_hz: float  # ball spin frequency
    ftf_hz: float  # fundamental train (cage) frequency

    # --- what they were computed from -----------------------------------
    rolling_elements: int
    ball_diameter_mm: float
    pitch_diameter_mm: float
    contact_angle_deg: float

    # --- provenance, never omit -----------------------------------------
    basis: str = CALCULATION_BASIS
    disclaimer: str = DISCLAIMER

    @property
    def orders(self) -> dict[str, float]:
        """Defect frequencies expressed in shaft orders (multiples of f_r).

        Orders are speed-independent, so they are the honest way to compare
        this bearing against a table in a handbook.
        """
        if self.shaft_frequency_hz <= 0.0:
            return {"bpfo": 0.0, "bpfi": 0.0, "bsf": 0.0, "ftf": 0.0}
        f_r = self.shaft_frequency_hz
        return {
            "bpfo": self.bpfo_hz / f_r,
            "bpfi": self.bpfi_hz / f_r,
            "bsf": self.bsf_hz / f_r,
            "ftf": self.ftf_hz / f_r,
        }

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["orders"] = self.orders
        return payload


def defect_frequencies_from_geometry(
    shaft_frequency_hz: float,
    rolling_elements: int,
    ball_diameter_mm: float,
    pitch_diameter_mm: float,
    contact_angle_deg: float = 0.0,
    designation: str = "custom",
) -> BearingFrequencies:
    """Calculate BPFO/BPFI/BSF/FTF for arbitrary geometry.

    This is the entry point behind the UI's bearing calculator page, where the
    user types their own bearing in. It is the same code path the pump's own
    bearing uses, so the calculator cannot drift from the asset.

    Raises ValueError on geometry that is not physically possible, rather than
    returning a plausible-looking number: a pitch diameter smaller than the
    ball diameter, or zero rolling elements, means the user mistyped, and
    silently returning a frequency for an impossible bearing is worse than an
    error message.
    """
    if rolling_elements <= 0:
        raise ValueError("rolling_elements must be positive")
    if ball_diameter_mm <= 0.0 or pitch_diameter_mm <= 0.0:
        raise ValueError("ball_diameter_mm and pitch_diameter_mm must be positive")
    if ball_diameter_mm >= pitch_diameter_mm:
        raise ValueError("ball_diameter_mm must be smaller than pitch_diameter_mm")
    if not -90.0 < contact_angle_deg < 90.0:
        raise ValueError("contact_angle_deg must be within +/-90 degrees")

    f_r = max(0.0, shaft_frequency_hz)
    # r = (d/D) cos(theta), the single dimensionless group all four formulas
    # are built from.
    ratio = (ball_diameter_mm / pitch_diameter_mm) * math.cos(math.radians(contact_angle_deg))
    half_elements = rolling_elements / 2.0

    return BearingFrequencies(
        designation=designation,
        shaft_frequency_hz=f_r,
        rotational_speed_rpm=f_r * 60.0,
        bpfo_hz=half_elements * f_r * (1.0 - ratio),
        bpfi_hz=half_elements * f_r * (1.0 + ratio),
        bsf_hz=(pitch_diameter_mm / (2.0 * ball_diameter_mm)) * f_r * (1.0 - ratio**2),
        ftf_hz=0.5 * f_r * (1.0 - ratio),
        rolling_elements=rolling_elements,
        ball_diameter_mm=ball_diameter_mm,
        pitch_diameter_mm=pitch_diameter_mm,
        contact_angle_deg=contact_angle_deg,
    )


def defect_frequencies(
    shaft_frequency_hz: float,
    geometry: BearingGeometry = BEARING,
) -> BearingFrequencies:
    """Calculated defect frequencies for the pump's own bearing (6205 by default).

    Still theoretical. See the module docstring.
    """
    return defect_frequencies_from_geometry(
        shaft_frequency_hz=shaft_frequency_hz,
        rolling_elements=geometry.rolling_elements,
        ball_diameter_mm=geometry.ball_diameter_mm,
        pitch_diameter_mm=geometry.pitch_diameter_mm,
        contact_angle_deg=geometry.contact_angle_deg,
        designation=geometry.designation,
    )


def defect_frequencies_at_rpm(
    rotational_speed_rpm: float,
    geometry: BearingGeometry = BEARING,
) -> BearingFrequencies:
    """Convenience wrapper for callers holding rpm rather than Hz."""
    return defect_frequencies(rotational_speed_rpm / 60.0, geometry)
