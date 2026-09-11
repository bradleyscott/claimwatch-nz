// HAR-R12: eval-script drift from the published metric. The vendored files
// must match the recorded SHA-256 of the pinned upstream commit on every push;
// the manifest asserts the same checksums before any L3 scoring run. The
// known-output execution smoke needs a Python scoring env (numpy/scipy/sklearn
// + NLTK data) — gated behind RUN_AVERITEC_SMOKE=1 so the default L1 install
// never reaches the network.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PINNED_DIR = new URL("../../../tools/averitec-eval/averitec-pinned/", import.meta.url)
  .pathname;
export const AVERITEC_PIN = {
  repo: "MichSchli/AVeriTeC",
  commit: "7c62d1ec8df3fb560d6efe2b85fa191135636f81",
  files: {
    "eval.py": "01e325e5e19074037d1f1a7673b0f7999ecab82ee5ae3e81205efc86cc39b161",
    "utils.py": "d4b1bcbd0ec10210892e5d41521ffd6a0ae02e50ba336b8d84830f19dc33643e",
  },
} as const;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("AVeriTeC eval tool pin (HAR-R12)", () => {
  it("vendored files match the recorded checksums of the pinned commit", () => {
    for (const [file, expected] of Object.entries(AVERITEC_PIN.files)) {
      expect(sha256(join(PINNED_DIR, file)), `${file} checksum`).toBe(expected);
    }
  });

  it("PIN.md documents the same commit the checksums assert", () => {
    const pin = readFileSync(join(PINNED_DIR, "PIN.md"), "utf8");
    expect(pin).toContain(AVERITEC_PIN.commit);
    for (const expected of Object.values(AVERITEC_PIN.files)) {
      expect(pin).toContain(expected);
    }
  });
});

describe.runIf(process.env.RUN_AVERITEC_SMOKE === "1")("AVeriTeC known-output smoke", () => {
  it("scores a tiny predictions file against a known reference", () => {
    // One claim, perfect prediction, exact-label match: veracity accuracy 1.0
    // at every reporting level; question-answer score deterministically > 0.
    const prediction = {
      claim: "The sky is blue",
      label: "Supported",
      justification: "The sky is blue because of Rayleigh scattering.",
      questions: [
        {
          question: "What colour is the sky?",
          answers: [
            { answer: "blue", answer_type: "extractive", source_url: "https://example.com" },
          ],
        },
      ],
    };
    const reference = {
      claim: "The sky is blue",
      label: "Supported",
      justification: "The sky is blue.",
      questions: [
        {
          question: "What colour is the sky?",
          answers: [
            { answer: "blue", answer_type: "extractive", source_url: "https://example.com" },
          ],
        },
      ],
    };
    const predictionsPath = join(tmpdir(), "averitec-smoke-predictions.json");
    const referencesPath = join(tmpdir(), "averitec-smoke-references.json");
    writeFileSync(predictionsPath, JSON.stringify([prediction]));
    writeFileSync(referencesPath, JSON.stringify([reference]));
    const out = execFileSync("python3", [
      join(PINNED_DIR, "eval.py"),
      "--predictions",
      predictionsPath,
      "--references",
      referencesPath,
    ]);
    const stdout = out.toString();
    expect(stdout).toContain("AVeriTeC evaluation:");
    expect(stdout).toContain(" * Veracity scores (meteor @ 0.5): 1.0");
  });
});
