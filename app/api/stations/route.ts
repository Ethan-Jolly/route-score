import { NextRequest, NextResponse } from "next/server";
import { searchStations } from "@/lib/stations";

/** GET /api/stations?q=brig — the autocomplete also works fully client-side;
 * this endpoint exists for external consumers and parity with the spec. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(searchStations(q), {
    headers: { "Cache-Control": "public, s-maxage=86400" },
  });
}
