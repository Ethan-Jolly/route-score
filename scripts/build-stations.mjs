/**
 * Builds lib/data/stations.json from a public UK station CRS dataset.
 * Tries a few candidate sources; validates it looks like CRS data before
 * writing. Run: node scripts/build-stations.mjs
 */
import { writeFileSync } from "node:fs";

const CANDIDATES = [
  "https://raw.githubusercontent.com/ellcom/UK-Train-Station-Locations/master/uk-train-stations.csv",
  "https://raw.githubusercontent.com/davwheat/uk-railway-stations/main/stations.csv",
];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const crsIdx = header.findIndex((h) => /crs|3alpha|three|code/.test(h));
  const nameIdx = header.findIndex((h) => /name|station/.test(h));
  if (crsIdx === -1 || nameIdx === -1) return null;
  const out = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    // naive CSV split is fine for these simple datasets
    const cols = line.split(",");
    const crs = (cols[crsIdx] || "").trim().toUpperCase().replace(/"/g, "");
    const name = (cols[nameIdx] || "")
      .trim()
      .replace(/"/g, "")
      // Drop the boilerplate suffixes these datasets carry, keep disambiguators
      // like "(London)".
      .replace(/\s+Rail Station$/i, "")
      .replace(/\s+Railway Station$/i, "")
      .replace(/\s+Station$/i, "")
      .trim();
    if (/^[A-Z]{3}$/.test(crs) && name && !seen.has(crs)) {
      seen.add(crs);
      out.push({ crs, name });
    }
  }
  return out;
}

let stations = null;
for (const url of CANDIDATES) {
  try {
    console.log("Trying", url);
    const res = await fetch(url);
    if (!res.ok) {
      console.log("  HTTP", res.status);
      continue;
    }
    const text = await res.text();
    const parsed = parseCsv(text);
    if (parsed && parsed.length > 1500) {
      stations = parsed;
      console.log("  Parsed", parsed.length, "stations");
      break;
    }
    console.log("  Parsed too few:", parsed ? parsed.length : "null");
  } catch (e) {
    console.log("  ERROR", e.message);
  }
}

if (!stations) {
  console.log("FAILED — no source produced a valid list");
  process.exit(1);
}

stations.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(
  "lib/data/stations.json",
  JSON.stringify(stations, null, 0) + "\n"
);
console.log("Wrote lib/data/stations.json with", stations.length, "stations");
console.log("Sample:", stations.slice(0, 3));
