# Health index — comparison of the implemented versions

**Read-only study.** Nothing outside this file was changed to produce it.

## Excluded: the described-but-unimplemented version

The module docstring of `frontend/src/lib/health.ts` used to quote, verbatim, a
health formula with its own coefficients — a `12` per mm/s of vibration above
1.8 and a `60` per unit of efficiency below 0.55. It was quoted there as the
*defect being described*: the stale string the Engineering page used to print.
Grepping the repository for those coefficients against `RMS - 1.8` /
`0.55 - eta` returned that one line and nothing else — no function, constant or
test computed it. It was prose, not code, and `docs/DUPLICATED_QUANTITIES.md:152`
already flagged it as "documents a formula no longer implemented anywhere".

**It has now been deleted.** The surrounding paragraph is a deliberate
explanation of why the module exists and has been kept, rewritten to describe
the defect without reproducing the coefficients — quoting them put a second,
unexecuted copy of the health index inside the file whose whole purpose is to
be the only copy.

## Scope note: there are four implementations, not two

The brief expected two. Searching `.py`/`.ts`/`.tsx` for every site that writes
a `health_index` found **four**:

| # | Site | Role |
|---|---|---|
| A | `backend/app/ml/diagnosis.py:465` `health_index()` | The named, documented backend index. Serves `/api/diagnosis`. |
| B | `frontend/src/lib/health.ts:76` `healthBreakdown()` | The browser-side index. Serves offline/recorded telemetry and the Engineering page. |
| C | `backend/app/api/routes.py:1154` `_physics_health()` | Fallback used by `physics_diagnosis()` when the ML diagnosis module is unavailable. |
| D | `backend/app/simulation/engine.py:449` `_condition_indices()` | Writes `Telemetry.health_index` on every simulated frame. Self-described placeholder; reads injected ground-truth `severity`. |

**A and B are documented in full below**, as instructed. C and D are recorded in
the judgement section because they bear directly on the question being asked —
they are further copies of the same quantity, and D is the one the live
Dashboard actually displays.

---

## Version A — backend, `ml/diagnosis.py`

### Location

| Item | Location |
|---|---|
| Entry point | `backend/app/ml/diagnosis.py:465` `health_index(telemetry, anomaly_score=0.0) -> float` |
| Term breakdown | `backend/app/ml/diagnosis.py:471` `health_terms(telemetry, anomaly_score=0.0) -> dict[str, float]` |
| Ramp helper | `backend/app/ml/diagnosis.py:509` `_fraction(value, good, bad)` |
| Weights | `backend/app/ml/diagnosis.py:447` `HEALTH_WEIGHTS` |
| Prose definition | `backend/app/ml/diagnosis.py:455-462` `HEALTH_INDEX_LABEL`, `HEALTH_INDEX_BASIS` |
| Banding | `backend/app/ml/diagnosis.py:516` `severity_label(index)` — 85 / 70 / 45 |

### Input quantities

Every signal is read off the `Telemetry` frame except `anomaly_score`, which is
passed in by the caller.

| Signal | Unit | Read at |
|---|---|---|
| `vibration_rms_mm_s` | mm/s RMS, 10–1000 Hz | `diagnosis.py:473` |
| `motor_temperature_c` | °C | `diagnosis.py:476` |
| `bearing_temperature_c` | °C | `diagnosis.py:481` |
| `rpm` | rev/min | `diagnosis.py:487` (solves the duty reference) |
| `flow_lpm` | L/min | `diagnosis.py:491` |
| `npsh_margin_m` | m (NPSHa − NPSHr) | `diagnosis.py:492` |
| `sensor_quality` | enum per tag | `diagnosis.py:497` via `bad_sensors()` at `:144` |
| `anomaly_score` | 0..1, isolation-forest output | `diagnosis.py:504`; supplied at `:596,608` |

### Penalty structure

Five terms, each a `weight × fraction` where the fraction is a clamped linear
ramp between a "good" and a "bad" anchor (`_fraction`, `diagnosis.py:509-513`,
saturating at 0 and 1). Penalties are summed and subtracted from 100.

