# 把 DSH 的 Agent 接到别人的应用上（R200 P2）：钩子约定 · 工具面 · 两种人格 · 边界

> 交付物：`docs/handoff/R200-contract.md:23-25`（§3 P2），要求原句在 `docs/handoff/R200-contract.md:25`。写者 = 本轮生产者。
> **本轮只写这一个文件**：没有改 example-app，没有改 `plugins/**`、`scripts/**`、`docs/handoff/**`，没有碰 4177 / 31761 / 31760 / 9222，
> 没有起浏览器，没有跑任何 git 写。**本页一条活体读数都没有**：活体门 `foreign-app-agent-live`（`docs/handoff/R200-contract.md:11-21`）
> **正在并行写**，`scripts/` 里此刻没有这个名字（`scripts/verify-device-net-foreign.mjs` 是另一件事）；下文凡说"门会读到什么"，都是门的**要求**。
> 每条断言指一个 `file:line`；§7 是同一批断言的表，可以机械地重读一遍。

## 0. 一句话

**DSH 的 agent 不是被"嵌"进那个应用的：它用壳的侧栏浏览器当一只真手去操作那一页。**它点的是真的、敲的是真的（`plugins/dsh-browser/lib/tools.js:17`），
但它**看不见**页面的源码、文本和存储（`plugins/dsh-browser/lib/cdp.js:9`）。于是"应用说真话"必须由**第二只眼**承担 —— 应用自己发布的全局钩子，
由校验者读，不由模型读：门要求模型真去调工具（`docs/handoff/R200-contract.md:13`），又要求门读应用**自己的**状态而不是模型的声明（`:17`）。

## 1. 钩子约定：应用该发布什么

### 1.1 一个全局、一个名字

example-app 的形态是 `window.__CHEMLAB__ = hook`（`<workspace>\\example-app\src\app\bootstrap.ts:187`），类型写在与实现分开的文件里
（`<workspace>\\example-app\src\types\globals.ts:11`）并在 `Window` 上声明（`:30-34`）。约定的名字是 `window.__APP__`（`docs/handoff/R200-contract.md:25`）；
名字叫什么不重要，**只有一个、且被类型声明住**才重要。

### 1.2 `ready` 是一个事实，不是"脚本跑完了"

example-app 写成 `ready: stage !== null`（`<workspace>\\example-app\src\app\bootstrap.ts:175`），契约写明"仅当 controller 与 stage 均可用时为 true"
（`<workspace>\\example-app\src\types\globals.ts:18`），消费者**必须先轮询 ready 再断言**（`:5`）；第二处信号是 `data-app-ready` 属性
（`<workspace>\\example-app\src\ui\appShell.ts:227` 的 `rootEl.dataset.appReady`），与 `markAppReady()` 一起写。

值钱的地方是**它把"哪些东西就绪"写清楚了**：渲染层没起来时 `ready` 永远 false，哪怕 DOM 已经能点。一个把 `ready` 定义成"模块加载完了"的应用，
会在页面还点不动的时候给门一个 true —— 那不是就绪，那是谎。顺序也是约定的一部分：example-app 的注释写着"必须先挂钩子再补一次 markAppReady"，
否则 UI 挂上去的 `ui` 会被赋值覆盖（`<workspace>\\example-app\src\app\bootstrap.ts:164`），这是它 qa 阶段真踩过的坑
（`<workspace>\\example-app\src\ui\testHook.ts:3`）；补救是一个"立即挂一次 + 有限重试 + 幂等补挂"的发布器（`:21`），调用点在
`<workspace>\\example-app\src\app\bootstrap.ts:190`。**能被验证的钩子必须能容忍挂载顺序。**

### 1.3 build id：它得真的是"哪一个构建"

契约要它存在的理由在 `<workspace>\\example-app\src\types\globals.ts:21`（断言页面与仓库版本一致），但 example-app 现在给的是时间戳
`dev-YYYYMMDDHHmmss`（`<workspace>\\example-app\src\app\bootstrap.ts:163`）—— 它能证明"这是新跑起来的"，不能证明"这是哪个提交"。
诚实的写法是让应用自己说明 id 的含义，而不是让读者以为它是版本号。

### 1.4 只读状态面：能序列化，且**不含写路径**

