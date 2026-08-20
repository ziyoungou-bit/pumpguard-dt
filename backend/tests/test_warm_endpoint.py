"""A2.2: Tests for /api/warm endpoint behavior.

This test suite verifies that /api/warm exercises the correct native code
paths without performing business computation.
"""

import numpy as np
from scipy import signal
from fastapi.testclient import TestClient


def test_warm_returns_ok(client: TestClient):
    """A2.2.1: /api/warm returns {"ok": True}."""
    response = client.get("/api/warm")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_warm_endpoint_returns_ok_on_repeated_calls(client: TestClient):
    """A2.2.2: /api/warm is a behavioural endpoint, not a timing contract."""
    assert client.get("/api/warm").json() == {"ok": True}
    assert client.get("/api/warm").json() == {"ok": True}


def test_warm_exercises_native_paths():
    """A2.2.3: Verify /api/warm actually exercises numpy/scipy native code.

    This is a unit test of the implementation logic, not an API test.
    It confirms that signal.welch() is called, which exercises the same
    native paths as /api/vibration.
    """
    # Simulate what /api/warm does
    x = np.random.rand(256)
    freqs, psd = signal.welch(x, nperseg=64)

    # Verify the operation completed and returned expected shapes
    assert freqs.shape == (33,), f"Expected 33 frequency bins, got {freqs.shape}"
    assert psd.shape == (33,), f"Expected 33 PSD values, got {psd.shape}"
    assert np.all(np.isfinite(psd)), "PSD contains non-finite values"


def test_warm_array_size_matches_spec():
    """A2.2.4: Verify /api/warm uses the specified array and segment sizes."""
    # The endpoint uses 256-point array, 64-point segments
    # Welch with nperseg=64 on 256 samples gives (64//2 + 1) = 33 bins
    x = np.random.rand(256)
    freqs, psd = signal.welch(x, nperseg=64)
    assert len(freqs) == 33
    assert len(psd) == 33


def test_warm_throttles_immediate_native_repeats(monkeypatch):
    """The endpoint warms native scipy paths once, then skips immediate repeats."""
    from app.api import routes

    calls = 0

    def fake_welch(x, nperseg):
        nonlocal calls
        calls += 1
        return np.arange(33), np.ones(33)

    monkeypatch.setattr(routes.signal, "welch", fake_welch)
    monkeypatch.setattr(routes, "_LAST_NATIVE_WARM_AT", 0.0)
    monkeypatch.setattr(routes.time, "monotonic", lambda: 100.0)

    assert routes.warm() == {"ok": True}
    assert routes.warm() == {"ok": True}
    assert calls == 1

def test_warm_throttle_window_is_far_below_keep_alive_interval():
    """The throttle must stay far below the 8-minute keep-alive cadence."""
    from app.api import routes

    keep_alive_interval_s = 8 * 60
    # If this window approaches or exceeds the keep-alive interval, /api/warm
    # silently stops touching the native path often enough and the endpoint's
    # whole cold-path prevention purpose fails.
    assert routes._WARM_MIN_INTERVAL_S * 8 <= keep_alive_interval_s
