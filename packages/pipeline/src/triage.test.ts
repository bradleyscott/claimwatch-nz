// Triage L1 (TRIAGE.md, ADR-0025). Two independent per-sentence arms: whose
// words the sentence is, and what it is. A sentence is checkable only when both
// pass. The LLM is mocked.

import { describe, expect, it } from "vitest";
import {
  emptyDiscourseContext,
  isCheckable,
  isCheckableContent,
  isEligibleSpeakershipClass,
  splitSentences,
  toStoredDiscourseContext,
  triageDocument,
  triageRecordFor,
} from "./triage.ts";
import { MockTriageLlm } from "./triage-llm.ts";

const doc = (sentences: Array<{ id: string; text: string; window?: string }>) => ({
  documentId: "doc-1",
  genre: "news-report" as const,
  documentText: sentences.map((s) => s.text).join(" "),
  sentences,
});

describe("splitSentences", () => {
  it("splits on sentence punctuation and keeps spans", () => {
    const sentences = splitSentences("One. Two! Three?");
    expect(sentences.map((s) => s.text)).toEqual(["One.", "Two!", "Three?"]);
    expect(sentences[0]?.span).toEqual({ start: 0, end: 4 });
  });

  it("keeps a caption cue whole when asked", () => {
    const sentences = splitSentences("we will build three thousand homes by 2030", {
      cueSpanPreserving: true,
    });
    expect(sentences).toHaveLength(1);
    expect(sentences[0]?.cueSpan).toEqual({ start: 0, end: 42 });
  });
});

describe("the two arms (ADR-0025)", () => {
  it("axis 1 passes only for quoted-actor and author-claim", () => {
    expect(isEligibleSpeakershipClass("quoted-actor")).toBe(true);
    expect(isEligibleSpeakershipClass("author-claim")).toBe(true);
    for (const cls of ["outlet-prose", "unresolved"]) {
      expect(isEligibleSpeakershipClass(cls), cls).toBe(false);
    }
  });

  it("axis 2 passes only for a checkable factual assertion", () => {
    expect(isCheckableContent("checkable")).toBe(true);
    for (const cls of [
      "opinion",
      "rhetoric",
      "procedure",
      "satire",
      "question",
      "off-domain",
      "pledge-conditional",
    ]) {
      expect(isCheckableContent(cls), cls).toBe(false);
    }
  });

  it("checkable requires BOTH arms — a quoted opinion is not checkable", () => {
    expect(isCheckable("quoted-actor", "checkable")).toBe(true);
    expect(isCheckable("author-claim", "checkable")).toBe(true);
    // The overlap the single-class design missed:
    expect(isCheckable("quoted-actor", "opinion")).toBe(false);
    expect(isCheckable("author-claim", "satire")).toBe(false);
    expect(isCheckable("outlet-prose", "checkable")).toBe(false);
    expect(isCheckable("unresolved", "checkable")).toBe(false);
  });
});

