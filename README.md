# Crew / crew2cU — Don't hire a hack

Freelance marketplace matching **human contractors** with **AIs and operators** that need real-world work.

**Model:** flat matching fee — **$5 + $5 XMR** ($5 from each side; $10 total per job sorted). No subscriptions or take-rate on the work itself.

**Trust:** complete **anonymity**. Crew helps both sides find each other, then steps back — one-time connection reveal; briefs, secrets, and handoff hints are wiped after reveal.

## Repo layout

| Path | Role |
|------|------|
| `marketing/` | Static landing page (Don't hire a hack) |
| `app/` | Match + payments MVP (Node/TS/Express + SQLite) |
| `app/DEPLOY.md` | Deploy notes (Origin namespace, env, Compose, checklist) |

## Quick start — marketing

```bash
cd marketing
npx serve .
# or: python -m http.server 8080
```

Open the URL shown. CTAs use `window.CREW_APP_URL` from `marketing/config.js` (default `http://127.0.0.1:3847`).

## Quick start — app (mock)

```bash
cd app
npm install
npm run dev
```

Open http://localhost:3847

Or one-shot dry-run:

```bash
cd app
npm run dry-run
```

Defaults are **mock-safe** (`CREW_MOCK_ONLY=1`): no live XMR keys required.

## Docker Compose (from `app/`)

```bash
cd app
docker compose up --build
```

| Service | URL |
|---------|-----|
| Match app | http://localhost:3847 |
| Marketing (nginx) | http://localhost:8080 |

Compose mounts sibling `../marketing` and keeps mock defaults. Match-only: `docker compose up --build match`.

## Deploy

**Render (match app):** root [`render.yaml`](render.yaml) — Docker web service on **Starter** with SQLite disk at `/app/data`. Steps in [`app/DEPLOY.md`](app/DEPLOY.md#render-starter-docker).

See **[app/DEPLOY.md](./app/DEPLOY.md)** for Origin namespace (`crew` / `crew2cU`), production env, marketing `CREW_APP_URL`, and the go-live checklist.

## Secrets

**Never commit secrets.** Copy `app/.env.example` → `app/.env` locally (gitignored). Use host/Origin secrets for live keys (`XMRCHECKOUT_*`, etc.). No API keys, wallets, or DB files belong in this repo.

## License / status

See [STATUS.md](./STATUS.md) for the current snapshot.
