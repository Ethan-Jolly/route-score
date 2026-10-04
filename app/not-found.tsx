import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold text-slate-200">404</p>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        If you typed the address by hand, check the station codes. Otherwise
        search for the route instead.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
      >
        Search a route
      </Link>
    </div>
  );
}
