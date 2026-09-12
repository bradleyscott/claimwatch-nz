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
  evidence: [
    {
      authorityRef: "policedata.nz",
      seriesIdentity: "victimisations-monthly",
      vintageDate: "2026-06-30",
      plainReason: "The cited window shows +11.6%, per-capita +1.9%.",
      url: "https://www.policedata.nz/victimisations",
    },
  ],
  pipelineVersion: "0.1.0",
  promptVersions: { adjudication: "adjudication@1" },
  justifications: ["The cited window shows +11.6%, per-capita +1.9%."],
  modelVersions: { adjudication: "claude-sonnet-5" },
  searchRefs: [],
} as const satisfies VerdictPageData;

async function renderVerdictPage(
  id: string,
  pages?: Record<string, VerdictPageData>,
): Promise<string> {
  const mod = await import("@/app/claim/[id]/page");
  const element = await mod.default({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(element as React.ReactElement);
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

  it("keeps the technical register out of the rendered public copy (SIT-R4)", async () => {
    const html = await renderVerdictPage(claimId);
    const publicCopy = html.slice(0, html.indexOf("How this verdict was made"));
    for (const banned of [
      "sensitivity grid",
      "extraction ladder",
      "nli audit",
      "tier-2",
      "stratum",
    ]) {
      expect(publicCopy.toLowerCase()).not.toContain(banned);
    }
  });
});
