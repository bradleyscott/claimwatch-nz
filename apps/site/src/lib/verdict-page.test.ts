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
import { PROCEDURE_DESCRIPTIONS } from "./verification-mode.ts";

const input = (
  over: Partial<VerdictPageInput> & { verdictClass: VerdictClass },
): VerdictPageInput => ({
  claimId: "c1",
  claimText: "Crime is up 30% since 2017.",
  speaker: "Hon Sample Minister",
  speakerVenue: "at a press conference",
  speakerAffiliation: "National",
  sourceUrl: "https://www.rnz.co.nz/news/politics/x",
  publishedAt: new Date("2026-09-08"),
  confidence: 0.72,
  attachedProposal: null,
  claimPassage: null,
  policyTopic: null,
  mediaAnchor: null,
  transcriptTier: null,
  evidence: [],
  pipelineVersion: "0.1.0",
  promptVersions: { "citation-compare": "citation-compare@1" },
  modelVersions: { "citation-compare": "model-x@v1" },
  searchRefs: [],
  sourceCodes: null,
  plan: planOf("open-web-research"),
  triageRecord: null,
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
      // The mode the ROUTER chose, not the one the claim type implies. For a
      // statistical claim those differ whenever the authority registry has no
      // entry for the domain, which is the common case (mode-routing.ts).
      plan: planOf("stat-grid"),
      // Triage's own output for the document this claim came from — the "what we
      // did not check" section. Two set aside, one held, out of eleven read.
      triageRecord: {
        sentencesRead: 11,
        checked: 1,
        setAside: [
          { sentenceText: "Communities deserve to feel safe.", rejectionClass: "opinion" },
          { sentenceText: "This is a war we intend to win.", rejectionClass: "rhetoric" },
        ],
        held: [
          {
            sentenceText: "We will have new laws in place this term.",
            reason: "A commitment: it can only be graded once the deadline it names has passed.",
          },
        ],
      },
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
        "citation-compare": "citation-compare@1",
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


/**
 * A one-step plan, for tests that only care which check the page describes.
 *
 * Plans replaced the single `verificationMode` (ADR-0023), so a test that used to
 * name a mode now names a procedure inside a plan. `planOf` keeps those tests
 * about the page rather than about the plan's shape; `plan.test.ts` in the
 * pipeline covers the shape, including multi-step plans.
 */
function planOf(procedureRef: string) {
  return {
    libraryVersion: "proc-lib-2026-09",
    features: {
      category: "test",
      assertsNumber: false,
      quotesPerson: false,
      citesDocument: false,
      attachesToProposal: false,
    },
    steps: [
      {
        procedureRef,
        procedureVersion: `${procedureRef}@1`,
        reason: "test",
        source: "required" as const,
        status: "ran" as const,
        declineReason: null,
        outcome: null,
      },
    ],
    notAttempted: [],
  };
}

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

describe("the mode-aware trail (SITE-MVP §2.3)", () => {
  it("emits the five sections in order, and only the ones its data supports", () => {
    const { trail } = recorded({ verdictClass: "conflicting_cherry_picking" });
    expect(trail.sections.map((section) => section.kind)).toEqual([
      "read",
      "chosen",
      "check",
      "sources",
      "gate",
    ]);
    expect(trail.sections.map((section) => section.number)).toEqual(["1", "2", "3", "4", "5"]);
    // The two sections that reached a conclusion carry the filled marker.
    expect(trail.sections.filter((s) => s.mark === "answer").map((s) => s.kind)).toEqual([
      "check",
      "gate",
    ]);
  });

  it("numbers the sections it renders, closing gaps when one drops", () => {
    // No evidence → no sources section, and the gate must not be numbered "5"
    // with a hole where "4" was.
    const { trail } = recorded({ verdictClass: "not_enough_evidence", evidence: [] });
    expect(trail.sections.map((section) => section.kind)).toEqual([
      "read",
      "chosen",
      "check",
      "gate",
    ]);
    expect(trail.sections.map((section) => section.number)).toEqual(["1", "2", "3", "4"]);
  });

  it("dates the sections the store can date, in the order the work happened", () => {
    const { trail } = recorded({ verdictClass: "conflicting_cherry_picking" });
    const when = trail.sections.map((section) => section.when);
    // Section 1 spans the document's retrieval and the claim's recording —
    // the two moments triage's read sits between.
    expect(when[0]).toBe("Wed 9 Sept · 9:10–9:26 am");
    expect(when[1]).toBe("Wed 9 Sept · 9:26 am"); // we recorded the claim
    // Ranges share a meridiem when both ends are in the same half of the day.
    expect(when[3]).toBe("Wed 9 Sept · 9:35 am");
    expect(when[4]).toBe("Wed 9 Sept · 9:40–10:12 am");
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
    expect(buildVerdictPageModel(input({ verdictClass: "supported" })).trail.headline).toBe(
      "Checked 8 Sept 2026",
    );
  });

  it("explains THIS claim's check, and never a different kind of check", () => {
    // The whole point of the mode-aware block: a claim checked against official
    // figures must not be explained with a citation check's copy, or vice versa.
    const statGrid = recorded({ verdictClass: "supported", plan: planOf("stat-grid") });
    const check = statGrid.trail.sections.find((s) => s.kind === "check");
    expect(check?.title).toBe("How it was checked: official figures");
    expect(check?.facts.join(" ")).toContain("official figures for it");
    expect(check?.facts.join(" ")).not.toContain("recording");

    const quote = recorded({
      verdictClass: "supported",
      plan: planOf("quote-fidelity"),
      mediaAnchor: {
        mediaUrl: "https://youtube.com?v=x",
        startS: 754,
        endS: 768,
        deepLink: "https://youtube.com?v=x&t=754s",
      },
      evidence: [],
    });
    const quoteCheck = quote.trail.sections.find((s) => s.kind === "check");
    expect(quoteCheck?.title).toBe("How it was checked: the recording");
    expect(quoteCheck?.facts.join(" ")).toContain("recording or transcript");
  });

  it("declares what the check cannot establish, on every mode", () => {
    // A finding reported without its limit invites the reader to over-read it.
    // The sharpest case is causation: no mode tests it, so every mode says so.
    for (const mode of [
      "stat-grid",
      "citation-check",
      "quote-fidelity",
      "provenance",
      "open-web-research",
    ]) {
      const { trail } = recorded({ verdictClass: "supported", plan: planOf(mode) });
      const check = trail.sections.find((s) => s.kind === "check");
      expect(check?.bounds.length, mode).toBeGreaterThan(0);
      expect((check?.bounds[0]?.text ?? "").length, mode).toBeGreaterThan(40);
    }
    const openWeb = recorded({ verdictClass: "supported", plan: planOf("open-web-research") });
    expect(
      openWeb.trail.sections
        .find((s) => s.kind === "check")
        ?.bounds.map((b) => b.text)
        .join(" "),
    ).toContain("cause");
  });

  it("reads the claim in the terms that produced the check", () => {
    const { trail } = recorded({ verdictClass: "supported", claimType: "broadcast-quote" });
    const chosen = trail.sections.find((s) => s.kind === "chosen");
    expect(chosen?.facts.join(" ")).toContain("a claim about what someone said");
    // The routing rule, stated as a rule — not restated as this claim's history.
    expect(chosen?.facts.join(" ")).toContain("before any evidence was gathered");
  });

  it("reports the sentences it did not check, with a plain reason", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const read = trail.sections.find((s) => s.kind === "read");
    expect(read?.facts[0]).toBe(
      "We read and classified 11 sentences from the document this claim came from. 1 became a claim; the rest could not be graded.",
    );
    expect(read?.asides.map((a) => a.sentenceText)).toEqual([
      "Communities deserve to feel safe.",
      "This is a war we intend to win.",
      "We will have new laws in place this term.",
    ]);
    // The stored class never reaches the page — the reader gets the reason
    // (SIT-R4). Two set aside; the third is HELD, which is not a drop.
    expect(JSON.stringify(read)).not.toContain("rejectionClass");
    expect(JSON.stringify(read)).not.toContain("rhetoric");
    expect(read?.asides.filter((a) => a.held)).toHaveLength(1);
    expect(read?.asides.find((a) => a.held)?.why).toContain("commitment");
    expect(read?.technical).toContain("sentences 11");
    expect(read?.technical).toContain("set aside 2");
    expect(read?.technical).toContain("held 1");
    // The section states its own limit: what can be checked is a judgement, and
    // a re-check may draw the line elsewhere. Two live runs of one 47-sentence
    // article gave 31/16 then 42/5, so a reader who treats this list as a
    // settled property of the document is reading a promise we do not make.
    expect(read?.facts.join(" ")).toContain(
      "Deciding what can be checked is a judgement made by a model",
    );
    expect(read?.facts.join(" ")).toContain("public revision path");
  });

  it("keeps the claim's own record on the trail when it has no section of its own", () => {
    // The "claim made" step was folded into section 1 rather than deleted: the
    // exact instant, the clip offset and the publisher are provenance and must
    // still be readable.
    const { trail } = recorded({
      verdictClass: "supported",
      mediaAnchor: {
        mediaUrl: "https://youtube.com?v=x",
        startS: 754,
        endS: 768,
        deepLink: "https://youtube.com?v=x&t=754s",
      },
    });
    const read = trail.sections.find((s) => s.kind === "read");
    expect(read?.technical).toContain("exact time 2026-09-07T19:42:00.000Z");
    expect(read?.technical).toContain("clip 12:34–12:48");
    expect(read?.technical).toContain("publisher Newstalk ZB");
  });

  it("carries each source's own finding, link and dates", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const sources = trail.sections.find((s) => s.kind === "sources");
    const source = sources?.sources[0];
    expect(source?.title).toBe("international-migration-monthly");
    expect(source?.url).toBe("https://www.stats.govt.nz/migration");
    // What this source says about the claim — the reader should not have to go
    // back up to the evidence card to find out.
    expect(source?.finding).toBe("Net migration peaked at 135,500 in the October 2023 year.");
    // Date-only vintages are calendar dates, so they must not slide a day when
    // the New Zealand offset is applied.
    expect(source?.dates).toBe("dated 31 Jan 2026 · fetched 9 Sept 2026");
  });

  it("says so when the check cannot run, instead of reporting one that did", () => {
    // A quotation check with no anchor (VER-R5). The page must distinguish "we
    // looked and the words could not be found" from "we did not look" — and it
    // must not render a comparison it never ran.
    const { trail } = recorded({
      verdictClass: "not_enough_evidence",
      plan: planOf("quote-fidelity"),
      mediaAnchor: null,
      evidence: [],
    });
    const check = trail.sections.find((s) => s.kind === "check");
    expect(check?.facts.join(" ")).toContain("could not be found");
    expect(check?.facts.join(" ")).toContain("could not run");
    expect(check?.absent).toBe(false); // the MODE is known; the comparison is not
  });

  it("renders an absence — not a guess — for a claim with no recorded check", () => {
    // Every verdict written before `claim.verification_mode` existed is in this
    // state, so this is the commonest case in the store today, not an edge case.
    const { trail } = recorded({ verdictClass: "supported", plan: null });
    const chosen = trail.sections.find((s) => s.kind === "chosen");
    const check = trail.sections.find((s) => s.kind === "check");
    expect(chosen?.absent).toBe(true);
    expect(check?.absent).toBe(true);
    expect(check?.bounds).toEqual([]);
    // It says what is missing rather than describing a check it cannot name.
    expect(check?.facts.join(" ")).toContain("We have no record of which checks");
    expect(check?.technical).toContain("checks not recorded");
  });

  it("never derives a check from the claim type, because a type is not a check", () => {
    // This test used to assert the opposite: `claimType → mode` was a partial
    // mapping, and for `statistical` it deliberately refused to derive (a
    // statistical claim reached the figures grid only on an authority-registry
    // hit). ADR-0023 removed the derivation entirely. The claim's type is
    // triage's answer about the sentence; the procedures it needs are the plan's,
    // and a type has never determined a check. So EVERY type renders an absence
    // when no plan was recorded, and there is nothing to infer.
    for (const claimType of [
      "statistical",
      "broadcast-quote",
      "citation-backed",
      "false-context",
      "other",
    ]) {
      const { trail } = recorded({ verdictClass: "supported", claimType, plan: null });
      const check = trail.sections.find((s) => s.kind === "check");
      expect(check?.absent, claimType).toBe(true);
      expect(check?.bounds, claimType).toEqual([]);
      // And the reasoning section says the plan was not written down, rather
      // than claiming a check it cannot name.
      expect(
        trail.sections.find((s) => s.kind === "chosen")?.technical,
        claimType,
      ).toContain("check not recorded");
    }
  });

  it("renders an absence for a document record the store does not hold", () => {
    const { trail } = recorded({ verdictClass: "supported", triageRecord: null });
    const read = trail.sections.find((s) => s.kind === "read");
    expect(read?.absent).toBe(true);
    expect(read?.asides).toEqual([]);
    expect(read?.facts.join(" ")).toContain("cannot say how much of the document");
    expect(read?.technical).toContain("sentences not recorded");
  });

  it("states the gate outcome, including when the second pass did not pass", () => {
    // A published verdict carrying a failed gate is a defect in whatever wrote
    // it. The page records it rather than hiding it (VERIFICATION §2.7).
    const failed = recorded({ verdictClass: "supported", nliOutcome: "fail" });
    const gate = failed.trail.sections.find((s) => s.kind === "gate");
    expect(gate?.facts.join(" ")).toContain("did not pass");
    expect(gate?.facts.join(" ")).toContain("defect");

    const passed = recorded({ verdictClass: "supported", nliOutcome: "pass" });
    expect(passed.trail.sections.find((s) => s.kind === "gate")?.facts.join(" ")).toContain(
      "agreed with the reasoning",
    );
  });

  it("warns when the wording came from an automatic transcript", () => {
    const { trail } = recorded({ verdictClass: "supported", transcriptTier: "publisher-auto" });
    expect(trail.sections.find((s) => s.kind === "gate")?.facts).toContain(
      "This wording comes from an automatic transcript and may contain errors.",
    );
    // And it is not said when the transcript was reviewed.
    const { trail: reviewed } = recorded({ verdictClass: "supported" });
    expect(
      reviewed.sections.some((section) =>
        section.facts.some((fact) => fact.includes("automatic transcript")),
      ),
    ).toBe(false);
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
    for (const mode of [
      "stat-grid",
      "citation-check",
      "quote-fidelity",
      "provenance",
      "open-web-research",
    ]) {
      const { trail } = recorded({ verdictClass: "supported", plan: planOf(mode) });
      for (const section of trail.sections) {
        expect(() => assertAuditLabelsKnown(section.technical)).not.toThrow();
      }
    }
    // The absence states are audit lines too, and the likeliest place for an
    // unreviewed label to be introduced by hand.
    for (const over of [
      { plan: null },
      { triageRecord: null },
      { plan: null, claimType: "statistical" },
    ]) {
      const { trail } = recorded({ verdictClass: "supported", ...over });
      for (const section of trail.sections) {
        expect(() => assertAuditLabelsKnown(section.technical)).not.toThrow();
      }
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
    expect(() => assertAuditLabelsKnown("sentences 11")).not.toThrow();
    expect(() => assertAuditLabelsKnown("set aside 9")).not.toThrow();
    // The guard polices labels only — a stored value is the record and is printed
    // as it was written, internal vocabulary and all (HAR-R7).
    expect(() => assertAuditLabelsKnown("checks stat-grid")).not.toThrow();
    expect(() => assertAuditLabelsKnown("instructions nli-audit@1")).not.toThrow();
  });

  it("attributes the recorded prompt roles to the section they belong to (HAR-R7)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const read = trail.sections.find((s) => s.kind === "read")?.technical ?? "";
    const check = trail.sections.find((s) => s.kind === "check")?.technical ?? "";
    const gate = trail.sections.find((s) => s.kind === "gate")?.technical ?? "";
    expect(read).toContain("triage-typing@1");
    expect(read).not.toContain("grid-materiality@2");
    expect(check).toContain("citation-compare@1");
    expect(check).toContain("model citation-compare: model-x@v1");
    // Which readings of the series are material is part of the comparison, so
    // its role is attributed there rather than to the publication gate.
    expect(check).toContain("grid-materiality@2");
    expect(gate).toContain("ClaimWatch version 0.1.0");
    expect(gate).toContain("verdict version 1");
    expect(gate).toContain("never revised");
    expect(gate).toContain("outcome pass");
    expect(gate).toContain("nli-audit@1");
    expect(gate).not.toContain("grid-materiality@2");
    // A role this page has never heard of is printed, not dropped: provenance
    // the reader cannot see is provenance that may as well not exist.
    expect(gate).toContain("brand-new-role@1");
  });

  it("reads honestly when there was nothing to compare the claim against", () => {
    const { trail } = recorded({ verdictClass: "not_enough_evidence", evidence: [] });
    expect(trail.sections.some((section) => section.kind === "sources")).toBe(false);
    const check = trail.sections.find((s) => s.kind === "check");
    expect(check?.decision).toBe(
      "No usable source was found, so the claim stays an open question rather than being graded.",
    );
    expect(JSON.stringify(trail)).not.toContain("Against 0 sources");
  });

  it("keeps internal vocabulary out of the public half of the trail (SIT-R4)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const publicCopy = trail.sections
      .flatMap((section) => [
        section.title,
        ...section.facts,
        section.decision ?? "",
        ...(section.bounds ?? []).map((b) => b.text),
        ...section.rows.flatMap((row) => [row.label, row.value]),
        ...section.sources.map((source) => `${source.title} ${source.dates}`),
        ...section.asides.map((aside) => aside.why),
      ])
      .join("\n");
    // A technical failure class, a model name, the internal method name and the
    // rejection classes are all present in this fixture — none may reach public
    // copy. (The quoted sentences themselves are exempt: they are the source
    // document's words, not ours.)
    for (const internal of ["nli-audit", "claude-", "stat-grid", "tier", "rhetoric", "opinion"]) {
      expect(publicCopy.toLowerCase()).not.toContain(internal);
    }
  });

  it("keeps the check's own name out of the copy that explains the check", () => {
    // The mode label is what triage ASSIGNED, and it carries a hyphenated
    // internal form. The title lowercases it into the running text ("How this
    // claim was checked: official figures"), which reads as English; the raw
    // value stays on the audit line where provenance belongs.
    for (const mode of [
      "stat-grid",
      "citation-check",
      "quote-fidelity",
      "provenance",
      "open-web-research",
    ]) {
      const { trail } = recorded({ verdictClass: "supported", plan: planOf(mode) });
      const check = trail.sections.find((s) => s.kind === "check");
      // The heading is built from the site's own plain-language label, so an
      // internal id can never become a public heading by being interpolated.
      const label = PROCEDURE_DESCRIPTIONS[mode]?.label.toLowerCase() ?? "";
      expect(check?.title, mode).toBe(`How it was checked: ${label}`);
      // The explanatory copy is ours; the recorded id stays on the audit line,
      // where provenance belongs.
      const copy = [...(check?.facts ?? []), ...(check?.bounds ?? []).map((b) => b.text)].join(" ");
      expect(copy, mode).not.toContain(mode);
      expect(check?.technical, mode).toContain(`checks ${mode}`);
    }
  });

  it("says nothing at all about a check it did not run (no boilerplate fill)", () => {
    // The failure mode this replaces: rendering a mode's scaffolding with empty
    // values, which reads as a completed check. An absent check says only what
    // is missing.
    const { trail } = recorded({
      verdictClass: "supported",
      plan: null,
      triageRecord: null,
    });
    const absent = trail.sections.filter((section) => section.absent);
    expect(absent.map((section) => section.kind)).toEqual(["read", "chosen", "check"]);
    for (const section of absent) {
      expect(section.facts.length).toBeGreaterThan(0);
      expect(section.bounds).toEqual([]);
      expect(section.decision).toBeNull();
      expect(section.rows).toEqual([]);
      expect(section.sources).toEqual([]);
      expect(section.asides).toEqual([]);
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
