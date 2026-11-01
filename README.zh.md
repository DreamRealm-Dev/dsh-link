# DSH Link

[English](README.md) | **简体中文**

一个面向 **DeepSeek Harness** 的 Tauri 桌面外壳。窗口渲染**官方 DSH 客户端**，由外壳通过带鉴权的 loopback 代理提供；内核就是 DSH 本身，作为本地子进程运行。

| | |
|---|---|
| 内核 | `deepseek-ai/deepseek-harness` @ `dsh-v0.2.2-alpha.2`（tag commit `f3803c96`，补丁分支 `dsh-link/multilevel-team` @ `1ee84404fa`） |
| 外壳 | Tauri v2（Rust） |
| 界面 | 官方 DSH 客户端，未修改 |
| 版本 | `v0.1.0-experimental.1` — [发布说明](docs/release/0.2.2-alpha.2.md) |


## 项目定位

**DSH LINK** = **DeepSeek Harness Lightweight Integration Nexus Kit**，基于 DeepSeek Harness 开发的底层框架。
核心理念：**链接所需、稳定集成**。

| 字母 | 英文 | 中文含义 | 对应定位 |
| --- | --- | --- | --- |
| **L** | Lightweight | 轻量 | 不打包重型运行时，优先轻量跨全端 |
| **I** | Integration | 集成 / 联动 | 软件间联动框架 |
| **N** | Nexus | 枢纽 / 连接点 | 扩展性，围绕官方核心连接各模块 |
| **K** | Kit | 套件 | 遵循官方设计理念，是官方 Harness 的增强包，不是“另起炉灶” |

- 技术栈：React + **Tauri**（v2+）| Rust（后端）| Vite（打包工具）| 系统 WebView + Servo（根据项目
  **tauri-runtime-verso**，下一代 Rust 实现的统一 WebView 架构；跨平台引擎一致性需要提前适配，
  目前主力还是系统 WebView）。
- 首发支持系统：Windows、Linux、macOS、Android。
- 基线：当前追到 **dsh-v0.2.2-alpha.2**（持续追上游最新）；壳（Tauri 外壳）已经是一个稳定、精美的
  DSH 第三方桌面版基线。
- 组织原则：**一切皆插件，内核不动**；一个功能由一个或多个插件构成，插件间协调。要求之间有冲突时，
  找最“社区”的方法；拒绝面向结果编程，框架必须具有可迁移性；新控件符合现有设计风格（源自 DSH 自身）。

### 三大创新部件

#### 1. DSH 跨版本加载器（打通底层）

DSH 本体更新非常勤快，且容易造成“破坏性更新”，旧版插件需要做大量适配。现有方案各有短板
（`dsh-loader` 的适配器注册表、`@lanbaolu/dsh-compat` 的别名托底、`dsh-compat-guard` 的升级治理、
`dsh-plugin-compat-guardian` 的 CI 自动化），所以 LINK 做一个**跨版本插件加载器**：DSH 改名、搬家、
换用法，插件代码不用改。

- **两层接口策略**：**透传接口**（给需要精细控制的插件）——插件通过
  `dshLoader.services.get('sessions')` 拿到 DSH 原始服务对象，自己处理细节，保证能力不缩水；
  **简化接口**（给大多数普通插件）——把“多步操作”变成“一步调用”，把“复杂对象”变成“简单数据”，
  例如 `session.getRecentMessages(sessionId, limit)`、`tools.registerSimple(name, handler)`、
  `settings.define(key, defaultValue, schema)`。
- **透传接口像“翻译官”**：插件永远只认“普通话”、只看见加载器，加载器只看见 DSH；中间是一张
  “方言对照表”（每个 DSH 版本里每个能力的叫法），升级时只需在表里加一行。翻译不了就老实说
  “这个功能在当前 DSH 版本下用不了”——**不猜、不骗、不埋雷**。
