import type { Pulse } from "@/lib/pulse";

const TONE = {
  better: { dot: "bg-emerald-500", text: "a better day than usual" },
  worse: { dot: "bg-red-500", text: "a worse day than usual" },
  normal: { dot: "bg-slate-400", text: "about a normal day" },
} as const;

/**
 * One line on the latest day: "Thu 12 Nov: 58% on time, a worse day than
 * usual (normally 74%)". `scope` says what it's about — "This route" or
 * "Across the network".
 */
export function PulseBanner({ pulse, scope }: { pulse: Pulse; scope: string }) {
  const tone = TONE[pulse.verdict];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
      <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${tone.dot}`} />
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${tone.dot}`} />
      </span>
      <p className="text-slate-600">
        <span className="font-semibold text-slate-900">
          {scope}, {pulse.label}:
        </span>{" "}
        {Math.round(pulse.onTimePct)}% on time
        {pulse.routes ? ` across ${pulse.routes} routes` : ""}, {tone.text} (normally{" "}
        {Math.round(pulse.typicalPct)}%).
        {pulse.worseThanPct !== null && (
          <>
            {" "}
            {pulse.worseThanPct >= 50
              ? `Worse than ${pulse.worseThanPct}% of the ${pulse.days} days we've recorded.`
              : `Better than ${100 - pulse.worseThanPct}% of the ${pulse.days} days we've recorded.`}
          </>
        )}
      </p>
    </div>
  );
}
