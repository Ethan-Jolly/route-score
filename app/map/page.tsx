import Link from "next/link";
import type { Metadata } from "next";
import { CommuterMapView } from "@/components/CommuterMapView";
import { HUBS, getCommuterMap } from "@/lib/commuterMap";
import { BAND_LABELS, isTimeBand } from "@/lib/score";
import type { TimeBand } from "@/lib/types";

export const metadata: Metadata = {
  title: "Where should I live? The commuter map",
  description:
    "Every town with a direct train into London or a major city, coloured by how reliable the commute is and how long it really takes.",
};

export const revalidate = 3600;

interface Props {
  searchParams: Promise<{ to?: string; band?: string }>;
}

export default async function MapPage(props: Props) {
  const { to, band: bandParam } = await props.searchParams;
  // Into the hub in the morning, out of it in the evening.
  const band: TimeBand = bandParam && isTimeBand(bandParam) ? bandParam : "am-peak";
  const hubId = HUBS.some((h) => h.id === to) ? to! : "london";
  const map = await getCommuterMap(hubId, band);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12">
      <section className="pt-8 pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Where should you live?
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Pick where you work. Every place with a direct train there is on the
          map, coloured by how reliable the {BAND_LABELS[band]} commute is.
          Tap a dot for the journey time with delays included.
        </p>
      </section>

      <form className="flex flex-wrap items-end gap-3" action="/map">
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Commuting to
          </span>
          <select
            name="to"
            defaultValue={hubId}
            className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
          >
            {HUBS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            When
          </span>
          <select
            name="band"
            defaultValue={band}
            className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
          >
            {(Object.keys(BAND_LABELS) as TimeBand[]).map((b) => (
              <option key={b} value={b}>
                {BAND_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
        >
          Show the map
        </button>
      </form>

      <div className="mt-6">
        {!map || map.points.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
            We don&apos;t have scored routes into there yet. Try{" "}
            <Link href="/map" className="font-semibold text-emerald-700">
              any London terminal
            </Link>
            .
          </p>
        ) : (
          <CommuterMapView
            key={`${hubId}-${band}`}
            points={map.points}
            centre={map.centre}
            hubName={map.hub.name}
            band={band}
          />
        )}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Direct trains only, and only routes we&apos;ve scored: the commuter
        belt around each city plus anything people have looked up. Where a
        place has trains to more than one terminal, it shows its best one.
      </p>
    </div>
  );
}
