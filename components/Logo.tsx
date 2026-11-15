/** The site mark: the timetable (white) runs straight, the real train
 * (emerald) steps down — planned vs actual. Kept in step with app/icon.svg,
 * which is the same drawing for the browser tab. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0f2a55" />
      <path d="M13 22H51" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      <path
        d="M13 36H28L36 45H51"
        fill="none"
        stroke="#34d399"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Mind the Delay" with "the" set back, so the two words that matter lead. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-[-0.02em] text-slate-900 ${className}`}>
      Mind <span className="font-normal text-slate-400">the</span> Delay
    </span>
  );
}
