/**
 * Context for a route's bad months: was it everyone, the operator, or just
 * this route?
 *
 * Tested November 2026 on ~1,000 routes (see docs/feature-plan.md, Phase 3):
 * network-wide months stand out clearly (leaf-fall November, a hot August:
 * 40–50% of routes 5+ points below their own average), operator-wide months
 * too (London Overground ~20 points down for three months running), and what's
 * left really is local. Nothing here says *why* — there's no source of causes
 * we can trust — only who else was affected.
 *
 * Deviations are in on-time percentage points, each route-band-month against
 * that route-band's own average, so busy and quiet routes count the same.
 */

import { unstable_cache } from "next/cache";
import { neon } from "@neondatabase/serverless";
import { dbConfigured } from "./db";
import { hspConfigured, tocNamesFor } from "./hsp";
import { scoreWindow } from "./provider";
import { currentMonth } from "./periods";
import type { MonthlyMetrics, TimeBand } from "./types";

export interface MonthContext {
  /** Median route's deviation from its own average this month. */
  networkMedian: number;
  /** Share of routes 5+ points below their own average. */
  networkShareDown: number;
  /** By operator name: median deviation of its single-operator routes. */
  operators: Record<string, { median: number; routes: number }>;
}

/** period → context, per band. */
export type NetworkContext = Record<TimeBand, Record<string, MonthContext>>;

/** A route-month must have this many trains to count. */
const MIN_TRAINS = 40;
/** ...and a route this many months, so its average means something. */
const MIN_MONTHS = 8;
/** An operator needs this many of its own routes for a month to say anything. */
const MIN_OPERATOR_ROUTES = 4;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

async function computeContext(): Promise<NetworkContext | null> {
  if (!hspConfigured() || !dbConfigured()) return null;
  const sql = neon(process.env.DATABASE_URL!);
  const { periods } = scoreWindow();
  const rows = (await sql`
    SELECT from_crs || '>' || to_crs AS route, period,
      CASE WHEN hour < 9 THEN 'am-peak' WHEN hour >= 16 THEN 'pm-peak' ELSE 'off-peak' END AS band,
      SUM(trains)::int AS trains, SUM(within5)::int AS within5,
      STRING_AGG(DISTINCT NULLIF(toc_codes, ''), ',') AS tocs
    FROM hourly_metrics
    WHERE period = ANY(${periods}) AND hour BETWEEN 6 AND 18
    GROUP BY 1, 2, 3
  `) as { route: string; period: string; band: TimeBand; trains: number; within5: number; tocs: string | null }[];

  const out = { "am-peak": {}, "pm-peak": {}, "off-peak": {} } as NetworkContext;
  for (const band of Object.keys(out) as TimeBand[]) {
    const byRoute = new Map<string, typeof rows>();
    for (const r of rows) {
      if (r.band !== band || r.trains < MIN_TRAINS) continue;
      byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r]);
    }
    const devs = new Map<string, { d: number; op: string | null }[]>();
    for (const months of byRoute.values()) {
      if (months.length < MIN_MONTHS) continue;
      const mean =
        (100 * months.reduce((s, m) => s + m.within5, 0)) /
        months.reduce((s, m) => s + m.trains, 0);
      const codes = new Set(months.flatMap((m) => (m.tocs ?? "").split(",").filter(Boolean)));
      const op = codes.size === 1 ? (tocNamesFor([...codes])[0] ?? null) : null;
      for (const m of months) {
        const list = devs.get(m.period) ?? [];
        list.push({ d: (100 * m.within5) / m.trains - mean, op });
        devs.set(m.period, list);
      }
    }
    for (const [period, list] of devs) {
      const byOp = new Map<string, number[]>();
      for (const x of list) if (x.op) byOp.set(x.op, [...(byOp.get(x.op) ?? []), x.d]);
      const operators: MonthContext["operators"] = {};
      for (const [op, ds] of byOp) {
        if (ds.length >= MIN_OPERATOR_ROUTES) {
          operators[op] = { median: round1(median(ds)), routes: ds.length };
        }
      }
      out[band][period] = {
        networkMedian: round1(median(list.map((x) => x.d))),
        networkShareDown: Math.round((100 * list.filter((x) => x.d <= -5).length) / list.length),
        operators,
      };
    }
  }
  return out;
}

/** Recomputed at most every six hours: it moves only as the ingest lands. */
export const getNetworkContext = unstable_cache(computeContext, ["network-context-v1"], {
  revalidate: 6 * 3600,
});

export interface MonthNote {
  month: string;
  /** This route's on-time deviation from its own average, in points. */
  delta: number;
  kind: "network" | "operator" | "local";
  text: string;
}

/** A month this far below the route's own average gets explained. */
const NOTABLE = -5;

/** Notes for a route's notably bad months, worst first. */
export function monthNotes(
  monthly: MonthlyMetrics[],
  operators: string[],
  band: TimeBand,
  ctx: NetworkContext | null
): MonthNote[] {
  if (!ctx || monthly.length < 6) return [];
  const trains = monthly.reduce((s, m) => s + m.totalTrains, 0);
  const mean = monthly.reduce((s, m) => s + m.onTimePct * m.totalTrains, 0) / trains;
  const notes: MonthNote[] = [];
  for (const m of monthly) {
    const delta = round1(m.onTimePct - mean);
    const c = ctx[band][m.month];
    if (delta > NOTABLE || !c) continue;
    const soFar = m.month === currentMonth() ? "So far this month: " : "";
    const opHit = operators
      .map((name) => ({ name, ...c.operators[name] }))
      .filter((o) => o.median !== undefined && o.median <= NOTABLE)
      .sort((a, b) => a.median - b.median)[0];
    if (c.networkShareDown >= 35 && c.networkMedian <= -2) {
      notes.push({
        month: m.month,
        delta,
        kind: "network",
        text: `${soFar}a bad month across the network, with ${c.networkShareDown}% of routes well below their usual.`,
      });
    } else if (opHit) {
      notes.push({
        month: m.month,
        delta,
        kind: "operator",
        text: `${soFar}${opHit.name} had a bad month across its routes (typically ${Math.abs(Math.round(opHit.median))} points below usual).`,
      });
    } else {
      notes.push({
        month: m.month,
        delta,
        kind: "local",
        text:
          soFar +
          (c.networkMedian >= 2
            ? "just this route, in a month most of the network did better than usual."
            : "mostly this route: the rest of the network was close to normal."),
      });
    }
  }
  return notes.sort((a, b) => a.delta - b.delta).slice(0, 4);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
