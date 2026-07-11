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
Postgres-backed service. Migrations are tracked in `schema_migrations` and each
filename is applied at most once.

## Configuration notes

| Variable | Notes |
| --- | --- |
| `AUTH_TOKEN_SECRET` | Required non-default value when `NODE_ENV=production` |
| `BACKUP_R2_ENABLED` | Not supported yet; config validation rejects `true` |
| `UPLOAD_BODY_LIMIT_MB` | Caps raw, gzip-decompressed, and chunked uploads |
| Share rate limits | Process-local only; multi-replica needs a shared limiter or sticky routing |

## Implemented surface

Auth & access:

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET|POST /api-tokens`, `DELETE /api-tokens/{tokenID}`

Taxonomy & bookmarks:

- `GET /workspace/bootstrap`
- Folders/tags CRUD
- `GET|POST /bookmarks`, `POST /ingest/bookmarks`
- Bookmark detail/status/metadata/icons/sidebar-stats
- Private bookmarks under `/private/bookmarks`

Captures & objects:

- `POST /captures/init|complete`, `POST /private/captures/init|complete`
- `PUT /uploads/{key}`, `PUT /uploads/{key}/chunks/{uploadID}`
- `GET /objects`, `GET /public/objects`

Private mode & extension:

- Private mode setup/unlock/password/lock/status
- Extension connect code, redeem, devices list/revoke
  - Connect codes are stored in the repository (memory or Postgres) for multi-instance redeem

Imports, shares, backups:

- Import preview/create/list/detail
- Share CRUD + public share fetch
- Bookmark package export/import/preview
  - Import remaps object keys into `captures/<importerUserId>/...`

## Parity gaps vs TypeScript API

- Scheduled R2 bookmark backups (`BACKUP_R2_ENABLED`) are not implemented
- Share rate limiting is in-process only

## Tests

```sh
cd apps/api-go && go test ./...
```
