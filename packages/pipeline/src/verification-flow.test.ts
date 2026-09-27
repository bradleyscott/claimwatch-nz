// Provenance mode (VERIFICATION §2.5) + the publication flow (pack → NLI gate
// → verdict v1 → transition). Curated-set-only for provenance (VER-R6);
// publication blocked when the NLI audit fails (§2.7).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

import {
  assembleEvidencePack,
  type EvidencePackInput,
  type ProvenanceOutcome,
  provenanceCheck,
  publicationFlow,
} from "./verification.ts";
import { MockVerificationLlm } from "./verification-llm.ts";

describe("provenance mode — curated set only (VER-R6)", () => {
  const set = JSON.parse(readFixture("false-context-set.json")) as {
    items: Array<{
      fixture_id: string;
      claimed_context: string;
      verified_context: string;
      claim_text: string;
    }>;
  };

  it.each(set.items)(
    "$fixture_id → false-context finding with true context shown",
    async (item) => {
      const llm = MockVerificationLlm.forProvenance(item.claim_text, "false context");
      const out = (await provenanceCheck(llm, {
        claimedContext: item.claimed_context,
        verifiedContext: item.verified_context,
        claimText: item.claim_text,
        isCuratedFixture: true,
      })) as ProvenanceOutcome;
      expect(out.verdict).toBe("false_context");
      expect(out.trueContext).toContain(item.verified_context.split(",")[0]);
    },
  );

  it("refuses to run on live records — the gate is is_curated_fixture (VER-R6)", async () => {
    const llm = MockVerificationLlm.forProvenance("anything", "false context");
    await expect(
      provenanceCheck(llm, {
        claimedContext: "c",
        verifiedContext: "v",
        claimText: "t",
        isCuratedFixture: false,
      }),
    ).rejects.toThrow(/curated fixture/i);
  });
});

describe("evidence pack assembly + publication gate", () => {
  const packInput: EvidencePackInput = {
    gridResult: { rows: [{ axis: "window", variant: "2017→2026", percentChange: 11.6 }] },
    justifications: [
      "Police-recorded victimisations rose from 328,000 in 2017 to 366,000 in 2026, about 11.6%.",
    ],
    evidenceItems: [
      {
        authorityRef: "policedata.nz",
        seriesIdentity: "victimisations-monthly",
        vintageDate: "2026-06-30",
      },
    ],
  };

  it("assembles an append-only pack with grid, justifications, and vintage", async () => {
    const nli = MockVerificationLlm.forNli(packInput.justifications[0] ?? "", "pass");
    const pack = (await assembleEvidencePack(packInput, nli)) as {
      packId: string;
      nliOutcome: string;
      vintageDates: string[];
    };
    expect(pack.packId).toBeTruthy();
    expect(pack.nliOutcome).toBe("pass");
    expect(pack.vintageDates).toContain("2026-06-30");
  });

  it("blocks publication when the NLI audit fails — the gate runs BEFORE publication", async () => {
    const nli = MockVerificationLlm.forNli(
      "Experts agree crime is out of control.",
      "fail",
      "unattributed-synthesis",
    );
    await expect(assembleEvidencePack(packInput, nli)).rejects.toThrow(/NLI/i);
  });

  it("writes verdict v1 and publishes via the legal transition", async () => {
    const { createTestStore } = await import("@cw/store");
    // Own scratch database: vitest forks run suites concurrently, and another
    // suite's from-zero wipe on a shared DB drops tables mid-flight.
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set — copy .env.example to .env (gitignored)");
    }
    const store = await createTestStore(databaseUrl, { scratchSuffix: "_flow" });
    try {
      const llm = MockVerificationLlm.forNli(packInput.justifications[0] ?? "", "pass");
      const pack = await assembleEvidencePack(packInput, llm);
      const claim = await store.recordClaim({
        utteranceText: "Crime is up 30% since 2017.",
        text: "Crime is up 30% since 2017.",
        claimType: "statistical",
        // No claim-level parse any more (ADR-0023): the window and magnitude are
        // parsed inside the figures procedure and stored with the plan that
        // consumed them, not as an identity for the claim.
        discourseContext: {
          window: "w",
          attachedProposal: "tougher sentencing",
          argumentDirection: "problem",
        },
      });
      const flow = (await publicationFlow(store, claim.claimId, pack, {
        verdictClass: "conflicting_cherry_picking",
        confidence: 0.72,
        provenance: {
          pipelineVersion: "0.1.0",
          promptVersions: { "citation-compare": "citation-compare@1" },
          modelVersions: { "citation-compare": "model-x@v1" },
          searchRefs: [],
        },
      })) as { verdictId: string; version: number; status: string; verdictClass: string };
      expect(flow.status).toBe("PUBLISHED");
      expect(flow.version).toBe(1);
      expect(flow.verdictClass).toBe("conflicting_cherry_picking");
    } finally {
      await store.close();
    }
  });
});
