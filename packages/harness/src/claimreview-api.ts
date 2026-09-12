// ClaimReview JSON-LD contract (L4a). Re-exports the shared implementation in
// packages/store (single source of truth — the harness corpus tests guard the
// serializer the site ships).

export type { ClaimReview } from "@cw/store";
export {
  claimReviewFromVerdict,
  VERDICT_CLASS_TO_RATING,
  validateClaimReview,
} from "@cw/store";

export type VerdictClassForMarkup =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";
