# KeepPage 使用文档

## 文档范围

本文覆盖 KeepPage 当前仓库中的三个可运行部分：

- 前端：`apps/web`
- 后端：`apps/api`
- 浏览器插件：`apps/extension`

KeepPage 当前是一个 **archive-first** 的网页收藏系统：先在浏览器本地生成归档，再异步同步到后端，最后在 Web 端查看、搜索和校验归档结果。

## 系统组成

| 模块 | 目录 | 主要职责 |
| --- | --- | --- |
| 前端 | `apps/web` | 展示归档列表、搜索筛选、查看详情、切换版本、预览归档 |
| 后端 | `apps/api` | 提供归档初始化、上传完成、书签列表/详情、对象读取接口 |
| 浏览器插件 | `apps/extension` | 抓取当前页面、生成本地归档、写入本地队列、异步同步到后端 |

## 快速开始

### 前置条件

- 已安装 Node.js 和 npm
- 已在仓库根目录执行过依赖安装
- 若要体验完整同步链路，建议准备一个可用的 Postgres
- 浏览器建议使用 Chrome，并开启扩展开发者模式

### 安装依赖

```bash
npm install
```

### 最小可用启动顺序

1. 启动后端
2. 启动前端
3. 启动或构建浏览器插件
4. 在插件 Side Panel 中填写 API 地址并测试连接
5. 保存当前页面，确认任务进入同步队列
6. 在 Web 端查看归档列表和详情

### 本地联调推荐命令

```bash
npm run dev:api
npm run dev:web
npm run dev:extension
```

如果需要用 Postgres 跑完整同步链路：

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/keeppage'
npm run db:init -w @keeppage/api
npm run start -w @keeppage/api
```

---

## 1. 前端

### 功能说明

前端是 KeepPage 的管理台，当前支持：

- 归档列表浏览
- 关键词搜索
- 质量等级筛选
- 统计概览
- 书签详情查看
- 版本切换
- iframe 预览归档 HTML
- 下载归档 HTML

### 开发启动

```bash
npm run dev -w @keeppage/web
```

默认访问地址：`http://127.0.0.1:5173`

开发态下，Vite 会把 `/api/*` 代理到本地 API：

- 默认代理目标：`http://127.0.0.1:8787`
- 可通过 `KEEPPAGE_API_PROXY_TARGET` 覆盖

示例：

```bash
export KEEPPAGE_API_PROXY_TARGET='http://127.0.0.1:8787'
npm run dev -w @keeppage/web
```

### 生产访问地址配置

前端运行时会读取：

- `VITE_API_BASE_URL`

默认值是 `/api`。这意味着 **最推荐的生产部署方式是前后端同域，通过反向代理把 `/api` 转发到 API 服务**。

如果直接把 `VITE_API_BASE_URL` 配成跨域绝对地址，当前 API 还没有显式开启 CORS，浏览器请求可能失败。

### 使用方式

1. 打开首页后，先查看归档列表和统计区块
2. 使用搜索框按标题、URL、域名、备注或标签检索
3. 使用质量筛选查看高/中/低质量归档
4. 点击卡片进入详情页
5. 在详情页切换版本，查看质量诊断与归档预览
6. 必要时下载归档 HTML 进行本地核验

### 常见现象

- 如果 API 不可用，前端会退回到 mock 数据源
- 如果对象文件不存在，详情页会展示缺失状态，而不是直接白屏
- 如果要访问真实数据，请优先确认 `/health`、`/bookmarks` 和 `/objects/*` 都可用

---

## 2. 后端

### 功能说明

后端当前提供以下核心能力：

- 健康检查：`GET /health`
- 捕获初始化：`POST /captures/init`
- 捕获完成：`POST /captures/complete`
- 对象上传：`PUT /uploads/:encodedObjectKey`
- 对象读取：`GET /objects/:encodedObjectKey`
- 书签列表：`GET /bookmarks`
- 书签详情：`GET /bookmarks/:bookmarkId`

### 启动方式

开发模式：

```bash
npm run dev -w @keeppage/api
```

普通启动：

```bash
npm run start -w @keeppage/api
```

默认监听：`127.0.0.1:8787`

### 存储模式

后端支持两种仓储驱动：

| 驱动 | 配置 | 适用场景 |
| --- | --- | --- |
| 内存 | `STORAGE_DRIVER=memory` | 快速联调、接口测试 |
| Postgres | `STORAGE_DRIVER=postgres` | 本地完整链路、长期数据保留 |

默认是内存模式。

