import express, { type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { createEntryFeeInvoice, fetchPublicInvoiceStatus, isConfirmedStatus, isLiveMode } from "../xmrcheckout.js";
import { adminToken, categories, paymentsMode, policy, pseudonymSecret, TERMS } from "./config.js";
import { nowMs } from "./clock.js";
import * as core from "./core.js";
import { ApiError, hmacHex, safeEqual } from "./util.js";
import { deliverDueWebhooks } from "./webhooks.js";
import { hardLimitsPage, jobsPage, termsPage } from "./pages.js";
import { migrateV1 } from "./schema.js";
import { mountMcp } from "./mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Req = Request & { auth?: core.AuthedKey; contractor?: core.Contractor };

const wrap = (fn: (req: Req, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req as Req, res);
  } catch (e) {
    next(e);
  }
};

function bearer(req: Request): string {
  return (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function requireKey(req: Req, _res: Response, next: NextFunction) {
  const a = core.authenticateKey(bearer(req));
  if (!a) return next(new ApiError(401, "unauthorized", "missing or invalid API key"));
  req.auth = a;
  next();
}
function requireContractor(req: Req, _res: Response, next: NextFunction) {
  const c = core.authenticateContractor(bearer(req));
  if (!c) return next(new ApiError(401, "unauthorized", "missing or invalid contractor token"));
  req.contractor = c;
  next();
}
function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const t = adminToken();
  if (!t) return next(new ApiError(503, "admin_disabled", "CREW_ADMIN_TOKEN not configured"));
  if (!safeEqual(bearer(req), t)) return next(new ApiError(401, "unauthorized", "admin token required"));
  next();
}

/** Simple per-key/IP rate limit (in-memory; single instance). */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Req, _res: Response, next: NextFunction) => {
    const k = req.auth?.keyId || req.ip || "anon";
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (arr.length > max) return next(new ApiError(429, "rate_limited", "too many requests"));
    next();
  };
}

function signFileUrl(fileId: string) {
  const exp = Math.floor(nowMs() / 1000) + 3600;
  const sig = hmacHex(pseudonymSecret(), `${fileId}.${exp}`);
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { url: `${base}/v1/proof/${fileId}?exp=${exp}&sig=${sig}`, expires_at: new Date(exp * 1000).toISOString() };
}

let lastLazySweep = 0;
async function lazySweep() {
  if (nowMs() - lastLazySweep < 5_000) return;
  lastLazySweep = nowMs();
  core.sweep();
  void deliverDueWebhooks().catch(() => undefined);
}

