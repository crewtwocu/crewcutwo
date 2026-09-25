#!/usr/bin/env bash
# Full mock flow: create match → pay both → dual-party grace reveal → wipe after grace
# Also: pre-pay brief redact, cancel, expiry (DB backdate), shareUrls.
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

echo "=== 2) Pre-pay: brief redacted on GET ==="
PRE=$(curl -sf "$BASE/api/matches/$MATCH_ID")
echo "$PRE" | tee /tmp/crew-pre.json
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-pre.json","utf8"));
if(j.jobBrief!=null){console.error("jobBrief must be redacted pre-pay", j); process.exit(1)}
if(j.summary!=null){console.error("summary must be redacted pre-pay", j); process.exit(1)}
if(j.jobBriefPresent!==true){console.error("expected jobBriefPresent true", j); process.exit(1)}
console.log("pre-pay redact ok (jobBriefPresent=true)");
'

echo "=== 3) Mock pay both ==="
curl -sf -X POST "$BASE/api/dev/pay/$INV1" | tee /tmp/crew-pay1.json
echo
curl -sf -X POST "$BASE/api/dev/pay/$INV2" | tee /tmp/crew-pay2.json
echo

echo "=== 4) First reveal (contractor) — connection + jobBrief in payload ==="
FIRST=$(curl -sf "$BASE/api/matches/$MATCH_ID?side=contractor")
echo "$FIRST" | tee /tmp/crew-first.json
CODE=$(node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-first.json","utf8"));
if(!j.connection||!j.connection.code){console.error("missing connection on first reveal", j); process.exit(1)}
if(j.summary!=null||j.jobBrief!=null){console.error("top-level summary/jobBrief should stay null", j); process.exit(1)}
if(j.connection.jobBrief!=="secret brief for dry-run"){console.error("missing/wrong connection.jobBrief", j.connection); process.exit(1)}
if(j.connection.handoffHint!=="SimpleX: dry-run-contact-link"){console.error("missing/wrong handoffHint on first reveal", j.connection); process.exit(1)}
if(!Array.isArray(j.connection.steps)||j.connection.steps.length<3){console.error("missing steps on first reveal", j.connection); process.exit(1)}
if(j.status!=="consumed"){console.error("expected consumed after reveal", j); process.exit(1)}
console.log(j.connection.code)
')
echo "CONNECTION_CODE=$CODE"

echo "=== 4b) During grace: secrets still in DB ==="
node -e '
const Database=require("better-sqlite3");
const db=new Database(process.env.DB_PATH);
const row=db.prepare("SELECT summary, job_brief, handoff_hint, connection_code, status, reveal_until FROM matches WHERE id=?").get(process.argv[1]);
if(!row){console.error("match missing"); process.exit(1)}
if(!row.connection_code||!row.job_brief||!row.handoff_hint){console.error("expected secrets retained during grace", row); process.exit(1)}
if(row.status!=="consumed"){console.error("expected consumed", row); process.exit(1)}
if(!row.reveal_until||new Date(row.reveal_until).getTime()<=Date.now()){console.error("expected future reveal_until", row); process.exit(1)}
console.log("grace retain ok, reveal_until=", row.reveal_until);
' "$MATCH_ID"

echo "=== 5) Second fetch (operator) — same connection during grace ==="
SECOND=$(curl -sf "$BASE/api/matches/$MATCH_ID?side=operator")
echo "$SECOND" | tee /tmp/crew-second.json
node -e '
const first=JSON.parse(require("fs").readFileSync("/tmp/crew-first.json","utf8"));
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-second.json","utf8"));
if(!j.connection||!j.connection.code){console.error("missing connection on second (grace) reveal", j); process.exit(1)}
if(j.connection.code!==first.connection.code){console.error("code mismatch", first.connection.code, j.connection.code); process.exit(1)}
if(j.connection.jobBrief!=="secret brief for dry-run"){console.error("missing jobBrief on second reveal", j.connection); process.exit(1)}
if(j.status!=="consumed"){console.error("expected consumed", j); process.exit(1)}
console.log("dual-party grace reveal ok");
'

echo "=== 5b) Hub fetch also gets connection during grace ==="
HUB=$(curl -sf "$BASE/api/matches/$MATCH_ID")
node -e '
const first=JSON.parse(require("fs").readFileSync("/tmp/crew-first.json","utf8"));
const j=JSON.parse(process.argv[1]);
if(!j.connection||j.connection.code!==first.connection.code){console.error("hub missing connection during grace", j); process.exit(1)}
console.log("hub grace reveal ok");
' "$HUB"

echo "=== 5c) After grace (backdate reveal_until) — wiped ==="
node -e '
const Database=require("better-sqlite3");
const db=new Database(process.env.DB_PATH);
const past=new Date(Date.now()-1000).toISOString();
db.prepare("UPDATE matches SET reveal_until=? WHERE id=?").run(past, process.argv[1]);
console.log("backdated reveal_until to", past);
' "$MATCH_ID"
THIRD=$(curl -sf "$BASE/api/matches/$MATCH_ID")
echo "$THIRD" | tee /tmp/crew-third.json
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/crew-third.json","utf8"));
if(j.connection){console.error("connection still present after grace", j); process.exit(1)}
if(j.status!=="consumed"){console.error("expected consumed", j); process.exit(1)}
if(j.jobBriefPresent!==false){console.error("expected jobBriefPresent false after wipe", j); process.exit(1)}
console.log("post-grace wipe ok");
'
node -e '
const Database=require("better-sqlite3");
const db=new Database(process.env.DB_PATH);
const row=db.prepare("SELECT summary, job_brief, handoff_hint, connection_code, status FROM matches WHERE id=?").get(process.argv[1]);
if(row.summary!=null||row.job_brief!=null||row.handoff_hint!=null||row.connection_code!=null){console.error("DB still has sensitive fields after grace", row); process.exit(1)}
console.log("DB cleared ok after grace");
' "$MATCH_ID"

echo "=== 6) Cancel match (open match) ==="
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

echo "=== 7) Expiry (backdate expires_at) ==="
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
echo "DRY-RUN OK — dual-party grace reveal + wipe: $CODE"
