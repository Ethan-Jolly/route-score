/**
 * Operator report cards.
 *
 * Each route belongs to its **primary operator**: whichever TOC appears on
 * most of its stored peak hours. An operator's figures are its routes pooled
 * as if they were one big route — summed counts through the same formula as a
 * route — over the leaderboard's window and hours (both commuter peaks), so
 * operator, leaderboard and route scores are all on the same footing.
 */

import { unstable_cache } from "next/cache";
import { neon } from "@neondatabase/serverless";
import {
  PEAK_HOURS,
  compositeScore,
  gapBetweenTrains,
  metricsFromCounts,
  monthlyScores,
  trendFor,
  verdictFor,
  type FineCounts,
} from "./score";
import { dbConfigured } from "./db";
import { fineDelayEnabled } from "./fineDelay";
import { TOC_NAMES, hspConfigured } from "./hsp";
import { weekdaysBetween } from "./periods";
import { scoreWindow } from "./provider";
import { stationByCrs } from "./stations";
import { CURATED_ROUTES } from "./routes";
import { demoMonthlyMetrics } from "./demo";
import type { MonthlyMetrics, MonthlyScore, Station, Trend } from "./types";

export interface OperatorRoute {
  from: Station;
  to: Station;
  score: number;
  onTimePct: number;
  trains: number;
  /** Other operators also on this route. */
  shared: boolean;
}

export interface OperatorCard {
  code: string;
  name: string;
  slug: string;
  score: number;
  verdict: string;
  onTimePct: number;
  reliabilityPct: number;
  trains: number;
  trend: Trend;
  monthlyScores: MonthlyScore[];
  routes: OperatorRoute[];
  /** 1 = best, out of `of`. */
  rank: number;
  of: number;
  source: "hsp" | "demo";
}

/** Same bar as the leaderboard: enough months and enough trains. */
const MIN_MONTHS = 6;
const MIN_TRAINS_PER_WEEKDAY = 2;
/** Operators need this many routes to get a card. */
const MIN_ROUTES = 3;

export const operatorSlug = (name: string) =>
  name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface RouteMonth {
  route: string;
  period: string;
  trains: number;
  within5: number;
  within30: number;
  weekdays: number;
  /** The finer buckets, when every hour has them and fine delay is on. */
  fine: FineCounts | null;
}

interface RouteData {
  route: string;
  primary: string;
  shared: boolean;
  months: RouteMonth[];
}

async function loadRoutes(): Promise<RouteData[]> {
  const sql = neon(process.env.DATABASE_URL!);
  const { periods } = scoreWindow();
  const useFine = await fineDelayEnabled();
  const rows = (await sql`
    SELECT from_crs || '>' || to_crs AS route, period,
           SUM(trains)::int AS trains, SUM(within5)::int AS within5,
           SUM(within30)::int AS within30, MIN(through_date) AS through,
           COUNT(within15)::int AS detailed, SUM(within10)::int AS within10,
           SUM(within15)::int AS within15, SUM(within60)::int AS within60,
           STRING_AGG(toc_codes, ',') AS tocs
    FROM hourly_metrics
    WHERE period = ANY(${periods}) AND hour = ANY(${PEAK_HOURS})
    GROUP BY 1, 2
    HAVING COUNT(*) = ${PEAK_HOURS.length}
  `) as { route: string; period: string; trains: number; within5: number; within30: number; through: string; tocs: string | null; detailed: number; within10: number | null; within15: number | null; within60: number | null }[];

  const byRoute = new Map<string, { months: RouteMonth[]; tocs: Map<string, number> }>();
  for (const r of rows) {
    const entry = byRoute.get(r.route) ?? { months: [] as RouteMonth[], tocs: new Map<string, number>() };
    if (r.trains > 0) {
      entry.months.push({
        route: r.route,
        period: r.period,
        trains: r.trains,
        within5: r.within5,
        within30: r.within30,
        weekdays: weekdaysBetween(`${r.period}-01`, r.through),
        fine:
          useFine && r.detailed === PEAK_HOURS.length
            ? { within10: r.within10 ?? 0, within15: r.within15 ?? 0, within60: r.within60 ?? 0 }
            : null,
      });
    }
    for (const code of (r.tocs ?? "").split(",").filter(Boolean)) {
      entry.tocs.set(code, (entry.tocs.get(code) ?? 0) + 1);
    }
    byRoute.set(r.route, entry);
  }

  const out: RouteData[] = [];
  for (const [route, { months, tocs }] of byRoute) {
    const ranked = [...tocs.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length || !TOC_NAMES[ranked[0][0]]) continue;
    const trains = months.reduce((s, m) => s + m.trains, 0);
    const weekdays = months.reduce((s, m) => s + m.weekdays, 0);
    if (months.length < MIN_MONTHS || trains / Math.max(1, weekdays) < MIN_TRAINS_PER_WEEKDAY) continue;
    out.push({ route, primary: ranked[0][0], shared: ranked.length > 1, months });
  }
  return out;
}

