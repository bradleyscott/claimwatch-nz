// The `attribute` stage (ADR-0019, INGESTION §2.9): whose words is each sentence?
//
// This is the project's scope rule, not an enrichment. Before it existed, every
// sentence of a document was a candidate claim, and the first live lane published
// a verdict about RNZ's own narration — "MFAT also played a key role on
// international policy and diplomacy…", and later a `supported` verdict on a
// scene-setting sentence about the City Rail Link. Neither was a claim by anyone.
// The outlook page cannot say whose claim it assesses if the sentence has no
// speaker, so the sentence must never become an eligible claim in the first place.
//
// It is also deliberately a separate stage from triage, with its own prompt role
// and its own call, rather than a field on the checkability call. ADR-0019 §4
// puts eligibility upstream so that triage never sees the claimant (TRIAGE §1);
// folding the two together would put identity inside the decision that selects
// what gets checked, which is the boundary the ADR draws explicitly.
//
// What this module does NOT do yet:
// - **Genre detection.** The genre is declared by the caller (a lane knows
//   whether it is reading a news feed or an opinion feed), because the failure
//   direction of a wrong genre is the dangerous one: a news report mislabelled
//   `opinion-analysis` makes the reporter's own assertions eligible, which is the
//   original defect. Classifying genre from content is INGESTION open question 13.
// - **Structural branches.** Where the document's own markup decides — Hansard
//   speaker markup, caption turn structure, a press release's by-construction
//   body (`method: "structural"` / `"by-construction"`) — no call is needed at
//   all. Those branches land with the lanes that have the structure; this module
//   is the `classified` path for prose.

import {
  ELIGIBLE_SPEAKERSHIP_CLASSES,
  type Genre,
  type SpeakershipClass,
  SpeakershipClassSchema,
  type SpeakershipMethod,
} from "@cw/store";
import { z } from "zod";
import type { SpeakershipLlm } from "./speakership-llm.ts";

/** Prompts are code and versioned (CROSS-CUTTING §3). A prompt edit moves this. */
export const SPEAKERSHIP_PROMPT_VERSIONS = {
  "speakership-classify": "speakership-classify@1",
} as const;

const ATTRIBUTION_PROMPT = `You classify each sentence of a document by WHOSE WORDS IT IS.
This decides whether the sentence may be fact-checked at all, so it is conservative by design: when the speaker is not clear from the text, the answer is "unresolved", never a guess.

You are given the document's genre and its sentences in order.

Classes — exactly one per sentence:
- "quoted-actor": reported speech. The sentence is inside quotation marks, or it is someone else's words being attributed (for example "Macpherson says", "Hipkins told RNZ", "the report said"). Quotation marks may open in one sentence and the attribution verb may sit in an adjacent sentence: read the sentences around it and attribute the quotation to the speaker it is attributed to.
- "author-claim": the AUTHOR of an opinion or analysis piece asserting in their own voice. Only available when the genre is "opinion-analysis". Never use it for a news report: there the author is a journalist reporting, not claiming.
- "outlet-prose": the journalist or outlet narrating, summarising, setting the scene, or describing background. No speaker. A reporter's sentence that happens to contain a number is still outlet prose.
- "unresolved": a quotation with no resolvable speaker — an unattributed pull-quote, or a quotation whose attribution is genuinely ambiguous.

Rules:
- A person merely mentioned in a sentence is NOT its speaker. Do not attribute narration to someone who is only referred to.
- Do not treat the document's headline or standfirst as a claim.
- The genre decides which rules apply: for "news-report", "author-claim" is not available.
Reply with ONLY JSON: {"sentences": [{"sentenceId": string, "class": "quoted-actor"|"author-claim"|"outlet-prose"|"unresolved", "speaker": string|null}]} — one entry per sentence, in the order given, where "speaker" names the person or body whose words they are when the class is "quoted-actor", and is null otherwise.`;

const SentenceAttribution = z.object({
  sentenceId: z.string(),
  class: SpeakershipClassSchema,
  speaker: z.string().nullable().default(null),
});

const AttributionOutput = z.object({ sentences: z.array(SentenceAttribution).min(1) });

export interface SentenceSpeakership {
  sentenceId: string;
  speakershipClass: SpeakershipClass;
  /** The named speaker where the class is `quoted-actor`, else null. */
  speaker: string | null;
  /** True when the sentence may become a claim, before the actor taxonomy. */
  eligible: boolean;
}

export interface SpeakershipScope {
  /** Sentences classified, i.e. the document's length as read by this stage. */
  read: number;
  eligible: number;
  excluded: number;
  /** Counts per class — the scope funnel (ADR-0019 §5). */
  byClass: Record<SpeakershipClass, number>;
}

export interface SpeakershipAttribution {
  genre: Genre;
  method: SpeakershipMethod;
  sentences: SentenceSpeakership[];
  scope: SpeakershipScope;
  provenance: {
    promptVersion: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    calls: number;
  };
}

export interface AttributeInput {
  documentId: string;
  /** Declared by the caller — see the module note on genre detection. */
  genre: Genre;
  sentences: Array<{ id: string; text: string }>;
}

/**
 * Bounds on the fan-out, for the same reason the checkability call has them: one
 * result per sentence against a fixed output budget truncates on a real document
 * (TRI-R12, Sept 2026). Same shape and same half-size retry as `triage.ts`'s
 * chunking; consolidating the two into one helper is a follow-up rather than a
 * second pattern to copy a third time.
 */
