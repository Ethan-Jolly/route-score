import { NextRequest, NextResponse } from "next/server";
import { fillRouteStep } from "@/lib/provider";
import { isTimeBand } from "@/lib/score";

// One call is a time-boxed step (~30s of HSP calls); the client repeats until done.
export const maxDuration = 60;

/**
 * POST /api/route-score/fill  { from, to, band, maxSpanMinutes? }
 *
 * Advances the stored data for a cold route by one time-boxed step and reports
 * progress in stored hours. The client warming UI calls this repeatedly until
 * `done`. Resumable: each call picks up where the last left off, because every
 * chunk is persisted. If a step comes back `stalled` (the route is too busy for
 * hour-sized calls), the client retries with a smaller `maxSpanMinutes`.
 */
export async function POST(req: NextRequest) {
  let body: { from?: string; to?: string; band?: string; maxSpanMinutes?: number };
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
    const span = Number(body.maxSpanMinutes);
    const progress = await fillRouteStep(
      from,
      to,
      band,
      Number.isFinite(span) && span > 0 ? Math.max(15, span) : undefined
    );
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
