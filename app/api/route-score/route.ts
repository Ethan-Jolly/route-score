import { NextRequest, NextResponse } from "next/server";
import { getRouteScore } from "@/lib/provider";
import { isTimeBand } from "@/lib/score";

// A cold route runs one time-boxed fill step (~30s of HSP calls) before responding.
export const maxDuration = 60;

/**
 * GET /api/route-score?from=BTN&to=LBG&band=am-peak
 *
 * 200 with the score once the route is stored. A route not seen before
 * returns 202 `{ warming: true, cached, total }` after fetching what fits in
 * one step — repeat the request to continue.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from")?.toUpperCase() ?? "";
  const to = req.nextUrl.searchParams.get("to")?.toUpperCase() ?? "";
  const band = req.nextUrl.searchParams.get("band") ?? "am-peak";

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return NextResponse.json(
      { error: "from and to must be 3-letter CRS codes" },
      { status: 400 }
    );
  }
  if (!isTimeBand(band)) {
    return NextResponse.json(
      { error: "band must be one of am-peak, pm-peak, off-peak" },
      { status: 400 }
    );
  }

  try {
    const result = await getRouteScore(from, to, band);
    if (!result) {
      return NextResponse.json(
        { error: "Unknown station code" },
        { status: 404 }
      );
    }
    if ("warming" in result) {
      return NextResponse.json(
        { warming: true, cached: result.warming.cached, total: result.warming.total },
        { status: 202, headers: { "Retry-After": "1", "Cache-Control": "no-store" } }
      );
    }
    // Stored data is refreshed daily by the ingest, so cache for an hour.
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=3600" },
    });
  } catch {
    return NextResponse.json(
      { error: "Performance data temporarily unavailable" },
      { status: 503 }
    );
  }
}
