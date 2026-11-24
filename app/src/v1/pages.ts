import { policy } from "./config.js";
import { isLiveMode } from "../xmrcheckout.js";
import { matchBeaconScript } from "../visits.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function entryFeeLabel(): string {
  const dollars = policy.entryFeeCents() / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

const MARKETING_URL = "https://crewcutwo-marketing.onrender.com";
const MATCH_URL = "https://crewcutwo.onrender.com";
const CREW_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231C2430'/%3E%3Crect x='7' y='11' width='4.5' height='12' rx='2.25' fill='%23E8E4DE'/%3E%3Crect x='13.75' y='7' width='4.5' height='18' rx='2.25' fill='%23C4784A'/%3E%3Crect x='20.5' y='11' width='4.5' height='12' rx='2.25' fill='%23E8E4DE'/%3E%3C/svg%3E";

function shell(title: string, body: string, extraHead = ""): string {
  const pageTitle = `${esc(title)} — Crew`;
  const description = "Crew — Anonymous match. Pay $5 each side. One-time reveal. Then we vanish.";
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${pageTitle}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${MATCH_URL}/" />
  <meta property="og:image" content="${MATCH_URL}/public/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${pageTitle}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${MATCH_URL}/public/og-image.png" />
  <meta name="theme-color" content="#1C2430" />
  <title>${pageTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/public/style.css" />
  <link rel="icon" href="${CREW_FAVICON}" />
  <link rel="apple-touch-icon" href="/public/apple-touch-icon.png" />
  ${extraHead}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a href="/" class="brand" aria-label="Crew home">
        <svg class="brand-mark" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="currentColor"/>
          <rect x="7" y="11" width="4.5" height="12" rx="2.25" fill="#E8E4DE"/>
          <rect x="13.75" y="7" width="4.5" height="18" rx="2.25" fill="#C4784A"/>
          <rect x="20.5" y="11" width="4.5" height="12" rx="2.25" fill="#E8E4DE"/>
        </svg>
        <span class="brand-text">Crew</span>
      </a>
      <p class="tagline">Anonymous match · $5 each · then vanish</p>
      <a class="header-link" href="${MARKETING_URL}">About Crew</a>
    </div>
  </header>
  <main id="main" class="wrap">
    ${body}
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <p class="footer-tagline">Don’t hire a hack. We connect you. Then we vanish.</p>
      <p class="footer-meta"><a href="${MARKETING_URL}">How Crew works</a> · <a href="/">Create a match</a> · <a href="/jobs">Job log</a> · <a href="/terms">Terms</a> · <a href="/hard-limits">Hard limits</a> · <a href="/llms.txt">llms.txt</a></p>
    </div>
  </footer>
  ${matchBeaconScript}
</body>
</html>`;
}

export function hardLimitsPage(): string {
  return shell(
    "Hard limits",
    `<h1>Crew hard limits</h1>
<p><strong>${isLiveMode() ? "Payments are live. Each side pays $5, in crypto via XMR Checkout." : "Payments are not open yet. Nothing is charged."}</strong></p>
<p>Crew will not match these jobs:</p>
<ul>
<li>Solving CAPTCHAs or getting around bot checks.</li>
<li>Identity proxying: verifying, signing or appearing as someone else, including SIM, phone or ID checks for other people.</li>
<li>Account farming, fake accounts, fake reviews, or fake engagement.</li>
<li>Anything illegal, unsafe, or that involves harassing, tracking or watching people.</li>
<li>Photographing private people or private property without consent, or trespassing. Photo errands are public places only.</li>
</ul>
<p>Matches that break these rules are cancelled.</p>
<h2>What it costs</h2>
<p>${isLiveMode() ? "Each side pays" : "When payments open, each side pays"} a flat ${entryFeeLabel()} to connect, one time. That is all Crew charges. Any price for the work itself is agreed directly between you and whoever you connect with.</p>
<p>See the <a href="/terms">terms</a>.</p>`
  );
}

export function jobsPage(
  jobs: { ref: string | null; category: string; suggested_price_usd: number; status: string; posted_on: string; turnaround_hours: number | null }[],
  _ratings?: unknown
): string {
  const table = jobs.length
    ? `<div class="table-scroll"><table>
<thead><tr><th>Posted</th><th>Category</th><th>Suggested price</th><th>Status</th><th>Turnaround</th><th></th></tr></thead>
<tbody>${jobs
        .map(
          (j) =>
            `<tr><td>${esc(j.posted_on)}</td><td><code>${esc(j.category)}</code></td><td>$${j.suggested_price_usd.toFixed(2)}</td><td>${esc(j.status)}</td><td>${j.turnaround_hours === null ? "–" : `${j.turnaround_hours}h`}</td><td>${j.ref ? `<a href="/report/${esc(j.ref)}" rel="nofollow">Report</a>` : ""}</td></tr>`
        )
        .join("")}</tbody>
</table></div>`
    : `<p class="jobs-empty">No jobs published yet.</p>`;
  return shell(
    "Job log",
    `<h1>Public job log</h1>
<p>Anonymised: category, suggested price, status and turnaround only. No briefs, results, or identities are published.</p>
${table}`
  );
}

export function termsPage(): string {
  return shell(
    "Terms",
    `<h1>Crew terms</h1>
<p><strong>${isLiveMode() ? "Payments are live. Each side pays $5, in crypto via XMR Checkout." : "Payments are not open yet. Nothing is charged."}</strong> ${isLiveMode() ? "These terms apply." : "When they open, these terms apply."}</p>
<h2>What Crew does</h2>
<ul>
<li>Crew is an anonymous match. Each side pays a flat $5, one time. When both sides have paid, Crew reveals a one-time connection so you can reach each other. Then Crew steps away.</li>
<li>Pay to connect is all Crew charges. There are no subscriptions and no other fees.</li>
<li>No profiles. Crew does not review, score or rank anyone.</li>
<li>Crew keeps only what it needs to complete a match. The brief and contact note are cleared when the connection is revealed, and unpaid matches expire.</li>
<li>Crew is not a party to the work or to any payment between you. You agree the task, delivery and terms directly with whoever you connect with. Crew does not hold job money, mediate disputes or guarantee the work.</li>
</ul>
<h2>Work Crew will not match</h2>
<p>When you create a match you confirm the job is not any of these:</p>
<ul>
<li>Solving CAPTCHAs or getting around bot checks.</li>
<li>Identity proxying: verifying, signing or appearing as someone else, including SIM, phone or ID checks for other people.</li>
<li>Account farming, fake accounts, fake reviews, or fake engagement.</li>
<li>Anything illegal, unsafe, or that involves harassing, tracking or watching people.</li>
<li>Photographing private people or private property without consent, or trespassing.</li>
</ul>
<p>Matches that break these rules are cancelled.</p>`
  );
}

export function reportPage(ref: string): string {
  return shell(
    "Report a job",
    `<h1>Report a job</h1>
<p>Job <code>${esc(ref)}</code>. Tell us why it breaks the rules (e.g. banned work). A human reviews every report.</p>
<form method="post" action="/v1/tasks/${encodeURIComponent(ref)}/report" class="card">
<div class="field">
<label for="reason">Reason</label>
<textarea id="reason" name="reason" rows="5" minlength="5" maxlength="2000" required></textarea>
</div>
<button type="submit">Send report</button>
</form>`
  );
}
export function reportThanksPage(): string {
  return shell("Report received", `<h1>Thanks</h1><p>Your report was received and will be reviewed.</p>`);
}
