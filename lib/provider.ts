/**
 * Orchestrates a RouteScoreResult from the best available data source, with a
 * DB read-through cache in front of the (slow, rolling-window) HSP API.
 *
 * Resolution order for a route/band:
 *   1. Demo mode (no HSP creds): deterministic synthetic data, instant.
 *   2. HSP mode: read the 12 needed months from Postgres; fetch whatever is
 *      missing from HSP in parallel; write it back; assemble the score.
 *
 * Because past months never change, a month is fetched from HSP exactly once
 * ever and served from the DB forever after — the first load of a brand-new
 * route is slow (~25s), every subsequent load is instant.
 */

import { demoMonthlyMetrics, demoOperators } from "./demo";
import { fetchHspMonth, hspConfigured, tocNamesFor } from "./hsp";
import {
  dbConfigured,
  ensureSchema,
  getCachedMonths,
  recordLookup,
  upsertMonths,
  type CachedMonth,
} from "./db";
import {
  aggregateMetrics,
  compositeScore,
  last12Months,
  monthlyScores,
  trendFor,
  verdictFor,
} from "./score";
import { stationByCrs } from "./stations";
import type {
  NoServiceResult,
  RouteScoreResult,
  Station,
  TimeBand,
} from "./types";

type Outcome = RouteScoreResult | NoServiceResult | null;

/**
 * HSP accepts only ~4 simultaneous requests per account (extras 503 instantly),
 * and each takes ~20s. So missing months are fetched in small concurrent waves
 * rather than all at once, and each wave is written to the DB as it lands —
 * meaning partial progress survives even if the request is cut short, and a
 * later call simply resumes.
 */
const HSP_CONCURRENCY = 3;

/** Progress of filling a route's 12-month window from HSP. */
export interface FillProgress {
  done: boolean;
  cached: number;
  total: number;
}

/** Full read-through: serves from DB, fetching every missing month from HSP in
 * waves. May take up to ~90s the first time a route is seen (resumable across
 * calls); instant thereafter. Used by the JSON API. Pages use the progressive
 * fast-path (getCachedRouteScore) + client warming instead. */
export async function getRouteScore(
  fromCrs: string,
  toCrs: string,
  band: TimeBand
): Promise<Outcome> {
  const stations = resolveStations(fromCrs, toCrs);
  if (!stations) return null;
  const { from, to } = stations;

  if (!hspConfigured()) {
    return assemble(from, to, band, demoCache(from.crs, to.crs, band));
  }

  const cached = await fillFromHsp(from, to, band, Infinity);
  return assemble(from, to, band, cached);
}

/**
 * Fetch up to `maxWaves` waves of missing months for a route, persisting each
 * wave. Returns how many of the 12 months are now cached. This is what the
 * client warming UI drives, a couple of waves at a time, to stay well under
 * the serverless timeout.
 */
export async function fillRouteStep(
  fromCrs: string,
  toCrs: string,
  band: TimeBand,
  maxWaves = 2
): Promise<FillProgress | null> {
  const stations = resolveStations(fromCrs, toCrs);
  if (!stations) return null;
  const { from, to } = stations;

  if (!hspConfigured()) {
    return { done: true, cached: 12, total: 12 };
  }

  const cached = await fillFromHsp(from, to, band, maxWaves);
  const total = last12Months().length;
  return { done: cached.size >= total, cached: cached.size, total };
}

/** Shared core: read cache, fetch missing months from HSP in concurrency-
 * limited waves (persisting each), return the assembled month map. */
async function fillFromHsp(
  from: Station,
  to: Station,
  band: TimeBand,
  maxWaves: number
): Promise<Map<string, CachedMonth>> {
  const months = last12Months();
  let cached = new Map<string, CachedMonth>();
  if (dbConfigured()) {
    await ensureSchema();
    cached = await getCachedMonths(from.crs, to.crs, band, months);
  }

  const missing = months.filter((m) => !cached.has(m));
  let waves = 0;
  for (let i = 0; i < missing.length && waves < maxWaves; i += HSP_CONCURRENCY) {
    const wave = missing.slice(i, i + HSP_CONCURRENCY);
    const fetched = await Promise.all(
      wave.map((m) => fetchHspMonth(from.crs, to.crs, band, m))
    );
    const rows: CachedMonth[] = fetched.map((f) => ({ ...f, source: "hsp" }));
    if (dbConfigured()) await upsertMonths(from.crs, to.crs, band, rows);
    for (const r of rows) cached.set(r.month, r);
    waves++;
  }

  if (dbConfigured()) {
    // Popularity signal for cron pre-warming; never block on it.
    recordLookup(from.crs, to.crs, band).catch(() => {});
  }
  return cached;
}

