#!/bin/bash
# Test each EdenAI model with a real API key.
# Usage: EDENAI_KEY=sk-... ./test-edenai.sh
#
# Output:
#   ✅ WORKS  - 200 + valid choices array
#   ❌ AUTH   - 401 (key problem, not model)
#   ❌ 404    - model not found
#   ❌ 5xx    - server-side failure (the 500 problem)
#   ⚠️  OTHER - other status codes

set -u

if [ -z "${EDENAI_KEY:-}" ]; then
  echo "Set EDENAI_KEY first, e.g.:"
  echo "  EDENAI_KEY=sk-... $0"
  exit 1
fi

CONFIG="${1:-.vscode/chatLanguageModels.json}"
URL="https://api.edenai.run/v3/chat/completions"

ok=0; auth=0; notfound=0; servererr=0; other=0
failed_models=()

mapfile -t ids < <(jq -r '.[3].models[].id' "$CONFIG")

for id in "${ids[@]}"; do
  body=$(curl -sS -w "\n%{http_code}" -H "Authorization: Bearer $EDENAI_KEY" \
    -H "content-type: application/json" \
    "$URL" \
    -d "{\"model\":\"$id\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":4}")
  http=$(echo "$body" | tail -n1)
  json=$(echo "$body" | sed '$d')

  if [ "$http" = "200" ] && echo "$json" | jq -e '.choices[0].message' >/dev/null 2>&1; then
    ok=$((ok+1))
    printf "  ✅ %s\n" "$id"
  elif [ "$http" = "401" ]; then
    auth=$((auth+1))
  elif [ "$http" = "404" ] || echo "$json" | grep -qi "not found\|unknown model"; then
    notfound=$((notfound+1))
    printf "  ❌ NOT FOUND: %s -> %s\n" "$id" "$json"
    failed_models+=("$id (404)")
  elif [ "$http" -ge 500 ] 2>/dev/null; then
    servererr=$((servererr+1))
    printf "  ❌ %s: %s -> %s\n" "$http" "$id" "$json"
    failed_models+=("$id ($http)")
  else
    other=$((other+1))
    printf "  ⚠️  %s: %s -> %s\n" "$http" "$id" "$json"
    failed_models+=("$id ($http)")
  fi
done

echo ""
echo "=== Summary ==="
echo "  ✅ Works:       $ok"
echo "  ❌ Auth fail:   $auth (key problem, not model)"
echo "  ❌ Not found:   $notfound"
echo "  ❌ Server err:  $servererr"
echo "  ⚠️  Other:       $other"
echo "  Total:          ${#ids[@]}"

if [ ${#failed_models[@]} -gt 0 ]; then
  echo ""
  echo "=== Failed models (paste these back to me) ==="
  printf '  %s\n' "${failed_models[@]}"
fi
