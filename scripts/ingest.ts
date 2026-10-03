// Route Score ingest: pulls route performance from HSP straight into Postgres.
//
// This is the only thing that fills and refreshes the data the site reads. It
// runs outside the web app (GitHub Actions on a schedule, or locally) because
// a single HSP call can take up to two minutes — far too long for a serverless
// request. It is resumable and safe to stop at any time: every chunk is written
// as it lands, and each run re-plans from what's actually stored.
//
// Usage:
//   npm run ingest                       # 50-minute run using .env.local
//   npm run ingest -- --minutes=600      # long local run for the first fill
//   npm run ingest -- --routes=KGX-EDB,WAT-WOK   # just these curated routes
//   npm run ingest -- --dry-run          # print the plan, fetch nothing
//
// Needs HSP_EMAIL, HSP_PASSWORD and DATABASE_URL. HSP_CONCURRENCY (default 2)
// sets how many HSP calls run at once; the account allows ~4 in total, shared
// with the live site.
//
// Work order each run (stalest/newest first within each):
//   1. Looked-up routes, requested bands — whatever visitors have asked for,
//      kept current to yesterday.
//   2. Looked-up routes, the other bands — so switching band is instant too.
//      These hours are refreshed weekly rather than daily.
//   3. Refresh — leaderboard routes' month-to-date and just-ended months.
//   4. Fill — curated routes still missing months (newest six months first,
//      so a route reaches the leaderboard sooner, then the older six).
// While there is still curated filling to do, steps 2 and 3 are each capped
// at a share of the run so they can't starve it.

import { appendFileSync } from "node:fs";
import { CURATED_ROUTES } from "../lib/routes.ts";
import { BAND_HOURS, STORED_HOURS, last12Months } from "../lib/score.ts";
import { currentMonth, periodRange, yesterday } from "../lib/periods.ts";
import { fetchHspHours, hspConfigured } from "../lib/hsp.ts";
import {
  dbConfigured,
  ensureSchema,
  getCoverage,
  getHourRows,
  getPopularRoutes,
  getServiceHint,
  upsertHourRows,
} from "../lib/db.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const MINUTES = Number(args.minutes ?? 50);
const DRY_RUN = args["dry-run"] === "true";
const ONLY = args.routes
  ? new Set(String(args.routes).toUpperCase().split(",").map((r) => r.replace("-", ">")))
  : null;
const CONCURRENCY = Number(process.env.HSP_CONCURRENCY) || 2;
/** Routes need this many complete months to appear on the leaderboard. */
const LEADERBOARD_MONTHS = 6;
/** Give up when this many tasks in a row fail: HSP is down or throttling us. */
const MAX_CONSECUTIVE_FAILURES = 6;
/** Only the hours some band uses (06:00–18:59) are ever fetched. */
const ALL_HOURS = STORED_HOURS;

if (!hspConfigured() || !dbConfigured()) {
  console.error("HSP_EMAIL, HSP_PASSWORD and DATABASE_URL must all be set.");
  process.exit(1);
}

interface Task {
  from: string;
  to: string;
  period: string;
  /** Hours to fetch; null = whatever isn't stored yet (resolved when run). */
  hours: number[] | null;
  /** Distinguishes two tasks for the same route-month (different hours). */
  tag?: string;
}

const startedAt = Date.now();
const endAt = startedAt + MINUTES * 60_000;
const closed = last12Months();
const current = currentMonth();
const periods = periodRange(current) ? [...closed, current] : closed;
const newestFirst = [...closed].reverse();
const routeKey = (from: string, to: string) => `${from}>${to}`;

await ensureSchema();
const coverage = await getCoverage(periods, ALL_HOURS);
const curated = ONLY
  ? CURATED_ROUTES.filter((r) => ONLY.has(routeKey(r.from, r.to)))
  : CURATED_ROUTES;

// ---- Plan ------------------------------------------------------------------

/** How far behind the other bands' hours of a looked-up route may fall before
 * they are refreshed (the requested bands are refreshed daily). */
const REST_REFRESH_DAYS = 7;

/** 1 + 2. Looked-up routes: missing or out-of-date hours. `band` is the hours
 * of the bands people asked for; `rest` is the hours of the other bands. */
