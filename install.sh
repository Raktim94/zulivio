#!/usr/bin/env bash
# One-click installer for Zulivio.
#
# Run this from the repo root after cloning:
#   ./install.sh
#
# Generates a .env with a random Postgres password (only if one doesn't
# already exist), builds the backend + web Docker images, starts the stack,
# and waits for the app to come online (the `migrate` service applies
# database migrations automatically before `backend` starts). Safe to
# re-run any time (e.g. after `git pull`, to rebuild) — nothing here
# overwrites an existing .env or destroys existing data.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# --- 1. Check prerequisites -------------------------------------------------
# Docker Engine must be installed and the `docker compose` plugin available
# (it ships by default with current Docker Desktop / Docker Engine).
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed." >&2
  echo "Install it from https://docs.docker.com/get-docker/ and re-run this script." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: the 'docker compose' plugin was not found." >&2
  echo "Update Docker Desktop/Engine to a version that bundles Compose v2." >&2
  exit 1
fi

# --- 2. Generate .env if one doesn't exist already --------------------------
# A one-click install can't ask you to hand-edit POSTGRES_PASSWORD first —
# compose.yaml has no insecure default, it fails loudly instead — so
# generate a real random value here. Never overwrites an existing .env, so
# re-running this script is safe.
if [ ! -f .env ]; then
  echo "No .env found — generating one with a random Postgres password..."
  if command -v openssl >/dev/null 2>&1; then
    pg_password="$(openssl rand -hex 16)"
  else
    pg_password="$(head -c24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c32)"
  fi
  cat > .env <<EOF
POSTGRES_PASSWORD=${pg_password}
FRONTEND_ORIGIN=http://localhost:3100
HOST_PORT=3100
BOOTSTRAP_DISABLED=false
GOOGLE_SHEETS_CLIENT_EMAIL=
GOOGLE_SHEETS_PRIVATE_KEY=
EOF
  echo ".env created with a generated POSTGRES_PASSWORD."
fi

# --- 3. Build the images and start the stack --------------------------------
echo "Building Zulivio images and starting the stack (this can take a few minutes on first run)..."
docker compose up -d --build

# --- 4. Wait for the app to report healthy ----------------------------------
# By the time /api/health/ready returns 200, the `migrate` service has
# already applied all migrations (backend only starts once migrate exits 0).
HOST_PORT="$(grep -m1 '^HOST_PORT=' .env 2>/dev/null | cut -d= -f2-)"
HOST_PORT="${HOST_PORT:-3100}"

echo "Waiting for the app to come online..."
ready=false
for _ in $(seq 1 90); do
  if curl -sf "http://localhost:${HOST_PORT}/api/health/ready" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [ "$ready" != "true" ]; then
  echo "Warning: the app didn't respond within 90s. Check the logs with:" >&2
  echo "  docker compose logs" >&2
  exit 1
fi

# --- 5. Done -----------------------------------------------------------------
echo ""
echo "Zulivio is up and running."
echo "Open http://localhost:${HOST_PORT}/setup to create your organization and Master Owner account."
