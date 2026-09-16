# Crew app — match + payments MVP

Functional MVP: create a match, collect **$5 from each side** (contractor + operator), then reveal a **one-time connection code** once. After reveal, the secret, any job brief / summary, and optional **handoff hint** are cleared from SQLite (anonymity).

Marketing site lives at `../marketing/` (not rebuilt here).

## Stack

- Node.js + TypeScript + Express
- SQLite via `better-sqlite3`
- Plain HTML create / hub / per-side pages with auto-poll

## Quick start (mock)

```bash
cd .
npm install
npm run dev
```

Open http://localhost:3847

Or one-shot:

```bash
npm run dry-run
```

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** for Origin namespace (`crew` / `crew2cU`), prod env (`XMRCHECKOUT_*`, `PUBLIC_BASE_URL`, `CREW_MOCK_ONLY` off), marketing `CREW_APP_URL`, Compose, and the go-live checklist.

## Docker demo (one command)

Requires Docker + Compose on the host (`docker compose config` validates the file). If Docker is missing on a machine, the files still ship; install Docker to run the demo. From this directory:

```bash
cd .
docker compose up --build
```

| Service | URL |
|---------|-----|
| Match app | http://localhost:3847 |
| Marketing (`conduit-landing` via nginx) | http://localhost:8080 |

Defaults are **mock-safe**: `CREW_MOCK_ONLY=1`, no API keys baked into the image. SQLite persists in a named volume (`crew-data`).

Marketing CTAs use `window.CREW_APP_URL` in `../marketing/config.js`. For Compose on your machine, keep it as `http://localhost:3847` (or `http://127.0.0.1:3847`).

### Live key (optional)

Do **not** put secrets in the Dockerfile. Compose substitutes from a local gitignored `.env`:

```bash
cp .env.example .env
# edit: XMRCHECKOUT_API_KEY=... and CREW_MOCK_ONLY=0
docker compose up --build
```

When a live key is set, mock pay is disabled unless `ALLOW_MOCK_PAY=true`.

Match-only (skip marketing):

```bash
docker compose up --build match
```

Dry-run outside Docker is unchanged: `npm run dry-run` / `CREW_MOCK_ONLY=1 npm run dev`.

## Share-link flow

1. **Create** a match on `/` (optional summary, job brief, and handoff hint — how the other side should reach you after both pay). Marketing deep links: `/?role=contractor` (you’re a contractor looking for work → emphasise operator share link) and `/?role=operator` (you’re an operator posting work → emphasise contractor share link); omit or unknown = neutral form.
2. You get **two share URLs** — send each party only their own:
   - `/m/:id/contractor` — contractor pay button + status
   - `/m/:id/operator` — operator pay button + status
3. Hub `/m/:id` lists both links and overall status (no need for both parties to open it).
4. Side pages and hub **poll** `GET /api/matches/:id` every ~3s until status is `ready`, `consumed`, `expired`, or `cancelled`. In **live** mode that GET also syncs confirmed XMR Checkout invoices (pending non-`mock_` ids via public poll) before returning status — so the UI notices real payments without calling `POST /api/dev/poll/:invoiceId`.
5. When both have paid, the first successful status fetch reveals the connection once (code + optional handoff hint + steps); brief/summary/secret/hint are wiped.

Browser try:

1. `CREW_MOCK_ONLY=1 npm run dev`
2. Open http://localhost:3847 → Create match → copy the two side links
3. Open each side link (two tabs), mock-pay $5 on each
4. Watch either page: status updates, then the connection code appears once

## Expiry + cancel

- Each invoice stores **`expires_at`** (default **~1 hour** from create, similar to XMR Checkout’s pay window). Override with `INVOICE_TTL_SECONDS` (seconds).
- If any unpaid invoice is past `expires_at` while the match is still open, status becomes **`expired`** (checked on read and before mock-pay).
- Hub / side UI shows expiry time (and a live countdown via poll). Pay buttons are hidden / discouraged when expired or cancelled.
- Mock-pay and webhooks refuse payment on expired / cancelled / consumed matches (`409` for mock-pay).
- **`POST /api/matches/:id/cancel`** — only while not both-paid and not consumed (also refused if already expired). Hub has a Cancel button with confirm.
- Status enum: `pending_payment` | `partial` | `ready` | `consumed` | `expired` | `cancelled`.

Manual expiry check (if not using dry-run step 6): create a match, backdate `invoices.expires_at` in SQLite, then `GET /api/matches/:id` — expect `"status":"expired"`.

## Rate limit

`POST /api/matches` (and HTML `POST /create`) are limited to **~10 creates per IP per 10 minutes** (in-memory Map). Over limit → **429** JSON `{ "error": "rate_limit", ... }`.

## Env

Copy `.env.example` → `.env`. Leave `XMRCHECKOUT_API_KEY` unset for mock mode.

