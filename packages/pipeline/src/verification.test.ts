// VERIFICATION L1 contract (VERIFICATION.md §2, risks VER-R1..R15). The stat
// grid is the flagship pure-logic module — exhaustive fixtures, integer-safe
// arithmetic, class boundaries as arithmetic. LLM stages mocked via the
// VerificationLlm port. Authored red; test-requirement changes need approval.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

import {
  citationCheck,
  computeStatGrid,
  nliAudit,
  openWebLoop,
  quoteFidelityCheck,
  recordSeriesRetrieval,
  rejectAdvocacySource,
  resolveAuthority,
} from "./verification.ts";
import type {
  CitationOutcome,
  DepthCapResult,
  EvidenceSeries,
  NliCheckResult,
  QuoteFidelityOutcome,
  SeriesData,
  StatGridOutcome,
} from "./verification-api.ts";
import { MockVerificationLlm } from "./verification-llm.ts";

const gridFixture = JSON.parse(readFixture("verification-grid.json")) as {
  series: { policedata_victimisations: object };
  claims: Array<{
    id: string;
    claim: string;
    fingerprint: Record<string, string | null>;
    discourseContext?: { attachedProposal?: string; argumentDirection?: string };
    expected: Record<string, unknown>;
  }>;
};

// Materiality mock: the LLM selects which grid rows are material to the claim's
// deployment; it never authors the grid (VERIFICATION §2.2 step 3).
const materialityLlm = (materialRows: string[]) =>
  MockVerificationLlm.scripted((_role, input) => {
    void input;
    return { ok: true, value: { materialRows } };
  });

// ---------- stat-grid arithmetic (VER-R1) ----------

describe("stat-grid arithmetic is pure logic (VER-R1)", () => {
  const crimeSeries = gridFixture.series.policedata_victimisations as never as SeriesData;

  it("computes the golden endpoint window for the crime claim", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-crime-30");
    const llm = materialityLlm(["window-2017-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: crimeSeries,
      discourseContext: claim?.discourseContext,
    })) as StatGridOutcome & { vintageDate: string };
    const endpoint = claim?.expected.endpointWindow as { periods: string[]; percentChange: number };
    const row = out.grid.rows.find((r) => r.axis === "window" && r.variant === "2017→2026");
    expect(row?.percentChange).toBeCloseTo(endpoint.percentChange, 1);
    expect(out.matchedRow).toBe(claim?.expected.matchedGridRow);
  });

  it("produces the golden alternatives table (per-capita + window variants)", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-crime-30");
    const llm = materialityLlm(["window-2017-2026", "window-2019-2026", "per-capita-2017-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: crimeSeries,
      discourseContext: claim?.discourseContext,
    })) as StatGridOutcome & { vintageDate: string };
    const expectedRows = claim?.expected.alternativesRows as Array<{
      variant: string;
      percentChange: number;
    }>;
    for (const exp of expectedRows) {
      const row = out.grid.rows.find((r) => r.variant === exp.variant);
      expect(row?.percentChange).toBeCloseTo(exp.percentChange, 1);
    }
  });

  it("marks the grid robust only when every material row supports the impression", async () => {
    const robust = gridFixture.claims.find((c) => c.id === "grid-crime-robust");
    const llm = materialityLlm(["year-over-year-2019-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: robust?.fingerprint ?? {},
      series: crimeSeries,
    })) as StatGridOutcome & { vintageDate: string };
    expect(out.verdictClass).toBe("supported");
    expect(out.grid.robust).toBe(true);
  });

  it("guards division-by-zero and missing population in per-capita rows", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-crime-30");
    const noPopulation: SeriesData = { ...crimeSeries, populationSeries: undefined };
    const llm = materialityLlm(["per-capita-2017-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: noPopulation,
    })) as StatGridOutcome & { vintageDate: string };
    const pcRow = out.grid.rows.find((r) => r.axis === "per-capita");
    expect(pcRow?.percentChange).toBeNull();
  });

  it("notes the vintage, not retrieval time, in every computed row (STO-R3)", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-crime-30");
    const llm = materialityLlm(["window-2017-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: crimeSeries,
    })) as StatGridOutcome & { vintageDate?: string };
    expect((out as { vintageDate?: string }).vintageDate).toBe(crimeSeries.vintageDate);
  });
});

// ---------- verdict-class boundary (VER-R11) ----------

