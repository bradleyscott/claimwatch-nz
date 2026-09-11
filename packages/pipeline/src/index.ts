// Pipeline public surface: the deterministic verification surface plus the
// versioned config constants other packages pin against.

export { FINGERPRINT_NORMALISATION_VERSION, GRID_AXES_VERSION } from "@cw/llm";
export * from "./ingestion.ts";
