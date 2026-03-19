# Repository Guidelines

## Project Structure & Module Organization
`KeepPage` uses npm workspaces. `apps/api` holds the Fastify backend, with routes in `src/routes` and storage in `src/repositories`; treat `apps/api/data/` as runtime data. `apps/web` is the React + Vite UI. `apps/extension` is the WXT Chrome MV3 extension, with browser entrypoints in `entrypoints/` and shared code in `src/lib/`. Shared schemas live in `packages/domain`; Drizzle schema and migrations live in `packages/db`. Docs are in `docs/`. Do not edit generated outputs such as `apps/web/dist`, `apps/extension/.output`, or `apps/extension/.wxt`.

## Build, Test, and Development Commands
Run `npm install` once at the repo root. Use `npm run dev:api` to start the API on `127.0.0.1:8787`, `npm run dev:web` for the Vite UI, and `npm run dev:extension` for extension development. `npm run build` builds every workspace that defines a `build` script. `npm run typecheck` is the repo-wide verification baseline. For Postgres-backed development, set `STORAGE_DRIVER=postgres`, provide `DATABASE_URL`, then run `npm run db:init -w @keeppage/api`.

## Extension Change Requirements
Whenever you modify code or configuration under `apps/extension`, you must do all of the following before finishing:
- Bump the extension version in both `apps/extension/package.json` and `apps/extension/wxt.config.ts`.
- Run `npm run build -w @keeppage/extension` to generate fresh extension artifacts.
- Never hand-edit generated directories such as `apps/extension/.output` or `apps/extension/.wxt`; regenerate them through the build command instead.

## Coding Style & Naming Conventions
Use strict TypeScript and ESM modules. Match the existing style: 2-space indentation, double quotes, semicolons, and small focused files. Use `PascalCase` for React components, `camelCase` for functions and variables, and kebab-case for utility or route filenames such as `singlefile-fetch.ts`. Keep shared contracts in `packages/domain` and public entrypoints in `src/index.ts`. No repo-wide ESLint or Prettier config is committed, so follow surrounding code closely.

## Testing Guidelines
There is no committed automated test runner yet. For every change, run `npm run typecheck` and include manual smoke checks in the PR. Verify the surface you touched: API routes like `GET /health`, web list/detail flows, or extension capture/sync behavior. If you add tests, place them near the owning module and name them `*.test.ts`.

## Commit & Pull Request Guidelines
Recent history uses short imperative commit subjects, sometimes with a prefix, for example `Fix extension upload URLs and add capture debug logging` or `docs: add usage and deployment guides`. Keep commits focused and concise. PRs should include the problem being solved, affected workspace(s), config or env changes, manual verification steps, and screenshots for `apps/web` or `apps/extension` UI changes. Link related issues when available.

## Configuration & Communication
Default local development uses `STORAGE_DRIVER=memory`; Postgres requires `DATABASE_URL`. `OBJECT_STORAGE_ROOT` defaults to `./data/object-storage`. Never commit secrets or runtime object data. In repo discussions, reviews, and assistant responses, default to Simplified Chinese unless the task clearly needs another language.
