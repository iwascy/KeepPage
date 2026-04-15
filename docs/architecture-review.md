# KeepPage 架构评审与拆解建议

> 评审时间：2026-04-15
> 评审目标：判断当前目录架构是否合理，并识别后续单体迭代开发的膨胀风险，给出可执行的拆解顺序。
>
> 2026-04-15 补充：对照真实代码完成二次核对，所有行数替换为实测值，并补入首轮遗漏的热点文件、API lib 层的子服务膨胀、Extension 的跨文件重复实现、以及 `apps/web-demo` 空壳目录等问题。

## 一、结论摘要

当前仓库在 **仓库级别** 的结构是合理的：

- `apps/api`、`apps/web`、`apps/extension` 作为三个运行时边界是清晰的
- `packages/domain`、`packages/db` 作为共享契约和数据库 schema 也有明确职责
- `package.json` 已通过 npm workspaces 管理 `apps/*` 和 `packages/*`

但在 **各个 app 内部**，已经出现明显的“伪模块化”趋势：

- 仓库看起来已经拆层
- 但 Web、API、Extension 内部都在向“大文件 + 大接口 + 大状态机”增长
- 如果继续按当前方式直接迭代功能，后续最容易膨胀成难拆的大单体

一句话判断：

> KeepPage 现在不是“仓库结构不合理”，而是“仓库骨架是对的，但各 app 内部正在重新长回单体”。

## 二、当前仓库主骨架

### 1. 顶层结构

- `apps/api`：Fastify 后端
- `apps/web`：React + Vite Web 管理端
- `apps/extension`：WXT Chrome MV3 扩展
- `packages/domain`：共享领域模型、类型、schema、状态约束
- `packages/db`：Drizzle schema 与 migrations
- `docs`：架构、部署、使用和 PRD 文档

### 2. 当前骨架的优点

- 运行时边界基本明确，没有把 Web、API、插件代码混写在一个应用里
- 共享契约集中在 `packages/domain`，避免三端各自定义同一套协议
- 数据库 schema 集中在 `packages/db`，避免 SQL 分散在业务代码里
- API 启动入口和路由注册相对清晰，扩展与 Web 也有独立入口

### 3. 当前骨架的局限

仓库层面虽然已经拆成多个 workspace，但每个 workspace 内部的功能边界还不够稳定。

也就是说：

- 现在的风险不在“有没有 monorepo”
- 而在“每个 app 内部是不是继续按能力拆分”

## 三、评审判断

### 3.1 仓库级：总体合理

这一层判断为：**合理，可以继续沿用**

主要依据：

- `apps/* + packages/*` 的 workspace 组织方式简洁直接
- API、Web、Extension 各自是独立运行单元
- `packages/domain` 与 `packages/db` 的存在，让共享契约和底层存储有机会被稳定收口

这意味着：

- 当前不需要急着把仓库再拆成更多 package
- 更优先的工作，是先把各个 app 内部整理成“功能模块”

### 3.2 Web：已经是单文件应用

这一层判断为：**风险最高，优先拆**

当前 `apps/web/src` 文件数很少，但主应用状态和交互几乎都集中在一个文件里：

- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/imports.tsx`
- `apps/web/src/demoData.ts`

其中：

- `apps/web/src/App.tsx` **实测 6122 行**
- 同时承担了路由、鉴权、列表页、详情页、批量选择、上下文菜单、文件夹/标签管理、导入流程、API Token、云端归档、本地插件桥接、mock/demo 逻辑

除了 `App.tsx`，同目录下还有两个被低估的热点文件：

- `apps/web/src/demoData.ts` **1886 行** —— 研发期 demo/mock 数据，体量已达到独立模块级别，同时被 `App.tsx` 主流程直接引用，正好印证后文 4.3 节 "Mock / Demo / Live 逻辑混在同一主流程" 的担心
- `apps/web/src/imports.tsx` **782 行** —— 已经是一个独立的导入向导子应用，但仍放在 `src/` 根下和 `App.tsx` 平级，没有收敛到 `features/imports`

换句话说：`apps/web/src` 虽然只有 9 个文件，但其中 3 个文件（`App.tsx` + `demoData.ts` + `imports.tsx`）合计已接近 **8790 行**，占 web 端代码 90% 以上。

这类结构短期开发很快，但会带来几个问题：

- 新功能几乎一定继续加进 `App.tsx`
- 改一个模块时很容易牵动其他页面状态
- 代码评审和回归测试范围越来越大
- 后面即使想引入更清晰的状态管理，也会因为现有耦合过重而很难落地

判断：

> `apps/web` 现在更像是“目录上是前端工程，代码上是单文件应用”。

### 3.3 API：仓储层已经变成超级接口

这一层判断为：**高风险，第二优先级拆**

当前 API 的大方向没有问题：

- `server.ts` 负责启动与基础装配
- `routes/*` 负责路由注册
- `repositories/*` 负责存储实现
- `lib/*` 放业务辅助能力

问题在于仓储接口过大。

`apps/api/src/repositories/bookmark-repository.ts` 当前一个接口同时覆盖：

- 用户
- API Token
- capture 初始化 / 完成
- ingest
- 书签查询 / 详情 / 删除 / 元数据更新
- 文件夹 / 标签
- 导入预览相关匹配
- 导入任务
- 对象读写权限

对应实现也非常大：

- `apps/api/src/repositories/postgres-bookmark-repository.ts` **实测 2397 行**
- `apps/api/src/repositories/memory-bookmark-repository.ts` **实测 1384 行**
- 对应的接口定义 `apps/api/src/repositories/bookmark-repository.ts` **只有 155 行，但声明了 29 个方法**，横跨 9 个业务域（用户、API Token、capture、ingest、书签、文件夹、标签、导入、对象权限）

这会导致：

- 每增加一个领域能力，都要继续扩充同一个 Repository 接口
- `memory` / `postgres` 双实现会被迫同步膨胀
- 仓储层既写 SQL，又做聚合映射，又混入部分业务判断

判断：

> API 还没有变成单体服务，但 Repository 已经开始变成“单体数据入口”。

### 3.3b API lib：正在悄悄长出一个“没有名字的 service 层”

补充风险：**高，和 Repository 膨胀同级**

除了 Repository，`apps/api/src/lib/` 也出现了明显的膨胀：

- `apps/api/src/lib/cloud-archive-worker.ts` **937 行**
- `apps/api/src/lib/imports.ts` **504 行**
- `apps/api/src/lib/auth-service.ts` 216 行
- `apps/api/src/lib/api-token-service.ts` 172 行
- `apps/api/src/lib/cloud-archive-manager.ts` 134 行

其中 `cloud-archive-worker.ts` 已经是 API 侧最大的非仓储文件，定位远远不只是 "工具函数"：

- `processCloudArchive` —— 云端归档主流程
- `fetchPageWithPuppeteer` —— 在 API 进程里驱动 Puppeteer 拉页面
- `installCloudArchiveExtensionRuntime` —— **在服务器端就地安装一份扩展运行时**，再通过 `sendContentScriptMessage` / `proxySingleFileFetch` 反向调用
- `buildFallbackArchiveHtml` / `buildArchiveSignals` —— HTML 兜底与信号聚合

这说明 `lib/` 实际上已经承担了本该由 service 层做的事：领域编排、外部依赖封装、跨运行时的反向桥接。

问题在于：

- 既没有被叫做 `services/`，也没有被叫做 `workers/`
- 因此没有稳定的职责边界，后续新增的 "不知道该放哪儿" 的逻辑都会继续落到 `lib/`
- 和 `routes/imports.ts` 里 `lib/imports.ts` 的职责切分也不清晰（路由做了一部分归一化，lib 做了另一部分解析）

判断：

> `lib/` 不是问题，"没被承认是 service 层的 service 层" 才是问题。要么把它正式升格为 `services/`，要么在拆 Repository 的同时把它的职责一起收口，否则第二阶段拆完 Repository 后，业务逻辑会继续沿着 `lib/` 这条阻力最小的路径重新长回来。

### 3.4 API Route：开始承担用例编排

这一层判断为：**中高风险，需要尽早止损**

一些 route 文件已经不只是协议适配，而是在做业务编排。

从行数上看，各 route 的分布本身就是一个信号（实测）：

| Route 文件 | 行数 | 是否仅做协议适配 |
|---|---|---|
| `routes/uploads.ts` | **361** | 否，含对象读/写/分片上传/对象权限判断 |
| `routes/imports.ts` | **253** | 否，大量归一化 + 编排 |
| `routes/bookmarks.ts` | 128 | 部分越界 |
| `routes/captures.ts` | 101 | 基本合理 |
| `routes/folders.ts` / `tags.ts` | 60 | 合理 |
| `routes/cloud-archive.ts` | 44 | 合理 |
| `routes/api-tokens.ts` / `auth.ts` / `ingest.ts` | ≤44 | 合理 |

典型的越界案例：

- `apps/api/src/routes/uploads.ts`（**route 层最大的文件**）
  - 对象 GET（含 key 解码、权限校验、content-type 映射）
  - PUT 单次上传 + 校验对象写权限
  - 分片上传（multipart init / chunk / complete）
  - gzip 解包、hash 校验
  - 这些本质上都是 "对象存储 use-case"，不该散在 route 里
- `apps/api/src/routes/imports.ts`
  - 请求体归一化（`normalizeImportRequestBody` / `normalizeSourceType` / `normalizeMode` 等 10+ 个辅助函数）
  - 导入内容解析
  - 去重匹配
  - 预览构建
  - 任务创建
  - 根据模式触发云归档
- `apps/api/src/routes/bookmarks.ts`
  - 查询详情
  - 补充对象存储可用性
  - 删除对象文件

如果继续这样增长，会出现：

- 一部分业务逻辑在 route
- 一部分业务逻辑在 repository
- 一部分业务逻辑在 `lib/*`

最后很难回答一个问题：

> “某个业务规则的唯一归属层到底在哪？”

### 3.5 Extension：内部开始重新长成一个小单体

这一层判断为：**中高风险，需上调优先级**

> 原判断是 "中风险，第三优先级拆"。但二次核对后发现扩展侧的热点文件总规模已接近 Web 的两倍，且出现了跨文件函数重复实现，因此**第三优先级是对的，但必须列入本轮拆解范围，不能再拖**。

扩展本身按运行时入口拆得不差：

- `entrypoints/background.ts`
- `entrypoints/content.content.ts`
- `entrypoints/popup/*`
- `entrypoints/sidepanel/*`

但内部的膨胀点比首轮评审列举的更多、更严重。先看规模：

| 文件 | 行数 | 定位 |
|---|---|---|
| `src/lib/site-archive.ts` | **2218** | 多站点归档聚合 |
| `entrypoints/content.content.ts` | **1786** | content 侧总调度器 |
| `entrypoints/sidepanel/App.tsx` | **1308** | 侧边栏单文件应用 |
| `entrypoints/popup/App.tsx` | **864** | popup 单文件应用 |
| `src/lib/sync-api.ts` | **864** | 扩展侧 API 客户端 |
| `src/lib/capture-pipeline.ts` | **768** | 抓取流水线 |
| `src/lib/domain-runtime.ts` | **681** | 本地运行时约束 |
| `src/lib/private-vault.ts` | 467 | 私有金库 |
| `src/lib/auth-flow.ts` | 359 | 鉴权跳转流程 |
| `src/lib/singlefile-fetch.ts` | 317 | SingleFile 适配 |
| `src/lib/local-archive-queue.ts` | 258 | 本地归档队列 |

仅前 7 个文件合计就达 **8489 行**，已超过 Web `App.tsx` 的 1.3 倍。

#### 1. 站点适配聚合过重

`apps/extension/src/lib/site-archive.ts`（**2218 行**）同时包含：

- 通用 reader 提取
- X 站点适配
- 小红书适配
- 少数派适配
- HTML 拼装与样式模板

这意味着后面每新增一个站点兼容，都还会继续堆在这个文件里。

#### 2. Content script 承担职责过多

`apps/extension/entrypoints/content.content.ts`（**1786 行**）当前同时处理：

- runtime message
- DOM 信号采集
- 选区模式交互
- 页面归档抓取
- 页面内 toast
- Web 与 extension 的桥接消息（`installKeepPageWebBridge` / `parseKeepPageBridgeRequest` 等）
- 小红书 state 解析（`parseXiaohongshuInitialState` / `readXiaohongshuStateImageUrls` / `collectXiaohongshuDownloadableMedia` / `readXiaohongshuVideoPosterUrl` ...）

这已经不是单一 "content script 入口"，而是 "content 侧总调度器"。

#### 3. 跨文件重复实现（首轮评审遗漏）

这是一条此前没有点出、但已经实锤的问题：

- `parseXiaohongshuInitialState` —— **同时定义在** `content.content.ts:629` 与 `site-archive.ts:1588`
- `extractAssignedJsonText` —— **同时定义在** `content.content.ts:646` 与 `site-archive.ts:1605`

两份实现几乎完全相同，只是一个跑在 content script 的实时 DOM 环境，一个跑在归档 builder 里。这意味着：

- 小红书初始 state 的解析规则已经有两套平行来源
- 任何一方更新、另一方忘了跟进，就会出现 "实时识别到了、但归档里丢了" 或反之的 bug
- 这已经不是 "可能漂移"，而是 "正在漂移"

正确做法是抽出 `src/lib/sites/xiaohongshu/state.ts`（或类似）作为唯一来源，content script 与 site-archive 都只 import 它。

#### 4. sidepanel / popup：两个并行的单文件应用

`sidepanel/App.tsx`（**1308 行**）和 `popup/App.tsx`（**864 行**）本质上是两个并行的单文件应用：

- 各自维护一套 auth 读写
- 各自维护一套状态 label 映射
- 各自维护一套 task/preview 展示逻辑
- 部分预览、格式化、error 提示代码在两侧都有近似实现

如果把它们看作扩展侧的 "App.tsx"，那么问题和 Web 是同构的：**所有新功能都会默认加到这两个文件里**。

#### 5. sync-api / capture-pipeline / private-vault：被忽视的大组件

- `src/lib/sync-api.ts` **864 行** —— 扩展与 API 之间的同步客户端，既做 HTTP，又做任务状态机映射，还做本地 db 读写协调
- `src/lib/capture-pipeline.ts` **768 行** —— 端到端抓取流水线，串起内容脚本、site-archive、上传、对象存储签名等所有环节
- `src/lib/private-vault.ts` 467 行 —— 私有模式数据落地与同步策略

这三个文件每一个都已经达到 "需要独立模块" 的体量，但在首轮评审里完全没被点名。

#### 6. 领域运行时逻辑有重复实现迹象

`apps/extension/src/lib/domain-runtime.ts`（**681 行**）内有不少与 `packages/domain` 接近的运行时约束与解析逻辑。

问题不在于扩展不该有 runtime guard，而在于：

- 哪些规则是共享领域规则
- 哪些规则是扩展本地运行时规则

这条边界还不够清晰，未来存在漂移风险。

### 3.6 packages/domain：方向正确，但文件粒度偏粗

这一层判断为：**方向正确，建议细化**

`packages/domain` 的定位是对的，应该继续保留。

但当前文件组织有继续变大的趋势，尤其 `capture.ts` 已混入：

- capture
- quality
- auth
- folder
- tag
- bookmark
- API request/response

从仓库层面看它是“共享域模型”，从文件层面看它更像“共享大杂烩”。

建议是：

- 暂时不需要继续拆包
- 先把单个文件拆细
- 把“契约分组”做出来

### 3.7 其他目录：不算错误，但需要收口

仓库根目录目前还存在一些非核心运行时目录：

- `apps/web-demo` —— **实测是一个空壳**：只有 `apps/web-demo/src/` 这个空目录，没有 `package.json`、没有源码、也没有原评审提到的 `dist`。它甚至不是一个真正的 workspace，但仍和 `apps/api` / `apps/web` / `apps/extension` 并列放在 `apps/` 下
- `expert-ui`
- `stitch-keeppage-ui`
- `deploy`
- `ops`

`apps/web-demo` 是比其他几个更糟的情况：它占着 `apps/` 的命名空间，却没有任何实际内容。**建议直接删除或者明确地迁出到 `experiments/`**，否则它会被未来某个人顺手重新填充成另一个演示工程，进一步稀释 `apps/` 的含义。

这些目录本身不构成严重架构问题，但会带来两个副作用：

- 新人不容易一眼区分“正式系统目录”和“实验/产物/运维目录”
- 后续容易把一次性资产、导出结果、演示页面继续堆到根目录

建议后面逐步把这类内容收敛到更明确的位置：

- `docs/mockups`
- `experiments`
- `ops`
- `deploy`

核心原则是：**不要让主产品目录继续吸纳临时资产。**

## 四、当前最主要的单体膨胀风险

按优先级排序，当前最需要警惕的是以下几类问题。

### 1. 大文件成为事实上的“默认扩展点”

一旦某个文件变成团队默认添加功能的位置，后续就很难再收回来。

当前最明显的几个文件（全部为实测行数，按所在 workspace 归类）：

**Web**
- `apps/web/src/App.tsx` —— **6122**
- `apps/web/src/demoData.ts` —— **1886**（首轮遗漏）
- `apps/web/src/imports.tsx` —— **782**（首轮遗漏）

**API**
- `apps/api/src/repositories/postgres-bookmark-repository.ts` —— **2397**
- `apps/api/src/repositories/memory-bookmark-repository.ts` —— **1384**
- `apps/api/src/lib/cloud-archive-worker.ts` —— **937**（首轮遗漏，实际是 "没被承认的 service 层"）
- `apps/api/src/lib/imports.ts` —— **504**（首轮遗漏）
- `apps/api/src/routes/uploads.ts` —— **361**（首轮遗漏，route 层最大的文件）

**Extension**
- `apps/extension/src/lib/site-archive.ts` —— **2218**
- `apps/extension/entrypoints/content.content.ts` —— **1786**
- `apps/extension/entrypoints/sidepanel/App.tsx` —— **1308**
- `apps/extension/entrypoints/popup/App.tsx` —— **864**（首轮遗漏）
- `apps/extension/src/lib/sync-api.ts` —— **864**（首轮遗漏）
- `apps/extension/src/lib/capture-pipeline.ts` —— **768**（首轮遗漏）
- `apps/extension/src/lib/domain-runtime.ts` —— **681**
- `apps/extension/src/lib/private-vault.ts` —— **467**（首轮遗漏）

**Domain**
- `packages/domain/src/capture.ts` —— **523**，82 个 export，混合 capture / auth / folder / tag / bookmark / 请求响应

### 2. 大接口导致所有功能耦合增长

当前 API 的 `BookmarkRepository` 就有这个问题。

当一个接口承载所有领域能力时，后果通常是：

- 单个实现体积持续增长
- 单元测试越来越难写
- 重构时不得不同时改很多调用方
- 很难按能力拆出独立 service / module

### 3. Mock / Demo / Live 逻辑混在同一主流程

Web 里这点尤其明显。

如果 mock / demo 是长期存在的产品能力，那么应该有明确边界；
如果它只是研发期辅助能力，就不该继续深度侵入主应用状态流。

### 4. 协议层、业务层、存储层边界模糊

API 目前已经有一些这种迹象：

- route 不只做 HTTP（`uploads.ts` / `imports.ts` 是典型）
- repository 不只做存储
- lib 有时是工具函数，有时又是业务编排（`cloud-archive-worker.ts` 就是一个 900+ 行的事实 service）

这类问题前期不会立刻爆炸，但会在需求开始并行迭代时明显拖慢开发。

### 5. 跨文件重复实现（首轮评审遗漏的独立风险）

这一类风险不是 "文件太大"，而是 "同一规则被 copy 到多处"：

- `parseXiaohongshuInitialState` / `extractAssignedJsonText` —— 同时存在于 `apps/extension/entrypoints/content.content.ts` 和 `apps/extension/src/lib/site-archive.ts`
- 扩展端 `domain-runtime.ts` 与 `packages/domain` 之间的约束重叠
- `sidepanel/App.tsx` 与 `popup/App.tsx` 之间的状态映射、preview、auth 读写重叠

重复实现比大文件更难发现，也更容易在回归测试中出现 "一边修了一边没修" 的问题。拆解时应该把这类已经实锤的重复列为 **必须顺手解决** 的项，而不是等到所谓 "有空再统一" 的阶段。

## 五、建议的拆解策略

这里不建议“一次性大重构”，而是建议按风险顺序，拆最值回票价的部分。

### 5.1 第一阶段：先拆 Web

目标：

- 把 `apps/web/src/App.tsx` 从超大总控组件，降到 app shell + 路由 + session 容器

建议拆法：

- `apps/web/src/features/auth`
- `apps/web/src/features/bookmarks`
- `apps/web/src/features/bookmark-detail`
- `apps/web/src/features/imports`
- `apps/web/src/features/settings`
- `apps/web/src/features/archive`
- `apps/web/src/shared`

建议优先抽离的内容：

1. 列表页与详情页
2. 文件夹 / 标签 / 批量管理相关交互
3. API Token 设置页
4. 云端归档和本地插件桥接
5. mock/demo 适配层

拆分原则：

- 先按功能边界拆组件、hook、view-model
- 不要先按“components/hooks/utils”这种技术目录拆
- 每个功能模块要能独立理解和维护

### 5.2 第二阶段：拆 API 的仓储与用例层

目标：

- 让 route 只负责协议适配
- 让 service / use-case 负责业务编排
- 让 repository 只负责持久化
- **同时把 `apps/api/src/lib/` 正式升格或收口**，避免它继续作为 "没有名字的 service 层" 吸纳业务逻辑

建议分组：

- `auth`
- `api-tokens`
- `bookmarks`
- `captures`
- `folders-tags` 或 `taxonomy`
- `imports`
- `uploads`（对应当前 `routes/uploads.ts` 的 361 行逻辑）
- `cloud-archive`（对应 `lib/cloud-archive-worker.ts` 的 937 行逻辑，建议直接变成 `services/cloud-archive/`）

一个更理想的结构示意：

```text
apps/api/src/
  routes/
  services/
    auth/
    bookmarks/
    captures/
    imports/
  repositories/
    auth/
    bookmarks/
    imports/
  lib/
  storage/
```

需要特别避免的事：

- 不要把当前 `BookmarkRepository` 再继续做大
- 不要把新的业务编排继续塞进 route
- 不要让 SQL 查询和业务规则继续糅在同一个长文件里

### 5.3 第三阶段：拆 Extension 的站点适配和 UI 入口

目标：

- 让 extension 保持“按运行时入口分层，按站点适配拆模块”

建议拆法：

#### 站点适配拆成 registry

例如：

```text
apps/extension/src/lib/site-adapters/
  index.ts
  generic-reader.ts
  x.ts
  xiaohongshu.ts
  sspai.ts
```

由统一分发器判断：

- 是否命中特定站点
- 走专用适配还是通用 reader

#### 内容脚本拆成多个职责模块

例如：

- `content-bridge.ts`
- `content-selection.ts`
- `content-toast.ts`
- `content-capture.ts`
- `content-signals.ts`

#### popup / sidepanel 共享状态逻辑

把重复的：

- 状态 label
- auth 读写
- task 映射
- preview 逻辑

抽到共享 hook 或 shared view-model 中，避免两个入口分别长出一套半重复逻辑。

应有的目标结构示意：

```text
apps/extension/src/
  entrypoints/
    popup/App.tsx        # 只保留 popup 专有 UI
    sidepanel/App.tsx    # 只保留 sidepanel 专有 UI
    content.content.ts   # 只保留入口注册和消息分发
  lib/
    ui-shared/           # 两个入口共享的 hook、label 映射、preview
    sites/
      index.ts
      xiaohongshu/
        state.ts         # parseXiaohongshuInitialState 的唯一来源
        content.ts       # DOM 采集
        archive.ts       # builder
      x/
      sspai/
      generic-reader.ts
    content/
      bridge.ts
      selection.ts
      signals.ts
      toast.ts
      capture.ts
    sync/
      sync-api.ts        # 拆到 <400 行
    pipeline/
      capture-pipeline.ts # 拆成 stages
```

#### sync-api / capture-pipeline 需要拆 stage

- `sync-api.ts` 当前 864 行，应该按 "HTTP 客户端 / 任务状态映射 / 本地 db 协调" 三部分拆开
- `capture-pipeline.ts` 当前 768 行，应该按 "采集 → 归档构建 → 上传 → 登记" 的 pipeline stage 拆

### 5.4 第四阶段：细化 packages/domain

目标：

- 让共享契约稳定下来，但不过度包化

建议先拆文件，不急着拆 package：

```text
packages/domain/src/
  auth.ts
  bookmark.ts
  capture.ts
  quality.ts
  folder.ts
  tag.ts
  imports.ts
  api-access.ts
```

判断标准：

- 哪怕还在同一个 package 中，也应该让文件边界对应业务边界
- 共享契约要避免重新回到“一个大文件导出所有东西”

## 六、建议的实施顺序

建议按下面顺序推进，而不是同时大拆：

1. **Web**：拆 `App.tsx`，顺手把 `demoData.ts` 抽成 `features/_demo/` 并与主流程解耦，`imports.tsx` 收敛到 `features/imports/`
2. **API**：拆 `BookmarkRepository`
3. **API**：补 `service/use-case` 层，同时把 `lib/cloud-archive-worker.ts` 升格为 `services/cloud-archive/`，把 `routes/uploads.ts` 里的业务逻辑抽到 `services/uploads/`
4. **Extension 先手**：消灭 `parseXiaohongshuInitialState` / `extractAssignedJsonText` 的双定义，抽出 `lib/sites/xiaohongshu/state.ts` 作为唯一来源（这一步成本极低，但能阻止漂移继续扩大，应该比 5/6 更早做）
5. **Extension**：拆 `site-archive.ts` → `lib/sites/<site>/`
6. **Extension**：拆 `content.content.ts` → `lib/content/*`
7. **Extension**：拆 `sidepanel/App.tsx` + `popup/App.tsx`，抽出 `lib/ui-shared/`
8. **Extension**：拆 `sync-api.ts` 与 `capture-pipeline.ts`
9. **Domain**：细化共享契约文件
10. **根目录**：删除或迁出 `apps/web-demo`（空壳），整理 `expert-ui` / `stitch-keeppage-ui` / `deploy` / `ops`

原因：

- Web 当前最容易继续膨胀，而且回报最快
- API Repository 是后端长期演进的主要阻塞点
- Extension 的总复杂度其实已经超过 Web，但单点拆解收益相对分散，因此仍然排在 Web / API 之后；**唯一的例外**是第 4 步的跨文件重复消除，成本远低于回报，应该穿插在前面几步之间尽快完成

## 七、后续拆解时的判断标准

后面做拆解时，可以用这几条作为验收标准。

### 1. 新功能不应该默认只改一个超级文件

如果新需求一来，团队第一反应仍然是：

- 去改 `App.tsx`
- 去改 `BookmarkRepository`
- 去改 `site-archive.ts`

说明拆解还没有真正成功。

### 2. 每个模块都要有稳定的“唯一归属”

比如：

- 导入预览逻辑归 `imports`
- 收藏夹与标签归 `taxonomy`
- 捕获流程归 `captures`

而不是在 route、repository、UI 页面里各写一半。

### 3. Mock / Demo / Live 边界要明确

如果 demo 能力保留，就应该有清晰适配层；
如果只是研发期辅助能力，就不要再继续侵入主业务流程。

### 4. 共享领域规则只能有一个主来源

`packages/domain` 应该是协议和共享规则的主要来源。

运行时允许有 adapter 或 guard，但不能长期形成两套平行定义。

## 八、最终建议

KeepPage 现在最应该做的，不是继续增加新的 workspace，也不是立即追求更复杂的“微服务 / 微前端”。

更现实、更有效的路径是：

1. 保留当前 monorepo 主骨架
2. 把每个 app 内部先整理成真正的功能模块
3. 控制超级文件、超级接口和超级状态机继续扩张

如果这个阶段处理得好，后续新增能力时：

- 只需要在现有能力边界内扩展
- 而不是每次都去改主入口和大仓储

这也是避免“单体迭代开发无限膨胀庞大”的关键。

## 九、截至 2026-04-15 的首轮落地进展

下面这部分不是评审建议，而是已经完成并在代码中落地的事项，用来标记“哪些已经做完，哪些还停留在建议阶段”。

### 9.1 已完成

#### 1. API：`Repository` 切窄 + `services/` 落地

已完成以下重构：

- `apps/api/src/repositories/bookmark-repository.ts` 已从“大一统仓储”切成一组窄接口：
  - `RepositoryInfo`
  - `AuthRepository`
  - `ApiTokenRepository`
  - `CaptureRepository`
  - `IngestRepository`
  - `BookmarkReadRepository`
  - `BookmarkWriteRepository`
  - `TaxonomyRepository`
  - `ImportRepository`
  - `ObjectAccessRepository`
- 仍保留 `BookmarkRepository` 作为交叉类型，兼容现有 `memory` / `postgres` 聚合实现，避免首轮重构就同时打散两套后端实现
- `apps/api/src/repositories/index.ts` 已同步导出这些新接口类型

同时，原本藏在 `lib/` 中的“事实 service 层”已经正式落到 `services/`：

- `apps/api/src/services/auth/auth-service.ts`
- `apps/api/src/services/api-tokens/api-token-service.ts`
- `apps/api/src/services/bookmarks/bookmark-service.ts`
- `apps/api/src/services/imports/import-service.ts`
- `apps/api/src/services/uploads/upload-service.ts`
- `apps/api/src/services/cloud-archive/cloud-archive-manager.ts`
- `apps/api/src/services/cloud-archive/cloud-archive-worker.ts`

这意味着前文 3.3b 节里提到的“`lib/` 正在长成没有名字的 service 层”问题，在首轮已经完成第一步纠偏。

#### 2. API：Route 去编排化已经完成第一拍

以下 route 已经从“自己做业务编排”改为“协议适配 -> 调 service -> 返回响应”：

- `apps/api/src/routes/bookmarks.ts`
- `apps/api/src/routes/imports.ts`
- `apps/api/src/routes/uploads.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/api-tokens.ts`
- `apps/api/src/routes/cloud-archive.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/server.ts` 也已改为在启动时装配 service，再传入 route 注册器

已下沉的重点业务包括：

- 书签详情的 archive/object 可用性补充
- 删除书签时的对象清理
- 导入 body normalize / sourceType 与 mode 映射 / preview 构建 / 任务创建
- 上传对象的 key 解码、权限校验、gzip 解包、分片拼装、offset 校验、对象写入

#### 3. Web：已经建立 app 级数据源适配层

已新增：

- `apps/web/src/data-sources/use-app-data-source.ts`
- `apps/web/src/features/imports/index.tsx`
- `apps/web/src/features/demo/index.ts`

其中 `use-app-data-source.ts` 已经把 live/demo 两种模式收口为统一接口，当前已覆盖：

- session restore / reset
- login / register
- folders / tags
- bookmarks list / detail / metadata update / delete
- import adapter
- API token list / create / revoke
- cloud archive submit / polling
- 本地 extension bridge 入队
- archive preview URL 创建

同时：

- `apps/web/src/main.tsx`
- `apps/web/src/demo-main.tsx`

已经只负责选择 `dataSourceKind`，不再在入口里直接拼业务逻辑。

#### 4. Web：`App.tsx` 已完成第一轮“去 demo 侵入”

前文评审时 `apps/web/src/App.tsx` 实测为 **6122 行**。截至本次落地后，它已下降到 **5658 行**，虽然仍然偏大，但已经完成第一轮关键止血：

- `App.tsx` 不再直接引用 `demoData.ts` 的 workspace 读写细节
- `App.tsx` 不再直接操作 demo workspace
- `App.tsx` 的 API Token 面板也已切到 `appDataSource`
- `imports` / `demo` 已建立 feature 入口，后续可继续从这里向真实 feature 目录迁移

这一步还没有完成最终形态的 “App shell only”，但已经把前文 4.3 节提到的 “Mock / Demo / Live 逻辑混在同一主流程” 风险压下去了一大截。

#### 5. Extension：已完成 E0 低成本止血

前文 3.5 节和 4.5 节提到的小红书状态解析双定义，已在首轮完成收口：

- 新增唯一来源模块：`apps/extension/src/lib/sites/xiaohongshu/state.ts`
- `apps/extension/entrypoints/content.content.ts`
- `apps/extension/src/lib/site-archive.ts`

这两个调用点现在都共用同一份 `parseXiaohongshuInitialState` / `readXiaohongshuNoteRecord` 逻辑，不再各自维护一份平行实现。

同时，按扩展改动要求，已完成：

- `apps/extension/package.json` 版本从 `0.1.32` 递增到 `0.1.33`
- `apps/extension/wxt.config.ts` 同步递增到 `0.1.33`
- 执行 `npm run build -w @keeppage/extension`

#### 6. 已完成的验证

已执行并通过：

- `npm run typecheck`
- `npm run build -w @keeppage/web`
- `npm run build:demo:html -w @keeppage/web`
- `npm run build -w @keeppage/extension`

其中 `build:demo:html` 已重新生成：

- `docs/mockups/keeppage-full-frontend-demo.html`

此外还完成了一轮真实烟测：

**API 手工/脚本回归**

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /bookmarks`
- `GET /bookmarks/:id`
- `POST /imports/preview`
- `POST /imports`
- `GET /imports`
- `GET /imports/:id`
- `POST /api-tokens`
- `GET /api-tokens`
- `DELETE /api-tokens/:id`
- `POST /captures/init`
- `PUT /uploads/:key`
- `PUT /uploads/:key/chunks/:uploadId`
- `POST /captures/complete`
- `GET /objects?key=...`

其中上传链路已实际验证：

- 单次上传
- `gzip` 解包
- 分片上传 `202 -> 204`
- offset 校验后的最终对象读取

**Web 页面级烟测**

- live 模式可注册并进入主工作台
- live 模式下 `#/settings/api-tokens` 可正常打开
- mock 模式 `#/` 可直接进入带 mock 数据的工作台
- `demo.html` 可正常加载独立 demo 页面

#### 7. Web：W2-1 已完成，列表 / 详情 route-level feature 已落地

本轮继续完成了前文 5.1 节里的第一块高优先级工作，但仍严格控制在 route-level feature 提取，不引入新的全局状态方案。

已新增：

- `apps/web/src/features/bookmarks/list/index.tsx`
- `apps/web/src/features/bookmarks/detail/index.tsx`
- `apps/web/src/features/bookmarks/shared/site-icon.ts`

当前结构已经变成：

- `apps/web/src/App.tsx` 负责 route / session / data source / 数据拉取 effect / 全局 dialog / context menu / cloud/local archive 编排
- 列表页和详情页的大块渲染逻辑，已经分别下沉到 `features/bookmarks/list` 与 `features/bookmarks/detail`

体量上也有实测下降：

- `apps/web/src/App.tsx` 已从上一轮记录的 **5658 行** 进一步下降到 **4629 行**
- 新拆出的 `features/bookmarks/list/index.tsx` 为 **757 行**
- 新拆出的 `features/bookmarks/detail/index.tsx` 为 **536 行**

这说明 `App.tsx` 已不再直接持有列表 / 详情页的主要 JSX 结构，前文 `W2-1` 的完成定义已经满足。

#### 8. API：A4-2 已完成，仓储实现已按能力物理拆分

前文 10.2 节里仍列为待做的 “仓储实现物理拆分”，本轮已经完成。

已新增两套同构目录：

- `apps/api/src/repositories/postgres/`
- `apps/api/src/repositories/memory/`

两侧都已按能力拆成：

- `auth`
- `api-tokens`
- `captures`
- `bookmarks`
- `taxonomy`
- `imports`
- `objects`
- `shared/helpers.ts`

同时：

- `apps/api/src/repositories/postgres-bookmark-repository.ts`
- `apps/api/src/repositories/memory-bookmark-repository.ts`

已经从原来的超级实现文件，收敛为只做转发的薄入口，当前两者都只有 **172 行**。

这意味着：

- `createRepository(...)`
- `BookmarkRepository`
- 各窄接口类型
- route / service 调用方式

都保持不变，但“接口已切窄、实现还堆在一个大文件里”的问题已经被真正解决。

#### 9. Extension：E1-1 已完成，站点适配已 registry 化

前文 10.3 节里原本写的是 “Wave 2 大拆仍然完整待做”。现在需要修正为：**E1-1 已完成，E1-2 / E1-3 / E1-4 仍待做**。

本轮已新增：

- `apps/extension/src/lib/sites/index.ts`
- `apps/extension/src/lib/sites/types.ts`
- `apps/extension/src/lib/sites/generic-reader.ts`
- `apps/extension/src/lib/sites/legacy-reader.ts`
- `apps/extension/src/lib/sites/x/archive.ts`
- `apps/extension/src/lib/sites/x/optimize.ts`
- `apps/extension/src/lib/sites/xiaohongshu/archive.ts`
- `apps/extension/src/lib/sites/sspai/archive.ts`

并完成以下收口：

- `apps/extension/src/lib/site-archive.ts` 已退化为 dispatcher，当前只有 **34 行**
- `apps/extension/src/lib/site-capture.ts` 已退化为 optimizer dispatcher，当前只有 **79 行**
- X 的 focused-column 优化规则已迁入 `sites/x/optimize.ts`
- reader archive 的站点判断与构建逻辑，已由 `sites/index.ts` 统一注册和分发

同时，按扩展改动要求，本轮已完成：

- `apps/extension/package.json` 版本从 `0.1.33` 递增到 `0.1.34`
- `apps/extension/wxt.config.ts` 同步更新到 `0.1.34`
- 执行并通过 `npm run typecheck -w @keeppage/extension`
- 执行并通过 `npm run build -w @keeppage/extension`

#### 10. 本轮新增验证

除了上一轮已经记录的回归外，本轮围绕 W2-1 / A4-2 / E1-1 又补做并通过了：

- 根目录 `npm run typecheck`
- `npm run typecheck -w @keeppage/web`
- `npm run typecheck -w @keeppage/api`
- `npm run typecheck -w @keeppage/extension`
- `npm run build -w @keeppage/web`
- `npm run build -w @keeppage/extension`

本轮没有补新的浏览器手工 smoke，因此 Web / Extension 的最终行为验证仍建议按 10.6 节继续补完。

### 9.2 当前状态判断

截至 2026-04-15，可以把整体状态概括为：

- Web：**W1 / W2-1 已完成，W2-2 / W2-3 待做**
- API：**A1 / A2 / A3 / A4-2 已完成，A4-1 待做**
- Extension：**E0 / E1-1 已完成，E1-2 / E1-3 / E1-4 待做**
- Domain / 根目录清理：**尚未开始**

也就是说，首轮的“骨架搭起来并可编译、可构建、主路径可回归”已经进一步推进到第二轮：Web 的列表 / 详情 feature 化、API 仓储物理拆分、Extension 站点 registry 化都已经落地；但 `settings/archive/cloud-archive/content script/pipeline/domain` 这些后续收口工作还没有结束。

## 十、剩余工作与下一步建议

下面这些事项仍然需要继续推进，按优先级排序如下。

### 10.1 Web：继续完成 W2 的剩余部分，真正把 `App.tsx` 收成 app shell

Web 本轮已经完成 `W2-1`，列表和详情 route 级别的 feature 模块已经落地；后续重点应转向 `W2-2 / W2-3`。

优先建议继续迁出的部分：

1. `features/settings/api-tokens`
2. `features/archive`
3. `features/demo`

当前还没做完的点：

- `apps/web/src/imports.tsx` 目前只是通过 `features/imports/index.tsx` 暴露，还没有完成物理迁移
- `apps/web/src/demoData.ts` 目前也只是通过 `features/demo/index.ts` 收口，还没有拆成真正的 demo feature 子模块
- `apps/web/src/App.tsx` 虽然已下降到 **4629 行**，但仍承载了 settings / archive / manager dialog / context menu / auth 等大量壳层与用例编排逻辑

验收标准仍然是前文 5.1 节那条：

> `App.tsx` 最终应退化为 app shell + route 解析 + session 容器 + 全局 feedback / dialog 挂载。

### 10.2 API：继续完成 A4，收紧 imports / cloud-archive 边界

API 首轮最大的结构调整已经完成，但还有两块需要继续收口：

#### 1. `services/cloud-archive`

虽然 `cloud-archive-manager.ts` / `cloud-archive-worker.ts` 已迁入 `services/cloud-archive/`，但后续仍建议继续做两件事：

- 让 `CloudArchiveManager` 更明确地只保留队列与并发控制
- 把 Puppeteer 抓取、扩展 runtime bridge、fallback archive、signals 聚合继续往 worker / use-case 子模块拆

#### 2. 轻量 route 是否继续 service 化

当前：

- `captures.ts`
- `folders.ts`
- `tags.ts`
- `ingest.ts`

仍属于较轻的 route，直接依赖窄接口是可以接受的。

但如果这些模块后续开始新增复杂规则，建议及时补 `service/use-case`，避免重新回到“route 做编排”的老路。

### 10.3 Extension：Wave 2 大拆仍然完整待做

E0 只是止血，不是整轮结构性重构。以下工作仍未开始：

- `content.content.ts` 按 bridge / selection / toast / signals / capture 拆到 `lib/content/*`
- `popup/App.tsx` 与 `sidepanel/App.tsx` 抽共享状态和 preview 逻辑
- `sync-api.ts` 按 HTTP 客户端 / 任务状态映射 / 本地 db 协调拆分
- `capture-pipeline.ts` 按 stage 拆成 “采集 -> 构建 -> 上传 -> 登记”

已完成的部分：

- `site-archive.ts` 已按 registry 思路拆到 `sites/**`
- `site-capture.ts` 已按 optimizer rule registry 收口

换句话说，前文 5.3 节里 **E1-1 已完成**，但 `content / popup-sidepanel / sync / pipeline` 仍然都在待办状态。

### 10.4 Domain：文件粒度细化仍待做

`packages/domain` 本轮没有改外部导出组织方式，这是有意控制范围的选择。

但后续仍建议把当前偏粗的文件继续按业务边界拆细，例如：

- `auth.ts`
- `bookmark.ts`
- `capture.ts`
- `quality.ts`
- `folder.ts`
- `tag.ts`
- `import.ts`
- `api-access.ts`

目标仍然是不拆 package，先拆文件。

### 10.5 根目录与非核心目录收口仍待做

以下事项还没处理：

- 删除或迁出 `apps/web-demo` 空壳目录
- 继续整理 `expert-ui` / `stitch-keeppage-ui` / `deploy` / `ops` 的边界
- 进一步明确哪些资产应该进入 `docs/mockups`，哪些应该进入 `experiments`

### 10.6 仍建议补做的人工回归

虽然主路径已经过了一轮 smoke，但以下项目仍建议在下一轮开发前后补做人工回归：

- Web live 模式下：
  - 书签详情切换 reader / original 预览
  - 文件夹 / 标签创建、编辑、删除
  - 批量选择、批量移动、批量标签
  - Import 新建 / 历史 / 详情完整流程
  - 云端存档触发与轮询
  - 本地扩展桥接入口
- Extension：
  - 小红书实时识别与归档构建是否都稳定走同一份 state 解析逻辑
  - popup / sidepanel / background 在真实浏览器环境下的联动

## 十一、文档维护建议

从现在开始，这份文档不应该只记录“评审建议”，也应该记录“哪些建议已经真的落地”。

建议后续每完成一轮重构，就在本文继续追加：

- 已完成项
- 尚未完成项
- 已验证范围
- 未验证范围

这样这份文档就能同时承担两种角色：

- 架构评审基线
- 重构进度看板

## 十二、下一轮目标架构蓝图

前文已经说明“先拆什么、后拆什么”。这一节补的是“拆完之后目录应该长什么样”，避免后续重构只是在大文件之间搬代码，而没有真正形成稳定边界。

### 12.1 Web 目标蓝图

Web 下一轮的核心目标，不是把 `App.tsx` 拆成很多零散组件，而是把它收成一个真正的 app shell。

建议目标结构：

```text
apps/web/src/
  app/
    AppShell.tsx
    routes.tsx
    session.ts
  data-sources/
    use-app-data-source.ts
  features/
    bookmarks/
      list/
      detail/
      metadata/
    imports/
      screens/
      hooks/
      adapters/
    settings/
      api-tokens/
    archive/
    demo/
      workspace/
      fixtures/
  shared/
    ui/
    format/
    urls/
  main.tsx
  demo-main.tsx
```

与当前文件的映射关系建议如下：

- `apps/web/src/App.tsx`
  - 收敛为 `app/AppShell.tsx` + `app/routes.tsx`
  - 列表、详情、弹窗、设置页、归档页迁入各自 `features/*`
- `apps/web/src/imports.tsx`
  - 迁入 `features/imports/screens/ImportPage.tsx`
- `apps/web/src/demoData.ts`
  - 拆成 `features/demo/workspace/*` 与 `features/demo/fixtures/*`
- `apps/web/src/local-archive-bridge.ts`
  - 保留独立 adapter 角色，但由 `features/archive` 或 `data-sources` 调用，不再由 `App.tsx` 直接编排

Web 这层最关键的边界不是“组件目录拆细”，而是：

- 页面状态归 feature
- demo/live 差异归 `data-sources`
- app 层只负责路由、session、全局挂载

### 12.2 API 目标蓝图

API 首轮已经做完“接口切窄 + services 落地”，下一轮的重点应该是把“逻辑拆层”进一步落成“文件边界”。

建议目标结构：

```text
apps/api/src/
  app/
    build-server.ts
    register-routes.ts
  routes/
    auth.ts
    bookmarks.ts
    imports.ts
    uploads.ts
  services/
    auth/
      login.ts
      register.ts
      get-current-user.ts
    bookmarks/
      search-bookmarks.ts
      get-bookmark-detail.ts
      update-bookmark-metadata.ts
      delete-bookmark.ts
    imports/
      preview-import.ts
      create-import-task.ts
      get-import-task-detail.ts
    uploads/
      put-object.ts
      upload-chunk.ts
      complete-multipart-upload.ts
    cloud-archive/
      manager.ts
      worker.ts
      fetch-page.ts
      build-fallback-archive.ts
  repositories/
    postgres/
      auth-repository.ts
      api-token-repository.ts
      bookmark-read-repository.ts
      bookmark-write-repository.ts
      import-repository.ts
      object-access-repository.ts
    memory/
      auth-repository.ts
      api-token-repository.ts
      bookmark-read-repository.ts
      bookmark-write-repository.ts
      import-repository.ts
      object-access-repository.ts
    bookmark-repository.ts
    index.ts
  storage/
    object-storage.ts
```

这里最重要的不是目录名字，而是三条硬边界：

1. `routes/*` 只做协议适配、鉴权上下文提取、schema 校验、响应格式化。
2. `services/*` 负责用例编排，不直接暴露 HTTP 概念，也不混写底层 SQL/存储细节。
3. `repositories/*` 只负责持久化与查询，不承担跨能力用例编排。

对当前代码来说，下一轮最值得做的是：

- 继续拆 `services/cloud-archive/cloud-archive-worker.ts`
- 把 `postgres-bookmark-repository.ts` / `memory-bookmark-repository.ts` 物理拆成子文件
- 保持窄接口定义仍然集中导出，避免调用方重新依赖实现细节

### 12.3 Extension 目标蓝图

Extension 下一轮不是简单“拆文件”，而是要同时建立三条边界：

- 按运行时入口分层
- 按站点适配分模块
- 按 pipeline stage 分职责

建议目标结构：

```text
apps/extension/
  entrypoints/
    background.ts
    content.content.ts
    popup/
      App.tsx
      main.tsx
    sidepanel/
      App.tsx
      main.tsx
  src/lib/
    content/
      bridge.ts
      selection.ts
      toast.ts
      signals.ts
      capture.ts
    sites/
      index.ts
      generic-reader.ts
      xiaohongshu/
        state.ts
        content.ts
        archive.ts
      x/
      sspai/
    pipeline/
      collect-page.ts
      build-archive.ts
      upload-archive.ts
      register-capture.ts
    sync/
      http-client.ts
      task-mappers.ts
      local-sync-store.ts
    ui-shared/
      auth/
      preview/
      task-status/
      view-models/
```

与当前热点文件的映射建议：

- `entrypoints/content.content.ts`
  - 退化为入口注册 + 消息分发
  - 实际逻辑迁入 `lib/content/*`
- `src/lib/site-archive.ts`
  - 拆成 `lib/sites/<site>/` + `lib/sites/index.ts`
- `src/lib/sync-api.ts`
  - 拆成 `sync/http-client.ts`、`sync/task-mappers.ts`、`sync/local-sync-store.ts`
- `src/lib/capture-pipeline.ts`
  - 拆成 `pipeline/*` 的 stage
- `entrypoints/popup/App.tsx` 与 `entrypoints/sidepanel/App.tsx`
  - 只保留各自入口专属 UI
  - 共用逻辑下沉到 `ui-shared/`

扩展侧后续最需要避免的一种退化是：

> 新站点兼容继续加进 `site-archive.ts`，新页面交互继续加进 `content.content.ts`，新 UI 状态继续分别加进 popup/sidepanel 的两个 `App.tsx`。

一旦这三条路径继续成立，首轮止血就只会变成“把膨胀推迟一轮”。

### 12.4 Domain 目标蓝图

`packages/domain` 下一轮不建议拆 package，但非常建议拆文件，并保持 `src/index.ts` 作为唯一公共出口。

建议目标结构：

```text
packages/domain/src/
  auth.ts
  bookmark.ts
  capture.ts
  quality.ts
  folder.ts
  tag.ts
  import.ts
  api-access.ts
  archive-html.ts
  cloud-archive.ts
  private-mode.ts
  private-vault.ts
  index.ts
```

这里的核心原则只有两条：

- 共享协议与共享规则优先收口到 `packages/domain`
- 外部 package 只 import `@keeppage/domain` 的稳定导出，不直接依赖文件内部布局

这样拆完之后，未来即使继续细化文件结构，也不会影响三端调用方式。

## 十三、建议按任务包推进，而不是按“感觉”重构

为了避免下一轮重构再次演化成“大改一周但边界没立住”，建议把剩余工作拆成有完成定义的任务包。

### 13.1 Web 任务包

**W2-1：列表与详情迁出 `App.tsx`（已完成）**

- 范围：列表页、详情页、元数据编辑、预览切换
- 主要触点：
  - `apps/web/src/App.tsx`
  - `apps/web/src/api.ts`
  - `apps/web/src/data-sources/use-app-data-source.ts`
- 完成定义：
  - `App.tsx` 不再直接持有列表/详情页的主要渲染逻辑
  - 列表与详情可以各自单独理解、单独维护

当前结果：

- 已新增 `features/bookmarks/list`、`features/bookmarks/detail`、`features/bookmarks/shared/site-icon`
- `App.tsx` 已从 5658 行下降到 4629 行

**W2-2：设置与归档链路迁出 `App.tsx`**

- 范围：API Token、云端归档、本地扩展桥接
- 主要触点：
  - `apps/web/src/App.tsx`
  - `apps/web/src/local-archive-bridge.ts`
  - `apps/web/src/features/*`
- 完成定义：
  - 设置页与归档相关交互不再由 `App.tsx` 直接编排
  - 本地桥接调用通过 feature 或 data-source 层统一进入

**W2-3：demo 目录物理拆分**

- 范围：`demoData.ts`、`mockData.ts`、demo fixture 与 workspace 逻辑
- 完成定义：
  - `features/demo/` 下有清晰的 workspace 与 fixture 边界
  - `App.tsx` 不再 import 大体量 demo 数据文件

### 13.2 API 任务包

**A4-1：继续拆 `cloud-archive` 服务**

- 范围：Puppeteer 抓取、扩展 runtime bridge、fallback archive、signals 聚合
- 主要触点：
  - `apps/api/src/services/cloud-archive/cloud-archive-worker.ts`
  - `apps/api/src/services/cloud-archive/cloud-archive-manager.ts`
- 完成定义：
  - manager 只保留并发与队列控制
  - worker 只保留工作流编排
  - 站点抓取、fallback 构建、signals 计算下沉到子模块

**A4-2：仓储实现物理拆分（已完成）**

- 范围：`postgres-bookmark-repository.ts`、`memory-bookmark-repository.ts`
- 完成定义：
  - 两份实现不再是超级文件
  - 每个子文件只实现一个窄能力接口或一组紧密相关查询

当前结果：

- `memory/` 与 `postgres/` 两套同构目录已经落地
- 两个顶层 repository 文件当前都已收敛到 172 行

**A4-3：轻量 route 的“观察期治理”**

- 范围：`captures.ts`、`folders.ts`、`tags.ts`、`ingest.ts`
- 完成定义：
  - 暂不强制 service 化
  - 但新增复杂规则时必须先补 service/use-case，再扩 route

### 13.3 Extension 任务包

**E1-1：站点适配 registry 化（已完成）**

- 范围：`site-archive.ts`、`site-capture.ts`
- 完成定义：
  - 新站点适配只能放进 `lib/sites/<site>/`
  - `site-archive.ts` 不再作为所有站点逻辑的汇总大文件存在

当前结果：

- `sites/index.ts`、`sites/types.ts` 与 X / 小红书 / 少数派 / generic reader 模块已落地
- `site-archive.ts` / `site-capture.ts` 已分别收敛到 34 / 79 行

**E1-2：content script 职责拆分**

- 范围：`entrypoints/content.content.ts`
- 完成定义：
  - 入口文件只保留注册与分发
  - bridge、toast、selection、signals、capture 分别落到 `lib/content/*`

**E1-3：popup / sidepanel 共享 view-model**

- 范围：
  - `entrypoints/popup/App.tsx`
  - `entrypoints/sidepanel/App.tsx`
- 完成定义：
  - auth 状态、task 映射、preview 状态、label 映射不再各维护一套
  - 两个入口只保留展示差异和入口专属动作

**E1-4：pipeline 与 sync 拆 stage**

- 范围：
  - `src/lib/capture-pipeline.ts`
  - `src/lib/sync-api.ts`
- 完成定义：
  - capture 流程可按阶段理解与替换
  - HTTP 调用、状态映射、本地 db 协调形成独立模块

### 13.4 Domain 与根目录任务包

**D1：共享契约文件细化**

- 范围：`packages/domain/src/capture.ts` 与相关导出
- 完成定义：
  - 大文件按业务边界拆细
  - 对外导出方式保持稳定

**R1：根目录与非核心目录收口**

- 范围：
  - `apps/web-demo`
  - 其他实验/演示/运维目录
- 完成定义：
  - `apps/` 只保留真正的运行时应用
  - 临时资产和实验目录迁到更明确的位置

## 十四、建议补上的架构治理规则

如果没有治理规则，拆一次和不拆几乎没有本质区别，因为代码会沿着“最顺手的路径”重新长回去。

建议从下一轮开始，把下面几条作为评审时的默认检查项。

### 14.1 文件体量阈值

- UI 入口文件超过 400 行时，默认要求说明为什么还不能继续下沉
- 业务编排文件超过 600 行时，默认要求拆成子模块
- 超过 1000 行的非生成文件，应该视为“需要主动拆解”的信号，而不是正常状态

这不是绝对红线，但应该成为默认预警阈值。

### 14.2 Route / Service / Repository 三层边界

- route 不写跨能力业务编排
- service 不暴露 HTTP 细节
- repository 不承担用例编排和状态机决策

评审时如果发现一条规则跨了两层甚至三层，应优先修边界，而不是继续堆功能。

### 14.3 共享规则必须单一来源

以下几类规则必须只有一个主来源：

- 共享协议与 request/response schema
- 共享状态机
- 站点特定的结构化解析规则
- popup / sidepanel 共用的任务状态映射和标签文案

如果运行时需要 adapter，可以有 adapter；但 adapter 不能再维护一份平行规则。

### 14.4 新功能落点规则

后续加需求时，先问两个问题：

1. 这是哪个 feature / use-case / site adapter 的职责？
2. 它应该落在现有边界内，还是说明现有边界本身还缺一层？

不要直接以“这个文件我最熟”作为落点标准。

### 14.5 文档更新规则

后续每完成一个任务包，建议至少同步更新本文三处内容：

1. “已完成”部分补上真实落地项
2. “剩余工作”里删除已完成项，或标记进入下一阶段
3. 补一段最小验证结果，说明这轮拆解后主路径是否仍可用

这样 `docs/architecture-review.md` 才会持续是“活文档”，而不是一次性评审纪要。
