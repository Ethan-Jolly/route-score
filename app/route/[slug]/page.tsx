import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ScoreDial } from "@/components/ScoreDial";
import { TrendBadge, TrendChart } from "@/components/TrendChart";
import { MetricBar } from "@/components/MetricBar";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { NoServiceCard } from "@/components/NoServiceCard";
import { RouteFilling, RouteWarming } from "@/components/RouteWarming";
import { getCachedRouteScore, parseRouteSlug, routeSlug } from "@/lib/provider";
import { stationByCrs } from "@/lib/stations";
import {
  BAND_LABELS,
  formatMins,
  formatMonthLong,
  TIER_COLORS,
  tierFor,
} from "@/lib/score";
import type { RouteScoreResult, Station, TimeBand } from "@/lib/types";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ band?: string }>;
}

/** Resolves the URL to valid stations + a cached result. `result` is null when
 * the route is valid but not yet cached (→ client warming). */
async function resolveRoute(props: Props): Promise<
  | { ok: false }
  | {
      ok: true;
      from: Station;
      to: Station;
      band: TimeBand;
      result: Awaited<ReturnType<typeof getCachedRouteScore>>;
    }
> {
  const { slug } = await props.params;
  const { band: bandParam } = await props.searchParams;
  // Accept band via ?band= (spec) or embedded in the slug (share-friendly).
  const parsed = parseRouteSlug(
    bandParam ? `${slug.split("-").slice(0, 2).join("-")}-${bandParam}` : slug
  );
  if (!parsed) return { ok: false };
  const from = stationByCrs(parsed.from);
  const to = stationByCrs(parsed.to);
  if (!from || !to || from.crs === to.crs) return { ok: false };
  const result = await getCachedRouteScore(parsed.from, parsed.to, parsed.band);
  return { ok: true, from, to, band: parsed.band, result };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const r = await resolveRoute(props);
  if (!r.ok) return { title: "Route not found" };
  if (r.result && r.result.noService === false) {
    return {
      title: `${r.from.name} → ${r.to.name} (${BAND_LABELS[r.band]}) scores ${r.result.score}/100`,
      description: r.result.verdict,
    };
  }
  return { title: `${r.from.name} → ${r.to.name} (${BAND_LABELS[r.band]})` };
}

const BANDS: TimeBand[] = ["am-peak", "pm-peak", "off-peak"];

/** When the requested band isn't stored yet, another band of the same route
 * often is — show that straight away rather than a loading screen. */
async function storedFallback(
  from: string,
  to: string,
  requested: TimeBand
): Promise<RouteScoreResult | null> {
  const others = await Promise.all(
    BANDS.filter((b) => b !== requested).map((b) => getCachedRouteScore(from, to, b))
  );
  const usable = others.filter(
    (r): r is RouteScoreResult => r !== null && r.noService === false
  );
  // Prefer a complete band over a provisional one.
  return usable.find((r) => !r.coverage) ?? usable[0] ?? null;
}

