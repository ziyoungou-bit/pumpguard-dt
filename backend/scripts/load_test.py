"""A7: Load test /api/vibration to verify stability under concurrent requests.

This script makes concurrent requests to /api/vibration and measures:
- Response time percentiles (p50, p90, p95, p99)
- Success rate
- Any errors or timeouts

Also verifies that Fault Diagnosis page banners still exist.
"""

import concurrent.futures
import sys
import time
from pathlib import Path
from statistics import median, quantiles

import requests

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

BASE_URL = "http://127.0.0.1:8001"


def make_request() -> tuple[float, int, str]:
    """Make one request to /api/vibration. Returns (elapsed_s, status_code, error_msg)."""
    try:
        start = time.perf_counter()
        response = requests.get(f"{BASE_URL}/api/vibration", timeout=10)
        elapsed = time.perf_counter() - start
        return (elapsed, response.status_code, "")
    except Exception as e:
        return (0.0, 0, str(e))


def load_test(num_requests: int = 100, concurrency: int = 10) -> dict:
    """Run load test with specified concurrency."""
    print(f"Running load test: {num_requests} requests, concurrency {concurrency}")

    results = []
    errors = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(make_request) for _ in range(num_requests)]

        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            elapsed, status, error = future.result()
            if error:
                errors.append(error)
                print(f"Request {i:3d}: ERROR - {error}")
            elif status != 200:
                errors.append(f"HTTP {status}")
                print(f"Request {i:3d}: HTTP {status}")
            else:
                results.append(elapsed)
                if i % 20 == 0:
                    print(f"Request {i:3d}: {elapsed:.3f}s")

    if not results:
        return {"success": False, "errors": errors}

    results_sorted = sorted(results)
    qs = quantiles(results_sorted, n=100)  # Percentiles

    return {
        "success": True,
        "total": num_requests,
        "successful": len(results),
        "failed": len(errors),
        "success_rate": len(results) / num_requests,
        "p50": median(results_sorted),
        "p90": qs[89],
        "p95": qs[94],
        "p99": qs[98],
        "min": min(results_sorted),
        "max": max(results_sorted),
        "errors": errors[:10],  # First 10 errors
    }


def verify_fault_diagnosis_banners() -> bool:
    """Verify that Fault Diagnosis page still has the required banners."""
    frontend_file = BACKEND_DIR.parent / "frontend" / "src" / "pages" / "FaultDiagnosis.tsx"

    if not frontend_file.exists():
        print(f"⚠ Cannot verify: {frontend_file} not found")
        return False

    content = frontend_file.read_text(encoding="utf-8")

    # Check for physics_model_conflict banner
    has_conflict_banner = "physics_model_conflict" in content and "physics rules and the classifier disagree" in content.lower()

    # Check for is_sensor_fault banner
    has_sensor_banner = "is_sensor_fault" in content or "sensor fault" in content.lower()

    print("\nVerifying Fault Diagnosis page banners:")
    print(f"  physics_model_conflict banner: {'✓ FOUND' if has_conflict_banner else '✗ NOT FOUND'}")
    print(f"  is_sensor_fault banner:        {'✓ FOUND' if has_sensor_banner else '✗ NOT FOUND'}")

    return has_conflict_banner and has_sensor_banner


def main():
    print("A7: Load test and banner verification")
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

    print(f"Server is running at {BASE_URL}\n")

    # Run load test
    result = load_test(num_requests=100, concurrency=10)

    # Results
    print("\n" + "=" * 60)
    if not result["success"]:
        print("LOAD TEST FAILED")
        print("Errors:", result["errors"])
        sys.exit(1)

    print("LOAD TEST RESULTS:")
    print(f"  Total requests:    {result['total']}")
    print(f"  Successful:        {result['successful']}")
    print(f"  Failed:            {result['failed']}")
    print(f"  Success rate:      {result['success_rate']:.1%}")
    print(f"\nLatency percentiles:")
    print(f"  p50 (median):      {result['p50']:.3f} s")
    print(f"  p90:               {result['p90']:.3f} s")
    print(f"  p95:               {result['p95']:.3f} s")
    print(f"  p99:               {result['p99']:.3f} s")
    print(f"  min:               {result['min']:.3f} s")
    print(f"  max:               {result['max']:.3f} s")

    if result['errors']:
        print(f"\nFirst errors: {result['errors']}")

    # Acceptance criteria
    if result['success_rate'] >= 0.95:
        print("✓ PASS: Success rate >= 95%")
    else:
        print("✗ FAIL: Success rate < 95%")

    if result['p95'] < 1.0:
        print("✓ PASS: p95 latency < 1.0s")
    else:
        print("⚠ WARNING: p95 latency >= 1.0s")

    print("=" * 60)

    # Verify banners
    print()
    banners_ok = verify_fault_diagnosis_banners()

    if not banners_ok:
        print("\n✗ FAIL: Required banners missing from FaultDiagnosis.tsx")
        sys.exit(1)

    print("✓ PASS: All required banners present")


if __name__ == "__main__":
    main()
