import type {
  MonthlyMetrics,
  MonthlyScore,
  ScoreBreakdown,
  TimeBand,
  Trend,
} from "./types";

export const BAND_LABELS: Record<TimeBand, string> = {
  "am-peak": "AM Peak",
  "pm-peak": "PM Peak",
  "off-peak": "Off-Peak",
  "all-day": "All Day",
};

export const BAND_TIMES: Record<TimeBand, { from: string; to: string }> = {
  "am-peak": { from: "0600", to: "0900" },
  "pm-peak": { from: "1600", to: "1900" },
  "off-peak": { from: "0900", to: "1600" },
  "all-day": { from: "0000", to: "2359" },
};

export function isTimeBand(value: string): value is TimeBand {
  return ["am-peak", "pm-peak", "off-peak", "all-day"].includes(value);
}

/** The spec's composite formula: 60% on-time, 25% reliability, 15% delay severity. */
export function compositeScore(
  onTimePct: number,
  reliabilityPct: number,
  avgDelayMins: number
): { score: number; breakdown: ScoreBreakdown } {
  const onTimeScore = clamp(onTimePct, 0, 100);
  const reliabilityScore = clamp(reliabilityPct, 0, 100);
  const delayScore = clamp(100 - avgDelayMins * 5, 0, 100);
  const score = onTimeScore * 0.6 + reliabilityScore * 0.25 + delayScore * 0.15;
  return {
    score: Math.round(score),
    breakdown: {
      onTimeScore: Math.round(onTimeScore),
      reliabilityScore: Math.round(reliabilityScore),
      delayScore: Math.round(delayScore),
    },
  };
}

export function verdictFor(score: number): string {
  if (score >= 90) return "Excellent — this route runs like clockwork";
  if (score >= 75) return "Good — mostly reliable with occasional hiccups";
  if (score >= 60) return "Fair — expect delays a couple of times a week";
  if (score >= 40) return "Poor — delays are a regular feature";
  return "Dire — consider cycling";
}

export type ScoreTier = "excellent" | "good" | "fair" | "poor" | "dire";

export function tierFor(score: number): ScoreTier {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "fair";
  if (score >= 40) return "poor";
  return "dire";
}

export const TIER_COLORS: Record<ScoreTier, string> = {
  excellent: "#10b981",
  good: "#84cc16",
  fair: "#f59e0b",
  poor: "#f97316",
  dire: "#ef4444",
};

export function monthlyScores(monthly: MonthlyMetrics[]): MonthlyScore[] {
  return monthly.map((m) => ({
    month: m.month,
    score: compositeScore(m.onTimePct, m.reliabilityPct, m.avgDelayMins).score,
  }));
}

/**
 * Trend from the direction of the 3-month moving average: compare the latest
 * 3-month average against the one ending three months earlier.
 */
export function trendFor(scores: MonthlyScore[]): Trend {
  if (scores.length < 6) return "stable";
  const avg = (xs: MonthlyScore[]) =>
    xs.reduce((s, x) => s + x.score, 0) / xs.length;
  const recent = avg(scores.slice(-3));
  const earlier = avg(scores.slice(-6, -3));
  const delta = recent - earlier;
  if (delta > 2) return "improving";
  if (delta < -2) return "degrading";
  return "stable";
}

/** Weighted-by-train-count aggregate of monthly metrics over the whole period. */
export function aggregateMetrics(monthly: MonthlyMetrics[]): {
  onTimePct: number;
  reliabilityPct: number;
  avgDelayMins: number;
  totalTrains: number;
} {
  const totalTrains = monthly.reduce((s, m) => s + m.totalTrains, 0);
  if (totalTrains === 0) {
    return { onTimePct: 0, reliabilityPct: 0, avgDelayMins: 0, totalTrains: 0 };
  }
  const w = (f: (m: MonthlyMetrics) => number) =>
    monthly.reduce((s, m) => s + f(m) * m.totalTrains, 0) / totalTrains;
  return {
    onTimePct: round1(w((m) => m.onTimePct)),
    reliabilityPct: round1(w((m) => m.reliabilityPct)),
    avgDelayMins: round1(w((m) => m.avgDelayMins)),
    totalTrains,
  };
}

export function formatMonth(isoMonth: string): string {
  const [y, m] = isoMonth.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString("en-GB", { month: "short" });
}

export function formatMonthLong(isoMonth: string): string {
  const [y, m] = isoMonth.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

/** The 12 complete calendar months preceding the current one, oldest first. */
export function last12Months(now = new Date()): string[] {
  const months: string[] = [];
  for (let i = 12; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
