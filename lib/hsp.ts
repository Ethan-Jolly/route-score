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

/** The punctuality thresholds asked for, in minutes. One call returns a bucket
 * for each at no extra cost: HSP charges per service, not per number. */
export const TOLERANCES = [1, 5, 10, 15, 30, 60] as const;

/** Trains arriving within each threshold. The 1/10/15/60-minute ones are null
 * on hours stored before they were collected (November 2026). */
export interface Buckets {
  within1: number | null;
  within5: number;
  within10: number | null;
  within15: number | null;
  within30: number;
  within60: number | null;
}

/** One timetabled service's performance over a date range. */
export interface ServiceCounts {
  /** Scheduled departure from the origin, "HHMM". */
  dep: string;
  /** Scheduled arrival at the destination, "HHMM" ("" if unknown). */
  arr: string;
  toc: string;
  /** Runs of this service in the range. */
  trains: number;
  within1: number;
  within5: number;
  within10: number;
  within15: number;
  within30: number;
  within60: number;
}

/** Raw performance for one departure hour of a route over a date range. */
export interface HourCounts extends Buckets {
  hour: number;
  trains: number;
  /** Distinct timetabled services seen — the cost driver, used to size calls. */
  services: number;
  tocCodes: string[];
  /** Timetabled journey minutes summed over `trains`, so the average is
   * journeyMins / trains. Null when not known: hours stored before this was
   * collected, or no service carried usable times. */
  journeyMins: number | null;
  /** The services behind these counts, when they came from HSP just now
   * (absent on rows read back from the database). */
  serviceList?: ServiceCounts[];
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
    /** Scheduled arrival at the queried destination, "HHMM". */
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

/** HSP crashed on the query (500). Some windows trip it on every call — bad
 * data for one service — so narrowing the window steers around it. */
export class HspServerError extends Error {}

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
      tolerance: TOLERANCES.map(String),
    },
    timeoutMs
  );
  if (!res.ok) {
    const message = `HSP serviceMetrics ${res.status} for ${from}-${to} ${range.from}..${range.to} ${fromTime}-${toTime}`;
    throw res.status === 500 ? new HspServerError(message) : new Error(message);
  }
  const data = (await res.json()) as HspMetricsResponse;
  return data.Services ?? [];
}

/** Timetabled minutes from departure to arrival ("HHMM" each), allowing for a
 * journey that runs past midnight. Null if either time is unusable. */
function scheduledMins(ptd: string, pta: string): number | null {
  if (!/^\d{4}$/.test(ptd ?? "") || !/^\d{4}$/.test(pta ?? "")) return null;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(2));
  const d = (mins(pta) - mins(ptd) + 1440) % 1440;
  return d > 0 ? d : null;
}

/** A service's counts per tolerance, keyed "within<n>". */
function serviceBuckets(svc: HspService): Omit<ServiceCounts, "dep" | "arr" | "toc" | "trains"> {
  const out = { within1: 0, within5: 0, within10: 0, within15: 0, within30: 0, within60: 0 };
  for (const metric of svc.Metrics ?? []) {
    const key = `within${metric.tolerance_value}` as keyof typeof out;
    if (key in out) out[key] += Number(metric.num_tolerance) || 0;
  }
  return out;
}

/** Bucket services into the given hours by scheduled departure time. Every
 * requested hour gets a row (zeros included) so "fetched, no trains" is
 * distinguishable from "not fetched". */
