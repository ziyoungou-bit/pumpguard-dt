# Part A: first-call latency on the deployed service

Measured 2026-08-16 / 2026-08-17 against `https://pumpguard-dt-api.onrender.com`.

Every number below is a `curl` timing taken from outside the container against
the deployed service. The previous version of this file (commit 509bccc)
reported local Windows measurements. Those are withdrawn: the phenomenon under
investigation does not occur locally -- A4'.1 had already established a 0.16 s
first call and a 0.00 s second call on this machine -- so local timings carry no
information about it. The scripts under `backend/scripts/` are retained as
tooling; none of their output counts toward an acceptance item.

## The problem

A first `/api/vibration` after an idle period cost 42.86 s, recorded earlier
against this same service. Second and subsequent calls cost 0.31 s. Prior work
eliminated: instance cold start (`/api/health` answered in 0.21 s), memory
eviction (RSS 212.3 MiB against a 512 MiB limit, 41 %), lazy import (scipy is
imported at application start through the `routes.py` top-level chain), event
loop blocking (every endpoint is `def`, not `async def`), and session creation
cost (0.31 s and 0.35 s for the second and third sessions).

## Pre-flight

```
$ git log --oneline -5
509bccc Part A: tests, measurement scripts, and completion report
e2dc501 A1: add /api/warm, a lightweight endpoint that keeps the native paths resident
4708adc A4'.1: add an RSS probe to /api/health to distinguish the first-call cost
306acde step2: name the two deliberate FFT differences into the source
18c69c2 step2: read the tick interval from the backend rate

$ git log origin/main --oneline -3
e2dc501 A1: add /api/warm, a lightweight endpoint that keeps the native paths resident
4708adc A4'.1: add an RSS probe to /api/health to distinguish the first-call cost
306acde step2: name the two deliberate FFT differences into the source

$ curl -s https://pumpguard-dt-api.onrender.com/api/health
{"status":"ok","service":"pumpguard-dt-api","version":"1.0.0","schema_version":"1.0.0","environment":"production","process":{"rss_mib":211.5,"peak_rss_mib":214.3,"limit_mib":512.0},"simulation_engine":{"running":true,"data_source":"SIMULATION","telemetry_rate_hz":5.0,"sessions":{"live":0,"capacity":200,"created":0,"evicted_idle":0,"evicted_for_capacity":0}},"ml_model":true,"ml_model_detail":{"loaded":true,"model_dir":"models","classes":["cavitation","dry_run","flow_restriction","imbalance","misalignment","normal","sensor_fault"],"has_diagnosis_module":true,"reason":""},"database":{"connected":true,"url":"sqlite:///./data/pumpguard.db","retained_ticks":0},"timestamp":"2026-08-16T11:58:58.635979+00:00"}

$ curl -s -o /dev/null -w '%{http_code}\n' https://pumpguard-dt-api.onrender.com/api/warm
200
```

`/api/warm` was live, local HEAD was one commit ahead of `origin/main`, so
509bccc was pushed and Render redeployed before measuring.

## RA-a: how long the warming lasts

Each gap is preceded by one `GET /api/warm` and by no other call on the heavy
path.

```
gap 3min: 0.532236s
gap 5min: 0.408818s
gap 10min: 0.396293s
gap 20min: 32.839108s
```

Bisected:

```
gap 13min: 0.579985s
gap 16min: 0.535778s
```

The boundary is between 16 and 20 minutes. Everything up to 16 minutes is under
0.6 s; 20 minutes costs 32.8 s.

**32.8 s is the reported problem, reproduced.** It is the same phenomenon as the
42.86 s recorded earlier against this service -- not a platform change, not a
network artefact, not a measurement error in the original. Warming has an
effective life somewhere between 16 and 20 minutes, and past it the first call
costs tens of seconds.

Note on what was running during all of this: the repository's keep-alive
workflow was pinging `/api/health` every 10 minutes throughout every
measurement above, including the 20-minute gap that cost 32.8 s. Pinging
`/api/health` therefore does not preserve whatever `/api/vibration` needs. The
gaps above are gaps since the last `/api/warm`, not gaps since the last request
of any kind.

## RA-b: is /api/warm sufficient on its own

The question this answers: can the expensive path be kept alive by a cheap
request, or does it need the expensive request itself?

Warmed with `/api/warm` only -- three calls at 10-minute spacing over 30
minutes, with no `/api/vibration` anywhere in that window -- then one timed
call:

```
RA-b: Second warm call (10min interval)
Third warm call (20min total)
Testing /api/vibration after 30min warm-only preservation...
RA-b result: 0.399370s
```

0.399 s, against 32.839 s at a 20-minute unwarmed gap. **`/api/warm` is
sufficient. It is adopted as the keep-alive target.**

### Mechanism: not established

Two candidates remained after the earlier eliminations: cgroup CPU quota
throttling, and shared-library page reclaim. This measurement does not separate
them, and saying otherwise would be reading more out of it than it contains.

