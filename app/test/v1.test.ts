process.env.DB_PATH = ":memory:";
process.env.CREW_ADMIN_TOKEN = "test-admin-token-0123456789";
process.env.CREW_ALLOW_INSECURE_CALLBACKS = "1";
process.env.CREW_PUBLIC_INCLUDE_TEST = "1";
delete process.env.XMRCHECKOUT_API_KEY;

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const express = (await import("express")).default;
const { mountV1 } = await import("../src/v1/router.js");
const { advanceClock, HOUR, DAY, nowMs } = await import("../src/v1/clock.js");
const core = await import("../src/v1/core.js");
const { deliverDueWebhooks, verifySignature } = await import("../src/v1/webhooks.js");
const { db } = await import("../src/db.js");

let base = "";
let server: http.Server;
const ADMIN = { Authorization: "Bearer test-admin-token-0123456789" };

// Webhook receiver
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let hookServer: http.Server;
let hookUrl = "";
let hookFail = false;

async function api(method: string, path: string, opts: { token?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers || {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  const app = express();
  mountV1(app, { timers: false });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.PUBLIC_BASE_URL = base;
  hookServer = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: b });
      res.statusCode = hookFail ? 500 : 200;
      res.end("ok");
    });
  });
  hookServer.listen(0);
  await new Promise((r) => hookServer.once("listening", r));
  hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/hook`;
});
after(() => { server.close(); hookServer.close(); });

const XMR = "4" + "A".repeat(94);
const EVM = "0x" + "a".repeat(40);

async function newOperator() {
  const r = await api("POST", "/v1/admin/operators", { headers: ADMIN, body: { label: "t" } });
  assert.equal(r.status, 201);
  return { key: r.json.api_key as string, opId: r.json.operator_id as string, whsec: r.json.webhook_secret as string };
}
async function newContractor(handle: string, cats: string[], pay: Record<string, string> = { pay_xmr: XMR }) {
  const r = await api("POST", "/v1/admin/contractors", { headers: ADMIN, body: { handle, categories: cats, ...pay } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.token as string;
}
const deadline = (h = 96) => new Date(nowMs() + h * HOUR).toISOString();
const checkBody = (extra: Record<string, unknown> = {}) => ({ category: "human_check_of_ai_output", brief: "Please fact-check this 3-paragraph AI summary for errors.", deadline: deadline(), accept_terms: true, ...extra });
/** create + mock-pay fee (unless credit used) + approve */
async function openTask(key: string, idem: string, body: Record<string, unknown> = checkBody()) {
  const c = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": idem }, body });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  if (c.json.entry_fee.status === "pending") {
    const p = await api("POST", `/v1/tasks/${c.json.id}/fee/mock-pay`, { token: key });
    assert.equal(p.json.status, "in_review");
  }
  const o = await api("POST", `/v1/admin/tasks/${c.json.id}/approve`, { headers: ADMIN });
  assert.equal(o.json.status, "open");
  return c.json;
}

test("categories: 4 types with suggested prices, $5 entry fee, terms", async () => {
  const r = await api("GET", "/v1/categories");
  assert.equal(r.status, 200);
  const m = Object.fromEntries(r.json.data.map((c: any) => [c.id, [c.suggested_price_usd, c.sla_hours]]));
  assert.deepEqual(m, { human_check_of_ai_output: [15, 24], code_or_doc_review: [20, 48], data_labelling: [10, 24], adelaide_photo_or_errand: [25, 48] });
  assert.deepEqual(r.json.policy, { entry_fee_usd: 5, no_accept_fee_credit_hours: 24, retention_days_default: 14, payments_mode: "test" });
  assert.match(r.json.terms.summary, /matching service only/);
  assert.ok(r.json.terms.points.some((p: string) => /half upfront/.test(p)));
});

test("auth: hashed keys, bad/revoked keys rejected", async () => {
  const { key } = await newOperator();
  const { sha256 } = await import("../src/v1/util.js");
  assert.ok(db.prepare("SELECT 1 FROM v1_api_keys WHERE hash = ?").get(sha256(key)));
  assert.equal(db.prepare("SELECT 1 FROM v1_api_keys WHERE hash = ? OR prefix = ?").get(key, key), undefined);
  assert.equal((await api("GET", "/v1/account")).status, 401);
  assert.equal((await api("GET", "/v1/account", { token: "crew_sk_test_nope_nope_nope_nope_nope" })).status, 401);
  const acct = await api("GET", "/v1/account", { token: key });
  assert.equal(acct.status, 200);
  assert.equal(acct.json.entry_fee_usd, 5);
  db.prepare("UPDATE v1_api_keys SET revoked_at = 'x' WHERE id = ?").run(acct.json.key.id);
  assert.equal((await api("GET", "/v1/account", { token: key })).status, 401);
  assert.equal((await api("GET", "/v1/admin/review")).status, 401);
});

test("create task: validation, idempotency, mock entry fee only", async () => {
  const { key } = await newOperator();
  assert.equal((await api("POST", "/v1/tasks", { token: key, body: checkBody() })).status, 400);
  assert.equal((await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "a0" }, body: checkBody({ budget_usd: 10 }) })).json.error.code, "budget_too_low");
  assert.equal((await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "a1" }, body: { ...checkBody(), category: "adelaide_photo_or_errand" } })).status, 400);
  const r1 = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "k1" }, body: checkBody() });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.status, "awaiting_fee");
  assert.equal(r1.json.entry_fee.amount_usd, 5);
  assert.match(r1.json.entry_fee.invoice_id, /^mock_fee_/);
  assert.equal(r1.json.suggested_price_usd, 15);
  assert.match(r1.json.job_payment, /direct/);
  const replay = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "k1" }, body: checkBody({ deadline: r1.json.deadline }) });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.id, r1.json.id);
  assert.equal((await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "k1" }, body: checkBody({ deadline: r1.json.deadline, budget_usd: 99 }) })).status, 409);
  // reveal blocked before fee + match
  assert.equal((await api("GET", `/v1/tasks/${r1.json.id}/reveal`, { token: key })).json.error.code, "fee_required");
  const paid = await api("POST", `/v1/tasks/${r1.json.id}/fee/mock-pay`, { token: key });
  assert.equal(paid.json.entry_fee.status, "paid");
  assert.equal((await api("GET", `/v1/tasks/${r1.json.id}/reveal`, { token: key })).json.error.code, "not_ready");
  const { key: k2 } = await newOperator();
  assert.equal((await api("GET", `/v1/tasks/${r1.json.id}`, { token: k2 })).status, 404);
});

test("full flow: fee → review → contractor accepts → reveal pay address → result → accept w/ rating; no money ledger", async () => {
  const { key, whsec } = await newOperator();
  const ct = await newContractor("ada_checks", ["human_check_of_ai_output"], { pay_usdc: EVM, pay_usdc_network: "base" });
  const c = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "f1" }, body: checkBody({ callback_url: hookUrl }) });
  const t = c.json;
  assert.equal((await api("GET", "/v1/admin/review", { headers: ADMIN })).json.data.some((x: any) => x.id === t.id), false); // unpaid not in review
  await api("POST", `/v1/tasks/${t.id}/fee/mock-pay`, { token: key });
  assert.equal((await api("GET", "/v1/contractor/tasks", { token: ct })).json.data.length, 0);
  assert.ok((await api("GET", "/v1/admin/review", { headers: ADMIN })).json.data.some((x: any) => x.id === t.id));
  await api("POST", `/v1/admin/tasks/${t.id}/approve`, { headers: ADMIN });
  const seen = (await api("GET", "/v1/contractor/tasks", { token: ct })).json.data.find((x: any) => x.id === t.id);
  assert.equal(seen.suggested_price_usd, 15);
  const other = await newContractor("bob_rev", ["human_check_of_ai_output"]);
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: ct })).status, 200);
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: other })).status, 409);
  const rv = await api("GET", `/v1/tasks/${t.id}/reveal`, { token: key });
  assert.equal(rv.status, 200);
  assert.deepEqual(rv.json.pay_to, { xmr: null, usdc: { address: EVM, network: "base" } });
  assert.equal(rv.json.suggested_price_usd, 15);
  assert.match(rv.json.note, /not a party/);
  assert.ok(!JSON.stringify(rv.json).includes("ada_checks"));
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/submit`, { token: ct, body: { result: { verdict: "maybe", notes: "x" } } })).status, 400);
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/submit`, { token: ct, body: { result: { verdict: "fail", notes: "Date in para 2 wrong" }, files: [{ mime: "text/plain", data_base64: Buffer.from("notes").toString("base64") }] } })).status, 200);
  const res = await api("GET", `/v1/tasks/${t.id}/result`, { token: key });
  assert.equal(res.json.result.verdict, "fail");
  assert.equal(await (await fetch(res.json.proof_files[0].url)).text(), "notes");
  assert.equal((await fetch(res.json.proof_files[0].url.replace(/sig=../, "sig=00"))).status, 403);
  assert.equal((await api("POST", `/v1/tasks/${t.id}/accept`, { token: key, body: { rating: 9 } })).status, 400);
  const acc = await api("POST", `/v1/tasks/${t.id}/accept`, { token: key, body: { rating: 4 } });
  assert.equal(acc.json.status, "completed");
  const rc = await api("GET", `/v1/receipts/${acc.json.receipt_id}`, { token: key });
  assert.equal(rc.json.entry_fee_usd, 5);
  assert.match(rc.json.job_payment, /not processed by Crew/);
  assert.deepEqual(rc.json.events.map((e: any) => e.type), ["task.submitted", "task.fee_paid", "task.opened", "task.matched", "task.delivered", "task.completed"]);
  // no custody tables exist
  for (const tbl of ["v1_ledger", "v1_payouts", "v1_topups"]) assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(tbl), undefined);

  await deliverDueWebhooks();
  const mine = received.filter((r) => r.body.includes(t.id));
  assert.equal(mine.length, 6);
  for (const m of mine) assert.ok(verifySignature(whsec, m.body, String(m.headers["crew-signature"]), 300, Math.floor(nowMs() / 1000)));
  assert.ok(!verifySignature("whsec_wrong", mine[0].body, String(mine[0].headers["crew-signature"]), 300, Math.floor(nowMs() / 1000)));

  const html = await (await fetch(base + "/jobs")).text();
  assert.ok(html.includes("human_check_of_ai_output"));
  assert.ok(!html.includes("fact-check this") && !html.includes(t.id) && !html.includes(EVM));
  assert.ok(html.includes("ada_checks") && html.includes("4.00 / 5"));
  assert.ok(!JSON.stringify((await api("GET", "/v1/public/jobs")).json).includes(t.id));
});

test("contractor: pay address required + validated, eligibility, invite-only", async () => {
  const { key } = await newOperator();
  assert.equal((await api("POST", "/v1/admin/contractors", { headers: ADMIN, body: { handle: "badaddr", categories: ["data_labelling"], pay_xmr: "nope" } })).status, 400);
  const noPay = await newContractor("nopay_one", ["human_check_of_ai_output"], {});
  const label = await newContractor("label_only", ["data_labelling"]);
  const t = await openTask(key, "e1");
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: label })).status, 403);
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: noPay })).status, 400);
  assert.equal((await api("PUT", "/v1/contractor/profile", { token: noPay, body: { pay_usdc: EVM } })).status, 400); // network missing
  assert.equal((await api("PUT", "/v1/contractor/profile", { token: noPay, body: { pay_xmr: XMR } })).json.pay_xmr, XMR);
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: noPay })).status, 200);
  assert.deepEqual((await api("GET", `/v1/tasks/${t.id}/reveal`, { token: key })).json.pay_to, { xmr: XMR, usdc: null });
  assert.equal((await api("GET", "/v1/contractor/tasks", { token: "crew_ct_fake" })).status, 401);
});

test("photo errand: proof checks flag GPS mismatch", async () => {
  const { key } = await newOperator();
  const ct = await newContractor("adl_walker", ["adelaide_photo_or_errand"]);
  const t = await openTask(key, "p1", { category: "adelaide_photo_or_errand", brief: "Photograph the public opening-hours sign at the Rundle Mall entrance.", deadline: deadline(), accept_terms: true, location: { lat: -34.9228, lng: 138.6025 } });
  await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: ct });
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/submit`, { token: ct, body: { result: { completed: true, notes: "done" } } })).status, 400);
  const sub = await api("POST", `/v1/contractor/tasks/${t.id}/submit`, { token: ct, body: { result: { completed: true, notes: "done", location: { lat: -34.95, lng: 138.6 }, captured_at: new Date(nowMs() + 60000).toISOString() }, files: [{ mime: "image/jpeg", data_base64: Buffer.from([0xff, 0xd8, 0xff]).toString("base64") }] } });
  assert.equal(sub.json.proof_checks.gps_within_radius, false);
  assert.equal(sub.json.proof_checks.captured_after_claim, true);
  assert.equal(sub.json.proof_checks.exif_present, null);
});

