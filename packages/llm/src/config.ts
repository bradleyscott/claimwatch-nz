// Cross-cutting config surface (CROSS-CUTTING §2): one typed surface carrying
// every value a scoring run depends on. Pre-declared and versioned — changing
// any of these is a pipeline change that re-runs the harness. Both the pipeline
// and the harness load this surface; NEITHER imports the other (CRO-R1: one
// tuple across dev/CI/slice; HARNESS §3.1 dependency direction).

/** Pre-declared sensitivity-grid axes (ADR-0005). */
export const GRID_AXES_VERSION = "grid-axes-2026-09";

/** Fingerprint normalisation rules (TRIAGE open Q3) — versioned, deterministic. */
export const FINGERPRINT_NORMALISATION_VERSION = "fp-norm-2025-01";

/**
 * Prompt/LLM role vocabulary — every step we hold a prompt for, and the only
 * keys a run manifest may record as `promptVersions` (HARNESS §2.8, HAR-R7).
 *
 * It lives on this surface because both sides load it and neither may import the
 * other (CRO-R1, CRO-R14): the pipeline calls the roles, the harness validates
 * the manifest. The point is that a manifest can never claim provenance for a
 * step that does not exist — the phantom `adjudication@1` role did exactly that
 * (Sept 2026), naming a prompt with no text anywhere in the pipeline.
 *
 * Adding a role means adding it here *and* adding its prompt where it is used;
 * `PortRole` in `packages/pipeline/src/llm/live-adapter.ts` derives from this.
 */
export const PROMPT_ROLES = [
  "triage-checkability",
  "triage-typing",
  "triage-fingerprint",
  "triage-context",
  "grid-materiality",
  "citation-compare",
  "quote-fidelity",
  "nli-audit",
  "open-web",
  "authority-classify",
  "claim-decompose",
  "research-assess",
] as const;

/**
 * Sampling settings every live call is made with (Sept 2026).
 *
 * Chosen for REPRODUCIBILITY, not quality. A verdict is a published artefact
 * that has to be re-checkable, and the same document triaged twice with default
 * sampling returned 31 claims then 42 — eleven sentences moved across the
 * "checkable" boundary, so the set-aside list the verdict page publishes is not
 * a stable property of the document unless the sampling is pinned.
 *
 * It belongs on this surface because it is part of what a scoring run depends
 * on (CRO-R1): two runs that differed only in temperature are not comparable,
 * and until this existed a run manifest could not tell them apart.
 *
 * `seed` is provider-conditional — Anthropic exposes no seed parameter, so its
 * determinism rests on temperature alone. `null` means "the provider was given
 * none", which is a fact a run file should carry rather than hide.
 */
export const SAMPLING = { temperature: 0, seed: 20260901 } as const;

/** Providers that accept a seed. Anthropic does not expose one. */
export const SEEDABLE_PROVIDERS = ["openai", "openrouter"] as const;

/** A role in {@link PROMPT_ROLES}. */
export type PromptRole = (typeof PROMPT_ROLES)[number];
