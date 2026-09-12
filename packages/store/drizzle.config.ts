import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // No committed connection strings: set DATABASE_URL in .env (gitignored).
    url: process.env.DATABASE_URL ?? "",
  },
});
