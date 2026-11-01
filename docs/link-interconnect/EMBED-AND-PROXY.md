# link-interconnect M4 + M5：session.embed v2 与 models.proxy

> 目标读者：维护 LINK 内核插件的开发者（Lead 负责把两个子系统接进 `src/index.ts`）。
> 冻结点 = `plugins/dsh-link-interconnect/src/protocol/types.ts`（FROZEN）：`ROUTES` / `SCOPES` / `CAPS` / `ERROR_CODES` / `LIMITS` / `Subsystem` 全部来自那里，本页不重复定义、冲突以 types.ts 为准。
> 实现（本页全部读数对应）：`src/bind/embed.ts`、`src/bind/proxy.ts`、`test/embed.test.mjs`、`test/proxy.test.mjs`、`scripts/link-interconnect-edge-check.mjs`。

两条能力都是 **LINK→软件** 方向：软件（peer）调用 LINK 的 `/link/v1/*`。两个模块都不 import `@deepseek-ai/*`（只有 `src/index.ts` 允许），可以脱离 app / kernel / cordis，用 `tsx` 直接单测。

---

## 一、M4 session.embed v2（origin 鉴权的嵌入窗口）

v1 的 `/embed?mode=` 没有鉴权，任何人拿到 URL 就能加载。v2 把「谁可以嵌入 LINK 会话窗口」收敛为**一个 10 分钟、aud=单一 origin 的 token + 浏览器 CSP frame-ancestors 双重约束**。

### 1. 路由

| 方法 | 路径 | 行为 |
|---|---|---|
| POST | `ROUTES.embedToken` = `/link/v1/embed/token` | `{sessionId, mode, origin}` → `200 {token, expiresAt, url}` |
| GET | `ROUTES.embedSession` = `/link/v1/embed/session?token=…&nonce=…` | 校验 token → 自包含 HTML 文档；失败 `401 link/unauthorized` |

### 2. mint（POST embed/token）

- `mode` ∈ `sidebar` | `full`，其它值 `400 link/bad-request`；
- `sessionId` 必填、1–128 个 URL 安全字符（`[A-Za-z0-9._:@/-]`）；
- `origin` 必须是**恰好一个** `http(s)` origin：不能带 path/query/fragment/userinfo，不能含 `*`；`http:` 仅允许回环（`127.0.0.0/8`、`localhost`、`::1`），其它主机必须 `https:`。`origin.origin` 归一化后进入 token audience；
- token = `core.tokens.mint({ sub: 'session:'+sessionId, aud: origin, scope: ['embed.session'], ttlMs: LIMITS.embedTokenMs })`，即 compact JWS(EdDSA)、10 分钟、`jti` 由 token service 生成；
- `url = ROUTES.embedSession + '?token=' + encodeURIComponent(token) + '&nonce=' + nonce`，nonce 为 16 字节 base64url（22 字符），随 mint 记账；
- mint 记账（sessionId / mode / origin / nonce / expiresAt，**不含 token**）落盘 `<core.dir>/embed-sessions.json`，重启后仍能给出同一 session/mode（过期即清）。
- 响应体**只有** `{token, expiresAt, url}` 三个字段；token 只出现这一次，不写日志、不进 HTML。

### 3. 打开会话（GET embed/session）

顺序固定：token query 必须非空 → 请求头必须有 `Origin` → `core.tokens.verify(token, {aud: requestOrigin, scope: 'embed.session'})` → nonce 必须与 mint 记账一致。任一步失败都是 `401 link/unauthorized`（不把 403 之类的细节回给调用方）。因此：

- 无 token → 401；
- 无 `Origin` 头 → 401（token 只对 mint 时那一个 origin 有效）；
- 其它 origin、篡改 token、撤销后的 jti → 401，且**不会写出任何 HTML 字节**；
- 撤销 = `core.tokens.revoke(jti)`，同一 URL 重载立即 401（jti 黑名单持久化）。

### 4. 文档内容（byte 全在模块里）

- 自包含：内联 style + 内联 script，无 `<script src>`、无外部 stylesheet/图片、无 `fetch`/`XMLHttpRequest`；token 不回显进 HTML；
- `window.parent === window` 时只写一句「未处于 frame 中，拒绝启动」，**在 postMessage 之前 return**；
- 处于 frame 中时向 token audience（服务端从校验过的 claims 注入，不是读请求）post `{type:'link:embed:ready', v:1, nonce, sessionId, mode}`；
- `<html>`/`<body>` 的 `data-link-embed="v2" data-session-id data-mode` + `<meta name="link:embed:*">` + 可见文本，三处声明 sessionId 与 mode 这两个事实。

### 5. frame policy（关键读数）

响应头 `content-security-policy`：

```
frame-ancestors <origin>; default-src 'none'; script-src 'unsafe-inline';
style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none';
base-uri 'none'; form-action 'none'
```

