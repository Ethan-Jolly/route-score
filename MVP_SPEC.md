# Route Score — MVP Specification

**Working title:** Route Score
**Type:** Web app (Next.js)
**Goal:** Give UK rail commuters a clear, data-driven view of how their route actually performs — not a journey planner, but a route performance dashboard with a single shareable score.

---

## Core Concept

Commuters already know their route. They don't need another app to tell them the 07:42 exists. What they don't have is a way to answer: *"How reliable is my commute, really? Is it getting better or worse? How does it compare to other routes?"*

Route Score turns National Rail's historical performance data into a simple, opinionated dashboard built around one number: your route's score out of 100.

---

## Target User

UK rail commuters who travel the same route regularly. They have a strong intuition about whether their line is "good" or "bad" but no data to back it up. They'd share a score card with colleagues, especially if their route scores higher (or embarrassingly lower).

---

## MVP Scope — What We're Building

### 1. Station Search (From → To)

- Autocomplete search for UK stations using National Rail reference data (~2,500 stations)
- User selects origin and destination
- Time-of-day band selector:
  - **AM Peak** (06:00–09:00)
  - **PM Peak** (16:00–19:00)
  - **Off-Peak** (all other times)
  - **All Day**
- Time band is core to route identity, not just a filter — the AM peak and off-peak are treated as different routes with different scores

### 2. Route Dashboard

The main output. A single page showing everything about this route's performance.

**Route Score (0–100)**
A composite score calculated from three weighted metrics:

| Metric | Weight | What it measures |
|---|---|---|
| On-time rate | 60% | % of trains arriving within 5 minutes of scheduled time |
| Reliability rate | 25% | % of trains not cancelled or severely delayed (30+ min) |
| Delay severity | 15% | Average minutes late when a train *is* late (inverted — lower delay = higher score) |

The score formula:

```
on_time_score = on_time_percentage (0–100)
reliability_score = reliability_percentage (0–100)
delay_score = max(0, 100 - (avg_delay_minutes * 5)) (capped 0–100)

route_score = (on_time_score * 0.60) + (reliability_score * 0.25) + (delay_score * 0.15)
```

Display: large, prominent number with a colour scale (red/amber/green) and a one-line verdict:
- 90–100: "Excellent — this route runs like clockwork"
- 75–89: "Good — mostly reliable with occasional hiccups"
- 60–74: "Fair — expect delays a couple of times a week"
- 40–59: "Poor — delays are a regular feature"
- 0–39: "Dire — consider cycling"

**Metric Breakdown**
Below the score, show the three component metrics with simple bar/gauge visuals:
- On-time: "82% of trains arrive within 5 minutes"
- Reliability: "96% of trains run without cancellation"
- Avg delay: "When late, trains average 8 minutes behind"

**Trend Chart (12 months)**
A line chart showing the route score month-by-month over the past 12 months. This answers "is it getting better or worse?" at a glance. Include a subtle trend arrow (↑ improving / ↓ degrading / → stable) based on 3-month moving average direction.

**Route Context**
- Primary operator(s) running this route
- Number of services per day in the selected time band
- Busiest vs quietest months (from the data)

### 3. Shareable Score Card

A well-designed, self-contained card view of the route score. This is the viral hook.

- Accessible via a URL like `/score/BTN-LBG-am-peak`
- Designed to look good when screenshotted or when the URL is shared (Open Graph meta tags for link previews)
- Shows: route, time band, score, trend arrow, one-line verdict
- No account required to view or share — it's just a URL

### 4. Homepage

- Clean landing page explaining the concept in one sentence
- Station search front and centre
- A few example routes shown as score cards (pre-populated with real data) to demonstrate value immediately
- No sign-up wall — search and see results instantly

---

## What We're NOT Building (Phase 1)

- User accounts or authentication
- Saved/bookmarked routes
- Database or persistence layer
- Friend comparison / social features
- Real-time train tracking or live departure boards
- Push notifications or alerts
- Native mobile app
- Route suggestions or journey planning

These are all valid phase 2+ features. The MVP validates one question: *do people care about seeing their route's performance score?*

---

## Technical Architecture

### Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR for score card pages (link previews), API routes for HSP calls |
| Language | TypeScript | Type safety across API responses |
| Styling | Tailwind CSS | Rapid UI development, utility-first |
| Charts | Recharts or Chart.js | Lightweight, well-documented |
| Deployment | Vercel | Zero-config for Next.js, free tier sufficient for MVP |

