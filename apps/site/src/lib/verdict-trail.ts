// The verdict trail (SITE-MVP §2.3, ADR-0026): the dated account of how a claim
// was checked. Pure logic; public copy goes through the register check.

import type { ResearchLoopRecord } from "@cw/store";
import { rejectionDescription } from "./triage-labels.ts";
import {
  clipOffset,
  nzDate,
  nzDayGap,
  nzDayLabel,
  nzTimeLabel,
  readableDate,
  relativeToClaim,
} from "./verdict-dates.ts";
import type { VerdictClass, VerdictPageInput } from "./verdict-page.ts";
import {
  assertAuditLabelsKnown,
  assertRegisterSafe,
  sanitiseRegisterText,
  TECHNICAL_RECORD_KEY,
} from "./verdict-register.ts";

// ---------------------------------------------------------------------------
// "How this verdict was made" — the trail (SITE-MVP §2.3)
// ---------------------------------------------------------------------------
//
// House style, applied per section: every line is either a fact about THIS claim (its dates, its counts,
// its sources, its verdict) or — at most one per section — a single short
// sentence explaining the stage. Nothing restates the verdict card above, and
// nothing restates `/methodology`: the general explanation of a check lives
// there, and what appears here is that explanation applied to this claim.
//
// Sections, and which of them exist for a given claim:
//
//   1 read      the document this claim came from, and what was not checked
//   2 chosen    the evidence plan: what evidence would settle the claim, per turn
//   3 check     THE LOOP SECTION — what was sought, what was found, the
//               critiquer's finding, and the bound the loop must declare
//   4 sources   what we compared it against
//   5 gate      our own reasoning re-read against those sources
//
// Sections 1 and 3 can render as ABSENCES, and that is a designed state rather
// than a failure: a claim whose document record we do not hold, and a claim
// whose loop record we do not hold, both say so. Neither substitutes a generic
// paragraph for material it does not have, because an empty section is
// indistinguishable from a check that found nothing to say.
//
// NOT YET BUILT: a closing "where this check stops" section (what the check
// could not settle, and what would change the verdict). It needs the pipeline to
// record those two things; no column holds them today, and deriving them on the
// site would be inventing findings. The mode bound in section 3 carries the part
// of that job which IS derivable — what the check cannot establish.
//
// The audit lines label their own parts in plain words around verbatim values
// (`sentences 11 · checked 1 · set aside 9`). Labels are drawn from
// `AUDIT_LABELS` and values stay exactly as the check recorded them. The
// opaque value forms are defined in `TECHNICAL_RECORD_KEY`.

/** The trail's sections, in order. */
export type TrailSectionKind = "read" | "chosen" | "check" | "sources" | "gate";

export interface TrailSource {
  title: string;
  /** Source link-out; null when the row carried no URL. */
  url: string | null;
  /** What this source says that bears on the claim (evidence_item.plain_finding). */
  finding: string;
  /** "dated 30 Jun 2026 · fetched 9 Sept 2026" */
  dates: string;
}

/** A label/value line: the framing rows a figures check computes, and similar. */
export interface TrailRow {
  label: string;
  value: string;
  /** Marked by the check as changing what the claim means (grid materialRows). */
  material: boolean;
}

/** A sentence that was classified and set aside, with the plain reason. */
export interface TrailAside {
  sentenceText: string;
  /** Plain-language reason, never the stored class name (SIT-R4). */
  why: string;
  /** Held rather than set aside — a commitment owed a verdict, not a drop. */
  held: boolean;
}

