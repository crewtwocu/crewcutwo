import { db } from "../db.js";
import { category, paymentsMode, policy, pseudonymSecret, TERMS, type Category } from "./config.js";
import { DAY, HOUR, nowIso, nowMs } from "./clock.js";
import { ApiError, haversineM, hmacHex, newId, randomToken, sha256, stableStringify } from "./util.js";
import { recordEvent } from "./webhooks.js";

/**
 * NO-CUSTODY model: Crew never holds or moves job money. The agent pays Crew a flat entry fee
 * before the reveal; the contractor's own pay address is revealed and the agent pays them directly.
 */
export type Mode = "live" | "test";

export type TaskRow = {
  id: string; operator_id: string; mode: Mode; category: string; brief: string | null;
  attachments_json: string | null; location_json: string | null; screen_flags_json: string | null;
  suggested_price_cents: number; fee_cents: number;
  fee_status: "pending" | "paid" | "paid_by_credit" | "credited" | "expired";
  fee_invoice_id: string | null; fee_pay_url: string | null; fee_expires_at: string | null;
  status: string; deadline: string; callback_url: string | null; retention_days: number;
  contractor_id: string | null; contractor_ref: string | null; pay_to_json: string | null;
  rejection_reason: string | null; dispute_reason: string | null; rating: number | null;
  result_json: string | null; result_sha256: string | null; proof_checks_json: string | null;
  created_at: string; fee_paid_at: string | null; opened_at: string | null; claimed_at: string | null;
  delivered_at: string | null; closed_at: string | null; wipe_at: string | null; wiped_at: string | null;
};

export type Operator = { id: string; label: string | null; webhook_secret: string; retention_days: number | null; fee_credits: number; created_at: string; banned_at: string | null };

// ---------- operators & keys ----------

