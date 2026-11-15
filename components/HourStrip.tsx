import { BAND_HOURS, BAND_LABELS, TIER_COLORS, tierFor } from "@/lib/score";
import type { HourStat } from "@/lib/detail";
import type { TimeBand } from "@/lib/types";

/** An hour needs this many trains (over the whole window) to be compared. */
const MIN_TRAINS = 40;

const label = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * "Which train should I catch?": on-time % for every departure hour of the
 * stored day, the current band's hours picked out, with a plain-English nudge
 * towards the better hours.
 */
export function HourStrip({ hours, band }: { hours: HourStat[]; band: TimeBand }) {
  if (hours.length < 3) return null;
  const bandHours = BAND_HOURS[band];
  const lo = Math.max(0, Math.min(...hours.map((h) => h.onTimePct)) - 10);
  const nudge = nudgeFor(hours, band);

  return (
    <div>
      <div
        className="grid items-end gap-1 sm:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
        role="list"
        aria-label="Share of trains on time by departure hour"
      >
        {hours.map((h) => {
          const inBand = bandHours.includes(h.hour);
          const thin = h.trains < MIN_TRAINS;
          // Leave room above the tallest bar for its label.
          const height = 12 + ((h.onTimePct - lo) / (100 - lo)) * 70;
          return (
            <div
              key={h.hour}
              role="listitem"
              className="flex flex-col items-center gap-1"
              title={`${label(h.hour)}–${String(h.hour).padStart(2, "0")}:59: ${Math.round(h.onTimePct)}% on time, about ${h.perDay} trains a weekday${h.late15Pct !== null ? `, ${h.late15Pct}% 15+ min late` : ""}`}
            >
              <div className="flex h-32 w-full flex-col items-center justify-end">
                <span className="mb-1 text-[10px] sm:text-[11px] font-semibold tabular-nums text-slate-600">
                  {Math.round(h.onTimePct)}
                </span>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${height}%`,
                    background: TIER_COLORS[tierFor(h.onTimePct)],
                    opacity: thin ? 0.35 : inBand ? 1 : 0.55,
                  }}
                />
              </div>
              <span
                className={`text-[10px] sm:text-[11px] tabular-nums ${
                  inBand ? "font-bold text-slate-900" : "text-slate-400"
                }`}
              >
                {String(h.hour).padStart(2, "0")}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        % of trains on time (within 5 minutes) by departure hour. Bold hours
        are the {BAND_LABELS[band]}; faded bars have too few trains to go on.
      </p>
      {nudge && <p className="mt-3 text-sm text-slate-700">{nudge}</p>}
    </div>
  );
}

function nudgeFor(hours: HourStat[], band: TimeBand): string | null {
  const solid = hours.filter((h) => h.trains >= MIN_TRAINS);
  const inBand = solid.filter((h) => BAND_HOURS[band].includes(h.hour));
  if (inBand.length < 2) return null;
  const byOnTime = [...inBand].sort((a, b) => b.onTimePct - a.onTimePct);
  const best = byOnTime[0];
  const worst = byOnTime[byOnTime.length - 1];

  // A shoulder hour just outside the band that beats all of it.
  const first = BAND_HOURS[band][0];
  const last = BAND_HOURS[band][BAND_HOURS[band].length - 1];
  const shoulder = solid
    .filter((h) => h.hour === first - 1 || h.hour === last + 1)
    .sort((a, b) => b.onTimePct - a.onTimePct)[0];
  if (shoulder && shoulder.onTimePct >= best.onTimePct + 4) {
    const when = shoulder.hour < first ? "a little earlier" : "a little later";
    return `Worth travelling ${when} if you can: trains leaving ${label(shoulder.hour)}–${String(shoulder.hour).padStart(2, "0")}:59 are on time ${Math.round(shoulder.onTimePct)}% of the time, better than any hour of the ${BAND_LABELS[band]}.`;
  }

  if (best.onTimePct - worst.onTimePct < 4) {
    return `It barely matters which hour you pick: every hour of the ${BAND_LABELS[band]} is within a few points of the others.`;
  }
  const lateBest = 100 - best.onTimePct;
  const lateWorst = 100 - worst.onTimePct;
  const ratio = lateBest > 0 ? lateWorst / lateBest : null;
  return `Best hour: ${label(best.hour)} (${Math.round(best.onTimePct)}% on time). Worst: ${label(worst.hour)} (${Math.round(worst.onTimePct)}%)${
    ratio && ratio >= 1.3 ? `, where you're ${ratio.toFixed(1)}× as likely to be late` : ""
  }.`;
}
