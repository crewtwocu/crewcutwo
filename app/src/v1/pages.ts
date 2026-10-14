import { policy } from "./config.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Crew</title><link rel="stylesheet" href="/public/style.css">
<style>table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #ddd}main{max-width:860px;margin:2rem auto;padding:0 1rem}</style>
</head><body><main>${body}<p><small><a href="/jobs">Job log</a> · <a href="/terms">Terms</a> · <a href="/hard-limits">Hard limits</a> · <a href="/llms.txt">llms.txt</a></small></p></main></body></html>`;
}

export function hardLimitsPage(): string {
  return shell(
    "Hard limits",
    `<h1>Crew hard limits</h1>
<p><strong>Payments are not open yet. Nothing is charged.</strong></p>
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
<p>When payments open, each side pays a flat $${(policy.entryFeeCents() / 100).toFixed(2)} to connect, one time. That is all Crew charges. Any price for the work itself is agreed directly between you and whoever you connect with.</p>
<p>See the <a href="/terms">terms</a>.</p>`
  );
}

export function jobsPage(
  jobs: { ref: string | null; category: string; suggested_price_usd: number; status: string; posted_on: string; turnaround_hours: number | null }[],
  _ratings?: unknown
): string {
  const rows = jobs.length
    ? jobs.map((j) => `<tr><td>${esc(j.posted_on)}</td><td><code>${esc(j.category)}</code></td><td>$${j.suggested_price_usd.toFixed(2)}</td><td>${esc(j.status)}</td><td>${j.turnaround_hours === null ? "–" : `${j.turnaround_hours}h`}</td><td>${j.ref ? `<a href="/report/${esc(j.ref)}" rel="nofollow">Report</a>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="6">No jobs yet.</td></tr>`;
  return shell(
    "Job log",
    `<h1>Public job log</h1>
<p>Anonymised: category, suggested price, status and turnaround only. No briefs, results, or identities are published.</p>
<table><tr><th>Posted</th><th>Category</th><th>Suggested price</th><th>Status</th><th>Turnaround</th><th></th></tr>${rows}</table>`
  );
}

export function termsPage(): string {
  return shell(
    "Terms",
    `<h1>Crew terms</h1>
<p><strong>Payments are not open yet. Nothing is charged.</strong> When they open, these terms apply.</p>
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
<form method="post" action="/v1/tasks/${encodeURIComponent(ref)}/report">
<p><textarea name="reason" rows="5" cols="60" minlength="5" maxlength="2000" required></textarea></p>
<button type="submit">Send report</button>
</form>`
  );
}
export function reportThanksPage(): string {
  return shell("Report received", `<h1>Thanks</h1><p>Your report was received and will be reviewed.</p>`);
}
