# Build context is the repo root:  docker build -f apps/web/Dockerfile .

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rich-text/package.json packages/rich-text/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts \
  -w @media/web -w @media/shared -w @media/rich-text --include-workspace-root

COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @media/shared && npm run build -w @media/rich-text
# API_INTERNAL_URL is baked into the /api/v1 rewrite at build time; compose passes the same value at runtime.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @media/web

FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# standalone output is traced from the repo root, so the server lands at apps/web/server.js.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
