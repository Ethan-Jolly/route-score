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

The app resolves a route's data from the best source available, controlled by
two things in `.env.local`:

| Env | Effect |
|---|---|
| `HSP_EMAIL` + `HSP_PASSWORD` | Use **live** National Rail HSP data. Without them, **demo** mode (deterministic synthetic data) runs. |
| `DATABASE_URL` (Neon Postgres) | Cache HSP results permanently and accumulate history. Without it, live mode still works but re-fetches every time. |

### Why the database matters

HSP is slow (~15–25s per monthly query) and only holds a rolling ~1 year of
history. The DB solves both:

- **Cache:** every route-month is fetched from HSP exactly once, ever, then
  served from Postgres forever after. The first load of a brand-new route
  takes ~25s (a skeleton covers the wait); every load after is instant.
- **History:** because we never delete old months, the app accumulates
  performance history *beyond* HSP's 1-year window from day one — a moat that
  grows on its own.

Concurrency note: HSP tolerates parallel requests without throttling, so a cold
route fires all 12 missing months at once (~25s total, not 12×25s).

### Live-data approximations (worth knowing)

HSP's `serviceMetrics` returns punctuality tolerance buckets only — no
cancellation counts, no exact lateness minutes. So in live mode:

- **Reliability** ≈ % of trains within 30 minutes.
- **Average delay** is estimated from bucket midpoints (5–30 min late ≈ 12
  min, 30+ min ≈ 40 min).

The score formula itself is exactly as specified. Exact cancellation/delay
figures would need per-train `serviceDetails` calls (thousands per route) — a
background-aggregator job for a later phase, noted in the code.

## The score

```
on_time_score      = % arriving within 5 min           (weight 60%)
reliability_score  = % not cancelled / 30+ min late    (weight 25%)
delay_score        = max(0, 100 − avg_delay_mins × 5)  (weight 15%)
route_score        = weighted sum, 0–100
```

Trend arrow compares the latest 3-month moving average against the previous one
(±2 points = improving/degrading, else stable).

## URLs

| Path | What |
|---|---|
| `/` | Homepage: search + example score cards (served from cache, fast path) |
| `/route/BTN-LBG?band=am-peak` | Full dashboard (band tabs, breakdown, trend, context) |
| `/score/BTN-LBG-am-peak` | Shareable score card, ISR-cached daily, with a dynamically rendered Open Graph image so pasted links preview as the card itself |
| `/leaderboard` | Best/worst routes, toggleable between the whole UK and London only (see below) |
| `/api/route-score?from=BTN&to=LBG&band=am-peak` | JSON API |
| `/api/stations?q=brig` | Station search API (autocomplete also runs client-side) |
| `/api/cron/warm` | Nightly warm job (see below) |
| `/api/cron/backfill` | Leaderboard backfill job (see below) |

Routes with no direct trains return a friendly "no direct service" page, not an
error — Route Score rates direct journeys only.

## Nightly warm cron

`vercel.json` schedules `GET /api/cron/warm` daily at 05:00 UTC. It refreshes
the most recent complete month for the 20 most-looked-up routes (tracked in the
`route_lookups` table), so as the 12-month window slides forward, popular routes
stay current and returning visitors never hit a cold fetch.

Protect it in production by setting **`CRON_SECRET`** — Vercel Cron sends it as
`Authorization: Bearer …`; the endpoint rejects mismatches. Locally (no secret
set) it's open so you can hit it directly.

## Leaderboard & backfill

`/leaderboard` ranks the best and worst-performing routes, toggleable between
the whole UK and London-only. Rankings are drawn from a **curated universe** of
~1,000 real routes in `lib/routes.ts` (every London terminal against the real
destinations on its lines, plus the major UK intercity city pairs, both
directions). All use the `all-day` band so scores are directly comparable, and
a route needs ≥6 cached months of real service to appear.