- `frame-ancestors` 恒为**精确 audience**，永不带 `*`；没有 `X-Frame-Options: ALLOWALL`（故意不发该头，避免与 CSP 语义打架）；
- 未获 audience 的 frame 拿不到文档（请求在 401 就结束），获 audience 的 frame 也只能被那一个 origin 嵌。

### 6. M4 读数（已跑通）

单元测试 8/8（`test/embed.test.mjs`），edge check 第 2–9 条；含：mint 校验矩阵、claims（sub/aud/scope/600s ttl）、无 token/无 Origin/异 origin/篡改 401、文档 guard→post 顺序、CSP 精确 origin、nonce 不符 401、撤销后重载 401、重启后 mint 仍可用、token 不进日志。

---

## 二、M5 models.proxy（反向模型代理）

软件拿着 LINK 发的 `lk_` key 调用 LINK，LINK 再调到由 Lead 注入的 upstream（真实 provider 桥）。

### 1. 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `ROUTES.openaiPrefix + '/v1/chat/completions'` | 透传给 `upstream.openai(body, {model, key, signal})` |
| GET | `ROUTES.openaiPrefix + '/v1/models'` | 有 `upstream.listModels` 用它，否则把 key 白名单渲染成 OpenAI list |
| POST | `ROUTES.anthropicPrefix + '/v1/messages'` | 透传给 `upstream.anthropic(...)` |
| GET | `ROUTES.anthropicPrefix + '/v1/models'` | 同上的 Anthropic 前缀兄弟路由 |

四条都是 **exact route**：kernel webserver / harness 都是 exact 先于 prefix、prefix 最长优先，所以它们不会被 protocol 的 `/link/v1` catch-all 吃掉，也不与 embed/其他子系统冲突。未实现的 `/v1/*` 兄弟路径目前 404（见「已知边界」）。

### 2. key 生命周期

- key 形态 `lk_<43 base64url>`（32 字节随机），id `pk_<base64url>`；
- **只持久化 sha256**：`<core.dir>/proxy-keys.json` 每条 `{id, label, models[], rpm, createdAt, revokedAt?, keySha256}`，文件权限 `0o600`、原子 rename 写入；
- 原始 key 只从 `createProxyKey()` 返回一次，之后不写文件、不进日志/audit/响应，也不转发给 upstream；audit/log 里只有 key id（`proxy-key:<id>`）；
- 进程内认证：`Bearer` 头 → 先匹配 `^lk_[A-Za-z0-9_-]{32,}$` → 算 sha256 → ledger 查表 → 检查 `revokedAt`。未知/畸形/撤销一律 `401 link/unauthorized`（不区分，避免 oracle）；
- 每 key 独立 token-bucket 限速（默认 `LIMITS.rpm`=60/min），超额 `429 link/rate-limited` + `Retry-After`（秒）。

### 3. 调用矩阵（固定顺序：auth → body → 白名单 → rpm → upstream）

| 输入 | 结果 |
|---|---|
| 有效 key + 白名单内 model | 200，upstream 的 status/headers/body 透传 |
| body.model 不在 key.models | `403 link/scope-missing`，不触达 upstream |
| 超过 key.rpm | `429 link/rate-limited`，带 `Retry-After` |
| 缺失/畸形/未知/已撤销 key | `401 link/unauthorized` |
| body 缺 model | `400 link/bad-request` |
| 请求体超 `LIMITS.bodyBytes` | `413 link/payload-too-large`（由共享 io.readJson 给） |
| upstream 抛错 / 未注入 | `503 link/peer-unavailable` |

### 4. upstream 注入缝（Lead 在 index.ts 提供）

```ts
interface ProxyUpstream {
  openai?(body: Record<string, any>, context: { model: string; key: string; signal?: AbortSignal }): Promise<ProxyUpstreamAnswer>
  anthropic?(body: Record<string, any>, context: { model: string; key: string; signal?: AbortSignal }): Promise<ProxyUpstreamAnswer>
  listModels?(context: { key: string; signal?: AbortSignal }): Promise<ProxyUpstreamAnswer>
}
interface ProxyUpstreamAnswer { status: number; headers?: Record<string, string>; body?: unknown }
```

- `body` 支持 string / Buffer / node Readable（SSE 等流式原样 pipe）/ 普通 JSON 值；
- `context.key` 是 key id（审计事实），**不是**原始 key；`signal` 在 `LIMITS.timeoutMs` 后 abort；
- 响应头只透传 `content-type`、`x-*`、`retry-after`、`content-disposition`，`set-cookie`/hop-by-hop 一律丢弃；再统一补 `cache-control: no-store`、`x-content-type-options: nosniff`；
- 测试里用 fake upstream（`test/proxy.test.mjs`）走完全相同代码路径；真实 upstream（providerId=our-free-model 等）由 Lead 接线。

### 5. admin 接线（Lead 用）

