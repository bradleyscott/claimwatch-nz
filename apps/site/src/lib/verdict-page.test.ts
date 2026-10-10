// SITE-MVP §2.3/§5 L1: section-order invariant, register rules, anchor href,
// claim-card shape. Authored red; requirements frozen, structural edits free.

import { ResearchLoopRecord, type ResearchLoopRecordInput } from "@cw/store";
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

/**
 * A research loop record, for tests that care what the trail says about it rather
 * than about its full shape. `loopOf` builds one turn; `loopWith` varies it.
 */
function loopOf(over: Partial<ResearchLoopRecordInput> = {}): ResearchLoopRecord {
  // Parsed rather than constructed, so the schema's defaults (strategy, queries,
  // toolCalls, evidenceFound) fill in and a fixture only states what the test is
  // about. The returned type is the parsed one, which is what the page consumes.
  return ResearchLoopRecord.parse({
    turns: [
      {
        round: 0,
        plan: {
          evidencePlan: "Find official migration figures for the period the claim names.",
          questions: ["What were net migration figures in the October 2023 year?"],
        },
        strategy: "Start from the official series the claim names.",
        queries: [
          "net migration October 2023 year stats nz",
          "net migration revised downwards October 2023",
        ],
        toolCalls: [
          { toolName: "search", input: { query: "net migration" }, resultSummary: "8 results" },
          {
            toolName: "readPage",
            input: { url: "https://www.stats.govt.nz/migration" },
            resultSummary: "2,400 chars",
          },
          {
            toolName: "extractEvidence",
            input: { question: "what was net migration in the October 2023 year?" },
            resultSummary: "1 passage",
          },
          {
            toolName: "finish",
            input: { reason: "the series states the figure" },
            resultSummary: "",
          },
        ],
        evidenceFound: [
          {
            url: "https://www.stats.govt.nz/migration",
            title: "International migration",
            domain: "stats.govt.nz",
            passage: "Net migration peaked at 135,500 in the October 2023 year.",
            tier: 1,
          },
        ],
        critique: {
          sufficient: true,
          verdictClass: "supported",
          confidence: 0.8,
          reason: "The official series states the figure the claim names.",
          gaps: [],
          justifications: ["Net migration peaked at 135,500 in the October 2023 year."],
        },
      },
    ],
    turnsUsed: 1,
    capBinding: 3,
    capped: false,
    reason: "The official series states the figure the claim names.",
    agreement: { agreed: true, classes: ["supported"] },
    ...over,
  });
}

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
  supports: null,
  claimPassage: null,
  policyTopic: null,
  mediaAnchor: null,
  transcriptTier: null,
  evidence: [],
  pipelineVersion: "0.1.0",
  promptVersions: { "claim-assessor": "claim-assessor@1" },
  modelVersions: { "claim-assessor": "model-x@v1" },
  searchRefs: [],
  sourceCodes: null,
  research: loopOf(),
  triageRecord: null,
  claimMadeAt: null,
  claimRecordedAt: null,
  sourceRetrievedAt: null,
  publisher: null,
  claimPromptVersions: {},
  claimModelVersion: null,
  checkedAt: null,
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
      // One turn, sufficient, agreed — the shape of a claim the loop settled.
      research: loopOf(),
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
      claimPromptVersions: { "triage-checkability": "triage-checkability@1" },
      claimModelVersion: "claude-sonnet-5",
      checkedAt: new Date("2026-09-09T09:40:00+12:00"),
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
        "triage-checkability": "triage-checkability@1",
        "claim-assessor": "claim-assessor@1",
        researcher: "researcher@1",
        "evidence-critiquer": "evidence-critiquer@1",
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
        supports: "tougher sentencing package",
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

  // SIT-R6: a confidence value is withheld until a step produces one AND the
  // harness calibrates it. Publishing an uncalibrated figure would claim a
  // measured statistical confidence the pipeline does not compute.
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

  it("states the plan the loop worked to, and the finding it reached", () => {
    // ADR-0026: one instrument, so there is no "which check" to select between.
    // What section 2 owes the reader is what evidence was sought; what section 3
    // owes them is what was found and what the critiquer made of it.
    const { trail } = recorded({ verdictClass: "supported" });
    const chosen = trail.sections.find((s) => s.kind === "chosen");
    expect(chosen?.facts.join(" ")).toContain("official migration figures");
    // The questions travel with the plan — the assessor writes questions, and they
    // include the ones that would disprove the claim.
    expect(chosen?.facts.join(" ")).toContain(
      "Question to answer: What were net migration figures in the October 2023 year?",
    );
    // The searches belong to the turn, not the plan, so section 2 does not carry
    // them.
    expect(chosen?.facts.join(" ")).not.toContain("Searched:");

    const check = trail.sections.find((s) => s.kind === "check");
    expect(check?.facts.join(" ")).toContain("1 source found");
    expect(check?.facts.join(" ")).toContain("official series states the figure");
  });

  it("renders the researcher's turn: its strategy, its searches and what it did", () => {
    // The researcher chooses how to answer the plan's questions, so the searches
    // and the tool calls are the record of ITS decisions — and the tool names are
    // internal, so each is translated rather than printed.
    const { trail } = recorded({ verdictClass: "supported" });
    const check = trail.sections.find((s) => s.kind === "check");
    const copy = check?.facts.join(" ") ?? "";
    expect(copy).toContain("Start from the official series the claim names.");
    expect(copy).toContain("Searched: net migration October 2023 year stats nz");
    expect(copy).toContain("Searched the web (8 results).");
    expect(copy).toContain("Read a page (2,400 chars).");
    expect(copy).toContain("Pulled passages from pages (1 passage).");
    // `finish` says nothing a reader needs: the turn ending already says it.
    expect(copy).not.toContain("finish");
    expect(copy).not.toContain("toolName");
    // And the internal tool names never reach the public copy.
    for (const internal of ["readPage", "extractEvidence", "toolCalls"]) {
      expect(copy).not.toContain(internal);
    }
    // The count of searches is on the plan's audit line, where the values belong.
    const chosen = trail.sections.find((s) => s.kind === "chosen");
    expect(chosen?.technical).toContain("searches 2");
    expect(chosen?.technical).toContain("questions 1");
  });

  it("shows every turn's plan, because a later plan answers the earlier critique", () => {
    // The assessor sees the previous critique and is asked again, so turn 2's
    // plan is a response to what turn 1 missed. Printing only the first would hide
    // the part a reader most needs.
    const { trail } = recorded({
      verdictClass: "not_enough_evidence",
      research: loopOf({
        turns: [
          {
            round: 0,
            plan: {
              evidencePlan: "Look for the department's own count.",
              questions: ["How many did the department count?"],
            },
            strategy: "Go straight to the department's own figures.",
            queries: ["department count", "department count disputed"],
            evidenceFound: [],
            critique: {
              sufficient: false,
              verdictClass: "not_enough_evidence",
              confidence: 0.3,
              reason: "No source states the figure the claim names.",
              gaps: ["no official count for the period claimed"],
              justifications: [],
            },
          },
          {
            round: 1,
            plan: {
              evidencePlan: "Look for the figure in the annual report instead.",
              questions: ["Does the annual report cover the period?"],
            },
            strategy: "The department page had nothing, so try the annual report.",
            queries: ["annual report figure", "annual report figure contradicted"],
            evidenceFound: [],
            critique: {
              sufficient: false,
              verdictClass: "not_enough_evidence",
              confidence: 0.3,
              reason: "The annual report does not cover the period either.",
              gaps: ["no official count for the period claimed"],
              justifications: [],
            },
          },
        ],
        turnsUsed: 2,
        capped: true,
      }),
    });
    const chosen = trail.sections.find((s) => s.kind === "chosen");
    expect(chosen?.facts.join(" ")).toContain("Turn 1:");
    expect(chosen?.facts.join(" ")).toContain("Turn 2:");
    expect(chosen?.facts.join(" ")).toContain("annual report");
    const check = trail.sections.find((s) => s.kind === "check");
    expect(check?.facts.join(" ")).toContain("Turn 1: 0 sources found.");
    expect(check?.facts.join(" ")).toContain("Turn 2: 0 sources found.");
  });

  it("declares what the loop cannot establish, always, and names the critiquer's gaps", () => {
    // A finding reported without its limit invites the reader to over-read it.
    const withGaps = recorded({
      verdictClass: "not_enough_evidence",
      research: loopOf({
        turns: [
          {
            round: 0,
            plan: {
              evidencePlan: "Find the figure.",
              questions: [],
            },
            evidenceFound: [],
            critique: {
              sufficient: false,
              verdictClass: "not_enough_evidence",
              confidence: 0.2,
              reason: "Nothing states it.",
              gaps: ["no official count for the period claimed", "no figure for the group named"],
              justifications: [],
            },
          },
        ],
        turnsUsed: 1,
        capped: true,
      }),
    });
    const gaps = withGaps.trail.sections.find((s) => s.kind === "check")?.bounds ?? [];
    expect(gaps).toHaveLength(2);
    expect(gaps.map((b) => b.text).join(" ")).toContain("no official count");

    // No gaps named: the loop's structural limit is stated instead. The bound is
    // NEVER empty when section 3 is present.
    const noGaps = recorded({ verdictClass: "supported" });
    const bound = noGaps.trail.sections.find((s) => s.kind === "check")?.bounds ?? [];
    expect(bound).toHaveLength(1);
    expect(bound[0]?.text).toContain("where the search stopped");
    expect(bound[0]?.text).toContain("never treated as proof that the claim is false");
  });

  it("names the cap as the reason the search stopped, when it bound", () => {
    const { trail } = recorded({
      verdictClass: "not_enough_evidence",
      research: loopOf({
        turns: [
          {
            round: 0,
            plan: {
              evidencePlan: "Find the figure.",
              questions: [],
            },
            evidenceFound: [],
            critique: {
              sufficient: false,
              verdictClass: "not_enough_evidence",
              confidence: 0.2,
              reason: "Nothing states it.",
              gaps: [],
              justifications: [],
            },
          },
        ],
        turnsUsed: 3,
        capBinding: 3,
        capped: true,
        reason: "The search cap was reached before the figure was found.",
      }),
    });
    const check = trail.sections.find((s) => s.kind === "check");
    expect(check?.facts.join(" ")).toContain("search cap of 3 turns was reached");
    expect(check?.technical).toContain("capped 3");
    // And section 5 says the cap, not the evidence, is why nothing was verified.
    const gate = trail.sections.find((s) => s.kind === "gate");
    expect(gate?.facts.join(" ")).toContain("before the search cap was reached");
    expect(gate?.facts.join(" ")).toContain("not a judgement that the claim is false");
  });

  it("states what the claim was used in support of, when the store holds it", () => {
    // `supports` is the argumentative point (ADR-0026). Absent stays absent: a
    // claim whose passage named no argument renders no line rather than a guess.
    const withSupports = recorded({
      verdictClass: "supported",
      supports: "the sentencing package",
    });
    expect(
      buildVerdictPageModel(
        input({ verdictClass: "supported", supports: "the sentencing package" }),
      ).sections.map((s) => s.kind),
    ).toContain("deployed");
    expect(withSupports.trail.sections.length).toBeGreaterThan(0);

    const without = buildVerdictPageModel(input({ verdictClass: "supported", supports: null }));
    expect(without.sections.map((s) => s.kind)).not.toContain("deployed");
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

  it("renders an absence — not a guess — for a claim with no recorded loop", () => {
    // A verdict with no loop record is in this state, so this is
    // a real state rather than an edge case. The page says what is missing; it
    // does not describe a check it cannot name.
    const { trail } = recorded({ verdictClass: "supported", research: null });
    const chosen = trail.sections.find((s) => s.kind === "chosen");
    const check = trail.sections.find((s) => s.kind === "check");
    expect(chosen?.absent).toBe(true);
    expect(check?.absent).toBe(true);
    expect(check?.bounds).toEqual([]);
    expect(check?.facts.join(" ")).toContain("We have no record of the research loop");
    expect(check?.technical).toContain("loop not recorded");
    // And section 2 says the plan was not written down rather than inventing one.
    expect(chosen?.facts.join(" ")).toContain("no record of the evidence plan");
    expect(chosen?.technical).toContain("plan not recorded");
  });

  it("renders an absence for a loop record that holds no turns", () => {
    // A record with an empty turn list is the same absence as no record: there is
    // nothing to describe, and an empty section would read as a check that found
    // nothing to say.
    const { trail } = recorded({ verdictClass: "supported", research: loopOf({ turns: [] }) });
    expect(trail.sections.find((s) => s.kind === "check")?.absent).toBe(true);
    expect(trail.sections.find((s) => s.kind === "chosen")?.absent).toBe(true);
  });

  it("says the class did not settle when the two runs disagreed (VER-R16)", () => {
    // A disagreement is a published state, not a hidden one: nothing was settled,
    // so "we could not verify this" went out rather than one of two answers.
    const { trail } = recorded({
      verdictClass: "not_enough_evidence",
      research: loopOf({
        agreement: { agreed: false, classes: ["supported", "refuted"] },
        reason: "The two runs reached different classes.",
      }),
    });
    const gate = trail.sections.find((s) => s.kind === "gate");
    expect(gate?.facts.join(" ")).toContain("did not agree");
    expect(gate?.facts.join(" ")).toContain("rather than choosing between two conflicting answers");
    expect(gate?.technical).toContain("agreement disagreed (supported, refuted)");
  });

  it("records the loop's own reason and agreement state on the audit line", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const gate = trail.sections.find((s) => s.kind === "gate");
    expect(gate?.facts.join(" ")).toContain("made twice, and both runs reached the same class");
    expect(gate?.technical).toContain("outcome The official series states the figure");
    expect(gate?.technical).toContain("agreement agreed (supported)");
  });

  it("renders an absence for a document record the store does not hold", () => {
    const { trail } = recorded({ verdictClass: "supported", triageRecord: null });
    const read = trail.sections.find((s) => s.kind === "read");
    expect(read?.absent).toBe(true);
    expect(read?.asides).toEqual([]);
    expect(read?.facts.join(" ")).toContain("cannot say how much of the document");
    expect(read?.technical).toContain("sentences not recorded");
  });

  it("states the sufficiency decision, and the cap when it bound", () => {
    // The gate is the critiquer's sufficiency decision (ADR-0026 §3), not a
    // separate entailment pass. A sufficient loop says so; a capped one says the
    // cap is why nothing was verified.
    const sufficient = recorded({ verdictClass: "supported" });
    expect(sufficient.trail.sections.find((s) => s.kind === "gate")?.facts.join(" ")).toContain(
      "judged sufficient to decide the claim",
    );
    expect(sufficient.trail.sections.find((s) => s.kind === "gate")?.facts.join(" ")).toContain(
      "had to cite a source we found",
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
    // The labels are English, so the key carries only the opaque value forms.
    // Every one of those must be defined, or the record is a riddle.
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
    // The labels are the register guard for the audit lines: those lines are
    // exempt from the scan, so an unreviewed label must fail loudly rather than
    // let prose onto a public page inside the exempt region.
    // Every shape the loop can take, because each puts different values on the
    // audit line — including the cap, which prints a bare number.
    for (const research of [
      loopOf(),
      loopOf({ capped: true, turnsUsed: 3, capBinding: 3 }),
      loopOf({ agreement: { agreed: false, classes: ["supported", "refuted"] } }),
    ]) {
      const { trail } = recorded({ verdictClass: "supported", research });
      for (const section of trail.sections) {
        expect(() => assertAuditLabelsKnown(section.technical)).not.toThrow();
      }
    }
    // The absence states are audit lines too, and the likeliest place for an
    // unreviewed label to be introduced by hand.
    for (const over of [{ research: null }, { triageRecord: null }]) {
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
    expect(() => assertAuditLabelsKnown("turns 3")).not.toThrow();
    expect(() => assertAuditLabelsKnown("capped 3")).not.toThrow();
    expect(() => assertAuditLabelsKnown("agreement disagreed (supported, refuted)")).not.toThrow();
    expect(() => assertAuditLabelsKnown("instructions evidence-critiquer@1")).not.toThrow();
    // A label that is not on the list fails, so an unreviewed one cannot ride
    // into a public page inside the audit line.
    expect(() => assertAuditLabelsKnown("checks triage-checkability")).toThrow(/no reviewed label/);
  });

  it("attributes the recorded prompt roles to the section they belong to (HAR-R7)", () => {
    const { trail } = recorded({ verdictClass: "supported" });
    const read = trail.sections.find((s) => s.kind === "read")?.technical ?? "";
    const check = trail.sections.find((s) => s.kind === "check")?.technical ?? "";
    const gate = trail.sections.find((s) => s.kind === "gate")?.technical ?? "";
    expect(read).toContain("triage-checkability@1");
    expect(read).not.toContain("claim-assessor@1");
    // The three loop roles belong to the check section: the assessor plans, the
    // researcher gathers, the critiquer decides.
    expect(check).toContain("claim-assessor@1");
    expect(check).toContain("researcher@1");
    expect(check).toContain("evidence-critiquer@1");
    expect(gate).toContain("ClaimWatch version 0.1.0");
    expect(gate).toContain("verdict version 1");
    expect(gate).toContain("never revised");
    // The critiquer's reason and the agreement state, as the run recorded them.
    expect(gate).toContain("outcome The official series states the figure");
    expect(gate).toContain("agreement agreed (supported)");
    expect(gate).toContain("evidence-critiquer@1");
    expect(gate).not.toContain("claim-assessor@1");
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
    // There is no check name to leak (ADR-0026: one instrument). What this guards
    // is the remaining route — the ROLE names on the audit line must not reach the
    // running copy.
    for (const research of [loopOf(), loopOf({ capped: true, turnsUsed: 3, capBinding: 3 })]) {
      const { trail } = recorded({ verdictClass: "supported", research });
      const check = trail.sections.find((s) => s.kind === "check");
      const copy = [...(check?.facts ?? []), ...(check?.bounds ?? []).map((b) => b.text)].join(" ");
      for (const role of ["claim-assessor", "evidence-critiquer", "researcher"]) {
        expect(copy).not.toContain(role);
      }
      // The role names stay on the audit line, where provenance belongs.
      expect(check?.technical).toContain("instructions");
    }
  });

  it("says nothing at all about a check it did not run (no boilerplate fill)", () => {
    // The failure mode this replaces: rendering a check's scaffolding with empty
    // values, which reads as a completed check. An absent section says only what
    // is missing.
    const { trail } = recorded({
      verdictClass: "supported",
      research: null,
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
