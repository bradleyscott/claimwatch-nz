// TRIAGE L1 contract (TRIAGE.md §2, risks TRI-R1..R13). The LLM stages run
// through the injectable TriageLlm port — L1 mocks the LLM entirely, so these
// tests pin the CONTRACT, not model behaviour. Authored before implementation
// (TDD red). Test-requirement changes need approval; structural changes don't.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

import {
  canonicalFingerprintKey,
  checkabilityFromLlm,
  contextFromLlm,
  fingerprintFromLlm,
  splitSentences,
  triageDocument,
  typeClaimFromLlm,
} from "./triage.ts";
import type {
  CanonicalFingerprintKey,
  CheckabilityDecision,
  DiscourseContext,
  Sentence,
  TriageResult,
  TypedClaim,
} from "./triage-api.ts";
import { type LlmCallResult, MockTriageLlm, type TriageLlm } from "./triage-llm.ts";

// ---------- sentence splitting ----------

describe("sentence splitting (deterministic)", () => {
  it("splits multi-clause prose on sentence boundaries, preserving punctuation", () => {
    const doc = "The Minister spoke today. She said growth was strong. Then she left.";
    const sentences = splitSentences(doc) as Sentence[];
    expect(sentences).toHaveLength(3);
    expect(sentences[0]?.text).toContain("today.");
  });

  it("keeps caption cues intact — ASR cues have no punctuation and are never split mid-cue (TRIAG open Q7)", () => {
    const cue = "FINANCE MINISTER Unemployment is at a record low of three point two percent";
    const sentences = splitSentences(cue, { cueSpanPreserving: true }) as Sentence[];
    expect(sentences).toHaveLength(1);
    expect(sentences[0]?.cueSpan).toEqual({ start: 0, end: cue.length });
  });

  it("records a sentence span for every split so claims stay anchorable", () => {
    const sentences = splitSentences("First sentence. Second one follows.") as Sentence[];
    expect(sentences[0]?.span).toEqual({ start: 0, end: "First sentence.".length });
    expect(sentences[1]?.span.start).toBeGreaterThan(0);
  });
});

// ---------- checkability (LLM stage, mocked port) ----------

describe("checkability (TRI-R1)", () => {
  const corpus = JSON.parse(readFixture("triage-checkability.json")) as {
    sentences: Array<{
      id: string;
      text: string;
      expected: string;
      rejectionClass?: string;
      window: string;
    }>;
  };

  it.each(corpus.sentences.map((s) => [s.id, s]))("classifies %s", async (_id, s) => {
    const llm = MockTriageLlm.forCheckability(s.text, s.expected, s.rejectionClass);
    const result = (await checkabilityFromLlm(llm, {
      sentence: s.text,
      window: s.window,
    })) as CheckabilityDecision;
    if (s.expected === "checkable") {
      expect(result.decision).toBe("checkable");
      expect(result.dropRecord).toBeUndefined();
    } else {
      expect(result.decision).toBe(s.expected);
      expect(result.dropRecord).toMatchObject({
        sentenceText: s.text,
        rejectionClass: s.rejectionClass,
        windowText: s.window,
      });
      expect(result.dropRecord?.provenance.promptVersion).toBeTruthy();
    }
  });

  it("never lets a malformed LLM output silently drop a sentence (TRI-R12)", async () => {
    const llm = MockTriageLlm.malformed();
    const result = (await checkabilityFromLlm(llm, {
      sentence: "Crime is up 30 percent.",
      window: "w",
    })) as CheckabilityDecision;
    expect(result.decision).toBe("schema-failure");
    expect(result.failureRecord?.failureClass).toBe("schema-validation");
    expect(result.failureRecord?.rawOutput).toBeTruthy();
  });
});

// ---------- typing + routing (TRI-R3) ----------

