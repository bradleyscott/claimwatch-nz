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
  speakerAffiliation: "National",
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
  publisher: "Newstalk ZB",
  checkedAt: new Date("2026-09-09T09:40:00+12:00"),
  nliOutcome: "pass",
  verdictVersion: 1,
  verdictStatus: "PUBLISHED",
  claimPromptVersions: { "triage-typing": "triage-typing@1" },
  claimModelVersion: "claude-sonnet-5",
} as const satisfies VerdictPageData;

async function renderVerdictPage(id: string): Promise<string> {
  const mod = await import("@/app/claim/[id]/page");
  const element = await mod.default({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(element as React.ReactElement);
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
    expect(html).toContain("evidence source codes: T1, T6");
  });

  it("renders the trail — every step, its date and its audit line — in the initial HTML (SITE-MVP §2.3)", async () => {
    const html = await renderVerdictPage(claimId);
    // The block that replaced the provenance accordion states the checked date
    // against the claim's own date...
    expect(html).toContain("How this verdict was made");
    expect(html).toContain("Checked 9 Sept 2026 — the day after the claim");
    // ...carries all four dated steps...
    for (const step of [
      "The claim was made",
      "We logged it, and worked out what to check it against",
      "What we compared it against — 3 sources",
      "The verdict, a second pass on the reasoning, and publishing",
    ]) {
      expect(html).toContain(step);
    }
    expect(html).toContain("Tue 8 Sept");
    expect(html).toContain("7:42 am");
    // ...keeps the whole audit record in the response for no-JS readers and
    // unfurlers, even though the drawers are... (Radix unmounts closed content,
    // so `forceMount` is what makes this true)
    expect(html).toContain("evidence source codes: T1, T6");
    expect(html).toContain("revisions 0");
    // ...and closes the loop a reader came for: why each source has a date.
    expect(html).toContain("Each source carries the date of the figures it holds");
    expect(html).toContain("Second pass, before publishing");
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

  it("keeps the technical record out of the reader's default view, with no JavaScript needed to reveal it", async () => {
    const html = await renderVerdictPage(claimId);
    // The toggle is a real checkbox, and the CSS rule that reveals the record is
    // keyed on its checked state — so it works with scripts disabled.
    expect(html).toContain('id="trail-tech-record"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Show the technical record");
    // Every technical line carries the marker that hidden-until-checked CSS (and
    // the register scan) keys on.
    const lines = html.match(/data-provenance-line/g) ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(3);
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
    const html = await renderVerdictPage(claimId);
    expect(html).toContain("citation-compare@1");
    expect(html).not.toContain("citation-compare@citation-compare@1");
    // Roles recorded on the claim itself reach the trail's "we logged it" step
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
    expect(bareSourceCode("evidence source codes: T1, T6")).not.toBeNull();
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
