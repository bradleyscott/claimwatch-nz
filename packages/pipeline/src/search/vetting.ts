// Authority vetting — two stages (VER-R14, ADR-0018).
//
// Stage 1 — deterministic guardrails (declared lists, no judgement):
//   advocacy rejection (ADR-0018), foreign-official domains (suffix matching —
//   ".gov" must not substring-match "govt.nz"), non-https links.
//
// Stage 2 — LLM tier classification into the declared T1–T6 taxonomy with
// rationale + confidence. The classifier is an LLM, honestly stated: same
// posture as the NLI publication gate (VERIFICATION §2.7) — a gate on the
// worst misclassifications, calibrated by harness fixtures (must-pass/must-fail
// authority packs at L1; audit agreement on labels at L3). The rationale is
// recorded on the authority row as provenance, contestable like any verdict.

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

// T1: NZ Crown — central government, parliament, official statistics.
// T2: NZ academia + peer-review. T3: major NZ media. T5: NGO/sector bodies.
// T6: unknown (open-web caveats apply).
const TIER_GUIDANCE = `Classify this source as an NZ evidence authority for statistical claims:
- tier 1: NZ Crown / official statistics — .govt.nz, .parliament.nz, official data portals
- tier 2: NZ academia / peer-reviewed research — .ac.nz, university research units
- tier 3: major NZ media — RNZ, NZ Herald, Stuff, 1News, Newshub, Newsroom
- tier 5: NZ NGO / advocacy-adjacent sector body — usable only with explicit tier-gap framing
- tier 6: unknown or personal sources
Return null if the source is not plausibly an evidence authority for NZ statistical claims.
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

export async function vetCandidate(
  result: SearchResult,
  llm: AuthorityVettingLlm,
): Promise<VettedCandidate> {
  const reject = (reason: string): VettedCandidate => ({
    link: result.link,
    title: result.title,
    snippet: result.snippet,
    tier: null,
    rejected: true,
    reason,
  });

  if (!result.link.startsWith("https://")) return reject("non-https link");

  const host = hostOf(result.link);
  if (host == null) return reject("unparseable URL");

  if (ADVOCACY_MARKERS.some((marker) => host.includes(marker))) {
    return reject("advocacy source (ADR-0018: claim source, never evidence)");
  }
  if (FOREIGN_SUFFIXES.some((suffix) => host.endsWith(suffix)) || FOREIGN_HOSTS.includes(host)) {
    return reject("foreign official domain — not an NZ authority");
  }

  // Stage 2: LLM classification — the only judgement step, with recorded
  // rationale. A refusal/null rejects: no silent accept.
  const classification = await llm.classifyAuthority(result);
  if (classification == null) {
    return reject("classifier declined — not plausibly an NZ evidence authority");
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
}

export { TIER_GUIDANCE };
