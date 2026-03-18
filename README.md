# KeepPage

KeepPage 是一个 archive-first 的网页收藏系统。

当前仓库已经具备一条可运行的 archive-first MVP 链路：

- `apps/extension`: Chrome MV3 扩展，已接入 SingleFile MV3 注入模型，支持本地归档、质量评估、IndexedDB 队列、Side Panel 预览与同步
- `apps/api`: Fastify 同步后端，已提供 `captures/init`、`captures/complete`、`bookmarks` 查询，并支持 `memory` / `postgres` 双仓储
- `apps/web`: Web 管理端，已提供归档列表、搜索、质量筛选和统计概览
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

## 当前约束

- `single-file-core` 使用 AGPL-3.0-or-later，产品许可证策略需要在项目早期确定
- 扩展已按 MV3 官方注入模型接入 SingleFile，归档优先走 `singlefile.getPageData()`，失败时回退到 DOM 序列化
- 站点级兼容规则、对象存储直传和版本管理 UI 仍在后续迭代范围
