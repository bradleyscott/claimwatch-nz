import { defineConfig } from "drizzle-kit";

// Labels schema generation (HARNESS §2.4): label tables are generated against
// the SEPARATE `claimwatch_labels` database, and the pipeline's migration
// history never touches them. Generate-time only — `generate` needs no live
// connection (the URL is empty when unset), which is why CI can run it with no
// secrets present.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // No committed connection strings: set LABELS_DATABASE_URL in .env.
    url: process.env.LABELS_DATABASE_URL ?? "",
  },
});
