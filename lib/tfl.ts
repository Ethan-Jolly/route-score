/**
 * TfL Unified API client (https://api.tfl.gov.uk), for the Tube.
 *
 * HSP is National Rail only, so the Tube is measured differently from a train
 * route: line status is polled and stored (scripts/tfl-status.ts) to build up a
 * history of how often each line runs a good service, and a Tube leg's route,
 * walk and frequency come from TfL's journey planner and timetables.
 *
 * Activated by TFL_APP_KEY. The licence asks for "Powered by TfL Open Data"
 * attribution wherever the data is shown.
 */

const TFL_BASE = "https://api.tfl.gov.uk";

export function tflConfigured(): boolean {
  return Boolean(process.env.TFL_APP_KEY);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a TfL endpoint as JSON. Rate limits (429) and TfL's own 5xx blips are
 * retried with backoff; anything else is an error. */
async function tflGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, TFL_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("app_key", process.env.TFL_APP_KEY ?? "");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    throw new Error(`TfL ${res.status} for ${path}`);
  }
}

// ---- Line status -------------------------------------------------------------

/** How a line is running, coarsely. "closed" is a closure (usually planned
 * engineering); "severe" covers severe delays and suspensions. */
export type StatusCategory = "good" | "minor" | "severe" | "closed";

/** TfL statusSeverity codes (GET /Line/Meta/Severity) → category. Codes about
 * stations rather than trains (exit only, no step-free access) and plain
 * information count as good service. */
const SEVERITY_CATEGORY: Record<number, StatusCategory> = {
  0: "good", // Special Service
  1: "closed", // Closed
  2: "severe", // Suspended
  3: "severe", // Part Suspended
  4: "closed", // Planned Closure
  5: "closed", // Part Closure
  6: "severe", // Severe Delays
  7: "minor", // Reduced Service
  8: "severe", // Bus Service
  9: "minor", // Minor Delays
  10: "good", // Good Service
  11: "closed", // Part Closed
  12: "good", // Exit Only
  13: "good", // No Step Free Access
  14: "good", // Change of frequency
  15: "minor", // Diverted
  16: "severe", // Not Running
  17: "minor", // Issues Reported
  18: "good", // No Issues
  19: "good", // Information
  20: "closed", // Service Closed
};

const CATEGORY_RANK: Record<StatusCategory, number> = {
  good: 0,
  minor: 1,
  closed: 2,
  severe: 3,
};

export interface LineStatus {
  line: string;
  name: string;
  mode: string;
  category: StatusCategory;
  /** TfL's wording for the worst status, e.g. "Minor Delays". */
  description: string;
}

interface TflLine {
  id: string;
  name: string;
  modeName: string;
  lineStatuses: { statusSeverity: number; statusSeverityDescription: string }[];
}

/** Every line's status right now. A line can report several statuses at once
 * (e.g. part closure on one branch, good service elsewhere); the worst wins,
 * since TfL doesn't say which stations each one covers in a usable way. */
export async function getLineStatuses(
  modes = ["tube", "dlr", "elizabeth-line", "overground"]
): Promise<LineStatus[]> {
  const lines = await tflGet<TflLine[]>(`/Line/Mode/${modes.join(",")}/Status`);
  return lines.map((l) => {
    let worst: { category: StatusCategory; description: string } = {
      category: "good",
      description: "Good Service",
    };
    for (const s of l.lineStatuses) {
      const category = SEVERITY_CATEGORY[s.statusSeverity] ?? "good";
      if (CATEGORY_RANK[category] > CATEGORY_RANK[worst.category]) {
        worst = { category, description: s.statusSeverityDescription };
      }
    }
    return { line: l.id, name: l.name, mode: l.modeName, ...worst };
  });
}

// ---- Journeys ---------------------------------------------------------------

/** Where a Tube leg starts or ends: a Tube station, or a point such as a
 * National Rail station's location (so the walk from the platforms counts). */
export type Place = { id: string } | { lat: number; lon: number };

