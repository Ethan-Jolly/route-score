export function MetricBar({
  label,
  detail,
  value,
  displayValue,
  weight,
  color,
}: {
  label: string;
  detail: string;
  /** Bar fill 0–100 */
  value: number;
  displayValue: string;
  weight: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
          {weight} of score
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}
          />
        </div>
        <span className="text-sm font-bold tabular-nums text-slate-900 w-14 text-right">
          {displayValue}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{detail}</p>
    </div>
  );
}
