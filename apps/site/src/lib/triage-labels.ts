// Why a sentence from the source document was not graded, in plain words
// (SITE-MVP §2.3).
//
// The rejection classes are internal taxonomy (TRIAGE §2.2) and stay internal:
// the page prints the description, never the class name, on the same rule that
// keeps a bare `T1` off the evidence card (SITE-MVP §2.2 rule 4). A reader
// deciding whether to trust a verdict needs to know that opinions and questions
// were set aside; they do not need our label for why.
//
// Classes come from `@cw/store`'s REJECTION_CLASSES so a new class added by the
// pipeline fails the exhaustiveness test here rather than rendering as nothing.

import { REJECTION_CLASSES, type RejectionClass } from "@cw/store";

export interface RejectionDescription {
  /** The reader-facing reason, short enough to sit in a list. */
  label: string;
  /** One sentence a layperson can act on. */
  description: string;
}

/**
 * Every class the store can hold, described. Keyed by the stored class rather
 * than by an index, so a reordered list in `@cw/store` cannot silently
 * re-label a sentence — and typed as an exhaustive record, so a NEW class is a
 * typecheck failure here until someone writes copy for it.
 */
export const REJECTION_DESCRIPTIONS: Record<RejectionClass, RejectionDescription> = {
  // ADR-0025 folded speakership into the triage decision, so the two classes that
  // mean "not a claim we assess" now arrive through the same drop log as opinion
  // and rhetoric. They are different reasons — one is about whose words it is, the
  // other about whether the speaker could be resolved at all — and a reader
  // judging the boundary needs both stated separately.
  "outlet-prose": {
    label: "the outlet's own words",
    description:
      "The newsroom narrating, summarising or setting the scene. Not a claim by anyone, so there is nothing here to check.",
  },
  unresolved: {
    label: "a quotation we could not place",
    description:
      "Words in quotation marks whose speaker could not be established from the text. It was set aside rather than guessed at, because attributing it wrongly would put words in someone's mouth.",
  },
  opinion: {
    label: "an opinion",
    description: "A judgement about fairness or importance, which no evidence can settle.",
  },
  rhetoric: {
    label: "rhetoric",
    description: "A figure of speech or a superlative with no agreed measure behind it.",
  },
  procedure: {
    label: "procedure",
    description: "About the interview or the sitting itself, not about the subject.",
  },
  satire: {
    label: "satire",
    description: "Written as satire, so treating it as a factual claim would misread it.",
  },
  "pledge-conditional": {
    label: "a commitment",
    description:
      "A promise that can only be graded once the deadline it names has passed. Held, not dropped — it is still owed a verdict.",
  },
  question: {
    label: "a question",
    description: "A question rather than a statement; any claim inside it is checked separately.",
  },
  "off-domain": {
    label: "outside our scope",
    description: "Not political debate, so it is outside what this project covers.",
  },
};

/** Classes the page reports as held rather than set aside (TRIAGE §2.2). */
export const HELD_CLASSES: readonly RejectionClass[] = ["pledge-conditional"];

export function rejectionDescription(value: string): RejectionDescription | null {
  return (REJECTION_DESCRIPTIONS as Record<string, RejectionDescription>)[value] ?? null;
}

/** Every class has copy — the exhaustiveness check, asserted in tests. */
export const DESCRIBED_REJECTION_CLASSES: readonly string[] = [...REJECTION_CLASSES];
