// Prints what's stored: overall coverage, then each route's months.
// Run: node --env-file=.env.local scripts/db-status.mjs [FROM-TO]
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const only = process.argv[2]?.toUpperCase().split("-");

const totals = await sql`
  SELECT count(*)::int AS hours,
         count(DISTINCT (from_crs, to_crs))::int AS routes,
         min(period) AS first_period, max(period) AS last_period,
         max(through_date) AS data_through, max(fetched_at) AS last_fetch
  FROM hourly_metrics`;
console.log("hourly_metrics:", totals[0]);

const rows = await sql`
  SELECT from_crs, to_crs,
         count(*)::int AS hours,
         count(DISTINCT period)::int AS months,
         sum(trains)::int AS trains,
         sum(services)::int AS services,
         max(through_date) AS through
  FROM hourly_metrics
  WHERE (${only?.[0] ?? null}::text IS NULL OR (from_crs = ${only?.[0] ?? null} AND to_crs = ${only?.[1] ?? null}))
  GROUP BY from_crs, to_crs
  ORDER BY from_crs, to_crs`;
console.log("Stored routes:");
for (const r of rows) {
  console.log(
    `  ${r.from_crs}-${r.to_crs}: ${r.hours} hours across ${r.months} months, ` +
      `${r.trains} trains, data through ${r.through}`
  );
}

if (only) {
  const detail = await sql`
    SELECT period, count(*)::int AS hours, sum(trains)::int AS trains,
           sum(within5)::int AS within5, sum(within30)::int AS within30,
           sum(services)::int AS services, bool_and(final) AS final,
           min(through_date) AS through
    FROM hourly_metrics
    WHERE from_crs = ${only[0]} AND to_crs = ${only[1]}
    GROUP BY period ORDER BY period`;
  console.table(detail);
}

const look = await sql`SELECT count(*)::int AS n FROM route_lookups`;
console.log("route_lookups rows:", look[0].n);
