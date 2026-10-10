// The public-copy register (SITE-MVP §2.2 rules 4-5, SIT-R4/SIT-R5): the two
// lexicons that must not reach a public page, the reviewed key and labels the
// audit lines are allowed to carry, and the checks that enforce both. The site
// build fails on a violation rather than publishing internal vocabulary.

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

/**
 * The key to the values the audit lines print (SITE-MVP §2.3). The
 * lines label their own parts in plain words, so this defines only what a plain
 * label cannot carry: the form of a prompt version, the source-type codes, the
 * verdict states this page is not currently printing, and the sentinel the page
 * uses when the store held nothing.
 */
export const TECHNICAL_RECORD_KEY: ReadonlyArray<{ term: string; meaning: string }> = [
  {
    term: "name@version",
    meaning:
      "the instructions a step ran, and their version, as our system recorded them. A new number means the instructions changed. The old version is kept, so any verdict can be re-checked against the instructions that made it.",
  },
  {
    term: "turns",
    meaning:
      "how many times the research loop went round: plan the evidence, search for it, then decide whether what was found is enough. Each turn is a fresh look, not a repeat.",
  },
  {
    term: "capped",
    meaning:
      "the loop stops after a fixed number of turns. This says the limit was reached, so the search stopped there rather than the evidence running out.",
  },
  {
    term: "agreement",
    meaning:
      'the decision is made twice, because our models give slightly different answers to identical input. "agreed" means both runs reached the same class and it was published; "disagreed" means they did not, and "we could not verify this" was published instead of picking one.',
  },
  {
    term: "plans",
    meaning:
      "how many evidence plans the assessor wrote — one per turn. A later plan responds to what the earlier critique found missing.",
  },
  {
    term: "source type codes",
    meaning:
      "a code for the kind of source: official statistics, academic research, a major newsroom. The plain-language key is on the evidence card above; the codes are what the check wrote down.",
  },
  {
    term: "PUBLISHED",
    meaning:
      "the state of the verdict. PUBLISHED means it is live and public; CONTESTED means someone has challenged it; FROZEN means it is locked for the election period — from 5 Nov 2026 until the results are declared.",
  },
  {
    term: "not recorded",
    meaning: "we hold nothing for that field. It says so rather than guessing.",
  },
];

/**
 * The labels an audit line may carry (SITE-MVP §2.2 rule 4).
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
  // ADR-0026: the loop's own vocabulary. `plans`, `questions` and `searches`
  // count what the assessor asked for; `turns` and `capped` describe how far the
  // loop got; `agreement` is the class-agreement state. All reviewed, and none is
  // a prefix of another.
  "plans",
  "questions",
  "searches",
  "turns",
  "capped",
  "agreement",
  "plan not recorded",
  "loop not recorded",
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
 * Plain-language replacements for internal vocabulary a model can write into its
 * own prose (a strategy, a reason, a justification).
 */
const REGISTER_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sensitivity grid/gi, replacement: "the figures" },
  { pattern: /extraction ladder/gi, replacement: "the fetch fallbacks" },
  { pattern: /NLI audit/gi, replacement: "the check" },
  { pattern: /tier[- ]2/gi, replacement: "the caption" },
  { pattern: /stratum/gi, replacement: "group" },
  { pattern: /discourse context/gi, replacement: "the context" },
  { pattern: /fingerprint/gi, replacement: "the claim key" },
  { pattern: /pgvector/gi, replacement: "the search index" },
  { pattern: /drizzle/gi, replacement: "the database tool" },
  { pattern: /\bcompletely\s+(wrong|false)\b/gi, replacement: "not supported by the evidence" },
  { pattern: /\babsolutely\s+(true|false)\b/gi, replacement: "not supported as stated" },
  { pattern: /\bhalf[- ]true\b/gi, replacement: "partly supported" },
  { pattern: /\bmostly\s+false\b/gi, replacement: "not supported as stated" },
];

/**
 * Translate internal vocabulary out of text a model wrote. The register scan is a
 * build gate on OUR copy; model-generated prose is data, and a banned term in it
 * must not fail the build — it is translated here instead, so no internal term
 * reaches a reader and the page still renders. Verbatim source passages are left
 * untouched (a quotation is the source's words, not ours).
 */
export function sanitiseRegisterText(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REGISTER_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
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
