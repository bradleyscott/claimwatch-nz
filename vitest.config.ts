import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Mirrors apps/site/tsconfig.json paths so component tests resolve "@/...".
const SITE_SRC = resolve(import.meta.dirname ?? ".", "apps/site/src");

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.{ts,tsx}",
      // Next.js dynamic-route dirs like claim/[id] — brackets are glob classes.
      "apps/*/src/**/\\[*\\]/**/*.test.{ts,tsx}",
    ],
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // L1 must never touch paid APIs; a live-egress flag assertion (CRO-R6) guards this.
    env: {
      LIVE_EGRESS: "0",
    },
  },
  resolve: {
    alias: {
      "@": SITE_SRC,
    },
  },
});