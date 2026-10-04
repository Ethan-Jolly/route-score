import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { StationSearch } from "@/components/StationSearch";
import { TrendBadge } from "@/components/TrendChart";
import { getStationRoutes } from "@/lib/provider";
import { stationByCrs } from "@/lib/stations";
import { BAND_LABELS, TIER_COLORS, formatMins, isTimeBand, tierFor } from "@/lib/score";
import type { RouteScoreResult, TimeBand } from "@/lib/types";

interface Props {
  params: Promise<{ crs: string }>;
  searchParams: Promise<{ band?: string; dir?: string }>;
}

type Direction = "from" | "to";

const BANDS: TimeBand[] = ["am-peak", "pm-peak", "off-peak"];

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { crs } = await props.params;
  const station = stationByCrs(crs);
  if (!station) return { title: "Station not found" };
  return {
    title: `${station.name} — every route scored`,
    description: `Route Scores for every direct route from and to ${station.name}, side by side.`,
  };
}

export default async function StationPage(props: Props) {
  const { crs } = await props.params;
  const { band: bandParam, dir: dirParam } = await props.searchParams;
  const station = stationByCrs(crs);
  if (!station) notFound();
  const band: TimeBand = bandParam && isTimeBand(bandParam) ? bandParam : "am-peak";

  const { departures, arrivals } = await getStationRoutes(station.crs, band);
  // Default to departures, unless only arrivals have anything to show.
  const dir: Direction =
    dirParam === "to" || (dirParam !== "from" && departures.length === 0 && arrivals.length > 0)
      ? "to"
      : "from";
  const routes = dir === "from" ? departures : arrivals;
  const href = (b: TimeBand, d: Direction) => `/station/${station.crs}?band=${b}&dir=${d}`;

  const average =
    routes.length > 0
      ? Math.round(routes.reduce((s, r) => s + r.score, 0) / routes.length)
      : null;
  const other = (r: RouteScoreResult) => (dir === "from" ? r.to : r.from);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <section className="rise-in pt-10">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Station
        </p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {station.name}{" "}
          <span className="font-mono text-base font-medium text-slate-400">
            {station.crs}
          </span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Every direct route we hold data for, scored side by side. Pick one to
          see its full breakdown.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
            {(["from", "to"] as const).map((d) => (
              <Link
                key={d}
                href={href(band, d)}
                scroll={false}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  d === dir ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {d === "from" ? "Trains from here" : "Trains to here"}
                <span className={`ml-1.5 tabular-nums ${d === dir ? "text-slate-300" : "text-slate-400"}`}>
                  {(d === "from" ? departures : arrivals).length}
                </span>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {BANDS.map((b) => (
              <Link
                key={b}
                href={href(b, dir)}
                scroll={false}
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
      </section>

      {routes.length === 0 ? (
        <p className="rise-in-delay-1 mt-8 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No {BAND_LABELS[band]} routes {dir === "from" ? "from" : "to"}{" "}
          {station.name} have been scored yet. Search for one below and
          we&apos;ll start collecting its data.
        </p>
      ) : (
        <>
          <section className="rise-in-delay-1 mt-8 grid gap-3 grid-cols-2 lg:grid-cols-4">
            <SummaryTile label="Routes scored" value={String(routes.length)} />
            <SummaryTile
              label="Average score"
              value={String(average)}
              color={TIER_COLORS[tierFor(average ?? 0)]}
            />
            <SummaryTile
              label="Best route"
              value={String(routes[0].score)}
              color={TIER_COLORS[tierFor(routes[0].score)]}
              detail={other(routes[0]).name}
            />
            <SummaryTile
              label="Worst route"
              value={String(routes[routes.length - 1].score)}
              color={TIER_COLORS[tierFor(routes[routes.length - 1].score)]}
              detail={other(routes[routes.length - 1]).name}
            />
          </section>

          <ol className="rise-in-delay-2 mt-6 space-y-2">
            {routes.map((r) => (
              <RouteRow key={`${r.from.crs}-${r.to.crs}`} result={r} dir={dir} />
            ))}
          </ol>
          <p className="mt-4 text-xs text-slate-400">
            {BAND_LABELS[band]} scores, best first. Only routes we already hold
            data for are listed.
          </p>
        </>
      )}

      <section className="mt-12 mx-auto max-w-2xl">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Route not listed?
        </h2>
        <StationSearch
          key={station.crs}
          initialBand={band}
          initialFrom={station}
          autoFocus={false}
        />
      </section>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900" style={{ color }}>
        {value}
      </p>
      {detail && <p className="truncate text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function RouteRow({ result, dir }: { result: RouteScoreResult; dir: Direction }) {
  const color = TIER_COLORS[tierFor(result.score)];
  const facts = [
    `${Math.round(result.onTimePct)}% on time`,
    `every ${formatMins(result.gapMins)}`,
    result.expectedMins !== undefined && `${formatMins(result.expectedMins)} journey`,
    result.coverage && `provisional, ${result.coverage.months} months`,
    result.limitedData && "limited data",
  ].filter(Boolean);
  return (
    <li>
      <Link
        href={`/route/${result.from.crs}-${result.to.crs}?band=${result.band}`}
        prefetch={false}
        className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white tabular-nums"
          style={{ background: color }}
        >
          {result.score}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {dir === "from" ? (
              <>
                <span className="font-normal text-slate-300">→</span> {result.to.name}
              </>
            ) : (
              <>
                {result.from.name} <span className="font-normal text-slate-300">→</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-400 tabular-nums">
            {facts.join(" · ")}
          </span>
        </span>
        <span className="hidden sm:block">
          <TrendBadge trend={result.trend} />
        </span>
        <span
          className="text-slate-300 group-hover:text-slate-500 transition-colors"
          aria-hidden
        >
          →
        </span>
      </Link>
    </li>
  );
}
