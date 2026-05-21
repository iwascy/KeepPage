# KeepPage 架构基线

> 更新日期：2026-05-21

## 产品原则

1. `archive.html` 是主档，截图、缩略图、PDF、纯文本都属于派生物。
2. 保存质量是一级产品能力，不是后台日志。
3. 本地先成功，再异步同步上云。
4. 共享协议优先沉到 `packages/domain`，三端不要各自维护一套平行规则。

## 仓库边界

KeepPage 当前采用 npm workspaces，仓库级结构是合理的，可以继续沿用：

- `apps/api`：Fastify 后端。
- `apps/web`：React + Vite Web 管理端。
- `apps/extension`：WXT Chrome MV3 扩展。
- `packages/domain`：三端共享领域契约。
- `packages/db`：Drizzle schema 与 SQL migrations。
- `docs`：架构、部署、使用、PRD 与 mockup 文档。

当前主要风险不在 monorepo 边界，而在各 app 内部仍存在大文件、大状态机和大实现类。下一阶段应优先做 app 内部模块化，不需要急着拆更多 workspace。

## 代码结构

### `packages/domain`

共享领域契约，包含：

- capture 状态机。
- capture profile 定义。
- 质量评分与原因结构。
- API request/response schema。
- Bookmark / BookmarkVersion / Folder / Tag 类型。
- 私密模式、扩展设备、导入任务、API Token 等跨端类型。

当前状态：

- 作为共享契约层的定位正确。
- `capture.ts` 已退化为外观导出，真实契约已迁入 `capture/contracts.ts`，并新增 `capture/index.ts` 保持内部边界。
- `capture/contracts.ts` 仍约 600 行，后续应继续按 auth/bookmark/capture/quality/folder/tag/import 等业务边界细拆。
- 对外仍通过 `src/index.ts` 提供稳定公共出口，不急着拆 package。

### `packages/db`

Postgres schema 的唯一来源，当前使用 Drizzle schema + SQL migration 双轨描述：

- 方便本地代码直接引用表结构。
- 方便服务端初期快速落表。

约定：

- 表结构变更必须同步 schema 与 migration。
- 三端业务类型不要绕过 `packages/domain` 直接复制数据库结构。

### `apps/api`

同步后端，职责：

- 用户、API Token、扩展设备鉴权。
- capture init / complete。
- 私密模式 capture / bookmark。
- 书签元数据查询与更新。
- 文件夹、标签、导入任务。
- 对象读写、上传、分片上传。
- 图标刷新与对象存储适配。

当前状态：

- `routes/*`、`services/*`、`repositories/*`、`storage/*` 的分层已经形成。
- 仓储接口已经切成多个窄接口，但 `BookmarkRepository` 仍作为交叉类型兼容现有装配。
- postgres / memory 已补齐 extension-devices、private-mode、private-captures、private-bookmarks 等 capability 文件，外层 repository 不再散落直连 `this.core.*`。
- `postgres/core.ts` 和 `memory/core.ts` 仍是最大实现单体，后续要把真实实现继续下沉到各能力文件。

API 边界规则：

- `routes/*` 只做 HTTP 协议适配、鉴权上下文提取、schema 校验和响应格式化。
- `services/*` 负责用例编排，不暴露 HTTP 细节。
- `repositories/*` 只负责持久化和查询，不承担跨能力状态机决策。
- `lib/*` 只放通用工具，不再吸纳事实 service。

### `apps/web`

Web 管理端，职责：

- 登录注册与 session restore。
- 收藏列表、搜索、筛选。
- 书签详情与 reader/original 预览。
- 文件夹、标签、批量管理。
- 导入新建、历史、详情。
- API Token、扩展设备、私密模式设置。
- Live / Demo 数据源适配。

当前状态：

- 已有 `features/bookmarks/list`、`features/bookmarks/detail`、`features/imports`、`features/private`、`features/api-tokens` 等 feature 目录。
- `use-app-data-source.ts` 已把 live/demo 两种模式收口成统一接口。
- `App.tsx` 已将 route、session token/error、预览选择、剪贴板与用户展示格式迁入 `src/app/**`，但仍超过 3600 行，继续承担全局 dialog、context menu、私密模式、批量操作等大量编排。
- `styles.css` 已完成第一阶段拆分，原文件只保留 `@import`，实际样式按区域迁入 `src/styles/**`。
- imports 实现已迁入 `features/imports/index.tsx`，demo workspace/mock 数据已迁入 `features/demo/**`；根目录兼容文件只保留 re-export。

Web 边界规则：

- app 层只保留路由、session、全局 feedback/dialog 挂载。
- 页面状态归 feature。
- demo/live 差异归 `data-sources` 和 `features/demo`。
- 大块 JSX、表单、弹窗、列表状态不要继续回流到 `App.tsx`。

### `apps/extension`

Chrome MV3 扩展，职责：

- 触发保存。
- 本地抓取与质量评估。
- IndexedDB 持久化队列。
- Content script 页面信号采集、选区捕获、SingleFile 适配。
- Popup / Side Panel 展示、连接配置与本地预览。
- 同步上传调度。

当前状态：

- 运行时入口边界清楚：`background`、`content`、`popup`、`sidepanel`。
- 站点适配已经部分拆到 `src/lib/sites/**`。
- `content.content.ts` 已迁出共享类型与常量到 `src/lib/content/types.ts`，但 bridge、signals、selection、toast、capture 方法体仍在入口内。
- `legacy-reader.ts`、`sync-api.ts`、`capture-pipeline.ts`、popup/sidepanel `App.tsx` 仍偏大。
- 扩展当前版本为 `0.1.40`，本轮结构调整后已执行 extension build。

扩展边界规则：

- `entrypoints/*` 只保留入口注册和消息分发。
- 站点适配放到 `src/lib/sites/<site>/`。
- content 侧 bridge / signals / selection / toast / capture 分模块维护。
- popup 与 sidepanel 共享的 task 状态、preview、auth view-model 不要重复实现。

## 当前阶段约定

1. API 可以同时保留 memory 与 postgres 两套存储实现，但对外必须走共享 repository 接口。
2. 扩展必须按 MV3 方式组织，关键状态全部落 IndexedDB，不依赖 service worker 内存。
3. SingleFile 当前按官方 MV3 注入模型组织：
   - `document_start`
   - `<all_urls>`
   - `all_frames`
   - `match_about_blank`
   - `match_origin_as_fallback`
   - `MAIN` world hook
4. 修改 `apps/extension` 时，必须同步 bump `apps/extension/package.json` 和 `apps/extension/wxt.config.ts`，并执行 `npm run build -w @keeppage/extension`。
5. 非生成源码超过 1000 行视为主动拆解信号；UI 入口超过 400 行、业务编排文件超过 600 行时，评审中需要说明保留原因。

## 下一阶段优先级

1. Web：继续拆 `App.tsx`，优先把 manager dialog、context menu、batch selection、private/local archive 壳层迁入 feature 或 shared UI；样式拆分进入维护阶段。
2. API：继续拆 `postgres/core.ts` / `memory/core.ts`，让各能力文件真正持有实现，而不是只做 thin wrapper。
3. Extension：拆 `content.content.ts`，再拆 popup/sidepanel 共享 view-model、`sync-api.ts` 和 `capture-pipeline.ts`。
4. Domain：继续细化 `packages/domain/src/capture/contracts.ts`，按 auth/bookmark/capture/quality/folder/tag/import 等边界拆文件。
5. Docs：维护 `docs/architecture-review.md` 作为活的架构看板，记录已完成、剩余工作和验证范围。
