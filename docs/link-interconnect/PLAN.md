# DSH-LINK 软件互联框架（link-interconnect）— 设计与落地计划

> 状态：计划已批准落盘。批准后第一步即本文件；随后按 §8 的 M1→M2 开工。

## 0. 目标与非目标

**目标**：给 DSH-LINK 内置一套**双向、声明式**的软件互联框架。

- **LINK 主动适配**（我们适配别人）：像 OFM 那样自动发现、询问、接入；**单个适配器 ≤120 行**（JSON 声明 + 少量脚本），OFM 是第 0 个用例。
- **软件主动适配**（别人适配我们）：外部软件用声明文件说明「我有哪些接口、怎么连」，并按 LINK 暴露的协议实现连接；框架先成熟，不要求今天就有接入方。
- 四类能力开箱：**接入模型**、**开放工具**、**在软件内部嵌入 LINK 会话窗口（需要鉴权）**、**反向代理模型**。

**非目标**：不做公网/云端穿透（局域网沿用现有 lan-bridge 中继）；不静默读取凭据；不执行声明之外的能力；不做通用 RPC 网关（只暴露「能力面」）。

---

## 1. 现状：可直接复用的既有件（读码/实测过）

| 既有件 | 位置 | 复用方式 |
| --- | --- | --- |
| 设备身份/授权/中继契约 | `plugins/dsh-lan-bridge/docs/MULTI-DEVICE-CONTRACT.md` | deviceId=指纹、grant 交集、relay 语义直接继承为 L1/L0 |
| 动态注册工具 | `dsh-lan-bridge/lib/core/tools.js`（`tools.register(def) → disposer`） | `tools.expose` 的绑定实现 |
| 路由注册 | `server.register({kind:'exact'\|'prefix', path, handler})` | 协议服务端的路由形态（teams/collab/browser/lan-bridge 都在用） |
| 主动适配先例 | `src-tauri/src/core/ofm.rs`（280 行；detect→consent→/health→/v1/models→写 ofm.json，key 只在同意后读） | 适配器生命周期的**黄金顺序**与「不静默」原则 |
| 同意 UI 先例 | `dsh-lan-bridge/lib/client.js:3489-3510`（读 `/__shell/ofm`、POST `/__shell/ofm/join`、`localStorage['dsh-ofm-later']`） | 同意卡片的交互范式 |
| 嵌入 v1 | `plugins/dsh-link-host/src/index.ts`（`/api/dsh-link-host/contract`、`/embed?mode=sidebar\|full`、postMessage `{type:'dsh-link:mode'}`） | 升级为带 token 的 embed v2（v1 缺口：无鉴权） |
| shell 路由面 | `src-tauri/src/core/proxy.rs:200-203`（`/api/*`→kernel RPC、`/__shell/*`→shell、其余→static） | **新增 `/link/*` 转发到 kernel**（缺口） |
| 对端台账 | `dsh-link-collab` `peerRecord(from,to,request,requested\|granted\|denied)` | 同意/拒绝的账本事件形态 |

---

## 2. 架构总览（5 层）

| 层 | 职责 | 落点 |
| --- | --- | --- |
| L5 治理 UI | 右上角同意卡、设置页（每个 peer）、审计、网络视图 | client 插件 + 现有 toast/slot |
| L4 适配器运行时 / SDK | LINK 主动：probe→detect→consent→bind；软件主动：declare+serve | `src/adapters/*`、`packages/link-interconnect-sdk` |
| L3 能力绑定 | models.provide / tools.expose / session.embed / models.proxy | `src/bind/*` |
| L2 声明层 | `link-interconnect/1` manifest + contract | `src/protocol/contract.ts` |
| L1 身份与信任 | Ed25519 linkId、配对码、scoped JWS token、grant 交集 | `src/identity/*`、`src/registry/*` |
| L0 传输 | loopback HTTP + SSE；LAN 复用 lan-bridge 中继 | `src/http/*` + 现有 relay |

