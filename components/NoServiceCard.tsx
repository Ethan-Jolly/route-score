import Link from "next/link";
import { BAND_LABELS } from "@/lib/score";
import type { Station, TimeBand } from "@/lib/types";

/** Shown when HSP confirms a station pair has no direct trains — a real,
 * meaningful answer, not an error. Route Score scores direct services only. */
export function NoServiceCard({
  from,
  to,
  band,
}: {
  from: Station;
  to: Station;
  band: TimeBand;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-3xl">
        🚫
      </span>
      <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">
        No direct trains
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        National Rail&apos;s performance data shows no direct services from{" "}
        <span className="font-semibold text-slate-700">{from.name}</span> to{" "}
        <span className="font-semibold text-slate-700">{to.name}</span> in the{" "}
        {BAND_LABELS[band]} band. Route Score rates direct journeys only — a
        route with changes is really several routes, each with its own score.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Try each leg of your journey separately, or pick two stations on the
        same line.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
      >
        Search another route
      </Link>
    </div>
  );
}
