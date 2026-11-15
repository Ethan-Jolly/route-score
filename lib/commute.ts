/**
 * "My commute": one pinned route per browser, in localStorage. No account,
 * nothing leaves the device. `seen` is the score the visitor last saw, so the
 * homepage can say what changed since.
 */

import type { TimeBand } from "./types";

export interface PinnedCommute {
  from: string;
  to: string;
  band: TimeBand;
  fromName: string;
  toName: string;
  seen: { score: number; at: string };
}

const KEY = "mtd:commute";
/** Changes event so every pin button and card on the page stays in sync. */
export const COMMUTE_EVENT = "mtd:commute-changed";

export function readCommute(): PinnedCommute | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.from === "string" && v.seen ? (v as PinnedCommute) : null;
  } catch {
    return null;
  }
}

/** Store without announcing it, for updates the page shouldn't react to. */
export function storeCommuteQuietly(c: PinnedCommute): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Ignore.
  }
}

export function writeCommute(c: PinnedCommute | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(COMMUTE_EVENT));
  } catch {
    // Storage unavailable: pinning just doesn't stick.
  }
}