| Term | Weight | Ramp | Notes |
|---|---|---|---|
| `vibration` | 30 | 1.8 → 4.5 mm/s | Zero below 1.8, i.e. a **dead band across the whole of ISO zones A and B** |
| `temperature` | 15 | motor 65 → 90 °C; bearing 55 → 80 °C | `max()` of the two — worse point wins, one shared budget |
| `hydraulic` | 25 | flow shortfall 0.15 → 1.0; NPSH −4.0 → 0.0 m | `max()` of the two. Whole term forced to 0 when the duty solve is invalid (`:494-495`) |
| `anomaly` | 20 | clamp(score, 0, 1) | Straight pass-through of the ML score |
| `sensor` | 10 | 1.0 if any BAD, 0.5 if any UNCERTAIN, else 0 | Step, not a ramp (`:498`) |

Flow shortfall is measured against the duty point the pump curve predicts at the
*measured* speed with the valve open (`_duty_reference`, `:117-124`), so the
reference tracks speed rather than being a table valid only at 1450 rpm.

### Coefficients

| Coefficient | Value | Literal or imported |
|---|---|---|
| `ISO_GOOD_MM_S` | 1.8 | **imported** — `VIBRATION.zone_b_c_mm_s`, `diagnosis.py:87` |
| `ISO_TRIP_MM_S` | 4.5 | **imported** — `VIBRATION.trip_mm_s`, which is the ISO 20816-1 Class I C/D boundary taken directly, `alarm_thresholds.py:113-116` |
| motor 65 / 90 °C | 65.0 / 90.0 | **imported** — `_LIMITS["motor_temperature_high"].warning/.trip` |
| bearing 55 / 80 °C | 55.0 / 80.0 | **imported** — `_LIMITS["bearing_temperature_high"].warning/.trip` |
| `NPSH_ERODED_M` | 4.0 | **literal**, `diagnosis.py:83` |
| flow shortfall onset | 0.15 | **literal**, inline at `diagnosis.py:491` |
| weights 30/15/25/20/10 | — | **literals**, `diagnosis.py:447-453`; sum to 100 by design |

### Output

- **Range** 0..100, clamped both ends (`diagnosis.py:468`), rounded to 2 dp.
- **Units** dimensionless index points.
- **100 = healthy.** A machine failing every term scores 0.
- No guard for a stopped machine: the frame is scored whatever the asset state.

### Consumers

| Consumer | Location |
|---|---|
| `diagnose()` builds the `Diagnosis` | `backend/app/ml/diagnosis.py:608`, assigned at `:614`, banded at `:615` |
| Re-exported from the package | `backend/app/ml/__init__.py:27,43` |
| `MLGateway.diagnose()` | `backend/app/api/routes.py:888` (calls the module when loaded) |
| **`GET /api/diagnosis`** | `backend/app/api/routes.py:602-616`, call at `:613` |
| UI — Fault Diagnosis page | `frontend/src/pages/FaultDiagnosis.tsx:56,112,117` |
| UI — Maintenance page | `frontend/src/pages/Maintenance.tsx:43,56,102,107,191` |

---

## Version B — frontend, `lib/health.ts`

### Location

| Item | Location |
|---|---|
| Entry point | `frontend/src/lib/health.ts:76` `healthBreakdown(input: HealthInputs): HealthBreakdown` |
| Vibration term | `frontend/src/lib/vibration.ts:441` `vibrationHealthPenalty(rmsMmS)` |
| Constants | `frontend/src/lib/health.ts:28,33,42` |
| Types | `frontend/src/lib/health.ts:44,52,65` `HealthTerm`, `HealthBreakdown`, `HealthInputs` |
| Banding | `frontend/src/lib/status.ts:75` `healthStatus(health)` — 85 / 65 / 40 |

The function returns the *terms*, not just a number: `HealthTerm` carries a
`label`, the `expression` with this frame's numbers already substituted, and the
`penalty` applied. That is the module's stated purpose — the Engineering page
renders the same objects the score was computed from, so a printed term cannot
drift from an applied one.

### Input quantities