两条数据流：

- **LINK 主动**：探针（文件/端口/健康指纹）→ 识别 → 通知 → 同意 → 读凭据 → 能力验证 → 绑定 → 审计 → 运行期健康检查 → 撤销。
- **软件主动**：软件暴露 well-known 声明 + `/link/v1/*` → LINK 拉声明 → 展示能力 → 同意 → 建 grant → 绑定调用。

---

## 3. 协议 v1（接口定义）

**版本**：`link-interconnect/1`（major 不同即拒绝；minor 只增不改，未知能力忽略）。
**LINK 侧前缀**：`/link/v1/*`（shell 转发到 kernel，自带鉴权，**不使用** `/api` 的会话 cookie）。

### 3.1 身份
- 实例级 Ed25519 密钥，`linkId = base32(sha256(pub))[0:26]`，存 `$DSH_HOME/link-interconnect/identity.json`。
- 人类别名（如「OFM 独立版@本机」）与 linkId 分离：别名可变，ID 不可变。

### 3.2 发现（三条通道，按可信度排序）
1. **适配器声明**（LINK 主动）：文件存在性 / JSON 字段（如 `service.lock.port`）/ 进程与注册表 / 端口候选 + `/health` 指纹；
2. **软件声明**（软件主动）：`GET /.well-known/link-interconnect.json`；
3. **LAN**：复用 lan-bridge announce（`accepts`/deviceId），不新增广播格式。

### 3.3 握手（配对码 + 签名，防中间人）
```
POST /link/v1/handshake          {protocol, client:{linkId,pub,platform}, scopes[]}  → {challenge, expiresIn}
POST /link/v1/handshake/confirm  {signature, pairingCode}                            → {accessToken, refreshToken, scopes, expiresAt, peer:{linkId,name}}
```
token = compact JWS(EdDSA)，claims `{sub, aud:'dsh-link', scope[], iat, exp, jti}`。

### 3.4 调用与事件
```
POST /link/v1/invoke   {cap, op, args, idempotencyKey?}
  → {ok:true, result} | {ok:false, error:{code, message}}
GET  /link/v1/events?token=   (SSE: {callId, seq, delta|done})
```
幂等：同一 idempotencyKey 10 分钟内返回首次结果。

### 3.5 错误码（稳定，不随文案变）
`link/unauthorized`、`link/scope-missing`、`link/version-unsupported`、`link/consent-required`、`link/peer-unavailable`、`link/rate-limited`、`link/payload-too-large`、`link/idempotency-conflict`。

### 3.6 四类能力面（JSON 契约）

| 能力 | 方向 | 契约 |
| --- | --- | --- |
| `models.provide` | 软件→LINK | 软件暴露 OpenAI 兼容 `/v1/models`、`/v1/chat/completions`；LINK 绑定为 provider |
| `tools.expose` | 软件→LINK | 声明 `tools:[{name,description,parameters(JSONSchema),call:{cap,op}}]`；LINK 用 `tools.register` 动态注册/回收 |
| `session.embed` | LINK→软件 | `POST /link/v1/embed/token {sessionId,mode,origin}` → 10 分钟、`aud=origin` 的 token；`GET /link/v1/embed/session?…&token=`；postMessage `{type:'link:embed',v:1,nonce}` / `{type:'link:embed:ready'}`；CSP 模板随 contract 下发 |
| `models.proxy` | LINK→软件 | `/link/v1/openai/v1/*`、`/link/v1/anthropic/v1/*`；`Bearer lk_…`（只存 sha256），每 key 模型白名单 + 速率上限 |

### 3.7 contract
`GET /link/v1/contract` → `{protocol, endpoints[], caps[], scopes[], limits, csp, version}`：只读、同输入同字节，供软件与适配器共用。

---

## 4. LINK 主动适配：声明式适配器（≤120 行）