describe("triageDocument", () => {
  it("makes a claim only when both arms pass, and drops each failure with its reason", async () => {
    const llm = MockTriageLlm.forDocument(
      [
        {
          text: "Crime is up 30% since 2017.",
          speakershipClass: "quoted-actor",
          speaker: "A Minister",
          contentClass: "checkable",
        },
        {
          text: "It was a lively debate.",
          speakershipClass: "quoted-actor",
          contentClass: "opinion",
        },
        { text: "The reporter noted the setting.", speakershipClass: "outlet-prose" },
        {
          text: "We will build homes.",
          speakershipClass: "quoted-actor",
          contentClass: "pledge-conditional",
        },
      ],
      { supports: "that law and order is failing" },
    );
    const result = await triageDocument(
      doc([
        { id: "s1", text: "Crime is up 30% since 2017.", window: "…debate…" },
        { id: "s2", text: "It was a lively debate." },
        { id: "s3", text: "The reporter noted the setting." },
        { id: "s4", text: "We will build homes." },
      ]),
      llm,
    );

    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0];
    expect(claim?.speakershipClass).toBe("quoted-actor");
    expect(claim?.speaker).toBe("A Minister");
    expect(claim?.discourseContext.supports).toBe("that law and order is failing");
    expect(claim?.discourseContext.window).toBe("…debate…");

    // One drop log, with the arm that failed as the reason.
    expect(result.dropLog.map((d) => d.rejectionClass).sort()).toEqual([
      "opinion",
      "outlet-prose",
      "pledge-conditional",
    ]);
    expect(result.triageRecord.sentencesRead).toBe(4);
    expect(result.triageRecord.checked).toBe(1);
    expect(result.triageRecord.held).toHaveLength(1);
  });

  it("does not ask the content arm about ineligible sentences", async () => {
    const contentCalls: Array<Array<{ id: string; text: string }>> = [];
    const llm = MockTriageLlm.scripted((role, input) => {
      if (role === "triage-context") {
        return { ok: true, value: { venue: null, topic: null, supports: null, qualifiers: [] } };
      }
      const sentences = (input as { sentences: Array<{ id: string; text: string }> }).sentences;
      if (role === "triage-speakership") {
        return {
          ok: true,
          value: {
            sentences: sentences.map((s) =>
              s.text.startsWith("Narration")
                ? { sentenceId: s.id, speakershipClass: "outlet-prose", speaker: null }
                : { sentenceId: s.id, speakershipClass: "quoted-actor", speaker: "A" },
            ),
          },
        };
      }
      contentCalls.push(sentences);
      return {
        ok: true,
        value: {
          sentences: sentences.map((s) => ({ sentenceId: s.id, contentClass: "checkable" })),
        },
      };
    });
    await triageDocument(
      doc([
        { id: "s1", text: "Narration one." },
        { id: "s2", text: "Claim two." },
      ]),
      llm,
    );
    expect(contentCalls).toHaveLength(1);
    expect(contentCalls[0]?.map((s) => s.text)).toEqual(["Claim two."]);
  });

  it("fails closed on an unanswered sentence at either arm", async () => {
    const llm = MockTriageLlm.scripted((role, input) => {
      if (role === "triage-context") {
        return { ok: true, value: { venue: null, topic: null, supports: null, qualifiers: [] } };
      }
      const sentences = (input as { sentences: Array<{ id: string; text: string }> }).sentences;
      if (role === "triage-speakership") {
        // s3 is omitted, so it must fall closed to `unresolved`.
        return {
          ok: true,
          value: {
            sentences: sentences
              .filter((s) => s.text !== "Never answered.")
              .map((s) => ({ sentenceId: s.id, speakershipClass: "quoted-actor", speaker: "A" })),
          },
        };
      }
      // The content arm omits s2, so it must fall closed to `off-domain`.
      return {
        ok: true,
        value: {
          sentences: sentences
            .filter((s) => s.text === "Claim one.")
            .map((s) => ({ sentenceId: s.id, contentClass: "checkable" })),
        },
      };
    });
    const result = await triageDocument(
      doc([
        { id: "s1", text: "Claim one." },
        { id: "s2", text: "Claim two." },
        { id: "s3", text: "Never answered." },
      ]),
      llm,
    );
    expect(result.claims).toHaveLength(1);
    expect(result.dropLog.map((d) => d.rejectionClass).sort()).toEqual([
      "off-domain",
      "unresolved",
    ]);
  });

  it("reads the WHOLE document for context, not a moving window", async () => {
    let contextInput: unknown = null;
    const llm = MockTriageLlm.scripted((role, input) => {
      if (role === "triage-context") {
        contextInput = input;
        return { ok: true, value: { venue: null, topic: null, supports: "x", qualifiers: [] } };
      }
      const sentences = (input as { sentences: Array<{ id: string }> }).sentences;
      return {
        ok: true,
        value: {
          sentences:
            role === "triage-speakership"
              ? sentences.map((s) => ({
                  sentenceId: s.id,
                  speakershipClass: "quoted-actor",
                  speaker: "A",
                }))
              : sentences.map((s) => ({ sentenceId: s.id, contentClass: "checkable" })),
        },
      };
    });
    await triageDocument(
      {
        documentId: "doc-1",
        genre: "news-report",
        documentText: "Opening context. The claim. Closing context.",
        sentences: [{ id: "s1", text: "The claim.", window: "a window" }],
      },
      llm,
    );
    const input = contextInput as { claim: string; document: string };
    expect(input.claim).toBe("The claim.");
    expect(input.document).toContain("Opening context.");
    expect(input.document).toContain("Closing context.");
  });

  it("is idempotent: a re-run resolves to the same claim ids (TRI-R13)", async () => {
    const fixture = [
      { id: "s1", text: "Crime is up 30% since 2017.", window: "…debate…" },
      { id: "s2", text: "The reporter noted the setting." },
    ];
    const script = (role: string, input: unknown) => {
      if (role === "triage-context") {
        return { ok: true, value: { venue: null, topic: null, supports: null, qualifiers: [] } };
      }
      const sentences = (input as { sentences: Array<{ id: string; text: string }> }).sentences;
      return {
        ok: true,
        value: {
          sentences:
            role === "triage-speakership"
              ? sentences.map((s) =>
                  s.text.startsWith("The reporter")
                    ? { sentenceId: s.id, speakershipClass: "outlet-prose", speaker: null }
                    : { sentenceId: s.id, speakershipClass: "quoted-actor", speaker: "A" },
                )
              : sentences.map((s) => ({ sentenceId: s.id, contentClass: "checkable" })),
        },
      };
    };
    const first = await triageDocument(doc(fixture), MockTriageLlm.scripted(script));
    const second = await triageDocument(doc(fixture), MockTriageLlm.scripted(script));
    expect(second.claims.map((c) => c.claimId)).toEqual(first.claims.map((c) => c.claimId));
  });
});

