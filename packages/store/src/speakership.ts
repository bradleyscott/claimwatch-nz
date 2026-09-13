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
 * How the class was decided (ADR-0019 §2). Not decoration: the ADR says "a
 * structural attribution and a classified one carry different confidence", and
 * §5 makes the page state how a claim was attributed — without this the page
 * cannot distinguish "we read the document's own turn structure" from "a model
 * guessed", which is the difference between a disclosure and a decoration.
 */
export const SPEAKERSHIP_METHODS = [
  /** The document's own structure decided it: Hansard speaker markup, caption
   * turn structure (`transcript_tier`, ADR-0007). Highest confidence. */
  "structural",
  /** The publishing body IS the claimant, so no classification is needed: a
   * government press release's forwarded sentences (ADR-0019 §2). */
  "by-construction",
  /** A classifier read the sentence. The default where no structure exists. */
  "classified",
] as const;
export type SpeakershipMethod = (typeof SPEAKERSHIP_METHODS)[number];

/**
 * The document's genre (ADR-0019 §2). The rule is genre-dependent — a press
 * release's forwarded sentences are eligible, a news report's are not — so this
 * is the input that selected the rule, and storing it is what makes the
 * selection auditable after the fact.
 */
export const GENRES = [
  "news-report",
  "opinion-analysis",
  "press-release",
  "transcript",
  "institutional-post",
] as const;
export type Genre = (typeof GENRES)[number];

/**
 * An actor the sentence's own text attributes the words to (ADR-0005's entity
 * model, ADR-0019 §3's taxonomy).
 *
 * The shape is deliberately loose about everything except the name, because the
 * stage that produces it can only honestly state the name:
 *
 * - `kind` (person | party | institution) is optional — the live lane writes a
 *   bare name, and inventing a kind to satisfy a type is the placeholder problem
 *   in miniature.
 * - `confidence` is optional and NEVER defaulted. The first wired lane wrote `1`
 *   to satisfy a required `number`, which is precisely the placeholder-confidence
 *   pattern this project already removed once: a fabricated 1 reads as certainty
 *   and nothing measures it. A name the text attributes is not a resolved entity
 *   — entity resolution is a separate step with its own accuracy, and until
 *   something calibrates it the honest value is absent. The page's "who" line
 *   reads `name` and is unaffected.
 * - `basis` records what produced the name (`speakership-classify@1`), which is
 *   the provenance that actually exists today.
 *
 * Validated at the write boundary, so a candidate with no name cannot be stored
 * rather than being discovered by whichever consumer reads it first.
 */
export const AttributionCandidate = z.object({
  name: z.string().min(1),
  kind: z.string().min(1).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  basis: z.string().min(1).nullish(),
});
export type AttributionCandidate = z.infer<typeof AttributionCandidate>;

/**
 * Whether a claim may be published. Two things are required, and both matter:
 *
 * 1. an eligible class (`quoted-actor` / `author-claim`);
 * 2. a COMPLETE decision — a method and a genre.
 *
 * A null class means no decision was recorded, and it is deliberately not
 * eligible: publishing a claim whose scope was never assessed is the failure this
 * module exists to stop, so the gate fails closed. The same applies to a class
 * with no method or genre: ADR-0019 §5 requires the page to disclose how the
 * claim was attributed, and a class with no provenance behind it cannot be
 * disclosed honestly, so a half-recorded decision is not publishable either.
 */
export function isEligibleSpeakership(input: {
  speakershipClass: string | null | undefined;
  speakershipMethod?: string | null;
  genre?: string | null;
}): boolean {
  return (
    input.speakershipClass != null &&
    (ELIGIBLE_SPEAKERSHIP_CLASSES as readonly string[]).includes(input.speakershipClass) &&
    input.speakershipMethod != null &&
    input.genre != null
  );
}
