// Decision calibration (ADR-0024). Measures whether a decision model's stated
// confidence is calibrated ON OUR CLAIMS, against the labelled triage set, and
// writes a run file carrying the provenance to reproduce it. The arithmetic is
// `packages/harness/src/calibration.ts`; this script only produces the pairs.
//
// A role moves to the decision model only when a run here clears the accuracy
// floor at n>=20 per class. Until then no role is routed (the routing table is
// unchanged), which is why this is a measurement rather than a switch.
//
// Live: it calls OpenRouter's alpha decisions endpoint and costs money (a
// 200-item run is ~$0.01). Run it deliberately:
//   set -a; source .env; set +a; npx tsx ops/calibrate-decisions.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  type CalibrationItem,
  calibrate,
  formatCalibrationReport,
  thresholdForAccuracy,
} from "../packages/harness/src/calibration.ts";
import { costUsd, PRICE_MAP_VERSION } from "../packages/llm/src/prices.ts";
import {
  createJevDecisions,
  type DecisionAnswer,
  JEV_MODEL,
  JEV_PRICE_KEY,
} from "../packages/pipeline/src/decision-port.ts";
import {
  checkabilityQuestion,
  speakershipQuestion,
} from "../packages/pipeline/src/decision-questions.ts";
import { confidenceOf } from "../packages/pipeline/src/decision-stage.ts";

const ELIGIBLE_SPEAKERSHIP = new Set(["quoted-actor", "author-claim"]);
/** The gate (ADR-0024): n>=20 per class, and a settled subset at >=95% accuracy. */
const GATE_ITEMS_PER_CLASS = 20;
const GATE_ACCURACY = 0.95;
/** Batch size: how many questions go in one round trip. Jev answers a set at once. */
const BATCH = 20;

const LabelledItem = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  speakership: z.string().min(1),
  content: z.string().min(1),
  arguable: z.boolean().optional().default(false),
});
const LabelledSet = z.object({
  description: z.string(),
  provenance: z.record(z.string(), z.string()),
  items: z.array(LabelledItem).min(1),
});
type LabelledItem = z.infer<typeof LabelledItem>;

interface Measured {
  items: CalibrationItem[];
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  resolvedModel: string;
  provider: string;
}

/**
 * Ask the decision model one question per item, in batches, and pair each answer
 * with its label. `labelFor` is the ground truth for that arm.
 */
