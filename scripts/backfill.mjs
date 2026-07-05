// Local driver for the leaderboard backfill.
//
// Repeatedly calls /api/cron/backfill against a running server, warming the
// curated route universe from HSP a few calls at a time, pausing between
// requests to stay under HSP's session rate limit and backing off hard when
// the server reports it's been throttled. Resumable: stop it any time (Ctrl-C)
// and re-run — it always continues from what's already cached.
//
// Usage (with `npm run dev` running in another terminal):
//   node scripts/backfill.mjs
//   node scripts/backfill.mjs --url=https://your-app.vercel.app --calls=9
//
// Options:
//   --url=<base>     server base URL (default http://localhost:3000)
//   --calls=<n>      HSP calls per request (default 9; server clamps to 60)
//   --pause=<sec>    wait between requests (default 5)
//   --backoff=<sec>  wait after a throttle (default 600 = 10 min)
//
// Auth: if CRON_SECRET is set in the environment it's sent as a Bearer token.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const CALLS = Number(args.calls ?? 9);
const PAUSE_MS = Number(args.pause ?? 5) * 1000;
const BACKOFF_MS = Number(args.backoff ?? 600) * 1000;
const SECRET = process.env.CRON_SECRET;

const headers = SECRET ? { authorization: `Bearer ${SECRET}` } : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n, d) => (d === 0 ? "100" : ((n / d) * 100).toFixed(1));

let totalFetched = 0;
let stalls = 0;
const startedAt = Date.now();

console.log(`Backfill driver → ${BASE}  (calls/req=${CALLS}, pause=${PAUSE_MS / 1000}s)`);

for (let iter = 1; ; iter++) {
  let res;
  try {
    res = await fetch(`${BASE}/api/cron/backfill?calls=${CALLS}`, { headers });
  } catch (e) {
    console.error(`  request failed (${e.message}); retrying in ${PAUSE_MS / 1000}s`);
    await sleep(PAUSE_MS);
    continue;
  }

  if (!res.ok) {
    console.error(`  HTTP ${res.status}; retrying in ${BACKOFF_MS / 1000}s`);
    await sleep(BACKOFF_MS);
    continue;
  }

  const d = await res.json();
  if (d.skipped) {
    console.error(`Server not configured for backfill: ${d.reason}`);
    process.exit(1);
  }

  totalFetched += d.fetched ?? 0;
  const elapsed = Math.round((Date.now() - startedAt) / 60000);
  console.log(
    `#${iter}  complete ${d.complete}/${d.totalRoutes} (${pct(d.complete, d.totalRoutes)}%)` +
      `  +${d.fetched} months (${d.failed} failed)` +
      `  session total ${totalFetched} in ${elapsed}m` +
      (d.throttled ? "  ⚠ THROTTLED" : "")
  );

  if (d.done) {
    console.log(`\n✅ Backfill complete: all ${d.totalRoutes} routes warmed.`);
    break;
  }

  if (d.throttled) {
    console.log(`  backing off ${BACKOFF_MS / 60000}m to clear the rate limit…`);
    await sleep(BACKOFF_MS);
    continue;
  }

  // Guard against a stuck loop: if nothing is progressing and we're not
  // throttled, the remaining routes are erroring persistently. Bail after a few.
  if ((d.fetched ?? 0) === 0) {
    if (++stalls >= 5) {
      console.error(
        `\nStopped: ${d.incomplete} routes still incomplete but no progress in ${stalls} tries.`
      );
      process.exit(1);
    }
  } else {
    stalls = 0;
  }

  await sleep(PAUSE_MS);
}