export interface TrailSection {
  kind: TrailSectionKind;
  /** "1", "2", … — the reader's running order, gaps closed as sections drop. */
  number: string;
  title: string;
  /** "9 Sept · 9:10 am". Empty when the store holds no date for the section. */
  when: string;
  /** The section's variable facts, one line each. */
  facts: string[];
  /** Labelled rows, where the check produced them (e.g. framing readings). */
  rows: TrailRow[];
  /** Sentences classified but not checked — the honest edge of the finding. */
  asides: TrailAside[];
  sources: TrailSource[];
  /** The decision this section reached, where it reached one. */
  decision: string | null;
  /**
   * What each check that ran cannot establish, with the check it belongs to. Set
   * on section 3 only. Always present when section 3 describes a check: a finding
   * reported without its limit invites the reader to over-read it.
   *
   * A LIST, not one string: a bound printed once for several checks would attach
   * to the wrong finding.
   */
  bounds: Array<{ label: string; text: string }>;
  /** True when the section reports that something did NOT happen. */
  absent: boolean;
  /** The audit line: recorded counts, versions, timestamps. Always rendered. */
  technical: string;
  /** Filled marker on the section that reached the verdict. */
  mark: "none" | "answer";
}

export interface VerdictTrail {
  /** "Checked 9 Sept 2026 — the day after the claim" */
  headline: string;
  sections: TrailSection[];
}

/** What the evidence did to the claim, per verdict class (ADR-0004 wording). */
const DECISION_PHRASE: Record<VerdictClass, string> = {
  supported: "backs the claim as it was made.",
  refuted: "does not support the claim as it was made.",
  not_enough_evidence: "does not settle the claim either way.",
  conflicting_cherry_picking: "backs the numbers but not the framing.",
};

/**
 * Which section a recorded prompt role belongs to, by name. The site reads
 * provenance keys as opaque strings (it may not import pipeline source — the
 * package boundary in AGENTS.md), so this is a mapping over the published role
 * names, not a type import. Roles that match nothing are still printed, on the
 * final section, rather than being dropped (HAR-R7).
 */
const ROLES_BY_SECTION: Record<TrailSectionKind, string[]> = {
  // ADR-0025 makes triage two arms over one sentence, so triage is the only
  // thing recorded on the claim.
  read: ["triage-checkability", "triage-context"],
  chosen: [],
  check: ["claim-assessor", "researcher", "evidence-critiquer", "authority-classify"],
  sources: [],
  // The critiquer is the gate as well as the check (ADR-0026 §3): it decides
  // sufficiency, so its version belongs on both. Listed here too rather than
  // only under `check`, because a reader asking "what gated this?" is owed the
  // instructions that did it.
  gate: ["evidence-critiquer"],
};

/**
 * Every role the mapping knows about. A role belonging to no section is printed on
 * the last section rather than dropped, so provenance the mapping has not been
 * taught about still reaches the reader.
 */
const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.values(ROLES_BY_SECTION).flat());

function promptRolesFor(section: TrailSectionKind, versions: Record<string, string>): string[] {
  return Object.keys(versions).filter((role) =>
    section === "gate"
      ? ROLES_BY_SECTION.gate.includes(role) || !KNOWN_ROLES.has(role)
      : ROLES_BY_SECTION[section].includes(role),
  );
}

/** "role@1, other-role@1" for the roles that belong to one section. */
function promptVersionsFor(section: TrailSectionKind, versions: Record<string, string>): string[] {
  return promptRolesFor(section, versions)
    .map((role) => versions[role] ?? role)
    .filter((value) => value.length > 0);
}

function modelVersionsFor(section: TrailSectionKind, versions: Record<string, string>): string[] {
  return promptRolesFor(section, versions).map((role) => `${role}: ${versions[role]}`);
}

/** The earliest and latest of a set of instants — the section's own span. */
function spanOf(instants: Array<Date | null | undefined>): { from: Date; to: Date } | null {
  const times = instants.filter((value): value is Date => value instanceof Date);
  if (times.length === 0) return null;
  const settled = times.map((value) => value.getTime());
  return { from: new Date(Math.min(...settled)), to: new Date(Math.max(...settled)) };
}

