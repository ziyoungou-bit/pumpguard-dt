# Duplicated quantities — inventory

**Phase 0, Step 1. This document changes nothing.** It records every physical
quantity that is written down in two or more places, so that the *possibility*
of the defect can be removed in Step 2. Where two sites disagree, the
disagreement is recorded and **not adjudicated**. No value in this repository was
changed to produce this document.

Scanned: `backend/app/**`, `frontend/src/**`. Generated files
(`pumpParameters.generated.ts`) are shown as *mirror* rather than as duplicates —
they are already projected from a source and are the pattern Step 2 should
extend, not an instance of the problem.

Line numbers are as of commit `670548c`.

---

## Legend

- **const** — a literal written in that file
- **derived** — computed from other quantities at that site
- **mirror** — projected automatically from a source; not hand-maintained
- **read** — reads a source module, holds no value of its own (listed only where
  it matters for the argument; these are *not* defects)

⚠️ marks a site whose value or form disagrees with another site for the same
quantity.

---

## 1. Pump and motor constants

These already have a single source (`pump_parameters.py`) projected into the
frontend. Listed to establish the pattern Step 2 should follow, and because a
few consumers still restate them in prose.

| Quantity | File:line | Value / expression | Kind |
|---|---|---|---|
| eta_BEP | `backend/app/config/pump_parameters.py:81` | `0.42` | const (source) |
| eta_BEP | `frontend/src/lib/pumpParameters.generated.ts` | `0.42` | mirror |
| eta_BEP | `frontend/src/pages/PumpPerformance.tsx:116,177` | `PUMP.bep_efficiency` | read |
| eta_BEP | `frontend/src/pages/PumpPerformance.tsx:143` | "A 62 % figure here would…" | ⚠️ **prose literal `62`** |
| eta_BEP | `backend/app/config/pump_parameters.py:111,141` | "was 62 %", "26 W hydraulic at 62 %" | ⚠️ prose literal |
| eta_BEP | `backend/app/config/alarm_thresholds.py:17` | "from 62 % to 42 %" | ⚠️ prose literal |
| eta_motor | `backend/app/config/pump_parameters.py:154` | `0.72` | const (source) |
| eta_motor | `frontend/src/lib/pumpPhysics.ts` (`electricalPowerW`) | `MOTOR.efficiency` | read |
| PF | `backend/app/config/pump_parameters.py:153` | `0.82` | const (source) |
| PF | `backend/app/physics/pump_model.py:298` | `motor.power_factor` | read |
| PF | `frontend/src/lib/pumpPhysics.ts:164` | `MOTOR.power_factor` | read |
| V | `backend/app/config/pump_parameters.py:151` | `230.0` | const (source) |
| V | `backend/app/config/pump_parameters.py:126` | "single-phase 230 V" | prose literal |
| I_noload | `backend/app/config/pump_parameters.py:156` | `0.42` | const (source) |
| I_noload | `backend/app/api/routes.py:874` | "unloads to about 0.42 A" | ⚠️ prose literal |
| I_noload | `backend/app/config/alarm_thresholds.py:134` | "unloads to 0.423 A" | ⚠️ prose literal, **0.423 ≠ 0.42** |
| I_rated | `backend/app/config/pump_parameters.py:157` | `0.95` | const (source) |
| I_rated | `backend/app/config/alarm_thresholds.py:122,123` | comment `0.95`, `warning=0.95` | ⚠️ restated |
| H0 | `backend/app/config/pump_parameters.py:74` | `12.0` | const (source) |
| H0 | `backend/app/config/pump_parameters.py:53,56` | "shutoff at 12.0 m" | prose literal |
| a (head coeff.) | `backend/app/config/pump_parameters.py:84-88` | `(H0 − H_duty)/Q_duty²` | derived (source) |
| a | `frontend/src/lib/pumpParameters.generated.ts` | `36000000.0` | mirror |
| a | `backend/app/config/pump_parameters.py:56-58` | "= 3.60e7" | prose literal |
| H_static | `backend/app/config/pump_parameters.py` (`static_head_m`) | `2.0` | const (source) |
| K | `backend/app/physics/pump_model.py:107` | `pipe·mult + valve(opening)` | derived |
| K | `frontend/src/lib/pumpPhysics.ts` (`systemResistance`) | `pipe + valve(opening)` | ⚠️ **derived, no blockage term** |
| pipe_resistance | `backend/app/config/pump_parameters.py:193` | `4.26e7` | const (source) |
| pipe_resistance | `backend/app/config/pump_parameters.py:190` | "= 4.26e7" | prose literal |
| P_parasitic | `backend/app/config/pump_parameters.py:164` | `9.0` | const (source) |
| P_parasitic scaling | `backend/app/physics/pump_model.py:232` | `× (N/N_rated)³` | derived |
| P_parasitic scaling | `frontend/src/lib/pumpPhysics.ts` (`shaftPowerW`) | `× (N/N_rated)³` | derived (duplicate form) |
| P_parasitic scaling | `frontend/src/lib/energy.ts:70-71` | `× (N/N_rated)³` | ⚠️ **third copy of the same expression** |
| P_parasitic scaling | `frontend/src/pages/PumpPerformance.tsx` (shaft tile hint) | `× (N/N_rated)³` | ⚠️ **fourth copy** |

