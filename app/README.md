# Crew app — match + payments MVP

Functional MVP: create a match, collect **$5 from each side** (contractor + operator), then reveal a **connection code** (plus job brief + optional handoff hint) to both parties during a short grace window. After the grace window ends, secrets are cleared from SQLite (anonymity).

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
5. When both have paid, status GETs during a **grace window** (default ~15 minutes, `REVEAL_GRACE_SECONDS`) return `connection` with `code`, `jobBrief`, optional `handoffHint`, and `steps` — so hub + both side pages can all succeed. After grace, secrets are wiped. Before both pay, `jobBrief` / `summary` are redacted (`jobBriefPresent` only).

Browser try:

1. `CREW_MOCK_ONLY=1 npm run dev`
2. Open http://localhost:3847 → Create match → copy the two side links
3. Open each side link (two tabs), mock-pay $5 on each
4. Watch either page: status updates, then the connection code + brief appear (both sides can refresh during grace)

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

`POST /api/contact` is limited to **~5 requests per IP per 15 minutes** (separate in-memory Map). Over limit → **429** `{ "ok": false, "requestId" }`.

## Env

Copy `.env.example` → `.env`. Leave `XMRCHECKOUT_API_KEY` unset for mock mode.

If present on this box, secrets may load from `/workspace/crew-lolipop/xmrcheckout.env` (not committed). Dry-run sets `CREW_MOCK_ONLY=1` so that file is skipped.

| Variable | Role |
|----------|------|
| `PORT` | Default `3847` |
| `PUBLIC_BASE_URL` | Base for mock pay + share URLs |
| `INVOICE_TTL_SECONDS` | Invoice / match pay-window length (default `3600`) |
| `REVEAL_GRACE_SECONDS` | How long both parties can re-fetch connection after first reveal (default `900`, min `30`) |
| `XMRCHECKOUT_API_KEY` | Live mode when set |
| `XMRCHECKOUT_BASE_URL` | Default `https://xmrcheckout.com/api/core` |
| `XMRCHECKOUT_WEBHOOK_SECRET` / `WEBHOOK_SECRET` | Optional webhook auth |
| `XMRCHECKOUT_STORE_ID` | Store id (reserved) |
| `ALLOW_MOCK_PAY` | If API key set, must be `true` to keep mock pay |
| `CREW_MOCK_ONLY` | Skip shared secrets file |
| `CREW_CONTACT_OPS_EMAIL` | Ops inbox for one-shot contact notifications |
| `CREW_CONTACT_OPS_PHONE` | Ops phone for Twilio callback SMS (optional) |
| `CREW_SMTP_*` | SMTP host/port/user/pass/from for contact email |
| `TWILIO_*` | Twilio SID/token/from for callback SMS |

## XMR Checkout adapter

See `src/xmrcheckout.ts`. Confirmed contract:

- **Auth:** `Authorization: ApiKey $XMRCHECKOUT_API_KEY`
- **Create:** `POST {BASE}/invoices` with `amount_fiat: "5.00"`, `currency: "USD"`, `confirmation_target: 2`, metadata `{ match_id, side, brand: "Crew" }` (matches) or `{ kind: "callback_ticket", ticket_id, brand: "Crew" }` (callback gate)
- **Pay URL:** response `invoice_url` (fallback `https://xmrcheckout.com/invoice/<id>`)
- **Paid (MVP):** poll `GET {BASE}/public/invoice/<id>` (no auth); treat `status === "confirmed"` as paid. Crew wires this into `GET /api/matches/:id` via `syncLivePayments` (also available as `POST /api/dev/poll/:invoiceId`).
- `checkout_continue_url` omitted until a public https host exists

When no API key: mock invoices with `/mock-pay/:invoiceId`.

## API

