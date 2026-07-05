/**
 * The curated route universe.
 *
 * We can't fetch all ~6.7M station pairs from HSP, so the leaderboard and the
 * warm cache are seeded from this hand-picked set of routes that actually
 * matter: every London terminal against the real destinations on its lines,
 * plus the major UK intercity city pairs. Both directions of each pair are
 * included (A→B and B→A score differently and are distinct routes).
 *
 * All routes use the `all-day` band so scores are directly comparable on the
 * leaderboard. Every CRS here is validated against stations.json by the
 * routes.test-style check in scripts/validate-routes.mjs — unknown codes are a
 * build error, so this list stays honest as stations change.
 *
 * A route is a "London" route (for the London leaderboard) iff one of its
 * endpoints is a London terminal — see LONDON_TERMINALS.
 */

import type { TimeBand } from "./types";

export const LEADERBOARD_BAND: TimeBand = "all-day";

export interface CuratedRoute {
  from: string;
  to: string;
  /** True when one endpoint is a London terminal. */
  london: boolean;
}

/** The London terminus stations. A route touching any of these is "London". */
export const LONDON_TERMINALS: Record<string, string> = {
  PAD: "London Paddington",
  KGX: "London Kings Cross",
  EUS: "London Euston",
  WAT: "London Waterloo",
  VIC: "London Victoria",
  LST: "London Liverpool Street",
  LBG: "London Bridge",
  CHX: "London Charing Cross",
  CST: "London Cannon Street",
  FST: "London Fenchurch Street",
  MYB: "London Marylebone",
  STP: "London St Pancras International",
  BFR: "London Blackfriars",
  MOG: "London Moorgate",
};

/**
 * Real destinations reachable by direct train from each London terminal.
 * Curated to keep the HSP hit-rate high (dead pairs waste the rate-limited
 * budget). Not exhaustive — a representative spread of each terminal's lines.
 */
