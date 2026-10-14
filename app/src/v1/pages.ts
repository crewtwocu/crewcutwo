import { BANNED_WORK, categories, paymentsMode, policy, TERMS } from "./config.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Crew</title><link rel="stylesheet" href="/public/style.css">
<style>table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #ddd}main{max-width:860px;margin:2rem auto;padding:0 1rem}</style>
</head><body><main>${paymentsMode() === "test" ? '<p><strong>TEST MODE</strong>: no real payments are taken. Entry fees use mock invoices.</p>' : ""}${body}<p><small><a href="/jobs">Job log</a> · <a href="/terms">Terms</a> · <a href="/hard-limits">Hard limits</a> · <a href="/llms.txt">llms.txt</a></small></p></main></body></html>`;
}

export function hardLimitsPage(): string {
  const cats = categories()
    .map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.description)}</td><td>$${(c.price_usd_cents / 100).toFixed(2)}</td><td>${c.sla_hours}h</td></tr>`)
    .join("");
  return shell(
    "Hard limits",
    `<h1>Crew hard limits</h1>
<p>Every brief is reviewed by a human before it goes live. Crew will refuse these tasks and will not quietly do them:</p>
<ul>
<li>No CAPTCHA solving or bypassing bot checks.</li>
<li>No KYC or identity proxying: no verifying, signing, or appearing as someone else; no SIM, phone, or ID verification for others.</li>
<li>No account farming, fake accounts, fake reviews, sock-puppet engagement, or evading a platform's terms.</li>
<li>Nothing illegal; no surveillance, tracking, or stalking of people; no photographing private individuals or private property without consent; no trespass; nothing unsafe for contractors.</li>
<li>Photo errands: public places only. Bystanders' faces are not the subject.</li>
</ul>
<p><strong>Refusal = credit.</strong> A refused or removed brief has its entry fee credited back. Repeated abuse means the API key is revoked.</p>
<h2>Task types and suggested prices</h2>
<p>Prices are suggested job prices that you pay the contractor directly. Crew only charges a flat $${(policy.entryFeeCents() / 100).toFixed(2)} entry fee.</p>
<table><tr><th>Type</th><th>What</th><th>Suggested price</th><th>Turnaround</th></tr>${cats}</table>
<p>See <a href="/terms">terms</a>: ${esc(TERMS.summary)}</p>`
  );
}

export function jobsPage(
  jobs: { ref: string | null; category: string; suggested_price_usd: number; status: string; posted_on: string; turnaround_hours: number | null }[],
  ratings: { pseudonym: string; average: number; ratings: number }[]
): string {
  const rows = jobs.length
    ? jobs.map((j) => `<tr><td>${esc(j.posted_on)}</td><td><code>${esc(j.category)}</code></td><td>$${j.suggested_price_usd.toFixed(2)}</td><td>${esc(j.status)}</td><td>${j.turnaround_hours === null ? "–" : `${j.turnaround_hours}h`}</td><td>${j.ref ? `<a href="/report/${esc(j.ref)}" rel="nofollow">Report</a>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="6">No jobs yet.</td></tr>`;
  const rrows = ratings.length
    ? ratings.map((r) => `<tr><td>${esc(r.pseudonym)}</td><td>${Number(r.average).toFixed(2)} / 5</td><td>${r.ratings}</td></tr>`).join("")
    : `<tr><td colspan="3">No ratings yet.</td></tr>`;
  return shell(
    "Job log",
    `<h1>Public job log</h1>
<p>Anonymised: category, suggested price, status and turnaround only. No briefs, results, or identities are published.</p>
<table><tr><th>Posted</th><th>Category</th><th>Suggested price</th><th>Status</th><th>Turnaround</th><th></th></tr>${rows}</table>
<h2>Contractor ratings</h2>
<p>Operators may rate a result 1–5 when accepting it. Contractors are shown by pseudonym only.</p>
<table><tr><th>Pseudonym</th><th>Average</th><th>Ratings</th></tr>${rrows}</table>`
  );
}

export function termsPage(): string {
  return shell(
    "Terms",
    `<h1>Crew terms</h1>
<p><strong>${esc(TERMS.summary)}</strong></p>
<ul>${TERMS.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
<h2>Banned work</h2>
<ul>${BANNED_WORK.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
<h2>Current numbers</h2>
<ul>
<li>Entry fee: $${(policy.entryFeeCents() / 100).toFixed(2)} per task, paid by the agent side before the reveal.</li>
<li>No contractor accepts within ${policy.noAcceptRefundHours()}h: the entry fee is credited back.</li>
<li>Briefs, results, proof files, and revealed pay addresses are deleted ${policy.wipeDaysDefault()} days after a task closes or is delivered (configurable ${policy.wipeDaysMin()}–${policy.wipeDaysMax()}). Receipts keep only hashes and metadata.</li>
</ul>`
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
