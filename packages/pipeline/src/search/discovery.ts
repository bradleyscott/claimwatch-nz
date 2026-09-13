// Discovery flow (user direction, Sept 2026): open-web is the DEFAULT
// verification path; the authority registry makes later claims better. On a
// registry miss, discovery runs NON-BLOCKING: search → guardrails → LLM
// classification → persist the best candidate. The triggering claim never
// waits on this.

import { canonicalDomain } from "@cw/store";
import type { SearchProvider, SearchResult } from "./serper-adapter.ts";
import { type BatchedAuthorityVettingLlm, vetCandidates } from "./vetting.ts";

export interface DiscoveryOutcome {
  persisted: boolean;
  authorityRef?: string;
  tier?: number;
  reason: string;
}

export interface DiscoveryDeps {
  search: SearchProvider["search"];
  /** Batched: one call classifies every candidate that survived guardrails. */
  classifyAuthorities: BatchedAuthorityVettingLlm["classifyAuthorities"];
  recordAuthority: (fixture: {
    domain: string;
    sourceUrl: string;
    authorityRef: string;
    tier: number;
    rationale: string;
    confidence: number;
    discoveredBy: string;
    searchRefs: string[];
  }) => Promise<unknown>;
}

// Query is built from the canonical domain key — never the claim text. The
// motivated-selection hazard dies here: the same category always produces the
// same query, whoever claimed what about it. The hyphenated key stays intact
// (it is the canonical identity; un-hyphenating re-opens phrasing drift) and
// the query still reads naturally with the official-source bias appended.
function discoveryQuery(domain: string): string {
  // Locale-aware: the domain key itself may name a non-NZ jurisdiction.
  const suffix = /\b(nz|new-zealand)\b/.test(domain)
    ? "statistics official New Zealand"
    : "official statistics";
  return `${domain.replace(/-/g, " ")} ${suffix}`;
}

export async function discoverAuthority(
  input: { domain: string; claimType?: string; claimText: string },
  deps: DiscoveryDeps,
): Promise<DiscoveryOutcome> {
  // Discovery exists for ONE purpose: populating the authority registry so later
  // claims in the category unlock the stat-grid. `routeMode` reaches stat-grid
  // only for statistical claims, so for any other type a persisted authority can
  // never be used — the search, the classification and the row are pure spend
  // (Sept 2026). Non-statistical claims keep their own lane.
  if (input.claimType != null && input.claimType !== "statistical") {
    return {
      persisted: false,
      reason: `claim type "${input.claimType}" never routes to stat-grid — discovery skipped`,
    };
  }

  const domain = canonicalDomain(input.domain);
  const query = discoveryQuery(domain);

  const results = await deps.search(query);
  const searchRefs = [`q=${query}`];

  // Guardrails fire inside vetCandidates before the classifier sees anything
  // (stage 1); survivors are classified together in ONE call (stage 2).
  const vetted = (
    await vetCandidates(results, { classifyAuthorities: deps.classifyAuthorities })
  ).filter((v) => !v.rejected && v.tier != null);

  if (vetted.length === 0) {
    return {
      persisted: false,
      reason: "no candidate survived vetting — open-web remains the evidence path",
    };
  }

  // Lowest tier number = strongest source. Ties break on classifier confidence.
  const best = vetted.slice().sort((a, b) => {
    const tierDelta = (a.tier ?? 9) - (b.tier ?? 9);
    if (tierDelta !== 0) return tierDelta;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  })[0];

  if (best == null) {
    return {
      persisted: false,
      reason: "no candidate survived vetting — open-web remains the evidence path",
    };
  }

  const authorityRef = new URL(best.link).hostname;
  await deps.recordAuthority({
    domain,
    sourceUrl: best.link,
    authorityRef,
    tier: best.tier ?? 6,
    rationale: best.rationale ?? "",
    confidence: best.confidence ?? 0,
    discoveredBy: "serper-search",
    searchRefs,
  });

  return {
    persisted: true,
    authorityRef,
    tier: best.tier ?? 6,
    reason: `authority persisted: ${authorityRef} (T${best.tier}) — ${best.rationale ?? ""}`,
  };
}
