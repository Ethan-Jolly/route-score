/**
 * Tube stations, and the National Rail stations you can change to the Tube
 * at. Data only, so the search boxes can use it in the browser; built from
 * the TfL API by scripts/build-tube-stations.mjs.
 *
 * A Tube station travels through the app as a Station whose `crs` is its TfL
 * NaPTAN id (e.g. "940GZZLUOXC"), which no CRS code can be mistaken for.
 */

import data from "./data/tube-stations.json";
import type { Station } from "./types";

export interface TubeStation {
  id: string;
  name: string;
  lines: string[];
}

export interface Interchange {
  /** Where the mainline station is, so the walk to the Tube can be planned. */
  lat: number;
  lon: number;
  /** Tube stations within a short walk. */
  tube: string[];
}

export const TUBE_STATIONS: TubeStation[] = data.stations;
const INTERCHANGES: Record<string, Interchange> = data.interchanges;

const byId = new Map(TUBE_STATIONS.map((s) => [s.id, s]));

export function isTubeId(code: string): boolean {
  return /^940G/i.test(code);
}

export function tubeStationById(id: string): TubeStation | undefined {
  return byId.get(id.toUpperCase());
}

/** A Tube station in the shape the station fields use. */
export function tubeAsStation(s: TubeStation): Station {
  return { crs: s.id, name: s.name };
}

/** Every Tube station, as station-field options. */
export const TUBE_OPTIONS: Station[] = TUBE_STATIONS.map(tubeAsStation);

export function interchangeFor(crs: string): Interchange | undefined {
  return INTERCHANGES[crs.toUpperCase()];
}

/** CRS codes of the mainline stations with the Tube a short walk away. */
export const INTERCHANGE_CRS = new Set(Object.keys(INTERCHANGES));
