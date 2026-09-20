# KeepPage Go API

Production-default Go backend for KeepPage. The TypeScript API remains under `apps/api` as a rollback implementation.

## Development

```sh
npm run dev -w @keeppage/api-go
```

Default address:

```text
127.0.0.1:8787
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
| `BACKUP_R2_ENABLED` | Enables scheduled per-user R2 bookmark backups |
| `AI_CREDENTIAL_ENCRYPTION_KEY` | Required to save AI provider API keys; use a stable high-entropy secret |
| `AI_ALLOW_PRIVATE_BASE_URL` | Allows HTTP/private-network AI endpoints for trusted self-hosted deployments; defaults to `false` |
| `UPLOAD_BODY_LIMIT_MB` | Caps raw, gzip-decompressed, and chunked uploads |
| Share rate limits | Stored in Postgres fixed-window buckets; memory mode is process-local for development |

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

## Tests

```sh
cd apps/api-go && go test ./...
```

## Browser sessions

Web login/register opt into refresh sessions with `X-KeepPage-Session: web`.
The API returns a 20-minute bearer and a rotating 30-day refresh cookie
(`HttpOnly`, `SameSite=Strict`, `Secure` in production). `POST /auth/refresh`
rotates it; `POST /auth/logout` revokes the family and immediately invalidates
its access tokens. Both require the custom header and a trusted `Origin`.
Set `WEB_PUBLIC_BASE_URL` to the exact public Web origin. Serve Web and `/api`
through the same origin; localhost Vite proxy is supported in development.

`AUTH_ACCESS_TOKEN_TTL_MINUTES` defaults to 20;
`AUTH_REFRESH_TOKEN_TTL_DAYS` defaults to 30 (absolute lifetime, not sliding).
The old `AUTH_TOKEN_TTL_DAYS` still controls clients without the opt-in header,
including legacy extension logins. Existing bearers remain valid until their
original expiry; signing in again adopts the refresh flow.

Apply `0017_auth_refresh_sessions.sql` using the normal migrator before deploying.
Postgres stores token hashes and rotation state; memory mode loses sessions on
restart. Expired records are cleaned on new browser login. API/device usage
writes are throttled to 5 minutes while revocation is checked on every request.

See [authentication design](../../docs/auth-sessions.md) for security boundaries
and regression commands.