We can't fetch all ~6.7M station pairs from HSP, so the leaderboard and the warm
cache are seeded from this set by the **backfill job**. It's fully resumable:
each run recomputes what's still missing and fetches only that, persisting every
wave, so you can stop and restart it freely. Because HSP has a sustained session
rate limit (see below), a run stops early and reports `throttled: true` the
moment a whole wave of calls fails.

### Running the backfill

The one-time populate is best driven locally. With the dev server running in one
terminal (`npm run dev`), run the driver in another:

```bash
npm run backfill
```

It loops the endpoint a few HSP calls at a time, pausing between requests and
backing off ~10 min whenever HSP throttles, until every route is warmed. Options
(all optional):

```bash
node scripts/backfill.mjs \
  --url=http://localhost:3000 \  # target server (default localhost:3000)
  --calls=9 \                    # HSP calls per request (server clamps to 60)
  --pause=5 \                    # seconds between requests
  --backoff=600                  # seconds to wait after a throttle
```

To backfill a deployed instance instead, point `--url` at it and export
`CRON_SECRET` to match the server (sent as `Authorization: Bearer …`):

```bash
CRON_SECRET=... node scripts/backfill.mjs --url=https://your-app.vercel.app
```

**Scale & pacing.** ~1,000 routes × ~12 months ≈ 12k HSP calls. At HSP's
~15–25s per call under its concurrency cap (~3–4) and sustained session quota,
the full first backfill runs over **days to a couple of weeks** — but it's
resumable and the leaderboard starts filling as soon as any route reaches 6
months. Steady-state upkeep afterward is tiny (one new month per route per
month) as the 12-month window slides.

### Backfill cron

`vercel.json` also schedules `GET /api/cron/backfill` (`15,45 1-4 * * *`) for
ongoing top-up — a small `?calls=` budget per run that fits inside
`maxDuration`. Sub-daily crons require the **Vercel Pro** plan; on Hobby, reduce
it to a single daily entry and rely on `npm run backfill` for the heavy initial
fill. It shares `CRON_SECRET` with the warm job for auth.

## Deploying to Vercel

1. **Push to GitHub.** From the project root:
   ```bash
   git init && git add -A && git commit -m "Route Score MVP"
   gh repo create route-score --private --source=. --push   # or push manually
   ```
2. **Import** the repo at https://vercel.com/new.
3. **Environment variables** (Project → Settings → Environment Variables):
   - `HSP_EMAIL`, `HSP_PASSWORD` — your National Rail Data Portal login.
   - `DATABASE_URL` — auto-added if you provision Neon via Vercel's Storage
     tab; otherwise paste your Neon connection string.
   - `CRON_SECRET` — any long random string.
   - `NEXT_PUBLIC_SITE_URL` — your production URL (e.g. `https://routescore.app`)
     so Open Graph image links resolve absolutely.
4. **Deploy.** The DB schema is created automatically on first request.

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
- All data access goes through `lib/provider.ts`:
  - `getRouteScore()` — full read-through (DB → HSP → DB), cold-tolerant.
  - `getCachedRouteScore()` — DB-only fast path, never calls HSP; used where a
    slow fetch would be unacceptable (homepage).
- `lib/db.ts` (Neon serverless Postgres) is the cache + history store;
  `lib/hsp.ts` is the HSP client; `lib/demo.ts` is the synthetic fallback.
- Cold routes stream a skeleton via `loading.tsx`; pages set `maxDuration = 60`
  so the ~25s fetch fits inside the serverless timeout.
- HSP credentials never leave the server — only server components and API
  routes call the provider.
- Product analytics via `@vercel/analytics` (validates the core MVP question:
  do people care?).

## Helper scripts

- `node scripts/db-test.mjs` — verify the Neon connection.
- `node scripts/build-stations.mjs` — regenerate the station list.
- `npm run backfill` (`scripts/backfill.mjs`) — warm the leaderboard cache (see above).
- `npm run validate:routes` (`scripts/validate-routes.mjs`) — check every CRS in
  the curated route universe exists in `stations.json`.
