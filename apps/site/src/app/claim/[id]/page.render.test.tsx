// L4a render test (SITE-MVP §5): the verdict page's PRE-HYDRATION SSR HTML
// carries the verdict content and the ClaimReview JSON-LD — crawlers get the
// verdict with no JS (SIT-R1/R8). Rendered with react-dom/server, no browser.
// Authored red against the shipped page component.

import { validateClaimReview } from "@cw/store";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  fixtureSiteStore,
  pinFixtureStore,
  resetSiteStore,
  type VerdictPageData,
} from "@/lib/site-store";

const claimId = "gold-01";
const pageData = {
  claimId,
  claimText: "Crime is up 30% since 2017.",
  speaker: "Hon Sample Minister",
  speakerVenue: "at a press conference",
  speakerAffiliation: "National",
  sourceUrl: "https://www.rnz.co.nz/news/politics/x",
  publishedAt: new Date("2026-09-09T10:12:00+12:00"),
  verdictClass: "conflicting_cherry_picking" as const,
  confidence: 0.72,
  attachedProposal: "tougher sentencing package",
  mediaAnchor: {
    mediaUrl: "https://youtube.com?v=x",
    startS: 2.5,
    endS: 11.8,
    deepLink: "https://youtube.com?v=x&t=2.5s&end=11.8s",
  },
  transcriptTier: null,
  // Authored in the pack's research order, NOT display order (uncoded → media →
  // official): the evidence list's strongest-first ordering is the page's job,
  // asserted below (SITE-MVP §2.3).
  evidence: [
    {
      authorityRef: "blog.example.com",
      seriesIdentity: "unclassified-post",
      vintageDate: "2026-08-02",
      plainReason: "No source classification came back with this finding.",
      url: "",
      tier: null,
      retrievedAt: new Date("2026-09-09T09:35:00+12:00"),
    },
    {
      authorityRef: "rnz.co.nz",
      seriesIdentity: "waitlist-report",
      vintageDate: "2026-07-01",
      plainReason: "Reports the same waitlist figure without publishing the series.",
      url: "",
      tier: 6,
      retrievedAt: null,
    },
    {
      authorityRef: "policedata.nz",
      seriesIdentity: "victimisations-monthly",
      vintageDate: "2026-06-30",
      plainReason: "The cited window shows +11.6%, per-capita +1.9%.",
      url: "https://www.policedata.nz/victimisations",
      tier: 1,
      retrievedAt: new Date("2026-09-09T09:35:00+12:00"),
    },
  ],
  pipelineVersion: "0.1.0",
  promptVersions: { "citation-compare": "citation-compare@1" },
  justifications: ["The cited window shows +11.6%, per-capita +1.9%."],
  modelVersions: { "citation-compare": "claude-sonnet-5" },
  searchRefs: [],
  // Trail inputs (SITE-MVP §2.3): a claim recorded end-to-end, with its own
  // date, so the rendered trail is the fully-populated one.
  claimMadeAt: new Date("2026-09-08T07:42:00+12:00"),
  claimRecordedAt: new Date("2026-09-09T09:26:00+12:00"),
  sourceRetrievedAt: new Date("2026-09-09T09:10:00+12:00"),
  claimType: "statistical",
  // ADR-0019's eligibility input, and eligible here: the claim is a resolvable
  // quoted actor's, which is why the page renders at all. A claim the outlet
  // wrote itself (`outlet-prose`) or one with no classification does not reach
  // the public record — the reader's gate, not the page, decides that.
  speakershipClass: "quoted-actor",
  // ...and a complete decision: the ADR-0019 gate requires the method and genre
  // too, so a class with no provenance cannot publish (ADR-0019 §5).
  speakershipMethod: "structural",
  genre: "transcript",
  publisher: "Newstalk ZB",
  checkedAt: new Date("2026-09-09T09:40:00+12:00"),
  nliOutcome: "pass",
  verdictVersion: 1,
  verdictStatus: "PUBLISHED",
  claimPromptVersions: { "triage-typing": "triage-typing@1" },
  claimModelVersion: "claude-sonnet-5",
  // Deliberately absent in this fixture: it dates from before the columns
  // existed (`claim.verification_mode` / `claim.triage_record`, Sept 2026), and
  // null is the state all 25 pre-migration verdicts are in — so this fixture
  // keeps rendering exactly what it rendered before. The mode-aware section
  // needs its own fixture with both values set.
  verificationMode: null,
  triageRecord: null,
} as const satisfies VerdictPageData;

