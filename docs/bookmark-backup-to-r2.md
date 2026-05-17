# KeepPage 全站书签数据备份到 R2 技术方案

## 方案结论

本方案只备份 KeepPage 的**全站书签数据**，不备份整个 Postgres 数据库文件。

备份目标是：

1. 每天自动导出全站书签领域数据
2. 将导出文件上传到 Cloudflare R2
3. 将书签版本引用的归档对象文件同步到 R2
4. 保证未来可以按用户恢复书签、文件夹、标签、版本和归档内容

该方案不是完整灾备方案，不覆盖登录态、API Token、同步游标、导入任务历史等非书签运行状态。

---

## 一、适用范围

本文覆盖：

- 生产环境 `STORAGE_DRIVER=postgres`
- 对象存储仍使用当前的 `OBJECT_STORAGE_DRIVER=localfs`
- 全站所有用户的普通书签与私密书签
- 每天一次的自动备份任务
- 备份目标为 Cloudflare R2

当前对象存储仍是本地文件目录，线上部署通常会把 `OBJECT_STORAGE_ROOT` 挂载到持久化目录，例如：

```text
/data/apps/keeppage/shared/object-storage
```

因此备份需要同时处理：

- Postgres 中的书签元数据
- 本地对象目录中的归档文件

---

## 二、备份目标与非目标

### 2.1 目标

- 导出全站用户的书签数据
- 导出普通书签和私密书签
- 导出文件夹、标签、书签版本、归档对象引用
- 同步版本引用的对象文件到 R2
- 支持按某天备份恢复书签数据
- 保留可校验的 manifest，方便确认备份是否完整

### 2.2 非目标

以下数据不进入本方案：

- 整个 Postgres 物理或逻辑 dump
- 用户密码哈希
- API Token 与 token hash
- 登录 session 或客户端状态
- `sync_ops` 同步游标
- 导入任务历史
- pending 上传记录
- 临时上传分片目录 `.uploads`

如果未来需要完整事故恢复，应另行设计数据库级备份方案。

---

## 三、备份数据范围

### 3.1 需要导出的数据库数据

建议导出以下书签相关数据：

| 数据 | 来源 | 说明 |
| --- | --- | --- |
| 用户最小信息 | `users` | 只导出 `id`、`email`、`name`，用于恢复时映射书签归属 |
| 普通书签 | `bookmarks` | 包含 URL、标题、域名、收藏、备注、文件夹引用等 |
| 普通书签版本 | `bookmark_versions` | 包含版本号、归档对象 key、质量信息、正文提取结果等 |
| 私密书签 | `private_bookmarks` | 私密空间中的书签元数据 |
| 私密书签版本 | `private_bookmark_versions` | 私密书签的版本与归档对象 key |
| 文件夹 | `folders` | 恢复书签层级结构 |
| 标签 | `tags` | 恢复标签名称和颜色 |
| 书签标签关系 | `bookmark_tags` | 恢复普通书签与标签关系 |

### 3.2 需要同步的对象文件

从导出的版本数据中收集所有对象 key：

- `htmlObjectKey`
- `readerHtmlObjectKey`
- `screenshotObjectKey`
- `thumbnailObjectKey`
- `pdfObjectKey`
- `sourceMetaJson.mediaFiles[].objectKey`

对象目录中可能还存在未被当前版本引用的历史文件。V1 只要求备份当前导出数据引用到的对象文件。

### 3.3 不同步的对象文件

- `.uploads/` 下的临时分片
- 没有被任何导出版本引用的孤儿对象
- 已删除书签对应且数据库已无引用的对象

如果希望增强历史恢复能力，可以在后续版本中将对象同步策略改为“只增不删的完整对象镜像”。

---

## 四、备份产物格式

### 4.1 R2 目录结构

建议使用以下结构：

```text
keeppage-backups/
  bookmark-exports/
    2026-05-12/
      bookmarks.ndjson.zst
      objects-manifest.ndjson.zst
      manifest.json
      restore-notes.md
  object-mirror/
    captures/
    private-captures/
```

说明：

- `bookmark-exports/` 保存每天生成的逻辑导出文件
- `object-mirror/` 保存书签版本引用的对象文件
- 每日目录使用本地部署时区日期，例如 `Asia/Shanghai` 下的 `YYYY-MM-DD`

