# DSH 局域网桥接插件 — 架构设计 (v1)

> 目标：把两台（或多台）运行 DSH 的电脑组成一个可互相操作的调试对。
> 一端是 **Agent 侧**（它的 agent 获得远程工具），另一端是 **桥接侧**（它把本机的文件编辑与 Shell 执行能力有限度地开放出去）。
> 今天要跑通的是 **Windows DSH 0.1.5 ↔ Windows DSH 0.2.0**；Mac 侧装的是 0.2.0，用「从文件夹导入插件」安装同一个包。

---

## 1. 交付物

| 交付 | 路径 | 用途 |
|---|---|---|
| 插件包（唯一实现） | `H:\mod\dsh-lan-bridge\` (仓库根) | 源码 + 可直接被 0.2.0 导入的包结构 |
| 0.2.0 导入文件夹 | `dist\dsh-lan-bridge-0.2.0\` | Mac：侧边栏「插件」→「从文件夹导入」 |
| 0.1.5 配套 | `dist\dsh-lan-bridge-0.1.5\` | Windows 0.1.5：profile bundle（`link:` + bundles + patch 行） |
| 设计文档 | `docs\ARCHITECTURE.md` | 本文件 |
| 安装文档 | `docs\INSTALL-zh.md` | 双端安装 + 使用 |

两个 dist 目录内容**完全相同**（同一份代码、同一个包名），只有 README 与安装说明不同 —— 这正是"统一版本通用连接"的准备：将来两端同版本时，两端都走 0.2.0 的「从文件夹导入」即可。

---

## 2. 已核实的 DSH 接口（本机实测，非猜测）

### 2.1 两端共用的插件机制

两个版本用的是同一套 profile/bundle 机制：

- profile 目录 `$DSH_HOME/profiles/<name>/`，含 `package.json`（`dependencies` + `dsh.profile.bundles`）、`cordis.patch.yml`（用户 patch 层）、`cordis.yml`（根条目表，固定 `[]`）。
- 包的 `package.json` 声明 `"dsh": { "bundle": { "patch": "cordis.patch.yml" } }`，patch 文件用 `- insert: [ {id, name, config} ]` 引入插件行。
- 兼容性闸门（`dsh-app-boot`）：导入插件前检查 `peerDependencies` 里 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 的范围是否匹配运行时版本；**未声明任何 DSH peer 时不施加版本约束**。→ 本插件刻意不声明 DSH peer，因此 0.1.5-rc.1 与 0.2.0-rc.2 都能装。
- 0.2.0 的侧边栏「插件」页（`dsh-client-ui-plugin-manager` + `dsh-plugin-manager`）的 `installBundle(spec)` 接受**绝对本地路径**：读该目录 `package.json` → 校验 → `pnpm add` → 写入 `dsh.profile.bundles`。

### 2.2 Host 侧（Node 进程内）

| 能力 | 0.1.5 / 0.2.0 契约 | 用途 |
|---|---|---|
| 工具注册 | `ctx.tools.register(def) → disposer`；普通 `ctx` = 全进程可见，`agent.ctx` = 仅该 agent | 连接时注册、断连时 dispose = **工具自动解锁/回收** |
| 工具定义 | `{ name, description, parameters(JSON Schema), output:{ schema, render(args,value)→[{type:'text',text}] }, execute(args, exec) }` | 手写纯对象，不 import `defineTool`，两端一致 |
| 执行上下文 | `exec.agent`（含 `exec.agent.session.id` / `.header.cwd`）、`exec.signal` | 定位会话工作目录 |
| 会话中途增删工具 | agent loop **每个 step** 重新组装目录；0.2.0 另追加 `tool-addition` / `tool-removal` 消息，**0.1.5 只有 `tools/change`，没有这条消息** | 断连回收工具时**上下文不丢、无需重开对话**；0.1.5 只是少一条显式提示（已活体实测） |
| 权限：沙箱模式 | `ctx.get('sandboxPolicy').resolve({ session }) → { mode, workspaceRoot }`，`mode ∈ read-only \| workspace-write \| danger-full-access` | 继承本机权限设置 |
| 权限：审批 | `ctx.get('approval').request({ agent, toolName, callId, reason, signal }) → 'allowed-once' \| 'rejected' \| 'cancelled' \| 'unavailable'`；`ask` 才询问，`never` 直接确定性拒绝 | 低权限会话下远程操作必须逐次批准 |
| HTTP 路由 | `ctx.webServer.register({ kind:'prefix', path, handler(req,res) }) → disposer` | UI ↔ Host 私有 RPC |
| index 注入 | `ctx.webServer.tapIndex((html)=>html) → disposer` | 把 UI token 注入页面 |
| 命令 | `ctx.commands.register({...}) → disposer` | `/bridge` 文本命令（可选） |
| 设置 | `ctx.settings.register(ns, schema)` | 端口、可被发现开关等持久偏好 |

### 2.3 Client 侧（浏览器）

- 客户端半成品是 `window.__ModuleLoader__.load({ id, factory: (require) => { var module={exports:{}}; var exports=module.exports; … exports.apply=apply; exports.inject=inject; return module.exports } })` 打包格式，**两端一致**（0.2.0 `dsh-client-modules/lib/client.js` 同款）。
- 包 `package.json` 声明 `"dsh": { "client": { "platform": "web" } }`，并通过 `exports["./client"]` 指向该文件。
- **侧边栏左下角**的落点是 slot **`sidebar.footer.action`**（kind=list，"Optional actions beside Settings at the sidebar foot"），注册形式：
  `ctx.slots.register({ name:'sidebar.footer.action', id, order, locale }, Component)`，注册即返回 disposer；组件收到 owner props `{ wide:boolean }` 与标准 props。
- 全屏浮层落点是 slot **`shell.overlay`**（kind=list）——面板本体放这里。
- 客户端 `ctx` 注入服务：`slots`、`locale`、`layout`、`connection`、`remote` 等；`require('react')` 与 `require('@deepseek-ai/dsh-client-ui-primitives')` 由模块系统的 seed/行解析（已有第三方包如此使用，本机 0.1.5 实测在运行）。为稳妥，primitives 用 try/catch 兜底为纯 React 元素。

---

## 3. 身份、多设备与连接流程

**只有两种身份**：`agent` / `bridge`（`both` 已取消）。身份是**姿态**而不是能力开关——两种身份都能同时连出多个设备、也能同时被多个设备连入，任何连接都不会禁用其他功能。身份只决定开机时**急切开什么**：

| 身份 | 开机即监听 | 开机即显示配对码 | announce `accepts` |
|---|---|---|---|
| `agent`（默认） | 否 | 否 | 打开配对窗口前为 `false` |
| `bridge` | 是 | 是 | `true` |

身份与「可被发现」持久化在 `$DSH_HOME/lan-bridge/prefs.json`。`accepts` 严格等于「正在监听」，与 `discoverable` **解耦**（后者只决定是否在局域网上广播自己：可以「不广播但按地址可达」）。切到 `agent` 会关掉配对窗口（连同监听），但**不会驱逐已建立的会话**。

```
        Agent 侧 (agent)                         桥接侧 (bridge)
   ┌────────────────────────┐                ┌────────────────────────┐
   │ UI: 我是 Agent 侧       │                │ UI: 我是桥接侧          │
   │  自动发现设备列表        │   UDP 组播      │  开机即显示 6 位配对码   │
   │  [连接] → 输入配对码     │ ─────────────► │  右上角通知卡片          │
   │  数据面工具 6 个解锁     │  同意/拒绝      │  授予：根目录/写/Shell/中转│
   │  控制面工具按策略出现     │ ◄────────────► │  审计日志               │
   └────────────────────────┘   TCP 加密会话    └────────────────────────┘
              │                                            │
              │  多路：state.links    : Map<deviceId, link>    │
              │        state.incoming : Map<deviceId, session> │
              ▼                                            ▼
        ┌──────────────────── 中转 (A → B → C) ────────────────────┐
        │ A 的 targets = { B(direct), C(relay via B) }             │
        │ C 对 A 生效的授权 = A 对 B 的授权 ∩ B 对 C 的授权          │
        │ 线上表示：op 后缀 `read@<deviceId>` + args.$relay.path    │
        └──────────────────────────────────────────────────────────┘
