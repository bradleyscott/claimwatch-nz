// Triage's persisted output (SITE-MVP §2.3, Sept 2026): the two things the
// verdict page needs to say *how* a claim was read and *which* check it got —
// both decided before any evidence is fetched, and both discarded until now.
//
// This module is the single definition of both shapes, and it lives in
// `@cw/store` for a reason: pipeline may import store, the site may only import
// store, and store must import neither (AGENTS.md package boundaries). A shape
// declared in pipeline would have to be redeclared in the reader, with nothing
// to catch the drift — the bug class the typed-reader work just removed. Both
// sides derive from here; the pipeline writes these values and the site renders
// them.

import { z } from "zod";

/**
 * The five kinds of check the verifier can run (VERIFICATION.md §2.1). The site
 * reads these as opaque strings — it may not import pipeline source — but the
 * column, the fixture type and the page's mode table all key off this list, so
 * it is defined once here and re-exported by the modules that need it.
 */
export const VERIFICATION_MODES = [
  "stat-grid",
  "citation-check",
  "quote-fidelity",
  "provenance",
  "open-web",
] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

/**
 * Why a sentence from the source document could not be graded (TRIAGE §2.2).
 * These are internal classes; the page renders each as a plain-language label
 * (`apps/site/src/lib/triage-labels.ts`) and never prints the class itself, on
 * the same rule that keeps a bare `T1` off the evidence card (SITE-MVP §2.2
 * rule 4).
 */
export const REJECTION_CLASSES = [
  "opinion",
  "rhetoric",
  "procedure",
  "satire",
  "pledge-conditional",
  "question",
  "off-domain",
] as const;
export type RejectionClass = (typeof REJECTION_CLASSES)[number];

/**
 * A sentence that was classified and set aside. `sentenceText` is stored
 * verbatim: the page shows a reader what was NOT checked, and a paraphrase
 * would make that disclosure unverifiable against the source document.
 */
export const TriageSetAside = z.object({
  sentenceText: z.string().min(1),
  rejectionClass: z.enum(REJECTION_CLASSES),
});
export type TriageSetAside = z.infer<typeof TriageSetAside>;

/**
 * A sentence that is checkable in principle but cannot be graded yet — a
 * commitment with no deadline passed, or a pledge whose terms are not public.
 * Held is not the same as dropped: it is a debt the project owes a verdict on,
 * and the page says so rather than letting the sentence vanish.
 */
export const TriageHeld = z.object({
  sentenceText: z.string().min(1),
  reason: z.string().min(1),
});
export type TriageHeld = z.infer<typeof TriageHeld>;

/**
 * What the triage pass made of the document this claim came from. Persisted on
 * `claim.triage_record`.
 *
 * The counts are required rather than optional: a page that renders "we set 5
 * sentences aside" must be able to say out of how many, or the disclosure is
 * unreadable. The arrays may be empty — an interview where every sentence was
 * checkable is a real, reportable state.
 *
 * Deliberately NOT here: the sentences that became claims. Those are claims,
 * each with its own page, and duplicating them into every sibling's record
 * would publish the same text once per claim and let the copies drift.
 */
export const TriageRecord = z.object({
  /** How many sentences in the source document were classified. */
  sentencesRead: z.number().int().nonnegative(),
  /** How many of them became checkable claims (this claim is one of them). */
  checked: z.number().int().nonnegative(),
  /** Set aside — no evidence can settle them. */
  setAside: z.array(TriageSetAside).default([]),
  /** Held — checkable in principle, not yet gradable. */
  held: z.array(TriageHeld).default([]),
});
export type TriageRecord = z.infer<typeof TriageRecord>;
