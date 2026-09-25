import { v4 as uuidv4 } from "uuid";
import {
  db,
  type InvoiceRow,
  type MatchRow,
  type MatchStatus,
  markInvoicePaid,
  revealConnection,
  applyExpiryIfNeeded,
  cancelMatch,
  defaultExpiresAt,
  matchExpiresAt,
} from "./db.js";
import {
  createInvoice,
  fetchPublicInvoiceStatus,
  isConfirmedStatus,
  isLiveMode,
  type Side,
} from "./xmrcheckout.js";

function generateConnectionCode(): string {
  // Short one-time code; not a wallet address — placeholder for how parties connect post-match
  const raw = uuidv4().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `CREW-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function publicBase(): string {
  const b = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3847}`;
  return b.replace(/\/$/, "");
}

export type CreateMatchOpts = {
  summary?: string;
  jobBrief?: string;
  /** Optional hint for how the other side should reach you after both pay (~500 chars). */
  handoffHint?: string;
};

const HANDOFF_HINT_MAX = 500;

export function normaliseHandoffHint(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, HANDOFF_HINT_MAX);
}

export async function createMatch(opts: CreateMatchOpts | string = {}) {
  // Back-compat: createMatch(summary?: string)
  const options: CreateMatchOpts =
    typeof opts === "string" ? { summary: opts } : opts || {};

  const id = uuidv4();
  const now = new Date().toISOString();
  const expiresAt = defaultExpiresAt(new Date(now));
  const code = generateConnectionCode();
  const note =
    "One-time connection code. Copy it now — Crew clears it after this reveal for anonymity.";

  const summary = options.summary?.trim() || null;
  const jobBrief = options.jobBrief?.trim() || null;
  const handoffHint = normaliseHandoffHint(options.handoffHint) || null;

  db.prepare(
    `INSERT INTO matches (id, summary, job_brief, handoff_hint, status, connection_code, connection_note, created_at)
     VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?)`
  ).run(id, summary, jobBrief, handoffHint, code, note, now);

  const sides: Side[] = ["contractor", "operator"];
  const invoices: Array<{
    side: Side;
    amountUsd: number;
    payUrl: string;
    id: string;
    expiresAt: string;
  }> = [];

  try {
    for (const side of sides) {
      const inv = await createInvoice({ matchId: id, side });
      db.prepare(
        `INSERT INTO invoices (id, match_id, side, amount_usd, pay_url, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(inv.id, id, inv.side, inv.amountUsd, inv.payUrl, now, expiresAt);
      invoices.push({
        side: inv.side,
        amountUsd: inv.amountUsd,
        payUrl: inv.payUrl,
        id: inv.id,
        expiresAt,
      });
    }
  } catch (err) {
    db.prepare("DELETE FROM invoices WHERE match_id = ?").run(id);
    db.prepare("DELETE FROM matches WHERE id = ?").run(id);
    throw err;
  }

  const base = publicBase();
  return {
    id,
    expiresAt,
    invoices,
    shareUrls: {
      contractor: `${base}/m/${id}/contractor`,
      operator: `${base}/m/${id}/operator`,
      hub: `${base}/m/${id}`,
    },
  };
}

/**
 * In live mode, poll pending non-mock invoices via public API and mark confirmed ones paid.
 * Per-invoice errors are logged and swallowed so GET /api/matches/:id stays resilient.
 */
export async function syncLivePayments(matchId: string): Promise<void> {
  if (!isLiveMode()) return;

  const pending = db
    .prepare(
      `SELECT id FROM invoices WHERE match_id = ? AND status = 'pending' AND id NOT LIKE 'mock_%'`
    )
    .all(matchId) as { id: string }[];

  for (const row of pending) {
    try {
      const pub = await fetchPublicInvoiceStatus(row.id);
      if (isConfirmedStatus(pub.status)) {
        markInvoicePaid(row.id);
        // markInvoicePaid already recomputes match status
      }
    } catch (err) {
      console.error(
        `[syncLivePayments] poll failed for invoice ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export async function getMatchStatus(matchId: string, side?: Side | string | null) {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow | undefined;
  if (!match) return null;

  // Skip live sync once match is terminal (consumed / cancelled)
  if (match.status !== "consumed" && !match.consumed_at && match.status !== "cancelled") {
    await syncLivePayments(matchId);
  }

  const invoices = db
    .prepare("SELECT * FROM invoices WHERE match_id = ? ORDER BY side")
    .all(matchId) as InvoiceRow[];

  // On-read: mark expired if past expires_at and not both paid; respect terminal states
  let status: MatchStatus;
  if (match.status === "consumed" || match.consumed_at) {
    status = "consumed";
  } else if (match.status === "cancelled") {
    status = "cancelled";
  } else {
    status = applyExpiryIfNeeded(matchId);
  }

  const normalisedSide =
    side === "contractor" || side === "operator" ? (side as Side) : undefined;

  const expiresAt = matchExpiresAt(matchId);

  // Re-read after possible live sync / expiry for reveal_until + secrets
  const fresh = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId) as MatchRow;
  const briefOnFile = Boolean(fresh.job_brief);
  const inRevealGrace =
    Boolean(fresh.connection_code) &&
    Boolean(fresh.reveal_until) &&
    new Date(fresh.reveal_until!).getTime() > Date.now() &&
    (fresh.status === "consumed" || Boolean(fresh.consumed_at) || status === "ready");

  const payload: {
    id: string;
    summary: string | null;
    jobBrief: string | null;
    jobBriefPresent: boolean;
    status: MatchStatus;
    expiresAt: string | null;
    invoices: Array<{
      id: string;
      side: string;
      amountUsd: number;
      payUrl: string;
      status: string;
      paidAt: string | null;
      expiresAt: string | null;
    }>;
    connection?: {
      code: string;
      note: string;
      handoffHint: string | null;
      jobBrief: string | null;
      steps: string[];
    };
    side?: Side;
    yourPayUrl?: string | null;
    shareUrls: {
      contractor: string;
      operator: string;
      hub: string;
    };
  } = {
    id: fresh.id,
    // Never expose brief/summary over API until reveal payload
    summary: null,
    jobBrief: null,
    jobBriefPresent: briefOnFile,
    status,
    expiresAt,
    invoices: invoices.map((i) => ({
      id: i.id,
      side: i.side,
      amountUsd: i.amount_usd,
      payUrl: i.pay_url,
      status: i.status,
      paidAt: i.paid_at,
      expiresAt: i.expires_at,
    })),
    shareUrls: {
      contractor: `${publicBase()}/m/${fresh.id}/contractor`,
      operator: `${publicBase()}/m/${fresh.id}/operator`,
      hub: `${publicBase()}/m/${fresh.id}`,
    },
  };

  if (normalisedSide) {
    payload.side = normalisedSide;
    const mine = invoices.find((i) => i.side === normalisedSide);
    payload.yourPayUrl = mine?.pay_url ?? null;
  }

  // ready → first reveal; in-grace → re-fetch; past grace with secrets → wipe via revealConnection
  const shouldTouchReveal =
    status === "ready" ||
    inRevealGrace ||
    (Boolean(fresh.connection_code) &&
      (fresh.status === "consumed" || Boolean(fresh.consumed_at)));

  if (shouldTouchReveal) {
    const connection = revealConnection(matchId);
    if (connection) {
      payload.connection = connection;
      payload.status = "consumed";
      payload.jobBriefPresent = Boolean(connection.jobBrief);
    } else {
      // Wiped (grace ended) or raced
      if (status === "ready" || fresh.status === "consumed" || fresh.consumed_at) {
        payload.status = "consumed";
      }
      payload.jobBriefPresent = false;
    }
  }

  return payload;
}

export { markInvoicePaid, cancelMatch };