| Signal | Unit | Read at |
|---|---|---|
| `running` | boolean (asset state = RUNNING) | `health.ts:77` |
| `vibration_rms_mm_s` | mm/s RMS | `health.ts:99` |
| `pump_efficiency` | fraction 0..1 | `health.ts:91,107` |
| `bep_efficiency` | fraction 0..1 (0.4874, derived) | `health.ts:91` |
| `npsh_margin_m` | m | `health.ts:113` |
| `bearing_temperature_c` | °C | `health.ts:120` |

No motor temperature, no flow, no sensor quality, no anomaly score.

### Penalty structure

Four terms, summed and subtracted from 100. Ahead of them sits an explicit
**stopped guard** (`health.ts:77-88`): when `running` is false the function
returns `health = 100, scored = false` with the guard named in the payload —
a stopped machine has no vibration to judge, no operating point and no suction
margin, so it is not scored at all rather than being scored as damaged.

| Term | Shape | Weight / slope |
|---|---|---|
| Vibration | Piecewise-linear in RMS, continuous, **starting from zero** | 4 pts per mm/s in zone A (0–0.71), 11 in B (0.71–1.8), 22 in C (1.8–4.5), 40 beyond 4.5 |
| Efficiency | `37 × max(0, 0.89 − η/η_BEP)` | 37, on a **relative** shortfall against BEP |
| NPSH margin | `14 × max(0, 0.5 − margin)` | 14 per metre below the guideline |
| Bearing temperature | `1.4 × max(0, T − 65)` | 1.4 per K above the limit |

The vibration term is where the two designs diverge most: it is deliberately
dead-band-free. `vibration.ts:426-439` records why — a machine at 0.99 mm/s,
already out of zone A, used to score a flat 100 while the diagnosis panel beside
it named a fault, and "Imbalance, MINOR, severity 0.13" next to "Health 100/100"
is a contradiction the reader resolves by distrusting both numbers.

The efficiency term is relative for a documented reason (`health.ts:35-42`): an
absolute threshold became an always-on penalty the moment η_BEP was corrected
downwards from an assumed 62 %. It has since been corrected a second time —
η_BEP is no longer assumed at all but evaluated from the EU 547/2012 Annex III
correlation — and the relative onset absorbed that change without an edit,
which is the property it was introduced for.

### Coefficients

| Coefficient | Value | Literal or imported |
|---|---|---|
| `ZONE_A_B_MM_S` / `ZONE_B_C_MM_S` / `ZONE_C_D_MM_S` | 0.71 / 1.8 / 4.5 | **imported** — `vibration.ts:391-393` from `pumpParameters.generated.ts:112-114` |
| zone slopes 4 / 11 / 22 / 40 | — | **literals**, `vibration.ts:450` |
| `NPSH_MARGIN_GUIDELINE_M` | 0.5 | **imported** — `ALARM_LIMITS.npsh_margin_low.alarm`, `health.ts:28` |
| `BEARING_TEMPERATURE_LIMIT_C` | **65.0** | **imported** — `ALARM_LIMITS.bearing_temperature_high.alarm`, `health.ts:33` |
| `EFFICIENCY_PENALTY_ONSET_FRACTION` | 0.89 | **literal**, `health.ts:42`; no backend counterpart |
| efficiency weight 37 | — | **literal**, `health.ts:107` |
| NPSH weight 14 | — | **literal**, `health.ts:114` |
| bearing weight 1.4 | — | **literal**, `health.ts:120` |

> Correction to an existing document: `docs/DUPLICATED_QUANTITIES.md:128` records
> `BEARING_TEMPERATURE_LIMIT_C = 62` as a hand-typed "fourth copy of 62". That is
> stale. `health.ts:33` now reads the value from `ALARM_LIMITS`, and the value it
> resolves to is **65.0** (`pumpParameters.generated.ts:213`), not 62.

### Output

- **Range** 5..100 — floored at **5**, not 0 (`health.ts:127-130`): a machine
  still running and still reporting is not in a zero-information state, and a bar
  pinned to the bottom hides the difference between bad and worse.
