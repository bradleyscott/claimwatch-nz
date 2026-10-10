// VERIFICATION public surface (ADR-0026): the adversarial research loop is the
// engine, and the class-agreement gate decides the published class. The
// procedure library, the deterministic checks and the NLI gate are removed; see
// `research.ts` for the loop.

export * from "./verification/agreement.ts";
export type { VerdictClass } from "./verification-api.ts";