- `GET /health`
- `POST /api/contact` — privacy-preserving Get-a-reply. Body: `{ "method": "email"|"callback", "contact": string, "note"?: string, "website"?: string }` (`website` = honeypot). **Email:** one-shot outbound to ops, then discard — response `{ ok, requestId }`. **Callback:** creates a **$5** payment intent tied to an opaque `ticketId` (phone held only in ephemeral process memory — never SQLite); response `{ ok, requestId, paymentRequired: true, ticketId, invoiceId, payUrl, amountUsd: 5, expiresAt }`. Ticket is **issued** (outbound notify + wipe phone) only after payment via mock pay / webhook / live poll. Honeypot → success-looking, no send/pay. Rate-limited per IP. Never echoes contact. Stub outbound when SMTP/Twilio unset.
- `GET /api/callback-tickets/:ticketId` — public ticket status (`awaiting_payment`|`paid`|`issued`|`expired`|`failed`); never returns phone/note. Live mode syncs confirmed XMR invoices while awaiting.
- `POST /api/matches` — `{ "summary"?: string, "jobBrief"?: string, "handoffHint"?: string }` (hint max ~500 chars) → `{ id, expiresAt, invoices, shareUrls: { contractor, operator, hub } }` (429 if rate-limited)
- `GET /api/matches/:id` — status + `expiresAt` + `jobBriefPresent`; before both paid, `jobBrief`/`summary` are null. When both paid, includes `connection` during grace (`code`, `note`, `jobBrief`, `handoffHint`, `steps`); secrets wiped after `reveal_until`. May return `expired` / `cancelled`. Live mode: syncs confirmed invoices on each GET (mock invoices never hit the public API).
- `GET /api/matches/:id?side=contractor|operator` — same, plus `side` / `yourPayUrl` emphasis (full invoices still returned)
- `POST /api/matches/:id/cancel` — cancel open match → `{ ok, id, status: "cancelled" }` (409 if not cancellable)
- `POST /api/dev/pay/:invoiceId` — mock mark paid for **match** invoices or **callback tickets** (404/disabled when live key set and `ALLOW_MOCK_PAY` not true; 409 if match/ticket expired)
- `POST /api/webhooks/xmrcheckout` — `{ invoiceId, status: "paid"|"confirmed" }` (secret optional); also completes callback tickets
- `POST /api/dev/poll/:invoiceId` — live-only helper to poll public invoice and mark paid if confirmed (match or callback)

### HTML routes

- `GET /` — create form + **Get a reply** contact component (`/#get-a-reply`)
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

# First reveal (either side) — connection + jobBrief during grace
curl -s "$BASE/api/matches/$MATCH?side=contractor"

# Second side / hub — same connection while grace active
curl -s "$BASE/api/matches/$MATCH?side=operator"

# Cancel another open match
curl -s -X POST "$BASE/api/matches" -H 'Content-Type: application/json' -d '{}' | tee /tmp/m2.json
MATCH2=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/m2.json","utf8")).id')
curl -s -X POST "$BASE/api/matches/$MATCH2/cancel"
```

## Contact / Get-a-reply (privacy)

```bash
# Email (free, immediate) — stub outbound if SMTP unset:
curl -s -X POST http://127.0.0.1:3847/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"method":"email","contact":"you@example.com","note":"quick question","website":""}'
# → {"ok":true,"requestId":"…"}

# Callback ($5 gate) — ticket issued only after pay:
curl -s -X POST http://127.0.0.1:3847/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"method":"callback","contact":"+61400000000","note":"call about match","website":""}' | tee /tmp/cb.json
# → {"ok":true,"paymentRequired":true,"ticketId":"…","payUrl":"…/mock-pay/…","amountUsd":5,…}

INV=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/cb.json","utf8")).invoiceId')
TID=$(node -pe 'JSON.parse(require("fs").readFileSync("/tmp/cb.json","utf8")).ticketId')
curl -s -X POST "http://127.0.0.1:3847/api/dev/pay/$INV"
curl -s "http://127.0.0.1:3847/api/callback-tickets/$TID"
# → {"ok":true,"status":"issued","ticketId":"…"} — phone never in response or SQLite
```

**Privacy notes (callback):** phone/note exist only in an in-memory map keyed by opaque `ticketId` until payment succeeds, expiry, or failure — then wiped. No contact tables. Logs use `ticketId` / `invoiceId` / result only. Email path unchanged (no $5 gate).

Do **not** log request bodies for `/api/contact` at the reverse proxy / access-log layer. The handler redacts `req.body` contact fields after processing.

## Done criteria

`scripts/dry-run.sh` exits 0: share URLs, pre-pay brief redact, dual-party grace reveal (incl. `connection.jobBrief` + handoff hint), post-grace wipe, cancel, and expiry (via backdated `expires_at`) all assert green.
