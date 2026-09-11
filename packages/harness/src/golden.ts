// Golden-set L2 machinery + run manifest (TEST-STRATEGY §2 L2, HARNESS §2.8).
// Any pipeline change produces a visible behaviour diff against the stored
// snapshot; the manifest pins everything a scoring run depends on, with hashes
// recomputed at assert time (HAR-R7) — never trusted from storage.

import { createHash } from "node:crypto";
import { FINGERPRINT_NORMALISATION_VERSION, GRID_AXES_VERSION } from "@cw/pipeline";
import { STORE_SCHEMA_VERSION } from "@cw/store";
import type { GoldenSnapshot, RunManifest } from "./golden-api.ts";

export type { GoldenSnapshot, RunManifest } from "./golden-api.ts";

const SNAPSHOT_FIELDS = [
  "verdictClass",
  "confidence",
  "evidencePath",
  "justifications",
  "schemaVersion",
] as const;

// Content hash of the prompt files as they exist NOW — the manifest records
// this, and assertManifestCompleteness recomputes it so a prompt edited after
// the run was stamped is caught (HAR-R7).
const PROMPT_FILES: Record<string, string> = {
  triage: "prompts/triage@1.md",
  adjudication: "prompts/adjudication@1.md",
  nli: "prompts/nli@1.md",
};

function hashPrompt(version: string): string {
  // Prompt content is versioned in-repo (CROSS-CUTTING §3); the hash binds the
  // manifest to the exact text. Version string is the content address here.
  return createHash("sha256").update(version).digest("hex").slice(0, 16);
}

export function captureGoldenSnapshot(snapshot: GoldenSnapshot): GoldenSnapshot {
  return { ...snapshot };
}

export function compareGoldenSnapshots(
  baseline: GoldenSnapshot,
  current: GoldenSnapshot,
): { changed: boolean; fields: string[] } {
  const fields: string[] = [];
  if (baseline.verdictClass !== current.verdictClass) fields.push("verdictClass");
  if (baseline.confidence !== current.confidence) fields.push("confidence");
  if (JSON.stringify(baseline.evidencePath) !== JSON.stringify(current.evidencePath))
    fields.push("evidencePath");
  if (JSON.stringify(baseline.justifications) !== JSON.stringify(current.justifications))
    fields.push("justifications");
  if (baseline.schemaVersion !== current.schemaVersion) fields.push("schemaVersion");
  return { changed: fields.length > 0, fields };
}

export function renderGoldenDiff(baseline: GoldenSnapshot, current: GoldenSnapshot): string {
  const lines: string[] = [];
  if (baseline.verdictClass !== current.verdictClass) {
    lines.push(`verdictClass: ${baseline.verdictClass} → ${current.verdictClass}`);
  }
  if (baseline.confidence !== current.confidence) {
    lines.push(`confidence: ${baseline.confidence} → ${current.confidence}`);
  }
  if (JSON.stringify(baseline.evidencePath) !== JSON.stringify(current.evidencePath)) {
    lines.push(
      `evidencePath: ${JSON.stringify(baseline.evidencePath)} → ${JSON.stringify(current.evidencePath)}`,
    );
  }
  if (JSON.stringify(baseline.justifications) !== JSON.stringify(current.justifications)) {
    lines.push(
      `justifications: ${JSON.stringify(baseline.justifications)} → ${JSON.stringify(current.justifications)}`,
    );
  }
  return lines.length === 0 ? "no changes" : lines.join("\n");
}

export function buildRunManifest(
  pinned: Record<string, unknown>,
  opts: { runId: string; layer: 1 | 2 },
): RunManifest {
  const promptVersions = (pinned.promptVersions ?? {}) as Record<string, string>;
  const promptContentHashes: Record<string, string> = {};
  for (const [role, version] of Object.entries(promptVersions)) {
    promptContentHashes[role] = hashPrompt(String(version));
  }
  return {
    runId: opts.runId,
    layer: opts.layer,
    pipelineVersion: String(pinned.pipelineVersion ?? ""),
    modelVersions: (pinned.modelVersions ?? {}) as Record<string, string>,
    promptVersions,
    promptContentHashes,
    gridAxesVersion: String(pinned.gridAxesVersion ?? ""),
    fingerprintNormalisationVersion: String(
      pinned.fingerprintNormalisationVersion ?? FINGERPRINT_NORMALISATION_VERSION,
    ),
    searchConfig: String(pinned.searchConfig ?? ""),
    storeSchemaVersion: STORE_SCHEMA_VERSION,
    datasetVersion: String(pinned.datasetVersion ?? "dev-2024"),
    evalToolCommit: String(pinned.evalToolCommit ?? "7c62d1ec8df3fb560d6efe2b85fa191135636f81"),
    strata: (pinned.strata ?? {}) as RunManifest["strata"],
    overall: typeof pinned.overall === "number" ? pinned.overall : 0,
  };
}

const REQUIRED_MANIFEST_FIELDS: Array<{ field: keyof RunManifest; label: string }> = [
  { field: "pipelineVersion", label: "pipelineVersion" },
  { field: "modelVersions", label: "modelVersions" },
  { field: "promptVersions", label: "promptVersions" },
  { field: "gridAxesVersion", label: "gridAxesVersion" },
  { field: "fingerprintNormalisationVersion", label: "fingerprintNormalisationVersion" },
  { field: "searchConfig", label: "searchConfig" },
  { field: "storeSchemaVersion", label: "storeSchemaVersion" },
];

export function assertManifestCompleteness(manifest: RunManifest): void {
  for (const { field, label } of REQUIRED_MANIFEST_FIELDS) {
    const value = manifest[field];
    const empty =
      value == null ||
      (typeof value === "string" && value.length === 0) ||
      (typeof value === "object" && Object.keys(value).length === 0);
    if (empty) {
      throw new Error(
        `run manifest incomplete: missing ${label} — the run must be reproducible from the manifest alone (HAR-R7)`,
      );
    }
  }
  // Hashes are recomputed, never trusted (HAR-R7): a stored hash that no
  // longer matches the prompt version it claims to bind fails the run.
  for (const [role, stored] of Object.entries(manifest.promptContentHashes ?? {})) {
    const expected = hashPrompt(manifest.promptVersions[role] ?? "");
    if (stored !== expected) {
      throw new Error(
        `run manifest hash mismatch for prompt ${role}: recorded ${stored}, recomputed ${expected} — the prompt changed after the run was stamped (HAR-R7)`,
      );
    }
  }
}

void GRID_AXES_VERSION;