读面是 `getSnapshot()`（`<workspace>\\example-app\src\types\app.ts:80`），返回的 `AppSnapshot`（`:39`）是纯数据：`mode`、`world`、`layers`、`sim`、`content`、`ui`、`lastResult`、`logs`，HUD 消息在 `ui.messages`（`:71`）。"可序列化"是设计而不是巧合 —— 门要把它 `JSON.stringify` 出来做前后对比。

**但 example-app 发布的是 controller 本身**（`<workspace>\\example-app\src\types\globals.ts:13`），读面写面都在上面，`dispatch(op)` 就在
（`<workspace>\\example-app\src\types\app.ts:83`）。建议**发布一个纯投影 `state()`**（JSON 安全、无函数、无引用泄漏），写面留在页面里。
理由不是洁癖：agent 若能 `dispatch` 写，它就不是"像用户那样操作"，门也就无法把"模型的工具调用"与"应用的状态变化"分开看
（`docs/handoff/R200-contract.md:13`、`:17`）。

### 1.5 坐标助手：单位必须写在名字里，因为口径是量出来的

example-app 把这条实测写进了代码：钩子原样返回 `(469,378)` **点不中**，加上画布偏移后的 `(745,383)` **精确选中容器**
（`<workspace>\\example-app\src\app\bootstrap.ts:178`）；因此它**一律**加上画布 `rect.left/top`（`:179`），`locateContainer` 固定返回
**视口 client 坐标**（`:177`），偏移来自 `getBoundingClientRect()`（`:183`）。本轮把这个事实原样收下（`docs/handoff/R200-contract.md:7`），
没有重测。

为什么重要：CDP 的 `Input.dispatchMouseEvent` 吃视口坐标。给错坐标系，点击会**成功**、页面却什么也没选中 —— 这类失败不报错，只沉默，
而沉默的失败正是这道门要防的。所以单位要写进名字：example-app 的 UI 句柄已经这么做，画布内那份叫 `containerScreenPos`
（`<workspace>\\example-app\src\ui\appShell.ts:80`），视口那份叫 `containerClientPos`（`:83`）。活证据：钩子的接口注释仍写着"画布内像素坐标"
（`<workspace>\\example-app\src\types\globals.ts:23`），与实现相反 —— 实现才是能命中的那个（`<workspace>\\example-app\src\app\bootstrap.ts:177`）。
**注释和实现会漂，名字不会。**

### 1.6 还有一份"机器能读、人看不见"的

example-app 在 `index.html` 里留了 hidden 的 `#status`（`<workspace>\\example-app\src\app\bootstrap.ts:192-198`），只为 E2E 与性能脚本读：
机器可读、**模型看不见**（截图里没有它）。这恰好是 §4 两只眼的分界。

## 2. Agent 拿到的是哪些工具，在什么"工具组"下

### 2.1 组 = host 平面的那一行，不是可开关的组

工具面是分层的：host 组合里挂的一行注册进**根层**，每个 agent scope 都继承，不用改也不用复制任何 preset
（`plugins/dsh-browser/lib/index.js:8`、`:101`）；那一行的 id 是 `browser`（`plugins/dsh-browser/README.md:125`）。它不是
`dsh-link-groups` 那种"关掉就从工具面消失"的组：出厂组目录里只有 `teams`（`plugins/dsh-link-groups/cordis.patch.yml:28`）与 `notes`（`:55`），
`browser_*` 不在其中。所以答案是直接的：**它常开，对每个会话都在，共 18 个名字**（`plugins/dsh-browser/README.md:7`、
`plugins/dsh-browser/lib/tools.js:751`）。代价是：这个附件**没有**"先问用户要不要把 agent 的手交出去"的开关（见 §3.3）。

### 2.2 一次附件真正会用到的工具，以及它们做不到什么

