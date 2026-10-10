import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve this repository's hand-maintained agent instructions during development.
  agentRules: false,
  // Normal builds support `next start`; the Docker build opts into its bundled server.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
};

export default nextConfig;
