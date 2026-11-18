import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DB_PATH = ":memory:";
process.env.STATS_KEY = "test-key";
const { recordVisit, visitStats, normalisePath } = await import("../src/visits.js");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36";

test("paths are reduced to first segment", () => {
  assert.equal(normalisePath("/m/abc123/contractor?x=1"), "/m");
  assert.equal(normalisePath("/"), "/");
  assert.equal(normalisePath(undefined), "/");
});

test("counts views and daily uniques, skips bots", () => {
  const now = new Date("2026-11-19T01:00:00Z");
  assert.equal(recordVisit({ site: "marketing", path: "/", ip: "1.1.1.1", ua: UA, now }).counted, true);
  assert.equal(recordVisit({ site: "marketing", path: "/", ip: "1.1.1.1", ua: UA, now }).counted, true);
  assert.equal(recordVisit({ site: "marketing", path: "/", ip: "2.2.2.2", ua: UA, now }).counted, true);
  assert.equal(recordVisit({ site: "marketing", path: "/", ip: "3.3.3.3", ua: "Twitterbot/1.0", now }).counted, false);
  assert.equal(recordVisit({ site: "match", path: "/", ip: "3.3.3.3", ua: "Render/1.0", now }).counted, false);
  assert.equal(recordVisit({ site: "evil", path: "/", ip: "3.3.3.3", ua: UA, now }).counted, false);
  const s = visitStats();
  assert.equal(s.sites.marketing!.views, 3);
  assert.equal(s.sites.marketing!.days["2026-11-19"]!.uniques, 2);
  assert.equal(s.sites.match, undefined);
  assert.ok(!JSON.stringify(s).includes("1.1.1.1"));
});