- 这一层满足：插件原貌更新（DSH 升级与插件无关）、轻量（启动时查一次表就缓存好）、高性能
  （热路径上插件直接拿到翻译好的引用，没有多余转发）、高可靠（翻译不了就报明确的“不支持”，
  而不是看起来成功、实际错误的结果）。按滚动升级策略适配。

#### 2. 跨软件联动器：统一互联层（打通表层）

从“工具调用”转向“协作总线”：每个 Agent 都是一个平等的“计算节点”，协作总线就是连接它们的“灵衢”。
仍然不能脱离 Agent“调用工具”的范式（大模型限制），但已经足够——就像团队用飞书收发消息就足以沟通。
身份与信任层很重要：Agent 需要知道“我在架构中的大致位置”，lead 下发任务时可根据不同 Agent 框架/
大模型的优缺点来决定怎么派发任务。

| 维度 | 旧设计（工具调用） | 新设计（协作总线） |
| --- | --- | --- |
| **Agent 关系** | 调用者与被调用者 | 地位平等的协作节点 |
| **通信方式** | 请求-响应式 API 调用 | 异步消息传递 + 共享状态 |
| **任务模型** | 单步工具执行 | 多步、有依赖的任务 DAG |
| **团队结构** | 扁平 | 分形、可递归嵌套 |
| **故障处理** | 调用失败即报错 | 节点隔离，任务重调度 |

实现机制：

- **能力注册表**：每个 Agent 启动时声明身份与能力（`id` / `type` / `capabilities` / `parent` / `status`），
  注册表维护实时状态并支持动态发现。
- **消息总线（控制流与数据流分离）**：控制通道承载任务分配、状态更新、审批请求，必须持久化，
  写入 append-only 事件流，确保可重放、可审计；数据通道承载 token 流、中间结果等高频数据，走临时
  会话通道，带 TTL 自动过期，不阻塞控制通道。
- **共享任务板**：任务以有向无环图（DAG）存在——依赖管理（全部前置完成才就绪）、认领与锁定
  （防止多个 Agent 重复处理）、状态同步（待处理 → 进行中 → 待审核 → 已完成，经控制通道广播）。
- **故障隔离与任务重调度**：心跳超时标记 `unhealthy` → 处理中的任务释放回任务板并重置为“就绪” →
  按能力注册表重新调度 → 故障节点暂时隔离，直到恢复健康。单个 Agent 的故障不会导致整个团队任务中断。
- **分形团队结构**：根团队（Team 0）由与用户直接交互的 DSH Agent 作为 Lead；Lead 把目标拆成子任务，
  创建或招募子团队（Team 1..N，子团队 Lead 可以是 DSH Agent，也可以是 HanaAgent、OpenCode V2、
  Codex 等外部 Agent），递归拆分到单个 Agent 可直接执行。与官方 `dsh-experimental-agent-team` 一致：
  会话中的 Agent 成为 Lead，创建具名 teammate，并共享任务板。
- **三阶段**：①控制总线 + 任务板 + 能力注册表；②故障隔离与任务重调度；③分形团队与多平台 Agent 接入
  （外部 Agent 装一个小桥接插件即可被 lead 接入任意会话，也可通过 MCP 服务快速接入——MCP 略有妥协）。
- 必要时子 Agent 可向网络中的同级/上级/下级直接发消息，不经过任何中间商；通常下级 Agent 自动继承
  上级的模型选择，上级也可以指定。

#### 3. 协作互联层（打通每个单位间的联系）

**核心模块一：设备间互联。** 同一局域网下可以搜索设备，设备 A（主）连接设备 B（从）：

1. **跨端接续**：A 连接 B 的一个对话（Agent 仍跑在 B 上），A 上可以像自己创建的对话一样管理——
   只是接续，不是把任务接力到 A。不限设备类型（手机/电脑），但有服务端与接收端之分。
