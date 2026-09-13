// Verdict-page model (SITE-MVP §2.3): shapes store data into the FIXED
// section order, plain-language verdict copy, and register-safe strings.
// Pure logic — unit-tested at L1 for every input shape; L4a asserts a rendered
// page only where a fixture covers it.

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
  /** The dated trail that replaces the old provenance block (SITE-MVP §2.3). */
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
  // The provenance block became the dated trail (Sept 2026): the same audit
  // content, ordered by when it happened, with the technical record behind one
  // control instead of a paragraph that restated the block's own heading.
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
// "How this verdict was made" — the dated trail (SITE-MVP §2.3, Sept 2026)
// ---------------------------------------------------------------------------
//
// House style for this block, decided after a first pass wrote far too much:
// every line is either a fact about THIS claim (its dates, its counts, its
// sources, its verdict) or — at most one per step — a single short sentence that
// explains the stage. Nothing restates the verdict card above or the methodology
// page, and the technical record is part of the reader's default view: no
// toggle, no collapsed content, nothing to click to see how a check was made.
// The reasoning behind that: an audit record a reader has to ask for is one most
// readers never see, and this block exists precisely to be seen.
//
// The audit lines carry plain labels around verbatim values (`ClaimWatch version
// 0.1.0 · state PUBLISHED · instructions triage-typing@1`), so a reader can read
// the line where it stands instead of holding six definitions in their head while
// they scroll down to a key. The labels are drawn from `AUDIT_LABELS`; the VALUES
// stay exactly as the check recorded them, because they are what ties this page to
// the run that produced it — a gloss can drift from the store, a stored value
// cannot. `TECHNICAL_RECORD_KEY` is now only what a reader genuinely cannot
// guess: the opaque value forms. Both live here so the register check can scan
// them.

/** The trail's four steps, in order. */
export type TrailStepId = "made" | "logged" | "compared" | "decided";

export interface TrailSource {
  title: string;
  /** Source link-out; null when the row carried no URL. */
  url: string | null;
  /** What this source says that bears on the claim (evidence_item.plain_finding). */
  finding: string;
  /** "dated 30 Jun 2026 · fetched 9 Sept 2026" */
  dates: string;
}

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
        `audit line part "${part}" carries no reviewed label (SITE-MVP §2.2 rule 4) — add it to AUDIT_LABELS and define its value in TECHNICAL_RECORD_KEY, or state it in the step's facts instead`,
      );
    }
  }
}

/**
 * The key under the trail (SITE-MVP §2.3, revised Sept 2026). The audit lines
 * label their own parts in plain words now, so this no longer decodes the line's
 * syntax — it defines the four things a plain label cannot carry: the form of a
 * prompt version, the source-type codes, the verdict states this page is not
 * currently printing, and the sentinel the page uses when the store held nothing.
 * Kept as data rather than prose in the component so the register check can scan
 * it: the key is public copy like any other, and it must not smuggle in the
 * vocabulary it exists to explain.
 *
 * A method code (`stat-grid`, `citation-check`) is deliberately absent: the
 * facts line directly above the audit line already states that check in plain
 * words, and the code sits underneath it as the record of which one ran.
 */
export const TECHNICAL_RECORD_KEY: ReadonlyArray<{ term: string; meaning: string }> = [
  {
    term: "name@version",
    meaning:
      "which set of instructions a step ran, and which version of them, written the way our system recorded it. A new number means the instructions changed; the version before it is kept, so a verdict can always be re-checked against the instructions that produced it. The step it sits under is where it belongs in the check.",
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
      "we hold nothing for that field, so the record says so rather than filling the gap with a guess — what a step shows when nothing was written down for it.",
  },
];

export interface TrailStep {
  id: TrailStepId;
  /** "Tue 8 Sep" — the rail's date. Empty when the step is undated. */
  dayLabel: string;
  /** "7:42 am", "9:10–9:26 am". Empty alongside `dayLabel`. */
  timeLabel: string;
  title: string;
  /** The step's variable facts, one line each. */
  facts: string[];
  sources: TrailSource[];
  /** One short line, where the stage needs one. Null when the facts suffice. */
  note: string | null;
  /**
   * The audit line: prompt/model/pipeline versions, source codes, timestamps.
   * Always rendered — it is the reason this block is trustworthy.
   */
  technical: string;
  /** Filled marker on the step that reached the verdict. */
  mark: "none" | "answer";
}

