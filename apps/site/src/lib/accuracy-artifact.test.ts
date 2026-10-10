// SIT-R2: the methodology page's measured-accuracy table is generated from the
// harness artifact — rendered values must equal artifact values exactly; a
// missing or malformed artifact fails the build rather than rendering stale or
// hand-edited numbers.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCURACY_ARTIFACT_PATH,
  type AccuracyArtifact,
  artifactEqualsRendered,
  loadAccuracyArtifact,
  renderAccuracyTable,
} from "./accuracy-artifact.ts";

const artifact: AccuracyArtifact = {
  runId: "l3-2026-09-11",
  generatedAt: "2026-09-11T06:00:00Z",
  storeSchemaVersion: "0.1.0",
  modes: [
    { mode: "quantitative", accuracy: 0.814, n: 30, costPerClaim: 0.42 },
    { mode: "quoted", accuracy: 0.76, n: 25, costPerClaim: 0.11 },
    { mode: "document-anchored", accuracy: 0.85, n: 20, costPerClaim: 0.09 },
    { mode: "open-research", accuracy: 0.62, n: 25, costPerClaim: 0.63 },
  ],
  overall: { accuracy: 0.762, iaa: 0.71, costPerClaim: 0.31 },
};

function artifactRepo(tmpDir: string): string {
  const out = join(tmpDir, "packages/harness/output");
  mkdirSync(out, { recursive: true });
  return tmpDir;
}

describe("accuracy artifact loading (SIT-R2)", () => {
  it("loads and validates a well-formed artifact", () => {
    const repo = artifactRepo(mkdtempSync(join(tmpdir(), "cw-acc-")));
    writeFileSync(join(repo, ACCURACY_ARTIFACT_PATH), JSON.stringify(artifact));
    const loaded = loadAccuracyArtifact(repo);
    expect(loaded.runId).toBe("l3-2026-09-11");
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails the build when the artifact is missing — never renders a stale number", () => {
    const repo = mkdtempSync(join(tmpdir(), "cw-acc-"));
    expect(() => loadAccuracyArtifact(repo)).toThrow(/artifact missing/);
    rmSync(repo, { recursive: true, force: true });
  });

  it("fails the build when the artifact is malformed — refuses to render", () => {
    const repo = artifactRepo(mkdtempSync(join(tmpdir(), "cw-acc-")));
    writeFileSync(
      join(repo, ACCURACY_ARTIFACT_PATH),
      JSON.stringify({ runId: "x", modes: "all-good-trust-us" }),
    );
    expect(() => loadAccuracyArtifact(repo)).toThrow(/malformed/);
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("rendering equality with the artifact (SIT-R2 CI check)", () => {
  it("renders rows in artifact order with rounded percentages and costs", () => {
    const rows = renderAccuracyTable(artifact);
    expect(rows[0]).toMatchObject({
      mode: "quantitative",
      accuracyPercent: 81.4,
      n: 30,
      costPerClaim: 0.42,
    });
    expect(rows[3]?.label).toContain("Open research");
  });

  it("the CI equality check passes for artifact-derived rows and fails on tampering", () => {
    const rows = renderAccuracyTable(artifact);
    expect(artifactEqualsRendered(artifact, rows)).toBe(true);
    const tampered = rows.map((r) => ({ ...r, accuracyPercent: 99.9 }));
    expect(artifactEqualsRendered(artifact, tampered)).toBe(false);
  });

  it("renders a group the site has no label for, without printing internal vocabulary", () => {
    // The harness's reporting axis is its own (ADR-0026), so an artifact can
    // arrive with group keys this site has never seen. It must render the NUMBER (the
    // build must not fail on a vocabulary change the site cannot make), and it
    // must not print an internal identifier into public copy — the methodology
    // page does not run the register scan.
    const withNewAxis: AccuracyArtifact = {
      ...artifact,
      modes: [
        // A key that is plain English once humanised: readable, so it is shown.
        { mode: "official-figures", accuracy: 0.8, n: 30, costPerClaim: 0.4 },
        // A key that trips the register check ("stratum" is on the banned list,
        // and a per-stratum axis is exactly what the harness may report next), so
        // a neutral label replaces it rather than leaking the term to a page.
        { mode: "stratum-3", accuracy: 0.7, n: 25, costPerClaim: 0.1 },
      ],
    };
    const rows = renderAccuracyTable(withNewAxis);
    expect(rows[0]?.label).toBe("Official figures");
    expect(rows[0]?.accuracyPercent).toBe(80);
    expect(rows[1]?.label).toBe("Claims checked");
    for (const row of rows) {
      expect(row.label).not.toContain("stratum");
      expect(row.label).not.toContain("-");
    }
  });

  it("renders with an empty-store-tolerant shape: the honest gaps are named, never hidden", () => {
    const rows = renderAccuracyTable(artifact);
    // provenance mode absent from this run → not rendered, but the methodology
    // page copy (checked at L4) names that as a gap rather than hiding it.
    expect(rows.some((r) => r.mode === "provenance")).toBe(false);
  });
});
