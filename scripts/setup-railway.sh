#!/usr/bin/env bash
# Configure Railway env vars for Scraper-NBA after linking the service.
# Usage:
#   railway login
#   railway link          # select your NBAscraper5.0 service
#   export BALLDONTLIE_API_KEY=your-key
#   export HOOP_CENTRAL_API_URL=https://your-hoop-central-api.up.railway.app
#   export INGEST_API_KEY=your-key   # optional, if Hoop Central requires it
#   ./scripts/setup-railway.sh

set -euo pipefail

if ! command -v railway >/dev/null 2>&1; then
  echo "Installing Railway CLI..."
  npm install -g @railway/cli
fi

if ! railway whoami >/dev/null 2>&1; then
  echo "Not logged in. Run: railway login"
  exit 1
fi

: "${BALLDONTLIE_API_KEY:?Set BALLDONTLIE_API_KEY in your shell first}"

HOOP_CENTRAL_API_URL="${HOOP_CENTRAL_API_URL:-http://localhost:3001}"

echo "Setting Railway variables..."
railway variables set "HOOP_CENTRAL_API_URL=${HOOP_CENTRAL_API_URL}"
railway variables set "BALLDONTLIE_API_KEY=${BALLDONTLIE_API_KEY}"
railway variables set "SCRAPE_REQUEST_DELAY_MS=250"

if [[ -n "${INGEST_API_KEY:-}" ]]; then
  railway variables set "INGEST_API_KEY=${INGEST_API_KEY}"
fi

echo ""
echo "Done. Redeploy with: railway up"
echo "Or push to GitHub if the repo is connected to Railway."
echo ""
echo "Current service:"
railway status 2>/dev/null || true
