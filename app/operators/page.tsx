import Link from "next/link";
import type { Metadata } from "next";
import { getOperatorCards } from "@/lib/operators";
import { TIER_COLORS, tierFor } from "@/lib/score";
import { TrendBadge } from "@/components/TrendChart";

export const metadata: Metadata = {
  title: "Train operators ranked",
  description:
    "Every UK train operator scored out of 100 on a year of peak-time punctuality across the routes it runs.",
};

export const revalidate = 3600;

export default async function OperatorsPage() {
  const cards = await getOperatorCards();

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12">
      <section className="pt-8 pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Operators, ranked
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Each operator scored on the routes it mainly runs, as if they were
          one big route: weekday peak trains over the past year. Tap one for
          its report card.
        </p>
      </section>

      {cards[0]?.source === "demo" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          This is <strong>demo data</strong>.
        </p>
      )}

      {cards.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
          Not enough data yet. Operators appear once three of their routes
          have six months stored.
        </p>
      ) : (
        <ol className="space-y-2">
          {cards.map((c) => (
            <li key={c.code}>
              <Link
                href={`/operator/${c.slug}`}
                prefetch={false}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
              >
                <span className="w-6 shrink-0 text-center text-sm font-semibold text-slate-300 tabular-nums">
                  {c.rank}
                </span>
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white tabular-nums"
                  style={{ background: TIER_COLORS[tierFor(c.score)] }}
                >
                  {c.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {c.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400 tabular-nums">
                    {Math.round(c.onTimePct)}% on time · {c.routes.length} routes
                  </span>
                </span>
                <span className="hidden sm:block">
                  <TrendBadge trend={c.trend} />
                </span>
                <span className="text-slate-300 group-hover:text-slate-500 transition-colors" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