describe("claim typing and mode routing (TRI-R3)", () => {
  const set = JSON.parse(readFixture("triage-typing.json")) as {
    items: Array<{
      id: string;
      text: string;
      claimType: string;
      routesTo?: string;
      expectedType?: string;
      retainFingerprintAttempt?: boolean;
      isCuratedFixture?: boolean;
    }>;
  };

  it.each(set.items.filter((i) => i.expectedType === undefined))("routes $id", async (item) => {
    const llm = MockTriageLlm.forTyping(item.text, item.claimType);
    const claim = (await typeClaimFromLlm(llm, { sentence: item.text })) as TypedClaim;
    expect(claim.claimType).toBe(item.claimType);
    expect(claim.mode).toBe(item.routesTo);
  });

  it("degrades a statistical signal with an unusable fingerprint to 'other', retaining the attempt (TRI-R3)", async () => {
    const degrade = set.items.find((i) => i.expectedType === "other");
    const llm = MockTriageLlm.forTypingWithBrokenFingerprint(degrade?.text ?? "");
    const claim = (await typeClaimFromLlm(llm, { sentence: degrade?.text ?? "" })) as TypedClaim;
    expect(claim.claimType).toBe("other");
    expect(claim.mode).toBe("open-web");
    expect(claim.fingerprintAttempt).toBeTruthy();
  });

  it("routes the false-context fixture type with is_curated_fixture gate", async () => {
    const item = set.items.find((i) => i.isCuratedFixture);
    const llm = MockTriageLlm.forTyping(item?.text ?? "", "false-context");
    const claim = (await typeClaimFromLlm(llm, {
      sentence: item?.text ?? "",
      isCuratedFixture: true,
    })) as TypedClaim;
    expect(claim.claimType).toBe("false-context");
    expect(claim.mode).toBe("provenance");
  });
});

// ---------- fingerprint normalisation (TRI-R2/R4) ----------

describe("fingerprint normalisation (TRI-R2)", () => {
  const fixture = JSON.parse(readFixture("triage-fingerprint.json")) as {
    mergePair: {
      a: Record<string, string | null>;
      b: Record<string, string | null>;
      expectSameKey: boolean;
    };
    noMergePair: {
      a: Record<string, string | null>;
      b: Record<string, string | (null & { reviewFlag?: string })>;
      expectSameKey: boolean;
    };
    adjacentWindowPair: {
      a: Record<string, unknown>;
      b: Record<string, unknown>;
      expectSameKey: boolean;
      expectOccurrences: number;
    };
    normalisationVariants: Array<{ id: string; a: string; b: string; normaliseEqual: boolean }>;
    normalisationConfigVersion: string;
  };

  it("same normalised tuple → same canonical key (merge)", () => {
    const ka = canonicalFingerprintKey(fixture.mergePair.a) as CanonicalFingerprintKey;
    const kb = canonicalFingerprintKey(fixture.mergePair.b) as CanonicalFingerprintKey;
    expect(ka.key).toBe(kb.key);
  });

  it("different claimant/window → different key, no merge", () => {
    const ka = canonicalFingerprintKey(fixture.noMergePair.a) as CanonicalFingerprintKey;
    const kb = canonicalFingerprintKey(fixture.noMergePair.b) as CanonicalFingerprintKey;
    expect(ka.key).not.toBe(kb.key);
  });

  it.each(fixture.normalisationVariants)(
    "normalisation variant $id is versioned and deterministic",
    (v) => {
      const ka = canonicalFingerprintKey({ core: v.a }) as CanonicalFingerprintKey;
      const kb = canonicalFingerprintKey({ core: v.b }) as CanonicalFingerprintKey;
      if (v.normaliseEqual) {
        expect(ka.key).toBe(kb.key);
      } else {
        expect(ka.key).not.toBe(kb.key);
      }
    },
  );

  it("records the normalisation config version with every key (re-runs must be reproducible)", () => {
    const key = canonicalFingerprintKey({
      core: "Crime is up 30% since 2017.",
    }) as CanonicalFingerprintKey;
    expect(key).toMatchObject({
      key: expect.any(String),
      normalisationVersion: fixture.normalisationConfigVersion,
    });
  });
});

// ---------- discourse context (TRI-R5/R6, ADR-0008) ----------

