import { db } from "../db.js";
import { nowIso, nowMs } from "./clock.js";
import { hmacHex, newId } from "./util.js";

/** Retry schedule after a failed attempt: 1m, 5m, 30m, 2h, 12h, then give up. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

export function signPayload(secret: string, rawBody: string, tSec: number): string {
  return `t=${tSec},v1=${hmacHex(secret, `${tSec}.${rawBody}`)}`;
}

/** Receiver-side helper (also documented for operators). Tolerance default 5 min. */
export function verifySignature(secret: string, rawBody: string, header: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  return hmacHex(secret, `${t}.${rawBody}`) === parts.v1;
}

/** Record an audit event and enqueue a webhook if the task has a callback_url. */
export function recordEvent(taskId: string, type: string): string {
  const id = newId("evt");
  const at = nowIso();
  db.prepare("INSERT INTO v1_events (id, task_id, type, at) VALUES (?,?,?,?)").run(id, taskId, type, at);
  const task = db.prepare("SELECT operator_id, callback_url FROM v1_tasks WHERE id = ?").get(taskId) as
    | { operator_id: string; callback_url: string | null }
    | undefined;
  if (task?.callback_url && type.startsWith("task.")) {
    const payload = JSON.stringify({ id, type, task_id: taskId, created_at: at });
    db.prepare(
      `INSERT INTO v1_webhook_deliveries (event_id, task_id, operator_id, url, payload, next_attempt_at, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, taskId, task.operator_id, task.callback_url, payload, at, at);
  }
  return id;
}

type Delivery = { id: number; event_id: string; operator_id: string; url: string; payload: string; attempts: number };

let inFlight = false;
/** Send due webhook deliveries. Safe to call often (lazy sweep on wake + timer). */
export async function deliverDueWebhooks(fetchImpl: typeof fetch = fetch): Promise<number> {
  if (inFlight) return 0;
  inFlight = true;
  let sent = 0;
  try {
    const due = db
      .prepare(`SELECT * FROM v1_webhook_deliveries WHERE status='pending' AND next_attempt_at <= ? ORDER BY id LIMIT 50`)
      .all(nowIso()) as Delivery[];
    for (const d of due) {
      const op = db.prepare("SELECT webhook_secret FROM v1_operators WHERE id = ?").get(d.operator_id) as { webhook_secret: string } | undefined;
      if (!op) continue;
      const t = Math.floor(nowMs() / 1000);
      let ok = false;
      let err = "";
      try {
        const res = await fetchImpl(d.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Crew-Webhooks/1",
            "Crew-Signature": signPayload(op.webhook_secret, d.payload, t),
            "Crew-Event-Id": d.event_id,
          },
          body: d.payload,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        ok = res.status >= 200 && res.status < 300;
        if (!ok) err = `HTTP ${res.status}`;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const attempts = d.attempts + 1;
      if (ok) {
        db.prepare("UPDATE v1_webhook_deliveries SET status='delivered', attempts=?, last_error=NULL WHERE id=?").run(attempts, d.id);
        sent++;
      } else if (attempts > RETRY_DELAYS_MS.length) {
        db.prepare("UPDATE v1_webhook_deliveries SET status='failed', attempts=?, last_error=? WHERE id=?").run(attempts, err, d.id);
      } else {
        const next = new Date(nowMs() + RETRY_DELAYS_MS[attempts - 1]).toISOString();
        db.prepare("UPDATE v1_webhook_deliveries SET attempts=?, next_attempt_at=?, last_error=? WHERE id=?").run(attempts, next, err, d.id);
      }
    }
  } finally {
    inFlight = false;
  }
  return sent;
}