export interface VerdictTrail {
  /** "Checked 9 Sept 2026 — the day after the claim" */
  headline: string;
  steps: TrailStep[];
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

/** "Tue 8 Sep" — the rail label. */
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

/**
 * What the claim IS decides what it gets checked against (TRIAGE's typing step),
 * said as the check the reader is watching happen. Written as plain sentences on
 * purpose: the first version read "a number over a period → the official series"
 * and "no routine shape → the open web", which is our internal framing — the
 * reader has no reason to know we think in claim shapes at all.
 */
const METHOD_BY_CLAIM_TYPE: Record<string, { check: string; mode: string }> = {
  statistical: {
    check: "Checked against the official figures for that number.",
    mode: "stat-grid",
  },
  "citation-backed": { check: "Checked against the source it cites.", mode: "citation-check" },
  "institution-citation": {
    check: "Checked against that institution's own record.",
    mode: "citation-check",
  },
  "broadcast-quote": { check: "Checked against the recording.", mode: "quote-fidelity" },
  "false-context": {
    check: "Checked against whether the context around it holds.",
    mode: "provenance",
  },
  other: {
    check:
      "Checked against whatever we could find online — our least reliable method, and the one most worth contesting.",
    mode: "open-web",
  },
};

const UNTYPED_METHOD = {
  check: "Checked against the official record for it.",
  mode: "not recorded",
};

/** What the evidence did to the claim, per verdict class (ADR-0004 wording). */
const DECISION_PHRASE: Record<VerdictClass, string> = {
  supported: "backs the claim as it was made.",
  refuted: "does not support the claim as it was made.",
  not_enough_evidence: "does not settle the claim either way.",
  conflicting_cherry_picking: "backs the numbers but not the framing.",
};

/**
 * Which step a recorded prompt role belongs to, by name. The site reads
 * provenance keys as opaque strings (it may not import pipeline source — the
 * package boundary in AGENTS.md), so this is a mapping over the published role
 * names, not a type import. Roles that match nothing are still printed, on the
 * final step, rather than being dropped.
 */
const ROLES_BY_STEP: Record<TrailStepId, string[]> = {
  made: [],
  logged: ["triage-checkability", "triage-typing", "triage-fingerprint", "triage-context"],
  compared: [
    "citation-compare",
    "quote-fidelity",
    "open-web",
    "authority-classify",
    "claim-decompose",
    "research-assess",
  ],
  decided: ["grid-materiality", "nli-audit"],
};

/** Every role the steps above account for, by name. */
const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.values(ROLES_BY_STEP).flat());

function promptRolesFor(step: TrailStepId, versions: Record<string, string>): string[] {
  return Object.keys(versions).filter((role) =>
    step === "decided"
      ? ROLES_BY_STEP.decided.includes(role) || !KNOWN_ROLES.has(role)
      : ROLES_BY_STEP[step].includes(role),
  );
}

/** "role@1, other-role@1" for the roles that belong to one step. */
function promptVersionsFor(step: TrailStepId, versions: Record<string, string>): string[] {
  return promptRolesFor(step, versions)
    .map((role) => versions[role] ?? role)
    .filter((value) => value.length > 0);
}

function modelVersionsFor(step: TrailStepId, versions: Record<string, string>): string[] {
  return promptRolesFor(step, versions).map((role) => `${role}: ${versions[role]}`);
}

/** The earliest and latest of a set of instants — the step's own span. */
function spanOf(instants: Array<Date | null | undefined>): { from: Date; to: Date } | null {
  const times = instants.filter((value): value is Date => value instanceof Date);
  if (times.length === 0) return null;
  const settled = times.map((value) => value.getTime());
  return { from: new Date(Math.min(...settled)), to: new Date(Math.max(...settled)) };
}

/** "9:10–9:26 am" when the step's events are on different clock times. */
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
 * Build the trail (SITE-MVP §2.3). Steps whose dates the store does not hold are
 * omitted rather than rendered with a guessed one — a page that says "we logged
 * it on the 8th" when nothing recorded that is worse than a page whose trail
 * starts at the verdict.
 *
 * Public copy goes through the register check (`assertRegisterSafe`), so a
 * template edit cannot leak internal vocabulary onto a public page (SIT-R4). The
 * technical lines are the sanctioned exception (§2.2 rule 4) and are not
 * scanned.
 */
