import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verdict pages are SSR atoms; no client-side fetching for verdict-first content.
  output: "standalone",
};

export default nextConfig;
