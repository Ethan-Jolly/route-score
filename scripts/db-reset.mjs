// Deletes ALL stored performance data and lookups. There is no undo — the
// data has to be re-fetched from HSP, which only holds about a year.
// Run: node --env-file=.env.local scripts/db-reset.mjs
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
await sql`DELETE FROM hourly_metrics`;
await sql`DELETE FROM route_lookups`;
const c = await sql`SELECT count(*)::int AS n FROM hourly_metrics`;
console.log("cleared; hourly_metrics rows now:", c[0].n);