2. **跨端访问**：A 的 Agent 按所设置权限，通过工具访问 B 的文件并执行 pwsh。
3. **跨端组队**：A 借 B 的 DSH 作中转，把 B 上的其他 Agent（或现场创建）接入 Agent Teams。
4. **跨端连接网络**：例如 A（主）– B（从）– C/D（在 B 下且同级），A 可直接访问 C 和 D，
   **权限取最短**（A 对 B 完全控制、B 对 C 只读，则 A 对 C 只读）；沙箱能力由从设备自己的 DSH
   处理，保证安全高效。

**核心模块二：Agent Teams 协作。** Agent 间通过工具交流（如 `send_message`），该模块允许用户深度参与
这种交流：一站式查看 Agent 集群及进行中的交流、任务认领情况，可以配合 lead 指挥，也可以直接要求 lead
（前端控件符合 DSH 风格）。自由交流模式：假设一个 DSH 实例存在两个不同规模的 Teams（A 和 B），
A 可以和 B 交流，哪怕工作不相干——第一步只能是 lead 间（像两国领导人通话，A 的 lead 借工具发现 B 团队
的存在并发起申请，B 的 lead 同意后才能进行对应行为；首次“握手”之后，lead 可指派专 Agent 交流，
被指派的 Agent 具有相应工具使用权）；工作相干时 A 可以招募 B，也可以选择被 B 招募。工具调用的 Agent
模式决定发消息的“用户”只能有一个，但工具的引入可以让 AI 区分“谁是谁”（DSH 内置 Agent Teams 就是
为模型量身定做的，互相成就）。

设备网不是“只能选一种”，还可以在设备网中继承：只要是 DSH-LINK，或安装了 DSH-LINK 连接插件的其他
Harness，没什么是不能连的。

### 其他能力（规划/进行中）

Markdown 编辑器（对标 Obsidian、像 HanaAgent 一样高审美、为 Agent 场景量身打造，支持公式、流程图等
常见附属格式，接入右侧边栏）；更完善的互联面板；手机版 DSH-LINK（不内置内核，Rust + React + Tauri，
可将电脑的 DSH 连到手机、让 Agent 只读访问手机文件、把手机当麦克风/摄像头，均需授权）；聊天模式
（丢掉工具与审计，联网由用户主导是否在下一轮开启）；工具的开放与收回（开/关之外的“自动”第三态、
工具组、激活工具、按需自动开放）；provider 路由插件（自写，支持 opencode go/go plus、command code
等，并支持用户自定义更多服务端点）；Auto review 权限选项调研；界面汉化与图标补全（统一风格、多样
图标、深/浅适配）；响应式布局；升级（内核随 DSH-LINK 分发；DSH-LINK 升级不丢对话、不缺失功能、
能正常启动）；插件生态接入（官方与第三方插件市场，主题/交互小窗/上下文管理类插件的兼容性）。

### 坑与不变量（摘要）

- Cordis 的 inverse 是单侧、局部的：发送消息、写文件、网络请求、浏览器操作、跨设备执行 pwsh 属于
  emission，不能完整撤回——只能 withhold、compensation，或 reify 成 coeffect 再管。
  “不回滚”可以，但必须显式设计（补偿 / 前滚 / 隔离丢弃 / 外置持久化 / 软删除墓碑 / 重调度 /
  版本级回滚 / 重启宿主）。
- 持久化要“外置到 **Fiber 生命周期之外**”（不是必须外置到 DSH 之外）：对话历史、任务板 DAG、控制通道
  消息、便条、设备配对/权限、审批/审计、插件配置必须持久化；数据通道消息、心跳、在线状态、UI 临时
  状态、缓存可以不持久化。优先复用 DSH 已有的会话存储、配置存储、插件状态存储，并把持久化本身做成
  coeffect provider（如 `session.store`、`task.board`、`note.store`），其他插件通过 `ctx.get(...)` 读写。
- 身份与信任层：Agent 身份 = fiber uid + provider key + capability manifest；信任 = interception
  metadata + provider 策略；上下级 = parent fiber + provider 依赖。

