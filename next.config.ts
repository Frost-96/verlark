import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/practices/*/uploads": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/ffmpeg-static/ffmpeg.LICENSE",
      "./node_modules/ffmpeg-static/ffmpeg.README",
    ],
  },
  // Private runtime development data must never become deployment assets.
  outputFileTracingExcludes: { "/*": ["./.dev-recordings/**/*"] },
};
export default nextConfig;
