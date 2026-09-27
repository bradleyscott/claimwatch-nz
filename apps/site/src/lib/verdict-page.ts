// Verdict-page model (SITE-MVP §2.3): shapes store data into the FIXED
// section order, plain-language verdict copy, and register-safe strings.
// Pure logic — unit-tested at L1 for every input shape; L4a asserts a rendered
// page only where a fixture covers it.
//
// The date formatting, the register check and the trail live in sibling modules
// (verdict-dates.ts, verdict-register.ts, verdict-trail.ts); this file keeps the
// page input types, the label set and the section builder, and re-exports the
// moved names so importers are unchanged.

import type { VerificationPlan } from "@cw/store";
import { buildVerdictTrail, type VerdictTrail } from "./verdict-trail.ts";

export {
  AUDIT_LABELS,
  assertAuditLabelsKnown,
  assertRegisterSafe,
  TECHNICAL_RECORD_KEY,
} from "./verdict-register.ts";
export type {
  TrailAside,
  TrailRow,
  TrailSection,
  TrailSectionKind,
  TrailSource,
  VerdictTrail,
} from "./verdict-trail.ts";
export { buildVerdictTrail } from "./verdict-trail.ts";

export type VerdictClass =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";

/** ADR-0004 public label set — the only verdict words a page may carry. */
export const VERDICT_LABELS: Record<
  VerdictClass,
  {
    /** The class name, as published to ClaimReview/AVeriTeC consumers. */
    label: string;
    /**
     * The public rendering of the class (ADR-0004: "a rendering, not a
     * departure") — the wording the verdict band's stop legend uses, and the
     * same rendering `packages/store` publishes as ClaimReview `alternateName`.
     * Identical to `label` for the three classes whose class name is already
     * plain English; the fourth is the one AVeriTeC name that is not.
     */
    plainLabel: string;
    plainSummary: string;
  }
> = {
  supported: {
    label: "Supported",
    plainLabel: "Supported",
    plainSummary: "We verified this claim against the official data.",
  },
  refuted: {
    label: "Refuted",
    plainLabel: "Refuted",
    plainSummary: "The official data does not support this claim.",
  },
  not_enough_evidence: {
    label: "Not enough evidence",
    plainLabel: "Not enough evidence",
    plainSummary:
      "We could not verify this claim with the evidence available — it stays an open question.",
  },
  conflicting_cherry_picking: {
    label: "Conflicting Evidence/Cherrypicking",
    plainLabel: "Accurate but incomplete",
    plainSummary: "The number is real, but the way it is framed changes the picture.",
  },
};

const VERDICT_ORDER: VerdictClass[] = [
  "refuted",
  "not_enough_evidence",
  "conflicting_cherry_picking",
  "supported",
];

/** A sentence triage classified but did not turn into a claim (claim.triage_record). */
export interface TriageRecordInput {
  sentencesRead: number;
  checked: number;
  setAside: Array<{ sentenceText: string; rejectionClass: string }>;
  held: Array<{ sentenceText: string; reason: string }>;
}

