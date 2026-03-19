# KeepPage 部署文档

## 部署结论

基于当前仓库实现，KeepPage 最稳妥的部署方式是：

1. **后端单实例部署**
2. **对象存储使用持久化本地磁盘目录**
3. **前端与 API 同域部署，通过 `/api` 反向代理访问 API**
4. **浏览器插件通过 Side Panel 配置对外可访问的 API 地址**

这是当前版本最贴近现状的部署方案，原因如下：

- API 目前只有 `localfs` 对象存储，没有 S3/R2/OSS 等远程对象存储实现
- API 当前没有显式开启 CORS，Web 更适合同域访问
- API 当前没有单独的 JS 构建产物，生产启动仍依赖 `tsx`

## 适用范围

本文覆盖：

- 前端部署：`apps/web`
- 后端部署：`apps/api`
- 浏览器插件分发：`apps/extension`

---

## 一、部署前准备

### 基础依赖

- Node.js 和 npm
- 一台可持久化磁盘的服务器
- 可选：Postgres 数据库
- 可选：Nginx 或其他反向代理
- 可选：HTTPS 域名

### 仓库准备

在服务器上拉取代码后执行：

```bash
npm install
```

> 注意：当前 API 的 `start` 命令依赖 `tsx`，而 `tsx` 位于 `devDependencies`。这意味着当前版本的后端部署不能直接只装生产依赖。

### 当前版本的部署限制

#### 1. API 更适合单实例

当前对象文件写入本地目录：

- 默认目录：`apps/api/data/object-storage/`

如果启多个 API 实例，但不共享同一块持久化存储，会出现：

- 上传到了 A 机器
- 查询或读取落到了 B 机器
- 最终对象找不到

因此当前推荐：

- 单实例部署
- 或者所有实例挂载同一个共享存储目录

#### 2. Web 推荐同域代理

前端默认读取 `VITE_API_BASE_URL`，缺省值为 `/api`。

由于当前 API 没有启用 CORS，最稳妥的方式是：

- Web 页面和 API 使用同一域名
- 浏览器访问 `/api/*`
- 反向代理转发到 API 根路径

#### 3. 扩展依赖对外可访问的 API 地址

扩展不是通过构建时环境变量拿 API 地址，而是运行时保存在 `chrome.storage.local` 的 `apiBaseUrl`。

如果是远程部署：

- API 服务必须能被用户浏览器直接访问
- `API_PUBLIC_BASE_URL` 必须设置成该对外地址

否则 API 返回的 `uploadUrl` 可能仍然指向 `127.0.0.1`，导致扩展上传失败。

---

## 二、后端部署

### 2.1 推荐配置

生产环境建议至少使用：

- `STORAGE_DRIVER=postgres`
- `OBJECT_STORAGE_DRIVER=localfs`
- 持久化 `OBJECT_STORAGE_ROOT`
- 设置 `API_PUBLIC_BASE_URL`

### 环境变量示例

```bash
export NODE_ENV=production
export API_HOST=127.0.0.1
export API_PORT=8787
export API_PUBLIC_BASE_URL='https://keeppage.example.com/api'
export STORAGE_DRIVER=postgres
export OBJECT_STORAGE_DRIVER=localfs
export OBJECT_STORAGE_ROOT='./data/object-storage'
export UPLOAD_BODY_LIMIT_MB=64
export DEBUG_MODE=false
export LOG_LEVEL=info
export DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/keeppage'
```

### 变量说明

| 变量名 | 是否建议配置 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | 建议 | 建议设为 `production` |
| `API_HOST` | 建议 | 建议监听本机地址，由反向代理对外暴露 |
| `API_PORT` | 建议 | API 端口 |
| `API_PUBLIC_BASE_URL` | **必填** | 扩展上传和远程访问必须依赖它生成正确的上传地址 |
| `STORAGE_DRIVER` | **必填** | 推荐 `postgres` |
| `OBJECT_STORAGE_DRIVER` | 必填 | 当前只能是 `localfs` |
| `OBJECT_STORAGE_ROOT` | 建议 | 显式指定对象存储目录，避免工作目录变化造成路径偏移 |
| `UPLOAD_BODY_LIMIT_MB` | 视情况 | 根据归档大小调整 |
| `DEBUG_MODE` | 可选 | 临时排障时可设为 `true`，会输出更详细请求日志 |
| `LOG_LEVEL` | 建议 | 推荐 `info` 或 `warn` |
| `DATABASE_URL` | `postgres` 模式必填 | Postgres 连接串 |

### 2.2 初始化数据库

```bash
npm run db:init -w @keeppage/api
```

这个命令会：

1. 检查目标数据库是否存在
2. 不存在则自动创建数据库
3. 执行 `packages/db/migrations/` 下的 SQL migration

### 2.3 启动 API

```bash
npm run start -w @keeppage/api
```

推荐使用进程管理器托管，例如 PM2、Systemd 或容器编排系统。

### 最小验收命令

```bash
curl -sS https://keeppage.example.com/api/health
```

返回 `status=ok` 后，再继续联调前端和插件。

### 2.4 持久化目录建议

建议把对象目录挂到持久化位置，例如：

```bash
export OBJECT_STORAGE_ROOT='/srv/keeppage/object-storage'
```

这样可以避免：

- 进程重启后目录丢失
- 发布代码时误删对象文件
- 工作目录变化导致对象写入错位

### 2.5 生产注意事项

- 当前 API 没有内建 CORS，Web 不建议跨域直连
- 当前对象存储不是云存储，暂不适合无状态多实例横向扩容
- 当前上传地址依赖 `API_PUBLIC_BASE_URL`，该值错误会直接影响扩展上传

