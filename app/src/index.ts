import { loadEnv } from "./env.js";
loadEnv();

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createMatch, getMatchStatus, markInvoicePaid, cancelMatch, normaliseHandoffHint } from "./matches.js";
import { db, applyExpiryIfNeeded, matchExpiresAt, type MatchStatus } from "./db.js";
import { isLiveMode, mockPayAllowed, fetchPublicInvoiceStatus, isConfirmedStatus } from "./xmrcheckout.js";
import { randomUUID } from "node:crypto";
import { handleContactRequest, redactContactBody } from "./contact.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3847);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/public", express.static(path.join(__dirname, "..", "public")));

/** In-memory rate limit: max 10 POST /api/matches per IP per 10 minutes. */
const CREATE_LIMIT = 10;
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const createHits = new Map<string, number[]>();

function clientIp(req: express.Request): string {
  const xf = req.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

function checkCreateRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - CREATE_WINDOW_MS;
  const prev = (createHits.get(ip) || []).filter((t) => t > cutoff);
  if (prev.length >= CREATE_LIMIT) {
    createHits.set(ip, prev);
    return false;
  }
  prev.push(now);
  createHits.set(ip, prev);
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExpiryLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}


type MarketingRole = "contractor" | "operator";

function parseMarketingRole(raw: unknown): MarketingRole | null {
  if (raw === "contractor" || raw === "operator") return raw;
  return null;
}

const MARKETING_URL = "https://crewcutwo-marketing.onrender.com";

const CREW_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231C2430'/%3E%3Crect x='7' y='11' width='4.5' height='12' rx='2.25' fill='%23E8E4DE'/%3E%3Crect x='13.75' y='7' width='4.5' height='18' rx='2.25' fill='%23C4784A'/%3E%3Crect x='20.5' y='11' width='4.5' height='12' rx='2.25' fill='%23E8E4DE'/%3E%3C/svg%3E";

const pageShell = (title: string, body: string, extraHead = "") => `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Crew — Anonymous match. Pay $5 each side. One-time reveal. Then we vanish." />
  <title>${escapeHtml(title)} — Crew</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/public/style.css" />
  <link rel="icon" href="${CREW_FAVICON}" />
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
      <p class="footer-meta"><a href="${MARKETING_URL}">How Crew works</a> · <a href="/#get-a-reply">Get a reply</a> · Anonymous by design</p>
    </div>
  </footer>
</body>
</html>`;


/** Client script for privacy-preserving Get-a-reply form (no analytics of address). */
function contactFormScript(): string {
  return `<script>
(function () {
  var form = document.getElementById("contact-form");
  if (!form) return;
  var emailField = form.querySelector("[data-contact-email]");
  var phoneField = form.querySelector("[data-contact-phone]");
  var emailInput = document.getElementById("contact-email");
  var phoneInput = document.getElementById("contact-phone");
  var noteInput = document.getElementById("contact-note");
  var websiteInput = document.getElementById("contact-website");
  var statusEl = document.getElementById("contact-status");
  var submitBtn = document.getElementById("contact-submit");

  function method() {
    var checked = form.querySelector('input[name="method"]:checked');
    return checked ? checked.value : "email";
  }

  function syncFields() {
    var m = method();
    var isEmail = m === "email";
    if (emailField) emailField.hidden = !isEmail;
    if (phoneField) phoneField.hidden = isEmail;
    if (emailInput) emailInput.required = isEmail;
    if (phoneInput) phoneInput.required = !isEmail;
  }

  form.querySelectorAll('input[name="method"]').forEach(function (el) {
    el.addEventListener("change", syncFields);
  });
  syncFields();

  function showStatus(text, ok) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.toggle("ok", !!ok);
    statusEl.classList.toggle("warn", !ok);
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var m = method();
    var contact = m === "email"
      ? (emailInput && emailInput.value ? emailInput.value.trim() : "")
      : (phoneInput && phoneInput.value ? phoneInput.value.trim() : "");
    var note = noteInput && noteInput.value ? noteInput.value.trim() : "";
    var website = websiteInput && websiteInput.value ? websiteInput.value : "";

    if (!contact) {
      showStatus(m === "email" ? "Enter an email address." : "Enter a phone number.", false);
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    showStatus("Sending…", true);

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        method: m,
        contact: contact,
        note: note,
        website: website
      })
    })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
      })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) {
          showStatus("Sent. We’ll be in touch.", true);
          form.reset();
          syncFields();
          return;
        }
        if (res.status === 429) {
          showStatus("Too many requests. Try again later.", false);
          return;
        }
        showStatus("Couldn’t send just now. Try again shortly.", false);
      })
      .catch(function () {
        showStatus("Couldn’t send just now. Try again shortly.", false);
      })
      .finally(function () {
        if (submitBtn) submitBtn.disabled = false;
      });
  });
})();
</script>`;
}

