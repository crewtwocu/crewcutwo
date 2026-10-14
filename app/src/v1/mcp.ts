/**
 * In-app MCP endpoint (streamable HTTP, stateless) at POST /mcp.
 * Thin wrapper over this server's own /v1 REST API via loopback. Callers send their API key as Bearer.
 * Standalone stdio/HTTP package lives in crew-mcp (same tools).
 */
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export const CATEGORY_IDS = ["human_check_of_ai_output", "code_or_doc_review", "data_labelling", "adelaide_photo_or_errand"] as const;

const baseUrl = () => (process.env.CREW_MCP_API_BASE || `http://127.0.0.1:${process.env.PORT || 3847}`).replace(/\/$/, "");

type CallResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function call(apiKey: string | undefined, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<CallResult> {
  try {
    const res = await fetch(`${baseUrl()}/v1${path}`, {
      method,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000), // free-tier cold starts can take ~60s
    });
    const text = await res.text();
    return { content: [{ type: "text", text }], ...(res.ok ? {} : { isError: true }) };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ error: { code: "network_error", message: e instanceof Error ? e.message : String(e) } }) }], isError: true };
  }
}

export function buildServer(apiKey: string | undefined): McpServer {
  const server = new McpServer({ name: "crew-mcp", version: "0.1.0" });
  const id = { task_id: z.string().min(1).max(80) };

  server.registerTool("list_categories", {
    title: "List Crew categories",
    description: "List task categories with fixed prices, turnaround (SLA), and result schemas.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => call(apiKey, "GET", "/categories"));

  server.registerTool("post_task", {
    title: "Post a task",
    description: "Post a task for a human contractor. Crew is a matching service only: you pay Crew a flat entry fee (returned as entry_fee.pay_url) before the reveal, then pay the contractor directly at the suggested category price. Brief is human-reviewed; disallowed tasks (captcha, KYC, account farming, illegal) are rejected and the fee credited.",
    inputSchema: {
      category: z.enum(CATEGORY_IDS),
      brief: z.string().min(20).max(4000),
      budget_usd: z.number().min(1).optional(),
      deadline: z.string().datetime({ offset: true }),
      callback_url: z.string().url().optional(),
      location: z.object({ lat: z.number(), lng: z.number(), radius_m: z.number().int().optional() }).optional(),
      attachments: z.array(z.string().url()).max(10).optional(),
      retention_days: z.number().int().min(1).max(30).optional(),
      idempotency_key: z.string().min(1).max(64),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ idempotency_key, ...body }) => call(apiKey, "POST", "/tasks", body, { "Idempotency-Key": idempotency_key }));

  server.registerTool("get_task", {
    title: "Get task status",
    description: "Get task status, price, payment state, and timestamps.",
    inputSchema: id,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ task_id }) => call(apiKey, "GET", `/tasks/${encodeURIComponent(task_id)}`));

  server.registerTool("get_reveal", {
    title: "Reveal contractor pay address",
    description: "After a contractor accepts and the entry fee is paid: returns the contractor's own pay address (XMR or USDC) and the suggested price. You pay the contractor directly; Crew is not a party to that payment. Tip: for larger jobs pay half upfront, half on delivery.",
    inputSchema: id,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ task_id }) => call(apiKey, "GET", `/tasks/${encodeURIComponent(task_id)}/reveal`));

  server.registerTool("get_result", {
    title: "Get task result",
    description: "Get the structured result, proof file links (signed, 1h) with SHA-256 hashes, and proof checks. Errors with not_ready until delivered.",
    inputSchema: id,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ task_id }) => call(apiKey, "GET", `/tasks/${encodeURIComponent(task_id)}/result`));

  server.registerTool("accept_result", {
    title: "Accept result",
    description: "Mark the task completed and optionally rate the contractor 1-5 (public pseudonym average). Irreversible. Does not move money; job payment is direct between you and the contractor.",
    inputSchema: { ...id, rating: z.number().int().min(1).max(5).optional() },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ task_id, rating }) => call(apiKey, "POST", `/tasks/${encodeURIComponent(task_id)}/accept`, rating === undefined ? {} : { rating }));

  server.registerTool("dispute_result", {
    title: "Dispute result",
    description: "Record a dispute (once per task). Crew is not a party to the payment; disputes affect the contractor's rating/access only.",
    inputSchema: { ...id, reason: z.string().min(10).max(2000) },
    annotations: { destructiveHint: false, openWorldHint: true },
  }, async ({ task_id, reason }) => call(apiKey, "POST", `/tasks/${encodeURIComponent(task_id)}/dispute`, { reason }));

  return server;
}


export function mountMcp(app: express.Express): void {
  app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
    const auth = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const server = buildServer(auth || undefined);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp]", e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
  });
  const notAllowed = (_req: express.Request, res: express.Response) => { res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null }); };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
