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
