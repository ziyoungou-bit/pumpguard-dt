#!/usr/bin/env python3
"""
RA-d: Steady-state latency measurement script
After 1-hour warmup at 10-minute intervals, measure 10 consecutive /api/vibration calls
"""

import requests
import time
from datetime import datetime
from typing import List, Dict

API_BASE = "https://pumpguard-dt-api.onrender.com"
WARMUP_INTERVAL_MINUTES = 10
WARMUP_DURATION_MINUTES = 60
CONSECUTIVE_CALLS = 10


def call_vibration_api() -> float:
    """Call /api/vibration and return latency in milliseconds"""
    url = f"{API_BASE}/api/vibration"
    start = time.time()
    try:
        response = requests.get(url, timeout=30)
        latency = (time.time() - start) * 1000  # Convert to ms
        print(f"  Status: {response.status_code}, Latency: {latency:.2f}ms")
        return latency
    except requests.exceptions.RequestException as e:
        latency = (time.time() - start) * 1000
        print(f"  Error: {e}, Latency: {latency:.2f}ms")
        return latency


def warmup_phase():
    """Warmup: call API every 10 minutes for 1 hour"""
    print(f"\n{'='*60}")
    print("WARMUP PHASE: Calling API every 10 minutes for 1 hour")
    print(f"{'='*60}\n")

    warmup_calls = WARMUP_DURATION_MINUTES // WARMUP_INTERVAL_MINUTES

    for i in range(warmup_calls):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] Warmup call {i+1}/{warmup_calls}")
        call_vibration_api()

        if i < warmup_calls - 1:  # Don't wait after the last call
            print(f"  Waiting {WARMUP_INTERVAL_MINUTES} minutes...\n")
            time.sleep(WARMUP_INTERVAL_MINUTES * 60)

    print(f"\nWarmup complete. Ready for steady-state measurement.\n")


def steady_state_measurement() -> List[float]:
    """Measure 10 consecutive calls and collect latencies"""
    print(f"\n{'='*60}")
    print("STEADY-STATE MEASUREMENT: 10 consecutive calls")
    print(f"{'='*60}\n")

    latencies = []

    for i in range(CONSECUTIVE_CALLS):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] Call {i+1}/{CONSECUTIVE_CALLS}")
        latency = call_vibration_api()
        latencies.append(latency)

    return latencies


def analyze_results(latencies: List[float]) -> Dict:
    """Analyze and report latency statistics"""
    avg_latency = sum(latencies) / len(latencies)
    min_latency = min(latencies)
    max_latency = max(latencies)

    # Calculate standard deviation
    variance = sum((x - avg_latency) ** 2 for x in latencies) / len(latencies)
    std_dev = variance ** 0.5

    print(f"\n{'='*60}")
    print("RESULTS")
    print(f"{'='*60}\n")
    print(f"Total calls: {len(latencies)}")
    print(f"Average latency: {avg_latency:.2f}ms")
    print(f"Min latency: {min_latency:.2f}ms")
    print(f"Max latency: {max_latency:.2f}ms")
    print(f"Std deviation: {std_dev:.2f}ms")
    print(f"\nAll latencies: {[f'{l:.2f}ms' for l in latencies]}")

    return {
        "latencies": latencies,
        "avg": avg_latency,
        "min": min_latency,
        "max": max_latency,
        "std_dev": std_dev
    }


def main():
    print(f"\nRA-d Steady-State Measurement Script")
    print(f"API Base: {API_BASE}")
    print(f"Start time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Phase 1: Warmup
    warmup_phase()

    # Phase 2: Steady-state measurement
    latencies = steady_state_measurement()

    # Phase 3: Analysis
    results = analyze_results(latencies)

    print(f"\nScript completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()
