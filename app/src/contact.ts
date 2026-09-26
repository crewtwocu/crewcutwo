/**
 * Privacy-preserving one-shot contact / callback requests.
 *
 * - No DB / CRM / mailing-list writes.
 * - Email path: payload lives only in request-scoped memory; discarded after send.
 * - Callback path: $5 payment required before a ticket is issued. Phone/note held
 *   only in ephemeral process memory (see callbackTickets.ts) until pay/expire/fail,
 *   then wiped — never in SQLite contact tables.
 * - Logs: timestamp, result, requestId/ticketId only — never email/phone/note/body.
 * - Fail-closed: in-memory retries only; never park contact data for later.
 */

import { randomUUID } from "node:crypto";
import {
  opsEmail,
  sendOutbound,
  type OutboundPayload,
} from "./outbound.js";
import { createCallbackTicket } from "./callbackTickets.js";

export type ContactMethod = "email" | "callback";

export type ContactRequestBody = {
  method?: unknown;
  contact?: unknown;
  note?: unknown;
  /** Honeypot — bots fill this; humans leave empty. */
  website?: unknown;
  company?: unknown;
};

export type ContactHandlerResult = {
  httpStatus: number;
  body: {
    ok: boolean;
    requestId: string;
    /** Present when callback requires $5 before ticket issuance. */
    paymentRequired?: boolean;
    ticketId?: string;
    invoiceId?: string;
    payUrl?: string;
    amountUsd?: number;
    expiresAt?: string;
  };
};

const CONTACT_LIMIT = 5;
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const contactHits = new Map<string, number[]>();

const MAX_NOTE = 200;
const MAX_CONTACT = 254;
const SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

export function checkContactRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - CONTACT_WINDOW_MS;
  const prev = (contactHits.get(ip) || []).filter((t) => t > cutoff);
  if (prev.length >= CONTACT_LIMIT) {
    contactHits.set(ip, prev);
    return false;
  }
  prev.push(now);
  contactHits.set(ip, prev);
  return true;
}

/** App-log line: no PII, no request body. */
export function logContactEvent(
  requestId: string,
  result: "sent" | "failed" | "payment_pending",
  extra?: { transport?: string; honeypot?: boolean; rateLimited?: boolean; method?: string }
): void {
  const row: Record<string, string | boolean> = {
    ts: new Date().toISOString(),
    event: "contact",
    requestId,
    result,
  };
  if (extra?.transport) row.transport = extra.transport;
  if (extra?.honeypot) row.honeypot = true;
  if (extra?.rateLimited) row.rateLimited = true;
  if (extra?.method) row.method = extra.method;
  console.log(JSON.stringify(row));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseMethod(raw: unknown): ContactMethod | null {
  if (raw === "email" || raw === "callback") return raw;
  return null;
}

function normaliseContact(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_CONTACT);
}

function normaliseNote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NOTE);
}

function honeypotFilled(body: ContactRequestBody): boolean {
  const a = typeof body.website === "string" ? body.website.trim() : "";
  const b = typeof body.company === "string" ? body.company.trim() : "";
  return Boolean(a || b);
}

function buildEmailOutbound(contact: string, note: string): OutboundPayload {
  const noteLine = note ? `Note: ${note}` : "Note: (none)";
  const to = opsEmail();
  const dest = to || "stub@localhost";
  return {
    kind: "email",
    to: dest,
    subject: "Crew contact: email reply request",
    text:
      `Someone requested an email reply via the Crew marketplace.\n\n` +
      `Reply-to: ${contact}\n` +
      `${noteLine}\n\n` +
      `This message is one-shot; Crew does not store the contact.\n`,
  };
}

/**
 * Handle a contact POST. Mutates nothing durable.
 * Email: send immediately then discard.
 * Callback: create $5 payment intent; ticket issued only after payment (see callbackTickets).
 */
export async function handleContactRequest(
  body: ContactRequestBody,
  ip: string
): Promise<ContactHandlerResult> {
  const requestId = randomUUID();

  if (!checkContactRateLimit(ip)) {
    logContactEvent(requestId, "failed", { rateLimited: true });
    return {
      httpStatus: 429,
      body: { ok: false, requestId },
    };
  }

  // Honeypot: success-looking response, no send, no payment, no PII in logs
  if (honeypotFilled(body)) {
    logContactEvent(requestId, "sent", { honeypot: true });
    return { httpStatus: 200, body: { ok: true, requestId } };
  }

  const method = parseMethod(body.method);
  const contact = normaliseContact(body.contact);
  const note = normaliseNote(body.note);

  if (!method || !contact) {
    logContactEvent(requestId, "failed");
    return { httpStatus: 400, body: { ok: false, requestId } };
  }

  if (method === "email" && !EMAIL_RE.test(contact)) {
    logContactEvent(requestId, "failed");
    return { httpStatus: 400, body: { ok: false, requestId } };
  }
  if (method === "callback" && !PHONE_RE.test(contact)) {
    logContactEvent(requestId, "failed");
    return { httpStatus: 400, body: { ok: false, requestId } };
  }

  // —— Callback: payment gate ($5) before ticket issuance ——
  if (method === "callback") {
    const created = await createCallbackTicket({ phone: contact, note });
    if (!created.ok) {
      logContactEvent(requestId, "failed", { method: "callback" });
      const status = created.reason === "invalid_phone" ? 400 : 503;
      return { httpStatus: status, body: { ok: false, requestId } };
    }
    logContactEvent(created.ticketId, "payment_pending", { method: "callback" });
    return {
      httpStatus: 200,
      body: {
        ok: true,
        requestId: created.ticketId,
        paymentRequired: true,
        ticketId: created.ticketId,
        invoiceId: created.invoiceId,
        payUrl: created.payUrl,
        amountUsd: created.amountUsd,
        expiresAt: created.expiresAt,
      },
    };
  }

  // —— Email: immediate one-shot (unchanged) ——
  const built = buildEmailOutbound(contact, note);
  let outbound: OutboundPayload | null = built;
  const noOpsDest = built.to === "stub@localhost";

  let lastTransport = "none";
  let sent = false;

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    try {
      if (!outbound) break;
      const result = noOpsDest
        ? { ok: true as const, transport: "stub" as const }
        : await sendOutbound(outbound);
      lastTransport = result.transport;
      if (result.ok) {
        sent = true;
        break;
      }
    } catch {
      if (attempt < SEND_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  if (outbound) {
    outbound.to = "";
    outbound.text = "";
    outbound.subject = "";
    outbound = null;
  }

  if (sent) {
    logContactEvent(requestId, "sent", { transport: lastTransport, method: "email" });
    return { httpStatus: 200, body: { ok: true, requestId } };
  }

  logContactEvent(requestId, "failed", { transport: lastTransport, method: "email" });
  return { httpStatus: 503, body: { ok: false, requestId } };
}

/**
 * Strip contact PII from a request-shaped object (for access-log / middleware hygiene).
 * Call after handling so reverse proxies / future loggers see redacted fields.
 */
export function redactContactBody(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== "object") return;
  if ("contact" in body) body.contact = "[redacted]";
  if ("note" in body) body.note = "[redacted]";
  if ("email" in body) body.email = "[redacted]";
  if ("phone" in body) body.phone = "[redacted]";
  if ("website" in body) body.website = "[redacted]";
  if ("company" in body) body.company = "[redacted]";
}
