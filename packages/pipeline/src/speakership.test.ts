// The `attribute` stage contract (ADR-0019, INGESTION §2.9).
//
// The sentences in the first test are the ones that produced the defect, taken
// from the RNZ politics article the first live lane ingested: the narration
// sentence the pipeline published a verdict about, the quotation beside it that
// it ignored, and the unattributed pull-quote that must never be guessed at.

import type { Genre } from "@cw/store";
import { describe, expect, it } from "vitest";
import {
  attributeSentences,
  attributionChunks,
  eligibleSentences,
  type SpeakershipAttribution,
} from "./speakership.ts";
import { MockSpeakershipLlm } from "./speakership-llm.ts";

const NARRATION =
  "MFAT also played a key role on international policy and diplomacy both at home and in embassies or 'posts' in the Middle East; in Southeast Asia, where more than 90 percent of New Zealand's fuel comes from; and with Pacific partners.";
const SCENE_SETTING =
  "The policy announcement coincides with the opening of the City Rail Link (CRL) on Sunday morning, which is expected to increase peak commuter capacity through the city centre by around 50 percent.";
const QUOTED =
  '"We\'d only been here for about a week ... very, very helpful at the time. It was very lucky timing," Macpherson says.';
const PULL_QUOTE = '"MFAT handles sensitive global diplomacy and rarely grants interviews';

function doc(genre: Genre, texts: string[]) {
  return {
    documentId: "doc-1",
    genre,
    sentences: texts.map((text, i) => ({ id: `s${i}`, text })),
  };
}

