/**
 * Neon Postgres data layer.
 *
 * This is the permanent cache and history store for route performance. HSP
 * only holds ~1 year and is slow (~22s/call), so every route-month we ever
 * fetch is written here once and never fetched again — which also lets the
 * app accumulate history beyond HSP's rolling window over time.
 *
 * Activated by DATABASE_URL. Without it, the app still works (direct HSP or
 * demo), just without caching or history.
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { MonthlyMetrics, TimeBand } from "./types";

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

/** A cached month row. `noService` marks a route-month HSP confirmed empty,
 * so we don't keep re-querying dead station pairs. */
export interface CachedMonth extends MonthlyMetrics {
  tocCodes: string[];
  noService: boolean;
  source: "hsp" | "demo";
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
    CREATE TABLE IF NOT EXISTS monthly_metrics (
      from_crs        TEXT    NOT NULL,
      to_crs          TEXT    NOT NULL,
      band            TEXT    NOT NULL,
      month           TEXT    NOT NULL,
      total_trains    INTEGER NOT NULL DEFAULT 0,
      on_time_pct     REAL    NOT NULL DEFAULT 0,
      reliability_pct REAL    NOT NULL DEFAULT 0,
      avg_delay_mins  REAL    NOT NULL DEFAULT 0,
      toc_codes       TEXT    NOT NULL DEFAULT '',
      no_service      BOOLEAN NOT NULL DEFAULT FALSE,
      source          TEXT    NOT NULL DEFAULT 'hsp',
      fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_crs, to_crs, band, month)
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
}

function rowToCached(r: Record<string, unknown>): CachedMonth {
  return {
    month: r.month as string,
    totalTrains: Number(r.total_trains),
    onTimePct: Number(r.on_time_pct),
    reliabilityPct: Number(r.reliability_pct),
    avgDelayMins: Number(r.avg_delay_mins),
    tocCodes: (r.toc_codes as string) ? (r.toc_codes as string).split(",") : [],
    noService: Boolean(r.no_service),
    source: (r.source as "hsp" | "demo") ?? "hsp",
  };
}

export async function getCachedMonths(
  from: string,
  to: string,
  band: TimeBand,
  months: string[]
): Promise<Map<string, CachedMonth>> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT * FROM monthly_metrics
      WHERE from_crs = ${from} AND to_crs = ${to} AND band = ${band}
        AND month = ANY(${months})
    `
  )) as Record<string, unknown>[];
  const out = new Map<string, CachedMonth>();
  for (const r of rows) out.set(r.month as string, rowToCached(r));
  return out;
}

export async function upsertMonths(
  from: string,
  to: string,
  band: TimeBand,
  months: CachedMonth[]
): Promise<void> {
  if (months.length === 0) return;
  const sql = db();
  await withRetry(() =>
    Promise.all(
      months.map(
        (m) => sql`
        INSERT INTO monthly_metrics
          (from_crs, to_crs, band, month, total_trains, on_time_pct,
           reliability_pct, avg_delay_mins, toc_codes, no_service, source, fetched_at)
        VALUES
          (${from}, ${to}, ${band}, ${m.month}, ${m.totalTrains}, ${m.onTimePct},
           ${m.reliabilityPct}, ${m.avgDelayMins}, ${m.tocCodes.join(",")},
           ${m.noService}, ${m.source}, now())
        ON CONFLICT (from_crs, to_crs, band, month) DO UPDATE SET
          total_trains = EXCLUDED.total_trains,
          on_time_pct = EXCLUDED.on_time_pct,
          reliability_pct = EXCLUDED.reliability_pct,
          avg_delay_mins = EXCLUDED.avg_delay_mins,
          toc_codes = EXCLUDED.toc_codes,
          no_service = EXCLUDED.no_service,
          source = EXCLUDED.source,
          fetched_at = now()
      `
      )
    )
  );
}

/**
 * How many of the given months are cached for each route in a band, keyed
 * `"FROM>TO"`. Used by the backfill to find routes that still need warming
 * without a per-route round-trip. Counts noService rows too (they're "done").
 */
export async function getRouteMonthCounts(
  band: TimeBand,
  months: string[]
): Promise<Map<string, number>> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs, COUNT(*) AS n
      FROM monthly_metrics
      WHERE band = ${band} AND month = ANY(${months})
      GROUP BY from_crs, to_crs
    `
  )) as Record<string, unknown>[];
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(`${r.from_crs as string}>${r.to_crs as string}`, Number(r.n));
  }
  return out;
}

/** Fire-and-forget popularity counter used to drive cron pre-warming. */
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

/** One route's period-aggregate performance, ready for scoring/ranking. */
export interface RouteAggregate {
  from: string;
  to: string;
  band: TimeBand;
  onTimePct: number;
  reliabilityPct: number;
  avgDelayMins: number;
  totalTrains: number;
  months: number;
}

/**
 * Train-weighted aggregate of every cached route for a band, for the
 * leaderboard. Only real HSP data with actual service is considered, and a
 * route needs `minMonths` of coverage to qualify (so a single freshly-warmed
 * month can't top the board). Scoring/ranking happens in TS via compositeScore.
 */
export async function getRouteAggregates(
  band: TimeBand,
  minMonths = 6
): Promise<RouteAggregate[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT
        from_crs,
        to_crs,
        SUM(total_trains)                                            AS total_trains,
        SUM(on_time_pct     * total_trains) / SUM(total_trains)      AS on_time_pct,
        SUM(reliability_pct * total_trains) / SUM(total_trains)      AS reliability_pct,
        SUM(avg_delay_mins  * total_trains) / SUM(total_trains)      AS avg_delay_mins,
        COUNT(*)                                                     AS months
      FROM monthly_metrics
      WHERE band = ${band}
        AND source = 'hsp'
        AND no_service = FALSE
        AND total_trains > 0
      GROUP BY from_crs, to_crs
      HAVING COUNT(*) >= ${minMonths} AND SUM(total_trains) > 0
    `
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    from: r.from_crs as string,
    to: r.to_crs as string,
    band,
    onTimePct: Number(r.on_time_pct),
    reliabilityPct: Number(r.reliability_pct),
    avgDelayMins: Number(r.avg_delay_mins),
    totalTrains: Number(r.total_trains),
    months: Number(r.months),
  }));
}

export async function getPopularRoutes(limit = 50): Promise<PopularRoute[]> {
  const sql = db();
  const rows = (await withRetry(
    () => sql`
      SELECT from_crs, to_crs, band, lookups FROM route_lookups
      ORDER BY lookups DESC, last_seen DESC
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
