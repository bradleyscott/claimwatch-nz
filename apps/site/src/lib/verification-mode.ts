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
      "Compares the claim's number against the agency that keeps that record, over several readings of the same series — and keeps every reading, including the ones that contradict the claim.",
    chosenWhen:
      "Used when the claim states a number over a period and an official series covers that number.",
    cannot:
      "Establish that one thing caused another. It shows when two things happened relative to each other, which is the strongest thing a series can say and is still not proof of cause.",
    checkItYourself: "the linked series and the vintage date on each source below.",
  },
  "citation-check": {
    label: "The source it cites",
    whatItDoes:
      "Reads the document the claim rests on — rather than searching around it — and asks whether the claim uses it the way the document uses it.",
    chosenWhen:
      "Used when the claim names, or clearly rests on, a document or an institution's record.",
    cannot:
      "Judge a document it cannot obtain. Where the cited source is paywalled or unreachable, the page says the claim was checked against its own wording and nothing else.",
    checkItYourself: "the quoted passage from the cited document, linked in the section above.",
  },
  "quote-fidelity": {
    label: "The recording",
    whatItDoes:
      "Compares the claim's wording against the recording or transcript it reports, and says first whether the words could be found at all.",
    chosenWhen: "Used when the claim is about what someone said.",
    cannot:
      "Check a quotation that no published record contains. A quotation that cannot be located is reported as exactly that — not as a misreport.",
    checkItYourself: "the clip link on this page, which jumps to the moment in the recording.",
  },
  provenance: {
    label: "The context it carries",
    whatItDoes:
      "Establishes what the claim is presented as — which event, image, document or date — and tests whether the thing presented actually is that.",
    chosenWhen:
      "Used when a claim is attached to an event, image, document or date it may not belong to.",
    cannot:
      "Say why a wrong attachment was made. The record supports which event something is from; it does not support a claim about anyone's intent.",
    checkItYourself: "the linked original and its earliest publication date.",
  },
  "open-web": {
    label: "Open-web research",
    whatItDoes:
      "Turns the claim into questions that published evidence could answer, searches for those, and reports what it found — including what it found and set aside.",
    chosenWhen:
      "Used when no official series covers the claim and it names no document or recording. This is the fallback, and the check most claims receive.",
    cannot:
      "Establish a fact nobody has published, and cannot establish cause. It reports what is published and where the searching stopped — an absence of evidence is reported as an absence, never as evidence a claim is false.",
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
    "a number stated over a period, with an official series covering that number — so no search, no cited document and no recording was needed.",
  "citation-backed":
    "a claim resting on a source it names — so the source itself could be read rather than searched for.",
  "institution-citation":
    "a claim about an institution's own record — so the institution's own published record could be read.",
  "broadcast-quote":
    "a claim about what someone said — so the recording could be checked directly.",
  "false-context":
    "a claim attached to an event, image or document — so the attachment could be tested against the record.",
  other:
    "a statement of fact with no named source, no quotation behind it and no official series covering it — so it was searched for, which is the fallback rather than the first choice.",
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
