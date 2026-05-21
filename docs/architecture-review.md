# KeepPage 架构评审与拆解看板

> 最新评审：2026-05-21
> 评审目标：梳理当前单体膨胀风险，并把后续拆解任务整理成 AI 友好的执行看板。

## 一、结论摘要

KeepPage 当前的仓库级架构是合理的：

- `apps/api`、`apps/web`、`apps/extension` 三个运行时边界清楚。
- `packages/domain` 承担共享契约，`packages/db` 承担数据库 schema 与 migration。
- npm workspaces 的组织方式足够支撑当前阶段，不需要急着拆更多 package。

真正的风险在 app 内部：

- Web 的 `styles.css` 已完成第一阶段拆分，`App.tsx` 仍是最大 app 级总控。
- API 的 repository 接口已经切窄，但 `postgres/core.ts` / `memory/core.ts` 仍是实现单体。
- Extension 已经拆出站点目录，但 content script、legacy reader、sync、pipeline、popup/sidepanel 仍偏大。
- `packages/domain` 定位正确，但部分共享契约文件粒度偏粗。

一句话判断：

> KeepPage 不是“仓库结构错了”，而是已经进入 vibecoding 后的边界固化期。下一阶段要把已有骨架里的大文件、大状态机、大实现类拆成稳定功能模块。

## 二、当前实测热点

以下统计排除了 `node_modules`、`dist`、`.output`、`.wxt` 等生成目录。

| 优先级 | 文件 | 行数 | 主要风险 |
|---|---:|---:|---|
| P0 | `apps/web/src/App.tsx` | 2277 | session、私密模式、批量操作仍集中；app shell、manager dialog、context menu、本地归档弹窗 UI 已迁出 |
| P0 | `apps/api/src/repositories/postgres/core.ts` | 3562 | 单个 `PostgresRepositoryCore` 承载大量持久化实现 |
| P1 | `apps/extension/src/lib/sites/legacy-reader.ts` | 2126 | generic / X / 小红书 / 少数派 archive builder 仍混在 legacy 文件 |
| P1 | `apps/api/src/repositories/memory/core.ts` | 1942 | memory 实现与 postgres 同步膨胀 |
| P1 | `apps/extension/entrypoints/content.content.ts` | 1734 | content 入口仍做 bridge、signals、selection、toast、archive capture；共享类型/常量已迁出 |
| P2 | `apps/extension/entrypoints/sidepanel/App.tsx` | 1246 | sidepanel 单文件应用 |
| P2 | `apps/extension/entrypoints/sidepanel/style.css` | 1146 | sidepanel 样式偏大 |
| P2 | `apps/web/src/api.ts` | 969 | HTTP client、缓存、normalize、各领域 API 混在一个文件 |
| P2 | `apps/extension/src/lib/sync-api.ts` | 923 | HTTP、上传、任务状态、本地协调混在一起 |
| P2 | `apps/extension/entrypoints/popup/App.tsx` | 864 | popup 单文件应用，与 sidepanel 有共享逻辑空间 |
| P2 | `apps/web/src/features/api-tokens/index.tsx` | 808 | feature 已拆出，但单文件仍偏大 |
| P2 | `apps/web/src/features/bookmarks/list/index.tsx` | 788 | 列表页已迁出 App，但自身可继续细化 |
| P2 | `apps/extension/src/lib/capture-pipeline.ts` | 690 | 采集、构建、上传、登记 pipeline 未按 stage 拆 |
| P2 | `apps/extension/entrypoints/background.ts` | 687 | background 消息处理偏集中 |
| P2 | `apps/extension/src/lib/domain-runtime.ts` | 682 | 与 `packages/domain` 的规则边界需要继续明确 |
| P2 | `packages/domain/src/capture/contracts.ts` | 605 | 共享契约已迁入 capture 子目录，仍需继续按业务边界细拆 |
| P2 | `apps/web/src/features/bookmarks/detail/index.tsx` | 596 | 详情页已迁出 App，但自身可继续细化 |

AST 粗扫也印证了几个“单个函数/类过长”的点：

