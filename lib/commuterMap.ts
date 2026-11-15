/**
 * "Where should I live?": every place with a direct train into a chosen hub,
 * with its score and expected journey time, placed on a map.
 *
 * Built from the station page's data (every stored route into a station), so
 * it covers whatever the ingest and visitors have filled — the curated
 * commuter belt plus anything looked up — never the whole network.
 */

import coords from "./data/station-coords.json";
import { getStationRoutes } from "./provider";
import { LONDON_TERMINALS } from "./routes";
import { stationByCrs } from "./stations";
import type { TimeBand } from "./types";

const COORDS = coords as unknown as Record<string, [number, number]>;

export interface Hub {
  id: string;
  name: string;
  /** Stations a journey can end at to count as reaching this hub. */
  stations: string[];
}

/** "Any London terminal" first, then each terminal, then other big cities. */
export const HUBS: Hub[] = [
  { id: "london", name: "Any London terminal", stations: Object.keys(LONDON_TERMINALS) },
  ...Object.entries(LONDON_TERMINALS).map(([crs, name]) => ({ id: crs, name, stations: [crs] })),
  ...["MAN", "BHM", "LDS", "BRI", "NCL", "GLC", "EDB", "CDF", "LIV", "SHF", "NOT"].map((crs) => ({
    id: crs,
    name: stationByCrs(crs)?.name ?? crs,
    stations: [crs],
  })),
];

export interface MapPoint {
  crs: string;
  name: string;
  lat: number;
  lon: number;
  /** The hub station of this place's best route. */
  hubCrs: string;
  hubName: string;
  /** The route page for that route, which runs into the hub (AM peak and
   * off-peak) or out of it (PM peak, the journey home). */
  href: string;
  score: number;
  onTimePct: number;
  /** Timetabled minutes plus average delay, when known. */
  expectedMins: number | null;
  gapMins: number;
}

export interface CommuterMap {
  hub: Hub;
  centre: [number, number];
  points: MapPoint[];
}

export async function getCommuterMap(hubId: string, band: TimeBand): Promise<CommuterMap | null> {
  const hub = HUBS.find((h) => h.id === hubId);
  if (!hub) return null;
  // The evening commute runs home from the hub, so it's the hub's departures.
  const homeward = band === "pm-peak";
  const routes = (
    await Promise.all(hub.stations.map((crs) => getStationRoutes(crs, band)))
  ).flatMap((r) => (homeward ? r.departures : r.arrivals));

  // One point per place: its best-scoring route to or from the hub.
  const best = new Map<string, MapPoint>();
  for (const r of routes) {
    const [place, hubStation] = homeward ? [r.to, r.from] : [r.from, r.to];
    if (hub.stations.includes(place.crs)) continue;
    const c = COORDS[place.crs];
    if (!c) continue;
    const prev = best.get(place.crs);
    if (prev && prev.score >= r.score) continue;
    best.set(place.crs, {
      crs: place.crs,
      name: place.name,
      lat: c[0],
      lon: c[1],
      hubCrs: hubStation.crs,
      hubName: hubStation.name,
      href: `/route/${r.from.crs}-${r.to.crs}?band=${band}`,
      score: r.score,
      onTimePct: r.onTimePct,
      expectedMins: r.expectedMins ?? null,
      gapMins: r.gapMins,
    });
  }

  const hubCoords = hub.stations.map((s) => COORDS[s]).filter(Boolean);
  const centre: [number, number] = hubCoords.length
    ? [
        hubCoords.reduce((s, c) => s + c[0], 0) / hubCoords.length,
        hubCoords.reduce((s, c) => s + c[1], 0) / hubCoords.length,
      ]
    : [52.5, -1.5];
  return {
    hub,
    centre,
    points: [...best.values()].sort((a, b) => b.score - a.score),
  };
}
