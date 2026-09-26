// SpeakershipLlm port — the injectable LLM boundary for the `attribute` stage
// (ADR-0019, INGESTION §2.9).
//
// The shared call shape lives in `llm-port.ts` (the neutral module this file
// previously asked for once a third port appeared).

import type { LlmCallResult, LlmPort } from "./llm-port.ts";

export type SpeakershipRole = "speakership-classify";

export type SpeakershipLlm = LlmPort<SpeakershipRole>;

/** Scripted LLM for tests: a fixed answer per sentence id, no network. */
export class MockSpeakershipLlm implements SpeakershipLlm {
  /** Sentences per call, in call order — the fan-out shape, observable. */
  readonly calls: number[] = [];

  constructor(
    private readonly answer: (
      sentences: Array<{ id: string; text: string }>,
      callIndex: number,
    ) => Record<string, string> | { fail: string },
    private readonly modelFor: (callIndex: number) => string = () => "mock-speakership",
  ) {}

  async generateObject<T>(
    role: "speakership-classify",
    input: unknown,
    schema: { parse(value: unknown): T },
  ): Promise<LlmCallResult<T>> {
    if (role !== "speakership-classify") throw new Error(`unexpected role: ${role}`);
    const sentences = (input as { sentences: Array<{ id: string; text: string }> }).sentences;
    const model = this.modelFor(this.calls.length);
    this.calls.push(sentences.length);
    const scripted = this.answer(sentences, this.calls.length - 1);
    if ("fail" in scripted) {
      return {
        ok: false,
        failureClass: "schema-validation",
        rawOutput: "No object generated: could not parse the response.",
        model,
        finishReason: scripted.fail,
      };
    }
    return {
      ok: true,
      value: schema.parse({
        sentences: sentences.map((s) => ({
          sentenceId: s.id,
          class: scripted[s.id] ?? "unresolved",
          speaker: scripted[s.id] === "quoted-actor" ? "Hon Sample Minister" : null,
        })),
      }),
      usage: { tokensIn: 10, tokensOut: 5 },
      model,
    };
  }
}
