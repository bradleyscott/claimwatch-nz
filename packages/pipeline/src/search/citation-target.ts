// Citation-target resolution (ADR-0020 rule 1). A citation check runs only
// against the document the claim actually cites — and fails closed otherwise.
//
// The path this replaces did: `citedName = fingerprint.source ?? domainKey`,
// search `"<citedName> New Zealand"`, then take `found[0]` with no gate. That is
// how a policing claim came to be "checked" against the subject's Wikipedia
// biography. Two rules now hold: a claim that names no document gets no citation
// check, and a result is only a candidate if it is admissible AND actually looks
// like the document cited.

import { admissibilityRefusal, hostOf, isAdmissibleEvidence } from "./admissibility.ts";

export interface CitationSearchResult {
  link: string;
  title: string;
  snippet: string;
}

export type CitationTargetOutcome =
  | { ok: true; target: CitationSearchResult }
  | { ok: false; reason: string };

/** Does this result plausibly BE the document the claim cites? */
function looksLikeTheCitedDocument(cited: string, result: CitationSearchResult): boolean {
  const citedLower = cited.toLowerCase();
  const citedHost = hostOf(cited) ?? hostOf(`https://${cited}`);
  const resultHost = hostOf(result.link);

  // A cited domain/URL is the strongest signal: the result must be on it.
  if (citedHost != null && resultHost != null) {
    if (resultHost === citedHost || resultHost.endsWith(`.${citedHost}`)) return true;
  }
  // Otherwise the citation is a name: require it, or a distinctive part of it,
  // to appear in the result's title or URL.
  const distinctive = citedLower.split(/\s+/).filter((word) => word.length > 3);
  const haystack = `${result.title} ${result.link}`.toLowerCase();
  if (distinctive.length === 0) return false;
  return distinctive.every((word) => haystack.includes(word));
}

/**
 * The document to compare a claim against, or a reason there is none. Never
 * returns a fallback: an absent citation, an inadmissible result, or a result
 * that does not look like the cited document all fail closed.
 */
export function resolveCitationTarget(input: {
  citedSource: string | null | undefined;
  results: readonly CitationSearchResult[];
  tierOf: (link: string) => number | null | undefined;
}): CitationTargetOutcome {
  const cited = input.citedSource?.trim() ?? "";
  if (cited.length === 0) {
    return {
      ok: false,
      reason: "the claim names no document, so there is nothing to compare it against",
    };
  }

  const plausible = input.results.filter((result) => looksLikeTheCitedDocument(cited, result));
  if (plausible.length === 0) {
    return {
      ok: false,
      reason: `no result looks like the document the claim cites ("${cited}")`,
    };
  }

  const admissible = plausible.find((result) =>
    isAdmissibleEvidence({ link: result.link, tier: input.tierOf(result.link) }),
  );
  if (admissible == null) {
    const first = plausible[0];
    const refusal =
      first == null
        ? null
        : admissibilityRefusal({ link: first.link, tier: input.tierOf(first.link) });
    return { ok: false, reason: refusal ?? `no admissible document found for the cited source` };
  }

  return { ok: true, target: admissible };
}
