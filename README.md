# KeepPage

KeepPage 是一个 archive-first 的网页收藏系统。

当前仓库已经具备一条可运行的 archive-first MVP 链路：

- `apps/extension`: Chrome MV3 扩展，已接入 SingleFile MV3 注入模型，支持本地归档、质量评估、IndexedDB 队列、Side Panel 预览与同步
- `apps/api`: Fastify 同步后端，已提供 `captures/init`、`captures/complete`、`bookmarks` 列表 / 详情、对象上传与对象读取路由，并支持 `memory` / `postgres` 双仓储
- `apps/web`: Web 管理端，已提供归档列表、搜索、质量筛选、统计概览，以及归档查看页、版本切换、iframe 预览和归档下载
- `packages/domain`: 共享领域模型、状态机、质量评估规则与 API schema
- `packages/db`: Postgres/Drizzle schema 与初始化 migration

## 开发命令

```bash
npm install
npm run dev:api
npm run dev:web
npm run dev:extension
```

如果要用本地 Postgres 跑通完整同步链路：

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL='postgresql://cyan:144125236@127.0.0.1:5432/keeppage'
npm run db:init -w @keeppage/api
npm run start -w @keeppage/api
```

Web 开发态默认通过 Vite 代理把 `/api/*` 转发到 `http://127.0.0.1:8787`；如需改目标，可设置：

```bash
export KEEPPAGE_API_PROXY_TARGET='http://127.0.0.1:8787'
```

## 文档

- 使用文档：`docs/usage.md`
- 部署文档：`docs/deployment.md`
- 架构基线：`docs/architecture.md`
- 架构评审与拆解建议：`docs/architecture-review.md`
- 私密模式 PRD：`docs/private-mode-prd.md`

## 当前约束

- `single-file-core` 使用 AGPL-3.0-or-later，产品许可证策略需要在项目早期确定
- 扩展已按 MV3 官方注入模型接入 SingleFile，归档优先走 `singlefile.getPageData()`，失败时回退到 DOM 序列化
- 当前对象存储仍以开发态本地文件存储为主，S3 / R2 / OSS / MinIO 兼容实现仍在后续迭代范围
- 站点级兼容规则、真实浏览器联调和多端同步仍在后续迭代范围