const CHUNK_SENTENCES = 20;
const CHUNK_CHARS = 6000;

export function attributionChunks(
  sentences: AttributeInput["sentences"],
): Array<AttributeInput["sentences"]> {
  const chunks: Array<AttributeInput["sentences"]> = [];
  let current: AttributeInput["sentences"] = [];
  let chars = 0;
  for (const sentence of sentences) {
    const size = sentence.text.length;
    if (current.length > 0 && (current.length >= CHUNK_SENTENCES || chars + size > CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(sentence);
    chars += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function eligibleClass(speakershipClass: SpeakershipClass): boolean {
  // One definition of eligibility, in @cw/store, so the writer and the site's
  // reader gate cannot disagree about what may be published.
  return (ELIGIBLE_SPEAKERSHIP_CLASSES as readonly string[]).includes(speakershipClass);
}

/**
 * Classify every sentence, in document order. One call per chunk; a chunk whose
 * response fails schema validation is retried at half size before the document is
 * failed, because a truncated response is indistinguishable from a malformed one.
 */
export async function attributeSentences(
  input: AttributeInput,
  llm: SpeakershipLlm,
): Promise<SpeakershipAttribution> {
  const bySentence = new Map<string, SentenceSpeakership>();
  const models = new Set<string>();
  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;

  const runChunk = async (chunk: AttributeInput["sentences"]): Promise<void> => {
    const call = await llm.generateObject(
      "speakership-classify",
      // The genre travels with the request: it selects the rule, so a classifier
      // that could not see it would be guessing which question to answer.
      { genre: input.genre, sentences: chunk },
      { parse: (raw: unknown) => AttributionOutput.parse(raw) },
    );
    if (!call.ok) {
      if (call.failureClass === "schema-validation" && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        await runChunk(chunk.slice(0, mid));
        await runChunk(chunk.slice(mid));
        return;
      }
      throw new Error(
        `speakership attribution failed: ${call.failureClass}` +
          `${call.finishReason ? ` (finish_reason: ${call.finishReason})` : ""} — raw: ${
            call.rawOutput?.slice(0, 400) ?? "none"
          }`,
      );
    }
    calls += 1;
    models.add(call.model);
    tokensIn += call.usage.tokensIn;
    tokensOut += call.usage.tokensOut;

    const seen = new Set<string>();
    for (const result of call.value.sentences) {
      // An id the model invented is not a sentence of this document.
      if (!chunk.some((s) => s.id === result.sentenceId)) continue;
      seen.add(result.sentenceId);
      bySentence.set(result.sentenceId, {
        sentenceId: result.sentenceId,
        speakershipClass: result.class,
        speaker: result.class === "quoted-actor" ? result.speaker : null,
        eligible: eligibleClass(result.class),
      });
    }
    // A sentence the model did not answer is NOT silently dropped and NOT
    // promoted: it becomes `unresolved`, which is excluded and counted. Excluding
    // is the fail-closed direction — the dangerous outcome would be treating a
    // missing answer as eligible — and the count makes it visible in the funnel
    // rather than invisible in the gap between two numbers.
    for (const sentence of chunk) {
      if (seen.has(sentence.id)) continue;
      bySentence.set(sentence.id, {
        sentenceId: sentence.id,
        speakershipClass: "unresolved",
        speaker: null,
        eligible: false,
      });
    }
  };

  for (const chunk of attributionChunks(input.sentences)) {
    await runChunk(chunk);
  }

  if (models.size > 1) {
    throw new Error(
      `speakership attribution spans ${models.size} models (${[...models].join(", ")}) — its provenance records one model per document`,
    );
  }

  // Document order, so the funnel and any later per-sentence reader keep the same
  // order as the source rather than the order chunks happened to complete in.
  const sentences: SentenceSpeakership[] = [];
  for (const sentence of input.sentences) {
    const attribution = bySentence.get(sentence.id);
    if (attribution) sentences.push(attribution);
  }

  const byClass = Object.fromEntries(
    (["quoted-actor", "author-claim", "outlet-prose", "unresolved"] as const).map((c) => [
      c,
      sentences.filter((s) => s.speakershipClass === c).length,
    ]),
  ) as Record<SpeakershipClass, number>;
  const eligible = sentences.filter((s) => s.eligible).length;

  return {
    genre: input.genre,
    method: "classified",
    sentences,
    scope: {
      read: sentences.length,
      eligible,
      excluded: sentences.length - eligible,
      byClass,
    },
    provenance: {
      promptVersion: SPEAKERSHIP_PROMPT_VERSIONS["speakership-classify"],
      model: [...models][0] ?? "unknown",
      tokensIn,
      tokensOut,
      calls,
    },
  };
}

/** The sentences triage may see, in document order. */
export function eligibleSentences(input: AttributeInput, attribution: SpeakershipAttribution) {
  const byId = new Map(attribution.sentences.map((s) => [s.sentenceId, s]));
  return input.sentences.filter((s) => byId.get(s.id)?.eligible === true);
}

/** Attribution for one sentence, for the claim write (ADR-0019 §5). */
export function speakershipFor(attribution: SpeakershipAttribution, sentenceId: string) {
  return attribution.sentences.find((s) => s.sentenceId === sentenceId) ?? null;
}

export { ATTRIBUTION_PROMPT };
