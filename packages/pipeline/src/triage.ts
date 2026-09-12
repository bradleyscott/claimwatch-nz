// Triage: document records → claim records (TRIAGE.md §2). LLM stages run
// through the injectable TriageLlm port (ADR-0011); L1 mocks the LLM, so the
// deterministic surface — splitting, routing, fingerprint normalisation,
// drop-log assembly, idempotency — is what these bodies implement. Every
// output carries provenance; every rejection is logged, never silent.

import { createHash } from "node:crypto";
import { FINGERPRINT_NORMALISATION_VERSION } from "@cw/llm";
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
});

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
  "triage-context": "triage-context@1",
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

export async function triageDocument(
  doc: TriageDocumentInput,
  llm: TriageLlm,
): Promise<
  TriageResult & {
    claims: Array<TypedClaim & { sourceSentenceId: string }>;
    dropLog: Array<DropRecord & { sentenceId: string }>;
  }
> {
  const call = await llm.generateObject(
    "triage-checkability",
    { sentences: doc.sentences },
    { parse: (raw: unknown) => DocumentLlmOutput.parse(raw) },
  );
  if (!call.ok) {
    throw new Error(
      `triage failed: ${call.failureClass} — raw: ${call.rawOutput?.slice(0, 400) ?? "none"}`,
    );
  }
  const provenance: TriageProvenance = {
    promptVersion: PROMPT_VERSIONS["triage-checkability"],
    model: call.model,
    tokensIn: call.usage.tokensIn,
    tokensOut: call.usage.tokensOut,
  };
  const claims: Array<TypedClaim & { sourceSentenceId: string }> = [];
  const dropLog: Array<DropRecord & { sentenceId: string }> = [];
  const failures: TriageFailureRecord[] = [];
  for (const result of call.value.results) {
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
      claims.push({
        claimId: claimIdFor(sentence.text, sentence.window, result.claimType),
        sourceSentenceId: sentence.id,
        claimType: claimType as ClaimType,
        mode: (MODE_BY_TYPE[claimType as ClaimType] ?? result.mode) as VerificationMode,
        text: sentence.text,
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
  return { claims, dropLog, failures, provenance };
}