## 本仓库的发布范围（实验版）

这是 **v0.1.0-experimental.1** 的源码发布，内核基线 `dsh-v0.2.2-alpha.2` + LINK 补丁系列，已在本机
跑通（构建、类型检查、双包测试、兼容门、实机 e2e；读数见 [发布说明](docs/release/0.2.2-alpha.2.md)）。

- 内核不是 vendored 源码：按上面“Building and running”一节拉取 pin 的 tag 并按序应用
  `docs/kernel-patches/` 里的补丁。
- **不含**内部工作文档、提示词与第三方插件分析归档（`docs/handoff/`、`docs/drss/`、`docs/frontend/`、
  `docs/codex/`、`.opencode/`、`compat/adaptation/` 等不在发布范围内）；这些材料包含本机路径与内部
  过程记录，不属于产品源码。
- **不含**任何第三方插件的代码或密钥：第三方插件（例如 opencode 路由插件）由用户在自己的 profile 中
  安装，其 API key 等属于 `DSH_HOME` 运行期数据，不在本仓库。
- 构建产物、运行数据、`.tmp/`、`node_modules/`、`src-tauri/target/` 等均在 `.gitignore` 内。

## 施工坑位

[docs/PITFALLS.md](docs/PITFALLS.md) —— 踩过的坑，每条带判定命令与修法。**先读第 1 条**：在 DSH
会话里编译出来的 exe 会被打上「低完整性」标签，托盘图标与窗口创建会因此静默失败。

## 为什么用官方界面

DSH 的前端插件 —— `dsh-chat-mode`、`dsh-svg-studio`，以及任何基于 `dsh.client` 构建的插件 —— 通过
官方客户端的 slot 系统扩展界面。从零画的界面没有 slot，所有插件对它不可见；加载官方客户端，才是插件
生态能生效的原因。

外壳只保留官方客户端自己无法提供的东西：窗口、内核进程、会话凭据，以及一种报告「内核起不来」的方式。

## 目录结构

```
src-tauri/                    Rust 外壳 —— 本项目自己代码的全部
  src/core/locator.rs         定位内核 checkout 并证明它可运行
  src/core/profile.rs         DSH_HOME 布局、overlay 种子、profile-patch 种子
  src/core/session.rs         launch-token 捕获与 cookie 交换
  src/core/proxy.rs           内核整个 HTTP 面的反向代理
  src/core/bridge.rs          注入 index 的客户端 bridge
  src/core/pnpm.rs            内置包管理器及其 shim
  src/core/update.rs          从本项目 GitHub releases 自更新
  src/core/shellpage.rs       内核未就绪时的启动/恢复页
  src/core/supervisor.rs      子进程监督
  src/lib.rs                  装配：绑定代理、启动内核、托盘、更新
core/deepseek-harness/        内核（pin 的 checkout，严禁手改）
plugins/                      Theme 区、Liquid Glass 材质，以及
  build.mjs                   桌面版移植，作为 dsh profile bundle
  dsh-liquid-glass/           液态玻璃（纯 esbuild，只有主题）
  dsh-theme-settings/         Theme 区 + 持久化偏好（host 与 client 两半）
  dsh-image-guard/            桌面版移植：图片数量硬上限
  dsh-escalation-guard/       桌面版移植：sandbox 热修，做成运行时 guard
  dsh-agent-context/          桌面版移植：委派工具
  dsh-browser/                桌面版移植：browser_* 工具
  dsh-lan-bridge/             桌面版移植：局域网桥（根层 bridge_* 工具）
  dsh-delegation-model-choice/ 桌面版移植：跨模型委派
  dsh-anchored-lite/          桌面版移植：按需工具锚定
  dsh-continue-button/        会话的「继续生成」按钮（client 半）
  dsh-link-mods/              挂载行与两个移植的 agent preset
dist/index.html               仅打包兜底；窗口实际加载代理
scripts/                      CDP 截图、代理探测、e2e、各验证脚本
```