function bucketByHour(services: HspService[], hours: number[]): HourCounts[] {
  const rows = new Map<
    number,
    HourCounts & {
      tocs: Set<string>;
      timed: number;
      mins: number;
      byService: Map<string, ServiceCounts>;
    }
  >();
  for (const h of hours) {
    rows.set(h, {
      hour: h,
      trains: 0,
      within1: 0,
      within5: 0,
      within10: 0,
      within15: 0,
      within30: 0,
      within60: 0,
      services: 0,
      tocCodes: [],
      journeyMins: null,
      tocs: new Set(),
      timed: 0,
      mins: 0,
      byService: new Map(),
    });
  }
  const first = hours[0];
  const last = hours[hours.length - 1];
  for (const svc of services) {
    const attrs = svc.serviceAttributesMetrics;
    const h = Number(attrs.gbtt_ptd?.slice(0, 2));
    // Anything HSP returns outside the window is clamped into it, not dropped.
    const row = rows.get(Number.isFinite(h) ? Math.min(last, Math.max(first, h)) : first)!;
    const matched = Number(attrs.matched_services) || 0;
    row.services++;
    row.trains += matched;
    const journey = scheduledMins(attrs.gbtt_ptd, attrs.gbtt_pta);
    if (journey !== null) {
      row.timed += matched;
      row.mins += matched * journey;
    }
    if (attrs.toc_code) row.tocs.add(attrs.toc_code);
    const b = serviceBuckets(svc);
    row.within1! += b.within1;
    row.within5 += b.within5;
    row.within10! += b.within10;
    row.within15! += b.within15;
    row.within30 += b.within30;
    row.within60! += b.within60;

    // The same timetable slot can come back as more than one service (a
    // pattern that changed mid-range); they are one train to a commuter.
    const dep = /^\d{4}$/.test(attrs.gbtt_ptd ?? "") ? attrs.gbtt_ptd : "";
    if (!dep) continue;
    const arr = /^\d{4}$/.test(attrs.gbtt_pta ?? "") ? attrs.gbtt_pta : "";
    const key = `${dep}|${arr}|${attrs.toc_code ?? ""}`;
    const prev = row.byService.get(key);
    if (prev) {
      prev.trains += matched;
      for (const k of Object.keys(b) as (keyof typeof b)[]) prev[k] += b[k];
    } else {
      row.byService.set(key, { dep, arr, toc: attrs.toc_code ?? "", trains: matched, ...b });
    }
  }
  return hours.map((h) => {
    const { tocs, timed, mins, byService, ...row } = rows.get(h)!;
    // Scaled up to cover any trains whose service had no usable times.
    const journeyMins =
      row.trains === 0 ? 0 : timed > 0 ? Math.round((mins * row.trains) / timed) : null;
    return {
      ...row,
      tocCodes: [...tocs],
      journeyMins,
      serviceList: [...byService.values()].filter((s) => s.trains > 0),
    };
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
 * calls as its service density allows. Chunks that time out or crash HSP are
 * halved, down to 15-minute slices of a single hour. Returns the rows fetched
 * and whether every requested hour was covered (false only when `deadline` cut
 * it short); `timedOut` says a call was too big for `timeoutMs`, so a caller on
 * a tight budget can come back with a smaller `maxSpanMinutes`. `skipped` lists
 * 15-minute slices HSP still crashed on: their hour is stored without them.
 */
export async function fetchHspHours(
  from: string,
  to: string,
  range: DateRange,
  hours: number[],
  opts: FetchHoursOptions = {}
): Promise<{ rows: HourCounts[]; complete: boolean; timedOut: boolean; skipped: string[] }> {
  const target = opts.targetServices ?? 30;
  const timeoutMs = opts.timeoutMs ?? 110_000;
  const maxSpan = opts.maxSpanMinutes ?? Infinity;
  const known = new Map(opts.hint ?? []);
  let fallbackDensity: number | null = null;
  let maxLen = maxSpan < 120 ? 1 : Math.floor(maxSpan / 60);

  const pending = [...new Set(hours)].sort((a, b) => a - b);
  const out: HourCounts[] = [];
  let timedOut = false;
  const skipped: string[] = [];
  const partial = () => ({ rows: out, complete: false, timedOut, skipped });

  const land = async (rows: HourCounts[]) => {
    for (const r of rows) known.set(r.hour, r.services);
    out.push(...rows);
    if (opts.onChunk) await opts.onChunk(rows);
  };
  const expired = () => opts.deadline !== undefined && Date.now() >= opts.deadline;

  /** One hour, split into sub-hour slices when it is too dense for one call.
   * At the smallest span a slice HSP crashes on is left out, as long as the
   * rest of the hour came back — if every slice fails, HSP itself is down. */
  const fetchHour = async (hour: number, span: number): Promise<HourCounts> => {
    const parts: HspService[] = [];
    const broken: string[] = [];
    let lastError: unknown;
    for (let start = 0; start < 60; start += span) {
      const end = Math.min(60, start + span) - 1;
      const window = `${pad(hour)}${pad(start)}-${pad(hour)}${pad(end)}`;
      try {
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
      } catch (e) {
        if (!(e instanceof HspServerError) || span > MIN_SPAN_MINUTES) throw e;
        broken.push(window);
        lastError = e;
      }
    }
    if (broken.length * span >= 60) throw lastError;
    skipped.push(...broken);
    return bucketByHour(parts, [hour])[0];
  };
  const fetchHourAdaptive = async (hour: number): Promise<HourCounts> => {
    for (let span = Math.min(60, maxSpan); ; span = Math.ceil(span / 2)) {
      try {
        return await fetchHour(hour, span);
      } catch (e) {
        if (e instanceof HspTimeoutError) timedOut = true;
        else if (!(e instanceof HspServerError)) throw e;
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
        // Denser than expected, or HSP crashed on something in it: retry this
        // stretch in smaller chunks.
        if (e instanceof HspTimeoutError) timedOut = true;
        else if (!(e instanceof HspServerError)) throw e;
        maxLen = Math.ceil(chunk.length / 2);
        continue;
      }
    }
    i = j;
  }
  return { rows: out, complete: true, timedOut, skipped };
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
