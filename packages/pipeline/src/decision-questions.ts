// Decision questions (ADR-0024): the closed-vocabulary classifications expressed
// in the decision port's three primitives. These are the versioned instructions
// for a decision role, so they live beside the pipeline that asks them (the same
// rule as a generative prompt) rather than in the transport client.

import type { DecisionQuestion } from "./decision-port.ts";

/**
 * Axis 1 (ADR-0025): whose words the sentence is. The four classes are the
 * generative arm's closed vocabulary, restated here as a `choice` so the model
 * cannot return a class outside it.
 */
export const SPEAKERSHIP_DECISION_CRITERIA: Record<string, string> = {
  "quoted-actor":
    "The sentence is the words of a named or identifiable person other than the document's author, whether quoted verbatim or paraphrased.",
  "author-claim":
    "The sentence is the document author's or outlet's own factual assertion, not attributed to anyone else.",
  "outlet-prose":
    "The sentence is narration, framing, scene-setting or connective text — not an assertion anyone is making to be checked.",
  unresolved: "It cannot be determined whose words the sentence is from the document given.",
};

/** One question per sentence, named by sentence id (unique across the set). */
export function speakershipQuestion(sentenceId: string): DecisionQuestion {
  return {
    type: "choice",
    instructions: `Which best describes sentence ${sentenceId}: whose words is it?`,
    criteria: SPEAKERSHIP_DECISION_CRITERIA,
  };
}

/**
 * Axis 2 (ADR-0025): what the words are. Only `checkable` is a factual assertion
 * evidence can settle; every other value is the reason it is not checked.
 */
export const CHECKABILITY_DECISION_CRITERIA: Record<string, string> = {
  checkable: "A factual assertion that evidence could establish or refute.",
  opinion: "A belief, value judgement or preference that evidence cannot settle.",
  rhetoric: "Persuasive or emotive language that asserts no checkable fact.",
  procedure: "A description of process, intent or what will be done, not a fact to check.",
  satire: "Satire, parody or a joke — the literal reading is not the intended one.",
  question: "A question, which asserts nothing.",
  "off-domain": "Not about a matter in this jurisdiction or not a public factual claim.",
  "pledge-conditional": "A commitment conditional on events, which cannot be true or false yet.",
};

/** One question per sentence, named by sentence id (unique across the set). */
export function checkabilityQuestion(sentenceId: string): DecisionQuestion {
  return {
    type: "choice",
    instructions: `Which best describes sentence ${sentenceId}: is it a checkable factual assertion, or why not?`,
    criteria: CHECKABILITY_DECISION_CRITERIA,
  };
}