/** Client poll script: polls GET /api/matches/:id until ready/consumed/expired/cancelled. */
function pollScript(matchId: string, side?: "contractor" | "operator"): string {
  const sideQ = side ? `?side=${side}` : "";
  return `<script>
(function () {
  var matchId = ${JSON.stringify(matchId)};
  var api = "/api/matches/" + encodeURIComponent(matchId) + ${JSON.stringify(sideQ)};
  var statusEl = document.getElementById("live-status");
  var connEl = document.getElementById("live-connection");
  var expiryEl = document.getElementById("live-expiry");
  var invoiceEls = document.querySelectorAll("[data-invoice-side]");
  var payActions = document.querySelectorAll("[data-pay-encourage]");
  var stopped = false;
  var seenConnection = false;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function renderConnection(conn) {
    if (!connEl || !conn || !conn.code) return;
    seenConnection = true;
    var hintHtml = "";
    if (conn.handoffHint) {
      hintHtml =
        '<div class="handoff-hint">' +
        "<h3>Handoff</h3>" +
        "<p>" + escapeHtml(conn.handoffHint) + "</p>" +
        "</div>";
    }
    var steps = Array.isArray(conn.steps) ? conn.steps : [];
    var stepsHtml = "";
    if (steps.length) {
      stepsHtml = '<ol class="handoff-steps">';
      steps.forEach(function (s) {
        stepsHtml += "<li>" + escapeHtml(s) + "</li>";
      });
      stepsHtml += "</ol>";
    }
    connEl.innerHTML =
      '<div class="card highlight">' +
      "<h2>Connection (one-time)</h2>" +
      '<p class="code">' + escapeHtml(conn.code) + "</p>" +
      "<p>" + escapeHtml(conn.note || "") + "</p>" +
      hintHtml +
      stepsHtml +
      '<p class="warn">Copy it now — Crew has cleared it from storage.</p>' +
      "</div>";
  }

  function renderConsumed() {
    if (!connEl || seenConnection) return;
    connEl.innerHTML =
      '<div class="card">' +
      "<h2>Consumed</h2>" +
      "<p>Connection already revealed and cleared from the database.</p>" +
      "</div>";
  }

  function renderTerminal(kind) {
    if (!connEl || seenConnection) return;
    var title = kind === "expired" ? "Expired" : "Cancelled";
    var msg =
      kind === "expired"
        ? "Payment window ended. Do not pay — this match will not reveal a connection."
        : "This match was cancelled. Do not pay.";
    connEl.innerHTML =
      '<div class="card">' +
      "<h2>" + title + "</h2>" +
      "<p>" + msg + "</p>" +
      "</div>";
    payActions.forEach(function (el) {
      el.innerHTML = '<span class="warn">' + title.toLowerCase() + " — payment closed</span>";
    });
  }

  function updateExpiry(expiresAt, status) {
    if (!expiryEl) return;
    if (!expiresAt || status === "consumed" || status === "ready") {
      expiryEl.textContent = "";
      return;
    }
    if (status === "expired" || status === "cancelled") {
      expiryEl.textContent = status === "expired" ? "Expired" : "Cancelled";
      return;
    }
    var end = new Date(expiresAt).getTime();
    var left = end - Date.now();
    if (left <= 0) {
      expiryEl.textContent = "Expired";
      return;
    }
    var mins = Math.floor(left / 60000);
    var secs = Math.floor((left % 60000) / 1000);
    expiryEl.textContent =
      "Expires in " + mins + "m " + secs + "s (" + new Date(expiresAt).toLocaleString() + ")";
  }

  function updateInvoices(invoices, status) {
    if (!invoices) return;
    var closed = status === "expired" || status === "cancelled";
    invoices.forEach(function (inv) {
      invoiceEls.forEach(function (row) {
        if (row.getAttribute("data-invoice-side") === inv.side) {
          var st = row.querySelector("[data-inv-status]");
          if (st) st.textContent = inv.status;
          var act = row.querySelector("[data-inv-action]");
          if (act && inv.status === "paid") {
            act.innerHTML = '<span class="ok">paid</span>';
          } else if (act && closed && inv.status !== "paid") {
            act.innerHTML = '<span class="warn">closed</span>';
          }
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tick() {
    if (stopped) return;
    fetch(api, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          setStatus("Could not load status");
          return;
        }
        var j = res.j;
        setStatus(j.status || "?");
        updateExpiry(j.expiresAt, j.status);
        updateInvoices(j.invoices, j.status);
        if (j.connection && j.connection.code) {
          renderConnection(j.connection);
          stopped = true;
          setStatus("consumed");
          return;
        }
        if (j.status === "consumed") {
          renderConsumed();
          stopped = true;
          return;
        }
        if (j.status === "expired" || j.status === "cancelled") {
          renderTerminal(j.status);
          stopped = true;
          return;
        }
        if (j.status === "ready") {
          // Server should have revealed; keep polling once more if no connection yet
          return;
        }
      })
      .catch(function () {
        setStatus("Polling error — retrying…");
      });
  }

  tick();
  var timer = setInterval(function () {
    if (stopped) {
      clearInterval(timer);
      return;
    }
    tick();
  }, 3000);
})();
</script>`;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    live: isLiveMode(),
    mockPay: mockPayAllowed(),
  });
});