/**
 * The same claim recorded AFTER the two Sept 2026 columns existed. Kept as a
 * second fixture rather than merged into `pageData`, because the null state is
 * not a leftover: it is what all 25 verdicts written before the migration look
 * like, so BOTH paths are live code and both get rendered here.
 */
const pageDataWithMode = {
  ...pageData,
  verificationMode: "stat-grid",
  triageRecord: {
    sentencesRead: 11,
    checked: 1,
    setAside: [
      { sentenceText: "Communities deserve to feel safe.", rejectionClass: "opinion" },
      { sentenceText: "This is a war we intend to win.", rejectionClass: "rhetoric" },
    ],
    held: [
      {
        sentenceText: "We will have new laws in place this term.",
        reason: "A commitment: it can only be graded once the deadline it names has passed.",
      },
    ],
  },
} as const satisfies VerdictPageData;

async function renderVerdictPage(id: string): Promise<string> {
  const mod = await import("@/app/claim/[id]/page");
  // No query string: the page renders the public record, which is the default
  // the reader enforces (`?corpus=all` is the unprovenanced escape hatch).
  const element = await mod.default({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(element as React.ReactElement);
}

/** The page as it renders for a claim whose check we can name. */
async function renderVerdictPageWithMode(id: string): Promise<string> {
  pinFixtureStore(fixtureSiteStore([], { [id]: pageDataWithMode }));
  return renderVerdictPage(id);
}

/**
 * The page's public copy: everything EXCEPT the trail's technical record, which
 * is the one slot allowed internal vocabulary (SITE-MVP §2.2 rule 4).
 *
 * The technical lines are cut by their own marker (`data-provenance-line`)
 * rather than by a heading or by position. That matters: the record now sits
 * inside each drawer, after the drawer's public copy, so slicing at any single
 * heading would leave later public copy unscanned — silently exempting real
 * copy from the register rules (SIT-R4).
 *
 * They are `<p>` elements, so a non-greedy element match cannot straddle two of
 * them; a line that fails to render is a loud failure, not a quiet exemption.
 */
function publicCopyOf(html: string): string {
  // `<noscript>` carries a style block, not copy — removed for the same reason
  // the technical lines are: it is machinery, not something a reader reads.
  const withoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, " ");
  const stripped = withoutNoscript.replace(/<p[^>]*data-provenance-line[^>]*>[\s\S]*?<\/p>/g, " ");
  if (stripped === withoutNoscript && withoutNoscript.includes("data-provenance-line")) {
    throw new Error("publicCopyOf: technical-record lines matched the page but not the stripper");
  }
  return stripped;
}

/**
 * A raw source code sitting in copy a reader can actually read (SIT-R4) — the
 * regression §2.2 rule 4 forbids, since the card must say "Official statistics"
 * and not "T1".
 *
 * Two deliberate choices, both learned the hard way:
 *
 * - **Text-only.** Markup matching false-positives on attributes (`t=2.5s`
 *   deep links, `pt-1.5` classes) and on the verdict rule's inline gradient
 *   offsets, and it never sees text React splits across elements. Stripping
 *   tags first asks the question the rule actually asks: what can a reader see?
 * - **Token-shaped, not substring.** The register scan's `"tier"` entry is
 *   word-shaped and can never catch a bare `T1` — no substring match will. Hence
 *   this separate check, which the register test asserts directly.
 */
function bareSourceCode(markup: string): RegExpMatchArray | null {
  return markup.replace(/<[^>]+>/g, " ").match(/(?:^|[\s(])T[1-6](?=$|[\s).,])/);
}

describe("L4a: verdict page SSR HTML (pre-hydration)", () => {
  beforeEach(() => {
    // Hermetic: clear the live-install latch (the .env load sets SITE_STORE=
    // live and an earlier request may have installed the live store), then
    // pin the fixture store — the render tests never touch Postgres.
    resetSiteStore();
    pinFixtureStore(fixtureSiteStore([], { [claimId]: pageData }));
  });

  it("embeds exactly one ClaimReview JSON-LD script in the initial HTML (SIT-R1)", async () => {
    const html = await renderVerdictPage(claimId);
    const matches = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ];
    expect(matches).toHaveLength(1);
    const payload = JSON.parse(matches[0]?.[1] ?? "{}") as unknown;
    const review = validateClaimReview(payload);
    expect(review.claimReviewed).toContain("Crime is up 30%");
    expect(review.reviewRating.ratingName).toBe("Conflicting Evidence/Cherrypicking");
  });

  it("renders the verdict label and plain summary in the initial HTML (SIT-R8)", async () => {
    const html = await renderVerdictPage(claimId);
    expect(html).toContain("Conflicting Evidence/Cherrypicking");
    expect(html).toContain("The number is real, but the way it is framed changes the picture.");
  });

  it("renders the hear-it control with the stored href, and the honest empty state when missing (SIT-R3/R14)", async () => {
    const withAnchor = await renderVerdictPage(claimId);
    expect(withAnchor).toContain("Hear the claim");
    expect(withAnchor).toContain("t=2.5s");

    const missing = await renderVerdictPage("does-not-exist");
    expect(missing).toContain("We could not find that claim");
    expect(missing).not.toContain("application/ld+json");
  });

  it("publishes no confidence number, even though the store carries one (SIT-R6)", async () => {
    const html = await renderVerdictPage(claimId);
    // Text content only: the verdict rule's gradient carries band offsets like
    // "72%" in an inline style, so markup-level matching would false-positive.
    const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
    expect(text).not.toContain("Confidence");
    expect(text).not.toMatch(/\b72\s*%/);
  });

  it("describes what each source is, and keeps the raw code in the provenance block (SIT-R4)", async () => {
    const html = await renderVerdictPage(claimId);
    // The stored code renders as words a reader already uses, with the key to
    // the vocabulary on the same card...
    expect(html).toContain("Official statistics");
    expect(html).toContain("Unknown source");
    expect(html).toContain("Not classified");
    expect(html).toContain("What these labels mean");
    // ...and the bare code badge is gone from the page body.
    expect(bareSourceCode(publicCopyOf(html))).toBeNull();
    // Whereas provenance still carries the codes, for anyone auditing against
    // the published classifier. An uncoded row contributes no code.
    expect(html).toContain("source types T1, T6");
  });

  it("renders the mode-aware trail — every section, dated — in the initial HTML (SITE-MVP §2.3)", async () => {
    const html = await renderVerdictPageWithMode(claimId);
    // The block states the checked date against the claim's own date...
    expect(html).toContain("How this verdict was made");
    expect(html).toContain("Checked 9 Sept 2026 — the day after the claim");
    // ...and carries all five sections, in order, in jargon-free titles.
    const headings = [
      "What else was in the document",
      "The check this claim got",
      "How it was checked: official figures",
      "Sources we used",
      "Decided and published",
    ];
    const positions = headings.map((heading) => html.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // The section the claim's own record rides on is dated; the claim-time line
    // is on the audit line rather than in a section of its own.
    expect(html).toContain("Wed 9 Sept");
    expect(html).toContain("exact time 2026-09-07T19:42:00.000Z");
    expect(html).toContain("publisher Newstalk ZB");
    // The claim's own date in words is the claim card's, not the trail's: the
    // "claim made" step was folded into section 1's audit line, so this pins
    // that the absolute date still reaches the reader.
    expect(html).toContain("8 September 2026");
    // The original item is linked, so a reader can read the claim in place.
    expect(html).toContain("As reported in");
    expect(html).toContain("https://www.rnz.co.nz/news/politics/x");
    // What the claim was read as, and which check that produced.
    expect(html).toContain("a number stated over a period");
    expect(html).toContain("check stat-grid");
    // What this check cannot establish — the bound, which no mode may omit.
    expect(html).toContain("What this check cannot establish");
    expect(html).toContain("Show that one thing caused another.");
    // The sentences we did not check, with a plain reason instead of the class.
    expect(html).toContain("Communities deserve to feel safe.");
    expect(html).toContain("A judgement about fairness or importance");
    expect(html).toContain("We will have new laws in place this term.");
    expect(html).toContain("held back");
    expect(html).toContain("sentences 11");
    expect(html).toContain("set aside 2");
    // The decision, the sources, and the second pass.
    expect(html).toContain(
      "Against 3 sources: the evidence backs the numbers but not the framing.",
    );
    expect(html).toContain("dated 30 Jun 2026 · fetched 9 Sept 2026");
    expect(html).toContain("The cited window shows +11.6%, per-capita +1.9%.");
    expect(html).toContain("agreed with the reasoning");
    // ...and the key that explains the values those audit lines print — the
    // labels are plain words, so only the opaque forms need defining — is in the
    // same server-rendered response, not behind a script.
    expect(html).toContain("What these values mean");
    expect(html).toContain("the instructions a step ran");
    expect(html).toContain("locked for the election period");
    // ...and the audit line is in the reader's default view: no control to
    // reveal it, nothing collapsed, nothing fetched client-side.
    expect(html).toContain("source types T1, T6");
    expect(html).toContain("never revised");
    expect(html).toContain("ClaimWatch version 0.1.0");
    expect(html).not.toContain("Show the technical record");
    expect(html).not.toContain('type="checkbox"');
  });

  it("renders an absence for the claims that predate the mode columns, not a guess", async () => {
    const html = await renderVerdictPage(claimId);
    // This is the state every verdict written before Sept 2026 is in. The page
    // says what it does not hold; it does not describe a check it cannot name.
    expect(html).toContain("data-trail-absent");
    expect(html).toContain("We have no record of which kind of check");
    expect(html).toContain("cannot say how much of the document");
    expect(html).toContain("check not recorded");
    expect(html).toContain("sentences not recorded");
    // And it never invents the bound for a check it could not identify.
    expect(html).not.toContain("What this check cannot establish");
  });

  it("states the explained-away duplication exactly once (the old footer paragraph is gone)", async () => {
    const html = await renderVerdictPage(claimId);
    // The paragraph that restated the accordion's own heading, and the metarow
    // that repeated the methodology link, were removed with the redesign: one
    // "How we check claims" link remains, and no copy restates the block.
    expect(html).not.toContain("produced by our automated pipeline");
    const howWeCheck = html.match(/How we check claims/g) ?? [];
    expect(howWeCheck).toHaveLength(1);
    const contest = html.match(/got this wrong\?/g) ?? [];
    expect(contest).toHaveLength(1);
  });

  it("keeps the technical record in the reader's view rather than behind a control", async () => {
    const html = await renderVerdictPage(claimId);
    // One audit line per section, marked so the register scan can exclude it —
    // the marker is a scan key, not a hiding mechanism (globals.css has no rule
    // for it; there is nothing to reveal and nothing to click).
    const lines = html.match(/data-provenance-line/g) ?? [];
    expect(lines).toHaveLength(5);
    // Nothing left over from the collapsed version: no reveal checkbox, no
    // drawer body wrapper, no accordion at all (the only disclosure left on the
    // page is the key, a native <details>).
    expect(html).not.toContain("trail-tech-record");
    expect(html).not.toContain("data-trail-body");
    expect(html).not.toContain('data-slot="accordion"');
  });

  it("renders the evidence strongest source first, unclassified last (SITE-MVP §2.3)", async () => {
    const html = await renderVerdictPage(claimId);
    // The fixture is authored in the pack's research order (uncoded, T6, T1),
    // so this asserts the page sorted it: a reader meets the official series
    // before the reporting about it, and a source nothing vouches for comes
    // last with a label saying so.
    const order = ["victimisations-monthly", "waitlist-report", "unclassified-post"];
    const positions = order.map((series) => html.indexOf(series));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html.indexOf("Official statistics")).toBeLessThan(html.indexOf("Unknown source"));
    expect(html.indexOf("Unknown source")).toBeLessThan(html.indexOf("Not classified"));
  });

  it("renders prompt versions without re-prefixing the role (it is already in the value)", async () => {
    const html = await renderVerdictPageWithMode(claimId);
    expect(html).toContain("citation-compare@1");
    expect(html).not.toContain("citation-compare@citation-compare@1");
    // Roles recorded on the claim itself reach the section for the reading
    // (with the model that typed the claim), and the claim's own date governs
    // the claim card — not the day the verdict was published.
    expect(html).toContain("triage-typing@1");
    expect(html).toContain("model claude-sonnet-5");
    expect(html).toContain("8 September 2026");
  });

  it("the bare-code matcher is not vacuous, and ignores markup noise (SIT-R4)", () => {
    // Positive controls: it fires on exactly the regression we care about...
    expect(bareSourceCode("<span>T1</span>")).not.toBeNull();
    expect(bareSourceCode("the T5 sector report says")).not.toBeNull();
    expect(bareSourceCode("cited (T3) as context")).not.toBeNull();
    // ...and does not fire on the shapes that made a markup-level match
    // unreliable: deep-link timestamps, class fragments, gradient offsets, and
    // codes that are legitimately inside a tag rather than in a reader's text.
    expect(bareSourceCode('<a href="https://youtube.com?v=x&t=2.5s">watch</a>')).toBeNull();
    expect(bareSourceCode('<span class="pt-1.5">x</span>')).toBeNull();
    expect(bareSourceCode('<span style="left:72%">x</span>')).toBeNull();
    expect(bareSourceCode("checked 2026-06-30")).toBeNull();
    // A code inside the provenance block is excluded by publicCopyOf, not by
    // this matcher — asserted where the block is built, above.
    expect(bareSourceCode("source codes: T1, T6")).not.toBeNull();
  });

  it("keeps the technical register out of the rendered public copy (SIT-R4)", async () => {
    const html = await renderVerdictPage(claimId);
    const publicCopy = publicCopyOf(html);
    // The region this test claims to scan really does include the footer copy
    // that follows the trail's technical lines, and really does exclude those
    // lines — otherwise "we scanned the public copy" becomes unfalsifiable.
    expect(publicCopy).toContain("Think we");
    expect(publicCopy).not.toContain("data-provenance-line");
    expect(publicCopy).not.toContain("evidence source codes");
    expect(publicCopy).not.toContain("pipeline 0.1.0");
    // A bare `T1` on the card is the §2.2 rule 4 violation the word-shaped
    // "tier" entry below cannot see, so it gets its own token-shaped check.
    expect(bareSourceCode(publicCopy)).toBeNull();
    for (const banned of [
      "sensitivity grid",
      "extraction ladder",
      "nli audit",
      // "tier" itself: the public copy says what a source is ("Official
      // statistics"), never which rung it sits on. Provenance is the one slot
      // allowed the code (SITE-MVP §2.2 rule 4), and publicCopyOf cuts it out.
      "tier",
      "stratum",
    ]) {
      expect(publicCopy.toLowerCase()).not.toContain(banned);
    }
  });
});
