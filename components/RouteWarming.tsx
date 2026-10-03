"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Station, TimeBand } from "@/lib/types";
import { BAND_LABELS } from "@/lib/score";

interface FillProgress {
  done: boolean;
  ready: boolean;
  months: number;
  cached: number;
  total: number;
  stalled: boolean;
}

/**
 * Drives /api/route-score/fill in a loop — each call is a time-boxed step
 * pulling a few more hours of data from the (slow) HSP API.
 *
 * `until: "ready"` stops as soon as there is enough to show a score and
 * refreshes the page; `until: "done"` keeps going until the whole window is
 * stored, refreshing whenever another month lands so the page fills in live.
 * The first step also registers the route with the scheduled ingest, which
 * finishes the job if the visitor leaves.
 */
function useRouteFill(
  from: string,
  to: string,
  band: TimeBand,
  until: "ready" | "done",
  shown: { months: number; ready: boolean }
) {
  const router = useRouter();
  const [progress, setProgress] = useState<FillProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const started = useRef(false);
  const shownRef = useRef(shown);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    async function run() {
      // Hour-sized HSP calls suit almost every route; halve the window when a
      // step stalls because the route is too busy for them.
      let maxSpanMinutes = 60;
      let failures = 0;
      let { months, ready } = shownRef.current;
      for (let attempt = 0; attempt < 200 && failures < 8 && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/route-score/fill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from, to, band, maxSpanMinutes }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const p: FillProgress = await res.json();
          if (cancelled) return;
          setError(null);
          setProgress(p);
          if (until === "ready" ? p.ready : p.done) {
            router.refresh();
            return;
          }
          if (until === "done" && (p.months !== months || p.ready !== ready)) {
            months = p.months;
            ready = p.ready;
            router.refresh();
          }
          if (p.stalled) {
            failures++;
            maxSpanMinutes = Math.max(15, maxSpanMinutes / 2);
          } else {
            failures = 0;
          }
        } catch {
          failures++;
          if (cancelled) return;
          setError("HSP is being slow right now. Retrying…");
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!cancelled) setGaveUp(true);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [from, to, band, until, router]);

  const pct = progress ? Math.round((progress.cached / progress.total) * 100) : 0;
  return { progress, pct, error, gaveUp };
}

/**
 * Full-page state shown the first time anyone views a route with nothing
 * stored yet. Hands over to the real dashboard as soon as the most recent
 * months are in; the rest of the year then loads behind it (RouteFilling).
 */
export function RouteWarming({
  from,
  to,
  band,
}: {
  from: Station;
  to: Station;
  band: TimeBand;
}) {
  const { pct, error, gaveUp } = useRouteFill(from.crs, to.crs, band, "ready", {
    months: 0,
    ready: false,
  });

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
        🚆
      </span>
      <h1 className="mt-5 text-lg font-bold tracking-tight text-slate-900">
        Scoring {from.name} → {to.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Pulling {BAND_LABELS[band]} performance data from National Rail. You&apos;ll
        see a score as soon as the most recent months are in; the rest of the
        year loads behind it.
      </p>

      <div className="mt-6 h-2.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${Math.max(6, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs font-medium text-slate-400 tabular-nums">
        {pct}% of the year fetched
      </p>
      {gaveUp ? (
        <p className="mt-3 text-xs text-amber-600">
          National Rail&apos;s data service isn&apos;t keeping up right now.
          We&apos;ll keep fetching this route in the background — check back
          later.
        </p>
      ) : (
        error && <p className="mt-3 text-xs text-amber-600">{error}</p>
      )}
    </div>
  );
}

/**
 * Slim banner on a dashboard that is already showing a score while more data
 * for `band` is still being collected — either the rest of the year for the
 * band on screen, or a different band the visitor asked for.
 */
export function RouteFilling({
  from,
  to,
  band,
  months,
  ready,
  message,
}: {
  from: string;
  to: string;
  band: TimeBand;
  /** Months of `band` the page was rendered with, and whether it's showing. */
  months: number;
  ready: boolean;
  message: string;
}) {
  const { pct, gaveUp } = useRouteFill(from, to, band, "done", { months, ready });

  return (
    <div className="rise-in mt-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-medium text-sky-900">{message}</p>
        <p className="text-[11px] font-medium text-sky-700 tabular-nums">
          {gaveUp ? "Paused — we'll finish in the background" : `${pct}% fetched`}
        </p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-500"
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
    </div>
  );
}
