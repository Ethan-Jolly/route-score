import { TIER_COLORS, tierFor } from "@/lib/score";

/**
 * Circular score gauge, pure SVG. The arc spans 270° (from 135° to 405°),
 * filled proportionally to score/100, with an animated sweep on load.
 */
export function ScoreDial({
  score,
  size = 240,
}: {
  score: number;
  size?: number;
}) {
  const stroke = size * 0.075;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const arcFraction = 0.75; // 270°
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * arcFraction;
  const filled = arcLength * (score / 100);
  const color = TIER_COLORS[tierFor(score)];

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(135 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
          />
          <circle
            className="dial-arc"
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={
              {
                "--dial-circumference": `${circumference}px`,
              } as React.CSSProperties
            }
          />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-bold tabular-nums leading-none"
          style={{ fontSize: size * 0.3, color }}
        >
          {score}
        </span>
        <span
          className="text-slate-400 font-medium"
          style={{ fontSize: size * 0.07 }}
        >
          out of 100
        </span>
      </div>
    </div>
  );
}
