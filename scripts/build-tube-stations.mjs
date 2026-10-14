/**
 * Builds lib/data/tube-stations.json from the TfL API: every Tube station,
 * and the National Rail stations close enough to change to the Tube at.
 *
 * A Tube station and a mainline station count as an interchange when TfL puts
 * them within RADIUS metres of each other (TfL's own station groupings miss
 * some, Victoria among them). Mainline stations are matched to our CRS codes
 * by name; anything that doesn't match is listed for checking.
 *
 * Run: npm run build:tube-stations (needs TFL_APP_KEY)
 */
import { readFileSync, writeFileSync } from "node:fs";

const KEY = process.env.TFL_APP_KEY;
if (!KEY) {
  console.error("TFL_APP_KEY must be set.");
  process.exit(1);
}
const RADIUS = 400;

async function tfl(path, params = {}) {
  const url = new URL(path, "https://api.tfl.gov.uk");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("app_key", KEY);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`TfL ${res.status} for ${path}`);
  }
}

/** Station names compared loosely: no punctuation, "and" for "&", and no
 * "Rail Station"/"Underground Station" boilerplate. */
const norm = (name) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bst\./g, "st")
    .replace(/\b(rail|railway|underground|dlr)?\s*station\b/g, "")
    .replace(/[^a-z0-9()]+/g, " ")
    .trim();
const bare = (name) => norm(name).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();

const ours = JSON.parse(readFileSync("lib/data/stations.json", "utf8"));
// A few names carry more than one CRS (e.g. Highbury & Islington is HHY and
// HII), so a name maps to every code it has.
const index = (key) => {
  const m = new Map();
  for (const s of ours) m.set(key(s.name), [...(m.get(key(s.name)) ?? []), s]);
  return m;
};
const exact = index(norm);
const loose = index(bare);
const crsFor = (name) => {
  const hit = exact.get(norm(name));
  if (hit) return hit.map((s) => s.crs);
  // Without a disambiguator, "(London)" wins: these are all London stations.
  const near = loose.get(bare(name)) ?? [];
  const london = near.filter((s) => /\(london\)/i.test(s.name));
  return (london.length ? london : near).map((s) => s.crs);
};

const all = await tfl("/StopPoint/Mode/tube");
const tube = all.stopPoints.filter((s) => s.stopType === "NaptanMetroStation");
console.log(`${tube.length} Tube stations`);

const stations = [];
const interchanges = new Map();
const unmatched = new Set();
const queue = [...tube];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      stations.push({
        id: s.id,
        name: s.commonName.replace(/\s+Underground Station$/i, "").trim(),
        lines: s.lines.map((l) => l.id).sort(),
      });
      const near = await tfl("/StopPoint", {
        lat: String(s.lat),
        lon: String(s.lon),
        stopTypes: "NaptanRailStation",
        radius: String(RADIUS),
      });
      for (const r of near.stopPoints) {
        if (!r.modes.includes("national-rail") && !r.modes.includes("overground") && !r.modes.includes("elizabeth-line")) continue;
        const codes = crsFor(r.commonName);
        if (codes.length === 0) unmatched.add(r.commonName);
        for (const crs of codes) {
          if (!interchanges.has(crs)) {
            interchanges.set(crs, { lat: r.lat, lon: r.lon, tube: [] });
          }
          const entry = interchanges.get(crs);
          if (!entry.tube.includes(s.id)) entry.tube.push(s.id);
        }
      }
    }
  })
);

stations.sort((a, b) => a.name.localeCompare(b.name));
const sortedInterchanges = Object.fromEntries(
  [...interchanges.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([crs, e]) => [crs, { ...e, tube: e.tube.sort() }])
);
writeFileSync(
  "lib/data/tube-stations.json",
  JSON.stringify({ stations, interchanges: sortedInterchanges }) + "\n"
);
console.log(
  `Wrote lib/data/tube-stations.json: ${stations.length} Tube stations, ` +
    `${interchanges.size} National Rail interchanges`
);
if (unmatched.size) {
  console.log(`No CRS match for ${unmatched.size} nearby rail stations (left out):`);
  for (const n of [...unmatched].sort()) console.log(`  ${n}`);
}
