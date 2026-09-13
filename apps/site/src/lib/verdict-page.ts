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

/**
 * The trail's four drawers, in order. Four rather than one-per-system-step
 * because the store records a timestamp per *document* (claim, publication,
 * evidence pack, verdict) and not per pipeline call — grouping is what keeps the
 * dates on this page true rather than plausible.
 */
export type TrailStepId = "made" | "logged" | "compared" | "decided";

export interface TrailSource {
  title: string;
  /** Source link-out; null when the row carried no URL. */
  url: string | null;
  /** What this source says that bears on the claim. */
  finding: string;
  /** "figures of 30 Jun 2026 · retrieved 9 Sep 2026" */
  dates: string;
}

export interface TrailStep {
  id: TrailStepId;
  /** "Tue 8 Sep" — the rail's date. Empty when the step is undated. */
  dayLabel: string;
  /** "7:42 am", "9:10–9:26 am". Empty alongside `dayLabel`. */
  timeLabel: string;
  title: string;
  /** Shown while the drawer is closed: the facts, without a click. */
  hint: string;
  body: Array<{ heading: string; text: string }>;
  /** Plain "why it matters" line. */
  why: string;
  sources: TrailSource[];
  /**
   * Monospace audit line — the one place technical vocabulary is permitted
   * (SITE-MVP §2.2 rule 4). Rendered behind the trail's single "show the
   * technical record" control, never in the reader's default view.
   */
  technical: string;
  /** "answer" fills the rail marker on the step that reached the verdict. */
  mark: "none" | "answer";
}

