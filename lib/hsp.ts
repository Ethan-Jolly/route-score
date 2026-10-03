/**
 * Client for National Rail's Historical Service Performance (HSP) API.
 *
 * Activated by setting HSP_EMAIL and HSP_PASSWORD (from the National Rail
 * Data Portal, https://opendata.nationalrail.co.uk/). Without credentials the
 * app falls back to the demo data provider.
 *
 * How HSP behaves (measured, Oct 2026), which shapes everything here:
 * - A call costs ~1–1.7s per distinct timetabled service it returns. The date
 *   range is almost free; the time-of-day window is what matters.
 * - HSP's own gateway gives up at 120s, so a busy route can never be fetched
 *   "all day" in one call. Queries are sliced by departure hour, sized from
 *   how many services each hour is known (or probed) to hold.
 * - More than ~4 concurrent calls per account are rejected with 503.
 *
 * Results are bucketed by departure hour and kept as raw counts, so any time
 * band is a sum over its hours and nothing is fetched twice per band.
 *
 * Metric caveat: serviceMetrics only returns punctuality tolerance buckets (no
 * cancellation counts, no exact lateness), so reliability and average delay
 * are approximations — see metricsFromCounts in score.ts.
 */

const HSP_BASE = "https://hsp-prod.rockshore.net/api/v1";

/** Raw performance for one departure hour of a route over a date range. */
export interface HourCounts {
  hour: number;
  trains: number;
  within5: number;
  within30: number;
  /** Distinct timetabled services seen — the cost driver, used to size calls. */
  services: number;
  tocCodes: string[];
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
    /** Scheduled departure from the queried origin, "HHMM". */
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

/** The call was too big for the time allowed — retry it as smaller slices. */
export class HspTimeoutError extends Error {}

export function hspConfigured(): boolean {
  return Boolean(process.env.HSP_EMAIL && process.env.HSP_PASSWORD);
}

function authHeader(): string {
  const creds = `${process.env.HSP_EMAIL}:${process.env.HSP_PASSWORD}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

/**
 * Process-wide gate on concurrent HSP calls. HSP 503s the moment more than ~4
 * requests are in flight per account, and that limit is shared by everything
 * using the account (the site and the ingest job), so each process stays well
 * under it. Override with HSP_CONCURRENCY.
 */
class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
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
const hspGate = new Semaphore(Number(process.env.HSP_CONCURRENCY) || 2);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (n: number) => String(n).padStart(2, "0");

/** POST to HSP through the gate. Transient 503/429 ("too many concurrent")
 * are retried with jittered backoff; a 504 or our own timeout means the query
 * was too big and surfaces as HspTimeoutError. */
async function hspPost(body: unknown, timeoutMs: number): Promise<Response> {
  return hspGate.run(async () => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${HSP_BASE}/serviceMetrics`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader(),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const name = (e as Error)?.name;
        if (name === "TimeoutError" || name === "AbortError") {
          throw new HspTimeoutError(`HSP call exceeded ${timeoutMs}ms`);
        }
        throw e;
      }
      if (res.status === 504) throw new HspTimeoutError("HSP gateway timeout");
      if ((res.status === 503 || res.status === 429) && attempt < 4) {
        await sleep(1200 * (attempt + 1) + Math.random() * 800);
        continue;
      }
      return res;
    }
  });
}

interface DateRange {
  from: string;
  to: string;
}

/** One HSP call: weekday services departing `from` within [fromTime, toTime]
 * (both inclusive, "HHMM") over the date range. */
async function fetchWindow(
  from: string,
  to: string,
  range: DateRange,
  fromTime: string,
  toTime: string,
  timeoutMs: number
): Promise<HspService[]> {
  const res = await hspPost(
    {
      from_loc: from,
      to_loc: to,
      from_time: fromTime,
      to_time: toTime,
      from_date: range.from,
      to_date: range.to,
      days: "WEEKDAY",
      tolerance: ["5", "30"],
    },
    timeoutMs
  );
  if (!res.ok) {
    throw new Error(
      `HSP serviceMetrics ${res.status} for ${from}-${to} ${range.from}..${range.to} ${fromTime}-${toTime}`
    );
  }
  const data = (await res.json()) as HspMetricsResponse;
  return data.Services ?? [];
}

/** Bucket services into the given hours by scheduled departure time. Every
 * requested hour gets a row (zeros included) so "fetched, no trains" is
 * distinguishable from "not fetched". */
function bucketByHour(services: HspService[], hours: number[]): HourCounts[] {
  const rows = new Map<number, HourCounts & { tocs: Set<string> }>();
  for (const h of hours) {
    rows.set(h, {
      hour: h,
      trains: 0,
      within5: 0,
      within30: 0,
      services: 0,
      tocCodes: [],
      tocs: new Set(),
    });
  }
  const first = hours[0];
  const last = hours[hours.length - 1];
  for (const svc of services) {
    const attrs = svc.serviceAttributesMetrics;
    const h = Number(attrs.gbtt_ptd?.slice(0, 2));
    // Anything HSP returns outside the window is clamped into it, not dropped.
    const row = rows.get(Number.isFinite(h) ? Math.min(last, Math.max(first, h)) : first)!;
    row.services++;
    row.trains += Number(attrs.matched_services) || 0;
    if (attrs.toc_code) row.tocs.add(attrs.toc_code);
    for (const metric of svc.Metrics ?? []) {
      const inTolerance = Number(metric.num_tolerance) || 0;
      if (metric.tolerance_value === "5") row.within5 += inTolerance;
      if (metric.tolerance_value === "30") row.within30 += inTolerance;
    }
  }
  return hours.map((h) => {
    const { tocs, ...row } = rows.get(h)!;
    return { ...row, tocCodes: [...tocs] };
  });
}

