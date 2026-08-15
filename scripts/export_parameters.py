"""Emit the frontend's physical constants from the backend configuration.

Why this exists.

The frontend needs the asset's constants offline: the Engineering page evaluates
the formulas it is explaining, and the recorded-demo fallback has to produce a
physically coherent dataset when the API is unreachable. Fetching them from the
backend is not an option in exactly the case they are needed for.

The previous answer was to hand-copy them into src/lib/pumpPhysics.ts with a
comment saying the duplication was unavoidable and had to be maintained by hand.
It was not maintained by hand. The two copies drifted: the frontend subtracted
the full 1.2 m suction lift where the backend subtracted the net 0.4 m, so every
NPSH figure in the UI was 0.8 m pessimistic against the backend that supposedly
owned the physics, and the two NPSHr formulas were different shapes entirely.
Nobody noticed because both sides were individually plausible.

So the constants are generated, not copied. backend/app/config/pump_parameters.py
is the single source; this script projects it into TypeScript; and
backend/tests/test_parameters_export.py fails the build if the checked-in file
does not match what this script would produce right now. Drift becomes a red
test instead of a wrong number on a chart.

What is NOT generated: the physics functions themselves. Those are a genuine
port -- the same equations written twice in two languages -- because the
browser must evaluate them with no backend. Behaviour cannot be projected the
way data can. The backend tests and the frontend contract test pin the two
implementations to the same answers.

Usage:
    python scripts/export_parameters.py            # write the file
    python scripts/export_parameters.py --check    # exit 1 if it is stale
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import fields, is_dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.config.alarm_thresholds import (  # noqa: E402
    ACQUISITION,
    ALARM_LIMITS,
    DISPLAY_BLOCK,
    TEMPERATURE,
    VIBRATION,
)
from app.config.pump_parameters import (  # noqa: E402
    ASSET,
    BEARING,
    CIRCUIT,
    FLUID,
    MOTOR,
    PUMP,
    THERMAL,
)
from app.settings import DEFAULT_TELEMETRY_RATE_HZ  # noqa: E402

OUTPUT_PATH = REPO_ROOT / "frontend" / "src" / "lib" / "pumpParameters.generated.ts"

HEADER = """/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Projected from backend/app/config/pump_parameters.py by
 * scripts/export_parameters.py. That module is the single source of truth for
 * every physical constant in this project; this file exists only so the browser
 * can evaluate the same physics with no backend reachable.
 *
 * To change a number, change it in pump_parameters.py and re-run:
 *
 *     python scripts/export_parameters.py
 *
 * backend/tests/test_parameters_export.py fails if this file is stale, so the
 * two sides cannot drift apart the way they did when they were hand-copied.
 */

