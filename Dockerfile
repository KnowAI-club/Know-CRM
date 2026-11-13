# syntax=docker/dockerfile:1
# Multi-stage build for KnowBook CRM. `docker compose up` builds the `api` and `web` targets.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── Install all workspace dependencies (cached until a package manifest changes) ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

# ── Build shared package, API and web app ──
FROM deps AS build
COPY . .
# Next.js bakes the /api proxy target into the build; inside compose the API is reachable as "api".
ARG API_INTERNAL_URL=http://api:4010
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_OUTPUT=standalone
RUN mkdir -p apps/web/public && npm run build

# ── Production dependencies for the API only ──
FROM base AS api-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @know-crm/api --include-workspace-root=false

# ── API image ──
FROM base AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4010 STORAGE_DIR=/data/storage
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
WORKDIR /app/apps/api
EXPOSE 4010
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4010/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# ── Web image (Next.js standalone server) ──
FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3010
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 3010
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3010/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