async function measure(
  port: ReturnType<typeof createJevDecisions>,
  role: "triage-speakership" | "triage-checkability",
  items: LabelledItem[],
  stateFor: (item: LabelledItem) => Record<string, unknown>,
  questionFor: (item: LabelledItem) => Record<string, unknown>,
  labelFor: (item: LabelledItem) => string,
): Promise<Measured> {
  const out: CalibrationItem[] = [];
  let calls = 0;
  let failed = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let resolvedModel = JEV_MODEL;
  let provider = "unknown";

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const state: Record<string, unknown> = {};
    const questions: Record<string, unknown> = {};
    for (const item of batch) {
      Object.assign(state, stateFor(item));
      Object.assign(questions, questionFor(item));
    }
    calls += 1;
    const call = await port.decide({
      role,
      state,
      questions: questions as never,
    });
    if (!call.ok) {
      failed += 1;
      console.error(`  ${role} batch ${i / BATCH + 1} failed: ${call.failureClass}`);
      continue;
    }
    tokensIn += call.usage.tokensIn;
    tokensOut += call.usage.tokensOut;
    resolvedModel = call.model;
    provider = call.provider;
    for (const item of batch) {
      const answer = call.answers[item.id] as DecisionAnswer | undefined;
      if (answer == null || answer.type !== "choice") continue;
      out.push({
        id: item.id,
        statedConfidence: confidenceOf(answer),
        correct: answer.choice === labelFor(item),
      });
    }
  }
  return { items: out, calls, failed, tokensIn, tokensOut, resolvedModel, provider };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set — copy .env.example to .env");

  const fixturePath = new URL(
    "../packages/pipeline/fixtures/triage-labelled.json",
    import.meta.url,
  );
  const parsed = LabelledSet.safeParse(JSON.parse(readFileSync(fixturePath, "utf8")));
  if (!parsed.success) throw new Error(`bad labelled set: ${parsed.error.message}`);
  const { items } = parsed.data;

  const port = createJevDecisions(apiKey);

  console.log(`calibrating ${JEV_MODEL} on ${items.length} labelled items…\n`);

  const speakership = await measure(
    port,
    "triage-speakership",
    items,
    (item) => ({ sentences: [{ id: item.id, text: item.text }] }),
    (item) => ({ [item.id]: speakershipQuestion(item.id) }),
    (item) => item.speakership,
  );
  const eligible = items.filter((item) => ELIGIBLE_SPEAKERSHIP.has(item.speakership));
  const checkability = await measure(
    port,
    "triage-checkability",
    eligible,
    (item) => ({
      sentences: [{ id: item.id, text: item.text, speakershipClass: item.speakership }],
    }),
    (item) => ({ [item.id]: checkabilityQuestion(item.id) }),
    (item) => item.content,
  );

  const speakershipReport = calibrate(speakership.items);
  const checkabilityReport = calibrate(checkability.items);

  console.log(formatCalibrationReport(speakershipReport, "triage-speakership"));
  console.log();
  console.log(formatCalibrationReport(checkabilityReport, "triage-checkability"));

  // The gate is per class: a class with fewer than n>=20 labels cannot clear it,
  // however well the model scores on the items that exist.
  const classCounts = (rows: LabelledItem[], key: "speakership" | "content") => {
    const counts = new Map<string, number>();
    for (const item of rows) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
    return counts;
  };

  const evaluateGate = (
    label: string,
    report: ReturnType<typeof calibrate>,
    counts: Map<string, number>,
  ): boolean => {
    const thin = [...counts.entries()].filter(([, n]) => n < GATE_ITEMS_PER_CLASS);
    const chosen = thresholdForAccuracy(report, GATE_ACCURACY);
    // A threshold that settles a handful of items at high accuracy is not a gate:
    // the settled subset must be big enough to mean something.
    const meaningful = chosen != null && chosen.settled >= GATE_ITEMS_PER_CLASS;
    const cleared = thin.length === 0 && meaningful;
    console.log(`  ${label}: ${[...counts.entries()].map(([c, n]) => `${c}=${n}`).join(", ")}`);
    if (thin.length > 0) {
      console.log(
        `    NOT CLEARED — classes below n>=${GATE_ITEMS_PER_CLASS}: ${thin.map(([c, n]) => `${c} (${n})`).join(", ")}`,
      );
    }
    console.log(
      `    accuracy floor ${(GATE_ACCURACY * 100).toFixed(0)}% at n>=${GATE_ITEMS_PER_CLASS} settled: ${
        chosen == null
          ? "no threshold clears it"
          : `best is ${chosen.threshold.toFixed(2)} — settles ${chosen.settled} at ${(chosen.settledAccuracy * 100).toFixed(1)}%`
      }`,
    );
    return cleared;
  };

  console.log("\n── gate (ADR-0024) ──");
  const speakershipCleared = evaluateGate(
    "triage-speakership",
    speakershipReport,
    classCounts(items, "speakership"),
  );
  const checkabilityCleared = evaluateGate(
    "triage-checkability",
    checkabilityReport,
    classCounts(eligible, "content"),
  );
  const gateCleared = speakershipCleared || checkabilityCleared;
  console.log(
    `  verdict: ${
      gateCleared
        ? `CLEARED for ${[speakershipCleared ? "triage-speakership" : null, checkabilityCleared ? "triage-checkability" : null].filter(Boolean).join(", ")}`
        : "NOT CLEARED — routing unchanged"
    }`,
  );

  const totalTokensIn = speakership.tokensIn + checkability.tokensIn;
  const totalTokensOut = speakership.tokensOut + checkability.tokensOut;
  const cost = costUsd(JEV_PRICE_KEY, { tokensIn: totalTokensIn, tokensOut: totalTokensOut });
  console.log(
    `\n  cost $${cost.toFixed(5)} (${PRICE_MAP_VERSION}; ${totalTokensIn} in / ${totalTokensOut} out)`,
  );

  const runId = `jev-calibration-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runFile = {
    runId,
    at: new Date().toISOString(),
    purpose:
      "ADR-0024: measure whether a decision model's probabilities are calibrated on our claims",
    model: {
      requested: JEV_MODEL,
      resolved: speakership.resolvedModel,
      provider: speakership.provider,
    },
    priceKey: JEV_PRICE_KEY,
    priceMapVersion: PRICE_MAP_VERSION,
    labelledSet: parsed.data.provenance,
    itemCount: items.length,
    arguableItemCount: items.filter((item) => item.arguable).length,
    calls: { speakership: speakership.calls, checkability: checkability.calls },
    failedCalls: speakership.failed + checkability.failed,
    usage: { tokensIn: totalTokensIn, tokensOut: totalTokensOut, costUsd: cost },
    report: { speakership: speakershipReport, checkability: checkabilityReport },
    gate: {
      itemsPerClass: GATE_ITEMS_PER_CLASS,
      accuracyFloor: GATE_ACCURACY,
      speakership: { cleared: speakershipCleared },
      checkability: { cleared: checkabilityCleared },
      cleared: gateCleared,
    },
  };
  mkdirSync(new URL("./runs", import.meta.url), { recursive: true });
  const out = new URL(`./runs/${runId}.json`, import.meta.url);
  writeFileSync(out, `${JSON.stringify(runFile, null, 2)}\n`);
  console.log(`  run file: ops/runs/${runId}.json`);
}

await main();
