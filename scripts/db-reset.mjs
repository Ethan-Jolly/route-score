import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(env.DATABASE_URL);
await sql`DELETE FROM monthly_metrics`;
await sql`DELETE FROM route_lookups`;
const c = await sql`SELECT count(*)::int AS n FROM monthly_metrics`;
console.log("cleared; monthly_metrics rows now:", c[0].n);