export function buildVerdictTrail(input: VerdictPageInput): VerdictTrail {
  const steps: TrailStep[] = [];
  const method =
    (input.claimType ? METHOD_BY_CLAIM_TYPE[input.claimType] : undefined) ?? UNTYPED_METHOD;
  // The claim's own record and the verdict's provenance are two sides of the same
  // run: merged for bucketing, so a role written onto the claim (triage) and one
  // written onto the verdict (the check) both reach their step.
  const promptVersions: Record<string, string> = {
    ...input.promptVersions,
    ...input.claimPromptVersions,
  };

  // 1 · the claim was made — needs the claim's own date (claim.spoken_at).
  if (input.claimMadeAt) {
    steps.push({
      id: "made",
      dayLabel: nzDayLabel(input.claimMadeAt),
      timeLabel: nzTimeLabel(input.claimMadeAt),
      title: "Claim made",
      facts: [
        line([
          input.publisher,
          input.mediaAnchor ? `clip from ${clipOffset(input.mediaAnchor.startS)}` : null,
        ]) || "in the record we logged",
      ],
      sources: [],
      note: null,
      technical: line([
        `exact time ${input.claimMadeAt.toISOString()}`,
        input.mediaAnchor
          ? `clip ${clipOffset(input.mediaAnchor.startS)}–${clipOffset(input.mediaAnchor.endS)}`
          : null,
        input.publisher ? `publisher ${input.publisher}` : null,
      ]),
      mark: "none",
    });
  }

  // 2 · we logged it and sorted it — needs a recorded ingestion time.
  const loggedSpan = spanOf([input.sourceRetrievedAt, input.claimRecordedAt]);
  if (loggedSpan) {
    const range = timeRange(loggedSpan);
    steps.push({
      id: "logged",
      dayLabel: range.dayLabel,
      timeLabel: range.timeLabel,
      title: "Logged and sorted",
      facts: [method.check],
      sources: [],
      note:
        input.transcriptTier === "publisher-auto"
          ? "This wording came from an automatic transcript and can contain errors."
          : null,
      technical: line([
        `recorded ${loggedSpan.from.toISOString()}`,
        `check ${method.mode}`,
        input.claimModelVersion ? `model ${input.claimModelVersion}` : null,
        `instructions ${promptVersionsFor("logged", promptVersions).join(", ") || "not recorded"}`,
      ]),
      mark: "none",
    });
  }

  // 3 · what we compared it against — one row per stored source.
  if (input.evidence.length > 0) {
    const count = input.evidence.length;
    const newest =
      input.evidence
        .map((item) => item.vintageDate)
        .filter((value) => value.length > 0)
        .sort()
        .at(-1) ?? null;
    const sourcesRange = timeRange(spanOf(input.evidence.map((item) => item.retrievedAt)));
    steps.push({
      id: "compared",
      dayLabel: sourcesRange.dayLabel,
      timeLabel: sourcesRange.timeLabel,
      title: "We gathered the evidence",
      facts: [
        `${count} source${count === 1 ? "" : "s"}${newest ? `, newest dated ${readableDate(newest)}` : ""}`,
      ],
      sources: input.evidence.map((item) => ({
        title: item.seriesIdentity,
        url: item.url && item.url.length > 0 ? item.url : null,
        finding: item.plainReason,
        dates: line([
          item.vintageDate ? `dated ${readableDate(item.vintageDate)}` : null,
          item.retrievedAt ? `fetched ${nzDate(item.retrievedAt)}` : null,
        ]),
      })),
      note: "A claim can hold up against old figures and fail against new ones.",
      technical: line([
        `sources ${count}`,
        input.sourceCodes ? `source types ${input.sourceCodes}` : null,
        `web searches ${input.searchRefs.length}`,
        `instructions ${promptVersionsFor("compared", promptVersions).join(", ") || "not recorded"}`,
      ]),
      mark: "none",
    });
  }

  // 4 · the verdict, the second pass and publication.
  const decidedSpan = spanOf([input.checkedAt, input.publishedAt]);
  const range = timeRange(decidedSpan);
  const count = input.evidence.length;
  const revisions = Math.max(0, input.verdictVersion - 1);
  const facts: string[] = [
    count > 0
      ? `Against ${count} source${count === 1 ? "" : "s"}: the evidence ${DECISION_PHRASE[input.verdictClass]}`
      : input.verdictClass === "not_enough_evidence"
        ? "No usable source found: it stays an open question."
        : "This check rested on the record above.",
  ];
  // The publication gate (VERIFICATION §2.7): the reasoning is re-read against
  // the sources before anything publishes, and a failure is supposed to BLOCK the
  // verdict. So a published page carrying `fail` is a defect in whatever wrote it
  // — two slice scripts used to publish past a failed audit, one of them
  // recording "pass" without running the audit at all (Sept 2026, both fixed).
  // The line below still renders the stored outcome rather than hiding it: a page
  // whose record says one thing and whose trail says another is worse than a page
  // that admits its second pass did not pass.
  if (input.nliOutcome === "pass") {
    facts.push("A second pass re-read the sources and agreed.");
  } else if (input.nliOutcome) {
    facts.push("The second pass on the reasoning did not pass.");
  }
  facts.push(
    revisions === 0
      ? "Nothing has changed since."
      : `Revised ${revisions} time${revisions === 1 ? "" : "s"} since.`,
  );
  steps.push({
    id: "decided",
    dayLabel: range.dayLabel,
    timeLabel: range.timeLabel,
    title: "Decided and published",
    facts,
    sources: [],
    note: null,
    technical: line([
      `ClaimWatch version ${input.pipelineVersion}`,
      `verdict version ${input.verdictVersion}`,
      `state ${input.verdictStatus}`,
      revisions === 0 ? "never revised" : `revised ${revisions} time${revisions === 1 ? "" : "s"}`,
      `instructions ${promptVersionsFor("decided", promptVersions).join(", ") || "not recorded"}`,
      modelVersionsFor("decided", input.modelVersions).length > 0
        ? `model ${modelVersionsFor("decided", input.modelVersions).join(", ")}`
        : null,
    ]),
    mark: "answer",
  });

  // The audit lines are the one region the register scan cannot police (§2.2
  // rule 4), so their labels are checked against a reviewed allow-list instead:
  // an unreviewed label fails the build rather than riding into a public page
  // inside the exempt region.
  for (const step of steps) assertAuditLabelsKnown(step.technical);

  const publicCopy = [
    ...steps.flatMap((step) => [
      step.title,
      ...step.facts,
      step.note ?? "",
      ...step.sources.map((source) => `${source.title} ${source.finding} ${source.dates}`),
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
    steps,
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
