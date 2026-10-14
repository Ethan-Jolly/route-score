"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StationField } from "./StationSearch";
import type { Station, TimeBand } from "@/lib/types";
import { inBoth, useKnownRoutes } from "./useKnownRoutes";
import { STATIONS } from "@/lib/stations";
import { INTERCHANGE_CRS, TUBE_OPTIONS, isTubeId } from "@/lib/tubeStations";

/** Which leg, if either, is on the Tube. */
export type TubeMode = "none" | "first" | "second";

const MODES: { mode: TubeMode; label: string }[] = [
  { mode: "none", label: "Two trains" },
  { mode: "second", label: "Train, then Tube" },
  { mode: "first", label: "Tube, then train" },
];

/** Mainline stations with the Tube a short walk away. */
const INTERCHANGES = STATIONS.filter((s) => INTERCHANGE_CRS.has(s.crs));

const codeOf = (s: Station) => (isTubeId(s.crs) ? "Tube" : s.crs);

/** Picks the three stations of a journey with one change, either leg of
 * which can be on the Tube. */
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
  const [mode, setMode] = useState<TubeMode>(
    initialFrom && isTubeId(initialFrom.crs)
      ? "first"
      : initialTo && isTubeId(initialTo.crs)
        ? "second"
        : "none"
  );
  const [from, setFrom] = useState<Station | null>(initialFrom);
  const [via, setVia] = useState<Station | null>(initialVia);
  const [to, setTo] = useState<Station | null>(initialTo);
  const [loading, setLoading] = useState(false);
  const rail = (s: Station | null) => (s && !isTubeId(s.crs) ? s : null);
  const fromRoutes = useKnownRoutes(rail(from));
  const viaRoutes = useKnownRoutes(rail(via));
  const toRoutes = useKnownRoutes(rail(to));

  function changeMode(next: TubeMode) {
    setMode(next);
    // Keep whatever still fits the new shape of the journey.
    if (from && isTubeId(from.crs) !== (next === "first")) setFrom(null);
    if (to && isTubeId(to.crs) !== (next === "second")) setTo(null);
    if (via && next !== "none" && !INTERCHANGE_CRS.has(via.crs)) setVia(null);
  }

  // The change has to be reachable from the start and lead on to the end, by
  // train on the train legs; with a Tube leg it must also be an interchange.
  let changes: Station[] | undefined;
  if (mode === "none") {
    changes =
      fromRoutes && toRoutes
        ? inBoth(fromRoutes.destinations, toRoutes.origins)
        : (fromRoutes?.destinations ?? toRoutes?.origins);
  } else {
    const byTrain = mode === "second" ? fromRoutes?.destinations : toRoutes?.origins;
    const reachable = byTrain ? inBoth(INTERCHANGES, byTrain) : [];
    changes = reachable.length > 0 ? reachable : INTERCHANGES;
  }
  const changeLabel =
    mode === "none"
      ? from && to
        ? `Between ${from.name} and ${to.name}`
        : from
          ? `Direct from ${from.name}`
          : to
            ? `Direct to ${to.name}`
            : undefined
      : mode === "second" && from && fromRoutes
        ? `Direct from ${from.name}, with the Tube`
        : mode === "first" && to && toRoutes
          ? `Direct to ${to.name}, with the Tube`
          : "Stations with the Tube";

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
      <div
        role="radiogroup"
        aria-label="How the journey is made"
        className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"
      >
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            onClick={() => changeMode(m.mode)}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
              mode === m.mode
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {mode === "first" ? (
          <StationField
            key="from-tube"
            label="From (Tube)"
            placeholder="e.g. Oxford Circus"
            selected={from}
            onSelect={setFrom}
            autoFocus={!initialFrom}
            options={TUBE_OPTIONS}
            optionsLabel="Tube stations"
            allowUnlisted={false}
            codeOf={codeOf}
          />
        ) : (
          <StationField
            key="from-rail"
            label="From"
            placeholder="e.g. Brighton"
            selected={from}
            onSelect={setFrom}
            autoFocus={!initialFrom}
            options={viaRoutes?.origins}
            optionsLabel={via ? `Direct to ${via.name}` : undefined}
          />
        )}
        <StationField
          key={`via-${mode === "none" ? "rail" : "tube"}`}
          label="Change at"
          placeholder={mode === "none" ? "e.g. Clapham Junction" : "e.g. London Victoria"}
          selected={via}
          onSelect={setVia}
          options={changes}
          optionsLabel={changeLabel}
          allowUnlisted={mode === "none"}
        />
        {mode === "second" ? (
          <StationField
            key="to-tube"
            label="To (Tube)"
            placeholder="e.g. Oxford Circus"
            selected={to}
            onSelect={setTo}
            options={TUBE_OPTIONS}
            optionsLabel="Tube stations"
            allowUnlisted={false}
            codeOf={codeOf}
          />
        ) : (
          <StationField
            key="to-rail"
            label="To"
            placeholder="e.g. Reading"
            selected={to}
            onSelect={setTo}
            options={viaRoutes?.destinations}
            optionsLabel={via ? `Direct from ${via.name}` : undefined}
          />
        )}
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
