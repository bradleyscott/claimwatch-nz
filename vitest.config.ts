import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// Load .env (gitignored) into process.env before suites run — no committed
// credentials anywhere (Sept 2026). CI sets env directly; .env is
// absent there and this is a no-op.
const envPath = resolve(import.meta.dirname ?? ".", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && match[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

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
      // CRO-R6: default to no live egress, but the shell wins (LIVE_EGRESS=1
      // in the command line enables the gated live smoke).
      LIVE_EGRESS: process.env.LIVE_EGRESS ?? "0",
    },
  },
  resolve: {
    alias: {
      "@": SITE_SRC,
    },
  },
});