---

## 2. Vibration severity band edges (ISO 20816-1 Class I)

The worst cluster in the repository: **eight independent copies**, in two
languages, with three different sets of edges in use.

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| A/B, B/C, C/D | `frontend/src/lib/vibration.ts:390-392` | `0.71 / 1.8 / 4.5` | const |
| B/C, trip | `backend/app/ml/diagnosis.py:87-88` | `ISO_GOOD=1.8`, `ISO_TRIP=11.2` | ⚠️ const, **different pair** |
| B/C, C/D, D | `backend/app/api/routes.py:869-871` | `1.8 / 4.5 / 7.1` | ⚠️ const, **third copy** |
| alarm escalation | `backend/app/config/alarm_thresholds.py:180-183` | `1.8 / 4.5 / 7.1 / 11.2` | const |
| band edges (prose) | `backend/app/config/alarm_thresholds.py:32-33` | `0.71 / 1.8 / 4.5` | prose literal |
| trip | `backend/app/config/alarm_thresholds.py:243` | `extreme_vibration_mm_s = 18.0` | ⚠️ const, **no other site has 18.0** |
| deviation denominator | `backend/app/api/routes.py:1054` | `(rms − 1.8)/(11.2 − 1.8)` | ⚠️ inline literal `11.2` |
| deviation denominator | `backend/app/simulation/engine.py:458` | `(rms − 1.0)/(11.2 − 1.0)` | ⚠️ inline, **`1.0` not `1.8`** |
| demo alarm ALARM | `frontend/src/data/recordedDemo.ts:357,359` | `4.5` twice (threshold + predicate) | ⚠️ const, stated twice in one rule |
| demo alarm WARNING | `frontend/src/data/recordedDemo.ts:366,368` | `1.8` twice | ⚠️ const |
| Dashboard tile | `frontend/src/pages/Dashboard.tsx:189` | `limitStatus(rms, 1.8, 4.5)` | ⚠️ inline literals |
| Dashboard trend | `frontend/src/pages/Dashboard.tsx:241` | `warningLevel={4.5}` | ⚠️ inline literal |
| Vibration tile | `frontend/src/pages/VibrationAnalysis.tsx:275` | `limitStatus(rms, 1.8, 4.5)` | ⚠️ inline literals |
| Trends limit | `frontend/src/pages/Trends.tsx:28` | `limit: 4.5` | ⚠️ inline literal |
| Digital Twin | `frontend/src/components/twin/TwinScene.tsx:45` | `alarmLimit: 4.5` | ⚠️ inline literal |
| recommendation text | `backend/app/ml/diagnosis.py:540` | "…passes the 4.5 mm/s band edge" | ⚠️ prose literal |

**Recorded disagreements** (not adjudicated): `diagnosis.py` scales vibration
between `1.8` and `11.2`; `engine.py` scales between `1.0` and `11.2`;
`routes.py` between `1.8` and `11.2` but escalates at `7.1`;
`interlocks` trips at `18.0`.

---

