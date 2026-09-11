// L4a: ClaimReview JSON-LD validation (TEST-STRATEGY §2 L4a). The markup is
// the Google Fact-Check-Explorer discovery channel — malformed JSON-LD fails
// SILENTLY in the wild, so it must fail loudly here, on every push.
// Authored red (TDD). Test-requirement changes need approval.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

import {
  type ClaimReview,
  claimReviewFromVerdict,
  VERDICT_CLASS_TO_RATING,
  validateClaimReview,
} from "./claimreview.ts";

const corpus = JSON.parse(readFixture("claimreview-corpus.json")) as {
  valid: Array<{ id: string; jsonld: object }>;
  invalid: Array<{ id: string; reason: string; jsonld: object }>;
};

describe("valid ClaimReview markup (L4a)", () => {
  it.each(corpus.valid)("$id validates", (v) => {
    expect(() => validateClaimReview(v.jsonld as never)).not.toThrow();
  });

  it("accepts the four ADR-0004 rating names plus pledge/conditional renderings", () => {
    for (const name of [
      "Supported",
      "Refuted",
      "Not Enough Evidence",
      "Conflicting Evidence/Cherrypicking",
    ]) {
      const review = {
        ...corpus.valid[0]?.jsonld,
        reviewRating: {
          ...(corpus.valid[0]?.jsonld as { reviewRating: object }).reviewRating,
          ratingName: name,
        },
      };
      expect(() => validateClaimReview(review as never)).not.toThrow();
    }
  });
});

describe("malformed ClaimReview fails LOUDLY (the L4a contract)", () => {
  it.each(corpus.invalid)("$id → $reason", (v) => {
    expect(() => validateClaimReview(v.jsonld as never)).toThrow();
  });

  it("rejects broken JSON at the parse boundary, not as a validation pass", () => {
    expect(() => validateClaimReview("{not json")).toThrow(/parse/i);
  });
});

describe("verdict → ClaimReview mapping (store fields only, never hand-edited)", () => {
  it("maps the four pipeline classes to rating names and 1–4 values", () => {
    expect(VERDICT_CLASS_TO_RATING.supported).toMatchObject({
      ratingName: "Supported",
      ratingValue: 4,
    });
    expect(VERDICT_CLASS_TO_RATING.refuted).toMatchObject({
      ratingName: "Refuted",
      ratingValue: 1,
    });
    expect(VERDICT_CLASS_TO_RATING.not_enough_evidence).toMatchObject({
      ratingName: "Not Enough Evidence",
      ratingValue: 2,
    });
    expect(VERDICT_CLASS_TO_RATING.conflicting_cherry_picking).toMatchObject({
      ratingName: "Conflicting Evidence/Cherrypicking",
      ratingValue: 3,
    });
  });

  it("builds a valid ClaimReview from a verdict record + claim + media anchor", () => {
    const review = claimReviewFromVerdict({
      verdictUrl: "https://claimwatch.nz/verdict/gold-01",
      claimText: "Crime is up 30% since 2017.",
      verdictClass: "conflicting_cherry_picking",
      publishedAt: "2026-09-10",
      claimPublishedAt: "2026-09-08",
      claimantName: "Hon Sample Minister",
      claimantKind: "person",
      mediaAnchor: {
        mediaUrl: "https://www.youtube.com/watch?v=qa1234567890",
        startS: 2.5,
        endS: 11.8,
        deepLink: "https://www.youtube.com/watch?v=qa1234567890&t=2.5s&end=11.8s",
      },
    }) as ClaimReview;
    expect(() => validateClaimReview(review)).not.toThrow();
    expect(review.itemReviewed?.firstAppearance?.url).toContain("t=2.5s");
  });

  it("builds a valid ClaimReview without a media anchor (non-caption claims)", () => {
    const review = claimReviewFromVerdict({
      verdictUrl: "https://claimwatch.nz/verdict/gold-05",
      claimText: "Treasury forecasts growth of 2.1 percent next year.",
      verdictClass: "supported",
      publishedAt: "2026-09-10",
      claimPublishedAt: "2026-09-09",
      claimantName: "Treasury",
      claimantKind: "institution",
    }) as ClaimReview;
    expect(() => validateClaimReview(review)).not.toThrow();
  });
});