### 4.2 `bookmarks.ndjson.zst`

推荐使用 NDJSON，并用 `zstd` 压缩。

每一行代表一个书签聚合对象，包含：

```json
{
  "kind": "bookmark",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "User Name"
  },
  "bookmark": {},
  "folder": {},
  "tags": [],
  "versions": []
}
```

私密书签使用：

```json
{
  "kind": "private-bookmark",
  "user": {},
  "bookmark": {},
  "versions": []
}
```

使用 NDJSON 的原因：

- 可以流式生成，避免一次性加载全站数据
- 单行损坏时更容易定位
- 后续恢复工具可以逐行导入

### 4.3 `objects-manifest.ndjson.zst`

每一行代表一个对象引用：

```json
{
  "objectKey": "captures/<user-id>/2026-05-12/<uuid>.html",
  "source": "bookmark_versions.html_object_key",
  "bookmarkId": "bookmark-id",
  "versionId": "version-id",
  "existsLocal": true,
  "uploadedToR2": true,
  "sizeBytes": 123456,
  "sha256": "..."
}
```

该文件用于：

- 检查备份是否缺对象
- 恢复时确认对象是否已经同步回本地
- 排查某个书签版本无法打开归档的问题

### 4.4 `manifest.json`

每日备份的摘要文件，建议包含：

```json
{
  "backupType": "bookmark-logical-export",
  "backupDate": "2026-05-12",
  "startedAt": "2026-05-12T02:00:00+08:00",
  "finishedAt": "2026-05-12T02:03:12+08:00",
  "status": "success",
  "databaseUrlHost": "postgres",
  "objectStorageRoot": "/data/apps/keeppage/shared/object-storage",
  "r2Bucket": "keeppage-backups",
  "r2Prefix": "bookmark-exports/2026-05-12/",
  "counts": {
    "users": 2,
    "bookmarks": 1200,
    "privateBookmarks": 30,
    "versions": 1500,
    "objectRefs": 1700,
    "missingObjects": 0
  },
  "checksums": {
    "bookmarks.ndjson.zst": "sha256:...",
    "objects-manifest.ndjson.zst": "sha256:..."
  }
}
```

`status` 可选值：

- `success`：所有导出文件和对象同步完成
- `warning`：导出完成，但存在缺失对象或个别对象上传失败
- `failed`：导出或上传失败，不能作为可靠恢复点

---

## 五、每日备份流程

### 5.0 当前实现

V1 已提供独立备份脚本：

```bash
npm run backup:bookmarks -w @keeppage/api
```

脚本位置：

```text
apps/api/src/scripts/backup-bookmarks-to-r2.ts
```

实现行为：

- 读取生产 `DATABASE_URL`
- 导出全站用户最小信息、文件夹、标签、普通书签、私密书签和版本数据
- 从版本字段与 `sourceMetaJson.mediaFiles` 收集对象 key
- 检查本地对象文件大小与 SHA-256
- 将对象上传到 R2 的 `object-mirror/`
- 生成并上传 `bookmarks.ndjson.zst`、`objects-manifest.ndjson.zst`、`manifest.json`、`restore-notes.md`

运行主机需要安装 `zstd`，因为导出文件会先写成 NDJSON，再压缩为 `.zst`。

### 5.1 调度方式

V1 推荐使用独立定时任务：

- `cron`
- `systemd timer`
- Jenkins 定时任务
- 独立 backup 容器

不建议把每日备份逻辑放进 API 进程内执行，避免备份耗时、R2 网络波动或压缩任务影响接口响应。

### 5.2 环境变量

备份任务至少需要：

| 变量名 | 说明 |
| --- | --- |
| `DATABASE_URL` | 连接生产 Postgres |
| `OBJECT_STORAGE_ROOT` | 本地对象存储目录 |
| `R2_ACCOUNT_ID` | Cloudflare 账号 ID |
| `R2_ENDPOINT_URL` | 可选，R2/S3 兼容 endpoint；设置后可不填 `R2_ACCOUNT_ID` |
| `R2_ACCESS_KEY_ID` | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key |
| `R2_BUCKET` | 备份 bucket |
| `R2_PREFIX` | 可选，bucket 内前缀，例如 `prod/` |
| `BACKUP_DATE` | 可选，手动指定备份日期，格式 `YYYY-MM-DD` |
| `BACKUP_TIMEZONE` | 备份日期使用的时区，建议 `Asia/Shanghai` |
| `BACKUP_INCLUDE_PRIVATE` | 是否导出私密书签，生产建议固定为 `true` |
| `BACKUP_WORK_DIR` | 可选，临时工作目录 |
| `BACKUP_ZSTD_LEVEL` | 可选，zstd 压缩等级，默认 `10` |
| `BACKUP_BATCH_SIZE` | 可选，书签分批查询大小，默认 `500` |

