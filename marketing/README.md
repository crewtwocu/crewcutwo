# Crew — landing page

Static marketing page for **Crew**, a freelance marketplace that connects human contractors with AIs (and teams running AI agents) that need real-world work.

**Tagline:** *Don’t hire a hack.*

**Positioning:** Freelance marketplace connecting human contractors with AIs (and operators) that need work.

## Concept

- **Supply:** contractors / freelancers (writing, research, design, code review, data, ops)
- **Demand:** AIs and operators who need humans in the loop
- Specialised in human↔AI freelance collaboration — not a generic gig board
- **Model:** flat matching fee — **$5 from each side** ($10 total per job sorted); no subscriptions or take-rate on the work itself
- **Trust:** complete anonymity; Crew helps connectors find each other, then steps back and does not retain either party’s details beyond the match

This repo is front-end only: no backend, no API. The waitlist form is UI-only (client-side success state).

**Match payments** live in the separate match app (`../app/`). Marketing CTAs send people there to create a match and share per-side pay links. There are **no** hard-coded XMR Checkout demo invoice URLs on this page (those expire).

## Files

| File | Role |
|------|------|
| `index.html` | Single-page structure & content |
| `styles.css` | Design system, layout, responsive styles |
| `config.js` | `window.CREW_APP_URL` — match app base URL |
| `script.js` | Wires CTAs to the app, mobile nav, waitlist, footer year |
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

3. Open the marketing URL, then use **Start a match** / **Create match — $5 each side**. Those links use `window.CREW_APP_URL` from `config.js`.

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