```ts
import { createEmbedSubsystem } from './bind/embed.ts'
import { createProxySubsystem, createProxyKey, revokeProxyKey, listProxyKeys } from './bind/proxy.ts'

const embed = createEmbedSubsystem({ core, io, log })
const proxy = createProxySubsystem({ core, io, log, upstream: providerBridge }) // providerBridge 由 Lead 实现
subsystems.push(embed, proxy)

// 管理面（例如 /api/dsh-link-interconnect/proxy-keys POST）：
const { id, key } = proxy.createKey({ label, models, rpm })   // 或模块级 createProxyKey(...)
proxy.revokeKey(id)                                            // 或 revokeProxyKey(id)
proxy.listKeys()                                               // 或 listProxyKeys()：永远不含 raw key/hash
```

注意：模块级 `createProxyKey()/revokeProxyKey()/listProxyKeys()` 绑定「本进程最近一次 createProxySubsystem() 建的那本 ledger」（index.ts 只会建一个）；也推荐直接用返回句柄上的 `createKey/revokeKey/listKeys`。raw key 由管理面**只回一次**给用户，不要写进任何 UI 持久化。

---

## 三、命令与期望读数

```powershell
# 1) 盘面门（每次改动都要绿）
cd <workspace>\\dsh-link
node scripts/link-interconnect-parse-check.mjs          # -> link-interconnect gate: 6 held, 0 failed

# 2) 单元测试（宿主模块是普通 ESM，用 kernel checkout 里的 tsx）
cd <workspace>\\dsh-link\core\deepseek-harness
node --import tsx/esm <workspace>\\dsh-link\plugins\dsh-link-interconnect\test\embed.test.mjs   # -> tests 8, pass 8, fail 0
node --import tsx/esm <workspace>\\dsh-link\plugins\dsh-link-interconnect\test\proxy.test.mjs   # -> tests 12, pass 12, fail 0

# 3) M4+M5 验收门（real HTTP，16 条读数）
node --import tsx/esm <workspace>\\dsh-link\scripts\link-interconnect-edge-check.mjs
# -> M4 embed v2 + M5 models.proxy edge check (standalone): 16/16 held, 0 failed
```

gate 关键行：`04/16` 无 token 401、`05/16` 无/异 Origin 401、`07/16` CSP frame-ancestors=audience、`09/16` 撤销后 401、`10/16` 200 转发、`11/16` 403 scope、`12/16` 429 rate、`13/16` 401 三连、`16/16` raw key 不在任何落盘文件/audit/log。

---

## 四、已知边界与待 Lead 决策

1. **embed/token 的调用者鉴权**：frozen contract 的 endpoints 表把 `embedToken` 标成 `auth: 'bearer'`，PLAN 的 M4 验收只要求「GET 会话 token」鉴权；本实现按任务书未在 POST mint 上再要 access token（否则 SDK `linkClient().embedToken()` 与本地巡检脚本都要先走 handshake）。若要收紧，建议 Lead 在装配层给 mint 路由加 `embed.session` scope 校验，或由我后续补一个 `requireCallerToken` 选项。
2. **真实浏览器 iframe 的 Origin**：普通 iframe 顶层 GET 导航通常**不发 `Origin` 头**；当前严格按矩阵要求以 `Origin` 判 audience。真正上线嵌入时，需要壳（`src-tauri/src/core/proxy.rs`）或嵌入方以会带 `Origin` 的方式取文档（例如 `fetch` 后写 srcdoc，或壳转发时保留/规范出 Origin）。这是 M6 真实接入前必须确认的一点，CSP frame-ancestors 仍提供第二道约束。
3. **openai/anthropic 只开了 4 条 exact 路由**（chat/completions、messages、两个 models）。contract 写的是 prefix + `/*`，其余 `/v1/*` 兄弟路径（embeddings 等）暂时 404；需要时可加 exact 或 prefix handler。
4. **mint 记账丢失时的降级**：若 `embed-sessions.json` 被删/损坏而 token 仍在有效期，GET 会用 claims 的 sub/aud 继续服务、mode 记为 `full`；正常重启走持久化路径（有测试）。
5. **upstream 不拥有 provider 凭据**：proxy 只负责「软件→LINK」的 key 鉴权；真实 provider 的 key/baseUrl 由 Lead 注入的 upstream 闭包持有，本模块不读取、不落盘。

---

## 五、文件表

| 文件 | 角色 |
|---|---|
| `plugins/dsh-link-interconnect/src/bind/embed.ts` | M4 子系统：mint、会话文档、CSP、mint 记账持久化 |
| `plugins/dsh-link-interconnect/src/bind/proxy.ts` | M5 子系统：key ledger（sha256 only）、四条转发路由、upstream 缝、admin 导出 |
| `plugins/dsh-link-interconnect/test/embed.test.mjs` | M4 单测 8 条（real HTTP + 真 protocol core） |
| `plugins/dsh-link-interconnect/test/proxy.test.mjs` | M5 单测 12 条（real HTTP + fake upstream） |
| `scripts/link-interconnect-edge-check.mjs` | M4+M5 16 条验收读数（standalone） |
