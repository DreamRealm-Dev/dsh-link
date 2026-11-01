# dsh-lan-bridge

DSH 局域网桥接插件：把同一局域网里的 DSH 接起来，让一端（**Agent 侧**）的 AI 直接操作另一端（**桥接侧**）的文件与 Shell，用于双机调试。

- 连接入口在 **侧边栏左下角**（「设置」旁边的「连接」按钮）。
- 身份只有两种：**Agent 侧 / 桥接侧**（`双侧` 已取消——现在任何身份都能同时连出多个设备、也能同时被多个设备连入，身份只决定默认姿态）。身份与「可被发现」会持久化。
- Agent 侧自动发现设备；选择设备后 **桥接侧点同意** 即可建立信任（同意界面是右上角的**应用内通知卡片**，面板关着也会弹）。
- **多设备**：可同时驱动多台设备，工具用可选的 `device` 参数区分；断一台不影响其他。
- **中转**：A 连 B、B 连 C，则 A 能直接调用 C 的工具，**权限取两跳的最小值**（能力取交集、上限取更小、目录用远端那台）。每个节点都追加 `$relay.path` 防环，跳数上限默认 3。
- 连接后 Agent 侧自动解锁 6 个远程工具（标准 / PTC / 创造 / 极简模式都会出现，因为工具注册在宿主平面），另有 5 个控制面工具在桥接「在用」时出现。
- **断连自动回收工具**：会话上下文保留、无需重开对话、本地工具不受影响。
- **极简模式 / 仅终端**：没有面板时，那 5 个控制面工具就是全部界面（`bridge_pair` 取码、`bridge_devices` 看请求、`bridge_approve` 同意），宿主日志也会大声打印请求与安全码。
- 权限设置继续生效并继承：完全访问直接执行，否则走 DSH 审批；`never` 策略下返回可读的拒绝原因，绝不静默绕过。
- 零运行时依赖（只用 Node 内置模块），不需要联网或构建。
- 安全：Ed25519 长期身份 + X25519 临时密钥 + **SPAKE2 配对**（不存在针对 6 位配对码的离线爆破）+ AES-256-GCM 会话 + 重放窗口 + TOFU 钉扎 + 路径规范化 + 桥接侧可撤销授权 + 中转取最小权限 + 审计日志。

## 交付内容

| 路径 | 说明 |
|---|---|
| `dist/dsh-lan-bridge-0.2.0/` | 在 DSH 0.2.0 上安装（macOS 用「从文件夹导入」） |
| `dist/dsh-lan-bridge-0.1.5/` | 在 DSH 0.1.5 上安装（Windows 社区版，profile bundle） |
| `docs/INSTALL-zh.md` | **安装与使用说明（先看这个）** |
| `docs/ARCHITECTURE.md` | 架构、协议、安全模型、跨版本演进 |
| `docs/MULTI-DEVICE-CONTRACT.md` | 身份 / 多设备 / 中转 / 快照 v2 的**冻结接口契约**（改代码前先看这个） |
| `lib/` | 插件全部代码（主机侧 + 浏览器侧 + 线路层） |
| `test/` | 8 套测试 + 端到端验证（见下方） |
| `_recon/` | 对两个 DSH 版本内部机制的侦查报告与原始证据（不随包发布） |
| `src/proto/` | 线路层原型与其独立自测（`lib/core/` 中 `frame/crypto/link/p256` 与之逐字节一致） |

## 安装

见 [`docs/INSTALL-zh.md`](docs/INSTALL-zh.md)。一句话版：

- **0.2.0（Mac）**：侧边栏「插件」→ 添加插件 → 「包名或地址」里粘贴插件文件夹的绝对路径 → 安装 → 立即启用 → 重启 DSH。
- **0.1.5（Windows）**：profile 的 `package.json` 加 `"dsh-lan-bridge": "link:<绝对路径>"` 并追加到 `dsh.profile.bundles` → `pnpm install` → 重启 DSH。

> **升级后要做一次的事**：身份现在是持久化的，但旧安装没存过身份，所以升级后本机身份回到默认的 **Agent 侧**。作为被操作的那台，请选一次 **桥接侧**，之后就会记住。

## 验证

