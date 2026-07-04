import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.DATABASE_URL;
if (!url) {
  console.log("MISSING DATABASE_URL");
  process.exit(1);
}
console.log("Host:", url.match(/@([^/]+)/)?.[1]?.replace(/:.*/, ""));

const sql = neon(url);
try {
  const t0 = Date.now();
  const rows = await sql`SELECT version() AS v`;
  console.log("Connected in", Date.now() - t0, "ms");
  console.log("Version:", rows[0].v.split(",")[0]);
  await sql`CREATE TABLE IF NOT EXISTS _rs_conn_test (id INT PRIMARY KEY, note TEXT)`;
  await sql`INSERT INTO _rs_conn_test (id, note) VALUES (1, 'ok') ON CONFLICT (id) DO UPDATE SET note = 'ok'`;
  const back = await sql`SELECT note FROM _rs_conn_test WHERE id = 1`;
  console.log("Round-trip:", back[0].note);
  await sql`DROP TABLE _rs_conn_test`;
  console.log("DB OK");
} catch (e) {
  console.log("DB ERROR:", e.message);
  process.exit(2);
}
