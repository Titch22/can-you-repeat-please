# Game server + built web app in one image. See docs/DEPLOYMENT.md.

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app

# Dependencies first, for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm --filter @cyrp/server build \
 && pnpm --filter @cyrp/web build \
 && pnpm --filter @cyrp/server deploy --prod /out/server

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app

# Same layout as the repo: the server finds sounds/, apps/web/dist and tmp/ from its own path.
COPY --from=build /out/server/package.json apps/server/package.json
COPY --from=build /out/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY sounds/default sounds/default
RUN mkdir tmp && chown node:node tmp

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