```

1. **发现**：可被发现的机器每 3s UDP 组播 `announce`（含 deviceId、名称、OS、端口、**身份 role、是否接受连接 accepts、中转 relay{enabled,maxHops,devices}**、协议版本、公钥指纹——全部在**签名体内**，对端无法谎报）；`probe` 主动询问，另有单播子网扫描兜底（组播被交换机/防火墙挡住时用）。不可被发现的机器**完全静默**：不广播、不回应单播探测、`probe()` 也不发包（一个探测包本身就是一份签名 announce），但仍**监听**并照常列出别人。
2. **配对**：Agent 侧点「连接」→ TCP → X25519 握手 → SPAKE2(P-256) 用桥接侧的一次性配对码认证 → 桥接侧**右上角通知卡片**显示设备名与**安全码**，同意后建立长期信任（TOFU）。安全码由两端长期公钥共同推导，两端相同才说明没有中间人。
3. **授权**：桥接侧为每个已信任设备保存授权表（根目录、只读/可写、Shell、**是否允许中转 + 中转白名单 relayPeers**、超时与输出上限）。**每次**远程操作都要过这张表 + 路径规范化；授权可以在**会话存活期间修改**，下一次调用立即生效。
4. **工作**：Agent 侧数据面工具解锁（`toolsAvailable = targets.length > 0`）；模型可以列目录/读/写/改/执行命令到任意可达设备，用可选的 `device` 参数区分（只有一台时可省略）。
5. **中转**：每个节点把自己能到达的设备（含自己）列给每个入站对端（`sys.info/devices`），附上**已为该对端算好的生效授权**。能力取交集、上限取更小、**目录用远端那台的**（近端授权里的路径是近端机器上的路径，对远端没有意义，所以近端只能收窄、不可能放宽）。relayed 调用用 op 后缀寻址，`$relay.path` 由每一跳追加并用于防环，`$relay` 在执行器之前被剥掉。
6. **断连**：任何一侧断开 → 只回收受影响的链路；**最后一台设备消失时**才 dispose 数据面工具（会话历史保留，可继续用本地工具）。控制面工具按 `controlTools` 策略保留。


---

## 4. 线协议（v1）

### 4.1 分帧
```
+--------+--------+--------+--------+--------+----------------+
| len(4B BE) | 固定头: type(1B) flags(1B) rsv(2B) | 载荷          |
+--------+--------+--------+--------+--------+----------------+
```
- `len` 上限 8 MiB，超限即断开（防内存攻击）。
- 控制帧：AES-256-GCM 密封后的 JSON；二进制帧：同类封装的分块数据（大文件读写用）。

### 4.2 握手与加密
1. `hello`（明文，双方并行）：`{ v:1, deviceId, name, os, arch, role, caps:[], eph: <X25519 公钥>, nonce }` + 长期公钥与其对 transcript 的签名。
2. 双方 `X25519(eph_self, eph_peer)` → HKDF-SHA256(salt = nonce_a‖nonce_b, info = "dsh-lan-bridge/v1") → 两条方向键 `k_ab`、`k_ba`。
3. 身份确认：`proof = HMAC-SHA256(shared, "id|" ‖ 长期公钥指纹 ‖ transcriptHash)` 互验，绑定长期身份，防 MITM 换键。
4. **配对码**：桥接侧生成 6 位数字。配对码只作为**已由 ECDH 保护的会话内确认标签**：`confirm = HMAC-SHA256(shared, "pair|" ‖ code ‖ transcriptHash)`。攻击者没有 ECDH 私钥就无法离线爆破配对码；在线尝试限制 5 次并指数锁定。
5. 会话：AES-256-GCM，12B nonce = `epoch(4B) ‖ counter(8B)`，AAD = 帧固定头；接收端维护滑动重放窗口；`2^31` 帧或 1 GiB 或 10 分钟触发 rekey。
6. 信任存储（TOFU）：`trust.json` 记录 `deviceId → 长期公钥 + 名称 + 授权表`；已信任设备重连免配对码，但仍需桥接侧授权表放行，且 UI 可见、可随时撤销。

### 4.3 版本与能力协商
`hello` 携带 `v` 与 `caps[]`；双方取 `min(protocolVersion)`，能力取交集，遇到未知能力忽略而非报错。这保证临时跨版本（0.1.5↔0.2.0）与将来统一版本共用一条协议。

---

## 5. 授权与安全模型

桥接侧是本机能力的**唯一权威**：

- 请求的能力：`fs.list`、`fs.read`、`fs.write`、`fs.edit`、`shell.exec`、`sys.info`。
- 授权表（每设备）：`roots[]`（允许的目录，默认当前工作区）、`write`（只读/可写）、`shell`（禁用/开启）、`cwdRoot`、`timeoutMs`、`maxOutputBytes`。
- 路径安全：`realpath` 解析后做**分隔符感知**的前缀比较；拒绝 `..` 逃逸、符号链接逃逸、UNC/设备路径；Windows 盘符与大小写、macOS 大小写不敏感但保留大小写 —— 统一用"规范化后逐段比较"实现。
- Shell 安全：以当前用户身份执行、cwd 锁定在授权根内、可选允许列表、超时强杀、输出截断；诚实声明"shell 授权 = 对端可在你账户下执行命令"，因此默认**关闭**，必须由桥接侧在 UI 上显式打开。
- UI 通道：HTTP 路由 `/dsh-lan-bridge/api` 要求自定义头 `X-DSH-Bridge-UI: <每次启动随机 token>`（token 由 `tapIndex` 注入页面），且只接受 `application/json`。自定义头 + 无 CORS 预检 = 阻断浏览器跨站请求伪造；token 每次启动重新生成。
- 审计：桥接侧把每次操作的 `{ts, peer, cap, path/cmd, allow/deny, reason, bytes, ms}` 追加到 JSONL，UI 可查看。

---

## 6. Agent 侧工具（连接时注册，断连时 dispose）

| 工具 | 参数 | 说明 |
|---|---|---|
| `bridge_status` | — | 连接状态、对端信息、授权摘要、往返延迟 |
| `bridge_fs_list` | `path` | 列目录 |
| `bridge_fs_read` | `path, offset?, limit?` | 读文本（行号） |
| `bridge_fs_write` | `path, content` | 写文件 |
| `bridge_fs_edit` | `path, old_string, new_string, replace_all?` | 精确替换编辑（与本地 edit 同语义） |
| `bridge_shell` | `command, cwd?, timeoutMs?` | 在对端执行 Shell |

所有工具 `execute` 统一走同一段**权限继承**逻辑：

```
mode = ctx.get('sandboxPolicy')?.resolve({ session: exec.agent.session })?.mode
if (mode === 'danger-full-access')  → 直接执行（本机权限已是完全访问）
else                                → ctx.get('approval').request({...})
                                       'allowed-once' → 执行
                                       其它            → 返回明确拒绝原因
