# UI 重构功能基线

核对日期：2026-09-20。本文记录重构需要保留的功能与代码入口，不规定配色、字体、圆角、材质或页面布局。

## 实际入口

| 范围 | 入口与职责 |
| --- | --- |
| Web 正式入口 | `apps/web/index.html` → `src/main.tsx` → `src/App.tsx` |
| Web 演示入口 | `apps/web/demo.html` → `src/demo-main.tsx` → 同一个 `App`，使用演示数据源 |
| 工作台与路由 | `src/app/app-shell.tsx`、`src/app/routes.ts` |
| 书签列表 | `src/features/bookmarks/list/index.tsx`、`brand-card.tsx`；仅保留当前卡片实现 |
| 归档详情 | `src/features/bookmarks/detail/index.tsx`、`src/app/archive-preview.ts` |
| 其他功能 | `src/features/{imports,private,shares,api-tokens,extension-devices,extension-connect,ai-organize}/` |
| 全局交互 | `src/app/{context-menu,manager-dialog,local-archive-dialog}.tsx` |
| 样式 | `src/styles.css` 按顺序引入 `src/styles/*.css`；重构时核对共享选择器和级联 |
| 数据与契约 | `src/data-sources/use-app-data-source.ts`、`src/api/index.ts`、`packages/domain` |
| 扩展 UI | `apps/extension/entrypoints/popup/` 与 `sidepanel/`，属于两个实际使用中的入口 |

表中 `src/` 均相对于 `apps/web/`。`App.tsx` 仍承担大量会话、私密模式、批量操作编排，不能按旧文档将它视为纯路由壳后直接替换。

## 功能与回归范围

| 流程 | 重构后应验证 |
| --- | --- |
| 会话 | 登录、注册、退出、会话失效与错误提示 |
| 书签列表 `#/` | 搜索、全部/星标/最近视图、收藏夹层级与标签筛选、分页加载、空态/错误态/加载态 |
| 书签动作 | 卡片打开原网页；存档按钮或菜单打开归档；星标、元数据编辑、右键菜单 |
| 批量操作 | 跨筛选保留选择、全选/取消、收藏夹/标签调整、分享、本地插件存档与删除确认 |
| 详情 `#/bookmarks/:id` | 版本切换、归档预览/下载、对象缺失反馈与返回列表 |
| 导入 `#/imports/new`、`#/imports`、`#/imports/:id` | 来源输入、预览、提交、历史与结果详情 |
| 私密 `#/settings/private-mode`、`#/private/bookmarks/:id` | 设置/解锁/锁定/重设密码、私密列表与归档；内容不混入普通列表，刷新后重新解锁 |
| 分享 `#/settings/shares`、`/s/:token` | 多选创建、复制/管理/撤销、访客只读浏览与失效状态；不公开私密内容 |
| API Token `#/settings/api-tokens` | 创建、一次性显示密钥、撤销与异常状态 |
| 扩展 `#/settings/extension-devices`、`#/extension/connect` | 设备管理、撤销、连接授权流程 |
| AI 整理 `#/settings/ai-organize` | 配置、连接测试、开始任务、进度及失败反馈 |
| 响应式与无障碍 | 桌面/窄屏导航、键盘焦点、弹窗关闭、菜单定位、长标题、横向溢出 |

私密模式是密码访问控制与数据隔离，不是端到端加密保险箱。重构须保留这项能力边界的准确说明。

## 开发与验证

- `npm run dev:web`：正式数据源，需要 API。
- `npm run dev:web:mock`：同一 UI 使用演示数据，不需要登录真实账号。
- `npm run dev:demo`：打开 `/demo.html`，同样复用正式组件。
- `npm run build:demo:html`：从当前代码生成 `apps/web/dist-standalone/keeppage-demo.html`，不把构建快照写回文档目录。
- 每次改动运行 `npm run typecheck`；Web 改动运行 `npm run build -w @keeppage/web` 并做相关浏览器 smoke。
- 改扩展时遵守 `AGENTS.md` 中版本同步和构建要求。

Mock 不覆盖完整私密、AI 服务和插件交互。演示通过不能替代真实 API 与 Chrome 扩展联调；正式模式在 API 失败时显示错误，不自动切换为模拟数据。

## 2026-09-20 标题优先体验

- 默认采用紧凑视图，用户可切换画廊并保留偏好。整张卡片打开原网页，存档与创建存档使用独立按钮。
- 列表标题、条数、目录与标签条件、搜索范围、排序集中在工具栏。默认按收藏时间排序，另支持最近更新、标题顺序和搜索相关性。
- 收藏夹与标签可组合筛选，筛选条件写入 hash URL；详情返回列表恢复条件和已加载内容。侧栏目录搜索只定位目录，不修改书签搜索条件。
- 切换目录只展示目标查询的数据。命中缓存立即呈现并后台校验；无缓存延迟展示骨架，后台错误保留已有内容。目录 hover/focus 有限预取，不全量下载资料库。
- 列表缓存按账号隔离，修改后失效，退出后清除。每个接口请求不超过100条，已加载大列表需要分批校验。
- 多选区分当前已加载项与全部结果；跨目录选择保留，批量动作使用统一的已选集合。部分失败保留失败项并支持仅重试失败项。标签支持追加、移除和替换。
- 正式数据源不初始化演示数据；演示入口按需加载数据源，继续使用同一套UI组件。

新增回归命令：

```bash
node --experimental-strip-types --test apps/web/src/lib/batch-actions.test.ts apps/web/src/lib/bookmark-list-cache.test.ts apps/web/src/lib/bookmark-window.test.ts apps/web/src/app/search-scope.test.ts
```

浏览器验收应检查：首次切夹与缓存返回、连续快速切夹、搜索/目录组合、前进后退、详情返回、超过100条的分页列表、全结果选择、键盘弹窗与菜单、1024px和390px布局。生产验收使用真实站点，只读检查；失败重试与写操作回归通过隔离测试数据验证。

## 本次清理边界

已移出工作区：两套独立设计探索、静态 HTML 原型、旧 UI 截图、无引用架构图、过时进度/架构评审报告、隐藏目录中的旧 UI 与未落地云端存档计划、生产 public 目录中的临时溢出检查页，以及引用已不存在设计目录的本地 `ui-guide` Skill。

已移除旧版横向卡片、版本切换控件、旧偏好读取与专属样式。浏览器中残留的旧版本偏好不再影响显示。演示数据与正式组件继续共用同一实现；扩展两个入口和 TS 回滚后端仍有实际用途。

今后的视觉规范由新的重构需求明确建立。

## 2026-09-20 设置工作台重设计

- 设置分类按资料库、连接与分享、数据管理分组；直接访问设置及导入路由保持当前分类，返回书签保留原查询。
- 私密、AI、API 密钥、分享、设备与导入界面采用统一表单与状态层级。API 调用示例默认折叠；分享编辑操作栏在滚动时保持可见。
- 私密收藏使用页内独立搜索，关键词不写入公开 URL；状态加载失败可直接重试。
- 密钥创建/撤销、分享编辑/撤销、设备撤销提供焦点管理和繁忙状态保护。插件连接须点击“授权并连接”才开始授权。
- 导入表单参数在 `src/api/import-request.ts` 转为共享 API 的 `content + options` 契约，避免 Go 严格解码拒绝平铺策略字段。
- 回归增加 `node --experimental-strip-types --test apps/web/src/api/import-request.test.ts`。本轮浏览器验收使用正式前后端隔离账号，未访问 Demo；上线状态单独记录，不由本地通过推断。
