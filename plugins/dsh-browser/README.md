# dsh-browser

DSH 的**常驻浏览器能力**：host 平面 Cordis 插件 + 右侧栏面板，向所有会话注册 `browser_*` 工具，用真实浏览器（默认就是壳右侧栏那块面板）完成「看 → 判断 → 真实鼠标/键盘操作」。

## 为什么是 host 平面

`tools` 注册表是分层的：`schemas(scope)` 合并所有**继承层**，保留每一层都 `admits()` 的工具，再叠加本 scope 自己的注册。把行挂在 **host composition** 上，注册就落在根层，每个 agent scope 都继承 —— 于是**任何会话、任何 preset 都直接拥有这套工具**，无需改动或复制任何 preset。已验证：本会话的 `Tool.listTools` 列出全部 18 个 `browser_*`（R184：14 → 18）。

## 为什么它能启动浏览器（而 pwsh 工具不能）

插件跑在 DSH **宿主进程**里，不是工具沙箱。Chromium 的 Mojo IPC 需要命名管道，沙箱会拒绝（`platform_channel.cc: Check failed: 拒绝访问 (0x5)`），所以 `pwsh` 工具调用起不了 Chrome；host 平面的包可以。这就是它是「包」而不是「脚本」的唯一原因。

代价要说清楚：**宿主进程启动的浏览器不受工具文件沙箱约束**。因此 **chrome 通道**的每个实例使用独立 profile（`$DSH_HOME/.dsh-browser/profiles/<id>`），不碰你日常的 Chrome 配置。（panel 通道不生成 profile：那块面板用的是壳自己的那一份。）

## 两种输入模式（重要）

| 模式 | 工具 | 说明 |
| --- | --- | --- |
| 坐标模式 | `browser_shot` → `browser_click {x,y}` | 纯视觉。视口钉死，**截图 1 像素 = 1 CSS 像素 = 点击坐标**。适合「禁止读取网站源码」的场合。 |
| 控件模式（主力） | `browser_controls` → `browser_pick {n}` | 把页面可交互控件压成极短的编号 JSON，可选带编号截图；按编号点击。省 token、不怕控件漂移。 |

控件模式读的是页面**交互结构**（标签、ARIA role、无障碍名、包围盒），不是源码。要严格「不读页面结构」时用坐标模式。包内**没有**任何返回页面文本/源码/存储的通道。

### 编号点击为什么稳

- **快照绑定**：`browser_controls` 返回 `snapshot=b1:3`，`browser_pick` 必须带上它；页面变了就报 stale 而不是猜着点。
- **抖动**：点击落在控件自身包围盒的**内缩随机点**（绝不贴边），并分两步逼近 + 随机按压时长，既像人也不怕小范围几何漂移。
- **离屏过滤**：视口外的控件不列出（先用 `browser_scroll` 滚过去）。
- 覆盖 `a[href] / button / input / select / textarea / summary / contenteditable / role=button|link|checkbox|radio|switch|tab|menuitem|option|combobox|textbox|searchbox|slider|spinbutton|treeitem / [onclick] / [tabindex]`，并自动丢弃「被更具体后代覆盖的祖先」，避免点到外层容器。

## 两条通道（先读这条，剩下的才读得对）

| 通道 | 什么时候 | 世界长什么样 |
| --- | --- | --- |
| **panel**（默认） | `DSH_BROWSER_PANEL` 不是 `0` | **一个**浏览器：壳的右侧栏面板（就是用户看着的那一栏）。它**有标签**：每标签一个原生子窗、`MAX_TABS=4`、恰好一个摆在内容区、其余停靠屏外。`browser_*` 工具的 `tab` 参数指的就是这里的标签 id。 |
| **chrome** | `DSH_BROWSER_PANEL=0` | 插件自己起的私有 Chrome，**每实例一个窗口**；这一侧**没有标签集**，凡带 `tab` 的调用都具名拒绝（`TABS_CHANNEL`）。 |

工具描述是按通道生成的（`lib/tools.js` 里 `panel = registry.usePanel === true`）：同一个工具名在两条通道上说的是各自的事实。**把一条通道的描述当另一条的读，就是被自己的工具骗。**

## 工具（18 个）

