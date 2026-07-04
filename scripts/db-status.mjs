import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(env.DATABASE_URL);
const rows = await sql`
  SELECT from_crs, to_crs, band, count(*)::int AS months,
         sum(total_trains)::int AS trains,
         bool_or(no_service) AS any_no_service
  FROM monthly_metrics
  GROUP BY from_crs, to_crs, band
  ORDER BY from_crs, to_crs, band`;
console.log("Cached routes:");
for (const r of rows) {
  console.log(
    `  ${r.from_crs}-${r.to_crs}-${r.band}: ${r.months} months, ${r.trains} trains${r.any_no_service ? " (no-service)" : ""}`
  );
}
const look = await sql`SELECT count(*)::int AS n FROM route_lookups`;
console.log("route_lookups rows:", look[0].n);
