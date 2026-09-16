#!/usr/bin/env bash
# Full mock flow: create match → pay both → reveal connection once → second fetch consumed
# Also: cancel, expiry (DB backdate), shareUrls + jobBrief/handoffHint cleared after reveal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3847}"
BASE="${PUBLIC_BASE_URL:-http://127.0.0.1:$PORT}"
DB_PATH="${DB_PATH:-$ROOT/data/dry-run.db}"
export DB_PATH
# Force mock mode for dry-run (do not load live key)
unset XMRCHECKOUT_API_KEY || true
export CREW_MOCK_ONLY=1
export ALLOW_MOCK_PAY=true
export PORT
export PUBLIC_BASE_URL="http://127.0.0.1:$PORT"

rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"

# Free port if a stale Crew process is still bound (common on shared box)
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
  sleep 0.3
fi

# Start server in background
npx tsx src/index.ts > /tmp/crew-dry-run.log 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "Waiting for server on $BASE ..."
for i in $(seq 1 40); do
  if curl -sf "$BASE/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server died. Log:" >&2
    cat /tmp/crew-dry-run.log >&2
    exit 1
  fi
  if [[ $i -eq 40 ]]; then
    echo "Timeout waiting for health. Log:" >&2
    cat /tmp/crew-dry-run.log >&2
    exit 1
  fi
done

echo "=== 1) Create match (with brief + handoff hint) ==="
CREATE=$(curl -sf -X POST "$BASE/api/matches" \
  -H 'Content-Type: application/json' \
  -d '{"summary":"dry-run match","jobBrief":"secret brief for dry-run","handoffHint":"SimpleX: dry-run-contact-link"}')
echo "$CREATE" | tee /tmp/crew-create.json

MATCH_ID=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/crew-create.json","utf8")); if(!j.id) process.exit(1); console.log(j.id)')
INV1=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/crew-create.json","utf8")); console.log(j.invoices[0].id)')
INV2=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/crew-create.json","utf8")); console.log(j.invoices[1].id)')

node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-create.json","utf8"));
const s=j.shareUrls||{};
if(!s.contractor||!s.operator||!s.hub){console.error("missing shareUrls", j); process.exit(1)}
if(!s.contractor.includes("/m/"+j.id+"/contractor")){console.error("bad contractor url", s); process.exit(1)}
if(!s.operator.includes("/m/"+j.id+"/operator")){console.error("bad operator url", s); process.exit(1)}
if(!j.expiresAt){console.error("missing expiresAt on create", j); process.exit(1)}
console.log("shareUrls ok");
console.log("expiresAt:", j.expiresAt);
console.log("contractor:", s.contractor);
console.log("operator:", s.operator);
'

echo "Match: $MATCH_ID"
echo "Invoices: $INV1 , $INV2"

# Side pages should respond
curl -sf "$BASE/m/$MATCH_ID/contractor" | grep -q "Contractor page"
curl -sf "$BASE/m/$MATCH_ID/operator" | grep -q "Operator page"
curl -sf "$BASE/m/$MATCH_ID" | grep -q "Match hub"
echo "side + hub HTML ok"

echo "=== 2) Mock pay both ==="
curl -sf -X POST "$BASE/api/dev/pay/$INV1" | tee /tmp/crew-pay1.json
echo
curl -sf -X POST "$BASE/api/dev/pay/$INV2" | tee /tmp/crew-pay2.json
echo

