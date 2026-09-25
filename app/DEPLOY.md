# Deploy Crew (match app)

Function-first notes for shipping the match app on [Origin](https://www.origin.computer/) (or any Docker host). Marketing stays in `../marketing/`.

## 1. Claim an Origin namespace

- Preferred: **`crew`**
- Fallback if taken: **`crew2cU`**

Push this repo (or the `crew-app` directory as the app root) to that namespace’s git remote once claimed.

## 2. Environment

Set these on the host / Origin secrets (never bake keys into the image):

| Variable | Prod value |
|----------|------------|
| `PUBLIC_BASE_URL` | Your public **https** origin, no trailing slash (e.g. `https://crew.example`) |
| `CREW_MOCK_ONLY` | **`0`** (or unset) — must be off for live payments |
| `XMRCHECKOUT_API_KEY` | Live XMR Checkout API key |
| `XMRCHECKOUT_BASE_URL` | Optional; default `https://xmrcheckout.com/api/core` |
| `XMRCHECKOUT_WEBHOOK_SECRET` / `WEBHOOK_SECRET` | Optional; required if you enforce webhook auth |
| `XMRCHECKOUT_STORE_ID` | Optional / reserved |
| `ALLOW_MOCK_PAY` | Leave unset/`false` in prod |
| `PORT` | Usually `3847` (Compose maps it) |
| `INVOICE_TTL_SECONDS` | Optional; default `3600` |
| `CREW_CONTACT_OPS_EMAIL` | Ops inbox for one-shot Get-a-reply notifications (optional; stub if unset) |
| `CREW_CONTACT_OPS_PHONE` | Ops phone for Twilio callback SMS (optional) |
| `CREW_SMTP_HOST` / `CREW_SMTP_PORT` / `CREW_SMTP_USER` / `CREW_SMTP_PASS` / `CREW_SMTP_FROM` | SMTP for contact email (optional) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Twilio SMS for callbacks (optional; else email-to-ops / stub) |

Copy `.env.example` → `.env` locally only for Compose substitution; do not commit `.env`.

## 3. Marketing `config.js`

In `../marketing/config.js`:

```js
window.CREW_APP_URL = "https://YOUR_PUBLIC_APP_URL"; // no trailing slash
```

Point CTAs at the public match app. Local Compose demo can keep `http://127.0.0.1:3847`.

## 4. Run with Docker Compose

From this directory:

```bash
cd .
# .env with live secrets + CREW_MOCK_ONLY=0 for prod
docker compose up --build
```

- Match app: port **3847** (set `PUBLIC_BASE_URL` to the public https URL in front of it)
- Marketing (optional sibling nginx): port **8080**

Match-only: `docker compose up --build match`.

## 5. Webhooks vs poll

- XMR Checkout **webhooks** need a **public HTTPS** URL hitting `POST /api/webhooks/xmrcheckout`.
- Until that is wired, **poll-on-GET is fine**: live mode syncs confirmed invoices inside `GET /api/matches/:id` (and side/hub pages already poll every ~3s).

## 6. Contact route privacy

`POST /api/contact` never writes visitor email/phone/note to SQLite. App logs only timestamp, `requestId`, and `sent`|`failed`. **Strip request bodies** for this path in any reverse-proxy / CDN access logs (do not enable body logging). The handler also redacts `req.body` fields after handling.

## 7. Checklist

1. Claim namespace (`crew` → else `crew2cU`)
2. Push / connect repo to Origin (or your host)
3. Set secrets: `XMRCHECKOUT_*`, `PUBLIC_BASE_URL` (https), `CREW_MOCK_ONLY=0`
4. Point domain / TLS at the match service
5. Set marketing `CREW_APP_URL` to that public URL
6. Smoke: create a match → open both share links → (mock or live) pay path → one-time reveal with optional handoff hint

Local confidence check (no live key): `npm run dry-run`.

## Render (Free now; Starter Friday)

Monorepo Blueprint: repo-root [`render.yaml`](../render.yaml) → web service **crewcutwo** (`runtime: docker`, `plan: free`).
The Free service uses ephemeral SQLite at `/app/data/crew.db`: data is lost on deploy, restart, or spin-down, and the service sleeps when idle. Upgrade to **Starter** and add the `/app/data` persistent disk on Friday for durable storage.

1. Push this repo to GitHub (`crewtwocu/crewcutwo`).
2. [Dashboard → Blueprints](https://dashboard.render.com/blueprints) → **New Blueprint Instance**, or open [Deploy to Render](https://render.com/deploy?repo=https://github.com/crewtwocu/crewcutwo).
3. Connect the GitHub repo; deploy **Free** now. On Friday, upgrade to **Starter** and add a 1 GB persistent disk mounted at `/app/data`.
4. When prompted, set secrets: `PUBLIC_BASE_URL` (https, no trailing slash — use the `*.onrender.com` URL after first deploy if needed), `XMRCHECKOUT_API_KEY`, and optional `XMRCHECKOUT_BASE_URL` / `XMRCHECKOUT_WEBHOOK_SECRET` / `XMRCHECKOUT_STORE_ID`.
5. `CREW_MOCK_ONLY=0` and `DB_PATH=/app/data/crew.db` are set in the Blueprint. Point marketing `CREW_APP_URL` at the public app URL. The `/health` endpoint is available for Render health checks.