| 工具 | 作用 |
| --- | --- |
| `browser_open` | 打开实例（可指定 `id`、URL、视口）；panel 通道上是打开那一个面板（`id` 只是它的手柄） |
| `browser_list` | chrome 通道：列出所有实例（id / URL / 视口 / 存活 / 进程）；panel 通道：列出**标签**（id / URL / 存活 / 谁在活动） |
| `browser_tabs` | **新（R184）** 读壳的标签集：`id / url / live / active` + 壳自己的 `count/limit`（每次都现读 `op=state`，不缓存） |
| `browser_goto` | 导航；panel 通道走壳的 `op=tab-goto`（默认活动标签，可用 `tab` 指名），导航**不改变**谁是活动标签 |
| `browser_tab_new` | **新（R184）** 开一个标签并成为活动标签；id 用壳的答复，上限由壳具名拒绝 |
| `browser_tab_close` | **新（R184）** 关一个标签；关掉活动标签后活动落到**左邻居**（以壳的回读为准） |
| `browser_tab_activate` | **新（R184）** 把一个标签摆进内容区（其余停靠）——这就是用户看到的那一个 |
| `browser_shot` | 截图，**图片直接内联给模型**（可裁剪 + 放大） |
| `browser_controls` | 控件编号清单（+ 可选带编号截图） |
| `browser_pick` | **按编号点击**（含抖动、快照校验、`repeat`） |
| `browser_click` | 按坐标真实点击 |
| `browser_hover` | 悬停 |
| `browser_type` | 向焦点元素真实输入 |
| `browser_key` | 命名按键 |
| `browser_scroll` | 真实滚轮 |
| `browser_status` | 只读元数据（URL/标题/视口/端口） |
| `browser_close` | 关闭一个（`id`）或全部（`all`），`kill` 决定是否关窗 |
| `browser_config` | 读写设置（Chrome 路径、默认视口、可见性、控件上限） |

除 `browser_open`/`browser_list` 外，其余工具都接受可选 `id` 指定实例，省略则用最近使用的那个。

**标签参数（R184）**：`browser_shot` / `browser_controls` / `browser_pick` / `browser_click` / `browser_hover` / `browser_type` / `browser_key` / `browser_scroll` / `browser_status` / `browser_goto` 都另接受一个可选 `tab`——一个来自 `browser_tabs` 的标签 id，**逐字**进请求体，省略即壳定义的活动标签（也能用 `"chrome"` 指外壳页本身，那是壳的拼法）。工具**不**自己造标签名/序号；壳不认识的 id 由壳具名拒绝，工具把原句带出来。

## 右侧栏面板

在右侧栏的标签系统里注册了一个新标签类型 `browser`，与内置的 **files（工作区文件）** 标签并列 —— 通过标签条的「＋ / guide」入口打开。

> **R184 补记（读这一节前先读）**：面板里那一页现在是**壳自己的浏览器页**（`browser_ui.html`，`sidebar_panel.rs` 从 `/__shell/browser` 送出），标签条/药丸/分辨率控件都是它的。插件侧默认只声明一个锚点（`client.js:191` 的 `data-dsh-link-surface`），宿主只认它；下面说的「实例 chips / 缩放 / 设置」是 `SHOW_CHROME_CONTROLS`（`client.js:46`，当前 `false`）那条旧控件路径。

- **实时画面**：按当前缩放抓帧，`<img>` 以像素尺寸 1:1 放进原生滚动容器，所以**浏览器视口恒定**（默认 1280×800），缩放/平移由容器自带的右侧与底部滚动条完成。
- **缩放**：`−` / `＋` / `适应` / `100%`（0.25×–1×；抓帧按缩放取图，放大不糊）。
- **管理**：实例 chips 切换、`＋打开` / `✕关闭` / `全部关闭` / `刷新画面` / `自动`（约 1.3s 轮询，可关）。
- **设置**：Chrome 路径输入 + 保存（写入 `config.json`），并显示生效路径与默认视口。

面板与 Agent **共用同一个注册表**，所以任一侧开关的实例另一侧立刻可见、可回收。

## 多开与回收

