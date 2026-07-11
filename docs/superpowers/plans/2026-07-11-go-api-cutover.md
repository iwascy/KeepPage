# Go API Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/api-go` the default production API, close the two documented parity gaps, and safely cut over the Singapore service.

**Architecture:** Extend the existing Go repository/storage/service layers with a scheduler and shared fixed-window limiter. Build Go as the stable `api` Compose service, retain the TS image as a rollback override, and validate with a sidecar before switching traffic.

**Tech Stack:** Go 1.23/1.24, chi, pgx, AWS SDK v2 S3, Docker Compose, Postgres 16, existing React/Nginx web container.

## Global Constraints

- Preserve existing Postgres and object-storage data volumes.
- Do not remove `apps/api` or generated outputs.
- Preserve the current `api:8787` internal upstream and public container port.
- Preserve uncommitted remote `._*` files; do not add or delete them.
- Use ASCII source edits and existing 2-space TypeScript / gofmt Go style.

### Task 1: Port scheduled R2 backups

**Files:**
- Modify: `apps/api-go/internal/repository/repository.go`
- Modify: `apps/api-go/internal/repository/postgres.go`
- Modify: `apps/api-go/internal/repository/memory.go`
- Modify: `apps/api-go/internal/jobs/r2_bookmark_backup.go`
- Modify: `apps/api-go/internal/config/config.go`
- Modify: `apps/api-go/cmd/server/main.go`
- Test: `apps/api-go/internal/jobs/r2_bookmark_backup_test.go`

- [ ] Add a repository method returning backup users and implement it for memory/Postgres.
- [ ] Add the scheduler’s S3 client, next-run calculation, startup trigger, overlap guard, manifest, and per-user upload behavior by calling `BackupService.Export`.
- [ ] Pass the backup service into the scheduler and remove the config rejection for enabled backups.
- [ ] Add tests for prefix/date calculation, disabled behavior, and successful/partial upload manifests using fakes.
- [ ] Run `gofmt -w` on changed Go files and `go test ./...` in `apps/api-go`.

### Task 2: Add shared share rate limiting

**Files:**
- Create: `apps/api-go/migrations/0015_rate_limits.sql`
- Modify: `apps/api-go/internal/repository/repository.go`
- Modify: `apps/api-go/internal/repository/postgres.go`
- Modify: `apps/api-go/internal/repository/memory.go`
- Modify: `apps/api-go/internal/httpapi/imports_shares.go`
- Test: `apps/api-go/internal/httpapi/server_test.go`

- [ ] Add a `rate_limit_buckets` table with a unique scope/key/window constraint and expiry index.
- [ ] Implement an atomic `HitRateLimit` repository operation returning allowed/retry seconds.
- [ ] Replace the two package-global memory limiters with the repository operation.
- [ ] Test that the second process semantics are shared through the Postgres implementation and that HTTP returns `429` with `Retry-After`.
- [ ] Run migrations and `go test ./...`.

### Task 3: Switch build and documentation defaults

**Files:**
- Create: `deploy/api-go.Dockerfile`
- Create: `deploy/docker-compose.ts-rollback.yml`
- Modify: `deploy/docker-compose.yml`
- Modify: `package.json`
- Modify: `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/usage.md`

- [ ] Build a static Go server and migration binary, run migrations for Postgres, and expose port 8787.
- [ ] Make Compose build the Go API by default while keeping the TS Dockerfile available through the rollback override.
- [ ] Update root commands and operational docs to identify Go as the default API and TS as rollback-only.
- [ ] Build the Go image and run repo-wide type checks.

### Task 4: Singapore sidecar and cutover

**Files:**
- Remote only: `/data/apps/keeppage/deploy/*`, `/data/apps/keeppage/shared/*` as needed; do not edit repository `._*` files.

- [ ] Snapshot the current Compose configuration and API image reference.
- [ ] Build/run Go on a temporary host port using the production env and existing volumes.
- [ ] Run health and authenticated smoke tests, including object upload/read and public share fetch.
- [ ] Switch the `keeppage-api` service to Go, recreate only API/Web as needed, and verify health/logs.
- [ ] Keep the TS rollback override and verify it is syntactically valid without activating it.

### Task 5: Final verification

- [ ] Run `go test ./...`, `npm run typecheck`, and `docker build` locally.
- [ ] Run remote `docker compose ps`, health checks, and recent API logs.
- [ ] Compare the deployment commit/image to `a32a999` and report any residual risk.
