/**
 * Pluggable one-shot outbound messaging for contact requests.
 * Transports are env-gated; missing credentials → stub (no PII logged).
 * Never logs email, phone, or message body.
 */

import net from "node:net";
import tls from "node:tls";

export type OutboundKind = "email" | "sms";

export type OutboundPayload = {
  kind: OutboundKind;
  /** Destination (ops inbox or ops phone). Not logged. */
  to: string;
  subject?: string;
  text: string;
};

export type OutboundResult = {
  ok: boolean;
  transport: "smtp" | "twilio" | "stub";
};

function smtpConfigured(): boolean {
  return Boolean(process.env.CREW_SMTP_HOST && process.env.CREW_SMTP_FROM);
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

type SmtpSocket = net.Socket | tls.TLSSocket;

/** Read one complete SMTP reply (handles multi-line 250- … 250 ). */
function readReply(socket: SmtpSocket): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const parts = buf.split("\r\n");
      // Keep incomplete trailing fragment
      buf = parts.pop() ?? "";
      const lines: string[] = [];
      for (const line of parts) {
        if (!/^\d{3}[ -]/.test(line)) continue;
        lines.push(line);
        if (line[3] === " ") {
          socket.off("data", onData);
          socket.off("error", onErr);
          const code = Number(line.slice(0, 3));
          resolve({ code, lines });
          return;
        }
      }
    };
    const onErr = (err: Error) => {
      socket.off("data", onData);
      reject(err);
    };
    socket.on("data", onData);
    socket.once("error", onErr);
  });
}

async function expect(socket: SmtpSocket, codes: number | number[]): Promise<void> {
  const want = Array.isArray(codes) ? codes : [codes];
  const { code } = await readReply(socket);
  if (!want.includes(code)) {
    throw new Error(`smtp_unexpected_${code}`);
  }
}

function writeLine(socket: SmtpSocket, line: string): void {
  socket.write(line + "\r\n");
}

/**
 * Minimal SMTP: EHLO → optional STARTTLS → optional AUTH LOGIN → MAIL/RCPT/DATA.
 * No third-party dependency. Does not log envelope or body.
 */
async function sendSmtp(to: string, subject: string, text: string): Promise<void> {
  const host = process.env.CREW_SMTP_HOST!;
  const port = Number(process.env.CREW_SMTP_PORT || 587);
  const user = process.env.CREW_SMTP_USER || "";
  const pass = process.env.CREW_SMTP_PASS || "";
  const from = process.env.CREW_SMTP_FROM!;
  const implicitTls =
    process.env.CREW_SMTP_SECURE === "1" ||
    process.env.CREW_SMTP_SECURE === "true" ||
    port === 465;

  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  let socket: SmtpSocket = await new Promise((resolve, reject) => {
    const s = implicitTls
      ? tls.connect({ host, port, servername: host }, () => resolve(s))
      : net.connect({ host, port }, () => resolve(s));
    s.setTimeout(20_000);
    s.once("error", reject);
    s.once("timeout", () => reject(new Error("smtp_timeout")));
  });

  const upgradeToTls = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const upgraded = tls.connect({ socket: socket as net.Socket, host, servername: host }, () => {
        socket = upgraded;
        resolve();
      });
      upgraded.once("error", reject);
    });

  try {
    await expect(socket, 220);
    writeLine(socket, "EHLO crew");
    await expect(socket, 250);

    if (!implicitTls) {
      writeLine(socket, "STARTTLS");
      await expect(socket, 220);
      await upgradeToTls();
      writeLine(socket, "EHLO crew");
      await expect(socket, 250);
    }

    if (user && pass) {
      writeLine(socket, "AUTH LOGIN");
      await expect(socket, 334);
      writeLine(socket, b64(user));
      await expect(socket, 334);
      writeLine(socket, b64(pass));
      await expect(socket, 235);
    }

    writeLine(socket, `MAIL FROM:<${from}>`);
    await expect(socket, 250);
    writeLine(socket, `RCPT TO:<${to}>`);
    await expect(socket, 250);
    writeLine(socket, "DATA");
    await expect(socket, 354);

    const safeSubject = subject.replace(/[\r\n]+/g, " ").slice(0, 200);
    const body =
      `From: ${from}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${safeSubject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..") +
      `\r\n.`;
    socket.write(body + "\r\n");
    await expect(socket, 250);
    writeLine(socket, "QUIT");
    try {
      await expect(socket, 221);
    } catch {
      /* quit reply optional */
    }
  } finally {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function sendTwilioSms(to: string, text: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const body = new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1500) });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`twilio_http_${res.status}`);
  }
}

function sendStub(): OutboundResult {
  return { ok: true, transport: "stub" };
}

/**
 * Send one outbound message. Caller owns retries.
 * Prefer Twilio for SMS; SMTP for email. Missing credentials → stub (ok).
 */
export async function sendOutbound(payload: OutboundPayload): Promise<OutboundResult> {
  if (payload.kind === "sms") {
    if (twilioConfigured()) {
      await sendTwilioSms(payload.to, payload.text);
      return { ok: true, transport: "twilio" };
    }
    return sendStub();
  }

  if (smtpConfigured()) {
    await sendSmtp(payload.to, payload.subject || "Crew contact", payload.text);
    return { ok: true, transport: "smtp" };
  }
  return sendStub();
}

export function opsEmail(): string | null {
  const e = (process.env.CREW_CONTACT_OPS_EMAIL || "").trim();
  return e || null;
}

export function opsPhone(): string | null {
  const p = (process.env.CREW_CONTACT_OPS_PHONE || "").trim();
  return p || null;
}

export function outboundCapabilities(): {
  smtp: boolean;
  twilio: boolean;
  opsEmail: boolean;
  opsPhone: boolean;
} {
  return {
    smtp: smtpConfigured(),
    twilio: twilioConfigured(),
    opsEmail: Boolean(opsEmail()),
    opsPhone: Boolean(opsPhone()),
  };
}