/** DB-only fast path: returns a result only if all 12 months are already
 * cached, otherwise null. Never calls HSP. Used where a slow cold fetch would
 * be unacceptable (homepage examples). In demo mode this is just the score. */
export async function getCachedRouteScore(
  fromCrs: string,
  toCrs: string,
  band: TimeBand
): Promise<Outcome> {
  const stations = resolveStations(fromCrs, toCrs);
  if (!stations) return null;
  const { from, to } = stations;

  if (!hspConfigured()) {
    return assemble(from, to, band, demoCache(from.crs, to.crs, band));
  }
  if (!dbConfigured()) return null;

  try {
    await ensureSchema();
    const months = last12Months();
    const cached = await getCachedMonths(from.crs, to.crs, band, months);
    if (months.some((m) => !cached.has(m))) return null;
    return assemble(from, to, band, cached);
  } catch {
    // A transient DB failure shouldn't 500 the page — degrade to "not cached"
    // (the caller shows the warming UI, which self-heals when the DB recovers).
    return null;
  }
}

function resolveStations(
  fromCrs: string,
  toCrs: string
): { from: Station; to: Station } | null {
  const from = stationByCrs(fromCrs);
  const to = stationByCrs(toCrs);
  if (!from || !to || from.crs === to.crs) return null;
  return { from, to };
}

function demoCache(
  from: string,
  to: string,
  band: TimeBand
): Map<string, CachedMonth> {
  const map = new Map<string, CachedMonth>();
  for (const m of demoMonthlyMetrics(from, to, band)) {
    map.set(m.month, { ...m, tocCodes: [], noService: false, source: "demo" });
  }
  return map;
}

function assemble(
  from: Station,
  to: Station,
  band: TimeBand,
  cached: Map<string, CachedMonth>
): Outcome {
  const months = last12Months();
  const ordered = months
    .map((m) => cached.get(m))
    .filter((m): m is CachedMonth => Boolean(m));

  const withService = ordered.filter((m) => !m.noService && m.totalTrains > 0);
  if (withService.length === 0) {
    return { noService: true, from, to, band };
  }

  const source = withService.some((m) => m.source === "hsp") ? "hsp" : "demo";
  const agg = aggregateMetrics(withService);
  const { score, breakdown } = compositeScore(
    agg.onTimePct,
    agg.reliabilityPct,
    agg.avgDelayMins
  );
  const scores = monthlyScores(withService);
  const byVolume = [...withService].sort((a, b) => b.totalTrains - a.totalTrains);
  const weekdaysPerMonth = 21.5;

  const operators = operatorsFor(from, to, withService);

  return {
    noService: false,
    from,
    to,
    band,
    score,
    verdict: verdictFor(score),
    breakdown,
    ...agg,
    limitedData: agg.totalTrains / withService.length < 50,
    trend: trendFor(scores),
    monthlyScores: scores,
    monthly: withService,
    operators,
    servicesPerDay: Math.max(
      1,
      Math.round(agg.totalTrains / withService.length / weekdaysPerMonth)
    ),
    busiestMonth: byVolume[0].month,
    quietestMonth: byVolume[byVolume.length - 1].month,
    source,
  };
}

/** Prefer real operators derived from HSP TOC codes; fall back to the
 * geographic heuristic (demo mode, or unmapped TOC codes). */
function operatorsFor(
  from: Station,
  to: Station,
  months: CachedMonth[]
): string[] {
  const codes = new Set<string>();
  for (const m of months) for (const c of m.tocCodes) codes.add(c);
  const named = tocNamesFor([...codes]);
  if (named.length > 0) return named.slice(0, 3);
  return demoOperators(from.crs, to.crs);
}

/** Parses slugs like "BTN-LBG-am-peak" or "BTN-LBG" (band defaults to all-day). */
export function parseRouteSlug(
  slug: string
): { from: string; to: string; band: TimeBand } | null {
  const parts = slug.split("-");
  if (parts.length < 2) return null;
  const from = parts[0].toUpperCase();
  const to = parts[1].toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const bandStr = parts.slice(2).join("-").toLowerCase();
  const band: TimeBand = bandStr === "" ? "all-day" : (bandStr as TimeBand);
  if (!["am-peak", "pm-peak", "off-peak", "all-day"].includes(band)) return null;
  return { from, to, band };
}

export function routeSlug(from: string, to: string, band: TimeBand): string {
  return `${from}-${to}-${band}`;
}
