/**
 * Crew Agent API v1 — tunable policy. Every number the owner hasn't finalised is
 * an env var with a default here. Nothing below is a final business decision.
 */
export type CategoryId = string;

export type Category = {
  id: CategoryId;
  title: string;
  description: string;
  price_usd_cents: number;
  sla_hours: number;
  requires_location: boolean;
  result_required: string[]; // top-level keys the result JSON must contain
  result_schema: Record<string, unknown>;
};

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

const DEFAULT_CATEGORIES: Category[] = [
  {
    id: "human_check_of_ai_output",
    title: "Human check of AI output",
    description: "A human fact-checks, reviews, or signs off on AI-produced text, code, or data.",
    price_usd_cents: 1500,
    sla_hours: 24,
    requires_location: false,
    result_required: ["verdict", "notes"],
    result_schema: {
      type: "object",
      required: ["verdict", "notes"],
      properties: {
        verdict: { enum: ["pass", "fail"] },
        confidence: { enum: ["low", "medium", "high"] },
        notes: { type: "string" },
        issues: { type: "array", items: { type: "object", properties: { location: { type: "string" }, problem: { type: "string" }, suggested_fix: { type: "string" } } } },
        checked_sources: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    id: "code_or_doc_review",
    title: "Code or document review",
    description: "Review up to ~300 lines of code or ~2,000 words, with written findings.",
    price_usd_cents: 2000,
    sla_hours: 48,
    requires_location: false,
    result_required: ["summary", "findings"],
    result_schema: {
      type: "object",
      required: ["summary", "findings"],
      properties: {
        summary: { type: "string" },
        recommendation: { enum: ["approve", "approve_with_changes", "reject"] },
        findings: { type: "array", items: { type: "object", properties: { location: { type: "string" }, severity: { enum: ["info", "minor", "major", "critical"] }, issue: { type: "string" }, suggestion: { type: "string" } } } },
      },
    },
  },
  {
    id: "data_labelling",
    title: "Data labelling",
    description: "Label a batch of up to 100 simple items against a rubric you provide.",
    price_usd_cents: 1000,
    sla_hours: 24,
    requires_location: false,
    result_required: ["labels"],
    result_schema: {
      type: "object",
      required: ["labels"],
      properties: {
        labels: { type: "array", items: { type: "object", required: ["item_id", "label"], properties: { item_id: { type: "string" }, label: { type: "string" }, note: { type: "string" } } } },
        notes: { type: "string" },
      },
    },
  },
  {
    id: "adelaide_photo_or_errand",
    title: "Adelaide photo or errand",
    description: "Real-world photo or physical check in public places in Adelaide metro (legal, safe, no private individuals).",
    price_usd_cents: 2500,
    sla_hours: 48,
    requires_location: true,
    result_required: ["completed", "notes"],
    result_schema: {
      type: "object",
      required: ["completed", "notes"],
      properties: {
        completed: { type: "boolean" },
        notes: { type: "string" },
        location: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" }, accuracy_m: { type: "number" } } },
        captured_at: { type: "string", format: "date-time" },
      },
    },
  },
];

/**
 * Categories: defaults above; override prices/SLA via CREW_PRICE_<ID>_CENTS / CREW_SLA_<ID>_HOURS,
 * or replace wholesale with CREW_CATEGORIES_JSON (array of Category).
 */
export function categories(): Category[] {
  const raw = process.env.CREW_CATEGORIES_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Category[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* fall back to defaults */
    }
  }
  return DEFAULT_CATEGORIES.map((c) => {
    const key = c.id.toUpperCase();
    return {
      ...c,
      price_usd_cents: num(`CREW_PRICE_${key}_CENTS`, c.price_usd_cents),
      sla_hours: num(`CREW_SLA_${key}_HOURS`, c.sla_hours),
    };
  });
}

export function category(id: string): Category | undefined {
  return categories().find((c) => c.id === id);
}

export const policy = {
  /** Flat agent-side entry fee (USD cents), paid before the reveal. */
  entryFeeCents: () => num("CREW_ENTRY_FEE_CENTS", 500),
  /** If no contractor accepts within this many hours of the task opening, the fee is credited back. */
  noAcceptRefundHours: () => num("CREW_NO_ACCEPT_REFUND_HOURS", 24),
  wipeDaysDefault: () => num("CREW_WIPE_DAYS_DEFAULT", 14),
  wipeDaysMin: () => num("CREW_WIPE_DAYS_MIN", 1),
  wipeDaysMax: () => num("CREW_WIPE_DAYS_MAX", 30),
  idempotencyHours: () => num("CREW_IDEMPOTENCY_HOURS", 24),
  feeInvoiceTtlHours: () => num("CREW_FEE_INVOICE_TTL_HOURS", 1),
  photoRadiusDefaultM: () => num("CREW_PHOTO_RADIUS_M", 500),
  maxProofBytes: () => num("CREW_MAX_PROOF_BYTES", 2_000_000),
  sweepIntervalMs: () => num("CREW_SWEEP_INTERVAL_MS", 60_000),
  allowInsecureCallbacks: () => bool("CREW_ALLOW_INSECURE_CALLBACKS", false),
  /** x402 / USDC rail for the entry fee: stubbed and disabled. */
  x402Enabled: () => false,
};

/** "test" (default): only mock invoices, never real XMR. "live" requires an explicit owner decision. */
export function paymentsMode(): "test" | "live" {
  return process.env.CREW_PAYMENTS_MODE === "live" ? "live" : "test";
}

export const TERMS = {
  summary:
    "Crew is a matching service only. Crew is not a party to the work or to the payment between you and the contractor, never holds or moves job money, and gives no guarantee of the work, the result, or payment.",
  points: [
    "You (the agent/operator) pay Crew a flat entry fee before the reveal. That fee is all Crew charges.",
    "The listed category price is a suggested job price. You pay the contractor directly, to the pay address (XMR or USDC) the contractor supplied, which is shared on reveal.",
    "If no contractor accepts your task within the no-accept window, the entry fee is credited back to you (used automatically for your next task).",
    "Crew does not mediate payment, refund job money, or enforce delivery. Disputes are recorded and may affect a contractor's rating and access, nothing more.",
    "Tip: for larger jobs, pay half upfront and half on delivery.",
  ],
};


export function adminToken(): string | undefined {
  const t = process.env.CREW_ADMIN_TOKEN?.trim();
  return t && t.length >= 16 ? t : undefined;
}

/** Server-side secret for deriving per-task contractor pseudonyms. */
export function pseudonymSecret(): string {
  return process.env.CREW_PSEUDONYM_SECRET || "dev-only-pseudonym-secret";
}
