"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchStations } from "@/lib/stations";
import { BAND_LABELS } from "@/lib/score";
import type { Station, TimeBand } from "@/lib/types";

const BANDS: TimeBand[] = ["am-peak", "pm-peak", "off-peak"];

const BAND_HINTS: Record<TimeBand, string> = {
  "am-peak": "06:00–09:00",
  "pm-peak": "16:00–19:00",
  "off-peak": "09:00–16:00",
};

function StationField({
  label,
  placeholder,
  selected,
  onSelect,
  autoFocus,
}: {
  label: string;
  placeholder: string;
  selected: Station | null;
  onSelect: (s: Station | null) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const results = open ? searchStations(query) : [];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function choose(s: Station) {
    onSelect(s);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative flex-1">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>
      {selected ? (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-900 hover:border-slate-400 flex items-center justify-between gap-2"
        >
          <span>
            {selected.name}{" "}
            <span className="text-slate-400 font-mono text-xs">{selected.crs}</span>
          </span>
          <span className="text-slate-300 text-xs" aria-hidden>✕</span>
        </button>
      ) : (
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && results[highlighted]) {
              e.preventDefault();
              choose(results[highlighted]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
        />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          {results.map((s, i) => (
            <li key={s.crs}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setHighlighted(i)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between ${
                  i === highlighted ? "bg-emerald-50 text-emerald-900" : "text-slate-700"
                }`}
              >
                <span>{s.name}</span>
                <span className="font-mono text-xs text-slate-400">{s.crs}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StationSearch({
  initialBand = "am-peak",
}: {
  initialBand?: TimeBand;
}) {
  const router = useRouter();
  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  const [band, setBand] = useState<TimeBand>(initialBand);
  const [loading, setLoading] = useState(false);

  const ready = from && to && from.crs !== to.crs;

  function go() {
    if (!ready) return;
    setLoading(true);
    router.push(`/route/${from.crs}-${to.crs}?band=${band}`);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-3">
        <StationField
          label="From"
          placeholder="e.g. Brighton"
          selected={from}
          onSelect={setFrom}
          autoFocus
        />
        <div className="hidden sm:flex items-end pb-2.5 text-slate-300" aria-hidden>
          →
        </div>
        <StationField
          label="To"
          placeholder="e.g. London Bridge"
          selected={to}
          onSelect={setTo}
        />
      </div>

      <div className="mt-4">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Time band
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BANDS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBand(b)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                band === b
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {BAND_LABELS[b]}
              <span
                className={`block text-[10px] font-normal ${
                  band === b ? "text-slate-300" : "text-slate-400"
                }`}
              >
                {BAND_HINTS[b]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={go}
        disabled={!ready || loading}
        className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Scoring your route…" : "Get my Route Score"}
      </button>
    </div>
  );
}
