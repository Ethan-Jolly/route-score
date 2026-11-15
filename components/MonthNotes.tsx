import { formatMonthLong } from "@/lib/score";
import type { MonthNote } from "@/lib/context";

const KIND = {
  network: { label: "Everywhere", cls: "bg-slate-100 text-slate-600" },
  operator: { label: "Operator", cls: "bg-violet-50 text-violet-700" },
  local: { label: "This route", cls: "bg-red-50 text-red-700" },
} as const;

/** "What happened in March?": who else had the route's bad months. */
export function MonthNotes({ notes }: { notes: MonthNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-semibold text-slate-900">The bad months, in context</h3>
      <ul className="mt-2 space-y-2">
        {notes.map((n) => (
          <li key={n.month} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className="font-semibold text-slate-900">{formatMonthLong(n.month)}</span>
            <span className="tabular-nums text-xs font-semibold text-red-600">
              {Math.round(n.delta)} pts on time
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND[n.kind].cls}`}>
              {KIND[n.kind].label}
            </span>
            <span className="basis-full text-slate-600 sm:basis-auto">
              {n.text.charAt(0).toUpperCase() + n.text.slice(1)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-400">
        Each month compared with this route&apos;s own average, then with how
        every other route we track did that month.
      </p>
    </div>
  );
}
