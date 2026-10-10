// Triage: document records → claim records (TRIAGE.md, ADR-0025). Two independent
// per-sentence decisions:
//
//   1. triage-speakership  — whose words is the sentence?
//   2. triage-checkability — is it a checkable factual assertion, or why not?
//
// A sentence is checkable only when BOTH arms pass. One context pass per
// checkable claim then reads the WHOLE document to say what argumentative point
// the claim supports (ADR-0026).
//
// LLM stages run through the injectable TriageLlm port (ADR-0011); L1 mocks the
// LLM, so the deterministic surface — splitting, arm evaluation, drop-log
// assembly, context mapping, idempotency — is what these bodies implement.

import { createHash } from "node:crypto";
import {
  ELIGIBLE_SPEAKERSHIP_CLASSES,
  REJECTION_CLASSES,
  type RejectionClass,
  type SpeakershipClass,
  type StoredDiscourseContext,
  type TriageRecord,
} from "@cw/store";
import { z } from "zod";
import type { DecisionPort, DecisionRole } from "./decision-port.ts";
import { checkabilityQuestion, speakershipQuestion } from "./decision-questions.ts";
import { runDecisionStage } from "./decision-stage.ts";
import {
  type ClaimRecord,
  CONTENT_CLASSES,
  type ContentClass,
  type DiscourseContext,
  type DropRecord,
  type Sentence,
  type SentenceCheckability,
  type SentenceSpeakership,
  type TriageDocumentInput,
  type TriageFailureRecord,
  type TriageProvenance,
} from "./triage-api.ts";
import type { TriageLlm } from "./triage-llm.ts";

export type {
  ClaimRecord,
  ContentClass,
  DiscourseContext,
  DropRecord,
  Sentence,
  SentenceCheckability,
  SentenceSpeakership,
  TriageDocumentInput,
  TriageFailureRecord,
  TriageProvenance,
} from "./triage-api.ts";
export { CONTENT_CLASSES } from "./triage-api.ts";

// ---------- the two axes (ADR-0025) ----------

const SPEAKERSHIP_CLASSES = ["quoted-actor", "author-claim", "outlet-prose", "unresolved"] as const;

/** Axis 1 passes when the sentence is someone's words we may check. */
export function isEligibleSpeakershipClass(value: string): value is SpeakershipClass {
  return (ELIGIBLE_SPEAKERSHIP_CLASSES as readonly string[]).includes(value);
}

/** Axis 2 passes when the sentence is a factual assertion. */
export function isCheckableContent(value: string): boolean {
  return value === "checkable";
}

/** Both arms pass. */
export function isCheckable(speakership: string, content: string): boolean {
  return isEligibleSpeakershipClass(speakership) && isCheckableContent(content);
}

function isRejectionClass(value: string): value is RejectionClass {
  return (REJECTION_CLASSES as readonly string[]).includes(value);
}

// ---------- sentence splitting ----------

export function splitSentences(text: string, opts?: { cueSpanPreserving?: boolean }): Sentence[] {
  if (opts?.cueSpanPreserving) {
    return [
      {
        id: sentenceId(text, 0),
        text,
        span: { start: 0, end: text.length },
        cueSpan: { start: 0, end: text.length },
      },
    ];
  }
  const sentences: Sentence[] = [];
  const regex = /([^.!?]+[.!?]+)(\s|$)/g;
  let match = regex.exec(text);
  let cursor = 0;
  while (match !== null) {
    const raw = match[0];
    const sentence = raw.trimEnd();
    const start = sentence.startsWith(" ")
      ? cursor + (raw.length - raw.trimStart().length)
      : cursor;
    sentences.push({
      id: sentenceId(sentence, start),
      text: sentence,
      span: { start, end: start + sentence.length },
    });
    cursor += raw.length;
    match = regex.exec(text);
  }
  if (cursor < text.length) {
    const rest = text.slice(cursor).trim();
    if (rest.length > 0) {
      const start = text.indexOf(rest, cursor);
      sentences.push({
        id: sentenceId(rest, start),
        text: rest,
        span: { start, end: start + rest.length },
      });
    }
  }
  return sentences;
}

function sentenceId(text: string, offset: number): string {
  return `s-${createHash("sha256").update(`${offset}:${text}`).digest("hex").slice(0, 12)}`;
}

// ---------- prompts ----------

export const TRIAGE_PROMPT_VERSIONS = {
  "triage-speakership": "triage-speakership@1",
  "triage-checkability": "triage-checkability@1",
  "triage-context": "triage-context@1",
} as const;