示例：

```bash
DATABASE_URL="postgres://keeppage:password@postgres:5432/keeppage" \
OBJECT_STORAGE_ROOT="/data/apps/keeppage/shared/object-storage" \
R2_ACCOUNT_ID="your-cloudflare-account-id" \
R2_ACCESS_KEY_ID="your-r2-access-key" \
R2_SECRET_ACCESS_KEY="your-r2-secret-key" \
R2_BUCKET="keeppage-backups" \
R2_PREFIX="prod/" \
BACKUP_TIMEZONE="Asia/Shanghai" \
npm run backup:bookmarks -w @keeppage/api
```

cron 示例：

```cron
15 2 * * * cd /data/apps/keeppage/app && /usr/bin/env bash -lc 'source /etc/keeppage/backup.env && npm run backup:bookmarks -w @keeppage/api' >> /var/log/keeppage-bookmark-backup.log 2>&1
```

### 5.3 执行步骤

每日任务按以下顺序执行：

1. 生成本次备份日期和临时工作目录
2. 检查 Postgres 可连接
3. 检查 `OBJECT_STORAGE_ROOT` 可读
4. 检查 R2 bucket 可写
5. 查询全站用户最小信息
6. 流式导出普通书签聚合数据
7. 流式导出私密书签聚合数据
8. 从版本数据收集对象 key
9. 对每个对象 key 读取本地文件大小和 checksum
10. 上传对象文件到 R2 `object-mirror/`
11. 生成 `objects-manifest.ndjson.zst`
12. 生成 `manifest.json`
13. 上传每日导出文件到 R2 `bookmark-exports/<date>/`
14. 输出备份结果日志

### 5.4 一致性策略

V1 不要求暂停 API。

原因：

- 备份只导出已完成的书签版本
- pending 上传记录不进入备份
- 版本表中的对象 key 是恢复的最终依据

需要接受的边界：

- 备份执行期间刚新增的书签可能出现在下一天备份中
- 备份执行期间刚删除的书签可能已经不在本次导出中
- 极端情况下可能出现版本记录存在但对象文件已经被删除，需通过 manifest 标记为 `warning`

如果后续需要更强一致性，可以增加：

- API 只读维护窗口
- 备份开始时间水位线
- 应用级导出锁

---

## 六、R2 同步策略

### 6.1 对象 key 映射

本地对象：

```text
${OBJECT_STORAGE_ROOT}/captures/<user-id>/<date>/<uuid>.html
```

同步到 R2：

```text
object-mirror/captures/<user-id>/<date>/<uuid>.html
```

私密对象同理：

```text
object-mirror/private-captures/<user-id>/<date>/<uuid>.html
```

### 6.2 上传策略

建议策略：

- 对象存在且大小、checksum 一致时跳过
- 对象不存在时上传
- 对象上传失败时记录到 `objects-manifest`
- 不在每日任务中删除 R2 对象

不删除远端对象可以降低误删风险。对象层允许出现孤儿文件，恢复时以 `bookmarks.ndjson.zst` 和 `objects-manifest.ndjson.zst` 为准。

### 6.3 生命周期策略

建议初始保留策略：

- `bookmark-exports/` 每日导出保留 90 天
- 每月最后一天的导出可转存或长期保留 12 个月
- `object-mirror/` 至少保留 180 天

如果 R2 成本可接受，`object-mirror/` 可以保留更久。

---

## 七、恢复流程

恢复时不使用 `pg_restore`，而是通过逻辑导入恢复书签数据。

### 7.1 恢复准备

1. 选择目标备份日期
2. 下载该日期的 `manifest.json`
3. 确认 `status` 为 `success`
4. 下载 `bookmarks.ndjson.zst`
5. 下载 `objects-manifest.ndjson.zst`

如果 `status` 为 `warning`，需要先检查缺失对象是否影响目标恢复范围。