/**
 * Privacy-preserving one-shot contact / callback.
 * No DB write. Logs only {ts, event, requestId, result} — never email/phone/note/body.
 * Access logs: do not log request bodies for this route (see DEPLOY.md / README).
 * Body fields are redacted in-memory after handling.
 */
app.post("/api/contact", async (req, res) => {
  const ip = clientIp(req);
  try {
    const result = await handleContactRequest(req.body || {}, ip);
    redactContactBody(req.body);
    res.status(result.httpStatus).json(result.body);
  } catch {
    redactContactBody(req.body);
    const requestId = randomUUID();
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "contact",
        requestId,
        result: "failed",
      })
    );
    res.status(503).json({ ok: false, requestId });
  }
});

app.post("/api/matches", async (req, res) => {
  const ip = clientIp(req);
  if (!checkCreateRateLimit(ip)) {
    return res.status(429).json({
      error: "rate_limit",
      message: "Too many matches created from this IP. Max 10 per 10 minutes. Try again later.",
    });
  }
  try {
    const summary = typeof req.body?.summary === "string" ? req.body.summary.trim() : undefined;
    const jobBrief =
      typeof req.body?.jobBrief === "string"
        ? req.body.jobBrief.trim()
        : typeof req.body?.job_brief === "string"
          ? req.body.job_brief.trim()
          : undefined;
    const handoffHint = normaliseHandoffHint(
      req.body?.handoffHint ?? req.body?.handoff_hint
    );
    const result = await createMatch({
      summary: summary || undefined,
      jobBrief: jobBrief || undefined,
      handoffHint,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "create failed" });
  }
});

app.get("/api/matches/:id", async (req, res) => {
  const sideRaw = typeof req.query.side === "string" ? req.query.side : undefined;
  const result = await getMatchStatus(req.params.id, sideRaw);
  if (!result) return res.status(404).json({ error: "not found" });
  res.json(result);
});

app.post("/api/matches/:id/cancel", (req, res) => {
  try {
    const match = cancelMatch(req.params.id);
    if (!match) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, id: match.id, status: match.status });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "NOT_CANCELLABLE") {
      return res.status(409).json({
        error: "not_cancellable",
        message: err instanceof Error ? err.message : "cannot cancel",
      });
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "cancel failed" });
  }
});

app.post("/api/dev/pay/:invoiceId", (req, res) => {
  if (!mockPayAllowed()) {
    return res.status(404).json({ error: "mock pay disabled" });
  }
  const invoice = markInvoicePaid(req.params.invoiceId);
  if (!invoice) {
    // Distinguish not found vs expired/cancelled
    const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.invoiceId) as
      | { id: string; match_id: string }
      | undefined;
    if (!row) return res.status(404).json({ error: "invoice not found" });
    let status = "unavailable";
    try {
      status = applyExpiryIfNeeded(row.match_id);
    } catch {
      /* ignore */
    }
    return res.status(409).json({
      error: "pay_refused",
      message: `Cannot mark paid (match status: ${status})`,
      status,
    });
  }

  const accept = req.get("accept") || "";
  const wantsHtml = accept.includes("text/html") || req.query.redirect === "1";
  if (wantsHtml || req.query.redirect === "1") {
    const returnTo =
      typeof req.body?.returnTo === "string"
        ? req.body.returnTo
        : typeof req.query.returnTo === "string"
          ? req.query.returnTo
          : `/m/${invoice.match_id}`;
    // Only allow relative paths under /m/
    const safe =
      returnTo.startsWith(`/m/${invoice.match_id}`) && !returnTo.includes("://")
        ? returnTo
        : `/m/${invoice.match_id}`;
    return res.redirect(303, safe);
  }
  res.json({ ok: true, invoiceId: invoice.id, matchId: invoice.match_id, status: invoice.status });
});

