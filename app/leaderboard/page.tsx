import Link from "next/link";
import type { Metadata } from "next";
import { getLeaderboard, type Board, type LeaderboardEntry } from "@/lib/leaderboard";
import { TIER_COLORS, tierFor } from "@/lib/score";

export const metadata: Metadata = {
  title: "Leaderboard — the best and worst UK rail routes",
  description:
    "The best and worst-performing UK rail routes, ranked by a year of real punctuality data. Filter to London commuter routes or the whole national network.",
};

// Data only changes when the backfill/warm crons run (nightly), so an hourly
// rebuild is plenty and keeps the page fast.
export const revalidate = 3600;

type Scope = "uk" | "london";

interface Props {
  searchParams: Promise<{ scope?: string }>;
}

export default async function LeaderboardPage(props: Props) {
  const { scope: scopeParam } = await props.searchParams;
  const scope: Scope = scopeParam === "london" ? "london" : "uk";

  const board = await getLeaderboard(10);
  const active: Board = scope === "london" ? board.london : board.uk;
  const isDemo = board.source === "demo";
  const hasData = active.best.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20">
      <section className="pt-12 pb-6">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          The leaderboard
        </h1>
        <p className="mt-3 max-w-2xl text-slate-500">
          Every route ranked by its Route Score — one honest number from a year
          of National Rail punctuality data. Best at the top, worst laid bare.
        </p>
      </section>

      {/* Scope toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
        <ScopeTab scope="uk" active={scope} label="All of the UK" />
        <ScopeTab scope="london" active={scope} label="London only" />
      </div>

      {isDemo && (
        <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-700">
          Showing <strong>demo data</strong> — connect HSP + a database and run
          the backfill to populate real rankings.
        </p>
      )}

      {!hasData ? (
        <p className="mt-10 rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
          No routes have enough data yet. The leaderboard fills in as the
          backfill job warms the route cache — check back soon.
        </p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <BoardColumn
            title="Best rated"
            accent="text-emerald-600"
            subtitle={scope === "london" ? "London's most reliable" : "The UK's most reliable"}
            entries={active.best}
          />
          <BoardColumn
            title="Worst rated"
            accent="text-red-600"
            subtitle={scope === "london" ? "London's worst offenders" : "The UK's worst offenders"}
            entries={active.worst}
          />
        </div>
      )}

      {hasData && (
        <p className="mt-10 text-xs text-slate-400">
          Ranked across {board.qualified.toLocaleString()} routes with at least
          six months of data and regular service. All scores use all-day
          performance so routes are directly comparable.
        </p>
      )}
    </div>
  );
}

function ScopeTab({
  scope,
  active,
  label,
}: {
  scope: Scope;
  active: Scope;
  label: string;
}) {
  const isActive = scope === active;
  return (
    <Link
      href={`/leaderboard?scope=${scope}`}
      scroll={false}
      className={
        "rounded-md px-4 py-1.5 font-medium transition-colors " +
        (isActive
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:text-slate-900")
      }
    >
      {label}
    </Link>
  );
}

function BoardColumn({
  title,
  subtitle,
  accent,
  entries,
}: {
  title: string;
  subtitle: string;
  accent: string;
  entries: LeaderboardEntry[];
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className={`text-lg font-bold ${accent}`}>{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      <ol className="space-y-2">
        {entries.map((e, i) => (
          <LeaderboardRow key={`${e.from.crs}-${e.to.crs}`} rank={i + 1} entry={e} />
        ))}
      </ol>
    </section>
  );
}

function LeaderboardRow({ rank, entry }: { rank: number; entry: LeaderboardEntry }) {
  const color = TIER_COLORS[tierFor(entry.score)];
  return (
    <li>
      <Link
        href={`/route/${entry.from.crs}-${entry.to.crs}?band=all-day`}
        prefetch={false}
        className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
      >
        <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-300 tabular-nums">
          {rank}
        </span>
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white tabular-nums"
          style={{ background: color }}
        >
          {entry.score}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {entry.from.name} → {entry.to.name}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400 tabular-nums">
            {entry.onTimePct.toFixed(0)}% on time · ~{entry.servicesPerDay}{" "}
            trains/day
          </span>
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
