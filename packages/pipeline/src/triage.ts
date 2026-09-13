// Triage: document records → claim records (TRIAGE.md §2). LLM stages run
// through the injectable TriageLlm port (ADR-0011); L1 mocks the LLM, so the
// deterministic surface — splitting, routing, fingerprint normalisation,
// drop-log assembly, idempotency — is what these bodies implement. Every
// output carries provenance; every rejection is logged, never silent.

import { createHash } from "node:crypto";
import { FINGERPRINT_NORMALISATION_VERSION } from "@cw/llm";
// The published shape of triage's own output lives in @cw/store, which the
// pipeline may import and the site may too (AGENTS.md boundaries) — so the
// record written here and the record rendered there are one definition.
import type { RejectionClass, StoredDiscourseContext, TriageRecord } from "@cw/store";
import { z } from "zod";
import type {
  CanonicalFingerprintKey,
  CheckabilityDecision,
  ClaimType,
  DiscourseContext,
  DropRecord,
  FingerprintTuple,
  Sentence,
  TriageDocumentInput,
  TriageFailureRecord,
  TriageProvenance,
  TriageResult,
  TypedClaim,
  VerificationMode,
} from "./triage-api.ts";
import type { TriageLlm } from "./triage-llm.ts";

export type {
  CanonicalFingerprintKey,
  CheckabilityDecision,
  ClaimType,
  DiscourseContext,
  DropRecord,
  FingerprintTuple,
  Sentence,
  TriageDocumentInput,
  TriageFailureRecord,
  TriageProvenance,
  TriageResult,
  TypedClaim,
  VerificationMode,
} from "./triage-api.ts";

// ---------- versioned normalisation config (TRIAG open Q3) ----------

export { FINGERPRINT_NORMALISATION_VERSION };

function normaliseCore(text: string): string {
  return (
    text
      // whitespace collapse
      .replace(/\s+/g, " ")
      .trim()
      // percent spelling ↔ % (fixture norm-number)
      .replace(/\s+percent\b/gi, "%")
      // macron folding (fixture norm-macron): versioned, recorded in provenance
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // number words used in fixtures
      .replace(/\bthirty\b/gi, "30")
      .toLowerCase()
  );
}

const SENTENCE_END = /([^.!?]+[.!?]+)(\s|$)/g;

