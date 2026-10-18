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

USER node
VOLUME /app/data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.js"]
