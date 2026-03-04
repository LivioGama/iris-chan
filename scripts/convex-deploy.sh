#!/bin/bash
# Deploy Convex functions to self-hosted backend
# Usage: ./scripts/convex-deploy.sh
#
# Why pinned CLI version?
# Self-hosted backend (latest: 2025-09-03) only supports deploy1 API.
# CLI v1.27+ uses deploy2 API. So we pin to v1.26.0.
# When a new self-hosted release ships with deploy2, update CLI version here.

set -euo pipefail

CONVEX_CLI_VERSION="1.26.0"
BACKEND_URL="https://backend-iris.devliv.io"

# Generate fresh admin key from container
ADMIN_KEY=$(ssh netcup "sudo docker exec backend-pg8g88kcc840wk0kkk4o8g8o /convex/generate_admin_key.sh 2>/dev/null" | head -1)

if [ -z "$ADMIN_KEY" ]; then
  echo "❌ Failed to generate admin key. Is the Convex backend running?"
  exit 1
fi

echo "🚀 Deploying to $BACKEND_URL with convex@$CONVEX_CLI_VERSION"

# Create clean env file (no CONVEX_DEPLOY_KEY or CONVEX_DEPLOYMENT which conflict)
TMPENV=$(mktemp)
echo "CONVEX_SELF_HOSTED_URL=$BACKEND_URL" > "$TMPENV"
echo "CONVEX_SELF_HOSTED_ADMIN_KEY=$ADMIN_KEY" >> "$TMPENV"

# Strip conflicting vars from shell + .env files
env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT \
  npx "convex@$CONVEX_CLI_VERSION" deploy \
    --typecheck disable \
    -y \
    --env-file "$TMPENV" 2>&1

rm -f "$TMPENV"
echo "✅ Done"
