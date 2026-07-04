import { StationSearch } from "@/components/StationSearch";
import { MiniScoreCard } from "@/components/MiniScoreCard";
import { getCachedRouteScore } from "@/lib/provider";
import type { RouteScoreResult, TimeBand } from "@/lib/types";

const EXAMPLE_ROUTES: Array<{ from: string; to: string; band: TimeBand }> = [
  { from: "BTN", to: "LBG", band: "am-peak" },
  { from: "RDG", to: "PAD", band: "am-peak" },
  { from: "MAN", to: "LDS", band: "pm-peak" },
  { from: "CBG", to: "KGX", band: "am-peak" },
  { from: "GLC", to: "EDB", band: "all-day" },
  { from: "WOK", to: "WAT", band: "am-peak" },
];

// Render per-request so the example cards reflect whatever routes are warm in
// the DB right now (a static build would freeze them at build time). The six
// cached DB reads are cheap and run in parallel.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Fast path only: show examples already warmed in the DB (or all of them in
  // demo mode). Cold routes are skipped rather than blocking the homepage.
  const examples = (
    await Promise.all(
      EXAMPLE_ROUTES.map((r) => getCachedRouteScore(r.from, r.to, r.band))
    )
  ).filter((r): r is RouteScoreResult => r !== null && r.noService === false);

  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-14 pb-10 text-center">
        <h1 className="rise-in text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          How reliable is your commute,{" "}
          <span className="text-emerald-600">really?</span>
        </h1>
        <p className="rise-in-delay-1 mx-auto mt-4 max-w-xl text-slate-500">
          Route Score turns a year of National Rail performance data into one
          honest number for your route. No sign-up, no journey planner — just
          the truth about your line.
        </p>
      </section>

      <section className="rise-in-delay-2 mx-auto max-w-2xl pb-12">
        <StationSearch />
      </section>

      {examples.length > 0 && (
        <section className="rise-in-delay-3 pb-16">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">
            See it in action
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

      <section className="pb-20 grid gap-6 sm:grid-cols-3 text-sm">
        <div>
          <h3 className="font-semibold text-slate-900">One number</h3>
          <p className="mt-1 text-slate-500">
            60% punctuality, 25% reliability, 15% delay severity. Weighted the
            way commuters actually feel it.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Twelve months of truth</h3>
          <p className="mt-1 text-slate-500">
            Every score is built from a full year of historical performance
            data, month by month, so you can see the trend.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Made to share</h3>
          <p className="mt-1 text-slate-500">
            Every route gets a shareable score card URL. Send it to the group
            chat. Settle the argument.
          </p>
        </div>
      </section>
    </div>
  );
}
