"use client";

import { useEffect, useState } from "react";

/** Subscribe to a route's monthly report: RSS, or a calendar that updates
 * itself. Calendar apps want a webcal:// link to subscribe rather than import
 * once, and that needs this site's host, so it's filled in on the client. */
export function FollowLinks({ slug }: { slug: string }) {
  const rss = `/feeds/${slug}/rss.xml`;
  const ics = `/feeds/${slug}/calendar.ics`;
  const [webcal, setWebcal] = useState(ics);
  useEffect(() => setWebcal(`webcal://${window.location.host}${ics}`), [ics]);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="font-semibold text-slate-900">Follow this route:</span>
      <a
        href={webcal}
        className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:text-emerald-800"
      >
        <span aria-hidden>📅</span> Add to your calendar
      </a>
      <a
        href={rss}
        className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:text-emerald-800"
      >
        <span aria-hidden>📡</span> RSS feed
      </a>
      <span className="basis-full text-xs text-slate-400">
        A new entry with the score each month. No sign-up, and nothing to
        unsubscribe from but the feed itself.
      </span>
    </div>
  );
}
