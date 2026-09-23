# Crew — landing page

Static marketing page for **Crew** (crew2cU): anonymous match between human contractors and AIs/operators.

**Tagline:** *Don’t hire a hack.*

**Positioning:** Anonymity is the product. We connect you. Then we vanish. Pay $5 each side → one-time reveal → Crew gone. No sticky identity.

## Concept

- **Supply:** contractors / freelancers (writing, research, design, code review, data, ops)
- **Demand:** AIs and operators who need humans in the loop
- **Model:** flat pay-to-connect fee — **$5 from each side** ($10 total per match); no subscriptions or take-rate on the work itself
- **Trust:** complete anonymity; no sticky profiles; one-time reveal (code + optional reach-me hint); then Crew steps back — no records, no database, no cookies

This repo is front-end only: no backend, no API, no waitlist / PII forms. CTAs send people straight to the match app.

**Match payments** live in the separate match app (`../app/`). Marketing CTAs send people there to create a match and share per-side pay links. There are **no** hard-coded XMR Checkout demo invoice URLs on this page (those expire).

## Files

| File | Role |
|------|------|
| `index.html` | Single-page structure & content |
| `styles.css` | Design system, layout, responsive styles |
| `config.js` | `window.CREW_APP_URL` — match app base URL |
| `script.js` | Wires CTAs to the app, mobile nav, footer year |
| `README.md` | This file |

## Connect to the match app

1. Start the match app (default `http://127.0.0.1:3847`):

   ```bash
   cd ../app
   npm install
   npm run dev
   ```

2. Serve this marketing site in another terminal:

   ```bash
   cd .
   npx serve .
   # or: python -m http.server 8080
   ```

3. Open the marketing URL, then use **Start a match** / **Pay to connect — $5 each**. Those links use `window.CREW_APP_URL` from `config.js`.

### Production URL

Edit `config.js`:

```js
window.CREW_APP_URL = "https://your-match-app.example"; // no trailing slash
```

Optional query hints on some CTAs (`?role=contractor`, `?role=operator`) — the app may ignore them for now.

## Preview (marketing only)

From this directory:

```bash
# Option A — serve package (recommended)
npx serve .

# Option B — Python
python -m http.server 8080
```

Then open the URL shown (typically `http://localhost:3000` for `serve`, or `http://localhost:8080` for Python).

You can also open `index.html` directly in a browser; Google Fonts still load if you are online. For CTAs to work, the match app must be reachable at `CREW_APP_URL`.

## Design notes

- Palette: deep slate (`#1C2430`) with a warm terracotta accent (`#C4784A`) on cream paper
- Logo: three geometric marks (crew) — cream / terracotta / cream on slate
- Typography: Instrument Serif for headlines, DM Sans for UI/body
- Australian English throughout (organise, specialised, favour)
- Accessible: semantic landmarks, skip link, focus styles, contrast-aware colours
