"""The Model Performance page must render measured model artefact metrics."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORT_SCRIPT = REPO_ROOT / "scripts" / "export_model_performance.py"
GENERATED = REPO_ROOT / "frontend" / "src" / "lib" / "modelPerformance.generated.ts"


def test_generated_model_performance_is_not_stale():
    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"{GENERATED.relative_to(REPO_ROOT)} is stale.\n"
        f"{result.stderr}\n"
        "Run: python scripts/export_model_performance.py"
    )


def test_generated_model_performance_carries_the_do_not_edit_banner():
    text = GENERATED.read_text(encoding="utf-8")
    assert "GENERATED FILE -- DO NOT EDIT" in text
    assert "scripts/export_model_performance.py" in text
