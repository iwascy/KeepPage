# KeepPage 架构基线

核对日期：2026-09-20。UI 入口与功能回归范围见 [UI 重构功能基线](ui-refactor-baseline.md)。

## 产品与数据边界

- `archive.html` 是归档主档；截图、封面和文本是派生信息。仅保存链接的书签可以没有归档版本。
- 浏览器本地完成归档后异步同步；队列与恢复状态需要持久化。
- 普通内容与私密内容使用独立查询和访问控制；私密模式不承诺端到端加密。
- 共享请求、响应和领域约定由 `packages/domain` 维护。

## 仓库职责

| 目录 | 当前职责 |
| --- | --- |
| `apps/web` | React + Vite 管理端与公开分享页 |
| `apps/extension` | WXT Chrome MV3 扩展；Popup 保存链接，Side Panel 管理归档、队列与私密内容 |
| `apps/api-go` | 生产默认 Go API，chi + pgx，支持 memory / postgres 仓储 |
| `apps/api` | TypeScript/Fastify 回滚实现，不能据此判断生产后端结构 |
| `packages/domain` | 共享领域类型、状态机、质量规则和 API schema |
| `packages/db` | TypeScript/Drizzle schema 与回滚后端的 SQL migrations |
| `docs` | 当前操作文档、功能需求与有日期的迁移背景 |

## Go API

实际分层位于 `apps/api-go/internal/`：

- `httpapi/`：HTTP 路由与请求响应适配。
- `service/`：书签、归档、导入、分享、备份、AI 整理等业务流程。
- `repository/`：memory / postgres 存储实现。
- `domain/`：Go 领域与传输结构。
- `auth/`、`access/`、`middleware/`：鉴权、API Token 权限与请求中间件。
- `storage/`：本地文件和 R2 对象存储。
- `jobs/`：定时备份等后台工作。

启动入口是 `cmd/server`；生产数据库迁移来自 `apps/api-go/migrations/`，由 `cmd/migrate` 执行。不要只修改 `packages/db` 后就认为 Go 生产迁移已经覆盖；跨运行时 schema 变更需要核对两端兼容性。

对象存储通过 `OBJECT_STORAGE_DRIVER` 与相关配置显式选择。本地默认目录为 `./data/object-storage`，旧 TS 运行时目录不是 Go 数据源。具体环境变量见 [部署说明](deployment.md)。

## Web

- `src/App.tsx` 负责会话、路由及多项业务编排，仍需逐步按功能拆分。
- `src/app/` 放应用壳、菜单、全局弹窗与路由辅助代码。
- `src/features/` 放书签、导入、私密、分享、设置等模块。
- `src/data-sources/` 适配 live / demo；`src/features/demo/` 是当前 UI 的演示数据与行为适配，不是旧 UI。
- `src/api/index.ts` 维护 Web API 调用；根 `src/api.ts` 为兼容导出。
- `src/styles.css` 是样式入口，具体样式按区域放在 `src/styles/`。

正式入口与演示入口复用组件。静态导出属于生成产物，不是另一套设计基线。重构可改变视觉与布局，同时应覆盖功能基线中的行为。

## 扩展

- `entrypoints/` 注册 background、content scripts、Popup 与 Side Panel。
- `src/lib/content/` 放内容脚本主体；`src/lib/sites/` 放站点适配。
- `src/lib/extension-db.ts` 与队列模块管理本地持久化；同步和抓取分别沿对应 pipeline/API 模块执行。
- `src/lib/ui-shared/` 放 UI 共用状态展示逻辑。
- SingleFile 使用 MV3 注入模型；修改时需要核对 frame、world、document_start 等注入条件。

名称带 `legacy` 或 `impl` 的模块仍可能处于归档链路中，不能仅凭名称删除。扩展版本以 `package.json` 和 `wxt.config.ts` 为准；改动时同步升版并重新构建。

## 文档与生成产物

[文档导航](README.md) 区分当前操作说明和历史需求。历史方案、旧截图和设计 Skill 不构成新 UI 的默认规范。构建输出保持在被忽略的目录内，通过构建命令生成，不手工修改。
