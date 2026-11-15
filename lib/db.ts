/**
 * Neon Postgres data layer.
 *
 * This is the permanent store for route performance. HSP only holds ~1 year
 * and is slow, so everything fetched is written here and served from here —
 * which also lets the app accumulate history beyond HSP's rolling window.
 *
 * Performance is stored as raw counts per route, month and departure hour
 * (`hourly_metrics`). Any time band is a sum over its hours, so one fetch
 * serves all bands, and partial progress on a busy route is never lost.
 *
 * Activated by DATABASE_URL. Without it, the app runs in demo mode.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { TimeBand } from "./types";
import type { HourCounts } from "./hsp";

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let _sql: NeonQueryFunction<false, false> | null = null;
function db(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

/** Retry transient network failures (Neon is reached over HTTP, so a flaky
 * connection surfaces as "fetch failed"/connect-timeout rather than a SQL
 * error). Real SQL errors are not retried. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      const transient = /fetch failed|timeout|ECONN|socket|network/i.test(msg);
      if (!transient || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/** One stored hour of a route-month. */
export interface HourRow extends HourCounts {
  period: string;
  /** Last date the counts cover (YYYY-MM-DD). */
  throughDate: string;
  /** True once fetched after the month had ended — never needs refreshing. */
  final: boolean;
}

// Run schema creation at most once per process.
let _schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!_schemaReady) _schemaReady = createSchema();
  return _schemaReady;
}

