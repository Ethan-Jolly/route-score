// Picks one route for every station the curated list doesn't reach, from the
// National Rail timetable, and writes lib/data/coverage-routes.json. The
// ingest fills those routes at low priority so every station has a score.
//
// Each station's route is its best direct destination on a normal weekday
// (the best of six spread over the coming weeks, so engineering works don't
// hide a line): the most trains departing 06:00–18:59 (the hours the site
// stores), weighted towards big destinations, so a village halt gets its
// line's city rather than the next halt along.
//
// Usage:
//   node scripts/build-coverage-routes.ts                  # download the timetable (needs HSP_EMAIL/HSP_PASSWORD)
//   node scripts/build-coverage-routes.ts --mca=path/to/RJTTFxxx.MCA   # the .MSN beside it is used too
//   node scripts/build-coverage-routes.ts --date=2026-11-17  # one reference weekday instead of six
//
// The timetable is the RDG CIF feed from the National Rail Data Portal (the
// HSP login, with the Timetable feed subscribed). Re-run after a timetable
// change (May and December) and commit the JSON.

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CURATED_ROUTES } from "../lib/routes.ts";
import { STORED_HOURS } from "../lib/score.ts";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

// ---- Timetable file ----------------------------------------------------------

async function download(): Promise<string> {
  const { HSP_EMAIL, HSP_PASSWORD } = process.env;
  if (!HSP_EMAIL || !HSP_PASSWORD) throw new Error("Set HSP_EMAIL and HSP_PASSWORD, or pass --mca=");
  const auth = await fetch("https://opendata.nationalrail.co.uk/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: HSP_EMAIL, password: HSP_PASSWORD }),
  });
  const { token } = (await auth.json()) as { token?: string };
  if (!token) throw new Error(`Portal login failed (${auth.status})`);
  const res = await fetch("https://opendata.nationalrail.co.uk/api/staticfeeds/3.0/timetable", {
    headers: { "X-Auth-Token": token },
  });
  if (!res.ok) throw new Error(`Timetable download failed (${res.status}): is the Timetable feed subscribed?`);
  const dir = join(tmpdir(), `mtd-timetable-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, "timetable.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // unzip on Linux/macOS; Windows' bundled tar (bsdtar) reads zips too.
  try {
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir]);
  } catch {
    execFileSync("tar", ["-xf", zip, "-C", dir]);
  }
  const mca = readdirSync(dir).find((f) => f.toUpperCase().endsWith(".MCA"));
  if (!mca) throw new Error("No .MCA file in the timetable zip");
  return join(dir, mca);
}

const mcaPath = args.mca ?? (await download());
if (!existsSync(mcaPath)) throw new Error(`No such file: ${mcaPath}`);

// ---- Reference days -----------------------------------------------------------

/** Six weekdays over the coming weeks (a different weekday each week, none
 * over Christmas). One day isn't enough: a line closed for engineering that
 * week would look like it has no trains. Each pair is judged on its best day. */
function referenceDays(): string[] {
  if (args.date) return [args.date];
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((2 - d.getUTCDay() + 7) % 7 || 7)); // next Tuesday
  const out: string[] = [];
  for (let week = 0; out.length < 6; week++) {
    const day = new Date(d.getTime() + (week * 7 + (week % 3)) * 86_400_000); // Tue, Wed, Thu…
    const md = day.toISOString().slice(5, 10);
    if (md >= "12-20" || md <= "01-03") continue;
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}
const refDates = referenceDays();
const refs = refDates.map((date) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) throw new Error(`${date} is not a weekday`);
  // CIF dates are yymmdd; its days-run string starts on Monday.
  return { ymd: date.slice(2).replace(/-/g, ""), dayIndex: (day + 6) % 7 };
});

// ---- Parse -----------------------------------------------------------------------

/** One call at a station with a public time, as minutes after midnight. */
interface Call {
  crs: string;
  arr: number | null;
  dep: number | null;
}
interface Schedule {
  uid: string;
  /** STP indicator; "X" marks a permanent bus, which never overrides. */
  stp: string;
  /** Bit i set: valid on reference day i. */
  days: number;
  calls: Call[];
}

// Timetable locations (TIPLOCs) to station codes. The station file (.MSN)
// is the authority: it maps every platform group to its main station code,
// which is what HSP uses (St Pancras's Thameslink platforms are STP, not
// SPL), and covers stations the timetable's own TI records miss (Waterloo).
// TI records fill any gaps.
const tiplocToCrs = new Map<string, string>();
const msnPath = mcaPath.replace(/\.MCA$/i, ".MSN");
const fromMsn = new Set<string>();
if (existsSync(msnPath)) {
  for (const line of readFileSync(msnPath, "latin1").split(/\r?\n/)) {
    if (line[0] !== "A" || line.startsWith("A    FILE-SPEC")) continue;
    const tiploc = line.slice(36, 43).trim();
    const crs = line.slice(49, 52).trim();
    if (tiploc && /^[A-Z]{3}$/.test(crs)) {
      tiplocToCrs.set(tiploc, crs);
      fromMsn.add(tiploc);
    }
  }
}

const schedules: Schedule[] = [];
let current: Schedule | null = null;
let keep = false;

const minutes = (hhmm: string): number | null => {
  if (!/^\d{4}$/.test(hhmm) || hhmm === "0000") return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
};
/** Passenger trains only: not buses, ships, freight or empty stock. */
const isPassengerTrain = (status: string, category: string) =>
  (status === "P" || status === "1") && !["BR", "BS", "SS", "EE", "ES"].includes(category);

const lines = createInterface({ input: createReadStream(mcaPath, "latin1"), crlfDelay: Infinity });
for await (const line of lines) {
  const type = line.slice(0, 2);
  if (type === "TI") {
    const tiploc = line.slice(2, 9).trim();
    const crs = line.slice(53, 56).trim();
    if (crs && !fromMsn.has(tiploc)) tiplocToCrs.set(tiploc, crs);
  } else if (type === "BS") {
    const stp = line[79];
    const from = line.slice(9, 15);
    const to = line.slice(15, 21);
    const runs = line.slice(21, 28);
    let days = 0;
    refs.forEach((r, i) => {
      if (from <= r.ymd && r.ymd <= to && runs[r.dayIndex] === "1") days |= 1 << i;
    });
    current = { uid: line.slice(3, 9), stp, days, calls: [] };
    keep = days !== 0;
    // Cancellations and replacement buses carry no train calls, but an STP
    // one still overrides the permanent train on its days, so it's kept with
    // no calls.
    if (keep && (stp === "C" || !isPassengerTrain(line[29], line.slice(30, 32)))) {
      if (stp !== "P") schedules.push(current);
      keep = false;
    }
  } else if (keep && current && (type === "LO" || type === "LI" || type === "LT")) {
    const tiploc = line.slice(2, 9).trim();
    let arr: number | null = null;
    let dep: number | null = null;
    if (type === "LO") dep = minutes(line.slice(15, 19));
    else if (type === "LT") arr = minutes(line.slice(15, 19));
    else {
      arr = minutes(line.slice(25, 29));
      dep = minutes(line.slice(29, 33));
    }
    if (arr !== null || dep !== null) current.calls.push({ crs: tiploc, arr, dep });
    if (type === "LT") {
      schedules.push(current);
      current = null;
      keep = false;
    }
  }
}
for (const s of schedules) {
  s.calls = s.calls.map((c) => ({ ...c, crs: tiplocToCrs.get(c.crs) ?? "" })).filter((c) => c.crs);
}

// ---- Pairs ---------------------------------------------------------------------

const firstHour = STORED_HOURS[0];
const lastHour = STORED_HOURS[STORED_HOURS.length - 1];
/** Direct trains A→B departing A in the stored hours (on the pair's best
 * reference day), and the total journey minutes that day. */
const pairs = new Map<string, { trains: number; mins: number }>();
/** How big a place is: calls, plus trains starting or ending there, which is
 * what marks out a city terminus (Waterloo) from a busy junction trains pass
 * through (Clapham Junction). Summed over the reference days. */
const importance = new Map<string, number>();
const bump = (crs: string, n: number) => importance.set(crs, (importance.get(crs) ?? 0) + n);
// STP: on each day, an overlay, new or cancellation record for a train UID
// beats its permanent schedule.
const rank: Record<string, number> = { C: 0, N: 1, O: 1, P: 2 };
let trainDays = 0;

refs.forEach((_, day) => {
  const byUid = new Map<string, Schedule>();
  for (const s of schedules) {
    if (!(s.days & (1 << day))) continue;
    const prev = byUid.get(s.uid);
    if (!prev || (rank[s.stp] ?? 3) < (rank[prev.stp] ?? 3)) byUid.set(s.uid, s);
  }
  const today = new Map<string, { trains: number; mins: number }>();
  for (const s of byUid.values()) {
    const calls = s.calls;
    if (calls.length < 2) continue; // cancelled, or replaced by a bus
    trainDays++;
    for (const c of calls) bump(c.crs, 1);
    bump(calls[0].crs, 2);
    bump(calls[calls.length - 1].crs, 2);
    for (let i = 0; i < calls.length; i++) {
      const dep = calls[i].dep;
      if (dep === null) continue;
      const hour = Math.floor(dep / 60);
      if (hour < firstHour || hour > lastHour) continue;
      const seen = new Set<string>([calls[i].crs]);
      for (let j = i + 1; j < calls.length; j++) {
        const c = calls[j];
        if (c.arr === null || seen.has(c.crs)) continue;
        seen.add(c.crs);
        const key = `${calls[i].crs}>${c.crs}`;
        const p = today.get(key) ?? { trains: 0, mins: 0 };
        p.trains++;
        p.mins += (c.arr - dep + 1440) % 1440;
        today.set(key, p);
      }
    }
  }
  for (const [key, p] of today) {
    if ((pairs.get(key)?.trains ?? 0) < p.trains) pairs.set(key, p);
  }
});

// ---- Choose ----------------------------------------------------------------------

const stations = JSON.parse(
  readFileSync(new URL("../lib/data/stations.json", import.meta.url), "utf8")
) as { crs: string; name: string }[];
const curatedStations = new Set(CURATED_ROUTES.flatMap((r) => [r.from, r.to]));

const outbound = new Map<string, { to: string; trains: number; mins: number }[]>();
for (const [key, p] of pairs) {
  const [from, to] = key.split(">");
  if (!outbound.has(from)) outbound.set(from, []);
  outbound.get(from)!.push({ to, trains: p.trains, mins: Math.round(p.mins / p.trains) });
}

const routes: { from: string; to: string; trains: number; mins: number }[] = [];
const noService: string[] = [];
let considered = 0;
for (const st of stations) {
  if (curatedStations.has(st.crs)) continue;
  considered++;
  const options = outbound.get(st.crs);
  if (!options?.length) {
    noService.push(st.crs);
    continue;
  }
  // Bigger places win among equal trains; journeys over 90 minutes fade, so
  // a Highland halt gets Fort William rather than Glasgow five hours away.
  const best = options
    .map((o) => ({
      ...o,
      weight:
        (o.trains * Math.log(2 + (importance.get(o.to) ?? 0))) / Math.max(1, o.mins / 90),
    }))
    .sort((a, b) => b.weight - a.weight)[0];
  routes.push({ from: st.crs, to: best.to, trains: best.trains, mins: best.mins });
}
routes.sort((a, b) => a.from.localeCompare(b.from));

const source = mcaPath.split(/[\\/]/).pop()!.replace(/\.MCA$/i, "");
writeFileSync(
  new URL("../lib/data/coverage-routes.json", import.meta.url),
  JSON.stringify({ source, referenceDates: refDates, routes }).replace(/\},\{/g, "},\n{") + "\n"
);
console.log(
  `${Math.round(trainDays / refs.length)} trains a day over ${refDates.join(", ")}; ` +
    `${pairs.size} direct station pairs.\n` +
    `${considered} stations outside the curated routes: ${routes.length} given a route, ` +
    `${noService.length} with no direct weekday train in ${firstHour}:00–${lastHour}:59 ` +
    `(${noService.join(", ")}).`
);
