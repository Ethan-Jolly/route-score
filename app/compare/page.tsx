import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ScoreDial } from "@/components/ScoreDial";
import { TrendBadge, TrendChart } from "@/components/TrendChart";
import { ComparePicker } from "@/components/ComparePicker";
import { RouteWarmingInline } from "@/components/RouteWarming";
import {
  getCachedRouteScore,
  getStationRoutes,
  parseRouteSlug,
  routeSlug,
} from "@/lib/provider";
import { stationByCrs } from "@/lib/stations";
import { BAND_LABELS, TIER_COLORS, formatMins, tierFor } from "@/lib/score";
import type { RouteScoreResult, Station, TimeBand } from "@/lib/types";

interface Props {
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
}

const BANDS: TimeBand[] = ["am-peak", "pm-peak", "off-peak"];

/** One half of a comparison. `outcome` is null while the route isn't stored. */
interface Side {
  slug: string;
  from: Station;
  to: Station;
  band: TimeBand;
  outcome: Awaited<ReturnType<typeof getCachedRouteScore>>;
}

async function loadSide(slug: string | string[] | undefined): Promise<Side | null> {
  if (typeof slug !== "string") return null;
  const parsed = parseRouteSlug(slug);
  if (!parsed) return null;
  const from = stationByCrs(parsed.from);
  const to = stationByCrs(parsed.to);
  if (!from || !to || from.crs === to.crs) return null;
  return {
    slug: routeSlug(from.crs, to.crs, parsed.band),
    from,
    to,
    band: parsed.band,
    outcome: await getCachedRouteScore(from.crs, to.crs, parsed.band),
  };
}

const scored = (side: Side | null): RouteScoreResult | null =>
  side?.outcome && side.outcome.noService === false ? side.outcome : null;

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { a, b } = await props.searchParams;
  const [sa, sb] = await Promise.all([loadSide(a), loadSide(b)]);
  if (!sa) return { title: "Compare routes" };
  const name = (s: Side) => `${s.from.name} → ${s.to.name}`;
  return { title: sb ? `${name(sa)} vs ${name(sb)}` : `Compare ${name(sa)}` };
}

export default async function ComparePage(props: Props) {
  const params = await props.searchParams;
  const [a, b] = await Promise.all([loadSide(params.a), loadSide(params.b)]);
  if (!a) redirect("/");

  const ra = scored(a);
  const rb = scored(b);
  // Until a second route is chosen, offer the other scored routes out of the
  // same station — the usual alternatives to a commute.
  const suggestions = b
    ? []
    : (await getStationRoutes(a.from.crs, a.band)).departures
        .filter((r) => r.to.crs !== a.to.crs)
        .slice(0, 6);

  const bandHref = (band: TimeBand) =>
    `/compare?a=${routeSlug(a.from.crs, a.to.crs, band)}` +
    (b ? `&b=${routeSlug(b.from.crs, b.to.crs, band)}` : "");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="rise-in">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Compare routes
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {BANDS.map((band) => (
            <Link
              key={band}
              href={bandHref(band)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                band === a.band && (!b || band === b.band)
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {BAND_LABELS[band]}
            </Link>
          ))}
        </div>
        {ra && rb && <p className="mt-4 text-slate-600">{headline(ra, rb)}</p>}
      </div>

      <div
        className={`rise-in-delay-1 mt-6 grid gap-3 sm:gap-6 ${
          b ? "grid-cols-2" : "sm:grid-cols-2"
        }`}
      >
        <SideCard side={a} />
        {b ? (
          <SideCard
            side={b}
            footer={
              <Link
                href={`/compare?a=${a.slug}`}
                className="mt-3 text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors"
              >
                Change route
              </Link>
            }
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 sm:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Compare with
            </h2>
            <ComparePicker a={a.slug} initialFrom={a.from} band={a.band} />
            {suggestions.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Other routes from {a.from.name}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {suggestions.map((r) => (
                    <li key={r.to.crs}>
                      <Link
                        href={`/compare?a=${a.slug}&b=${routeSlug(r.from.crs, r.to.crs, r.band)}`}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
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
              </div>
            )}
          </div>
        )}
      </div>

      {ra && rb && (
        <>
          <section className="rise-in-delay-2 mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
            {metricRows(ra, rb).map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-slate-100 px-3 py-3 first:border-t-0 sm:px-6"
              >
                <Cell win={row.better === "a"}>{row.a}</Cell>
                <div className="w-24 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400 sm:w-44">
                  {row.label}
                </div>
                <Cell win={row.better === "b"}>{row.b}</Cell>
              </div>
            ))}
          </section>

          <section className="rise-in-delay-3 mt-6 grid gap-3 sm:grid-cols-2 sm:gap-6">
            {[ra, rb].map((r, i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 className="mb-2 truncate text-xs font-semibold text-slate-500">
                  {r.from.name} → {r.to.name} · score by month
                </h2>
                <TrendChart scores={r.monthlyScores} />
              </div>
            ))}
          </section>

          <p className="mt-6 text-xs text-slate-400">
            ✓ marks the better figure in each row. Expected journey is the
            timetabled time plus the delay an average train picks up.
          </p>
        </>
      )}
    </div>
  );
}

