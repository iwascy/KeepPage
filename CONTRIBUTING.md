# Contributing · 参与贡献

Thanks for helping improve KeepPage. Issues and pull requests may be written in English or Simplified Chinese.

欢迎参与 KeepPage，Issue 和 PR 均可使用中文或英文。

## Before you start · 开始之前

- For bugs, include reproduction steps, the affected surface (web, extension, or API), versions, and expected versus actual behavior. Remove tokens, passwords, personal archives, and connection strings from logs.
- For larger changes, open an issue first to agree on scope. Keep pull requests focused.
- A project-wide license is still pending; see the [licensing notes](docs/legal/singlefile-license.md). No CLA or alternative license is implied by this guide.

报告问题时请提供复现步骤、受影响模块、版本和预期行为；日志与截图应去除密钥和私人内容。较大改动先通过 Issue 对齐范围。整体许可证尚未确定，本指南不构成 CLA 或其他授权。

## Local setup · 本地环境

Use Node.js 24, npm, Go 1.24+, and Chrome for extension work. Run `npm ci` at the repository root. See the [English quick start](README.md#quick-start) or [中文快速开始](README.zh-CN.md#快速开始).

The Go API in `apps/api-go` is the production backend. The TypeScript backend in `apps/api` is retained for rollback. Go database migrations belong in `apps/api-go/migrations/`; changing only the Drizzle schema does not migrate the Go backend.

## Checks · 验证

Run the repository baseline for every change:

```bash
npm run typecheck
```

This includes TypeScript checks and the Go test suite. PostgreSQL integration tests opt in with `KEEPPAGE_SEARCH_TEST_DATABASE_URL` or `KEEPPAGE_AUTH_TEST_DATABASE_URL` pointing to a disposable test database; inspect the relevant test before running it. Never use a production database for tests.

For web changes:

```bash
npm run build -w @keeppage/web
node --experimental-strip-types --test apps/web/src/lib/batch-actions.test.ts apps/web/src/lib/bookmark-list-cache.test.ts apps/web/src/lib/bookmark-window.test.ts apps/web/src/app/search-scope.test.ts apps/web/src/api/import-request.test.ts
```

Also smoke-test the affected flow and narrow-screen layout. Demo mode covers the UI but cannot verify real authentication, capture, AI, or sync. See the [UI regression baseline](docs/ui-refactor-baseline.md).

Whenever changing code or configuration under `apps/extension`:

1. Bump the version in **both** `apps/extension/package.json` and `apps/extension/wxt.config.ts`.
2. Run `npm run build -w @keeppage/extension`.
3. Load the fresh build in Chrome and verify the affected capture, popup, Side Panel, or sync flow.

每次改动运行 `npm run typecheck`。Web 改动补充生产构建、相关测试和界面检查；扩展改动必须同步升版并重新构建，使用真实 Chrome 扩展入口验证。

## Code and generated files · 代码与生成产物

Follow [AGENTS.md](AGENTS.md) and the style of the file you edit: strict TypeScript, ESM, two-space indentation, double quotes, and semicolons. Keep shared API contracts in `packages/domain` and check compatibility with the Go implementation.

Do not hand-edit or commit `dist/`, `.output/`, `.wxt/`, runtime data, secrets, or standalone demo builds. Temporary screenshots belong in ignored `output/`. The intentionally published README images live in `docs/assets/`; they describe the current product, not a fixed UI specification.

## Documentation · 文档

- Keep `README.md` and `README.zh-CN.md` aligned when changing capabilities, commands, or limitations.
- Update relevant usage and deployment guides alongside behavior changes.
- Use [the screenshot workflow](docs/screenshots.md) to refresh product images from current source and fictional data.
- Keep historical PRDs separate from current implementation claims.

修改功能、启动命令或能力边界时，同时更新中英文 README 和对应操作文档。宣传截图从当前源码生成；历史 PRD 不代表当前功能已实现。

## Pull requests · 提交说明

Describe the problem, changed behavior, affected workspaces, configuration changes, and checks actually run. Include screenshots for UI changes, and call out any checks you could not complete. Link the related issue when available.

Keep commit subjects short and specific, for example `Fix archive preview fallback` or `docs: update deployment instructions`.
