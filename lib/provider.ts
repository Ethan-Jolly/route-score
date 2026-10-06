/**
 * Orchestrates a RouteScoreResult from the best available data source.
 *
 * Resolution order for a route/band:
 *   1. Demo mode (no HSP creds): deterministic synthetic data, instant.
 *   2. HSP mode: read the stored hours for the 12 complete months plus the
 *      month in progress from Postgres and assemble the score from them.
 *
 * The site never blocks a page on HSP. The scheduled ingest (scripts/ingest.ts)
 * keeps the curated and looked-up routes filled and fresh; a route nobody has
 * seen before is filled on demand in small, time-boxed steps driven by the
 * client warming UI, each step persisting what it fetched.
 */

import { demoJourneyMins, demoMonthlyMetrics, demoOperators } from "./demo";
import { fetchHspHours, hspConfigured, tocNamesFor } from "./hsp";
import {
  dbConfigured,
  ensureSchema,
  getHourRows,
  getServiceHint,
  getStationHourRows,
  getStationRouteTotals,
  recordLookup,
  upsertHourRows,
  type HourRow,
} from "./db";
import {
  BAND_HOURS,
  STORED_HOURS,
  aggregateMetrics,
  compositeScore,
  gapBetweenTrains,
  last12Months,
  metricsFromCounts,
  monthlyScores,
  trendFor,
  verdictFor,
} from "./score";
import { currentMonth, periodRange, weekdaysBetween } from "./periods";
import { CURATED_ROUTES } from "./routes";
import { stationByCrs } from "./stations";
import type {
  MonthlyMetrics,
  NoServiceResult,
  RouteScoreResult,
  Station,
  TimeBand,
} from "./types";

type Outcome = RouteScoreResult | NoServiceResult | null;

/** One month of a route/band, assembled from its stored hours. */
export interface CachedMonth extends MonthlyMetrics {
  tocCodes: string[];
  /** Timetabled journey minutes summed over `journeyTrains` trains — the
   * hours of the month whose journey times are known (possibly none). */
  journeyMins: number;
  journeyTrains: number;
  /** No direct trains ran in this band that month. */
  noService: boolean;
  source: "hsp" | "demo";
  /** The month in progress: counts run to `throughDate`, not month end. */
  partial: boolean;
  throughDate?: string;
}

/** Progress of filling a route's window from HSP, in stored hours. */
export interface FillProgress {
  done: boolean;
  /** Enough is stored to show a score (possibly a provisional one). */
  ready: boolean;
  /** Complete months stored for the band. */
  months: number;
  cached: number;
  total: number;
  /** The step fetched nothing because calls were too big for its time box;
   * the caller should retry with a smaller `maxSpanMinutes`. */
  stalled: boolean;
}

/** On-demand fills run inside a 60s serverless function, so each step stops
 * starting HSP calls after the deadline and caps any single call's duration. */
const STEP_DEADLINE_MS = 20_000;
const STEP_CALL_TIMEOUT_MS = 28_000;
/** Small calls (~15s) so a step always lands something. */
const STEP_TARGET_SERVICES = 12;
/** A busy route can take most of an hour to fetch in full, so a score is shown
 * as soon as this many of the most recent months are stored — marked
 * provisional — while the rest of the year loads behind it. */
const PROVISIONAL_MONTHS = 3;

/** The periods a score is built from: 12 complete months, then the month in
 * progress once it has at least one day HSP could know about. */
function scoreWindow(): { closed: string[]; periods: string[] } {
  const closed = last12Months();
  const current = currentMonth();
  return {
    closed,
    periods: periodRange(current) ? [...closed, current] : closed,
  };
}

interface RouteState {
  /** Periods whose every band hour is stored. */
  months: Map<string, CachedMonth>;
  /** Hours still to fetch, newest period first. */
  missing: { period: string; hours: number[] }[];
  stored: number;
  needed: number;
  /** The whole year is stored: every complete month except possibly the
   * newest (which the ingest may not have reached just after rollover). */
  full: boolean;
  /** Enough is stored to show a score: the full year, or at least the most
   * recent PROVISIONAL_MONTHS (months are always fetched newest first). */
  ready: boolean;
  /** Complete months stored, out of `closedTotal`. */
  closedStored: number;
  closedTotal: number;
}

async function loadRoute(
  from: Station,
  to: Station,
  band: TimeBand
): Promise<RouteState> {
  const { periods } = scoreWindow();
  return buildState(await getHourRows(from.crs, to.crs, periods), band);
}

