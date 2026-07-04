import { NextRequest, NextResponse } from "next/server";
import { getRouteScore } from "@/lib/provider";
import { isTimeBand } from "@/lib/score";

// A cold route triggers the ~25s parallel HSP fetch before responding.
export const maxDuration = 60;

/** GET /api/route-score?from=BTN&to=LBG&band=am-peak */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from")?.toUpperCase() ?? "";
  const to = req.nextUrl.searchParams.get("to")?.toUpperCase() ?? "";
  const band = req.nextUrl.searchParams.get("band") ?? "all-day";

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return NextResponse.json(
      { error: "from and to must be 3-letter CRS codes" },
      { status: 400 }
    );
  }
  if (!isTimeBand(band)) {
    return NextResponse.json(
      { error: "band must be one of am-peak, pm-peak, off-peak, all-day" },
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
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=86400" },
    });
  } catch {
    return NextResponse.json(
      { error: "Performance data temporarily unavailable" },
      { status: 503 }
    );
  }
}
