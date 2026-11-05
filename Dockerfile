# Symbiose server: one small image, one volume (/data). Multi-arch (amd64/arm64).

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Install only what the server needs. Native install scripts are skipped:
# better-sqlite3 ships prebuilt binaries for linux/musl.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@symbiose/server..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/core packages/core
COPY apps/server apps/server
RUN pnpm --filter @symbiose/server build \
 && mkdir -p /out/node_modules \
 && cp -r node_modules/better-sqlite3 /out/node_modules/ \
 && rm -rf /out/node_modules/better-sqlite3/deps /out/node_modules/better-sqlite3/src /out/node_modules/better-sqlite3/build \
 && cp -r apps/server/dist packages/core/drizzle /out/ \
 && printf '{"name":"symbiose-server","private":true,"type":"module"}\n' > /out/package.json

FROM node:22-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
