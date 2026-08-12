# Built from the MONOREPO ROOT context (see compose.yaml `context: .`)
# because this app depends on the workspace package @zulivio/types.
# Do not try to `docker build` this file with apps/backend as context.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- deps: install with full workspace visible so pnpm can link @zulivio/types ---
FROM base AS deps
RUN apk add --no-cache openssl
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

# --- builder: generate Prisma client, build Nest ---
# (backend has no runtime dependency on @zulivio/types — that package is
# consumed by the web app only.)
FROM deps AS builder
COPY apps/backend apps/backend
RUN pnpm --filter backend exec prisma generate
RUN pnpm --filter backend build

# --- runtime: slim image, only what's needed to run ---
# Keeps the SAME directory depth as the workspace (/repo/apps/backend, not a
# flattened /app) — pnpm's per-package node_modules/.bin/* entries are
# symlinks with relative paths back into the root node_modules/.pnpm store,
# and flattening the tree breaks them silently.
FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
RUN addgroup -S nodedr && adduser -S nodedr -G nodedr
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /repo/apps/backend/dist ./apps/backend/dist
COPY --from=builder /repo/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /repo/apps/backend/package.json ./apps/backend/package.json

RUN mkdir -p /data/uploads && chown -R nodedr:nodedr /data/uploads /repo
USER nodedr

WORKDIR /repo/apps/backend
EXPOSE 4100
CMD ["node", "dist/src/main.js"]
