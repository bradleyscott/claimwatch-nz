import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // L1 must never touch paid APIs; a live-egress flag assertion (CRO-R6) guards this.
    env: {
      LIVE_EGRESS: "0",
    },
  },
});