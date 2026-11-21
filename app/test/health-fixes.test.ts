process.env.DB_PATH = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const { llmsTxtForMode } = await import("../src/v1/router.js");
const { jobsPage } = await import("../src/v1/pages.js");

const llms = fs.readFileSync(new URL("../docs/llms.txt", import.meta.url), "utf8");

test("llms.txt keeps TEST MODE line when payments are off", () => {
  assert.match(llmsTxtForMode(llms, false), /^Status: TEST MODE\./m);
});

test("llms.txt says LIVE when payments are on", () => {
  const out = llmsTxtForMode(llms, true);
  assert.doesNotMatch(out, /TEST MODE/);
  assert.match(out, /^Status: LIVE\. Payments are real/m);
});

test("/jobs table sits in its own scroll container", () => {
  const html = jobsPage([{ ref: "r1", category: "code_or_doc_review", suggested_price_usd: 20, status: "open", posted_on: "2026-11-21", turnaround_hours: 48 }]);
  assert.match(html, /<div class="table-scroll"><table>[\s\S]*<\/table><\/div>/);
  assert.match(html, /\.table-scroll\{overflow-x:auto/);
});
