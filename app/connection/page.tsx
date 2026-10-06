import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ScoreDial } from "@/components/ScoreDial";
import { TrendBadge, TrendChart } from "@/components/TrendChart";
import { ConnectionBuilder } from "@/components/ConnectionBuilder";
import { RouteWarmingInline } from "@/components/RouteWarming";
import { getCachedRouteScore, getStationRoutes } from "@/lib/provider";
import { scoreConnection, type ConnectionResult } from "@/lib/connection";
import { stationByCrs } from "@/lib/stations";
import {
  BAND_LABELS,
  TIER_COLORS,
  formatMins,
  isTimeBand,
  tierFor,
} from "@/lib/score";
import type { RouteScoreResult, Station, TimeBand } from "@/lib/types";

type Param = string | string[] | undefined;

interface Props {
  searchParams: Promise<{ from?: Param; via?: Param; to?: Param; band?: Param }>;
}

const BANDS: TimeBand[] = ["am-peak", "pm-peak", "off-peak"];

/** One train of the journey. `outcome` is null while the route isn't stored. */
interface Leg {
  from: Station;
  to: Station;
  outcome: Awaited<ReturnType<typeof getCachedRouteScore>>;
}

/** The stations the URL names, dropping any that are unknown or repeated. */
async function readParams(props: Props) {
  const params = await props.searchParams;
  const station = (p: Param) =>
    typeof p === "string" ? (stationByCrs(p.toUpperCase()) ?? null) : null;
  const band: TimeBand =
    typeof params.band === "string" && isTimeBand(params.band) ? params.band : "am-peak";
  const from = station(params.from);
  let via = station(params.via);
  let to = station(params.to);
  if (via && via.crs === from?.crs) via = null;
  if (to && (to.crs === from?.crs || to.crs === via?.crs)) to = null;
  return { from, via, to, band };
}

const scored = (leg: Leg): RouteScoreResult | null =>
  leg.outcome && leg.outcome.noService === false ? leg.outcome : null;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { from, via, to } = await readParams(props);
  if (!from || !via || !to) return { title: "Connection builder" };
  return { title: `${from.name} → ${to.name} via ${via.name}` };
}