/** "9:10–9:26 am" when the section's events are on different clock times. */
function timeRange(span: { from: Date; to: Date } | null): { dayLabel: string; timeLabel: string } {
  if (!span) return { dayLabel: "", timeLabel: "" };
  const dayLabel = nzDayLabel(span.to);
  if (span.from.getTime() === span.to.getTime()) {
    return { dayLabel, timeLabel: nzTimeLabel(span.to) };
  }
  if (nzDayGap(span.from, span.to) === 0) {
    const from = nzTimeLabel(span.from);
    const to = nzTimeLabel(span.to);
    // Two events inside the same recorded minute are one label, not a range
    // that reads as a bug ("3:14–3:14 am").
    if (from === to) return { dayLabel, timeLabel: to };
    // "9:10–9:26 am", not "9:10 am–9:26 am": the meridiem is shared when both
    // ends of the range are in the same half of the day.
    const shared = from.slice(-2) === to.slice(-2) ? from.slice(0, -3) : from;
    return { dayLabel, timeLabel: `${shared}–${to}` };
  }
  return { dayLabel, timeLabel: `${nzDayLabel(span.from)} – ${nzDayLabel(span.to)}` };
}

/** "9 Sept · 9:10–9:26 am" — the section header's date, or "" when undated. */
function whenLabel(span: { from: Date; to: Date } | null): string {
  const range = timeRange(span);
  if (!range.dayLabel) return "";
  return range.timeLabel ? `${range.dayLabel} · ${range.timeLabel}` : range.dayLabel;
}

/** Joins the parts of a line that exist, so optional fields never leave a gap. */
function line(parts: Array<string | null>): string {
  return parts.filter((part): part is string => part !== null && part.length > 0).join(" · ");
}

/**
 * Build the trail (SITE-MVP §2.3). A section whose material the store does not
 * hold renders as an absence with its reason; it is never filled with a
 * paraphrase, because an empty or generic section is indistinguishable from a
 * check that ran and found nothing.
 *
 * Public copy goes through the register check (`assertRegisterSafe`), so a
 * template edit cannot leak internal vocabulary onto a public page (SIT-R4). Two
 * regions are exempt, both scoped rather than wholesale: the technical lines
 * (§2.2 rule 4), and verbatim sentences quoted from the source document — a
 * quotation is not our copy, and scanning third-party text against our internal
 * lexicon would fail a page because an interviewee said "fingerprint".
 */
