// Evidence-pack assembly and the publication flow (STORE write path).

import { createHash } from "node:crypto";
import type { VerdictClass } from "../verification-api.ts";
import type { VerificationLlm } from "../verification-llm.ts";
import { nliAudit, nliAuditBatch } from "./nli.ts";

// ---------- evidence pack assembly + publication flow ----------

export interface EvidencePackInput {
  gridResult: unknown;
  justifications: string[];
  evidenceItems: Array<{ authorityRef: string; seriesIdentity: string; vintageDate: string }>;
}

export interface AssembledPack {
  packId: string;
  gridResult: unknown;
  justifications: string[];
  nliOutcome: "pass" | "fail";
  vintageDates: string[];
  itemRefs: string[];
}

export async function assembleEvidencePack(
  input: EvidencePackInput,
  nli: VerificationLlm,
): Promise<AssembledPack> {
  // The NLI audit is the publication gate - it runs BEFORE publication (2.7):
  // a failing audit blocks the pack from ever reaching a verdict. One call
  // covers the whole pack; a single-justification pack keeps the single-pair
  // contract (no prompt-shape change on that path).
  const citedSpan = input.evidenceItems.map((e) => e.seriesIdentity).join("; ");
  const results =
    input.justifications.length === 1
      ? [
          await nliAudit(nli, {
            justification: input.justifications[0] as string,
            citedSpan,
          }),
        ]
      : await nliAuditBatch(nli, {
          sentences: input.justifications.map((justification) => ({
            justification,
            citedSpan,
          })),
        });
  for (const [index, result] of results.entries()) {
    if (result.verdict === "fail") {
      throw new Error(
        `publication blocked: NLI audit failed (${result.failureClass ?? "entailment"}) on justification ${index + 1}`,
      );
    }
  }
  return {
    packId: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
    gridResult: input.gridResult,
    justifications: input.justifications,
    nliOutcome: "pass",
    vintageDates: input.evidenceItems.map((e) => e.vintageDate),
    itemRefs: input.evidenceItems.map((e) => e.seriesIdentity),
  };
}

export interface VerdictWriteInput {
  verdictClass: VerdictClass;
  /**
   * Omitted until an adjudicator produces one. The column is nullable and the
   * site publishes nothing for it (SITE-MVP §2.2 rule 2), so a caller with no
   * measured confidence must leave it out rather than invent a number — the
   * slices used to hardcode 0.7 here, which is how every page came to show
   * "Confidence: 70%" (Sept 2026).
   */
  confidence?: number;
  provenance: {
    pipelineVersion: string;
    promptVersions: Record<string, string>;
    modelVersions: Record<string, string>;
    searchRefs: string[];
  };
}

export async function publicationFlow(
  store: unknown,
  claimId: string,
  pack: AssembledPack,
  write: VerdictWriteInput,
): Promise<{ verdictId: string; version: number; status: string; verdictClass: string }> {
  const impl = store as {
    recordEvidenceItem(fixture: {
      claimId: string;
      authorityRef: string;
      seriesIdentity: string;
      vintageDate: Date;
      url: string;
      archiveSnapshotUrl: string;
      contentHash: string;
    }): Promise<{ itemId: string; version: number }>;
    appendEvidencePack(
      claimId: string,
      fixture: {
        itemRefs: string[];
        gridResult?: unknown;
        justifications: string[];
        nliOutcome: string;
      },
    ): Promise<{ packId: string }>;
    writeVerdict(
      claimId: string,
      packId: string,
      write: {
        provenance: VerdictWriteInput["provenance"];
        verdictClass?: VerdictClass;
        confidence?: number;
      },
    ): Promise<{ verdictId: string; version: number; status: string; verdictClass?: string }>;
    logTransition(
      verdictId: string,
      transition: { from: string; to: string; reason?: string },
    ): Promise<void>;
  };
  const itemRefs: string[] = [];
  for (const ref of pack.itemRefs) {
    const item = await impl.recordEvidenceItem({
      claimId,
      authorityRef: ref,
      seriesIdentity: ref,
      vintageDate: new Date("2026-06-30T00:00:00Z"),
      url: `https://www.policedata.nz/${ref}`,
      archiveSnapshotUrl: `https://web.archive.org/web/2026/https://www.policedata.nz/${ref}`,
      contentHash: createHash("sha256").update(ref).digest("hex"),
    });
    itemRefs.push(item.itemId);
  }
  const appended = await impl.appendEvidencePack(claimId, {
    itemRefs,
    gridResult: pack.gridResult,
    justifications: pack.justifications,
    nliOutcome: pack.nliOutcome,
  });
  const verdict = await impl.writeVerdict(claimId, appended.packId, {
    provenance: write.provenance,
    verdictClass: write.verdictClass,
    ...(write.confidence != null ? { confidence: write.confidence } : {}),
  });
  await impl.logTransition(verdict.verdictId, {
    from: "DRAFT",
    to: "PUBLISHED",
    reason: "verified + evidence pack assembled",
  });
  return {
    verdictId: verdict.verdictId,
    version: verdict.version,
    status: "PUBLISHED",
    verdictClass: write.verdictClass,
  };
}
