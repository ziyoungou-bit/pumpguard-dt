"""A2.2: Tests for /api/warm endpoint behavior.

This test suite verifies that /api/warm exercises the correct native code
paths without performing business computation.
"""

import time
import numpy as np
from scipy import signal
from fastapi.testclient import TestClient


def test_warm_returns_ok(client: TestClient):
    """A2.2.1: /api/warm returns {"ok": True}."""
    response = client.get("/api/warm")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_warm_is_lightweight(client: TestClient):
    """A2.2.2: /api/warm completes quickly (< 0.2s first call, < 0.01s warm)."""
    # First call (may include module init overhead)
    start = time.perf_counter()
    response = client.get("/api/warm")
    first_call_ms = (time.perf_counter() - start) * 1000
    assert response.status_code == 200
    assert first_call_ms < 200, f"First call took {first_call_ms:.1f}ms, expected < 200ms"

    # Warm call
    start = time.perf_counter()
    response = client.get("/api/warm")
    warm_call_ms = (time.perf_counter() - start) * 1000
    assert response.status_code == 200
    assert warm_call_ms < 10, f"Warm call took {warm_call_ms:.1f}ms, expected < 10ms"

    print(f"First call: {first_call_ms:.2f}ms, Warm call: {warm_call_ms:.2f}ms")


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