- **chrome 通道**：每个实例 = 一个独立 Chrome 进程 + 独立 profile + 独立钉死视口。
- **panel 通道**：只有一个浏览器（壳的面板），它多的是**标签**不是实例；`browser_open {id:"b2"}` 只是给同一块面板再加一个手柄，屏幕上不会多出第二个窗口。
- Agent：`browser_open {id:"shop"}` / `browser_close {id:"shop", kill:true}` / `browser_close {all:true}`；标签则用 `browser_tab_*`。
- 用户：外壳页的药丸条按钮（`＋` / `×` / 点药丸）。**用户的任何一次真实输入都会按名夺走面板的租约**（R178-T/R179-A），此后的写要重新 claim。

## 标签面（R184）：谁拥有什么

- **壳持有标签集**：`src-tauri/src/core/sidebar_panel.rs` 的 `tabs/active/next_tab` 才是事实，唯一读面是壳自己的 `op=state`。插件侧**不存第二份**：`lib/panel.js` 的 `panelTabs(state)` 是**纯投影**（不缓存、不带几何）。
- **写操作回读**：`tab-new` / `tab-close` / `tab-activate` 之后都再读一次 `op=state`，把**壳说的**报给模型，而不是把请求当真。
- **写操作带 `holder`**：`dsh-browser`（一个名字，不是租约——不 claim）。租约被别人持着时，壳按名拒绝，工具**原句**带出。
- **导航走 `op=tab-goto`**：不再用 `Page.navigate` 打活动标签——那正是「让 AI 上网」与「别动用户正在看的页」以前互斥的原因。
- **非活动标签是停靠的**：壳只把活动标签摆在内容区，其余在 `-30000,-30000 0x0`。所以对停靠标签截图/注入得到的是那个停靠窗口，工具的回复里会**明说**这一点（不给一个看起来像页面的 1×1 图）。
- **每个标签没有自己的分辨率**（R184 冻结）：`viewport/mode/scale` 是面板级的一份状态。
- **不做的**：标签持久化、标签崩溃检测/自愈、拖拽排序、分组、每标签分辨率、以及 chrome 通道的「真多实例」改造。

### `panelOrigin`：离线夹具的接缝（默认一字不改）

`lib/panel.js` 的 `DEFAULT_PANEL_ORIGIN` 仍是 `http://127.0.0.1:31761`。行配置 `panelOrigin` 或环境变量 `DSH_BROWSER_PANEL_ORIGIN` 可以把它指到**假面板**上——这是让整套标签面**离线可验**的唯一开口（`test/panel-tabs-selfcheck.mjs` 就是这么跑的）。**它只在 `apply()` 时读一次**：拿它当运行期开关用 = 造第二个真相。默认值不改 ⇒ 不设它的部署行为零变化。

## 配置

配置文件 `<baseDir>/config.json`（`baseDir` 默认 `$DSH_HOME/.dsh-browser`，可用行配置 `baseDir` 覆盖）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `browserExecutable` | `null` | chrome.exe / msedge.exe 绝对路径；`null` = 自动探测，再退到 `DSH_BROWSER_EXECUTABLE` |
| `viewport` | `{1280,800}` | 新实例的钉死视口 |
| `visible` | `true` | `false` 追加 `--headless=new` |
| `maxControls` | `150` | `browser_controls` 上限，用于约束 token |
| `extraArgs` | `[]` | 追加给 Chrome 的命令行参数 |

行配置里的 `viewport` / `browserExecutable` 只在配置文件缺失时写入一次，之后**以文件为准**，所以重启不会覆盖你在面板里改过的值。

## 安装

```powershell
# 1) junction：让 profile 能解析裸包名
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\web\node_modules\dsh-browser" `
  -Target "H:\mod\dsh-browser"