### 7.2 恢复对象文件

根据 `objects-manifest.ndjson.zst` 中的 object key，把 R2 中的对象同步回本地：

```text
object-mirror/<objectKey> -> ${OBJECT_STORAGE_ROOT}/<objectKey>
```

恢复后检查：

- 所有 `htmlObjectKey` 都存在
- 有值的 `readerHtmlObjectKey` 都存在
- 有值的截图、缩略图、PDF、media files 都存在

### 7.3 恢复数据库记录

逻辑导入顺序建议为：

1. 按 `user.email` 查找目标用户
2. 如果用户不存在，按恢复策略创建用户或跳过该用户
3. 恢复文件夹
4. 恢复标签
5. 恢复普通书签
6. 恢复普通书签版本
7. 恢复普通书签标签关系
8. 恢复私密书签
9. 恢复私密书签版本
10. 更新书签的 `latestVersionId`

恢复时需要处理 ID 冲突：

- 恢复到空库时，可以尽量保留原 ID
- 恢复到已有库时，建议生成新 ID，并维护旧 ID 到新 ID 的映射表
- 对象 key 可以保留原值，因为对象路径本身已包含用户和日期

### 7.4 恢复校验

恢复完成后至少校验：

- 普通书签数量与导出数量一致
- 私密书签数量与导出数量一致
- 每个书签至少有一个版本
- 所有版本引用对象都能通过 API 读取
- 文件夹路径和标签关系正常
- 前端列表、详情页、归档打开流程正常

---

## 八、安全与权限

### 8.1 R2 凭据

备份任务使用独立 R2 凭据，不复用 API 运行时凭据。

建议权限：

- 允许写入 `bookmark-exports/`
- 允许写入 `object-mirror/`
- 允许读取用于校验
- 不授予 bucket 管理权限
- 不在应用日志中输出密钥

### 8.2 私密书签

私密书签本质上仍然是用户数据，备份时需要按生产数据处理：

- 默认纳入备份，避免用户误以为私密空间不受保护
- 备份文件和对象存储 bucket 需要限制访问权限
- 如果未来私密书签内容引入端到端加密，备份只保存密文和必要元数据

### 8.3 导出文件加密

如果 R2 bucket 不是严格私有，或团队中有多人具备对象读取权限，建议对每日导出文件额外加密：

- 使用 `age`
- 或使用 GPG
- 密钥不放在仓库中
- 解密密钥只保存在恢复操作人手中

---

## 九、告警与观测

每日任务需要输出结构化日志，并在以下情况告警：

- Postgres 连接失败
- R2 上传失败
- `manifest.status=failed`
- 缺失对象数量大于 0
- 当天没有生成新的 `bookmark-exports/<date>/manifest.json`
- 备份耗时明显异常
- 导出书签数量相比上一天异常下降

建议在日志中输出：

- 本次备份日期
- 普通书签数量
- 私密书签数量
- 版本数量
- 对象引用数量
- 缺失对象数量
- 上传对象数量
- 跳过对象数量
- 总耗时

---

## 十、后续迭代

V1 先实现每日全量逻辑导出。

后续可以继续增强：

1. 增量导出：只导出 `updatedAt` 或 `createdAt` 大于上次备份时间的数据
2. 应用级导出锁：减少导出期间新增或删除导致的一致性边界
3. 管理后台恢复入口：支持按日期恢复某个用户的书签
4. 对象完整镜像：R2 保留所有本地对象，增强历史恢复能力
5. 自动恢复演练：定期恢复到临时环境并校验归档可读性
6. 备份报告页面：展示最近备份状态、大小、耗时和失败原因

---

## 十一、验收标准

首次上线前需要完成一次恢复演练。

验收标准：

- 每日任务能自动生成 `manifest.json`
- `manifest.status` 为 `success`
- `bookmarks.ndjson.zst` 可以解压并逐行解析
- `objects-manifest.ndjson.zst` 中缺失对象数量为 0
- R2 中存在对应日期的导出目录
- R2 中存在导出版本引用的对象文件
- 能恢复到一个临时 Postgres 实例
- 恢复后普通书签列表和详情页可用
- 恢复后私密书签在解锁后可用
- 随机抽查归档 HTML 可以打开

只要以上条件满足，就可以认为“全站书签数据每日备份到 R2”的 V1 目标达成。