### Postgres 初始化

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/keeppage'
npm run db:init -w @keeppage/api
npm run start -w @keeppage/api
```

### 对象存储说明

当前对象存储仅支持本地文件系统：

- 驱动：`OBJECT_STORAGE_DRIVER=localfs`
- 默认目录：`./data/object-storage`

通过 `npm run start -w @keeppage/api` 或 `npm run dev -w @keeppage/api` 启动时，这个目录会落在 `apps/api/data/object-storage/`。

### 主要环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `API_HOST` | `127.0.0.1` | API 监听地址 |
| `API_PORT` | `8787` | API 监听端口 |
| `API_PUBLIC_BASE_URL` | 空 | 对外可访问的 API 基础地址，用于生成上传地址 |
| `STORAGE_DRIVER` | `memory` | 仓储驱动，可选 `memory`、`postgres` |
| `OBJECT_STORAGE_DRIVER` | `localfs` | 对象存储驱动，当前仅支持 `localfs` |
| `OBJECT_STORAGE_ROOT` | `./data/object-storage` | 本地对象存储目录 |
| `UPLOAD_BODY_LIMIT_MB` | `32` | 上传体积限制，单位 MB |
| `DEBUG_MODE` | `false` | 开启后自动启用更详细的 API 调试日志 |
| `LOG_LEVEL` | `info` | Fastify 日志级别 |
| `DATABASE_URL` | 空 | 使用 Postgres 时必填 |

如果需要排查接口问题，可以直接开启：

```bash
export DEBUG_MODE=true
npm run start -w @keeppage/api
```

开启后会额外打印请求头摘要、参数、请求体摘要、响应状态和耗时；敏感头和口令字段会自动脱敏。

### 健康检查

```bash
curl -sS http://127.0.0.1:8787/health
```

返回中可看到：

- `status`
- `storage`
- `uptimeSec`
- `tables`
- `now`

### 使用建议

1. 本地联调可先用 `memory` 模式快速验证接口
2. 需要保留数据时切换到 `postgres`
3. 远程部署时务必设置 `API_PUBLIC_BASE_URL`
4. 若扩展需要访问远程 API，请保证该地址可被浏览器直接访问

---

## 3. 浏览器插件

### 功能说明

浏览器插件负责完成 archive-first 链路的前半段：

- 捕获当前页面
- 优先使用 SingleFile 生成归档 HTML
- 在 IndexedDB 中持久化本地任务队列
- 展示质量评分与失败原因
- 本地预览归档内容
- 调用 API 进行初始化、上传和完成同步

插件侧也支持“调试模式”：

- 打开扩展侧边栏
- 在“同步与默认规则”或登录页“连接设置”里勾选“开启调试模式（打印详细日志）”
- 然后查看扩展的 `service worker` 控制台，以及当前页面的 content script 控制台日志

### 启动与构建

开发：

```bash
npm run dev -w @keeppage/extension
```

生产构建：

```bash
npm run build -w @keeppage/extension
```

打包压缩包：

```bash
npm run zip -w @keeppage/extension
```

### 加载到 Chrome

1. 打开 Chrome 扩展管理页：`chrome://extensions`
2. 开启右上角“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择 WXT 生成的扩展目录

通常可直接使用 WXT 输出的 Chrome MV3 目录；如果目录名称与本地版本不一致，请以构建命令输出提示为准。

### 插件入口

当前插件支持以下入口：

- 点击扩展图标，保存当前页
- 右键菜单中的“保存到 KeepPage”
- 快捷键 `Ctrl+Shift+Y`：保存当前页
- 快捷键 `Ctrl+Shift+O`：打开 Side Panel

### Side Panel 使用方式

首次使用建议按以下顺序：

1. 打开 Side Panel
2. 设置 `API Base URL`
3. 确认默认抓取 profile
4. 点击“测试连接”确认 API 可达
5. 点击“保存当前页”生成归档任务
6. 在左侧任务列表查看状态变化
7. 在右侧查看质量诊断和本地预览

### 抓取 Profile

当前扩展界面固定使用 `complete`：

- `complete`：完整保留，适合复杂页面

其余 `standard`、`dynamic`、`lightweight` 仍保留在内部兼容逻辑中，但默认界面不再提供切换入口。

### 任务状态说明

常见状态流转如下：

`queued -> capturing -> validating -> local_ready -> upload_pending -> uploading -> uploaded -> synced`

失败时可能出现：

- `failed`：抓取阶段失败
- `upload_pending`：本地归档已生成，但同步失败，等待重试

### 本地数据存储

插件会把以下信息持久化到浏览器本地：

- 任务队列：IndexedDB
- `apiBaseUrl`：API 地址
- `captureProfilePreference`：默认抓取 profile（当前固定为 `complete`）
- `deviceId`：当前浏览器实例的设备标识

### 常用操作建议

- 看到 `upload_pending` 时，可先检查 API 地址和网络，再点击“继续同步”
- 如果页面质量不理想，可直接重试抓取，当前会继续使用 `complete`
- 如果只想检查本地归档是否成功，可直接使用“新标签预览”

---

## 推荐联调流程

### 本地内存模式

适合先确认链路是否跑通：

```bash
npm install
npm run dev:api
npm run dev:web
npm run dev:extension
```

然后：

1. 在插件中把 `API Base URL` 设为 `http://127.0.0.1:8787`
2. 点击“测试连接”
3. 保存任意网页
4. 打开 Web 管理端查看列表与详情

### 本地 Postgres 模式

适合验证持久化与对象读取：

```bash
export STORAGE_DRIVER=postgres
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/keeppage'
npm run db:init -w @keeppage/api
npm run start -w @keeppage/api
npm run dev:web
npm run dev:extension
```

---

## 常见问题

### Web 页面有内容，但不是实时数据

说明前端可能回退到了 mock 数据源。请优先检查：

- API 是否启动
- Web 的 `/api` 代理是否正确
- `GET /health`、`GET /bookmarks` 是否可访问

### 插件测试连接失败

优先检查：

- `API Base URL` 是否填写正确
- API 是否真的监听在该地址
- 如果是远程环境，是否配置了公网可访问地址

### 插件能连上 API，但同步失败

优先检查：

- `API_PUBLIC_BASE_URL` 是否正确
- 返回的 `uploadUrl` 是否可被浏览器访问
- API 进程是否对 `PUT /uploads/:encodedObjectKey` 正常响应

### Web 生产环境访问 API 失败

当前最常见原因是跨域。建议优先使用 **同域部署 + `/api` 反向代理**。

> 可补充信息：若后续需要把文档扩展为团队内部 SOP，可继续补充截图、Nginx/PM2/Systemd 示例和 Chrome 商店发布流程。
