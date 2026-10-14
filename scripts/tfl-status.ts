// Tube status collector: polls TfL line status and counts it per line and hour.
//
// TfL publishes no history of how its lines ran, so this builds one. Every
// couple of minutes it records each line's status (good / minor / severe /
// closed) against the London hour it was seen in; a Tube leg's reliability
// is then the share of weekday samples in its time band that were good.
// Counting samples rather than assuming a fixed rate means a missed poll or a
// late-starting run just leaves fewer samples, never a wrong figure.
//
// Usage:
//   npm run tfl-status                    # poll for 55 minutes
//   npm run tfl-status -- --minutes=5     # a shorter run
//   npm run tfl-status -- --once          # one poll, then exit
//
// Needs TFL_APP_KEY and DATABASE_URL. Runs hourly in GitHub Actions.

import { getLineStatuses, londonTime, tflConfigured } from "../lib/tfl.ts";
import { addLineSamples, dbConfigured, ensureSchema } from "../lib/db.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const MINUTES = Number(args.minutes ?? 55);
const ONCE = args.once === "true";
const INTERVAL_MS = 2 * 60_000;
/** Give up when this many polls in a row fail: TfL or the database is down. */
const MAX_CONSECUTIVE_FAILURES = 5;

if (!tflConfigured() || !dbConfigured()) {
  console.error("TFL_APP_KEY and DATABASE_URL must both be set.");
  process.exit(1);
}

await ensureSchema();
const endAt = Date.now() + MINUTES * 60_000;
let polls = 0;
let failures = 0;
let consecutiveFailures = 0;

async function poll(): Promise<void> {
  const at = new Date();
  const { day, hour } = londonTime(at);
  try {
    const statuses = await getLineStatuses();
    await addLineSamples(day, hour, statuses);
    polls++;
    consecutiveFailures = 0;
    const notGood = statuses.filter((s) => s.category !== "good");
    console.log(
      `${at.toISOString()} ${statuses.length} lines` +
        (notGood.length ? `: ${notGood.map((s) => `${s.line} ${s.description}`).join(", ")}` : ", all good")
    );
  } catch (e) {
    failures++;
    consecutiveFailures++;
    console.error(`${at.toISOString()} poll failed — ${(e as Error).message}`);
  }
}

do {
  const began = Date.now();
  await poll();
  if (ONCE || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
  const next = began + INTERVAL_MS;
  if (next >= endAt) break;
  await new Promise((r) => setTimeout(r, next - Date.now()));
} while (Date.now() < endAt);

console.log(`\n${polls} polls stored, ${failures} failed.`);
if (polls === 0) {
  console.error("::error::TfL status collector stored nothing.");
  process.exit(1);
}
