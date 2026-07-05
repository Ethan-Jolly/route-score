import { NextRequest, NextResponse } from "next/server";
import { fetchHspMonth, hspConfigured } from "@/lib/hsp";
import {
  dbConfigured,
  ensureSchema,
  getCachedMonths,
  getRouteMonthCounts,
  upsertMonths,
  type CachedMonth,
} from "@/lib/db";
import { last12Months } from "@/lib/score";
import { CURATED_ROUTES, LEADERBOARD_BAND } from "@/lib/routes";

export const maxDuration = 60;

/**
 * Backfill job for the leaderboard / warm cache.
 *
 * Grinds through the curated route universe (lib/routes.ts), fetching the
 * months each route is still missing from HSP and persisting them. It's the
 * one-time populate for the leaderboard and an ongoing top-up as the 12-month
 * window slides — the same endpoint is driven two ways:
 *   - the nightly Vercel cron (small `calls` budget, fits in maxDuration), and
 *   - scripts/backfill.mjs locally (larger budget, looped until complete).
 *
 * Fully resumable: every wave is written to the DB, and each run recomputes
 * what's still missing, so it always picks up where the last left off. Because
 * HSP has a sustained session rate limit, a run stops early and reports
 * `throttled: true` the moment a whole wave fails — the driver then backs off.
 *
 * Query params:
 *   calls  — max HSP calls this invocation (default 6, clamped 1..60).
 *
 * Auth: same as /api/cron/warm — Bearer $CRON_SECRET when set.
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

  const budget = clampInt(req.nextUrl.searchParams.get("calls"), 6, 1, 60);
  const HSP_CONCURRENCY = 3;
  const band = LEADERBOARD_BAND;

  await ensureSchema();
  const months = last12Months();
  const counts = await getRouteMonthCounts(band, months);

  const incomplete = CURATED_ROUTES.filter(
    (r) => (counts.get(`${r.from}>${r.to}`) ?? 0) < months.length
  );

  let callsLeft = budget;
  let fetched = 0;
  let failed = 0;
  let routesTouched = 0;
  let throttled = false;

  for (const r of incomplete) {
    if (callsLeft <= 0) break;

    const cached = await getCachedMonths(r.from, r.to, band, months);
    const missing = months.filter((m) => !cached.has(m));
    if (missing.length === 0) continue;
    routesTouched++;

    for (let i = 0; i < missing.length && callsLeft > 0; i += HSP_CONCURRENCY) {
      const wave = missing.slice(i, i + Math.min(HSP_CONCURRENCY, callsLeft));
      const settled = await Promise.allSettled(
        wave.map((m) => fetchHspMonth(r.from, r.to, band, m))
      );
      const rows: CachedMonth[] = [];
      let waveFailed = 0;
      for (const s of settled) {
        if (s.status === "fulfilled") rows.push({ ...s.value, source: "hsp" });
        else waveFailed++;
      }
      if (rows.length > 0) await upsertMonths(r.from, r.to, band, rows);
      fetched += rows.length;
      failed += waveFailed;
      callsLeft -= wave.length;

      // A whole wave failing means we've likely hit HSP's session rate limit,
      // not a one-off blip — stop so the driver can back off.
      if (waveFailed === wave.length) {
        throttled = true;
        break;
      }
    }
    if (throttled) break;
  }

  return NextResponse.json({
    band,
    totalRoutes: CURATED_ROUTES.length,
    complete: CURATED_ROUTES.length - incomplete.length,
    incomplete: incomplete.length,
    routesTouched,
    fetched,
    failed,
    throttled,
    // The driver stops when there's nothing left to do and we weren't throttled.
    done: incomplete.length === 0,
  });
}

function clampInt(
  raw: string | null,
  fallback: number,
  lo: number,
  hi: number
): number {
  const n = raw == null ? fallback : parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