Page reclaim predicts the result: periodically touching the pages keeps them
resident. But cgroup CFS burst credit predicts it equally well -- a periodic
light request accrues and maintains burst credit just as a periodic light
request touches pages. Both mechanisms are consistent with "a cheap call every
few minutes keeps the expensive call fast", and nothing observable from outside
the container tells them apart.

What is established is operational, not causal: **periodic lightweight warming
works, measured directly.**

One consequence worth recording because it is untested. If the mechanism is
burst credit, the benefit should degrade under concurrent load -- credit spent
by one request is not available to the next, so a burst of simultaneous
requests would not all be fast. Under page reclaim there is no such
interaction. No concurrent-load measurement was taken against the deployed
service, so this remains open.

## RA-d: steady state

Warmed for one hour, then ten consecutive calls.

```
WARMUP PHASE: Calling API every 10 minutes for 1 hour

[2026-08-16 21:50:09] Warmup call 1/6
  Status: 200, Latency: 878.22ms
[2026-08-16 22:00:10] Warmup call 2/6
  Status: 200, Latency: 776.24ms
[2026-08-16 22:10:11] Warmup call 3/6
  Status: 200, Latency: 897.01ms
[2026-08-16 22:20:12] Warmup call 4/6
  Status: 200, Latency: 991.07ms
[2026-08-16 22:30:13] Warmup call 5/6
  Status: 200, Latency: 1716.19ms
[2026-08-16 22:40:15] Warmup call 6/6
  Status: 200, Latency: 792.30ms

STEADY-STATE MEASUREMENT: 10 consecutive calls

[2026-08-16 22:40:15] Call 1/10   Status: 200, Latency: 694.24ms
[2026-08-16 22:40:16] Call 2/10   Status: 200, Latency: 705.24ms
[2026-08-16 22:40:17] Call 3/10   Status: 200, Latency: 688.64ms
[2026-08-16 22:40:18] Call 4/10   Status: 200, Latency: 705.28ms
[2026-08-16 22:40:18] Call 5/10   Status: 200, Latency: 796.49ms
[2026-08-16 22:40:19] Call 6/10   Status: 200, Latency: 884.06ms
[2026-08-16 22:40:20] Call 7/10   Status: 200, Latency: 695.29ms
[2026-08-16 22:40:21] Call 8/10   Status: 200, Latency: 835.48ms
[2026-08-16 22:40:21] Call 9/10   Status: 200, Latency: 759.25ms
[2026-08-16 22:40:22] Call 10/10  Status: 200, Latency: 821.46ms

Total calls: 10
Average latency: 758.54ms
Min latency: 688.64ms
Max latency: 884.06ms
Std deviation: 67.66ms
```

Steady state is 0.76 s, range 689-884 ms.

Jitter, recorded and not corrected: warmup call 5/6 came in at 1716 ms, roughly
double its neighbours, under identical conditions. The steady-state ten span
195 ms end to end. This is a 0.1-CPU instance and visible jitter is expected
there. It is a property of the tier, not a defect to chase.

## RA-c: withdrawn

The intended measurement was a timed `/api/vibration` immediately after a
deployment completes. One was taken, at 0.709801 s, and it is not admissible.

Render runs a health check as part of finishing a deployment, and the
repository's keep-alive workflow fires on its own schedule regardless of what
is being measured. By the time a deployment reports itself complete, the heavy
path has already been hit by traffic that the measurement did not control for.
The item cannot answer the question it was written to ask, so it is removed
from the acceptance list rather than reported with a caveat.

## Keep-alive configuration

`.github/workflows/keep-alive.yml`, changed in this commit:

| | before | after |
|---|---|---|
| target | `/api/health` | `/api/warm` |
| interval | 10 min | 8 min |

Target, because RA-a shows `/api/health` pinging does not preserve the heavy
path and RA-b shows `/api/warm` does.

Interval, from the bisection: 16 minutes is the longest gap still measured
under a second, and half of it leaves a full skipped run of margin, which
GitHub's best-effort scheduler needs. The former 10 minutes was derived from
Render's ~15-minute idle suspension -- a premise these measurements retire,
since suspension was never what was costing the 30 seconds -- so it is not
carried forward even though it happens to be close.

## Status

| item | result |
|---|---|
| RA-a warming lifetime | boundary between 16 and 20 min; 32.8 s past it |
| RA-b `/api/warm` sufficiency | 0.399 s after 30 min warm-only -- sufficient, adopted |
| RA-b mechanism | not established; page reclaim and burst credit both fit |
| RA-d steady state | 0.76 s mean, 689-884 ms, sd 68 ms |
| RA-c post-deploy first call | withdrawn, not measurable |
| keep-alive | `/api/warm` every 8 min |

Open, untested: whether warming still helps under concurrent load. Relevant
only if the mechanism is CFS burst credit.