```powershell
# 线路层：48 项 + 1 跳过（分帧、SPAKE2、重放、路径逃逸、伪装报文…）
cd src\proto; node selftest.mjs

# 桥接侧执行器：17 项（原子写、编辑语义、超时杀进程树、权限拒绝…）
node test\selftest-exec.mjs

# 浏览器侧面板：64 项（槽位注册、多设备列表、中转标记、通知弹窗、旧主机降级、LINK 面板贡献项…）
node test\client-smoke.mjs

# 双服务端到端：60 项（发现→拒绝→配对→同意→远程读写改/Shell→越权拒绝→降权→断连回收）
node test\e2e-twohost.mjs

# 三机中转：88 项（A→B→C 真实握手，权限取两跳最小值，min 上限，目录取远端）
node test\relay-three-host.mjs

# 中转安全：121 项（A→B→A 与 A→B→C→A 防环、跳数上限、伪造 op 后缀、relayPeers、
#                    取消传播、子树被杀干净、跳数不塌缩）
node test\relay-safety.mjs

# 多设备：79 项（两条并发链路、resolveTarget 语义、逐台断开、toolsAvailable 翻转时机）
node test\multi-device.mjs

# 工具回收：36 项（0/1/多设备下的注册与回收、授权刷新不抖动、飞行中的调用干净失败）
node test\reclaim.mjs

# Lead 自用的四个探针：三机中转 / 调用方超时 / 宿主崩溃回归 / 身份持久化
node _test\relay-smoke.mjs
node _test\cancel-smoke.mjs
node _test\crash-smoke.mjs
node _test\identity-smoke.mjs
```

合计 **518 项检查，0 失败**（外加线路层 48 项 + 1 项 POSIX-only 跳过）。
另外在**真实 DSH 0.1.5 宿主进程**里验证过挂载：用隔离 profile 起宿主后 `/dsh-lan-bridge/health` 返回
`hostBuild 2026-10-04.1 / role agent / accepts false`，围栏路由无 cookie 返回 401，控制面 5 个工具按配置注册。

跨应用验证（真实的 DSH 0.1.5 ↔ DSH 0.2.0 两个宿主进程，36 项）需要先按 `_test/boot015.ps1`、`_test/boot020.ps1` 起两个测试宿主，再运行 `node test/two-host-real.mjs <agentBase> <agentDshToken> <bridgeBase> <bridgeDshToken> <授权根目录>`；结果留存在 `_test/verify-two-host-real.txt`。

## 面板贡献（LINK 面板的「连接状态」项）

DSH 的 LINK 面板（`dsh-link-panel`）在客户端面发布一个服务 `linkPanel`：`declare(definition)` 注册一项、返回撤下它的 disposer。本包**贡献一项** —— 就是它自己那条连接读数：

| 字段 | 值 | 说明 |
|---|---|---|
| `id` | `dsh-lan-bridge:connection` | 带包名，别的包不会撞上 |
| `kind` | `status` | 面板闭集里那个「人不用打开就该看见的状态」 |
| `source` | `dsh-lan-bridge` | 这一项属于谁 |
| `order` | `20` | 低于面板自己的 guide 条目（40）：贡献项不抢第一个位置 |
| `title` | `function () { return t('panel.item.title') }` | thunk：改语言时重新读（座位自己的 copy 规则：Thunked copy，read again） |
| `body` | `function () { return <本包既有的连接读数> }` | thunk：每次投影重新读；读数一变**还要**调面板接缝的 `notify()` 让面板重投影（见下），**不用**重新 declare |

**正文不是新数字**：它取的是页脚/面板已经在画的那条读数（`footerText` + `dotState`，同一个 store、同一份主机快照）。读失败时显示主机自己的错误原文，还没读到时显示「连接读数还没回来」，**都不显示 0**（0 会被读成「没连上」）。

### 读数一变，怎么到面板上（事件，不是轮询）

两个字段都是 thunk，面板**每次取投影**都会重新读 —— 但面板不会凭空去取：**被叫到**才取。所以本包在 declare 之后**订自己的 store**，store 一变就调接缝的**具名刷新路径** `notify()`：

