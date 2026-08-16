"""A6: Verify RSS stays constant under repeated requests.

This script monitors process RSS (Resident Set Size) while making repeated
API calls to verify that native code remains resident in memory.
"""

import sys
import time
from pathlib import Path

import requests

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = "http://127.0.0.1:8001"


def measure_rss_stability(num_requests: int = 20, interval_s: float = 0.5) -> list[float]:
    """Make repeated requests and collect RSS values from /api/health."""
    rss_values = []

    for i in range(num_requests):
        try:
            response = requests.get(f"{BASE_URL}/api/health", timeout=5)
            if response.status_code == 200:
                data = response.json()
                if "memory" in data and data["memory"]["rss_mib"] is not None:
                    rss_values.append(data["memory"]["rss_mib"])
                    print(f"Request {i+1:2d}: RSS = {data['memory']['rss_mib']:.1f} MiB")
                else:
                    print(f"Request {i+1:2d}: RSS not available (non-Linux platform)")
            else:
                print(f"Request {i+1:2d}: HTTP {response.status_code}")
        except Exception as e:
            print(f"Request {i+1:2d}: Error - {e}")

        if i < num_requests - 1:
            time.sleep(interval_s)

    return rss_values


def main():
    print("A6: Monitoring RSS stability under repeated requests")
    print("=" * 60)

    # Check server is running
    try:
        response = requests.get(f"{BASE_URL}/api/health", timeout=5)
        if response.status_code != 200:
            print("ERROR: Server not responding at", BASE_URL)
            print("Start the server with: uvicorn app.main:app")
            sys.exit(1)
    except requests.ConnectionError:
        print("ERROR: Cannot connect to server at", BASE_URL)
        print("Start the server with: uvicorn app.main:app")
        sys.exit(1)

    print("\nMaking 20 requests to /api/health to monitor RSS...")
    print()

    rss_values = measure_rss_stability(num_requests=20, interval_s=0.5)

    if not rss_values:
        print("\n⚠ WARNING: RSS monitoring not available on this platform")
        print("RSS monitoring requires Linux /proc/self/status")
        print("A6 cannot be verified on Windows")
        return

    # Analysis
    print("\n" + "=" * 60)
    print("RESULTS:")
    print(f"  Requests made:     {len(rss_values)}")
    print(f"  Initial RSS:       {rss_values[0]:.1f} MiB")
    print(f"  Final RSS:         {rss_values[-1]:.1f} MiB")
    print(f"  Min RSS:           {min(rss_values):.1f} MiB")
    print(f"  Max RSS:           {max(rss_values):.1f} MiB")
    print(f"  Range:             {max(rss_values) - min(rss_values):.1f} MiB")
    print(f"  Mean RSS:          {sum(rss_values)/len(rss_values):.1f} MiB")
    print("=" * 60)

    # Acceptance criteria: RSS should stay within ±10 MiB
    rss_range = max(rss_values) - min(rss_values)
    if rss_range < 10:
        print(f"✓ PASS: RSS stable (range {rss_range:.1f} MiB < 10 MiB)")
    else:
        print(f"✗ FAIL: RSS unstable (range {rss_range:.1f} MiB >= 10 MiB)")
        sys.exit(1)


if __name__ == "__main__":
    main()
