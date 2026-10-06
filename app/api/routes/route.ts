import { NextRequest, NextResponse } from "next/server";
import { getKnownRoutes } from "@/lib/provider";

/**
 * GET /api/routes?station=BTN
 *
 * The stations with a known direct route from (`destinations`) and to
 * (`origins`) this one. The search box uses it to narrow the second station
 * once the first is chosen.
 */
export async function GET(req: NextRequest) {
  const station = req.nextUrl.searchParams.get("station")?.toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(station)) {
    return NextResponse.json(
      { error: "station must be a 3-letter CRS code" },
      { status: 400 }
    );
  }
  // New routes only appear as the ingest or a visitor fetches them.
  return NextResponse.json(await getKnownRoutes(station), {
    headers: { "Cache-Control": "public, s-maxage=3600" },
  });
}
