// TRIAGE types (ADR-0025). Two independent axes per sentence:
//
//   1. whose words it is  — quoted-actor / author-claim / outlet-prose / unresolved
//   2. what the words are — a checkable factual assertion, or the reason not
//      (opinion, rhetoric, procedure, satire, question, off-domain, pledge)
//
// The axes are independent because they overlap: a quoted actor can state an
// opinion, or be satirical. A sentence is checkable only when BOTH arms pass:
// the words are someone's, and they are a factual assertion.

import type { Genre, RejectionClass, SpeakershipClass } from "@cw/store";
import type { TriageLlm } from "./triage-llm.ts";

export interface Sentence {
  /** Stable within-document sentence id (content-derived, not positional). */
  id: string;
  text: string;
  /** Character span in the source document. */
  span: { start: number; end: number };
  /** Caption cue span when the document is a transcript. */
  cueSpan?: { start: number; end: number };
  /** The passage surrounding the sentence, stored verbatim as the claim window. */
  window?: string;
}

export interface TriageProvenance {
  promptVersion: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /**
   * The decision-model funnel, present only when the stage ran through the
   * decision port (ADR-0024): what the decision model settled without escalation,
   * what escalated to the generative model, and whether it degraded.
   */
  decision?: DecisionFunnel;
}

/** What a decision-backed stage settled and escalated (ADR-0024). */
export interface DecisionFunnel {
  role: string;
  /** The model the provider actually served — may be a dated pin. */
  model: string;
  provider: string;
  settled: number;
  escalated: number;
  degraded: boolean;
}

/** Axis 1: whose words the sentence is. */
export interface SentenceSpeakership {
  sentenceId: string;
  speakershipClass: SpeakershipClass;
  /** The named speaker for an eligible class, else null. */
  speaker: string | null;
}

/**
 * Axis 2: what the sentence is. `checkable` is a factual assertion evidence can
 * settle; every other value is the reason it is not checked.
 */
export const CONTENT_CLASSES = [
  "checkable",
  "opinion",
  "rhetoric",
  "procedure",
  "satire",
  "question",
  "off-domain",
  "pledge-conditional",
] as const;
export type ContentClass = (typeof CONTENT_CLASSES)[number];

export interface SentenceCheckability {
  sentenceId: string;
  contentClass: ContentClass;
}

export interface DropRecord {
  sentenceId: string;
  sentenceText: string;
  rejectionClass: RejectionClass;
  windowText: string;
  provenance: TriageProvenance;
}

export interface TriageFailureRecord {
  failureClass: "schema-validation" | "llm-refusal" | "timeout";
  rawOutput?: string;
  sentenceId?: string;
}

/** A checkable claim: both arms passed. */
export interface ClaimRecord {
  claimId: string;
  sourceSentenceId: string;
  /** The claim as made — the quoted content, stripped of its attribution. */
  text: string;
  /** The verbatim sentence it was cut from, kept for the audit trail. */
  utteranceText: string;
  speakershipClass: SpeakershipClass;
  speaker: string | null;
  isCuratedFixture?: boolean;
  provenance: TriageProvenance;
}

/**
 * The discourse context (ADR-0008, ADR-0026). `window` is the passage the claim
 * was cut from; the context pass reads the WHOLE document and answers what
 * argumentative point the claim supports, in one field (`supports`).
 */
export interface DiscourseContext {
  venue: string | null;
  topic: string | null;
  supports: string | null;
  qualifiers: string[];
  provenance: TriageProvenance;
}

export interface TriageDocumentInput {
  documentId: string;
  /** Declared by the lane; selects the eligibility rule (ADR-0025 §2). */
  genre: Genre;
  /** The whole document text, for the context pass (ADR-0026). */
  documentText?: string;
  sentences: Array<{ id: string; text: string; window?: string }>;
}

export interface TriageResult {
  claims: ClaimRecord[];
  dropLog: Array<DropRecord & { sentenceId: string }>;
  failures: TriageFailureRecord[];
  provenance: TriageProvenance;
}

export function splitSentences(_text: string, _opts?: { cueSpanPreserving?: boolean }): Sentence[] {
  throw new Error("NOT IMPLEMENTED: splitSentences (triage red phase)");
}

export function triageDocument(_doc: TriageDocumentInput, _llm: TriageLlm): Promise<unknown> {
  throw new Error("NOT IMPLEMENTED: triageDocument (triage red phase)");
}
