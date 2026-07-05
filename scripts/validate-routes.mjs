// Validates that every CRS used in the curated route universe exists in
// stations.json. Run: node scripts/validate-routes.mjs
// Exits non-zero and lists unknown codes if any are wrong.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const stations = JSON.parse(
  readFileSync(join(root, "lib/data/stations.json"), "utf8")
);
const known = new Map(stations.map((s) => [s.crs, s.name]));

// Pull the raw code lists straight out of routes.ts without importing TS.
const src = readFileSync(join(root, "lib/routes.ts"), "utf8");
const codes = new Set();
// every quoted 2-5 uppercase-letter token (CRS are 3; catch typos of any length)
for (const m of src.matchAll(/"([A-Z]{2,5})"/g)) codes.add(m[1]);

const unknown = [...codes].filter((c) => !known.has(c)).sort();

if (unknown.length === 0) {
  console.log(`OK: all ${codes.size} CRS codes valid.`);
  process.exit(0);
}
console.error(`INVALID CRS codes (${unknown.length}):`);
for (const c of unknown) console.error(`  ${c}`);
process.exit(1);
