/**
 * A journey with one change, scored from its two direct legs.
 *
 * HSP only knows direct trains, so nothing here is measured end to end: the
 * legs' figures are combined as if their delays were unrelated, and the
 * result goes through the same formula as a direct route.
 */

import { compositeScore, monthlyScores, trendFor, verdictFor } from "./score";
import type {
  MonthlyMetrics,
  MonthlyScore,
  RouteScoreResult,
  ScoreBreakdown,
  Trend,
} from "./types";

type LegMetrics = Pick<
  MonthlyMetrics,
  "onTimePct" | "reliabilityPct" | "avgDelayMins" | "gapMins"
>;

export interface ConnectionResult {
  score: number;
  verdict: string;
  breakdown: ScoreBreakdown;
  /** % of journeys where both trains arrive within 5 minutes */
  onTimePct: number;
  /** % of journeys where neither train is cancelled or 30+ min late */
  reliabilityPct: number;
  /** Average minutes late, among journeys with a late train */
  avgDelayMins: number;
  /** The less frequent leg's gap: it decides how often the journey can be made */
  gapMins: number;
  /** Typical wait at the change: half the second leg's gap */
  changeMins: number;
  /** Timetabled minutes on the two trains; absent until both legs have them. */
  journeyMins?: number;
  /** On-train time, the wait at the change and both legs' average delay. */
  expectedMins?: number;
  trend: Trend;
  /** Months both legs have data for */
  monthlyScores: MonthlyScore[];
  /** Either leg is still built from part of the year. */
  provisional: boolean;
}

/** Both legs have to behave for the journey to: the shares multiply, the
 * delays add, and the less frequent leg sets the frequency. */
export function combineLegs(a: LegMetrics, b: LegMetrics): LegMetrics {
  const onTimePct = (a.onTimePct * b.onTimePct) / 100;
  // Minutes of delay per journey, then shared among only the late journeys to
  // match how a single route's figure is defined.
  const delayPerJourney =
    ((100 - a.onTimePct) / 100) * a.avgDelayMins +
    ((100 - b.onTimePct) / 100) * b.avgDelayMins;
  const lateShare = (100 - onTimePct) / 100;
  return {
    onTimePct: round1(onTimePct),
    reliabilityPct: round1((a.reliabilityPct * b.reliabilityPct) / 100),
    avgDelayMins: lateShare > 0 ? round1(delayPerJourney / lateShare) : 0,
    gapMins: Math.max(a.gapMins, b.gapMins),
  };
}

export function scoreConnection(
  first: RouteScoreResult,
  second: RouteScoreResult
): ConnectionResult {
  const metrics = combineLegs(first, second);
  const { score, breakdown } = compositeScore(
    metrics.onTimePct,
    metrics.reliabilityPct,
    metrics.avgDelayMins,
    metrics.gapMins
  );

  const secondByMonth = new Map(second.monthly.map((m) => [m.month, m]));
  const months: MonthlyMetrics[] = [];
  for (const m of first.monthly) {
    const other = secondByMonth.get(m.month);
    if (!other) continue;
    months.push({
      month: m.month,
      totalTrains: m.totalTrains + other.totalTrains,
      ...combineLegs(m, other),
    });
  }
  const scores = monthlyScores(months);

  const changeMins = Math.round(second.gapMins / 2);
  const timed =
    first.journeyMins !== undefined &&
    second.journeyMins !== undefined &&
    first.expectedMins !== undefined &&
    second.expectedMins !== undefined;

  return {
    score,
    verdict: verdictFor(score),
    breakdown,
    ...metrics,
    changeMins,
    journeyMins: timed ? first.journeyMins! + second.journeyMins! : undefined,
    expectedMins: timed
      ? first.expectedMins! + second.expectedMins! + changeMins
      : undefined,
    trend: trendFor(scores),
    monthlyScores: scores,
    provisional: !!first.coverage || !!second.coverage,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
