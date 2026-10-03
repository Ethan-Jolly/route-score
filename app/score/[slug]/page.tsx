import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ScoreDial } from "@/components/ScoreDial";
import { TrendBadge } from "@/components/TrendChart";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { NoServiceCard } from "@/components/NoServiceCard";
import { RouteWarming } from "@/components/RouteWarming";
import { getCachedRouteScore, parseRouteSlug } from "@/lib/provider";
import { stationByCrs } from "@/lib/stations";
import { BAND_LABELS } from "@/lib/score";
import type { Station, TimeBand } from "@/lib/types";

interface Props {
  params: Promise<{ slug: string }>;
}

// Score cards are static-cached and regenerated daily (ISR), per the spec.
export const revalidate = 86400;

async function resolveRoute(props: Props): Promise<
  | { ok: false }
  | {
      ok: true;
      from: Station;
      to: Station;
      band: TimeBand;
      result: Awaited<ReturnType<typeof getCachedRouteScore>>;
    }
> {
  const { slug } = await props.params;
  const parsed = parseRouteSlug(slug);
  if (!parsed) return { ok: false };
  const from = stationByCrs(parsed.from);
  const to = stationByCrs(parsed.to);
  if (!from || !to || from.crs === to.crs) return { ok: false };
  const result = await getCachedRouteScore(parsed.from, parsed.to, parsed.band);
  return { ok: true, from, to, band: parsed.band, result };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const r = await resolveRoute(props);
  if (!r.ok) return { title: "Route not found" };
  if (!r.result || r.result.noService) {
    return { title: `${r.from.name} → ${r.to.name}` };
  }
  const title = `${r.from.name} → ${r.to.name}: ${r.result.score}/100`;
  return {
    title,
    description: `${BAND_LABELS[r.band]} · ${r.result.verdict}`,
    openGraph: { title, description: r.result.verdict },
    twitter: {
      card: "summary_large_image",
      title,
      description: r.result.verdict,
    },
  };
}

export default async function ScoreCardPage(props: Props) {
  const r = await resolveRoute(props);
  if (!r.ok) notFound();
  if (!r.result) {
    return <RouteWarming from={r.from} to={r.to} band={r.band} />;
  }
  if (r.result.noService) {
    return <NoServiceCard from={r.from} to={r.to} band={r.band} />;
  }
  const result = r.result;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-12">
      <div className="rise-in w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
          Route Score
        </p>
        <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-900">
          {result.from.name}
          <span className="mx-2 text-slate-300 font-normal">→</span>
          {result.to.name}
        </h1>
        <p className="mt-1 text-xs font-semibold text-slate-400">
          {BAND_LABELS[result.band]}
        </p>

        <div className="mt-4 flex justify-center">
          <ScoreDial score={result.score} size={200} />
        </div>

        <div className="mt-2 flex justify-center">
          <TrendBadge trend={result.trend} />
        </div>

        <p className="mt-4 text-sm font-medium text-slate-700">
          {result.verdict}
        </p>
        <p className="mt-2 text-[11px] text-slate-400">
          Based on {result.totalTrains.toLocaleString("en-GB")} services ·{" "}
          {result.coverage
            ? `most recent ${result.coverage.months} months (provisional)`
            : "past 12 months"}
        </p>
      </div>

      <div className="rise-in-delay-1 mt-6 flex items-center gap-3">
        <CopyLinkButton
          path={`/score/${result.from.crs}-${result.to.crs}-${result.band}`}
        />
        <Link
          href={`/route/${result.from.crs}-${result.to.crs}?band=${result.band}`}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          Full dashboard →
        </Link>
      </div>

      <Link
        href="/"
        className="rise-in-delay-2 mt-8 text-xs text-slate-400 hover:text-slate-600 transition-colors"
      >
        Score your own route at Route Score
      </Link>
    </div>
  );
}