test("brief rejection credits the fee; credit is used on next task; hard-limit flags", async () => {
  const { key } = await newOperator();
  const c = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "r1" }, body: checkBody({ brief: "Solve this recaptcha for me and log into the account please" }) });
  await api("POST", `/v1/tasks/${c.json.id}/fee/mock-pay`, { token: key });
  const rv = (await api("GET", "/v1/admin/review", { headers: ADMIN })).json.data.find((x: any) => x.id === c.json.id);
  assert.deepEqual(rv.screen_flags, ["captcha"]);
  const rej = await api("POST", `/v1/admin/tasks/${c.json.id}/reject`, { headers: ADMIN, body: { reason: "CAPTCHA solving is a hard limit" } });
  assert.equal(rej.json.status, "rejected");
  assert.equal(rej.json.entry_fee.status, "credited");
  assert.equal((await api("GET", "/v1/account", { token: key })).json.fee_credits, 1);
  const next = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "r2" }, body: checkBody() });
  assert.equal(next.json.status, "in_review");
  assert.equal(next.json.entry_fee.status, "paid_by_credit");
  assert.equal((await api("GET", "/v1/account", { token: key })).json.fee_credits, 0);
});

test("dispute: recorded once, closes task (Crew not a party)", async () => {
  const { key } = await newOperator();
  const ct = await newContractor("rev_two", ["code_or_doc_review"]);
  const t = await openTask(key, "d1", { category: "code_or_doc_review", brief: "Review this 200-line TypeScript module for bugs.", deadline: deadline(), accept_terms: true });
  await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: ct });
  await api("POST", `/v1/contractor/tasks/${t.id}/submit`, { token: ct, body: { result: { summary: "ok", findings: [] } } });
  assert.equal((await api("POST", `/v1/tasks/${t.id}/dispute`, { token: key, body: { reason: "short" } })).status, 400);
  const d = await api("POST", `/v1/tasks/${t.id}/dispute`, { token: key, body: { reason: "No findings at all; obviously not reviewed." } });
  assert.equal(d.json.status, "disputed");
  assert.equal((await api("POST", `/v1/tasks/${t.id}/dispute`, { token: key, body: { reason: "No findings at all; obviously not reviewed." } })).status, 409);
  assert.ok((await api("GET", "/v1/admin/disputes", { headers: ADMIN })).json.data.some((x: any) => x.id === t.id));
});