## 3. Temperature limits

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| ambient | `backend/app/config/pump_parameters.py:234` | `23.0` | const (source) |
| motor rise at rated | `…:235` | `42.0` | const (source) |
| motor tau | `…:236` | `420.0` | const (source) |
| motor tau | `frontend/src/lib/frameModel.ts:137` | `420` running / `900` stopped | ⚠️ **inline literals; 900 has no backend counterpart** |
| bearing tau | `…:237-238` | `28.0`, `300.0` | const (source) |
| bearing tau | `frontend/src/lib/frameModel.ts:140` | `180` dry / `300` running / `700` stopped | ⚠️ **inline; 700 has no counterpart** |
| cooling tau factor | `backend/app/simulation/thermal.py:39` | `1.6` | ⚠️ const, frontend uses absolute `900`/`700` instead |
| dry-run extra rise | `backend/app/config/pump_parameters.py:240` | `55.0` | const (source) |
| dry-run extra rise | `frontend/src/lib/frameModel.ts:135` | `55` | ⚠️ inline literal |
| motor T warning | `backend/app/config/alarm_thresholds.py:150` | `65.0` | const (source) |
| motor T warning | `frontend/src/pages/Dashboard.tsx:175` | `limitStatus(T, 70, 78)` | ⚠️ **inline `70`/`78`, neither is 65** |
| motor T alarm/trip | `alarm_thresholds.py:151-152` | `75.0` / `90.0` | const |
| motor T (demo rule) | `frontend/src/data/recordedDemo.ts:393,395` | `78` twice | ⚠️ inline |
| motor T (trend) | `frontend/src/pages/Trends.tsx:37` | `limit: 78` | ⚠️ inline |
| bearing T warning | `alarm_thresholds.py:162` | `55.0` | const (source) |
| bearing T | `frontend/src/pages/Dashboard.tsx:182` | `limitStatus(T, 55, 62)` | ⚠️ inline; `62` is not a backend limit |
| bearing T (demo rule) | `frontend/src/data/recordedDemo.ts:384,386` | `62` twice | ⚠️ inline |
| bearing T (trend) | `frontend/src/pages/Trends.tsx:38` | `limit: 62` | ⚠️ inline |
| bearing T (health) | `frontend/src/lib/health.ts:29` | `BEARING_TEMPERATURE_LIMIT_C = 62` | ⚠️ const, fourth copy of `62` |
| interlock trips | `alarm_thresholds.py:239-240` | `90.0` / `80.0` | const |

**Recorded disagreement**: the backend's motor warning is `65`; the UI colours
the tile at `70`, the demo alarm fires at `78`, and the trend line is drawn at
`78`. Bearing: backend `55`, UI `55`→`62`, demo `62`, health penalty `62`.

---

## 4. Health index

Two different formulations, five weights each, no shared term.

| Quantity | File:line | Value / expression | Kind |
|---|---|---|---|
| weights | `backend/app/ml/diagnosis.py:447-453` | vib 30, temp 15, hyd 25, anomaly 20, sensor 10 | const |
| weights | `frontend/src/lib/health.ts` | vib piecewise 4/11/22/40, eff ×37, NPSH ×14, brg ×1.4 | ⚠️ **const, unrelated scheme** |
| health (telemetry) | `backend/app/simulation/engine.py:449-463` | `100(1 − min(0.7·severity + 0.3·physical, 1))` | ⚠️ **derived, third formulation, uses ground-truth severity** |
| eff. penalty onset | `frontend/src/lib/health.ts:36` | `0.89` (fraction of eta_BEP) | const, no backend counterpart |
| NPSH guideline | `frontend/src/lib/health.ts:27` | `0.5` | const |
| NPSH guideline | `backend/app/config/alarm_thresholds.py` (`npsh_margin_low.alarm`) | `0.5` | const |
| NPSH guideline | `frontend/src/data/recordedDemo.ts:375,377` | `0.5` twice | ⚠️ inline |
| NPSH guideline | `frontend/src/pages/Dashboard.tsx:165-167` | `0.5` twice | ⚠️ inline |
| NPSH guideline | `frontend/src/pages/PumpPerformance.tsx` (marginStatus) | `0.5` twice | ⚠️ inline |
| stale formula (comment) | `frontend/src/lib/health.ts:12` | `100 − 12·max(0,RMS−1.8) − 60·max(0,0.55−eta)` | ⚠️ **documents a formula no longer implemented anywhere** |

---

## 5. Vibration signature amplitudes and fault gains

