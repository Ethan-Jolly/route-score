import stationsData from "./data/stations.json";
import type { Station } from "./types";

export const STATIONS: Station[] = stationsData;

const byCrs = new Map(STATIONS.map((s) => [s.crs, s]));

export function stationByCrs(crs: string): Station | undefined {
  return byCrs.get(crs.toUpperCase());
}

export function searchStations(query: string, limit = 8): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: Station[] = [];
  const contains: Station[] = [];
  for (const s of STATIONS) {
    const name = s.name.toLowerCase();
    if (s.crs.toLowerCase() === q || name.startsWith(q)) starts.push(s);
    else if (name.includes(q)) contains.push(s);
  }
  return [...starts, ...contains].slice(0, limit);
}
