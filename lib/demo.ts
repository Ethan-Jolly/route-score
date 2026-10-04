/**
 * Demo data provider.
 *
 * Generates deterministic, plausible route performance data seeded by the
 * route identity (from + to + time band), so every route URL is stable and
 * shareable without HSP API credentials. Includes real-world texture:
 * routes have a fixed "character" (some good, some bad), AM peak is slightly
 * worse than off-peak, and autumn/winter months dip (leaf fall, December
 * disruption) the way UK rail performance actually does.
 */

import type { MonthlyMetrics, TimeBand } from "./types";
import { BAND_HOURS, gapBetweenTrains, last12Months } from "./score";
import { monthEnd, weekdaysBetween } from "./periods";

/** Small deterministic PRNG (mulberry32) seeded from a string. */
function seededRandom(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAND_PENALTY: Record<TimeBand, number> = {
  "am-peak": 4,
  "pm-peak": 5.5,
  "off-peak": 0,
};

/** Seasonal on-time penalty by calendar month (1–12). UK rail's shape. */
const SEASONAL_PENALTY = [2, 1, 0, 0, 0, 1, 3, 2, 0, 4, 6, 7];

export function demoMonthlyMetrics(
  from: string,
  to: string,
  band: TimeBand,
  now = new Date()
): MonthlyMetrics[] {
  const rand = seededRandom(`${from}-${to}`);

  // Route character: base on-time % between ~62 and ~93.
  const baseOnTime = 62 + rand() * 31;
  // Reliability tracks on-time but is higher (most late trains still run).
  const baseReliability = 88 + (baseOnTime - 62) * 0.32 + rand() * 2;
  // Worse routes also have worse delays when late.
  const baseDelay = 5 + (93 - baseOnTime) * 0.22 + rand() * 2;
  // Service volume: 25–85 trains/day all-day, scaled to the band's share.
  const bandScale = band === "off-peak" ? 0.45 : 0.22;
  const dailyServices = Math.max(4, Math.round((25 + rand() * 60) * bandScale));
  // Year-long drift: some routes are genuinely getting better or worse.
  // Spread up to ±7 points of on-time % across the 12 months.
  const drift = (rand() - 0.5) * 14;

  const monthRand = seededRandom(`${from}-${to}-${band}-months`);
  const months = last12Months(now);

  return months.map((month, i) => {
    const m = Number(month.split("-")[1]);
    const noise = () => (monthRand() - 0.5) * 2;
    const driftNow = drift * (i / (months.length - 1) - 0.5);

    const onTimePct = clamp(
      baseOnTime - BAND_PENALTY[band] - SEASONAL_PENALTY[m - 1] + driftNow + noise() * 4,
      35,
      99
    );
    const reliabilityPct = clamp(
      baseReliability - BAND_PENALTY[band] * 0.4 - SEASONAL_PENALTY[m - 1] * 0.5 + driftNow * 0.3 + noise() * 1.5,
      70,
      99.8
    );
    const avgDelayMins = clamp(
      baseDelay + SEASONAL_PENALTY[m - 1] * 0.35 + BAND_PENALTY[band] * 0.2 - driftNow * 0.15 + noise() * 1.2,
      2,
      25
    );

    // ~21-22 weekdays per month; December has fewer services, summer dips.
    const monthScale = m === 12 ? 0.82 : m === 8 ? 0.92 : 1;
    const totalTrains = Math.round(dailyServices * 21.5 * monthScale * (0.95 + monthRand() * 0.1));

    return {
      month,
      totalTrains,
      onTimePct: round1(onTimePct),
      reliabilityPct: round1(reliabilityPct),
      avgDelayMins: round1(avgDelayMins),
      gapMins: gapBetweenTrains(
        totalTrains,
        weekdaysBetween(`${month}-01`, monthEnd(month)),
        BAND_HOURS[band].length
      ),
    };
  });
}

/** A plausible timetabled journey time for a route: 18–140 minutes, the same
 * in both directions. */
export function demoJourneyMins(from: string, to: string): number {
  const rand = seededRandom(`${[from, to].sort().join("-")}-journey`);
  return Math.round(18 + rand() * rand() * 122);
}

/** Plausible primary operators, keyed by which stations the route touches. */
const OPERATOR_HINTS: Array<{ stations: string[]; operators: string[] }> = [
  { stations: ["BTN", "HOV", "WRH", "LWS", "EBN", "HHE", "TBD", "GTW", "HRH"], operators: ["Southern", "Thameslink"] },
  { stations: ["LBG", "CHX", "CST", "SEV", "TON", "TBW", "HGS", "ORP", "DFD", "GRV", "LEW", "GNW", "WWA"], operators: ["Southeastern"] },
  { stations: ["CBW", "CBE", "AFK", "DVP", "FKC", "RAM", "MAR", "MDE", "BMS"], operators: ["Southeastern"] },
  { stations: ["WAT", "SUR", "WIM", "WOK", "GLD", "BSK", "WIN", "SOU", "PMH", "PMS", "BMH", "POO", "SAL", "CLJ", "EPS", "SUT", "HAV"], operators: ["South Western Railway"] },
  { stations: ["PAD", "RDG", "DID", "SWI", "BTH", "BRI", "BPW", "OXF", "EXD", "PLY", "PNZ", "TAU", "CDF", "SWA", "NWP"], operators: ["Great Western Railway"] },
  { stations: ["EUS", "MKC", "NMP", "COV", "BHM", "WVH", "STA", "CRE", "PRE", "LAN", "CAR", "GLC", "NUN", "LIV", "MAN"], operators: ["Avanti West Coast", "London Northwestern Railway"] },
  { stations: ["KGX", "PBO", "SVG", "DON", "YRK", "DAR", "DHM", "NCL", "EDB", "LDS", "WKF", "HUL"], operators: ["LNER", "Great Northern"] },
  { stations: ["STP", "LUT", "SAC", "LEI", "NOT", "DBY", "SHF"], operators: ["East Midlands Railway", "Thameslink"] },
  { stations: ["LST", "CHM", "COL", "IPS", "NRW", "CBG", "ELY", "SSD", "SRA", "SOV"], operators: ["Greater Anglia"] },
  { stations: ["FST", "SOC"], operators: ["c2c"] },
  { stations: ["MYB", "HWY", "BAN", "BMO"], operators: ["Chiltern Railways"] },
  { stations: ["MAN", "MCV", "MCO", "MIA", "LDS", "SHF", "HUL", "BDI", "HFX", "HUD", "HGT", "MBR", "YRK", "NCL"], operators: ["Northern", "TransPennine Express"] },
  { stations: ["GLQ", "HYM", "ABD", "DEE", "INV", "STG", "PTH"], operators: ["ScotRail"] },
  { stations: ["CTR", "SHR", "WRX"], operators: ["Transport for Wales"] },
];

export function demoOperators(from: string, to: string): string[] {
  const hits = new Map<string, number>();
  for (const hint of OPERATOR_HINTS) {
    const matches =
      (hint.stations.includes(from) ? 1 : 0) + (hint.stations.includes(to) ? 1 : 0);
    if (matches > 0) {
      for (const op of hint.operators) {
        hits.set(op, (hits.get(op) ?? 0) + matches);
      }
    }
  }
  if (hits.size === 0) return ["National Rail"];
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([op]) => op);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
