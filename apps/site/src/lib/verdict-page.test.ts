// SITE-MVP §2.3/§5 L1: section-order invariant, register rules, anchor href,
// claim-card shape. Authored red; requirements frozen, structural edits free.

import { describe, expect, it } from "vitest";
import {
  anchorHref,
  assertRegisterSafe,
  buildVerdictPageModel,
  VERDICT_LABELS,
  type VerdictClass,
  type VerdictPageInput,
} from "./verdict-page.ts";

const input = (
  over: Partial<VerdictPageInput> & { verdictClass: VerdictClass },
): VerdictPageInput => ({
  claimId: "c1",
  claimText: "Crime is up 30% since 2017.",
  speaker: "Hon Sample Minister",
  speakerAffiliation: "National",
  publishedAt: new Date("2026-09-08"),
  confidence: 0.72,
  attachedProposal: null,
  mediaAnchor: null,
  transcriptTier: null,
  evidence: [],
  pipelineVersion: "0.1.0",
  promptVersions: { "citation-compare": "citation-compare@1" },
  modelVersions: { "citation-compare": "model-x@v1" },
  searchRefs: [],
  sourceCodes: null,
  claimMadeAt: null,
  claimRecordedAt: null,
  sourceRetrievedAt: null,
  claimType: null,
  publisher: null,
  claimPromptVersions: {},
  claimModelVersion: null,
  checkedAt: null,
  nliOutcome: null,
  verdictVersion: 1,
  verdictStatus: "PUBLISHED",
  ...over,
});

/** A fully-recorded claim: every step the trail can show has its dates. */
const recorded = (over: Partial<VerdictPageInput> & { verdictClass: VerdictClass }) =>
  buildVerdictPageModel(
    input({
      claimMadeAt: new Date("2026-09-08T07:42:00+12:00"),
      sourceRetrievedAt: new Date("2026-09-09T09:10:00+12:00"),
      claimRecordedAt: new Date("2026-09-09T09:26:00+12:00"),
      claimType: "statistical",
      publisher: "Newstalk ZB",
      claimPromptVersions: { "triage-typing": "triage-typing@1" },
      claimModelVersion: "claude-sonnet-5",
      checkedAt: new Date("2026-09-09T09:40:00+12:00"),
      nliOutcome: "pass",
      publishedAt: new Date("2026-09-09T10:12:00+12:00"),
      evidence: [
        {
          authorityRef: "stats.govt.nz",
          seriesIdentity: "international-migration-monthly",
          vintageDate: "2026-01-31",
          plainReason: "Net migration peaked at 135,500 in the October 2023 year.",
          url: "https://www.stats.govt.nz/migration",
          retrievedAt: new Date("2026-09-09T09:35:00+12:00"),
        },
      ],
      promptVersions: {
        "triage-typing": "triage-typing@1",
        "grid-materiality": "grid-materiality@2",
        "nli-audit": "nli-audit@1",
        // A role this page does not know about — the store may legitimately
        // carry one (a new pipeline step shipping before the site does), and it
        // must still reach the reader.
        "brand-new-role": "brand-new-role@1",
      },
      sourceCodes: "T1",
      ...over,
    }),
  );

describe("section order is a design invariant (SITE-MVP §2.3)", () => {
  it("emits the fixed order: claim → verdict → (deployed) → (media) → evidence → trail", () => {
    const model = buildVerdictPageModel(
      input({
        verdictClass: "conflicting_cherry_picking",
        attachedProposal: "tougher sentencing package",
        mediaAnchor: {
          mediaUrl: "https://youtube.com?v=x",
          startS: 2.5,
          endS: 11.8,
          deepLink: "https://youtube.com?v=x&t=2.5s&end=11.8s",
        },
      }),
    );
    expect(model.sections.map((s) => s.kind)).toEqual([
      "claim",
      "verdict",
      "deployed",
      "media",
      "evidence",
      "trail",
    ]);
  });

  it("omits absent sections rather than rendering placeholders (no dead controls, SIT-R3)", () => {
    const model = buildVerdictPageModel(input({ verdictClass: "supported" }));
    expect(model.sections.map((s) => s.kind)).toEqual(["claim", "verdict", "evidence", "trail"]);
  });

  it("positions the verdict pin on the rule per class — left = refuted, right = supported", () => {
    for (const [cls, pos] of [
      ["refuted", 0],
      ["not_enough_evidence", 1],
      ["conflicting_cherry_picking", 2],
      ["supported", 3],
    ] as Array<[VerdictClass, number]>) {
      expect(buildVerdictPageModel(input({ verdictClass: cls })).verdictPosition).toBe(pos);
    }
  });
});

