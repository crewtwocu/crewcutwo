/**
 * Paid callback tickets ($5 gate).
 *
 * Privacy:
 * - No SQLite / CRM / contact-table writes for visitor phone/note.
 * - Phone + note live only in process memory until payment succeeds or the
 *   ticket expires/fails; then wiped. Never logged.
 * - Public identifiers are opaque ticketId + invoiceId only.
 * - Ticket issuance (outbound notify + status=issued) runs only after payment.
 */

import { randomUUID } from "node:crypto";
import {
  opsEmail,
  opsPhone,
  sendOutbound,
  type OutboundPayload,
} from "./outbound.js";
import { createCallbackInvoice } from "./xmrcheckout.js";

export type CallbackTicketStatus =
  | "awaiting_payment"
  | "paid"
  | "issued"
  | "expired"
  | "failed";

type EphemeralContact = {
  phone: string;
  note: string;
};

type CallbackTicketRecord = {
  ticketId: string;
  invoiceId: string;
  payUrl: string;
  amountUsd: number;
  status: CallbackTicketStatus;
  createdAt: number;
  expiresAt: number;
  /** Cleared on issue / expire / fail. Never logged. */
  contact: EphemeralContact | null;
  issuedAt: number | null;
};

const TICKET_TTL_MS = (() => {
  const raw = process.env.INVOICE_TTL_SECONDS;
  const sec = raw ? Number(raw) : 3600;
  return (Number.isFinite(sec) && sec > 60 ? sec : 3600) * 1000;
})();

const byTicketId = new Map<string, CallbackTicketRecord>();
const byInvoiceId = new Map<string, string>();

const MAX_NOTE = 200;
const MAX_CONTACT = 254;
const SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logTicketEvent(
  ticketId: string,
  result: string,
  extra?: Record<string, string | boolean | number>
): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "callback_ticket",
      ticketId,
      result,
      ...(extra || {}),
    })
  );
}

function wipeContact(rec: CallbackTicketRecord): void {
  if (rec.contact) {
    rec.contact.phone = "";
    rec.contact.note = "";
    rec.contact = null;
  }
}

function purgeRecord(rec: CallbackTicketRecord): void {
  wipeContact(rec);
  byTicketId.delete(rec.ticketId);
  byInvoiceId.delete(rec.invoiceId);
}

/** Drop expired awaiting tickets; wipe any leftover contact. */
export function sweepExpiredCallbackTickets(now = Date.now()): number {
  let n = 0;
  for (const rec of [...byTicketId.values()]) {
    if (rec.status === "awaiting_payment" && rec.expiresAt <= now) {
      rec.status = "expired";
      wipeContact(rec);
      logTicketEvent(rec.ticketId, "expired");
      // Keep stub metadata briefly so status polls can report expired, then drop.
      setTimeout(() => purgeRecord(rec), 60_000).unref?.();
      n++;
    } else if (
      (rec.status === "issued" || rec.status === "failed" || rec.status === "expired") &&
      rec.expiresAt + 60_000 < now
    ) {
      purgeRecord(rec);
      n++;
    }
  }
  return n;
}

function buildCallbackOutbound(phone: string, note: string): OutboundPayload {
  const noteLine = note ? `Note: ${note}` : "Note: (none)";
  const ops = opsPhone();
  if (ops) {
    return {
      kind: "sms",
      to: ops,
      text: `Crew paid callback ticket: ${phone}. ${noteLine}`.slice(0, 1500),
    };
  }
  const to = opsEmail() || "stub@localhost";
  return {
    kind: "email",
    to,
    subject: "Crew contact: paid callback ticket",
    text:
      `Someone paid $5 for a phone callback via the Crew marketplace.\n\n` +
      `Phone: ${phone}\n` +
      `${noteLine}\n\n` +
      `Ticket was issued after payment; Crew does not store the contact.\n`,
  };
}

