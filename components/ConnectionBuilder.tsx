"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StationField } from "./StationSearch";
import type { Station, TimeBand } from "@/lib/types";
import { inBoth, useKnownRoutes } from "./useKnownRoutes";

/** Picks the three stations of a journey with one change. */
export function ConnectionBuilder({
  band,
  initialFrom = null,
  initialVia = null,
  initialTo = null,
}: {
  band: TimeBand;
  initialFrom?: Station | null;
  initialVia?: Station | null;
  initialTo?: Station | null;
}) {
  const router = useRouter();
  const [from, setFrom] = useState<Station | null>(initialFrom);
  const [via, setVia] = useState<Station | null>(initialVia);
  const [to, setTo] = useState<Station | null>(initialTo);
  const [loading, setLoading] = useState(false);
  const fromRoutes = useKnownRoutes(from);
  const viaRoutes = useKnownRoutes(via);
  const toRoutes = useKnownRoutes(to);
  // The change has to be reachable from the start and lead on to the end.
  const changes =
    fromRoutes && toRoutes
      ? inBoth(fromRoutes.destinations, toRoutes.origins)
      : (fromRoutes?.destinations ?? toRoutes?.origins);

  const ready =
    from && via && to && from.crs !== via.crs && via.crs !== to.crs && from.crs !== to.crs;
  const unchanged =
    from?.crs === initialFrom?.crs &&
    via?.crs === initialVia?.crs &&
    to?.crs === initialTo?.crs;

  function go() {
    if (!ready) return;
    setLoading(true);
    router.push(`/connection?from=${from.crs}&via=${via.crs}&to=${to.crs}&band=${band}`);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row">
        <StationField
          label="From"
          placeholder="e.g. Brighton"
          selected={from}
          onSelect={setFrom}
          autoFocus={!initialFrom}
          options={viaRoutes?.origins}
          optionsLabel={via ? `Direct to ${via.name}` : undefined}
        />
        <StationField
          label="Change at"
          placeholder="e.g. Clapham Junction"
          selected={via}
          onSelect={setVia}
          options={changes}
          optionsLabel={
            from && to
              ? `Between ${from.name} and ${to.name}`
              : from
                ? `Direct from ${from.name}`
                : to
                  ? `Direct to ${to.name}`
                  : undefined
          }
        />
        <StationField
          label="To"
          placeholder="e.g. Reading"
          selected={to}
          onSelect={setTo}
          options={viaRoutes?.destinations}
          optionsLabel={via ? `Direct from ${via.name}` : undefined}
        />
      </div>
      <button
        type="button"
        onClick={go}
        disabled={!ready || loading || unchanged}
        className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Loading…" : "Score the journey"}
      </button>
    </div>
  );
}