| 工具 | 做什么 | 做不到什么 | 出处 |
|---|---|---|---|
| `browser_open` | 打开壳的侧栏面板（用户看着的那一栏），给它一个手柄 | panel 通道上不会多出第二个窗口 | `plugins/dsh-browser/README.md:44` |
| `browser_tabs` | 读壳的标签集（id / url / live / active + 上限），每次现读 | 不缓存、不替壳记第二份 | `plugins/dsh-browser/README.md:46` |
| `browser_tab_new` | 开一个**自己的**标签并成为活动标签 | 上限由壳具名拒绝（标签上限 4） | `plugins/dsh-browser/README.md:48`、`:35` |
| `browser_goto` | 走壳的 per-tab op 导航；不指 tab 时动的是**活动标签 = 用户正在看的那页** | 不改变谁是活动标签 | `plugins/dsh-browser/README.md:47` |
| `browser_shot` | 截图，图片直接内联给模型 | 视口外看不见；停靠标签会明说 | `plugins/dsh-browser/README.md:51` |
| `browser_controls` → `browser_pick` | 把可交互控件压成编号清单（标签 / role / 无障碍名 / 包围盒），按编号真点击、绑定快照 | 读的是交互**结构**不是源码；页面变了报 stale | `plugins/dsh-browser/README.md:52-53`、`:26` |
| `browser_click` / `browser_type` | 按坐标点击 / 向焦点元素真输入 | 都是真事件，不是 DOM 写 | `plugins/dsh-browser/lib/tools.js:17`、`:599` |

坐标模式的前提是钉死视口：**截图 1 像素 = 1 CSS 像素 = 点击坐标**（`plugins/dsh-browser/README.md:19`）；控件模式的落点是控件包围盒的
**内缩随机点**（`plugins/dsh-browser/lib/controls.js:13`），编号绑定快照：`browser_controls` 回 `snapshot=b1:3`，`browser_pick` 必须带上。

### 2.3 三件它明确做不到的事（本页最该记住的一段）

1. **不读页面。** 包里没有任何返回页面文本/源码/存储的通道（`plugins/dsh-browser/README.md:22`）；CDP 客户端**故意**不暴露
   `Runtime.evaluate`、`DOM.*` 和其它读源码的 domain（`plugins/dsh-browser/lib/cdp.js:9`）；`evaluate` 只喂控件抽取、只回 roles / labels /
   boxes，永不回页面源码、文本或存储（`plugins/dsh-browser/lib/session.js:716`）。**推论：agent 读不到 `window.__APP__`；钩子的读者是校验者。**
2. **不猜。** 编号绑定快照，控件动了就报 stale 而不是点下去（`plugins/dsh-browser/README.md:26`）。
3. **不假装看见。** 停靠（非活动）标签的截图会明说那是停靠窗口，不给一张看起来像页面的 1×1（`plugins/dsh-browser/README.md:93`）。

## 3. 两种用法人格

### 3.1 用户开车、agent 搭手

用户的任何一次真实输入都按名夺走面板的租约（`plugins/dsh-browser/README.md:85`）：壳把持租约者记成被撤销、并记下是谁用什么动的
（`src-tauri/src/core/sidebar_panel.rs:1086`）。此后 AI 的写被具名拒绝（`:1057`），**包括本来就没持租约的调用者** —— 拒绝句说的是
"没有租约被撤销，claim 之后继续"（`:1052`）。回来的路只有一条：claim（`:1041`、`:824`）。

关键事实：`dsh-browser` 的 holder `dsh-browser` **只是一个名字，不是租约**，它从不 claim（`plugins/dsh-browser/lib/panel.js:38`、`:42`）。
所以在这一格里，用户一动手，agent 的写就一路被拒到有人替它 claim 为止。这不是 bug，是这格的自然形态：**agent 出编号清单、指位置、
说下一步，用户点。** 想验证 agent 的手，就得走 3.2。

### 3.2 agent 开车、用户看

- **先开自己的标签。** 不指 tab 时 `browser_goto` 动的是活动标签 —— 用户正在看的那一页（`plugins/dsh-browser/lib/tools.js:311`）；要避开就
  `browser_tab_new`（`plugins/dsh-browser/README.md:48`）。导航不改变谁是活动标签（`:47`），所以"用户的页"与"agent 的页"能同时存在。
- **标签集是壳的。** 唯一读面是壳自己的 `op=state`，插件侧不存第二份（`plugins/dsh-browser/README.md:89`）；上限 4（`:35`）。
- **壳自己的注入不算用户的手。** agent 通过 `op=cdp` 发的 `Input.*` 在注入窗口里被记成注入、**不夺权**（`src-tauri/src/core/sidebar_panel.rs:70`、
  `:52`）。没有这一条这格根本不成立：agent 点自己一下就会把自己的租约撤掉（`:62-68` 记的正是那次实测缺陷）。