## 为什么需要代理

两个原因，只有第二个是显然的。

**Cookie。** DSH 0.2.x 对**每个**路由（包括 `/api`）鉴权：启动时内核打印一行
`dsh web: http://127.0.0.1:31760/?token=<launch token>`；`GET /?token=…` 返回 `303` 加一个签名 cookie
（`HttpOnly`、`SameSite=Strict`、绑定请求 authority）；之后每个请求都必须带这个 cookie，没有就 `401`。
浏览器自己做不到：`Cookie` 是禁止的 fetch 头，cookie 也无法从 JavaScript 读取。官方客户端靠 Electron
外壳通过 Node IPC 在带外持有 cookie —— Rust 做不到，所以外壳自己完成交换，并在上行时附上 cookie。

**单一 origin。** 代理在自己的根上镜像内核整个 HTTP 面：index、每个 bundle、`/api` unary 调用，以及
WebSocket 下行。于是页面与 API 同源，不需要放宽 CORS、不需要 remote-domain IPC opt-in，CSP 可以保持严格。

客户端永远不知道内核的地址和凭据，它只看到 `http://127.0.0.1:31761`。

镜像里有两个细节是承重的：index HTML 必须逐字节转发（内核宿主会把 `window.__DSH_BOOT__` 模块清单写进
去，没有它客户端无处启动）；构造上游 URL 时 path 与 query 必须分开设置（客户端 bundle 形如
`plugins/??@deepseek-ai/dsh-client-<name>/client.js&rev=<hash>`，其中 `??` 是 *path* 的一部分；拼在一起会
把 `?` 百分号编码，所有插件 404，表现为「Failed to load plugins」而不是路由 bug）。

## 客户端 bridge

官方客户端把每个 Desktop-only 面都压在一个页面全局 `window.dshDesktop` 上：账号登录、登录奖励提示、
账号额度提示、账号设置页、首启引导。Electron 桌面端从 preload 提供它；通过 HTTP 提供的页面没有 preload，
所以代理改为向 index 注入一段同源脚本（`core::bridge`），内核字节其余部分原样转发。

脚本安装的正是官方 preload 给非自有 frame 的那份 stub —— `{ protocolVersion: 1 }` —— 外加代理无法提供的
两件事：外部链接要交给系统浏览器；官方引导要问模型凭据是否已配置。这里不授予任何凭据或 IPC 面：出现的
账号操作走内核自己的 Remote API，Web profile 本来就挂载了它。

| 端点 | 用途 |
|---|---|
| `GET /__shell/bridge.js` | 注入脚本 |
| `GET /__shell/has-api-key` | 某个凭据引用是否持有值 |
| `POST /__shell/open` | 在系统浏览器打开 http(s) 链接 |

两条策略放在同一处，因为代理没有 window-open handler、也没有安装身份可依赖：

- **每个外部链接都交给系统浏览器。** 账号页的 Platform 链接、用量与充值链接、奖励提示里的链接和反馈
  入口都是 `target="_blank"` 锚点，它们从不调用 `window.open` —— 它们向 webview 要一个新窗口。两条路径
  都被围住：注入脚本路由 `window.open`，窗口构造器在把 http(s) 交给 OS 后拒绝 `on_new_window`。没有第二
  条，客户端的链接会打开**本应用的第二个窗口**，显示别人的页面。
- **账号菜单的反馈入口被移除。** 它通向 DeepSeek 自己的问卷，而本安装不是 DeepSeek。注入脚本在菜单渲染
  时删掉该行，并吞掉仍落到它上面的点击。

登录随后按内核已实现的方式工作：客户端展示带 Platform 授权链接的对话框，内核轮询 Platform 结果。
该链接**只复制、不自动打开**：官方桌面端在主进程里一有尝试就打开，于是登录会霸占桌面；这里 URL 只被
读出并放进剪贴板，窗口留在原地，用户自己决定何时去浏览器。

