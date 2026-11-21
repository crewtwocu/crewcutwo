/**
 * Time zone helpers for the agent API. Label-only: nothing here touches payments or wallets.
 */

/** Validate an IANA time zone name. Returns the canonical name, or null if invalid. */
export function normaliseTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(s)) return null;
  try {
    const tz = new Intl.DateTimeFormat("en-US", { timeZone: s }).resolvedOptions().timeZone;
    if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
    const known = new Set(Intl.supportedValuesOf("timeZone"));
    // Accept canonical zones and well-known aliases Intl resolves (e.g. Asia/Calcutta -> Asia/Kolkata).
    return known.has(tz) || known.has(s) ? tz : null;
  } catch {
    return null;
  }
}

function offsetString(minutes: number): string {
  if (minutes === 0) return "Z";
  const sign = minutes > 0 ? "+" : "-";
  const m = Math.abs(minutes);
  return `${sign}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Wall-clock parts of an instant in a zone, plus the zone's UTC offset in minutes at that instant. */
function zoneParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  const offsetMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  return { p, offsetMin };
}

/** ISO 8601 local time with offset, e.g. 2026-11-21T14:00:00+10:30. */
export function toZonedIso(date: Date, timeZone: string): string {
  const { p, offsetMin } = zoneParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offsetString(offsetMin)}`;
}

export type DualTime = { utc: string; local: string; timezone: string };

/** A timestamp shown in both UTC and the resolved zone. */
export function dualTime(iso: string | null | undefined, timeZone: string): DualTime | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { utc: d.toISOString(), local: toZonedIso(d, timeZone), timezone: timeZone };
}