```
`never` 策略下 `approval.request` 确定性拒绝，因此低权限会话里的远程操作会得到一条可读的错误（提示用户切换权限预设），而不是静默失败或绕过。

---

## 7. 代码结构

```
dsh-lan-bridge/
  package.json          # 无 DSH peer → 两端均可安装
  cordis.patch.yml      # 只插入一行：name: dsh-lan-bridge
  lib/
    index.js            # 默认入口 → re-export ./current.js（便于 live reload）
    current.js          # Host 插件：装配一切（identity/discovery/session/tools/routes）
    client.js           # Client 半：__ModuleLoader__ bundle（footer 按钮 + 浮层面板）
    core/
      identity.js       # 设备身份 + trust.json
      discovery.js      # UDP 组播发现（多网卡/回环）
      net.js            # TCP 帧传输 + 会话状态机（agent/bridge 双角色）
      crypto.js         # X25519 / HKDF / AES-GCM / 重放窗口 / 配对
      frame.js          # 分帧编解码（流式解析）
      policy.js         # 授权表 + 路径规范化 + 审计
      exec.js           # 桥接侧：文件读写改、列目录、Shell
      tools.js          # Agent 侧：6 个远程工具定义 + 权限继承
      rpc.js            # /dsh-lan-bridge/api 路由 + token
      log.js            # 带标签日志
  test/
    selftest-proto.mjs  # 分帧/加密/重放/路径逃逸/超帧 自测
    e2e-twohost.mjs     # 双进程端到端
  dist/
    dsh-lan-bridge-0.2.0/
    dsh-lan-bridge-0.1.5/
  docs/
