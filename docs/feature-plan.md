# Feature plan (November 2026)

The next round of features for Mind the Delay, agreed 15 Nov 2026. This is the
reference for what is being built, why, and in what order. Tick items off as
they land; add notes on anything that turned out differently.

## Guiding principles

- **Use the data we already pay for.** HSP's cost is per service returned, not
  per number asked for. Everything in Phase 1 rides on calls the ingest already
  makes.
- **Be honest about precision.** Where a figure is estimated, say so; don't
  show decimals we haven't earned.
- **No accounts.** State lives in URLs, `localStorage` or feeds people
  subscribe to.
- **Degrade gracefully while history builds.** New columns are NULL for rows
  stored before them. Every feature shows what it has ("based on the last 3
  months") rather than nothing.

## What HSP gives us (checked 15 Nov 2026)

One `serviceMetrics` call accepts several tolerances at no extra cost:
`tolerance: ["1","5","10","15","30","60"]` comes back as one bucket each,
per service. Each service carries `gbtt_ptd` / `gbtt_pta` (scheduled times),
`toc_code` and `matched_services` (how many runs). `hsp.ts` used to merge
services into hours and ask only for 5 and 30.

## Phase 1: data foundation

| # | Item | Status |
|---|---|---|
| 1.1 | Ask HSP for 1/5/10/15/30/60-minute tolerances | Done |
| 1.2 | New `hourly_metrics` columns `within1/10/15/60` (NULL for old rows) | Done |
| 1.3 | Per-service counts (dep time, arr time, operator, runs, the six buckets), stored packed in `service_months` (one row per route-month) | Done |
| 1.4 | New `day_metrics` table: whenever a month-to-date hour is refreshed, the difference from the previous snapshot is the counts for the days in between. Gives day-level data for free | Done |
| 1.5 | Ingest phase "detail backfill": refetch stored hours that lack the new buckets, newest month first, using time the other phases leave over. Replaces the journey-time backfill | Done |
| 1.6 | `metricsFromCounts` uses the finer buckets when a month has them, so average delay stops being a two-bucket guess | Built; switches itself on at 99% detail coverage (ingest sets `fine_delay` in `app_settings`) |

## Phase 2: route page features (ideas 1–4)

| # | Item | Status |
|---|---|---|
| 2.1 | **Which train should I catch?** Hour-by-hour strip (06:00–18:59) on the route page, from `hourly_metrics` (already populated), with a "leave earlier / later" nudge | Done |
| 2.2 | **Your train, not your route.** Per-service table for the band (07:42 → 08:39, operator, on-time %, 15+ late %), from `service_months` as it fills | Done |
| 2.3 | **Delay Repay estimator.** Share of trains 15–29, 30–59 and 60+ late; the visitor enters a single fare or season ticket price and gets an estimated yearly claim | Done |
| 2.4 | **Hours lost per year.** Average delay per journey × ~225 working days, with a plain-English comparison | Done |
| 2.5 | **Pin my commute.** `localStorage` pin on the route page; homepage shows your route first with the change since your last visit | Done |

## Phase 3: trend annotations (idea 7, experimental)

Try before committing. Questions to answer:

- Can our own data tell a **network-wide** bad month (weather, strikes: most
  routes dip together) from a **local** one (only this line or operator)?
- Is a small hand-curated `events.json` (strikes, named storms) worth the upkeep?
- Does `day_metrics` (1.4) make pinpointing bad days possible going forward?

**Result (15 Nov 2026): it works, and is built.** Over 1,019 routes:

- Network-wide months are obvious: Nov 2025 (44% of routes 5+ points below
  their own average), Aug 2026 (49%), Oct 2026 (40%); Feb–Apr 2026 were good
  almost everywhere.
- Operator-wide months are just as clear: London Overground ~18–21 points down
  Aug–Oct 2026, c2c 11–18 down Aug–Oct, Great Northern 14 down in Sep,
  Elizabeth line 16 down in Aug.
- Only 3.6% of route-months are bad while the network was normal ("local").
  Some cluster regionally (Aberdeen routes, Jan 2026); spotting regions
  automatically would need station coordinates (which we now have, see 5.1).

Built as "The bad months, in context" under the route trend chart
(`lib/context.ts`): each month 5+ points below the route's own average is
labelled Everywhere / Operator / This route. It says **who else** had a bad
month, never **why**: we have no trustworthy source of causes, and a
hand-curated `events.json` (strikes, storms) was not built. Revisit if someone
is willing to maintain it. `day_metrics` will make day-level explanations
possible once it has history.

## Phase 4: discovery and following (ideas 9, 10)

| # | Item | Status |
|---|---|---|
| 4.1 | `/operator/[code]` report card: overall score, best and worst routes, trend; `/operators` index ranking them | Done |
| 4.2 | RSS feed per route: one item per month with its score and change | Done |
| 4.3 | ICS calendar feed per route: an all-day event per month carrying the score, so a subscribed calendar updates itself | Done |

## Phase 5: bigger bets (ideas 11, 12)

| # | Item | Status |
|---|---|---|
| 5.1 | **Where should I live?** Pick a London terminal; map of every place with a direct train there, coloured by score, with expected journey time. Needs station coordinates | Done |
| 5.2 | **Today vs typical.** From `day_metrics`: the latest day's peak on a route (and across the network) against its usual, e.g. "worse than 80% of days we've recorded". True live data (Realtime Trains or Darwin) would need new credentials and is out of scope for now | Done |

## Known limits

- Detail (1.2–1.4) only exists for hours fetched after the change. The
  backfill gets there over days to weeks, depending on how much ingest time is
  left over.
- `day_metrics` spans are as long as the gap between refreshes. A route
  refreshed every day gives single days; otherwise two or three days together.
  HSP can also still be filling in yesterday when we read it, so the latest
  span is slightly provisional.
- Delay Repay is an estimate: cancellations count as 60+ minutes, and operators
  differ in their rules.

## Notes and decisions

- **Nothing collects until the ingest change is deployed.** The scheduled
  ingest runs from the GitHub repo, so `service_months`, `day_metrics` and
  the finer buckets only start filling after these changes are pushed. As of
  15 Nov only BTN→LBG 07:00 has detail (from testing).
- **Route features degrade gracefully meanwhile**: the hour strip works today
  (it only needs `hourly_metrics`); train-by-train shows a "still collecting"
  note listing missing hours; Delay Repay falls back to the 30+ minute share
  and says the 15–29 band is missing; the latest-day banner is hidden until a
  route has a recent span.
- **Delay severity display** now reads "~21m" with wording that says it's an
  estimate, until `fine_delay` is on.
- **Delay Repay maths**: 25% / 50% / 100% of a single fare for 15–29 / 30–59 /
  60+ minutes; season tickets per journey = weekly ÷ 10, monthly ÷ 40,
  annual ÷ 464; 225 trips a year. Cancellations count as 60+.
- **Pin my commute** keeps one route in `localStorage` (`mtd:commute`); the
  "since" baseline moves on at most once a day so a reload doesn't erase it.
- **Operators** (`/operators`, `/operator/[slug]`): a route belongs to the
  operator on most of its peak hours; an operator is its routes pooled into
  one big route, on the leaderboard's hours and window. Cached 6 hours.
- **Feeds** live at `/feeds/<FROM-TO-band>/rss.xml` and `/calendar.ics`; the
  route page links them (calendar via `webcal://`).
- **Commuter map** (`/map`): Leaflet with OpenStreetMap's own tiles (CARTO's
  basemaps now need an API key). OSM's tile policy is fine for modest traffic;
  move to a keyed provider if the map gets popular. PM peak shows the journey
  home (departures from the hub). Coordinates: `lib/data/station-coords.json`
  from `scripts/build-station-coords.mjs` (2,563 of 2,595 stations).