describe("register rules (SIT-R4/R5/R6)", () => {
  it("bans technical lexicon on public pages", () => {
    expect(() => assertRegisterSafe("Our sensitivity grid shows the alternatives.")).toThrow(
      /register violation/,
    );
    expect(() => assertRegisterSafe("We ran the NLI audit before publishing.")).toThrow(
      /register violation/,
    );
    expect(() => assertRegisterSafe("This claim came from a Tier-2 caption.")).toThrow(
      /register violation/,
    );
  });

  it("bans character statements and degree-slider vocabulary (ADR-0002/0004)", () => {
    expect(() => assertRegisterSafe("The Minister is dishonest about crime.")).toThrow(
      /register violation/,
    );
    expect(() => assertRegisterSafe("This claim is half-true.")).toThrow(/register violation/);
    expect(() => assertRegisterSafe("This claim is mostly false.")).toThrow(/register violation/);
  });

  it("accepts the ADR-0004 label set and plain summaries", () => {
    expect(() =>
      assertRegisterSafe(
        "Conflicting Evidence/Cherrypicking — The number is real, but the way it is framed changes the picture.",
      ),
    ).not.toThrow();
    for (const label of Object.values(VERDICT_LABELS)) {
      expect(() => assertRegisterSafe(`${label.label} — ${label.plainSummary}`)).not.toThrow();
      expect(() => assertRegisterSafe(`${label.plainLabel} — ${label.plainSummary}`)).not.toThrow();
    }
  });

  // Sept 2026: the published number was a hardcoded placeholder in the `ops/`
  // slice scripts with no adjudicator behind it, so SIT-R6 tightened from
  // "de-emphasise" to "do not publish": a confidence value is withheld until
  // ADR-0011's adjudication step exists and the harness calibrates it.
  it("publishes no confidence value, even when the store carries one (SIT-R6)", () => {
    const model = buildVerdictPageModel(input({ verdictClass: "supported", confidence: 0.81 }));
    const rendered = JSON.stringify(model.sections);
    expect(rendered).not.toContain("confidence");
    expect(rendered).not.toContain("0.81");
  });
});

