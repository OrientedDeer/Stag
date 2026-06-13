#!/usr/bin/env bash
# Stag self-hosting deploy: pull the repo, rebuild + restart the Compose stack
# (CouchDB + backend + frontend, plus the optional Cloudflare tunnel), and
# verify the site is serving.
#
# This script lives in the repo (selfhost/deploy.sh) and uses only paths
# relative to itself, so it works for any checkout. Machine-specific values
# (secrets, public origin) come from selfhost/.env — never hard-coded here.
#
# Usage:  deploy.sh            # pull + rebuild + verify (default)
#         deploy.sh --no-pull  # rebuild from the current checkout, skip git pull
set -euo pipefail

SELFHOST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SELFHOST_DIR/.." && pwd)"
PROFILE_ARGS=(--profile tunnel)

DO_PULL=1
[[ "${1:-}" == "--no-pull" ]] && DO_PULL=0

if [[ ! -f "$SELFHOST_DIR/.env" ]]; then
  echo "!! $SELFHOST_DIR/.env not found — copy .env.example to .env and fill it in." >&2
  exit 1
fi

if [[ "$DO_PULL" == "1" ]]; then
  echo "==> pulling $REPO_ROOT"
  git -C "$REPO_ROOT" fetch --quiet origin
  # Refuse to clobber local changes — bail loudly instead.
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    echo "    !! working tree dirty — refusing to pull. Resolve manually:" >&2
    git -C "$REPO_ROOT" status --short >&2
    exit 1
  fi
  git -C "$REPO_ROOT" pull --ff-only
  echo "    now at: $(git -C "$REPO_ROOT" log -1 --oneline)"
fi

cd "$SELFHOST_DIR"

echo "==> rebuilding + restarting compose stack"
docker compose "${PROFILE_ARGS[@]}" up -d --build

echo "==> container status"
docker compose "${PROFILE_ARGS[@]}" ps --format "table {{.Name}}\t{{.Status}}"

# Public URL for the health check comes from CORS_ORIGIN in .env (the app origin).
echo "==> verifying public endpoint"
PUBLIC_URL="$(grep -E '^CORS_ORIGIN=' .env | head -1 | cut -d= -f2-)"
PUBLIC_URL="${PUBLIC_URL%/}/"
if [[ -z "$PUBLIC_URL" || "$PUBLIC_URL" == "/" ]]; then
  echo "    (CORS_ORIGIN not set in .env — skipping public check; verify manually)"
  exit 0
fi
code=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL" || echo "000")
echo "    $PUBLIC_URL -> $code"
if [[ "$code" == "200" ]]; then
  echo "==> OK: Stag is serving."
else
  echo "!! WARNING: public endpoint returned $code (expected 200)" >&2
  exit 1
fi
