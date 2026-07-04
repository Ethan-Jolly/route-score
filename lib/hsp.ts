/**
 * Client for National Rail's Historical Service Performance (HSP) API.
 *
 * Activated by setting HSP_EMAIL and HSP_PASSWORD (from the National Rail
 * Data Portal, https://opendata.nationalrail.co.uk/). Without credentials the
 * app falls back to the demo data provider.
 *
 * Metric caveats, since serviceMetrics only returns punctuality tolerance
 * buckets (no cancellation counts and no exact lateness minutes):
 * - reliabilityPct is approximated as the % of trains within 30 minutes.
 * - avgDelayMins is estimated from bucket midpoints: trains late by 5–30 min
 *   are assumed ~12 min late, trains beyond 30 min ~40 min late.
 * Exact values would need per-train serviceDetails calls (one per rid), which
 * is too many requests for an MVP. Both caveats are surfaced in the README.
 */

import type { TimeBand } from "./types";
import { BAND_TIMES } from "./score";

const HSP_BASE = "https://hsp-prod.rockshore.net/api/v1";

/** One month of route performance as measured from HSP, ready for the cache.
 * `noService` = HSP confirmed no direct trains for this pair/band/month. */
export interface HspMonth {
  month: string;
  totalTrains: number;
  onTimePct: number;
  reliabilityPct: number;
  avgDelayMins: number;
  tocCodes: string[];
  noService: boolean;
}

interface HspMetric {
  tolerance_value: string;
  num_not_tolerance: string;
  num_tolerance: string;
  percent_tolerance: string;
  global_tolerance: boolean;
}

interface HspService {
  serviceAttributesMetrics: {
    origin_location: string;
    destination_location: string;
    gbtt_ptd: string;
    gbtt_pta: string;
    toc_code: string;
    matched_services: string;
    rids: string[];
  };
  Metrics: HspMetric[];
}

interface HspMetricsResponse {
  header: { from_location: string; to_location: string };
  Services: HspService[];
}

export function hspConfigured(): boolean {
  return Boolean(process.env.HSP_EMAIL && process.env.HSP_PASSWORD);
}

function authHeader(): string {
  const creds = `${process.env.HSP_EMAIL}:${process.env.HSP_PASSWORD}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

/**
 * Process-wide gate on concurrent HSP calls. HSP 503s the moment more than ~4
 * requests are in flight per account, and that limit is shared across *all*
 * requests this server is handling — so per-request limiting isn't enough.
 * Everything funnels through here, capped conservatively at 3 to leave headroom.
 */
class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((res) => this.waiters.push(res));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
const hspGate = new Semaphore(3);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST to HSP through the gate, retrying transient 503/429 (which here mean
 * "too many concurrent") with jittered backoff. */
async function hspPost(body: unknown): Promise<Response> {
  return hspGate.run(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${HSP_BASE}/serviceMetrics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader(),
        },
        body: JSON.stringify(body),
      });
      if ((res.status === 503 || res.status === 429) && attempt < 4) {
        await sleep(1200 * (attempt + 1) + Math.random() * 800);
        continue;
      }
      return res;
    }
  });
}

/**
 * Fetch and aggregate one calendar month for a route/band from HSP.
 *
 * HSP takes ~15–25s per call and 503s past ~4 concurrent, so calls are gated
 * (see Semaphore) and retried on transient throttling.
 */
export async function fetchHspMonth(
  from: string,
  to: string,
  band: TimeBand,
  month: string
): Promise<HspMonth> {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  const times = BAND_TIMES[band];

  const res = await hspPost({
    from_loc: from,
    to_loc: to,
    from_time: times.from,
    to_time: times.to,
    from_date: `${month}-01`,
    to_date: `${month}-${String(lastDay).padStart(2, "0")}`,
    days: "WEEKDAY",
    tolerance: ["5", "30"],
  });

  if (!res.ok) {
    throw new Error(`HSP serviceMetrics ${res.status} for ${from}-${to} ${month}`);
  }

  const data = (await res.json()) as HspMetricsResponse;
  const services = data.Services ?? [];

  let total = 0;
  let within5 = 0;
  let within30 = 0;
  const tocs = new Set<string>();
  for (const svc of services) {
    const matched = Number(svc.serviceAttributesMetrics.matched_services) || 0;
    total += matched;
    if (svc.serviceAttributesMetrics.toc_code) {
      tocs.add(svc.serviceAttributesMetrics.toc_code);
    }
    for (const metric of svc.Metrics) {
      const inTolerance = Number(metric.num_tolerance) || 0;
      if (metric.tolerance_value === "5") within5 += inTolerance;
      if (metric.tolerance_value === "30") within30 += inTolerance;
    }
  }

  if (total === 0) {
    // No direct trains for this pair/band/month. Cache the fact so we never
    // re-query it (distinguishes "dead route" from "not yet fetched").
    return {
      month,
      totalTrains: 0,
      onTimePct: 0,
      reliabilityPct: 0,
      avgDelayMins: 0,
      tocCodes: [],
      noService: true,
    };
  }

  const late5to30 = Math.max(0, within30 - within5);
  const over30 = Math.max(0, total - within30);
  const lateTrains = late5to30 + over30;
  const avgDelayMins =
    lateTrains > 0 ? (late5to30 * 12 + over30 * 40) / lateTrains : 0;

  return {
    month,
    totalTrains: total,
    onTimePct: round1((within5 / total) * 100),
    reliabilityPct: round1((within30 / total) * 100),
    avgDelayMins: round1(avgDelayMins),
    tocCodes: [...tocs],
    noService: false,
  };
}

/** Map HSP TOC codes to operator names, in the order given, unknowns dropped. */
export function tocNamesFor(codes: string[]): string[] {
  const names: string[] = [];
  for (const code of codes) {
    const name = TOC_NAMES[code];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** TOC code → operator name, for the route context panel. */
export const TOC_NAMES: Record<string, string> = {
  AW: "Transport for Wales",
  CC: "c2c",
  CH: "Chiltern Railways",
  CS: "Caledonian Sleeper",
  EM: "East Midlands Railway",
  ES: "Eurostar",
  GC: "Grand Central",
  GN: "Great Northern",
  GR: "LNER",
  GW: "Great Western Railway",
  GX: "Gatwick Express",
  HT: "Hull Trains",
  HX: "Heathrow Express",
  IL: "Island Line",
  LD: "Lumo",
  LE: "Greater Anglia",
  LM: "London Northwestern Railway",
  LO: "London Overground",
  ME: "Merseyrail",
  NT: "Northern",
  SE: "Southeastern",
  SN: "Southern",
  SR: "ScotRail",
  SW: "South Western Railway",
  TL: "Thameslink",
  TP: "TransPennine Express",
  VT: "Avanti West Coast",
  XC: "CrossCountry",
  XR: "Elizabeth Line",
};

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