describe("verdict-class boundaries are arithmetic (VER-R11)", () => {
  const crimeSeries = gridFixture.series.policedata_victimisations as never as SeriesData;

  it("material alternatives contradicting the impression → conflicting_cherry_picking", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-crime-30");
    const llm = materialityLlm(["window-2017-2026", "per-capita-2017-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: crimeSeries,
      discourseContext: claim?.discourseContext,
    })) as StatGridOutcome & { vintageDate: string };
    expect(out.verdictClass).toBe("conflicting_cherry_picking");
  });

  it("claim quantity matching no grid row → refuted, never 'false' characterisation", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-no-row-match");
    const llm = materialityLlm(["window-2017-2026"]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: crimeSeries,
    })) as StatGridOutcome & { vintageDate: string };
    expect(out.verdictClass).toBe("refuted");
  });

  it("no canonical series → not_enough_evidence with visibly lower reliability", async () => {
    const claim = gridFixture.claims.find((c) => c.id === "grid-no-series");
    const llm = materialityLlm([]);
    const out = (await computeStatGrid(llm, {
      fingerprint: claim?.fingerprint ?? {},
      series: { ...crimeSeries, points: [] },
    })) as StatGridOutcome & { vintageDate: string };
    expect(out.verdictClass).toBe("not_enough_evidence");
  });

  it("renders 'as deployed' only when attached_proposal exists — absent stays absent (ADR-0008)", async () => {
    const withProposal = gridFixture.claims.find((c) => c.id === "grid-crime-30");
    const llm = materialityLlm(["window-2017-2026"]);
    const outWith = (await computeStatGrid(llm, {
      fingerprint: withProposal?.fingerprint ?? {},
      series: crimeSeries,
      discourseContext: withProposal?.discourseContext,
    })) as StatGridOutcome & { vintageDate: string };
    expect(outWith.asDeployed).toContain("tougher sentencing");
    const robust = gridFixture.claims.find((c) => c.id === "grid-crime-robust");
    const outWithout = (await computeStatGrid(llm, {
      fingerprint: robust?.fingerprint ?? {},
      series: crimeSeries,
    })) as StatGridOutcome & { vintageDate: string };
    expect(outWithout.asDeployed).toBeUndefined();
  });
});

// ---------- series retrieval + evidence durability ----------

describe("series retrieval records vintages and snapshots (STO-R3, §10)", () => {
  it("records the fetched series with vintage distinct from retrieval and an archive snapshot", async () => {
    const crimeSeries = gridFixture.series.policedata_victimisations as never as SeriesData;
    const evidence = recordSeriesRetrieval({
      series: crimeSeries,
      url: "https://www.policedata.nz/victimisations",
    }) as EvidenceSeries;
    expect(evidence.vintageDate).toBe(crimeSeries.vintageDate);
    expect(evidence.archiveSnapshotUrl).toContain("web.archive.org");
    expect(evidence.contentHash).toBeTruthy();
    expect(new Date(evidence.vintageDate).getTime()).not.toBe(
      new Date(evidence.retrievedAt ?? crimeSeries.retrievedAt).getTime(),
    );
  });
});

// ---------- authority map (VER-R14) ----------

describe("authority map precedence and advocacy rejection (VER-R14)", () => {
  const fixture = JSON.parse(readFixture("verification-authority-map.json")) as {
    resolutions: Array<{
      domain: string;
      requested: { source: string; tier: number };
      expectPrimary?: string;
      expectReject?: boolean;
    }>;
  };

  it.each(fixture.resolutions.filter((r) => r.expectPrimary))(
    "resolves $domain to $expectPrimary",
    (r) => {
      const out = resolveAuthority({
        domain: r.domain,
        requestedSource: r.requested.source,
        requestedTier: r.requested.tier,
      }) as AuthorityResolution;
      expect(out.primary).toBe(r.expectPrimary);
      if (r.requested.tier === 6) {
        expect(out.note).toBeTruthy();
      }
    },
  );

  it("rejects advocacy sources as a verdict basis", async () => {
    const advocacy = fixture.resolutions.find((r) => r.expectReject);
    expect(rejectAdvocacySource(advocacy?.requested.source ?? "")).toBe(true);
    expect(rejectAdvocacySource("policedata.nz")).toBe(false);
  });
});

// ---------- citation-check (VER-R4) ----------

