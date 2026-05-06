FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN npm ci --include=dev \
  --workspace @keeppage/web \
  --workspace @keeppage/domain \
  --include-workspace-root=false \
  && if [ "$(dpkg --print-architecture)" = "arm64" ]; then npm install --no-save --package-lock=false @rollup/rollup-linux-arm64-gnu@4.59.0; fi \
  && npm cache clean --force

COPY apps/web ./apps/web
COPY packages/domain ./packages/domain
COPY tsconfig.base.json ./tsconfig.base.json

ARG VITE_API_BASE_URL=/api
ARG VITE_COVER_IMAGE_ORIGIN=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_COVER_IMAGE_ORIGIN=${VITE_COVER_IMAGE_ORIGIN}

RUN npm run build -w @keeppage/web

FROM nginx:1.27-alpine

COPY deploy/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
