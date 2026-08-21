# Deployment — PumpGuard DT

The target is the acceptance test: a recruiter opens a URL from a CV, on a phone
or an unfamiliar laptop, and the platform works. No install, no login, no clone.

## Why two hosts

| Part | Nature | Host | Cold start |
|---|---|---|---|
| Frontend | static files after `vite build` | Netlify (CDN) | none |
| Backend | long-lived process, WebSocket, in-memory sessions | Render (container) | yes on free tier |

Serving the built frontend from FastAPI would be simpler, but it would put the
landing page behind the backend's cold start. Splitting them means the page a
recruiter first sees is instant, and the backend can wake up behind it while the
recorded-demo fallback keeps every screen populated.

---

## Step 1 — GitHub

The `gh` CLI is not installed on this machine, so create the repository through
the web UI.

1. Create an empty repo at <https://github.com/new> named `pumpguard-dt`.
   Do not add a README, .gitignore or licence — the repo already has them.
2. From `D:\PumpGuardDT`:

```bash
git add -A
git commit -m "PumpGuard DT: motor-pump digital twin and predictive maintenance platform"
git branch -M main
git remote add origin https://github.com/<your-username>/pumpguard-dt.git
git push -u origin main
```

If the push asks for a password, use a Personal Access Token
(<https://github.com/settings/tokens>, scope `repo`), not your account password —
GitHub stopped accepting passwords over HTTPS in 2021.

---

## Step 2 — Backend on Render

1. Sign in at <https://render.com> with the GitHub account.
2. **New → Blueprint**, select the `pumpguard-dt` repo. Render reads
   `render.yaml` and configures the service itself.
3. Leave `BACKEND_CORS_ORIGINS` empty for now — the frontend URL does not exist
   yet. Deploy.
4. Note the URL, e.g. `https://pumpguard-dt-api.onrender.com`.
5. Check it is alive:

```bash
curl https://pumpguard-dt-api.onrender.com/api/health
```

Expect `{"status":"ok", ...}`. The first request after idling takes ~50 s on the
free plan; that is the cold start, not a failure.

---

## Step 3 — Frontend on Netlify

1. Sign in at <https://netlify.com> with GitHub.
2. **Add new site → Import an existing project**, pick `pumpguard-dt`.
   `netlify.toml` at the repository ROOT supplies the base directory
   (`frontend`), the build command and the publish directory, so accept what it
   shows. It has to be at the root: Netlify reads netlify.toml from the base
   directory, and it does not know the base is `frontend` until it has read the
   file. A copy inside `frontend/` is never found and every setting in it is
   silently ignored — which is where this file sat until the first real deploy.
3. Set the environment variables **before** the first build, under
   Site configuration → Environment variables:

```
VITE_API_BASE_URL = https://pumpguard-dt-api.onrender.com
VITE_WS_URL       = wss://pumpguard-dt-api.onrender.com
```

   `wss://`, not `ws://`. The page is served over HTTPS, and a browser blocks a
   plaintext WebSocket from a secure page as mixed content — the connection
   fails silently with nothing useful in the console.
4. Set the site name under Site configuration → Change site name. Use
   `pumpguard-dt`. Note that `pumpguard.netlify.app` is already taken by an
   unrelated project — Netlify subdomains are global and first-come.
5. Deploy. The URL is then `https://ziyangou-pumpguard-dt.netlify.app`.

---

## Step 4 — Close the CORS loop

Back on Render, set:

```
BACKEND_CORS_ORIGINS = https://ziyangou-pumpguard-dt.netlify.app
```

Exact origin, no trailing slash, no wildcard. A wildcard is refused by the
browser on credentialed requests and would also let any website drive the API.
Redeploy the backend.

Then hard-refresh the frontend. If charts stay empty, open the browser console:
a CORS rejection names the blocked origin explicitly, and the fix is almost
always a trailing slash or `http` vs `https` in this variable.

---

## Step 5 — Verify as a stranger

Use a private/incognito window, so nothing depends on local storage or a warm
cache:

1. Open the Netlify URL — landing page appears.
2. Launch Interactive Demo → Start the pump.
3. Dashboard shows live RPM, flow, pressure, current, vibration.
4. Vibration Analysis → inject imbalance → the 1x peak grows.
5. Pump Performance → close the valve → the operating point moves along the
   pump curve and flow falls.
6. Inject cavitation → broadband vibration rises, NPSH margin goes negative,
   diagnosis changes, health index drops, an alarm is raised.
7. E-STOP → state becomes E_STOP and START is refused by the interlock.
8. Alarms page shows the history; Maintenance generates a work order.
9. Refresh the page mid-run — the app must recover, not white-screen.

---

## Cold start, and what to do about it before applying for jobs

Render's free plan sleeps a service after ~15 minutes idle. The next visitor
waits ~50 seconds. A recruiter will not wait 50 seconds.

Three honest options:

1. **Render Starter, ~US$7/month.** No sleeping. The right answer while
   actively applying; cancel afterwards.
2. **Keep the free plan and rely on the fallback.** The frontend ships a
   recorded dataset and renders it immediately, labelled "Recorded Demo", while
   the backend wakes in the background and takes over when it responds. Nothing
   is ever blank and nothing pretends to be live. This is the default.
3. **An uptime pinger** every 10 minutes. `.github/workflows/keep-alive.yml`
   does this and it is enabled. It works, and the cost is real: it burns the
   free plan's monthly instance hours, and Render's terms discourage keeping a
   free service awake artificially. It is in the repo because the alternative
   during a job search is a recruiter meeting a 50-second wait — but it is a
   workaround for being on the free plan, not a substitute for option 1. If the
   instance hours run out before the month ends, disable the workflow rather
   than wondering why the service stopped.

Do not solve this by faking the data. A recorded demo labelled as recorded is
honest; a "live" screen driven by a canned array is not, and an interviewer who
opens the network tab will see it.

---

## Environment variables

### Backend
| Variable | Purpose | Example |
|---|---|---|
| `APP_ENV` | environment name | `production` |
| `DATA_SOURCE` | which provider feeds the pipeline | `SIMULATION` |
| `BACKEND_CORS_ORIGINS` | exact allowed origins, comma-separated | `https://ziyangou-pumpguard-dt.netlify.app` |
| `DATABASE_URL` | historian storage | `sqlite:///./data/pumpguard.db` |
| `PORT` | injected by the host | `8000` |

### Frontend (build time — Vite inlines these, so a change needs a rebuild)
| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | HTTPS base for the REST API |
| `VITE_WS_URL` | WSS base for `/ws/realtime` |

`VITE_*` values are compiled into the bundle and are publicly readable. Never
put a secret in one.

---

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Charts empty, console shows CORS | `BACKEND_CORS_ORIGINS` wrong | exact origin, no trailing slash |
| WebSocket never connects on HTTPS | `ws://` instead of `wss://` | fix `VITE_WS_URL`, rebuild |
| Blank page after a deploy | `index.html` was cached | already handled by the no-cache header in `netlify.toml` |
| 404 on refresh at `/dashboard` | SPA redirect missing | the `/*` → `/index.html` 200 rule |
| First load takes ~50 s | free-plan cold start | see above |
| Values freeze after a while | WebSocket dropped | client reconnects with backoff; verify it did |
| Everyone sees the same fault | session state shared | sessions are per-visitor; check the session id is being sent |

## Rollback

Both hosts keep previous deploys. Render: Events → the last good deploy →
Rollback. Netlify: Deploys → the last good deploy → Publish deploy. Neither
needs a git revert, so recovery does not depend on rebuilding anything.

## Scaling beyond one instance

Simulation sessions live in process memory, so the container runs a single
worker: a second worker would own different sessions and a visitor's WebSocket
could reach the one that has never heard of theirs. Moving sessions to Redis is
the prerequisite for more than one instance. For a portfolio demo, one instance
is correct and cheaper.