describe("citation-check mode (VER-R4)", () => {
  const fixture = JSON.parse(readFixture("verification-citation.json")) as {
    cases: Array<{
      id: string;
      claim: string;
      citedDocument: object;
      expected: Record<string, unknown>;
    }>;
  };

  it.each(fixture.cases)("$id", async (c) => {
    const llm = MockVerificationLlm.forCitation(c.claim, c.citedDocument as never, c.expected);
    const out = (await citationCheck(llm, {
      claim: c.claim,
      citedDocument: c.citedDocument as never,
    })) as CitationOutcome;
    expect(out.verdict).toBe(c.expected.verdict);
    expect(out.bindingStrictness).toBe(c.expected.bindingStrictness);
    if (c.expected.quotedClaimOnly) {
      expect(out.quotedClaimOnly).toBe(true);
    }
  });
});

// ---------- quote-fidelity mode (VER-R5, ADR-0007) ----------

describe("quote-fidelity mode (VER-R5)", () => {
  const fixture = JSON.parse(readFixture("verification-quote-fidelity.json")) as {
    artefacts: Array<{
      id: string;
      claimText: string;
      captionText: string;
      expected: Record<string, unknown>;
    }>;
  };

  it.each(fixture.artefacts)("$id", async (a) => {
    const llm = MockVerificationLlm.forQuoteFidelity(a, a.expected);
    const out = (await quoteFidelityCheck(llm, {
      claimText: a.claimText,
      captionText: a.captionText,
      transcriptTier: "publisher-auto",
    })) as QuoteFidelityOutcome;
    if (a.expected.anchorMissing) {
      expect(out.anchorMissing).toBe(true);
      return;
    }
    expect(out.verdict).toBe(a.expected.verdict);
    expect(out.note).toBe(a.expected.note);
    if (a.expected.verdict === "not_enough_evidence" && !a.expected.routesToStatGrid) {
      expect(out.captionQualityFlag).toBe(true);
    }
    if (a.expected.routesToStatGrid) {
      expect(out.routesToStatGrid).toBe(true);
    }
  });
});

// ---------- NLI gate (VER-R2) ----------

describe("NLI publication gate (VER-R2)", () => {
  const fixture = JSON.parse(readFixture("verification-nli.json")) as {
    mustPass: Array<{ id: string; justification: string; citedSpan: string; expected: string }>;
    mustFail: Array<{
      id: string;
      justification: string;
      citedSpan: string;
      expected: string;
      failureClass: string;
    }>;
  };

  it.each(fixture.mustPass)("passes $id", async (p) => {
    const llm = MockVerificationLlm.forNli(p.justification, "pass");
    const out = (await nliAudit(llm, {
      justification: p.justification,
      citedSpan: p.citedSpan,
    })) as NliCheckResult;
    expect(out.verdict).toBe("pass");
  });

  it.each(fixture.mustFail)("fails $id with $failureClass", async (p) => {
    const llm = MockVerificationLlm.forNli(p.justification, "fail", p.failureClass);
    const out = (await nliAudit(llm, {
      justification: p.justification,
      citedSpan: p.citedSpan,
    })) as NliCheckResult;
    expect(out.verdict).toBe("fail");
    expect(out.failureClass).toBe(p.failureClass);
  });
});

// ---------- open-web depth caps ----------

describe("open-web loop confidence-capped depth (VER-R3, §2.6)", () => {
  it("stops at the cap and marks the run as capped — never a silent weak verdict", async () => {
    const llm = MockVerificationLlm.forOpenWeb(9, 0.2);
    const out = (await openWebLoop(llm, {
      claim: "The PM has never visited the West Coast",
      depthCap: 3,
      mockRounds: 9,
    })) as DepthCapResult;
    expect(out.roundsUsed).toBeLessThanOrEqual(3);
    expect(out.capBinding).toBe(3);
    expect(out.cappedRun).toBe(true);
  });

  it("runs to natural completion under the cap", async () => {
    const llm = MockVerificationLlm.forOpenWeb(2, 0.85);
    const out = (await openWebLoop(llm, {
      claim: "The PM visited the West Coast in 2024",
      depthCap: 3,
      mockRounds: 2,
    })) as DepthCapResult;
    expect(out.roundsUsed).toBe(2);
    expect(out.cappedRun).toBe(false);
    expect(out.confidence).toBeCloseTo(0.85, 2);
  });
});

// type used by resolveAuthority test
interface AuthorityResolution {
  primary: string;
  note?: string;
}