export function createOperator(label?: string): { operator: Operator; webhookSecret: string } {
  const id = newId("op");
  const webhookSecret = `whsec_${randomToken(24)}`;
  db.prepare("INSERT INTO v1_operators (id, label, webhook_secret, created_at) VALUES (?,?,?,?)").run(id, label ?? null, webhookSecret, nowIso());
  return { operator: getOperator(id)!, webhookSecret };
}
export function getOperator(id: string): Operator | undefined {
  return db.prepare("SELECT * FROM v1_operators WHERE id = ?").get(id) as Operator | undefined;
}
/** Issue an API key. Plaintext returned once; only sha256 stored. */
export function issueApiKey(operatorId: string, mode: Mode): { id: string; key: string; prefix: string } {
  const key = `crew_sk_${mode}_${randomToken(24)}`;
  const id = newId("key");
  const prefix = key.slice(0, 16);
  db.prepare("INSERT INTO v1_api_keys (id, operator_id, hash, prefix, mode, created_at) VALUES (?,?,?,?,?,?)").run(id, operatorId, sha256(key), prefix, mode, nowIso());
  return { id, key, prefix };
}
export function revokeApiKey(keyId: string): boolean {
  return db.prepare("UPDATE v1_api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), keyId).changes > 0;
}
export type AuthedKey = { keyId: string; operatorId: string; mode: Mode; prefix: string };
export function authenticateKey(presented: string): AuthedKey | null {
  if (!/^crew_sk_(live|test)_[A-Za-z0-9_-]{20,}$/.test(presented)) return null;
  const row = db.prepare("SELECT * FROM v1_api_keys WHERE hash = ?").get(sha256(presented)) as
    | { id: string; operator_id: string; mode: Mode; prefix: string; revoked_at: string | null } | undefined;
  if (!row || row.revoked_at) return null;
  db.prepare("UPDATE v1_api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
  return { keyId: row.id, operatorId: row.operator_id, mode: row.mode, prefix: row.prefix };
}

// ---------- contractors ----------

export type Contractor = { id: string; banned_at: string | null; handle: string; pay_xmr: string | null; pay_usdc: string | null; pay_usdc_network: string | null; categories_json: string; active: number };

const XMR_RE = /^[48][1-9A-HJ-NP-Za-km-z]{94}$|^4[1-9A-HJ-NP-Za-km-z]{105}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USDC_NETWORKS = ["base", "ethereum", "polygon", "arbitrum", "optimism", "solana"];

export type PayInput = { pay_xmr?: unknown; pay_usdc?: unknown; pay_usdc_network?: unknown };
function validatePay(p: PayInput): { xmr: string | null; usdc: string | null; net: string | null } {
  const xmr = p.pay_xmr ? String(p.pay_xmr).trim() : null;
  const usdc = p.pay_usdc ? String(p.pay_usdc).trim() : null;
  const net = p.pay_usdc_network ? String(p.pay_usdc_network).toLowerCase() : null;
  if (xmr && !XMR_RE.test(xmr)) throw new ApiError(400, "invalid_request", "pay_xmr is not a valid Monero address");
  if (usdc) {
    if (!net || !USDC_NETWORKS.includes(net)) throw new ApiError(400, "invalid_request", `pay_usdc_network required: ${USDC_NETWORKS.join("|")}`);
    if (net === "solana" ? !SOL_RE.test(usdc) : !EVM_RE.test(usdc)) throw new ApiError(400, "invalid_request", "pay_usdc is not a valid address for that network");
  }
  return { xmr, usdc, net: usdc ? net : null };
}

export function inviteContractor(handle: string, categories: string[], pay: PayInput = {}): { contractor: Contractor; token: string } {
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/i.test(handle)) throw new ApiError(400, "invalid_request", "handle must be 3-32 chars [a-z0-9_-] (pseudonym, not a real name)");
  for (const c of categories) if (!category(c)) throw new ApiError(400, "invalid_request", `unknown category ${c}`);
  const v = validatePay(pay);
  const token = `crew_ct_${randomToken(24)}`;
  const id = newId("ctr");
  try {
    db.prepare("INSERT INTO v1_contractors (id, handle, token_hash, pay_xmr, pay_usdc, pay_usdc_network, categories_json, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, handle, sha256(token), v.xmr, v.usdc, v.net, JSON.stringify(categories), nowIso());
  } catch {
    throw new ApiError(409, "conflict", "handle already taken");
  }
  return { contractor: getContractor(id)!, token };
}
function getContractor(id: string) {
  return db.prepare("SELECT * FROM v1_contractors WHERE id = ?").get(id) as Contractor | undefined;
}
export function updateContractorPay(c: Contractor, pay: PayInput): Contractor {
  const v = validatePay(pay);
  db.prepare("UPDATE v1_contractors SET pay_xmr=?, pay_usdc=?, pay_usdc_network=? WHERE id=?").run(v.xmr, v.usdc, v.net, c.id);
  return getContractor(c.id)!;
}
export function contractorProfile(c: Contractor) {
  return { handle: c.handle, categories: contractorCategories(c), pay_xmr: c.pay_xmr, pay_usdc: c.pay_usdc, pay_usdc_network: c.pay_usdc_network };
}
export function authenticateContractor(token: string): Contractor | null {
  if (!token.startsWith("crew_ct_")) return null;
  const c = db.prepare("SELECT * FROM v1_contractors WHERE token_hash = ?").get(sha256(token)) as Contractor | undefined;
  return c && c.active ? c : null;
}
function contractorRef(contractorId: string, taskId: string): string {
  return `ctr_ref_${hmacHex(pseudonymSecret(), `${contractorId}:${taskId}`).slice(0, 12)}`;
}
export function contractorCategories(c: Contractor): string[] {
  try { return JSON.parse(c.categories_json) as string[]; } catch { return []; }
}

export function accountView(a: AuthedKey) {
  const op = getOperator(a.operatorId)!;
  return {
    operator_id: op.id,
    mode: a.mode,
    key: { id: a.keyId, prefix: a.prefix },
    entry_fee_usd: policy.entryFeeCents() / 100,
    fee_credits: op.fee_credits,
    retention_days: op.retention_days ?? policy.wipeDaysDefault(),
    payments_mode: paymentsMode(),
    terms: TERMS,
  };
}

// ---------- tasks ----------

const HARD_LIMIT_PATTERNS: [string, RegExp][] = [
  ["captcha", /captcha|recaptcha|hcaptcha|bot[- ]?check/i],
  ["identity_proxy", /\bkyc\b|identity verification|verify (my|their|an?) (id|identity)|selfie with id|sim (card )?registration|pose as|impersonat/i],
  ["account_farming", /account farm|bulk accounts?|fake (reviews?|accounts?|followers|engagement)|sock ?puppet|upvote ring/i],
  ["surveillance", /\bfollow (him|her|them)\b|stalk|track (a|this) person|home address of|photograph (a|this) (person|man|woman)/i],
];
export function screenBrief(brief: string): string[] {
  return HARD_LIMIT_PATTERNS.filter(([, re]) => re.test(brief)).map(([k]) => k);
}

export type CreateTaskInput = {
  category?: unknown; brief?: unknown; budget_usd?: unknown; deadline?: unknown; callback_url?: unknown;
  location?: unknown; attachments?: unknown; retention_days?: unknown; accept_terms?: unknown;
};

function validateCreate(body: CreateTaskInput) {
  const cat = typeof body.category === "string" ? category(body.category) : undefined;
  if (!cat) throw new ApiError(400, "invalid_request", "category must be one of GET /v1/categories");
  if (typeof body.brief !== "string" || body.brief.trim().length < 20 || body.brief.length > 4000) throw new ApiError(400, "invalid_request", "brief must be 20-4000 chars");
  if (body.budget_usd !== undefined && (typeof body.budget_usd !== "number" || !Number.isFinite(body.budget_usd) || body.budget_usd <= 0)) throw new ApiError(400, "invalid_request", "budget_usd must be a positive number");
  if (typeof body.budget_usd === "number" && Math.round(body.budget_usd * 100) < cat.price_usd_cents) throw new ApiError(400, "budget_too_low", `budget_usd is below the suggested price for ${cat.id} ($${cat.price_usd_cents / 100})`);
  if (typeof body.deadline !== "string" || Number.isNaN(Date.parse(body.deadline))) throw new ApiError(400, "invalid_request", "deadline must be an ISO 8601 date-time");
  const dl = Date.parse(body.deadline);
  if (dl < nowMs() + cat.sla_hours * HOUR) throw new ApiError(400, "invalid_request", `deadline must be at least ${cat.sla_hours}h from now (category turnaround)`);
  let callback: string | null = null;
  if (body.callback_url !== undefined && body.callback_url !== null) {
    let u: URL;
    try { u = new URL(String(body.callback_url)); } catch { throw new ApiError(400, "invalid_request", "callback_url must be a URL"); }
    if (u.protocol !== "https:" && !(policy.allowInsecureCallbacks() && u.protocol === "http:")) throw new ApiError(400, "invalid_request", "callback_url must be https");
    callback = u.toString();
  }
  let location: { lat: number; lng: number; radius_m: number } | null = null;
  if (body.location !== undefined && body.location !== null) {
    const l = body.location as Record<string, unknown>;
    if (typeof l.lat !== "number" || typeof l.lng !== "number" || Math.abs(l.lat) > 90 || Math.abs(l.lng) > 180) throw new ApiError(400, "invalid_request", "location needs numeric lat, lng");
    const r = l.radius_m === undefined ? policy.photoRadiusDefaultM() : Number(l.radius_m);
    if (!Number.isInteger(r) || r < 10 || r > 50_000) throw new ApiError(400, "invalid_request", "location.radius_m must be an integer 10-50000");
    location = { lat: l.lat, lng: l.lng, radius_m: r };
  }
  if (cat.requires_location && !location) throw new ApiError(400, "invalid_request", `location is required for ${cat.id}`);
  let attachments: string[] = [];
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments) || body.attachments.length > 10 || !body.attachments.every((a) => typeof a === "string" && /^https?:\/\//.test(a))) throw new ApiError(400, "invalid_request", "attachments must be up to 10 URLs");
    attachments = body.attachments as string[];
  }
  let retentionDays: number | null = null;
  if (body.retention_days !== undefined) {
    const r = Number(body.retention_days);
    if (!Number.isInteger(r) || r < policy.wipeDaysMin() || r > policy.wipeDaysMax()) throw new ApiError(400, "invalid_request", `retention_days must be ${policy.wipeDaysMin()}-${policy.wipeDaysMax()}`);
    retentionDays = r;
  }
  return { cat, brief: body.brief, deadline: new Date(dl).toISOString(), callback, location, attachments, retentionDays };
}

/**
 * Create a task. Idempotent per (operator, key). Uses a fee credit if available (→ in_review),
 * otherwise status awaiting_fee and the caller attaches an entry-fee invoice.
 */
export const createTask = db.transaction((a: AuthedKey, idemKey: string, body: CreateTaskInput): { task: TaskRow; replayed: boolean } => {
  const bodyHash = sha256(stableStringify({ ...body, _mode: a.mode }));
  const prior = db.prepare("SELECT * FROM v1_idempotency WHERE operator_id=? AND key=?").get(a.operatorId, idemKey) as { body_hash: string; task_id: string; created_at: string } | undefined;
  if (prior && Date.parse(prior.created_at) > nowMs() - policy.idempotencyHours() * HOUR) {
    if (prior.body_hash !== bodyHash) throw new ApiError(409, "conflict", "Idempotency-Key reused with a different request body");
    return { task: getTask(prior.task_id)!, replayed: true };
  }
  if (prior) db.prepare("DELETE FROM v1_idempotency WHERE operator_id=? AND key=?").run(a.operatorId, idemKey);

  const op = getOperator(a.operatorId)!;
  if (op.banned_at) throw new ApiError(403, "banned", "this operator is banned from posting tasks");
  if (body.accept_terms !== true) throw new ApiError(400, "terms_not_accepted", "accept_terms must be true: confirm the task is not banned work (GET /v1/terms → banned_work)");
  const v = validateCreate(body);
  const id = newId("task");
  const now = nowIso();
  const useCredit = op.fee_credits > 0;
  if (useCredit) db.prepare("UPDATE v1_operators SET fee_credits = fee_credits - 1 WHERE id=?").run(op.id);
  db.prepare(
    `INSERT INTO v1_tasks (id, operator_id, mode, category, brief, attachments_json, location_json, screen_flags_json, suggested_price_cents, fee_cents, fee_status,
      status, deadline, callback_url, retention_days, created_at, fee_paid_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, op.id, a.mode, v.cat.id, v.brief, JSON.stringify(v.attachments), v.location ? JSON.stringify(v.location) : null, JSON.stringify(screenBrief(v.brief)),
    v.cat.price_usd_cents, policy.entryFeeCents(), useCredit ? "paid_by_credit" : "pending", useCredit ? "in_review" : "awaiting_fee",
    v.deadline, v.callback, v.retentionDays ?? op.retention_days ?? policy.wipeDaysDefault(), now, useCredit ? now : null);
  db.prepare("UPDATE v1_tasks SET public_ref=?, terms_accepted_at=? WHERE id=?").run(`job_${hmacHex(pseudonymSecret(), "pub:" + id).slice(0, 10)}`, now, id);
  db.prepare("INSERT INTO v1_idempotency (operator_id, key, body_hash, task_id, created_at) VALUES (?,?,?,?,?)").run(op.id, idemKey, bodyHash, id, now);
  recordEvent(id, "task.submitted");
  if (useCredit) recordEvent(id, "task.fee_paid");
  return { task: getTask(id)!, replayed: false };
});

export function setFeeInvoice(taskId: string, invoiceId: string, payUrl: string) {
  db.prepare("UPDATE v1_tasks SET fee_invoice_id=?, fee_pay_url=?, fee_expires_at=? WHERE id=?").run(invoiceId, payUrl, new Date(nowMs() + policy.feeInvoiceTtlHours() * HOUR).toISOString(), taskId);
}
export function taskByFeeInvoice(invoiceId: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM v1_tasks WHERE fee_invoice_id = ?").get(invoiceId) as TaskRow | undefined;
}
/** Mark the entry fee paid exactly once → task goes to human brief review. */
export const markFeePaid = db.transaction((taskId: string): TaskRow => {
  const t = getTask(taskId);
  if (!t) throw new ApiError(404, "not_found", "task not found");
  if (t.fee_status !== "pending") return t;
  if (t.status !== "awaiting_fee") throw new ApiError(409, "conflict", `task is ${t.status}`);
  db.prepare("UPDATE v1_tasks SET fee_status='paid', fee_paid_at=?, status='in_review' WHERE id=?").run(nowIso(), taskId);
  recordEvent(taskId, "task.fee_paid");
  return getTask(taskId)!;
});

export function getTask(id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM v1_tasks WHERE id = ?").get(id) as TaskRow | undefined;
}
export function getOwnedTask(a: AuthedKey, id: string): TaskRow {
  const t = getTask(id);
  if (!t || t.operator_id !== a.operatorId || t.mode !== a.mode) throw new ApiError(404, "not_found", "task not found");
  return t;
}

export function taskView(t: TaskRow) {
  return {
    id: t.id,
    category: t.category,
    status: t.status,
    mode: t.mode,
    suggested_price_usd: t.suggested_price_cents / 100,
    entry_fee: {
      amount_usd: t.fee_cents / 100,
      status: t.fee_status,
      invoice_id: t.fee_invoice_id,
      pay_url: t.fee_status === "pending" ? t.fee_pay_url : null,
      expires_at: t.fee_status === "pending" ? t.fee_expires_at : null,
    },
    job_payment: "direct between you and the contractor; Crew does not hold or move it",
    reveal_available: ["matched", "delivered", "completed", "disputed"].includes(t.status) && !t.wiped_at,
    rejection_reason: t.rejection_reason,
    contractor_ref: t.contractor_ref,
    deadline: t.deadline,
    callback_url: t.callback_url,
    created_at: t.created_at,
    fee_paid_at: t.fee_paid_at,
    opened_at: t.opened_at,
    claimed_at: t.claimed_at,
    delivered_at: t.delivered_at,
    closed_at: t.closed_at,
    wipe_at: t.wipe_at,
    wiped: Boolean(t.wiped_at),
    retention_days: t.retention_days,
    rating: t.rating,
    receipt_id: receiptId(t.id),
  };
}

function close(t: TaskRow, status: string, extra: Record<string, unknown> = {}) {
  const now = nowMs();
  const sets = Object.keys(extra).map((k) => `${k} = @${k}`);
  db.prepare(`UPDATE v1_tasks SET status=@status, closed_at=@closed, wipe_at=@wipe${sets.length ? ", " + sets.join(", ") : ""} WHERE id=@id`)
    .run({ ...extra, status, closed: new Date(now).toISOString(), wipe: new Date(now + t.retention_days * DAY).toISOString(), id: t.id });
}
/** Credit the entry fee back to the operator (used automatically on their next task). */
function creditFee(t: TaskRow) {
  if (t.fee_status !== "paid" && t.fee_status !== "paid_by_credit") return;
  db.prepare("UPDATE v1_tasks SET fee_status='credited' WHERE id=?").run(t.id);
  db.prepare("UPDATE v1_operators SET fee_credits = fee_credits + 1 WHERE id=?").run(t.operator_id);
  recordEvent(t.id, "task.fee_credited");
}

// --- admin: brief review ---
export const approveTask = db.transaction((id: string) => {
  const t = getTask(id);
  if (!t) throw new ApiError(404, "not_found", "task not found");
  if (t.status !== "in_review") throw new ApiError(409, "conflict", `task is ${t.status}`);
  db.prepare("UPDATE v1_tasks SET status='open', opened_at=? WHERE id=?").run(nowIso(), id);
  recordEvent(id, "task.opened");
  return getTask(id)!;
});
export const rejectTask = db.transaction((id: string, reason: string) => {
  const t = getTask(id);
  if (!t) throw new ApiError(404, "not_found", "task not found");
  if (!["awaiting_fee", "in_review", "open"].includes(t.status)) throw new ApiError(409, "conflict", `task is ${t.status}`);
  close(t, "rejected", { rejection_reason: reason.slice(0, 500) });
  creditFee(t);
  recordEvent(id, "task.rejected");
  return getTask(id)!;
});

// --- contractor ---
export function listOpenForContractor(c: Contractor) {
  const cats = contractorCategories(c);
  if (!cats.length) return [];
  const rows = db.prepare(`SELECT * FROM v1_tasks WHERE status='open' AND category IN (${cats.map(() => "?").join(",")}) ORDER BY deadline`).all(...cats) as TaskRow[];
  return rows.map((t) => ({
    id: t.id, category: t.category, mode: t.mode, brief: t.brief, attachments: JSON.parse(t.attachments_json || "[]"),
    location: t.location_json ? JSON.parse(t.location_json) : null, suggested_price_usd: t.suggested_price_cents / 100, deadline: t.deadline,
  }));
}
export function listClaimedByContractor(c: Contractor) {
  const rows = db.prepare("SELECT * FROM v1_tasks WHERE contractor_id=? AND status='matched' ORDER BY deadline").all(c.id) as TaskRow[];
  return rows.map((t) => ({ id: t.id, category: t.category, brief: t.brief, attachments: JSON.parse(t.attachments_json || "[]"), location: t.location_json ? JSON.parse(t.location_json) : null, suggested_price_usd: t.suggested_price_cents / 100, deadline: t.deadline, claimed_at: t.claimed_at }));
}

/** Contractor accepts the task → matched; their own pay address is snapshotted for the reveal. */
export const claimTask = db.transaction((c: Contractor, id: string) => {
  const t = getTask(id);
  if (!t) throw new ApiError(404, "not_found", "task not found");
  if (c.banned_at) throw new ApiError(403, "banned", "this contractor is banned from accepting tasks");
  if (!contractorCategories(c).includes(t.category)) throw new ApiError(403, "forbidden", "not eligible for this category");
  if (!c.pay_xmr && !c.pay_usdc) throw new ApiError(400, "invalid_request", "set a pay address first: PUT /v1/contractor/profile {pay_xmr | pay_usdc + pay_usdc_network}");
  if (t.status !== "open") throw new ApiError(409, "conflict", "task is not open (already accepted or closed)");
  const payTo = { xmr: c.pay_xmr, usdc: c.pay_usdc ? { address: c.pay_usdc, network: c.pay_usdc_network } : null };
  const r = db.prepare("UPDATE v1_tasks SET status='matched', contractor_id=?, contractor_ref=?, pay_to_json=?, claimed_at=? WHERE id=? AND status='open'")
    .run(c.id, contractorRef(c.id, t.id), JSON.stringify(payTo), nowIso(), id);
  if (r.changes !== 1) throw new ApiError(409, "conflict", "task already accepted");
  recordEvent(id, "task.matched");
  return getTask(id)!;
});

export type ProofUpload = { name?: string; mime: string; data_base64: string };

function validateResult(cat: Category, result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new ApiError(400, "invalid_request", "result must be a JSON object");
  const r = result as Record<string, unknown>;
  for (const k of cat.result_required) if (!(k in r)) throw new ApiError(400, "invalid_request", `result missing required field '${k}'`);
  if (cat.id === "human_check_of_ai_output" && r.verdict !== "pass" && r.verdict !== "fail") throw new ApiError(400, "invalid_request", "verdict must be pass|fail");
  if (cat.id === "data_labelling" && !Array.isArray(r.labels)) throw new ApiError(400, "invalid_request", "labels must be an array");
  if (cat.id === "code_or_doc_review" && !Array.isArray(r.findings)) throw new ApiError(400, "invalid_request", "findings must be an array");
  if (cat.id === "adelaide_photo_or_errand" && typeof r.completed !== "boolean") throw new ApiError(400, "invalid_request", "completed must be boolean");
  return r;
}

export const submitTask = db.transaction((c: Contractor, id: string, result: unknown, files: ProofUpload[]) => {
  const t = getTask(id);
  if (!t || t.contractor_id !== c.id) throw new ApiError(404, "not_found", "task not found");
  if (t.status !== "matched") throw new ApiError(409, "conflict", `task is ${t.status}`);
  const cat = category(t.category)!;
  const r = validateResult(cat, result);
  if (!Array.isArray(files) || files.length > 10) throw new ApiError(400, "invalid_request", "files must be an array of up to 10");
  if (cat.requires_location && files.length === 0) throw new ApiError(400, "invalid_request", "photo proof required for this category");
  const now = nowIso();
  for (const f of files) {
    if (!f || typeof f.mime !== "string" || typeof f.data_base64 !== "string" || !/^(image\/(jpeg|png|webp)|application\/pdf|text\/plain)$/.test(f.mime)) throw new ApiError(400, "invalid_request", "each file needs mime (jpeg/png/webp/pdf/txt) and data_base64");
    const buf = Buffer.from(f.data_base64, "base64");
    if (buf.length === 0 || buf.length > policy.maxProofBytes()) throw new ApiError(400, "invalid_request", `file size must be 1..${policy.maxProofBytes()} bytes`);
    db.prepare("INSERT INTO v1_proof_files (id, task_id, name, mime, sha256, size, data, created_at) VALUES (?,?,?,?,?,?,?,?)").run(newId("file"), id, f.name ?? null, f.mime, sha256(buf), buf.length, buf, now);
  }
  const resultJson = JSON.stringify(r);
  // Wipe clock also starts at delivery, so unconfirmed tasks don't keep data forever.
  db.prepare("UPDATE v1_tasks SET status='delivered', delivered_at=?, result_json=?, result_sha256=?, proof_checks_json=?, wipe_at=? WHERE id=?").run(
    now, resultJson, sha256(resultJson), JSON.stringify(proofChecks(t, r, files.length)), new Date(nowMs() + t.retention_days * DAY).toISOString(), id);
  recordEvent(id, "task.delivered");
  return getTask(id)!;
});

/** MVP proof checks from contractor-reported fields. EXIF not parsed (exif_present: null). Mismatches flagged. */
function proofChecks(t: TaskRow, r: Record<string, unknown>, fileCount: number) {
  const out: { gps_within_radius: boolean | null; distance_m: number | null; captured_after_claim: boolean | null; exif_present: boolean | null; files: number } = { gps_within_radius: null, distance_m: null, captured_after_claim: null, exif_present: null, files: fileCount };
  if (t.location_json) {
    const want = JSON.parse(t.location_json) as { lat: number; lng: number; radius_m: number };
    const got = r.location as { lat?: unknown; lng?: unknown } | undefined;
    if (got && typeof got.lat === "number" && typeof got.lng === "number") {
      out.distance_m = Math.round(haversineM(want, { lat: got.lat, lng: got.lng }));
      out.gps_within_radius = out.distance_m <= want.radius_m;
    } else out.gps_within_radius = false;
    out.captured_after_claim = typeof r.captured_at === "string" && t.claimed_at ? Date.parse(r.captured_at) >= Date.parse(t.claimed_at) : false;
  }
  return out;
}

/** Reveal: contractor's own pay address + suggested price. Agent pays the contractor directly. */
export function revealView(t: TaskRow) {
  if (t.fee_status !== "paid" && t.fee_status !== "paid_by_credit") throw new ApiError(402, "fee_required", "entry fee not paid");
  if (!["matched", "delivered", "completed", "disputed"].includes(t.status)) throw new ApiError(409, "not_ready", `task is ${t.status}; reveal happens once a contractor accepts`);
  if (t.wiped_at || !t.pay_to_json) throw new ApiError(410, "gone", "reveal data wiped after retention period");
  return {
    task_id: t.id,
    contractor_ref: t.contractor_ref,
    pay_to: JSON.parse(t.pay_to_json),
    suggested_price_usd: t.suggested_price_cents / 100,
    note: "Pay the contractor directly at the address above. Crew is not a party to this payment and does not hold, move, or refund it.",
    tip: "For larger jobs, pay half upfront and half on delivery.",
    terms: TERMS,
  };
}

// --- operator decisions (no money moves through Crew) ---
export const acceptTask = db.transaction((a: AuthedKey, id: string, rating?: unknown) => {
  const t = getOwnedTask(a, id);
  if (t.status !== "delivered" && t.status !== "matched") throw new ApiError(409, ["open", "in_review", "awaiting_fee"].includes(t.status) ? "not_ready" : "conflict", `task is ${t.status}`);
  let ratingVal: number | null = null;
  if (rating !== undefined && rating !== null) {
    if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) throw new ApiError(400, "invalid_request", "rating must be an integer 1-5");
    ratingVal = rating as number;
  }
  close(t, "completed", { rating: ratingVal });
  recordEvent(id, "task.completed");
  return getTask(id)!;
});

export const disputeTask = db.transaction((a: AuthedKey, id: string, reason: unknown) => {
  const t = getOwnedTask(a, id);
  if (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 2000) throw new ApiError(400, "invalid_request", "reason must be 10-2000 chars");
  if (t.dispute_reason) throw new ApiError(409, "conflict", "task already disputed once");
  if (t.status !== "delivered" && t.status !== "matched") throw new ApiError(409, "conflict", `task is ${t.status}`);
  close(t, "disputed", { dispute_reason: reason });
  recordEvent(id, "task.disputed");
  return getTask(id)!;
});

// ---------- results & receipts ----------

export function resultView(t: TaskRow, signUrl: (fileId: string) => { url: string; expires_at: string }) {
  if (t.wiped_at) throw new ApiError(410, "gone", "result wiped after retention period; receipt keeps hashes only");
  if (!t.delivered_at || !t.result_json) throw new ApiError(409, "not_ready", `task is ${t.status}`);
  const files = db.prepare("SELECT id, mime, sha256, size FROM v1_proof_files WHERE task_id=?").all(t.id) as { id: string; mime: string; sha256: string; size: number }[];
  return {
    task_id: t.id, category: t.category, delivered_at: t.delivered_at,
    result: JSON.parse(t.result_json), result_sha256: t.result_sha256,
    proof_files: files.map((f) => ({ sha256: f.sha256, mime: f.mime, size: f.size, ...signUrl(f.id) })),
    proof_checks: t.proof_checks_json ? JSON.parse(t.proof_checks_json) : null,
  };
}
export function receiptId(taskId: string): string {
  return `rcpt_${taskId.replace(/^task_/, "")}`;
}
export function receiptView(t: TaskRow) {
  const events = db.prepare("SELECT type, at FROM v1_events WHERE task_id=? ORDER BY at, rowid").all(t.id) as { type: string; at: string }[];
  const fileHashes = db.prepare("SELECT sha256 FROM v1_proof_files WHERE task_id=?").all(t.id) as { sha256: string }[];
  return {
    id: receiptId(t.id), task_id: t.id, category: t.category, mode: t.mode, status: t.status,
    entry_fee_usd: t.fee_cents / 100, entry_fee_status: t.fee_status, fee_invoice_id: t.fee_invoice_id,
    payment_rail: "xmrcheckout", payments_mode: paymentsMode(),
    suggested_price_usd: t.suggested_price_cents / 100,
    job_payment: "direct between parties; not processed by Crew",
    result_sha256: t.result_sha256, proof_sha256: fileHashes.map((f) => f.sha256), wiped_at: t.wiped_at, events,
  };
}
export function listReceipts(a: AuthedKey, limit = 50) {
  return (db.prepare("SELECT * FROM v1_tasks WHERE operator_id=? AND mode=? ORDER BY created_at DESC LIMIT ?").all(a.operatorId, a.mode, limit) as TaskRow[]).map(receiptView);
}

// ---------- sweep (timers): interval AND lazily on requests ----------

export const sweep = db.transaction(() => {
  const now = nowMs();
  const iso = new Date(now).toISOString();
  const counts = { fee_expired: 0, expired_credited: 0, wiped: 0 };

  // Unpaid entry-fee invoices past TTL → cancelled (nothing was paid).
  for (const t of db.prepare("SELECT * FROM v1_tasks WHERE status='awaiting_fee' AND fee_expires_at IS NOT NULL AND fee_expires_at <= ?").all(iso) as TaskRow[]) {
    db.prepare("UPDATE v1_tasks SET fee_status='expired' WHERE id=?").run(t.id);
    close(t, "cancelled");
    recordEvent(t.id, "task.cancelled");
    counts.fee_expired++;
  }
  // No contractor accepted within the window (from opening; or deadline passed) → expired, fee credited.
  for (const t of db.prepare("SELECT * FROM v1_tasks WHERE status IN ('in_review','open')").all() as TaskRow[]) {
    const pastDeadline = Date.parse(t.deadline) <= now;
    const noAccept = t.status === "open" && Date.parse(t.opened_at!) + policy.noAcceptRefundHours() * HOUR <= now;
    if (pastDeadline || noAccept) {
      close(t, "expired");
      creditFee(t);
      recordEvent(t.id, "task.expired");
      counts.expired_credited++;
    }
  }
  for (const { id } of db.prepare("SELECT id FROM v1_tasks WHERE wipe_at IS NOT NULL AND wipe_at <= ? AND wiped_at IS NULL").all(iso) as { id: string }[]) {
    db.prepare("UPDATE v1_tasks SET brief=NULL, attachments_json=NULL, location_json=NULL, result_json=NULL, dispute_reason=NULL, pay_to_json=NULL, wiped_at=? WHERE id=?").run(iso, id);
    db.prepare("UPDATE v1_proof_files SET data=NULL, name=NULL WHERE task_id=?").run(id);
    db.prepare("INSERT INTO v1_events (id, task_id, type, at) VALUES (?,?,?,?)").run(newId("evt"), id, "data.wiped", iso);
    counts.wiped++;
  }
  db.prepare("DELETE FROM v1_idempotency WHERE created_at < ?").run(new Date(now - policy.idempotencyHours() * HOUR).toISOString());
  return counts;
});

// ---------- public stats (anonymised) ----------

export function publicJobs(includeTest: boolean, limit = 100) {
  const rows = db
    .prepare(`SELECT public_ref, category, suggested_price_cents, status, created_at, delivered_at FROM v1_tasks WHERE status NOT IN ('awaiting_fee','in_review','rejected','cancelled') ${includeTest ? "" : "AND mode='live'"} ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as { public_ref: string | null; category: string; suggested_price_cents: number; status: string; created_at: string; delivered_at: string | null }[];
  return rows.map((r) => ({
    ref: r.public_ref,
    category: r.category,
    suggested_price_usd: r.suggested_price_cents / 100,
    status: r.status,
    posted_on: r.created_at.slice(0, 10),
    turnaround_hours: r.delivered_at ? Math.round(((Date.parse(r.delivered_at) - Date.parse(r.created_at)) / HOUR) * 10) / 10 : null,
  }));
}
export function publicRatings(includeTest: boolean) {
  return db
    .prepare(`SELECT c.handle AS pseudonym, ROUND(AVG(t.rating),2) AS average, COUNT(t.rating) AS ratings
              FROM v1_tasks t JOIN v1_contractors c ON c.id = t.contractor_id
              WHERE t.rating IS NOT NULL ${includeTest ? "" : "AND t.mode='live'"} GROUP BY c.id ORDER BY ratings DESC`)
    .all() as { pseudonym: string; average: number; ratings: number }[];
}

// ---------- bans & reports ----------

/** Ban by API key id (bans its operator), operator id, or contractor handle (pseudonym). */
export function setBan(target: { api_key_id?: unknown; operator_id?: unknown; contractor_handle?: unknown }, banned: boolean) {
  const at = banned ? nowIso() : null;
  if (typeof target.api_key_id === "string" || typeof target.operator_id === "string") {
    let opId = target.operator_id as string | undefined;
    if (typeof target.api_key_id === "string") {
      const k = db.prepare("SELECT operator_id FROM v1_api_keys WHERE id=?").get(target.api_key_id) as { operator_id: string } | undefined;
      if (!k) throw new ApiError(404, "not_found", "api key not found");
      opId = k.operator_id;
    }
    if (db.prepare("UPDATE v1_operators SET banned_at=? WHERE id=?").run(at, opId).changes !== 1) throw new ApiError(404, "not_found", "operator not found");
    return { type: "operator", operator_id: opId, banned };
  }
  if (typeof target.contractor_handle === "string") {
    if (db.prepare("UPDATE v1_contractors SET banned_at=? WHERE handle=?").run(at, target.contractor_handle).changes !== 1) throw new ApiError(404, "not_found", "contractor not found");
    return { type: "contractor", contractor_handle: target.contractor_handle, banned };
  }
  throw new ApiError(400, "invalid_request", "give api_key_id, operator_id, or contractor_handle");
}
export function listBans() {
  return {
    operators: db.prepare("SELECT id, label, banned_at FROM v1_operators WHERE banned_at IS NOT NULL").all(),
    contractors: db.prepare("SELECT handle, banned_at FROM v1_contractors WHERE banned_at IS NOT NULL").all(),
  };
}

/** Report a task by internal id or public job ref. Feeds the admin review list. */
export function reportTask(idOrRef: string, reason: unknown, source: string) {
  const t = db.prepare("SELECT id FROM v1_tasks WHERE id=? OR public_ref=?").get(idOrRef, idOrRef) as { id: string } | undefined;
  if (!t) throw new ApiError(404, "not_found", "task not found");
  if (typeof reason !== "string" || reason.trim().length < 5 || reason.length > 2000) throw new ApiError(400, "invalid_request", "reason must be 5-2000 chars");
  const id = newId("rpt");
  db.prepare("INSERT INTO v1_reports (id, task_id, reason, source, created_at) VALUES (?,?,?,?,?)").run(id, t.id, reason.trim(), source, nowIso());
  return { id, status: "received" };
}
export function openReports() {
  return db.prepare(`SELECT r.id, r.task_id, r.reason, r.source, r.created_at, t.category, t.status AS task_status, t.public_ref
                     FROM v1_reports r JOIN v1_tasks t ON t.id = r.task_id WHERE r.status='open' ORDER BY r.created_at`).all();
}
export function closeReport(id: string) {
  if (db.prepare("UPDATE v1_reports SET status='closed' WHERE id=?").run(id).changes !== 1) throw new ApiError(404, "not_found", "report not found");
  return { id, status: "closed" };
}
