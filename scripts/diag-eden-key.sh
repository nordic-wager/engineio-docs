#!/bin/bash
# Diagnose the Eden API key situation end-to-end.
# This script will:
#   1. Prompt for the key (hidden input)
#   2. Test it against the live /v3/models endpoint
#   3. Send a real chat call to one free model
#   4. Print clear next steps
#
# Usage: ./diag-eden-key.sh

set -u

echo "=== Eden AI Key Diagnostic ==="
echo ""

# Read key securely (no echo)
read -s -p "Paste your Eden AI API key: " KEY
echo ""
echo ""

if [ -z "$KEY" ]; then
  echo "❌ No key provided"
  exit 1
fi

echo "--- Test 1: /v3/models with key (no auth expected, but VS Code will always send it) ---"
RESP=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $KEY" \
  -H "accept: application/json" \
  "https://api.edenai.run/v3/models")
HTTP=$(echo "$RESP" | grep -oE 'HTTP_STATUS:[0-9]+' | cut -d: -f2)
BODY=$(echo "$RESP" | sed 's/HTTP_STATUS:[0-9]*$//')
echo "HTTP $HTTP"
if [ "$HTTP" = "200" ]; then
  echo "✅ /v3/models accepted key (200)"
  COUNT=$(echo "$BODY" | jq -r '.data | length' 2>/dev/null)
  echo "   Catalog size: $COUNT models"
elif [ "$HTTP" = "401" ]; then
  echo "❌ /v3/models rejected key (401)"
  echo "   Body: $BODY"
  echo "   → Key is invalid or has been revoked."
  echo "   → Generate a new one at https://app.edenai.run"
  exit 1
else
  echo "⚠️  Unexpected HTTP $HTTP"
  echo "   Body: $BODY"
fi

echo ""
echo "--- Test 2: real chat call to a free model ---"
CHAT=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  "https://api.edenai.run/v3/chat/completions" \
  -d '{"model":"google/gemma-4-26b-a4b-it","messages":[{"role":"user","content":"Reply with just: OK"}],"max_tokens":8}')
HTTP=$(echo "$CHAT" | grep -oE 'HTTP_STATUS:[0-9]+' | cut -d: -f2)
BODY=$(echo "$CHAT" | sed 's/HTTP_STATUS:[0-9]*$//')
echo "HTTP $HTTP"
echo "Body: $BODY" | head -c 400
echo ""

if [ "$HTTP" = "200" ]; then
  CONTENT=$(echo "$BODY" | jq -r '.choices[0].message.content // "(no content)"' 2>/dev/null)
  echo ""
  echo "✅ Chat call worked!"
  echo "   Model said: $CONTENT"
  echo ""
  echo "=== NEXT STEP ==="
  echo "Key is good. The 401 in VS Code means the key in VS Code's secret"
  echo "storage is OUT OF SYNC with the key on Eden's side."
  echo ""
  echo "To sync, do ONE of these:"
  echo ""
  echo "A) In VS Code model picker, click the gear icon next to"
  echo "   'EdenAI (Free + Preview)' → 'Enter API Key' → paste this key"
  echo ""
  echo "B) Open Command Palette → 'Preferences: Configure Custom API Key'"
  echo "   → pick 'EdenAI' → paste this key"
  echo ""
  echo "Then Reload Window: Ctrl+Shift+P → Developer: Reload Window"
elif [ "$HTTP" = "401" ]; then
  echo ""
  echo "❌ Chat call rejected (401)"
  echo "   The key works for some endpoints but not chat,"
  echo "   OR the key is restricted to a specific tier / IP."
  echo "   Check Eden dashboard for account status."
else
  echo ""
  echo "⚠️  Unexpected status $HTTP"
fi
