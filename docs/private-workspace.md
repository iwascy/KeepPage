# 私密工作区（Private Workspace）

私密书签拥有一套独立于普通书签的收藏夹与标签。解锁私密模式后，Web 首页可在「普通 / 私密」两种内容模式之间切换，私密模式下的列表、筛选、收藏夹、标签、批量操作与详情编辑与普通书签一致。

## 隔离原则

- 私密收藏夹、标签只存在于 `private_*` 表，普通接口（`/folders`、`/tags`、`/workspace/bootstrap`）永远不返回它们。
- 所有私密接口都要求登录凭据 **以及** `x-keeppage-private-token` 有效（未解锁返回 `PrivateModeLocked`）。
- 扩展设备令牌（`kpd_`）可访问私密接口；API Token 不可。
- Web 不把私密列表写入持久化列表缓存；锁定或刷新页面后需要重新解锁。

## 接口契约

全部接口与普通接口同构，只是加了 `/private` 前缀，请求/响应复用 `@keeppage/domain` 中的同名 schema。

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/private/workspace/bootstrap` | – | `workspaceBootstrapResponseSchema` |
| GET | `/private/folders` | – | `folderListResponseSchema` |
| POST | `/private/folders` | `folderCreateRequestSchema` | `201` `folderSchema` |
| PATCH | `/private/folders/:folderId` | `folderUpdateRequestSchema` | `folderSchema` / `404 FolderNotFound` |
| DELETE | `/private/folders/:folderId` | – | `204` / `404 FolderNotFound` |
| GET | `/private/tags` | – | `tagListResponseSchema` |
| POST | `/private/tags` | `tagCreateRequestSchema` | `201` `tagSchema` |
| PATCH | `/private/tags/:tagId` | `tagUpdateRequestSchema` | `tagSchema` / `404 TagNotFound` |
| DELETE | `/private/tags/:tagId` | – | `204` / `404 TagNotFound` |
| GET | `/private/bookmarks` | `q, view, quality, domain, folderId, tagId, sort, limit, offset` | `bookmarkSearchResponseSchema`（条目含 `folder`、`tags`） |
| GET | `/private/bookmarks/sidebar-stats` | – | `bookmarkSidebarStatsResponseSchema` |
| GET | `/private/bookmarks/:bookmarkId` | – | `bookmarkDetailResponseSchema`（含 `folder`、`tags`） |
| PATCH | `/private/bookmarks/:bookmarkId/metadata` | `bookmarkMetadataUpdateRequestSchema` | `bookmarkSchema` / `404 PrivateBookmarkNotFound` |
| DELETE | `/private/bookmarks/:bookmarkId` | – | `204` / `404 PrivateBookmarkNotFound` |

语义与普通接口保持一致：

- `folderId` 筛选包含子收藏夹；`tagId` 筛选精确匹配。
- 关键词搜索额外匹配私密收藏夹路径与私密标签名。
- 删除收藏夹时子收藏夹上移一级，该收藏夹内的书签变为未归档；删除标签时移除所有关联。
- `metadata` 中 `folderPath` / `tags` 会按路径、名称在**私密**分类中查找或创建；`folderId` / `tagIds` 只接受当前用户的私密分类 id。

## 数据表

迁移：`apps/api-go/migrations/0018_private_taxonomy.sql`（TS 回滚后端同步：`packages/db/migrations/0012_private_taxonomy.sql`）。

- `private_folders(id, user_id, name, path, parent_id, created_at, updated_at)`，`unique(user_id, path)`
- `private_tags(id, user_id, name, color, created_at)`，`unique(user_id, name)`
- `private_bookmark_tags(bookmark_id, tag_id, created_at)`，主键 `(bookmark_id, tag_id)`
- `private_bookmarks.folder_id → private_folders(id) on delete set null`

## Web 路由

- `#/private?folder=&tag=&view=&q=&sort=&quality=`：私密内容模式下的首页列表。
- `#/private/bookmarks/:bookmarkId?version=`：私密书签详情（与普通详情同一组件，可编辑收藏夹、标签、备注、星标）。
- `#/settings/private-mode`：启用、解锁、修改密码。

## 扩展

- 侧边栏私密任务详情可设置私密收藏夹与标签（`PATCH /private/bookmarks/:id/metadata`）。
- 「移到私密模式」会把原普通书签的收藏夹路径、标签名、备注与星标带到私密书签。