/** What one route's stored hours amount to for a band. */
function buildState(storedRows: HourRow[], band: TimeBand): RouteState {
  const { closed, periods } = scoreWindow();
  const hours = BAND_HOURS[band];
  const current = currentMonth();

  const byPeriod = new Map<string, Map<number, HourRow>>();
  for (const row of storedRows) {
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, new Map());
    byPeriod.get(row.period)!.set(row.hour, row);
  }

  const months = new Map<string, CachedMonth>();
  const missing: RouteState["missing"] = [];
  let stored = 0;
  for (const period of periods) {
    const have = byPeriod.get(period) ?? new Map<number, HourRow>();
    const rows = hours.map((h) => have.get(h)).filter((r): r is HourRow => !!r);
    stored += rows.length;
    if (rows.length < hours.length) {
      missing.push({ period, hours: hours.filter((h) => !have.has(h)) });
      continue;
    }
    const trains = rows.reduce((s, r) => s + r.trains, 0);
    const throughDate = rows.reduce(
      (min, r) => (r.throughDate < min ? r.throughDate : min),
      rows[0].throughDate
    );
    const timed = rows.filter((r) => r.journeyMins !== null);
    months.set(period, {
      month: period,
      totalTrains: trains,
      ...metricsFromCounts(
        trains,
        rows.reduce((s, r) => s + r.within5, 0),
        rows.reduce((s, r) => s + r.within30, 0)
      ),
      gapMins: gapBetweenTrains(
        trains,
        weekdaysBetween(`${period}-01`, throughDate),
        hours.length
      ),
      tocCodes: [...new Set(rows.flatMap((r) => r.tocCodes))],
      journeyMins: timed.reduce((s, r) => s + (r.journeyMins ?? 0), 0),
      journeyTrains: timed.reduce((s, r) => s + r.trains, 0),
      noService: trains === 0,
      source: "hsp",
      partial: period === current,
      throughDate,
    });
  }

  const full = closed.slice(0, -1).every((p) => months.has(p));
  const closedStored = closed.filter((p) => months.has(p)).length;
  return {
    months,
    missing: missing.reverse(),
    stored,
    needed: periods.length * hours.length,
    full,
    ready: full || closedStored >= PROVISIONAL_MONTHS,
    closedStored,
    closedTotal: closed.length,
  };
}

/**
 * JSON API read: serves from the DB, running one time-boxed fill step first if
 * the route isn't stored yet. Returns `{ warming }` progress when more steps
 * are needed — call again to continue. Pages use getCachedRouteScore plus the
 * client warming UI instead.
 */
export async function getRouteScore(
  fromCrs: string,
  toCrs: string,
  band: TimeBand
): Promise<Outcome | { warming: FillProgress }> {
  const stations = resolveStations(fromCrs, toCrs);
  if (!stations) return null;
  const { from, to } = stations;

  if (!hspConfigured() || !dbConfigured()) {
    return assemble(from, to, band, demoCache(from.crs, to.crs, band));
  }

  await ensureSchema();
  let state = await loadRoute(from, to, band);
  if (!state.ready) {
    const progress = await fillStep(from, to, band, state);
    state = await loadRoute(from, to, band);
    if (!state.ready) return { warming: progress };
  }
  return assembleState(from, to, band, state) ?? { warming: progressOf(state, false) };
}

/**
 * Advance a cold route by one time-boxed step, persisting each chunk as it
 * lands. This is what the client warming UI drives until `done`.
 */
export async function fillRouteStep(
  fromCrs: string,
  toCrs: string,
  band: TimeBand,
  maxSpanMinutes?: number
): Promise<FillProgress | null> {
  const stations = resolveStations(fromCrs, toCrs);
  if (!stations) return null;
  const { from, to } = stations;

  if (!hspConfigured() || !dbConfigured()) {
    return { done: true, ready: true, months: 12, cached: 12, total: 12, stalled: false };
  }

  await ensureSchema();
  const state = await loadRoute(from, to, band);
  return fillStep(from, to, band, state, maxSpanMinutes);
}

/** Shared core: fetch as many of the route's missing hours as fit in one
 * step, newest period first. */
async function fillStep(
  from: Station,
  to: Station,
  band: TimeBand,
  state: RouteState,
  maxSpanMinutes?: number
): Promise<FillProgress> {
  // Popularity signal: the ingest keeps looked-up routes fresh. Never block on it.
  recordLookup(from.crs, to.crs, band).catch(() => {});

  if (state.missing.length === 0) return progressOf(state, false);

  const deadline = Date.now() + STEP_DEADLINE_MS;
  const hint = await getServiceHint(from.crs, to.crs);
  let landed = 0;
  let timedOut = false;

  // A small pool rather than firing every period at once: queued work must
  // not start after the deadline.
  const queue = [...state.missing];
  const worker = async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      if (Date.now() >= deadline) return;
      const { period, hours } = task;
      const range = periodRange(period);
      if (!range) continue;
      const res = await fetchHspHours(from.crs, to.crs, range, hours, {
        hint,
        targetServices: STEP_TARGET_SERVICES,
        timeoutMs: STEP_CALL_TIMEOUT_MS,
        deadline,
        maxSpanMinutes,
        onChunk: async (rows) => {
          await upsertHourRows(from.crs, to.crs, period, rows, range.to, range.final);
          landed += rows.length;
        },
      });
      if (res.timedOut) timedOut = true;
    }
  };
  const results = await Promise.allSettled([worker(), worker()]);
  // If nothing landed and HSP itself failed (not just "too slow"), surface it.
  const failure = results.find((r) => r.status === "rejected");
  if (landed === 0 && failure && !timedOut) {
    throw (failure as PromiseRejectedResult).reason;
  }

  return progressOf(await loadRoute(from, to, band), landed === 0);
}