export function buildVerdictTrail(input: VerdictPageInput): VerdictTrail {
  const sections: Array<Omit<TrailSection, "number">> = [];
  // The research loop (ADR-0026). One instrument, so there is nothing to select
  // between: section 2 states the plan each turn produced and section 3 renders
  // what was found and what the critiquer made of it.
  const loop = input.research ?? null;
  // The claim's own record and the verdict's provenance are two sides of the same
  // run: merged for bucketing, so a role written onto the claim (triage) and one
  // written onto the verdict (the check) both reach their section.
  const promptVersions: Record<string, string> = {
    ...input.promptVersions,
    ...input.claimPromptVersions,
  };

  // 1 · the document this claim came from, and what was not checked.
  sections.push(readSection(input, promptVersions));

  // 2 · the evidence plan: what would settle this claim.
  sections.push(chosenSection(input, loop));

  // 3 · THE LOOP SECTION — what was sought, found, and concluded.
  sections.push(checkSection(input, promptVersions, loop));

  // 4 · what we compared it against.
  if (input.evidence.length > 0) sections.push(sourcesSection(input));

  // 5 · the sufficiency decision, the class agreement, and publication.
  sections.push(gateSection(input, promptVersions, loop));

  // Model-generated prose (a strategy, a reason, a justification) is data: a
  // banned term in it is translated rather than failing the build, and verbatim
  // source passages are left untouched because a quotation is the source's words.
  const numbered: TrailSection[] = sections.map((section, index) => ({
    ...section,
    number: String(index + 1),
    title: sanitiseRegisterText(section.title),
    facts: section.facts.map(sanitiseRegisterText),
    decision: section.decision == null ? null : sanitiseRegisterText(section.decision),
    bounds: section.bounds.map((bound) => ({
      label: sanitiseRegisterText(bound.label),
      text: sanitiseRegisterText(bound.text),
    })),
    rows: section.rows.map((row) => ({
      ...row,
      label: sanitiseRegisterText(row.label),
      value: sanitiseRegisterText(row.value),
    })),
    asides: section.asides.map((aside) => ({ ...aside, why: sanitiseRegisterText(aside.why) })),
    sources: section.sources.map((source) => ({
      ...source,
      title: sanitiseRegisterText(source.title),
      dates: sanitiseRegisterText(source.dates),
    })),
  }));

  // The audit lines are the one region the register scan cannot police (§2.2
  // rule 4), so their labels are checked against a reviewed allow-list instead:
  // an unreviewed label fails the build rather than riding into a public page
  // inside the exempt region.
  for (const section of numbered) assertAuditLabelsKnown(section.technical);

  // Quoted source sentences are excluded from the scan on purpose — see the
  // function comment. Everything else the page prints is scanned.
  const publicCopy = [
    ...numbered.flatMap((section) => [
      section.title,
      ...section.facts,
      section.decision ?? "",
      ...section.bounds.map((bound) => `${bound.label} ${bound.text}`),
      ...section.rows.flatMap((row) => [row.label, row.value]),
      ...section.sources.map((source) => `${source.title} ${source.dates}`),
      ...section.asides.map((aside) => aside.why),
    ]),
    // The key is public copy too — the one place internal values are named, so it
    // must not itself smuggle in vocabulary it exists to explain.
    ...TECHNICAL_RECORD_KEY.flatMap((entry) => [entry.term, entry.meaning]),
  ].join("\n");
  assertRegisterSafe(publicCopy);

  return {
    headline: input.claimMadeAt
      ? `Checked ${nzDate(input.publishedAt)} — ${relativeToClaim(input.claimMadeAt, input.publishedAt)}`
      : `Checked ${nzDate(input.publishedAt)}`,
    sections: numbered,
  };
}

/** Said when a stored rejection class has no description in the site's table. */
const SET_ASIDE_FALLBACK = "no evidence can settle it as stated.";

