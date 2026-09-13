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
  publishedAt: new Date("2026-09-08"),
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
    },
    {
      authorityRef: "rnz.co.nz",
      seriesIdentity: "waitlist-report",
      vintageDate: "2026-07-01",
      plainReason: "Reports the same waitlist figure without publishing the series.",
      url: "",
      tier: 6,
    },
    {
      authorityRef: "policedata.nz",
      seriesIdentity: "victimisations-monthly",
      vintageDate: "2026-06-30",
      plainReason: "The cited window shows +11.6%, per-capita +1.9%.",
      url: "https://www.policedata.nz/victimisations",
      tier: 1,
    },
  ],
  pipelineVersion: "0.1.0",
  promptVersions: { "citation-compare": "citation-compare@1" },
  justifications: ["The cited window shows +11.6%, per-capita +1.9%."],
  modelVersions: { "citation-compare": "claude-sonnet-5" },
  searchRefs: [],
} as const satisfies VerdictPageData;

async function renderVerdictPage(id: string): Promise<string> {
  const mod = await import("@/app/claim/[id]/page");
  const element = await mod.default({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(element as React.ReactElement);
}

/**
 * The page's public copy: everything EXCEPT the provenance block, which is the
 * one slot allowed technical vocabulary (SITE-MVP §2.2 rule 4). Cut out by the
 * provenance paragraph's own opening text rather than by the accordion trigger,
 * because the trigger comes first and the footer paragraphs come after the
 * block — slicing at the trigger would leave the footer unscanned, silently
 * exempting real public copy from the register rules (SIT-R4).
 */
function publicCopyOf(html: string): string {
  const provenanceStart = html.indexOf("Pipeline version");
  if (provenanceStart < 0) return html;
  const paragraphEnd = html.indexOf("</p>", provenanceStart);
  return (
    html.slice(0, provenanceStart) +
    html.slice(paragraphEnd < 0 ? provenanceStart : paragraphEnd + "</p>".length)
  );
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
    // that follows the provenance block, and really does exclude the block —
    // otherwise "we scanned the public copy" becomes unfalsifiable.
    expect(publicCopy).toContain("quality-audited");
    expect(publicCopy).not.toContain("Pipeline version");
    expect(publicCopy).not.toContain("evidence source codes");
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
