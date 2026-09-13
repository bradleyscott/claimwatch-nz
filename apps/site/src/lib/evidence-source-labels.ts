// Evidence-source descriptions (SITE-MVP §2.2/§2.3): the open-web loop stores a
// numeric source class on every evidence row it resolves (`evidence_item.tier`),
// assigned by the classifier prompt in
// `packages/pipeline/src/search/vetting.ts` (TIER_GUIDANCE):
//
//   T1 official statistics / the relevant national government source
//   T2 academia / peer-reviewed research
//   T3 major mainstream media
//   T5 sector body / NGO (usable only with the gap it leaves named)
//   T6 unknown or personal sources
//   (T4 is never assigned by that classifier)
//
// A code is meaningful to an auditor and meaningless to a reader, so the verdict
// page publishes the plain-language rendering below and the raw code moves to
// the provenance block (SIT-R4: the internal noun stays out of public copy).
//
// Do NOT re-read these numbers as `docs/SOURCE-TAXONOMY.md` §2.1's
// evidence-authority ladder (T1 designated statistics … T6 international
// comparators). The two schemes share a code space and disagree from T2 on —
// T2 is "official administrative data" in the taxonomy but "academic research"
// here, and no pipeline code writes a taxonomy tier onto an open-web row. The
// classifier that produced the stored value is the one described above; using
// the taxonomy's wording would mislabel today's rows. Reconciling the two is a
// pipeline change (prompt edit → L2 golden diff), not a copy change.

export interface EvidenceSourceDescription {
  /** Stored code, for audit only — never rendered. null = no code stored. */
  code: number | null;
  /** What the source is, in the words a reader already uses. */
  label: string;
  /** One sentence a layperson can act on. */
  description: string;
}

/** Codes the open-web classifier actually assigns, strongest first. */
export const EVIDENCE_SOURCE_SCALE: readonly EvidenceSourceDescription[] = [
  {
    code: 1,
    label: "Official statistics",
    description:
      "The government's own numbers for this subject — a Statistics NZ series, or the agency that keeps the record. The strongest evidence we use.",
  },
  {
    code: 2,
    label: "Academic research",
    description:
      "Peer-reviewed or university research from New Zealand, used where no official series covers the question.",
  },
  {
    code: 3,
    label: "Major news outlet",
    description:
      "A large New Zealand newsroom reporting the figure. We use it for context and to find the record behind it, not as the record itself.",
  },
  {
    code: 5,
    label: "Sector or advocacy body",
    description:
      "An industry, charity or advocacy group's own research. We use it only where the gap it leaves is the finding, and never as the record.",
  },
  {
    code: 6,
    label: "Unknown source",
    description:
      "We could not establish who stands behind this source, so what it says is treated as the weakest evidence on the page.",
  },
];

/**
 * Applied to any row the scale above does not cover, including a row with no
 * stored code at all. The no-code case is common today and is not a downgrade
 * we chose: the adjudicator returns a source finding without always returning a
 * code for it (`ops/live-averitec-one.ts` maps `finding?.tier ?? null`), and no
 * current path writes stat-grid series rows as evidence. So we say "not
 * classified" rather than guess a grade, and such rows sort last — nothing in
 * the store vouches for them.
 */
export const EVIDENCE_SOURCE_NOT_CLASSIFIED: EvidenceSourceDescription = {
  code: null,
  label: "Not classified",
  description:
    "Our source check did not place this one on the scale — it is on the page because it was used, but nothing here vouches for it. Treat it as unverified.",
};

/** Every label the on-page key has to explain, in the order it lists them. */
export const EVIDENCE_SOURCE_KEY_LEVELS: readonly EvidenceSourceDescription[] = [
  ...EVIDENCE_SOURCE_SCALE,
  EVIDENCE_SOURCE_NOT_CLASSIFIED,
];

/**
 * The public rendering of an evidence row's stored code. Total by design: an
 * absent code and a code outside the classifier's set both render as "Not
 * classified" — the page never shows a source with no explanation, and never
 * guesses which grade an unfamiliar code meant.
 */
export function describeEvidenceSource(tier: number | null): EvidenceSourceDescription {
  if (tier == null) return EVIDENCE_SOURCE_NOT_CLASSIFIED;
  return (
    EVIDENCE_SOURCE_SCALE.find((level) => level.code === tier) ?? EVIDENCE_SOURCE_NOT_CLASSIFIED
  );
}

/**
 * Strongest source first (SITE-MVP §2.3). Rank is the stored code itself — the
 * classifier's scale runs 1 (official statistics) to 6 (unknown) — and any row
 * off the scale sorts after every classified row. Ties keep the order the
 * evidence pack produced (`toSorted` is stable), so the adjudicator's own
 * sequence still reads through within a grade. Pure: returns a new array and
 * never reorders the pack.
 */
export function orderEvidenceBySourceQuality<Item extends { tier: number | null }>(
  evidence: readonly Item[],
): Item[] {
  const rank = (tier: number | null): number =>
    tier != null && EVIDENCE_SOURCE_SCALE.some((level) => level.code === tier)
      ? tier
      : Number.MAX_SAFE_INTEGER;
  return evidence.toSorted((a, b) => rank(a.tier) - rank(b.tier));
}

/**
 * The raw codes for the provenance block, deduped and ordered — e.g. "T1, T5".
 * Returns null when the page has no classified rows. These are the only place
 * the codes appear publicly (SITE-MVP §2.2 rule 4: technical vocabulary is
 * confined to the provenance block).
 */
export function evidenceSourceCodes(
  evidence: ReadonlyArray<{ tier: number | null }>,
): string | null {
  const codes = [
    ...new Set(evidence.map((item) => item.tier).filter((tier): tier is number => tier != null)),
  ].sort((a, b) => a - b);
  return codes.length > 0 ? codes.map((code) => `T${code}`).join(", ") : null;
}