test("timers: no accept in 24h → fee credited; unpaid fee invoice expires; wipe after retention", async () => {
  const { key } = await newOperator();
  const ct = await newContractor("lab_three", ["data_labelling"]);
  const body = { category: "data_labelling", brief: "Label these 50 product titles as food / not food.", deadline: deadline(24 * 10), accept_terms: true };
  const a = await openTask(key, "t1", body);
  const b = await openTask(key, "t2", { ...body, retention_days: 1 });
  const unpaid = (await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "t3" }, body })).json;
  await api("POST", `/v1/contractor/tasks/${b.id}/claim`, { token: ct });
  await api("POST", `/v1/contractor/tasks/${b.id}/submit`, { token: ct, body: { result: { labels: [{ item_id: "1", label: "food" }] }, files: [{ mime: "text/plain", data_base64: "aGk=" }] } });

  advanceClock(2 * HOUR);
  core.sweep();
  assert.equal(core.getTask(unpaid.id)!.status, "cancelled");
  assert.equal(core.getTask(unpaid.id)!.fee_status, "expired");
  assert.equal(core.getTask(a.id)!.status, "open");
  advanceClock(23 * HOUR);
  core.sweep();
  assert.equal(core.getTask(a.id)!.status, "expired");
  assert.equal(core.getTask(a.id)!.fee_status, "credited");
  assert.equal(core.getTask(b.id)!.status, "delivered"); // no auto-accept escrow
  assert.equal((await api("GET", "/v1/account", { token: key })).json.fee_credits, 1);

  const wb = core.getTask(b.id)!;
  assert.ok(wb.wiped_at, "1-day retention from delivery");
  assert.equal(wb.brief, null);
  assert.equal(wb.pay_to_json, null);
  assert.ok(wb.result_sha256);
  assert.equal((await api("GET", `/v1/tasks/${b.id}/result`, { token: key })).status, 410);
  assert.equal((await api("GET", `/v1/tasks/${b.id}/reveal`, { token: key })).status, 410);
  const rc = (await api("GET", `/v1/receipts/rcpt_${b.id.slice(5)}`, { token: key })).json;
  assert.equal(rc.proof_sha256.length, 1);
  assert.ok(rc.events.some((e: any) => e.type === "data.wiped"));
  assert.ok(core.getTask(a.id)!.brief, "14-day default not yet reached");
  advanceClock(14 * DAY);
  core.sweep();
  assert.equal(core.getTask(a.id)!.brief, null);
});

