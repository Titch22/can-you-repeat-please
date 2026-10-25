# Sound library service. Build from the repo root:
#   docker build -f apps/sounds/Dockerfile .
# See docs/DEPLOYMENT.md.

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app

# Every workspace package.json, so the lockfile matches.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/sounds/package.json apps/sounds/
COPY apps/web/package.json apps/web/
COPY packages/audio/package.json packages/audio/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @cyrp/sounds...

COPY packages packages
COPY apps/sounds apps/sounds
RUN pnpm --filter @cyrp/sounds build \
 && pnpm --filter @cyrp/sounds deploy --prod /out/sounds

FROM node:24-slim
ENV NODE_ENV=production \
    SOUNDS_DATA_DIR=/app/data
WORKDIR /app/sounds

COPY --from=build /out/sounds/package.json package.json
COPY --from=build /out/sounds/node_modules node_modules
COPY --from=build /app/apps/sounds/dist dist
RUN mkdir /app/data && chown node:node /app/data

# yt-dlp, for sounds added from YouTube links: the standalone binary (no Python), pinned and
# checked. YouTube changes often: bump the version (and checksum, from the release's
# SHA2-256SUMS) when downloads start failing.
ARG YTDLP_VERSION=2026.10.21
ARG YTDLP_SHA256=d8bd33fca9d5b23bd5b9952b3fca36db5c46331933fda9f598a3da14ce2c243f
ADD --chmod=755 --checksum=sha256:${YTDLP_SHA256}     https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux     /usr/local/bin/yt-dlp

USER node
VOLUME /app/data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.js"]
