# Route Score

**How reliable is your commute, really?**

Route Score turns National Rail's historical service performance data into one
honest number per route — a 0–100 score built from a year of punctuality data,
with a 12-month trend, a metric breakdown, and a shareable score card whose
link preview *is* the card.

Built per [MVP_SPEC.md](./MVP_SPEC.md).

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

> **npm on this machine:** Node's AES-GCM TLS path is broken here
> (`ERR_SSL_CIPHER_OPERATION_FAILED` on large tarballs). If `npm install`
> fails, prefix it with:
> `NODE_OPTIONS=--tls-cipher-list=TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-CHACHA20-POLY1305`
> and retry until it completes (downloaded tarballs stay cached between tries).

## Data sources & modes

| Env | Effect |
|---|---|
| `HSP_EMAIL` + `HSP_PASSWORD` | Use **live** National Rail HSP data. Without them, **demo** mode (deterministic synthetic data) runs. |
| `DATABASE_URL` (Neon Postgres) | Where everything fetched from HSP is stored. Live data needs it; without it the app stays in demo mode. |

## How data gets in

The site only ever **reads** from Postgres. Getting data out of HSP is a
separate job, because of how HSP behaves (measured October 2026):

- A call costs roughly **1–1.7 seconds per distinct timetabled service** it
  returns. The date range is almost free; the time-of-day window is what costs.
- HSP's own gateway gives up at **120 seconds**. A busy route can never be
  fetched for a whole day in one call (London Waterloo → Woking has ~270
  services a day), whatever the date range.
- More than **~4 concurrent calls** per account are rejected with 503.
- Data is available about **a day** after the trains ran.

So the design is:

- **Hourly storage.** Performance is stored as raw counts per route, month and
  departure hour (`hourly_metrics`). HSP calls are sliced by hour — sized from
  how many services each hour is known to hold, and halved on timeout — and
  results are bucketed by scheduled departure time. Every time band is then
  just a sum over its hours, so one fetch serves all three bands. Only
  06:00–18:59 is ever fetched — the hours the bands cover.
- **A standalone ingest** (`scripts/ingest.ts`) talks to HSP and Postgres
  directly. It runs on a schedule in GitHub Actions, or locally. It is fully
  resumable: every chunk is stored as it lands and each run re-plans from
  what's stored.
- **Month-to-date.** A score covers the 12 complete months **plus the month in
  progress**, re-fetched as it grows, so scores are typically a day or two
  behind the railway rather than up to a month. Rows for a month become
  `final` once fetched after the month has ended; until then they are a
  snapshot through `through_date` and get refreshed.
- **On-demand fill for new routes.** A route nobody has looked up before shows
  a warming screen that drives `/api/route-score/fill` in short, time-boxed
  steps (each well inside the 60s function limit), newest month first. HSP's
  per-service cost means a busy route's full year can take the best part of an
  hour, so the visitor is never made to wait for it:
  - As soon as the **three most recent months** are stored the dashboard
    appears with a **provisional** score, and the rest of the year loads behind
    a small progress banner, the page updating as each month lands.
  - If the requested band isn't stored but **another band of the route is**,
    that band is shown immediately while the requested one is collected.
  - The first step registers the route with the ingest, which finishes it in
    the background if the visitor leaves.

Because old months are never deleted, the database also accumulates history
beyond HSP's rolling one-year window.

### Running the ingest

```bash
npm run ingest                          # 50-minute run, reads .env.local
npm run ingest -- --minutes=600         # long run, e.g. overnight for the first fill
npm run ingest -- --routes=KGX-EDB      # only these curated routes
npm run ingest -- --dry-run             # print the plan, fetch nothing
```

Needs Node 22.18+ (it runs the TypeScript directly). `HSP_CONCURRENCY`
(default 2) sets how many HSP calls run at once — the account's ~4 are shared
with the live site, so don't run two ingests at the same time.

Each run works in this order:

1. **Looked-up routes, requested bands** — whatever visitors have asked for:
   missing months, plus the month-to-date if it's behind.
2. **Looked-up routes, the other bands** — so switching band on a route
   someone has visited is instant. Refreshed weekly, not daily.
3. **Refresh** — routes already on the leaderboard: month-to-date and
   just-ended months, stalest first.
4. **Fill** — curated routes still missing months, newest six months first (so
   a route reaches the leaderboard sooner), then the older six.

