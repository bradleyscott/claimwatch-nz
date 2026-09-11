// ClaimReview markup type (L4a): the shape rendered into verdict pages.

export interface ClaimReview {
  "@context": string;
  "@type": string;
  url: string;
  author: { "@type": string; name: string; url: string };
  claimReviewed: string;
  reviewRating: {
    "@type": string;
    ratingValue: number;
    bestRating: number;
    worstRating: number;
    ratingName: string;
    alternateName?: string;
  };
  datePublished: string;
  itemReviewed?: {
    "@type": string;
    datePublished: string;
    author?: { "@type": string; name: string; jobTitle?: string };
    firstAppearance?: { "@type": string; url: string };
  };
}

export type VerdictClassForMarkup =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";
