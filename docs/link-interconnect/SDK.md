# link-interconnect SDK：软件侧契约（peer 侧 v1）

> 目标读者：要让自己的软件「被 LINK 接入」的厂商。你只需暴露一个声明 + 一个调用端点，其余由 SDK 负责。
> 冻结点 = `plugins/dsh-link-interconnect/src/protocol/types.ts`（FROZEN）；本页是它的可读摘要，冲突以 types.ts 为准。
> 实现 = `packages/link-interconnect-sdk`（零依赖 ESM，可整目录拷走；`examples/echo-service` 可直接 node 跑）。

## 一、软件只做三件事

1. `GET /.well-known/link-interconnect.json`：声明你是谁、有哪些能力（PeerManifest）。
2. `POST /link/v1/invoke`：按 `{cap, op}` 分发，回 `{ok:true,result}` 或 `{ok:false,error}`。
3. 可选：声明 `models.provide` 时，暴露 OpenAI 兼容的 `GET /v1/models` 与 `POST /v1/chat/completions`。

协议前缀固定 `/link/v1`。LINK 的壳（`src-tauri/src/core/proxy.rs`）把 `/link/*` 转发到内核并带上会话凭据；
**软件方不持有、也不需要 cookie**，只带自己声明的 Bearer token（或由自己的 `auth` 缝决定）。

## 二、well-known 声明（PeerManifest）

```json
{
  "protocol": "link-interconnect/1",
  "identity": { "linkId": "svc_echo_01", "name": "Echo Service", "vendor": "example" },
  "endpoints": { "invoke": "/link/v1/invoke", "events": "/link/v1/events" },
  "capabilities": [
    { "kind": "models.provide", "version": 1, "auth": "bearer", "scopes": ["models.provide"] },
    { "kind": "tools.expose", "version": 1, "auth": "bearer", "scopes": ["tools.expose"],
      "tools": [{ "name": "echo.ping", "description": "回显", "parameters": { "type": "object" } }] }
  ],
  "limits": { "rpm": 60, "bodyBytes": 1048576 }
}
```

- `protocol` 必填且 **major 必须为 1**：`link-interconnect/2` 被拒为 `link/version-unsupported`；未知 minor 只忽略、不改语义。
- `identity.linkId` 不可变（1–128 字符 `[A-Za-z0-9._:@-]`，首字符字母数字）；`name` 是人类可读别名，可变。
- `endpoints` 可省，缺省即 `/link/v1/invoke`、`/link/v1/events`；`limits` 可省，是给 LINK 的限额意图。
- `declare(manifest)` 校验并冻结上表；字段明显不对抛 `LinkSdkError`，`.code` 是稳定码（见第八节）。

## 三、四个能力面（方向很重要）

| 能力 | 方向 | 谁实现什么 |
|---|---|---|
| `models.provide` | 软件 → LINK | 你暴露 OpenAI 兼容面；LINK 把你绑成 provider |
| `tools.expose` | 软件 → LINK | 你声明 `tools[]`（含 `call: {cap, op}`）；LINK 注册为工具，用 invoke 调你 |
| `session.embed` | LINK → 软件 | LINK 签发 10 分钟、aud=origin 的 embed token 供你把会话窗口嵌进自己的页面（需鉴权） |
| `models.proxy` | LINK → 软件 | 软件用 Bearer `lk_...` 反向调 LINK 的 `/link/v1/openai/v1/*`、`/link/v1/anthropic/v1/*`；key 只存 sha256，有模型白名单与速率上限 |

## 四、invoke：请求、分发、应答

```json
// 请求（POST /link/v1/invoke）
{ "cap": "tools.expose", "op": "echo.ping", "args": { "text": "hi" }, "idempotencyKey": "可选" }

// 应答（二选一）
{ "ok": true, "result": { "pong": true } }
{ "ok": false, "error": { "code": "link/not-found", "message": "no handler for tools.expose/echo.ping" } }
```

- 分发顺序：`handlers[cap + '/' + op]` 先，`handlers[op]` 后；都没有 → HTTP 404 + `link/not-found`。handler 签名 `handler(args, context)`，可返回对象或 Promise；context = `{cap, op, args, peer, idempotencyKey, manifest, request}`。
- 返回 `undefined` 当 `null`；抛 `LinkSdkError` → 用它自己的 code；抛其他异常 → `link/internal`（不泄露栈）。
- 同一 `idempotencyKey` 在 `LIMITS.idempotencyMs`（10 分钟）内重放首次结果；请求体上限 `LIMITS.bodyBytes`（1 MiB），超出 `link/payload-too-large`。

## 五、auth 缝（唯一鉴权点）

`serve({ auth })` 里 `auth(request)` 收 `{method, url, headers, token, route}`；`token` 取自 `Authorization: Bearer <token>`，SSE 的 `GET /link/v1/events` 还接受 `?token=`。
放行回答 `true` 或 `{ok:true, peer?}`；拒绝回答 `false` 或 `{ok:false, code?, message?}`（缺省 401 `link/unauthorized`）。**不传 auth = 不鉴权**，只适合回环开发；协议默认只回环。

## 六、serve() 与 linkClient()

- `await serve({ manifest, handlers, auth, port?, host?, models? })` → `{url, manifestUrl, manifest, publish, close}`；`port` 缺省 0（临时端口），`host` 缺省 `127.0.0.1`。
- `publish(event)` 把事件推给所有 SSE 订阅者；`await close()` 停监听并结束订阅。`models` 用于 `models.provide`：`{list, chat}`。
- `linkClient({ baseUrl, token, fetchImpl?, timeoutMs? })` → `contract()`、`invoke({cap,op,args?,idempotencyKey?})`、`embedToken({sessionId,mode,origin})`、`openai(path, init)`、`anthropic(path, init)`；被拒抛带 `.code` 的 `LinkSdkError`。

## 七、20 行 echo 示例

```js
import { serve } from '@dsh-link/link-interconnect-sdk'

const token = 'echo-token'
const manifest = {
  protocol: 'link-interconnect/1',
  identity: { linkId: 'svc_echo_01', name: 'Echo Service' },
  capabilities: [{
    kind: 'tools.expose', version: 1, auth: 'bearer', scopes: ['tools.expose'],
    tools: [{ name: 'echo.ping', description: 'echo', parameters: { type: 'object' } }],
  }],
}
const peer = await serve({
  manifest,
  handlers: { 'tools.expose/echo.ping': (args) => ({ pong: true, echo: args }) },
  auth: (request) => request.token === token,
  port: 0,
})
console.log('listening on ' + peer.url)
console.log('declaration  ' + peer.manifestUrl)
```

## 八、错误码（稳定；码不变，文案可变）

`link/unauthorized`（401）、`link/scope-missing`（403）、`link/version-unsupported`（400）、`link/consent-required`（403）、`link/peer-unavailable`（503）、
`link/rate-limited`（429）、`link/payload-too-large`（413）、`link/idempotency-conflict`（409）、`link/bad-request`（400）、`link/not-found`（404）、
`link/internal`（500）、`link/method-not-allowed`（405）。

## 九、读数

仓库根跑 `node scripts/link-interconnect-sdk-check.mjs`：18 passed, 0 failed。其中 `frozen mirror` 一行直接 import types.ts，
比对协议 id、五个路由前缀、scope/cap/错误码/limits；所以本页的常量不是手抄信仰，是每次跑门重验的。
