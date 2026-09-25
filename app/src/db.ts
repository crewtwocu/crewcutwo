import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, "crew.db");
export const db: Database.Database = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    connection_code TEXT,
    connection_note TEXT,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id),
    side TEXT NOT NULL CHECK (side IN ('contractor', 'operator')),
    amount_usd REAL NOT NULL,
    pay_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    paid_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_match ON invoices(match_id);
`);

// Migration: job_brief for sensitive brief held until reveal
try {
  db.exec(`ALTER TABLE matches ADD COLUMN job_brief TEXT`);
} catch {
  /* column already exists */
}

// Migration: optional handoff hint (how to reach after both pay)
try {
  db.exec(`ALTER TABLE matches ADD COLUMN handoff_hint TEXT`);
} catch {
  /* column already exists */
}

// Migration: invoice expiry (XMR Checkout ~1h)
try {
  db.exec(`ALTER TABLE invoices ADD COLUMN expires_at TEXT`);
} catch {
  /* column already exists */
}

// Migration: dual-party reveal grace window end time
try {
  db.exec(`ALTER TABLE matches ADD COLUMN reveal_until TEXT`);
} catch {
  /* column already exists */
}

export type MatchStatus =
  | "pending_payment"
  | "partial"
  | "ready"
  | "consumed"
  | "expired"
  | "cancelled";

export type MatchRow = {
  id: string;
  summary: string | null;
  job_brief: string | null;
  handoff_hint: string | null;
  status: MatchStatus;
  connection_code: string | null;
  connection_note: string | null;
  consumed_at: string | null;
  reveal_until: string | null;
  created_at: string;
};

export type InvoiceRow = {
  id: string;
  match_id: string;
  side: "contractor" | "operator";
  amount_usd: number;
  pay_url: string;
  status: "pending" | "paid";
  paid_at: string | null;
  created_at: string;
  expires_at: string | null;
};

/** Default invoice TTL: 1 hour (matches typical XMR Checkout window). */
export function invoiceTtlMs(): number {
  const raw = process.env.INVOICE_TTL_SECONDS;
  if (raw && /^\d+$/.test(raw)) {
    return Math.max(1, Number(raw)) * 1000;
  }
  return 60 * 60 * 1000;
}

export function defaultExpiresAt(from: Date = new Date()): string {
  return new Date(from.getTime() + invoiceTtlMs()).toISOString();
}

function isTerminalStatus(status: string): boolean {
  return status === "consumed" || status === "expired" || status === "cancelled";
}

/** Earliest unpaid invoice expires_at, or null if all paid / none set. */
export function matchExpiresAt(matchId: string): string | null {
  const rows = db
    .prepare(
      `SELECT expires_at, status FROM invoices WHERE match_id = ? AND expires_at IS NOT NULL`
    )
    .all(matchId) as { expires_at: string; status: string }[];
  const unpaid = rows.filter((r) => r.status !== "paid");
  const pool = unpaid.length > 0 ? unpaid : rows;
  if (pool.length === 0) return null;
  return pool.map((r) => r.expires_at).sort()[0] ?? null;
}

/**
 * If match is still open and any unpaid invoice is past expires_at, mark expired.
 * Returns current (possibly updated) status.
 */
export function applyExpiryIfNeeded(matchId: string): MatchStatus {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow | undefined;
  if (!match) throw new Error("match not found");
  if (isTerminalStatus(match.status) || match.consumed_at) {
    return match.status === "consumed" || match.consumed_at ? "consumed" : match.status;
  }

  const invoices = db
    .prepare("SELECT status, expires_at FROM invoices WHERE match_id = ?")
    .all(matchId) as { status: string; expires_at: string | null }[];

  const paidCount = invoices.filter((i) => i.status === "paid").length;
  if (paidCount === invoices.length && invoices.length > 0) {
    // Both paid — never expire
    return recomputeMatchStatus(matchId);
  }

  const now = Date.now();
  const anyExpiredUnpaid = invoices.some((i) => {
    if (i.status === "paid") return false;
    if (!i.expires_at) return false;
    return new Date(i.expires_at).getTime() <= now;
  });

  if (anyExpiredUnpaid) {
    if (match.status !== "expired") {
      db.prepare("UPDATE matches SET status = 'expired' WHERE id = ?").run(matchId);
    }
    return "expired";
  }

  return recomputeMatchStatus(matchId);
}

export function recomputeMatchStatus(matchId: string): MatchStatus {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow | undefined;
  if (!match) throw new Error("match not found");
  if (match.status === "consumed" || match.consumed_at) return "consumed";
  if (match.status === "cancelled") return "cancelled";
  if (match.status === "expired") return "expired";

  const invoices = db
    .prepare("SELECT status FROM invoices WHERE match_id = ?")
    .all(matchId) as { status: string }[];
  const paidCount = invoices.filter((i) => i.status === "paid").length;
  let next: MatchStatus = "pending_payment";
  if (paidCount === 0) next = "pending_payment";
  else if (paidCount < invoices.length) next = "partial";
  else next = "ready";

  if (match.status !== next) {
    db.prepare("UPDATE matches SET status = ? WHERE id = ?").run(next, matchId);
  }
  return next;
}

export function markInvoicePaid(invoiceId: string): InvoiceRow | null {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as InvoiceRow | undefined;
  if (!invoice) return null;
  if (invoice.status === "paid") return invoice;

  const matchStatus = applyExpiryIfNeeded(invoice.match_id);
  if (matchStatus === "expired" || matchStatus === "cancelled" || matchStatus === "consumed") {
    return null;
  }

  if (invoice.expires_at && new Date(invoice.expires_at).getTime() <= Date.now()) {
    applyExpiryIfNeeded(invoice.match_id);
    return null;
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE invoices SET status = 'paid', paid_at = ? WHERE id = ?").run(now, invoiceId);
  recomputeMatchStatus(invoice.match_id);
  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as InvoiceRow;
}

/** Cancel open match. Returns null if not found; throws with code if not cancellable. */
export function cancelMatch(matchId: string): MatchRow | null {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow | undefined;
  if (!match) return null;

  applyExpiryIfNeeded(matchId);
  const fresh = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow;

  if (fresh.status === "cancelled") return fresh;
  if (fresh.status === "consumed" || fresh.consumed_at) {
    const err = new Error("match already consumed") as Error & { code: string };
    err.code = "NOT_CANCELLABLE";
    throw err;
  }
  if (fresh.status === "ready") {
    const err = new Error("both sides already paid") as Error & { code: string };
    err.code = "NOT_CANCELLABLE";
    throw err;
  }
  if (fresh.status === "expired") {
    const err = new Error("match already expired") as Error & { code: string };
    err.code = "NOT_CANCELLABLE";
    throw err;
  }

  const invoices = db
    .prepare("SELECT status FROM invoices WHERE match_id = ?")
    .all(matchId) as { status: string }[];
  const allPaid = invoices.length > 0 && invoices.every((i) => i.status === "paid");
  if (allPaid) {
    const err = new Error("both sides already paid") as Error & { code: string };
    err.code = "NOT_CANCELLABLE";
    throw err;
  }

  db.prepare("UPDATE matches SET status = 'cancelled' WHERE id = ?").run(matchId);
  return db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow;
}

export type ConnectionReveal = {
  code: string;
  note: string;
  handoffHint: string | null;
  jobBrief: string | null;
  steps: string[];
};

const REVEAL_STEPS = [
  "Copy the connection code and handoff details now.",
  "Share only what you need with the other party outside Crew.",
  "Crew steps back — this reveal won't show again after the short grace window.",
];

/** How long both parties can re-fetch the connection after first reveal. Default 15m. */
export function revealGraceMs(): number {
  const raw = process.env.REVEAL_GRACE_SECONDS;
  if (raw && /^\d+$/.test(raw)) {
    return Math.max(30, Number(raw)) * 1000;
  }
  return 15 * 60 * 1000;
}

function buildConnectionPayload(match: MatchRow): ConnectionReveal {
  return {
    code: match.connection_code!,
    note:
      match.connection_note ||
      "One-time connection. Share privately; Crew clears this after the grace window.",
    handoffHint: match.handoff_hint ?? null,
    jobBrief: match.job_brief ?? null,
    steps: [...REVEAL_STEPS],
  };
}

function wipeRevealSecrets(matchId: string): void {
  db.prepare(
    `UPDATE matches
     SET connection_code = NULL, connection_note = NULL,
         summary = NULL, job_brief = NULL, handoff_hint = NULL,
         reveal_until = NULL
     WHERE id = ?`
  ).run(matchId);
}

/**
 * Dual-party reveal: first GET while ready starts a grace window and returns
 * connection (incl. jobBrief). Further GETs within reveal_until return the same
 * payload so hub + both side polls all succeed. After grace, secrets are wiped.
 */
export function revealConnection(matchId: string): ConnectionReveal | null {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow | undefined;
  if (!match) return null;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // Already wiped
  if (!match.connection_code) {
    return null;
  }

  // Past grace → wipe and deny
  if (match.reveal_until && new Date(match.reveal_until).getTime() <= now) {
    wipeRevealSecrets(matchId);
    return null;
  }

  // Active grace (consumed but secrets retained)
  if (
    (match.status === "consumed" || match.consumed_at) &&
    match.reveal_until &&
    new Date(match.reveal_until).getTime() > now
  ) {
    return buildConnectionPayload(match);
  }

  // First reveal
  if (match.status !== "ready") return null;

  const revealUntil = new Date(now + revealGraceMs()).toISOString();
  db.prepare(
    `UPDATE matches
     SET status = 'consumed', consumed_at = ?, reveal_until = ?
     WHERE id = ?`
  ).run(nowIso, revealUntil, matchId);

  const fresh = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow;
  return buildConnectionPayload(fresh);
}