describe("discourse-context extraction (ADR-0008)", () => {
  const fixture = JSON.parse(readFixture("triage-context.json")) as {
    variants: Array<{ id: string; window: string; expected: Record<string, unknown> }>;
  };

  it.each(fixture.variants)(
    "$id keeps absent fields null, never defaulted (TRI-R5/R6)",
    async (v) => {
      const llm = MockTriageLlm.forContext(v.window, v.expected);
      const context = (await contextFromLlm(llm, { window: v.window })) as DiscourseContext;
      const exp = v.expected as Record<string, unknown>;

      if (exp.attachedProposal === "present") {
        expect(context.attachedProposal).toBeTruthy();
      } else if (exp.attachedProposal === null) {
        expect(context.attachedProposal).toBeNull();
      }
      if (exp.speaker === "absent") {
        expect(context.speaker).toBeNull();
      } else if (exp.speaker === "present") {
        expect(context.speaker).toBeTruthy();
      }
      if (exp.topic === "absent") {
        expect(context.topic).toBeNull();
      } else if (typeof exp.topic === "string") {
        expect(context.topic).toBe(exp.topic);
      }
      if (exp.stillRoutes) {
        expect(() => context).not.toThrow();
      }
    },
  );

  it("identity-only windows never infer an attached proposal (TRI-R6 — the no-inference guardrail)", async () => {
    const identityOnly = fixture.variants.find((v) => v.id === "ctx-identity-only");
    const llm = MockTriageLlm.forContext(identityOnly?.window ?? "", { attachedProposal: null });
    const context = (await contextFromLlm(llm, {
      window: identityOnly?.window ?? "",
    })) as DiscourseContext;
    expect(context.attachedProposal).toBeNull();
  });
});

// ---------- idempotency (TRI-R13) ----------

describe("re-triage idempotency (TRI-R13)", () => {
  it("re-triaging the same document yields the identical claim set and drop log", async () => {
    const corpus = JSON.parse(readFixture("triage-checkability.json")) as {
      sentences: Array<{
        id: string;
        text: string;
        expected: string;
        rejectionClass?: string;
        window: string;
      }>;
    };
    const doc = {
      documentId: "doc-1",
      sentences: corpus.sentences.map((s) => ({ id: s.id, text: s.text, window: s.window })),
    };
    const llm = MockTriageLlm.forDocument(corpus.sentences);

    const first = (await triageDocument(doc, llm)) as TriageResult;
    const second = (await triageDocument(doc, llm)) as TriageResult;

    expect(second.claims.map((c) => c.claimId)).toEqual(first.claims.map((c) => c.claimId));
    expect(second.claims).toHaveLength(first.claims.length);
    expect(second.dropLog.map((d) => d.sentenceId)).toEqual(first.dropLog.map((d) => d.sentenceId));
    expect(second.dropLog).toHaveLength(first.dropLog.length);
  });

  it("claim IDs are stable across runs — derived from content, not sequence", async () => {
    const corpus = JSON.parse(readFixture("triage-checkability.json")) as {
      sentences: Array<{
        id: string;
        text: string;
        expected: string;
        rejectionClass?: string;
        window: string;
      }>;
    };
    const doc = {
      documentId: "doc-1",
      sentences: corpus.sentences
        .filter((s) => s.expected === "checkable")
        .map((s) => ({ id: s.id, text: s.text, window: s.window })),
    };
    const llm = MockTriageLlm.forDocument(corpus.sentences);
    const a = (await triageDocument(doc, llm)) as TriageResult;
    const reversed = (await triageDocument(
      { ...doc, sentences: [...doc.sentences].reverse() },
      llm,
    )) as TriageResult;
    const idsBySentence = new Map(reversed.claims.map((c) => [c.sourceSentenceId, c.claimId]));
    for (const claim of a.claims) {
      expect(idsBySentence.get(claim.sourceSentenceId)).toBe(claim.claimId);
    }
  });
});

// The checkability call returns one result per sentence, so the response grows
// with the document while the adapter's output budget is fixed. A real
// 47-sentence RNZ article truncated at the 2048-token default and surfaced as
// `schema-validation — the model did not return a response` (Sept 2026); every
// fixture then in L1 was 3-5 sentences, so nothing reached the bound. These pin
// the bound and its failure mode (TRI-R12).
class BudgetedCheckabilityLlm implements TriageLlm {
  /** Sentences per call, in call order — the fan-out shape, observable. */
  readonly calls: number[] = [];

  constructor(
    private readonly failsAbove: number,
    private readonly modelFor: (callIndex: number) => string = () => "mock-model-a",
  ) {}