### Data Source: HSP API

**Provider:** National Rail (via Darwin platform)
**Portal:** https://opendata.nationalrail.co.uk/
**Auth:** HTTP Basic Auth (email + password from portal registration)
**Base URL:** https://hsp-prod.rockshore.net/api/v1/
**Rate limits:** TBC — need to confirm during registration

**Two endpoints we'll use:**

1. `POST /serviceMetrics` — aggregate performance stats for a route over a date range
   - Input: from_loc, to_loc, from_time, to_time, from_date, to_date, days (weekday filter)
   - Returns: total trains, on-time counts at various tolerances, late/cancelled counts

2. `POST /serviceDetails` — individual train-level detail for a specific date
   - Input: rid (service ID from serviceMetrics)
   - Returns: per-train arrival times, delays, cancellation info

**Data strategy:**
- Query HSP API server-side via Next.js API routes (credentials stay on server)
- For the trend chart, make 12 monthly queries (one per month for the past year)
- Cache responses aggressively (route performance data doesn't change once the day has passed)
- Use Next.js built-in caching / ISR for score card pages — regenerate daily

### Station Reference Data

- National Rail provides a station code CSV/XML (CRS codes → station names)
- Download once, bundle as a static JSON file in the app
- Powers the autocomplete search — no API call needed, purely client-side filtering

### API Route Structure

```
/api/route-score?from=BTN&to=LBG&band=am-peak
  → calls HSP serviceMetrics for each of the past 12 months
  → calculates composite score + trend
  → returns JSON

/api/stations?q=brig
  → filters static station list
  → returns matching stations (client-side alternative also fine)
```

### Page Structure

```
/                   → Homepage with search
/route/[from]-[to]  → Route dashboard (with ?band= query param)
/score/[from]-[to]  → Shareable score card (minimal, visual, OG-tagged)
```

---

## Design Principles

1. **Instant value** — no sign-up, no onboarding. Search a route, see the score.
2. **One number** — the score is the anchor. Everything else supports it.
3. **Transparent** — show how the score is calculated. Trust comes from transparency.
4. **Shareable by default** — every route has a URL. Link previews show the score.
5. **Mobile-first** — commuters will check this on their phone at the platform.

---

## Visual Direction

- Clean, minimal, modern — think Monzo or Linear, not National Rail
- Dark-on-light, generous whitespace
- The score is the hero element — large, bold, colour-coded
- Trend chart is simple and scannable — no chart junk
- Score card should feel like something you'd screenshot for a group chat

---

## Data Constraints & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| HSP API only holds 1 year of history | Can't show multi-year trends | Start caching monthly snapshots from day one (even as flat JSON files). New users still get 12 months. |
| HSP API rate limits unknown | Could throttle heavy usage | Cache aggressively. Score card pages use ISR (regenerate daily, not per-request). |
| HSP API could go down or change | App is fully dependent on one data source | Server-side calls with error handling + fallback "data temporarily unavailable" UI. |
| Score formula may feel wrong to users | Undermines trust | Show the breakdown. Be transparent. Iterate on weights based on feedback. |
| Some routes may have very few trains | Score is statistically noisy | Show sample size ("based on X trains"). Flag routes with <50 trains/month as "limited data". |

---

## Registration Required Before Development

1. **National Rail Data Portal** — register at https://opendata.nationalrail.co.uk/
   - Subscribe to HSP feed
   - Get API credentials
   - Download station reference data (CRS codes)

2. **Vercel** — account for deployment (free tier)

---

## Success Criteria

The MVP is successful if:
- A user can search any UK rail route and see a meaningful score within 3 seconds
- The score feels credible — it matches commuters' lived experience
- People share score card URLs without being prompted to
- We learn enough from usage to know whether phase 2 (accounts, comparison, social) is worth building

---

## Phase 2 Candidates (Post-MVP)

Ordered by likely impact:

1. **Route comparison** — side-by-side two routes
2. **Saved routes** — bookmark your commute (needs accounts)
3. **Friend comparison** — share and compare scores (needs accounts)
4. **Weekly email digest** — "your route scored 71 this week, down from 76"
5. **Historical data accumulation** — build multi-year trends from cached data
6. **Operator league table** — rank TOCs by average route score
7. **Heatmap** — best/worst times of day to travel a route
8. **Cost-per-minute-delayed** — combine with ticket price for a "value" score
