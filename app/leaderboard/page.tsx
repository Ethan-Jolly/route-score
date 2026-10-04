import Link from "next/link";
import type { Metadata } from "next";
import { getLeaderboard, type Board, type LeaderboardEntry } from "@/lib/leaderboard";
import { TIER_COLORS, tierFor } from "@/lib/score";

export const metadata: Metadata = {
  title: "Leaderboard: the best and worst UK rail routes",
  description:
    "The ten best and ten worst UK rail routes, ranked on a year of peak-time punctuality data. See the whole country or just London.",
};

// Data only changes when the scheduled ingest runs (daily), so an hourly
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
    <div className="mx-auto max-w-5xl px-4 pb-12">
      <section className="pt-8 pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Leaderboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          The ten best and ten worst routes we&apos;ve scored, on a year of
          peak-time trains. Tap a route to see the detail.
        </p>
      </section>

      {/* Scope toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-sm">
        <ScopeTab scope="uk" active={scope} label="All of the UK" />
        <ScopeTab scope="london" active={scope} label="London only" />
      </div>

      {isDemo && (
        <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-700">
          This is <strong>demo data</strong>. Connect HSP and a database, then
          run the ingest, to see real rankings.
        </p>
      )}

      {!hasData ? (
        <p className="mt-10 rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
          No routes have enough data yet. The leaderboard fills in as the
          ingest job works through the route list.
        </p>
      ) : (
        <div className="mt-6 grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <BoardColumn
            title="Best rated"
            accent="text-emerald-600"
            subtitle={scope === "london" ? "London's most reliable" : "The UK's most reliable"}
            entries={active.best}
          />
          <BoardColumn
            title="Worst rated"
            accent="text-red-600"
            subtitle={scope === "london" ? "London's least reliable" : "The UK's least reliable"}
            entries={active.worst}
          />
        </div>
      )}

      {hasData && (
        <p className="mt-6 text-xs text-slate-400">
          Out of {board.qualified.toLocaleString()} routes with at least six
          months of data and a regular service. Scores here use weekday peak
          trains only (06:00–09:00 and 16:00–19:00), so every route is judged
          on the same hours.
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
        href={`/route/${entry.from.crs}-${entry.to.crs}?band=am-peak`}
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
            {entry.onTimePct.toFixed(0)}% on time · about {entry.servicesPerDay}{" "}
            peak trains a day
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