async function createSchema(): Promise<void> {
  const sql = db();
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS hourly_metrics (
      from_crs     TEXT     NOT NULL,
      to_crs       TEXT     NOT NULL,
      period       TEXT     NOT NULL,
      hour         SMALLINT NOT NULL,
      trains       INTEGER  NOT NULL DEFAULT 0,
      within5      INTEGER  NOT NULL DEFAULT 0,
      within30     INTEGER  NOT NULL DEFAULT 0,
      services     INTEGER  NOT NULL DEFAULT 0,
      toc_codes    TEXT     NOT NULL DEFAULT '',
      through_date TEXT     NOT NULL,
      final        BOOLEAN  NOT NULL DEFAULT FALSE,
      fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_crs, to_crs, period, hour)
    )
  `);
  // Added after launch; hours stored before then stay NULL until refetched.
  await withRetry(() => sql`
    ALTER TABLE hourly_metrics ADD COLUMN IF NOT EXISTS journey_mins INTEGER
  `);
  // Finer punctuality thresholds, added November 2026. NULL on hours stored
  // before then until the ingest's detail backfill refetches them.
  await withRetry(() => sql`
    ALTER TABLE hourly_metrics
      ADD COLUMN IF NOT EXISTS within1  INTEGER,
      ADD COLUMN IF NOT EXISTS within10 INTEGER,
      ADD COLUMN IF NOT EXISTS within15 INTEGER,
      ADD COLUMN IF NOT EXISTS within60 INTEGER
  `);
  // Each timetabled service behind an hour, so a route can be broken down to
  // "the 07:42". Stored packed, one row per route-month: `services` maps each hour to its
  // services as [dep, arr, toc, trains, within1, within5, within10, within15,
  // within30, within60]. A row per service would run to millions of rows
  // across every station's route; this is tens of thousands. Refetching an
  // hour replaces just that hour's entry.
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS service_months (
      from_crs TEXT  NOT NULL,
      to_crs   TEXT  NOT NULL,
      period   TEXT  NOT NULL,
      services JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (from_crs, to_crs, period)
    )
  `);
  // Day-level counts for free: when a month-to-date hour is refreshed, what
  // it gained since the last snapshot is the trains of the days in between.
  // A span is as long as the gap between refreshes (usually one day).
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS day_metrics (
      from_crs  TEXT     NOT NULL,
      to_crs    TEXT     NOT NULL,
      hour      SMALLINT NOT NULL,
      from_date DATE     NOT NULL,
      to_date   DATE     NOT NULL,
      trains    INTEGER  NOT NULL,
      within5   INTEGER  NOT NULL,
      within15  INTEGER,
      within30  INTEGER  NOT NULL,
      PRIMARY KEY (from_crs, to_crs, hour, to_date)
    )
  `);
  await withRetry(() => sql`
    CREATE INDEX IF NOT EXISTS day_metrics_to_date ON day_metrics (to_date)
  `);
  // Small switches the ingest flips for the site (e.g. fine_delay).
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS route_lookups (
      from_crs  TEXT NOT NULL,
      to_crs    TEXT NOT NULL,
      band      TEXT NOT NULL,
      lookups   INTEGER NOT NULL DEFAULT 0,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_crs, to_crs, band)
    )
  `);
  // TfL line status, polled every couple of minutes and counted per line,
  // London day and hour, so a missed poll just means fewer samples.
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS tfl_line_hours (
      line    TEXT     NOT NULL,
      day     DATE     NOT NULL,
      hour    SMALLINT NOT NULL,
      samples INTEGER  NOT NULL DEFAULT 0,
      good    INTEGER  NOT NULL DEFAULT 0,
      minor   INTEGER  NOT NULL DEFAULT 0,
      severe  INTEGER  NOT NULL DEFAULT 0,
      closed  INTEGER  NOT NULL DEFAULT 0,
      PRIMARY KEY (line, day, hour)
    )
  `);
  // Planned Tube legs, so the journey planner isn't asked on every page view.
  await withRetry(() => sql`
    CREATE TABLE IF NOT EXISTS tfl_journeys (
      key        TEXT  NOT NULL PRIMARY KEY,
      data       JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

const nullableNumber = (v: unknown): number | null => (v == null ? null : Number(v));

function rowToHour(r: Record<string, unknown>): HourRow {
  return {
    period: r.period as string,
    hour: Number(r.hour),
    trains: Number(r.trains),
    within1: nullableNumber(r.within1),
    within5: Number(r.within5),
    within10: nullableNumber(r.within10),
    within15: nullableNumber(r.within15),
    within30: Number(r.within30),
    within60: nullableNumber(r.within60),
    services: Number(r.services),
    tocCodes: (r.toc_codes as string) ? (r.toc_codes as string).split(",") : [],
    journeyMins: r.journey_mins == null ? null : Number(r.journey_mins),
    throughDate: r.through_date as string,
    final: Boolean(r.final),
  };
}

/** Every stored hour of a route for the given periods. */
export async function getHourRows(
  from: string,
  to: string,
  periods: string[]
): Promise<HourRow[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT * FROM hourly_metrics
      WHERE from_crs = ${from} AND to_crs = ${to} AND period = ANY(${periods})
    `
  )) as Record<string, unknown>[];
  return rows.map(rowToHour);
}

/** A stored hour together with the route it belongs to. */
export interface StationHourRow extends HourRow {
  from: string;
  to: string;
}

/** Stored hours of every route starting or ending at a station, for the
 * given periods and hours — the whole station page in one query. */
export async function getStationHourRows(
  crs: string,
  periods: string[],
  hours: number[]
): Promise<StationHourRow[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT * FROM hourly_metrics
      WHERE (from_crs = ${crs} OR to_crs = ${crs})
        AND period = ANY(${periods}) AND hour = ANY(${hours})
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...rowToHour(r),
    from: r.from_crs as string,
    to: r.to_crs as string,
  }));
}

/** How much is stored for one route, across every period and hour. */
export interface RouteTotal {
  from: string;
  to: string;
  hours: number;
  trains: number;
}

/** Totals for every stored route starting or ending at a station. */
export async function getStationRouteTotals(crs: string): Promise<RouteTotal[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs, COUNT(*)::int AS hours, SUM(trains)::int AS trains
      FROM hourly_metrics
      WHERE from_crs = ${crs} OR to_crs = ${crs}
      GROUP BY from_crs, to_crs
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    from: r.from_crs as string,
    to: r.to_crs as string,
    hours: Number(r.hours),
    trains: Number(r.trains),
  }));
}

/** Longest gap between two snapshots of a month that is still recorded as a
 * day span; anything longer is a first fetch or a long outage, not "a day". */
const MAX_DAY_SPAN = 7;

/**
 * Write (or replace) hours of one route-month, in one transaction:
 *   1. the trains each hour gained since its last snapshot go to day_metrics
 *      (read before step 2 overwrites the snapshot);
 *   2. the hours themselves are upserted;
 *   3. their services, when the rows carry them, replace the stored ones.
 */
export async function upsertHourRows(
  from: string,
  to: string,
  period: string,
  rows: HourCounts[],
  throughDate: string,
  final: boolean,
  opts: { dayMetrics?: boolean } = {}
): Promise<void> {
  if (rows.length === 0) return;
  const sql = db();
  const col = <K extends keyof HourCounts>(k: K) => rows.map((r) => r[k]);
  const hours = col("hour");
  const withServices = rows.filter((r) => r.serviceList);
  const packed = Object.fromEntries(
    withServices.map((r) => [
      r.hour,
      r.serviceList!.map((v) => [
        v.dep, v.arr, v.toc, v.trains, v.within1, v.within5, v.within10, v.within15,
        v.within30, v.within60,
      ]),
    ])
  );
  const monthStart = `${period}-01`;

  const queries: ReturnType<typeof sql>[] = [];
  if (opts.dayMetrics !== false) {
    queries.push(sql`
      INSERT INTO day_metrics
        (from_crs, to_crs, hour, from_date, to_date, trains, within5, within15, within30)
      SELECT ${from}, ${to}, d.hour, d.span_start, ${throughDate}::date,
             d.trains, d.within5, d.within15, d.within30
      FROM (
        SELECT t.hour,
               COALESCE(h.through_date::date + 1, ${monthStart}::date) AS span_start,
               t.trains - COALESCE(h.trains, 0)     AS trains,
               t.within5 - COALESCE(h.within5, 0)   AS within5,
               CASE WHEN h.hour IS NULL THEN t.within15
                    ELSE t.within15 - h.within15 END AS within15,
               t.within30 - COALESCE(h.within30, 0) AS within30,
               h.final
        FROM unnest(
          ${hours}::smallint[],
          ${col("trains")}::int[],
          ${col("within5")}::int[],
          ${col("within15")}::int[],
          ${col("within30")}::int[]
        ) AS t(hour, trains, within5, within15, within30)
        LEFT JOIN hourly_metrics h
          ON h.from_crs = ${from} AND h.to_crs = ${to}
         AND h.period = ${period} AND h.hour = t.hour
      ) d
      WHERE ${throughDate}::date >= d.span_start
        AND ${throughDate}::date - d.span_start < ${MAX_DAY_SPAN}
        AND d.final IS NOT TRUE
        AND d.trains >= 0 AND d.within5 >= 0 AND d.within30 >= 0
        AND (d.within15 IS NULL OR d.within15 >= 0)
      ON CONFLICT (from_crs, to_crs, hour, to_date) DO UPDATE SET
        from_date = EXCLUDED.from_date,
        trains = EXCLUDED.trains,
        within5 = EXCLUDED.within5,
        within15 = EXCLUDED.within15,
        within30 = EXCLUDED.within30
    `);
  }
  queries.push(sql`
      INSERT INTO hourly_metrics
        (from_crs, to_crs, period, hour, trains, within1, within5, within10, within15,
         within30, within60, services, toc_codes, journey_mins, through_date, final,
         fetched_at)
      SELECT ${from}, ${to}, ${period}, t.hour, t.trains, t.within1, t.within5,
             t.within10, t.within15, t.within30, t.within60, t.services, t.toc_codes,
             t.journey_mins, ${throughDate}, ${final}, now()
      FROM unnest(
        ${hours}::smallint[],
        ${col("trains")}::int[],
        ${col("within1")}::int[],
        ${col("within5")}::int[],
        ${col("within10")}::int[],
        ${col("within15")}::int[],
        ${col("within30")}::int[],
        ${col("within60")}::int[],
        ${col("services")}::int[],
        ${rows.map((r) => r.tocCodes.join(","))}::text[],
        ${col("journeyMins")}::int[]
      ) AS t(hour, trains, within1, within5, within10, within15, within30, within60,
             services, toc_codes, journey_mins)
      ON CONFLICT (from_crs, to_crs, period, hour) DO UPDATE SET
        trains = EXCLUDED.trains,
        within1 = EXCLUDED.within1,
        within5 = EXCLUDED.within5,
        within10 = EXCLUDED.within10,
        within15 = EXCLUDED.within15,
        within30 = EXCLUDED.within30,
        within60 = EXCLUDED.within60,
        services = EXCLUDED.services,
        toc_codes = EXCLUDED.toc_codes,
        journey_mins = EXCLUDED.journey_mins,
        through_date = EXCLUDED.through_date,
        final = EXCLUDED.final,
        fetched_at = now()
    `);
  if (withServices.length > 0) {
    queries.push(sql`
      INSERT INTO service_months (from_crs, to_crs, period, services)
      VALUES (${from}, ${to}, ${period}, ${JSON.stringify(packed)}::jsonb)
      ON CONFLICT (from_crs, to_crs, period) DO UPDATE SET
        services = service_months.services || EXCLUDED.services
    `);
  }
  await withRetry(() => sql.transaction(queries));
}

/** How much of one route-month is stored, counting only the hours asked about. */
export interface PeriodCoverage {
  /** Hours stored. */
  hours: number;
  /** Hours stored and final. */
  finalHours: number;
  /** Oldest through-date among the stored hours. */
  through: string;
}

/**
 * Coverage of every route for the given periods and hours, keyed `"FROM>TO"`
 * then period. Lets the ingest plan its work in one query instead of one per
 * route.
 */
export async function getCoverage(
  periods: string[],
  hours: number[]
): Promise<Map<string, Map<string, PeriodCoverage>>> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs, period,
             COUNT(*)::int                       AS hours,
             COUNT(*) FILTER (WHERE final)::int  AS final_hours,
             MIN(through_date)                   AS through
      FROM hourly_metrics
      WHERE period = ANY(${periods}) AND hour = ANY(${hours})
      GROUP BY from_crs, to_crs, period
    `
  )) as Record<string, unknown>[];
  const out = new Map<string, Map<string, PeriodCoverage>>();
  for (const r of rows) {
    const key = `${r.from_crs as string}>${r.to_crs as string}`;
    if (!out.has(key)) out.set(key, new Map());
    out.get(key)!.set(r.period as string, {
      hours: Number(r.hours),
      finalHours: Number(r.final_hours),
      through: r.through as string,
    });
  }
  return out;
}

