import Link from "next/link";
import { StationSearch } from "@/components/StationSearch";
import { MiniScoreCard } from "@/components/MiniScoreCard";
import { getCachedRouteScore } from "@/lib/provider";
import type { RouteScoreResult, TimeBand } from "@/lib/types";

const EXAMPLE_ROUTES: Array<{ from: string; to: string; band: TimeBand }> = [
  { from: "BTN", to: "LBG", band: "am-peak" },
  { from: "RDG", to: "PAD", band: "am-peak" },
  { from: "MAN", to: "LDS", band: "pm-peak" },
  { from: "CBG", to: "KGX", band: "am-peak" },
  { from: "GLC", to: "EDB", band: "am-peak" },
  { from: "WOK", to: "WAT", band: "am-peak" },
];

/** The headline changes from visit to visit: [opening, the words in green]. */
const HEADLINES: Array<[string, string]> = [
  ["How reliable is your commute,", "really?"],
  ["How does your commute", "actually compare?"],
  ["Is your train as late as", "it feels?"],
  ["How often is your train", "on time?"],
  ["Is it just you, or is your line", "that bad?"],
  ["What would you give your commute", "out of 100?"],
];

// Render per-request so the example cards reflect whatever routes are warm in
// the DB right now (a static build would freeze them at build time), and so
// the headline can vary. The six cached DB reads are cheap and run in parallel.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Fast path only: show examples already warmed in the DB (or all of them in
  // demo mode). Cold routes are skipped rather than blocking the homepage.
  const examples = (
    await Promise.all(
      EXAMPLE_ROUTES.map((r) => getCachedRouteScore(r.from, r.to, r.band))
    )
  ).filter((r): r is RouteScoreResult => r !== null && r.noService === false);
  const [opening, accent] = HEADLINES[Math.floor(Math.random() * HEADLINES.length)];

  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-10 pb-7 text-center sm:pt-12">
        <h1 className="rise-in text-4xl sm:text-5xl font-bold tracking-tight text-balance text-slate-900">
          {opening} <span className="text-emerald-600">{accent}</span>
        </h1>
        <p className="rise-in-delay-1 mx-auto mt-3 max-w-xl text-balance text-slate-500">
          Pick your route and get a score out of 100, worked out from a year of
          National Rail punctuality data. Free, and no sign-up.
        </p>
      </section>

      <section className="rise-in-delay-2 mx-auto max-w-2xl pb-10">
        <StationSearch />
        <p className="mt-3 text-center text-sm text-slate-500">
          Have to change trains?{" "}
          <Link
            href="/connection"
            className="font-semibold text-emerald-700 hover:text-emerald-800 transition-colors"
          >
            Score both legs as one journey
          </Link>
        </p>
      </section>

      {examples.length > 0 && (
        <section className="rise-in-delay-3 pb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
            Popular routes
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {examples.map((r) => (
              <MiniScoreCard
                key={`${r.from.crs}-${r.to.crs}-${r.band}`}
                result={r}
              />
            ))}
          </div>
        </section>
      )}

      <section className="pb-10">
        <Link
          href="/leaderboard"
          className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-5 text-white shadow-sm hover:shadow-md transition-all"
        >
          <span>
            <span className="block text-lg font-semibold">
              See the leaderboard
            </span>
            <span className="mt-0.5 block text-sm text-slate-300">
              The ten best and ten worst routes in the country, or just the
              London ones.
            </span>
          </span>
          <span
            className="text-2xl text-slate-400 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all"
            aria-hidden
          >
            →
          </span>
        </Link>
      </section>

      <section className="pb-12 grid gap-x-6 gap-y-4 sm:grid-cols-3 text-sm">
        <div>
          <h3 className="font-semibold text-slate-900">What goes into it</h3>
          <p className="mt-1 text-slate-500">
            Half the score is punctuality. The rest is cancellations, how late
            the late trains are, and how often trains run.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">A full year</h3>
          <p className="mt-1 text-slate-500">
            Scores cover the last twelve months and are shown month by month,
            so you can see whether a line is getting better or worse.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Easy to share</h3>
          <p className="mt-1 text-slate-500">
            Every route has a score card with its own link, which is handy
            when the group chat is arguing about whose line is worst.
          </p>
        </div>
      </section>
    </div>
  );
}