describe("speakership attribution (ADR-0019)", () => {
  it("excludes outlet prose and credits the quoted actor in the same document", async () => {
    // The classifier's judgement, scripted: this is what the live model returned
    // once the stage existed.
    const llm = new MockSpeakershipLlm((sentences) =>
      Object.fromEntries(
        sentences.map((s) => {
          if (s.text === NARRATION || s.text === SCENE_SETTING) return [s.id, "outlet-prose"];
          if (s.text === QUOTED) return [s.id, "quoted-actor"];
          return [s.id, "unresolved"];
        }),
      ),
    );
    const input = doc("news-report", [NARRATION, SCENE_SETTING, QUOTED, PULL_QUOTE]);
    const result = await attributeSentences(input, llm);

    expect(result.method).toBe("classified");
    expect(result.genre).toBe("news-report");

    const eligible = eligibleSentences(input, result);
    // Only the quotation. The narration sentence and the scene-setting sentence
    // — the one carrying a number, which triage typed `statistical` and the
    // pipeline published a `supported` verdict about — are out of scope.
    expect(eligible.map((s) => s.text)).toEqual([QUOTED]);
    expect(result.scope).toMatchObject({
      read: 4,
      eligible: 1,
      excluded: 3,
      byClass: { "outlet-prose": 2, "quoted-actor": 1, unresolved: 1, "author-claim": 0 },
    });
  });

  it("names the speaker so the verdict page can say whose claim it assesses", async () => {
    const llm = new MockSpeakershipLlm(() => ({ s0: "quoted-actor" }));
    const result = await attributeSentences(doc("news-report", [QUOTED]), llm);
    expect(result.sentences[0]?.speaker).toBe("Hon Sample Minister");
  });

  it("treats an opinion piece's author as an eligible claimant (ADR-0019 §2)", async () => {
    const llm = new MockSpeakershipLlm(() => ({ s0: "author-claim" }));
    const input = doc("opinion-analysis", ["The Government's housing numbers do not add up."]);
    const result = await attributeSentences(input, llm);
    expect(eligibleSentences(input, result)).toHaveLength(1);
  });

  it("passes the genre to the model, because it selects the rule", async () => {
    const calls: unknown[] = [];
    const llm = {
      async generateObject<T>(
        _role: "speakership-classify",
        input: unknown,
        schema: { parse(value: unknown): T },
      ) {
        calls.push(input);
        return {
          ok: true as const,
          value: schema.parse({
            sentences: [{ sentenceId: "s0", class: "outlet-prose", speaker: null }],
          }),
          usage: { tokensIn: 1, tokensOut: 1 },
          model: "mock-speakership",
        };
      },
    };
    await attributeSentences(doc("opinion-analysis", ["A claim."]), llm);
    expect((calls[0] as { genre: string }).genre).toBe("opinion-analysis");
  });

  it("never promotes a sentence the model did not answer", async () => {
    // Fail closed: a missing answer becomes `unresolved`, which is excluded and
    // counted. The dangerous direction would be treating silence as eligible.
    const llm = new MockSpeakershipLlm(() => ({}));
    const input = doc("news-report", [NARRATION, QUOTED]);
    const result = await attributeSentences(input, llm);

    expect(result.sentences.every((s) => s.speakershipClass === "unresolved")).toBe(true);
    expect(result.scope.eligible).toBe(0);
    expect(eligibleSentences(input, result)).toHaveLength(0);
  });

  it("ignores an id the model invented, which is not a sentence of this document", async () => {
    const llm = new MockSpeakershipLlm(() => ({ s0: "outlet-prose", invented: "quoted-actor" }));
    const result = await attributeSentences(doc("news-report", [NARRATION]), llm);
    expect(result.sentences.map((s) => s.sentenceId)).toEqual(["s0"]);
  });

  it("chunks a long document and keeps every sentence, in document order", async () => {
    const llm = new MockSpeakershipLlm(
      (sentences) => Object.fromEntries(sentences.map((s) => [s.id, "outlet-prose"])),
      () => "mock-speakership",
    );
    const texts = Array.from({ length: 47 }, (_, i) => `Sentence number ${i} of a long document.`);
    const input = doc("news-report", texts);
    const result = await attributeSentences(input, llm);

    expect(llm.calls.length).toBeGreaterThan(1);
    expect(llm.calls.reduce((a, b) => a + b, 0)).toBe(47);
    expect(result.sentences.map((s) => s.sentenceId)).toEqual(input.sentences.map((s) => s.id));
    // Tokens accumulate across the chunks (ADR-0012: cost is computed at
    // aggregation from the price map).
    expect(result.provenance.tokensOut).toBe(5 * llm.calls.length);
    expect(result.provenance.calls).toBe(llm.calls.length);
  });

  it("retries a truncated chunk at half size, and names the truncation when it cannot", async () => {
    // A budget of 10 rejects 20-sentence chunks and accepts their halves.
    const halving = new MockSpeakershipLlm((sentences) =>
      sentences.length > 10
        ? { fail: "length" }
        : Object.fromEntries(sentences.map((s) => [s.id, "outlet-prose"])),
    );
    const texts = Array.from({ length: 47 }, (_, i) => `Sentence ${i} of a long document.`);
    const recovered = await attributeSentences(doc("news-report", texts), halving);
    expect(halving.calls).toContain(20);
    expect(halving.calls).toContain(10);
    expect(recovered.scope.read).toBe(47);

    const hopeless = new MockSpeakershipLlm(() => ({ fail: "length" }));
    await expect(
      attributeSentences(doc("news-report", ["One sentence."]), hopeless),
    ).rejects.toThrow(/finish_reason: length/);
  });

  it("refuses to record one model for chunks served by different models", async () => {
    const llm = new MockSpeakershipLlm(
      (sentences) => Object.fromEntries(sentences.map((s) => [s.id, "outlet-prose"])),
      (i) => (i === 0 ? "anthropic:claude-sonnet-5" : "openrouter:z-ai/glm-5.3-flash"),
    );
    const texts = Array.from({ length: 47 }, (_, i) => `Sentence ${i} of a long document.`);
    await expect(attributeSentences(doc("news-report", texts), llm)).rejects.toThrow(
      /spans 2 models/,
    );
  });
});

describe("chunk bounds", () => {
  it("splits on sentence count and on characters, whichever binds first", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, text: "short." }));
    expect(attributionChunks(many).map((c) => c.length)).toEqual([20, 5]);

    const long = [
      { id: "a", text: "x".repeat(5000) },
      { id: "b", text: "y".repeat(2000) },
      { id: "c", text: "z" },
    ];
    // `b` cannot join `a` without exceeding the character bound.
    expect(attributionChunks(long).map((c) => c.map((s) => s.id))).toEqual([["a"], ["b", "c"]]);
  });

  it("a document inside one chunk is a single call", async () => {
    const llm = new MockSpeakershipLlm(() => ({ s0: "outlet-prose" }));
    const result: SpeakershipAttribution = await attributeSentences(
      doc("news-report", ["One sentence."]),
      llm,
    );
    expect(llm.calls).toEqual([1]);
    expect(result.provenance.calls).toBe(1);
  });
});