### 3.3 这一格换来了什么、换走了什么

- **换走了审批。** `browser_*` 自己没有审批缝：对 `plugins/dsh-browser/lib` 搜 `tools/pre-execute` 无命中。仓里的审批缝是 `tools/pre-execute`，
  用的是 notes（`plugins/dsh-link-notes/README.md:56`）与工具组（`docs/dev/tool-groups.md:37`）。所以 agent 开车时，保障不是"每次点击先问人"，
  而是"用户就看着那一栏"（`plugins/dsh-browser/README.md:3`）。
- **换来了可验证。** 这是唯一能跑活体门的形态：模型真调工具（`docs/handoff/R200-contract.md:13`），应用的状态真的变了（`:17`）。

## 4. 边界，直说

1. **agent 只看见页面画出来的东西。** 这是两只眼：模型那只是截图与控件清单（无页面源码，`plugins/dsh-browser/lib/cdp.js:9`）；校验者那只是壳的
   `op=cdp` 协议口，可以对指定标签发任意协议方法（`src-tauri/src/core/sidebar_panel.rs:2142`），而 `Runtime.evaluate` 在壳里被明确归为
   "不注入输入"（`:2204`）—— 仓里真在用的仪器是 `scripts/cdp-eval.mjs:46`。**同一个页面，两种看法，谁也别冒充谁。**
2. **只有画布、没有状态面的应用无法被验证，而且必须自己说出来。** 门不会退回"拿截图当状态"（`docs/handoff/R200-contract.md:21`）。一个 3D 沙盒
   若只把结果画在 canvas 上、没有可序列化的状态面，诚实的回答是"我无法被验证"，而不是"你看截图挺好"。
3. **这里不动那个应用。** example-app 是用户自己的项目，本轮只读它、只驱动它自愿发布的公共钩子（`docs/handoff/R200-contract.md:29`）：附件是**消费**
   钩子，不是给应用加接口。
4. **浏览器是 DSH 的侧栏面板，不是一只私有 Chrome。** 默认通道就是一个面板（`plugins/dsh-browser/lib/index.js:48`），它多的是**标签**不是实例
   （`plugins/dsh-browser/README.md:35`）；写操作以 `dsh-browser` 这个名字走（`plugins/dsh-browser/lib/panel.js:42`），失败句是壳的**原句**、
   不被改写成插件自己的措辞（`:24`）。私有 Chrome 是 `DSH_BROWSER_PANEL=0` 的另一条通道（`plugins/dsh-browser/lib/index.js:48`），它不共享用户的眼睛，本附件不用它。
5. **不是 Tauri 子 webview 那条路。** 把 DSH-LINK 装进另一个 Tauri 应用的配方在 `docs/dev/tauri-host-embed.md:1`，本文不重复：那边是"宿主承载这个
   页面"，这边是"agent 操作别人的页面"。**入口也是应用自己的**：example-app 就是 `127.0.0.1:4177`、`strictPort`（`<workspace>\\example-app\vite.config.ts:14`）。
6. **本页没有任何活体读数**（见页首）：活体门正在并行写，读数归它。

## 5. 接上去的最小清单

- [ ] 页面在应用自己的地址上、`strictPort`（`<workspace>\\example-app\vite.config.ts:14`）；一个全局钩子，被类型声明住（`<workspace>\\example-app\src\types\globals.ts:11`、`:30-34`）。
- [ ] `ready` 说清"哪些东西就绪"，消费者先轮询（`:5`、`:18`）；一个 build id，含义由应用写明（`:21`）。
- [ ] 一个**只读、可序列化、不含写路径**的状态面（`<workspace>\\example-app\src\types\app.ts:39`、`:80`）。
- [ ] 坐标助手的单位写在名字里，且与 CDP 的视口口径一致（`<workspace>\\example-app\src\app\bootstrap.ts:177`）。
- [ ] 至少一个**一句话能说清的状态事实**（选中 id / 已放置数量 / HUD 值），门读得到前后各一次（`docs/handoff/R200-contract.md:17`）。
- [ ] 一份"机器能读、人看不见"的探针（`<workspace>\\example-app\src\app\bootstrap.ts:192-198`）。

