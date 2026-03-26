FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN npm ci --include=dev --omit=optional \
  --workspace @keeppage/web \
  --workspace @keeppage/domain \
  --include-workspace-root=false \
  && npm cache clean --force

COPY apps/web ./apps/web
COPY packages/domain ./packages/domain
COPY tsconfig.base.json ./tsconfig.base.json

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build -w @keeppage/web

FROM nginx:1.27-alpine

COPY deploy/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
