"use client";

import { useEffect, useState } from "react";
import type { Lateness } from "@/lib/detail";

/** One-way trips a year for someone making this journey every working day:
 * ~252 weekdays less bank holidays and a typical holiday allowance. */
const TRIPS_PER_YEAR = 225;

/** What one single journey is worth for Delay Repay, by ticket. Season tickets
 * use the National Rail standard divisors. */
const TICKETS = {
  single: { label: "Single ticket", divisor: 1 },
  weekly: { label: "Weekly season", divisor: 10 },
  monthly: { label: "Monthly season", divisor: 40 },
  annual: { label: "Annual season", divisor: 464 },
} as const;
type Ticket = keyof typeof TICKETS;

const STORAGE_KEY = "mtd:ticket";

/** Delay Repay 15 pays these shares of a single fare. */
const PAYOUT = { late15to30: 0.25, late30to60: 0.5, late60: 1 };

/**
 * What delays cost: time (hours lost a year) and money (an estimate of the
 * Delay Repay someone would be owed if they claimed every time).
 */
export function DelayCost({
  delayPerJourneyMins,
  lateness,
  over30Pct,
}: {
  /** Average minutes of delay per journey, late or not. */
  delayPerJourneyMins: number;
  lateness: Lateness | null;
  /** Coarse fallback when the finer buckets aren't stored yet. */
  over30Pct: number;
}) {
  const [ticket, setTicket] = useState<Ticket>("annual");
  const [price, setPrice] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved?.ticket in TICKETS) setTicket(saved.ticket);
      if (typeof saved?.price === "string") setPrice(saved.price);
    } catch {
      // No storage (private window etc.): start blank.
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ticket, price }));
    } catch {
      // Ignore.
    }
  }, [ticket, price]);

  const hoursLost = (delayPerJourneyMins * TRIPS_PER_YEAR) / 60;

  // Shares (%) of trains in each paying band. Without the finer buckets only
  // "30+" is known, so the 15–29 band is left out (an underestimate).
  const shares = lateness
    ? { late15to30: lateness.late15to30, late30to60: lateness.late30to60, late60: lateness.late60 }
    : { late15to30: 0, late30to60: over30Pct, late60: 0 };
  const qualifyingPct = shares.late15to30 + shares.late30to60 + shares.late60;
  const qualifyingTrips = Math.round((qualifyingPct / 100) * TRIPS_PER_YEAR);
  const payoutPerTrip =
    (shares.late15to30 * PAYOUT.late15to30 +
      shares.late30to60 * PAYOUT.late30to60 +
      shares.late60 * PAYOUT.late60) /
    100;
  const amount = Number(price.replace(/[£,\s]/g, ""));
  const perJourney = amount > 0 ? amount / TICKETS[ticket].divisor : 0;
  const yearly = perJourney * payoutPerTrip * TRIPS_PER_YEAR;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Time lost to delays
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
          {hoursLost >= 10 ? Math.round(hoursLost) : hoursLost.toFixed(1)} hours
          <span className="text-base font-semibold text-slate-400"> a year</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">{comparison(hoursLost)}</p>
        <p className="mt-3 text-xs text-slate-400">
          If you make this trip every working day (about {TRIPS_PER_YEAR} a
          year). That&apos;s {delayPerJourneyMins.toFixed(1)} minutes of delay
          on an average journey, counting the trains that were on time.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Delay Repay you could claim
        </p>
        <p className="mt-1 text-sm text-slate-600">
          About <strong className="text-slate-900">{qualifyingTrips} trips a year</strong>{" "}
          ({qualifyingPct.toFixed(1)}%) arrive {lateness ? "15" : "30"}+ minutes
          late or are cancelled, which most operators pay out on.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={ticket}
            onChange={(e) => setTicket(e.target.value as Ticket)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-700"
            aria-label="Ticket type"
          >
            {Object.entries(TICKETS).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="flex items-center rounded-lg border border-slate-300 bg-white px-2 text-sm focus-within:border-emerald-500">
            <span className="text-slate-400">£</span>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
              className="w-24 px-1 py-2 outline-none tabular-nums"
              aria-label="Ticket price in pounds"
            />
          </label>
        </div>
        {perJourney > 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Claiming every time would get you roughly{" "}
            <strong className="text-2xl font-bold tabular-nums text-emerald-700">
              £{yearly >= 100 ? Math.round(yearly).toLocaleString("en-GB") : yearly.toFixed(2)}
            </strong>{" "}
            a year.
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            Enter what you pay to see roughly how much that&apos;s worth.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          An estimate: 25% of a single fare for 15–29 minutes late, 50% for
          30–59, 100% for an hour or more (cancellations counted there).
          Operators&apos; rules differ, so check yours.
          {!lateness &&
            " We don't have the 15-minute figures for this route yet, so the 15–29 minute band is left out for now."}
        </p>
      </div>
    </div>
  );
}

function comparison(hours: number): string {
  if (hours >= 15) {
    const days = hours / 7.5;
    return `That's about ${days.toFixed(days >= 10 ? 0 : 1)} working days spent waiting on a late train.`;
  }
  if (hours >= 4) {
    return `That's about ${Math.round(hours / 2)} feature films' worth of waiting.`;
  }
  if (hours >= 1) {
    return `About ${Math.round(hours * 60)} minutes: an afternoon a year, which isn't bad.`;
  }
  return "Barely anything: delays here hardly add up.";
}
