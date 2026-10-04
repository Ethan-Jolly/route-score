"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StationField } from "./StationSearch";
import type { Station, TimeBand } from "@/lib/types";

/** Picks the second route of a comparison. Starts from the first route's
 * origin, since the usual question is "which line from my station?". */
export function ComparePicker({
  a,
  initialFrom,
  band,
}: {
  /** Slug of the route already chosen. */
  a: string;
  initialFrom: Station;
  band: TimeBand;
}) {
  const router = useRouter();
  const [from, setFrom] = useState<Station | null>(initialFrom);
  const [to, setTo] = useState<Station | null>(null);
  const [loading, setLoading] = useState(false);

  const ready = from && to && from.crs !== to.crs;

  function go() {
    if (!ready) return;
    setLoading(true);
    router.push(`/compare?a=${a}&b=${from.crs}-${to.crs}-${band}`);
  }

  return (
    <div className="w-full text-left">
      <div className="flex flex-col gap-3">
        <StationField
          label="From"
          placeholder="e.g. Brighton"
          selected={from}
          onSelect={setFrom}
        />
        <StationField
          label="To"
          placeholder="e.g. London Victoria"
          selected={to}
          onSelect={setTo}
        />
      </div>
      <button
        type="button"
        onClick={go}
        disabled={!ready || loading}
        className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Loading…" : "Compare"}
      </button>
    </div>
  );
}
