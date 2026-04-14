# KeepPage 架构评审与拆解建议

> 评审时间：2026-04-15
> 评审目标：判断当前目录架构是否合理，并识别后续单体迭代开发的膨胀风险，给出可执行的拆解顺序。

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

- `apps/web/src/App.tsx` 约 6100+ 行
- 同时承担了路由、鉴权、列表页、详情页、批量选择、上下文菜单、文件夹/标签管理、导入流程、API Token、云端归档、本地插件桥接、mock/demo 逻辑

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

- `apps/api/src/repositories/postgres-bookmark-repository.ts` 约 2400 行
- `apps/api/src/repositories/memory-bookmark-repository.ts` 约 1380 行

这会导致：

- 每增加一个领域能力，都要继续扩充同一个 Repository 接口
- `memory` / `postgres` 双实现会被迫同步膨胀
- 仓储层既写 SQL，又做聚合映射，又混入部分业务判断

判断：

> API 还没有变成单体服务，但 Repository 已经开始变成“单体数据入口”。

### 3.4 API Route：开始承担用例编排

这一层判断为：**中高风险，需要尽早止损**

一些 route 文件已经不只是协议适配，而是在做业务编排。

例如：

- `apps/api/src/routes/imports.ts`
  - 请求体归一化
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

这一层判断为：**中风险，第三优先级拆**

扩展本身按运行时入口拆得不差：

- `entrypoints/background.ts`
- `entrypoints/content.content.ts`
- `entrypoints/popup/*`
- `entrypoints/sidepanel/*`

但内部仍有几个明显的膨胀点：

#### 1. 站点适配聚合过重

`apps/extension/src/lib/site-archive.ts` 同时包含：

- 通用 reader 提取
- X 站点适配
- 小红书适配
- 少数派适配
- HTML 拼装与样式模板

这意味着后面每新增一个站点兼容，都还会继续堆在这个文件里。

#### 2. Content script 承担职责过多

`apps/extension/entrypoints/content.content.ts` 当前同时处理：

- runtime message
- DOM 信号采集
- 选区模式交互
- 页面归档抓取
- 页面内 toast
- Web 与 extension 的桥接消息

这已经不是单一“content script 入口”，而是“content 侧总调度器”。

#### 3. 领域运行时逻辑有重复实现迹象

`apps/extension/src/lib/domain-runtime.ts` 内有不少与 `packages/domain` 接近的运行时约束与解析逻辑。

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

- `apps/web-demo/dist`
- `expert-ui`
- `stitch-keeppage-ui`
- `deploy`
- `ops`

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

当前最明显的几个文件：

- `apps/web/src/App.tsx`
- `apps/api/src/repositories/postgres-bookmark-repository.ts`
- `apps/api/src/repositories/memory-bookmark-repository.ts`
- `apps/extension/src/lib/site-archive.ts`
- `apps/extension/entrypoints/content.content.ts`
- `apps/extension/entrypoints/sidepanel/App.tsx`

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

- route 不只做 HTTP
- repository 不只做存储
- lib 有时是工具函数，有时又是业务编排

这类问题前期不会立刻爆炸，但会在需求开始并行迭代时明显拖慢开发。

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

建议分组：

- `auth`
- `api-tokens`
- `bookmarks`
- `captures`
- `folders-tags` 或 `taxonomy`
- `imports`

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

1. Web：拆 `App.tsx`
2. API：拆 `BookmarkRepository`
3. API：补 `service/use-case` 层
4. Extension：拆 `site-archive.ts`
5. Extension：拆 `content.content.ts`
6. Domain：细化共享契约文件
7. 根目录：整理 demo / mockup / 产物目录

原因：

- Web 当前最容易继续膨胀，而且回报最快
- API Repository 是后端长期演进的主要阻塞点
- Extension 的复杂度高，但拆分收益次于前两者

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