test("webhook retries with backoff on failure", async () => {
  const { key } = await newOperator();
  hookFail = true;
  const t = (await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "w1" }, body: checkBody({ callback_url: hookUrl }) })).json;
  await deliverDueWebhooks();
  const d = db.prepare("SELECT * FROM v1_webhook_deliveries WHERE task_id=?").get(t.id) as any;
  assert.equal(d.attempts, 1);
  assert.equal(d.status, "pending");
  hookFail = false;
  advanceClock(61_000);
  await deliverDueWebhooks();
  assert.equal((db.prepare("SELECT status FROM v1_webhook_deliveries WHERE task_id=?").get(t.id) as any).status, "delivered");
});

test("x402 disabled; xmr webhook refuses in test mode; live keys still get mock invoices in test mode", async () => {
  const { key } = await newOperator();
  assert.equal((await api("POST", "/v1/x402")).json.error.code, "payment_rail_disabled");
  assert.equal((await api("GET", "/v1/account", { token: key, headers: { "X-PAYMENT": "abc" } })).status, 501);
  const r = await api("POST", "/v1/admin/operators", { headers: ADMIN, body: { mode: "live" } });
  process.env.XMRCHECKOUT_API_KEY = "would-be-real-key";
  try {
    const t = await api("POST", "/v1/tasks", { token: r.json.api_key, headers: { "Idempotency-Key": "x1" }, body: checkBody() });
    assert.equal(t.status, 201);
    assert.match(t.json.entry_fee.invoice_id, /^mock_fee_/);
    assert.equal((await api("POST", "/v1/webhooks/xmrcheckout", { body: { invoice_id: t.json.entry_fee.invoice_id, status: "confirmed" } })).status, 403);
  } finally {
    delete process.env.XMRCHECKOUT_API_KEY;
  }
});