- **Units** dimensionless index points.
- **100 = healthy.**
- Carries `scored: boolean` and `guard: string | null` alongside the number, so a
  100 from the guard is distinguishable from a 100 that was earned.

### Consumers

| Consumer | Location |
|---|---|
| Frame synthesis → `Telemetry.health_index` | `frontend/src/lib/frameModel.ts:215` (call), `:257` (assignment) |
| Anomaly score derived from it | `frontend/src/lib/frameModel.ts:223` — `(100 − health) / 70`, clamped |
| **Engineering page**, renders the terms | `frontend/src/pages/Engineering.tsx:52` (call), `:176-197` (render + guard text) |
| Tests | `frontend/src/lib/health.test.ts:30,38,51,59,93,103,118,130` |

Downstream of `frameModel`, the number reaches every page that reads
`telemetry.health_index`: `AppShell.tsx:183,222`, `Dashboard.tsx:24,67,75`,
`ScadaControl.tsx:221`, `SimulationLab.tsx:126`, `Trends.tsx:43,60`.

---

## Comparison

| | **A — `ml/diagnosis.py:465`** | **B — `lib/health.ts:74`** |
|---|---|---|
| Terms | 5 | 4 |
| Vibration | weight 30, linear ramp 1.8 → 4.5 mm/s | piecewise slopes 4 / 11 / 22 / 40, from 0 mm/s |
| Vibration dead band | **yes** — nothing scored below 1.8 mm/s | **no** — deliberately removed |
| Motor temperature | 65 → 90 °C, shares a 15-pt budget | **absent** |
| Bearing temperature | 55 → 80 °C, shares the same 15-pt budget | 1.4 pts/K above **65** °C |
| Flow | duty-point shortfall, shares a 25-pt budget | **absent** |
| Efficiency | **absent** | 37 × shortfall below 0.89 η_BEP |
| NPSH margin | ramp −4.0 → 0.0 m, shares the 25-pt budget | 14 pts/m below **0.5** m |
| Anomaly score | **input**, weight 20 | **output** — derived from health at `frameModel.ts:223` |
| Sensor quality | step term, weight 10 | **absent** |
| Stopped guard | none | explicit, reported with a reason |
| Clamp | 0..100 | **5**..100 |
| Rounding | 2 dp | 1 dp |
| Contract field written | `Diagnosis.health_index` (`contracts.py:156`) | `Telemetry.health_index` (`contracts.ts:104`) |
| Field documented as | "0..100" / "0..100, 100 = healthy" | identical wording |
| Severity banding applied | 85 / 70 / 45 (`diagnosis.py:518-523`) | 85 / 65 / 40 (`status.ts:76-81`) |
| Shared inputs | vibration RMS, NPSH margin, bearing temperature | same three |
| Shared truth source | `alarm_thresholds.py` directly | `alarm_thresholds.py` via `pumpParameters.generated.ts` |

### Both evaluated at one identical healthy operating point

Operating point: **1450 rpm, valve fully open, no injected fault**, solved from
`physics.pump_model` — flow 115.52 L/min, head 7.588 m, η 0.4864 against η_BEP
0.4874. Frame values: RMS 0.612 mm/s, motor 48 °C, bearing 46 °C, NPSH margin
7.021 m (NPSHa 9.165 − NPSHr 2.144), all sensors GOOD, anomaly score 0.0. (This
is the `healthy` fixture from `health.test.ts:11-28`, with the extra channels A
needs filled from the same solved duty point.)

**A — backend**, terms actually returned by `health_terms()`:

| vibration | temperature | hydraulic | anomaly | sensor | **health** |
|---|---|---|---|---|---|
| 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **100.00** |

**B — frontend**, terms actually returned by `healthBreakdown()`:

| vibration | efficiency | NPSH | bearing | **health** |
|---|---|---|---|---|
| 2.448 | 0.0 | 0.0 | 0.0 | **97.6** |

For completeness, the other two implementations on the same frame:
`routes._physics_health` → **97.14**; `engine._condition_indices` → **100.0**.

