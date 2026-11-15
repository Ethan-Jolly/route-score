/**
 * Builds lib/data/station-coords.json — CRS → [lat, lon], 4 decimal places
 * (~10 m) — for the commuter map. Merges two public datasets, the first one
 * winning where both have a station. Only stations in stations.json are kept.
 *
 * Run: node scripts/build-station-coords.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const SOURCES = [
  {
    url: "https://raw.githubusercontent.com/davwheat/uk-railway-stations/main/stations.csv",
    cols: { crs: "crsCode", lat: "lat", lon: "long" },
  },
  {
    url: "https://raw.githubusercontent.com/ellcom/UK-Train-Station-Locations/master/uk-train-stations.csv",
    cols: { crs: "station_code", lat: "latitude", lon: "longitude" },
  },
];

/** Quote-aware CSV line split (names can contain commas). */
function splitCsv(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const known = new Set(
  JSON.parse(readFileSync(new URL("../lib/data/stations.json", import.meta.url))).map((s) => s.crs)
);
const coords = {};
for (const { url, cols } of SOURCES) {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`skip ${url}: ${res.status}`);
    continue;
  }
  const lines = (await res.text()).split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsv(lines[0]);
  const idx = Object.fromEntries(Object.entries(cols).map(([k, name]) => [k, header.indexOf(name)]));
  let added = 0;
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    const crs = (c[idx.crs] ?? "").toUpperCase();
    const lat = Number(c[idx.lat]);
    const lon = Number(c[idx.lon]);
    // Rough Great Britain bounding box, to drop bad rows.
    if (!known.has(crs) || coords[crs] || !(lat > 49 && lat < 61 && lon > -9 && lon < 2.5)) continue;
    coords[crs] = [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4];
    added++;
  }
  console.log(`${url}: ${added} stations`);
}

const sorted = Object.fromEntries(Object.entries(coords).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL("../lib/data/station-coords.json", import.meta.url), JSON.stringify(sorted));
console.log(`Wrote ${Object.keys(sorted).length} of ${known.size} stations.`);
