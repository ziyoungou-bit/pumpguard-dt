"""A2.3: Measure whether /api/warm prevents cold starts on /api/vibration.

This script measures the first-call latency of /api/vibration under two conditions:
1. Cold start: fresh process, no warm-up
2. Warm start: after calling /api/warm

Expected outcome: warm start latency << cold start latency (< 0.5s vs 30-43s)
"""

import subprocess
import sys
import time
from pathlib import Path

import requests

# Ensure we're in the backend directory
BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))


def start_server() -> subprocess.Popen:
    """Start uvicorn in a subprocess."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"],
        cwd=BACKEND_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    # Wait for server to be ready
    for _ in range(50):  # 5 seconds max
        try:
            response = requests.get("http://127.0.0.1:8001/api/health", timeout=0.5)
            if response.status_code == 200:
                print("Server ready")
                return proc
        except requests.ConnectionError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("Server failed to start within 5 seconds")


def measure_cold_start() -> float:
    """Measure /api/vibration first-call latency without warm-up."""
    print("\n=== COLD START MEASUREMENT ===")
    proc = start_server()
    try:
        # Immediate call to /api/vibration (no warm-up)
        start = time.perf_counter()
        response = requests.get("http://127.0.0.1:8001/api/vibration", timeout=60)
        elapsed = time.perf_counter() - start

        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"Cold start: {elapsed:.3f} s")
        return elapsed
    finally:
        proc.kill()
        proc.wait()


def measure_warm_start() -> tuple[float, float]:
    """Measure /api/vibration first-call latency after calling /api/warm."""
    print("\n=== WARM START MEASUREMENT ===")
    proc = start_server()
    try:
        # Call /api/warm first
        warm_start = time.perf_counter()
        response = requests.get("http://127.0.0.1:8001/api/warm", timeout=5)
        warm_elapsed = time.perf_counter() - warm_start
        assert response.status_code == 200, f"/api/warm failed: {response.status_code}"
        print(f"/api/warm completed in {warm_elapsed:.3f} s")

        # Now call /api/vibration
        start = time.perf_counter()
        response = requests.get("http://127.0.0.1:8001/api/vibration", timeout=10)
        elapsed = time.perf_counter() - start

        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print(f"First /api/vibration after warm: {elapsed:.3f} s")
        return warm_elapsed, elapsed
    finally:
        proc.kill()
        proc.wait()


def main():
    print("A2.3: Measuring cold-start prevention effectiveness")
    print("=" * 60)

    # Measure cold start (baseline)
    cold_latency = measure_cold_start()

    # Measure warm start (with /api/warm)
    warm_call_latency, vibration_after_warm = measure_warm_start()

    # Results
    print("\n" + "=" * 60)
    print("RESULTS:")
    print(f"  Cold start (no warm):       {cold_latency:.3f} s")
    print(f"  /api/warm overhead:         {warm_call_latency:.3f} s")
    print(f"  First /api/vibration (warm): {vibration_after_warm:.3f} s")
    print(f"  Improvement:                {cold_latency - vibration_after_warm:.3f} s")
    print(f"  Speedup:                    {cold_latency / vibration_after_warm:.1f}x")
    print("=" * 60)

    # Acceptance criteria
    if vibration_after_warm < 1.0:
        print("✓ PASS: /api/warm prevents cold starts (< 1.0s)")
    else:
        print("✗ FAIL: /api/warm did not prevent cold start")
        sys.exit(1)

    if cold_latency > 2 * vibration_after_warm:
        print("✓ PASS: Warm start is at least 2x faster than cold")
    else:
        print("⚠ WARNING: Improvement is marginal")


if __name__ == "__main__":
    main()
