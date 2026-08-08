# syntax=docker/dockerfile:1
#
# Built from this repo's own root, post Phase 1 extraction (see
# docs/plans/20260801-1935-mfe-pot-polyrepo-split-and-k8s-hosting.md).
#
# This is a single-package Nx "integrated" workspace, not a per-project
# pnpm workspace (no apps/*/package.json exists) -- Nx's `prune`/
# `prune-lockfile` executors expect the latter and fail here
# ("package.json does not exist"). So this copies the full workspace
# node_modules into the runtime stage rather than a pruned subset. That's
# an accepted PoT-scale simplification for now: this repo already depends
# only on the pinned @tn4consulting/shared-* packages plus this BFF's own
# runtime deps (express, cors), so node_modules is small -- no extra
# pruning step needed.
#
# `pnpm install` resolves the whole workspace lockfile (single root
# package.json), which includes @tn4consulting/shared-* even though this
# BFF's own source doesn't import them -- same GitHub Packages auth need,
# same file-mounted-secret and pnpm-store-cache-mount reasoning, as
# apps/job-bank-mfe/Dockerfile's top comment.
FROM node:22-alpine AS build
WORKDIR /workspace
# CI=true kept for consistency, and the pnpm.onlyBuiltDependencies fix
# (nx removed from that list) applied -- see apps/job-bank-mfe/Dockerfile's
# top comment for the fuller story on why.
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json tsconfig.json .npmrc ./
RUN --mount=type=secret,id=npm_token \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" pnpm install --frozen-lockfile --network-concurrency=4
COPY apps ./apps
COPY libs ./libs
COPY tools ./tools
RUN pnpm exec nx build job-bank-bff --configuration=production

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The Express server binds process.env.HOST (default 'localhost' in
# main.ts, meant for local dev) -- inside a container that must be
# 0.0.0.0, or the Pod's Service can never reach it despite the process
# looking healthy from inside its own container.
ENV HOST=0.0.0.0
COPY --from=build /workspace/dist/apps/job-bank-bff ./
COPY --from=build /workspace/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "main.js"]