# 2) host 行（已写入 profiles\web\cordis.patch.yml）
#    - insert:
#        - id: browser
#          name: dsh-browser
```

**改动 host 行需要重启 DSH。** 新增/修改 **client half** 还需要重启后**刷新一次页面**（客户端插件表在启动时扫描）。

## 卸载

删掉 `cordis.patch.yml` 里的 `browser` 段 + 删除 `node_modules\dsh-browser` junction，重启 DSH。

## 自检

```powershell
# 标签面（R184）：自己起一个假面板世界，驱动真插件（lib/index.js 的 apply() 与真工具）
node plugins/dsh-browser/test/panel-tabs-selfcheck.mjs                       # 20 条读数，全过则 exit 0
node plugins/dsh-browser/test/panel-tabs-selfcheck.mjs --list                # 每条读数在判什么、哪条谎会让它红
node plugins/dsh-browser/test/panel-tabs-selfcheck.mjs --mutate=ignore-tab   # 让世界说一条谎：声明要红的读数必须红，别的不许红

# 产物漂移（本包没有 src/：lib/** 就是源，不经过打包器）
node plugins/build.mjs --check
```

假面板世界在 `test/fake-panel.mjs`：它的 `op=state` **键集与键序**由自检对着 `src-tauri/src/core/sidebar_panel.rs` 的格式串逐字核对，拒绝语句（上限/未知 id/未挂载/别人的租约/用户夺回）也都是壳的原句抄本。它**不支持的东西**一律 `FAKE_UNSUPPORTED` 具名拒绝，不会静默 200。

（README 从前这里列过 `selftest*.mjs`、`registry-test.mjs`：那几个文件只存在于 `H:\mod\dsh-browser` 那份 10-03 的旧副本里，仓库这份没有，已从本页删掉。）

## 实现要点

- `lib/cdp.js` — 基于 WHATWG `WebSocket` 全局的极简 CDP 客户端，**零运行时依赖**。
- `lib/chrome.js` — 发现/启动/接管 Chrome；`DevToolsActivePort` 取端口，`/json/version` 探活以识别崩溃残留。
- `lib/session.js` — 长连接会话、钉死视口、截图、输入、控件快照与按编号点击。DevTools 的 emulation override 是**会话级**的，所以连接必须长驻，否则视口会在两次调用之间悄悄丢失。
- `lib/controls.js` — 控件抽取表达式、编号覆盖层、抖动取点。
- `lib/registry.js` — 多实例注册表，工具与面板共用。
- `lib/rpc.js` — 面板 carrier：**`ctx.webServer` 上的 prefix 路由**，地址 `POST /browser/api/<op>`，JSON body。与 `dsh-better-sidebar` 的 `/sidebar/api` 同形。
  **不要用 `ctx.connection.rpc.handle(channel, handler)`**：它内部通过**连接服务自己的 ctx**（`owner = this.ctx`）去 `owner.webServer.register(...)`，而那个 ctx 没有 inject `webServer`，于是直接抛
  `cannot get property "webServer" without inject` —— 路由从未建立。客户端随后回退到一条没有路由的 HTTP 传输，报 `transport failure for <channel>/<endpoint>: HTTP 405`。
  鉴权复用官方 fence：`connection.requestRejection(new Request(...))` 同时覆盖 Host/Origin 信任与浏览器会话校验，所以这条路由和 app 自己的 API 一样受保护。`selftest-rpc.mjs` 会**真实驱动 handler** 验证 405/404/403/200 与 op 分发。
- `lib/client.js` — 自包含客户端 bundle：**必须**用 `window.__ModuleLoader__.load({ id: 'dsh-browser', factory })` 自注册（`dsh-lan-bridge/lib/client.js` 是参考形状），模块体写在 factory 闭包里，`require` 由加载器注入。只写 `exports.name = …` 的裸 CJS 不会注册任何东西，加载器会直接报
  `bundle … loaded without registering "dsh-browser" via __ModuleLoader__.load`（即「Failed to load plugins」）。网络层用
  `fetch('/browser/api/<op>', { method:'POST', headers:{'content-type':'application/json'}, body, credentials:'same-origin' })`，不注入任何客户端服务。
- `lib/client.js` — 自包含客户端 bundle：**必须**用 `window.__ModuleLoader__.load({ id: 'dsh-browser', factory })` 自注册（`dsh-lan-bridge/lib/client.js` 是参考形状），模块体写在 factory 闭包里，`require` 由加载器注入。只写 `exports.name = …` 的裸 CJS 不会注册任何东西，加载器会直接报
  `bundle … loaded without registering "dsh-browser" via __ModuleLoader__.load`（即「Failed to load plugins」）。