export const TRIAGE_SPEAKERSHIP_PROMPT = `You decide, for each sentence of a document, WHOSE WORDS IT IS. This is conservative by design: when the speaker is not clear from the text, the answer is "unresolved", never a guess.

You are given the whole document and its sentences in order. USE THE WHOLE DOCUMENT to resolve who is speaking: a reference like "the Minister" or "Mr Mitchell" in one sentence is named elsewhere in the document. Give the speaker's name, and their role or portfolio where the document states it ("Mark Mitchell, Police Minister"). Return exactly one class per sentence, in the order given, plus the speaker when the class is "quoted-actor" and null otherwise.

Classes:
- "quoted-actor": reported speech. The sentence is inside quotation marks, or its words are attributed to someone ("Macpherson says", "Hipkins told RNZ", "the report said"). A quotation may open in one sentence with the attribution verb in an adjacent one: read the neighbours and attribute to the speaker it is attributed to.
- "author-claim": the AUTHOR of an opinion or analysis piece asserting in their own voice. Only available when the genre is "opinion-analysis". Never for a news report: there the author is a journalist reporting, not claiming.
- "outlet-prose": the journalist or outlet narrating, summarising, setting the scene, or describing background. No speaker.
- "unresolved": a quotation with no resolvable speaker — an unattributed pull-quote, or one whose attribution is genuinely ambiguous.

Rules:
- A person merely mentioned in a sentence is NOT its speaker.
- Do not treat the document's headline or standfirst as a claim.
- The genre decides which rules apply: for "news-report", "author-claim" is not available.`;

export const TRIAGE_CHECKABILITY_PROMPT = `You decide, for each sentence, WHAT IT IS: a factual assertion that evidence could settle, or something else.

You are given the document's genre and the sentences that are someone's words (each with the class the speakership pass gave it). Return exactly one class per sentence, in the order given.

Classes:
- "checkable": a factual assertion about the world that evidence could prove or disprove. A quotation of a factual claim is checkable; the fact that it is someone's opinion is not the same as the sentence BEING an opinion.
- "opinion": an evaluation, value judgement, or prediction that no evidence can settle as stated.
- "rhetoric": persuasive framing with no factual content.
- "procedure": a statement about proceedings rather than a factual claim.
- "satire": satire is set aside, never checked.
- "question": a question, not an assertion.
- "off-domain": outside the project's policy remit.
- "pledge-conditional": a commitment about what will happen; gradable only once its deadline passes.

A sentence can be someone's words AND an opinion: judge what the sentence asserts, not who said it.`;

export const TRIAGE_CONTEXT_PROMPT = `You are given a document and one claim made in it. Say what the claim is doing in the document's argument.

Answer four things:
- venue: where or on what occasion the words were said ("in the House", "at a post-Cabinet press conference", "on RNZ Morning Report"). Null when the document does not say. NEVER the speaker's name.
- topic: the policy topic the claim is about. Null when unclear.
- supports: the specific point the claim is used to support — why it matters to the argument being made. Read the WHOLE document to answer this, not just the sentence. Null when the document does not make the point.
- qualifiers: the speaker's own qualifications, verbatim where present.

All fields null (or empty) if absent. Never infer from who is speaking.`;

// ---------- schemas ----------

const SpeakershipOutput = z.object({
  sentences: z
    .array(
      z.object({
        sentenceId: z.string(),
        speakershipClass: z.enum(SPEAKERSHIP_CLASSES),
        speaker: z.string().nullable().default(null),
      }),
    )
    .min(1),
});

const CheckabilityOutput = z.object({
  sentences: z
    .array(z.object({ sentenceId: z.string(), contentClass: z.enum(CONTENT_CLASSES) }))
    .min(1),
});

const ContextOutput = z.object({
  venue: z.string().nullable().default(null),
  topic: z.string().nullable().default(null),
  supports: z.string().nullable().default(null),
  qualifiers: z.array(z.string()).default([]),
});

export type ContextOutputShape = z.infer<typeof ContextOutput>;

