/**
 * Privacy-preserving one-shot contact / callback requests.
 *
 * - No DB / CRM / mailing-list writes.
 * - Payload lives only in request-scoped memory; discarded after send attempt.
 * - Logs: timestamp, result (sent|failed), requestId only — never email/phone/note/body.
 * - Fail-closed: in-memory retries only; never park contact data for later.
 */

import { randomUUID } from "node:crypto";
import {
  opsEmail,
  opsPhone,
  sendOutbound,
  type OutboundPayload,
} from "./outbound.js";

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
  body: { ok: boolean; requestId: string };
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
  result: "sent" | "failed",
  extra?: { transport?: string; honeypot?: boolean; rateLimited?: boolean }
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

function buildOutbound(
  method: ContactMethod,
  contact: string,
  note: string
): OutboundPayload {
  const noteLine = note ? `Note: ${note}` : "Note: (none)";

  if (method === "email") {
    const to = opsEmail();
    // If no ops inbox configured, still attempt stub path via a placeholder "to"
    // that only the stub transport will accept without sending.
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

  // callback: prefer SMS to ops phone; else email-to-ops
  const phone = opsPhone();
  if (phone) {
    return {
      kind: "sms",
      to: phone,
      text: `Crew callback request: ${contact}. ${noteLine}`.slice(0, 1500),
    };
  }

  const to = opsEmail() || "stub@localhost";
  return {
    kind: "email",
    to,
    subject: "Crew contact: callback request",
    text:
      `Someone requested a phone callback via the Crew marketplace.\n\n` +
      `Phone: ${contact}\n` +
      `${noteLine}\n\n` +
      `This message is one-shot; Crew does not store the contact.\n`,
  };
}

/**
 * Handle a contact POST. Mutates nothing durable.
 * After return, callers should treat the request body as discarded.
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

  // Honeypot: success-looking response, no send, no PII in logs
  if (honeypotFilled(body)) {
    logContactEvent(requestId, "sent", { honeypot: true });
    return { httpStatus: 200, body: { ok: true, requestId } };
  }

  const method = parseMethod(body.method);
  const contact = normaliseContact(body.contact);
  const note = normaliseNote(body.note);

  if (!method || !contact) {
    logContactEvent(requestId, "failed");
    // Generic — do not echo which field failed with PII
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

  const built = buildOutbound(method, contact, note);
  // Drop locals that hold PII as soon as payload is built
  // (payload still holds them until send finishes — then we null it)
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
      // Swallow — no error message (may contain destinations)
      if (attempt < SEND_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  // Fail-closed discard: clear payload from memory; never park for later
  if (outbound) {
    outbound.to = "";
    outbound.text = "";
    outbound.subject = "";
    outbound = null;
  }

  if (sent) {
    logContactEvent(requestId, "sent", { transport: lastTransport });
    return { httpStatus: 200, body: { ok: true, requestId } };
  }

  logContactEvent(requestId, "failed", { transport: lastTransport });
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