- **一次 store 变化 = 一次 `notify()`**：store 自己的通知（`setSnapshot` / `setError` / `setNotice` / `begin` / `end` 都走它）→ 本包的回调 → 接缝的 `notify()`。自检 **G8** 用 recording seam 数这条读数（一次变化一次计数），并同时断言这不是轮询 —— 见下一条。
- **这一段一个定时器都没加**。该通知的那一刻 store 自己知道 —— 本包既有的 1500/3000 ms 轮询把新快照写进 store，**那一次写就是那一刻**。再叠一个定时器只是多一个时钟去猜同一件事，读数与画出来的那一行会互相追尾（R191 的教训）：刷新由**事件**触发，不由**节奏**触发。
- **`notify()` 不是重新 declare**：还是那一项、那一个 id，面板重投影后拿到的是**新读数**（面板自检 **P13** 钉住这一点：同一个 claim，读数变了之后再次 `entries()` 拿到的是新值）。
- **订阅与项同生共死**：这段 store 订阅挂在 `declarePanelItem` 返回的**同一个 disposer** 上（它由 `ctx.effect` 的清理调用），而且**先解订阅、再撤项目**：项撤下之后，store 再怎么变都不该再叫醒面板 —— G8 同样钉住这条（disposer 之后 `notify()` 计数不再变）。
- **老面板没有 `notify` 不报错**：接缝上没有 `notify`（或它不是函数）时，本包照样声明、照样更新自己的标记，只是不去叫它。

### 键表（本包自己的 locale 命名空间 `dsh-lan-bridge`）

| 键 | zh | en |
|---|---|---|
| `panel.item.title` | 连接状态 | Connection status |
| `panel.item.pending` | 连接读数还没回来 | the connection reading has not arrived yet |
| `panel.item.error` | 读数失败：{detail} | reading failed: {detail} |

字典经**内核的 locale 服务**注册（`ctx.locale.register('dsh-lan-bridge', { zh, en })`，注册绑在 `ctx.effect` 的生命周期上），贡献项的文案全走 `t()`；zh/en 键集相同、且与产物里 `t()` 用到的键逐字相同 —— 两条都由自检 G2/G5 钉住（删一个 zh 键 ⇒ G2+G5 必红，实测）。

⚠ **具名欠账**：包里既有的其它文案（页脚与面板那 266 条中文成对手写）今天仍走包内自己的 `pick(zh, en)`，**没有**改成 `t()`。所以本包是「读 locale 服务 + 自持一套文案」的第四种形态，不是「文案全走字典」的 A 档。

### 服务缺席时的行为（fail-closed）

页面里**没有** `linkPanel` 服务（或它拒了这一项）时：

- **不抛**：`apply()` 照常返回，页脚、浮层面板、通知卡片三个槽位照常注册 —— 一个没有面板的页面不会被这一项拖垮（`ctx.effect`/`ctx.get`/`declare` 三处都捕获）。
- 只有本包**自己**的标记说话：`globalThis.__dshLanBridgePanel = { mounted, id, kind, source, ns, declared: false, title, body, failed: 'linkPanel-unavailable: …' }`（`failed` 具名；被拒时是 `linkPanel-declare-refused: <原文>`）。面板自己的标记 `__dshLinkPanel` 本包**一个字都不写**。
- 自检 G4 就是这条：无服务 ⇒ `apply()` 不抛、三个槽位都在、标记 `declared === false` 且 `failed` 具名；让缺席路径抛出来 ⇒ G4 必红（实测）。

### 这一半是怎么构建的（事实，不是承诺）

`lib/client.js` 是**手写的** `window.__ModuleLoader__.load(...)` bundle，**不在** `plugins/build.mjs` 的插件清单里 —— 构建链**不会**重新产出它，既有的 `node plugins/build.mjs --check` 既不含本包、也不是本包的验收：改这一半就是直接改产物。同一事实也记在 `docs/dev/client-plugin-mount.md`（那一页写的是改前字节数 `153119B`，本轮改过 ⇒ 那个数字已过期；那一页不在本包的写范围里）。

## 重新打包

```powershell
node tools\build-dist.mjs   # 校验两个 dist 的插件文件集完全一致，并校验 bundle 行用的是裸包名
```

## 已知限制

- **未在真实 macOS 上运行过**（本机没有 Mac）。线路层与执行器在 Windows 上全部通过；macOS 首次使用需放行「本地网络」权限（被拒绝时是静默失败），详见安装文档第 6 节。
- 大文件与长输出是「上限截断」，暂无流式分块。
- 同一台机器上跑两个实例时，第二个实例的 TCP 端口会退让到随机端口（发现报文会广播真实端口）。