分界因此是：**点击才会打开，其他一律不打开。**

## 包管理器

`dsh plugin add` 会调用 pnpm，桌面安装不能假设机器上已有它。外壳随包携带 pnpm 自己的 bundle
（`scripts/fetch-pnpm.mjs`，gitignored），并以内核的两种方式交给它：生成的 `--patch` overlay 把 shim 命名为
插件管理器的 `pnpmCommand`，子进程的 `PATH` 带上同一个 shim 供其他调用者。没有 bundle 的安装退回 PATH
上的 `pnpm`，与无外壳的内核行为一致。

overlay 每次启动都重写（`DSH_HOME/dsh-link.runtime.patch.yml`），因为它描述的是外壳自己 bundle 的位置 ——
安装事实而不是偏好；用户自己的 `dsh-link.patch.yml` 从不被碰。

## 自更新

托盘的**检查并安装更新**读取本项目的 GitHub releases，挑出带本平台资产的最新 release，带续传下载，并
交给一个分离的 helper：等本进程退出后安装并重启。发布一个 GitHub release 就是全部发布步骤。

```sh
dsh-link.exe --check-update                      # 托盘项会做的事
DSH_LINK_UPDATE_REPORT=report.txt dsh-link.exe --check-update
```

| 变量 | 用途 |
|---|---|
| `DSH_LINK_UPDATE_REPO` | 读取的仓库，`owner/name` |
| `DSH_LINK_UPDATE_API` | release API 根，用于镜像或测试 |
| `DSH_LINK_UPDATE_REPORT` | 同时把结果写到该文件 |

## 窗口、托盘与启动面

关闭窗口只是隐藏到托盘，只有托盘的「退出」才结束进程（退出时 supervisor 会停止内核）。窗口随窗口结束
的外壳无法在后台维持长会话。

窗口在任何页面渲染前就上色，而 WebView2 的默认是白色 —— 深色模式下每次冷启动都是一记闪光。外壳因此读取
系统外观、涂上与客户端启动遮罩相同的表面，并把 webview 主题钉在同一读数上。代理也在**窗口创建之前**绑定，
否则窗口的第一个请求到达空气，webview 会画自己的连接错误页。

### 窗口的圆角

窗口无边框且透明，圆角由 `src-tauri/src/core/frame.rs` 注入的文档绘制。那是一个形状而不只是半径：
`--dsh-shell-corner-shape` 携带 `superellipse(1.5)`，`#dsh-shell-surface` 通过 `corner-shape` 穿上它；
圆形 `inset()` 裁剪按定义是圆的、无法跟随该形状，所以 frame 脚本按半径、形状和窗口尺寸生成 `path()` 并
由此裁剪 body。画不了连续圆角的引擎保留圆形回退。

## 端口

| 用途 | 端口 |
|---|---|
| 内核（`dsh web`） | `31760` |
| 外壳代理 —— 窗口的 origin | `31761` |

选这两个端口是为了避开本机其他 DSH 安装（官方 Electron 客户端用 `3080`；`<workspace>\-studio` 用
`31750`/`31751`）。

## 构建与运行

```sh
npm run setup          # 内核安装 + 内核构建（较久，一次即可）
cd src-tauri && cargo run
```

没有前端要构建、没有 dev server：窗口加载代理，官方客户端的 bundle 来自内核。`npm run tauri:build` 打包外壳。

内核是源码 checkout，所以新 clone 在 setup 之前没有依赖、没有构建好的 web 前端；外壳会报告缺哪一步而不是
静默失败。

新 clone 同样没有内核 checkout：它是 pin 的上游树加本项目的补丁系列，不是 vendored 源码。先取 pin 的 tag
并按序应用补丁，再跑 `npm run setup`：

