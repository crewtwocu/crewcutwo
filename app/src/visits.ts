/**
 * Privacy-friendly visitor counter for the marketing site and the match app.
 *
 * - No cookies, no third-party scripts, no raw IPs stored or logged.
 * - "Unique visitors" = distinct HMAC(STATS_KEY, day | ip | user-agent) per site per day.
 *   Hashes for past days are deleted; only daily totals are kept.
 * - Paths are reduced to their first segment (e.g. /m/abc123 -> /m) so no match IDs are stored.
 * - Each counted hit is also written as one JSON line to stdout ("event":"visit"), so totals
 *   can be rebuilt from logs if the SQLite file is lost (free plan has no persistent disk).
 * - GET /stats?key=STATS_KEY returns JSON totals; disabled (503) if STATS_KEY is unset.
 */
import type express from "express";
import crypto from "node:crypto";
import { db } from "./db.js";

const SITES = new Set(["marketing", "match", "test"]);
const MARKETING_ORIGINS = new Set([
  "https://crewcutwo-marketing.onrender.com",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
]);
const BOT_UA = /bot|crawl|spider|preview|slurp|facebookexternalhit|embedly|headlesschrome|render|uptime|monitor|curl|wget|python-requests|httpclient/i;

db.exec(`
  CREATE TABLE IF NOT EXISTS visit_daily (
    day TEXT NOT NULL,
    site TEXT NOT NULL,
    path TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, site, path)
  );
  CREATE TABLE IF NOT EXISTS visit_uniques (
    day TEXT NOT NULL,
    site TEXT NOT NULL,
    uniques INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, site)
  );
  CREATE TABLE IF NOT EXISTS visit_seen (
    day TEXT NOT NULL,
    site TEXT NOT NULL,
    vhash TEXT NOT NULL,
    PRIMARY KEY (day, site, vhash)
  );
`);

const insView = db.prepare(
  `INSERT INTO visit_daily (day, site, path, views) VALUES (?, ?, ?, 1)
   ON CONFLICT(day, site, path) DO UPDATE SET views = views + 1`
);
const insSeen = db.prepare(`INSERT OR IGNORE INTO visit_seen (day, site, vhash) VALUES (?, ?, ?)`);
const incUnique = db.prepare(
  `INSERT INTO visit_uniques (day, site, uniques) VALUES (?, ?, 1)
   ON CONFLICT(day, site) DO UPDATE SET uniques = uniques + 1`
);
const pruneSeen = db.prepare(`DELETE FROM visit_seen WHERE day < ?`);

function statsKey(): string {
  return (process.env.STATS_KEY || "").trim();
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function normalisePath(raw: unknown): string {
  let p = typeof raw === "string" ? raw : "/";
  p = p.split(/[?#]/)[0] || "/";
  const first = p.split("/").filter(Boolean)[0];
  if (!first) return "/";
  const seg = first.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  return seg ? `/${seg}` : "/";
}

function clientIp(req: express.Request): string {
  const xf = req.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Light per-visitor flood guard (in-memory). */
const recent = new Map<string, number[]>();
function flooded(vhash: string): boolean {
  const now = Date.now();
  const arr = (recent.get(vhash) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  recent.set(vhash, arr);
  if (recent.size > 5000) recent.clear();
  return arr.length > 30;
}

let lastPruneDay = "";

export function recordVisit(input: { site: string; path: string; ip: string; ua: string; now?: Date }):
  | { counted: true; newVisitor: boolean }
  | { counted: false; reason: string } {
  const { site, ip, ua } = input;
  if (!SITES.has(site)) return { counted: false, reason: "bad_site" };
  if (!ua || BOT_UA.test(ua)) return { counted: false, reason: "bot" };
  const day = utcDay(input.now);
  const path = normalisePath(input.path);
  const salt = statsKey() || "crew-visits-unsalted";
  const vhash = crypto.createHmac("sha256", salt).update(`${day}|${ip}|${ua}`).digest("hex").slice(0, 32);
  if (flooded(vhash)) return { counted: false, reason: "rate_limited" };

  let newVisitor = false;
  db.transaction(() => {
    insView.run(day, site, path);
    if (insSeen.run(day, site, vhash).changes > 0) {
      incUnique.run(day, site);
      newVisitor = true;
    }
    if (lastPruneDay !== day) {
      pruneSeen.run(day);
      lastPruneDay = day;
    }
  })();
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "visit", site, path, day, new_visitor: newVisitor }));
  return { counted: true, newVisitor };
}

export function visitStats() {
  const views = db
    .prepare(`SELECT day, site, path, views FROM visit_daily ORDER BY day DESC, site, views DESC`)
    .all() as { day: string; site: string; path: string; views: number }[];
  const uniques = db.prepare(`SELECT day, site, uniques FROM visit_uniques`).all() as {
    day: string;
    site: string;
    uniques: number;
  }[];
  const sites: Record<string, { views: number; uniques_sum_of_days: number; days: Record<string, { views: number; uniques: number; paths: Record<string, number> }> }> = {};
  const ensure = (site: string, day: string) => {
    sites[site] ??= { views: 0, uniques_sum_of_days: 0, days: {} };
    sites[site].days[day] ??= { views: 0, uniques: 0, paths: {} };
    return sites[site].days[day];
  };
  for (const r of views) {
    const d = ensure(r.site, r.day);
    d.views += r.views;
    d.paths[r.path] = r.views;
    sites[r.site]!.views += r.views;
  }
  for (const r of uniques) {
    ensure(r.site, r.day).uniques = r.uniques;
    sites[r.site]!.uniques_sum_of_days += r.uniques;
  }
  return {
    generated_at: new Date().toISOString(),
    note: "Days are UTC. Uniques are per site per day (salted daily hash, no cookies, no IPs stored). Counts live in SQLite on the free plan with no disk, so they reset on restart or redeploy; every hit is also logged to stdout as event=visit.",
    sites,
  };
}

export function mountVisits(app: express.Express): void {
  const hit = (req: express.Request, res: express.Response) => {
    const origin = req.get("origin");
    if (origin && MARKETING_ORIGINS.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Cache-Control", "no-store");
    const site = String(req.query.site || "");
    const isTest = req.query.test === "1";
    recordVisit({
      site: isTest ? "test" : site,
      path: String(req.query.path || "/"),
      ip: clientIp(req),
      ua: req.get("user-agent") || "",
    });
    res.status(204).end();
  };
  app.options("/hit", (req, res) => {
    const origin = req.get("origin");
    if (origin && MARKETING_ORIGINS.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Methods", "GET, POST");
      res.set("Vary", "Origin");
    }
    res.status(204).end();
  });
  app.get("/hit", hit);
  app.post("/hit", hit);

  app.get("/stats", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex");
    const key = statsKey();
    if (!key) return res.status(503).json({ error: "stats_disabled", message: "STATS_KEY not configured" });
    const given = String(req.query.key || "");
    const a = Buffer.from(given);
    const b = Buffer.from(key);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "unauthorized" });
    res.json(visitStats());
  });
}

/** Inline beacon for match-app pages (same origin, no cookies). */
export const matchBeaconScript = `<script>(function(){try{var u="/hit?site=match&path="+encodeURIComponent(location.pathname);if(navigator.sendBeacon){navigator.sendBeacon(u)}else{fetch(u,{method:"POST",keepalive:true})}}catch(e){}})();</script>`;
