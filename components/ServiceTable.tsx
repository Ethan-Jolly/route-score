import { TIER_COLORS, formatMins, tierFor } from "@/lib/score";
import type { ServiceStat } from "@/lib/detail";

/**
 * "Your train, not your route": every regular timetabled train in the band
 * with its own punctuality, so a commuter can see whether the 07:42 is the
 * bad one.
 */
export function ServiceTable({
  services,
  months,
  missingHours = [],
}: {
  services: ServiceStat[];
  months: number;
  /** Band hours that have trains but no train-by-train figures yet. */
  missingHours?: number[];
}) {
  if (services.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        We&apos;re collecting train-by-train figures for this route now. They
        start appearing within a few days and fill in over the next few weeks.
      </p>
    );
  }
  const ranked = [...services].sort((a, b) => b.onTimePct - a.onTimePct);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const showBadges = services.length >= 3 && best.onTimePct - worst.onTimePct >= 5;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-2 sm:px-3 py-2 text-left font-semibold">Train</th>
              <th className="hidden px-3 py-2 text-left font-semibold sm:table-cell">Operator</th>
              <th className="px-2 sm:px-3 py-2 text-left font-semibold">On time</th>
              <th className="px-2 sm:px-3 py-2 text-right font-semibold">
                <span className="hidden sm:inline">15+ min late</span>
                <span className="sm:hidden">15+ late</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {services.map((s) => (
              <tr key={s.dep}>
                <td className="px-2 sm:px-3 py-2 whitespace-nowrap">
                  <span className="font-semibold tabular-nums text-slate-900">{s.dep}</span>
                  {s.arr && (
                    <span className="ml-1.5 hidden text-xs tabular-nums text-slate-400 min-[420px]:inline">
                      → {s.arr}
                      {s.journeyMins !== null && (
                        <span className="hidden sm:inline"> ({formatMins(s.journeyMins)})</span>
                      )}
                    </span>
                  )}
                  {showBadges && s === best && (
                    <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      Best
                    </span>
                  )}
                  {showBadges && s === worst && (
                    <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                      Worst
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-2 text-xs text-slate-500 sm:table-cell">
                  {s.operator}
                </td>
                <td className="px-2 sm:px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-10 sm:w-24 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${s.onTimePct}%`,
                          background: TIER_COLORS[tierFor(s.onTimePct)],
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-xs font-semibold text-slate-700">
                      {Math.round(s.onTimePct)}%
                    </span>
                  </div>
                </td>
                <td className="px-2 sm:px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                  {Math.round(s.late15Pct)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missingHours.length > 0 && (
        <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Still collecting: no train-by-train figures yet for trains leaving
          in the {listHours(missingHours)} {missingHours.length === 1 ? "hour" : "hours"}.
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-400">
        Each regular train over {months === 1 ? "the latest month" : `${months} months`}{" "}
        of weekdays. Times are scheduled departure and arrival; trains that ran
        fewer than 8 times aren&apos;t listed.
      </p>
    </div>
  );
}

/** "06:00", "06:00 and 08:00", "06:00, 07:00 and 08:00". */
function listHours(hours: number[]): string {
  const names = hours.map((h) => `${String(h).padStart(2, "0")}:00`);
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