/** Most services ever seen per departure hour of a route — sizes HSP calls. */
export async function getServiceHint(
  from: string,
  to: string
): Promise<Map<number, number>> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT hour, MAX(services)::int AS services
      FROM hourly_metrics
      WHERE from_crs = ${from} AND to_crs = ${to}
      GROUP BY hour
    `
  )) as Record<string, unknown>[];
  return new Map(rows.map((r) => [Number(r.hour), Number(r.services)]));
}

/** Hours with trains but without the finer punctuality buckets (stored before
 * they were collected), newest first — what the detail backfill refetches.
 * Refetching also brings journey times and per-service rows. */
export async function getUndetailedHours(
  periods: string[]
): Promise<{ from: string; to: string; period: string; hours: number[] }[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs, period, ARRAY_AGG(hour ORDER BY hour) AS hours
      FROM hourly_metrics
      WHERE period = ANY(${periods}) AND trains > 0 AND within15 IS NULL
      GROUP BY from_crs, to_crs, period
      ORDER BY period DESC
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    from: r.from_crs as string,
    to: r.to_crs as string,
    period: r.period as string,
    hours: (r.hours as number[]).map(Number),
  }));
}

/** Share of stored hours (with trains) that carry the finer buckets. */
export async function getDetailCoverage(periods: string[]): Promise<{ detailed: number; total: number }> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT COUNT(*) FILTER (WHERE within15 IS NOT NULL)::int AS detailed,
             COUNT(*)::int AS total
      FROM hourly_metrics
      WHERE period = ANY(${periods}) AND trains > 0
    `
  )) as Record<string, unknown>[];
  return { detailed: Number(rows[0]?.detailed ?? 0), total: Number(rows[0]?.total ?? 0) };
}

