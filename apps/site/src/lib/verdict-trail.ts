// The mode-aware verdict trail (SITE-MVP §2.3, Sept 2026): the dated account of
// how a claim was checked, rendered per verification mode. Pure logic; public
// copy goes through the register check.

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
  TECHNICAL_RECORD_KEY,
} from "./verdict-register.ts";
import { CLAIM_TYPE_READING, modeDescription, resolveMode } from "./verification-mode.ts";

// ---------------------------------------------------------------------------
// "How this verdict was made" — the mode-aware trail (SITE-MVP §2.3, Sept 2026)
// ---------------------------------------------------------------------------
//
// House style, unchanged from the Sept 2026 revisions and now applied per
// section: every line is either a fact about THIS claim (its dates, its counts,
// its sources, its verdict) or — at most one per section — a single short
// sentence explaining the stage. Nothing restates the verdict card above, and
// nothing restates `/methodology`: the general explanation of a check lives
// there, and what appears here is that explanation applied to this claim.
//
// Sections, and which of them exist for a given claim:
//
//   1 read      the document this claim came from, and what was not checked
//   2 chosen    what the claim was read as, and which check that produced
//   3 check     THE MODE SECTION — one body per verification mode, plus the
//               bound that mode must declare, plus the decision it reached
//   4 sources   what we compared it against
//   5 gate      our own reasoning re-read against those sources
//
// Sections 1 and 3 can render as ABSENCES, and that is a designed state rather
// than a failure: a claim whose document record we do not hold, and a claim
// whose mode we do not hold, both say so. Neither substitutes a generic
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
   * What this check cannot establish (the mode's bound). Set on section 3 only,
   * and always present when section 3 describes a mode: a finding reported
   * without its limit invites the reader to over-read it.
   */
  bound: string | null;
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
  read: ["triage-checkability", "triage-typing", "triage-fingerprint", "triage-context"],
  chosen: [],
  check: [
    "citation-compare",
    "quote-fidelity",
    "open-web",
    "authority-classify",
    "claim-decompose",
    "research-assess",
    // Selects which readings of a series are material to how the claim is
    // deployed — the comparison itself, not the gate. Filed here rather than
    // under `gate` because the published copy for this section is what that
    // selection produced.
    "grid-materiality",
  ],
  sources: [],
  gate: ["nli-audit"],
};

/**
 * Sections a role may land on when the pipeline recorded it before the section
 * names existed. `read` and `chosen` share the triage roles; a role that belongs
 * to neither is printed on the last section rather than dropped.
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
  const resolved = resolveMode({
    verificationMode: input.verificationMode ?? null,
    claimType: input.claimType,
  });
  // The claim's own record and the verdict's provenance are two sides of the same
  // run: merged for bucketing, so a role written onto the claim (triage) and one
  // written onto the verdict (the check) both reach their section.
  const promptVersions: Record<string, string> = {
    ...input.promptVersions,
    ...input.claimPromptVersions,
  };

  // 1 · the document this claim came from, and what was not checked.
  sections.push(readSection(input, promptVersions));

  // 2 · what the claim was read as, and which check that produced.
  sections.push(chosenSection(input, resolved));

  // 3 · THE MODE SECTION — how this kind of check works, and what it did here.
  sections.push(checkSection(input, promptVersions, resolved));

  // 4 · what we compared it against.
  if (input.evidence.length > 0) sections.push(sourcesSection(input));

  // 5 · our own reasoning, re-read against those sources.
  sections.push(gateSection(input, promptVersions));

  const numbered: TrailSection[] = sections.map((section, index) => ({
    ...section,
    number: String(index + 1),
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
      section.bound ?? "",
      ...section.rows.flatMap((row) => [row.label, row.value]),
      ...section.sources.map((source) => `${source.title} ${source.finding} ${source.dates}`),
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
      bound: null,
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
  // The limit of this section, stated rather than implied (Sept 2026). Deciding
  // what CAN be checked is a judgement, not a rule, and it is made by a model —
  // so a re-check of the same document can draw the line differently. Two live
  // runs of one 47-sentence RNZ article returned 31 claims / 16 set aside and
  // then 42 / 5. A reader who treats this list as a settled property of the
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
    bound: null,
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
function kindLabel(input: VerdictPageInput): string {
  return input.claimType ? `kind ${input.claimType}` : "kind not recorded";
}

/** Section 2 — the reading, and the check it produced. */
function chosenSection(
  input: VerdictPageInput,
  resolved: { mode: string; source: "recorded" | "derived" } | null,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.claimRecordedAt]);
  const reading = input.claimType ? CLAIM_TYPE_READING[input.claimType] : undefined;
  if (!resolved) {
    return {
      kind: "chosen",
      title: "The check this claim got",
      when: whenLabel(span),
      facts: [
        "We have no record of which check this claim was sent to. The check ran and produced the verdict above, but the decision was not written down, so this page will not guess.",
      ],
      rows: [],
      asides: [],
      sources: [],
      decision: null,
      bound: null,
      absent: true,
      technical: line([
        `recorded ${span?.from.toISOString() ?? "not recorded"}`,
        "check not recorded",
      ]),
      mark: "none",
    };
  }
  return {
    kind: "chosen",
    title: "The check this claim got",
    when: whenLabel(span),
    facts: [
      reading
        ? `Read as ${reading}`
        : "Read as a statement a check could test, on the claim's own wording.",
      "That choice was made from the claim alone, before any evidence was gathered — it is the one decision that could not be made honestly once the answer was known.",
    ],
    rows: [],
    asides: [],
    sources: [],
    decision: null,
    bound: null,
    absent: false,
    technical: line([
      `recorded ${span?.from.toISOString() ?? "not recorded"}`,
      kindLabel(input),
      `check ${resolved.mode}`,
      resolved.source === "derived" ? "check derived from claim type" : null,
    ]),
    mark: "none",
  };
}

