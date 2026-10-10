// Cross-cutting config surface (CROSS-CUTTING §2): one typed surface carrying
// every value a scoring run depends on. Pre-declared and versioned — changing
// any of these is a pipeline change that re-runs the harness. Both the pipeline
// and the harness load this surface; NEITHER imports the other (CRO-R1: one
// tuple across dev/CI/slice; HARNESS §3.1 dependency direction).

/**
 * Prompt/LLM role vocabulary — every step we hold a prompt for, and the only
 * keys a run manifest may record as `promptVersions` (HARNESS §2.8, HAR-R7).
 *
 * It lives on this surface because both sides load it and neither may import the
 * other (CRO-R1, CRO-R14): the pipeline calls the roles, the harness validates
 * the manifest. The point is that a manifest can never claim provenance for a
 * step that does not exist.
 *
 * Adding a role means adding it here *and* adding its prompt where it is used;
 * `PortRole` in `packages/pipeline/src/llm/live-adapter.ts` derives from this.
 */
export const PROMPT_ROLES = [
  // Triage: two independent per-sentence arms — whose words the sentence is
  // (`triage-speakership`) and what it is (`triage-checkability`) — plus one
  // context pass per checkable claim (ADR-0025).
  "triage-speakership",
  "triage-checkability",
  "triage-context",
  // The adversarial research loop (ADR-0026): the assessor's plan, the tool-loop
  // researcher, the researcher's passage extractor, and the critiquer.
  "claim-assessor",
  "researcher",
  "researcher-extract",
  "evidence-critiquer",
  // Used by source vetting: what kind of source a page is (ADR-0020).
  "authority-classify",
] as const;

/**
 * Sampling settings every live call REQUESTS.
 *
 * **This is a request, not a control — and on the configured stack it is
 * ignored.** The AI SDK warns `temperature is not supported by
 * claude-sonnet-5 and will be ignored` (Anthropic serves triage, the verdict
 * tier and the gate) and `seed is not supported` on the OpenRouter path, so
 * neither knob bites. The same input can therefore move a class between runs.
 *
 * It stays on the surface because what a run REQUESTS belongs in the run file
 * (CRO-R1, and two runs that differed here are not comparable) — but a manifest
 * carrying this must not be read as evidence that the provider honoured it. See
 * CROSS-CUTTING §2 and TRIAGE open question 9: determinism needs a mechanism
 * that survives an unseedable model, not a parameter.
 *
 * `seed: null` means no seed is configured at all; the seed applies only to
 * providers that accept one, and `modelVersions` names which ran.
 */
export const SAMPLING = { temperature: 0, seed: 20260901 } as const;

/**
 * Providers that accept a seed. Anthropic does not expose one, and the
 * OpenAI-compatible route does not honour it for every model behind it — so
 * membership here is a necessary condition, not a promise.
 */
export const SEEDABLE_PROVIDERS = ["openai", "openrouter"] as const;

/** A role in {@link PROMPT_ROLES}. */
export type PromptRole = (typeof PROMPT_ROLES)[number];