Four numbers — 100.00, 97.6, 97.14, 100.0 — for one machine at one instant, all
labelled "Health index / 100" in the UI.

---

## JUDGEMENT

**These are drifted versions of the same quantity, not designs of different
quantities.**

The evidence that decides it is not the formulas — it is the contract and the
consumers.

1. **They write one field, under one name, with one documented meaning.**
   `contracts.py:118` and `:156` declare `health_index: float  # 0..100, 100 =
   healthy`; `contracts.ts:104,132` mirrors it word for word. A and B both fill
   that field. Two genuinely different quantities cannot share a single field
   with a single definition — one of them would be mislabelled.

2. **The same UI components render both, interchangeably.** `Dashboard.tsx:75`
   and `AppShell.tsx:222` draw `telemetry.health_index`; `FaultDiagnosis.tsx:117`
   and `Maintenance.tsx:107` draw `diagnosis.health_index`. Both go through the
   same `<Meter …label="Health index" />`. Nothing on screen tells the reader
   which formula produced the number, because nothing in the contract records it.

3. **Both are banded as if they were the same scale** — `healthStatus()`
   (`status.ts:75-81`) applies 85 / 65 / 40 to whichever value arrives. The
   backend's own `severity_label()` (`diagnosis.py:516-524`) applies 85 / 70 / 45
   to A. The two banding functions themselves disagree, which is drift of a
   third kind, but both presuppose one common 0..100 scale.

4. **They share input signals and they share a truth source.** Vibration RMS,
   NPSH margin and bearing temperature are read by both. Both take their
   thresholds from `alarm_thresholds.py` — A directly, B through the generated
   mirror. If these were different quantities there would be no reason for them
   to be anchored to the same setpoints.

5. **Neither subsumes the other, which is the signature of drift rather than
   design.** A has motor temperature, flow shortfall, anomaly and sensor validity
   that B lacks; B has an efficiency term worth 37 points that A lacks entirely.
   A deliberate pair of quantities would nest or be disjoint. This pair overlaps
   partially in both directions — the shape you get when one implementation is
   extended and the other is not.

6. **Where they do share a signal, they disagree on the number.** Bearing
   temperature: A ramps from the *warning* (55 °C) to the *trip* (80 °C); B steps
   from the *alarm* (65 °C). NPSH: A ramps from −4.0 m; B from +0.5 m. Vibration:
   A is flat until 1.8 mm/s; B charges from 0. These are the same three signals
   scored against different anchors — disagreement about one quantity, not two
   quantities that happen to read the same sensors.

7. **The same inputs produce meaningfully different outputs.** At the identical
   healthy duty point above, A returns 100.00 and B returns 97.6. The gap is not
   noise: it is A's zone A+B dead band, the very defect `vibration.ts:426-439`
   was written to remove and `health.test.ts:50-53` now asserts against
   ("scores a healthy machine in 94-99, not a suspiciously round 100"). B is a
   *corrected* A. A correction applied to one copy and not the other is the
   definition of drift.

The two extra implementations reinforce this rather than complicating it.
`routes._physics_health` (`routes.py:1154-1173`) is a worst-of over four
deviations with its own inline anchors — bearing 45 → 80 °C, motor 55 → 90 °C,
flow against the solved duty point `_DUTY` — none of which match A's or B's, and
it fills the *same* `Diagnosis.health_index` field as A whenever the ML module is
absent
(`routes.py:894,1113`). `engine._condition_indices` (`engine.py:449-470`) fills
the same `Telemetry.health_index` field as B and is the number the live
Dashboard shows; it is `100 (1 − min(0.7·severity + 0.3·physical, 1))`, and its
`severity` is the **injected ground truth**, so on live backend data the
Dashboard's "health" is partly a readout of the answer rather than a measurement.
Its own docstring calls it a placeholder that "the diagnosis service will own".

So the honest description of the current state is: **one quantity, four
implementations, no shared definition, and a contract field that cannot say
which one it is carrying.** The two documented here are the two that were meant
to be the real ones; they have drifted apart in inputs, anchors and dead-band
behaviour, and B is the version that carries the corrections.
