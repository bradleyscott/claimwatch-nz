// Claim context (ADR-0021): a claim carries its DOCUMENT, its REFERENTS and its
// JURISDICTION — none of which can be read off the claim sentence.
//
// Why this exists: the sentence "The charity said it would need about $140,000
// more for infrastructure upgrades and clinical staff" contains no country and
// no referent. The document it came from (rnz.co.nz) was unambiguously New
// Zealand, and the speaker (BirdCare Aotearoa) resolved "the charity". Neither
// reached retrieval, so research searched the sentence, matched "$140,000
// infrastructure" and returned American pages — and the verdict concluded no
// charity had made a statement its own source recorded.

/** A jurisdiction code, kept short and query-biased through {@link queryBias}. */
export type Jurisdiction = string;

const TLD_TO_JURISDICTION: Record<string, Jurisdiction> = {
  nz: "NZ",
  au: "AU",
  uk: "UK",
  ie: "IE",
  ca: "CA",
  in: "IN",
  za: "ZA",
  sg: "SG",
};

/** Country names for query bias, and the pipeline's own country names. */
const JURISDICTION_LABEL: Record<string, string> = {
  NZ: "New Zealand",
  AU: "Australia",
  UK: "United Kingdom",
  IE: "Ireland",
  CA: "Canada",
  IN: "India",
  ZA: "South Africa",
  SG: "Singapore",
  US: "United States",
};

/** Source ids and hosts that name their jurisdiction even without a ccTLD. */
const SOURCE_JURISDICTION: ReadonlyArray<[RegExp, Jurisdiction]> = [
  [/(^|[^a-z])nz([^a-z]|$)|rnz|beehive|hansard|stats\.govt|policedata|elections\.nz/i, "NZ"],
  [/census\.gov|bls\.gov|cdc\.gov|\.gov$/i, "US"],
];

/**
 * The claim's jurisdiction, derived from the DOCUMENT it came from — never from
 * the claim sentence. A sentence with no country in it is still a NZ claim when
 * it was published by rnz.co.nz.
 */
export function deriveJurisdiction(input: {
  publicationUrl?: string | null;
  sourceId?: string | null;
}): Jurisdiction | null {
  const url = input.publicationUrl ?? "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split(".");
    const tld = parts.at(-1) ?? "";
    if (TLD_TO_JURISDICTION[tld] != null) return TLD_TO_JURISDICTION[tld] ?? null;
  } catch {
    // Not a URL — fall through to the source-id hints.
  }
  const hay = `${input.sourceId ?? ""} ${url}`;
  for (const [pattern, code] of SOURCE_JURISDICTION) {
    if (pattern.test(hay)) return code;
  }
  return null;
}

/** The phrase to bias a query with, or null when the jurisdiction is unknown. */
export function queryBias(jurisdiction: Jurisdiction | null | undefined): string | null {
  if (jurisdiction == null) return null;
  return JURISDICTION_LABEL[jurisdiction] ?? jurisdiction;
}

const REFERRING_NOUNS = new Set([
  "charity",
  "company",
  "organisation",
  "organization",
  "group",
  "hospital",
  "firm",
  "agency",
  "body",
  "council",
  "university",
  "school",
  "provider",
  "spokesperson",
  "spokesman",
  "spokeswoman",
  "party",
  "ministry",
  "department",
  "trust",
  "foundation",
  "union",
  "association",
  "business",
  "service",
  "operator",
  "report",
  "study",
]);

/**
 * Resolve a leading definite reference — "The charity said…" — to the speaker
 * the attribution stage identified. Conservative on purpose: it only touches a
 * leading "The/A/An <referring-noun>", only when the speaker is known and not
 * already named, and otherwise returns the sentence untouched.
 */
export function resolveReferent(
  claimText: string,
  opts: { speaker?: string | null },
): { text: string; resolved: boolean; referent?: string } {
  const speaker = opts.speaker?.trim() ?? "";
  if (speaker.length === 0) return { text: claimText, resolved: false };
  const match = claimText.match(/^(The|A|An)\s+([A-Za-z]+)\b/);
  if (match == null) return { text: claimText, resolved: false };
  const noun = (match[2] ?? "").toLowerCase();
  if (!REFERRING_NOUNS.has(noun)) return { text: claimText, resolved: false };
  // The speaker is already in the sentence — nothing to resolve.
  if (claimText.toLowerCase().includes(speaker.toLowerCase())) {
    return { text: claimText, resolved: false };
  }
  return {
    text: `${speaker}${claimText.slice(match[0].length)}`,
    resolved: true,
    referent: match[0],
  };
}

/**
 * Bias search queries to the claim's jurisdiction. Appends the country name to
 * each query that does not already name it — the guarantee that a NZ claim does
 * not return American pages because its sentence happens to contain no country.
 */
export function biasQueries(
  queries: readonly string[],
  jurisdiction: Jurisdiction | null | undefined,
): string[] {
  const label = queryBias(jurisdiction);
  if (label == null) return [...queries];
  return queries.map((query) =>
    query.toLowerCase().includes(label.toLowerCase()) ? query : `${query} ${label}`,
  );
}

/**
 * Entity-anchored queries (ADR-0021 rule 4). The speaker's own name is the
 * strongest query term available — "BirdCare Aotearoa" finds the article;
 * "charity $140,000 infrastructure" finds New Mexico.
 */
export function entityQueries(input: {
  entities: readonly string[];
  jurisdiction?: Jurisdiction | null;
}): string[] {
  const named = input.entities.map((e) => e.trim()).filter((e) => e.length > 0);
  if (named.length === 0) return [];
  const label = queryBias(input.jurisdiction);
  const joined = named.join(" ");
  return label == null ? [joined] : [joined, `${joined} ${label}`];
}
