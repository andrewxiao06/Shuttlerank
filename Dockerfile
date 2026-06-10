# syntax=docker/dockerfile:1.6

# ---- Base ---------------------------------------------------------------
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps:
#   - build-essential / libpq-dev: needed if any wheel falls back to source
#   - curl: for healthcheck and debugging inside the container
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
 && rm -rf /var/lib/apt/lists/*


# ---- Dependencies -------------------------------------------------------
# Copy only requirements first so layer caches when source changes.
FROM base AS deps
COPY requirements.txt .
RUN pip install -r requirements.txt


# ---- Final --------------------------------------------------------------
FROM deps AS final
COPY . .

# Run as non-root for safety.
RUN useradd --create-home --uid 1001 brs \
 && chown -R brs:brs /app
USER brs

EXPOSE 8000

# Entrypoint applies migrations and then starts uvicorn.
CMD ["./scripts/entrypoint.sh"]
