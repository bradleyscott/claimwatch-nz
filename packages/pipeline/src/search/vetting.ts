// Authority vetting — two stages (VER-R14, ADR-0018).
//
// Stage 1 — deterministic guardrails (declared lists, no judgement):
//   advocacy rejection (ADR-0018), foreign-official domains (suffix matching —
//   ".gov" must not substring-match "govt.nz"), non-https links.
//
// Stage 2 — LLM classification onto this module's own source-type scale (the
// one in TIER_GUIDANCE below) with rationale + confidence. This is NOT
// `docs/SOURCE-TAXONOMY.md` §2.1's authority precedence order: that answers
// which official authority is primary for a domain (A1–A6); this answers what
// KIND of source a page is (1 official · 2 academic · 3 media · 5 sector ·
// 6 unknown). The value written to `evidence_item.tier` comes from here, so
// public copy is described from TIER_GUIDANCE (see
// apps/site/src/lib/evidence-source-labels.ts). The two previously shared a
// T1–T6 code space and disagreed from T2 on; the docs ladder was renamed to
// A1–A6 (Sept 2026) to end the false equivalence. The
// classifier is an LLM, honestly stated: same posture as the NLI publication
// gate (VERIFICATION §2.7) — a gate on the worst misclassifications, calibrated
// by harness fixtures (must-pass/must-fail authority packs at L1; audit
// agreement on labels at L3). The rationale is recorded on the authority row as
// provenance, contestable like any verdict.

import type { SearchResult } from "./serper-adapter.ts";

export interface VettedCandidate {
  link: string;
  title: string;
  snippet: string;
  tier: number | null;
  rejected: boolean;
  reason: string;
  rationale?: string;
  confidence?: number;
}

/** Classification port — same dependency pattern as VerificationLlm. */
export interface AuthorityVettingLlm {
  classifyAuthority(candidate: SearchResult): Promise<{
    tier: number;
    rationale: string;
    confidence: number;
  } | null>;
}

/**
 * Batched classification port: one call classifies every candidate that
 * survived stage 1. The per-candidate port above cost one LLM call per organic
 * search result (Serper returns ~10, roughly 8 survive guardrails) — by far the
 * largest call count in the pipeline, for a task that is one classification per
 * row. Same model, same taxonomy, more context per call (Sept 2026).
 */
export interface BatchedAuthorityVettingLlm {
  classifyAuthorities(
    candidates: SearchResult[],
  ): Promise<Array<{ tier: number; rationale: string; confidence: number } | null>>;
}

// T1: NZ Crown — central government, parliament, official statistics.
// T2: NZ academia + peer-review. T3: major NZ media. T5: NGO/sector bodies.
// T6: unknown (open-web caveats apply).
const TIER_GUIDANCE = `Classify this source as an evidence authority for statistical claims.
The authority question is JURISDICTION-RELATIVE: a source is tier 1 if it is the official
statistics office or relevant government department FOR THE JURISDICTION the claim concerns
(NZ claims → govt.nz portals; US claims → census.gov, bls.gov, cdc.gov; India claims →
mospi.gov.in, rbi.org.in; etc). A national statistics office of ANY country is tier 1 for
THAT JURISDICTION's claims — and only for them.
- tier 1: official statistics / relevant national government source for the claim's jurisdiction
- tier 2: academia / peer-reviewed research in the claim's jurisdiction
- tier 3: major mainstream media in the claim's jurisdiction
- tier 5: NGO / advocacy-adjacent sector body (usable only with explicit tier-gap framing)
- tier 6: unknown or personal sources
Return null if the source is not plausibly an evidence authority for the claim's jurisdiction.
Reply with ONLY JSON: {"tier": number, "rationale": string, "confidence": number}
where confidence is 0-1.`;

// ADR-0018 advocacy markers — claim sources, never evidence authorities.
const ADVOCACY_MARKERS = [
  "taxpayers.org.nz",
  "taxpayersunion",
  "curia",
  "nzinitiative",
  "nzier",
  "thekaka",
];

// Foreign-official: authoritative elsewhere, out of NZ jurisdiction — never
// promoted to NZ evidence authorities. Suffix/host matching only.
const FOREIGN_SUFFIXES = [".gov.uk", ".gov.au", ".gov", ".edu"];
const FOREIGN_HOSTS = ["census.gov", "ons.gov.uk"];

function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Stage-1 guardrails, shared by the single and batched paths so the declared
// lists have exactly one definition. Returns the rejection reason, or null when
// the candidate survives to stage 2.
function stage1Reject(result: SearchResult): string | null {
  if (!result.link.startsWith("https://")) return "non-https link";

  const host = hostOf(result.link);
  if (host == null) return "unparseable URL";

  if (ADVOCACY_MARKERS.some((marker) => host.includes(marker))) {
    return "advocacy source (ADR-0018: claim source, never evidence)";
  }
  if (FOREIGN_SUFFIXES.some((suffix) => host.endsWith(suffix)) || FOREIGN_HOSTS.includes(host)) {
    return "foreign official domain — not an NZ authority";
  }
  return null;
}

function rejected(result: SearchResult, reason: string): VettedCandidate {
  return {
    link: result.link,
    title: result.title,
    snippet: result.snippet,
    tier: null,
    rejected: true,
    reason,
  };
}

/**
 * Vets a batch of candidates with ONE classification call for the whole set
 * (VER-R14 stage 2). Stage-1 guardrails run first and rejected candidates never
 * reach the classifier; the classifier's per-index answer is attached in order.
 * A short or missing answer rejects that candidate — never a silent accept.
 */
export async function vetCandidates(
  results: SearchResult[],
  llm: BatchedAuthorityVettingLlm,
): Promise<VettedCandidate[]> {
  const staged = results.map((result) => ({ result, rejectReason: stage1Reject(result) }));
  const survivors = staged.filter((s) => s.rejectReason == null).map((s) => s.result);

  // No survivor → no call at all. The fan-out is bounded by real candidates.
  if (survivors.length === 0) {
    return staged.map((s) => rejected(s.result, s.rejectReason ?? "rejected"));
  }

  const classifications = await llm.classifyAuthorities(survivors);
  let survivorIndex = 0;
  return staged.map(({ result, rejectReason }) => {
    if (rejectReason != null) return rejected(result, rejectReason);
    const classification = classifications[survivorIndex++] ?? null;
    if (classification == null) {
      return rejected(result, "classifier declined — not plausibly an NZ evidence authority");
    }
    return {
      link: result.link,
      title: result.title,
      snippet: result.snippet,
      tier: classification.tier,
      rejected: false,
      reason: "vetted: guardrails passed, classifier assigned tier",
      rationale: classification.rationale,
      confidence: classification.confidence,
    };
  });
}

/**
 * Single-candidate vetting — the original contract, kept for callers that vet
 * one candidate at a time. Delegates to {@link vetCandidates} so both paths
 * share the guardrails and the accept/decline rules.
 */
export async function vetCandidate(
  result: SearchResult,
  llm: AuthorityVettingLlm,
): Promise<VettedCandidate> {
  const [vetted] = await vetCandidates([result], {
    classifyAuthorities: async (candidates) => [
      await llm.classifyAuthority(candidates[0] as SearchResult),
    ],
  });
  // noUncheckedIndexedAccess: one input, one output — but the narrowing is explicit.
  return vetted ?? rejected(result, "no vetting result");
}

export { TIER_GUIDANCE };
