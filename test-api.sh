#!/usr/bin/env bash
# Usage: ./test-api.sh [BASE_URL]
# Default BASE_URL: http://localhost:3000

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  local name="$1"
  local expected_status="$2"
  local actual_status="$3"
  local extra="$4"
  if [ "$actual_status" = "$expected_status" ]; then
    echo -e "${GREEN}PASS${NC} [$actual_status] $name $extra"
    ((PASS++))
  else
    echo -e "${RED}FAIL${NC} [$actual_status != $expected_status] $name $extra"
    ((FAIL++))
  fi
}

echo "=== photos-cdn API tests ==="
echo "Target: $BASE"
echo ""

# ── Settings ──────────────────────────────────────────────────────────────────

echo "--- Settings ---"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/settings")
check "GET /api/settings" 200 "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/settings" \
  -H "Content-Type: application/json" \
  -d '{}')
check "POST /api/settings (empty body)" 200 "$status"

# ── Queue / Images / Logs ─────────────────────────────────────────────────────

echo ""
echo "--- Data endpoints ---"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/images")
check "GET /api/images" 200 "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/queue")
check "GET /api/queue" 200 "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/logs")
check "GET /api/logs" 200 "$status"

# ── CDN — category/seed (no text) ─────────────────────────────────────────────
# Server returns 302 → R2/CDN URL (private bucket). Accept 302 as success.

echo ""
echo "--- CDN basic (category/seed) ---"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/800/600?category=nature&seed=1")
check "GET /api/cdn/800/600 category=nature → 302" "302" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/1280/720?category=technology&seed=42")
check "GET /api/cdn/1280/720 category=technology → 302" "302" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/640/480?category=food&seed=7&output=webp")
check "GET /api/cdn/640/480 output=webp → 302" "302" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/640/480?category=urban&output=png")
check "GET /api/cdn/640/480 output=png → 302" "302" "$status"

# ── CDN — text query (sync, may 202 if generating) ────────────────────────────

echo ""
echo "--- CDN text query ---"

response=$(curl -s -o /dev/null -w "%{http_code}" -L "$BASE/api/cdn/800/600?text=green+forest+nature")
check "GET /api/cdn text=green forest nature (200 or 202)" "200" "$response" "(got $response — 202 means async enqueued)"
# Accept 202 as valid too
if [ "$response" = "202" ]; then
  echo -e "  ${YELLOW}INFO${NC} Server returned 202 — image generating async"
  ((FAIL--)); ((PASS++))
fi

response=$(curl -s -o /dev/null -w "%{http_code}" -L "$BASE/api/cdn/400/300?text=office+workspace+desk")
check "GET /api/cdn text=office workspace (200 or 202)" "200" "$response"
if [ "$response" = "202" ]; then
  echo -e "  ${YELLOW}INFO${NC} Server returned 202 — image generating async"
  ((FAIL--)); ((PASS++))
fi

# ── CDN — special formats ─────────────────────────────────────────────────────

echo ""
echo "--- CDN special formats ---"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/800/600?category=nature&seed=1&format=blurhash")
check "GET /api/cdn format=blurhash → 200" "200" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/800/600?category=nature&seed=1&format=lqip")
# 200 when thumbnail variant exists, 302 when falling back to CDN url
if [ "$status" = "200" ] || [ "$status" = "302" ]; then
  echo -e "${GREEN}PASS${NC} [$status] GET /api/cdn format=lqip (200 or 302)"
  ((PASS++))
else
  check "GET /api/cdn format=lqip → 200 or 302" "200" "$status"
fi

# ── CDN — Prefer: respond-async ───────────────────────────────────────────────
# Use a unique prompt unlikely to be cached so server won't skip straight to 302

echo ""
echo "--- CDN async (Prefer: respond-async) ---"

ASYNC_TEXT="xzq-unique-$(date +%s)-nebula-test"

status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Prefer: respond-async" \
  "$BASE/api/cdn/800/600?text=$ASYNC_TEXT")
# 202 = enqueued, 302 = already cached (also acceptable)
if [ "$status" = "202" ]; then
  check "GET /api/cdn Prefer:respond-async → 202" "202" "$status"
elif [ "$status" = "302" ]; then
  echo -e "${GREEN}PASS${NC} [$status] GET /api/cdn Prefer:respond-async (302=already cached, valid)"
  ((PASS++))
else
  check "GET /api/cdn Prefer:respond-async → 202 or 302" "202" "$status"
fi

JOB_LOCATION=$(curl -s -D - -o /dev/null \
  -H "Prefer: respond-async" \
  "$BASE/api/cdn/800/600?text=$ASYNC_TEXT" 2>/dev/null \
  | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
if [ -n "$JOB_LOCATION" ]; then
  echo -e "${GREEN}PASS${NC} Location header present: $JOB_LOCATION"
  ((PASS++))

  # Only poll if location is an internal /api/ status path
  if [[ "$JOB_LOCATION" == /api/* ]]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$JOB_LOCATION")
    check "GET $JOB_LOCATION (status poll)" "202" "$status" "(202=pending, 303=done)"
    if [ "$status" = "303" ]; then
      echo -e "  ${YELLOW}INFO${NC} Already done — redirecting to final"
      ((FAIL--)); ((PASS++))
    fi
  else
    echo -e "${GREEN}PASS${NC} Location is final CDN URL (already resolved): $JOB_LOCATION"
    ((PASS++))
  fi
else
  echo -e "${RED}FAIL${NC} No Location header in async response"
  ((FAIL++))
fi

# ── srcset ────────────────────────────────────────────────────────────────────

echo ""
echo "--- srcset ---"

body=$(curl -s "$BASE/api/cdn/srcset?category=nature&seed=1")
has_srcset=$(echo "$body" | grep -c '"srcset"' || true)
if [ "$has_srcset" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} GET /api/cdn/srcset returns srcset field"
  ((PASS++))
else
  echo -e "${RED}FAIL${NC} GET /api/cdn/srcset missing srcset field: $body"
  ((FAIL++))
fi

SRCSET_TEXT="xzq-unique-$(date +%s)-srcset-test"

status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Prefer: respond-async" \
  "$BASE/api/cdn/srcset?text=$SRCSET_TEXT")
if [ "$status" = "202" ]; then
  check "GET /api/cdn/srcset Prefer:respond-async → 202" "202" "$status"
elif [ "$status" = "200" ]; then
  echo -e "${GREEN}PASS${NC} [$status] GET /api/cdn/srcset Prefer:respond-async (200=already cached, valid)"
  ((PASS++))
else
  check "GET /api/cdn/srcset Prefer:respond-async → 202 or 200" "202" "$status"
fi

SRCSET_JOB=$(curl -s -D - -o /dev/null \
  -H "Prefer: respond-async" \
  "$BASE/api/cdn/srcset?text=$SRCSET_TEXT" 2>/dev/null \
  | grep -i "^location:" | tr -d '\r' | awk '{print $2}')
if [ -n "$SRCSET_JOB" ] && [[ "$SRCSET_JOB" == /api/* ]]; then
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$SRCSET_JOB")
  check "GET $SRCSET_JOB (srcset status poll)" "202" "$status" "(202=pending, 200=done)"
fi

# ── Error cases ───────────────────────────────────────────────────────────────

echo ""
echo "--- Error cases ---"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/800/600/status/nonexistent-job-id?text=test")
check "GET /api/cdn/status invalid jobId → 202" "202" "$status"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cdn/800/600/status/nonexistent-job-id")
check "GET /api/cdn/status missing text param → 400" "400" "$status"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "=============================="
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