app.post("/api/webhooks/xmrcheckout", (req, res) => {
  const secret = process.env.WEBHOOK_SECRET || process.env.XMRCHECKOUT_WEBHOOK_SECRET;
  if (secret) {
    const hdr =
      req.get("x-webhook-secret") ||
      req.get("x-xmrcheckout-secret") ||
      (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (hdr !== secret) {
      return res.status(401).json({ error: "invalid webhook secret" });
    }
  }

  const body = req.body || {};
  const invoiceId =
    body.invoiceId ||
    body.invoice_id ||
    body.id ||
    body?.data?.id ||
    body?.invoice?.id;
  const status = String(body.status || body.event || body.type || "").toLowerCase();

  const paidish =
    status === "paid" ||
    status === "confirmed" ||
    status === "invoice.confirmed" ||
    status.includes("confirmed");

  if (!invoiceId) return res.status(400).json({ error: "missing invoiceId" });
  if (!paidish) {
    return res.json({ ok: true, ignored: true, status });
  }

  const invoice = markInvoicePaid(String(invoiceId));
  if (!invoice) return res.status(404).json({ error: "invoice not found or match closed" });
  res.json({ ok: true, invoiceId: invoice.id, matchId: invoice.match_id });
});

/** Optional: poll live invoices for confirmed status (MVP paid detection). */
app.post("/api/dev/poll/:invoiceId", async (req, res) => {
  if (!isLiveMode()) {
    return res.status(400).json({ error: "live mode only" });
  }
  try {
    const pub = await fetchPublicInvoiceStatus(req.params.invoiceId);
    if (isConfirmedStatus(pub.status)) {
      const invoice = markInvoicePaid(req.params.invoiceId);
      if (!invoice) return res.status(404).json({ error: "invoice not found locally or match closed" });
      return res.json({ ok: true, paid: true, status: pub.status, matchId: invoice.match_id });
    }
    res.json({ ok: true, paid: false, status: pub.status });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "poll failed" });
  }
});

app.get("/", (req, res) => {
  const role = parseMarketingRole(req.query.role);
  let nudge = "";
  let heading = "Create a match";
  let submitLabel = "Create match";
  if (role === "contractor") {
    heading = "Find AI / operator work";
    submitLabel = "Create match & get operator link";
    nudge = `
    <div class="card role-nudge" data-role="contractor">
      <p><strong>You’re a contractor looking for work.</strong> Create a match, then send the <strong>operator</strong> share link to the AI / operator side that has the job.</p>
    </div>`;
  } else if (role === "operator") {
    heading = "Post work for contractors";
    submitLabel = "Create match & get contractor link";
    nudge = `
    <div class="card role-nudge" data-role="operator">
      <p><strong>You’re an operator posting work.</strong> Create a match, then send the <strong>contractor</strong> share link to freelancers who can take the job.</p>
    </div>`;
  }
  const roleHidden = role
    ? `<input type="hidden" name="role" value="${escapeHtml(role)}" />`
    : "";
  res.type("html").send(
    pageShell(
      heading,
      `
    <h1>${escapeHtml(heading)}</h1>
    ${nudge}
    <p class="lede">Each side pays a flat <strong>$5</strong>. When both are paid, Crew reveals a one-time connection code — then forgets it. No sticky profiles. No records kept after reveal.</p>
    <p class="trust-strip" role="note">
      <span>Complete anonymity</span><span class="dot" aria-hidden="true">·</span>
      <span>$5 / $5</span><span class="dot" aria-hidden="true">·</span>
      <span>One-time reveal</span><span class="dot" aria-hidden="true">·</span>
      <span>Then we vanish</span>
    </p>
    <form method="post" action="/create" class="card">
      ${roleHidden}
      <div class="field">
        <label for="summary">Summary <span class="muted">(optional)</span></label>
        <input id="summary" name="summary" type="text" placeholder="e.g. research assist for agent ops" autocomplete="off" />
      </div>
      <div class="field">
        <label for="jobBrief">Job brief <span class="muted">(optional, cleared on reveal)</span></label>
        <textarea id="jobBrief" name="jobBrief" rows="4" placeholder="Sensitive brief held until both sides pay"></textarea>
        <p class="field-hint">Held until both sides pay, then cleared with the connection.</p>
      </div>
      <div class="field">
        <label for="handoffHint">How should the other side reach you after both pay? <span class="muted">(optional)</span></label>
        <textarea id="handoffHint" name="handoffHint" class="short" rows="3" maxlength="500" placeholder="Session, SimpleX, email relay, etc."></textarea>
        <p class="field-hint">Shown once with the connection code, then cleared. Max ~500 characters.</p>
      </div>
      <button type="submit">${escapeHtml(submitLabel)}</button>
    </form>
    <section class="card contact-card" id="get-a-reply" aria-labelledby="contact-heading">
      <h2 id="contact-heading">Get a reply</h2>
      <p class="muted contact-lede">Prefer a human? Ask Crew to email you back or call you once. One message — nothing sticky.</p>
      <form id="contact-form" class="contact-form" novalidate>
        <fieldset class="contact-method">
          <legend class="sr-only">How should we reach you?</legend>
          <label class="choice">
            <input type="radio" name="method" value="email" checked />
            <span>Email me back</span>
          </label>
          <label class="choice">
            <input type="radio" name="method" value="callback" />
            <span>Request a callback</span>
          </label>
        </fieldset>
        <div class="field" data-contact-email>
          <label for="contact-email">Email</label>
          <input id="contact-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" />
        </div>
        <div class="field" data-contact-phone hidden>
          <label for="contact-phone">Phone</label>
          <input id="contact-phone" name="phone" type="tel" autocomplete="tel" maxlength="20" placeholder="+61 …" />
        </div>
        <div class="field">
          <label for="contact-note">Note <span class="muted">(optional, one line)</span></label>
          <input id="contact-note" name="note" type="text" maxlength="200" autocomplete="off" placeholder="What is this about?" />
        </div>
        <div class="hp-field" aria-hidden="true">
          <label for="contact-website">Website</label>
          <input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off" />
        </div>
        <button type="submit" id="contact-submit">Send</button>
        <p id="contact-status" class="contact-status" role="status" hidden></p>
      </form>
    </section>
    <p class="page-nav muted">Invoices expire after ~1 hour if unpaid. <a href="${MARKETING_URL}">Learn how Crew works →</a></p>
  ` + contactFormScript()
    )
  );
});

