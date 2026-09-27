// TRIAGE L1 API surface — authored red. Types are real; every function throws
// NOT IMPLEMENTED until the green phase lands. Tests import ./triage.ts, which
// re-exports these until real bodies exist.

import type { TriageLlm } from "./triage-llm.ts";

export interface Sentence {
  /** Stable within-document sentence id (content-derived, not positional). */
  id: string;
  text: string;
  /** Character span in the source document. */
  span: { start: number; end: number };
  /** Caption cue span when the document is a transcript (TRIAG open Q7). */
  cueSpan?: { start: number; end: number };
  window?: string;
}

export interface CheckabilityDecision {
  decision: "checkable" | "not-checkable" | "pledge" | "schema-failure";
  claimId?: string;
  sourceSentenceId?: string;
  dropRecord?: DropRecord;
  failureRecord?: TriageFailureRecord;
  provenance: TriageProvenance;
}

export interface DropRecord {
  sentenceId: string;
  sentenceText: string;
  rejectionClass:
    | "opinion"
    | "rhetoric"
    | "procedure"
    | "satire"
    | "pledge-conditional"
    | "question"
    | "off-domain";
  windowText: string;
  provenance: TriageProvenance;
}

export interface TriageFailureRecord {
  failureClass: "schema-validation" | "llm-refusal" | "timeout";
  rawOutput?: string;
  sentenceId?: string;
}

export interface TriageProvenance {
  promptVersion: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export type ClaimType =
  | "statistical"
  | "citation-backed"
  | "broadcast-quote"
  | "institution-citation"
  | "false-context"
  | "other";

// `VerificationMode`, `FingerprintTuple` and `CanonicalFingerprintKey` were
// declared here and removed by ADR-0023. Triage now decides a claim's TYPE; the
// PLAN (`plan.ts`) decides which procedures that type needs, and a claim may need
// several. Kept as this note rather than silently deleted, because the mode was
// load-bearing across the pipeline, the store and the site, and a reader arriving
// from an older branch needs to know where it went.

export interface TypedClaim {
  claimId: string;
  sourceSentenceId: string;
  claimType: ClaimType;
  text: string;
  isCuratedFixture?: boolean;
  provenance: TriageProvenance;
}

export interface DiscourseContext {
  speaker: string | null;
  /** Where or on what occasion the words were said (venue). Null if unstated. */
  venue: string | null;
  topic: string | null;
  proposal: string | null;
  attachedProposal: string | null;
  qualifiers: string[];
  /**
   * Stance over the window — problem-vs-success framing (TRIAGE §3.2), null when
   * the pass is not confident. It was specified from the start and extracted by
   * nothing until Sept 2026, so every stored value was null.
   */
  argumentDirection: "problem" | "success" | null;
  provenance: TriageProvenance;
}

export interface TriageDocumentInput {
  documentId: string;
  sentences: Array<{ id: string; text: string; window?: string }>;
}

export interface TriageResult {
  claims: Array<TypedClaim & { sourceSentenceId: string }>;
  dropLog: Array<DropRecord & { sentenceId: string }>;
  failures: TriageFailureRecord[];
  provenance: TriageProvenance;
}

export function splitSentences(_text: string, _opts?: { cueSpanPreserving?: boolean }): unknown {
  throw new Error("NOT IMPLEMENTED: splitSentences (triage red phase)");
}

export function checkabilityFromLlm(
  _llm: TriageLlm,
  _input: { sentence: string; window: string },
): unknown {
  throw new Error("NOT IMPLEMENTED: checkabilityFromLlm (triage red phase)");
}

export function typeClaimFromLlm(
  _llm: TriageLlm,
  _input: { sentence: string; isCuratedFixture?: boolean },
): unknown {
  throw new Error("NOT IMPLEMENTED: typeClaimFromLlm (triage red phase)");
}

export function contextFromLlm(_llm: TriageLlm, _input: { window: string }): unknown {
  throw new Error("NOT IMPLEMENTED: contextFromLlm (triage red phase)");
}

export function triageDocument(_doc: TriageDocumentInput, _llm: TriageLlm): unknown {
  throw new Error("NOT IMPLEMENTED: triageDocument (triage red phase)");
}
