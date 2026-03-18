# KeepPage API MVP

`apps/api` 当前已经跑通 archive-first 核心接口，并支持 `memory` / `postgres` 两种存储驱动；对象存储直传仍是下一步。

## 启动

```bash
npm install
npm run start -w @keeppage/api
```

默认监听 `127.0.0.1:8787`。

## 已实现路由

- `GET /health`
- `POST /captures/init`
- `POST /captures/complete`
- `GET /bookmarks?q=&quality=&domain=&limit=&offset=`

所有核心请求体都通过 `@keeppage/domain` 的 zod schema 进行解析校验：

- `captureInitRequestSchema`
- `captureCompleteRequestSchema`
- `bookmarkSearchResponseSchema`

## 当前存储模型

当前默认 `STORAGE_DRIVER=memory`，适合快速启动与接口联调：

- 文件：`src/repositories/memory-bookmark-repository.ts`
- 能力：去重、版本追加、搜索过滤（关键词/质量/域名）

也可以切到 `STORAGE_DRIVER=postgres` 使用真实 Postgres 仓储：

- 仓储工厂：`src/repositories/index.ts`
- Postgres 实现：`src/repositories/postgres-bookmark-repository.ts`
- 表结构来源：`@keeppage/db`（Drizzle schema + SQL migration）
- 初始化脚本：`src/scripts/init-postgres.ts`

当前 Postgres 实现已经支持：

- `captures/init` 的 pending upload 持久化
- `captures/complete` 的去重、版本写入和质量报告持久化
- `GET /bookmarks` 的标题、URL、域名、标签、文件夹、备注与正文检索

切换方式：

1. 设置 `STORAGE_DRIVER=postgres`
2. 提供 `DATABASE_URL`
3. 初始化表结构：`npm run db:init -w @keeppage/api`
4. 启动 API：`npm run start -w @keeppage/api`

推荐本地示例：

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL='postgresql://cyan:144125236@127.0.0.1:5432/keeppage'
npm run db:init -w @keeppage/api
npm run start -w @keeppage/api
```

## 目前还没接上的部分

- `uploadUrl` 目前仍是占位返回，扩展尚未直传对象存储
- 搜索当前以 API 内过滤 / Postgres 查询为主，后续再接专门搜索索引
- 多端增量同步游标（sync cursor / sync ops）尚未实现
