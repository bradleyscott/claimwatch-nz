// SITE-MVP §2.3/§5 L1: section-order invariant, register rules, anchor href,
// claim-card shape. Authored red; requirements frozen, structural edits free.

import { describe, expect, it } from "vitest";
import {
  anchorHref,
  assertAuditLabelsKnown,
  assertRegisterSafe,
  buildVerdictPageModel,
  TECHNICAL_RECORD_KEY,
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
    expect(trail.steps.map((step) => step.title)).toEqual([
      "Claim made",
      "Logged and sorted",
      "We gathered the evidence",
      "Decided and published",
    ]);
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

  it("states each step's own facts, and repeats nothing from the verdict card", () => {
    const { trail } = recorded({ verdictClass: "conflicting_cherry_picking" });
    // What it is (speaker, verdict word, plain summary) belongs to the cards
    // above; each step carries only what happened to THIS claim at THAT stage.
    expect(trail.steps[0]?.facts).toEqual(["Newstalk ZB"]);
    expect(trail.steps[1]?.facts).toEqual([
      "Checked against the official figures for that number.",
    ]);
    expect(trail.steps[2]?.facts).toEqual(["1 source, newest dated 31 Jan 2026"]);
    expect(trail.steps[3]?.facts).toEqual([
      "Against 1 source: the evidence backs the numbers but not the framing.",
      "A second pass re-read the sources and agreed.",
      "Nothing has changed since.",
    ]);
    const publicCopy = trail.steps
      .flatMap((step) => [step.title, ...step.facts, step.note ?? ""])
      .join(" ");
    expect(publicCopy).not.toContain("Accurate but incomplete");
    expect(publicCopy).not.toContain("Hon Sample Minister");
  });

  it("keeps the claim's clip offset and publisher on the first step", () => {
    const { trail } = recorded({
      verdictClass: "supported",
      mediaAnchor: {
        mediaUrl: "https://zb.co.nz/x",
        startS: 160,
        endS: 178,
        deepLink: "https://zb.co.nz/x?t=160s",
      },
    });
    expect(trail.steps[0]?.facts).toEqual(["Newstalk ZB · clip from 2:40"]);
  });

  it("carries each source's own finding, link and dates", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const [source] = trail.steps[2]?.sources ?? [];
    expect(source?.title).toBe("international-migration-monthly");
    expect(source?.url).toBe("https://www.stats.govt.nz/migration");
    // What this source says about the claim — the reader should not have to go
    // back up to the evidence card to find out.
    expect(source?.finding).toBe("Net migration peaked at 135,500 in the October 2023 year.");
    // Date-only vintages are calendar dates, so they must not slide a day when
    // the New Zealand offset is applied.
    expect(source?.dates).toBe("dated 31 Jan 2026 · fetched 9 Sept 2026");
  });

  it("defines every value a reader cannot read off a plain label", () => {
    // The labels are English now, so the key no longer restates them — it
    // carries only the opaque value forms. Every one of those must be defined,
    // or the record is a riddle.
    const terms = TECHNICAL_RECORD_KEY.map((entry) => entry.term);
    for (const valueForm of ["name@version", "source type codes", "PUBLISHED", "not recorded"]) {
      expect(terms).toContain(valueForm);
    }
    // The key is scannable public copy, so it may not print a source code itself
    // — the code stays in the exempt audit line, and the key only says where to
    // read it. The render test's bare-code check is what enforces this; this is
    // the L1 half of the same rule.
    expect(JSON.stringify(TECHNICAL_RECORD_KEY)).not.toMatch(/T[1-6]\b/);
    // The four verdict states are all named, even though a page prints one: a
    // reader who meets a FROZEN verdict on an election-eve page should not have
    // to find out elsewhere that the record stopped moving on purpose.
    const states = TECHNICAL_RECORD_KEY.find((entry) => entry.term === "PUBLISHED");
    for (const state of ["CONTESTED", "FROZEN"]) {
      expect(states?.meaning).toContain(state);
    }
    // Every meaning is a sentence.
    for (const entry of TECHNICAL_RECORD_KEY) {
      expect(entry.meaning.length).toBeGreaterThan(20);
    }
    // The key is public copy: it goes through the same register check as the
    // trail, so it cannot smuggle in the vocabulary it exists to explain.
    expect(() =>
      assertRegisterSafe(
        TECHNICAL_RECORD_KEY.flatMap((entry) => [entry.term, entry.meaning]).join("\n"),
      ),
    ).not.toThrow();
  });

  it("labels every part of an audit line with a reviewed word (SITE-MVP §2.2 rule 4)", () => {
    // The labels are what replaced the key as the register guard: the audit lines
    // are exempt from the scan, so an unreviewed label must fail loudly rather
    // than let prose onto a public page inside the exempt region.
    const { trail } = recorded({ verdictClass: "supported" });
    for (const step of trail.steps) {
      expect(() => assertAuditLabelsKnown(step.technical)).not.toThrow();
    }
    expect(() => assertAuditLabelsKnown("remarks our grid liked the framing")).toThrow(
      /no reviewed label/,
    );
    // A value may not masquerade as a label, and a label may not be a prefix of
    // another label, or the two-source-type lines would be indistinguishable.
    expect(() => assertAuditLabelsKnown("source values T1, T6")).toThrow(/no reviewed label/);
    expect(() => assertAuditLabelsKnown("sources 3")).not.toThrow();
    expect(() => assertAuditLabelsKnown("source types T1, T6")).not.toThrow();
    expect(() => assertAuditLabelsKnown("revised 3 times")).not.toThrow();
    // The guard polices labels only — a stored value is the record and is printed
    // as it was written, internal vocabulary and all (HAR-R7).
    expect(() => assertAuditLabelsKnown("check stat-grid")).not.toThrow();
    expect(() => assertAuditLabelsKnown("instructions nli-audit@1")).not.toThrow();
  });

  it("attributes the recorded prompt roles to the step they belong to (HAR-R7)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const logged = trail.steps[1]?.technical ?? "";
    const declared = trail.steps[3]?.technical ?? "";
    expect(logged).toContain("check stat-grid");
    expect(logged).toContain("model claude-sonnet-5");
    expect(logged).toContain("triage-typing@1");
    expect(logged).not.toContain("grid-materiality@2");
    expect(declared).toContain("ClaimWatch version 0.1.0");
    expect(declared).toContain("verdict version 1");
    expect(declared).toContain("never revised");
    expect(declared).toContain("grid-materiality@2");
    expect(declared).toContain("nli-audit@1");
    // A role this page has never heard of is printed, not dropped: provenance
    // the reader cannot see is provenance that may as well not exist.
    expect(declared).toContain("brand-new-role@1");
  });

  it("reads honestly when there was nothing to compare the claim against", () => {
    const { trail } = recorded({ verdictClass: "not_enough_evidence", evidence: [] });
    expect(trail.steps.map((step) => step.id)).toEqual(["made", "logged", "decided"]);
    expect(trail.steps.at(-1)?.facts[0]).toBe("No usable source found: it stays an open question.");
    expect(JSON.stringify(trail)).not.toContain("Against 0 sources");
  });

  it("keeps internal vocabulary out of the public half of the trail (SIT-R4)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const publicCopy = trail.steps
      .flatMap((step) => [
        step.title,
        ...step.facts,
        step.note ?? "",
        ...step.sources.map((source) => `${source.title} ${source.dates}`),
      ])
      .join("\n");
    // A technical failure class, a model name and the internal method name are
    // all present in this fixture — and none of them may reach public copy.
    for (const internal of ["nli-audit", "claude-", "stat-grid", "tier"]) {
      expect(publicCopy.toLowerCase()).not.toContain(internal);
    }
  });

  it("warns when the wording came from an automatic transcript", () => {
    const { trail } = recorded({ verdictClass: "supported", transcriptTier: "publisher-auto" });
    expect(trail.steps[1]?.note).toBe(
      "This wording came from an automatic transcript and can contain errors.",
    );
    // The only explainer line otherwise: why the sources carry dates.
    const { trail: plain } = recorded({ verdictClass: "supported" });
    expect(plain.steps[2]?.note).toBe(
      "A claim can hold up against old figures and fail against new ones.",
    );
    expect(plain.steps.filter((step) => step.note !== null)).toHaveLength(1);
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