const LONDON_DESTINATIONS: Record<string, string[]> = {
  // South Western Railway
  WAT: [
    "WOK", "GLD", "BSK", "WIN", "SOU", "BMH", "POO", "WEY", "PMS", "PMH",
    "HAV", "EPS", "DOR", "SUR", "KNG", "RMD", "TWI", "SNS", "RDG", "FNB",
    "AON", "SAL", "EXD", "YVJ", "AND", "FLE", "HMC", "SHP", "WNR", "AHT",
    "ACT", "CSS", "FEL", "GUI", "HSL", "WVF", "MOT", "BSW",
  ],
  // Southern / Gatwick Express / Southeastern (Victoria)
  VIC: [
    "BTN", "GTW", "ECR", "SUO", "EPS", "DKG", "HRH", "LIT", "BOG", "CCH",
    "WRH", "HOV", "LWS", "EBN", "HGS", "BMS", "ORP", "SEV", "AFK", "CBW",
    "DVP", "RAM", "MDE", "TON", "TBW", "RDH", "REI", "CAT", "PUR", "HSK",
    "BAA", "GRV", "CHM",
  ],
  // Southeastern / Southern / Thameslink (London Bridge)
  LBG: [
    "SEV", "TON", "TBW", "HGS", "ORP", "BMS", "GTW", "BTN", "ECR", "DFD",
    "GRV", "HYS", "GNW", "LEW", "BXH", "SID", "PMR", "CST", "ELE", "NWX",
  ],
  // Southeastern (Charing Cross)
  CHX: [
    "DFD", "GRV", "GLM", "SEV", "TON", "TBW", "HGS", "AFK", "ORP", "HYS",
    "GNW", "LEW", "WWA", "BXH", "SID", "GLM", "PMR", "MDW", "PNW",
  ],
  // Southeastern (Cannon Street)
  CST: ["DFD", "GLM", "GRV", "ORP", "SEV", "HYS", "LEW", "GNW", "BXH", "SID"],
  // Greater Anglia / Elizabeth (Liverpool Street)
  LST: [
    "NRW", "IPS", "COL", "CHM", "SNF", "CLT", "HWC", "CBG", "SSD", "BIS",
    "HFE", "CHN", "BTR", "WTM", "MNG", "SRA", "RMF", "SOV", "HWN", "ROM",
    "GDP", "AUR", "MRN",
  ],
  // c2c (Fenchurch Street)
  FST: ["SOC", "SRY", "BSO", "GRY", "TIL", "UPM", "BKG", "PIT", "BEF", "LES", "LTS"],
  // Great Northern (Moorgate)
  MOG: ["WGC", "HFN", "SVG", "HIT", "LET", "GDN", "FPK", "OLD", "AAP", "HAT", "WLW"],
  // LNER / Great Northern / Grand Central / Hull / Lumo (Kings Cross)
  KGX: [
    "EDB", "YRK", "NCL", "LDS", "PBO", "DON", "DAR", "GRA", "NNG", "RET",
    "WKF", "HUL", "LCN", "SVG", "CBG", "KLN", "ELY", "DUR", "NBA", "HGT",
    "HUN", "SDY", "ALM",
  ],
  // East Midlands Railway / Thameslink / Southeastern HS1 (St Pancras)
  STP: [
    "LEI", "NOT", "DBY", "SHF", "LUT", "BDM", "COH", "KET", "WEL", "MHR",
    "LBO", "CHD", "AFK", "EBD", "GTW", "BTN", "CBG", "STP", "LTN", "MAR",
  ],
  // Avanti West Coast / London Northwestern / Southern (Euston)
  EUS: [
    "BHM", "MAN", "LIV", "GLC", "PRE", "LAN", "CRE", "STA", "MKC", "RUG",
    "COV", "WVH", "WFJ", "NMP", "CAR", "WBQ", "WGN", "NUN", "TRI", "HRW",
    "BLY", "LTV", "PNR", "OXN", "BHI", "TAM", "RUN",
  ],
  // Great Western Railway / Elizabeth (Paddington)
  PAD: [
    "RDG", "OXF", "SWI", "BRI", "BPW", "BTH", "CDF", "SWA", "NWP", "CNM",
    "GCR", "EXD", "PLY", "PNZ", "TRU", "TAU", "NBY", "DID", "SLO", "MAI",
    "TWY", "HFD", "WOS", "WSM", "TOT", "BPN", "CPM", "KEM",
  ],
  // Chiltern Railways (Marylebone)
  MYB: [
    "BMO", "BAN", "BCS", "HWY", "AYS", "OXF", "STR", "WRW", "LMS", "SOL",
    "GER", "AMR", "PRP", "BSW", "HDM",
  ],
  // Thameslink (Blackfriars)
  BFR: ["GTW", "BTN", "LUT", "BDM", "SVG", "SAC", "ELS", "RDH", "GTW", "SUO"],
};

/**
 * Major UK intercity pairs (non-London). Encoded hub → destinations; expanded
 * to both directions. Dedup with the London set happens in buildRoutes().
 */
