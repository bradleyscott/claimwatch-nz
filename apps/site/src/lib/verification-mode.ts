// The five checks, in plain words (SITE-MVP §2.3, Sept 2026). The verdict page's
// trail explains WHICH check a claim got and WHAT that kind of check can and
// cannot establish — and that explanation is per-mode, not per-claim boilerplate.
//
// Why this lives on the site rather than in the pipeline: `apps/site` may not
// import pipeline source (AGENTS.md package boundaries), so this is a mapping
// over the *published* mode names — the same pattern the trail already uses for
// prompt roles. The mode VALUES come from `claim.verification_mode`, which
// triage writes; nothing here re-decides routing.
//
// The `cannot` line is the load-bearing part of the design, and the reason the
// section exists at all. Each check has a hard limit, and a page that reports a
// finding without stating the limit invites the reader to treat the finding as
// covering more than it does. The sharpest case: no mode tests causation, so a
// causal claim's limit is stated on the page instead of being quietly graded by
// timing evidence (SITE-MVP §2.3 named gap, Sept 2026).

/** A mode's plain-language identity, and the bound it must declare. */
export interface ModeDescription {
  /** What the check is called on the page. */
  label: string;
  /** One sentence: what this kind of check does. */
  whatItDoes: string;
  /** When triage routes a claim here — the rule, not this claim's instance. */
  chosenWhen: string;
  /** What this check cannot establish. Always present; never a hedge. */
  cannot: string;
  /** What a reader can verify themselves, without our tooling. */
  checkItYourself: string;
}

export const MODE_DESCRIPTIONS: Record<string, ModeDescription> = {
  "stat-grid": {
    label: "Official figures",
    whatItDoes:
      "Checks the number against the official figures for it, and shows every reading of those figures — including the ones that disagree with the claim.",
    chosenWhen: "The claim states a number over a period, and official figures cover it.",
    cannot:
      "Show that one thing caused another. It can show that two things changed at the same time; it cannot show that one caused the other.",
    checkItYourself: "the linked figures, and the date recorded on each source below.",
  },
  "citation-check": {
    label: "The source it cites",
    whatItDoes:
      "Reads the document the claim rests on, and checks whether the claim uses it the way the document does.",
    chosenWhen: "The claim names a document, or clearly rests on one.",
    cannot:
      "Judge a document it cannot get. If the cited source is paywalled or unreachable, this page says the claim was checked against its own wording and nothing else.",
    checkItYourself: "the quoted passage from the cited document, linked above.",
  },
  "quote-fidelity": {
    label: "The recording",
    whatItDoes:
      "Checks the claim's wording against the recording or transcript it reports, and says first whether the words were found at all.",
    chosenWhen: "The claim is about what someone said.",
    cannot:
      "Check a quotation that appears in no published record. If the words cannot be found, this page says so — it does not say the person was misreported.",
    checkItYourself: "the clip link on this page, which jumps to that moment.",
  },
  provenance: {
    label: "The context it carries",
    whatItDoes:
      "Checks what the claim is presented as — which event, image, document or date — and whether that is really what it is.",
    chosenWhen: "The claim is attached to an event, image, document or date it may not belong to.",
    cannot:
      "Say why someone attached it wrongly. The record can show which event something comes from; it cannot show anyone's intent.",
    checkItYourself: "the linked original and its earliest publication date.",
  },
  "open-web": {
    label: "Open-web research",
    whatItDoes:
      "Turns the claim into questions that published evidence could answer, searches for it, and reports what it found — including what it set aside.",
    chosenWhen:
      "No official figures cover the claim, and it names no document or recording. This is the fallback, and the most common check.",
    cannot:
      "Find a fact nobody has published, or show that one thing caused another. It reports what is published and where the searching stopped: no evidence is reported as no evidence, never as proof the claim is false.",
    checkItYourself: "the sources below, each linked with the date we fetched it.",
  },
};

/**
 * What the claim was read as, in the claim's own terms — and, because triage's
 * type assignment IS the routing decision, this is also why the other four
 * checks do not apply. Deliberately phrased as what the claim is *not*: the
 * reader's question at this point is "why this check and not another one".
 */
export const CLAIM_TYPE_READING: Record<string, string> = {
  statistical:
    "a number stated over a period, with official figures covering it — so no search and no document were needed.",
  "citation-backed": "a claim resting on a source it names — so the source could be read directly.",
  "institution-citation":
    "a claim about an institution's own record — so that record could be read directly.",
  "broadcast-quote": "a claim about what someone said — so the recording could be checked directly.",
  "false-context":
    "a claim attached to an event, image or document — so the attachment could be checked against the record.",
  other:
    "a factual statement with no named source, no quotation and no official figures — so it was searched for.",
};

/** The typing a claim got, when the store holds no mode of its own. */
export const MODE_BY_CLAIM_TYPE: Record<string, string> = {
  statistical: "stat-grid",
  "citation-backed": "citation-check",
  "institution-citation": "citation-check",
  "broadcast-quote": "quote-fidelity",
  "false-context": "provenance",
  other: "open-web",
};

/**
 * The mode to explain, or null when the store holds none.
 *
 * `claim.verification_mode` is authoritative whenever it is present, because a
 * statistical claim reaches stat-grid only on an authority-registry hit and the
 * open-web loop otherwise (`mode-routing.ts`, Sept 2026), and the site cannot
 * see the registry. The claim-type fallback exists only for rows written before
 * the column did — and it returns null for `statistical` on purpose: guessing
 * between the two modes a statistical claim can take would publish a claim
 * about which check ran that nothing recorded. Null renders as an absent check.
 */
export function resolveMode(input: {
  verificationMode: string | null;
  claimType: string | null;
}): { mode: string; source: "recorded" | "derived" } | null {
  if (input.verificationMode && MODE_DESCRIPTIONS[input.verificationMode]) {
    return { mode: input.verificationMode, source: "recorded" };
  }
  if (!input.claimType || input.claimType === "statistical") return null;
  const derived = MODE_BY_CLAIM_TYPE[input.claimType];
  return derived ? { mode: derived, source: "derived" } : null;
}

export function modeDescription(mode: string): ModeDescription | null {
  return MODE_DESCRIPTIONS[mode] ?? null;
}
