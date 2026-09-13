// Verdict-page model (SITE-MVP §2.3): shapes store data into the FIXED
// section order, plain-language verdict copy, and register-safe strings.
// Pure logic — unit-tested at L1 for every input shape; L4a asserts a rendered
// page only where a fixture covers it.

import { rejectionDescription } from "./triage-labels.ts";
import { CLAIM_TYPE_READING, modeDescription, resolveMode } from "./verification-mode.ts";

export type VerdictClass =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";

/** ADR-0004 public label set — the only verdict words a page may carry. */
export const VERDICT_LABELS: Record<
  VerdictClass,
  {
    /** The class name, as published to ClaimReview/AVeriTeC consumers. */
    label: string;
    /**
     * The public rendering of the class (ADR-0004: "a rendering, not a
     * departure") — the wording the verdict band's stop legend uses, and the
     * same rendering `packages/store` publishes as ClaimReview `alternateName`.
     * Identical to `label` for the three classes whose class name is already
     * plain English; the fourth is the one AVeriTeC name that is not.
     */
    plainLabel: string;
    plainSummary: string;
  }
> = {
  supported: {
    label: "Supported",
    plainLabel: "Supported",
    plainSummary: "We verified this claim against the official data.",
  },
  refuted: {
    label: "Refuted",
    plainLabel: "Refuted",
    plainSummary: "The official data does not support this claim.",
  },
  not_enough_evidence: {
    label: "Not enough evidence",
    plainLabel: "Not enough evidence",
    plainSummary:
      "We could not verify this claim with the evidence available — it stays an open question.",
  },
  conflicting_cherry_picking: {
    label: "Conflicting Evidence/Cherrypicking",
    plainLabel: "Accurate but incomplete",
    plainSummary: "The number is real, but the way it is framed changes the picture.",
  },
};

const VERDICT_ORDER: VerdictClass[] = [
  "refuted",
  "not_enough_evidence",
  "conflicting_cherry_picking",
  "supported",
];

/** A sentence triage classified but did not turn into a claim (claim.triage_record). */
export interface TriageRecordInput {
  sentencesRead: number;
  checked: number;
  setAside: Array<{ sentenceText: string; rejectionClass: string }>;
  held: Array<{ sentenceText: string; reason: string }>;
}

export interface VerdictPageInput {
  claimId: string;
  claimText: string;
  speaker: string | null;
  speakerAffiliation: string | null;
  publishedAt: Date;
  verdictClass: VerdictClass;
  /**
   * Store field, deliberately NOT rendered (SITE-MVP §2.2 rule 2, revised Sept
   * 2026). Every value ever written came from a hardcoded placeholder in the
   * `ops/` slice scripts — no adjudicator produces it and no calibration backs
   * it, so publishing "Confidence: 70%" claimed a measured statistical
   * confidence the pipeline does not compute. It is republished as small meta
   * text only once ADR-0011's adjudication step lands *and* the harness
   * measures it (EVALUATION §3). Test: SIT-R6.
   */
  confidence: number | null;
  attachedProposal: string | null;
  mediaAnchor: { mediaUrl: string; startS: number; endS: number; deepLink: string } | null;
  transcriptTier: string | null;
  evidence: Array<{
    authorityRef: string;
    seriesIdentity: string;
    vintageDate: string;
    plainReason: string;
    /** Source link-out — absent for rows the check gave no URL for. */
    url?: string;
    /** When we fetched this source (evidence_item.retrieved_at). */
    retrievedAt?: Date | null;
  }>;
  pipelineVersion: string;
  promptVersions: Record<string, string>;
  modelVersions: Record<string, string>;
  searchRefs: string[];
  /** Raw source codes, provenance-only (SITE-MVP §2.2 rule 4). */
  sourceCodes: string | null;
  /** When the claim was made (claim.spoken_at); null when not recorded. */
  claimMadeAt: Date | null;
  /** When the claim record was created (claim.created_at). */
  claimRecordedAt: Date | null;
  /** When the source document was retrieved (publication.retrieved_at). */
  sourceRetrievedAt: Date | null;
  /** Store claim type — decides which method the claim got (TRIAGE). */
  claimType: string | null;
  /**
   * The check triage routed this claim to (claim.verification_mode, Sept 2026).
   * Null on every row written before the column existed — the trail then renders
   * an absent check rather than guessing, and never falls back to a guess for a
   * statistical claim, which can take either of two modes.
   */
  verificationMode?: string | null;
  /**
   * Triage's output for the document this claim came from (claim.triage_record):
   * how many sentences were read, which were set aside and why, which were held.
   * Null on older rows — the "what we did not check" section is omitted rather
   * than rendered with invented counts.
   */
  triageRecord?: TriageRecordInput | null;
  publisher: string | null;
  /** Roles recorded on the claim itself (claim.prompt_versions) — its triage. */
  claimPromptVersions: Record<string, string>;
  /** Model that typed the claim (claim.model_version); null when unrecorded. */
  claimModelVersion: string | null;
  /** When the evidence pack was assembled (evidence_pack.created_at). */
  checkedAt: Date | null;
  /** Publication gate outcome (evidence_pack.nli_outcome). */
  nliOutcome: string | null;
  /** Monotonic verdict version (1 = never revised). */
  verdictVersion: number;
  verdictStatus: string;
}

