export type TimeBand = "am-peak" | "pm-peak" | "off-peak";

export interface Station {
  crs: string;
  name: string;
}

/** Raw performance metrics for one calendar month of a route. */
export interface MonthlyMetrics {
  /** ISO month, e.g. "2025-11" */
  month: string;
  totalTrains: number;
  /** % of trains arriving within 5 minutes of schedule (0–100) */
  onTimePct: number;
  /** % of trains not cancelled or 30+ min late (0–100) */
  reliabilityPct: number;
  /** Average minutes late, among late trains only */
  avgDelayMins: number;
}

export interface ScoreBreakdown {
  onTimeScore: number;
  reliabilityScore: number;
  delayScore: number;
}

export type Trend = "improving" | "degrading" | "stable";

export interface MonthlyScore {
  month: string;
  score: number;
}

/** Returned when a station pair has no direct HSP services in any month. */
export interface NoServiceResult {
  noService: true;
  from: Station;
  to: Station;
  band: TimeBand;
}

export interface RouteScoreResult {
  noService: false;
  from: Station;
  to: Station;
  band: TimeBand;
  /** Composite 0–100 score over the full period */
  score: number;
  verdict: string;
  breakdown: ScoreBreakdown;
  /** Aggregate metrics over the full period */
  onTimePct: number;
  reliabilityPct: number;
  avgDelayMins: number;
  totalTrains: number;
  limitedData: boolean;
  trend: Trend;
  monthlyScores: MonthlyScore[];
  monthly: MonthlyMetrics[];
  operators: string[];
  servicesPerDay: number;
  busiestMonth: string;
  quietestMonth: string;
  /** Which data source produced this result */
  source: "hsp" | "demo";
  /** Last date the underlying data covers (YYYY-MM-DD); absent for demo data. */
  dataThrough?: string;
  /** Present while history is still being collected: the score is provisional,
   * built from only the `months` most recent complete months of `total`. */
  coverage?: { months: number; total: number };
}
