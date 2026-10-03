/**
 * Builds the best/worst leaderboards from cached route data.
 *
 * Ranking is over the curated universe (lib/routes.ts) that the ingest fills,
 * scored on the same window as a route page: the 12 complete months plus the
 * month in progress.
 * The UK board is national; the London board is the subset touching a London
 * terminal. A route needs enough months and enough weekly service to qualify,
 * so the boards reflect real, well-travelled routes rather than statistical
 * flukes on an obscure pair.
 *
 * Works in three modes, mirroring the rest of the app: real HSP data from the
 * DB when configured, and a deterministic demo board otherwise so the page is
 * viewable in local dev.
 */

import { BAND_HOURS, compositeScore, last12Months, metricsFromCounts, verdictFor } from "./score";
import { dbConfigured, ensureSchema, getRouteAggregates } from "./db";
import { currentMonth } from "./periods";
import { hspConfigured } from "./hsp";
import { demoMonthlyMetrics } from "./demo";
import { CURATED_ROUTES, LEADERBOARD_BAND, isLondonTerminal } from "./routes";
import { stationByCrs } from "./stations";
import type { Station, TimeBand } from "./types";

export interface LeaderboardEntry {
  from: Station;
  to: Station;
  band: TimeBand;
  score: number;
  verdict: string;
  onTimePct: number;
  reliabilityPct: number;
  avgDelayMins: number;
  totalTrains: number;
  months: number;
  /** Approx weekday trains/day, for display. */
  servicesPerDay: number;
  london: boolean;
}

export interface Board {
  best: LeaderboardEntry[];
  worst: LeaderboardEntry[];
}

export interface Leaderboard {
  uk: Board;
  london: Board;
  /** How many routes qualified (had enough data) for the national board. */
  qualified: number;
  /** "hsp" once real data is flowing, "demo" in local dev without a DB. */
  source: "hsp" | "demo";
}

/** One route's period-aggregate performance, ready for scoring/ranking. */
interface RouteAggregate {
  from: string;
  to: string;
  band: TimeBand;
  onTimePct: number;
  reliabilityPct: number;
  avgDelayMins: number;
  totalTrains: number;
  months: number;
}

const WEEKDAYS_PER_MONTH = 21.5;
/** Minimum coverage/volume to appear on a board. */
const MIN_MONTHS = 6;
const MIN_TRAINS_PER_WEEKDAY = 2; // ~40+ trains/month; filters out rare pairs

/** Turn a scored, filtered set of entries into ranked best/worst lists. */
function rank(entries: LeaderboardEntry[], size: number): Board {
  const byScore = [...entries].sort((a, b) => b.score - a.score);
  return {
    best: byScore.slice(0, size),
    // Worst = lowest score first, but keep them readable (ascending score).
    worst: byScore.slice(-size).reverse().sort((a, b) => a.score - b.score),
  };
}

/** Map one aggregate to a scored entry, or null if its stations are unknown. */
function toEntry(a: RouteAggregate): LeaderboardEntry | null {
  const from = stationByCrs(a.from);
  const to = stationByCrs(a.to);
  if (!from || !to) return null;
  const { score } = compositeScore(a.onTimePct, a.reliabilityPct, a.avgDelayMins);
  return {
    from,
    to,
    band: a.band,
    score,
    verdict: verdictFor(score),
    onTimePct: a.onTimePct,
    reliabilityPct: a.reliabilityPct,
    avgDelayMins: a.avgDelayMins,
    totalTrains: a.totalTrains,
    months: a.months,
    servicesPerDay: Math.max(
      1,
      Math.round(a.totalTrains / a.months / WEEKDAYS_PER_MONTH)
    ),
    london: isLondonTerminal(a.from) || isLondonTerminal(a.to),
  };
}

function assemble(
  aggregates: RouteAggregate[],
  source: "hsp" | "demo",
  size: number
): Leaderboard {
  const entries = aggregates
    .filter(
      (a) =>
        a.months >= MIN_MONTHS &&
        a.totalTrains / a.months / WEEKDAYS_PER_MONTH >= MIN_TRAINS_PER_WEEKDAY
    )
    .map(toEntry)
    .filter((e): e is LeaderboardEntry => e !== null);

  const london = entries.filter((e) => e.london);
  return {
    uk: rank(entries, size),
    london: rank(london, size),
    qualified: entries.length,
    source,
  };
}

/** Deterministic demo aggregates over the curated universe (no DB needed). */
function demoAggregates(): RouteAggregate[] {
  const out: RouteAggregate[] = [];
  for (const r of CURATED_ROUTES) {
    const months = demoMonthlyMetrics(r.from, r.to, LEADERBOARD_BAND);
    const totalTrains = months.reduce((s, m) => s + m.totalTrains, 0);
    if (totalTrains === 0) continue;
    const w = (f: (m: (typeof months)[number]) => number) =>
      months.reduce((s, m) => s + f(m) * m.totalTrains, 0) / totalTrains;
    out.push({
      from: r.from,
      to: r.to,
      band: LEADERBOARD_BAND,
      onTimePct: w((m) => m.onTimePct),
      reliabilityPct: w((m) => m.reliabilityPct),
      avgDelayMins: w((m) => m.avgDelayMins),
      totalTrains,
      months: months.length,
    });
  }
  return out;
}

/** Build the leaderboard. `size` is how many entries per best/worst list. */
export async function getLeaderboard(size = 10): Promise<Leaderboard> {
  // Demo mode (no HSP creds, or no DB to read from): synthesize from curated set.
  if (!hspConfigured() || !dbConfigured()) {
    return assemble(demoAggregates(), "demo", size);
  }
  await ensureSchema();
  const totals = await getRouteAggregates(
    BAND_HOURS[LEADERBOARD_BAND],
    [...last12Months(), currentMonth()],
    MIN_MONTHS
  );
  const aggregates = totals.map((t) => ({
    from: t.from,
    to: t.to,
    band: LEADERBOARD_BAND,
    ...metricsFromCounts(t.trains, t.within5, t.within30),
    totalTrains: t.trains,
    months: t.months,
  }));
  return assemble(aggregates, "hsp", size);
}
