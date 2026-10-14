import type { TubeOutcome } from "@/lib/tube";
import { MIN_HISTORY_DAYS } from "@/lib/tube";
import { BAND_LABELS, formatMins } from "@/lib/score";
import type { TimeBand } from "@/lib/types";

/** TfL's line colours, for the dot beside each line's name. */
const LINE_COLORS: Record<string, string> = {
  bakerloo: "#B36305",
  central: "#E32017",
  circle: "#FFD300",
  district: "#00782A",
  "hammersmith-city": "#F3A9BB",
  jubilee: "#A0A5A9",
  metropolitan: "#9B0056",
  northern: "#000000",
  piccadilly: "#003688",
  victoria: "#0098D4",
  "waterloo-city": "#95CDBA",
};

export function LineDot({ line }: { line: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10"
      style={{ background: LINE_COLORS[line] ?? "#94a3b8" }}
      aria-hidden
    />
  );
}

const UNAVAILABLE: Record<Exclude<TubeOutcome, { ok: true }>["reason"], string> = {
  unavailable: "Tube journeys aren't available right now.",
  "no-route": "TfL couldn't find a Tube journey between these stations.",
  error: "We couldn't reach TfL just now. Try again in a minute.",
};

/** The Tube leg beside the train leg: the route, its times and how reliably
 * its lines have run. */
export function TubeLegCard({
  outcome,
  fromName,
  toName,
  band,
  label,
}: {
  outcome: TubeOutcome;
  fromName: string;
  toName: string;
  band: TimeBand;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <h2 className="mt-0.5 text-sm font-bold tracking-tight text-slate-900 sm:text-lg">
        {fromName} <span className="font-normal text-slate-300">→</span> {toName}
      </h2>
      {!outcome.ok ? (
        <p className="mt-6 mb-4 text-sm text-slate-500">{UNAVAILABLE[outcome.reason]}</p>
      ) : (
        <TubeLegBody leg={outcome.leg} band={band} />
      )}
    </div>
  );
}

function TubeLegBody({
  leg,
  band,
}: {
  leg: Extract<TubeOutcome, { ok: true }>["leg"];
  band: TimeBand;
}) {
  const history = new Map(leg.lines.map((l) => [l.line, l]));
  return (
    <div className="mt-3 w-full text-left">
      {leg.rides.length === 0 ? (
        <p className="text-sm text-slate-600">
          It&apos;s quicker to walk: about {formatMins(leg.walkMins)}.
        </p>
      ) : (
        <ol className="space-y-2">
          {leg.rides.map((r, i) => {
            const h = history.get(r.line);
            return (
              <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <LineDot line={r.line} />
                  {r.lineName} line
                </p>
                <p className="text-xs text-slate-500">
                  {r.fromName} to {r.toName}, {formatMins(r.minutes)}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {h ? (
                    <>
                      Good service{" "}
                      <span className="font-semibold tabular-nums">{Math.round(h.goodPct)}%</span>{" "}
                      of the {BAND_LABELS[band]}, severe disruption{" "}
                      <span className="font-semibold tabular-nums">
                        {Math.round(h.severePct)}%
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">Collecting status history</span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-slate-400">Walking</dt>
          <dd className="font-semibold tabular-nums text-slate-700">
            {formatMins(leg.walkMins)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Time between trains</dt>
          <dd className="font-semibold tabular-nums text-slate-700">
            {leg.gapMins === null ? "—" : formatMins(leg.gapMins)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** How far the line-status history has got, for when there isn't enough of
 * it to show figures. */
export function collectingNote(leg: Extract<TubeOutcome, { ok: true }>["leg"]): string {
  const most = Math.max(0, ...leg.collecting.map((c) => c.days));
  return most === 0
    ? `We've only just started recording Tube line status. Figures appear after ${MIN_HISTORY_DAYS} weekdays.`
    : `${most} of ${MIN_HISTORY_DAYS} weekdays recorded so far; figures appear once every line has ${MIN_HISTORY_DAYS}.`;
}
