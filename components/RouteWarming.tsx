"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Station, TimeBand } from "@/lib/types";
import { BAND_LABELS } from "@/lib/score";

/**
 * Shown the first time anyone views a route that isn't cached yet. Drives
 * /api/route-score/fill in a loop — each call pulls a few more months from the
 * (slow) HSP API — showing live progress, then refreshes the page to reveal
 * the real dashboard once all 12 months are in the DB.
 *
 * This keeps the cold-load cost (~a minute, once per route, ever) off the
 * server render and turns it into a deliberate, on-brand moment.
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
  const router = useRouter();
  const [cached, setCached] = useState(0);
  const [total, setTotal] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    async function run() {
      for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/route-score/fill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: from.crs, to: to.crs, band }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const p: { done: boolean; cached: number; total: number } =
            await res.json();
          if (cancelled) return;
          setCached(p.cached);
          setTotal(p.total);
          if (p.done) {
            router.refresh();
            return;
          }
        } catch {
          if (cancelled) return;
          setError("HSP is being slow right now. Retrying…");
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [from.crs, to.crs, band, router]);

  const pct = Math.round((cached / total) * 100);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl">
        🚆
      </span>
      <h1 className="mt-5 text-lg font-bold tracking-tight text-slate-900">
        Scoring {from.name} → {to.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Pulling a year of {BAND_LABELS[band]} performance data from National
        Rail. This happens once per route, then it&apos;s instant forever.
      </p>

      <div className="mt-6 h-2.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${Math.max(6, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs font-medium text-slate-400 tabular-nums">
        {cached} of {total} months
      </p>
      {error && <p className="mt-3 text-xs text-amber-600">{error}</p>}
    </div>
  );
}
