// Source admissibility (ADR-0020). The tier classifier in `vetting.ts` answers
// "how much do we trust this source?"; this answers the prior question — "is
// this the right KIND of source to be the record at all?".
//
// Why it exists: a live run verified a policing claim against the subject's
// Wikipedia biography. The biography scored tier 6 (unknown) and was compared
// against anyway, because a low grade is not an exclusion. Some sources can
// never be the record, whatever they would score.

/** Hosts that can never be the record for a verdict, whatever they'd score. */
const NEVER_THE_RECORD_SUFFIXES = [
  // Encyclopaedia and reference works: a summary of sources, not the source.
  "wikipedia.org",
  "wikimedia.org",
  "wikidata.org",
  "wikiwand.com",
  "fandom.com",
  "britannica.com",
  // User-generated and social: no editorial accountability.
  "reddit.com",
  "quora.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "youtube.com",
  // Self-publishing platforms: anyone can be the author.
  "medium.com",
  "blogspot.com",
  "wordpress.com",
  "substack.com",
  // Aggregators that republish someone else's record.
  "news.google.com",
  "flipboard.com",
  "smartnews.com",
];

/**
 * The authority floor for a decisive verdict (`supported` / `refuted`): tier 5
 * or better. Tier 6 is "unknown or personal" — it may be found and reported, but
 * it cannot be the thing a decisive verdict rests on. ADR-0020.
 */
export const DECISIVE_AUTHORITY_FLOOR = 5;

export function hostOf(link: string): string | null {
  try {
    return new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when a source can never be the record for a verdict (ADR-0020 rule 2). */
export function isNeverTheRecord(link: string): boolean {
  const host = hostOf(link);
  if (host == null) return false;
  return NEVER_THE_RECORD_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** True when a tier meets the floor for a decisive verdict. */
export function meetsAuthorityFloor(tier: number | null | undefined): boolean {
  return tier != null && tier <= DECISIVE_AUTHORITY_FLOOR;
}

/**
 * Hosts we treat as an official record for a jurisdiction. A heuristic, and
 * deliberately wider than one country: the pipeline verifies any claim, so any
 * national government domain counts as official for ITS jurisdiction.
 */
const OFFICIAL_SUFFIXES = [".govt.nz", ".gov", ".gov.uk", ".gov.au", ".gov.in", ".govt", ".mil"];
const OFFICIAL_HOSTS = [
  "parliament.nz",
  "hansard.parliament.nz",
  "elections.nz",
  "policedata.nz",
  "stats.govt.nz",
  "treasury.govt.nz",
];

export function looksOfficial(link: string): boolean {
  const host = hostOf(link);
  if (host == null) return false;
  return (
    OFFICIAL_HOSTS.includes(host) || OFFICIAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** How many DIFFERENT domains speak to the claim. Two pages on one site are one source. */
export function independentSourceCount(
  evidence: ReadonlyArray<{ link: string }>,
): number {
  return new Set(evidence.map((e) => hostOf(e.link)).filter((h) => h != null)).size;
}

export function meetsCorroboration(evidence: ReadonlyArray<{ link: string }>): boolean {
  return independentSourceCount(evidence) >= 2;
}

/**
 * The evidence floor for a decisive verdict (ADR-0020 rule 3): `supported` and
 * `refuted` may rest only on either one official record or two INDEPENDENT
 * admissible sources. Anything less downgrades to `not_enough_evidence` — the
 * honest class — rather than publishing a decisive finding on a single weak
 * source.
 */
export interface EvidenceFloorOutcome {
  verdictClass: string;
  downgraded: boolean;
  reason?: string;
}

export function enforceEvidenceFloor(input: {
  verdictClass: string;
  evidence: ReadonlyArray<{ link: string; tier?: number | null }>;
}): EvidenceFloorOutcome {
  if (input.verdictClass !== "supported" && input.verdictClass !== "refuted") {
    return { verdictClass: input.verdictClass, downgraded: false };
  }
  const admissible = input.evidence.filter((e) =>
    isAdmissibleEvidence({ link: e.link, tier: e.tier ?? null }),
  );
  if (admissible.length === 0) {
    return {
      verdictClass: "not_enough_evidence",
      downgraded: true,
      reason: "no admissible source backs a decisive verdict",
    };
  }
  if (!admissible.some((e) => looksOfficial(e.link)) && !meetsCorroboration(admissible)) {
    return {
      verdictClass: "not_enough_evidence",
      downgraded: true,
      reason: "a single non-official source cannot settle the claim",
    };
  }
  return { verdictClass: input.verdictClass, downgraded: false };
}

/**
 * May this source be the record a verdict rests on? Both rules must pass:
 * admissible in kind, and at or above the authority floor.
 */
export function isAdmissibleEvidence(input: {
  link: string;
  tier: number | null | undefined;
}): boolean {
  return !isNeverTheRecord(input.link) && meetsAuthorityFloor(input.tier);
}

/**
 * Why a source was refused, in words a justification can carry. Null when it is
 * admissible.
 */
export function admissibilityRefusal(input: {
  link: string;
  tier: number | null | undefined;
}): string | null {
  if (isNeverTheRecord(input.link)) {
    return `${hostOf(input.link) ?? input.link} is a reference or user-generated page, not a record we can verify against`;
  }
  if (!meetsAuthorityFloor(input.tier)) {
    return `${hostOf(input.link) ?? input.link} is not a source we can establish, so it cannot settle this claim`;
  }
  return null;
}