- `App` 函数约 2050 行，仍是主要 app 级编排点。
- `AppShell` 已迁入 `apps/web/src/app/app-shell.tsx`，约 698 行。
- `ManagerDialog` 已迁入 `apps/web/src/app/manager-dialog.tsx`，约 506 行。
- `PostgresRepositoryCore` class 约 3427 行。
- `InMemoryRepositoryCore` class 约 1832 行。
- `legacy-reader.ts` 中多个站点 builder 都在 250 行以上。
- `syncTaskToApi` 约 175 行。

## 三、当前状态判断

### 3.1 仓库级：继续沿用

仓库级边界清晰，不建议新增复杂的微服务、微前端或更多 workspace。下一阶段的收益主要来自 app 内部拆分。

### 3.2 Web：最高优先级

Web 已经有 feature 目录，列表和详情也已从 `App.tsx` 迁出一部分，样式入口也已完成第一阶段拆分。当前最大阻力集中在：

- `App.tsx` 仍是 app 级总控。
- manager dialog、context menu、batch selection、private/local archive 壳层还在主文件内。

这会导致：

- AI 修改任何主流程都需要读大量无关状态。
- UI 调整容易误伤全局样式。
- settings、archive、private、manager dialog、context menu、batch 操作之间耦合过高。

### 3.3 API：方向正确，但 core 实现还没拆实

已完成的好变化：

- `bookmark-repository.ts` 已经拆出 `AuthRepository`、`ApiTokenRepository`、`CaptureRepository`、`BookmarkReadRepository`、`BookmarkWriteRepository`、`TaxonomyRepository`、`ImportRepository`、`ObjectAccessRepository` 等窄接口。
- `services/` 已经存在，`routes/uploads.ts` 等 route 也明显变瘦。
- `postgres-bookmark-repository.ts` / `memory-bookmark-repository.ts` 已经是薄入口。

剩余问题：

- `postgres/core.ts` 和 `memory/core.ts` 仍保留大部分真实实现。
- `postgres/bookmarks.ts`、`memory/bookmarks.ts` 等能力文件目前很多只是转发到 core。
- 后续新增存储能力如果继续写进 core，会重新长回单体数据入口。

### 3.4 Extension：站点拆分已有进展，但入口和流水线仍大

已完成的好变化：

- `src/lib/sites/index.ts`、`types.ts`、`generic-reader.ts`、`x/*`、`xiaohongshu/*`、`sspai/*` 已经存在。
- 小红书 state 解析已有 `sites/xiaohongshu/state.ts`，避免 content 与 archive 各写一份。

剩余问题：

- `legacy-reader.ts` 仍超过 2000 行，站点 builder 还需要继续搬离。
- `content.content.ts` 仍是 content 侧总调度器。
- popup / sidepanel 各自是单文件应用，共享 view-model 还没形成。
- `sync-api.ts` 与 `capture-pipeline.ts` 需要拆成 HTTP / mapper / local store / pipeline stages。

### 3.5 Domain：暂不拆包，先拆文件

`packages/domain` 的角色是正确的，但 `capture.ts` 已经混入较多领域概念。下一阶段应保持 `@keeppage/domain` 对外导出稳定，同时把内部文件按业务边界拆细。

## 四、建议目标结构

### 4.1 Web 目标结构

```text
apps/web/src/
  app/
    App.tsx
    AppShell.tsx
    routes.ts
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
      extension-devices/
    private/
    archive/
    taxonomy/
    demo/
      workspace/
      fixtures/
  styles/
    tokens.css
    layout.css
    sidebar.css
    bookmarks.css
    dialogs.css
    mobile.css
  shared/
    ui/
    format/
    urls/
```

关键边界：

- app 层只保留路由、session、全局挂载。
- feature 持有自己的页面状态、表单、弹窗、view model。
- demo/live 差异归 `data-sources` 和 `features/demo`。
- 样式按界面区域拆，不继续集中到一个全局大文件。

### 4.2 API 目标结构

```text
apps/api/src/
  routes/
  services/
    auth/
    bookmarks/
    captures/
    imports/
    uploads/
    icons/
  repositories/
    bookmark-repository.ts
    postgres/
      core.ts
      auth.ts
      api-tokens.ts
      captures.ts
      bookmarks.ts
      taxonomy.ts
      imports.ts
      objects.ts
      shared/
    memory/
      core.ts
      auth.ts
      api-tokens.ts
      captures.ts
      bookmarks.ts
      taxonomy.ts
      imports.ts
      objects.ts
      shared/
  storage/
```