const INTERCITY: Record<string, string[]> = {
  MAN: ["LDS", "LIV", "BHM", "SHF", "YRK", "NCL", "EDB", "GLC", "PRE", "NOT", "MCV", "CTR"],
  BHM: ["MAN", "LDS", "BRI", "CDF", "NOT", "DBY", "SHF", "RDG", "OXF", "COV", "WVH", "CNM", "LEI", "NCL", "YRK", "EDB", "GLC", "SOU", "BMH"],
  BRI: ["CDF", "BHM", "EXD", "PLY", "RDG", "GCR", "TAU", "NWP", "BTH", "SOU", "PNZ"],
  LDS: ["MAN", "YRK", "SHF", "NCL", "BDQ", "HUL", "HGT", "DON", "NOT", "BHM", "CAR"],
  EDB: ["GLC", "ABD", "DEE", "INV", "PTH", "STG", "NCL", "YRK", "CAR", "DUN", "FKK"],
  GLC: ["EDB", "ABD", "DEE", "INV", "PTH", "STG", "CAR", "AYR", "PYG"],
  CDF: ["SWA", "BRI", "NWP", "BHM", "GCR", "CNM", "HFD"],
  NCL: ["EDB", "YRK", "LDS", "DHM", "MBR", "SUN", "CAR", "MAN"],
  LIV: ["MAN", "PRE", "LDS", "BHM", "WGN", "CTR", "MCV"],
  SHF: ["LDS", "MAN", "NOT", "DBY", "BHM", "DON", "LEI", "YRK"],
  NOT: ["DBY", "LEI", "SHF", "BHM", "LCN"],
  SOU: ["BMH", "PMS", "RDG", "WIN", "SAL", "BTN", "POO", "WEY"],
  BTN: ["PMS", "SOU", "AFK", "HGS", "GTW", "EBN", "WRH"],
  YRK: ["NCL", "LDS", "MAN", "SHF", "DON", "SCA", "HUL"],
  PRE: ["MAN", "LIV", "LAN", "BPN", "CAR", "WGN"],
  EXD: ["PLY", "BRI", "TAU", "PNZ", "TRU", "BPN", "PGN"],
  RDG: ["OXF", "BSK", "GLD", "NBY", "DID", "RDH", "BRI", "SOU", "GTW", "WKM", "BCE"],
  LEI: ["DBY", "NUN", "PBO", "STP", "SHF", "BHM", "NOT"],
  DBY: ["NOT", "SHF", "BHM", "CRE", "LEI"],
  COV: ["RUG", "BHM", "NMP", "BHI", "MKC", "WVH"],
  WVH: ["BHM", "STA", "CRE", "WOS", "SHR"],
  GLD: ["RDG", "RDH", "GTW", "BSK"],
  MKC: ["BHM", "NMP", "RUG", "CRE", "STA"],
  TAU: ["EXD", "BRI", "PLY"],
  SHR: ["WVH", "BHM", "CTR"],
  NWP: ["CDF", "BRI", "GCR"],
  CBG: ["PBO", "ELY", "BSE", "NMK", "HUN", "SDY", "IPS", "NRW"],
  PBO: ["ELY", "GRA", "SPA", "DON", "LEI", "LDS"],
  IPS: ["LWT", "FLX", "BSE", "SMK", "COL", "NRW"],
  NRW: ["GYM", "LWT", "DIS", "WMD", "TTF", "COL"],
  SWA: ["LLE", "CMN", "NTH", "PTA", "BGN", "NWP"],
  CAR: ["PNR", "OXN", "LAN", "PRE", "NCL"],
  ABD: ["DEE", "STN", "MTS", "INV", "PTH"],
  INV: ["AVM", "PTH", "DIN", "NRN"],
  PLY: ["TOT", "LSK", "BOD", "TRU", "PNZ", "PGN", "NTA"],
  MBR: ["DAR", "NCL", "YRK", "SLB", "DHM"],
  HUL: ["SBY", "BEV", "YRK", "DON"],
  CNM: ["GCR", "WOS", "HFD", "BHM"],
  CTR: ["CRE", "WBQ", "LIV", "WRX"],
};

/** Build the full route universe, both directions, deduped. */
export function buildRoutes(): CuratedRoute[] {
  const seen = new Set<string>();
  const routes: CuratedRoute[] = [];
  const terminals = new Set(Object.keys(LONDON_TERMINALS));

  const add = (from: string, to: string) => {
    if (from === to) return;
    const key = `${from}>${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push({
      from,
      to,
      london: terminals.has(from) || terminals.has(to),
    });
  };

  for (const [terminal, dests] of Object.entries(LONDON_DESTINATIONS)) {
    for (const d of dests) {
      add(terminal, d);
      add(d, terminal);
    }
  }
  for (const [hub, dests] of Object.entries(INTERCITY)) {
    for (const d of dests) {
      add(hub, d);
      add(d, hub);
    }
  }
  return routes;
}

/** All curated routes (computed once). */
export const CURATED_ROUTES: CuratedRoute[] = buildRoutes();

/** True if a CRS is a London terminal. */
export function isLondonTerminal(crs: string): boolean {
  return crs.toUpperCase() in LONDON_TERMINALS;
}