/** Section 1 — the document read, and what was set aside. */
function readSection(
  input: VerdictPageInput,
  promptVersions: Record<string, string>,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.sourceRetrievedAt, input.claimRecordedAt]);
  const record = input.triageRecord ?? null;
  // Two buckets, built separately rather than merged. A held sentence is not a
  // set-aside, and the plain reason for each comes from the SITE's own table
  // rather than from stored prose: published copy stays ours and stays
  // register-scanned, so a pipeline that writes an unvetted sentence into
  // `triage_record` cannot put it on a public page (SIT-R4).
  const asides: TrailAside[] = record
    ? [
        ...record.setAside.map((entry) => ({
          sentenceText: entry.sentenceText,
          why: rejectionDescription(entry.rejectionClass)?.description ?? SET_ASIDE_FALLBACK,
          held: false,
        })),
        ...record.held.map((entry) => ({
          sentenceText: entry.sentenceText,
          why: "a commitment that can only be graded once the deadline it names has passed.",
          held: true,
        })),
      ]
    : [];

  if (!record) {
    return {
      kind: "read",
      title: "What else was in the document",
      when: whenLabel(span),
      facts: [
        "This claim came out of a longer document. We have no record of which other sentences were read and set aside, so this page cannot say how much of the document the verdict covers.",
      ],
      rows: [],
      asides: [],
      sources: [],
      decision: null,
      bounds: [],
      absent: true,
      // The claim's own record — when it was said, where in the recording, and
      // who published it — rides on this section's audit line rather than having
      // a section of its own: the claim card above already carries the
      // attribution and the date, and a section that restates them would be the
      // duplication this block was rewritten to remove. The raw values are
      // provenance and stay visible either way.
      technical: line([
        `exact time ${input.claimMadeAt?.toISOString() ?? "not recorded"}`,
        input.mediaAnchor
          ? `clip ${clipOffset(input.mediaAnchor.startS)}–${clipOffset(input.mediaAnchor.endS)}`
          : null,
        input.publisher ? `publisher ${input.publisher}` : null,
        `recorded ${span?.from.toISOString() ?? "not recorded"}`,
        "sentences not recorded",
        input.claimModelVersion ? `model ${input.claimModelVersion}` : null,
        `instructions ${promptVersionsFor("read", promptVersions).join(", ") || "not recorded"}`,
      ]),
      mark: "none",
    };
  }

  const setAsideCount = record.setAside.length;
  const heldCount = record.held.length;
  const facts: string[] = [
    `We read and classified ${record.sentencesRead} sentence${record.sentencesRead === 1 ? "" : "s"} from the document this claim came from. ${record.checked} became ${record.checked === 1 ? "a claim" : "claims"}; the rest could not be graded.`,
  ];
  if (setAsideCount > 0 || heldCount > 0) {
    facts.push(
      "The sentences we did not check are listed below, so you can see how much of the document this finding covers.",
    );
  }
  // The limit of this section, stated rather than implied. Deciding
  // what CAN be checked is a judgement, not a rule, and it is made by a model —
  // so a re-check of the same document can draw the line differently: two runs of
  // one 47-sentence article returned 31 claims / 16 set aside and then 42 / 5. A
  // reader who treats this list as a settled property of the
  // document is reading a promise the system does not make; what IS stable is
  // that this page shows the line drawn by the run that produced its verdict,
  // and that the verdict itself moves only through the public revision path.
  facts.push(
    "Deciding what can be checked is a judgement made by a model, so a second run over the same document may draw the line in a different place. The verdict itself only changes through the public revision path.",
  );
  return {
    kind: "read",
    title: "What else was in the document",
    when: whenLabel(span),
    facts,
    rows: [],
    asides,
    sources: [],
    decision: null,
    bounds: [],
    absent: false,
    technical: line([
      `exact time ${input.claimMadeAt?.toISOString() ?? "not recorded"}`,
      input.mediaAnchor
        ? `clip ${clipOffset(input.mediaAnchor.startS)}–${clipOffset(input.mediaAnchor.endS)}`
        : null,
      input.publisher ? `publisher ${input.publisher}` : null,
      `recorded ${span?.from.toISOString() ?? "not recorded"}`,
      `sentences ${record.sentencesRead}`,
      `checked ${record.checked}`,
      `set aside ${setAsideCount}`,
      heldCount > 0 ? `held ${heldCount}` : null,
      input.claimModelVersion ? `model ${input.claimModelVersion}` : null,
      `instructions ${promptVersionsFor("read", promptVersions).join(", ") || "not recorded"}`,
    ]),
    mark: "none",
  };
}

