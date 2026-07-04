/**
 * Streamed instantly while the dashboard's server component does its (fast)
 * cached DB read. Brand-new routes get the dedicated RouteWarming experience
 * instead; this is just a brief skeleton so navigation never feels frozen.
 */
export default function RouteLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="h-8 w-72 max-w-full rounded-lg shimmer" />
      <div className="mt-3 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-7 w-20 rounded-full shimmer" />
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[auto_1fr] items-center rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <div className="mx-auto h-[240px] w-[240px] rounded-full shimmer" />
        <div className="space-y-3">
          <div className="h-5 w-40 rounded shimmer" />
          <div className="h-7 w-full max-w-md rounded shimmer" />
          <div className="h-4 w-64 rounded shimmer" />
          <div className="h-4 w-52 rounded shimmer" />
        </div>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
          >
            <div className="h-4 w-24 rounded shimmer" />
            <div className="h-2 w-full rounded-full shimmer" />
            <div className="h-3 w-40 rounded shimmer" />
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="h-4 w-56 rounded shimmer" />
        <div className="mt-4 h-[200px] w-full rounded-lg shimmer" />
      </div>
    </div>
  );
}