async function planLookups(): Promise<{ band: Task[]; rest: Task[] }> {
  if (ONLY) return { band: [], rest: [] };
  const restCutoff = yesterday(new Date(Date.now() - REST_REFRESH_DAYS * 86_400_000));

  // A route may have been looked up in several bands; merge their hours.
  const routes = new Map<string, Set<number>>();
  for (const r of await getPopularRoutes(50)) {
    const key = `${r.from}|${r.to}`;
    if (!routes.has(key)) routes.set(key, new Set());
    for (const h of BAND_HOURS[r.band] ?? []) routes.get(key)!.add(h);
  }

  const band: Task[] = [];
  const rest: Task[] = [];
  for (const [key, bandHours] of routes) {
    const [from, to] = key.split("|");
    const stored = new Map<string, { final: boolean; through: string }>();
    for (const row of await getHourRows(from, to, periods)) {
      stored.set(`${row.period}|${row.hour}`, { final: row.final, through: row.throughDate });
    }
    for (const period of periods) {
      const range = periodRange(period);
      if (!range) continue;
      const wantBand: number[] = [];
      const wantRest: number[] = [];
      for (const hour of ALL_HOURS) {
        const have = stored.get(`${period}|${hour}`);
        if (have?.final) continue;
        if (bandHours.has(hour)) {
          if (!have || have.through < range.to) wantBand.push(hour);
        } else if (!have || (have.through < range.to && have.through < restCutoff)) {
          wantRest.push(hour);
        }
      }
      if (wantBand.length) band.push({ from, to, period, hours: wantBand, tag: "band" });
      if (wantRest.length) rest.push({ from, to, period, hours: wantRest, tag: "rest" });
    }
  }
  const newest = (a: Task, b: Task) => b.period.localeCompare(a.period);
  return { band: band.sort(newest), rest: rest.sort(newest) };
}

/** 2. Refresh: leaderboard routes whose stored months are snapshots that have
 * since moved on (month-to-date, or a month that has now ended). */
function planRefresh(): Task[] {
  const stale: (Task & { through: string })[] = [];
  for (const r of curated) {
    const cov = coverage.get(routeKey(r.from, r.to));
    if (!cov) continue;
    const complete = closed.filter((p) => cov.get(p)?.hours === ALL_HOURS.length);
    if (complete.length < LEADERBOARD_MONTHS) continue;
    for (const period of periods) {
      const range = periodRange(period);
      const c = cov.get(period);
      if (!range) continue;
      if (period === current && !c) {
        stale.push({ from: r.from, to: r.to, period, hours: ALL_HOURS, through: "" });
      } else if (
        c &&
        c.hours === ALL_HOURS.length &&
        c.finalHours < c.hours &&
        c.through < range.to
      ) {
        stale.push({ from: r.from, to: r.to, period, hours: ALL_HOURS, through: c.through });
      }
    }
  }
  return stale.sort((a, b) => a.through.localeCompare(b.through));
}

/** 3. Fill: curated routes still missing hours in the given months. */
function planFill(months: string[]): Task[] {
  const tasks: Task[] = [];
  for (const r of curated) {
    const cov = coverage.get(routeKey(r.from, r.to));
    for (const period of months) {
      const stored = cov?.get(period)?.hours ?? 0;
      if (stored >= ALL_HOURS.length) continue;
      tasks.push({ from: r.from, to: r.to, period, hours: stored === 0 ? ALL_HOURS : null });
    }
  }
  return tasks;
}

const lookups = await planLookups();
const refresh = planRefresh();
const fillRecent = planFill(newestFirst.slice(0, LEADERBOARD_MONTHS));
const fillOlder = planFill(newestFirst.slice(LEADERBOARD_MONTHS));

console.log(
  `Ingest: ${curated.length} curated routes, window ${periods[0]}..${periods.at(-1)}, ` +
    `budget ${MINUTES} min, ${CONCURRENCY} concurrent HSP calls`
);
console.log(
  `Plan: ${lookups.band.length} looked-up (requested bands), ` +
    `${lookups.rest.length} looked-up (other bands), ${refresh.length} refresh, ` +
    `${fillRecent.length} fill (recent 6 months), ${fillOlder.length} fill (older 6 months) route-months`
);
if (DRY_RUN) process.exit(0);

// ---- Run -------------------------------------------------------------------

const stats = { tasks: 0, completed: 0, failed: 0, hours: 0, trains: 0 };
const done = new Set<string>();
let consecutiveFailures = 0;
let aborted = false;