  async generateObject<T>(
    role: "triage-checkability" | "triage-typing" | "triage-fingerprint" | "triage-context",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>> {
    if (role !== "triage-checkability") throw new Error(`unexpected role: ${role}`);
    const sentences = (input as { sentences: Array<{ id: string; text: string }> }).sentences;
    const model = this.modelFor(this.calls.length);
    this.calls.push(sentences.length);
    if (sentences.length > this.failsAbove) {
      // What an output-budget truncation looks like at this port.
      return {
        ok: false,
        failureClass: "schema-validation",
        rawOutput: "No object generated: the model did not return a response.",
        model,
        finishReason: "length",
      };
    }
    return {
      ok: true,
      value: schema.parse({
        results: sentences.map((s) => ({
          sentenceId: s.id,
          checkable: false,
          rejectionClass: "opinion",
        })),
      }),
      usage: { tokensIn: 10, tokensOut: 5 },
      model,
    };
  }
}

describe("checkability fan-out bounds (TRI-R12)", () => {
  const doc = (n: number) => ({
    documentId: "long-doc",
    sentences: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      text: `Sentence number ${i} of a long document that must not be lost.`,
      window: "window text",
    })),
  });

  it("classifies every sentence of a document too long for one call", async () => {
    const llm = new BudgetedCheckabilityLlm(Number.POSITIVE_INFINITY);
    const result = await triageDocument(doc(47), llm);

    // Chunked, not one unbounded call — and no sentence is dropped in the split.
    expect(llm.calls.length).toBeGreaterThan(1);
    expect(llm.calls.reduce((a, b) => a + b, 0)).toBe(47);
    expect(result.triageRecord.sentencesRead).toBe(47);
    expect(result.dropLog).toHaveLength(47);
    // Document order, not chunk-completion order: the page renders this list in
    // array order and tells the reader to judge the boundary themselves.
    expect(result.dropLog.map((d) => d.sentenceId)).toEqual(doc(47).sentences.map((s) => s.id));
    // Provenance accumulates across chunks (ADR-0012: tokens, not money).
    expect(result.provenance.tokensOut).toBe(5 * llm.calls.length);
    expect(result.provenance.tokensIn).toBe(10 * llm.calls.length);
  });

  it("a document inside one chunk makes exactly one call with the unchanged payload", async () => {
    const llm = new BudgetedCheckabilityLlm(Number.POSITIVE_INFINITY);
    await triageDocument(doc(5), llm);
    // This is what keeps every pre-existing fixture and L2 golden unchanged.
    expect(llm.calls).toEqual([5]);
  });

  it("retries a truncated chunk at half size instead of failing the document", async () => {
    // A budget of 10 rejects the 20-sentence chunks and accepts their halves.
    const llm = new BudgetedCheckabilityLlm(10);
    const result = await triageDocument(doc(47), llm);

    expect(llm.calls).toContain(20);
    expect(llm.calls).toContain(10);
    expect(result.triageRecord.sentencesRead).toBe(47);
    expect(result.dropLog).toHaveLength(47);
  });

  it("names the truncation when a chunk cannot be split further", async () => {
    // Budget of 0: even a single-sentence chunk fails, so the halving stops.
    const llm = new BudgetedCheckabilityLlm(0);
    await expect(triageDocument(doc(3), llm)).rejects.toThrow(/finish_reason: length/);
  });

  it("refuses to record one model for chunks served by different models", async () => {
    // ADR-0011 escalation can split a document across tiers. Storing the first
    // chunk's model would name a model that produced only part of the triage.
    const llm = new BudgetedCheckabilityLlm(Number.POSITIVE_INFINITY, (i) =>
      i === 0 ? "anthropic:claude-sonnet-5" : "openrouter:z-ai/glm-5.3-flash",
    );
    await expect(triageDocument(doc(47), llm)).rejects.toThrow(/spans 2 models/);
  });
});

// ---------- the orchestrator's role set (Sept 2026) ----------
//
// `contextFromLlm` had TRI-R5/TRI-R6 tests and no caller for weeks, so
// `discourse_context.attached_proposal` was null on every real claim and the
// verdict page's "as deployed" section could not render. Each stage was covered
// in isolation and nothing asserted that the orchestrator ran them, which is a
// failure mode L1 cannot see by construction. These tests assert the CALL SET,
// so a stage that stops being invoked fails here rather than silently not
// existing in production.

/** Wraps a TriageLlm and records every role the orchestrator asks for. */
function recordingRoles(inner: TriageLlm, roles: string[]): TriageLlm {
  return {
    generateObject: async (role, input, schema) => {
      roles.push(role);
      return inner.generateObject(role, input, schema);
    },
  } as TriageLlm;
}

