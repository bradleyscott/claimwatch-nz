// ClaimReview JSON-LD: validation + build (L4a). The markup is the Google
// Fact-Check-Explorer discovery channel — built from store fields only, never
// hand-edited (STORE §3 site contract). Malformed markup fails loudly here
// because it fails silently in the wild.

import { z } from "zod";
import type { ClaimReview } from "./claimreview-types.ts";

export const VERDICT_CLASS_TO_RATING: Record<string, { ratingName: string; ratingValue: number }> =
  {
    supported: { ratingName: "Supported", ratingValue: 4 },
    refuted: { ratingName: "Refuted", ratingValue: 1 },
    not_enough_evidence: { ratingName: "Not Enough Evidence", ratingValue: 2 },
    conflicting_cherry_picking: {
      ratingName: "Conflicting Evidence/Cherrypicking",
      ratingValue: 3,
    },
  };

// ADR-0004 four-class vocabulary — the ONLY ratingNames the markup may carry.
const VALID_RATING_NAMES = new Set([
  "Supported",
  "Refuted",
  "Not Enough Evidence",
  "Conflicting Evidence/Cherrypicking",
]);

const RatingSchema = z.object({
  "@type": z.literal("Rating"),
  ratingValue: z.number(),
  bestRating: z.number().default(4),
  worstRating: z.number().default(1),
  ratingName: z.string(),
  alternateName: z.string().optional(),
});

const ClaimReviewSchema = z.object({
  "@context": z.string(),
  "@type": z.literal("ClaimReview"),
  url: z.string(),
  author: z.object({ "@type": z.string(), name: z.string(), url: z.string() }),
  claimReviewed: z.string(),
  reviewRating: RatingSchema,
  datePublished: z.string(),
  itemReviewed: z
    .object({
      "@type": z.literal("Claim"),
      datePublished: z.string(),
      author: z
        .object({ "@type": z.string(), name: z.string(), jobTitle: z.string().optional() })
        .optional(),
      firstAppearance: z.object({ "@type": z.literal("CreativeWork"), url: z.string() }).optional(),
    })
    .optional(),
});

export function validateClaimReview(input: unknown): ClaimReview {
  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      throw new Error(`ClaimReview JSON parse error: ${(e as Error).message}`);
    }
    return validateClaimReview(parsed);
  }
  const result = ClaimReviewSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `ClaimReview validation failed at ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "unknown"} — malformed JSON-LD fails silently in the wild, so it must fail loudly here`,
    );
  }
  const review = result.data;
  if (!VALID_RATING_NAMES.has(review.reviewRating.ratingName)) {
    throw new Error(
      `ClaimReview ratingName "${review.reviewRating.ratingName}" is outside the ADR-0004 four-class vocabulary`,
    );
  }
  if (
    review.reviewRating.ratingValue > review.reviewRating.bestRating ||
    review.reviewRating.ratingValue < review.reviewRating.worstRating
  ) {
    throw new Error(
      `ClaimReview ratingValue ${review.reviewRating.ratingValue} outside ${review.reviewRating.worstRating}–${review.reviewRating.bestRating}`,
    );
  }
  return review as ClaimReview;
}

export function claimReviewFromVerdict(input: {
  verdictUrl: string;
  claimText: string;
  verdictClass: keyof typeof VERDICT_CLASS_TO_RATING;
  publishedAt: string;
  claimPublishedAt: string;
  claimantName: string;
  claimantKind: string;
  mediaAnchor?: { mediaUrl: string; startS: number; endS: number; deepLink: string };
}): ClaimReview {
  const rating = VERDICT_CLASS_TO_RATING[input.verdictClass];
  if (!rating) {
    throw new Error(`unknown verdict class for markup: ${String(input.verdictClass)}`);
  }
  const alternateName =
    input.verdictClass === "conflicting_cherry_picking"
      ? "Accurate but incomplete"
      : input.verdictClass === "not_enough_evidence"
        ? "Open question — evidence not found"
        : undefined;
  const firstAppearance = input.mediaAnchor
    ? { "@type": "CreativeWork", url: input.mediaAnchor.deepLink }
    : undefined;
  const claimant =
    input.claimantKind === "person"
      ? { "@type": "Person", name: input.claimantName }
      : { "@type": "Organization", name: input.claimantName };
  return {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    url: input.verdictUrl,
    author: { "@type": "Organization", name: "ClaimWatch NZ", url: "https://claimwatch.nz" },
    claimReviewed: input.claimText,
    reviewRating: {
      "@type": "Rating",
      ratingValue: rating.ratingValue,
      bestRating: 4,
      worstRating: 1,
      ratingName: rating.ratingName,
      ...(alternateName !== undefined ? { alternateName } : {}),
    },
    datePublished: input.publishedAt,
    itemReviewed: {
      "@type": "Claim",
      datePublished: input.claimPublishedAt,
      ...(claimant !== undefined ? { author: claimant } : {}),
      ...(firstAppearance !== undefined ? { firstAppearance } : {}),
    },
  };
}

export type { ClaimReview } from "./claimreview-types.ts";
