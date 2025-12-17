#!/bin/bash
# Set Cloudflare Workers secrets from .env file
# Usage: ./scripts/set-secrets.sh

set -e

# Load .env file
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

echo "Setting Cloudflare Workers secrets..."

# Set HARVEST_CLIENT_ID
if [ -n "$HARVEST_CLIENT_ID" ]; then
  echo "$HARVEST_CLIENT_ID" | npx wrangler secret put HARVEST_CLIENT_ID
  echo "✓ HARVEST_CLIENT_ID set"
else
  echo "✗ HARVEST_CLIENT_ID not found in .env"
fi

# Set HARVEST_CLIENT_SECRET
if [ -n "$HARVEST_CLIENT_SECRET" ]; then
  echo "$HARVEST_CLIENT_SECRET" | npx wrangler secret put HARVEST_CLIENT_SECRET
  echo "✓ HARVEST_CLIENT_SECRET set"
else
  echo "✗ HARVEST_CLIENT_SECRET not found in .env"
fi

# Set SESSION_SECRET
if [ -n "$SESSION_SECRET" ]; then
  echo "$SESSION_SECRET" | npx wrangler secret put SESSION_SECRET
  echo "✓ SESSION_SECRET set"
else
  echo "✗ SESSION_SECRET not found in .env"
fi

echo ""
echo "Done! Secrets have been set for the harvest-mcp worker."
echo "You can now deploy with: npm run deploy"
