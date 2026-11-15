/**
 * Following a route without an account: an RSS feed and an ICS calendar,
 * each with one entry per finished month carrying that month's score.
 * Feed readers and calendar apps poll these, so a new month just appears.
 */

import { BAND_LABELS, formatMonthLong } from "./score";
import { currentMonth, monthEnd } from "./periods";
import { SITE_NAME } from "./site";
import type { RouteScoreResult } from "./types";

export interface FeedMonth {
  month: string;
  score: number;
  change: number | null;
  onTimePct: number;
  /** When the month's report is out: the day after it ends. */
  published: Date;
}

/** Finished months only, newest first, each with the change on the month before. */
export function feedMonths(r: RouteScoreResult): FeedMonth[] {
  const now = currentMonth();
  const byMonth = new Map(r.monthly.map((m) => [m.month, m]));
  const scores = r.monthlyScores.filter((s) => s.month !== now);
  return scores
    .map((s, i) => {
      const end = new Date(`${monthEnd(s.month)}T00:00:00Z`);
      return {
        month: s.month,
        score: s.score,
        change: i > 0 ? s.score - scores[i - 1].score : null,
        onTimePct: byMonth.get(s.month)?.onTimePct ?? 0,
        published: new Date(end.getTime() + 86_400_000),
      };
    })
    .reverse();
}

const routeName = (r: RouteScoreResult) =>
  `${r.from.name} → ${r.to.name} (${BAND_LABELS[r.band]})`;

const changeText = (c: number | null) =>
  c === null ? "" : c === 0 ? " (no change)" : c > 0 ? ` (▲${c})` : ` (▼${Math.abs(c)})`;

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function rss(r: RouteScoreResult, origin: string, pageUrl: string): string {
  const items = feedMonths(r)
    .map((m) => {
      const title = `${formatMonthLong(m.month)}: ${m.score}/100${changeText(m.change)}`;
      const body = `${routeName(r)} scored ${m.score}/100 in ${formatMonthLong(m.month)}${
        m.change === null ? "" : m.change === 0 ? ", the same as the month before" : `, ${m.change > 0 ? "up" : "down"} ${Math.abs(m.change)} on the month before`
      }. ${Math.round(m.onTimePct)}% of trains were on time.`;
      return `    <item>
      <title>${xml(title)}</title>
      <link>${xml(pageUrl)}</link>
      <guid isPermaLink="false">${xml(`${r.from.crs}-${r.to.crs}-${r.band}-${m.month}`)}</guid>
      <pubDate>${m.published.toUTCString()}</pubDate>
      <description>${xml(body)}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xml(`${routeName(r)} · ${SITE_NAME}`)}</title>
    <link>${xml(pageUrl)}</link>
    <description>${xml(`A monthly score out of 100 for ${routeName(r)}, from National Rail punctuality data.`)}</description>
    <language>en-GB</language>
    <ttl>720</ttl>
    <image><url>${xml(`${origin}/icon.svg`)}</url><title>${xml(SITE_NAME)}</title><link>${xml(origin)}</link></image>
${items}
  </channel>
</rss>
`;
}

/** ICS text escaping (RFC 5545 §3.3.11). */
const icsText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Fold lines at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const icsDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function ics(r: RouteScoreResult, host: string, pageUrl: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const events = feedMonths(r).map((m) => {
    const next = new Date(m.published.getTime() + 86_400_000);
    return [
      "BEGIN:VEVENT",
      `UID:${r.from.crs}-${r.to.crs}-${r.band}-${m.month}@${host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(m.published)}`,
      `DTEND;VALUE=DATE:${icsDate(next)}`,
      `SUMMARY:${icsText(`🚆 ${r.from.name} → ${r.to.name}: ${m.score}/100 in ${formatMonthLong(m.month)}${changeText(m.change)}`)}`,
      `DESCRIPTION:${icsText(`${Math.round(m.onTimePct)}% of ${BAND_LABELS[r.band]} trains were on time. Full detail: ${pageUrl}`)}`,
      `URL:${pageUrl}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    ];
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${SITE_NAME}//Route report cards//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`${r.from.name} → ${r.to.name} (${SITE_NAME})`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
    ...events.flat(),
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n")
    .concat("\r\n");
}
