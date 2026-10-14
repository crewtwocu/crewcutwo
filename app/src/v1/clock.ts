/** Overridable clock so timers (auto-accept, refunds, wipe) are testable. */
let offsetMs = 0;
export function nowMs(): number {
  return Date.now() + offsetMs;
}
export function nowIso(): string {
  return new Date(nowMs()).toISOString();
}
export function advanceClock(ms: number): void {
  offsetMs += ms;
}
export function resetClock(): void {
  offsetMs = 0;
}
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
