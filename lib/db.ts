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
}

function rowToHour(r: Record<string, unknown>): HourRow {
  return {
    period: r.period as string,
    hour: Number(r.hour),
    trains: Number(r.trains),
    within5: Number(r.within5),
    within30: Number(r.within30),
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

/** Write (or replace) hours of one route-month in a single statement. */
export async function upsertHourRows(
  from: string,
  to: string,
  period: string,
  rows: HourCounts[],
  throughDate: string,
  final: boolean
): Promise<void> {
  if (rows.length === 0) return;
  const sql = db();
  await withRetry(
    () => sql`
      INSERT INTO hourly_metrics
        (from_crs, to_crs, period, hour, trains, within5, within30, services,
         toc_codes, journey_mins, through_date, final, fetched_at)
      SELECT ${from}, ${to}, ${period}, t.hour, t.trains, t.within5, t.within30,
             t.services, t.toc_codes, t.journey_mins, ${throughDate}, ${final}, now()
      FROM unnest(
        ${rows.map((r) => r.hour)}::smallint[],
        ${rows.map((r) => r.trains)}::int[],
        ${rows.map((r) => r.within5)}::int[],
        ${rows.map((r) => r.within30)}::int[],
        ${rows.map((r) => r.services)}::int[],
        ${rows.map((r) => r.tocCodes.join(","))}::text[],
        ${rows.map((r) => r.journeyMins)}::int[]
      ) AS t(hour, trains, within5, within30, services, toc_codes, journey_mins)
      ON CONFLICT (from_crs, to_crs, period, hour) DO UPDATE SET
        trains = EXCLUDED.trains,
        within5 = EXCLUDED.within5,
        within30 = EXCLUDED.within30,
        services = EXCLUDED.services,
        toc_codes = EXCLUDED.toc_codes,
        journey_mins = EXCLUDED.journey_mins,
        through_date = EXCLUDED.through_date,
        final = EXCLUDED.final,
        fetched_at = now()
    `
  );
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
             COUNT(*) FILTER (WHERE trains > 0)::int AS months,
             ARRAY_AGG(period || '|' || through) FILTER (WHERE trains > 0) AS spans
      FROM (
        SELECT from_crs, to_crs, period,
               SUM(trains)       AS trains,
               SUM(within5)      AS within5,
               SUM(within30)     AS within30,
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
