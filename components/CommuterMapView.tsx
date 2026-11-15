"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { TIER_COLORS, formatMins, tierFor } from "@/lib/score";
import type { MapPoint } from "@/lib/commuterMap";
import type { TimeBand } from "@/lib/types";

const TIME_STEPS = [30, 45, 60, 75, 90, 120, 180];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The commuter map: one dot per place with a direct train into the hub,
 * coloured by score. Filters for journey time and score narrow the map and
 * the ranked list beneath it together.
 */
export function CommuterMapView({
  points,
  centre,
  hubName,
  band,
}: {
  points: MapPoint[];
  centre: [number, number];
  hubName: string;
  band: TimeBand;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [maxMins, setMaxMins] = useState<number | null>(null);
  const [minScore, setMinScore] = useState(0);

  const shown = useMemo(
    () =>
      points.filter(
        (p) =>
          p.score >= minScore &&
          (maxMins === null || (p.expectedMins !== null && p.expectedMins <= maxMins))
      ),
    [points, maxMins, minScore]
  );

  // Create the map once; Leaflet touches `window`, so it's loaded here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { scrollWheelZoom: false, zoomControl: true }).setView(centre, 8);
      // OpenStreetMap's own tiles: free with attribution for modest traffic
      // (https://operations.osmfoundation.org/policies/tiles/). Washed out in
      // CSS (.commuter-map .leaflet-tile-pane) so the coloured dots carry the
      // page. A busy site should move to a keyed tile provider.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 14,
      }).addTo(m);
      L.circleMarker(centre, { radius: 7, color: "#0f172a", weight: 3, fillColor: "#fff", fillOpacity: 1 })
        .bindTooltip(esc(hubName))
        .addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      // Open on the commuter belt proper: places within ~80 km as the crow
      // flies (journey times aren't known for every route yet), if there are
      // enough of them; the long-distance dots are a zoom away.
      const near = points.filter((p) => m.distance(centre, [p.lat, p.lon]) <= 80_000);
      const frame = near.length >= 8 ? near : points;
      if (frame.length > 1) {
        m.fitBounds(L.latLngBounds(frame.map((p) => [p.lat, p.lon])).pad(0.08), { maxZoom: 10 });
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // The page remounts this for a new hub, so one setup per mount is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the dots whenever the filters change.
  useEffect(() => {
    if (!ready || !layer.current) return;
    (async () => {
      const L = (await import("leaflet")).default;
      layer.current!.clearLayers();
      // Worst first, so the good places are drawn on top.
      for (const p of [...shown].reverse()) {
        L.circleMarker([p.lat, p.lon], {
          radius: 6,
          color: "#fff",
          weight: 1.5,
          fillColor: TIER_COLORS[tierFor(p.score)],
          fillOpacity: 0.95,
        })
          .bindTooltip(`${esc(p.name)}: ${p.score}`)
          .bindPopup(
            `<div style="font:13px/1.4 Inter,system-ui,sans-serif">
              <strong>${esc(p.name)}</strong> ${band === "pm-peak" ? "←" : "→"} ${esc(p.hubName)}<br/>
              Score <strong>${p.score}</strong> · ${Math.round(p.onTimePct)}% on time<br/>
              ${p.expectedMins !== null ? `About ${formatMins(p.expectedMins)} with delays<br/>` : ""}
              A train every ${formatMins(p.gapMins)}<br/>
              <a href="${p.href}" style="color:#047857;font-weight:600">See the route →</a>
            </div>`
          )
          .addTo(layer.current!);
      }
    })();
  }, [shown, ready, band]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Journey up to
          </span>
          <select
            value={maxMins ?? ""}
            onChange={(e) => setMaxMins(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          >
            <option value="">Any time</option>
            {TIME_STEPS.map((m) => (
              <option key={m} value={m}>
                {formatMins(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Score at least {minScore}
          </span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="mt-2 w-40 accent-emerald-600"
          />
        </label>
        <p className="text-sm text-slate-500">
          {shown.length} of {points.length} places
        </p>
      </div>

      <div
        ref={el}
        className="commuter-map mt-4 h-[420px] sm:h-[520px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 z-0"
        role="region"
        aria-label={`Map of places with a direct train to ${hubName}`}
      />

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
        Best places, by score
      </h2>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing matches those filters. Try loosening them.</p>
      ) : (
        <ol className="grid gap-2 sm:grid-cols-2">
          {shown.slice(0, 30).map((p, i) => (
            <li key={p.crs}>
              <Link
                href={p.href}
                prefetch={false}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
              >
                <span className="w-5 shrink-0 text-center text-xs font-semibold text-slate-300 tabular-nums">
                  {i + 1}
                </span>
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white tabular-nums"
                  style={{ background: TIER_COLORS[tierFor(p.score)] }}
                >
                  {p.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{p.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-400 tabular-nums">
                    {p.expectedMins !== null ? `${formatMins(p.expectedMins)} · ` : ""}a train every{" "}
                    {formatMins(p.gapMins)} · {band === "pm-peak" ? "from" : "to"}{" "}
                    {p.hubName.replace(/^London /, "")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