export interface VerdictSection {
  /** Render order is a design invariant (SITE-MVP §2.3). */
  kind: "claim" | "verdict" | "deployed" | "media" | "evidence" | "trail" | "related";
  data: unknown;
}

export interface VerdictPageModel {
  sections: VerdictSection[];
  label: string;
  plainSummary: string;
  verdictPosition: number; // 0..3 on the verdict rule, left = refuted
  /** The mode-aware account of the check (SITE-MVP §2.3, Sept 2026). */
  trail: VerdictTrail;
}

/** Banned on public pages (SIT-R4): technical register stays in provenance. */
const BANNED_LEXICON = [
  "sensitivity grid",
  "extraction ladder",
  "NLI audit",
  "Tier-2",
  "tier-2",
  "stratum",
  "discourse context",
  "fingerprint",
  "pgvector",
  "drizzle",
];

/** Banned verdict language (SIT-R5): character statements + degree sliders. */
const BANNED_PATTERNS = [
  /\b(is|are|was|were)\s+(a\s+)?(liar|dishonest|corrupt|untrustworthy)\b/i,
  /\bcompletely\s+(wrong|false)\b/i,
  /\babsolutely\s+(true|false)\b/i,
  /\bhalf[- ]true\b/i,
  /\bmostly\s+false\b/i,
  /\bpants[- ]on[- ]fire\b/i,
];

export function buildVerdictPageModel(input: VerdictPageInput): VerdictPageModel {
  const sections: VerdictSection[] = [];
  sections.push({
    kind: "claim",
    data: { claimText: input.claimText, speaker: input.speaker, publishedAt: input.publishedAt },
  });
  sections.push({
    kind: "verdict",
    data: { verdictClass: input.verdictClass },
  });
  if (input.attachedProposal) {
    sections.push({ kind: "deployed", data: { attachedProposal: input.attachedProposal } });
  }
  if (input.mediaAnchor) {
    sections.push({ kind: "media", data: input.mediaAnchor });
  }
  // Evidence always renders: with items, or as the honest empty state for
  // not-enough-evidence ("we could not verify this") — never a failure state
  // (SITE-MVP §2.5), never a placeholder-free gap.
  sections.push({ kind: "evidence", data: input.evidence });
  // The trail became mode-aware in Sept 2026: the same dated record, but the
  // section that explains HOW the comparison worked is the one belonging to the
  // check this claim actually got, rather than one shape stretched to cover all
  // five kinds of check.
  const trail = buildVerdictTrail(input);
  sections.push({ kind: "trail", data: trail });
  return {
    sections,
    label: VERDICT_LABELS[input.verdictClass].label,
    plainSummary: VERDICT_LABELS[input.verdictClass].plainSummary,
    verdictPosition: VERDICT_ORDER.indexOf(input.verdictClass),
    trail,
  };
}

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

/**
 * The key to the values the audit lines print (SITE-MVP §2.3, Sept 2026). The
 * lines label their own parts in plain words, so this defines only what a plain
 * label cannot carry: the form of a prompt version, the source-type codes, the
 * verdict states this page is not currently printing, and the sentinel the page
 * uses when the store held nothing.
 */