export default async function ConnectionPage(props: Props) {
  const { from, via, to, band } = await readParams(props);

  let legs: [Leg, Leg] | null = null;
  if (from && via && to) {
    const [first, second] = await Promise.all([
      getCachedRouteScore(from.crs, via.crs, band),
      getCachedRouteScore(via.crs, to.crs, band),
    ]);
    legs = [
      { from, to: via, outcome: first },
      { from: via, to, outcome: second },
    ];
  }
  const ra = legs && scored(legs[0]);
  const rb = legs && scored(legs[1]);
  const combined = ra && rb ? scoreConnection(ra, rb) : null;

  // With the first train chosen, offer the scored routes onward from the
  // change — the second train is usually one of them.
  const onward =
    from && via && !to
      ? (await getStationRoutes(via.crs, band)).departures
          .filter((r) => r.to.crs !== from.crs)
          .slice(0, 8)
      : [];

  const href = (b: TimeBand, dest: Station | null = to) =>
    "/connection?" +
    [
      from && `from=${from.crs}`,
      via && `via=${via.crs}`,
      dest && `to=${dest.crs}`,
      `band=${b}`,
    ]
      .filter(Boolean)
      .join("&");

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <div className="rise-in">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Connection builder
        </h1>
        <p className="mt-1 text-slate-500">
          Have to change trains? Put the two legs together and get one score
          for the whole journey.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {BANDS.map((b) => (
            <Link
              key={b}
              href={href(b)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                b === band
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {BAND_LABELS[b]}
            </Link>
          ))}
        </div>
      </div>

      <div className="rise-in-delay-1 mt-5">
        <ConnectionBuilder
          key={`${from?.crs}-${via?.crs}-${to?.crs}-${band}`}
          band={band}
          initialFrom={from}
          initialVia={via}
          initialTo={to}
        />
      </div>

      {onward.length > 0 && via && (
        <section className="rise-in-delay-2 mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Onward from {via.name}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {onward.map((r) => (
              <li key={r.to.crs}>
                <Link
                  href={href(band, r.to)}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white tabular-nums"
                    style={{ background: TIER_COLORS[tierFor(r.score)] }}
                  >
                    {r.score}
                  </span>
                  <span className="truncate">
                    <span className="text-slate-300">→</span> {r.to.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {legs && from && via && to && (
        <>
          {combined && (
            <Hero combined={combined} from={from} via={via} to={to} />
          )}

          <div className="rise-in-delay-2 mt-6 grid grid-cols-2 gap-3 sm:gap-6">
            <LegCard leg={legs[0]} band={band} label="First train" />
            <LegCard leg={legs[1]} band={band} label="Second train" />
          </div>

          {combined && ra && rb && (
            <>
              <section className="rise-in-delay-3 mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-center text-sm tabular-nums sm:text-base">
                  <thead>
                    <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-3 text-left font-semibold sm:px-6" />
                      <th className="px-1 py-3 font-semibold">First</th>
                      <th className="px-1 py-3 font-semibold">Second</th>
                      <th className="bg-slate-50 px-3 py-3 font-semibold sm:px-6">
                        Together
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows(ra, rb, combined).map((row) => (
                      <tr key={row.label} className="border-t border-slate-100">
                        <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 sm:px-6">
                          {row.label}
                        </th>
                        <td className="px-1 py-3 font-medium text-slate-600">{row.a}</td>
                        <td className="px-1 py-3 font-medium text-slate-600">{row.b}</td>
                        <td className="bg-slate-50 px-3 py-3 font-bold text-slate-900 sm:px-6">
                          {row.both}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {combined.monthlyScores.length > 1 && (
                <section className="rise-in-delay-3 mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
                    Whole journey, score by month
                  </h2>
                  <TrendChart scores={combined.monthlyScores} />
                </section>
              )}

              <p className="mt-6 max-w-2xl text-xs text-slate-400">
                How it&apos;s worked out: National Rail only records direct
                trains, so the two legs are put together as if their delays
                had nothing to do with each other. The journey counts as on
                time when both trains are, the less frequent train sets the
                frequency, and the result is scored the same way as a direct
                route. The wait at {via.name} is taken as half the gap between
                onward trains. A missed connection isn&apos;t counted, so a
                tight change will feel worse than this.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Hero({
  combined,
  from,
  via,
  to,
}: {
  combined: ConnectionResult;
  from: Station;
  via: Station;
  to: Station;
}) {
  const { expectedMins, journeyMins, changeMins } = combined;
  const delayMins =
    expectedMins !== undefined && journeyMins !== undefined
      ? expectedMins - journeyMins - changeMins
      : 0;
  return (
    <div className="rise-in-delay-1 mt-6 grid items-center gap-x-8 gap-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[auto_1fr]">
      <div className="mx-auto">
        <ScoreDial score={combined.score} />
      </div>
      <div className="text-center lg:text-left">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
          {from.name} <span className="font-normal text-slate-300">→</span> {to.name}
        </h2>
        <p className="text-sm text-slate-500">Changing at {via.name}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
          <span
            className="text-xs font-bold uppercase tracking-wider"
            style={{ color: TIER_COLORS[tierFor(combined.score)] }}
          >
            {tierFor(combined.score)}
          </span>
          <TrendBadge trend={combined.trend} />
          {combined.provisional && (
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              Provisional
            </span>
          )}
        </div>
        <p className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">
          {combined.verdict}
        </p>
        <dl className="mt-4 grid gap-3 text-left sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Expected journey time
            </dt>
            {expectedMins !== undefined && journeyMins !== undefined ? (
              <>
                <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
                  About {formatMins(expectedMins)}
                </dd>
                <dd className="text-xs text-slate-500">
                  {formatMins(journeyMins)} on the trains, around{" "}
                  {formatMins(changeMins)} waiting at {via.name}
                  {delayMins > 0 && `, plus ${delayMins} min of average delay`}
                </dd>
              </>
            ) : (
              <>
                <dd className="mt-0.5 text-lg font-bold text-slate-400">Coming soon</dd>
                <dd className="text-xs text-slate-500">
                  We&apos;re still collecting timetable data for these routes
                </dd>
              </>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Both trains on time
            </dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
              {Math.round(combined.onTimePct)}% of journeys
            </dd>
            <dd className="text-xs text-slate-500">
              And {Math.round(combined.reliabilityPct)}% with neither train
              cancelled or 30+ minutes late
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

interface Row {
  label: string;
  a: ReactNode;
  b: ReactNode;
  both: ReactNode;
}

function metricRows(
  a: RouteScoreResult,
  b: RouteScoreResult,
  both: ConnectionResult
): Row[] {
  const pct = (x: number) => `${Math.round(x)}%`;
  const mins = (m: number | undefined) => (m === undefined ? "—" : formatMins(m));
  return [
    { label: "Score", a: a.score, b: b.score, both: both.score },
    { label: "On time", a: pct(a.onTimePct), b: pct(b.onTimePct), both: pct(both.onTimePct) },
    {
      label: "Reliability",
      a: pct(a.reliabilityPct),
      b: pct(b.reliabilityPct),
      both: pct(both.reliabilityPct),
    },
    {
      label: "Delay when late",
      a: `${a.avgDelayMins} min`,
      b: `${b.avgDelayMins} min`,
      both: `${both.avgDelayMins} min`,
    },
    {
      label: "Time between trains",
      a: formatMins(a.gapMins),
      b: formatMins(b.gapMins),
      both: formatMins(both.gapMins),
    },
    {
      label: "Expected journey",
      a: mins(a.expectedMins),
      b: mins(b.expectedMins),
      both: mins(both.expectedMins),
    },
  ];
}

function LegCard({ leg, band, label }: { leg: Leg; band: TimeBand; label: string }) {
  const r = leg.outcome;
  return (
    <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <h2 className="mt-0.5 text-sm font-bold tracking-tight text-slate-900 sm:text-lg">
        <Link
          href={`/route/${leg.from.crs}-${leg.to.crs}?band=${band}`}
          className="hover:text-emerald-700 transition-colors"
        >
          {leg.from.name} <span className="font-normal text-slate-300">→</span>{" "}
          {leg.to.name}
        </Link>
      </h2>
      {r === null ? (
        <RouteWarmingInline
          key={`${leg.from.crs}-${leg.to.crs}-${band}`}
          from={leg.from.crs}
          to={leg.to.crs}
          band={band}
        />
      ) : r.noService ? (
        <p className="mt-6 mb-4 text-sm text-slate-500">
          No direct trains in the {BAND_LABELS[band]} band.
        </p>
      ) : (
        <>
          <div className="mt-3">
            <ScoreDial score={r.score} size={96} />
          </div>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">{r.verdict}</p>
          {r.coverage && (
            <p className="mt-2 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              Provisional, {r.coverage.months} months so far
            </p>
          )}
        </>
      )}
    </div>
  );
}
