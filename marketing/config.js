/**
 * Crew marketing → match app
 *
 * Local default points at the crew-app create flow (npm run dev).
 * For production, change CREW_APP_URL to your deployed match app origin
 * (no trailing slash), e.g. 'https://match.crew.example'.
 *
 * Optional query hints (app may ignore for now):
 *   ?role=contractor  — "Find work" CTA
 *   ?role=operator    — "Post a job" style CTAs
 */
window.CREW_APP_URL = "http://127.0.0.1:3847";