app.post("/create", async (req, res) => {
  const ip = clientIp(req);
  if (!checkCreateRateLimit(ip)) {
    return res.status(429).type("html").send(
      pageShell(
        "Rate limited",
        `<h1>Too many matches</h1><p>Max 10 creates per IP per 10 minutes. Try again later.</p><p><a href="/">← Back</a></p>`
      )
    );
  }
  try {
    const summary = typeof req.body?.summary === "string" ? req.body.summary.trim() : undefined;
    const jobBrief = typeof req.body?.jobBrief === "string" ? req.body.jobBrief.trim() : undefined;
    const handoffHint = normaliseHandoffHint(req.body?.handoffHint);
    const role = parseMarketingRole(req.body?.role);
    const result = await createMatch({
      summary: summary || undefined,
      jobBrief: jobBrief || undefined,
      handoffHint,
    });
    const { id, shareUrls, expiresAt } = result;
    // role=contractor → visitor is contractor looking for work → emphasise operator share link
    // role=operator → visitor is operator posting work → emphasise contractor share link
    const emphasiseContractor = role === "operator";
    const emphasiseOperator = role === "contractor";
    const contractorCardClass = emphasiseContractor
      ? "card highlight share-emphasised"
      : emphasiseOperator
        ? "card share-secondary"
        : "card";
    const operatorCardClass = emphasiseOperator
      ? "card highlight share-emphasised"
      : emphasiseContractor
        ? "card share-secondary"
        : "card";
    const contractorHint = emphasiseContractor
      ? `<p class="ok">Send this link to contractors taking the job.</p>`
      : "";
    const operatorHint = emphasiseOperator
      ? `<p class="ok">Send this link to the AI / operator side.</p>`
      : "";
    const lead = emphasiseContractor
      ? `<p>Share the <strong>contractor</strong> link below — that’s who you’re hiring for this job.</p>`
      : emphasiseOperator
        ? `<p>Share the <strong>operator</strong> link below — send that to the AI / operator side.</p>`
        : `<p>Share <strong>one link per side</strong> — each party only needs their own page.</p>`;
    const backHref = role ? `/?role=${encodeURIComponent(role)}` : "/";
    const contractorBlock = `
    <div class="${contractorCardClass}">
      <h2>Contractor${emphasiseContractor ? " — send this" : ""}</h2>
      ${contractorHint}
      <input class="share-url" id="url-contractor" type="text" readonly value="${escapeHtml(shareUrls.contractor)}" />
      <p class="row-actions">
        <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('url-contractor').value)">Copy</button>
        <a class="btn" href="${escapeHtml(shareUrls.contractor)}" target="_blank" rel="noopener">Open</a>
      </p>
    </div>`;
    const operatorBlock = `
    <div class="${operatorCardClass}">
      <h2>Operator${emphasiseOperator ? " — send this" : ""}</h2>
      ${operatorHint}
      <input class="share-url" id="url-operator" type="text" readonly value="${escapeHtml(shareUrls.operator)}" />
      <p class="row-actions">
        <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('url-operator').value)">Copy</button>
        <a class="btn" href="${escapeHtml(shareUrls.operator)}" target="_blank" rel="noopener">Open</a>
      </p>
    </div>`;
    // Emphasised side first when role is set
    const shareBlocks = emphasiseOperator
      ? operatorBlock + contractorBlock
      : contractorBlock + operatorBlock;
    res.type("html").send(
      pageShell(
        "Match created",
        `
    <h1>Match created</h1>
    <p class="mono">${escapeHtml(id)}</p>
    <p class="muted">Pay window expires: <strong>${escapeHtml(formatExpiryLocal(expiresAt))}</strong></p>
    ${lead}
    ${shareBlocks}
    <p class="muted">Hub (both sides + status): <a href="${escapeHtml(shareUrls.hub)}">${escapeHtml(shareUrls.hub)}</a></p>
    <p class="page-nav"><a href="${escapeHtml(backHref)}">← New match</a></p>
  `
      )
    );
  } catch (err) {
    res.status(500).type("html").send(
      pageShell("Error", `<h1>Create failed</h1><pre>${escapeHtml(err instanceof Error ? err.message : String(err))}</pre>`)
    );
  }
});