"""


def _ts_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f"'{value}'"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, tuple):
        return "[" + ", ".join(_ts_value(item) for item in value) + "]"
    raise TypeError(f"no TypeScript projection for {type(value).__name__}")


def emit_object(name: str, instance: object, extra: dict[str, float] | None = None) -> str:
    """One frozen dataclass instance as an exported TS object literal."""
    if not is_dataclass(instance):
        raise TypeError(f"{name} is not a dataclass instance")
    lines = [f"export const {name} = {{"]
    for field in fields(instance):
        value = getattr(instance, field.name)
        lines.append(f"  {field.name}: {_ts_value(value)},")
    for key, value in (extra or {}).items():
        lines.append(f"  {key}: {_ts_value(value)},")
    lines.append("} as const")
    return "\n".join(lines)


def render() -> str:
    parts = [HEADER.rstrip("\n")]
    parts.append(
        "/** Litres per minute in one cubic metre per second. */\n"
        "export const LPM_PER_M3S = 60000"
    )
    parts.append(emit_object("FLUID", FLUID))
    parts.append(emit_object("PUMP", PUMP))
    parts.append(emit_object("MOTOR", MOTOR))
    parts.append(emit_object("CIRCUIT", CIRCUIT))
    parts.append(emit_object("BEARING", BEARING))
    parts.append(emit_object("THERMAL", THERMAL))

    tag_fields = [f.name for f in fields(ASSET) if f.name != "tags"]
    tag_lines = ["export const ASSET_TAGS = {"]
    for name in tag_fields:
        tag_lines.append(f"  {name}: {_ts_value(getattr(ASSET, name))},")
    tag_lines.append("} as const")
    parts.append("\n".join(tag_lines))

    parts.append(
        "/**\n"
        " * a in H = H0 - a Q^2, m/(m^3/s)^2, derived from the two catalogue points.\n"
        " * Derived on the Python side so both languages get the identical float.\n"
        " */\n"
        f"export const HEAD_COEFFICIENT = {PUMP.head_coefficient!r}"
    )
    parts.append(
        "/**\n"
        " * n_q = N sqrt(Q) / H^0.75 at the rated duty point, N in rpm, Q in m^3/s.\n"
        " * See PumpParameters.specific_speed_nq for why this number sets eta_BEP.\n"
        " */\n"
        f"export const SPECIFIC_SPEED_NQ = {PUMP.specific_speed_nq!r}"
    )

    # -- protection setpoints ------------------------------------------------
    parts.append(
        emit_object(
            "VIBRATION",
            VIBRATION,
            # trip_mm_s is a property, not a field, so it is projected here
            # rather than being recomputed on the far side. Deriving it twice
            # is how the two halves start to disagree.
            extra={"trip_mm_s": VIBRATION.trip_mm_s},
        )
    )
    parts.append(emit_object("TEMPERATURE", TEMPERATURE))

    # Two named acquisitions, deliberately different. Both are projected, with
    # their resolutions computed here, so the difference is a named fact rather
    # than a pair of unexplained literals on opposite sides of the boundary.
    for name, block in (("ACQUISITION_BLOCK", ACQUISITION), ("DISPLAY_BLOCK", DISPLAY_BLOCK)):
        parts.append(
            emit_object(
                name,
                block,
                extra={
                    "resolution_hz": block.resolution_hz,
                    "duration_s": block.duration_s,
                },
            )
        )

    limit_lines = [
        "/**",
        " * Alarm setpoints, keyed exactly as backend/app/config/alarm_thresholds.py",
        " * names them. The UI must not restate a limit: every threshold it draws,",
        " * colours or compares against comes from here.",
        " */",
        "export const ALARM_LIMITS = {",
    ]
    for limit in ALARM_LIMITS:
        limit_lines.append(f"  {limit.key}: {{")
        limit_lines.append(f"    tag: {_ts_value(limit.tag)},")
        limit_lines.append(f"    unit: {_ts_value(limit.unit)},")
        limit_lines.append(f"    direction: {_ts_value(limit.direction)},")
        limit_lines.append(f"    warning: {_ts_value(limit.warning)},")
        limit_lines.append(f"    alarm: {_ts_value(limit.alarm)},")
        limit_lines.append(f"    trip: {_ts_value(limit.trip)},")
        limit_lines.append(f"    deadband: {_ts_value(limit.deadband)},")
        limit_lines.append("  },")
    limit_lines.append("} as const")
    parts.append("\n".join(limit_lines))

    parts.append(
        "/**\n"
        " * Frames per second the backend emits, and the tick interval that follows.\n"
        " * The browser-side replay used to carry a hardcoded 0.5 s, so the two\n"
        " * halves disagreed about how fast the machine was being observed and\n"
        " * every window computed from it -- including the history buffer's stated\n"
        " * '30 minutes' -- was wrong by a factor of 2.5.\n"
        " */\n"
        f"export const TELEMETRY_RATE_HZ = {DEFAULT_TELEMETRY_RATE_HZ!r}\n"
        f"export const TICK_INTERVAL_S = {1.0 / DEFAULT_TELEMETRY_RATE_HZ!r}"
    )
    return "\n\n".join(parts) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit 1 if the checked-in file is stale",
    )
    args = parser.parse_args()

    rendered = render()
    if args.check:
        current = OUTPUT_PATH.read_text(encoding="utf-8") if OUTPUT_PATH.exists() else ""
        if current != rendered:
            print(
                f"{OUTPUT_PATH.relative_to(REPO_ROOT)} is stale.\n"
                "Run: python scripts/export_parameters.py",
                file=sys.stderr,
            )
            return 1
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(rendered, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