test("public pages: terms, hard limits, jobs", async () => {
  const terms = await (await fetch(base + "/terms")).text();
  assert.ok(terms.includes("matching service only") && terms.includes("half upfront") && terms.includes("TEST MODE"));
  const h = await (await fetch(base + "/hard-limits")).text();
  assert.ok(h.includes("CAPTCHA") && h.includes("$5.00") && !h.includes("80%"));
  assert.equal((await api("GET", "/v1/terms")).json.summary.includes("not a party"), true);
});

test("in-app MCP endpoint: tools/list + list_categories over streamable HTTP", async () => {
  process.env.CREW_MCP_API_BASE = base;
  const { key } = await newOperator();
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "t", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["accept_result", "dispute_result", "get_result", "get_reveal", "get_task", "list_categories", "post_task"]);
  const r: any = await client.callTool({ name: "list_categories", arguments: {} });
  assert.equal(JSON.parse(r.content[0].text).data.length, 4);
  const p: any = await client.callTool({ name: "post_task", arguments: { category: "data_labelling", brief: "Label 20 sentences as positive or negative sentiment.", deadline: new Date(nowMs() + 48 * HOUR).toISOString(), idempotency_key: "mcp-1", accept_terms: true } });
  assert.equal(JSON.parse(p.content[0].text).status, "awaiting_fee");
  await client.close();
});