function renderSidePage(matchId: string, side: "contractor" | "operator", res: express.Response) {
  // Peek only — do not reveal on HTML paint; JS poll hits GET /api/matches/:id for reveal.
  const peek = peekMatchForPage(matchId);
  if (!peek) {
    return res.status(404).type("html").send(pageShell("Not found", "<h1>Match not found</h1>"));
  }

  const myInv = peek.invoices.find((i) => i.side === side);
  const otherSide = side === "contractor" ? "operator" : "contractor";
  const otherInv = peek.invoices.find((i) => i.side === otherSide);
  const closed = peek.status === "expired" || peek.status === "cancelled";

  let payBlock = "";
  if (!myInv) {
    payBlock = `<p class="warn">No invoice for this side.</p>`;
  } else if (myInv.status === "paid") {
    payBlock = `<p class="ok">Your $5 is paid.</p>`;
  } else if (closed) {
    payBlock = `<p class="warn" data-pay-encourage>${peek.status === "expired" ? "Expired" : "Cancelled"} — do not pay.</p>`;
  } else if (mockPayAllowed()) {
    payBlock = `
      <span data-pay-encourage>
      <a class="btn" href="/mock-pay/${encodeURIComponent(myInv.id)}?returnTo=${encodeURIComponent(`/m/${matchId}/${side}`)}">Mock pay $5</a>
      <a class="link" href="${escapeHtml(myInv.payUrl)}" target="_blank" rel="noopener">pay link</a>
      </span>`;
  } else {
    payBlock = `<span data-pay-encourage><a class="btn" href="${escapeHtml(myInv.payUrl)}" target="_blank" rel="noopener">Pay $5</a></span>`;
  }

  const summaryBits = [
    peek.summary ? `<p>${escapeHtml(peek.summary)}</p>` : "",
    peek.jobBrief ? `<p class="muted">Brief on file (cleared when connection is revealed).</p>` : "",
  ].join("");

  const expiryLine = peek.expiresAt
    ? `<p class="muted">Pay by: <span id="live-expiry">${escapeHtml(
        closed ? (peek.status === "expired" ? "Expired" : "Cancelled") : formatExpiryLocal(peek.expiresAt)
      )}</span></p>`
    : `<p class="muted"><span id="live-expiry"></span></p>`;

  res.type("html").send(
    pageShell(
      `${side} · ${matchId.slice(0, 8)}`,
      `
    <h1>${escapeHtml(side === "contractor" ? "Contractor" : "Operator")} page</h1>
    <p class="mono">${escapeHtml(matchId)}</p>
    ${summaryBits}
    <p>Status: <strong id="live-status">${escapeHtml(peek.status)}</strong> <span class="muted">(auto-updates)</span></p>
    ${expiryLine}

    <div class="card" data-invoice-side="${side}">
      <h2>Your payment</h2>
      <p>Amount: <strong>$5</strong> · Status: <span data-inv-status>${escapeHtml(myInv?.status || "?")}</span></p>
      <div data-inv-action>${payBlock}</div>
    </div>

    <div class="card muted" data-invoice-side="${otherSide}">
      <h2>Other side (${escapeHtml(otherSide)})</h2>
      <p>Status: <span data-inv-status>${escapeHtml(otherInv?.status || "?")}</span></p>
      <p class="muted">They use their own share link — no pay button here.</p>
    </div>

    <div id="live-connection"></div>
    ${
      peek.status === "consumed"
        ? `<div class="card"><h2>Consumed</h2><p>Connection already revealed and cleared from the database.</p></div>`
        : peek.status === "expired"
          ? `<div class="card"><h2>Expired</h2><p>Payment window ended. Do not pay.</p></div>`
          : peek.status === "cancelled"
            ? `<div class="card"><h2>Cancelled</h2><p>This match was cancelled. Do not pay.</p></div>`
            : ""
    }

    <p class="page-nav"><a href="/m/${escapeHtml(matchId)}">Hub</a> · <a href="/">← New match</a></p>
  `,
      pollScript(matchId, side)
    )
  );
}

