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
import { MockTriageLlm } from "./triage-llm.ts";

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
