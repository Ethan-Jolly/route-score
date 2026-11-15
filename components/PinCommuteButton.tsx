"use client";

import { useEffect, useState } from "react";
import { COMMUTE_EVENT, readCommute, writeCommute } from "@/lib/commute";
import type { TimeBand } from "@/lib/types";

/** Pin this route as "my commute" so the homepage opens on it. */
export function PinCommuteButton({
  from,
  to,
  band,
  fromName,
  toName,
  score,
}: {
  from: string;
  to: string;
  band: TimeBand;
  fromName: string;
  toName: string;
  score: number;
}) {
  // null until mounted: the server can't know what this browser pinned.
  const [pinned, setPinned] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = () => {
      const c = readCommute();
      setPinned(!!c && c.from === from && c.to === to && c.band === band);
    };
    sync();
    window.addEventListener(COMMUTE_EVENT, sync);
    return () => window.removeEventListener(COMMUTE_EVENT, sync);
  }, [from, to, band]);

  function toggle() {
    if (pinned) {
      writeCommute(null);
    } else {
      writeCommute({
        from,
        to,
        band,
        fromName,
        toName,
        seen: { score, at: new Date().toISOString() },
      });
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pinned === null}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        pinned
          ? "border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400"
      }`}
      title={pinned ? "Unpin from the homepage" : "Show this route first on the homepage"}
    >
      {pinned ? "★ My commute" : "☆ Pin as my commute"}
    </button>
  );
}
