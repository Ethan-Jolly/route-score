/**
 * Whether average delay uses the finer punctuality buckets (see
 * FINE_DELAY_COVERAGE in lib/score.ts).
 *
 * The ingest turns it on by setting `fine_delay` = `on` in app_settings once
 * the detail backfill is nearly complete. `FINE_DELAY=on|off` in the
 * environment overrides the database either way, e.g. to test locally or to
 * back the change out without touching the database.
 */

import { unstable_cache } from "next/cache";
import { dbConfigured, ensureSchema, getSetting } from "./db";

const readSetting = unstable_cache(
  async () => {
    try {
      await ensureSchema();
      return (await getSetting("fine_delay")) === "on";
    } catch {
      return false;
    }
  },
  ["fine-delay-v1"],
  { revalidate: 3600 }
);

export async function fineDelayEnabled(): Promise<boolean> {
  const env = process.env.FINE_DELAY?.toLowerCase();
  if (env === "on") return true;
  if (env === "off") return false;
  if (!dbConfigured()) return false;
  return readSetting();
}