function claimIdFor(text: string, window: string | undefined, speakershipClass: string): string {
  return createHash("sha256")
    .update(`claim:${speakershipClass}:${window ?? ""}:${text}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * The claim as made, not the sentence it was embedded in. A quoted claim is the
 * quoted content; a trailing attribution (`, he said in a statement`) is not part
 * of what was claimed. The verbatim sentence is kept separately
 * (`utteranceText`) so nothing is lost.
 */
export function normaliseClaimText(sentence: string): string {
  // A directly quoted claim: the content inside the quotation marks.
  const quoted = sentence.match(/["“]([^"”]+)["”]/);
  if (quoted?.[1] != null && quoted[1].trim().length > 0) {
    return quoted[1].trim().replace(/[,;:]+$/, "");
  }
  // Reported speech without quotation marks: drop a trailing attribution clause.
  return sentence
    .replace(
      /,\s*(?:he|she|they|the\s+[A-Za-z][A-Za-z .'-]*|Mr|Ms|Mrs|[A-Z][a-z]+)\s+(?:said|says|stated|told|added|wrote|claimed|confirmed)\b[\s\S]*$/i,
      "",
    )
    .trim();
}

export function toStoredDiscourseContext(
  context: ContextOutputShape,
  window: string,
): StoredDiscourseContext {
  return {
    window,
    speechContext: context.venue,
    policyTopic: context.topic,
    supports: context.supports,
    contextQualifiers: context.qualifiers.length > 0 ? context.qualifiers.join("; ") : null,
  };
}

export function emptyDiscourseContext(window = ""): StoredDiscourseContext {
  return {
    window,
    speechContext: null,
    policyTopic: null,
    supports: null,
    contextQualifiers: null,
  };
}

export async function contextFromLlm(
  llm: TriageLlm,
  input: { claim: string; document: string },
): Promise<DiscourseContext> {
  const call = await llm.generateObject("triage-context", input, ContextOutput);
  if (!call.ok) {
    throw new Error(`context extraction failed: ${call.failureClass}`);
  }
  const value = call.value;
  return {
    venue: value.venue,
    topic: value.topic,
    supports: value.supports,
    qualifiers: value.qualifiers,
    provenance: {
      promptVersion: TRIAGE_PROMPT_VERSIONS["triage-context"],
      model: call.model,
      tokensIn: call.usage.tokensIn,
      tokensOut: call.usage.tokensOut,
    },
  };
}

// ---------- document-level triage ----------

type TriageSentence = TriageDocumentInput["sentences"][number];

/**
 * Bounds on the per-sentence fan-out (TRI-R12): one result per sentence against a
 * fixed output budget. A chunk whose response fails schema validation is retried
 * at half size before the document is failed.
 */
const CHUNK_SENTENCES = 20;
const CHUNK_CHARS = 6000;

function chunksOf<T extends { text: string }>(sentences: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
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

interface StageProvenance {
  provenance: TriageProvenance;
  failures: TriageFailureRecord[];
}

/**
 * Run one per-sentence stage across the document's chunks, returning a result per
 * sentence and the stage's provenance. A sentence the model did not answer is
 * left out of the map; the caller decides the fail-closed answer.
 */
async function runPerSentenceStage<
  S extends { text: string; window?: string },
  R extends { sentenceId: string },
>(
  llm: TriageLlm,
  role: "triage-speakership" | "triage-checkability",
  promptVersion: string,
  input: { genre: string; sentences: S[]; user: (sentences: S[]) => unknown },
  schema: z.ZodType<{ sentences: R[] }>,
): Promise<{ byId: Map<string, R>; stage: StageProvenance }> {
  const byId = new Map<string, R>();
  const models = new Set<string>();
  let tokensIn = 0;
  let tokensOut = 0;
  const failures: TriageFailureRecord[] = [];

  const runChunk = async (chunk: S[]): Promise<void> => {
    const call = await llm.generateObject(role, input.user(chunk), schema);
    if (!call.ok) {
      if (call.failureClass === "schema-validation" && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        await runChunk(chunk.slice(0, mid));
        await runChunk(chunk.slice(mid));
        return;
      }
      throw new Error(
        `${role} failed: ${call.failureClass}` +
          `${call.finishReason ? ` (finish_reason: ${call.finishReason})` : ""} — raw: ${
            call.rawOutput?.slice(0, 400) ?? "none"
          }`,
      );
    }
    for (const result of call.value.sentences) byId.set(result.sentenceId, result);
    models.add(call.model);
    tokensIn += call.usage.tokensIn;
    tokensOut += call.usage.tokensOut;
  };

  for (const chunk of chunksOf(input.sentences)) {
    await runChunk(chunk);
  }
  if (models.size > 1) {
    throw new Error(
      `${role} spans ${models.size} models (${[...models].join(", ")}) — provenance records one model per stage per document`,
    );
  }
  return {
    byId,
    stage: {
      provenance: {
        promptVersion,
        model: [...models][0] ?? "unknown",
        tokensIn,
        tokensOut,
      },
      failures,
    },
  };
}

export type TriageDocumentResult = {
  claims: Array<
    ClaimRecord & { sourceSentenceId: string; discourseContext: StoredDiscourseContext }
  >;
  dropLog: Array<DropRecord & { sentenceId: string }>;
  failures: TriageFailureRecord[];
  provenance: TriageProvenance;
  triageRecord: TriageRecord;
};

/**
 * Optional decision-port configuration (ADR-0024). A role is routed to the
 * decision model only when it is named in `decisionRoles`, so the default (no
 * options) is exactly the all-generative path and a role moves only after a
 * calibration run clears the accuracy floor.
 */
export interface TriageOptions {
  decisions?: DecisionPort;
  decisionRoles?: DecisionRole[];
  decisionThreshold?: number;
}

function decisionEnabled(opts: TriageOptions, role: DecisionRole): boolean {
  return opts.decisions != null && (opts.decisionRoles ?? []).includes(role);
}

/**
 * Axis 1 through the decision port: the class is a closed choice, so the model
 * cannot invent one, and a settled `quoted-actor` still escalates for the
 * attribution NAME — no decision primitive produces free text.
 */
async function runSpeakershipDecisions(
  doc: TriageDocumentInput,
  llm: TriageLlm,
  opts: TriageOptions,
): Promise<{ byId: Map<string, SentenceSpeakership>; stage: StageProvenance }> {
  const port = opts.decisions;
  if (port == null) throw new Error("runSpeakershipDecisions called without a decision port");
  const sentences = doc.sentences.map((sentence) => ({ id: sentence.id, text: sentence.text }));
  let escalationTokensIn = 0;
  let escalationTokensOut = 0;
  let escalationModel = "not-called";
  const result = await runDecisionStage({
    port,
    role: "triage-speakership",
    items: sentences,
    ...(opts.decisionThreshold != null ? { threshold: opts.decisionThreshold } : {}),
    stateFor: (items) => ({
      genre: doc.genre,
      document: doc.documentText ?? null,
      sentences: items,
    }),
    questionFor: (sentence) => ({ [sentence.id]: speakershipQuestion(sentence.id) }),
    settle: (sentence, answers) => {
      const answer = answers[sentence.id];
      const cls = answer?.type === "choice" ? answer.choice : "unresolved";
      return {
        sentenceId: sentence.id,
        speakershipClass: (SPEAKERSHIP_CLASSES as readonly string[]).includes(cls)
          ? (cls as SpeakershipClass)
          : "unresolved",
        speaker: null,
      };
    },
    needsEscalation: (sentence, answers) => {
      const answer = answers[sentence.id];
      return answer?.type === "choice" && answer.choice === "quoted-actor";
    },
    escalate: async (items) => {
      const stage = await runPerSentenceStage<TriageSentence, SentenceSpeakership>(
        llm,
        "triage-speakership",
        TRIAGE_PROMPT_VERSIONS["triage-speakership"],
        {
          genre: doc.genre,
          sentences: items,
          user: (chunk) => ({
            genre: doc.genre,
            document: doc.documentText ?? null,
            sentences: chunk,
          }),
        },
        SpeakershipOutput,
      );
      escalationTokensIn += stage.stage.provenance.tokensIn;
      escalationTokensOut += stage.stage.provenance.tokensOut;
      escalationModel = stage.stage.provenance.model;
      return stage.byId;
    },
  });
  return {
    byId: result.byId,
    stage: {
      provenance: {
        promptVersion: TRIAGE_PROMPT_VERSIONS["triage-speakership"],
        // The generative model ran only for the escalated items; when nothing
        // escalated the decision model is what produced the answers.
        model: result.escalated > 0 ? escalationModel : (result.model ?? "unknown"),
        tokensIn: result.tokensIn + escalationTokensIn,
        tokensOut: result.tokensOut + escalationTokensOut,
        decision: {
          role: "triage-speakership",
          model: result.model ?? "unknown",
          provider: result.provider ?? "unknown",
          settled: result.settled,
          escalated: result.escalated,
          degraded: result.degraded,
        },
      },
      failures: [],
    },
  };
}

/** Axis 2 through the decision port: a pure closed choice, with no name to escalate for. */
async function runCheckabilityDecisions(
  doc: TriageDocumentInput,
  eligible: Array<TriageSentence & { speakershipClass: SpeakershipClass }>,
  llm: TriageLlm,
  opts: TriageOptions,
): Promise<{ byId: Map<string, SentenceCheckability>; stage: StageProvenance }> {
  const port = opts.decisions;
  if (port == null) throw new Error("runCheckabilityDecisions called without a decision port");
  const sentences = eligible.map((s) => ({
    id: s.id,
    text: s.text,
    speakershipClass: s.speakershipClass,
  }));
  let escalationTokensIn = 0;
  let escalationTokensOut = 0;
  let escalationModel = "not-called";
  const result = await runDecisionStage({
    port,
    role: "triage-checkability",
    items: sentences,
    ...(opts.decisionThreshold != null ? { threshold: opts.decisionThreshold } : {}),
    stateFor: (items) => ({ genre: doc.genre, sentences: items }),
    questionFor: (sentence) => ({ [sentence.id]: checkabilityQuestion(sentence.id) }),
    settle: (sentence, answers) => {
      const answer = answers[sentence.id];
      const cls = answer?.type === "choice" ? answer.choice : "off-domain";
      return {
        sentenceId: sentence.id,
        contentClass: (CONTENT_CLASSES as readonly string[]).includes(cls)
          ? (cls as ContentClass)
          : "off-domain",
      };
    },
    escalate: async (items) => {
      const stage = await runPerSentenceStage<
        { id: string; text: string; speakershipClass: SpeakershipClass },
        SentenceCheckability
      >(
        llm,
        "triage-checkability",
        TRIAGE_PROMPT_VERSIONS["triage-checkability"],
        {
          genre: doc.genre,
          sentences: items,
          user: (chunk) => ({ genre: doc.genre, sentences: chunk }),
        },
        CheckabilityOutput,
      );
      escalationTokensIn += stage.stage.provenance.tokensIn;
      escalationTokensOut += stage.stage.provenance.tokensOut;
      escalationModel = stage.stage.provenance.model;
      return stage.byId;
    },
  });
  return {
    byId: result.byId,
    stage: {
      provenance: {
        promptVersion: TRIAGE_PROMPT_VERSIONS["triage-checkability"],
        model: result.escalated > 0 ? escalationModel : (result.model ?? "unknown"),
        tokensIn: result.tokensIn + escalationTokensIn,
        tokensOut: result.tokensOut + escalationTokensOut,
        decision: {
          role: "triage-checkability",
          model: result.model ?? "unknown",
          provider: result.provider ?? "unknown",
          settled: result.settled,
          escalated: result.escalated,
          degraded: result.degraded,
        },
      },
      failures: [],
    },
  };
}

export async function triageDocument(
  doc: TriageDocumentInput,
  llm: TriageLlm,
  opts: TriageOptions = {},
): Promise<TriageDocumentResult> {
  // Axis 1 — whose words, for every sentence. Through the decision port when the
  // role is gated, otherwise the generative path (ADR-0024).
  const speakership = decisionEnabled(opts, "triage-speakership")
    ? await runSpeakershipDecisions(doc, llm, opts)
    : await runPerSentenceStage<TriageSentence, SentenceSpeakership>(
        llm,
        "triage-speakership",
        TRIAGE_PROMPT_VERSIONS["triage-speakership"],
        {
          genre: doc.genre,
          // The model gets the sentence text; the stored window is an artefact for
          // the page, not input to the decision, and re-sending it per sentence would
          // multiply the prompt by the number of chunks.
          sentences: doc.sentences.map((sentence) => ({ id: sentence.id, text: sentence.text })),
          user: (sentences) => ({
            genre: doc.genre,
            document: doc.documentText ?? null,
            sentences,
          }),
        },
        SpeakershipOutput,
      );

  const speakershipFor = (sentence: TriageSentence): SentenceSpeakership => {
    const answer = speakership.byId.get(sentence.id);
    const cls = answer?.speakershipClass;
    // Fail closed: an unanswered or unknown class is `unresolved`.
    if (cls == null || !(SPEAKERSHIP_CLASSES as readonly string[]).includes(cls)) {
      return { sentenceId: sentence.id, speakershipClass: "unresolved", speaker: null };
    }
    return {
      sentenceId: sentence.id,
      speakershipClass: cls,
      speaker: cls === "quoted-actor" ? (answer?.speaker ?? null) : null,
    };
  };

  const eligible = doc.sentences.filter((s) =>
    isEligibleSpeakershipClass(speakershipFor(s).speakershipClass),
  );

  // Axis 2 — what the sentence is, for eligible sentences only. When none are
  // eligible there is nothing to ask, and no call is made.
  const checkability =
    eligible.length > 0
      ? decisionEnabled(opts, "triage-checkability")
        ? await runCheckabilityDecisions(
            doc,
            eligible.map((s) => ({
              id: s.id,
              text: s.text,
              speakershipClass: speakershipFor(s).speakershipClass,
            })),
            llm,
            opts,
          )
        : await runPerSentenceStage<
            TriageSentence & { speakershipClass: SpeakershipClass },
            SentenceCheckability
          >(
            llm,
            "triage-checkability",
            TRIAGE_PROMPT_VERSIONS["triage-checkability"],
            {
              genre: doc.genre,
              sentences: eligible.map((s) => ({
                id: s.id,
                text: s.text,
                speakershipClass: speakershipFor(s).speakershipClass,
              })),
              user: (sentences) => ({ genre: doc.genre, sentences }),
            },
            CheckabilityOutput,
          )
      : {
          byId: new Map<string, SentenceCheckability>(),
          stage: {
            provenance: {
              promptVersion: TRIAGE_PROMPT_VERSIONS["triage-checkability"],
              model: "not-called",
              tokensIn: 0,
              tokensOut: 0,
            },
            failures: [],
          },
        };

  const documentText = doc.documentText ?? doc.sentences.map((s) => s.text).join(" ");
  const claims: TriageDocumentResult["claims"] = [];
  const dropLog: TriageDocumentResult["dropLog"] = [];

  for (const sentence of doc.sentences) {
    const spoken = speakershipFor(sentence);
    if (!isEligibleSpeakershipClass(spoken.speakershipClass)) {
      dropLog.push({
        sentenceId: sentence.id,
        sentenceText: sentence.text,
        rejectionClass: spoken.speakershipClass as RejectionClass,
        windowText: sentence.window ?? sentence.text,
        provenance: speakership.stage.provenance,
      });
      continue;
    }
    const contentAnswer = checkability.byId.get(sentence.id);
    const contentClass: ContentClass = contentAnswer?.contentClass ?? "off-domain";
    if (contentClass !== "checkable") {
      dropLog.push({
        sentenceId: sentence.id,
        sentenceText: sentence.text,
        rejectionClass: isRejectionClass(contentClass) ? contentClass : "off-domain",
        windowText: sentence.window ?? sentence.text,
        provenance: checkability.stage.provenance,
      });
      continue;
    }
    const window = sentence.window ?? "";
    const discourseContext =
      documentText.trim().length > 0
        ? toStoredDiscourseContext(
            await contextFromLlm(llm, { claim: sentence.text, document: documentText }),
            window,
          )
        : emptyDiscourseContext(window);
    claims.push({
      claimId: claimIdFor(sentence.text, sentence.window, spoken.speakershipClass),
      sourceSentenceId: sentence.id,
      text: normaliseClaimText(sentence.text),
      utteranceText: sentence.text,
      speakershipClass: spoken.speakershipClass,
      speaker: spoken.speaker,
      discourseContext,
      provenance: checkability.stage.provenance,
    });
  }

  const index = new Map(doc.sentences.map((sentence, i) => [sentence.id, i]));
  dropLog.sort((a, b) => (index.get(a.sentenceId) ?? 0) - (index.get(b.sentenceId) ?? 0));
  return {
    claims,
    dropLog,
    failures: [...speakership.stage.failures, ...checkability.stage.failures],
    provenance: speakership.stage.provenance,
    triageRecord: triageRecordFor(doc, claims, dropLog),
  };
}

/**
 * Fold the drop log into the record the verdict page publishes: how many
 * sentences were read, how many became claims, which were set aside and why, and
 * which were held rather than dropped.
 */
export function triageRecordFor(
  doc: TriageDocumentInput,
  claims: readonly ClaimRecord[],
  dropLog: readonly DropRecord[],
): TriageRecord {
  return {
    sentencesRead: doc.sentences.length,
    checked: claims.length,
    setAside: dropLog
      .filter((drop) => drop.rejectionClass !== "pledge-conditional")
      .map((drop) => ({
        sentenceText: drop.sentenceText,
        rejectionClass: drop.rejectionClass as RejectionClass,
      })),
    held: dropLog
      .filter((drop) => drop.rejectionClass === "pledge-conditional")
      .map((drop) => ({
        sentenceText: drop.sentenceText,
        reason: "A commitment: it can only be graded once the deadline it names has passed.",
      })),
  };
}
