// Speakership (ADR-0019): whose words a sentence is, decided at ingestion by the
// `attribute` stage *before* triage reads it. This is the scope rule — it decides
// whether a sentence is eligible to become a claim at all, and it exists because
// the first live lane published a verdict about a journalist's own sentence:
//
//   "MFAT also played a key role on international policy and diplomacy both at
//    home and in embassies or 'posts' in the Middle East…"
//
// No quotation, no attribution verb, no speaker. ADR-0005's entity resolution and
// ADR-0008's discourse context both key off who spoke, so a sentence the reporter
// synthesised yields a verdict that cannot say whose claim it assesses, and
// "the project fact-checks claims made in political debate" turns into media
// criticism (ADR-0019 §6).
//
// The vocabulary lives in `@cw/store` for the same reason `triage-record.ts`
// does: the pipeline may import store and store may import neither pipeline nor
// harness (AGENTS.md boundaries). The pipeline writes these values, the store
// column's CHECK constrains them, and the site's reader gates on them — one
// definition, so the three cannot drift.

import { z } from "zod";

/**
 * One sentence's speakership class (ADR-0019 §1). Every sentence in a source
 * document receives exactly one, whether or not it becomes a claim: the excluded
 * ones are counted per lane as a scope funnel (ADR-0019 §5), which is how "not a
 * claim" stays visibly different from "not ours to check".
 */
export const SPEAKERSHIP_CLASSES = [
  /** Reported speech; the speaker resolves from quotation and attribution. */
  "quoted-actor",
  /** The author of an opinion/analysis piece asserting in their own voice. */
  "author-claim",
  /** Journalist/outlet narration, editorial synthesis, scene-setting. */
  "outlet-prose",
  /** A quotation with no resolvable attribution — never guessed (ADR-0006). */
  "unresolved",
] as const;
export type SpeakershipClass = (typeof SPEAKERSHIP_CLASSES)[number];

/**
 * The classes that may become a published claim, still subject to the actor
 * taxonomy (ADR-0019 §3: journalists and outlets are sources of quotation, never
 * claimants; officials are in scope only when speaking for the government).
 *
 * `outlet-prose` and `unresolved` are never eligible: outlet prose has no speaker
 * by construction, and an unresolved quotation cannot be attributed without
 * guessing. Both are recorded rather than dropped.
 */
export const ELIGIBLE_SPEAKERSHIP_CLASSES = ["quoted-actor", "author-claim"] as const;

export const SpeakershipClassSchema = z.enum(SPEAKERSHIP_CLASSES);

/**
 * Whether a claim may be published. A null class means NO decision was recorded —
 * every row ingested before ADR-0019 existed is in that state — and it is
 * deliberately not eligible: publishing a claim whose scope was never assessed is
 * the failure this module exists to stop, so the gate fails closed. The site
 * therefore serves only claims the `attribute` stage positively classified as
 * in scope.
 */
export function isEligibleSpeakership(value: string | null | undefined): boolean {
  return value != null && (ELIGIBLE_SPEAKERSHIP_CLASSES as readonly string[]).includes(value);
}