The two implementations are **structurally different**, not merely numerically:
the backend is multiplicative on a baseline, the frontend is additive.

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| base 1x | `backend/app/simulation/engine.py:74` | `0.55` | const |
| base 1x | `frontend/src/lib/frameModel.ts:145` | `0.55 × speedScale` | ⚠️ const (matches) |
| base 2x | `backend/app/simulation/engine.py:75` | `0.22` | const |
| base 2x | `frontend/src/lib/frameModel.ts:146` | `0.18` | ⚠️ **const, 0.18 ≠ 0.22** |
| base HF | `backend/app/simulation/engine.py` (`_BASE_HIGH_FREQUENCY_MM_S`) | see file | const |
| base HF | `frontend/src/lib/frameModel.ts:147` | `0.12` | ⚠️ const |
| imbalance 1x gain | `backend/app/simulation/engine.py:82` | `×(1 + 10.0·s)` | ⚠️ multiplicative |
| imbalance 1x gain | `frontend/src/lib/frameModel.ts:152` | `+3.1·s` | ⚠️ **additive — different model** |
| misalignment 2x gain | `backend/app/simulation/engine.py:83` | `×(1 + 18.0·s)` | ⚠️ multiplicative |
| misalignment 2x gain | `frontend/src/lib/frameModel.ts:158` | `+2.4·s` | ⚠️ additive |
| cavitation HF gain | `backend/app/simulation/engine.py:85` | `×(1 + 14.0·s)` | ⚠️ multiplicative |
| cavitation HF gain | `frontend/src/lib/frameModel.ts:162` | `+1.9·s` | ⚠️ additive |
| noise floor | `frontend/src/lib/frameModel.ts:177` | `0.09` / `0.01` | ⚠️ inline, no backend counterpart |
| vane pass amplitude | `frontend/src/lib/vibration.ts:160` | `0.12` | const |
| vane pass amplitude | `backend/app/simulation/engine.py` (`_BASE_BLADE_PASS_MM_S`) | see file | ⚠️ separate const |
| line-frequency amp | `frontend/src/lib/vibration.ts:161` | `0.05` | const, **no backend counterpart** |
| healthy crest factor | `frontend/src/lib/frameModel.ts` (`HEALTHY_CREST_FACTOR`) | `2.25` | const |
| healthy crest factor | `backend/app/simulation/engine.py:270` | `1.414 + 1.2·breakdown + 0.3·misalign` | ⚠️ **const `1.414` ≠ 2.25** |
| axial ratio | `backend/app/simulation/engine.py:264` | `0.18` | inline literal |
| y/x ratio | `backend/app/simulation/engine.py:442` | `0.62` | inline literal |

---

## 6. Sampling, block size and buffers

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| telemetry rate | `backend/app/settings.py:150` | `TELEMETRY_RATE_HZ` default `5.0` | const (source) |
| tick interval | `backend/app/settings.py:101-103` | `1 / telemetry_rate_hz` = **0.2 s** | derived |
| tick interval | `frontend/src/data/recordedDemo.ts:50` | `DEMO_TICK_S = 0.5` | ⚠️ **const, 0.5 ≠ 0.2** |
| tick interval | `frontend/src/state/AppState.tsx:51` | `TICK_MS = DEMO_TICK_S × 1000` | derived from the 0.5 |
| history buffer | `frontend/src/state/AppState.tsx:52` | `HISTORY_LIMIT = 3600` + comment "30 minutes at 0.5 s" | ⚠️ **const; comment assumes 0.5 s, so the real window is 12 min at 0.2 s** |
| history windows | `backend/app/storage/historian.py:49` | `HISTORY_WINDOWS` | const, separate scheme |
| flush buffer | `backend/app/storage/historian.py:97` | `50` ticks, comment "ten seconds at 5 Hz" | const (self-consistent) |
| vibration fs | `backend/app/signal_processing/waveform.py:88` | `5120.0` | const |
| vibration fs | `frontend/src/lib/vibration.ts` (`VIBRATION_SAMPLE_RATE_HZ`) | `2560` | ⚠️ **const, deliberately different — recorded, see stage A report** |
| vibration block | `backend/app/signal_processing/waveform.py:89` | `4096` | const |
| vibration block | `frontend/src/lib/vibration.ts` (`VIBRATION_BLOCK_SIZE`) | `8192` | ⚠️ const, deliberately different |
| waveform samples served | `backend/app/api/routes.py:69` | `512` | const |
| spectrum bins served | `backend/app/api/routes.py:74` | `512` | const |
| warm start | `backend/app/api/sessions.py` (`WARM_START_S`) | `2 × ALARM_STARTUP_INHIBIT_S` | derived (good pattern) |

---

## 7. Fluid, suction and pressure

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| rho, g, p_vap, p_atm | `backend/app/config/pump_parameters.py:35-38` | `998.2 / 9.80665 / 2339.0 / 101325.0` | const (source) |
| same | `frontend/src/lib/pumpParameters.generated.ts` | same | mirror |
| p_atm (kPa) | `frontend/src/lib/frameModel.ts:114` | `101.325` | ⚠️ **inline literal, a unit-converted restatement of the source** |
| suction drop at speed | `frontend/src/lib/frameModel.ts:115` | `11.8` | ⚠️ inline, no backend counterpart |
| cavitation suction drop | `frontend/src/lib/frameModel.ts:116` | `9.5·s` | ⚠️ inline |
| dry-run suction drop | `frontend/src/lib/frameModel.ts:117` | `4.0·s` | ⚠️ inline |
| suction pressure model | `backend/app/physics/pump_model.py:292-317` | `p_atm − ρg(lift + friction)` | ⚠️ **derived — a different model entirely from the four literals above** |
| suction lift / reservoir | `backend/app/config/pump_parameters.py:201-202` | `1.2` / `0.8` | const (source) |
| NPSHr | `backend/app/physics/pump_model.py:349-372` | `(N/Nr)²[0.6 + 1.4(Q_red/Q_duty)²]` | derived |
| NPSHr | `frontend/src/lib/pumpPhysics.ts` (`npshRequiredM`) | same expression | ⚠️ duplicated form |
| NPSH breakdown | `backend/app/simulation/engine.py:221` | `−npsh_margin / 2.0` | inline literal |
| NPSH deviation | `backend/app/simulation/engine.py:459` | `(1.5 − margin)/3.0` | ⚠️ inline literals |

