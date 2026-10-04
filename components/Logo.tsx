/** The site mark: a score dial about three-quarters full. Kept in step with
 * app/icon.svg, which is the same drawing for the browser tab. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f172a" />
      <g
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        transform="rotate(135 16 16)"
      >
        <circle cx="16" cy="16" r="9" stroke="#334155" strokeDasharray="42.4 56.6" />
        <circle cx="16" cy="16" r="9" stroke="#34d399" strokeDasharray="31 56.6" />
      </g>
    </svg>
  );
}
