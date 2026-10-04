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
};

const hourRange = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => from + i);

/** Departure hours (0–23) each band covers. Performance is stored per hour, so
 * every band is just a sum over its hours — one ingest serves all three.
 * There is deliberately no all-day band: the app compares commuting times,
 * and early-morning/late-evening hours would nearly double the HSP cost. */
export const BAND_HOURS: Record<TimeBand, number[]> = {
  "am-peak": hourRange(6, 9),
  "pm-peak": hourRange(16, 19),
  "off-peak": hourRange(9, 16),
};

/** Every hour some band uses (06:00–18:59) — all the ingest ever fetches. */
export const STORED_HOURS = hourRange(6, 19);

/** Both commuter peaks together — what the leaderboard ranks on. */
export const PEAK_HOURS = [...BAND_HOURS["am-peak"], ...BAND_HOURS["pm-peak"]];

/**
 * Average minutes between trains: the band's length shared out among the
 * trains that ran in it per weekday. Half of this is the typical wait for
 * someone who turns up without checking the timetable.
 */
export function gapBetweenTrains(
  trains: number,
  weekdays: number,
  bandHours: number
): number {
  if (trains <= 0) return 0;
  return round1((bandHours * 60 * Math.max(1, weekdays)) / trains);
}

/**
 * Percentages from raw punctuality counts. HSP gives tolerance buckets only,
 * so reliability ≈ % within 30 min and average delay is estimated from bucket
 * midpoints (5–30 min late ≈ 12 min, 30+ min ≈ 40 min).
 */
export function metricsFromCounts(
  trains: number,
  within5: number,
  within30: number
): { onTimePct: number; reliabilityPct: number; avgDelayMins: number } {
  if (trains <= 0) return { onTimePct: 0, reliabilityPct: 0, avgDelayMins: 0 };
  const late5to30 = Math.max(0, within30 - within5);
  const over30 = Math.max(0, trains - within30);
  const late = late5to30 + over30;
  return {
    onTimePct: round1((within5 / trains) * 100),
    reliabilityPct: round1((within30 / trains) * 100),
    avgDelayMins: late > 0 ? round1((late5to30 * 12 + over30 * 40) / late) : 0,
  };
}

export function isTimeBand(value: string): value is TimeBand {
  return ["am-peak", "pm-peak", "off-peak"].includes(value);
}

/** Each component's share of the score. The spec's original three, with a
 * tenth taken from on-time to make room for how often trains run. */
export const SCORE_WEIGHTS = {
  onTime: 0.5,
  reliability: 0.25,
  delay: 0.15,
  frequency: 0.1,
};

/** A train every 10 minutes or better is full marks; each minute of gap
 * beyond that costs a point, so an hourly service scores 50 here. */
const FREQUENCY_FREE_MINS = 10;
const FREQUENCY_POINTS_PER_MIN = 1;

/** The composite formula: 50% on-time, 25% reliability, 15% delay severity,
 * 10% frequency. */
export function compositeScore(
  onTimePct: number,
  reliabilityPct: number,
  avgDelayMins: number,
  gapMins: number
): { score: number; breakdown: ScoreBreakdown } {
  const onTimeScore = clamp(onTimePct, 0, 100);
  const reliabilityScore = clamp(reliabilityPct, 0, 100);
  const delayScore = clamp(100 - avgDelayMins * 5, 0, 100);
  const frequencyScore = clamp(
    100 - (gapMins - FREQUENCY_FREE_MINS) * FREQUENCY_POINTS_PER_MIN,
    0,
    100
  );
  const score =
    onTimeScore * SCORE_WEIGHTS.onTime +
    reliabilityScore * SCORE_WEIGHTS.reliability +
    delayScore * SCORE_WEIGHTS.delay +
    frequencyScore * SCORE_WEIGHTS.frequency;
  return {
    score: Math.round(score),
    breakdown: {
      onTimeScore: Math.round(onTimeScore),
      reliabilityScore: Math.round(reliabilityScore),
      delayScore: Math.round(delayScore),
      frequencyScore: Math.round(frequencyScore),
    },
  };
}

export function verdictFor(score: number): string {
  if (score >= 90) return "Runs like clockwork";
  if (score >= 75) return "Mostly reliable, with the odd bad day";
  if (score >= 60) return "Expect delays a couple of times a week";
  if (score >= 40) return "Delays are a regular feature";
  return "Consider cycling";
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
    score: compositeScore(m.onTimePct, m.reliabilityPct, m.avgDelayMins, m.gapMins)
      .score,
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
  gapMins: number;
  totalTrains: number;
} {
  const totalTrains = monthly.reduce((s, m) => s + m.totalTrains, 0);
  if (totalTrains === 0) {
    return { onTimePct: 0, reliabilityPct: 0, avgDelayMins: 0, gapMins: 0, totalTrains: 0 };
  }
  const w = (f: (m: MonthlyMetrics) => number) =>
    monthly.reduce((s, m) => s + f(m) * m.totalTrains, 0) / totalTrains;
  return {
    onTimePct: round1(w((m) => m.onTimePct)),
    reliabilityPct: round1(w((m) => m.reliabilityPct)),
    avgDelayMins: round1(w((m) => m.avgDelayMins)),
    // Train-weighting a gap gives total band time over total trains — the
    // true average gap across the months.
    gapMins: round1(w((m) => m.gapMins)),
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

/** Minutes as "45 min", "1h" or "1h 20m". */
export function formatMins(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return rest === 0 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 60)}h ${rest}m`;
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