### 4.1 布局
```
plugins/dsh-link-interconnect/
  adapters/ofm/adapter.json     ← 大多数适配只有这一个文件
  adapters/ofm/adapter.mjs      ← 可选，只写声明表达不了的映射；预算 ≤120 行
```

### 4.2 adapter.json（OFM 完整示例）
```json
{
  "id": "ofm",
  "name": "Our Free Model",
  "vendor": "Ebony-Vinyl",
  "match": {
    "files": [{ "path": "~/.our-free-model/service.lock", "jsonPath": "port", "as": "port" }],
    "env": ["OFM_HOME"],
    "identity": { "method": "GET", "url": "http://127.0.0.1:{port}/health", "contains": "our-free-model" }
  },
  "connect": {
    "baseUrl": "http://127.0.0.1:{port}",
    "credential": { "kind": "file-json", "path": "~/.our-free-model/settings.json", "jsonPath": "forwardKey" },
    "verify": [{ "method": "GET", "path": "/v1/models", "expectStatus": 200 }]
  },
  "capabilities": [
    { "kind": "models.provide", "version": 1, "from": "openai",
      "as": { "providerId": "our-free-model", "label": "Our Free Model" } }
  ],
  "consent": { "title": "接入 Our Free Model 作为模型供应商", "scopes": ["models.provide"] },
  "limits": { "rpm": 60, "timeoutMs": 15000 }
}
```

### 4.3 生命周期（8 步，严格顺序；与 ofm.rs 已验证顺序一致）
1 probe → 2 identify（/health 指纹）→ 3 **toast 询问** → 4 同意 → 5 读凭据（仅此时）→ 6 能力验证（/v1/models）→ 7 绑定 + 写 `peers/<linkId>.json` → 8 审计。
任一步失败即**整体回滚**（不写半截配置）；运行期每 60s 健康检查，连续 3 次失败标记 `unavailable`（不自动摘除绑定，避免抖动）。

### 4.4 「100 行」如何保证
- 声明覆盖：探针、凭据位置、验证请求、能力映射、同意文案、限额；
- `adapter.mjs` 只处理声明表达不了的部分（例如非标准响应字段映射）；
- **CI 门** `scripts/verify-adapter-budget.mjs`：每个 `adapter.mjs` ≤120 行（含注释），超预算即失败。

### 4.5 OFM 迁移
把 `core/ofm.rs` 的 detect/join 语义搬进 `adapters/ofm/adapter.json` + 运行时；Rust 侧只保留原生探针（文件/注册表）或整体下移到 kernel 的 node 实现（见 §10）。**保持已实测顺序与「key 不复制出目录」原则**。

---

## 5. 软件主动适配：SDK（零依赖）

软件只需三件事：
1. 暴露 `GET /.well-known/link-interconnect.json`（声明）；
2. 实现 `POST /link/v1/invoke`（按自己声明的 cap 分发）；
3. 可选：暴露 `/v1/models`、`/v1/chat/completions`（若声明 models.provide）。

声明示例（软件侧）：
```json
{
  "protocol": "link-interconnect/1",
  "identity": { "linkId": "svc_echo_01", "name": "Echo Service", "vendor": "example" },
  "endpoints": { "invoke": "/link/v1/invoke", "events": "/link/v1/events" },
  "capabilities": [
    { "kind": "models.provide", "version": 1, "auth": "bearer", "scopes": ["models.provide"] },
    { "kind": "tools.expose", "version": 1,
      "tools": [{ "name": "echo.ping", "description": "回显", "parameters": { "type": "object" } }],
      "auth": "bearer", "scopes": ["tools.expose"] }
  ]
}
```

SDK API（node，零依赖）：`declare(manifest)`、`serve({handlers, auth})`、`linkClient({baseUrl, token})`（反向调用 LINK 的 models.proxy / embed.token）。
示例 `examples/echo-service`：约 80 行，声明一个 tool + 一个 model，跑通「被 LINK 接入」。