/** Read match + invoices without revealing connection (for HTML first paint). */
function peekMatchForPage(matchId: string) {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as
    | {
        id: string;
        summary: string | null;
        job_brief: string | null;
        status: string;
        consumed_at: string | null;
      }
    | undefined;
  if (!match) return null;

  const invoices = db
    .prepare(
      "SELECT id, side, amount_usd, pay_url, status, expires_at FROM invoices WHERE match_id = ? ORDER BY side"
    )
    .all(matchId) as Array<{
    id: string;
    side: "contractor" | "operator";
    amount_usd: number;
    pay_url: string;
    status: string;
    expires_at: string | null;
  }>;

  let status: MatchStatus | string = match.status;
  if (match.status === "consumed" || match.consumed_at) {
    status = "consumed";
  } else if (match.status === "cancelled") {
    status = "cancelled";
  } else {
    try {
      status = applyExpiryIfNeeded(matchId);
    } catch {
      status = match.status;
    }
  }

  return {
    id: match.id,
    summary: match.summary,
    jobBrief: match.job_brief,
    status: status as string,
    expiresAt: matchExpiresAt(matchId),
    invoices: invoices.map((i) => ({
      id: i.id,
      side: i.side,
      amountUsd: i.amount_usd,
      payUrl: i.pay_url,
      status: i.status,
      expiresAt: i.expires_at,
    })),
  };
}

app.get("/m/:id/contractor", (req, res) => {
  renderSidePage(req.params.id, "contractor", res);
});

app.get("/m/:id/operator", (req, res) => {
  renderSidePage(req.params.id, "operator", res);
});

app.get("/m/:id", (req, res) => {
  const peek = peekMatchForPage(req.params.id);
  if (!peek) {
    return res.status(404).type("html").send(pageShell("Not found", "<h1>Match not found</h1>"));
  }

  const base = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
  const contractorUrl = `${base}/m/${peek.id}/contractor`;
  const operatorUrl = `${base}/m/${peek.id}/operator`;
  const closed = peek.status === "expired" || peek.status === "cancelled";
  const canCancel =
    peek.status !== "consumed" &&
    peek.status !== "ready" &&
    peek.status !== "cancelled" &&
    peek.status !== "expired";

  const invoiceRows = peek.invoices
    .map((inv) => {
      let pay: string;
      if (inv.status === "paid") {
        pay = `<span class="ok">paid</span>`;
      } else if (closed) {
        pay = `<span class="warn">closed</span>`;
      } else {
        pay = `<a class="link" href="/m/${escapeHtml(peek.id)}/${escapeHtml(inv.side)}">Open ${escapeHtml(inv.side)} page</a>`;
      }
      return `<tr data-invoice-side="${escapeHtml(inv.side)}">
        <td>${escapeHtml(inv.side)}</td>
        <td>$${inv.amountUsd}</td>
        <td data-inv-status>${escapeHtml(inv.status)}</td>
        <td data-inv-action>${pay}</td>
      </tr>`;
    })
    .join("");

  const expiryLine = peek.expiresAt
    ? `<p class="muted">Pay by: <span id="live-expiry">${escapeHtml(
        closed ? (peek.status === "expired" ? "Expired" : "Cancelled") : formatExpiryLocal(peek.expiresAt)
      )}</span></p>`
    : `<p class="muted"><span id="live-expiry"></span></p>`;

  const cancelBlock = canCancel
    ? `
    <div class="card">
      <h2>Cancel match</h2>
      <p class="muted">Stops both sides from paying. Only while not both-paid / not consumed.</p>
      <button type="button" id="cancel-btn" class="btn-danger">Cancel match</button>
      <span id="cancel-msg" class="muted"></span>
    </div>
    <script>
    (function () {
      var btn = document.getElementById("cancel-btn");
      var msg = document.getElementById("cancel-msg");
      if (!btn) return;
      btn.addEventListener("click", function () {
        if (!confirm("Cancel this match? Parties should not pay after cancel.")) return;
        btn.disabled = true;
        fetch("/api/matches/" + encodeURIComponent(${JSON.stringify(peek.id)}) + "/cancel", {
          method: "POST",
          headers: { Accept: "application/json" }
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
          .then(function (res) {
            if (res.ok) {
              msg.textContent = "Cancelled.";
              var st = document.getElementById("live-status");
              if (st) st.textContent = "cancelled";
              location.reload();
            } else {
              msg.textContent = (res.j && (res.j.message || res.j.error)) || "Cancel failed";
              btn.disabled = false;
            }
          })
          .catch(function () {
            msg.textContent = "Cancel failed";
            btn.disabled = false;
          });
      });
    })();
    </script>`
    : "";

  res.type("html").send(
    pageShell(
      `Match ${peek.id.slice(0, 8)}`,
      `
    <h1>Match hub</h1>
    <p class="mono">${escapeHtml(peek.id)}</p>
    ${peek.summary ? `<p>${escapeHtml(peek.summary)}</p>` : ""}
    <p>Status: <strong id="live-status">${escapeHtml(peek.status)}</strong> <span class="muted">(auto-updates)</span></p>
    ${expiryLine}

    <div class="card">
      <h2>Share links</h2>
      <p>Give each party only their own link:</p>
      <p><strong>Contractor</strong><br />
        <input class="share-url" type="text" readonly value="${escapeHtml(contractorUrl)}" id="hub-c" />
        <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('hub-c').value)">Copy</button>
        <a class="btn" href="${escapeHtml(contractorUrl)}">Open</a>
      </p>
      <p><strong>Operator</strong><br />
        <input class="share-url" type="text" readonly value="${escapeHtml(operatorUrl)}" id="hub-o" />
        <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('hub-o').value)">Copy</button>
        <a class="btn" href="${escapeHtml(operatorUrl)}">Open</a>
      </p>
    </div>

    <table>
      <thead><tr><th>Side</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${invoiceRows}</tbody>
    </table>

    <div id="live-connection"></div>
    ${
      peek.status === "consumed"
        ? `<div class="card"><h2>Consumed</h2><p>Connection already revealed and cleared from the database.</p></div>`
        : peek.status === "expired"
          ? `<div class="card"><h2>Expired</h2><p>Payment window ended. Do not pay — no connection will be revealed.</p></div>`
          : peek.status === "cancelled"
            ? `<div class="card"><h2>Cancelled</h2><p>This match was cancelled. Do not pay.</p></div>`
            : peek.status === "ready"
              ? `<div class="card muted"><p>Both paid — waiting for reveal via poll…</p></div>`
              : `<div class="card muted"><p>Waiting for both sides to pay.</p></div>`
    }

    ${cancelBlock}

    <p class="page-nav"><a href="/">← New match</a></p>
  `,
      pollScript(peek.id)
    )
  );
});

