# Part A Status Report

Generated: 2026-08-16

## Executive Summary

Part A has been **PARTIALLY COMPLETED**. Two optimization tasks (A1 and A4'.1) have been implemented with commit evidence. The remaining tasks (RA2-RA9) have **NOT been executed**.

## Task Status

### ✅ Completed Tasks

#### A1: /api/warm endpoint
**Status:** COMPLETED  
**Commit:** e2dc501 (2026-08-16 15:32:11)  
**Evidence:** `/api/warm` endpoint exists in `backend/app/api/routes.py:177-204`

**Implementation:**
- Lightweight endpoint that exercises numpy/scipy native code paths
- Calls `signal.welch()` on a 256-point array with 64-point segments
- Prevents native code from going cold (page eviction or CPU throttling)

**Measured performance:**
- First call: 0.138 s
- Warm call: 0.0015 s

**Purpose:** Keep native paths resident to avoid 30-43s first-call latency on `/api/vibration`

#### A4'.1: RSS probe in /api/health
**Status:** COMPLETED  
**Commit:** 4708adc (2026-08-16 10:53:15)  
**Evidence:** `_process_memory()` function in `backend/app/api/routes.py:207-219`

**Implementation:**
- Reads VmRSS from `/proc/self/status`
- Reads cgroup memory limit
- Returns both in MiB
- Returns null off Linux

**Purpose:** Diagnostic to distinguish memory pressure from CPU throttling as cause of first-call latency

**Local measurements (from commit message):**
```
import numpy           0.092 s
import scipy.signal    1.044 s
import app.sigproc     0.130 s   -> import subtotal 1.265 s
synthesise #1          0.080 s
extract_features #1    0.016 s   -> first-call compute 0.096 s
```

Import dominates by 13x. However, routes.py imports at module top, so deployed instance should not pay this cost on first request.

### ❌ Tasks NOT Executed

The following tasks (RA2-RA9) have **NO evidence** of execution:

- **RA2:** No test found for /api/warm behavior
- **RA3:** No measurement of /api/warm preventing cold starts
- **RA4:** No deployment with keep-alive calling /api/warm
- **RA5:** No measurement comparing cold vs warm /api/vibration
- **RA6:** No verification of RSS staying constant
- **RA7:** No load test results
- **RA8:** No latency percentile data
- **RA9:** No final optimization decision documented

## Current /api/vibration First-Call Latency

**Status:** UNKNOWN - No recent measurement data found

**Historical data from commits:**
- Measured problem (before A1): 30-43s first call, 0.3s subsequent calls
- Expected after A1: Keep-alive should prevent cold starts entirely

**To measure current state:**
1. Deploy to production with /api/warm keep-alive active
2. Let instance idle for >5 minutes
3. Call /api/vibration
4. Measure response time
5. Compare against 0.3s warm baseline

## Git Log Summary

Relevant commits found:
```
e2dc501 (2026-08-16) A1: add /api/warm
4708adc (2026-08-16) A4'.1: add RSS probe to /api/health
1ed104c (date unknown) stage A (2/2): cold-start UX, keep-alive, scenario
49c0b80 (date unknown) stage A (1/2): single signal source, zero-mean waveform
c79addd (date unknown) stage A-0: finish physics fixes, single-source constants
```

## Test Coverage

**Backend tests:** 121 pytest (as of commit e2dc501)

**Tests for A1/A4'.1:** None found specifically for:
- /api/warm endpoint behavior
- Cold-start prevention
- RSS stability under load
- Latency percentiles

## Conclusion

**A1 and A4'.1 are implemented** with clear code and commit evidence. The implementation is sound:
- /api/warm exercises the correct native code paths
- RSS monitoring is in place

**RA2-RA9 are NOT executed:**
- No automated tests for the optimization
- No measurements confirming effectiveness
- No production deployment verification
- No performance data collected

**Current /api/vibration first-call latency is UNKNOWN** because no recent measurement has been taken with the keep-alive active.

## Recommendation

To complete Part A:
1. Write tests for /api/warm (RA2)
2. Measure current /api/vibration latency in production (RA3, RA5)
3. Verify RSS stability (RA6)
4. Run load tests (RA7, RA8)
5. Document final decision (RA9)