/** Section 3 — the mode body: how this check works, what it did, its limit. */
function checkSection(
  input: VerdictPageInput,
  promptVersions: Record<string, string>,
  resolved: { mode: string; source: "recorded" | "derived" } | null,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.checkedAt, ...input.evidence.map((item) => item.retrievedAt)]);
  const description = resolved ? modeDescription(resolved.mode) : null;

  if (!description || !resolved) {
    return {
      kind: "check",
      title: "How this claim was checked",
      when: whenLabel(span),
      facts: [
        "We have no record of which kind of check produced the verdict, so this page cannot explain how the comparison worked.",
      ],
      rows: [],
      asides: [],
      sources: [],
      decision: null,
      bound: null,
      absent: true,
      technical: line([
        `recorded ${span?.from.toISOString() ?? "not recorded"}`,
        "check not recorded",
      ]),
      mark: "answer",
    };
  }

  const facts: string[] = [description.whatItDoes, description.chosenWhen];
  const decision = decisionFor(input);

  // The anchor absence (VER-R5): a quotation check cannot compare words it
  // cannot locate, and says so rather than reporting a comparison it did not run.
  if (resolved.mode === "quote-fidelity" && !input.mediaAnchor) {
    facts.push(
      "No recording or transcript is linked to this claim, so the words could not be found and this check could not run. That is not the same as the quotation being misreported.",
    );
  }

  // One line, and only where it is true of this mode: a figures check reads
  // several vintages of the same series, and the vintage is half of what a
  // number means. It would be noise on a quotation check.
  if (resolved.mode === "stat-grid" && input.evidence.length > 1) {
    facts.push("A claim can hold up against old figures and fail against new ones.");
  }

  const rows: TrailRow[] = [];

  return {
    kind: "check",
    title: `How it was checked: ${description.label.toLowerCase()}`,
    when: whenLabel(span),
    facts,
    rows,
    asides: [],
    sources: [],
    decision,
    bound: description.cannot,
    absent: false,
    technical: line([
      `recorded ${span?.from.toISOString() ?? "not recorded"}`,
      `check ${resolved.mode}`,
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
    bound: null,
    absent: false,
    technical: line([
      `sources ${input.evidence.length}`,
      input.sourceCodes ? `source types ${input.sourceCodes}` : null,
    ]),
    mark: "none",
  };
}

/** Section 5 — the publication gate, and the publication itself. */
function gateSection(
  input: VerdictPageInput,
  promptVersions: Record<string, string>,
): Omit<TrailSection, "number"> {
  const span = spanOf([input.checkedAt, input.publishedAt]);
  const revisions = Math.max(0, input.verdictVersion - 1);
  const facts: string[] = [
    "Before publishing, a second pass re-read our reasoning against the sources. Its only job is to find claims the sources do not support.",
  ];
  // The publication gate (VERIFICATION §2.7): a failure is supposed to BLOCK the
  // verdict, so a published page carrying `fail` is a defect in whatever wrote it
  // — two slice scripts used to publish past a failed audit, one of them
  // recording "pass" without running the audit at all (Sept 2026, both fixed).
  // The line below still renders the stored outcome rather than hiding it.
  if (input.nliOutcome === "pass") {
    facts.push(
      "It agreed with the reasoning, so nothing here rests on a claim the sources do not support.",
    );
  } else if (input.nliOutcome) {
    facts.push(
      "The second pass did not pass. That is a defect in how this verdict was published — recorded here rather than hidden.",
    );
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
    bound: null,
    absent: false,
    technical: line([
      `ClaimWatch version ${input.pipelineVersion}`,
      `verdict version ${input.verdictVersion}`,
      `state ${input.verdictStatus}`,
      revisions === 0 ? "never revised" : `revised ${revisions} time${revisions === 1 ? "" : "s"}`,
      input.nliOutcome ? `outcome ${input.nliOutcome}` : null,
      `instructions ${promptVersionsFor("gate", promptVersions).join(", ") || "not recorded"}`,
      modelVersionsFor("gate", input.modelVersions).length > 0
        ? `model ${modelVersionsFor("gate", input.modelVersions).join(", ")}`
        : null,
    ]),
    mark: "answer",
  };
}