test("accept_terms required on create; terms list banned work + credit wording", async () => {
  const { key } = await newOperator();
  const r = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "at1" }, body: checkBody({ accept_terms: undefined }) });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "terms_not_accepted");
  assert.equal((await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "at2" }, body: checkBody({ accept_terms: "yes" }) })).status, 400);
  const t = (await api("GET", "/v1/terms")).json;
  assert.ok(t.banned_work.length >= 5 && t.banned_work.some((b: string) => /CAPTCHA/.test(b)));
  assert.ok(t.points.some((p: string) => /credit toward your next match \(not a cash refund\)/.test(p)));
  const html = await (await fetch(base + "/terms")).text();
  assert.ok(html.includes("Banned work") && html.includes("not a cash refund"));
});

test("ban list: banned operator key can't post; banned contractor can't claim; unban restores", async () => {
  const { key } = await newOperator();
  const acct = (await api("GET", "/v1/account", { token: key })).json;
  const ct = await newContractor("ban_me", ["human_check_of_ai_output"]);
  const t = await openTask(key, "b1");
  assert.equal((await api("POST", "/v1/admin/bans", { headers: ADMIN, body: { contractor_handle: "ban_me" } })).status, 200);
  const c = await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: ct });
  assert.equal(c.status, 403);
  assert.equal(c.json.error.code, "banned");
  assert.equal((await api("POST", "/v1/admin/bans", { headers: ADMIN, body: { api_key_id: acct.key.id } })).json.type, "operator");
  const p = await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "b2" }, body: checkBody() });
  assert.equal(p.status, 403);
  assert.equal(p.json.error.code, "banned");
  const bans = (await api("GET", "/v1/admin/bans", { headers: ADMIN })).json;
  assert.ok(bans.contractors.some((x: any) => x.handle === "ban_me") && bans.operators.some((x: any) => x.id === acct.operator_id));
  assert.equal((await api("POST", "/v1/admin/bans", { headers: ADMIN, body: {} })).status, 400);
  await api("POST", "/v1/admin/unban", { headers: ADMIN, body: { contractor_handle: "ban_me" } });
  await api("POST", "/v1/admin/unban", { headers: ADMIN, body: { operator_id: acct.operator_id } });
  assert.equal((await api("POST", `/v1/contractor/tasks/${t.id}/claim`, { token: ct })).status, 200);
  assert.equal((await api("POST", "/v1/tasks", { token: key, headers: { "Idempotency-Key": "b3" }, body: checkBody() })).status, 201);
});

test("report: API by task id, public form via /jobs ref; feeds admin review", async () => {
  const { key } = await newOperator();
  const t = await openTask(key, "rp1");
  const r1 = await api("POST", `/v1/tasks/${t.id}/report`, { token: key, body: { reason: "Looks like account farming" } });
  assert.equal(r1.status, 201);
  assert.equal((await api("POST", `/v1/tasks/${t.id}/report`, { body: { reason: "x" } })).status, 400);
  assert.equal((await api("POST", `/v1/tasks/job_nope/report`, { body: { reason: "valid reason" } })).status, 404);
  const jobsHtml = await (await fetch(base + "/jobs")).text();
  const ref = (jobsHtml.match(/href="\/report\/(job_[a-f0-9]+)"/) || [])[1];
  assert.ok(ref, "Report link on /jobs");
  assert.ok(!jobsHtml.includes(t.id));
  const form = await (await fetch(`${base}/report/${ref}`)).text();
  assert.ok(form.includes(`action="/v1/tasks/${ref}/report"`));
  const sub = await fetch(`${base}/v1/tasks/${ref}/report`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "reason=" + encodeURIComponent("Banned work: captcha") });
  assert.equal(sub.status, 200);
  assert.ok((await sub.text()).includes("Thanks"));
  const rv = (await api("GET", "/v1/admin/review", { headers: ADMIN })).json;
  const mine = rv.reports.filter((x: any) => x.task_id === t.id);
  assert.equal(mine.length, 2);
  assert.ok(mine.some((x: any) => x.source === "public") && mine.some((x: any) => x.source.startsWith("operator:")));
  await api("POST", `/v1/admin/reports/${mine[0].id}/close`, { headers: ADMIN });
  assert.equal((await api("GET", "/v1/admin/review", { headers: ADMIN })).json.reports.filter((x: any) => x.task_id === t.id).length, 1);
});
