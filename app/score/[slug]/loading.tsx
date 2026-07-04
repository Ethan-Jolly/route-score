/** Skeleton for the shareable score card while a cold route is fetched. */
export default function ScoreLoading() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-12">
      <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60 flex flex-col items-center">
        <div className="h-3 w-24 rounded shimmer" />
        <div className="mt-4 h-6 w-64 max-w-full rounded shimmer" />
        <div className="mt-2 h-3 w-20 rounded shimmer" />
        <div className="mt-5 h-[200px] w-[200px] rounded-full shimmer" />
        <div className="mt-5 h-4 w-56 rounded shimmer" />
        <div className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-slate-400">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-transparent" />
          Building this score card…
        </div>
      </div>
    </div>
  );
}