export const TECHNICAL_RECORD_KEY: ReadonlyArray<{ term: string; meaning: string }> = [
  {
    term: "name@version",
    meaning:
      "which set of instructions a step ran, and which version of them, written the way our system recorded it. A new number means the instructions changed; the version before it is kept, so a verdict can always be re-checked against the instructions that produced it. The section it sits under is where it belongs in the check.",
  },
  {
    term: "source type codes",
    meaning:
      "a one-letter code saying what kind of source each one is — official statistics, academic research, a major newsroom. The plain-language key to these codes is on the evidence card above; the codes themselves are what the check wrote down.",
  },
  {
    term: "PUBLISHED",
    meaning:
      "the state the verdict is in. This page says PUBLISHED once it is live and public, CONTESTED once someone has challenged it, and FROZEN once it is locked for the election period — from 5 Nov 2026 until the results are declared.",
  },
  {
    term: "not recorded",
    meaning:
      "we hold nothing for that field, so the record says so rather than filling the gap with a guess — what a section shows when nothing was written down for it.",
  },
];

/**
 * The labels an audit line may carry (SITE-MVP §2.2 rule 4, revised Sept 2026).
 * The audit lines are the one region the register scan cannot police — they
 * exist to print the raw values — so this list is what replaces it:
 * `assertAuditLabelsKnown` fails the build on a label nobody reviewed, rather
 * than letting prose ride onto a public page inside the exempt region. Adding a
 * label here means adding its definition to `TECHNICAL_RECORD_KEY`. Values are
 * deliberately NOT checked: a stored value is the record.
 */
export const AUDIT_LABELS: readonly string[] = [
  "exact time",
  "clip",
  "publisher",
  "recorded",
  "sentences",
  "checked",
  "set aside",
  "held",
  "kind",
  "check",
  "model",
  "instructions",
  "sources",
  "source types",
  "web searches",
  "ClaimWatch version",
  "verdict version",
  "state",
  "never revised",
  "revised",
  "outcome",
  "not recorded",
];

/**
 * Every part of an audit line must open with a reviewed label, or be a reviewed
 * phrase that carries its own meaning (`never revised`). A label may not be a
 * prefix of another label, so `sources 3` and `source types T1` cannot be
 * confused for each other — the test pins that. Called on every rendered audit
 * line by the builder.
 */
export function assertAuditLabelsKnown(auditLine: string): void {
  for (const part of auditLine.split(" · ")) {
    const known = AUDIT_LABELS.some((label) => part === label || part.startsWith(`${label} `));
    if (!known) {
      throw new Error(
        `audit line part "${part}" carries no reviewed label (SITE-MVP §2.2 rule 4) — add it to AUDIT_LABELS and define its value in TECHNICAL_RECORD_KEY, or state it in the section's facts instead`,
      );
    }
  }
}

/**
 * Times render in New Zealand time, explicitly. The server that renders these
 * pages is not necessarily in NZ (and a UTC server would date a 9pm Auckland
 * broadcast to the previous day) — so the zone is pinned here rather than left
 * to whatever the host happens to be set to. DST is IANA's business, not ours.
 */
const NZ_ZONE = "Pacific/Auckland";