/** "kind statistical" — the typing, for an audit line. */
/** Section 2 — the reading, and the check it produced. */
function chosenSection(
  input: VerdictPageInput,
  loop: ResearchLoopRecord | null,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.claimRecordedAt]);
  if (loop == null || loop.turns.length === 0) {
    return {
      kind: "chosen",
      title: "What evidence would settle this claim",
      when: whenLabel(span),
      facts: [
        "We have no record of the evidence plan for this claim. A check ran and produced the verdict above, but the plan was not written down, so this page will not guess what was sought.",
      ],
      rows: [],
      asides: [],
      sources: [],
      decision: null,
      bounds: [],
      absent: true,
      technical: line([
        `recorded ${span?.from.toISOString() ?? "not recorded"}`,
        "plan not recorded",
      ]),
      mark: "none",
    };
  }

  // One line per turn, because the plan CHANGES between turns: the assessor sees
  // the earlier critique and is asked again, so a later turn's plan is a response
  // to what the previous one missed. Printing only the first would hide the part a
  // reader most needs — what the loop learned it had not looked for.
  //
  // The questions travel with the plan because they are what the researcher works
  // through, and they include the questions that would DISPROVE the claim. The
  // searches themselves belong to the turn (section 3), because the assessor
  // writes questions and the researcher chooses how to answer them.
  const facts: string[] = [];
  for (const turn of loop.turns) {
    facts.push(
      loop.turns.length === 1
        ? turn.plan.evidencePlan
        : `Turn ${turn.round + 1}: ${turn.plan.evidencePlan}`,
    );
    for (const question of turn.plan.questions) {
      facts.push(`Question to answer: ${question}`);
    }
  }

  return {
    kind: "chosen",
    title: "What evidence would settle this claim",
    when: whenLabel(span),
    facts,
    rows: [],
    asides: [],
    sources: [],
    decision: null,
    bounds: [],
    absent: false,
    technical: line([
      `recorded ${span?.from.toISOString() ?? "not recorded"}`,
      `plans ${loop.turns.length}`,
      `questions ${loop.turns.reduce((sum, turn) => sum + turn.plan.questions.length, 0)}`,
      `searches ${loop.turns.reduce((sum, turn) => sum + turn.queries.length, 0)}`,
    ]),
    mark: "none",
  };
}

/**
 * What the researcher did, in plain words.
 *
 * The tool names are internal identifiers, so printing one would put vocabulary on
 * a public page that the register check bans and a reader cannot use. `finish`
 * returns null because "the researcher stopped" is already said by the turn
 * ending — the alternative is a line that reports nothing.
 *
 * An unrecognised tool returns its own name rather than being dropped: a tool the
 * site has not been taught about must be visible, not silently missing from the
 * record of what ran.
 */
function describeToolCall(toolName: string, resultSummary: string): string | null {
  const suffix = resultSummary.length > 0 ? ` (${resultSummary})` : "";
  switch (toolName) {
    case "search":
      return `Searched the web${suffix}.`;
    case "readPage":
      return `Read a page${suffix}.`;
    case "extractEvidence":
      return `Pulled passages from pages${suffix}.`;
    case "finish":
      return null;
    default:
      return `Used ${toolName}${suffix}.`;
  }
}

/**
 * The loop's own bound, in plain words.
 *
 * ADR-0026 §3 makes the critiquer state what the evidence cannot establish, and
 * section 3 must always carry a bound: a finding reported without its limit
 * invites the reader to over-read it. The critiquer's `gaps` are the specific
 * version; when it named none, the loop's structural limit is stated instead,
 * which is true of every run.
 */
const LOOP_BOUND =
  "This loop reports published evidence and where the search stopped. Finding nothing is reported as finding nothing — it is never treated as proof that the claim is false.";

/**
 * Section 3 — what the loop found, and what the critiquer made of it.
 *
 * One block per turn, because the record is a sequence: each turn's evidence was
 * gathered under that turn's plan, and the critiquer's reason for asking for
 * another turn is the most informative thing in the record. Collapsing the turns
 * into a total would lose exactly that.
 */