export default async function RoutePage(props: Props) {
  const r = await resolveRoute(props);
  if (!r.ok) notFound();
  const fallback = r.result ? null : await storedFallback(r.from.crs, r.to.crs, r.band);
  if (!r.result && !fallback) {
    return <RouteWarming from={r.from} to={r.to} band={r.band} />;
  }
  if (r.result?.noService) {
    return <NoServiceCard from={r.from} to={r.to} band={r.band} />;
  }
  const result = (r.result ?? fallback) as RouteScoreResult;
  // The band still being collected, if any: the one asked for (while another
  // band stands in), or the one on screen (while its history loads).
  const collecting = fallback ? r.band : result.coverage ? result.band : null;
  const period = result.coverage
    ? `the most recent ${result.coverage.months} months`
    : "the past 12 months";

  const color = TIER_COLORS[tierFor(result.score)];
  const slug = routeSlug(result.from.crs, result.to.crs, result.band);
  const shareUrl = `/score/${slug}`;
  // What delays add to the timetable for an average train, in whole minutes.
  const delayMins =
    result.expectedMins !== undefined && result.journeyMins !== undefined
      ? result.expectedMins - result.journeyMins
      : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      {/* Route header */}
      <div className="rise-in flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            <Link
              href={`/station/${result.from.crs}?band=${result.band}&dir=from`}
              className="hover:text-emerald-700 transition-colors"
              title={`Every route from ${result.from.name}`}
            >
              {result.from.name}
            </Link>{" "}
            <span className="text-slate-300 font-normal">→</span>{" "}
            <Link
              href={`/station/${result.to.crs}?band=${result.band}&dir=to`}
              className="hover:text-emerald-700 transition-colors"
              title={`Every route to ${result.to.name}`}
            >
              {result.to.name}
            </Link>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {BANDS.map((b) => (
              <Link
                key={b}
                href={`/route/${result.from.crs}-${result.to.crs}?band=${b}`}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  b === result.band
                    ? "bg-slate-900 text-white"
                    : b === collecting
                      ? "bg-sky-100 text-sky-800"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {BAND_LABELS[b]}
                {b === collecting && b !== result.band && " · collecting"}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CopyLinkButton path={shareUrl} />
          <Link
            href={`/compare?a=${slug}`}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            Compare
          </Link>
          <Link
            href={shareUrl}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 transition-colors"
          >
            View score card
          </Link>
        </div>
      </div>

      {collecting && (
        <RouteFilling
          key={collecting}
          from={result.from.crs}
          to={result.to.crs}
          band={collecting}
          months={fallback ? 0 : (result.coverage?.months ?? 0)}
          ready={!fallback}
          message={
            fallback
              ? `${BAND_LABELS[collecting]} data for this route is still coming in. Showing ${BAND_LABELS[result.band]} for now.`
              : `This score only covers ${period} so far. The rest of the year is still loading.`
          }
        />
      )}

      {/* Score hero */}
      <div className="rise-in-delay-1 mt-6 grid gap-x-8 gap-y-4 lg:grid-cols-[auto_1fr] items-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mx-auto">
          <ScoreDial score={result.score} />
        </div>
        <div className="text-center lg:text-left">
          <div className="flex items-center justify-center lg:justify-start gap-2">
            <span
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color }}
            >
              {tierFor(result.score)}
            </span>
            <TrendBadge trend={result.trend} />
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-semibold text-slate-900">
            {result.verdict}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Based on {result.totalTrains.toLocaleString("en-GB")} services over{" "}
            {period}
            {result.dataThrough &&
              `, up to ${new Date(result.dataThrough).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}`}
            {result.limitedData && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Not many trains, so treat with caution
              </span>
            )}
          </p>
          <dl className="mt-4 grid gap-3 text-left sm:grid-cols-2">
            {/* Left out until the route's hours have been refetched with
                timetabled times; an empty tile only adds clutter. */}
            {result.expectedMins !== undefined && result.journeyMins !== undefined && (
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Expected journey time
                </dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                  {formatMins(result.expectedMins)}
                </dd>
                <dd className="text-xs text-slate-500">
                  {formatMins(result.journeyMins)} timetabled
                  {delayMins > 0
                    ? `, plus ${delayMins} min of average delay`
                    : ", with under a minute of average delay"}
                </dd>
              </div>
            )}
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Time between trains
              </dt>
              <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                {formatMins(result.gapMins)}
              </dd>
              <dd className="text-xs text-slate-500">
                So about a {formatMins(result.gapMins / 2)} wait if you turn
                up without checking
              </dd>
            </div>
          </dl>
          {result.source === "demo" && (
            <p className="mt-3 inline-block rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-[11px] text-slate-400">
              Demo data. Add HSP API credentials for live figures.
            </p>
          )}
        </div>
      </div>

      {/* Metric breakdown */}
      <section className="rise-in-delay-2 mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Where the score comes from
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricBar
            label="On-time"
            weight="50%"
            value={result.breakdown.onTimeScore}
            displayValue={`${Math.round(result.onTimePct)}%`}
            detail="Trains arriving within 5 minutes of the timetable"
            color="#0ea5e9"
          />
          <MetricBar
            label="Reliability"
            weight="25%"
            value={result.breakdown.reliabilityScore}
            displayValue={`${Math.round(result.reliabilityPct)}%`}
            detail="Trains not cancelled or more than 30 minutes late"
            color="#8b5cf6"
          />
          <MetricBar
            label="Delay severity"
            weight="15%"
            value={result.breakdown.delayScore}
            displayValue={`${result.avgDelayMins}m`}
            detail="How late the late trains are, on average"
            color="#f59e0b"
          />
          <MetricBar
            label="Frequency"
            weight="10%"
            value={result.breakdown.frequencyScore}
            displayValue={`${Math.round(result.gapMins)}m`}
            detail="Average time between trains"
            color="#14b8a6"
          />
        </div>
      </section>

      {/* Trend */}
      <section className="rise-in-delay-3 mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Score over {period}
        </h2>
        <TrendChart scores={result.monthlyScores} />
      </section>

      {/* Route context */}
      <section className="rise-in-delay-3 mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Operated by
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {result.operators.join(" · ")}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Trains per weekday ({BAND_LABELS[result.band]})
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            About {result.servicesPerDay}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Busiest / quietest month
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {formatMonthLong(result.busiestMonth)} /{" "}
            {formatMonthLong(result.quietestMonth)}
          </p>
        </div>
      </section>

      {/* Transparency note */}
      <p className="mt-6 text-xs text-slate-400 max-w-2xl">
        How it&apos;s worked out: 50% is trains arriving within 5 minutes, 25%
        is trains that weren&apos;t cancelled or 30+ minutes late, 15% is how
        late the late trains were (each minute costs 5 points) and 10% is
        frequency (full marks for a train every 10 minutes, then a point off
        for each extra minute).
      </p>
    </div>
  );
}