function progressOf(state: RouteState, stalled: boolean): FillProgress {
  return {
    done: state.missing.length === 0,
    ready: state.ready,
    months: state.closedStored,
    cached: state.stored,
    total: state.needed,
    stalled,
  };
}

/** Assemble what's stored, or null if it isn't showable yet. A provisional
 * "no service" is not trusted — older months may still have trains. */
function assembleState(
  from: Station,
  to: Station,
  band: TimeBand,
  state: RouteState
): Outcome {
  if (!state.ready) return null;
  const outcome = assemble(
    from,
    to,
    band,
    state.months,
    state.full ? undefined : { months: state.closedStored, total: state.closedTotal }
  );
  if (!state.full && outcome?.noService) return null;
  return outcome;
}

/** DB-only fast path: returns a result only if enough of the route is stored
 * to show (a provisional result carries `coverage`), otherwise null. Never
 * calls HSP. Used by every page. In demo mode this is just the score. */
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
    return assembleState(from, to, band, await loadRoute(from, to, band));
  } catch {
    // A transient DB failure shouldn't 500 the page — degrade to "not cached"
    // (the caller shows the warming UI, which self-heals when the DB recovers).
    return null;
  }
}

/** Every stored route out of and into one station, best score first. */
export interface StationRoutes {
  departures: RouteScoreResult[];
  arrivals: RouteScoreResult[];
}

/**
 * The station page: scores for every route touching a station that has
 * enough stored to show, in one DB read. Never calls HSP — a route appears
 * here once the ingest (or a visitor's lookup) has fetched it. In demo mode
 * the curated routes stand in for "stored".
 */
export async function getStationRoutes(
  crs: string,
  band: TimeBand
): Promise<StationRoutes> {
  const station = stationByCrs(crs);
  if (!station) return { departures: [], arrivals: [] };

  const outcomes: Outcome[] = [];
  if (!hspConfigured()) {
    for (const r of CURATED_ROUTES) {
      if (r.from !== station.crs && r.to !== station.crs) continue;
      const pair = resolveStations(r.from, r.to);
      if (!pair) continue;
      outcomes.push(assemble(pair.from, pair.to, band, demoCache(r.from, r.to, band)));
    }
  } else if (dbConfigured()) {
    try {
      await ensureSchema();
      const { periods } = scoreWindow();
      const byRoute = new Map<string, HourRow[]>();
      for (const row of await getStationHourRows(station.crs, periods, BAND_HOURS[band])) {
        const key = `${row.from}>${row.to}`;
        if (!byRoute.has(key)) byRoute.set(key, []);
        byRoute.get(key)!.push(row);
      }
      for (const [key, rows] of byRoute) {
        const [from, to] = key.split(">");
        const pair = resolveStations(from, to);
        if (!pair) continue;
        outcomes.push(assembleState(pair.from, pair.to, band, buildState(rows, band)));
      }
    } catch {
      // Same as a route page: a transient DB failure shows as "nothing stored".
    }
  }

  const scored = outcomes
    .filter((o): o is RouteScoreResult => o !== null && o.noService === false)
    .sort((a, b) => b.score - a.score || a.to.name.localeCompare(b.to.name));
  return {
    departures: scored.filter((r) => r.from.crs === station.crs),
    arrivals: scored.filter((r) => r.to.crs === station.crs),
  };
}

/** The stations one station is known to have direct trains to and from. */
export interface KnownRoutes {
  destinations: Station[];
  origins: Station[];
}

/** Hours stored with no trains at all before a pair is written off as having
 * no direct service: six months of the stored day. */
const NO_SERVICE_HOURS = 6 * STORED_HOURS.length;

/**
 * The routes we know about at a station, for narrowing the search box: the
 * curated list plus anything stored with trains in it, less the pairs that
 * turned out to have no direct service. Not the whole network — a station
 * can have real routes nobody has looked up yet.
 */
