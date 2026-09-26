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