const placeParam = (p: Place) => ("id" in p ? p.id : `${p.lat},${p.lon}`);

export interface PlannedRide {
  line: string;
  lineName: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  minutes: number;
}

export interface PlannedJourney {
  /** Door to door as planned, from the first departure (no initial wait). */
  minutes: number;
  /** Walking within that, e.g. from the mainline platforms to the Tube. */
  walkMins: number;
  /** The Tube trains taken, in order. Empty when walking is quickest. */
  rides: PlannedRide[];
}

interface TflJourneyResult {
  journeys?: {
    duration: number;
    legs: {
      duration: number;
      mode: { id: string };
      departurePoint: { naptanId?: string; commonName?: string };
      arrivalPoint: { naptanId?: string; commonName?: string };
      routeOptions?: { name: string; lineIdentifier?: { id: string } }[];
    }[];
  }[];
}

const stationName = (name = "") => name.replace(/\s+Underground Station$/i, "").trim();

/** TfL's best Tube journey between two places at a given weekday time
 * ("YYYYMMDD", "HHMM"), or null if it finds none. */
export async function planTubeJourney(
  from: Place,
  to: Place,
  date: string,
  time: string
): Promise<PlannedJourney | null> {
  const result = await tflGet<TflJourneyResult>(
    `/Journey/JourneyResults/${placeParam(from)}/to/${placeParam(to)}`,
    { mode: "tube,walking", date, time, timeIs: "Departing" }
  );
  const best = result.journeys?.[0];
  if (!best) return null;
  let walkMins = 0;
  const rides: PlannedRide[] = [];
  for (const leg of best.legs) {
    if (leg.mode.id === "walking") {
      walkMins += leg.duration;
    } else if (leg.mode.id === "tube") {
      const route = leg.routeOptions?.[0];
      rides.push({
        line: route?.lineIdentifier?.id ?? route?.name.toLowerCase() ?? "",
        lineName: route?.name ?? "",
        from: leg.departurePoint.naptanId ?? "",
        fromName: stationName(leg.departurePoint.commonName),
        to: leg.arrivalPoint.naptanId ?? "",
        toName: stationName(leg.arrivalPoint.commonName),
        minutes: leg.duration,
      });
    }
  }
  return { minutes: best.duration, walkMins, rides };
}

interface TflTimetable {
  timetable?: {
    routes?: {
      schedules?: { name: string; knownJourneys: { hour: string; minute: string }[] }[];
    }[];
  };
}

/** Weekday Tube departures from `from` towards `to` on a line, counted within
 * the given hours, or null if TfL has no timetable for it. Uses the
 * Monday–Thursday timetable (Fridays differ only late at night). */
export async function countDepartures(
  line: string,
  from: string,
  to: string,
  hours: number[]
): Promise<number | null> {
  const data = await tflGet<TflTimetable>(`/Line/${line}/Timetable/${from}/to/${to}`);
  const schedules = data.timetable?.routes?.flatMap((r) => r.schedules ?? []) ?? [];
  const weekday =
    schedules.find((s) => /monday/i.test(s.name) && !/friday/i.test(s.name)) ??
    schedules.find((s) => /monday/i.test(s.name));
  if (!weekday) return null;
  const wanted = new Set(hours);
  return weekday.knownJourneys.filter((j) => wanted.has(Number(j.hour))).length;
}

// ---- Time ---------------------------------------------------------------------

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

/** A moment as London wall-clock date ("YYYY-MM-DD"), hour and weekday. */
export function londonTime(at: Date): { day: string; hour: number; weekday: string } {
  const p = Object.fromEntries(londonParts.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}

/** The next weekday after today in London, as "YYYYMMDD" for the planner. */
export function nextWeekday(now = new Date()): string {
  for (let i = 1; i <= 7; i++) {
    const t = londonTime(new Date(now.getTime() + i * 86_400_000));
    if (t.weekday !== "Sat" && t.weekday !== "Sun") return t.day.replaceAll("-", "");
  }
  throw new Error("unreachable");
}