describe("discourse-context mapping (ADR-0026)", () => {
  it("maps the context pass onto the stored shape and carries the window verbatim", () => {
    const stored = toStoredDiscourseContext(
      { venue: "in the House", topic: "housing", supports: "the housing plan", qualifiers: [] },
      "the window text",
    );
    expect(stored).toEqual({
      window: "the window text",
      speechContext: "in the House",
      policyTopic: "housing",
      supports: "the housing plan",
      contextQualifiers: null,
    });
  });

  it("leaves every field null for a claim with no window — absent is data", () => {
    expect(emptyDiscourseContext()).toEqual({
      window: "",
      speechContext: null,
      policyTopic: null,
      supports: null,
      contextQualifiers: null,
    });
  });
});

describe("triageRecordFor", () => {
  it("counts the whole document, so a partial read can never look complete", () => {
    const record = triageRecordFor(
      doc([
        { id: "s1", text: "One." },
        { id: "s2", text: "Two." },
        { id: "s3", text: "Three." },
      ]),
      [],
      [
        {
          sentenceId: "s1",
          sentenceText: "One.",
          rejectionClass: "opinion",
          windowText: "One.",
          provenance: {
            promptVersion: "triage-checkability@1",
            model: "m",
            tokensIn: 1,
            tokensOut: 1,
          },
        },
      ],
    );
    expect(record.sentencesRead).toBe(3);
    expect(record.checked).toBe(0);
    expect(record.setAside).toHaveLength(1);
  });
});

describe("decision-backed triage (ADR-0024)", () => {
  const choice = (value: string, confidence: number) => ({
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: confidence },
    confidence,
  });
  const ok = (answers: Record<string, ReturnType<typeof choice>>) => ({
    ok: true as const,
    answers,
    usage: { tokensIn: 120, tokensOut: 0 },
    model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
  });

  const sentences = [
    {
      text: "We will cut crime by half.",
      speakershipClass: "quoted-actor",
      contentClass: "checkable",
      speaker: "A. Person",
    },
    {
      text: "Crime fell two percent last year.",
      speakershipClass: "author-claim",
      contentClass: "checkable",
    },
    { text: "Here is the story.", speakershipClass: "outlet-prose" },
  ];

  it("settles the classes and escalates only for the attribution name", async () => {
    const input = doc(sentences.map((s, i) => ({ id: `s${i + 1}`, text: s.text })));
    const llm = MockTriageLlm.forDocument(sentences, { supports: "cut crime" });
    const requests: string[] = [];
    const decisions = {
      decide: async (request: { role: string }) => {
        requests.push(request.role);
        if (request.role === "triage-speakership") {
          return ok({
            s1: choice("quoted-actor", 0.99),
            s2: choice("author-claim", 0.95),
            s3: choice("outlet-prose", 0.9),
          });
        }
        return ok({ s1: choice("checkable", 0.95), s2: choice("checkable", 0.97) });
      },
    };
    const result = await triageDocument(input, llm, {
      decisions,
      decisionRoles: ["triage-speakership", "triage-checkability"],
    });

    expect(requests).toEqual(["triage-speakership", "triage-checkability"]);
    expect(result.claims.map((c) => c.sourceSentenceId)).toEqual(["s1", "s2"]);
    // s1 was settled as quoted-actor, so it escalated for the NAME only.
    expect(result.claims[0]?.speaker).toBe("A. Person");
    expect(result.claims[1]?.speaker).toBeNull();
    expect(result.dropLog.map((d) => d.sentenceId)).toEqual(["s3"]);
    expect(result.provenance.decision).toMatchObject({
      role: "triage-speakership",
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      settled: 2,
      escalated: 1,
      degraded: false,
    });
  });

  it("stays entirely generative when no role is gated", async () => {
    const input = doc(sentences.map((s, i) => ({ id: `s${i + 1}`, text: s.text })));
    const llm = MockTriageLlm.forDocument(sentences, { supports: "cut crime" });
    let calls = 0;
    const decisions = {
      decide: async () => {
        calls += 1;
        return ok({});
      },
    };
    const result = await triageDocument(input, llm, { decisions, decisionRoles: [] });
    expect(calls).toBe(0);
    expect(result.provenance.decision).toBeUndefined();
    expect(result.claims.map((c) => c.sourceSentenceId)).toEqual(["s1", "s2"]);
  });

  it("degrades to the generative path when the decision call fails", async () => {
    const input = doc(sentences.map((s, i) => ({ id: `s${i + 1}`, text: s.text })));
    const llm = MockTriageLlm.forDocument(sentences, { supports: "cut crime" });
    const decisions = {
      decide: async () => ({
        ok: false as const,
        failureClass: "transport" as const,
        rawOutput: "HTTP 503",
      }),
    };
    const result = await triageDocument(input, llm, {
      decisions,
      decisionRoles: ["triage-speakership", "triage-checkability"],
    });
    // The generative mock answered everything, so the claims are unchanged.
    expect(result.claims.map((c) => c.sourceSentenceId)).toEqual(["s1", "s2"]);
    expect(result.provenance.decision?.degraded).toBe(true);
    expect(result.provenance.decision?.settled).toBe(0);
    expect(result.provenance.decision?.escalated).toBe(3);
  });
});