describe("the orchestrator runs the stages the spec says it runs", () => {
  const corpus = JSON.parse(readFixture("triage-checkability.json")) as {
    sentences: Array<{
      id: string;
      text: string;
      expected: string;
      rejectionClass?: string;
      window: string;
    }>;
  };

  it("runs the discourse-context pass, once per checkable claim", async () => {
    const sentences = corpus.sentences.map((s) => ({
      id: s.id,
      text: s.text,
      window: s.window,
    }));
    const roles: string[] = [];
    const llm = recordingRoles(MockTriageLlm.forDocument(corpus.sentences), roles);
    const result = await triageDocument({ documentId: "doc-1", sentences }, llm);
    const checkable = corpus.sentences.filter((s) => s.expected === "checkable").length;

    expect(checkable).toBeGreaterThan(0);
    expect(roles.filter((role) => role === "triage-context")).toHaveLength(checkable);
    // And the context it read reaches the claim, carrying the window verbatim as
    // the artefact it was read from (TRIAGE §3.2) — not the sentence text.
    for (const claim of result.claims) {
      const source = sentences.find((s) => s.id === claim.sourceSentenceId);
      expect(claim.discourseContext.window).toBe(source?.window);
    }
  });

  it("carries the deployment framing through to the claim", async () => {
    // The value the verdict page's "as deployed" line renders (SITE-MVP §2.2).
    const sentences = corpus.sentences.map((s) => ({
      id: s.id,
      text: s.text,
      window: s.window,
    }));
    const llm = MockTriageLlm.forDocument(corpus.sentences, {
      attachedProposal: "the announced housing package",
      argumentDirection: "problem",
      speaker: "Minister",
      topic: "housing",
    });
    const result = await triageDocument({ documentId: "doc-1", sentences }, llm);
    const [claim] = result.claims;
    expect(claim?.discourseContext.attachedProposal).toBe("the announced housing package");
    // Field names are the STORED ones — the two contracts differ, and nothing but
    // this boundary maps between them.
    expect(claim?.discourseContext.argumentDirection).toBe("problem");
    // The stored field is the VENUE, and the mock supplies no venue: the speaker
    // the context pass reads is attribution, which the `attribute` stage owns.
    // Writing it here is what printed "Mark Mitchell, Mark Mitchell" on the page.
    expect(claim?.discourseContext.speechContext).toBeNull();
    expect(claim?.discourseContext.policyTopic).toBe("housing");
  });

  it("does not read context from a sentence with no window, and claims no framing", async () => {
    // ADR-0008: framing comes from window text or not at all. Reading it off the
    // claim itself would manufacture a deployment context out of nothing.
    const sentences = corpus.sentences.map((s) => ({ id: s.id, text: s.text }));
    const roles: string[] = [];
    const llm = recordingRoles(MockTriageLlm.forDocument(corpus.sentences), roles);
    const result = await triageDocument({ documentId: "doc-1", sentences }, llm);
    expect(roles).not.toContain("triage-context");
    for (const claim of result.claims) {
      expect(claim.discourseContext).toEqual({
        window: "",
        speechContext: null,
        policyTopic: null,
        attachedProposal: null,
        argumentDirection: null,
        contextQualifiers: null,
      });
    }
  });

  it("calls checkability and context, and not typing, for non-statistical claims", async () => {
    // The role set, asserted rather than assumed. `triage-typing` is NOT called:
    // the checkability call returns `claimType` and `mode` per sentence, so
    // typing is folded into it. `triage-fingerprint` is not called here either,
    // because this fixture's sentences are all typed `other` — it runs for
    // statistical claims only, proven in the fingerprint describe block below.
    // Pinned so that wiring typing (TRIAGE open question 2) is a deliberate
    // change rather than an accident.
    const sentences = corpus.sentences.map((s) => ({
      id: s.id,
      text: s.text,
      window: s.window,
    }));
    const roles: string[] = [];
    const llm = recordingRoles(MockTriageLlm.forDocument(corpus.sentences), roles);
    await triageDocument({ documentId: "doc-1", sentences }, llm);
    expect([...new Set(roles)].sort()).toEqual(["triage-checkability", "triage-context"]);
  });
});

// ---------- the fingerprint stage (TRIAGE §2.1, TRI-R3) ----------
//
// `fingerprintFromLlm` had no caller: it was imported by this file and never
// invoked, so `claim.fingerprint` is null on every row in the store and TRI-R3's
// degrade path had never run. These tests exercise the stage through the
// orchestrator, which is where it was missing.

