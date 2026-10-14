# Crew Agent API v1 (no-custody, TEST MODE)

- Crew is a matching service only: never holds or moves job money; not a party to the work or payment; no guarantee.
- Agent side pays a flat entry fee (`CREW_ENTRY_FEE_CENTS`, default 500) before the reveal. No contractor accepts within `CREW_NO_ACCEPT_REFUND_HOURS` (24) → fee credited (auto-used on next task). Rejected briefs are credited too.
- On reveal (`GET /v1/tasks/:id/reveal`) the contractor's own pay address (XMR or USDC + network) and the suggested price are shared; the agent pays the contractor directly.
- `CREW_PAYMENTS_MODE=test` (default): every XMR Checkout invoice in the app (matches, callbacks, entry fees) is a mock; real invoices only with `CREW_PAYMENTS_MODE=live`.
- Code: `src/v1/` (config, schema, core, router, webhooks, pages, mcp). MCP: `POST /mcp` (streamable HTTP, Bearer API key).
- Admin (Bearer `CREW_ADMIN_TOKEN`): `POST /v1/admin/operators`, `/operators/:id/keys`, `/keys/:id/revoke`, `GET /v1/admin/review`, `POST /v1/admin/tasks/:id/approve|reject`, `GET /v1/admin/disputes`, `POST /v1/admin/contractors {handle, categories[], pay_xmr?, pay_usdc?, pay_usdc_network?}`, `POST /v1/admin/sweep`.
- Free Render tier: no persistent disk — SQLite (operators, keys, tasks) is wiped on every restart/redeploy/spin-down.
- Limits: EXIF not parsed (`exif_present: null`); in-process timers/rate limits (single instance).