export async function getKnownRoutes(crs: string): Promise<KnownRoutes> {
  const station = stationByCrs(crs);
  if (!station) return { destinations: [], origins: [] };

  const known = new Set<string>();
  for (const r of CURATED_ROUTES) {
    if (r.from === station.crs || r.to === station.crs) known.add(`${r.from}>${r.to}`);
  }
  if (hspConfigured() && dbConfigured()) {
    try {
      await ensureSchema();
      for (const t of await getStationRouteTotals(station.crs)) {
        const key = `${t.from}>${t.to}`;
        if (t.trains > 0) known.add(key);
        else if (t.hours >= NO_SERVICE_HOURS) known.delete(key);
      }
    } catch {
      // The curated list alone is still a useful answer.
    }
  }

  const pairs = [...known].map((key) => key.split(">"));
  const stations = (codes: string[]) =>
    codes
      .map((c) => stationByCrs(c))
      .filter((s): s is Station => !!s)
      .sort((a, b) => a.name.localeCompare(b.name));
  return {
    destinations: stations(pairs.filter((p) => p[0] === station.crs).map((p) => p[1])),
    origins: stations(pairs.filter((p) => p[1] === station.crs).map((p) => p[0])),
  };
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
  const journey = demoJourneyMins(from, to);
  for (const m of demoMonthlyMetrics(from, to, band)) {
    map.set(m.month, {
      ...m,
      tocCodes: [],
      journeyMins: journey * m.totalTrains,
      journeyTrains: m.totalTrains,
      noService: false,
      source: "demo",
      partial: false,
    });
  }
  return map;
}

function assemble(
  from: Station,
  to: Station,
  band: TimeBand,
  months: Map<string, CachedMonth>,
  coverage?: { months: number; total: number }
): Outcome {
  const withService = [...months.values()]
    .filter((m) => !m.noService && m.totalTrains > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (withService.length === 0) {
    return { noService: true, from, to, band };
  }

  // The month in progress always counts toward the score (train-weighted, so
  // a few days barely move it), but only joins the month-by-month series once
  // it has enough trains to be a fair point next to full months.
  const closed = withService.filter((m) => !m.partial);
  const base = closed.length > 0 ? closed : withService;
  const avgTrains = base.reduce((s, m) => s + m.totalTrains, 0) / base.length;
  const series = withService.filter(
    (m) => !m.partial || closed.length === 0 || m.totalTrains >= avgTrains * 0.4
  );

  const source = withService.some((m) => m.source === "hsp") ? "hsp" : "demo";
  const agg = aggregateMetrics(withService);
  const { score, breakdown } = compositeScore(
    agg.onTimePct,
    agg.reliabilityPct,
    agg.avgDelayMins,
    agg.gapMins
  );
  // Timetabled time over whichever trains have it, plus the delay an average
  // train picks up (late trains' average lateness, spread over all trains).
  const timedTrains = withService.reduce((s, m) => s + m.journeyTrains, 0);
  const journeyMins =
    timedTrains > 0
      ? withService.reduce((s, m) => s + m.journeyMins, 0) / timedTrains
      : undefined;
  const expectedMins =
    journeyMins === undefined
      ? undefined
      : journeyMins + ((100 - agg.onTimePct) / 100) * agg.avgDelayMins;
  const scores = monthlyScores(series);
  const byVolume = [...base].sort((a, b) => b.totalTrains - a.totalTrains);
  const weekdaysPerMonth = 21.5;
  const dataThrough = withService
    .map((m) => m.throughDate)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

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
    journeyMins: journeyMins === undefined ? undefined : Math.round(journeyMins),
    expectedMins: expectedMins === undefined ? undefined : Math.round(expectedMins),
    limitedData: avgTrains < 50,
    trend: trendFor(scores),
    monthlyScores: scores,
    monthly: series,
    operators,
    servicesPerDay: Math.max(1, Math.round(avgTrains / weekdaysPerMonth)),
    busiestMonth: byVolume[0].month,
    quietestMonth: byVolume[byVolume.length - 1].month,
    source,
    dataThrough,
    coverage,
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

/** Parses slugs like "BTN-LBG-am-peak" or "BTN-LBG". The band defaults to AM
 * peak, which is also where links to the retired all-day band now land. */
export function parseRouteSlug(
  slug: string
): { from: string; to: string; band: TimeBand } | null {
  const parts = slug.split("-");
  if (parts.length < 2) return null;
  const from = parts[0].toUpperCase();
  const to = parts[1].toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;
  const bandStr = parts.slice(2).join("-").toLowerCase();
  const band: TimeBand =
    bandStr === "" || bandStr === "all-day" ? "am-peak" : (bandStr as TimeBand);
  if (!["am-peak", "pm-peak", "off-peak"].includes(band)) return null;
  return { from, to, band };
}

export function routeSlug(from: string, to: string, band: TimeBand): string {
  return `${from}-${to}-${band}`;
}