- **Today vs typical** was built from `day_metrics` ("latest day", usually
  yesterday because HSP lags a day) rather than live data. "Worse than X% of
  days" appears once a route has 10 single recorded days. True live data would
  need Realtime Trains or Darwin credentials.
- **Automatic switch to fine delay** (added 15 Nov): each ingest run checks
  detail coverage; at 99% it sets `fine_delay` = `on` in `app_settings`
  (latched, never flips back) and the site reads it, cached for an hour.
  `FINE_DELAY=on|off` env overrides. Expected around mid-December to mid-January
  2027: on 15 Nov, 169,181 of 169,182 stored hours lacked detail, and the
  ingest manages ~1,600 hours per hour of running across ~10 hours a day,
  much of which goes on refreshing month-to-date first.
- **Faster ingest** (15 Nov): runs now chain themselves while there's a
  backlog (about 24 hours a day instead of ~10) at 3 concurrent HSP calls
  instead of 2. Roughly 3.5× the throughput, so the detail backfill should
  take about 1–2 weeks. The Neon database is already awake around the clock
  (the Tube collector writes every 2 minutes), so this adds no awake time.
- **Station coverage** (15 Nov): every station outside the curated routes
  gets one route from the National Rail timetable
  (`scripts/build-coverage-routes.ts` → `lib/data/coverage-routes.json`):
  2,232 routes; 46 stations have no direct weekday train (closed, bus-only,
  or sub-codes of a main station). Filled at low priority before the detail
  backfill; about 2–3 days of ingest. Skipping empty hours was dropped: the
  ingest already batches quiet hours into one call, so it saved almost
  nothing. A better pick of "most popular" would need ORR's origin–destination
  passenger figures.
- **Storage** (15 Nov): with ~3,300 routes, a row per train per month would
  have been ~1.7M rows (~300 MB) against Neon's free 0.5 GB, so per-service
  counts are packed one row per route-month (`service_months`, JSON by hour)
  and `day_metrics` keeps 60 days and skips coverage routes. The old
  `service_metrics` table (test rows only) is unused and can be dropped.
- **Known inherited issue**: leaderboard and operator route lists rank on both
  peaks but link to the AM peak page, so the number can differ on click.