LINK 侧接受流程：拉 well-known → 展示能力 → 同意 → 存 peer+grant → 绑定；版本不匹配只忽略未知能力并提示。

---

## 6. 身份、授权、同意、审计

| 项 | 规则 |
| --- | --- |
| scopes | `models.provide`、`models.proxy`、`tools.expose`、`embed.session`、`consent.manage`、`audit.read` |
| 默认 | deny-by-default；仅回环；LAN 需显式开启并复用 lan-bridge LAN Key/中继 |
| grant | 双方 grant 交集（沿用 lan-bridge 语义：取小限额、取远端 roots） |
| token | access 15m、refresh 30d、embed 10m（aud=origin）、proxy key 长期可轮换；`jti` 黑名单支持即时撤销 |
| 凭据 | 永不写入 manifest、永不进日志；只在同意之后读取；proxy key 只存 sha256 |
| 审计 | link-notes 记 `interconnect/consent`、`/invoke`、`/revoke`（含耗时与结果码，不含参数体） |
| 撤销 | 删 grant + jti 拉黑 + unbind（provider/tool 即时消失） |

---

## 7. 代码落点（文件清单）

**kernel 插件 `plugins/dsh-link-interconnect/`**：`src/index.ts`（装配）、`src/protocol/{contract,handshake,invoke,events,errors}.ts`、`src/identity/{store,tokens}.ts`、`src/registry/{peers,grants,consent}.ts`、`src/bind/{models,tools,embed,proxy}.ts`、`src/adapters/{runtime,probe}.ts`、`src/http/{routes,cors,ratelimit}.ts`、`adapters/ofm/adapter.json`。

**client 半边（同包）**：`src/client/{consentToasts.tsx,settings.tsx,peers.tsx}`（右上角卡片 + 设置页 + 网络视图）。

**shell（Rust）**：`src-tauri/src/core/proxy.rs` 增加 `/link/{*path}` → kernel 转发（复用 `forward_unary` 形态但不带会话 cookie）；可选 `core/interconnect_probe.rs`（文件/注册表探针）。

**SDK + 文档 + 脚本**：`packages/link-interconnect-sdk/{package.json,src/index.ts,examples/echo-service}`、`docs/link-interconnect/{PROTOCOL,ADAPTERS,SDK,SECURITY}.md`、`scripts/link-interconnect-check.mjs`、`scripts/verify-adapter-budget.mjs`、`scripts/interconnect-embed-test.mjs`。

---

## 8. 里程碑与验收（每步都有读数）

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M1** | 协议骨架：contract、身份、握手、invoke/events、错误码 | `node scripts/link-interconnect-check.mjs` → 12/12；无 token 401、越权 403 两条读数 |
| **M2** | 适配器运行时 + OFM | 起 stub OFM(18900) → toast → 接入 → `node scripts/dsh-runtime.mjs` 的 providers 出现 `our-free-model`；适配器行数 ≤120 |
| **M3** | SDK + echo 示例 | agent 调 `echo.ping` 成功（transcript）；模型列表出现 echo 模型 |
| **M4** | embed v2（鉴权） | 无 token 401；正确 token 加载 + nonce 握手；撤销后重载 401 |
| **M5** | models.proxy | curl 矩阵：200 / 403(scope) / 429(rate) 三条读数 |
| **M6** | LAN + 文档 + 真实接入（OFM 独立版） | 第二进程/第二台机可发现；docs 齐；OFM 走声明式适配器 |

---

## 9. 失败模式与边界

| 场景 | 行为 |
| --- | --- |
| 服务未启动 | `detected:false` + 原因句；不提示接入 |
| 端口漂移 | 每次启动重读 lock/声明；不缓存旧端口 |
| 版本不匹配 | 忽略未知能力；major 不符直接拒绝并给 code |
| 密钥轮换 | 验证失败 → 标记 `rejoin-required`，提示重新接入 |
| 能力 id 冲突 | 拒绝第二个绑定并具名（谁占了 id） |
| 同意中途撤销 | 立即杀 token + unbind；进行中调用返回 `link/consent-required` |
| 绑定部分失败 | 整体回滚，不留半截 provider/tool |
| SSRF | 只允许声明的 loopback/allowlist；不跟随重定向 |
| 大响应体 | `limit.payload` 上限，超出 `link/payload-too-large` |