```

代码全部为**零依赖 ESM**（只用 Node 内置 `net`/`dgram`/`crypto`/`os`/`fs`），因此不触发 pnpm 安装、不需要构建、macOS 上开箱可用。

---

## 8. 跨版本与"通用连接"的演进

- 协议层与角色完全对称：**同一个包、同一份代码**，角色只是运行时选择。
- 今天 0.1.5 用 profile bundle 安装、0.2.0 用「从文件夹导入」安装 —— 差异只在**安装方式**，不在插件内容。
- 将来两端同为 0.2.x 时：两边都用「从文件夹导入插件」，无需任何代码改动（`dsh.bundle.patch` 与 `dsh.client` 声明两端通用）。
- 新增能力只加 `caps` 标记与新帧类型，旧端看到未知能力忽略；协议版本提升时走 `min(v)` 兼容窗口 + 明确的不支持错误。

---

## 9. 实测验证结果（截至交付）

| 验证 | 规模 | 结果 |
|---|---|---|
| 线路层独立用例 `src/proto/selftest.mjs` | 48 项 + 1 跳过（POSIX-only） | 全绿；与 `lib/core/` 中的 `frame/crypto/link/p256` **逐字节一致** |
| 桥接侧执行器 `test/selftest-exec.mjs` | 17 项 | 全绿 |
| 浏览器侧面板 `test/client-smoke.mjs` | 44 项 | 全绿 |
| 双服务端到端 `test/e2e-twohost.mjs` | 42 项（真实 UDP 组播 + TCP + 真实文件/进程） | 全绿 |
| **三机中转** `_test/relay-smoke.mjs` | 25 项：A→B→C 真实握手，A 通过 B 读 C 的文件、跑 C 的命令，权限取两跳最小值，`relay:false` 与逐台断开 | 全绿 |
| **跨应用真实双宿主** `test/two-host-real.mjs` | 36 项：DSH 0.1.5（Agent 侧）↔ DSH 0.2.0（桥接侧），两个独立宿主进程 | 全绿，留存于 `_test/verify-two-host-real.txt` |
| 真实 0.1.5 App 内挂载 | 用户的正式 profile（junction + patch 行，`patchReload: live`） | 已即时挂载：`$DSH_HOME/lan-bridge/` 已生成身份与信任文件，路由对无 token 请求返回 403 |
| **工具增减时机（活体实测）** | 在**正在运行的** DSH 0.1.5 宿主上，用动态 Cordis 插件注册一个工具，再在**同一个对话的下一个 step** 调用它 | 调用成功；停掉插件后再调用得到干净的 `Error: unknown tool`，对话继续，无挂起、无未捕获拒绝 |

跨应用验证覆盖的关键行为：UDP 发现、未配对设备被拒、配对窗口 + 一次性配对码、桥接侧同意与授权表下发、两端安全码一致、**6 个工具解锁**、远程 `fs.write/read/edit/list` 与 `shell.exec` 的真实副作用、路径逃逸拒绝、只读/无 Shell 授权下的拒绝、**断连即回收工具**、审计落盘、撤销授权后重新配对、同一台机器上第二实例的端口退让。

### 工具解锁 / 回收的确切时机（已实测）

`ctx.tools.register()` 注册进**宿主平面**（进程级单例 registry），而模型看到的目录是**每个 step 重新组装**的（agent loop 的 `preStep` → `systemPrompt.assemble` → `tools` provider）。因此：

- **活跃会话**：下一个 step 就拿到新工具，**不需要重启、不需要重开对话、上下文不丢**；
- **从未运行过的会话**：第一次 step 时目录里就有，且不会产生多余的提示消息；
- **回收**：dispose 之后，下一个 step 目录里就没有了；如果模型在这一瞬间刚好发起调用，得到的是一个**普通的工具错误结果**（`UNKNOWN_TOOL`），不是异常、不会挂起；已经开始执行的那次调用会跑完。
- 版本差异：**0.2.0** 会在目录变化时追加一条 `tool-addition` / `tool-removal` 开发者消息；**0.1.5 没有这个机制**，只是静默地重组目录（本机实测：注册后下一个 step 可调用，回收后得到干净错误）。功能一致，只是 0.1.5 少一条显式提示。

### 极简模式 / 仅终端

极简模式是 `minimal` **Agent 预设**（`presets/minimal/agent.cordis.yml`：一个持久 Shell + `persona.complete: true`），宿主平面完全不变，**浏览器面板照常加载**，所以面板那套交互在极简模式下可用。真正只有终端（无界面）时，DSH **没有任何终端审批回答者**（`approval/request` 的监听者只有浏览器、远程桥、ACP 三处），所以答案是本插件的**控制面工具**：`bridge_pair` 取配对码、`bridge_devices` 看谁在请求（含安全码）、`bridge_approve` 同意。宿主日志也会把每个请求连同安全码与「怎么同意」大声打出来——无界面时日志就是唯一的通知面。控制面工具的注册由 `controlTools` 策略决定（`auto` 默认：桥接在用期间才出现；`always` 供发现不到对端的纯终端环境）。


### 已知限制与未验证项（诚实清单）

1. **未在真实 macOS 上运行过**（本机无 Mac）。零依赖纯 Node 代码，但以下平台分支属"推理正确、未实测"：macOS 15+ 的「本地网络」TCC 授权（被拒绝时**静默**失败：socket 能绑定但收不到任何报文，且它也拦截到局域网地址的单播 TCP，需放行后重启 App）、`en0` 组播出接口、`/bin/sh` 行为、POSIX 进程组杀树、APFS 大小写不敏感探测。建议在 Mac 上先跑 `src/proto/selftest.mjs`。
2. **跨主机路径已在真实双机验证**（Windows 0.1.5 Agent 侧 ↔ Mac 0.2.0 桥接侧，`yixuandeMacBook-Air.local`，安全码一致，6 个工具解锁，远程 `shell.exec` / `fs.list` / `fs.read` / `fs.edit` 真实副作用）。**中转（A→B→C）尚未在两台以上真实机器上验证**：三机用例是同一台机器上的三个进程 + 真实 socket + 真实握手，链路逻辑与真实多机一致，但没有跨网段/跨交换机的实测。
3. SPAKE2 依赖子代理手写的 P-256 大整数实现：已与 OpenSSL 做差分测试、自检断言"任何猜测码都不构成曲线点"，但**不是常数时间**实现。若要更保守，可改用高熵预共享密钥 + 普通 ECDH 的 `authMode:'psk'` 路径。
4. 路径校验是"先规范化再打开"，存在固有 TOCTOU 窗口（已用 `O_NOFOLLOW` + dev/ino 复核收窄，Node 不提供 `openat2`）。
5. 信任文件以 0600 保存长期私钥，未接系统钥匙串。
6. 大文件/长输出为上限截断，无流式分块。
7. `_recon/` 下另有一份更重的策略引擎与发现实现（`src/proto/policy.js`、`src/proto/discovery.js`），**未随包发布**：它们的安全加固更强（NTFS 数据流、保留设备名、arg-argv 化 Shell 白名单、环境变量清理、多实例单播端口），但接口与本包 `lib/core/` 的已实测实现不同。若后续要进一步提高安全等级，建议以那一份为蓝本做一次受控替换并重跑全部用例。
8. **中转没有端到端加密层**：A→B 与 B→C 是两条独立加密会话，B 看得到明文。这是「B 是受信任的中转者」这一前提的直接后果；如果需求变成「B 不该看到内容」，需要另外设计端到端密封，而不是调当前协议。
9. **中转默认开启**：给某个对端授权即默认允许它通过本机到达本机能到达的设备（权限仍取两跳最小值，所以永远不会超过本机自己的权限）。这是刻意的产品选择——但它的影响面比「只授权本机」大，面板上把 中转 开关和 `relayPeers` 白名单做成了显式项，中转来的设备在工具结果里也一定会标明经由哪台机器。
10. 身份是**持久化**的（`prefs.json`），但这一版之前的安装没有存过身份：升级后本机身份回到默认 `agent`，桥接侧那台需要重新选一次。

