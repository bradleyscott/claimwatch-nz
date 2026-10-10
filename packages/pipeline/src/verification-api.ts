// Verdict vocabulary (ADR-0004, ADR-0026): the four AVeriTeC-aligned classes the
// evidence-critiquer may publish. `pledge` / `conditional` are store-level
// statuses for held commitments, not classes the research loop returns.

export type VerdictClass =
  | "supported"
  | "refuted"
  | "not_enough_evidence"
  | "conflicting_cherry_picking";