async function runTask(t: Task): Promise<void> {
  const key = `${t.from}|${t.to}|${t.period}|${t.tag ?? ""}`;
  if (done.has(key)) return;
  done.add(key);
  const range = periodRange(t.period);
  if (!range) return;

  stats.tasks++;
  const began = Date.now();
  let landed = 0;
  try {
    let hours = t.hours;
    if (!hours) {
      const have = new Set(
        (await getHourRows(t.from, t.to, [t.period])).map((r) => r.hour)
      );
      hours = ALL_HOURS.filter((h) => !have.has(h));
      if (hours.length === 0) return;
    }
    const res = await fetchHspHours(t.from, t.to, range, hours, {
      hint: await getServiceHint(t.from, t.to),
      deadline: endAt,
      onChunk: async (rows) => {
        await upsertHourRows(t.from, t.to, t.period, rows, range.to, range.final);
        landed += rows.length;
        stats.hours += rows.length;
        stats.trains += rows.reduce((s, r) => s + r.trains, 0);
      },
    });
    if (res.complete) stats.completed++;
    consecutiveFailures = 0;
    console.log(
      `  ${t.from}-${t.to} ${t.period}: ${landed}/${hours.length} hours in ` +
        `${Math.round((Date.now() - began) / 1000)}s${res.complete ? "" : " (out of time)"}`
    );
  } catch (e) {
    stats.failed++;
    if (landed === 0) consecutiveFailures++;
    console.error(`  ${t.from}-${t.to} ${t.period}: FAILED after ${landed} hours — ${(e as Error).message}`);
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) aborted = true;
  }
}

async function runPhase(name: string, tasks: Task[], deadline: number): Promise<void> {
  if (tasks.length === 0 || aborted || Date.now() >= deadline) return;
  console.log(`\n${name}: ${tasks.length} route-months`);
  const queue = [...tasks];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (aborted || Date.now() >= deadline) return;
      await runTask(t);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

const hasFill = fillRecent.length + fillOlder.length > 0;
/** A phase's deadline: the whole run, or a share of what's left of it while
 * curated filling is still waiting its turn. */
const share = (fraction: number) =>
  hasFill ? Date.now() + fraction * (endAt - Date.now()) : endAt;
await runPhase("Looked-up routes (requested bands)", lookups.band, endAt);
await runPhase("Looked-up routes (other bands)", lookups.rest, share(0.4));
await runPhase("Refresh", refresh, share(0.3));
await runPhase("Fill (recent 6 months)", fillRecent, endAt);
await runPhase("Fill (older 6 months)", fillOlder, endAt);
await runPhase("Looked-up routes (other bands, remaining)", lookups.rest, endAt);
await runPhase("Refresh (remaining)", refresh, endAt);

// ---- Report ----------------------------------------------------------------

const after = await getCoverage(closed, ALL_HOURS);
let qualified = 0;
let complete = 0;
for (const r of curated) {
  const cov = after.get(routeKey(r.from, r.to));
  const n = closed.filter((p) => cov?.get(p)?.hours === ALL_HOURS.length).length;
  if (n >= LEADERBOARD_MONTHS) qualified++;
  if (n === closed.length) complete++;
}

const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
const lines = [
  `Ran ${minutes} min: ${stats.completed} route-months completed, ${stats.failed} failed, ` +
    `${stats.hours} hours stored (${stats.trains.toLocaleString("en-GB")} trains).`,
  `Curated routes: ${qualified}/${curated.length} have ${LEADERBOARD_MONTHS}+ months ` +
    `(leaderboard-ready), ${complete}/${curated.length} have all 12.`,
];
if (aborted) {
  lines.push(
    `Stopped early: ${MAX_CONSECUTIVE_FAILURES} tasks in a row failed — HSP is unavailable or rate-limiting this account.`
  );
}
console.log(`\n${lines.join("\n")}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Route Score ingest\n\n${lines.join("\n\n")}\n`);
}
if (aborted) console.log("::warning::Ingest stopped early: HSP unavailable or rate-limiting.");

// A run that had work to do and stored nothing is a real failure — say so.
if (stats.tasks > 0 && stats.hours === 0) {
  console.error("::error::Ingest stored nothing.");
  process.exit(1);
}
