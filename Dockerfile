# Stage 1: Build & Dependencies
#
# `oven/bun` rather than node + `npm i -g bun`. The previous form installed npm
# and its whole dependency tree purely to throw it away and download a second
# runtime, so the builder carried two package managers and cached the npm one for
# no reason. The image also puts bun on PATH by construction, which means the
# version is the image's, not whatever npm resolved that week.
#
# Node is still required at runtime (see stage 2) but not here: `bun install`,
# `bun run build` and `esbuild` are all that stage 1 does.
FROM oven/bun:1-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./

# Install all dependencies using bun cache
RUN bun install --frozen-lockfile

# Copy application source code
COPY . .

ARG GIT_COMMIT_SHA
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

# Build Astro SSR application
ENV NODE_ENV=production
RUN bun run build

# Bundle the OTel preload to a standalone ESM module. `node:http` can only be
# instrumented if the SDK runs before the server entry is evaluated, so this has
# to be a real `--import` preload rather than an in-app import.
# `bunx`, not `npx`: the builder image is bun-based and ships no npm.
RUN bunx esbuild instrumentation.ts \
      --bundle --platform=node --format=esm --target=node22 \
      --packages=external --outfile=dist/instrumentation.mjs

# Prune dev dependencies for production runtime
RUN rm -rf node_modules/.vite node_modules/.vite-cache 2>/dev/null || true
RUN bun install --production

# Stage 2: Production Server Runtime (Lean & Minimal)
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4321
ENV HOST=0.0.0.0
# Harmless when tracing is off — the preload exits after a single env check.
ENV NODE_OPTIONS=--import=/app/dist/instrumentation.mjs

# Security: Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy pruned node_modules directly with proper ownership (0s chown overhead)
COPY --chown=appuser:appgroup --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appgroup --from=builder /app/package*.json ./
COPY --chown=appuser:appgroup --from=builder /app/dist ./dist
COPY --chown=appuser:appgroup --from=builder /app/public ./public
COPY --chown=appuser:appgroup --from=builder /app/scripts ./scripts
COPY --chown=appuser:appgroup --from=builder /app/migrations ./migrations
COPY --chown=appuser:appgroup --from=builder /app/src ./src
USER appuser

EXPOSE 4321

# Probe the liveness endpoint over IPv4 explicitly: the server binds 0.0.0.0, so
# `localhost` resolves to ::1 first and every check fails against a healthy
# process. Probing / rather than a health route would also render a whole page
# every 30s. See plan/core-architecture/32-observability-and-telemetry-stack.md
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4321/api/v1/health || exit 1

CMD ["node", "./dist/server/entry.mjs"]
