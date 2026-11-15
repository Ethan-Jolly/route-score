/**
 * The route page's finer-grained views, beyond the headline score:
 *
 * - **Hours**: punctuality for every departure hour 06:00–18:59, from
 *   `hourly_metrics` (stored for every route since launch) — "which train
 *   should I catch?".
 * - **Services**: each timetabled train in the band ("the 07:42"), from
 *   `service_metrics`, which fills as hours are fetched or backfilled.
 * - **Lateness**: how late the late trains are in 15/30/60-minute steps —
 *   what Delay Repay pays on — from the finer buckets, same caveat.
 *
 * Everything is read over the same window as the score. Demo mode makes up
 * plausible figures from the route's seed so the page is viewable locally.
 */

import { BAND_HOURS, STORED_HOURS, latenessBuckets } from "./score";
import { dbConfigured, ensureSchema, getHourRows, getServiceRows, type HourRow } from "./db";
import { hspConfigured, tocNamesFor } from "./hsp";
import { demoMonthlyMetrics } from "./demo";
import { weekdaysBetween } from "./periods";
import { fineCounts, scoreWindow } from "./provider";
import type { TimeBand } from "./types";

export interface HourStat {
  hour: number;
  trains: number;
  /** Trains per weekday departing in this hour. */
  perDay: number;
  onTimePct: number;
  /** % 15+ minutes late (or cancelled); null until the finer buckets exist. */
  late15Pct: number | null;
}

export interface ServiceStat {
  /** Scheduled departure, "HH:MM". */
  dep: string;
  /** Usual scheduled arrival, "HH:MM", or "" if unknown. */
  arr: string;
  journeyMins: number | null;
  operator: string;
  /** Runs counted. */
  trains: number;
  onTimePct: number;
  late15Pct: number;
}

/** Share of trains in each lateness band, in %. */
export interface Lateness {
  trains: number;
  /** Months of the window these figures cover. */
  months: number;
  onTime: number;
  late5to15: number;
  late15to30: number;
  late30to60: number;
  /** Includes cancellations, which HSP counts as never arriving on time. */
  late60: number;
}

export interface RouteDetail {
  hours: HourStat[];
  services: ServiceStat[];
  /** Months the service list covers. */
  serviceMonths: number;
  /** Band hours with at least one service stored, and the band hours that
   * have trains at all: fewer of the first means the list is still filling. */
  serviceHours: number[];
  bandHoursWithTrains: number[];
  lateness: Lateness | null;
  source: "hsp" | "demo";
}

/** A service needs this many runs to be listed — fewer is a one-off
 * (a diversion, a short-lived timetable) rather than "your train". */
const MIN_SERVICE_RUNS = 8;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const hhmm = (t: string) => (t ? `${t.slice(0, 2)}:${t.slice(2)}` : "");

export async function getRouteDetail(
  from: string,
  to: string,
  band: TimeBand
): Promise<RouteDetail | null> {
  if (!hspConfigured()) return demoDetail(from, to, band);
  if (!dbConfigured()) return null;
  try {
    await ensureSchema();
    const { periods } = scoreWindow();
    const [hourRows, serviceRows] = await Promise.all([
      getHourRows(from, to, periods),
      getServiceRows(from, to, periods, BAND_HOURS[band]),
    ]);
    return {
      hours: hourStats(hourRows),
      ...serviceStats(serviceRows),
      bandHoursWithTrains: BAND_HOURS[band].filter((h) =>
        hourRows.some((r) => r.hour === h && r.trains > 0)
      ),
      lateness: lateness(hourRows, BAND_HOURS[band]),
      source: "hsp",
    };
  } catch {
    // Extra detail is never worth failing the page over.
    return null;
  }
}

function hourStats(rows: HourRow[]): HourStat[] {
  const out: HourStat[] = [];
  for (const hour of STORED_HOURS) {
    const hr = rows.filter((r) => r.hour === hour);
    const trains = hr.reduce((s, r) => s + r.trains, 0);
    if (trains === 0) continue;
    const weekdays = hr.reduce(
      (s, r) => s + weekdaysBetween(`${r.period}-01`, r.throughDate),
      0
    );
    const fine = hr.filter((r) => r.within15 !== null);
    const fineTrains = fine.reduce((s, r) => s + r.trains, 0);
    out.push({
      hour,
      trains,
      perDay: weekdays > 0 ? Math.round((trains / weekdays) * 10) / 10 : 0,
      onTimePct: pct(hr.reduce((s, r) => s + r.within5, 0), trains),
      // Only from months that have it, and only once there's a fair sample.
      late15Pct:
        fineTrains >= 40
          ? pct(fineTrains - fine.reduce((s, r) => s + (r.within15 ?? 0), 0), fineTrains)
          : null,
    });
  }
  return out;
}

