# syntax=docker/dockerfile:1
#
# Built from this repo's own root, post Phase 1 extraction (see
# docs/plans/20260801-1935-mfe-pot-polyrepo-split-and-k8s-hosting.md).
#
# One image, built once, promoted across environments unchanged -- see
# CLAUDE.md's Hosting section. Environment-specific values are injected at
# container startup via MFE_POT_ENV_JSON (see tools/docker/frontend-entrypoint.sh),
# never baked in at build time.
#
# `pnpm install` needs to fetch @tn4consulting/shared-* from GitHub
# Packages, which requires auth the build container doesn't have by
# default (unlike a host install, which picks up ~/.npmrc). The token is
# passed as a BuildKit secret (`--secret id=npm_token,env=NODE_AUTH_TOKEN`),
# mounted as a file rather than an env var directly -- this environment's
# Docker Desktop doesn't support the newer `--mount=...,env=` form
# (errors with "experimental feature exec.secretenv is not supported") --
# so it's available to this RUN step's environment only and never gets
# written into an image layer or the build cache. CI passes its same-org
# GITHUB_TOKEN the same way.
#
# The pnpm store is cache-mounted (persists across builds) and
# network-concurrency is capped. Root cause: this environment's Docker
# Desktop had too little memory allocated (~2GiB) while several unrelated
# containers were also running, which manifested as slow tarball
# downloads and ECONNRESET retries against the npm registry, then an
# outright OOM-killed install (exit 137) -- not genuine registry
# flakiness. A warm store plus fewer concurrent connections reduces peak
# memory during install regardless of how much headroom Docker actually
# has, so kept even after freeing memory fixed the immediate cause.

FROM node:22-alpine AS build
WORKDIR /workspace
# CI=true is Nx's own documented signal for non-interactive environments;
# harmless to set even though it turned out not to be the actual fix
# below. `nx`'s postinstall script (dist/bin/post-install.js) has its own
# internal 30s watchdog timer that force-exits regardless of what it's
# doing -- so a hang lasting many minutes, past that timer, can't be
# happening inside the script's own logic at all; something upstream
# (module loading, or pnpm's own script-running machinery) never gets far
# enough to hit it. Root cause not fully isolated, but the fix is simple:
# pnpm only runs a dependency's install/postinstall scripts for packages
# explicitly listed in `pnpm.onlyBuiltDependencies` below, and nx doesn't
# need this optional hook to function as a CLI -- removed "nx" from that
# list entirely rather than chase the hang further.
ENV CI=true
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json tsconfig.json .npmrc ./
RUN --mount=type=secret,id=npm_token \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" pnpm install --frozen-lockfile --network-concurrency=4
COPY apps ./apps
COPY libs ./libs
COPY tools ./tools
RUN pnpm exec nx build job-bank-mfe --configuration=production

# Signs the built federation manifest so a shell can verify it before
# trusting/executing the code it points at -- see mfe-pot/docs/plans/
# 20260811-1500-federation-remote-loading-integrity.md. The private key
# never leaves this build container: mounted as a BuildKit secret file
# (same pattern as npm_token above), read once by sign-remote-manifest,
# never written into an image layer or the build cache. REMOTE_SIGNING_KID
# is not secret -- it's how the shell picks which trust-registry entry to
# verify against -- so it's a plain build arg, not a secret mount.
ARG REMOTE_SIGNING_KID
RUN --mount=type=secret,id=remote_signing_key \
    pnpm exec sign-remote-manifest \
      --dist dist/apps/job-bank-mfe/browser \
      --remote-name job-bank-mfe \
      --private-key /run/secrets/remote_signing_key \
      --kid "$REMOTE_SIGNING_KID"

FROM nginx:alpine AS runtime
COPY tools/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY tools/docker/frontend-entrypoint.sh /docker-entrypoint.d/40-mfe-pot-env.sh
RUN chmod +x /docker-entrypoint.d/40-mfe-pot-env.sh
COPY --from=build /workspace/dist/apps/job-bank-mfe/browser /usr/share/nginx/html
EXPOSE 80
