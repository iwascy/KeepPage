# 登录会话、刷新与鉴权写入

## 2026-09-21 变更与理由

修复页面恢复登录时因网络、超时、500 或普通 403 清除凭据的问题；增加短期访问令牌和可撤销刷新会话；降低 API/插件高频访问带来的 `last_used_at` 写放大。涉及生产 Go API、Web、共享 Drizzle 表定义和部署配置。TS 回滚 API 与扩展协议兼容保留。

## 会话协议

- Web 登录/注册发送 `X-KeepPage-Session: web`，响应 JSON 保持 `{token,user}`；访问令牌默认 20 分钟，仍保存在 `localStorage`。
- 刷新令牌只通过 `HttpOnly` Cookie 下发，`SameSite=Strict`、生产 `Secure`、host-only、Path `/`，适配反向代理的 `/api` 前缀和本地开发。Cookie 不用于普通业务接口鉴权。
- `POST /auth/refresh` 和 `/auth/logout` 必须携带上述自定义头，且 Origin 必须匹配 `WEB_PUBLIC_BASE_URL`。未设置时生产仅接受 HTTPS 的同 Host 来源，开发允许 localhost/127.0.0.1/::1 的 Vite 代理。
- 部署推荐 Web 与 API 同源，不支持跨站第三方 Cookie 模式；生产必须 HTTPS。代理需保留正确 Host。不要为 Cookie 会话配置任意 Origin 的 credentialed CORS。
- 刷新会话默认从登录起 30 天绝对到期，轮换不延长此期限；过期后重新登录。
- 新令牌包含 `sid`，每次鉴权查询会话有效期和撤销状态；显式退出立即撤销整个会话，已签发访问令牌也失效。网络故障导致退出失败时保留当前状态并提示重试，不假报撤销成功。
- 旧 bearer 无 `sid`，保持原始有效期和无服务端单会话撤销的兼容行为。重新登录升级到新机制；旧版插件/API 客户端未发送 opt-in 头时仍按 `AUTH_TOKEN_TTL_DAYS` 签发。设备 token 的撤销/有效期不变。
- Web 使用统一请求入口（含私密和归档内容）。距到期 30 秒内按需刷新；服务端 `TokenExpired` 最多刷新后重试一次。私密锁定、密码错误和 403 不触发账号退出。
- 同一标签页合并刷新请求，支持 Web Locks 的浏览器跨标签页串行化刷新/登录/退出；存储事件同步退出和账户切换。刷新完成前重新核对会话身份，避免已退出或切换账号后恢复旧登录。
- 初始化恢复失败只在明确的账号认证 401 下清理 token；网络、5xx、403 显示重试页面。失败登录提交也不删除先前的凭据。

## 轮换、威胁模型与边界

防御刷新令牌重放、CSRF、退出与刷新竞态、数据库凭据泄露后的直接令牌使用，以及普通权限错误导致的误退出。

刷新令牌由随机会话 UUID、代数和带 `refresh:` 域隔离的 HMAC-SHA256 签名组成。数据库只存当前/前一代 SHA-256 哈希和代数，不存原始凭据。HMAC 让同一代凭据可确定性重建，便于对并发重试返回相同后继 Cookie。先验证签名再访问轮换状态，伪造令牌不能吊销他人的会话。

Postgres 在事务内 `SELECT ... FOR UPDATE` 锁定会话，memory 使用互斥锁。前一代在 30 秒内重试返回同一后继，不重复增加代数；超出窗口或更早代的已签名令牌重放会撤销整组会话。这个有限窗口兼容并发与短暂丢包，也意味着被盗前一代在窗口内仍可使用。严重网络中断导致轮换响应丢失且超过窗口时，可能需要重新登录。

访问令牌本地存储仍受 XSS 影响；HttpOnly 限制脚本直接读取刷新凭据，不防止已在同源执行的恶意脚本代用户操作。已有旧式 bearer 保留原安全边界。轮换签名与普通 token 共用稳定 `AUTH_TOKEN_SECRET`、使用不同签名输入域，轮换密钥会让所有现存签名失效。没有引入鉴权结果缓存，避免撤销延迟。

刷新会话表由 Go migration `0017` 管理，Drizzle 同步声明。过期记录在新 Web 会话创建时清理；没有新登录时可能暂留，鉴权仍严格检查到期时间。memory 模式重启会丢失新会话，生产应使用 Postgres。

## 配置与发布

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `AUTH_ACCESS_TOKEN_TTL_MINUTES` | 20 | Web 访问令牌时长 |
| `AUTH_REFRESH_TOKEN_TTL_DAYS` | 30 | Web 刷新会话绝对时长 |
| `AUTH_TOKEN_TTL_DAYS` | 30 | 兼容旧客户端的 token 时长 |
| `WEB_PUBLIC_BASE_URL` | 空 | 建议显式填写 Web 的完整 origin，如 `https://keeppage.example` |

先运行正常数据库迁移，再更新 Go API 与 Web。容器启动流程已自动迁移。回滚 TS API 时需重新登录，TS 不支持新 `sid` 会话的轮换与撤销；不要将回滚模式视为新安全机制的延续。

## 使用时间节流

API/设备记录增加读取 `last_used_at`。距上次写入不足 5 分钟时，鉴权服务不发起更新；超过窗口由数据库条件 UPDATE 再次判定，避免多个实例同时写入。每次仍读取 token/hash/作用域/撤销/过期状态。最近使用时间精度为 5 分钟；写入失败不影响原有鉴权结果，下一次请求可重试。

## 验证

```sh
npm run typecheck
npm run build -w @keeppage/web
node --experimental-strip-types --test apps/web/src/api/session-transport.test.ts
cd apps/api-go
go test -race ./internal/httpapi ./internal/repository
KEEPPAGE_AUTH_TEST_DATABASE_URL='postgresql://.../disposable_test_db' go test -race ./internal/repository -run TestRefreshStoresAndUsageThrottling
```

Postgres 集成测试只能使用独立可丢弃测试库，不复用线上 `DATABASE_URL`。测试覆盖 CSRF/安全 Cookie、并发轮换、重放撤销、绝对到期、退出后 access/refresh 失效、兼容旧 bearer、断网/500/403 不清除登录、单次重试、退出竞态和 5 分钟使用时间写入。

浏览器 smoke：隔离账号注册/登录、刷新页面恢复、短访问期限触发静默刷新、两个标签页同时刷新、断网/500 后重试、普通 403 保留账号、退出后页面与旧 bearer 失效；截图只放 ignored `output/`，不作为设计规范。
