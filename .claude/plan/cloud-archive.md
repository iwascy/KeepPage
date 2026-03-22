# 云端存档功能规划

## 功能概述

用户无需浏览器扩展，直接在 Web UI 输入 URL，由服务端使用 Puppeteer headless browser 抓取网页全量内容，异步生成 archive.html 存档。

## 架构决策

- **抓取方案**：Puppeteer headless Chrome，全量抓取页面渲染后的完整 HTML
- **异步机制**：提交后立即返回任务 ID，后台异步执行，前端轮询状态
- **UI 入口**：在现有书签列表页顶部添加「云端存档」按钮，弹出 Modal

---

## 实施计划

### Phase 1：Domain 层 — Schema 定义

**文件**：`packages/domain/src/cloud-archive.ts`

新增 Zod schema：

```typescript
// 任务状态枚举
cloudArchiveStatusValues = ["queued", "fetching", "processing", "completed", "failed"]

// 提交请求
cloudArchiveRequestSchema = {
  url: z.url(),                              // 必填
  title: z.string().max(500).optional(),     // 可选，留空则从页面提取
  folderId: z.string().optional(),           // 可选
  tagIds: z.array(z.string()).max(100).optional(), // 可选
}

// 提交响应
cloudArchiveResponseSchema = {
  taskId: z.string(),
  status: cloudArchiveStatusSchema,
}

// 任务状态查询响应
cloudArchiveTaskSchema = {
  taskId: z.string(),
  status: cloudArchiveStatusSchema,
  url: z.string(),
  title: z.string().optional(),
  bookmarkId: z.string().optional(),     // 完成后填入
  versionId: z.string().optional(),      // 完成后填入
  errorMessage: z.string().optional(),   // 失败时填入
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}
```

**文件**：`packages/domain/src/index.ts` — 新增导出

### Phase 2：后端 API 路由

**文件**：`apps/api/src/routes/cloud-archive.ts`

两个路由：

1. `POST /cloud-archive` — 提交云端存档任务
   - 认证：`authService.requireUser(request)`
   - 验证请求体
   - 创建任务记录（内存 Map 存储）
   - 启动后台抓取（不阻塞请求）
   - 返回 `{ taskId, status: "queued" }`

2. `GET /cloud-archive/:taskId` — 查询任务状态
   - 认证：`authService.requireUser(request)`
   - 返回任务当前状态

**文件**：`apps/api/src/routes/index.ts` — 注册新路由

### Phase 3：服务端抓取引擎

**文件**：`apps/api/src/lib/cloud-archive-worker.ts`

核心逻辑：

1. 动态 `import("puppeteer")` — Puppeteer 作为可选依赖
2. 启动 headless browser，导航到目标 URL
3. 等待页面加载完成（`networkidle0` 或 `domcontentloaded` + 超时）
4. 获取完整 HTML（`page.content()`）
5. 调用 `ensureArchiveBaseHref()` 重写相对路径
6. 计算 SHA256 hash
7. 存入 object storage
8. 提取基础页面信号（文本长度、图片数量等）做质量评估
9. 调用 `repository.completeCapture()` 或等价方法创建 bookmark + version
10. 更新任务状态

配置项（`apps/api/src/config.ts` 新增）：
```
CLOUD_ARCHIVE_ENABLED: booleanFlagSchema  // 默认 false
CLOUD_ARCHIVE_TIMEOUT_MS: z.coerce.number().default(60000)
CLOUD_ARCHIVE_MAX_CONCURRENT: z.coerce.number().default(3)
```

### Phase 4：任务管理器

**文件**：`apps/api/src/lib/cloud-archive-manager.ts`

- 内存中的任务队列（Map<taskId, CloudArchiveTask>）
- 并发控制（最大同时抓取数）
- 任务创建、状态查询、错误处理
- 后续可扩展为持久化队列

### Phase 5：前端 API 层

**文件**：`apps/web/src/api.ts` — 新增函数

```typescript
export async function submitCloudArchive(input, token): Promise<CloudArchiveResponse>
export async function fetchCloudArchiveTask(taskId, token): Promise<CloudArchiveTask>
```

### Phase 6：前端 UI

**修改文件**：`apps/web/src/App.tsx`

1. **新增状态类型**：
   - `ManagerDialogState` 增加 `{ kind: "cloud-archive" }`
   - 新增 `CloudArchiveModalState` 管理表单和轮询

2. **列表页顶部按钮**：
   - 在现有操作栏（搜索框旁边或导入按钮附近）添加「云端存档」按钮
   - 样式与现有「导入书签」按钮保持一致

3. **Modal 对话框**：
   - URL 输入框（必填，支持粘贴）
   - 标题输入框（可选）
   - 文件夹下拉选择器（复用现有 folders 数据）
   - 标签多选（复用现有 tags 数据）
   - 「开始存档」提交按钮

4. **状态展示**：
   - 提交后 Modal 切换为进度视图
   - 显示当前状态：排队中 → 正在抓取 → 处理中 → 完成/失败
   - 完成后显示成功信息 + 「查看书签」链接
   - 失败后显示错误信息 + 「重试」按钮
   - 轮询间隔：2 秒

---

## 依赖变更

**`apps/api/package.json`** 新增：
```json
"puppeteer": "^24.x"  // 或 puppeteer-core + 独立 chromium
```

考虑使用 `puppeteer-core` + `@puppeteer/browsers` 以减小安装体积，或通过环境变量 `PUPPETEER_EXECUTABLE_PATH` 指向系统已安装的 Chrome。

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 新增 | `packages/domain/src/cloud-archive.ts` | Zod schema 定义 |
| 修改 | `packages/domain/src/index.ts` | 导出新 schema |
| 新增 | `apps/api/src/lib/cloud-archive-worker.ts` | Puppeteer 抓取逻辑 |
| 新增 | `apps/api/src/lib/cloud-archive-manager.ts` | 任务队列管理 |
| 新增 | `apps/api/src/routes/cloud-archive.ts` | API 路由 |
| 修改 | `apps/api/src/routes/index.ts` | 注册路由 |
| 修改 | `apps/api/src/config.ts` | 新增配置项 |
| 修改 | `apps/api/src/server.ts` | 传递 manager 给路由 |
| 修改 | `apps/api/package.json` | 添加 puppeteer 依赖 |
| 修改 | `apps/web/src/api.ts` | 新增 API 调用函数 |
| 修改 | `apps/web/src/App.tsx` | 云端存档 UI |

---

## 实施顺序

1. Domain schema（无依赖）
2. Config 新增配置项
3. Cloud archive worker + manager（后端核心）
4. API 路由 + 注册
5. 前端 API 函数
6. 前端 UI（Modal + 轮询）
7. 安装 puppeteer 依赖 + 构建验证
