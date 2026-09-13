// Store helpers: typed connections per role, append-only write surface.
// Implementation lands with the schema batch; the failing tests define the contract.

export * from "./claimreview.ts";
export * from "./domain.ts";
export * from "./schema/index.ts";
export * from "./site-reader.ts";
export * from "./store.ts";
export * from "./store-api.ts";

/** Bumped whenever an exported claim/verdict/evidence shape changes (CRO-R13). */
export const STORE_SCHEMA_VERSION = "0.3.0";
