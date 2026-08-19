"""The frontend's constants must be a projection of the backend's, not a copy.

This test exists because the copy drifted. src/lib/pumpPhysics.ts carried a
hand-maintained duplicate of pump_parameters.py with a comment stating that the
duplication was unavoidable and had to be kept in step by hand. It was not kept
in step: the frontend subtracted the full 1.2 m suction lift where the backend
subtracted the net 0.4 m, and the two NPSHr formulas were different shapes. Both
sides were individually plausible, so nothing looked broken -- the UI simply
reported an NPSH margin 0.8 m away from the physics it claimed to display.

A comment asking a human to remember something is not a mechanism. This is.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_SCRIPT = REPO_ROOT / "scripts" / "export_parameters.py"
GENERATED = REPO_ROOT / "frontend" / "src" / "lib" / "pumpParameters.generated.ts"


def test_generated_frontend_parameters_are_not_stale():
    """`python scripts/export_parameters.py --check` must pass.

    If this fails, a constant was changed in pump_parameters.py without
    re-running the exporter. The fix is never to edit the generated file:

        python scripts/export_parameters.py
    """
    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"{GENERATED.relative_to(REPO_ROOT)} is stale.\n"
        f"{result.stderr}\n"
        "Run: python scripts/export_parameters.py"
    )


def test_generated_file_carries_the_do_not_edit_banner():
    """A generated file that does not say so invites someone to edit it."""
    text = GENERATED.read_text(encoding="utf-8")
    assert "GENERATED FILE -- DO NOT EDIT" in text
    assert "scripts/export_parameters.py" in text


def test_the_frontend_port_no_longer_holds_its_own_constants():
    """pumpPhysics.ts must re-export, not redeclare.

    Catches the specific regression of someone re-adding a local literal for
    convenience, which is how the original drift started.
    """
    source = (REPO_ROOT / "frontend" / "src" / "lib" / "pumpPhysics.ts").read_text(
        encoding="utf-8"
    )
    for name in ("PUMP", "CIRCUIT", "MOTOR", "FLUID", "BEARING", "THERMAL"):
        assert f"export const {name} = {{" not in source, (
            f"{name} is declared locally in pumpPhysics.ts again. "
            "It must come from pumpParameters.generated.ts."
        )


def test_b8_temperature_limits_are_projected_from_one_backend_source():
    """B8 redefines TT-101/TT-102; generated frontend constants must follow."""
    from app.config.alarm_thresholds import ALARM_LIMITS, INTERLOCKS, TEMPERATURE

    limits = {limit.key: limit for limit in ALARM_LIMITS}
    motor = limits["motor_temperature_high"]
    bearing = limits["bearing_temperature_high"]

    assert TEMPERATURE.thermal_class == "B"
    assert TEMPERATURE.ambient_reference_c == 40.0
    assert TEMPERATURE.rise_limit_resistance_k == 80.0
    assert TEMPERATURE.hotspot_margin_c == 10.0
    assert TEMPERATURE.t_design_avg_c == 120.0
    assert TEMPERATURE.t_class_hotspot_c == 130.0

    assert motor.warning == 105.0
    assert motor.alarm == 120.0
    assert motor.trip == 120.0
    assert bearing.warning == 65.0
    assert bearing.alarm == 80.0
    assert bearing.trip == 80.0
    assert INTERLOCKS.high_motor_temperature_c == 120.0
    assert INTERLOCKS.high_bearing_temperature_c == 80.0

    generated = GENERATED.read_text(encoding="utf-8")
    for expected in (
        "rise_limit_resistance_k: 80.0",
        "t_design_avg_c: 120.0",
        "t_class_hotspot_c: 130.0",
        "warning: 105.0",
        "alarm: 120.0",
        "trip: 120.0",
        "warning: 65.0",
        "alarm: 80.0",
    ):
        assert expected in generated