/** A value from app_settings, or null when unset. */
export async function getSetting(key: string): Promise<string | null> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`SELECT value FROM app_settings WHERE key = ${key}`
  )) as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const sql = db();
  await withRetry(
    () => sql`
      INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `
  );
}

/** One stored service of a route-month. */
export interface ServiceRow {
  period: string;
  hour: number;
  dep: string;
  arr: string;
  toc: string;
  trains: number;
  within1: number;
  within5: number;
  within10: number;
  within15: number;
  within30: number;
  within60: number;
}

/** Stored services of a route departing in the given hours. */
export async function getServiceRows(
  from: string,
  to: string,
  periods: string[],
  hours: number[]
): Promise<ServiceRow[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT period, services FROM service_months
      WHERE from_crs = ${from} AND to_crs = ${to} AND period = ANY(${periods})
    `
  )) as { period: string; services: Record<string, (string | number)[][]> }[];
  const out: ServiceRow[] = [];
  for (const r of rows) {
    for (const hour of hours) {
      for (const v of r.services[hour] ?? []) {
        out.push({
          period: r.period,
          hour,
          dep: String(v[0]),
          arr: String(v[1]),
          toc: String(v[2]),
          trains: Number(v[3]),
          within1: Number(v[4]),
          within5: Number(v[5]),
          within10: Number(v[6]),
          within15: Number(v[7]),
          within30: Number(v[8]),
          within60: Number(v[9]),
        });
      }
    }
  }
  return out;
}

/** Drop day spans older than `days`: "latest day" only looks back a couple
 * of months, and a row per route, hour and day would otherwise grow without
 * end. */
export async function pruneDayMetrics(days: number): Promise<number> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      WITH gone AS (
        DELETE FROM day_metrics WHERE to_date < CURRENT_DATE - ${days}::int RETURNING 1
      )
      SELECT COUNT(*)::int AS n FROM gone
    `
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Day spans of a route's chosen hours, summed across those hours. A span is
 * only returned when every hour has it (same dates), so it is a whole band. */
export interface DaySpan {
  fromDate: string;
  toDate: string;
  trains: number;
  within5: number;
  within15: number | null;
  within30: number;
}

export async function getDaySpans(
  from: string,
  to: string,
  hours: number[],
  sinceDay: string
): Promise<DaySpan[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT to_char(from_date, 'YYYY-MM-DD') AS from_date,
             to_char(to_date, 'YYYY-MM-DD') AS to_date,
             SUM(trains)::int AS trains, SUM(within5)::int AS within5,
             SUM(within15)::int AS within15, SUM(within30)::int AS within30,
             COUNT(within15)::int AS with15, COUNT(*)::int AS cells
      FROM day_metrics
      WHERE from_crs = ${from} AND to_crs = ${to} AND hour = ANY(${hours})
        AND to_date >= ${sinceDay}::date
      GROUP BY from_date, to_date
      HAVING COUNT(*) = ${hours.length}
      ORDER BY to_date
    `
  )) as Record<string, unknown>[];
  return rows.map(toDaySpan);
}

/** Network-wide day spans: every route's chosen hours summed, per span. Only
 * spans covering at least `minRoutes` routes, so a lone refresh can't pose as
 * "the network". */
export async function getNetworkDaySpans(
  hours: number[],
  sinceDay: string,
  minRoutes = 20
): Promise<(DaySpan & { routes: number })[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT to_char(from_date, 'YYYY-MM-DD') AS from_date,
             to_char(to_date, 'YYYY-MM-DD') AS to_date,
             SUM(trains)::int AS trains, SUM(within5)::int AS within5,
             SUM(within15)::int AS within15, SUM(within30)::int AS within30,
             COUNT(within15)::int AS with15,
             COUNT(DISTINCT from_crs || to_crs)::int AS routes,
             COUNT(*)::int AS cells
      FROM day_metrics
      WHERE hour = ANY(${hours}) AND to_date >= ${sinceDay}::date
      GROUP BY from_date, to_date
      HAVING COUNT(DISTINCT from_crs || to_crs) >= ${minRoutes}
      ORDER BY to_date
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({ ...toDaySpan(r), routes: Number(r.routes) }));
}

function toDaySpan(r: Record<string, unknown>): DaySpan {
  return {
    fromDate: r.from_date as string,
    toDate: r.to_date as string,
    trains: Number(r.trains),
    within5: Number(r.within5),
    // A partial sum would understate it: only trust it when every row had one.
    within15:
      r.within15 == null || Number(r.with15) !== Number(r.cells) ? null : Number(r.within15),
    within30: Number(r.within30),
  };
}

/** Fire-and-forget popularity counter; the ingest keeps looked-up routes fresh. */
export async function recordLookup(
  from: string,
  to: string,
  band: TimeBand
): Promise<void> {
  const sql = db();
  await withRetry(
    () => sql`
      INSERT INTO route_lookups (from_crs, to_crs, band, lookups, last_seen)
      VALUES (${from}, ${to}, ${band}, 1, now())
      ON CONFLICT (from_crs, to_crs, band) DO UPDATE SET
        lookups = route_lookups.lookups + 1,
        last_seen = now()
    `
  );
}

export interface PopularRoute {
  from: string;
  to: string;
  band: TimeBand;
  lookups: number;
}

/** One route's raw totals over a set of periods, ready for scoring/ranking. */
export interface RouteAggregate {
  from: string;
  to: string;
  trains: number;
  within5: number;
  within30: number;
  /** The finer buckets, when every hour summed has them. */
  fine: { within10: number; within15: number; within60: number } | null;
  /** Months with actual service that had every requested hour stored. */
  months: number;
  /** Those months, each with the last date its counts cover. */
  spans: { period: string; through: string }[];
}

/**
 * Totals for every route over the given hours and periods, for the
 * leaderboard. A month only counts when all the requested hours are stored
 * (so a half-fetched month can't skew a route), and a route needs `minMonths`
 * of real service to qualify.
 */
export async function getRouteAggregates(
  hours: number[],
  periods: string[],
  minMonths = 6
): Promise<RouteAggregate[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs,
             SUM(trains)::int                        AS trains,
             SUM(within5)::int                       AS within5,
             SUM(within30)::int                      AS within30,
             SUM(within10)::int                      AS within10,
             SUM(within15)::int                      AS within15,
             SUM(within60)::int                      AS within60,
             SUM(undetailed)::int                    AS undetailed,
             COUNT(*) FILTER (WHERE trains > 0)::int AS months,
             ARRAY_AGG(period || '|' || through) FILTER (WHERE trains > 0) AS spans
      FROM (
        SELECT from_crs, to_crs, period,
               SUM(trains)       AS trains,
               SUM(within5)      AS within5,
               SUM(within30)     AS within30,
               SUM(within10)     AS within10,
               SUM(within15)     AS within15,
               SUM(within60)     AS within60,
               COUNT(*) FILTER (WHERE within15 IS NULL AND trains > 0) AS undetailed,
               MIN(through_date) AS through
        FROM hourly_metrics
        WHERE hour = ANY(${hours}) AND period = ANY(${periods})
        GROUP BY from_crs, to_crs, period
        HAVING COUNT(*) = ${hours.length}
      ) m
      GROUP BY from_crs, to_crs
      HAVING COUNT(*) FILTER (WHERE trains > 0) >= ${minMonths}
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    from: r.from_crs as string,
    to: r.to_crs as string,
    trains: Number(r.trains),
    within5: Number(r.within5),
    within30: Number(r.within30),
    fine:
      Number(r.undetailed) === 0
        ? {
            within10: Number(r.within10 ?? 0),
            within15: Number(r.within15 ?? 0),
            within60: Number(r.within60 ?? 0),
          }
        : null,
    months: Number(r.months),
    spans: ((r.spans as string[] | null) ?? []).map((s) => {
      const [period, through] = s.split("|");
      return { period, through };
    }),
  }));
}

export async function getPopularRoutes(limit = 50): Promise<PopularRoute[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs, band, lookups FROM route_lookups
      ORDER BY last_seen DESC, lookups DESC
      LIMIT ${limit}
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    from: r.from_crs as string,
    to: r.to_crs as string,
    band: r.band as TimeBand,
    lookups: Number(r.lookups),
  }));
}

// ---- TfL ----------------------------------------------------------------------

/** One poll of every line's status, added to the counts for its London hour. */
export async function addLineSamples(
  day: string,
  hour: number,
  samples: { line: string; category: "good" | "minor" | "severe" | "closed" }[]
): Promise<void> {
  if (samples.length === 0) return;
  const sql = db();
  const is = (c: string) => samples.map((s) => (s.category === c ? 1 : 0));
  await withRetry(
    () => sql`
      INSERT INTO tfl_line_hours (line, day, hour, samples, good, minor, severe, closed)
      SELECT t.line, ${day}::date, ${hour}, 1, t.good, t.minor, t.severe, t.closed
      FROM unnest(
        ${samples.map((s) => s.line)}::text[],
        ${is("good")}::int[],
        ${is("minor")}::int[],
        ${is("severe")}::int[],
        ${is("closed")}::int[]
      ) AS t(line, good, minor, severe, closed)
      ON CONFLICT (line, day, hour) DO UPDATE SET
        samples = tfl_line_hours.samples + 1,
        good = tfl_line_hours.good + EXCLUDED.good,
        minor = tfl_line_hours.minor + EXCLUDED.minor,
        severe = tfl_line_hours.severe + EXCLUDED.severe,
        closed = tfl_line_hours.closed + EXCLUDED.closed
    `
  );
}

/** A line's status counts over a window, weekdays only. */
export interface LineHistory {
  line: string;
  samples: number;
  good: number;
  minor: number;
  severe: number;
  closed: number;
  /** Distinct weekdays with at least one sample in the hours asked about. */
  days: number;
  /** Earliest such day (YYYY-MM-DD). */
  since: string;
}

/** Weekday status history of some lines within the given London hours, from
 * `sinceDay` on. Lines never polled are simply absent. */
export async function getLineHistory(
  lines: string[],
  hours: number[],
  sinceDay: string
): Promise<LineHistory[]> {
  if (lines.length === 0) return [];
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT line,
             SUM(samples)::int AS samples, SUM(good)::int AS good,
             SUM(minor)::int AS minor, SUM(severe)::int AS severe,
             SUM(closed)::int AS closed,
             COUNT(DISTINCT day)::int AS days,
             to_char(MIN(day), 'YYYY-MM-DD') AS since
      FROM tfl_line_hours
      WHERE line = ANY(${lines}) AND hour = ANY(${hours})
        AND day >= ${sinceDay}::date AND EXTRACT(ISODOW FROM day) < 6
      GROUP BY line
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    line: r.line as string,
    samples: Number(r.samples),
    good: Number(r.good),
    minor: Number(r.minor),
    severe: Number(r.severe),
    closed: Number(r.closed),
    days: Number(r.days),
    since: r.since as string,
  }));
}

/** A stored Tube journey, if fetched within `maxAgeDays`. */
export async function getTflJourney<T>(key: string, maxAgeDays: number): Promise<T | null> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT data FROM tfl_journeys
      WHERE key = ${key} AND fetched_at > now() - make_interval(days => ${maxAgeDays})
    `
  )) as Record<string, unknown>[];
  return rows.length ? (rows[0].data as T) : null;
}

export async function putTflJourney(key: string, data: unknown): Promise<void> {
  const sql = db();
  await withRetry(
    () => sql`
      INSERT INTO tfl_journeys (key, data, fetched_at)
      VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()
    `
  );
}
