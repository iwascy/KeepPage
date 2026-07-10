# KeepPage Go API

Experimental Go backend for a contract-first, module-by-module migration from the existing TypeScript API.

## Development

```sh
npm run dev -w @keeppage/api-go
```

Default address:

```text
127.0.0.1:8788
```

For Postgres-backed development:

```sh
STORAGE_DRIVER=postgres DATABASE_URL=postgres://... npm run db:init -w @keeppage/api-go
STORAGE_DRIVER=postgres DATABASE_URL=postgres://... npm run dev -w @keeppage/api-go
```

The container entrypoint runs the same migration command before starting a
Postgres-backed service.

The current vertical slice includes:

- `GET /`
- `GET /health`
- `GET /bookmarks`
- `POST /bookmarks`
- `POST /ingest/bookmarks`

`POST /bookmarks` is a Go-only convenience endpoint for the initial vertical slice. `POST /ingest/bookmarks` matches the existing TypeScript ingest contract and reuses the same service path.
