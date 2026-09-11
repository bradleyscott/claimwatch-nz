// Cross-cutting config surface (CROSS-CUTTING §2): one typed surface carrying
// every value a scoring run depends on. Pre-declared and versioned — changing
// any of these is a pipeline change that re-runs the harness. Both the pipeline
// and the harness load this surface; NEITHER imports the other (CRO-R1: one
// tuple across dev/CI/slice; HARNESS §3.1 dependency direction).

/** Pre-declared sensitivity-grid axes (ADR-0005). */
export const GRID_AXES_VERSION = "grid-axes-2026-09";

/** Fingerprint normalisation rules (TRIAGE open Q3) — versioned, deterministic. */
export const FINGERPRINT_NORMALISATION_VERSION = "fp-norm-2025-01";