关键边界：

- `core.ts` 只保留连接、事务、对象存储引用、通用 mapper/helper。
- 各领域文件持有真实查询和写入逻辑。
- route 不写跨能力编排。
- service 不暴露 HTTP 细节。
- repository 不承担 use-case 状态机决策。

### 4.3 Extension 目标结构

```text
apps/extension/
  entrypoints/
    background.ts
    content.content.ts
    popup/
    sidepanel/
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
      x/
      xiaohongshu/
        state.ts
        content.ts
        archive.ts
      sspai/
    pipeline/
      collect-page.ts
      build-archive.ts
      upload-archive.ts
      register-capture.ts
    sync/
      http-client.ts
      upload.ts
      task-mappers.ts
      local-sync-store.ts
    ui-shared/
      auth/
      preview/
      task-status/
      view-models/
```

关键边界：

- `entrypoints/*` 退化为入口注册和消息分发。
- 新站点只能进 `src/lib/sites/<site>/`。
- content 侧 UI/DOM/bridge/signals 分模块维护。
- popup 与 sidepanel 共用状态映射、preview、auth view-model。

### 4.4 Domain 目标结构

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
  extension-device.ts
  private-mode.ts
  private-vault.ts
  index.ts
```

关键边界：

- 外部仍只 import `@keeppage/domain`。
- 共享协议、状态机和跨端规则只有一个主来源。
- 运行时 adapter 可以存在，但不能维护另一套平行规则。

## 五、任务包

### W1：拆 `App.tsx` 余留编排

状态：进行中。2026-05-21 已迁出路由 hash、session token/error、预览选择、剪贴板与用户展示格式到 `apps/web/src/app/**`，`App.tsx` 从 3903 行降到 3680 行。同日继续迁出 `ManagerDialog`、`ContextMenu`、`LocalArchiveDialog`、`AppShell` 到 `apps/web/src/app/**`，`App.tsx` 降到 2277 行；batch selection 与 private mode 壳层仍需继续下沉。

范围：

- session restore / auth panel。
- app shell / sidebar / mobile chrome。（已迁出 UI 组件，仍由 `App.tsx` 提供路由和动作回调）
- manager dialog。（已迁出 UI 组件与类型，业务 handler 仍在 `App.tsx`）
- context menu。（已迁出 UI 组件与类型，菜单组装仍在 `App.tsx`）
- batch selection。
- private mode 壳层状态。
- local archive dialog。（已迁出 UI 组件与类型，队列提交 handler 仍在 `App.tsx`）

完成定义：

- `App.tsx` 降到 app shell + route 解析 + session 容器 + 全局挂载。
- 大块 JSX 和用例编排进入对应 feature。
- 新增书签列表、详情、设置、私密模式相关需求时，不再默认修改 `App.tsx`。

### W2：拆 `styles.css`

状态：已完成第一阶段。2026-05-21 已将原 6184 行 `styles.css` 拆为 `apps/web/src/styles/**`，原文件只保留 13 行 `@import` 入口，保持 CSS 级联顺序与视觉行为不变。

范围：

- tokens / base / layout。
- sidebar / mobile chrome。
- bookmarks list / detail。
- dialogs / forms。
- settings / imports / private。

完成定义：

- `styles.css` 不再是 6000 行全局样式入口。
- 修改某个 feature 的样式时，可以定位到对应 CSS 文件。
- 样式拆分只做搬运和命名收口，避免顺手大改视觉。

### W3：demo 与 imports 物理归位

状态：已完成第一阶段。2026-05-21 已将 imports 实现迁入 `features/imports/index.tsx`，demo workspace/mock 数据迁入 `features/demo/workspace.ts` 与 `features/demo/mock-data.ts`；根目录保留薄 re-export 兼容旧 import。

范围：

- `apps/web/src/demoData.ts`
- `apps/web/src/mockData.ts`
- `apps/web/src/imports.tsx`
- `features/demo`
- `features/imports`

完成定义：

- demo fixture 与 demo workspace 逻辑在 `features/demo/**` 下有清晰边界。
- imports UI 物理迁入 `features/imports/**`。
- `src/` 根目录只保留入口和通用薄文件。

### A1：拆 API repository core

状态：进行中。2026-05-21 已补齐 postgres/memory 的 extension-devices、private-mode、private-captures、private-bookmarks capability 文件，并让外层 repository 不再直接散落调用 `this.core.*`；真实 SQL / memory 方法体仍在 core，后续需逐领域继续迁出 private helper 依赖。

范围：

- `apps/api/src/repositories/postgres/core.ts`
- `apps/api/src/repositories/memory/core.ts`
- `apps/api/src/repositories/postgres/*`
- `apps/api/src/repositories/memory/*`

完成定义：

- `core.ts` 不再持有大量领域方法。
- `auth.ts`、`bookmarks.ts`、`captures.ts`、`imports.ts` 等文件持有真实实现。
- `PostgresRepositoryCore` / `InMemoryRepositoryCore` 只作为共享上下文和通用 helper。

### A2：观察轻量 route，复杂化时补 service

范围：

- `captures.ts`
- `folders.ts`
- `tags.ts`
- `ingest.ts`

完成定义：

- 现阶段可保持轻量 route。
- 一旦新增跨能力规则，先补 service/use-case，再扩 route。

### E1：拆 content script

状态：进行中。2026-05-21 已新增 `src/lib/content/types.ts`，迁出 content script 共享类型与常量，并按扩展规则 bump 到 `0.1.40` 后重新构建。bridge、signals、selection、toast、capture 方法体仍需继续迁出。

范围：

- `apps/extension/entrypoints/content.content.ts`
- `apps/extension/src/lib/content/*`

完成定义：

- content 入口只保留消息注册和分发。
- bridge、signals、selection、toast、capture 分别有独立模块。
- 小红书/X 等站点专用 DOM 采集逻辑不继续堆在 content 入口。

### E2：继续迁出 legacy reader

范围：

- `apps/extension/src/lib/sites/legacy-reader.ts`
- `apps/extension/src/lib/sites/generic-reader.ts`
- `apps/extension/src/lib/sites/x/*`
- `apps/extension/src/lib/sites/xiaohongshu/*`
- `apps/extension/src/lib/sites/sspai/*`

完成定义：

- `legacy-reader.ts` 不再包含多个站点的大块 builder。
- generic / X / 小红书 / 少数派分别由各自目录维护。
- `sites/index.ts` 是统一 registry 和 dispatcher。

### E3：popup / sidepanel 共享 view-model

范围：

- `entrypoints/popup/App.tsx`
- `entrypoints/sidepanel/App.tsx`
- `src/lib/ui-shared/*`

完成定义：

- auth 状态、task 状态 label、preview 状态、错误提示映射有共享来源。
- popup / sidepanel 只保留入口专属 UI 和动作差异。

### E4：拆 sync 与 capture pipeline

范围：

- `src/lib/sync-api.ts`
- `src/lib/capture-pipeline.ts`

完成定义：

- sync 按 HTTP client、upload、task mapper、local store 拆分。
- capture pipeline 按 collect、build、upload、register 等 stage 拆分。
- 单个 stage 可以独立理解和替换。

### D1：细化 domain 文件

状态：已完成第一阶段。2026-05-21 已将 `packages/domain/src/capture.ts` 退化为 1 行外观导出，真实契约迁入 `packages/domain/src/capture/contracts.ts`，并新增 `capture/index.ts`，保持 `@keeppage/domain` 对外导出兼容。

范围：

- `packages/domain/src/capture.ts`
- `packages/domain/src/index.ts`

完成定义：

- 共享契约按业务边界拆文件。
- 对外导出保持兼容。
- 三端不需要改 import 路径，仍使用 `@keeppage/domain`。

### R1：整理非核心目录

范围：

- 根目录 mockup / preview HTML。
- `expert-ui`
- `stitch-keeppage-ui`
- `output`
- `docs/mockups`

完成定义：

- `apps/` 只放真实运行时应用。
- 临时资产、实验页面、设计稿进入 `docs/mockups` 或未来的 `experiments`。
- README 或 docs 中说明这些目录的用途，避免 AI 把实验资产当正式代码。

## 六、建议顺序

1. W2：先拆 `styles.css`。这是最大文件，且可以低风险搬运。
2. W1：拆 `App.tsx` 的 manager dialog、context menu、private/local archive 壳层。
3. A1：拆 API repository core，让已存在的能力文件真正承载实现。
4. E1：拆 content script，阻止扩展入口继续膨胀。
5. W3：demo/imports 物理归位。
6. E2：继续迁出 legacy reader。
7. E3/E4：拆 popup/sidepanel 共享 view-model 与 sync/pipeline。
8. D1：细化 domain 文件。
9. R1：整理非核心目录和实验资产。

原因：

- `styles.css` 和 `App.tsx` 是当前 AI 读写成本最高的两个点。
- API 的接口边界已经准备好，继续拆 core 的收益稳定。
- Extension 总复杂度高，但拆点多，适合在 Web/API 主要阻力下降后分批推进。
- Domain 拆文件影响面广，应该在 app 内部边界更稳定后做。

## 七、架构治理规则

### 7.1 文件体量阈值

- UI 入口文件超过 400 行时，默认要求说明为什么还不能继续下沉。
- 业务编排文件超过 600 行时，默认要求拆成子模块。
- 超过 1000 行的非生成文件，视为需要主动拆解的信号。

这些不是硬性红线，但应该作为默认预警。

### 7.2 三层边界

- route 不写跨能力业务编排。
- service 不暴露 HTTP 细节。
- repository 不承担 use-case 状态机决策。

如果一条规则跨了两层甚至三层，优先修边界，再堆功能。

### 7.3 共享规则单一来源

以下规则必须只有一个主来源：

- 共享协议与 request/response schema。
- 共享状态机。
- 站点特定的结构化解析规则。
- popup / sidepanel 共用任务状态映射和文案。

运行时 adapter 可以存在，但 adapter 不能维护一份平行规则。

### 7.4 新功能落点规则

新增需求前先判断：

1. 这是哪个 feature / use-case / site adapter 的职责？
2. 它应该落在现有边界内，还是说明现有边界缺一层？

不要因为某个大文件最熟，就继续把新功能加进去。

### 7.5 文档更新规则

每完成一个任务包，至少同步更新本文三处：

1. 在任务包中标记完成结果。
2. 调整“当前实测热点”的行数和判断。
3. 补一段验证结果，说明 typecheck/build/manual smoke 是否覆盖。

## 八、验证基线

### 2026-05-21 本轮验证记录

- 已通过：`npm run typecheck -w @keeppage/web`，覆盖 W1 的 app shell / manager dialog / context menu / local archive dialog 迁出。
- 已通过：`npm run build -w @keeppage/web`，覆盖 W1 迁出后的 Web production build。
- 已通过：`npm run build -w @keeppage/web`，覆盖 W1/W2/W3 的 TypeScript 与 Vite production build。
- 已通过：`npm run typecheck -w @keeppage/api`，覆盖 A1 facade 落点调整。
- 已通过：`npm run typecheck`，覆盖 Web/API/Extension/DB/Domain 全仓类型检查。
- 已通过：`npm run build -w @keeppage/extension`，覆盖 E1 拆分与扩展版本 `0.1.40` 构建。
- 未完成：API HTTP smoke、Web 浏览器 smoke、Extension 真实浏览器 smoke；本轮尝试打开本地 Web smoke 时浏览器客户端阻止 `localhost` 访问，后续涉及方法体迁移时需要补人工 smoke。

每轮结构调整后，至少执行：

```bash
npm run typecheck
```

涉及 Web 时补：

```bash
npm run build -w @keeppage/web
```

涉及 Extension 时必须补：

```bash
npm run build -w @keeppage/extension
```

涉及 API 关键路径时建议手工 smoke：

- `GET /health`
- 注册 / 登录 / `GET /auth/me`
- 书签列表 / 详情。
- 导入 preview / create / detail。
- capture init / upload / complete / object read。

涉及 Web UI 时建议浏览器 smoke：

- live 模式进入工作台。
- mock/demo 模式进入工作台。
- 书签详情 reader/original 预览。
- 文件夹 / 标签创建、编辑、删除。
- 批量选择、批量移动、批量标签。
- 导入新建 / 历史 / 详情。

涉及 Extension 时建议真实浏览器 smoke：

- background / popup / sidepanel 联动。
- 标准保存与私密保存。
- 小红书、X、少数派、通用 reader 归档。
- 本地队列与同步上传。
