# PumpGuard DT

**A motor鈥損ump condition monitoring platform built so that every number on screen
can be checked by hand.**

馃敆 **[Live demo](https://ziyangou-pumpguard-dt.netlify.app)** 路
[Engineering formula sheet](https://ziyangou-pumpguard-dt.netlify.app/app/engineering) 路
[Model performance](https://ziyangou-pumpguard-dt.netlify.app/app/model-performance)

> **This is simulated data, not a real machine.** Every value in this application
> is produced by a physics simulation of a laboratory-scale motor鈥損ump set. No
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
(畏_BEP)min,requ = 88.59x + 13.46y 鈭?11.48x虏 鈭?0.85y虏 鈭?0.38xy 鈭?C

x = ln(ns)   y = ln(Q_BEP in m鲁/h)   C = 128.07  (ESOB, 1450 rpm, MEI 鈮?0.40)
```

At this machine's specific speed (ns = 14.876) and BEP flow (7.260 m鲁/h) that
gives **畏_BEP = 0.4874** 鈥?a pump sitting exactly on the legal minimum that came
into force in 2015.

The correlation has a scope, and the scope did the design work. Article 2(2)
requires ns between 6 and 80 and a **rated** flow of at least 6 m鲁/h. An earlier
version of this rig ran at 20 L/min, which fails both. The duty point was moved
to 110 L/min (6.6 m鲁/h) so that the machine falls inside the regulation, rather
than keeping the machine and quietly using a correlation that does not cover it.
The scope test is evaluated live on the Pump Performance page, the same way the
ISO 20816 class check is.

One deliberate ugliness: `ns` takes flow in m鲁/s while `y` takes it in m鲁/h. That
inconsistency is in the legislative text itself, so the code carries two
separately named variables (`qBepM3s`, `qBepM3hForFormula`) rather than one `Q`
converted inline 鈥?each can then cite the clause it comes from.

**A cross-check that was not designed for.** The same Annex sets the part-load
and overload floors at 0.947 and 0.985 of the BEP floor, at 75 % and 110 % of BEP
flow. The efficiency model on this site is an independently chosen parabola,
`畏/畏_BEP = 2x 鈭?x虏`. It returns 0.9375 and 0.9900 at those two flows 鈥?within
**1.0 %** and **0.5 %** of the regulated derating factors. Nothing was fitted to
make that happen.

---

### Chasing a 43-second first call

The first request to `/api/vibration` after an idle period took **42.9 s**. Every
request after it took 0.31鈥?.44 s. Five explanations were eliminated in turn,
each against a measurement:

| Hypothesis | Evidence against |
| --- | --- |
| Render instance cold start | `/api/health` answered in 0.21 s 鈥?the process was alive |
| Memory eviction | RSS 212.3 MiB against a 512 MiB limit (41 %) |
| Lazy import of scipy | `routes.py` pulls it at module level; the cost is paid at startup |
| Async event-loop blocking | Every endpoint is `def`, so FastAPI runs it in the threadpool |
| Session creation | Two consecutive calls that both built a new session took 0.31 s and 0.35 s |

Two candidates survived: cgroup CPU quota starvation, and reclamation of the
file-backed pages holding numpy/scipy's native code. Neither can be observed
directly from outside the container.

Rather than guess, the fix was designed to act on both. `/api/warm` is a
deliberately trivial endpoint whose only job is to call into scipy's compiled
extensions 鈥?`signal.welch` on a 256-sample array. It costs two orders of
magnitude less than a real vibration request.

Calibration against the deployed service:

```
gap  3 min 鈫? 0.532 s
gap  5 min 鈫? 0.409 s
gap 10 min 鈫? 0.396 s
gap 20 min 鈫?32.839 s
```

After thirty minutes preserved by `/api/warm` alone, `/api/vibration` returned in
**0.399 s**.

The knee sits somewhere between 10 and 20 minutes and has not been resolved
further. The mechanism is still not distinguished: periodic light traffic would
maintain CFS burst credit just as well as it keeps pages resident, so both
explanations survive the result. What is established is narrower and sufficient 鈥?periodic lightweight warming works, and the platform constraint that makes it
necessary is stated on the Settings page rather than hidden.

---

### A classifier at 0.82, and why it is on display

The supervised model reaches **grouped accuracy 0.8236**; the unsupervised
detector reaches **ROC AUC 0.8432**. **25.8 % of healthy frames are classified
The failure is concentrated in one pair of classes, and it runs both ways. 25.8 % of healthy frames are classified as `sensor_fault` (248 of 960); 54.2 % of sensor faults are classified as `normal` (407 of 751). The two classes overlap almost completely in feature space.
That is not a modelling accident. Sixteen of the model's features are sensor readings. When the instrument is the thing that failed, the machine underneath it is still healthy, and there is no second source of information for the classifier to fall back on.
A rule that reads the same channels cannot separate them either — which is why the diagnosis page shows both columns rather than picking one.

Those numbers are on the
[Model Performance page](https://ziyangou-pumpguard-dt.netlify.app/app/model-performance),
together with the full seven-class confusion matrix 鈥?including the `normal` /
`sensor_fault` cell, which is where the model actually fails.

The reason for publishing them rather than a headline accuracy is a specific
finding. When the duty point moved from 20 L/min to 110 L/min, the existing model
predicted anomaly on **every** frame and had to be retrained from scratch. A model
that had learned pump physics would not do that. This one had learned the output
distribution of the simulator that produced its training data 鈥?and since the
features come from the same set of equations as the labels, these metrics are a
ceiling on what the model could do, not a prediction of how it would behave on a
real machine.

Retraining fixed the symptom 鈥?the model now scores a healthy frame correctly
most of the time. It did not fix the cause. The new model learned the new
simulator distribution just as faithfully as the old one learned the old
distribution. That is the point: retraining is how you adapt a model to a
distribution, not how you teach it physics.

That has a visible consequence in the product. The Fault Diagnosis page shows
the deterministic physics rules and the model's output side by side, as two
separate columns of evidence rather than one verdict. The
`physics_model_conflict` flag fires when they disagree 鈥?surfacing the
disagreement instead of resolving it silently in favour of whichever is more
confident. On a model with a 25.8 % false-alarm rate on healthy frames, deciding
by confidence would be the wrong rule.

Stating this is not a disclaimer bolted onto a demo. The whole site is built so
its numbers can be argued with 鈥?the Engineering page prints every equation with
the current operating point substituted in; the vibration limits declare which
ISO class they came from and that this asset is below the scope of ISO 20816-3. A
machine-learning stage that reported only its best figure would be the one part
of the system that could not be checked.

---

## How it holds together

**One source of truth for every physical constant.** `backend/app/config/` is
canonical. `scripts/export_parameters.py` projects it into
`frontend/src/lib/pumpParameters.generated.ts`, and a test fails the build if the
two diverge. Physical literals are not permitted in the frontend 鈥?the same
quantity living in two files, then being changed in one, was the defect class
that motivated the arrangement.

**One name for every field on the wire.** `backend/app/contracts.py` defines the
field names in transport, in storage and in the React types, and
`src/types/contracts.ts` mirrors it verbatim 鈥?no camelCase conversion, no
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
| Hosting | Netlify (static frontend) 路 Render free tier (API) |

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
  method, but has not been checked against the standard text 鈥?the limits are a
  matrix indexed by winding type and machine rating. A test asserts that the
  constant appears exactly once, so correcting it is a one-line change.
- **The classifier will not transfer.** See the third section above. The metrics
  bound what is achievable on this simulator; they say nothing about a real pump.
- **The API runs on a free tier.** First-call latency after a long idle period is
  a platform property, mitigated by scheduled warming and stated on the Settings
  page.
- **Temporal confirmation reuses polled predictions.** Diagnosis is polled every
  2.5 seconds while the debounce is driven by 5 Hz telemetry, so consecutive
  ticks are not independent classifier samples. Running prediction at 5 Hz was
  rejected: three independent samples would still be statistically weak, while
  the added inference load is unsuitable for the 0.1-CPU free instance.
- **The PLC layer is a software equivalent.** The state machine and interlocks
  are real and tested, but they run as Python, not as ladder or structured text
  on PLC hardware 鈥?so no scan-cycle timing, no I/O module behaviour and no
  fail-safe output state is being demonstrated.
- **Vibration limits are applied by analogy.** At roughly 294 W shaft power this
  asset falls below the scope of ISO 20816-3 (> 15 kW). ISO 20816-1 Class I
  boundaries are used, and the page says so.

---

## Author

**Ziyang Ou** 鈥?Master of Professional Engineering (Mechanical), Monash University
Research Assistant, Monash Centre for Additive Manufacturing

[LinkedIn](https://www.linkedin.com/in/ziyang-ou-a29aa2386) 路 ouziyoung@gmail.com

---

## Licence

[MIT](LICENSE)
