import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Private runtime development data must never become deployment assets.
  outputFileTracingExcludes: { "/*": ["./.dev-recordings/**/*"] },
};
export default nextConfig;
