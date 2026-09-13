// Why a sentence from the source document was not graded, in plain words
// (SITE-MVP §2.3, Sept 2026).
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
