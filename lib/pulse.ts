/**
 * "Today vs typical": the most recent day (or few days) on a route, and across
 * the network, against its usual.
 *
 * Built from `day_metrics` — what each month-to-date refresh added since the
 * last one (see upsertHourRows). HSP runs about a day behind, so "latest" is
 * normally yesterday. A span covers more than one weekday when a route wasn't
 * refreshed every day; those are shown as a range and kept out of the
 * day-by-day comparison.
 */

import { BAND_HOURS } from "./score";
import { dbConfigured, ensureSchema, getDaySpans, getNetworkDaySpans, type DaySpan } from "./db";
import { hspConfigured } from "./hsp";
import { weekdaysBetween } from "./periods";
import type { TimeBand } from "./types";

export interface Pulse {
  /** "Thu 12 Nov", or "12–13 Nov" for a multi-day span. */
  label: string;
  toDate: string;
  trains: number;
  onTimePct: number;
  /** The usual on-time %, to compare against. */
  typicalPct: number;
  /** Share of recorded single days that were better than this one, when
   * there are enough of them to say. */
  worseThanPct: number | null;
  /** How many single days that comparison is over. */
  days: number;
  verdict: "better" | "worse" | "normal";
  routes?: number;
}

/** Days needed before "worse than X% of days" means anything. */
const MIN_DAYS = 10;
/** How far back to look. The ingest keeps 60 days of day spans. */
const LOOKBACK_DAYS = 60;

const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

export function spanLabel(s: Pick<DaySpan, "fromDate" | "toDate">): string {
  const weekdays = weekdaysBetween(s.fromDate, s.toDate);
  if (weekdays <= 1) {
    // Weekends carry no trains here, so a Sat–Mon span is really Monday.
    return fmt(s.toDate, { weekday: "short", day: "numeric", month: "short" });
  }
  return `${fmt(s.fromDate, { day: "numeric" })}–${fmt(s.toDate, { day: "numeric", month: "short" })}`;
}

/**
 * Pure summary of a list of spans (oldest first). `typical` is the usual
 * on-time %; when omitted, the spans' own average stands in.
 */
export function summarisePulse(spans: DaySpan[], typical?: number): Pulse | null {
  const usable = spans.filter(
    (s) => s.trains > 0 && weekdaysBetween(s.fromDate, s.toDate) >= 1
  );
  if (usable.length === 0) return null;
  const latest = usable[usable.length - 1];
  const onTime = (s: DaySpan) => (100 * s.within5) / s.trains;
  const singles = usable.filter((s) => weekdaysBetween(s.fromDate, s.toDate) === 1);
  const baseline =
    typical ??
    (100 * usable.reduce((s, x) => s + x.within5, 0)) / usable.reduce((s, x) => s + x.trains, 0);
  const latestPct = onTime(latest);
  const isSingle = weekdaysBetween(latest.fromDate, latest.toDate) === 1;
  const worseThan =
    isSingle && singles.length >= MIN_DAYS
      ? Math.round((100 * singles.filter((s) => onTime(s) > latestPct).length) / singles.length)
      : null;
  const diff = latestPct - baseline;
  return {
    label: spanLabel(latest),
    toDate: latest.toDate,
    trains: latest.trains,
    onTimePct: Math.round(latestPct * 10) / 10,
    typicalPct: Math.round(baseline * 10) / 10,
    worseThanPct: worseThan,
    days: singles.length,
    verdict: diff >= 3 ? "better" : diff <= -3 ? "worse" : "normal",
  };
}

const since = () => new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

/** A route's latest day against its usual (its 12-month on-time %). */
export async function getRoutePulse(
  from: string,
  to: string,
  band: TimeBand,
  typicalPct: number
): Promise<Pulse | null> {
  if (!hspConfigured() || !dbConfigured()) return null;
  try {
    await ensureSchema();
    const pulse = summarisePulse(await getDaySpans(from, to, BAND_HOURS[band], since()), typicalPct);
    // Older than a week isn't "latest" any more: the route has stopped being refreshed.
    if (!pulse || Date.now() - Date.parse(pulse.toDate) > 7 * 86_400_000) return null;
    return pulse;
  } catch {
    return null;
  }
}

/** The network's latest single day in a band against its recent days. */
export async function getNetworkPulse(band: TimeBand): Promise<Pulse | null> {
  if (!hspConfigured() || !dbConfigured()) return null;
  try {
    await ensureSchema();
    const spans = (await getNetworkDaySpans(BAND_HOURS[band], since())).filter(
      (s) => weekdaysBetween(s.fromDate, s.toDate) === 1
    );
    const pulse = summarisePulse(spans);
    if (!pulse || Date.now() - Date.parse(pulse.toDate) > 7 * 86_400_000) return null;
    return { ...pulse, routes: spans[spans.length - 1].routes };
  } catch {
    return null;
  }
}