describe("the fingerprint stage runs for statistical claims (TRI-R3)", () => {
  /** A document whose one sentence is a statistical claim, plus a scripted parse. */
  const statDoc = {
    documentId: "doc-stat",
    sentences: [
      {
        id: "s1",
        text: "Crime is up 30% since 2017.",
        window: "Law and order: the Minister said crime is up 30% since 2017, and promised action.",
      },
    ],
  };

  function llmWithFingerprint(
    fingerprint:
      | {
          core: string;
          claimant: string | null;
          domain: string | null;
          temporal: string | null;
          quantity: string | null;
          source: string | null;
        }
      | "fail",
  ): TriageLlm {
    return MockTriageLlm.scripted((role, _input) => {
      switch (role) {
        case "triage-checkability":
          return {
            ok: true,
            value: {
              results: [
                { sentenceId: "s1", checkable: true, claimType: "statistical", mode: "stat-grid" },
              ],
            },
          };
        case "triage-context":
          return {
            ok: true,
            value: {
              speaker: "Minister",
              topic: "crime",
              proposal: null,
              attachedProposal: "tougher sentencing",
              qualifiers: [],
              argumentDirection: "problem",
            },
          };
        case "triage-fingerprint":
          return fingerprint === "fail"
            ? { ok: false, raw: "no parse", failureClass: "schema-validation" }
            : {
                ok: true,
                value: { claimType: "statistical", mode: "stat-grid", sentence: "", fingerprint },
              };
        default:
          return { ok: false, raw: `unexpected role ${role}`, failureClass: "schema-validation" };
      }
    });
  }

  const tuple = {
    core: "crime up 30% since 2017",
    claimant: "Minister",
    domain: "crime-statistics",
    temporal: "2017-2026",
    quantity: "30%",
    source: "police",
  };

  it("attaches the parse and its canonical key to a statistical claim", async () => {
    const result = await triageDocument(statDoc, llmWithFingerprint(tuple));
    const [claim] = result.claims;
    expect(claim?.claimType).toBe("statistical");
    expect(claim?.mode).toBe("stat-grid");
    expect(claim?.fingerprint).toEqual(tuple);
    // The key is the normalised one, not the raw tuple: it is what dedup and
    // near-fingerprint review compare on (TRI-R2/R4).
    expect(claim?.fingerprintKey).toBe(canonicalFingerprintKey(tuple).key);
    expect(result.failures).toHaveLength(0);
  });

  it("degrades to `other` when the parse cannot be extracted, and records why", async () => {
    // TRI-R3: never silently generic. A statistical claim whose number cannot be
    // parsed cannot be checked against a series, so it routes to the open-web
    // loop — and the degrade is visible in the funnel rather than appearing as a
    // claim type that quietly changed.
    const result = await triageDocument(statDoc, llmWithFingerprint("fail"));
    const [claim] = result.claims;
    expect(claim?.claimType).toBe("other");
    expect(claim?.mode).toBe("open-web");
    expect(claim?.fingerprint).toBeNull();
    expect(claim?.fingerprintKey).toBeNull();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.sentenceId).toBe("s1");
    // The claim still becomes a claim: a failed parse is not a dropped sentence.
    expect(result.triageRecord.checked).toBe(1);
  });

  it("does not ask for a parse of a non-statistical claim", async () => {
    // Quotation claims have no number to parse; asking would be a wasted call
    // and would put a fingerprint on a claim no series can be matched to.
    const roles: string[] = [];
    const llm = MockTriageLlm.scripted((role) => {
      roles.push(role);
      if (role === "triage-checkability") {
        return {
          ok: true,
          value: {
            results: [
              {
                sentenceId: "s1",
                checkable: true,
                claimType: "broadcast-quote",
                mode: "quote-fidelity",
              },
            ],
          },
        };
      }
      if (role === "triage-context") {
        return {
          ok: true,
          value: {
            speaker: null,
            topic: null,
            proposal: null,
            attachedProposal: null,
            qualifiers: [],
            argumentDirection: null,
          },
        };
      }
      return { ok: false, raw: `unexpected ${role}`, failureClass: "schema-validation" };
    });
    const result = await triageDocument(statDoc, llm);
    expect(roles).not.toContain("triage-fingerprint");
    expect(result.claims[0]?.fingerprint).toBeNull();
    expect(result.claims[0]?.claimType).toBe("broadcast-quote");
  });
});