function checkSection(
  input: VerdictPageInput,
  promptVersions: Record<string, string>,
  loop: ResearchLoopRecord | null,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.checkedAt, ...input.evidence.map((item) => item.retrievedAt)]);

  if (loop == null || loop.turns.length === 0) {
    return {
      kind: "check",
      title: "How this claim was checked",
      when: whenLabel(span),
      facts: [
        "We have no record of the research loop for this claim, so this page cannot explain how the evidence was gathered.",
      ],
      rows: [],
      asides: [],
      sources: [],
      decision: null,
      bounds: [],
      absent: true,
      technical: line([
        `recorded ${span?.from.toISOString() ?? "not recorded"}`,
        "loop not recorded",
      ]),
      mark: "answer",
    };
  }

  const facts: string[] = [];
  for (const turn of loop.turns) {
    // The researcher's own words for the turn, when it gave any: the strategy is
    // what it set out to do, which is the reader's context for the searches that
    // follow.
    if (turn.strategy.length > 0) {
      facts.push(
        loop.turns.length === 1 ? turn.strategy : `Turn ${turn.round + 1}: ${turn.strategy}`,
      );
    }

    // The searches the researcher CHOSE and ran — the assessor writes questions,
    // not queries, so these are the researcher's own decisions and belong here
    // rather than in the plan.
    for (const query of turn.queries) {
      facts.push(`Searched: ${query}`);
    }

    // What the researcher did, in plain words. The tool names are internal, so
    // each is translated rather than printed: a reader needs to know that a page
    // was read, not which function read it.
    for (const call of turn.toolCalls) {
      const described = describeToolCall(call.toolName, call.resultSummary);
      if (described != null) facts.push(described);
    }

    const found = turn.evidenceFound.length;
    facts.push(`Turn ${turn.round + 1}: ${found} source${found === 1 ? "" : "s"} found.`);
    // The critiquer's reason is the finding, not commentary on it: it is what the
    // class was decided from, and for a turn that did not settle the claim it is
    // the statement of what was still missing.
    if (turn.critique.reason.length > 0) facts.push(turn.critique.reason);
  }

  if (loop.capped) {
    // A capped run is a finding about the record, named as one (ADR-0026 §2).
    facts.push(
      `The search cap of ${loop.capBinding} turn${loop.capBinding === 1 ? "" : "s"} was reached, so the search stopped there rather than the evidence running out. The verdict below is what the record supports at that point.`,
    );
  }

  // The bound: the critiquer's own gaps where it named them, else the loop's
  // structural limit. Never empty — see LOOP_BOUND.
  const gaps = loop.turns.flatMap((turn) => turn.critique.gaps);
  const bounds =
    gaps.length > 0
      ? gaps.map((gap, index) => ({
          label: `What is still open${gaps.length > 1 ? ` (${index + 1})` : ""}`,
          text: gap,
        }))
      : [{ label: "What this loop cannot establish", text: LOOP_BOUND }];

  return {
    kind: "check",
    title: "How this claim was checked",
    when: whenLabel(span),
    facts,
    rows: [],
    asides: [],
    sources: [],
    decision: decisionFor(input),
    bounds,
    absent: false,
    technical: line([
      `recorded ${span?.from.toISOString() ?? "not recorded"}`,
      `turns ${loop.turnsUsed}`,
      loop.capped ? `capped ${loop.capBinding}` : null,
      // The source count and codes live on the sources section, one section on;
      // repeating them here would print the same record twice.
      input.searchRefs.length > 0 ? `web searches ${input.searchRefs.length}` : null,
      `instructions ${promptVersionsFor("check", promptVersions).join(", ") || "not recorded"}`,
      modelVersionsFor("check", input.modelVersions).length > 0
        ? `model ${modelVersionsFor("check", input.modelVersions).join(", ")}`
        : null,
    ]),
    mark: "answer",
  };
}

/** What the evidence did to the claim, from the verdict class (ADR-0004). */
function decisionFor(input: VerdictPageInput): string | null {
  const count = input.evidence.length;
  if (count > 0) {
    return `Against ${count} source${count === 1 ? "" : "s"}: the evidence ${DECISION_PHRASE[input.verdictClass]}`;
  }
  if (input.verdictClass === "not_enough_evidence") {
    return "No usable source was found, so the claim stays an open question rather than being graded.";
  }
  return null;
}

/** Section 4 — the sources themselves. */
function sourcesSection(input: VerdictPageInput): Omit<TrailSection, "number"> {
  const span = spanOf(input.evidence.map((item) => item.retrievedAt));
  return {
    kind: "sources",
    title: "Sources we used",
    when: whenLabel(span),
    facts: [],
    rows: [],
    asides: [],
    sources: input.evidence.map((item) => ({
      title: item.seriesIdentity,
      url: item.url && item.url.length > 0 ? item.url : null,
      finding: item.plainReason,
      dates: line([
        item.vintageDate ? `dated ${readableDate(item.vintageDate)}` : null,
        item.retrievedAt ? `fetched ${nzDate(item.retrievedAt)}` : null,
      ]),
    })),
    decision: null,
    bounds: [],
    absent: false,
    technical: line([
      `sources ${input.evidence.length}`,
      input.sourceCodes ? `source types ${input.sourceCodes}` : null,
    ]),
    mark: "none",
  };
}

