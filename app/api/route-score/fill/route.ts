import { NextRequest, NextResponse } from "next/server";
import { fillRouteStep } from "@/lib/provider";
import { isTimeBand } from "@/lib/score";

// One call does a couple of HSP waves (~40s); the client repeats until done.
export const maxDuration = 60;

/**
 * POST /api/route-score/fill  { from, to, band }
 *
 * Advances the DB cache for a cold route by a bounded number of HSP waves and
 * reports progress. The client warming UI calls this repeatedly until `done`,
 * showing "fetched N of 12 months". Resumable: each call picks up where the
 * last left off, because every wave is persisted.
 */
export async function POST(req: NextRequest) {
  let body: { from?: string; to?: string; band?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const from = (body.from ?? "").toUpperCase();
  const to = (body.to ?? "").toUpperCase();
  const band = body.band ?? "all-day";

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return NextResponse.json(
      { error: "from and to must be 3-letter CRS codes" },
      { status: 400 }
    );
  }
  if (!isTimeBand(band)) {
    return NextResponse.json({ error: "invalid band" }, { status: 400 });
  }

  try {
    const progress = await fillRouteStep(from, to, band);
    if (!progress) {
      return NextResponse.json({ error: "unknown station" }, { status: 404 });
    }
    return NextResponse.json(progress);
  } catch {
    return NextResponse.json(
      { error: "Performance data temporarily unavailable" },
      { status: 503 }
    );
  }
}
