// Authority map and advocacy rejection (VER-R14, ADR-0018): which official
// source is primary for a domain, and which sources may never be evidence for
// their own claims.

import type { AuthorityResolution } from "../verification-api.ts";

// ---------- authority map (VER-R14) ----------

const DOMAIN_PRIMARY: Record<string, string> = {
  "crime-statistics": "policedata.nz",
  "economic-forecasts": "treasury.govt.nz",
  "population-estimates": "stats.govt.nz",
};

export function resolveAuthority(input: {
  domain: string;
  requestedSource: string;
  requestedTier: number;
}): AuthorityResolution {
  const primary = DOMAIN_PRIMARY[input.domain];
  if (!primary) {
    throw new Error(
      `no authority mapped for domain: ${input.domain} — route to open-web loop with no-pre-vetted-authority note`,
    );
  }
  if (input.requestedTier < 6) {
    return { primary };
  }
  // T6 requested: the claim's own tier is cited first, then the higher
  // authority — the gap IS the finding (VERIFICATION §3.4).
  return {
    primary,
    note: `claim cites ${input.requestedSource} (T6); verdict cites it first, then ${primary} — the tier gap is the finding`,
  };
}

const ADVOCACY_MARKERS = ["NZ Initiative", "Curia", "Taxpayers' Union", "The Kākā", "NZIER"];

export function rejectAdvocacySource(source: string): boolean {
  return ADVOCACY_MARKERS.some((marker) => source.includes(marker));
}
