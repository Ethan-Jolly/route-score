"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  COMMUTE_EVENT,
  readCommute,
  storeCommuteQuietly,
  writeCommute,
  type PinnedCommute,
} from "@/lib/commute";
import { BAND_LABELS, TIER_COLORS, tierFor } from "@/lib/score";
import { TrendBadge } from "./TrendChart";
import type { RouteScoreResult } from "@/lib/types";

/** The "since last time" baseline moves on at most once a day, so reloading
 * the homepage doesn't wipe out the change it just showed. */
const SEEN_REFRESH_MS = 20 * 3600_000;

/** The visitor's pinned route, first thing on the homepage. Renders nothing
 * when nothing is pinned. */
export function MyCommute() {
  const [pin, setPin] = useState<PinnedCommute | null>(null);
  const [result, setResult] = useState<RouteScoreResult | null>(null);
  const [baseline, setBaseline] = useState<PinnedCommute["seen"] | null>(null);

  useEffect(() => {
    const sync = () => setPin(readCommute());
    sync();
    window.addEventListener(COMMUTE_EVENT, sync);
    return () => window.removeEventListener(COMMUTE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    setBaseline(pin.seen);
    fetch(`/api/route-score?from=${pin.from}&to=${pin.to}&band=${pin.band}`)
      .then((res) => (res.status === 200 ? res.json() : null))
      .then((r: RouteScoreResult | null) => {
        if (cancelled || !r || r.noService) return;
        setResult(r);
        if (Date.now() - Date.parse(pin.seen.at) > SEEN_REFRESH_MS) {
          // Remember today's score for next time, without re-rendering this
          // visit's comparison.
          storeCommuteQuietly({ ...pin, seen: { score: r.score, at: new Date().toISOString() } });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only refetch when a different route is pinned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.from, pin?.to, pin?.band]);

  if (!pin) return null;
  const href = `/route/${pin.from}-${pin.to}?band=${pin.band}`;
  const score = result?.score;
  const delta = score !== undefined && baseline ? score - baseline.score : 0;
  const since = baseline
    ? new Date(baseline.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "";

  return (
    <section className="rise-in mx-auto mb-6 max-w-2xl">
      <div className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
        <Link
          href={href}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white tabular-nums"
          style={{ background: score !== undefined ? TIER_COLORS[tierFor(score)] : "#cbd5e1" }}
          aria-label={score !== undefined ? `Score ${score}` : "Loading score"}
        >
          {score ?? "…"}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            ★ Your commute
          </p>
          <Link href={href} className="block truncate font-semibold text-slate-900 hover:text-emerald-700">
            {pin.fromName} → {pin.toName}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{BAND_LABELS[pin.band]}</span>
            {result && <TrendBadge trend={result.trend} />}
            {result && delta !== 0 && (
              <span className={`font-semibold ${delta > 0 ? "text-emerald-700" : "text-red-600"}`}>
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} since {since}
              </span>
            )}
            {result && delta === 0 && <span>No change since {since}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => writeCommute(null)}
          className="self-start text-xs text-slate-400 hover:text-slate-600"
          title="Unpin"
          aria-label="Unpin your commute"
        >
          ✕
        </button>
      </div>
    </section>
  );
}