async function sendWithRetries(payload: OutboundPayload): Promise<{
  ok: boolean;
  transport: string;
}> {
  const noOpsDest = payload.to === "stub@localhost";
  let lastTransport = "none";
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      const result = noOpsDest
        ? { ok: true as const, transport: "stub" as const }
        : await sendOutbound(payload);
      lastTransport = result.transport;
      if (result.ok) return { ok: true, transport: lastTransport };
    } catch {
      if (attempt < SEND_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  return { ok: false, transport: lastTransport };
}

export type CreateCallbackTicketResult =
  | {
      ok: true;
      ticketId: string;
      invoiceId: string;
      payUrl: string;
      amountUsd: number;
      expiresAt: string;
    }
  | { ok: false; reason: "invalid_phone" | "invoice_failed" };

/**
 * Create a pending $5 callback ticket. Phone held only in memory until pay/expire.
 */
export async function createCallbackTicket(opts: {
  phone: string;
  note: string;
}): Promise<CreateCallbackTicketResult> {
  sweepExpiredCallbackTickets();

  const phone = opts.phone.trim().slice(0, MAX_CONTACT);
  const note = opts.note.trim().replace(/\s+/g, " ").slice(0, MAX_NOTE);
  if (!phone || !PHONE_RE.test(phone)) {
    return { ok: false, reason: "invalid_phone" };
  }

  const ticketId = randomUUID();
  let invoice;
  try {
    invoice = await createCallbackInvoice({ ticketId });
  } catch {
    logTicketEvent(ticketId, "invoice_failed");
    return { ok: false, reason: "invoice_failed" };
  }

  // Prefer returnTo back to Get-a-reply with ticket id (mock + any relative pay page).
  let payUrl = invoice.payUrl;
  if (payUrl.includes("/mock-pay/")) {
    const sep = payUrl.includes("?") ? "&" : "?";
    payUrl = `${payUrl}${sep}returnTo=${encodeURIComponent(`/?callbackTicket=${ticketId}#get-a-reply`)}`;
  }

  const now = Date.now();
  const rec: CallbackTicketRecord = {
    ticketId,
    invoiceId: invoice.id,
    payUrl,
    amountUsd: invoice.amountUsd,
    status: "awaiting_payment",
    createdAt: now,
    expiresAt: now + TICKET_TTL_MS,
    contact: { phone, note },
    issuedAt: null,
  };
  byTicketId.set(ticketId, rec);
  byInvoiceId.set(invoice.id, ticketId);
  logTicketEvent(ticketId, "created", {
    invoiceId: invoice.id,
    amountUsd: invoice.amountUsd,
  });

  return {
    ok: true,
    ticketId,
    invoiceId: invoice.id,
    payUrl: invoice.payUrl,
    amountUsd: invoice.amountUsd,
    expiresAt: new Date(rec.expiresAt).toISOString(),
  };
}

export type CallbackTicketPublic = {
  ticketId: string;
  status: CallbackTicketStatus;
  amountUsd: number;
  invoiceId: string;
  payUrl: string | null;
  expiresAt: string;
  issuedAt: string | null;
};

function toPublic(rec: CallbackTicketRecord): CallbackTicketPublic {
  return {
    ticketId: rec.ticketId,
    status: rec.status,
    amountUsd: rec.amountUsd,
    invoiceId: rec.invoiceId,
    payUrl: rec.status === "awaiting_payment" ? rec.payUrl : null,
    expiresAt: new Date(rec.expiresAt).toISOString(),
    issuedAt: rec.issuedAt ? new Date(rec.issuedAt).toISOString() : null,
  };
}

export function getCallbackTicket(ticketId: string): CallbackTicketPublic | null {
  sweepExpiredCallbackTickets();
  const rec = byTicketId.get(ticketId);
  if (!rec) return null;
  if (rec.status === "awaiting_payment" && rec.expiresAt <= Date.now()) {
    rec.status = "expired";
    wipeContact(rec);
    logTicketEvent(rec.ticketId, "expired");
  }
  return toPublic(rec);
}

export function findCallbackTicketByInvoice(
  invoiceId: string
): CallbackTicketPublic | null {
  const ticketId = byInvoiceId.get(invoiceId);
  if (!ticketId) return null;
  return getCallbackTicket(ticketId);
}

/**
 * Mark a callback invoice paid and issue the ticket (one-shot outbound).
 * Idempotent: already-issued tickets return success without re-sending.
 */
export async function completeCallbackPayment(invoiceId: string): Promise<{
  ok: boolean;
  ticketId?: string;
  status?: CallbackTicketStatus;
  reason?: string;
}> {
  sweepExpiredCallbackTickets();
  const ticketId = byInvoiceId.get(invoiceId);
  if (!ticketId) return { ok: false, reason: "not_found" };
  const rec = byTicketId.get(ticketId);
  if (!rec) return { ok: false, reason: "not_found" };

  if (rec.status === "issued") {
    return { ok: true, ticketId, status: "issued" };
  }
  if (rec.status === "expired" || rec.status === "failed") {
    return { ok: false, ticketId, status: rec.status, reason: rec.status };
  }
  if (rec.expiresAt <= Date.now() && rec.status === "awaiting_payment") {
    rec.status = "expired";
    wipeContact(rec);
    logTicketEvent(ticketId, "expired");
    return { ok: false, ticketId, status: "expired", reason: "expired" };
  }

  rec.status = "paid";
  const contact = rec.contact;
  if (!contact || !contact.phone) {
    // Payment arrived but contact already wiped — fail closed, do not invent.
    rec.status = "failed";
    logTicketEvent(ticketId, "failed", { reason: "contact_missing" });
    return { ok: false, ticketId, status: "failed", reason: "contact_missing" };
  }

  const phone = contact.phone;
  const note = contact.note;
  // Wipe before send so a crash mid-send does not leave PII longer than needed;
  // outbound payload holds a copy until send finishes.
  wipeContact(rec);

  let outbound: OutboundPayload | null = buildCallbackOutbound(phone, note);
  const send = await sendWithRetries(outbound);
  if (outbound) {
    outbound.to = "";
    outbound.text = "";
    outbound.subject = "";
    outbound = null;
  }

  if (!send.ok) {
    rec.status = "failed";
    logTicketEvent(ticketId, "failed", { transport: send.transport });
    return { ok: false, ticketId, status: "failed", reason: "send_failed" };
  }

  rec.status = "issued";
  rec.issuedAt = Date.now();
  logTicketEvent(ticketId, "issued", { transport: send.transport });
  return { ok: true, ticketId, status: "issued" };
}

/** True if this invoice id belongs to an in-memory callback ticket. */
export function isCallbackInvoice(invoiceId: string): boolean {
  return byInvoiceId.has(invoiceId);
}