export interface VerdictPageInput {
  claimId: string;
  claimText: string;
  speaker: string | null;
  /** Where or on what occasion the words were said (venue). Never the speaker. */
  speakerVenue: string | null;
  /** The speaker's affiliation (party/role), from the entity record. */
  speakerAffiliation: string | null;
  publishedAt: Date;
  verdictClass: VerdictClass;
  /**
   * Store field, deliberately NOT rendered (SITE-MVP §2.2 rule 2, revised Sept
   * 2026). Every value ever written came from a hardcoded placeholder in the
   * `ops/` slice scripts — no adjudicator produces it and no calibration backs
   * it, so publishing "Confidence: 70%" claimed a measured statistical
   * confidence the pipeline does not compute. It is republished as small meta
   * text only once ADR-0011's adjudication step lands *and* the harness
   * measures it (EVALUATION §3). Test: SIT-R6.
   */
  confidence: number | null;
  attachedProposal: string | null;
  /**
   * The passage the claim was cut from, verbatim (claim.discourse_context.window).
   * Rendered under the quote so a reader sees the sentence in its context rather
   * than floating free. Null when the store holds no window.
   */
  claimPassage: string | null;
  /** The policy topic the passage is about; rendered as a small line. */
  policyTopic: string | null;
  mediaAnchor: { mediaUrl: string; startS: number; endS: number; deepLink: string } | null;
  transcriptTier: string | null;
  evidence: Array<{
    authorityRef: string;
    seriesIdentity: string;
    vintageDate: string;
    plainReason: string;
    /** Source link-out — absent for rows the check gave no URL for. */
    url?: string;
    /** When we fetched this source (evidence_item.retrieved_at). */
    retrievedAt?: Date | null;
  }>;
  pipelineVersion: string;
  promptVersions: Record<string, string>;
  modelVersions: Record<string, string>;
  searchRefs: string[];
  /** Raw source codes, provenance-only (SITE-MVP §2.2 rule 4). */
  sourceCodes: string | null;
  /** When the claim was made (claim.spoken_at); null when not recorded. */
  claimMadeAt: Date | null;
  /** When the claim record was created (claim.created_at). */
  claimRecordedAt: Date | null;
  /** When the source document was retrieved (publication.retrieved_at). */
  sourceRetrievedAt: Date | null;
  /** Store claim type — decides which method the claim got (TRIAGE). */
  claimType: string | null;
  /**
   * The check triage routed this claim to (claim.verification_mode, Sept 2026).
   * Null on every row written before the column existed — the trail then renders
   * an absent check rather than guessing, and never falls back to a guess for a
   * statistical claim, which can take either of two modes.
   */
  /**
   * The plan this verification ran (ADR-0023): an ordered list of steps, each
   * naming the procedure it invoked. Replaces the single `verificationMode`.
   */
  plan?: VerificationPlan | null;
  /**
   * Triage's output for the document this claim came from (claim.triage_record):
   * how many sentences were read, which were set aside and why, which were held.
   * Null on older rows — the "what we did not check" section is omitted rather
   * than rendered with invented counts.
   */
  triageRecord?: TriageRecordInput | null;
  publisher: string | null;
  /** The original item the claim came from, so a reader can read it themselves. */
  sourceUrl: string | null;
  /** Roles recorded on the claim itself (claim.prompt_versions) — its triage. */
  claimPromptVersions: Record<string, string>;
  /** Model that typed the claim (claim.model_version); null when unrecorded. */
  claimModelVersion: string | null;
  /** When the evidence pack was assembled (evidence_pack.created_at). */
  checkedAt: Date | null;
  /** Publication gate outcome (evidence_pack.nli_outcome). */
  nliOutcome: string | null;
  /** Monotonic verdict version (1 = never revised). */
  verdictVersion: number;
  verdictStatus: string;
}

export interface VerdictSection {
  /** Render order is a design invariant (SITE-MVP §2.3). */
  kind: "claim" | "verdict" | "deployed" | "media" | "evidence" | "trail" | "related";
  data: unknown;
}

export interface VerdictPageModel {
  sections: VerdictSection[];
  label: string;
  plainSummary: string;
  verdictPosition: number; // 0..3 on the verdict rule, left = refuted
  /** The mode-aware account of the check (SITE-MVP §2.3, Sept 2026). */
  trail: VerdictTrail;
}

export function buildVerdictPageModel(input: VerdictPageInput): VerdictPageModel {
  const sections: VerdictSection[] = [];
  sections.push({
    kind: "claim",
    data: { claimText: input.claimText, speaker: input.speaker, publishedAt: input.publishedAt },
  });
  sections.push({
    kind: "verdict",
    data: { verdictClass: input.verdictClass },
  });
  if (input.attachedProposal) {
    sections.push({ kind: "deployed", data: { attachedProposal: input.attachedProposal } });
  }
  if (input.mediaAnchor) {
    sections.push({ kind: "media", data: input.mediaAnchor });
  }
  // Evidence always renders: with items, or as the honest empty state for
  // not-enough-evidence ("we could not verify this") — never a failure state
  // (SITE-MVP §2.5), never a placeholder-free gap.
  sections.push({ kind: "evidence", data: input.evidence });
  // The trail became mode-aware in Sept 2026: the same dated record, but the
  // section that explains HOW the comparison worked is the one belonging to the
  // check this claim actually got, rather than one shape stretched to cover all
  // five kinds of check.
  const trail = buildVerdictTrail(input);
  sections.push({ kind: "trail", data: trail });
  return {
    sections,
    label: VERDICT_LABELS[input.verdictClass].label,
    plainSummary: VERDICT_LABELS[input.verdictClass].plainSummary,
    verdictPosition: VERDICT_ORDER.indexOf(input.verdictClass),
    trail,
  };
}

/** Hear-it href built ONLY from the stored anchor (SIT-R3 — no re-derivation). */
export function anchorHref(anchor: { deepLink: string }): string {
  return anchor.deepLink;
}