While there is still curated filling to do, steps 2 and 3 are each capped at a
share of the run (40% and 30% of what's left) so they can't starve it.

A run that had work to do and stored nothing exits non-zero, so a broken
ingest shows up red in GitHub Actions instead of passing silently.

### Scheduled ingest (GitHub Actions)

`.github/workflows/ingest.yml` runs the ingest daily for 50 minutes. Add these
repository secrets (Settings → Secrets and variables → Actions): `HSP_EMAIL`,
`HSP_PASSWORD`, `DATABASE_URL`.

A private repo gets 2,000 free Actions minutes a month; one 50-minute run a day
uses about 1,600. You can start a longer run by hand from the Actions tab
(`minutes` input, up to ~340).

**Scale.** The curated universe is ~1,000 routes × 12 months. A route-month
costs about 1.3s per timetabled service: roughly a minute for a quiet
intercity route, about six minutes for the busiest commuter routes. The first
fill is therefore long — do it with a few overnight local runs
(`npm run ingest -- --minutes=600`) rather than waiting on the daily schedule.
Afterwards the daily run only has refreshing to do.

### Live-data approximations (worth knowing)

HSP's `serviceMetrics` returns punctuality tolerance buckets only — no
cancellation counts, no exact lateness minutes. So in live mode:

- **Reliability** ≈ % of trains within 30 minutes.
- **Average delay** is estimated from bucket midpoints (5–30 min late ≈ 12
  min, 30+ min ≈ 40 min).
- Only **weekday** services are counted.

The score formula itself is exactly as specified.

## The score

```
on_time_score      = % arriving within 5 min           (weight 60%)
reliability_score  = % not cancelled / 30+ min late    (weight 25%)
delay_score        = max(0, 100 − avg_delay_mins × 5)  (weight 15%)
route_score        = weighted sum, 0–100
```

Time bands are sums of departure hours: AM peak 06:00–08:59, off-peak
09:00–15:59, PM peak 16:00–18:59. There is no all-day band (the spec had one):
the app is about comparing commuting times, and the extra early and late hours
made busy routes far slower to fetch. Old all-day links open AM peak.

Trend arrow compares the latest 3-month moving average against the previous one
(±2 points = improving/degrading, else stable). The month in progress joins the
trend once it has enough trains to be a fair point next to full months.

## URLs

| Path | What |
|---|---|
| `/` | Homepage: search + example score cards (stored routes only) |
| `/route/BTN-LBG?band=am-peak` | Full dashboard (band tabs, breakdown, trend, context) |
| `/score/BTN-LBG-am-peak` | Shareable score card, ISR-cached daily, with a dynamically rendered Open Graph image so pasted links preview as the card itself |
| `/leaderboard` | Best/worst routes, toggleable between the whole UK and London only |
| `/api/route-score?from=BTN&to=LBG&band=am-peak` | JSON API. 200 with the score, or 202 `{ warming, cached, total }` while a new route is being fetched — repeat to continue |
| `/api/route-score/fill` | One time-boxed fill step for a new route (used by the warming screen) |
| `/api/stations?q=brig` | Station search API (autocomplete also runs client-side) |

Routes with no direct trains return a friendly "no direct service" page, not an
error — Route Score rates direct journeys only.

## Leaderboard

`/leaderboard` ranks the best and worst-performing routes, toggleable between
the whole UK and London-only. Rankings are drawn from a **curated universe** of
~1,000 real routes in `lib/routes.ts` (every London terminal against the real
destinations on its lines, plus the major UK intercity city pairs, both
directions). All are ranked on **both commuter peaks combined** (06:00–08:59
and 16:00–18:59) so scores are directly comparable, and a route needs ≥6 fully
stored months of real service to appear.

## Deploying to Vercel

1. **Push to GitHub.**
2. **Import** the repo at https://vercel.com/new.
3. **Environment variables** (Project → Settings → Environment Variables):
   - `HSP_EMAIL`, `HSP_PASSWORD` — your National Rail Data Portal login.
   - `DATABASE_URL` — auto-added if you provision Neon via Vercel's Storage
     tab; otherwise paste your Neon connection string.
   - `NEXT_PUBLIC_SITE_URL` — your production URL (e.g. `https://routescore.app`)
     so Open Graph image links resolve absolutely.
4. **Add the same three data secrets to GitHub Actions** (see above) so the
   scheduled ingest can run.
5. **Deploy.** The DB schema is created automatically on first use.

## Station reference data

`lib/data/stations.json` holds ~2,600 UK stations (CRS → name). Regenerate it
from the public dataset any time with:

```bash
node scripts/build-stations.mjs
```

## Architecture notes

- **Next.js 15 App Router, TypeScript, Tailwind CSS 4.** No chart library —
  the score dial and trend chart are hand-rolled SVG (smaller bundle, custom
  design, CSS-animated), with a `prefers-reduced-motion` fallback.
- All page data goes through `lib/provider.ts`:
  - `getCachedRouteScore()` — DB-only, never calls HSP; used by every page.
  - `fillRouteStep()` — one time-boxed on-demand fill step for a new route.
  - `getRouteScore()` — the JSON API's read (DB, plus one fill step if needed).
- `lib/hsp.ts` is the HSP client (hour slicing, timeouts, concurrency gate);
  `lib/db.ts` (Neon serverless Postgres) is the store; `lib/periods.ts` decides
  which dates a month covers right now; `lib/demo.ts` is the synthetic fallback.
- HSP credentials never leave the server — only server code and the ingest
  script use them.
- Product analytics via `@vercel/analytics` (validates the core MVP question:
  do people care?).

## Helper scripts

- `npm run ingest` (`scripts/ingest.ts`) — fill and refresh stored data (see above).
- `node --env-file=.env.local scripts/db-status.mjs [FROM-TO]` — what's stored.
- `node scripts/db-test.mjs` — verify the Neon connection.
- `node scripts/build-stations.mjs` — regenerate the station list.
- `npm run validate:routes` (`scripts/validate-routes.mjs`) — check every CRS in
  the curated route universe exists in `stations.json`.