---

## 三、前端部署

### 3.1 构建前端

```bash
npm run build -w @keeppage/web
```

构建产物位于：`apps/web/dist`

### 3.2 构建时环境变量

前端主要关注一个变量：

- `VITE_API_BASE_URL`

### 推荐配置

推荐保持默认值 `/api`，并通过同域代理访问后端：

```bash
export VITE_API_BASE_URL='/api'
npm run build -w @keeppage/web
```

### 不推荐但可选的方式

你也可以把它设置成绝对地址，例如：

```bash
export VITE_API_BASE_URL='https://api.example.com'
```

但当前 API 没有显式开启 CORS，这种方式通常需要你额外补齐跨域支持。

### 3.3 静态站点部署

把 `apps/web/dist` 发布到任意静态资源服务即可，例如：

- Nginx
- CDN + 对象存储
- Vercel / Netlify 一类静态托管

如果使用静态托管平台，仍建议在网关层把 `/api` 代理回 KeepPage API。

### 3.4 Nginx 同域代理示例

```nginx
server {
  listen 80;
  server_name keeppage.example.com;

  root /srv/keeppage/web/dist;
  index index.html;
  client_max_body_size 64m;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

这个配置有两个关键点：

1. Web 仍然访问 `/api/...`
2. Nginx 把 `/api/...` 转发到 API 的根路径 `/...`
3. `client_max_body_size` 需要不小于 `UPLOAD_BODY_LIMIT_MB`，否则浏览器会先收到 Nginx 的 `413 Request Entity Too Large`

这样前端、插件和 API 可以共享同一个公网地址前缀。

---

## 四、浏览器插件部署与分发

### 4.1 构建插件

```bash
npm run build -w @keeppage/extension
```

如果要生成便于分发的压缩包：

```bash
npm run zip -w @keeppage/extension
```

### 4.2 内部测试分发

最简单的内部测试方式：

1. 执行构建命令
2. 把 WXT 生成的已解压目录发给测试同学
3. 在 `chrome://extensions` 中开启开发者模式
4. 选择“加载已解压的扩展程序”完成安装

### 4.3 运行时配置

插件当前不依赖构建时注入 API 地址，而是由用户在 Side Panel 中填写：

- `API Base URL`

生产环境推荐填写：

```plaintext
https://keeppage.example.com/api
```

这要求后端同时满足：

- `API_PUBLIC_BASE_URL='https://keeppage.example.com/api'`
- 用户浏览器能直接访问该地址

### 4.4 发布前检查

发布插件前至少检查：

1. `保存当前页` 能成功创建本地任务
2. `测试连接` 返回正常
3. 任务能从 `upload_pending` 进入 `synced`
4. Web 端能看到新增归档
5. Web 端能打开对应版本的归档预览

---

## 五、推荐上线顺序

1. 先部署 Postgres
2. 部署 API，并确认 `/health` 正常
3. 配置对象存储持久化目录
4. 配置同域反向代理
5. 构建并发布 Web 静态资源
6. 在真实浏览器中安装插件
7. 在插件 Side Panel 中填写正式 API 地址
8. 手工保存一条网页，确认完整闭环

---

## 六、上线验收清单

### 后端验收

- `GET /api/health` 正常
- `storage` 显示为预期驱动
- 本地对象目录可写
- Postgres 表结构初始化成功

### 前端验收

- 首页能正常打开
- 列表查询返回真实数据
- 详情页能切换版本
- 预览 iframe 能打开归档主档

### 插件验收

- 能加载扩展
- 能打开 Side Panel
- 能保存当前页
- 能看到质量评分和失败原因
- 能完成同步并在 Web 端看到结果

---

## 七、常见部署问题

### 1. 插件连接正常，但上传失败

通常是 `API_PUBLIC_BASE_URL` 配置错误。请重点检查：

- 返回给插件的 `uploadUrl` 是否是公网可访问地址
- 是否误返回了 `127.0.0.1` 或内网地址
- 反向代理是否转发了 `PUT /uploads/*`
- Nginx / 网关的请求体限制是否小于 `UPLOAD_BODY_LIMIT_MB`

当前扩展已经支持分片上传，能规避一部分代理默认的小体积限制；但如果网关限制设置得过低，仍建议显式调大到至少 `16m` 以上。

### 2. Web 能打开，但看不到真实数据

通常是前端没有正确代理到 API。请重点检查：

- `VITE_API_BASE_URL` 是否正确
- 是否已配置 `/api` 反向代理
- `/api/bookmarks` 是否能在浏览器直接访问

### 3. 重启服务后归档文件丢失

通常是对象目录没有挂持久化磁盘，或者目录跟随临时工作目录变化。建议显式设置：

```bash
export OBJECT_STORAGE_ROOT='/srv/keeppage/object-storage'
```

### 4. 生产环境只安装了生产依赖，API 启不来

当前是已知约束。原因是 API 的启动命令依赖 `tsx`。如果暂不改造构建链路，请保留开发依赖安装。

---

## 八、后续可优化项

如果后续要把部署方案做得更完整，建议优先补以下能力：

1. API 增加正式 `build` 产物，摆脱运行时 `tsx`
2. API 增加 CORS 配置，支持跨域 Web 部署
3. 对象存储切换到 S3/R2/OSS/MinIO 兼容实现
4. 增加 Dockerfile、Compose 和基础 IaC
5. 增加插件正式商店发布流程文档

> 可补充信息：若你准备采用 Docker、Systemd、PM2、Nginx Ingress 或云厂商对象存储，我可以继续按目标环境补一版可直接执行的部署手册。
