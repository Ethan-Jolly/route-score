import { NextRequest, NextResponse } from "next/server";
import { fetchHspMonth, hspConfigured } from "@/lib/hsp";
import {
  dbConfigured,
  ensureSchema,
  getPopularRoutes,
  upsertMonths,
} from "@/lib/db";
import { last12Months } from "@/lib/score";

export const maxDuration = 60;

/**
 * Nightly warm job (wired up via vercel.json crons).
 *
 * Refreshes the most recent complete month for the most-looked-up routes.
 * This does two things: it pulls in a newly-completed month as the 12-month
 * window slides forward (so returning visitors get current scores instantly),
 * and it re-fetches the latest month whose data may still have been settling
 * in HSP when first cached. Bounded to one HSP call per popular route.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. If CRON_SECRET
 * is unset (e.g. local dev) the endpoint is open; set it in production.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!hspConfigured() || !dbConfigured()) {
    return NextResponse.json({
      skipped: true,
      reason: "HSP and DATABASE_URL must both be configured",
    });
  }

  await ensureSchema();
  const latest = last12Months().at(-1)!;
  // HSP allows only ~4 concurrent requests and each takes ~20s, so cap the
  // number of routes so the whole job fits inside maxDuration: 6 routes at
  // concurrency 3 is two ~20s waves.
  const CONCURRENCY = 3;
  const routes = await getPopularRoutes(6);

  let warmed = 0;
  let failed = 0;
  for (let i = 0; i < routes.length; i += CONCURRENCY) {
    const wave = routes.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      wave.map(async (r) => {
        const month = await fetchHspMonth(r.from, r.to, r.band, latest);
        await upsertMonths(r.from, r.to, r.band, [{ ...month, source: "hsp" }]);
      })
    );
    warmed += results.filter((x) => x.status === "fulfilled").length;
    failed += results.filter((x) => x.status === "rejected").length;
  }

  return NextResponse.json({
    month: latest,
    candidates: routes.length,
    warmed,
    failed,
  });
}
