/**
 * XMR Checkout adapter
 *
 * Confirmed contract (Master Of Coins):
 * - Auth: Authorization: ApiKey $XMRCHECKOUT_API_KEY
 * - Base: https://xmrcheckout.com/api/core (or XMRCHECKOUT_BASE_URL)
 * - Create: POST /invoices with amount_fiat + currency
 * - Paid (MVP): poll GET /public/invoice/<id> (no auth); status === "confirmed"
 *
 * When XMRCHECKOUT_API_KEY is unset, returns mock invoices for local dry-run.
 */

export type Side = "contractor" | "operator";

export type CreatedInvoice = {
  id: string;
  payUrl: string;
  amountUsd: number;
  side: Side;
};

export type PublicInvoiceStatus = {
  id: string;
  status: string;
  raw: unknown;
};

const AMOUNT_USD = 5;

function baseUrl(): string {
  return (process.env.XMRCHECKOUT_BASE_URL || "https://xmrcheckout.com/api/core").replace(/\/$/, "");
}

function apiKey(): string | undefined {
  const k = process.env.XMRCHECKOUT_API_KEY?.trim();
  return k || undefined;
}

export function isLiveMode(): boolean {
  return Boolean(apiKey());
}

export function mockPayAllowed(): boolean {
  if (!isLiveMode()) return true;
  return process.env.ALLOW_MOCK_PAY === "true" || process.env.ALLOW_MOCK_PAY === "1";
}

function publicBase(): string {
  const b = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3847}`;
  return b.replace(/\/$/, "");
}

/** Create one invoice for a match side. */
export async function createInvoice(opts: {
  matchId: string;
  side: Side;
}): Promise<CreatedInvoice> {
  const key = apiKey();
  if (!key) {
    // Mock: stable local id; pay page posts to /api/dev/pay/:id
    const id = `mock_${opts.side}_${opts.matchId.slice(0, 8)}_${Date.now().toString(36)}`;
    return {
      id,
      payUrl: `${publicBase()}/mock-pay/${id}`,
      amountUsd: AMOUNT_USD,
      side: opts.side,
    };
  }

  const body = {
    amount_fiat: "5.00",
    currency: "USD",
    confirmation_target: 2,
    metadata: {
      match_id: opts.matchId,
      side: opts.side,
      brand: "Crew",
    },
    // Omit checkout_continue_url until a public https host exists.
  };

  const res = await fetch(`${baseUrl()}/invoices`, {
    method: "POST",
    headers: {
      Authorization: `ApiKey ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`XMR Checkout create invoice failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    invoice_url?: string;
  };

  if (!data.id) throw new Error("XMR Checkout response missing id");

  const payUrl =
    data.invoice_url || `https://xmrcheckout.com/invoice/${data.id}`;

  return {
    id: data.id,
    payUrl,
    amountUsd: AMOUNT_USD,
    side: opts.side,
  };
}

/** Poll public invoice endpoint; confirmed => paid for MVP. */
export async function fetchPublicInvoiceStatus(invoiceId: string): Promise<PublicInvoiceStatus> {
  const res = await fetch(`${baseUrl()}/public/invoice/${encodeURIComponent(invoiceId)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`XMR Checkout public invoice failed: ${res.status} ${text}`);
  }
  const raw = await res.json();
  const status = typeof raw === "object" && raw && "status" in raw ? String((raw as { status: unknown }).status) : "";
  return { id: invoiceId, status, raw };
}

export function isConfirmedStatus(status: string): boolean {
  return status === "confirmed";
}
