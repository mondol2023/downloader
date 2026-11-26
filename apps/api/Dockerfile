# One image serves both the `api` and the `worker` services (different CMD in docker-compose.yml).
# Build context is the repo root:  docker build -f apps/api/Dockerfile .

# ---- build: install the API's workspace slice and compile it ----
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rich-text/package.json packages/rich-text/
COPY apps/api/package.json apps/api/
# Only the API's dependency slice, not the web app's (Next, Tiptap React, Playwright...).
RUN npm ci --ignore-scripts \
  -w @media/api -w @media/shared -w @media/rich-text --include-workspace-root

COPY packages packages
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build -w @media/shared \
  && npm run build -w @media/rich-text \
  && npm run build -w @media/api

# ---- runtime ----
FROM node:24-slim AS runtime
ARG YTDLP_VERSION=latest
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates curl \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/${YTDLP_VERSION}/download/yt-dlp_linux" -o /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    STORAGE_DIR=/app/storage
WORKDIR /app/apps/api

# node_modules is kept whole (including the prisma CLI) so `prisma migrate deploy` can run from this image.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
