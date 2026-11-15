import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getOperatorCard, type OperatorRoute } from "@/lib/operators";
import { TIER_COLORS, tierFor } from "@/lib/score";
import { ScoreDial } from "@/components/ScoreDial";
import { TrendBadge, TrendChart } from "@/components/TrendChart";

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const card = await getOperatorCard((await props.params).slug);
  if (!card) return { title: "Operator not found" };
  return {
    title: `${card.name} scores ${card.score}/100`,
    description: `${card.name}'s report card: ${Math.round(card.onTimePct)}% of peak trains on time across ${card.routes.length} routes, ranked ${card.rank} of ${card.of} operators.`,
  };
}

/** How many routes to show at each end. */
const SHOWN = 6;

export default async function OperatorPage(props: Props) {
  const card = await getOperatorCard((await props.params).slug);
  if (!card) notFound();
  const color = TIER_COLORS[tierFor(card.score)];
  const best = card.routes.slice(0, SHOWN);
  const worst = card.routes.length > SHOWN ? card.routes.slice(-SHOWN).reverse() : [];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-12">
      <Link href="/operators" className="text-xs font-semibold text-slate-400 hover:text-slate-600">
        ← All operators
      </Link>
      <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
        {card.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Report card · ranked {card.rank} of {card.of} operators
      </p>

      <div className="rise-in mt-6 grid gap-x-8 gap-y-4 lg:grid-cols-[auto_1fr] items-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mx-auto">
          <ScoreDial score={card.score} />
        </div>
        <div className="text-center lg:text-left">
          <div className="flex items-center justify-center lg:justify-start gap-2">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
              {tierFor(card.score)}
            </span>
            <TrendBadge trend={card.trend} />
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-semibold text-slate-900">{card.verdict}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-left">
            <Stat label="On time" value={`${Math.round(card.onTimePct)}%`} />
            <Stat label="Not cancelled or 30+ late" value={`${Math.round(card.reliabilityPct)}%`} />
            <Stat label="Routes" value={String(card.routes.length)} />
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            Based on {card.trains.toLocaleString("en-GB")} weekday peak trains
            (06:00–09:00 and 16:00–19:00) on the routes {card.name} mainly runs.
          </p>
        </div>
      </div>

      {card.monthlyScores.length >= 2 && (
        <section className="rise-in-delay-1 mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Month by month
          </h2>
          <TrendChart scores={card.monthlyScores} />
        </section>
      )}

      <div className="rise-in-delay-2 mt-6 grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <RouteList title="Best routes" accent="text-emerald-600" routes={best} />
        {worst.length > 0 && (
          <RouteList title="Worst routes" accent="text-red-600" routes={worst} />
        )}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        A route counts for the operator that runs most of its peak hours.
        Routes marked &ldquo;shared&rdquo; also see trains from other
        operators, which are included in the route&apos;s score.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-3">
      <dt className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function RouteList({
  title,
  accent,
  routes,
}: {
  title: string;
  accent: string;
  routes: OperatorRoute[];
}) {
  return (
    <section className="min-w-0">
      <h2 className={`mb-3 text-lg font-bold ${accent}`}>{title}</h2>
      <ol className="space-y-2">
        {routes.map((r) => (
          <li key={`${r.from.crs}-${r.to.crs}`}>
            <Link
              href={`/route/${r.from.crs}-${r.to.crs}?band=am-peak`}
              prefetch={false}
              className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white tabular-nums"
                style={{ background: TIER_COLORS[tierFor(r.score)] }}
              >
                {r.score}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">
                  {r.from.name} → {r.to.name}
                </span>
                <span className="mt-0.5 block text-xs text-slate-400 tabular-nums">
                  {Math.round(r.onTimePct)}% on time
                  {r.shared && " · shared"}
                </span>
              </span>
              <span className="text-slate-300 group-hover:text-slate-500 transition-colors" aria-hidden>
                →
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