/**
 * Section 5 — the sufficiency decision, the class agreement, and publication.
 *
 * The gate is the critiquer's sufficiency decision (ADR-0026 §3), not a separate
 * entailment pass: the critiquer decides whether the evidence is sufficient AND
 * picks the class, so the entailment question is asked where the class is chosen
 * rather than after the prose is written. What remains to report here is that decision, the cap when it
 * bound, and the class-agreement gate (VER-R16) — the class-deciding call runs
 * twice and only an agreed class publishes, because the configured models ignore
 * sampling settings.
 */
function gateSection(
  input: VerdictPageInput,
  promptVersions: Record<string, string>,
  loop: ResearchLoopRecord | null,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.checkedAt, input.publishedAt]);
  const revisions = Math.max(0, input.verdictVersion - 1);
  const facts: string[] = [];

  if (loop == null) {
    facts.push(
      "We have no record of the decision that gated this verdict, so this page cannot say what settled it.",
    );
  } else if (loop.capped && !loop.turns.some((turn) => turn.critique.sufficient)) {
    facts.push(
      'The evidence did not settle the claim before the search cap was reached, so "we could not verify this" is the finding — not a failure to look, and not a judgement that the claim is false.',
    );
  } else {
    facts.push(
      "The evidence was judged sufficient to decide the claim, and every part of the reasoning had to cite a source we found. A conclusion the evidence did not support could not be published.",
    );
  }

  // The class-agreement gate (VER-R16). A disagreement is a real, published state:
  // nothing was settled, so `not_enough_evidence` went out rather than one of two
  // conflicting answers.
  if (loop != null && !loop.agreement.agreed) {
    facts.push(
      'The decision was made twice and the two runs did not agree, so the class was not settled. This page publishes "we could not verify this" rather than choosing between two conflicting answers.',
    );
  } else if (loop != null) {
    facts.push("The decision was made twice, and both runs reached the same class.");
  }

  if (input.transcriptTier === "publisher-auto") {
    facts.push("This wording comes from an automatic transcript and may contain errors.");
  }
  facts.push(
    revisions === 0
      ? "Nothing has changed since it was first published."
      : `It has been revised ${revisions} time${revisions === 1 ? "" : "s"} since; the earlier version stays visible.`,
  );

  return {
    kind: "gate",
    title: "Decided and published",
    when: whenLabel(span),
    facts,
    rows: [],
    asides: [],
    sources: [],
    decision: null,
    bounds: [],
    absent: false,
    technical: line([
      `ClaimWatch version ${input.pipelineVersion}`,
      `verdict version ${input.verdictVersion}`,
      `state ${input.verdictStatus}`,
      revisions === 0 ? "never revised" : `revised ${revisions} time${revisions === 1 ? "" : "s"}`,
      // The loop's own outcome, as recorded: its reason and whether the class
      // agreed. Both are values the run wrote down, never re-derived here.
      loop != null ? `outcome ${loop.reason}` : null,
      loop != null
        ? `agreement ${loop.agreement.agreed ? "agreed" : "disagreed"}${
            loop.agreement.classes.length > 0 ? ` (${loop.agreement.classes.join(", ")})` : ""
          }`
        : null,
      `instructions ${promptVersionsFor("gate", promptVersions).join(", ") || "not recorded"}`,
      modelVersionsFor("gate", input.modelVersions).length > 0
        ? `model ${modelVersionsFor("gate", input.modelVersions).join(", ")}`
        : null,
    ]),
    mark: "answer",
  };
}