echo "=== 3) First reveal (expect connection + brief cleared in response) ==="
FIRST=$(curl -sf "$BASE/api/matches/$MATCH_ID")
echo "$FIRST" | tee /tmp/crew-first.json
CODE=$(node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-first.json","utf8"));
if(!j.connection||!j.connection.code){console.error("missing connection on first reveal", j); process.exit(1)}
if(j.summary!=null||j.jobBrief!=null){console.error("summary/jobBrief should be cleared on reveal", j); process.exit(1)}
if(j.connection.handoffHint!=="SimpleX: dry-run-contact-link"){console.error("missing/wrong handoffHint on first reveal", j.connection); process.exit(1)}
if(!Array.isArray(j.connection.steps)||j.connection.steps.length<3){console.error("missing steps on first reveal", j.connection); process.exit(1)}
console.log(j.connection.code)
')
echo "CONNECTION_CODE=$CODE"

echo "=== 3b) DB brief + handoff hint cleared ==="
node -e '
const Database=require("better-sqlite3");
const db=new Database(process.env.DB_PATH);
const row=db.prepare("SELECT summary, job_brief, handoff_hint, connection_code, status FROM matches WHERE id=?").get(process.argv[1]);
if(!row){console.error("match missing"); process.exit(1)}
if(row.summary!=null||row.job_brief!=null||row.handoff_hint!=null||row.connection_code!=null){console.error("DB still has sensitive fields", row); process.exit(1)}
if(row.status!=="consumed"){console.error("expected consumed", row); process.exit(1)}
console.log("DB cleared ok (incl. handoff_hint)");
' "$MATCH_ID"

echo "=== 4) Second fetch (expect consumed, no connection) ==="
SECOND=$(curl -sf "$BASE/api/matches/$MATCH_ID")
echo "$SECOND" | tee /tmp/crew-second.json
node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/crew-second.json","utf8")); if(j.connection){console.error("connection still present", j); process.exit(1)} if(j.status!=="consumed"){console.error("expected consumed", j); process.exit(1)} console.log("status=consumed ok")'

echo "=== 5) Cancel match (open match) ==="
CREATE2=$(curl -sf -X POST "$BASE/api/matches" \
  -H 'Content-Type: application/json' \
  -d '{"summary":"cancel-me"}')
echo "$CREATE2" | tee /tmp/crew-create2.json
MATCH2=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/crew-create2.json","utf8")).id)')
CANCEL=$(curl -sf -X POST "$BASE/api/matches/$MATCH2/cancel")
echo "$CANCEL" | tee /tmp/crew-cancel.json
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-cancel.json","utf8"));
if(j.status!=="cancelled"){console.error("expected cancelled", j); process.exit(1)}
console.log("cancel ok");
'
STATUS2=$(curl -sf "$BASE/api/matches/$MATCH2")
node -e '
const j=JSON.parse(process.argv[1]);
if(j.status!=="cancelled"){console.error("GET after cancel", j); process.exit(1)}
console.log("GET status=cancelled ok");
' "$STATUS2"
# Mock pay on cancelled should refuse
INV_C=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/crew-create2.json","utf8")).invoices[0].id)')
HTTP_C=$(curl -s -o /tmp/crew-pay-cancelled.json -w "%{http_code}" -X POST "$BASE/api/dev/pay/$INV_C")
if [[ "$HTTP_C" != "409" ]]; then
  echo "expected 409 mock-pay on cancelled, got $HTTP_C" >&2
  cat /tmp/crew-pay-cancelled.json >&2
  exit 1
fi
echo "mock-pay refused on cancelled (409) ok"

echo "=== 6) Expiry (backdate expires_at) ==="
CREATE3=$(curl -sf -X POST "$BASE/api/matches" \
  -H 'Content-Type: application/json' \
  -d '{"summary":"expire-me"}')
echo "$CREATE3" | tee /tmp/crew-create3.json
MATCH3=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/crew-create3.json","utf8")).id)')
INV3A=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/crew-create3.json","utf8")).invoices[0].id)')
# Backdate invoice expiry into the past
node -e '
const Database=require("better-sqlite3");
const db=new Database(process.env.DB_PATH);
const past=new Date(Date.now()-60_000).toISOString();
db.prepare("UPDATE invoices SET expires_at=? WHERE match_id=?").run(past, process.argv[1]);
console.log("backdated expires_at to", past);
' "$MATCH3"
EXPIRED=$(curl -sf "$BASE/api/matches/$MATCH3")
echo "$EXPIRED" | tee /tmp/crew-expired.json
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-expired.json","utf8"));
if(j.status!=="expired"){console.error("expected expired", j); process.exit(1)}
if(!j.expiresAt){console.error("missing expiresAt", j); process.exit(1)}
console.log("status=expired ok, expiresAt=", j.expiresAt);
'
HTTP_E=$(curl -s -o /tmp/crew-pay-expired.json -w "%{http_code}" -X POST "$BASE/api/dev/pay/$INV3A")
if [[ "$HTTP_E" != "409" ]]; then
  echo "expected 409 mock-pay on expired, got $HTTP_E" >&2
  cat /tmp/crew-pay-expired.json >&2
  exit 1
fi
echo "mock-pay refused on expired (409) ok"

# Cancel consumed should 409
HTTP_CC=$(curl -s -o /tmp/crew-cancel-consumed.json -w "%{http_code}" -X POST "$BASE/api/matches/$MATCH_ID/cancel")
if [[ "$HTTP_CC" != "409" ]]; then
  echo "expected 409 cancel on consumed, got $HTTP_CC" >&2
  cat /tmp/crew-cancel-consumed.json >&2
  exit 1
fi
echo "cancel refused on consumed (409) ok"

echo
echo "DRY-RUN OK — connection on first reveal only: $CODE"
