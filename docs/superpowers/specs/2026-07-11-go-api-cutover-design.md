# Go API Cutover Design

## Goal

Make `apps/api-go` the production KeepPage API while preserving the existing TypeScript API as an explicit rollback path.

## Scope

- Port scheduled R2 bookmark backups from `apps/api` to Go.
- Replace process-local share rate limiting with a Postgres-backed fixed-window limiter. The memory repository keeps an in-process implementation for tests and local development.
- Add a Go production image and make the deploy Compose file select Go by default.
- Keep `apps/api` and its Dockerfile intact for rollback; do not migrate or delete existing Postgres/object-storage data.
- Validate the Go service against the production database and object storage on `oracle-singapore` before switching the Web proxy.

## Architecture

The Go server constructs one backup service and one scheduler. The scheduler computes the next local `HH:mm` run, optionally performs a startup run, exports each user’s normal bookmarks through the existing `BackupService`, and uploads per-user packages plus a manifest through the existing `ObjectStorage` interface. Scheduler overlap is prevented inside a process.

Share create and public-share requests use a repository rate-limit operation. The Postgres implementation atomically deletes expired buckets and inserts the current hit under a unique `(scope, key, window_start)` row; the memory implementation mirrors the same contract. HTTP handlers return `429` and `Retry-After` using the operation result.

The deployment keeps the public API port and Docker service name stable. Only the API image/build target changes from Node/TS to Go, so Web’s `api:8787` upstream and existing volumes remain unchanged. A separate rollback override points the API service back to the TypeScript Dockerfile.

## Safety and rollback

- Existing Postgres and object-storage volumes are reused without destructive migration.
- Go is first built and run on a temporary host port with the same environment and database.
- Smoke tests cover health, auth, workspace, bookmarks, capture upload/read, private mode, shares, and extension ingest.
- The previous TS image is retained and rollback is performed by the saved Compose override followed by a health check.

## Acceptance criteria

1. `go test ./...` and `npm run typecheck` pass locally.
2. Go accepts `BACKUP_R2_ENABLED=true` when its R2 settings are valid and starts/stops the scheduler cleanly.
3. Share rate limiting is consistent across two Go processes sharing Postgres.
4. The Go production image builds successfully.
5. The Singapore service answers `/health` and the smoke-test endpoints after cutover; rollback remains executable without data changes.
