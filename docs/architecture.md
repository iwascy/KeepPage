# KeepPage 架构基线

## 产品原则

1. `archive.html` 是主档，截图、缩略图、PDF、纯文本都属于派生物。
2. 保存质量是一级产品能力，不是后台日志。
3. 本地先成功，再异步同步上云。

## 代码结构

### `packages/domain`

共享领域契约，包含：

- capture 状态机
- capture profile 定义
- 质量评分与原因结构
- API request/response schema
- Bookmark / BookmarkVersion / Folder / Tag 类型

### `packages/db`

Postgres schema 的唯一来源，当前使用 Drizzle schema + SQL migration 双轨描述：

- 方便本地代码直接引用表结构
- 方便服务端初期快速落表

### `apps/extension`

Chrome MV3 扩展，职责：

- 触发保存
- 本地抓取与质量评估
- IndexedDB 持久化队列
- Side Panel 展示、连接配置与本地预览
- 同步上传调度

### `apps/api`

同步后端，职责：

- capture init / complete
- 书签元数据查询
- 去重与版本判定
- 后续接对象存储、sync cursor，并继续增强搜索能力

### `apps/web`

Web 管理端，职责：

- 收藏列表
- 搜索与筛选
- 质量状态可视化
- 版本与元数据展示

## 当前阶段约定

1. API 可以先跑内存仓储，保证 MVP 能启动；但所有接口都要沿用共享 schema。
2. 扩展必须按 MV3 方式组织，关键状态全部落 IndexedDB，不依赖 service worker 内存。
3. SingleFile 当前已按官方 MV3 注入模型组织：
   - `document_start`
   - `<all_urls>`
   - `all_frames`
   - `match_about_blank`
   - `match_origin_as_fallback`
   - `MAIN` world hook

## 下一阶段优先级

1. 完善 SingleFile 站点兼容性、失败回退和域名级 capture 规则。
2. API 接入对象存储预签名上传与多端 sync cursor。
3. Web 增加归档查看页、版本时间线和更多元数据操作。
