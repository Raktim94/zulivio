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

# Docker CLI (optional in-container "update & restart" against mounted
# docker.sock — see src/system/update.service.ts). Pulled from the official
# docker:cli image rather than Alpine's community docker-cli package so the
# binary is guaranteed present/current across both amd64 and arm64 builds.
FROM docker:cli AS dockercli

# Fetches the docker-compose CLI plugin binary in its own throwaway stage —
# deliberately NOT via `apk add curl` in the runtime stage itself. Alpine's
# package resolver can pull in a newer transitive openssl than the one
# already pinned there, and the Prisma query engine binary (downloaded at
# `prisma generate` time in the builder stage, matched to a specific
# musl/openssl ABI) then fails at startup with "could not locate the Query
# Engine for runtime linux-musl..." (hit and fixed this exact way in
# nodedr-restaurant-pos's identical self-update feature). Isolating the
# fetch here keeps the runtime stage's apk install byte-for-byte what it
# was before self-update existed.
FROM alpine:3.20 AS compose-fetch
ARG TARGETARCH=amd64
RUN apk add --no-cache curl \
  && case "$TARGETARCH" in \
       amd64) DARCH=x86_64 ;; \
       arm64) DARCH=aarch64 ;; \
       *) DARCH=$TARGETARCH ;; \
     esac \
  && curl -fsSL --retry 3 --retry-delay 2 \
     "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-${DARCH}" \
     -o /docker-compose \
  && chmod +x /docker-compose

# --- runtime: slim image, only what's needed to run ---
# Keeps the SAME directory depth as the workspace (/repo/apps/backend, not a
# flattened /app) — pnpm's per-package node_modules/.bin/* entries are
# symlinks with relative paths back into the root node_modules/.pnpm store,
# and flattening the tree breaks them silently.
FROM node:24-alpine AS runtime
# postgresql16-client (matching the postgres:16-alpine server used
# everywhere in this app) provides pg_dump/pg_restore for the backup
# feature; tar is used to archive the uploads volume alongside the DB dump.
RUN apk add --no-cache openssl postgresql16-client tar
RUN mkdir -p /usr/local/lib/docker/cli-plugins
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=compose-fetch /docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
WORKDIR /repo
ENV NODE_ENV=production
# Baked in at build time (compose.yaml passes APP_VERSION as a build arg,
# e.g. from `git describe --tags`) so the running app can report its own
# version for the "update available" check — see src/system/version.*.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /repo/apps/backend/dist ./apps/backend/dist
COPY --from=builder /repo/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /repo/apps/backend/package.json ./apps/backend/package.json

RUN mkdir -p /data/uploads /data/secrets
# Runs as root — a deliberate consequence of the self-update feature, not
# an oversight: docker.sock access already grants host-root-equivalent
# control regardless of the container's own UID, so a separate
# unprivileged user provides no real additional isolation once that mount
# exists (same reasoning as Submify's identical Dockerfile decision).

WORKDIR /repo/apps/backend
EXPOSE 4100
CMD ["node", "dist/src/main.js"]
