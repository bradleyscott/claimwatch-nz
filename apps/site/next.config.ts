import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verdict pages are SSR atoms; no client-side fetching for verdict-first content.
  output: "standalone",
  // The store's schema toolchain is loaded lazily and only by migration runs;
  // keep it out of the site's server bundle.
  serverExternalPackages: ["drizzle-kit"],
};

export default nextConfig;
