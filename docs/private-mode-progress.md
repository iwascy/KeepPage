# KeepPage 私密模式实现进度

## 文档目的

记录 `docs/private-mode-prd.md` 的实际开发进展，避免后续开发时只看到 PRD、看不到当前代码状态。

## 当前结论

截至 `2026-03-19`，私密模式已完成 **V1：本机私密** 的首轮落地，范围以 `apps/extension` 为主，`apps/web` 做了最小提示接入；`apps/api` 与 `packages/db` 的 V2 私密同步链路尚未开始。

## 本次已完成

### 1. 领域模型补充

已在 `packages/domain` 中加入私密模式相关类型：

- `SaveMode`
- `PrivateMode`
- `PrivateSyncState`
- `PrivateAutoLock`
- `PrivateVaultSummary`
- `PrivateCaptureTaskShell`

对应文件：

- [packages/domain/src/private-vault.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/packages/domain/src/private-vault.ts)
- [packages/domain/src/capture.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/packages/domain/src/capture.ts)

### 2. 扩展本地私密库

已在扩展侧新增独立的私密存储层：

- IndexedDB 新增 `privateVault` 与 `privateCaptureTasks`
- 私密任务分为：
  - 明文壳：仅保留最小必要字段
  - 加密载荷：保存 `source`、`quality`、`artifacts`、`localArchiveSha256`
- 使用浏览器端 `PBKDF2 + AES-GCM` 实现首版口令派生和内容加密
- 支持自动锁定计时和手动锁定

对应文件：

- [apps/extension/src/lib/extension-db.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/extension-db.ts)
- [apps/extension/src/lib/private-vault.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/private-vault.ts)

说明：

- PRD 推荐的 `Argon2id` 还没有接入，当前为了先落地 V1，先用了 WebCrypto 能直接支持的 `PBKDF2`。
- 恢复码当前已生成并展示，但仅完成“生成与提示”，还没有恢复流程。

### 3. 扩展 Side Panel 双模式

已将 Side Panel 改成普通 / 私密双模式：

- 顶部新增“保存模式”选择器
- 支持持久化最近一次模式选择
- 支持“无痕窗口默认私密”
- 私密模式下支持：
  - 首次启用私密库
  - 设置自动锁定时长
  - 解锁私密库
  - 手动锁定私密库
  - 锁定态任务列表
  - 解锁态详情与本地预览

对应文件：

- [apps/extension/entrypoints/sidepanel/App.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/entrypoints/sidepanel/App.tsx)
- [apps/extension/entrypoints/sidepanel/style.css](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/entrypoints/sidepanel/style.css)

### 4. 抓取链路分流

已把普通保存和私密保存拆成两条本地执行路径：

- 普通模式仍沿用原有队列与 API 同步链路
- 私密模式会在本地完成抓取、质量评估、加密落盘
- 私密模式当前不会走普通 `/captures/*` 接口
- 私密模式日志已做最小暴露处理，不再记录标题、URL、正文片段

对应文件：

- [apps/extension/src/lib/capture-pipeline.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/capture-pipeline.ts)
- [apps/extension/src/lib/messages.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/messages.ts)
- [apps/extension/entrypoints/background.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/entrypoints/background.ts)

### 5. Web 端最小提示

Web 工作台已增加私密模式说明区，明确当前状态：

- V1 私密库主要在扩展端可用
- Web 暂不支持私密内容解锁查看
- 后续 V2 再补 Web 锁定态 / 解锁态页面

对应文件：

- [apps/web/src/App.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/web/src/App.tsx)
- [apps/web/src/styles.css](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/web/src/styles.css)

### 6. 扩展版本与构建

已按仓库要求处理扩展产物：

- 版本已从 `0.1.1` 升到 `0.1.2`
- 已重新执行扩展构建

对应文件：

- [apps/extension/package.json](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/package.json)
- [apps/extension/wxt.config.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/wxt.config.ts)

## 已验证

已完成以下验证：

- `npm install`
- `npm run typecheck`
- `npm run build -w @keeppage/extension`

说明：

- 本次验证覆盖了类型检查与扩展构建。
- 还没有补真实 Chrome 手工场景的私密模式回归记录。

## 当前未完成

以下 PRD 项目仍未落地：

### V1 范围内未完成

- 域名级私密规则仍未实现
- 私密失败任务的“原地重试”仍是首版能力，尚未单独优化任务动作
- 恢复码仅生成，不支持恢复流程
- 私密日志策略已收敛，但还没有统一的日志开关与审查机制

### V2 完全未开始

- `apps/api` 私密专用路由
- `packages/db` 私密专用表
- 私密对象上传与私密完成写入
- Web 私密库锁定态概览
- Web 私密库解锁态列表 / 详情 / 预览
- 跨设备同步私密

## 当前已知设计折中

这次实现是“先做可运行 V1”的版本，存在几个明确折中：

1. 密钥派生算法暂用 `PBKDF2`，还没切到 PRD 建议的 `Argon2id`。
2. 私密任务当前只保存在扩展本机，不做服务端加密同步。
3. Web 端目前只有提示，不承载私密内容展示。
4. 私密任务锁定态仍会显示任务状态和时间，但不显示标题、域名、URL、质量原因和预览。

## 推荐下一步

建议下一次开发按下面顺序继续：

1. 先补 `apps/api + packages/db` 的私密链路骨架：
   - `private_vaults`
   - `private_capture_uploads`
   - `private_bookmarks`
   - `private_bookmark_versions`
2. 再补扩展侧同步私密上传协议，避免复用普通 `/captures/*`
3. 然后补 Web 私密库锁定态页面
4. 最后再做 Web 解锁态和跨设备私密查看

## 快速判断当前代码状态

如果下次打开仓库想快速确认状态，可以先看这些文件：

- [docs/private-mode-prd.md](/Users/cyan/.codex/worktrees/6422/KeepPage/docs/private-mode-prd.md)
- [docs/private-mode-progress.md](/Users/cyan/.codex/worktrees/6422/KeepPage/docs/private-mode-progress.md)
- [apps/extension/src/lib/private-vault.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/private-vault.ts)
- [apps/extension/src/lib/capture-pipeline.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/capture-pipeline.ts)
- [apps/extension/entrypoints/sidepanel/App.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/entrypoints/sidepanel/App.tsx)