function headline(a: RouteScoreResult, b: RouteScoreResult): ReactNode {
  const name = (r: RouteScoreResult) => (
    <strong className="font-semibold text-slate-900">
      {r.from.name} → {r.to.name}
    </strong>
  );
  // The same route in two bands needs the band to tell the sides apart.
  const sameRoute = a.from.crs === b.from.crs && a.to.crs === b.to.crs;
  const label = (r: RouteScoreResult) =>
    sameRoute ? (
      <strong className="font-semibold text-slate-900">{BAND_LABELS[r.band]}</strong>
    ) : (
      name(r)
    );
  if (a.score === b.score) {
    return (
      <>
        {label(a)} and {label(b)} both score {a.score}.
      </>
    );
  }
  const [hi, lo] = a.score > b.score ? [a, b] : [b, a];
  const diff = hi.score - lo.score;
  return (
    <>
      {label(hi)} scores {diff} point{diff === 1 ? "" : "s"} higher than {label(lo)}.
    </>
  );
}

interface Row {
  label: string;
  a: ReactNode;
  b: ReactNode;
  better: "a" | "b" | null;
}

function metricRows(a: RouteScoreResult, b: RouteScoreResult): Row[] {
  const better = (
    x: number | undefined,
    y: number | undefined,
    higherWins: boolean
  ): Row["better"] => {
    if (x === undefined || y === undefined || x === y) return null;
    return x > y === higherWins ? "a" : "b";
  };
  const mins = (m: number | undefined) => (m === undefined ? "—" : formatMins(m));
  return [
    {
      label: "Route Score",
      a: a.score,
      b: b.score,
      better: better(a.score, b.score, true),
    },
    {
      label: "On time",
      a: `${Math.round(a.onTimePct)}%`,
      b: `${Math.round(b.onTimePct)}%`,
      better: better(Math.round(a.onTimePct), Math.round(b.onTimePct), true),
    },
    {
      label: "Reliability",
      a: `${Math.round(a.reliabilityPct)}%`,
      b: `${Math.round(b.reliabilityPct)}%`,
      better: better(Math.round(a.reliabilityPct), Math.round(b.reliabilityPct), true),
    },
    {
      label: "Delay when late",
      a: `${a.avgDelayMins} min`,
      b: `${b.avgDelayMins} min`,
      better: better(a.avgDelayMins, b.avgDelayMins, false),
    },
    {
      label: "Time between trains",
      a: formatMins(a.gapMins),
      b: formatMins(b.gapMins),
      better: better(Math.round(a.gapMins), Math.round(b.gapMins), false),
    },
    {
      label: "Expected journey",
      a: mins(a.expectedMins),
      b: mins(b.expectedMins),
      better: better(a.expectedMins, b.expectedMins, false),
    },
    {
      label: "Trains per weekday",
      a: `~${a.servicesPerDay}`,
      b: `~${b.servicesPerDay}`,
      better: better(a.servicesPerDay, b.servicesPerDay, true),
    },
    {
      label: "Trend",
      a: <TrendBadge trend={a.trend} />,
      b: <TrendBadge trend={b.trend} />,
      better: null,
    },
    {
      label: "Operated by",
      a: <span className="text-xs sm:text-sm">{a.operators.join(" · ")}</span>,
      b: <span className="text-xs sm:text-sm">{b.operators.join(" · ")}</span>,
      better: null,
    },
  ];
}

function Cell({ win, children }: { win: boolean; children: ReactNode }) {
  return (
    <div
      className={`text-center text-sm tabular-nums sm:text-base ${
        win ? "font-bold text-emerald-700" : "font-medium text-slate-600"
      }`}
    >
      {win && (
        <span className="mr-1 text-xs" aria-label="better">
          ✓
        </span>
      )}
      {children}
    </div>
  );
}

function SideCard({ side, footer }: { side: Side; footer?: ReactNode }) {
  const r = side.outcome;
  return (
    <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm sm:p-6">
      <h2 className="text-sm font-bold tracking-tight text-slate-900 sm:text-lg">
        <Link
          href={`/route/${side.from.crs}-${side.to.crs}?band=${side.band}`}
          className="hover:text-emerald-700 transition-colors"
        >
          {side.from.name} <span className="font-normal text-slate-300">→</span>{" "}
          {side.to.name}
        </Link>
      </h2>
      <p className="mt-0.5 text-xs font-semibold text-slate-400">
        {BAND_LABELS[side.band]}
      </p>
      {r === null ? (
        <RouteWarmingInline
          key={side.slug}
          from={side.from.crs}
          to={side.to.crs}
          band={side.band}
        />
      ) : r.noService ? (
        <p className="mt-6 mb-4 text-sm text-slate-500">
          No direct trains in the {BAND_LABELS[side.band]} band.
        </p>
      ) : (
        <>
          <div className="mt-3">
            <ScoreDial score={r.score} size={120} />
          </div>
          <p
            className="mt-1 text-xs font-bold uppercase tracking-wider"
            style={{ color: TIER_COLORS[tierFor(r.score)] }}
          >
            {tierFor(r.score)}
          </p>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">{r.verdict}</p>
          {r.coverage && (
            <p className="mt-2 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              Provisional — {r.coverage.months} months so far
            </p>
          )}
        </>
      )}
      {footer}
    </div>
  );
}