```sh
git clone --depth 1 --branch dsh-v0.2.2-alpha.2 https://github.com/deepseek-ai/deepseek-harness.git core/deepseek-harness
cd core/deepseek-harness
git apply ../../docs/kernel-patches/R484-multilevel-team.patch
git apply ../../docs/kernel-patches/R459-page-nav-bridge.patch
git apply ../../docs/kernel-patches/R501-b2-event-window.patch
```

`docs/kernel-patches/README.md` 记录 rebase/刷新流程；`R510-draft.patch` 是未应用草稿，需先按当前 base 重做。

## 恢复

内核启动整个官方 web profile，首启较慢。在它持有会话之前，代理用自带的启动页（`/__shell/`）回答窗口的根
请求，该页轮询 `/__shell/status` 取阶段、pid 与路径，内核就绪后 reload 进客户端。启动失败时页面显示失败
与 `DSH_HOME/boot.log` 路径（内核输出镜像在此，launch token 已脱敏）。

## 扩展内核

`DSH_HOME` 保存内核的会话、设置、凭据、skills 与插件状态，首次启动时种下：

- `dsh-link.patch.yml` —— 作为 `--patch` 传给加载器的 cordis overlay。加载器要求它是**顶层 YAML 数组**，
  所以种子以 `[]` 结尾；纯注释文档会解析成 `null` 而被拒。
- `settings.yaml` —— 内核自己的设置文档，热加载。
- `.agent-presets/` —— 可写的 agent-preset 根。

外壳还会一次性种下 profile **自己的** patch 文档（`profiles/web/cordis.patch.yml`），内容为
`session-log-deepseek: enabled: false`：上游默认会随 DeepSeek API 请求上传 Session Log，而那个文档正是设置
表单写入的那份，把它种在那里能保持 Settings → General 的开关可用。

## 主题区：控件风格

Settings → **主题 / Theme** 提供**控件风格 / Control style**：客户端自带材质，或 Apple 的 Liquid Glass ——
iOS 18 → iOS 26 的变化，应用在控件而不是整个界面。切换是 `<html>` 上的一个属性、一份样式表，不 reload；
切回则移除两者。

它以 `plugins/` 下两个普通 profile bundle 到达：`dsh-liquid-glass`（browser 半：材质引擎、样式注册表、受门
的样式表、折射滤镜）与 `dsh-theme-settings`（Host + browser 半：Theme 区、持久的 `controlStyle` 偏好）。
两者只通过官方扩展点触达客户端：`settings.section` 注册、settings 文档（行的 `Config` schema）、以及绑定在
客户端自己的 `data-slot` 钩子上的 CSS。会话内部不改样式，背景仍是客户端自己的近黑色；材质唯一改动的几何
是侧栏列的 gutter，这才让面板读起来像浮起。玻璃永不嵌套玻璃。

```sh
node plugins/build.mjs --check              # lib/ 不陈旧
node scripts/verify-theme-section.mjs       # Theme 区，双向，走 CDP
```

## 移植桌面版自带插件

本项目替换的第三方桌面壳（`<install-dir>`，dsh `0.1.5-rc.1`）带有若干自制插件与
agent preset（`H:\mod`）。它们被原样移植进 `plugins/`，通过 `dsh-link-mods` bundle 挂载；
`plugins/dsh-link-mods/README.md` 有逐插件的兼容性说明、安装路径，以及反重复套件所需的唯一一条
`dsh plugin allow-version` 豁免。

移植吸收了两个结构性变化：

- **Preset 从目录变成声明。** 0.1.x 通过 `.agent-presets/<id>/` 目录发现 preset；0.2.x 去掉了目录发现，改为
  由 `@deepseek-ai/dsh-agent-preset` 声明行（随 bundle patch 携带）组合。桌面版两个自制 preset
  （chat-mode、minimal-tuned）因此作为 `plugins/dsh-link-mods/presets.patch.yml` 里的声明到达。