app.get("/mock-pay/:invoiceId", (req, res) => {
  if (!mockPayAllowed()) {
    return res.status(404).type("html").send(pageShell("Disabled", "<h1>Mock pay disabled</h1>"));
  }
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.invoiceId) as
    | { id: string; match_id: string; side: string; status: string; expires_at: string | null }
    | undefined;
  if (!invoice) {
    return res.status(404).type("html").send(pageShell("Not found", "<h1>Invoice not found</h1>"));
  }
  const returnTo =
    typeof req.query.returnTo === "string" &&
    req.query.returnTo.startsWith(`/m/${invoice.match_id}`) &&
    !req.query.returnTo.includes("://")
      ? req.query.returnTo
      : `/m/${invoice.match_id}/${invoice.side}`;

  if (invoice.status === "paid") {
    return res.redirect(303, returnTo);
  }

  let matchStatus: string = "pending_payment";
  try {
    matchStatus = applyExpiryIfNeeded(invoice.match_id);
  } catch {
    /* ignore */
  }
  if (matchStatus === "expired" || matchStatus === "cancelled" || matchStatus === "consumed") {
    return res.type("html").send(
      pageShell(
        "Closed",
        `
    <h1>Payment closed</h1>
    <p>Match status: <strong>${escapeHtml(matchStatus)}</strong>. Do not pay.</p>
    <p><a href="${escapeHtml(returnTo)}">Back</a></p>
  `
      )
    );
  }

  res.type("html").send(
    pageShell(
      "Mock pay",
      `
    <h1>Mock pay</h1>
    <p>Side: <strong>${escapeHtml(invoice.side)}</strong> · $5 USD</p>
    <p class="mono">${escapeHtml(invoice.id)}</p>
    ${
      invoice.expires_at
        ? `<p class="muted">Expires: ${escapeHtml(formatExpiryLocal(invoice.expires_at))}</p>`
        : ""
    }
    <form method="post" action="/api/dev/pay/${encodeURIComponent(invoice.id)}?redirect=1">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      <button type="submit">Mark paid (mock)</button>
    </form>
    <p><a href="${escapeHtml(returnTo)}">Cancel</a></p>
  `
    )
  );
});

app.listen(PORT, () => {
  console.log(`Crew app listening on http://localhost:${PORT} (live=${isLiveMode()} mockPay=${mockPayAllowed()})`);
});
