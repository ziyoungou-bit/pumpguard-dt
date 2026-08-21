# PumpGuard DT

**A motor–pump condition monitoring platform built so that every number on screen
can be checked by hand.**

🔗 **[Live demo](https://ziyangou-pumpguard-dt.netlify.app)** ·
[Engineering formula sheet](https://ziyangou-pumpguard-dt.netlify.app/app/engineering) ·
[Model performance](https://ziyangou-pumpguard-dt.netlify.app/app/model-performance)

> **This is simulated data, not a real machine.** Every value in this application
> is produced by a physics simulation of a laboratory-scale motor–pump set. No
> physical asset, plant, or customer data is involved anywhere in the system.
> This is an engineering portfolio prototype, not a certified condition-monitoring
> product.

---

## What it is

A single-stage end-suction centrifugal pump (P-101) driven by a 4-pole induction
motor (MTR-101), roughly 110 L/min at 8 m head, 1450 rpm. Flow is solved as the
intersection of the pump characteristic and the system curve; head, efficiency,
shaft power, electrical power and NPSH margin all follow from that one operating
point. Nothing downstream invents a coefficient.

That scale is deliberate. The numbers stay checkable by hand, so the model can be
argued with rather than merely believed.

The platform covers the full path from sensor to maintenance decision: a
simulated DAQ at 5 Hz, a PLC-equivalent state machine with real interlocks, a
FastAPI acquisition layer over REST and websocket, velocity-waveform and FFT
signal processing, a physics model, a supervised classifier and anomaly detector,
a 3D digital twin driven by live telemetry, and a condition-based maintenance
view.

---

## Three pieces of the work worth reading in full

### Efficiency is not a parameter here

`eta_BEP` is not typed in anywhere. It is evaluated at runtime from the
minimum-efficiency correlation in **Commission Regulation (EU) No 547/2012,
Annex III** (OJ L 165/34):

```
(η_BEP)min,requ = 88.59x + 13.46y − 11.48x² − 0.85y² − 0.38xy − C

x = ln(ns)   y = ln(Q_BEP in m³/h)   C = 128.07  (ESOB, 1450 rpm, MEI ≥ 0.40)
```

At this machine's specific speed (ns = 14.876) and BEP flow (7.260 m³/h) that
gives **η_BEP = 0.4874** — a pump sitting exactly on the legal minimum that came
into force in 2015.

The correlation has a scope, and the scope did the design work. Article 2(2)
requires ns between 6 and 80 and a **rated** flow of at least 6 m³/h. An earlier
version of this rig ran at 20 L/min, which fails both. The duty point was moved
to 110 L/min (6.6 m³/h) so that the machine falls inside the regulation, rather
than keeping the machine and quietly using a correlation that does not cover it.
The scope test is evaluated live on the Pump Performance page, the same way the
ISO 20816 class check is.

One deliberate ugliness: `ns` takes flow in m³/s while `y` takes it in m³/h. That
inconsistency is in the legislative text itself, so the code carries two
separately named variables (`qBepM3s`, `qBepM3hForFormula`) rather than one `Q`
converted inline — each can then cite the clause it comes from.

**A cross-check that was not designed for.** The same Annex sets the part-load
and overload floors at 0.947 and 0.985 of the BEP floor, at 75 % and 110 % of BEP
flow. The efficiency model on this site is an independently chosen parabola,
`η/η_BEP = 2x − x²`. It returns 0.9375 and 0.9900 at those two flows — within
**1.0 %** and **0.5 %** of the regulated derating factors. Nothing was fitted to
make that happen.

---

### Chasing a 43-second first call

The first request to `/api/vibration` after an idle period took **42.9 s**. Every
request after it took 0.31–0.44 s. Five explanations were eliminated in turn,
each against a measurement:

| Hypothesis | Evidence against |
| --- | --- |
| Render instance cold start | `/api/health` answered in 0.21 s — the process was alive |
| Memory eviction | RSS 212.3 MiB against a 512 MiB limit (41 %) |
| Lazy import of scipy | `routes.py` pulls it at module level; the cost is paid at startup |
| Async event-loop blocking | Every endpoint is `def`, so FastAPI runs it in the threadpool |
| Session creation | Two consecutive calls that both built a new session took 0.31 s and 0.35 s |

Two candidates survived: cgroup CPU quota starvation, and reclamation of the
file-backed pages holding numpy/scipy's native code. Neither can be observed
directly from outside the container.

Rather than guess, the fix was designed to act on both. `/api/warm` is a
deliberately trivial endpoint whose only job is to call into scipy's compiled
extensions — `signal.welch` on a 256-sample array. It costs two orders of
magnitude less than a real vibration request.

Calibration against the deployed service:

```
gap  3 min →  0.532 s
gap  5 min →  0.409 s
gap 10 min →  0.396 s
gap 20 min → 32.839 s
```

After thirty minutes preserved by `/api/warm` alone, `/api/vibration` returned in
**0.399 s**.

The knee sits somewhere between 10 and 20 minutes and has not been resolved
further. The mechanism is still not distinguished: periodic light traffic would
maintain CFS burst credit just as well as it keeps pages resident, so both
explanations survive the result. What is established is narrower and sufficient —
periodic lightweight warming works, and the platform constraint that makes it
necessary is stated on the Settings page rather than hidden.

---

### A classifier at 0.82, and why it is on display

The supervised model reaches **grouped accuracy 0.8236**; the unsupervised
detector reaches **ROC AUC 0.8432**. On a completely healthy frame the random
forest returns `sensor_fault` at 0.71 against `normal` at 0.28.

Those numbers are on the
[Model Performance page](https://ziyangou-pumpguard-dt.netlify.app/app/model-performance),
together with the full seven-class confusion matrix — including the `normal` /
`sensor_fault` cell, which is where the model actually fails.

The reason for publishing them rather than a headline accuracy is a specific
finding. When the duty point moved from 20 L/min to 110 L/min, the existing model
predicted anomaly on **every** frame and had to be retrained from scratch. A model
that had learned pump physics would not do that. This one had learned the output
distribution of the simulator that produced its training data — and since the
features come from the same set of equations as the labels, these metrics are a
ceiling on what the model could do, not a prediction of how it would behave on a
real machine.

That has a visible consequence in the product. The Fault Diagnosis page runs the
deterministic physics rules rather than the classifier, and the
`physics_model_conflict` flag exists to surface disagreement between the two
instead of resolving it silently in favour of whichever is more confident.

Stating this is not a disclaimer bolted onto a demo. The whole site is built so
its numbers can be argued with — the Engineering page prints every equation with
the current operating point substituted in; the vibration limits declare which
ISO class they came from and that this asset is below the scope of ISO 20816-3. A
machine-learning stage that reported only its best figure would be the one part
of the system that could not be checked.

---

## How it holds together

**One source of truth for every physical constant.** `backend/app/config/` is
canonical. `scripts/export_parameters.py` projects it into
`frontend/src/lib/pumpParameters.generated.ts`, and a test fails the build if the
two diverge. Physical literals are not permitted in the frontend — the same
quantity living in two files, then being changed in one, was the defect class
that motivated the arrangement.

**One name for every field on the wire.** `backend/app/contracts.py` defines the
field names in transport, in storage and in the React types, and
`src/types/contracts.ts` mirrors it verbatim — no camelCase conversion, no
renaming, no nesting. If a producer writes `flow_lpm` and a consumer reads
`flowRate`, the consumer gets `undefined`, the chart draws an empty line, and
nothing raises an error. Silent contract drift is far more expensive to find than
a crash.

**Two hand-written implementations of the same formula, locked together.** The
health index exists in Python and in TypeScript, because the browser has to score
a frame when the backend is unreachable. Both sides assert against one shared
fixture, `testdata/health_cases.json`, and each carries a sentinel test that reads
the other side's source. Breaking either implementation turns both test suites
red.

**Degradation is explicit.** A single websocket in one provider feeds every page,
with exponential backoff on reconnect. REST calls resolve to the payload or to
null and retry rather than throwing at the UI. With no backend, a bundled
recorded dataset replays and is labelled as such. Every chart sits inside an error
boundary, so one broken panel cannot blank the page.

---

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind, Recharts, three.js |
| Backend | Python, FastAPI, NumPy, SciPy, scikit-learn |
| Transport | REST + websocket (5 Hz telemetry) |
| Hosting | Netlify (static frontend) · Render free tier (API) |

---

## Running locally

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

Tests:

```bash
cd backend && python -m pytest tests -q
cd frontend && npm run build && npx vitest run
```

Regenerating the frontend constants after changing a backend parameter:

```bash
python scripts/export_parameters.py
python scripts/export_model_performance.py
```

---

## Scope and known limitations

These are decisions, not an outstanding to-do list.

- **`RISE_LIMIT_RESISTANCE = 80 K` is unverified.** It is marked as such in the
  source. The value is attributed to IEC 60034-1, thermal class B, resistance
  method, but has not been checked against the standard text — the limits are a
  matrix indexed by winding type and machine rating. A test asserts that the
  constant appears exactly once, so correcting it is a one-line change.
- **The classifier will not transfer.** See the third section above. The metrics
  bound what is achievable on this simulator; they say nothing about a real pump.
- **The API runs on a free tier.** First-call latency after a long idle period is
  a platform property, mitigated by scheduled warming and stated on the Settings
  page.
- **The PLC layer is a software equivalent.** The state machine and interlocks
  are real and tested, but they run as Python, not as ladder or structured text
  on PLC hardware — so no scan-cycle timing, no I/O module behaviour and no
  fail-safe output state is being demonstrated.
- **Vibration limits are applied by analogy.** At roughly 294 W shaft power this
  asset falls below the scope of ISO 20816-3 (> 15 kW). ISO 20816-1 Class I
  boundaries are used, and the page says so.

---

## Author

**Ziyang Ou** — Master of Professional Engineering (Mechanical), Monash University
Research Assistant, Monash Centre for Additive Manufacturing

[LinkedIn](https://www.linkedin.com/in/ziyang-ou-a29aa2386) · ouziyoung@gmail.com

---

## Licence

[MIT](LICENSE)
