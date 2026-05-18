import type { NextConfig } from "next";

const config: NextConfig = {
  // typedRoutes is stable in Next 15.5+, no longer experimental.
  typedRoutes: true,
  // Pin the workspace root so Next doesn't pick up an unrelated home-dir lockfile.
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "maps.googleapis.com" },
      { protocol: "https", hostname: "*.tile.openstreetmap.org" },
      { protocol: "https", hostname: "api.mapbox.com" },
    ],
  },
};

export default config;
