"use client";

import { useEffect, useState } from "react";
import type { Station } from "@/lib/types";

export interface KnownRoutes {
  destinations: Station[];
  origins: Station[];
}

// One request per station for the life of the page, shared by every field.
const cache = new Map<string, Promise<KnownRoutes | null>>();

function load(crs: string): Promise<KnownRoutes | null> {
  let hit = cache.get(crs);
  if (!hit) {
    hit = fetch(`/api/routes?station=${crs}`)
      .then((res) => (res.ok ? (res.json() as Promise<KnownRoutes>) : null))
      .catch(() => null);
    cache.set(crs, hit);
  }
  return hit;
}

/** The stations with a known direct route to and from `station`. Null until
 * loaded, when no station is chosen, or if the lookup failed — in all of
 * which the search box just offers every station. */
export function useKnownRoutes(station: Station | null): KnownRoutes | null {
  const crs = station?.crs ?? null;
  const [loaded, setLoaded] = useState<{ crs: string; routes: KnownRoutes | null } | null>(
    null
  );

  useEffect(() => {
    if (!crs) return;
    let cancelled = false;
    load(crs).then((routes) => {
      if (!cancelled) setLoaded({ crs, routes });
    });
    return () => {
      cancelled = true;
    };
  }, [crs]);

  return loaded && loaded.crs === crs ? loaded.routes : null;
}

/** Stations in both lists, keeping the first list's order. */
export function inBoth(a: Station[], b: Station[]): Station[] {
  const codes = new Set(b.map((s) => s.crs));
  return a.filter((s) => codes.has(s.crs));
}