/** "9 Sep 2026" — the date a reader compares against the claim's own date. */
function nzDate(date: Date, zone: string = NZ_ZONE): string {
  return date
    .toLocaleDateString("en-NZ", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    .replace(/\u202f|\u00a0/g, " ");
}

/** "Tue 8 Sep" — the day label. */
function nzDayLabel(date: Date): string {
  return date
    .toLocaleDateString("en-NZ", {
      timeZone: NZ_ZONE,
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(/\u202f|\u00a0/g, " ")
    .replace(/,/g, "");
}

/** "7:42 am" — lowercase, narrow-space normalised, so tests can pin it. */
function nzTimeLabel(date: Date): string {
  return date
    .toLocaleTimeString("en-NZ", { timeZone: NZ_ZONE, hour: "numeric", minute: "2-digit" })
    .replace(/\u202f|\u00a0/g, " ")
    .toLowerCase();
}

/** "2:40" — a clip offset as a reader reads it. */
function clipOffset(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/** Whole calendar days between two instants, counted in New Zealand days. */
function nzDayGap(from: Date, to: Date): number {
  const asDay = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: NZ_ZONE }); // YYYY-MM-DD
  const start = Date.parse(`${asDay(from)}T00:00:00Z`);
  const end = Date.parse(`${asDay(to)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** "the day after the claim", "the same day as the claim", "3 days after …". */
function relativeToClaim(claimMadeAt: Date, checkedAt: Date): string {
  const days = nzDayGap(claimMadeAt, checkedAt);
  if (days === 0) return "the same day as the claim";
  if (days === 1) return "the day after the claim";
  if (days > 1) return `${days} days after the claim`;
  return "before the claim was made";
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

/**
 * A stored date (evidence_item.vintage_date, "YYYY-MM-DD") in the reader's
 * words. A date-only value is a calendar date, not an instant: it renders in UTC
 * so "2026-01-31" reads "31 Jan 2026" rather than sliding into February when
 * the New Zealand offset is applied to a midnight timestamp.
 */
function readableDate(value: string): string {
  const dateOnly = value.length === 10;
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return nzDate(parsed, dateOnly ? "UTC" : NZ_ZONE);
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
        "This claim came out of a longer document. We do not hold a record of which other sentences were read and set aside for it, so this page cannot say how much of that document the verdict speaks to.",
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
    `${record.sentencesRead} sentence${record.sentencesRead === 1 ? "" : "s"} in the document this claim came from were read and classified. ${record.checked} became ${record.checked === 1 ? "a claim" : "claims"}; the rest could not be graded.`,
  ];
  if (setAsideCount > 0 || heldCount > 0) {
    facts.push(
      "What we did not check is listed below, so you can judge for yourself how much of the document this finding covers.",
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
    "Deciding what can be checked is a judgement made by a model from a versioned set of instructions, so re-checking the same document can draw this line differently; the verdict itself changes only through the public revision path.",
  );
  return {
    kind: "read",
    title: "What else was in the document, and what we did not check",
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
      title: "Which check this claim was given",
      when: whenLabel(span),
      facts: [
        "We do not hold a record of the kind of check this claim was routed to. The check ran and produced the verdict above, but the decision that selected it was not written down, so this page will not guess which one it was.",
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
    title: "Which check this claim was given",
    when: whenLabel(span),
    facts: [
      reading
        ? `Read as ${reading}`
        : "Read as a statement a check could test, on the claim's own wording.",
      "That choice was made from the claim itself, before any evidence was gathered — it is the one decision that cannot be made honestly once the answer is known.",
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
        "This page does not hold a record of which kind of check produced the verdict below, so it cannot explain how the comparison worked.",
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
      "No recording or transcript is linked to this claim, so the quoted words could not be located in any record — and this check could not run. That is not the same finding as a quotation being misreported.",
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
    title: `How this claim was checked: ${description.label.toLowerCase()}`,
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
    title: "What we compared it against",
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
    "Before publishing, our own reasoning was re-read against the sources by a separate pass whose only job is to find statements the evidence does not support.",
  ];
  // The publication gate (VERIFICATION §2.7): a failure is supposed to BLOCK the
  // verdict, so a published page carrying `fail` is a defect in whatever wrote it
  // — two slice scripts used to publish past a failed audit, one of them
  // recording "pass" without running the audit at all (Sept 2026, both fixed).
  // The line below still renders the stored outcome rather than hiding it.
  if (input.nliOutcome === "pass") {
    facts.push(
      "It agreed with all of the reasoning, so nothing published here rests on a statement the sources do not support.",
    );
  } else if (input.nliOutcome) {
    facts.push(
      "The second pass did not pass. That is a defect in how this verdict was published, and it is recorded rather than hidden.",
    );
  }
  if (input.transcriptTier === "publisher-auto") {
    facts.push("The claim's wording came from an automatic transcript and can contain errors.");
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

export function assertRegisterSafe(publicText: string): void {
  for (const banned of BANNED_LEXICON) {
    if (publicText.toLowerCase().includes(banned.toLowerCase())) {
      throw new Error(
        `register violation: "${banned}" must not appear on public pages (SIT-R4) — translate it or move it to the provenance block`,
      );
    }
  }
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(publicText)) {
      throw new Error(
        `register violation: verdict language outside the ADR-0004 label set (SIT-R5) — no character statements, no degree sliders`,
      );
    }
  }
}

/** Hear-it href built ONLY from the stored anchor (SIT-R3 — no re-derivation). */
export function anchorHref(anchor: { deepLink: string }): string {
  return anchor.deepLink;
}