export function createV1Router(): express.Router {
  migrateV1();
  const r = express.Router();
  r.use(express.json({ limit: "15mb" }));
  r.use(async (_req, _res, next) => {
    try { await lazySweep(); } catch { /* never block requests on sweep */ }
    next();
  });

  // x402 / USDC: stubbed and disabled by design (separate owner decision required).
  r.use((req, _res, next) => {
    if (req.get("x-payment") || req.get("payment-signature")) return next(new ApiError(501, "payment_rail_disabled", "x402 payments are not enabled"));
    next();
  });
  r.all("/x402", (_req, _res, next) => next(new ApiError(501, "payment_rail_disabled", "x402 payments are not enabled")));

  // ---- public ----
  r.get("/categories", (_req, res) => {
    res.json({
      data: categories().map((c) => ({ id: c.id, title: c.title, description: c.description, suggested_price_usd: c.price_usd_cents / 100, price_note: "suggested job price, paid directly to the contractor", sla_hours: c.sla_hours, requires_location: c.requires_location, result_schema: c.result_schema })),
      policy: { entry_fee_usd: policy.entryFeeCents() / 100, no_accept_fee_credit_hours: policy.noAcceptRefundHours(), retention_days_default: policy.wipeDaysDefault(), payments_mode: paymentsMode() },
      terms: TERMS,
    });
  });
  r.get("/terms", (_req, res) => res.json(TERMS));
  r.get("/openapi.yaml", (_req, res) => {
    const p = path.join(__dirname, "..", "..", "docs", "openapi.yaml");
    if (!fs.existsSync(p)) return res.status(404).end();
    res.type("application/yaml").send(fs.readFileSync(p, "utf8"));
  });
  r.get("/public/jobs", (_req, res) => {
    const includeTest = process.env.CREW_PUBLIC_INCLUDE_TEST === "1";
    res.json({ data: core.publicJobs(includeTest), ratings: core.publicRatings(includeTest) });
  });
  r.get("/proof/:fileId", (req, res, next) => {
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || "");
    if (!Number.isFinite(exp) || exp * 1000 < nowMs() || !safeEqual(sig, hmacHex(pseudonymSecret(), `${req.params.fileId}.${exp}`))) return next(new ApiError(403, "forbidden", "invalid or expired link"));
    const f = db.prepare("SELECT mime, data FROM v1_proof_files WHERE id=?").get(req.params.fileId) as { mime: string; data: Buffer | null } | undefined;
    if (!f) return next(new ApiError(404, "not_found", "file not found"));
    if (!f.data) return next(new ApiError(410, "gone", "file wiped"));
    res.set("Cache-Control", "private, no-store").type(f.mime).send(f.data);
  });

  // XMR Checkout webhook for entry fees (same shared-secret check as the match webhook).
  r.post("/webhooks/xmrcheckout", wrap(async (req, res) => {
    const secret = process.env.WEBHOOK_SECRET || process.env.XMRCHECKOUT_WEBHOOK_SECRET;
    if (secret) {
      const hdr = req.get("x-webhook-secret") || req.get("x-xmrcheckout-secret") || bearer(req);
      if (!safeEqual(hdr, secret)) throw new ApiError(401, "unauthorized", "invalid webhook secret");
    } else if (isLiveMode()) {
      throw new ApiError(503, "unconfigured", "webhook secret not configured");
    }
    const b = req.body || {};
    const invoiceId = String(b.invoiceId || b.invoice_id || b.id || b?.data?.id || b?.invoice?.id || "");
    if (!invoiceId) throw new ApiError(400, "invalid_request", "missing invoice id");
    const t = core.taskByFeeInvoice(invoiceId);
    if (!t) throw new ApiError(404, "not_found", "unknown entry-fee invoice");
    if (!isLiveMode()) throw new ApiError(403, "forbidden", "test payments mode: use mock-pay");
    const pub = await fetchPublicInvoiceStatus(invoiceId); // never trust the webhook body alone
    if (!isConfirmedStatus(pub.status)) return res.json({ ok: true, paid: false, status: pub.status });
    res.json({ ok: true, paid: true, task: core.taskView(core.markFeePaid(t.id)) });
  }));

  // ---- operator (API key) ----
  const op = express.Router();
  op.use(requireKey, rateLimit(120, 60_000));
  op.get("/account", (req: Req, res) => res.json(core.accountView(req.auth!)));

  op.post("/tasks", wrap(async (req, res) => {
    const key = req.get("idempotency-key");
    if (!key || key.length > 64) throw new ApiError(400, "invalid_request", "Idempotency-Key header required (max 64 chars)");
    const { task, replayed } = core.createTask(req.auth!, key, req.body || {});
    let t = task;
    if (!replayed && t.fee_status === "pending" && !t.fee_invoice_id) {
      if (!isLiveMode() || req.auth!.mode === "test") {
        core.setFeeInvoice(t.id, `mock_fee_${t.id}`, `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/v1/tasks/${t.id}/fee/mock-pay`);
      } else {
        const inv = await createEntryFeeInvoice({ taskId: t.id, amountUsdCents: t.fee_cents });
        core.setFeeInvoice(t.id, inv.id, inv.payUrl);
      }
      t = core.getTask(t.id)!;
    }
    res.status(replayed ? 200 : 201).set("Idempotent-Replayed", String(replayed)).json(core.taskView(t));
  }));
  op.get("/tasks/:id", wrap(async (req, res) => {
    let t = core.getOwnedTask(req.auth!, String(req.params.id));
    if (t.fee_status === "pending" && t.fee_invoice_id && isLiveMode() && !t.fee_invoice_id.startsWith("mock_")) {
      try {
        const pub = await fetchPublicInvoiceStatus(t.fee_invoice_id);
        if (isConfirmedStatus(pub.status)) t = core.markFeePaid(t.id);
      } catch { /* still pending */ }
    }
    res.json(core.taskView(t));
  }));
  op.post("/tasks/:id/fee/mock-pay", wrap((req, res) => {
    const t = core.getOwnedTask(req.auth!, String(req.params.id));
    if (isLiveMode() && t.mode !== "test") throw new ApiError(403, "forbidden", "mock pay is test-mode only");
    if (!t.fee_invoice_id?.startsWith("mock_")) throw new ApiError(409, "conflict", "no mock invoice on this task");
    res.json(core.taskView(core.markFeePaid(t.id)));
  }));
  op.get("/tasks/:id/reveal", wrap((req, res) => res.json(core.revealView(core.getOwnedTask(req.auth!, String(req.params.id))))));
  op.get("/tasks/:id/result", wrap((req, res) => res.json(core.resultView(core.getOwnedTask(req.auth!, String(req.params.id)), signFileUrl))));
  op.post("/tasks/:id/accept", wrap((req, res) => res.json(core.taskView(core.acceptTask(req.auth!, String(req.params.id), req.body?.rating)))));
  op.post("/tasks/:id/dispute", wrap((req, res) => res.json(core.taskView(core.disputeTask(req.auth!, String(req.params.id), req.body?.reason)))));
  op.get("/receipts", wrap((req, res) => res.json({ data: core.listReceipts(req.auth!) })));
  op.get("/receipts/:id", wrap((req, res) => {
    const id = String(req.params.id);
    const taskId = id.startsWith("rcpt_") ? `task_${id.slice(5)}` : id;
    res.json(core.receiptView(core.getOwnedTask(req.auth!, taskId)));
  }));

  // ---- contractor (invite-only token) ----
  const ct = express.Router();
  ct.use(requireContractor, rateLimit(120, 60_000));
  ct.get("/profile", (req: Req, res) => res.json(core.contractorProfile(req.contractor!)));
  ct.put("/profile", wrap((req, res) => res.json(core.contractorProfile(core.updateContractorPay(req.contractor!, req.body || {})))));
  ct.get("/tasks", (req: Req, res) => res.json({ data: core.listOpenForContractor(req.contractor!), claimed: core.listClaimedByContractor(req.contractor!) }));
  ct.post("/tasks/:id/claim", wrap((req, res) => {
    const t = core.claimTask(req.contractor!, String(req.params.id));
    res.json({ id: t.id, status: t.status, deadline: t.deadline, brief: t.brief, location: t.location_json ? JSON.parse(t.location_json) : null, suggested_price_usd: t.suggested_price_cents / 100, note: "The agent pays you directly at your pay address. Crew is not a party to the payment." });
  }));
  ct.post("/tasks/:id/submit", wrap((req, res) => {
    let result = req.body?.result;
    if (typeof result === "string") { try { result = JSON.parse(result); } catch { throw new ApiError(400, "invalid_request", "result is not valid JSON"); } }
    const t = core.submitTask(req.contractor!, String(req.params.id), result, req.body?.files ?? []);
    res.json({ id: t.id, status: t.status, proof_checks: JSON.parse(t.proof_checks_json || "null") });
  }));

  // ---- admin (owner) ----
  const ad = express.Router();
  ad.use(requireAdmin);
  ad.post("/operators", wrap((req, res) => {
    const { operator, webhookSecret } = core.createOperator(req.body?.label);
    const mode = req.body?.mode === "live" ? "live" : "test";
    const key = core.issueApiKey(operator.id, mode);
    res.status(201).json({ operator_id: operator.id, api_key: key.key, api_key_id: key.id, webhook_secret: webhookSecret, note: "Shown once. Store securely." });
  }));
  ad.post("/operators/:id/keys", wrap((req, res) => {
    if (!core.getOperator(String(req.params.id))) throw new ApiError(404, "not_found", "operator not found");
    const key = core.issueApiKey(String(req.params.id), req.body?.mode === "live" ? "live" : "test");
    res.status(201).json({ api_key: key.key, api_key_id: key.id });
  }));
  ad.post("/keys/:id/revoke", wrap((req, res) => res.json({ revoked: core.revokeApiKey(String(req.params.id)) })));
  ad.get("/review", (_req, res) => {
    const rows = db.prepare("SELECT id, category, mode, brief, location_json, screen_flags_json, deadline, created_at FROM v1_tasks WHERE status='in_review' ORDER BY created_at").all() as Record<string, string>[];
    res.json({ data: rows.map((r) => ({ ...r, screen_flags: JSON.parse(r.screen_flags_json || "[]") })) });
  });
  ad.post("/tasks/:id/approve", wrap((req, res) => res.json(core.taskView(core.approveTask(String(req.params.id))))));
  ad.post("/tasks/:id/reject", wrap((req, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 3) throw new ApiError(400, "invalid_request", "reason required");
    res.json(core.taskView(core.rejectTask(String(req.params.id), reason)));
  }));
  ad.get("/disputes", (_req, res) => res.json({ data: db.prepare("SELECT id, category, dispute_reason, contractor_id, closed_at FROM v1_tasks WHERE status='disputed'").all() }));
  ad.post("/contractors", wrap((req, res) => {
    const cats = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const { contractor, token } = core.inviteContractor(String(req.body?.handle || ""), cats, req.body || {});
    res.status(201).json({ contractor_id: contractor.id, handle: contractor.handle, token, note: "Shown once. Give privately to the contractor." });
  }));
  ad.post("/sweep", wrap(async (_req, res) => res.json({ ...core.sweep(), webhooks_sent: await deliverDueWebhooks() })));

  r.use("/contractor", ct);
  r.use("/admin", ad);
  r.use(op);

  r.use((_req, _res, next) => next(new ApiError(404, "not_found", "no such endpoint")));
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "invalid_request", message: "invalid JSON body" } });
    if (e?.type === "entity.too.large") return res.status(413).json({ error: { code: "invalid_request", message: "body too large" } });
    console.error("[v1] unhandled", err);
    res.status(500).json({ error: { code: "internal", message: "internal error" } });
  });
  return r;
}

/** Mount /v1, public pages, and start background timers. */
export function mountV1(app: express.Express, opts: { timers?: boolean } = {}): void {
  app.use("/v1", createV1Router());
  app.get("/jobs", (_req, res) => {
    const includeTest = process.env.CREW_PUBLIC_INCLUDE_TEST === "1";
    res.type("html").send(jobsPage(core.publicJobs(includeTest), core.publicRatings(includeTest)));
  });
  mountMcp(app);
  app.get("/hard-limits", (_req, res) => res.type("html").send(hardLimitsPage()));
  app.get("/terms", (_req, res) => res.type("html").send(termsPage()));
  app.get("/llms.txt", (_req, res) => {
    const p = path.join(__dirname, "..", "..", "docs", "llms.txt");
    if (!fs.existsSync(p)) return res.status(404).end();
    res.type("text/plain").send(fs.readFileSync(p, "utf8"));
  });
  if (opts.timers !== false) {
    const t = setInterval(() => {
      try { core.sweep(); } catch (e) { console.error("[v1] sweep", e); }
      void deliverDueWebhooks().catch(() => undefined);
    }, policy.sweepIntervalMs());
    t.unref();
  }
}