/** Score a pile of route-months as one route. */
function pooled(months: RouteMonth[]) {
  const sum = (f: (m: RouteMonth) => number) => months.reduce((s, m) => s + f(m), 0);
  const trains = sum((m) => m.trains);
  const fine = months.every((m) => m.fine)
    ? {
        within10: sum((m) => m.fine!.within10),
        within15: sum((m) => m.fine!.within15),
        within60: sum((m) => m.fine!.within60),
      }
    : null;
  const metrics = metricsFromCounts(trains, sum((m) => m.within5), sum((m) => m.within30), fine);
  const gap = gapBetweenTrains(trains, sum((m) => m.weekdays), PEAK_HOURS.length);
  const { score } = compositeScore(metrics.onTimePct, metrics.reliabilityPct, metrics.avgDelayMins, gap);
  return { score, trains, ...metrics, gapMins: gap };
}

/** For pooling several routes: frequency is about each route's own trains,
 * so the gap is averaged over routes rather than worked out from the pile. */
function pooledOperator(routes: RouteData[]) {
  const all = routes.flatMap((r) => r.months);
  const p = pooled(all);
  const gap =
    routes.reduce((s, r) => s + pooled(r.months).gapMins * pooled(r.months).trains, 0) / p.trains;
  const { score } = compositeScore(p.onTimePct, p.reliabilityPct, p.avgDelayMins, gap);
  return { ...p, score, gapMins: gap };
}

async function computeCards(): Promise<OperatorCard[]> {
  if (!hspConfigured() || !dbConfigured()) return demoCards();
  const routes = await loadRoutes();
  const byOp = new Map<string, RouteData[]>();
  for (const r of routes) byOp.set(r.primary, [...(byOp.get(r.primary) ?? []), r]);

  const cards: Omit<OperatorCard, "rank" | "of">[] = [];
  for (const [code, list] of byOp) {
    if (list.length < MIN_ROUTES) continue;
    const name = TOC_NAMES[code];
    const p = pooledOperator(list);
    const periods = [...new Set(list.flatMap((r) => r.months.map((m) => m.period)))].sort();
    const monthly: MonthlyMetrics[] = periods.map((period) => {
      const ms = list.flatMap((r) => r.months.filter((m) => m.period === period));
      const pm = pooled(ms);
      return {
        month: period,
        totalTrains: pm.trains,
        onTimePct: pm.onTimePct,
        reliabilityPct: pm.reliabilityPct,
        avgDelayMins: pm.avgDelayMins,
        gapMins: p.gapMins,
      };
    });
    // A month in progress with few trains isn't a fair point on the chart.
    const avg = monthly.reduce((s, m) => s + m.totalTrains, 0) / monthly.length;
    const series = monthlyScores(monthly.filter((m) => m.totalTrains >= avg * 0.4));
    cards.push({
      code,
      name,
      slug: operatorSlug(name),
      score: p.score,
      verdict: verdictFor(p.score),
      onTimePct: p.onTimePct,
      reliabilityPct: p.reliabilityPct,
      trains: p.trains,
      trend: trendFor(series),
      monthlyScores: series,
      routes: list
        .map((r) => {
          const [from, to] = r.route.split(">");
          const rp = pooled(r.months);
          return {
            from: stationByCrs(from)!,
            to: stationByCrs(to)!,
            score: rp.score,
            onTimePct: rp.onTimePct,
            trains: rp.trains,
            shared: r.shared,
          };
        })
        .filter((r) => r.from && r.to)
        .sort((a, b) => b.score - a.score),
      source: "hsp",
    });
  }
  return rank(cards);
}

function rank(cards: Omit<OperatorCard, "rank" | "of">[]): OperatorCard[] {
  return cards
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((c, i) => ({ ...c, rank: i + 1, of: cards.length }));
}

/** Demo mode: group the curated routes by a made-up operator. */
function demoCards(): OperatorCard[] {
  const names = ["Southern", "Southeastern", "Great Western Railway", "LNER", "Northern", "ScotRail"];
  const groups = new Map<string, OperatorRoute[]>();
  CURATED_ROUTES.slice(0, 120).forEach((r, i) => {
    const from = stationByCrs(r.from);
    const to = stationByCrs(r.to);
    if (!from || !to) return;
    const months = demoMonthlyMetrics(r.from, r.to, "am-peak");
    const onTime = months.reduce((s, m) => s + m.onTimePct, 0) / months.length;
    const name = names[i % names.length];
    groups.set(name, [
      ...(groups.get(name) ?? []),
      { from, to, score: Math.round(onTime * 0.9 + 8), onTimePct: Math.round(onTime), trains: 2400, shared: false },
    ]);
  });
  return rank(
    [...groups.entries()].map(([name, routes]) => {
      const score = Math.round(routes.reduce((s, r) => s + r.score, 0) / routes.length);
      const series = demoMonthlyMetrics(name.slice(0, 3).toUpperCase(), "OPS", "am-peak");
      const scores = monthlyScores(series);
      return {
        code: name.slice(0, 2).toUpperCase(),
        name,
        slug: operatorSlug(name),
        score,
        verdict: verdictFor(score),
        onTimePct: Math.round(routes.reduce((s, r) => s + r.onTimePct, 0) / routes.length),
        reliabilityPct: 95,
        trains: routes.length * 2400,
        trend: trendFor(scores),
        monthlyScores: scores,
        routes: routes.sort((a, b) => b.score - a.score),
        source: "demo" as const,
      };
    })
  );
}

/** Every operator with a card, best first. Recomputed at most every 6 hours. */
export const getOperatorCards = unstable_cache(computeCards, ["operator-cards-v1"], {
  revalidate: 6 * 3600,
});

export async function getOperatorCard(slug: string): Promise<OperatorCard | null> {
  return (await getOperatorCards()).find((c) => c.slug === slug) ?? null;
}