describe("the trail: how this verdict was made (SITE-MVP §2.3)", () => {
  it("dates every step the store can date, in the order the work happened", () => {
    const { trail } = recorded({ verdictClass: "conflicting_cherry_picking" });
    expect(trail.steps.map((step) => step.id)).toEqual(["made", "logged", "compared", "decided"]);
    expect(trail.steps[0]?.dayLabel).toBe("Tue 8 Sept");
    expect(trail.steps[0]?.timeLabel).toBe("7:42 am");
    // A range inside one half of the day shares its meridiem.
    expect(trail.steps[1]?.timeLabel).toBe("9:10–9:26 am");
    expect(trail.steps[2]?.timeLabel).toBe("9:35 am");
    expect(trail.steps[3]?.timeLabel).toBe("9:40–10:12 am");
    expect(trail.steps[3]?.mark).toBe("answer");
  });

  it("headline states the checked date and how long after the claim it was", () => {
    expect(recorded({ verdictClass: "supported" }).trail.headline).toBe(
      "Checked 9 Sept 2026 — the day after the claim",
    );
    expect(
      recorded({
        verdictClass: "supported",
        claimMadeAt: new Date("2026-09-09T06:00:00+12:00"),
      }).trail.headline,
    ).toBe("Checked 9 Sept 2026 — the same day as the claim");
    expect(
      recorded({
        verdictClass: "supported",
        claimMadeAt: new Date("2026-09-04T06:00:00+12:00"),
      }).trail.headline,
    ).toBe("Checked 9 Sept 2026 — 5 days after the claim");
  });

  it("omits a step it has no date for rather than inventing one", () => {
    // No claim date, no ingestion date, no sources: the trail says what it knows
    // — that the check ran and published — and claims nothing else.
    const { trail } = buildVerdictPageModel(
      input({ verdictClass: "supported", publishedAt: new Date("2026-09-09T10:12:00+12:00") }),
    );
    expect(trail.steps.map((step) => step.id)).toEqual(["decided"]);
    expect(trail.headline).toBe("Checked 9 Sept 2026");
  });

  it("puts the load-bearing facts on the closed drawer, so nothing important needs a click", () => {
    const { trail } = recorded({ verdictClass: "conflicting_cherry_picking" });
    expect(trail.steps[2]?.hint).toBe("1 source · newest of them dated 31 Jan 2026");
    expect(trail.steps[3]?.hint).toBe("Accurate but incomplete · published 10:12 am");
    expect(trail.steps[1]?.hint).toBe("a number over a stated period → the official series");
  });

  it("says which dates a source carries, and links it", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const [source] = trail.steps[2]?.sources ?? [];
    expect(source?.title).toBe("international-migration-monthly");
    expect(source?.url).toBe("https://www.stats.govt.nz/migration");
    // Date-only vintages are calendar dates, so they must not slide a day when
    // the New Zealand offset is applied.
    expect(source?.dates).toBe("dated 31 Jan 2026 · retrieved 9 Sept 2026");
  });

  it("attributes the recorded prompt roles to the step they belong to (HAR-R7)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const logged = trail.steps[1]?.technical ?? "";
    const decided = trail.steps[3]?.technical ?? "";
    expect(logged).toContain("method stat-grid");
    expect(logged).toContain("triage-typing@1");
    expect(logged).not.toContain("grid-materiality@2");
    expect(decided).toContain("pipeline 0.1.0");
    expect(decided).toContain("verdict version 1");
    expect(decided).toContain("revisions 0");
    expect(decided).toContain("grid-materiality@2");
    expect(decided).toContain("nli-audit@1");
    // A role this page has never heard of is printed, not dropped: provenance
    // the reader cannot see is provenance that may as well not exist.
    expect(decided).toContain("brand-new-role@1");
  });

  it("reads honestly when there was nothing to compare the claim against", () => {
    const { trail } = recorded({ verdictClass: "not_enough_evidence", evidence: [] });
    expect(trail.steps.map((step) => step.id)).toEqual(["made", "logged", "decided"]);
    const text = (trail.steps.at(-1)?.body ?? []).map((part) => part.text).join(" ");
    expect(text).toContain("did not settle it");
    expect(text).not.toContain("Against 0 sources");
  });

  it("keeps internal vocabulary out of the public half of the trail (SIT-R4)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const publicCopy = trail.steps
      .flatMap((step) => [
        step.title,
        step.hint,
        step.why,
        ...step.body.map((part) => `${part.heading} ${part.text}`),
      ])
      .join("\n");
    // A technical failure class, a model name and the internal method name are
    // all present in this fixture — and none of them may reach public copy.
    for (const internal of ["nli-audit", "claude-", "stat-grid", "tier"]) {
      expect(publicCopy.toLowerCase()).not.toContain(internal);
    }
  });
});

describe("hear-it anchor contract (SIT-R3)", () => {
  it("href is the stored deep link, byte-exact — never re-derived", () => {
    const deepLink = "https://www.youtube.com/watch?v=qa1234567890&t=2.5s&end=11.8s";
    expect(anchorHref({ deepLink })).toBe(deepLink);
  });
});

describe("label set is the ADR-0004 mapping", () => {
  it("carries the four public labels with honest plain summaries", () => {
    expect(VERDICT_LABELS.supported.label).toBe("Supported");
    expect(VERDICT_LABELS.refuted.label).toBe("Refuted");
    expect(VERDICT_LABELS.not_enough_evidence.label).toBe("Not enough evidence");
    expect(VERDICT_LABELS.conflicting_cherry_picking.label).toBe(
      "Conflicting Evidence/Cherrypicking",
    );
  });

  it("carries the ADR-0004 public rendering the verdict band displays", () => {
    // The fourth class is the one AVeriTeC name that is not already plain
    // English, so ADR-0004 gives it a public rendering — the same string
    // `packages/store` publishes as ClaimReview `alternateName`.
    expect(VERDICT_LABELS.conflicting_cherry_picking.plainLabel).toBe("Accurate but incomplete");
    // The other three class names are their own public rendering.
    expect(VERDICT_LABELS.supported.plainLabel).toBe(VERDICT_LABELS.supported.label);
    expect(VERDICT_LABELS.refuted.plainLabel).toBe(VERDICT_LABELS.refuted.label);
    expect(VERDICT_LABELS.not_enough_evidence.plainLabel).toBe(
      VERDICT_LABELS.not_enough_evidence.label,
    );
  });
});