export interface FetchHoursOptions {
  /** Services previously seen per hour for this route, to size calls. */
  hint?: Map<number, number>;
  /** Aim for about this many services per call (~1–1.7s each). */
  targetServices?: number;
  /** Per-call timeout. HSP itself gives up at 120s. */
  timeoutMs?: number;
  /** Epoch ms after which no new call is started (for serverless budgets). */
  deadline?: number;
  /** Largest window a single call may cover; below 60 splits within hours. */
  maxSpanMinutes?: number;
  /** Called with each chunk's rows as it lands, so progress can be persisted. */
  onChunk?: (rows: HourCounts[]) => Promise<void>;
}

/** Hour most likely to be a route's busiest, probed first when nothing is
 * known about it, so later calls can be sized from a worst-case density. */
const PROBE_HOURS = [8, 17, 7, 18, 12];
const MIN_SPAN_MINUTES = 15;

/**
 * Fetch the given departure hours of a route for a date range, in as few HSP
 * calls as its service density allows. Chunks that time out are halved, down
 * to 15-minute slices of a single hour. Returns the rows fetched and whether
 * every requested hour was covered (false only when `deadline` cut it short);
 * `timedOut` says a call was too big for `timeoutMs`, so a caller on a tight
 * budget can come back with a smaller `maxSpanMinutes`.
 */
export async function fetchHspHours(
  from: string,
  to: string,
  range: DateRange,
  hours: number[],
  opts: FetchHoursOptions = {}
): Promise<{ rows: HourCounts[]; complete: boolean; timedOut: boolean }> {
  const target = opts.targetServices ?? 30;
  const timeoutMs = opts.timeoutMs ?? 110_000;
  const maxSpan = opts.maxSpanMinutes ?? Infinity;
  const known = new Map(opts.hint ?? []);
  let fallbackDensity: number | null = null;
  let maxLen = maxSpan < 120 ? 1 : Math.floor(maxSpan / 60);

  const pending = [...new Set(hours)].sort((a, b) => a - b);
  const out: HourCounts[] = [];
  let timedOut = false;
  const partial = () => ({ rows: out, complete: false, timedOut });

  const land = async (rows: HourCounts[]) => {
    for (const r of rows) known.set(r.hour, r.services);
    out.push(...rows);
    if (opts.onChunk) await opts.onChunk(rows);
  };
  const expired = () => opts.deadline !== undefined && Date.now() >= opts.deadline;

  /** One hour, split into sub-hour slices when it is too dense for one call. */
  const fetchHour = async (hour: number, span: number): Promise<HourCounts> => {
    const parts: HspService[] = [];
    for (let start = 0; start < 60; start += span) {
      const end = Math.min(60, start + span) - 1;
      parts.push(
        ...(await fetchWindow(
          from,
          to,
          range,
          `${pad(hour)}${pad(start)}`,
          `${pad(hour)}${pad(end)}`,
          timeoutMs
        ))
      );
    }
    return bucketByHour(parts, [hour])[0];
  };
  const fetchHourAdaptive = async (hour: number): Promise<HourCounts> => {
    for (let span = Math.min(60, maxSpan); ; span = Math.ceil(span / 2)) {
      try {
        return await fetchHour(hour, span);
      } catch (e) {
        if (!(e instanceof HspTimeoutError)) throw e;
        timedOut = true;
        if (span <= MIN_SPAN_MINUTES || expired()) throw e;
      }
    }
  };

  // Nothing known about this route: probe its likely-busiest hour first.
  if (pending.every((h) => !known.has(h)) && pending.length > 1) {
    const probe = PROBE_HOURS.find((h) => pending.includes(h)) ?? pending[0];
    if (expired()) return partial();
    let row: HourCounts;
    try {
      row = await fetchHourAdaptive(probe);
    } catch (e) {
      if (e instanceof HspTimeoutError && expired()) return partial();
      throw e;
    }
    fallbackDensity = Math.max(1, row.services);
    pending.splice(pending.indexOf(probe), 1);
    await land([row]);
  }
  const density = (h: number) => known.get(h) ?? fallbackDensity ?? 20;

  let i = 0;
  while (i < pending.length) {
    if (expired()) return partial();

    // Grow a chunk of contiguous hours until it would exceed the target.
    let j = i + 1;
    let est = density(pending[i]);
    while (
      j < pending.length &&
      j - i < maxLen &&
      pending[j] === pending[j - 1] + 1 &&
      est + density(pending[j]) <= target
    ) {
      est += density(pending[j]);
      j++;
    }
    const chunk = pending.slice(i, j);

    if (chunk.length === 1) {
      try {
        await land([await fetchHourAdaptive(chunk[0])]);
      } catch (e) {
        if (e instanceof HspTimeoutError && expired()) return partial();
        throw e;
      }
    } else {
      try {
        const services = await fetchWindow(
          from,
          to,
          range,
          `${pad(chunk[0])}00`,
          `${pad(chunk[chunk.length - 1])}59`,
          timeoutMs
        );
        await land(bucketByHour(services, chunk));
      } catch (e) {
        if (!(e instanceof HspTimeoutError)) throw e;
        // Denser than expected: retry this stretch in smaller chunks.
        timedOut = true;
        maxLen = Math.ceil(chunk.length / 2);
        continue;
      }
    }
    i = j;
  }
  return { rows: out, complete: true, timedOut };
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
