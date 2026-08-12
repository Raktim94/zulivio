# Built from the MONOREPO ROOT context (see compose.yaml `context: .`)
# because this app depends on the workspace package @zulivio/types.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- deps ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

# --- builder ---
# BACKEND_URL is a build ARG, not a runtime env — Next.js bakes rewrite
# destinations into the routes manifest at build time.
FROM deps AS builder
ARG BACKEND_URL=http://backend:4100
ENV BACKEND_URL=${BACKEND_URL}
COPY packages/types packages/types
COPY apps/web apps/web
RUN pnpm --filter @zulivio/types build
RUN pnpm --filter web build

# --- runtime ---
FROM node:24-alpine AS runtime
RUN addgroup -S nodedr && adduser -S nodedr -G nodedr
WORKDIR /app
ENV NODE_ENV=production

# The standalone server (apps/web/server.js) resolves `public/` and
# `.next/static` relative to its own traced monorepo path.
COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

RUN chown -R nodedr:nodedr /app
USER nodedr

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
