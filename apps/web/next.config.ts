import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo-root .env is the single source of truth (STREAM_SIGNING_SECRET, ALLOWED_STREAM_HOSTS, API_INTERNAL_URL).
// forceReload: Next has already loaded (and cached) apps/web/.env* by the time this file runs.
loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production", console, true);

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@media/shared"],
  // Same-origin proxy so the refresh cookie (path /api/v1/auth) needs no CORS.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${API_INTERNAL_URL}/api/v1/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