If present on this box, secrets may load from `/workspace/crew-lolipop/xmrcheckout.env` (not committed). Dry-run sets `CREW_MOCK_ONLY=1` so that file is skipped.

| Variable | Role |
|----------|------|
| `PORT` | Default `3847` |
| `PUBLIC_BASE_URL` | Base for mock pay + share URLs |
| `INVOICE_TTL_SECONDS` | Invoice / match pay-window length (default `3600`) |
| `XMRCHECKOUT_API_KEY` | Live mode when set |
| `XMRCHECKOUT_BASE_URL` | Default `https://xmrcheckout.com/api/core` |
| `XMRCHECKOUT_WEBHOOK_SECRET` / `WEBHOOK_SECRET` | Optional webhook auth |
| `XMRCHECKOUT_STORE_ID` | Store id (reserved) |
| `ALLOW_MOCK_PAY` | If API key set, must be `true` to keep mock pay |
| `CREW_MOCK_ONLY` | Skip shared secrets file |

## XMR Checkout adapter

See `src/xmrcheckout.ts`. Confirmed contract:

- **Auth:** `Authorization: ApiKey $XMRCHECKOUT_API_KEY`
- **Create:** `POST {BASE}/invoices` with `amount_fiat: "5.00"`, `currency: "USD"`, `confirmation_target: 2`, metadata `{ match_id, side, brand: "Crew" }`
- **Pay URL:** response `invoice_url` (fallback `https://xmrcheckout.com/invoice/<id>`)
- **Paid (MVP):** poll `GET {BASE}/public/invoice/<id>` (no auth); treat `status === "confirmed"` as paid. Crew wires this into `GET /api/matches/:id` via `syncLivePayments` (also available as `POST /api/dev/poll/:invoiceId`).
- `checkout_continue_url` omitted until a public https host exists

When no API key: mock invoices with `/mock-pay/:invoiceId`.

## API

- `GET /health`
- `POST /api/matches` — `{ "summary"?: string, "jobBrief"?: string, "handoffHint"?: string }` (hint max ~500 chars) → `{ id, expiresAt, invoices, shareUrls: { contractor, operator, hub } }` (429 if rate-limited)
- `GET /api/matches/:id` — status + `expiresAt`; includes `connection` **once** when both paid (`code`, `note`, `handoffHint`, `steps`); clears brief/summary/hint/secret on reveal; may return `expired` / `cancelled`. Live mode: syncs confirmed invoices on each GET (mock invoices never hit the public API).
- `GET /api/matches/:id?side=contractor|operator` — same, plus `side` / `yourPayUrl` emphasis (full invoices still returned)
- `POST /api/matches/:id/cancel` — cancel open match → `{ ok, id, status: "cancelled" }` (409 if not cancellable)
- `POST /api/dev/pay/:invoiceId` — mock mark paid (404/disabled when live key set and `ALLOW_MOCK_PAY` not true; 409 if match expired/cancelled)
- `POST /api/webhooks/xmrcheckout` — `{ invoiceId, status: "paid"|"confirmed" }` (secret optional)
- `POST /api/dev/poll/:invoiceId` — live-only helper to poll public invoice and mark paid if confirmed

### HTML routes

- `GET /` — create form
- `POST /create` — creates match, shows copyable side share URLs
- `GET /m/:id` — hub (both share links + live status + cancel)
- `GET /m/:id/contractor` · `GET /m/:id/operator` — per-side pay + live status

## Curl walkthrough (mock)

Terminal A:

```bash
CREW_MOCK_ONLY=1 npm run dev
```

Terminal B:

```bash
BASE=http://127.0.0.1:3847

# Create
curl -s -X POST "$BASE/api/matches" -H 'Content-Type: application/json' \
  -d '{"summary":"demo","jobBrief":"hold until reveal","handoffHint":"Session / SimpleX / email relay"}' | tee /tmp/m.json

MATCH=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/m.json","utf8")).id')
INV1=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/m.json","utf8")).invoices[0].id')
INV2=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/m.json","utf8")).invoices[1].id')

# Share links are in .shareUrls; expiresAt on create + GET

# Pay both sides
curl -s -X POST "$BASE/api/dev/pay/$INV1"
curl -s -X POST "$BASE/api/dev/pay/$INV2"

# First reveal — prints connection; brief cleared
curl -s "$BASE/api/matches/$MATCH"

# Second — consumed, no connection
curl -s "$BASE/api/matches/$MATCH"

# Cancel another open match
curl -s -X POST "$BASE/api/matches" -H 'Content-Type: application/json' -d '{}' | tee /tmp/m2.json
MATCH2=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/m2.json","utf8")).id')
curl -s -X POST "$BASE/api/matches/$MATCH2/cancel"
```

## Done criteria

`scripts/dry-run.sh` exits 0: share URLs, one-time reveal (incl. handoff hint) + brief/hint wipe, cancel, and expiry (via backdated `expires_at`) all assert green.