function serviceStats(rows: Awaited<ReturnType<typeof getServiceRows>>) {
  const byDep = new Map<
    string,
    { trains: number; within5: number; within15: number; arrs: Map<string, number>; tocs: Map<string, number> }
  >();
  for (const r of rows) {
    const s = byDep.get(r.dep) ?? {
      trains: 0,
      within5: 0,
      within15: 0,
      arrs: new Map(),
      tocs: new Map(),
    };
    s.trains += r.trains;
    s.within5 += r.within5;
    s.within15 += r.within15;
    if (r.arr) s.arrs.set(r.arr, (s.arrs.get(r.arr) ?? 0) + r.trains);
    s.tocs.set(r.toc, (s.tocs.get(r.toc) ?? 0) + r.trains);
    byDep.set(r.dep, s);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const services: ServiceStat[] = [...byDep.entries()]
    .filter(([, s]) => s.trains >= MIN_SERVICE_RUNS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dep, s]) => {
      const arr = top(s.arrs);
      const toc = top(s.tocs);
      return {
        dep: hhmm(dep),
        arr: hhmm(arr),
        journeyMins: arr ? journey(dep, arr) : null,
        operator: tocNamesFor([toc])[0] ?? toc,
        trains: s.trains,
        onTimePct: pct(s.within5, s.trains),
        late15Pct: pct(s.trains - s.within15, s.trains),
      };
    });
  return {
    services,
    serviceMonths: new Set(rows.map((r) => r.period)).size,
    serviceHours: [...new Set(rows.map((r) => r.hour))].sort((a, b) => a - b),
  };
}

function journey(dep: string, arr: string): number | null {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2));
  const d = (mins(arr) - mins(dep) + 1440) % 1440;
  return d > 0 ? d : null;
}

/** Lateness over the months whose every band hour has the finer buckets. */
function lateness(rows: HourRow[], hours: number[]): Lateness | null {
  const byPeriod = new Map<string, HourRow[]>();
  for (const r of rows) {
    if (!hours.includes(r.hour)) continue;
    byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  }
  let trains = 0;
  let within5 = 0;
  let within30 = 0;
  const fine = { within10: 0, within15: 0, within60: 0 };
  let months = 0;
  for (const monthRows of byPeriod.values()) {
    if (monthRows.length < hours.length) continue;
    const f = fineCounts(monthRows);
    if (!f) continue;
    const t = monthRows.reduce((s, r) => s + r.trains, 0);
    if (t === 0) continue;
    months++;
    trains += t;
    within5 += monthRows.reduce((s, r) => s + r.within5, 0);
    within30 += monthRows.reduce((s, r) => s + r.within30, 0);
    fine.within10 += f.within10;
    fine.within15 += f.within15;
    fine.within60 += f.within60;
  }
  if (trains === 0) return null;
  const b = latenessBuckets(trains, within5, within30, fine);
  return {
    trains,
    months,
    onTime: pct(within5, trains),
    late5to15: pct(b.late5to10 + b.late10to15, trains),
    late15to30: pct(b.late15to30, trains),
    late30to60: pct(b.late30to60, trains),
    late60: pct(b.late60, trains),
  };
}

// ---- Demo ---------------------------------------------------------------------

/** Deterministic 0–1 from a string, for demo texture. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function demoDetail(from: string, to: string, band: TimeBand): RouteDetail {
  const months = demoMonthlyMetrics(from, to, band);
  const trains = months.reduce((s, m) => s + m.totalTrains, 0);
  const onTime = months.reduce((s, m) => s + m.onTimePct * m.totalTrains, 0) / trains;
  const reliable = months.reduce((s, m) => s + m.reliabilityPct * m.totalTrains, 0) / trains;

  // Peaks are worse, the shoulder hours either side of them best.
  const hourPenalty: Record<number, number> = { 7: 6, 8: 9, 16: 3, 17: 8, 18: 5 };
  const base = onTime + 4;
  const hours: HourStat[] = STORED_HOURS.map((hour) => {
    const perDay = Math.round((2 + hash01(`${from}${to}${hour}n`) * 4 + (hourPenalty[hour] ? 2 : 0)) * 10) / 10;
    const ot = Math.max(30, Math.min(99, base - (hourPenalty[hour] ?? 0) + (hash01(`${from}${to}${hour}`) - 0.5) * 8));
    return {
      hour,
      trains: Math.round(perDay * 250),
      perDay,
      onTimePct: Math.round(ot * 10) / 10,
      late15Pct: Math.round(((100 - ot) * 0.35) * 10) / 10,
    };
  });

  const services: ServiceStat[] = [];
  for (const hour of BAND_HOURS[band]) {
    const n = 2 + Math.floor(hash01(`${from}${to}${hour}s`) * 3);
    for (let i = 0; i < n; i++) {
      const minute = Math.floor((60 / n) * i + hash01(`${from}${to}${hour}${i}m`) * (60 / n - 1));
      const dep = `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
      const j = 25 + Math.round(hash01(`${from}${to}j`) * 60);
      const arrM = hour * 60 + minute + j;
      const arr = `${String(Math.floor(arrM / 60) % 24).padStart(2, "0")}${String(arrM % 60).padStart(2, "0")}`;
      const ot = Math.max(30, Math.min(99, onTime + (hash01(`${from}${to}${dep}`) - 0.5) * 30));
      services.push({
        dep: hhmm(dep),
        arr: hhmm(arr),
        journeyMins: j,
        operator: "Demo Rail",
        trains: 240,
        onTimePct: Math.round(ot * 10) / 10,
        late15Pct: Math.round((100 - ot) * 0.35 * 10) / 10,
      });
    }
  }

  const late = 100 - onTime;
  const over30 = 100 - reliable;
  return {
    hours,
    services,
    serviceMonths: 12,
    serviceHours: BAND_HOURS[band],
    bandHoursWithTrains: BAND_HOURS[band],
    lateness: {
      trains,
      months: 12,
      onTime: Math.round(onTime * 10) / 10,
      late5to15: Math.round((late - over30) * 0.65 * 10) / 10,
      late15to30: Math.round((late - over30) * 0.35 * 10) / 10,
      late30to60: Math.round(over30 * 0.6 * 10) / 10,
      late60: Math.round(over30 * 0.4 * 10) / 10,
    },
    source: "demo",
  };
}
