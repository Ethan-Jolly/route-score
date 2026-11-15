import { NextRequest } from "next/server";
import { getCachedRouteScore, parseRouteSlug } from "@/lib/provider";
import { ics, rss } from "@/lib/feeds";

/**
 * GET /feeds/BTN-LBG-am-peak/rss.xml   — RSS, one item per finished month
 * GET /feeds/BTN-LBG-am-peak/calendar.ics — the same as calendar events
 *
 * Reads stored data only; a route that isn't stored yet is a 404 (look it up
 * on the site first, which starts collecting it).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; file: string }> }
) {
  const { slug, file } = await params;
  if (file !== "rss.xml" && file !== "calendar.ics") {
    return new Response("Not found", { status: 404 });
  }
  const parsed = parseRouteSlug(slug);
  const result = parsed ? await getCachedRouteScore(parsed.from, parsed.to, parsed.band) : null;
  if (!result || result.noService) {
    return new Response("No score for this route yet", { status: 404 });
  }

  const origin = req.nextUrl.origin;
  const pageUrl = `${origin}/route/${result.from.crs}-${result.to.crs}?band=${result.band}`;
  // Months only change when the ingest lands; half a day is plenty.
  const cache = "public, s-maxage=43200, stale-while-revalidate=86400";
  if (file === "rss.xml") {
    return new Response(rss(result, origin, pageUrl), {
      headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": cache },
    });
  }
  return new Response(ics(result, req.nextUrl.host, pageUrl), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}.ics"`,
      "Cache-Control": cache,
    },
  });
}
