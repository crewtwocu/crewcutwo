import { db } from "../db.js";

/** v1 tables (no-custody model). Additive only: existing match/callback tables are untouched. */
export function migrateV1(): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS v1_operators (
    id TEXT PRIMARY KEY,
    label TEXT,
    webhook_secret TEXT NOT NULL,
    retention_days INTEGER,
    fee_credits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS v1_api_keys (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL REFERENCES v1_operators(id),
    hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('live','test')),
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE TABLE IF NOT EXISTS v1_contractors (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    pay_xmr TEXT,
    pay_usdc TEXT,
    pay_usdc_network TEXT,
    categories_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS v1_tasks (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    category TEXT NOT NULL,
    brief TEXT,
    attachments_json TEXT,
    location_json TEXT,
    screen_flags_json TEXT,
    suggested_price_cents INTEGER NOT NULL,
    fee_cents INTEGER NOT NULL,
    fee_status TEXT NOT NULL CHECK (fee_status IN ('pending','paid','paid_by_credit','credited','expired')),
    fee_invoice_id TEXT,
    fee_pay_url TEXT,
    fee_expires_at TEXT,
    status TEXT NOT NULL,
    deadline TEXT NOT NULL,
    callback_url TEXT,
    retention_days INTEGER NOT NULL,
    contractor_id TEXT,
    contractor_ref TEXT,
    pay_to_json TEXT,
    rejection_reason TEXT,
    dispute_reason TEXT,
    rating INTEGER,
    result_json TEXT,
    result_sha256 TEXT,
    proof_checks_json TEXT,
    created_at TEXT NOT NULL,
    fee_paid_at TEXT,
    opened_at TEXT,
    claimed_at TEXT,
    delivered_at TEXT,
    closed_at TEXT,
    wipe_at TEXT,
    wiped_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_v1_tasks_status ON v1_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_v1_tasks_op ON v1_tasks(operator_id);
  CREATE INDEX IF NOT EXISTS idx_v1_tasks_fee_inv ON v1_tasks(fee_invoice_id);
  CREATE TABLE IF NOT EXISTS v1_proof_files (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    name TEXT,
    mime TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS v1_idempotency (
    operator_id TEXT NOT NULL,
    key TEXT NOT NULL,
    body_hash TEXT NOT NULL,
    task_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (operator_id, key)
  );
  CREATE TABLE IF NOT EXISTS v1_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    type TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_v1_events_task ON v1_events(task_id);
  CREATE TABLE IF NOT EXISTS v1_webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    url TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
    last_error TEXT,
    created_at TEXT NOT NULL
  );
  `);
}
