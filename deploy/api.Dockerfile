FROM node:22-bookworm-slim AS deps
WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN npm ci --include=dev --omit=optional \
  --workspace @keeppage/api \
  --workspace @keeppage/db \
  --workspace @keeppage/domain \
  --include-workspace-root=false \
  && npm cache clean --force

FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/domain ./packages/domain
COPY tsconfig.base.json ./tsconfig.base.json

EXPOSE 8787

CMD ["sh", "-lc", "mkdir -p /app-logs /app-data/object-storage && npm run db:init -w @keeppage/api >> /app-logs/bootstrap.log 2>&1 && exec npm run start -w @keeppage/api >> /app-logs/api.log 2>&1"]
