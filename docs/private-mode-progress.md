# KeepPage 私密模式实现进度

## 文档目的

记录 `docs/private-mode-prd.md` 的实际开发进展，避免后续开发时只看到 PRD、看不到当前代码状态。

## 当前结论

截至 `2026-05-26`，私密模式已从早期 **V1：本机私密** 推进到 **password-gated 私密同步链路**：

- 扩展已支持右键“保存到 KP 私密模式”，并会在打开 Side Panel 时切到对应保存模式。
- API 已具备私密模式密码设置 / 解锁 / 锁定状态、私密 captures、私密 bookmarks 独立路由。
- `packages/db` 已具备 `private_mode_configs`、`private_capture_uploads`、`private_bookmarks`、`private_bookmark_versions` 独立表。
- Web 已具备左下角设置入口、锁定态 / 解锁态、私密列表、私密详情和私密预览。
- 普通列表、普通搜索、普通统计仍走普通表和普通接口，不混排私密内容。

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

### 5. Web 私密工作区

Web 工作台已从最小提示推进到可用私密工作区：

- 左下角“设置”中进入私密模式
- 设置入口展示当前状态：未启用 / 已锁定 / 已进入
- 支持首次设置私密密码
- 支持输入私密密码后查看私密列表
- 支持私密详情、版本切换和归档预览
- 私密 token 只保存在当前页面内存中，刷新后需要重新输入密码

对应文件：

- [apps/web/src/App.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/web/src/App.tsx)
- [apps/web/src/features/private/index.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/web/src/features/private/index.tsx)
- [apps/web/src/app/app-shell.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/web/src/app/app-shell.tsx)
- [apps/web/src/styles/private.css](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/web/src/styles/private.css)

### 6. 服务端与数据库私密链路

已补齐服务端 password-gated 私密模式主链路：

- `GET /private-mode/status`
- `POST /private-mode/setup`
- `POST /private-mode/unlock`
- `POST /private-mode/lock`
- `POST /private/captures/init`
- `POST /private/captures/complete`
- `GET /private/bookmarks`
- `GET /private/bookmarks/:bookmarkId`

私密对象统一使用 `private-captures/` 前缀，读取和写入都会校验登录账号与私密 token。

对应文件：

- [apps/api/src/routes/private-mode.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/api/src/routes/private-mode.ts)
- [apps/api/src/routes/private-captures.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/api/src/routes/private-captures.ts)
- [apps/api/src/routes/private-bookmarks.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/api/src/routes/private-bookmarks.ts)
- [packages/db/migrations/0008_private_mode_v1.sql](/Users/cyan/.codex/worktrees/6422/KeepPage/packages/db/migrations/0008_private_mode_v1.sql)

### 7. 扩展版本与构建

已按仓库要求处理扩展产物：

- 版本已升到 `0.1.42`
- 已重新执行扩展构建

对应文件：

- [apps/extension/package.json](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/package.json)
- [apps/extension/wxt.config.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/wxt.config.ts)

## 已验证

已完成以下验证：

- `npm install`
- `npm run typecheck`
- `npm run build -w @keeppage/extension`
- `npm run build -w @keeppage/web`

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

### 仍需真实联调 / 增强

- 真实 Chrome 手工场景的右键私密保存、解锁、同步、Web 查看回归记录仍需补齐。
- 私密模式目前是“默认隐藏 + 二次密码进入 + 独立链路”，不是端到端加密保险箱。
- 密码哈希使用服务端 `scrypt`，不是 PRD 早期提到的 `Argon2id`。
- 跨设备同步私密链路已经有服务端和扩展协议骨架，但还需要真实浏览器端回归确认。
- 私密密码重置 / 恢复流程仍未设计完成。

## 当前已知设计折中

这次实现是“先做可运行 V1”的版本，存在几个明确折中：

1. 早期本机私密曾使用 `PBKDF2`；当前服务端私密密码使用 `scrypt`，还没切到 PRD 早期建议的 `Argon2id`。
2. 私密内容本期按 PRD v0.2 定位为产品层访问控制，不做端到端内容加密。
3. Web 私密 token 只放在当前页面内存中，刷新后默认锁定。
4. 扩展私密 token 使用 `chrome.storage.session`，浏览器会话结束后默认丢失。

## 推荐下一步

建议下一次开发按下面顺序继续：

1. 跑真实 Chrome 手工联调：
   - 右键“保存到 KP 私密模式”
   - 未启用 / 已锁定 / 已解锁三种状态
   - 私密 capture init -> upload -> complete
   - Web 私密列表 / 详情 / 预览
2. 补私密密码重置或恢复流程的产品决策。
3. 继续收敛私密日志审查，避免调试日志泄漏敏感标题、URL 或正文片段。
4. 根据真实样本继续打磨失败恢复、低质量提示和站点规则。

## 快速判断当前代码状态

如果下次打开仓库想快速确认状态，可以先看这些文件：

- [docs/private-mode-prd.md](/Users/cyan/.codex/worktrees/6422/KeepPage/docs/private-mode-prd.md)
- [docs/private-mode-progress.md](/Users/cyan/.codex/worktrees/6422/KeepPage/docs/private-mode-progress.md)
- [apps/extension/src/lib/private-vault.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/private-vault.ts)
- [apps/extension/src/lib/capture-pipeline.ts](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/src/lib/capture-pipeline.ts)
- [apps/extension/entrypoints/sidepanel/App.tsx](/Users/cyan/.codex/worktrees/6422/KeepPage/apps/extension/entrypoints/sidepanel/App.tsx)
