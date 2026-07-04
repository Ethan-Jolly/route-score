import Link from "next/link";
import { BAND_LABELS, TIER_COLORS, tierFor } from "@/lib/score";
import { TrendBadge } from "./TrendChart";
import type { RouteScoreResult } from "@/lib/types";

/** Compact score card used for the homepage example routes. */
export function MiniScoreCard({ result }: { result: RouteScoreResult }) {
  const color = TIER_COLORS[tierFor(result.score)];
  return (
    <Link
      href={`/route/${result.from.crs}-${result.to.crs}?band=${result.band}`}
      className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all flex items-center gap-4"
      prefetch={false}
    >
      <span
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white tabular-nums"
        style={{ background: color }}
      >
        {result.score}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">
          {result.from.name} → {result.to.name}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
          {BAND_LABELS[result.band]}
          <TrendBadge trend={result.trend} />
        </span>
      </span>
      <span
        className="text-slate-300 group-hover:text-slate-500 transition-colors"
        aria-hidden
      >
        →
      </span>
    </Link>
  );
}