---

## 10. 需要拍板的三件事

1. **协议前缀与公开度**：`/link/v1` 还是 `/interconnect/v1`？是否写进公开文档、当作稳定规范（决定以后能否随意改）。
2. **OFM 独立版是否愿意加 `/.well-known/link-interconnect.json`**（约 30 行）：加了就是「他们主动声明」的样板；不加只能靠适配器探针（「我们主动适配」）。
3. **embed 鉴权强度**：短期 token（推荐，M4 可交付）还是 token + Tauri 原生窗口握手（更强，多一层原生桥）？

> 下一步：按 **M1 → M2** 开工。M1 只动 kernel 插件与 shell 的一条转发规则；M2 交付「OFM 从探测到成为 provider」的完整闭环（stub 自测），不依赖他们真实发布制品。

## 11. R472 拍板结果（替代 §10 的三个待定问题）

1. **前缀与公开度**：定为 `/link/v1`，且**从 M1 起按稳定规范对待**——`ROUTES` 表是唯一拼写处，
   SDK 侧的镜像读数（frozen mirror）在 CI 门里与 `types.ts` 逐字段对比，改前缀会让 SDK 门变红。
   公开文档：`docs/link-interconnect/SDK.md`（已交付）、PROTOCOL.md（随 M6 补齐）。
2. **OFM 独立版的 well-known**：不阻塞 M6。LINK 主动适配路径（声明式 adapter）已完整跑通；
   对端加那约 30 行 `/.well-known/link-interconnect.json` 是"他们主动声明"的样板，留给 OFM 仓库自己决定；
   我们保证：加了就能被入站（M3）直接拉取，不加也有一条完整的适配器路径。
3. **embed 鉴权**：先做**短期 token**（10 分钟、aud=origin、jti 可撤销），Tauri 原生窗口握手列为后续可选加强，
   不进入 M4 验收；M4 的验收就是无 token 401 / 正确 token + nonce 加载 / 撤销后 401 三条读数。

## 12. 收口（R475）：M1→M6 全部交付

| 里程碑 | 交付读数 |
| --- | --- |
| M1 协议骨架 | 离线 12/12、经 shell 活体 12/12；无 token 401 / 缺 scope 403；contract 两次字节相同 |
| M2 声明式适配器 + OFM | 活体 probe→同意卡→bind→provider `our-free-model`；适配器 115 读数、预算 2/0、OFM 纯声明 36 行；重启按 receipt 恢复 |
| M3 零依赖 SDK + echo 示例 | SDK 18/18；LINK 入站按 URL→同意→绑定工具/模型，agent 调用返回 `{"pong":true}`（R473） |
| M4 embed v2 | 无 token 401 / 正确 token+nonce 200 且 CSP 精确 / 撤销后 401；离线 8/8、活体 5/5 |
| M5 models.proxy | 200 / 403(whitelist) / 429(rate + retry-after)；key 只存 sha256；离线 12/12、活体 5/5 |
| M6 LAN + 文档 + OFM 真实路径 | LAN allowlist 第二进程实测 8/8；docs 8 篇（PROTOCOL/ADAPTERS/SECURITY/LAN/OFM-INTEGRATION/README/SDK/EMBED-AND-PROXY）；OFM 独立版 runbook |

汇总门：`link-interconnect-live-accept.mjs` **31/31**；parse 6/0；SDK 18/18；edge 16/16；单元 13/115/8/12；
adapter budget 2/0；pack 一致；插件契约门两包各 10 pass。逐条读数：`READINGS-R472.md`、`READINGS-R473.md`、`READINGS-R475.md`。
