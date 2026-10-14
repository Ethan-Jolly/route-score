/**
 * A Tube leg of a journey: a mainline station and a Tube station, either way
 * round.
 *
 * There's no Tube equivalent of HSP's train-by-train punctuality, so a Tube
 * leg isn't scored like a train route. It gets:
 *   - its route, walk and time on the trains from TfL's journey planner, from
 *     the mainline station itself so the walk to the platforms counts;
 *   - its frequency from TfL's timetable for the first line taken;
 *   - its reliability from the line-status history (scripts/tfl-status.ts):
 *     the share of weekday samples in the time band each line ran a good
 *     service, and the share it was severely disrupted or closed.
 *
 * Planned journeys are stored for a week; the history is read fresh.
 */

import { BAND_HOURS } from "./score";
import {
  countDepartures,
  londonTime,
  nextWeekday,
  planTubeJourney,
  tflConfigured,
  type PlannedRide,
  type Place,
} from "./tfl";
import { dbConfigured, ensureSchema, getLineHistory, getTflJourney, putTflJourney } from "./db";
import { interchangeFor, tubeStationById } from "./tubeStations";
import type { Station, TimeBand } from "./types";

/** A line needs this many weekdays of status history before it's shown. */
export const MIN_HISTORY_DAYS = 5;
/** Status history older than this is left out, matching a route's year. */
const HISTORY_DAYS = 365;
const JOURNEY_MAX_AGE_DAYS = 7;

/** When in each band the planner is asked about: a typical time to travel. */
const BAND_TIME: Record<TimeBand, string> = {
  "am-peak": "0800",
  "pm-peak": "1730",
  "off-peak": "1200",
};

export interface LineReliability {
  line: string;
  name: string;
  /** % of weekday samples in the band with a good service (0–100). */
  goodPct: number;
  /** % severely delayed, suspended or closed. */
  severePct: number;
  days: number;
  since: string;
}

export interface TubeLeg {
  from: Station;
  to: Station;
  /** The Tube trains taken, in order; empty when it's quicker to walk. */
  rides: PlannedRide[];
  /** Door to door as planned, from the first departure. */
  minutes: number;
  walkMins: number;
  /** Average minutes between trains on the first line; null if unknown. */
  gapMins: number | null;
  /** Typical wait for the first train: half the gap. */
  waitMins: number;
  /** Status history for each line taken, once it has MIN_HISTORY_DAYS. */
  lines: LineReliability[];
  /** Lines taken that are still collecting history, with how far they've got. */
  collecting: { line: string; name: string; days: number }[];
  /** Every line has a good service: their good shares multiplied, as with
   * two trains. Null until every line has enough history. */
  goodPct: number | null;
  /** Any line severely disrupted or closed. */
  severePct: number | null;
}

export type TubeOutcome =
  | { ok: true; leg: TubeLeg }
  | { ok: false; reason: "unavailable" | "no-route" | "error" };

interface Planned {
  minutes: number;
  walkMins: number;
  rides: PlannedRide[];
  gapMins: number | null;
}

/** Where a station of the leg is for the planner: the Tube station itself,
 * or the mainline station's location. */
function placeOf(s: Station): Place | null {
  if (tubeStationById(s.crs)) return { id: s.crs };
  const i = interchangeFor(s.crs);
  return i ? { lat: i.lat, lon: i.lon } : null;
}

async function plan(from: Place, to: Place, band: TimeBand): Promise<Planned | null> {
  const journey = await planTubeJourney(from, to, nextWeekday(), BAND_TIME[band]);
  if (!journey) return null;
  let gapMins: number | null = null;
  const first = journey.rides[0];
  if (first) {
    const hours = BAND_HOURS[band];
    const count = await countDepartures(first.line, first.from, first.to, hours).catch(
      () => null
    );
    if (count) gapMins = Math.round((hours.length * 60 * 10) / count) / 10;
  }
  return { ...journey, gapMins };
}

/** A Tube leg between a mainline interchange and a Tube station (either way
 * round) in a time band. */
export async function getTubeLeg(from: Station, to: Station, band: TimeBand): Promise<TubeOutcome> {
  if (!tflConfigured()) return { ok: false, reason: "unavailable" };
  const a = placeOf(from);
  const b = placeOf(to);
  if (!a || !b) return { ok: false, reason: "no-route" };

  const useDb = dbConfigured();
  const key = `${from.crs}>${to.crs}|${band}`;
  let planned: Planned | null = null;
  try {
    if (useDb) {
      await ensureSchema();
      planned = await getTflJourney<Planned>(key, JOURNEY_MAX_AGE_DAYS);
    }
    if (!planned) {
      planned = await plan(a, b, band);
      if (!planned) return { ok: false, reason: "no-route" };
      if (useDb) await putTflJourney(key, planned);
    }
  } catch {
    return { ok: false, reason: "error" };
  }

  const names = new Map(planned.rides.map((r) => [r.line, r.lineName]));
  const lineIds = [...names.keys()];
  const since = londonTime(new Date(Date.now() - HISTORY_DAYS * 86_400_000)).day;
  const history = useDb
    ? await getLineHistory(lineIds, BAND_HOURS[band], since).catch(() => [])
    : [];
  const byLine = new Map(history.map((h) => [h.line, h]));

  const lines: LineReliability[] = [];
  const collecting: TubeLeg["collecting"] = [];
  for (const line of lineIds) {
    const h = byLine.get(line);
    const name = names.get(line) ?? line;
    if (!h || h.days < MIN_HISTORY_DAYS || h.samples === 0) {
      collecting.push({ line, name, days: h?.days ?? 0 });
      continue;
    }
    lines.push({
      line,
      name,
      goodPct: round1((h.good / h.samples) * 100),
      severePct: round1(((h.severe + h.closed) / h.samples) * 100),
      days: h.days,
      since: h.since,
    });
  }

  const complete = collecting.length === 0 && lines.length > 0;
  return {
    ok: true,
    leg: {
      from,
      to,
      rides: planned.rides,
      minutes: planned.minutes,
      walkMins: planned.walkMins,
      gapMins: planned.gapMins,
      waitMins: planned.gapMins === null ? 0 : Math.round(planned.gapMins / 2),
      lines,
      collecting,
      goodPct: complete
        ? round1(lines.reduce((p, l) => p * (l.goodPct / 100), 1) * 100)
        : null,
      severePct: complete
        ? round1((1 - lines.reduce((p, l) => p * (1 - l.severePct / 100), 1)) * 100)
        : null,
    },
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