---

## 8. Bearing geometry

Clean — one source, projected. Included because the brief asked for it.

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| 6205 geometry | `backend/app/config/pump_parameters.py:214-218` | `9 / 7.94 / 39.04 / 0.0` | const (source) |
| same | `frontend/src/lib/pumpParameters.generated.ts` | same | mirror |
| calculator defaults | `frontend/src/pages/VibrationAnalysis.tsx:140-143` | `BEARING.*` | read |
| defect frequency formulas | `backend/app/signal_processing/bearing.py` | kinematic relations | derived |
| defect frequency formulas | `frontend/src/lib/vibration.ts:35-50` | same relations | ⚠️ duplicated form (port) |

---

## 9. Other UI literals

| Quantity | File:line | Value | Kind |
|---|---|---|---|
| service factor | `backend/app/config/pump_parameters.py` | `1.15` | const (source) |
| service factor | `frontend/src/data/recordedDemo.ts:411,413` | `× 1.15` twice | ⚠️ inline |
| service factor | `frontend/src/pages/Dashboard.tsx:155` | `× 1.15` | ⚠️ inline |
| current alarm | `frontend/src/pages/Trends.tsx:36` | `limit: 1.09` | ⚠️ **inline; 1.09 = 0.95 × 1.15 precomputed** |
| low-flow alarm | `frontend/src/data/recordedDemo.ts:402,404` | `8` twice | ⚠️ inline; backend `flow_low.warning` is `14.0` |
| twin alarm limits | `frontend/src/components/twin/TwinScene.tsx:34-45` | per-channel `alarmLimit` | ⚠️ separate table |
| twin warn ratio | `frontend/src/pages/DigitalTwinPage.tsx:96,103` | `× 0.85` | ⚠️ inline |

---

## Summary of counts

| Category | Distinct sites | Sites disagreeing with another site |
|---|---|---|
| ISO band edges | 16 | 6 |
| Temperature limits | 18 | 9 |
| Health index | 10 | 3 (three unrelated formulations) |
| Vibration amplitudes / gains | 17 | 9 (two structurally different models) |
| Tick / buffer | 9 | 3 |
| Pressure / suction | 12 | 5 |
| Pump / motor constants | 25 | 5 (all prose) |
| NPSH guideline | 5 | 0 (same value, five copies) |
| Service factor | 4 | 0 |

**Total quantities appearing in two or more places: 47.**
**Sites carrying a value that disagrees with another site for the same quantity: 40.**

---

## Notes for Step 2

Three observations that bear on the design, recorded here rather than acted on:

1. **`pumpParameters.generated.ts` already solves this** for the pump, motor,
   fluid, circuit, bearing and thermal blocks. Nothing in section 1, 7 (source
   rows) or 8 is a hand-maintained duplicate. The pattern works; it just was
   never extended past `pump_parameters.py`. `alarm_thresholds.py` is the
   obvious next block to project, and it would collapse most of sections 2, 3
   and 9.

2. **Some duplication is of *form*, not of *value*** — `npshRequiredM`,
   `bearingDefectFrequencies`, `shaftPowerW` and the whole of `frameModel.ts`
   are ports: the same equations written twice because the browser must
   evaluate them with no backend. A generated constants module cannot fix
   those. They need either a cross-language conformance test or an explicit
   decision to accept them. Section 5 is where this matters most: the two fault
   models are not the same model, so no shared constant would make them agree.

3. **Two "disagreements" are deliberate and documented** — the vibration
   sampling rate and block size differ on purpose (frontend 2560 Hz × 8192 for
   0.3125 Hz resolution; backend 5120 Hz × 4096). Step 2 should keep them
   distinguishable rather than unify them, or the resolution argument on the
   Vibration page stops being true.
