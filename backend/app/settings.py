"""Runtime configuration, read from the environment exactly once.

Every value that differs between a laptop and the public deployment lives here
and nowhere else. No module below this one may read `os.environ`, and no module
may contain a hostname, a port or a database path -- that is what turned into
the "works locally, CORS-blocked in production" failure this file exists to
prevent.

Defaults are the *development* values, so a fresh checkout runs with no `.env`
at all. Production overrides them through the host's dashboard (see
`render.yaml`), which is why nothing here is read from a committed file.

The one rule with no development escape hatch: **CORS origins are exact and
never `*`**. A wildcard origin is refused by the browser on any credentialed
request, and it would also let an arbitrary site drive this API from a
visitor's machine. If the variable is unset in production the service starts
with an empty origin list -- refusing the browser is the correct failure, and a
silent wildcard is not.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .contracts import DataSource

SERVICE_NAME = "pumpguard-dt-api"
SERVICE_VERSION = "1.0.0"

#: Origins allowed when nothing is configured and we are not in production:
#: the two spellings of the Vite dev server.
DEVELOPMENT_CORS_ORIGINS: tuple[str, ...] = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    """A malformed or absurd number falls back to the default rather than crashing.

    A typo in a dashboard field should not stop a deployment from booting; it
    should run on the documented default and be visible in `/api/health`.
    """
    try:
        value = float(_env(name, str(default)))
    except ValueError:
        return default
    return min(max(value, minimum), maximum)


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    return int(_env_float(name, float(default), float(minimum), float(maximum)))


def _parse_origins(raw: str) -> tuple[str, ...]:
    """Comma-separated exact origins. `*` is dropped, never honoured."""
    origins = []
    for item in raw.split(","):
        origin = item.strip().rstrip("/")
        if not origin or origin == "*":
            continue
        origins.append(origin)
    return tuple(dict.fromkeys(origins))


@dataclass(frozen=True)
class Settings:
    """The resolved configuration for this process."""

    app_env: str
    data_source: DataSource
    cors_origins: tuple[str, ...]
    database_url: str
    host: str
    port: int
    telemetry_rate_hz: float
    session_idle_timeout_s: float
    max_sessions: int
    model_dir: str
    #: Retention. A public demo left open for a week must not fill the disk, so
    #: the historian is a rolling window and not an archive.
    history_max_ticks_per_session: int
    history_max_ticks_total: int

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in ("production", "prod")

    @property
    def tick_interval_s(self) -> float:
        """Seconds of simulated time per tick; the reciprocal of the push rate."""
        return 1.0 / self.telemetry_rate_hz

    @property
    def sqlite_path(self) -> str:
        """`DATABASE_URL` as something `sqlite3.connect` accepts.

        Only SQLite is supported today and the code says so plainly rather than
        pretending to be engine-agnostic. A Postgres URL is rejected on startup
        with a message naming the missing driver, which is more useful than a
        connection error thirty seconds later.
        """
        url = self.database_url.strip()
        if url in (":memory:", "sqlite:///:memory:"):
            return ":memory:"
        if url.startswith("sqlite:///"):
            return url[len("sqlite:///") :]
        if url.startswith("sqlite://"):
            return url[len("sqlite://") :]
        raise ValueError(
            f"unsupported DATABASE_URL {url!r}: this service ships with the sqlite3 "
            "driver only. Use a sqlite:/// URL, or add a driver before pointing it "
            "at another engine."
        )


def load_settings() -> Settings:
    """Read the environment. Called once by `get_settings`, and by tests directly."""
    app_env = _env("APP_ENV", "development")
    origins = _parse_origins(_env("BACKEND_CORS_ORIGINS", ""))
    if not origins and app_env.lower() not in ("production", "prod"):
        origins = DEVELOPMENT_CORS_ORIGINS

    raw_source = _env("DATA_SOURCE", DataSource.SIMULATION.value).upper()
    try:
        data_source = DataSource(raw_source)
    except ValueError:
        data_source = DataSource.SIMULATION

    return Settings(
        app_env=app_env,
        data_source=data_source,
        cors_origins=origins,
        database_url=_env("DATABASE_URL", "sqlite:///./data/pumpguard.db"),
        host=_env("HOST", "0.0.0.0"),
        port=_env_int("PORT", 8000, 1, 65535),
        # Above ~20 Hz the browser cannot paint the frames anyway and the
        # bandwidth is wasted; below 1 Hz the trend charts look like steps.
        telemetry_rate_hz=_env_float("TELEMETRY_RATE_HZ", 5.0, 0.5, 20.0),
        session_idle_timeout_s=_env_float("SESSION_IDLE_TIMEOUT_S", 900.0, 10.0, 86_400.0),
        # Each session is one SimulationSession: a few hundred floats plus a
        # numpy RNG. 200 of them is a handful of megabytes, and the cap exists
        # so a crawler opening the public URL in a loop cannot exhaust memory.
        max_sessions=_env_int("MAX_SESSIONS", 200, 1, 10_000),
        model_dir=_env("MODEL_DIR", "models"),
        # 18 000 ticks is one hour at 5 Hz.
        history_max_ticks_per_session=_env_int("HISTORY_MAX_TICKS_PER_SESSION", 18_000, 60, 5_000_000),
        history_max_ticks_total=_env_int("HISTORY_MAX_TICKS_TOTAL", 400_000, 100, 50_000_000),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The process-wide settings. Cached: the environment is read once."""
    return load_settings()


__all__ = [
    "DEVELOPMENT_CORS_ORIGINS",
    "SERVICE_NAME",
    "SERVICE_VERSION",
    "Settings",
    "get_settings",
    "load_settings",
]
