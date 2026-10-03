/**
 * Period helpers. A period is a calendar month, "YYYY-MM".
 *
 * HSP data lags real life by about a day, so the freshest picture is the 12
 * complete months plus the current month-to-date. A month's rows are only
 * `final` once they were fetched after the month had fully ended and settled;
 * until then they are a snapshot through `to` and get refreshed by the ingest.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The month in progress, e.g. "2026-10". */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Last calendar day of a period, as YYYY-MM-DD. */
export function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** The most recent date HSP can be expected to have data for. */
export function yesterday(now = new Date()): string {
  return isoDate(new Date(now.getTime() - 86_400_000));
}

export interface PeriodRange {
  /** First date to query (always the 1st). */
  from: string;
  /** Last date to query: month end, or yesterday for the month in progress. */
  to: string;
  /** True when the month is over and settled, so the result never changes. */
  final: boolean;
}

/** The date range to ask HSP for right now, or null if the period has no
 * queryable days yet (e.g. it's the 1st of the month). */
export function periodRange(period: string, now = new Date()): PeriodRange | null {
  const from = `${period}-01`;
  const end = monthEnd(period);
  const yday = yesterday(now);
  if (yday < from) return null;
  return { from, to: yday < end ? yday : end, final: yday > end };
}