## 6. 本页判不了什么（第三态，不当绿用）

- 活体门一次都没跑：它不存在（页首）。
- 坐标口径的读数来自 example-app 自己的记录（`<workspace>\\example-app\src\app\bootstrap.ts:178`）与本轮 §1 的转述（`docs/handoff/R200-contract.md:7`）；
  本页没有重测，也不声称重测。
- `browser_*` 的"常开"是**读配置与注册点**读出来的（`plugins/dsh-browser/lib/index.js:101`、`plugins/dsh-link-groups/cordis.patch.yml:28`、`:55`），
  不是在某个部署里数工具面数出来的。
- 不在 panel 通道上的部署（`DSH_BROWSER_PANEL=0`）没有标签集，§3.2 后两条要重写；本页只描述默认通道。

## 7. 引用的表

每一行是上面某条断言、它来自哪个文件、以及那里必须能找到的文本。可以照着这张表把本页机械地重读一遍。

<!-- citations
| id | where | must contain |
|---|---|---|
| A1 | <workspace>\\example-app\src\app\bootstrap.ts:187 | window.__CHEMLAB__ = hook |
| A2 | <workspace>\\example-app\src\app\bootstrap.ts:175 | ready: stage !== null |
| A3 | <workspace>\\example-app\src\app\bootstrap.ts:163 | const buildId = "dev-" |
| A4 | <workspace>\\example-app\src\app\bootstrap.ts:177 | 测试钩子固定返回视口 client 坐标 |
| A5 | <workspace>\\example-app\src\app\bootstrap.ts:178 | (469,378) |
| A6 | <workspace>\\example-app\src\app\bootstrap.ts:179 | 一律加上画布 rect.left/top |
| A7 | <workspace>\\example-app\src\app\bootstrap.ts:183 | getBoundingClientRect |
| A8 | <workspace>\\example-app\src\app\bootstrap.ts:190 | ui.markAppReady() |
| A9 | <workspace>\\example-app\src\app\bootstrap.ts:164 | 必须先挂钩子 |
| A10 | <workspace>\\example-app\src\app\bootstrap.ts:192 | 机器可读状态探针 |
| A11 | <workspace>\\example-app\src\types\globals.ts:11 | export interface ChemLabTestHook |
| A12 | <workspace>\\example-app\src\types\globals.ts:13 | controller: AppController |
| A13 | <workspace>\\example-app\src\types\globals.ts:18 | 仅当 controller 与 stage 均可用时为 true |
| A14 | <workspace>\\example-app\src\types\globals.ts:21 | buildId |
| A15 | <workspace>\\example-app\src\types\globals.ts:23 | 画布内像素坐标 |
| A16 | <workspace>\\example-app\src\types\globals.ts:5 | 必须先轮询 ready |
| A17 | <workspace>\\example-app\src\ui\testHook.ts:3 | bootstrap 可能在 createUi 之后 |
| A18 | <workspace>\\example-app\src\ui\testHook.ts:21 | createTestHookPublisher |
| A19 | <workspace>\\example-app\src\ui\appShell.ts:80 | 画布内 |
| A20 | <workspace>\\example-app\src\ui\appShell.ts:83 | containerClientPos |
| A21 | <workspace>\\example-app\src\ui\appShell.ts:227 | dataset.appReady |
| A22 | <workspace>\\example-app\src\types\app.ts:39 | export interface AppSnapshot |
| A23 | <workspace>\\example-app\src\types\app.ts:71 | messages: HudMessage |
| A24 | <workspace>\\example-app\src\types\app.ts:80 | getSnapshot(): AppSnapshot |
| A25 | <workspace>\\example-app\src\types\app.ts:83 | dispatch(op: Operation) |
| A26 | <workspace>\\example-app\vite.config.ts:14 | 4177 |
| B1 | plugins/dsh-browser/README.md:3 | 右侧栏面板 |
| B2 | plugins/dsh-browser/README.md:7 | 18 个 |
| B3 | plugins/dsh-browser/README.md:19 | 1 像素 |
| B4 | plugins/dsh-browser/README.md:22 | 返回页面文本/源码/存储的通道 |
| B5 | plugins/dsh-browser/README.md:26 | snapshot=b1:3 |
| B6 | plugins/dsh-browser/README.md:35 | MAX_TABS=4 |
| B7 | plugins/dsh-browser/README.md:44 | browser_open |
| B8 | plugins/dsh-browser/README.md:46 | browser_tabs |
| B9 | plugins/dsh-browser/README.md:47 | browser_goto |
| B10 | plugins/dsh-browser/README.md:48 | browser_tab_new |
| B11 | plugins/dsh-browser/README.md:51 | browser_shot |
| B12 | plugins/dsh-browser/README.md:52 | browser_controls |
| B13 | plugins/dsh-browser/README.md:53 | browser_pick |
| B14 | plugins/dsh-browser/README.md:59 | browser_status |
| B15 | plugins/dsh-browser/README.md:60 | browser_close |
| B16 | plugins/dsh-browser/README.md:85 | 夺走面板的租约 |
| B17 | plugins/dsh-browser/README.md:89 | 壳持有标签集 |
| B18 | plugins/dsh-browser/README.md:93 | 停靠 |
| B19 | plugins/dsh-browser/README.md:125 | - id: browser |
| B20 | plugins/dsh-browser/lib/index.js:8 | HOST |
| B21 | plugins/dsh-browser/lib/index.js:48 | DSH_BROWSER_PANEL |
| B22 | plugins/dsh-browser/lib/index.js:101 | defineBrowserTools |
| B23 | plugins/dsh-browser/lib/tools.js:17 | real synthesized mouse event |
| B24 | plugins/dsh-browser/lib/tools.js:311 | ACTIVE tab |
| B25 | plugins/dsh-browser/lib/tools.js:599 | real text input |
| B26 | plugins/dsh-browser/lib/tools.js:751 | BROWSER_TOOL_NAMES |
| B27 | plugins/dsh-browser/lib/cdp.js:9 | Runtime.evaluate |
| B28 | plugins/dsh-browser/lib/session.js:716 | never page source |
| B29 | plugins/dsh-browser/lib/panel.js:24 | verbatim |
| B30 | plugins/dsh-browser/lib/panel.js:38 | NAME, not a lease |
| B31 | plugins/dsh-browser/lib/panel.js:42 | PANEL_HOLDER |
| B32 | plugins/dsh-browser/lib/controls.js:13 | jittered |
| C1 | src-tauri/src/core/sidebar_panel.rs:52 | USER_SHELL_HOLDER |
| C2 | src-tauri/src/core/sidebar_panel.rs:70 | INJECTION_GRACE |
| C3 | src-tauri/src/core/sidebar_panel.rs:824 | pub fn lease |
| C4 | src-tauri/src/core/sidebar_panel.rs:1041 | op=lease claim |
| C5 | src-tauri/src/core/sidebar_panel.rs:1052 | no lease was held |
| C6 | src-tauri/src/core/sidebar_panel.rs:1057 | REVOKED by |
| C7 | src-tauri/src/core/sidebar_panel.rs:1086 | fn take_turn |
| C8 | src-tauri/src/core/sidebar_panel.rs:2142 | pub fn cdp |
| C9 | src-tauri/src/core/sidebar_panel.rs:2204 | Runtime.evaluate |
| D1 | docs/handoff/R200-contract.md:7 | client coordinates |
| D2 | docs/handoff/R200-contract.md:11 | foreign-app-agent-live |
| D3 | docs/handoff/R200-contract.md:13 | ONE real agent round |
| D4 | docs/handoff/R200-contract.md:17 | OWN state |
| D5 | docs/handoff/R200-contract.md:21 | screenshots as state |
| D6 | docs/handoff/R200-contract.md:25 | window.__APP__ |
| D7 | docs/handoff/R200-contract.md:29 | Modifying |
| D8 | docs/dev/tool-groups.md:37 | userDisabled |
| D9 | plugins/dsh-link-notes/README.md:56 | tools/pre-execute |
| D10 | plugins/dsh-link-groups/cordis.patch.yml:28 | teams |
| D11 | plugins/dsh-link-groups/cordis.patch.yml:55 | notes |
| D12 | docs/dev/tauri-host-embed.md:1 | Host embed page |
| D13 | scripts/cdp-eval.mjs:46 | Runtime.evaluate |
-->
