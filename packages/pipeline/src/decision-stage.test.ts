// Decision stage L1 (ADR-0024). The decision model is a fake port: the tests
// pin the CONTRACT — what settles, what escalates, what a decision outage does —
// not the model's behaviour. No network, no key (CRO-R6).

import { describe, expect, it } from "vitest";
import type {
  ChoiceAnswer,
  DecisionAnswer,
  DecisionCallResult,
  DecisionPort,
  DecisionQuestion,
  DecisionRequest,
} from "./decision-port.ts";
import { confidenceOf, DECISION_THRESHOLD, runDecisionStage } from "./decision-stage.ts";

const choice = (value: string, confidence: number) =>
  ({ type: "choice", choice: value, probabilities: { [value]: confidence }, confidence }) as const;

const noul = (value: number) => ({ type: "noul", noul: value }) as const;

const question: DecisionQuestion = {
  type: "choice",
  instructions: "which class?",
  criteria: { a: "class a", b: "class b" },
};

function recordingPort(answerFor: (request: DecisionRequest) => DecisionCallResult): {
  port: DecisionPort;
  requests: DecisionRequest[];
} {
  const requests: DecisionRequest[] = [];
  return {
    port: {
      decide: async (request) => {
        requests.push(request);
        return answerFor(request);
      },
    },
    requests,
  };
}

const ok = (answers: Record<string, ReturnType<typeof choice>>): DecisionCallResult => ({
  ok: true,
  answers,
  usage: { tokensIn: 100, tokensOut: 0 },
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
});

describe("runDecisionStage", () => {
  const items = [{ id: "s1" }, { id: "s2" }];
  const base = {
    role: "triage-speakership" as const,
    items,
    stateFor: (i: typeof items) => ({ items: i }),
    questionFor: (i: { id: string }) => ({ [i.id]: question }),
    settle: (i: { id: string }, answers: Record<string, DecisionAnswer>) => ({
      id: i.id,
      cls: (answers[i.id] as ChoiceAnswer | undefined)?.choice ?? "",
    }),
  };

  it("takes confident answers without calling the generative model", async () => {
    const { port } = recordingPort(() => ok({ s1: choice("a", 0.95), s2: choice("b", 0.91) }));
    let escalations = 0;
    const result = await runDecisionStage({
      ...base,
      port,
      escalate: async () => {
        escalations += 1;
        return new Map();
      },
    });
    expect(result.settled).toBe(2);
    expect(result.escalated).toBe(0);
    expect(result.degraded).toBe(false);
    expect(escalations).toBe(0);
    expect(result.model).toBe("typesafe/jev-1.13-20260917");
    expect(result.byId.get("s1")).toEqual({ id: "s1", cls: "a" });
  });

  it("escalates the marginal items in ONE batched call", async () => {
    const { port } = recordingPort(() => ok({ s1: choice("a", 0.95), s2: choice("b", 0.4) }));
    const batches: string[][] = [];
    const result = await runDecisionStage({
      ...base,
      port,
      escalate: async (marginal) => {
        batches.push(marginal.map((i) => i.id));
        return new Map(marginal.map((i) => [i.id, { id: i.id, cls: "generative" }]));
      },
    });
    expect(batches).toEqual([["s2"]]);
    expect(result.settled).toBe(1);
    expect(result.escalated).toBe(1);
    expect(result.byId.get("s2")).toEqual({ id: "s2", cls: "generative" });
  });

  it("escalates when needsEscalation says so, even at full confidence", async () => {
    // A settled `quoted-actor` still needs the attribution NAME, which no
    // decision primitive produces.
    const { port } = recordingPort(() => ok({ s1: choice("quoted-actor", 0.99) }));
    const result = await runDecisionStage({
      ...base,
      items: [{ id: "s1" }],
      port,
      needsEscalation: (_i, answers) =>
        (answers.s1 as ChoiceAnswer | undefined)?.choice === "quoted-actor",
      escalate: async (marginal) =>
        new Map(marginal.map((i) => [i.id, { id: i.id, cls: "generative", speaker: "A. Person" }])),
    });
    expect(result.settled).toBe(0);
    expect(result.escalated).toBe(1);
    expect(result.byId.get("s1")).toEqual({ id: "s1", cls: "generative", speaker: "A. Person" });
  });

  it("escalates an item whose answer is missing", async () => {
    const { port } = recordingPort(() => ok({ s1: choice("a", 0.99) }));
    const result = await runDecisionStage({
      ...base,
      port,
      escalate: async (marginal) =>
        new Map(marginal.map((i) => [i.id, { id: i.id, cls: "generative" }])),
    });
    expect(result.settled).toBe(1);
    expect(result.escalated).toBe(1);
    expect(result.byId.get("s2")).toEqual({ id: "s2", cls: "generative" });
  });

  it("uses the MINIMUM confidence when an item carries several questions", async () => {
    const { port } = recordingPort(() => ok({ sufficient: choice("yes", 0.95) }));
    const result = await runDecisionStage({
      role: "triage-checkability",
      items: [{ id: "c1" }],
      port,
      stateFor: () => ({}),
      questionFor: () => ({
        sufficient: question,
        verdictClass: question,
      }),
      settle: () => ({ id: "c1", cls: "settled" }),
      escalate: async (marginal) =>
        new Map(marginal.map((i) => [i.id, { id: i.id, cls: "generative" }])),
    });
    // `verdictClass` is absent, so the item cannot be settled.
    expect(result.settled).toBe(0);
    expect(result.escalated).toBe(1);
  });

  it("degrades to the generative path when the decision call fails", async () => {
    const { port } = recordingPort(() => ({
      ok: false,
      failureClass: "transport",
      rawOutput: "HTTP 503",
    }));
    const batches: string[][] = [];
    const result = await runDecisionStage({
      ...base,
      port,
      escalate: async (all) => {
        batches.push(all.map((i) => i.id));
        return new Map(all.map((i) => [i.id, { id: i.id, cls: "generative" }]));
      },
    });
    expect(result.degraded).toBe(true);
    expect(result.settled).toBe(0);
    expect(result.escalated).toBe(2);
    expect(batches).toEqual([["s1", "s2"]]);
    expect(result.byId.get("s1")).toEqual({ id: "s1", cls: "generative" });
  });

  it("makes no call for an empty set", async () => {
    const { port, requests } = recordingPort(() => ok({}));
    const result = await runDecisionStage({
      ...base,
      items: [],
      port,
      escalate: async () => new Map(),
    });
    expect(requests).toHaveLength(0);
    expect(result.settled).toBe(0);
    expect(result.escalated).toBe(0);
  });

  it("passes the threshold through and honours the default", async () => {
    const { port } = recordingPort(() => ok({ s1: choice("a", 0.65) }));
    const escalate = async (marginal: Array<{ id: string }>) =>
      new Map(marginal.map((i) => [i.id, { id: i.id, cls: "generative" }]));
    const atDefault = await runDecisionStage({ ...base, items: [{ id: "s1" }], port, escalate });
    // 0.65 is below the measured threshold, so it escalates.
    expect(DECISION_THRESHOLD).toBe(0.7);
    expect(atDefault.escalated).toBe(1);
    const lowered = await runDecisionStage({
      ...base,
      items: [{ id: "s1" }],
      port,
      escalate,
      threshold: 0.6,
    });
    expect(lowered.settled).toBe(1);
  });
});

describe("confidenceOf", () => {
  it("reads the probability from a noul and the confidence from a choice", () => {
    expect(confidenceOf(noul(0.62))).toBe(0.62);
    expect(confidenceOf(choice("a", 0.88))).toBe(0.88);
  });
});