export interface VerdictTrail {
  /** "Checked 9 Sep 2026 — the day after the claim" */
  headline: string;
  intro: string;
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
 * What the claim IS decides what it gets checked against (TRIAGE's typing step) —
 * stated in the reader's words, and pointedly without naming the machinery.
 * `short` completes "we sorted it as …"; `check` completes "so it is checked
 * against …". An unrecognised or absent type says so instead of guessing.
 */
const METHOD_BY_CLAIM_TYPE: Record<
  string,
  { short: string; check: string; hint: string; mode: string }
> = {
  statistical: {
    short: "a claim about a number, over a stated period",
    check: "the official series for that number, rather than a news story about it",
    hint: "a number over a stated period → the official series",
    mode: "stat-grid",
  },
  "citation-backed": {
    short: "a claim that cites a source",
    check: "the source it cites",
    hint: "a claim citing a source → that source",
    mode: "citation-check",
  },
  "institution-citation": {
    short: "a claim attributed to an institution",
    check: "that institution's own record",
    hint: "a claim attributed to an institution → its own record",
    mode: "citation-check",
  },
  "broadcast-quote": {
    short: "something said in a broadcast",
    check: "the words as they were recorded",
    hint: "words said in a broadcast → the recording",
    mode: "quote-fidelity",
  },
  "false-context": {
    short: "a claim carrying its own context",
    check: "whether that context holds",
    hint: "a claim carrying its own context → whether it holds",
    mode: "provenance",
  },
  other: {
    short: "a claim outside the shapes we handle routinely",
    check: "the open web — our least reliable method, and the one most worth contesting",
    hint: "no routine shape → the open web",
    mode: "open-web",
  },
};

const UNTYPED_METHOD = {
  short: "a checkable claim",
  check: "the official record for it, or the open web where no record covers it",
  hint: "a checkable claim → the official record for it",
  mode: "not recorded",
};

/** What the evidence did to the claim, per verdict class (ADR-0004 wording). */
const DECISION_PHRASE: Record<VerdictClass, string> = {
  supported: "backs the claim as it was made.",
  refuted: "does not support the claim as it was made.",
  not_enough_evidence:
    "does not settle the claim either way — it stays an open question rather than getting a confident answer.",
  conflicting_cherry_picking:
    "backs the numbers but not the way they are framed — a real figure used in a way that changes the picture.",
};

/**
 * Which drawer a recorded prompt role belongs to, by name prefix. The site reads
 * provenance keys as opaque strings (it may not import pipeline source — the
 * package boundary in AGENTS.md), so this is deliberately a mapping over the
 * published role names, not a type import. Roles that match nothing are still
 * printed, on the final step, rather than being dropped.
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

/** Every role the drawers above account for, by name. */
const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.values(ROLES_BY_STEP).flat());

/**
 * The recorded roles belonging to one drawer. Roles this site does not
 * recognise go on the final step: a role recorded in the store must never be
 * invisible to a reader just because this mapping has not heard of it.
 */
function promptRolesFor(step: TrailStepId, promptVersions: Record<string, string>): string[] {
  return Object.keys(promptVersions).filter((role) =>
    step === "decided"
      ? ROLES_BY_STEP.decided.includes(role) || !KNOWN_ROLES.has(role)
      : ROLES_BY_STEP[step].includes(role),
  );
}

/** "role@1, other-role@1" for the roles that belong to one drawer. */
function promptVersionsFor(step: TrailStepId, promptVersions: Record<string, string>): string[] {
  return promptRolesFor(step, promptVersions)
    .map((role) => promptVersions[role] ?? role)
    .filter((value) => value.length > 0);
}

function modelVersionsFor(step: TrailStepId, modelVersions: Record<string, string>): string[] {
  return promptRolesFor(step, modelVersions).map((role) => `${role}: ${modelVersions[role]}`);
}

/** The earliest and latest of a set of instants — the drawer's own span. */
function spanOf(instants: Array<Date | null | undefined>): { from: Date; to: Date } | null {
  const times = instants.filter((value): value is Date => value instanceof Date);
  if (times.length === 0) return null;
  const settled = times.map((value) => value.getTime());
  return { from: new Date(Math.min(...settled)), to: new Date(Math.max(...settled)) };
}

/** "9:10–9:26 am" when the drawer's events are on different clock times. */
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

/**
 * Build the trail (SITE-MVP §2.3). Steps whose dates the store does not hold
 * are omitted rather than rendered with a guessed one — a page that says "we
 * logged it on the 8th" when nothing recorded that is worse than a page whose
 * trail starts at the verdict.
 *
 * Public copy goes through the register check (`assertRegisterSafe`) so a
 * template edit cannot leak internal vocabulary onto a public page (SIT-R4).
 */
export function buildVerdictTrail(input: VerdictPageInput): VerdictTrail {
  const steps: TrailStep[] = [];
  const method =
    (input.claimType ? METHOD_BY_CLAIM_TYPE[input.claimType] : undefined) ?? UNTYPED_METHOD;
  // The claim's own record and the verdict's provenance are two sides of the
  // same run: merged for bucketing, so a role written onto the claim (triage)
  // and one written onto the verdict (the check) both reach their drawer.
  const promptVersions: Record<string, string> = {
    ...input.promptVersions,
    ...input.claimPromptVersions,
  };

  // 1 · the claim was made — needs the claim's own date (claim.spoken_at).
  if (input.claimMadeAt) {
    const where = [
      input.publisher ?? null,
      input.mediaAnchor ? `at ${clipOffset(input.mediaAnchor.startS)} in the recording` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
    const who = [input.speaker, input.speakerAffiliation].filter(Boolean).join(", ");
    steps.push({
      id: "made",
      dayLabel: nzDayLabel(input.claimMadeAt),
      timeLabel: nzTimeLabel(input.claimMadeAt),
      title: "The claim was made",
      hint: where.length > 0 ? where : "in the record we found it in",
      body: [
        ...(who.length > 0 ? [{ heading: "", text: `${who}.` }] : []),
        {
          heading: "",
          text: "The wording we check is quoted from the record itself, never from a report of it.",
        },
      ],
      why: "We check the words that were actually said — checking someone's summary would be checking a different claim.",
      sources: [],
      technical: [
        `claim spoken ${input.claimMadeAt.toISOString()}`,
        input.mediaAnchor
          ? `clip ${clipOffset(input.mediaAnchor.startS)}–${clipOffset(input.mediaAnchor.endS)}`
          : null,
        input.publisher ? `publication ${input.publisher}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      mark: "none",
    });
  }

  // 2 · we logged it, and sorted it — needs a recorded ingestion time.
  const loggedSpan = spanOf([input.sourceRetrievedAt, input.claimRecordedAt]);
  if (loggedSpan) {
    const range = timeRange(loggedSpan);
    // One recorded instant for both events (they land in the same minute on a
    // short ingest) reads as a bug if the heading repeats the clock time, so it
    // says what is true instead: both happened at that moment.
    const sameInstant = loggedSpan.from.getTime() === loggedSpan.to.getTime();
    steps.push({
      id: "logged",
      dayLabel: range.dayLabel,
      timeLabel: range.timeLabel,
      title: "We logged it, and worked out what to check it against",
      hint: method.hint,
      body: [
        {
          heading: `Logged at ${nzTimeLabel(loggedSpan.from)}, before any checking began`,
          text: "The claim was saved with the record it came from. From this point it can be added to but not edited — so the wording cannot be adjusted to fit the answer.",
        },
        ...(input.transcriptTier === "publisher-auto"
          ? [
              {
                heading: "",
                text: "The wording comes from a transcript published automatically, which can contain errors.",
              },
            ]
          : []),
        {
          heading: sameInstant
            ? "Sorted at the same moment"
            : `Sorted at ${nzTimeLabel(loggedSpan.to)}`,
          text: `We sorted it as ${method.short}, so it is checked against ${method.check}.`,
        },
      ],
      why: "The method follows from what the claim is, and is fixed before we know the answer — so the same kind of claim always gets the same kind of check.",
      sources: [],
      technical: [
        `recorded ${loggedSpan.from.toISOString()}`,
        `method ${method.mode}`,
        input.claimModelVersion ? `model ${input.claimModelVersion}` : null,
        `prompts ${promptVersionsFor("logged", promptVersions).join(", ") || "none recorded"}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      mark: "none",
    });
  }

  // 3 · what we compared it against — one row per stored source.
  if (input.evidence.length > 0) {
    const count = input.evidence.length;
    const vintages = input.evidence
      .map((item) => item.vintageDate)
      .filter((value) => value.length > 0)
      .sort();
    const newest = vintages.at(-1) ?? null;
    const sources: TrailSource[] = input.evidence.map((item) => ({
      title: item.seriesIdentity,
      url: item.url && item.url.length > 0 ? item.url : null,
      finding: item.plainReason,
      dates: [
        item.vintageDate ? `dated ${readableDate(item.vintageDate)}` : null,
        item.retrievedAt ? `retrieved ${nzDate(item.retrievedAt)}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
    }));
    const datedSources = input.evidence.map((item) => item.retrievedAt);
    const sourcesSpan = spanOf(datedSources);
    const sourcesRange = timeRange(sourcesSpan);
    steps.push({
      id: "compared",
      dayLabel: sourcesRange.dayLabel,
      timeLabel: sourcesRange.timeLabel,
      title: `What we compared it against — ${count} source${count === 1 ? "" : "s"}`,
      hint: [
        `${count} source${count === 1 ? "" : "s"}`,
        newest ? `newest of them dated ${readableDate(newest)}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      body: [],
      sources,
      why: "Each source carries the date of the figures it holds — the same claim can hold up against older figures and fail against newer ones, so the date is part of the answer.",
      technical: [
        `evidence items ${count}`,
        `prompts ${promptVersionsFor("compared", promptVersions).join(", ") || "none recorded"}`,
        input.sourceCodes ? `evidence source codes: ${input.sourceCodes}` : null,
        `search queries recorded ${input.searchRefs.length}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      mark: "none",
    });
  }

  // 4 · the verdict, the second pass on the reasoning, and publishing.
  const decidedSpan = spanOf([input.checkedAt, input.publishedAt]);
  const range = timeRange(decidedSpan);
  const body: Array<{ heading: string; text: string }> = [];
  const count = input.evidence.length;
  const decidedText =
    count > 0
      ? `Against ${count} source${count === 1 ? "" : "s"}, the evidence ${DECISION_PHRASE[input.verdictClass]}`
      : input.verdictClass === "not_enough_evidence"
        ? "The sources we could use did not settle it, so it stays an open question rather than getting a confident answer."
        : "This check rested on the record above rather than on an outside source.";
  if (decidedSpan) {
    body.push({
      heading: `Decided at ${nzTimeLabel(decidedSpan.from)}`,
      text: decidedText,
    });
  }
  // The publication gate has no timestamp of its own in the store — the pack
  // carries one `created_at` for the whole check — so this paragraph is dated by
  // its position (after deciding, before publishing) rather than by a clock time
  // it would be borrowing from the step above.
  if (input.nliOutcome === "pass") {
    body.push({
      heading: "Second pass, before publishing",
      text: "An independent pass re-read the sources against the verdict and asked only whether the evidence supports the conclusion. It agreed, so the verdict went forward unchanged.",
    });
  } else if (input.nliOutcome) {
    body.push({
      heading: "Second pass, before publishing",
      text: "An independent pass re-read the sources against the verdict and did not agree, so this is published as an open question rather than a settled one.",
    });
  }
  body.push({
    heading: `Published at ${nzTimeLabel(input.publishedAt)}`,
    text: "Nothing has changed since. A later change would be added as a new version of this page, with the reason and the difference shown, and this one kept visible.",
  });
  const revisions = Math.max(0, input.verdictVersion - 1);
  steps.push({
    id: "decided",
    dayLabel: range.dayLabel,
    timeLabel: range.timeLabel,
    title: "The verdict, a second pass on the reasoning, and publishing",
    hint: `${VERDICT_LABELS[input.verdictClass].plainLabel} · published ${nzTimeLabel(input.publishedAt)}`,
    body,
    why: "Publishing the reasoning as well as the answer is the point: it is the part a reader can check for themselves.",
    sources: [],
    technical: [
      `pipeline ${input.pipelineVersion}`,
      `verdict version ${input.verdictVersion}`,
      `status ${input.verdictStatus}`,
      `revisions ${revisions}`,
      `prompts ${promptVersionsFor("decided", promptVersions).join(", ") || "none recorded"}`,
      modelVersionsFor("decided", input.modelVersions).length > 0
        ? `models ${modelVersionsFor("decided", input.modelVersions).join(", ")}`
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · "),
    mark: "answer",
  });

  // Register guard: the public half of the trail only. The technical lines are
  // the sanctioned exception (§2.2 rule 4) and are not scanned.
  const publicCopy = steps
    .flatMap((step) => [
      step.title,
      step.hint,
      step.why,
      ...step.body.map((part) => `${part.heading} ${part.text}`),
      ...step.sources.map((source) => `${source.title} ${source.finding} ${source.dates}`),
    ])
    .join("\n");
  assertRegisterSafe(publicCopy);

  const headline = input.claimMadeAt
    ? `Checked ${nzDate(input.publishedAt)} — ${relativeToClaim(input.claimMadeAt, input.publishedAt)}`
    : `Checked ${nzDate(input.publishedAt)}`;

  return {
    headline,
    intro:
      "Everything we did to this claim, in the order we did it. Open any step for what we looked at and why; the dates are when it happened, and every source is linked.",
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
