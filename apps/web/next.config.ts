import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo-root .env is the single source of truth (STREAM_SIGNING_SECRET, ALLOWED_STREAM_HOSTS, API_INTERNAL_URL).
// forceReload: Next has already loaded (and cached) apps/web/.env* by the time this file runs.
loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image; traced from the repo root so workspace packages are included.
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // The Express API runs inside Next route handlers; keep it and its native deps out of the bundle.
  serverExternalPackages: ["@media/api", "argon2", "sharp", "@prisma/client", "prisma", "bullmq", "ioredis", "pino", "googleapis"],
  transpilePackages: ["@media/shared", "@media/rich-text"],
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