- **Sandbox 热修变成插件。** 桌面版在每个安装上修补 shipped 的 `@deepseek-ai/dsh-sandbox` lib，让非加宽的
  `sandbox_permissions` 请求按有效模式执行而不是失败。本 checkout 保持不打补丁；`dsh-escalation-guard` 在
  `tools/execute` 接缝处复现该语义。

**挂载状态（2026-10-07 更正）**：上述四行曾以 `disabled: true` 列在 `dsh-link-mods` 中，但其中三个是
**死标志**：每个插件自带 bundle patch，会以相同 id 再次插入而不带 `disabled`，且排在 bundle 顺序更后面，
而加载器的 entry store 按 id 键 —— 后面的行覆盖前面的。实测而非假设：活内核的 `boot.log` 显示 lan-bridge
host service 启动，工具面在有/无这些标志时逐字节相同。所以 agent-context、lan-bridge、
delegation-model-choice 一直挂着；**只有 browser 真的被禁用**（它没有自己的 bundle patch），2026-10-07
已启用（读数见 `docs/handoff/...` 历史记录：工具 6 → 20，其中 14 个 `browser_*`）。死标志与重复行已清掉。

## 验证

一条命令跑本项目所有门：

```sh
node scripts/verify-all.mjs           # 现在能跑的全部；跳过的 LIVE 门以非零退出
node scripts/verify-all.mjs --live    # 不能跑就是失败，不是跳过
node scripts/verify-all.mjs --allow-skipped-live   # 仅离线的活：列出被跳过的 live 门并接受
node scripts/verify-all.mjs --only compat-table,interconnect
```

每个门报 PASS / FAIL / SKIPPED-LIVE，不能跑的门从不算 pass。live 门拒绝测量时退出 3，映射为
SKIPPED-LIVE。**跳过的 live 门是 FATAL**。尾部打印 `live: R ran / K skipped of N` 与 `policy:` 行，
只有 `--allow-skipped-live` 会刻意接受跳过。同一轮还会拒绝「存在但未登记在门列表里」的
`scripts/verify-*.mjs`。

每个门也可单独跑（请见英文版 README 的完整清单与说明）；常用门包括
`verify-baseline.mjs`（内核未被编辑且在锁定 commit）、`verify-compat-table.mjs`（每个能力按其内核表
resolve/translate/refuse）、`verify-interconnect.mjs`（LAN bridge 套件、grant 格、relay cells）、
`probe-proxy.mjs`、`e2e-session.mjs`、`verify-theme-section.mjs`、`verify-accept.mjs`、
`verify-radius-audit.mjs`、`probe-composer-fade.mjs`、`verify-tray.ps1` 与 `cargo test`。

## 本机注意事项

- 本机 cargo 需要 `CARGO_HTTP_CHECK_REVOKE=false`：配置的 registry 镜像做证书吊销检查会失败
  （`CRYPT_E_REVOCATION_OFFLINE`）。
- 不要用 PowerShell 的 `Set-Content` 编辑 Rust 源文件；它会写 ANSI 并破坏 UTF-8 注释。
- 在命令行手动跑内核时设置 `DSH_HOME`：本机有多个 DSH 安装，各自有 home；从别的客户端继承的 `DSH_HOME`
  会让 `--dump-config` 描述那个安装的 profile 而不是本项目的。

## 许可

`core/deepseek-harness` 下的内核是 MIT，© DeepSeek。本项目自己的源码是 MIT。

**品牌素材是另一件作品。** DSH Link 的标志、字标与图标底板不是 MIT，而是 **CC BY-NC-SA 4.0**，
放在独立仓库 <https://github.com/DreamRealm-Dev/dsh-link-brand>。本仓库内的该素材副本
（`plugins/dsh-link-brand/assets/`、`src-tauri/icons/` 的位图产物、启动页标志）仍适用该许可，
不是 MIT。范围、署名与商标规则见 [BRAND-ASSETS.md](BRAND-ASSETS.md)。
