import { useId } from "react";
import { formatMonth, TIER_COLORS, tierFor } from "@/lib/score";
import type { MonthlyScore, Trend } from "@/lib/types";

const TREND_META: Record<Trend, { arrow: string; label: string; cls: string }> = {
  improving: { arrow: "↑", label: "Improving", cls: "text-emerald-600 bg-emerald-50" },
  degrading: { arrow: "↓", label: "Getting worse", cls: "text-red-600 bg-red-50" },
  stable: { arrow: "→", label: "Steady", cls: "text-slate-500 bg-slate-100" },
};

export function TrendBadge({ trend }: { trend: Trend }) {
  const meta = TREND_META[trend];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}
    >
      <span aria-hidden>{meta.arrow}</span>
      {meta.label}
    </span>
  );
}

/**
 * 12-month score trend as a hand-rolled SVG line chart: gradient area fill,
 * dot per month, month labels, and a y-axis window padded around the data so
 * small movements stay legible.
 */
export function TrendChart({ scores }: { scores: MonthlyScore[] }) {
  // Unique per chart, so two charts on one page don't share a gradient.
  const fillId = useId();
  const w = 640;
  const h = 200;
  const pad = { top: 16, right: 12, bottom: 28, left: 34 };

  const values = scores.map((s) => s.score);
  const lo = Math.max(0, Math.min(...values) - 8);
  const hi = Math.min(100, Math.max(...values) + 8);

  const x = (i: number) =>
    pad.left + (i / Math.max(1, scores.length - 1)) * (w - pad.left - pad.right);
  const y = (v: number) =>
    pad.top + (1 - (v - lo) / (hi - lo)) * (h - pad.top - pad.bottom);

  const linePath = scores
    .map((s, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(s.score).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${x(scores.length - 1).toFixed(1)},${h - pad.bottom} L${x(0).toFixed(1)},${h - pad.bottom} Z`;

  const latest = scores[scores.length - 1];
  const color = TIER_COLORS[tierFor(latest.score)];

  const gridLines = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Route score by month, most recently ${latest.score}`}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {gridLines.map((v) => (
        <g key={v}>
          <line
            x1={pad.left}
            x2={w - pad.right}
            y1={y(v)}
            y2={y(v)}
            stroke="#e2e8f0"
            strokeDasharray="3 5"
          />
          <text
            x={pad.left - 8}
            y={y(v) + 3.5}
            textAnchor="end"
            fontSize="10"
            fill="#94a3b8"
          >
            {v}
          </text>
        </g>
      ))}

      <path d={areaPath} fill={`url(#${fillId})`} />
      <path
        className="trend-line"
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {scores.map((s, i) => (
        <g key={s.month}>
          <circle
            cx={x(i)}
            cy={y(s.score)}
            r={i === scores.length - 1 ? 5 : 3}
            fill="white"
            stroke={color}
            strokeWidth={i === scores.length - 1 ? 2.5 : 1.5}
          />
          <text
            x={x(i)}
            y={h - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#94a3b8"
          >
            {formatMonth(s.month)}
          </text>
        </g>
      ))}
    </svg>
  );
}
