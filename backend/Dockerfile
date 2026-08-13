# PumpGuard DT backend.
#
# Slim rather than alpine: numpy/scipy/scikit-learn ship manylinux wheels that
# alpine's musl libc cannot use, so alpine would trigger a source build of the
# whole scientific stack and turn a 90-second deploy into a 20-minute one.
FROM python:3.12-slim

# PYTHONUNBUFFERED so container logs appear in the host's log viewer in real
# time instead of being held in a buffer until the process exits.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    DATA_SOURCE=SIMULATION

WORKDIR /app

# Requirements first, as their own layer: application code changes on every
# push, requirements rarely do, so this keeps the dependency layer cached.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Train and persist the ML artefacts at BUILD time, not at startup. Training on
# boot would add tens of seconds to every cold start and, worse, would retrain
# per instance, so two instances could disagree about the same input. The model
# is a build artefact; the running service only loads it.
RUN python -m app.ml.train --output models || \
    echo "WARNING: model training step skipped or failed; backend will start in physics-only mode"

# Render/Railway/Fly inject the port to bind. Defaulting to 8000 keeps local
# `docker run` working unchanged.
ENV PORT=8000
EXPOSE 8000

# Single worker on purpose. Simulation sessions live in process memory, so a
# second worker would own a different set of sessions and a visitor's WebSocket
# could land on the worker that has never heard of their session. Scaling out
# requires moving session state to Redis first -- see docs/deployment.md.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips '*'"]
