#!/bin/bash
# Test MCP server endpoints

BASE_URL="https://harvest-mcp.southleft-llc.workers.dev"

echo "=== Testing MCP Server ==="
echo ""

# Test health
echo "1. Health check:"
curl -s "$BASE_URL/health" | jq .
echo ""

# Initialize session
echo "2. Initialize session:"
INIT_RESPONSE=$(curl -s -i -X POST "$BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-cli","version":"1.0"}},"id":1}')

# Extract session ID from x-harvest-session header (more reliable)
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "x-harvest-session:" | cut -d' ' -f2 | tr -d '\r\n')
echo "Session ID: $SESSION_ID"
echo "Response:"
echo "$INIT_RESPONSE" | tail -1 | jq .
echo ""

# List tools
echo "3. List tools:"
TOOLS_RESPONSE=$(curl -s -X POST "$BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "x-harvest-session: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}')

TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | jq '.result.tools | length')
echo "Tools available: $TOOL_COUNT"
echo "Tool names:"
echo "$TOOLS_RESPONSE" | jq -r '.result.tools[].name' | head -5
echo "..."
echo ""

# Call a tool (harvest_get_schema - doesn't require auth)
echo "4. Call harvest_get_schema tool:"
SCHEMA_RESPONSE=$(curl -s -X POST "$BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "x-harvest-session: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"harvest_get_schema","arguments":{"category":"time_tracking"}},"id":3}')

if echo "$SCHEMA_RESPONSE" | jq -e '.result' > /dev/null 2>&1; then
  echo "Tool call successful!"
  echo "Schema category: time_tracking"
  echo "$SCHEMA_RESPONSE" | jq -r '.result.content[0].text' | jq '.categories[0].entities[0].name'
else
  echo "Error: $SCHEMA_RESPONSE"
fi
echo ""

echo "=== Done ==="