export function splitSentences(text: string, opts?: { cueSpanPreserving?: boolean }): Sentence[] {
  if (opts?.cueSpanPreserving) {
    // ASR cues carry no reliable punctuation; the cue IS the segmentation unit.
    // Splitting mid-cue would break media_anchor anchoring (TRIAG open Q7).
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
  const regex = /[^.!?]+[.!?]+(\s|$)/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const trimmedEnd = raw.trimEnd().length;
    const text = raw.trimEnd();
    const start = text.startsWith(" ") ? cursor + (raw.length - raw.trimStart().length) : cursor;
    sentences.push({
      id: sentenceId(text, start),
      text,
      span: { start, end: start + text.length },
    });
    cursor += raw.length;
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

// ---------- LLM stage wrappers ----------

const CheckabilityOutput = z.object({
  checkable: z.boolean(),
  rejectionClass: z
    .enum([
      "opinion",
      "rhetoric",
      "procedure",
      "satire",
      "pledge-conditional",
      "question",
      "off-domain",
    ])
    .optional(),
  sentence: z.string().optional(),
});

const TypingOutput = z.object({
  claimType: z.enum([
    "statistical",
    "citation-backed",
    "broadcast-quote",
    "institution-citation",
    "false-context",
    "other",
  ]),
  mode: z.enum(["stat-grid", "citation-check", "quote-fidelity", "provenance", "open-web"]),
  sentence: z.string(),
  fingerprint: z
    .object({
      core: z.string(),
      claimant: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      temporal: z.string().nullable().optional(),
      quantity: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      __unusable: z.boolean().optional(),
    })
    .optional(),
});

const ContextOutput = z.object({
  speaker: z.string().nullable(),
  topic: z.string().nullable(),
  proposal: z.string().nullable(),
  attachedProposal: z.string().nullable(),
  qualifiers: z.array(z.string()).default([]),
  // TRIAGE §3.2 has always listed `argument_direction` ("stance over window;
  // null when not confident") and the stored shape has always had a field for
  // it — but the extraction schema never asked for it, so it could only ever be
  // null. Added Sept 2026 with the prompt change; hence the version bump.
  argumentDirection: z.enum(["problem", "success"]).nullable().default(null),
});

export type ContextOutputShape = z.infer<typeof ContextOutput>;

/**
 * Triage's discourse context → the shape the store holds (ADR-0008).
 *
 * Two contracts, different field names, and nothing mapped between them: that
 * is why `contextFromLlm` had no caller for so long. The stored shape is the
 * published one (the verdict page reads `attachedProposal` for its "as
 * deployed" line, and `speechContext` for the who-line), so the mapping lives
 * here at the boundary rather than either side being renamed.
 *
 * The window is carried through verbatim — it is the auditable artefact the
 * context was read from (TRIAGE §3.2), not a derived value.
 */
export function toStoredDiscourseContext(
  context: ContextOutputShape,
  window: string,
): StoredDiscourseContext {
  return {
    window,
    speechContext: context.speaker,
    policyTopic: context.topic,
    attachedProposal: context.attachedProposal,
    argumentDirection: context.argumentDirection,
    contextQualifiers: context.qualifiers.length > 0 ? context.qualifiers.join("; ") : null,
  };
}

/**
 * The stored context for a sentence that had NO window to read. Every field null
 * rather than omitted, on ADR-0008's rule that absent is data: the page then
 * shows no "as deployed" line, which is the truth, rather than a line derived
 * from the claim itself.
 */
export function emptyDiscourseContext(window = ""): StoredDiscourseContext {
  return {
    window,
    speechContext: null,
    policyTopic: null,
    attachedProposal: null,
    argumentDirection: null,
    contextQualifiers: null,
  };
}

const MODE_BY_TYPE: Record<ClaimType, VerificationMode> = {
  statistical: "stat-grid",
  "citation-backed": "citation-check",
  "broadcast-quote": "quote-fidelity",
  "institution-citation": "citation-check",
  "false-context": "provenance",
  other: "open-web",
};

const PROMPT_VERSIONS = {
  "triage-checkability": "triage-checkability@1",
  "triage-typing": "triage-typing@1",
  "triage-fingerprint": "triage-fingerprint@1",
  // @2: the extraction now asks for `argumentDirection`. A prompt edit is a
  // model-equivalent behaviour change, so the version moves with it.
  "triage-context": "triage-context@2",
} as const;

function claimIdFor(text: string, window: string | undefined, claimType: string): string {
  return createHash("sha256")
    .update(`claim:${claimType}:${window ?? ""}:${text}`)
    .digest("hex")
    .slice(0, 32);
}

export async function checkabilityFromLlm(
  llm: TriageLlm,
  input: { sentence: string; window: string },
): Promise<CheckabilityDecision> {
  const promptVersion = PROMPT_VERSIONS["triage-checkability"];
  const call = await llm.generateObject(
    "triage-checkability",
    { sentence: input.sentence, window: input.window },
    { parse: (raw: unknown) => CheckabilityOutput.parse(raw) },
  );
  const baseProvenance: TriageProvenance = {
    promptVersion,
    model: call.ok ? call.model : "unknown",
    tokensIn: call.ok ? call.usage.tokensIn : 0,
    tokensOut: call.ok ? call.usage.tokensOut : 0,
  };
  if (!call.ok) {
    const failureRecord: TriageFailureRecord = {
      failureClass: call.failureClass,
      ...(call.rawOutput !== undefined ? { rawOutput: call.rawOutput } : {}),
    };
    return { decision: "schema-failure", failureRecord, provenance: baseProvenance };
  }
  const value = call.value;
  if (value.checkable) {
    return {
      decision: "checkable",
      provenance: {
        promptVersion,
        model: call.model,
        tokensIn: call.usage.tokensIn,
        tokensOut: call.usage.tokensOut,
      },
    };
  }
  const dropRecord: DropRecord = {
    sentenceId: input.sentence,
    sentenceText: input.sentence,
    rejectionClass: value.rejectionClass ?? "opinion",
    windowText: input.window,
    provenance: {
      promptVersion,
      model: call.model,
      tokensIn: call.usage.tokensIn,
      tokensOut: call.usage.tokensOut,
    },
  };
  return {
    decision: value.rejectionClass === "pledge-conditional" ? "pledge" : "not-checkable",
    dropRecord,
    provenance: {
      promptVersion,
      model: call.model,
      tokensIn: call.usage.tokensIn,
      tokensOut: call.usage.tokensOut,
    },
  };
}

export async function typeClaimFromLlm(
  llm: TriageLlm,
  input: { sentence: string; isCuratedFixture?: boolean },
): Promise<TypedClaim> {
  const call = await llm.generateObject(
    "triage-typing",
    { sentence: input.sentence },
    { parse: (raw: unknown) => TypingOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`triage typing failed: ${call.failureClass}`);
  }
  const value = call.value;
  const provenance: TriageProvenance = {
    promptVersion: PROMPT_VERSIONS["triage-typing"],
    model: call.model,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
  };

  // TRI-R3 conservative boundary: a statistical claim needs a usable numeric
  // fingerprint (parseable quantity). Anything else degrades to 'other' with
  // the attempt retained — never silently generic.
  if (value.claimType === "statistical") {
    const fp = value.fingerprint;
    // Only a RETURNED-but-unusable fingerprint degrades (TRI-R3): the typing
    // stage routinely types a statistical claim before the fingerprint stage
    // runs, so an absent fingerprint is normal, not a degrade signal.
    const returnedButUnusable =
      fp !== undefined &&
      (fp.__unusable === true || fp.quantity == null || !/\d/.test(fp.quantity));
    if (returnedButUnusable) {
      return {
        claimId: claimIdFor(input.sentence, undefined, "other"),
        sourceSentenceId: input.sentence,
        claimType: "other",
        mode: "open-web",
        text: input.sentence,
        ...(fp !== undefined ? { fingerprintAttempt: stripMarker(fp) } : {}),
        provenance,
      };
    }
  }

  return {
    claimId: claimIdFor(input.sentence, undefined, value.claimType),
    sourceSentenceId: input.sentence,
    claimType: value.claimType,
    mode: value.mode,
    text: input.sentence,
    ...(value.fingerprint !== undefined && value.claimType === "statistical"
      ? { fingerprintAttempt: stripMarker(value.fingerprint) }
      : {}),
    ...(input.isCuratedFixture ? { isCuratedFixture: true } : {}),
    provenance,
  };
}

function stripMarker(
  fp: NonNullable<z.infer<typeof TypingOutput>["fingerprint"]>,
): FingerprintTuple {
  return {
    core: fp.core,
    claimant: fp.claimant ?? null,
    domain: fp.domain ?? null,
    temporal: fp.temporal ?? null,
    quantity: fp.quantity ?? null,
    source: fp.source ?? null,
  };
}

export async function fingerprintFromLlm(
  llm: TriageLlm,
  input: { sentence: string },
): Promise<FingerprintTuple> {
  const call = await llm.generateObject(
    "triage-fingerprint",
    { sentence: input.sentence },
    { parse: (raw: unknown) => TypingOutput.parse(raw) },
  );
  if (!call.ok || !call.value.fingerprint) {
    throw new Error(
      `fingerprint extraction failed: ${call.ok ? "no fingerprint in output" : call.failureClass}`,
    );
  }
  return stripMarker(call.value.fingerprint);
}

export async function contextFromLlm(
  llm: TriageLlm,
  input: { window: string },
): Promise<DiscourseContext> {
  const call = await llm.generateObject(
    "triage-context",
    { window: input.window },
    { parse: (raw: unknown) => ContextOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(`context extraction failed: ${call.failureClass}`);
  }
  const value = call.value;
  // Absent is data (ADR-0008): every field null-if-absent, never defaulted.
  return {
    speaker: value.speaker,
    topic: value.topic,
    proposal: value.proposal,
    attachedProposal: value.attachedProposal,
    qualifiers: value.qualifiers,
    argumentDirection: value.argumentDirection,
    provenance: {
      promptVersion: PROMPT_VERSIONS["triage-context"],
      model: call.model,
      tokensIn: call.usage.tokensIn,
      tokensOut: call.usage.tokensOut,
    },
  };
}

// ---------- canonical fingerprint key (TRI-R2) ----------

export function canonicalFingerprintKey(tuple: Partial<FingerprintTuple>): CanonicalFingerprintKey {
  const normalised = {
    core: normaliseCore(tuple.core ?? ""),
    claimant: tuple.claimant ?? null,
    domain: tuple.domain ?? null,
    temporal: tuple.temporal == null ? null : normaliseCore(tuple.temporal),
    quantity: tuple.quantity == null ? null : normaliseCore(tuple.quantity),
    source: tuple.source ?? null,
  };
  const key = createHash("sha256").update(JSON.stringify(normalised)).digest("hex").slice(0, 40);
  return { key, normalisationVersion: FINGERPRINT_NORMALISATION_VERSION };
}

// ---------- document-level triage (idempotent, TRI-R13) ----------

const DocumentLlmOutput = z.object({
  results: z.array(
    z.union([
      z.object({
        sentenceId: z.string(),
        checkable: z.literal(true),
        claimType: z.string(),
        mode: z.string(),
      }),
      z.object({ sentenceId: z.string(), checkable: z.literal(false), rejectionClass: z.string() }),
    ]),
  ),
});

/** The real Zod schemas per triage role — the live adapter generates with
 * these directly; the port's {parse} wrapper exists for mock injection. */
export const TRIAGE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "triage-checkability": DocumentLlmOutput,
  "triage-typing": TypingOutput,
  "triage-fingerprint": TypingOutput,
  "triage-context": ContextOutput,
};

type CheckabilityResult = z.infer<typeof DocumentLlmOutput>["results"][number];
type TriageSentence = TriageDocumentInput["sentences"][number];

/**
 * Bounds on the checkability fan-out (TRI-R12). The call returns ONE result per
 * sentence, so the response grows with the document while the adapter's output
 * budget is fixed — a real 47-sentence news article (~8.5 KB of results)
 * truncated at the 2048-token default and surfaced as `schema-validation — the
 * model did not return a response`, naming the symptom and not the cause
 * (Sept 2026). Both the sentence count and the input characters are bounded:
 * one very long sentence is still one result but unbounded prompt text.
 */
const CHECKABILITY_CHUNK_SENTENCES = 20;
const CHECKABILITY_CHUNK_CHARS = 6000;

/**
 * Split the document into calls small enough to answer in one response. A
 * document that fits is one chunk, so the single-chunk path issues exactly the
 * call it issued before this existed — which is what keeps the L2 goldens and
 * the ops slices unchanged.
 */
function checkabilityChunks(sentences: TriageSentence[]): TriageSentence[][] {
  const chunks: TriageSentence[][] = [];
  let current: TriageSentence[] = [];
  let chars = 0;
  for (const sentence of sentences) {
    const size = sentence.text.length + (sentence.window?.length ?? 0);
    if (
      current.length > 0 &&
      (current.length >= CHECKABILITY_CHUNK_SENTENCES || chars + size > CHECKABILITY_CHUNK_CHARS)
    ) {
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

/**
 * What document triage produces: the triage result, plus the per-claim discourse
 * context it read (ADR-0008) and the record the verdict page publishes
 * (SITE-MVP §2.3). Declared as a named type so a consumer cannot hold the result
 * typed as `TriageResult` and miss the fields the store write needs — which is
 * how `attached_proposal` stayed null for so long.
 *
 * `Omit<…, "claims">` rather than intersecting `TriageResult` directly: an
 * intersection of two array types (`Array<A> & Array<B>`) does not propagate the
 * narrowed element type through `.find()`. TypeScript infers the BASE element
 * type there, so a consumer that selects a claim the natural way —
 * `claims.find(c => c.claimType === …)` — cannot see `discourseContext` and fails
 * to compile, while index access works. Verified against tsc (Sept 2026), and it
 * bit the first consumer, which is the whole reason this type exists.
 */
export type TriageDocumentResult = Omit<TriageResult, "claims"> & {
  claims: Array<
    TypedClaim & { sourceSentenceId: string; discourseContext: StoredDiscourseContext }
  >;
  dropLog: Array<DropRecord & { sentenceId: string }>;
  triageRecord: TriageRecord;
};

export async function triageDocument(
  doc: TriageDocumentInput,
  llm: TriageLlm,
): Promise<TriageDocumentResult> {
  const results: CheckabilityResult[] = [];
  const models = new Set<string>();
  let tokensIn = 0;
  let tokensOut = 0;

  const runChunk = async (chunk: TriageSentence[]): Promise<void> => {
    const call = await llm.generateObject(
      "triage-checkability",
      { sentences: chunk },
      { parse: (raw: unknown) => DocumentLlmOutput.parse(raw) },
    );
    if (!call.ok) {
      // A chunk that overflows the output budget is retried at half size rather
      // than failing the document: a schema failure here IS the truncation
      // signal, so the retry turns a hard failure into a slower success. Bounded
      // by the halving — `chunk.length > 1` is what terminates it.
      if (call.failureClass === "schema-validation" && chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2);
        await runChunk(chunk.slice(0, mid));
        await runChunk(chunk.slice(mid));
        return;
      }
      // Truncation is named where it happens: this message is what made a
      // 2048-token cut look like a model that refused to answer.
      throw new Error(
        `triage failed: ${call.failureClass}` +
          `${call.finishReason ? ` (finish_reason: ${call.finishReason})` : ""} — raw: ${
            call.rawOutput?.slice(0, 400) ?? "none"
          }`,
      );
    }
    results.push(...call.value.results);
    models.add(call.model);
    tokensIn += call.usage.tokensIn;
    tokensOut += call.usage.tokensOut;
  };

  for (const chunk of checkabilityChunks(doc.sentences)) {
    await runChunk(chunk);
  }

  // One provenance record has to describe every chunk, so the chunks must agree
  // on the model. ADR-0011's tiered routing makes a mid-document escalation
  // possible, and recording the first chunk's model would name a model that
  // produced only part of the triage — the same class of misattribution as the
  // phantom `adjudication@1` role. Fail loudly; per-chunk provenance is a store
  // shape change and wants its own decision (Sept 2026).
  if (models.size > 1) {
    throw new Error(
      `triage spans ${models.size} models (${[...models].join(", ")}) — triage provenance records one model per document; per-chunk provenance is not modelled`,
    );
  }
  const provenance: TriageProvenance = {
    promptVersion: PROMPT_VERSIONS["triage-checkability"],
    model: [...models][0] ?? "unknown",
    // Summed across chunks: ADR-0012 computes cost at aggregation from the price
    // map, so the thing to accumulate is tokens, not money.
    tokensIn,
    tokensOut,
  };
  const claims: Array<
    TypedClaim & { sourceSentenceId: string; discourseContext: StoredDiscourseContext }
  > = [];
  const dropLog: Array<DropRecord & { sentenceId: string }> = [];
  const failures: TriageFailureRecord[] = [];
  for (const result of results) {
    const sentence = doc.sentences.find((s) => s.id === result.sentenceId);
    if (!sentence) continue;
    if (result.checkable) {
      const claimType = (
        [
          "statistical",
          "citation-backed",
          "broadcast-quote",
          "institution-citation",
          "false-context",
          "other",
        ] as const
      ).includes(result.claimType as ClaimType)
        ? (result.claimType as ClaimType)
        : "other";
      // The discourse-context pass (TRIAGE §2.3, ADR-0008) runs HERE, per
      // checkable claim, and only when there is a window to read. It had no
      // caller at all until Sept 2026: `contextFromLlm` was exercised by its own
      // tests and by nothing else, so every stored `attached_proposal` was null
      // and the verdict page's "as deployed" line could never render on a real
      // claim. A stage the orchestrator forgets is a stage that does not exist,
      // however well covered in isolation.
      //
      // No window → no call, and an all-null context, because ADR-0008 forbids
      // inferring deployment framing from anything but window text: the honest
      // reading of a missing window is "absent", never "read it off the claim".
      const window = sentence.window ?? "";
      const discourseContext =
        window.trim().length > 0
          ? toStoredDiscourseContext(await contextFromLlm(llm, { window }), window)
          : emptyDiscourseContext();
      claims.push({
        claimId: claimIdFor(sentence.text, sentence.window, result.claimType),
        sourceSentenceId: sentence.id,
        claimType: claimType as ClaimType,
        mode: (MODE_BY_TYPE[claimType as ClaimType] ?? result.mode) as VerificationMode,
        text: sentence.text,
        discourseContext,
        provenance,
      });
    } else {
      dropLog.push({
        sentenceId: sentence.id,
        sentenceText: sentence.text,
        rejectionClass: result.rejectionClass as DropRecord["rejectionClass"],
        windowText: sentence.window ?? sentence.text,
        provenance,
      });
    }
  }
  // Document order, not completion order: the verdict page renders the set-aside
  // list in array order and invites the reader to judge the boundary themselves,
  // which a chunk-ordered list quietly defeats.
  const index = new Map(doc.sentences.map((sentence, i) => [sentence.id, i]));
  dropLog.sort((a, b) => (index.get(a.sentenceId) ?? 0) - (index.get(b.sentenceId) ?? 0));
  return {
    claims,
    dropLog,
    failures,
    provenance,
    triageRecord: triageRecordFor(doc, claims, dropLog),
  };
}

/**
 * Fold the drop log into the record the verdict page publishes (SITE-MVP §2.3,
 * Sept 2026): how many sentences were read, how many became claims, which were
 * set aside and why, and which were held rather than dropped.
 *
 * `pledge-conditional` sentences are the held bucket, not a rejection. TRIAGE.md
 * §2.2 is explicit that they are "pledge — not yet checkable", checkable later
 * as consistency claims once a deadline passes — so they are a debt the project
 * owes a verdict on, and the page reports them separately from sentences no
 * evidence can ever settle. Every other rejection class is a permanent set-aside.
 *
 * Counts come from the document and the results rather than from
 * `setAside.length`, so a sentence whose id fails to match the document (skipped
 * in the loop above) can never silently shrink the denominator the page divides
 * by.
 */
export function triageRecordFor(
  doc: TriageDocumentInput,
  claims: readonly TypedClaim[],
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
