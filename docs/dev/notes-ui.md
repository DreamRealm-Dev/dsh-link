# 便条 UI 页（R189 P3）：两条写路径 · 路由的形状与码 · 标记的读法（不是像素）· 用户可见文案

> 本页是 R189 的**接口冻结点**，冻结点来自 `docs/handoff/R189-contract.md`：**§1 是 Lead 的写路径裁决（硬要求）**、§2 是 P1/P2/P3 的交付与唯一写范围、§4 是风险（其中 §4.2「标记不能代替像素」本页逐字照办）。
> 写者 = R189 生产者 **P3**；**唯一写范围只有本文件**，scratch 在 `.tmp/r189-p3/**`。
> **全程离线**：没连 31761/31760/9222、没启停客户端、没改活档案 `%APPDATA%\dev.dshlink.client\**`、没碰 `core/deepseek-harness/**` 与 `src-tauri/**`、没跑整套 `verify-all.mjs`、没有 git 写操作。
> **写本页的时刻（2026-10-12 00:2x）**：P1 的两条路由与 P2 的客户端半**都已落盘**（`plugins/dsh-link-notes/src/index.ts`、`plugins/dsh-link-panel/src/client/**`、门 123 `scripts/verify-notes-route.mjs` 都在树上）⇒ 本页引的是**实码**；裁定（契约）只用来钉「为什么必须是这个样子」。
>
> **引文口径（三种形式，分工是故意的）**——与 `docs/dev/client-plugin-mount.md` 同一口径：
> - `core/deepseek-harness/**` 是 **pin 住的**内核（`kernel.lock.json`）⇒ `path:line`。行号会漂**是设计**：内核一动就得有人来对齐。
> - `plugins/**` 与 `scripts/verify-all.mjs` **本轮就会动**（P1 改 `dsh-link-notes`、P2 改 `dsh-link-panel`、Lead 往门注册表里加行）⇒ **一律自愈形** `path#text`：那段文本必须在全文**恰好出现一次**才算一条引文。
> - 契约/记档（`docs/handoff/R189-contract.md`、`docs/handoff/R188-handoff.md`）收口时还会被改 ⇒ 也用自愈形。
> **正文里的行号只作阅读辅助，判据是页尾那张表。**
> ⚠ 两条解剖学事实（我读核对器源码得到的）：① `path#text` 那个正则的 `(.*)` 是**贪婪**的（`scripts/check-protocol-page.mjs:78-80`）⇒ **needle 文本里不许再出现 `#`**；② `must contain` 格里出现 `|` 会让整行判成 malformed（`:53`），`-` 是「本行不带要求」的**故意拼法**（`:62`）。
>
> **R190 更新（2026-10-12 01:04）**：产品侧把面板客户端半的文案搬进了 locale 字典（`plugins/dsh-link-panel/src/client/locales.ts`，`NS = 'dsh-link-panel'`）⇒ R189 时锚在**英文原文**上的 **17 条针**全部失效（实测 `116 of 133`、exit 1）。本页**跟着产品重锚**：从「英文原文」改指**键**与新的 `t()` 调用点（§4；逐条读数见 §4.4）。**值会改，键才是契约。**
> 重锚的写者 = R190 的**契约页维护者**（唯一写范围仍只有本文件；scratch 在 `.tmp/r190-pageb/**`）；页尾判据表随之从 `133` 条长到 `141` 条。

## 〇、一句话

便条的**写**有两条路、**一个写函数**：**Agent** 走 `notes_add` 工具 + `tools/pre-execute` 的 `{kind:'ask'}`（每次审批；审批没通过 ⇒ 工具体根本没跑 ⇒ 账本不动）；**用户**在面板里敲的字走**宿主窄写路由** `POST /api/dsh-link-notes/add`（人自己敲的字不必向自己申请审批）。两条路都汇进**同一个** `writeOneNote` ⇒ 同一个 `appendNote` ⇒ 同一套三码（`NOTES_INPUT` / `NOTES_TOO_LONG` / `NOTES_FULL`），路由**不许**自带第二份校验。面板的「活着」只有一条**只读自报标记** `globalThis.__dshLinkPanel`——它证明「客户端半挂了并算出了视图」，**不证明像素**；要读像素必须开面板（那要独占窗口）。

## 一、两条写路径的对照表（★ 契约 §1 的裁决）

| # | 谁在写 | 走哪条路（每段都可失败） | 中间隔着什么 | 失败时 | 具名码 | 证据（页尾表的 id） |
|---|---|---|---|---|---|---|
| 1 | **Agent（模型）** | `notes_add` 工具 ⇒ `tools/pre-execute` 的 `{kind:'ask'}` ⇒ **每次**审批 ⇒ 工具体 ⇒ `writeOneNote` ⇒ `appendNote` | ①内核（审批那一关）②一个写函数（入参层 + 阈值层） | 审批拒了或没人应答 ⇒ 工具体**根本没跑** ⇒ 账本**不动** | 审批那句拒是内核自己的原文（本包不写同义句）；`NOTES_INPUT` / `NOTES_TOO_LONG` / `NOTES_FULL` | `notes-ask-decision`、`notes-tool-calls-one-write-path`、`notes-write-refuses-input`、`notes-write-refuses-too-long`、`notes-write-refuses-full` |
| 2 | **用户（在面板里敲）** | 面板客户端半 ⇒ 宿主窄写路由 `POST /api/dsh-link-notes/add` ⇒（**同一个**）`writeOneNote` ⇒ `appendNote` | ①路由的形状（方法/字段/一次一条）②同一个写函数 | 具名码**原样**回给面板；账本**不动** | 同上三码；方法不是 POST ⇒ `405`（`METHOD_NOT_ALLOWED`） | `notes-route-calls-one-write-path`、`notes-405-named`、`notes-refusal-status-map` |

**两条路的差别只有两处，而且都是「谁在写」的差别**：① Agent 那条**多一道审批**（模型的动作要人看）；② 缺省 `author` 不同（模型 `agent`、面板 `user`）。**别的都一样**：同一个写函数、同一份字段表、同一套三码、同一对阈值对象。

### 1.1 两条路共用的那个写函数在哪一行

- `writeOneNote`（`plugins/dsh-link-notes/src/index.ts:602`，写作时刻行号；自愈锚 `notes-one-write-path`）是**唯一**的写路径。它自己的注释把这句钉死：`THIS is the package's only \`appendNote\` call site`（`:582`，锚 `notes-only-appendnote-call-site`）。
- 两个调用点各一处：**工具** `:643`（`{ who: ADD_TOOL, author: AGENT_AUTHOR }`）、**路由** `:948`（`{ who: NOTES_ADD_ROUTE_PATH, author: ROUTE_AUTHOR }`）。
- 字段表只有一份：`const WRITE_FIELDS = ['text', 'tags', 'author']`（`:560`）；多一个字段就按名拒（`NOTES_INPUT`）。
- `appendNote`（`:471`，锚 `notes-shared-write-function`）是**阈值层**：太长 ⇒ `NOTES_TOO_LONG`、满了 ⇒ `NOTES_FULL`（都在它自己身上，`:478`/`:482` 一带，锚 `notes-write-refuses-*`）。阈值对象是行解析的那一份，**手上**交给写函数，各层不再各查一次。
- 两条路**唯一**各自拥有的东西，就是传给 `writeOneNote` 的 `caller`：`AGENT_AUTHOR = 'agent'`（`:563`）与 `ROUTE_AUTHOR = 'user'`（`:111`）。

### 1.2 「第二份校验」为什么是禁止的（五条依据，全部可复跑）

1. **契约 §1 原文**：窄写路由**不许**自己实现一套校验（那会出现第二份规则）——它必须调用与工具**同一个**写函数。
2. **契约 §4.1** 把它列为第 1 条风险：窄写路由与工具必须共用同一个写函数。
3. **P1 落地的注释把后果写死了**：`and false of another, which is what R189-contract.md §1 rules out.`（`:586`，锚 `notes-second-rule-rationale`）——第二份边界判定不是「多一次检查」，是**同一条规则对一个写者为真、对另一个写者为假**。
4. **门 123 用读数 06 钉它**：`'06-the-route-and-appendNote-write-byte-identical-ledgers'`——同一入参经两路写出的账本**逐字节相同**（含整目录 sha256）。
5. **同一原则在本包里已有先例**（另一条规则、同一手法）：胜负规则 import 交错、**不复制**——`const folded = foldClaim(…)`（锚 `notes-foldclaim-imported`）；模块头写明理由：两个副本就是「同一条便条，一个折叠说 open、另一个说 done」。

⇒ **唯一允许的形态**：路由只做「把请求体读成 JSON、把字段交给 `writeOneNote`、把它的拒原样答回去」。任何能在路由里**拒掉**一条便条的本地检查都是第二份规则；任何拒不掉东西的本地检查是死代码。

### 1.3 审批与路由：两个写入口，一套校验

- 审批只在工具那条路：`ctx.on('tools/pre-execute', …)` 里 `if (exec.name !== ADD_TOOL) return next()` / `return { kind: 'ask' }`；**decision 不带理由**，所以模型读到的拒是内核自己的句子，不是这里的同义词。
- 路由**没有**审批（人不必向自己申请），但它也**没有**因此变宽：字段表固定、一次只写一条、方法不对就 `405`。
- 两条路的工具面/路由面**不共享**任何校验代码的副本——共享的是**那一个函数**。

## 二、路由的形状与码（P1 已落盘）

### 2.1 两条路由

| 形状 | `GET /api/dsh-link-notes/state` | `POST /api/dsh-link-notes/add` |
|---|---|---|
| 路径常量 | `NOTES_ROUTE_PATH`（`:98`） | `NOTES_ADD_ROUTE_PATH`（`:108`） |
| 方法面 | GET/HEAD 之外 ⇒ `405`（`:910-913`） | POST 之外 ⇒ `405`（`:927-930`） |
| 回答 | `ok / path / readOnly / limits / counts / notes`（`:882-905`） | `{ ok: true, seq, notes }`（`:949`） |
| 只读 | 自报 `readOnly: true`（`:888`）；handler 除了 `sendJson` 什么都不做（`:916`） | 只 append **一条**（`:948`） |
| 阈值 | 行解析的那一份**原样带出**（`:891`） | 同一个 `limits` 对象交给写函数（`:948`） |
| 便条行 | 只列**活**便条（墓碑只进计数，不进列表）（`:904`） | — |
| 绑定 | 两条一起注册到 `webServer`（`:956-966`），两条启动行（`:968-969`） | 同左 |

⚠ 本节行号是**写作时刻**的读数；判据是页尾表里的自愈锚（这个文件本轮还会动）。

### 2.2 `405` 具名（照它的形状写，不是照我的概括写）

- 码：`METHOD_NOT_ALLOWED`（`:119`，锚 `notes-method-not-allowed-code`）——**故意不叫** `NOTES_*`：`NOTES_*` 是「一条便条被拒」的家族，这里是「一个动词被拒」。
- 正文把**收到的那个动词**写进去：`message: noun + ' takes ' + allowed + ' and nothing else, so ' + String(req.method) + ' was refused'`（`:807`）。
- 还带 `Allow` 头（`:802`），并且把请求体**排掉**（`:801`——不排，socket 会带着半读的体被拆，调用方会读成「服务端坏了」）。
- 两条路由各自的 noun 与 allowed：`dsh-link-notes state` / `GET`（`:911`）、`dsh-link-notes add` / `POST`（`:928`）。

### 2.3 三码经路由可达（原样透传，不重命名）

| 码 | 谁抛 | 路由给的状态 | 路由给的消息 |
|---|---|---|---|
| `NOTES_INPUT` | `writeOneNote`（入参不可用/不是 JSON/体过大） | 400 | **原样**（`:849`：The message is the original text and not a rewrite） |
| `NOTES_TOO_LONG` | `appendNote`（超过 `maxChars` 码点） | 400 | 原样 |
| `NOTES_FULL` | `appendNote`（已有 `maxNotes` 条活便条） | 409 | 原样 |
| 其他 Error | 任何一层 | 500 且 `code: null` | 原样（**不给**它一个 `NOTES_` 名） |

映射点：`REFUSAL_STATUS`（`:840-844`，锚 `notes-refusal-status-map`）与 `refusalAnswer`（`:856-863`）。三码的**定义**只在 `REFUSALS` 里出现一次（`:60`），路由不认识第四个码。

### 2.4 Agent 走不到这条路由（三条独立证据）

1. 路由**注册在 webServer**（`:961-976`，锚 `notes-routes-on-webserver`），不是注册进工具表；工具面只有两个名字：`const TOOL_NAMES: readonly string[] = [LIST_TOOL, ADD_TOOL]`（`:522`），注册点只有 `installTools` 里那一处循环。
2. **启动行自己说**：`the notes_add tool is NOT this path`（`:969`，锚 `notes-boot-add-route`）——这句话就是 P1 钉给「两条路不是同一条」的。
3. 写入口只对本机同源（契约 §4.4 的口径；与 R188 面板路由同形）。

### 2.5 本节判不了什么（具名）

- 「GET 真的一个账本字节都不改」「两路写出的账本逐字节相同」「三码真的能经 HTTP 打到」——这三条都要**跑起来**，读数是**门 123**的：`gate123-get-no-byte` / `gate123-byte-identical` / `gate123-code-too-long` / `gate123-405-allow-header`。本页给的是**源码层**：我看 handler 里只有 `sendJson`，但「只有」是一句阅读，不是一条运行读数。
- **鉴权口径本页没有读数**：只对本机同源这件事要么在 webServer 那一层、要么还没实现；本页不替它背书。

## 三、标记的读法与其边界（★ 契约 §4.2）

### 3.1 形状与同族

- **实码**：`markerFrom`（`plugins/dsh-link-panel/src/client/view.ts:504`）正常时返回 `{ mounted: true, tabId, items, notes: { count, limits }, failed: null }`；任一读失败时返回 `{ mounted: true, failed: first.code + ': ' + first.detail }`。
- 键：`MARKER_KEY = '__dshLinkPanel'`（`register.ts:26`），与 R188 的 `__dshLinkMarkdown` **同族**（同一套三态、同一套「失败也写标记、绝不抛」）。
- `tabId` 是注册身份 `PANEL_TAB_ID = 'dsh-link-panel'`；标签类型是 `kind = 'pane'`（`view.ts:29`）——取自面板宿主半的闭集 `PANEL_KINDS`（`plugins/dsh-link-panel/src/index.ts:63`）里「落右栏」的那一个。
- `items` 是**可见条目的数组**（不是计数）；`notes.count` 是**面板画出来的行数**；`notes.limits` 是**路由原样带的阈值对象**（客户端不重算、不翻译）。

### 3.2 三态（都不许抛）

| 态 | 写什么 | 在哪 |
|---|---|---|
| 挂上 | `markView(globals, face.initial())` | `register.ts:170` |
| 失败 | `{ mounted: true, failed: <错误原文> }`（注册抛错或读失败都落这里） | `register.ts:115`（写入那一行）、`:165`（注册抛错）、`:171`（读失败）、`view.ts:507` |
| 卸下 | `{ mounted: false, disposed: true }` | `register.ts:119` |

### 3.3 怎么读它：一次活页面里的**只读**求值

`globalThis.*` 只能**在活页面里求值**才读得到（R188 的读法原文：只读 CDP `Runtime.evaluate`）。R189 要读它的是**门 124**（live、只读、零面板操作、零模型回合）。**本页（P3）没读**——P3 全程离线。

### 3.4 边界①：它**不证明像素**

契约 §4.2 原文：**要读像素得开面板（那要独占窗口）**。R188 记档把同一条写得更直白：渲染产物一条读数都没有、**渲染门要开面板**、会跟正在用的人抢 ⇒ 排后。本页把这一条写成**禁令**：**不许**把 `globalThis.__dshLinkPanel` 的绿写成「用户看得见」。

### 3.5 边界②（我读源码读出来的那条缝）：`mounted` 先于「读回来」

`markView(globals, face.initial())`（`register.ts:170`）跑在 `void face.load()`（`:171`）**之前**，而 `face.initial()` 是一份**空的、两个槽都 pending 的**视图。于是：

- `mounted === true` **只**证明「注册那一段跑到了」；
- 「两条路由读回来了」是**另一件事**：要另看 `items` 与 `notes.limits` 是否与**真路由**的回答一致——那正是门 124 的判据（契约 §2 的 P2 行把它写死了）；
- 谁把 `mounted === true` 当成「读到了」，就会把「注册成功、两次读都还没回来」读成绿。

### 3.6 第三态（本节三条，具名）

1. **标记在，面板不在**：`mounted === true` 是自报；标签页被折叠/隐藏、或根节点尺寸为 0 时它照样为真。
2. **标记是「算出来的」不是「画出来的」**：视图模型是纯函数 ⇒ 模型对了**不代表**画对了。
3. **挂上之后 body 抛错**这一类**不判**（R188 的同一条）。

## 四、用户可见文案（键 + en 值；事实的家不在这里）

### 4.1 一个事实一个家：这些字在 R190 搬进了字典

- **R189 的事实（当时为真）**：这些字是**硬编码英文**，取舍写在两处注释里（`English: this package ships no locale namespace`、`stylesheet and no locale namespace`）。R190 把面板客户端半的文案搬进 locale 字典后，那两条注释**消失了** ⇒ 本页当时锚在它们字面量上的 **17 条针一起失效**（实测 `116 of 133`、exit 1）。**页跟着产品重锚**，逐条读数见 §4.4。
- **R190 的事实**：**键**在 `plugins/dsh-link-panel/src/client/locales.ts`（`NS = 'dsh-link-panel'`，zh/en 各 20 键 —— 20 是那两个字典的**写作时刻**读数），源码里只剩 `t('…')` 调用点；契约把「文案一律经 `ctx.locale` 命名空间」写成硬要求（锚 `r190-copy-rule-locale`）。
- **事实的家（本页不再复制副本，一份事实一个家）**：
  - **口径与实数**：产品侧的 `docs/dev/client-copy-and-icons.md`（命名空间规则、census、`zh == en` 的逐条解释）—— 锚 `panel-copy-facts-home`。
  - **唯一真源**：各包自己的 `locales.ts`（这里就是 `plugins/dsh-link-panel/src/client/locales.ts`）；键集由类型 `PanelCopyKey = keyof typeof zh` 持有（锚 `panel-client-copy-keyset-source`）。
  - ⇒ 本页 §4.2 只留一张**索引**（位置 → 键 → **写作时刻**的 en 值）：**判据是键**，针钉在**键与 `t()` 调用点**上 —— 值改了，本页**不会红**。
- **「这些字改错了不会红」这句要改口径（R189 的写法今天不成立）**：
  - ① **产品侧新装的闸门**：脚本 `scripts/verify-client-copy-and-icons.mjs`（R190 契约里的**门 125**，offline）扫 `plugins/**/src/client/**` —— 硬编码文案、`t()` 的键必须落在字典里、zh/en 键集相同（契约里那一行见锚 `r190-gate125-declared`）；**登记**由 Lead 做（契约收口口径）；我读 `scripts/verify-all.mjs` 时那里**还没有**这个门 —— 那句是**我那一刻**的读数。
  - ② **产品自己的自检**把本页 §4.2 的**冻结格逐条对着 en 字典核**，读的是**发出去的那一页**（锚 `panel-selfcheck-reads-this-table`）⇒ 值改**错**了，红的是**它**，不是本页的针。
  - ③ 内核那道 `verify-client-ui-i18n` 今天仍然只覆盖内核根目录（`core/deepseek-harness/scripts/verify-client-ui-i18n.ts:14`、`:321`/`:326`/`:330`）⇒ **`dsh-link/plugins/**` 一个文件都不在它里面**（R189 的这条口径今天仍成立）。
- ⚠ 边界（本页持有与不持有，具名）：本页持有**键**与我读到的 **en 值**；**不**持有渲染（那要像素，见 §3.4），也**不**持有翻译质量的裁决（zh 值今天在，但「翻得好不好」本页判不了）。

### 4.2 索引表（位置 → 键 + en 值；判据是键）

⚠ 两条读法：① 表头第 3 格那串字（`逐字（原样）`）**一字不改** —— 产品的自检按那串字定位这张表（锚 `panel-selfcheck-reads-this-table`）；② 第 4 格（**键**）是本轮加的列，第 3 格列的是**今天 en 字典里的值**（写作时刻读数）：改值不必来改这一页，页尾表的针钉的是**键与调用点**。

| 位置 | 逐字（原样） | 锚 | 键 |
|---|---|---|---|
| 标签页标题 / guide 标题 | `LINK panel` | `panel-client-title` | tab.title |
| guide 描述（一行） | `What the panel registry declares — its visible items, the items it refused by name — and the note ledger, with a box to add one note.` | `panel-client-guide` | guide.description |
| 模式签 | `read-only` | `panel-client-readonly-chip` | panel.readonly |
| 两路读数行 | `registry <pending/ok/failed> · ledger <pending/ok/failed>` | `panel-client-reads-text` | panel.reads（那三个态另有键 `state.pending`/`state.ok`/`state.failed`，锚 `panel-client-state-keys`） |
| 条目区空态 | `no visible item` | `panel-client-items-empty` | items.empty |
| 登记拒绝区空态 | `nothing refused` | `panel-client-refused-empty` | refused.empty |
| 便条计数 | `<N> note(s)` | `panel-client-count` | notes.count |
| 阈值行（读到了） | `limits: <maxNotes> live note(s), <maxChars> character(s) each` | `panel-client-limits-text` | notes.limits |
| 阈值行（还没读到） | `limits: not read` | `panel-client-limits-unread` | notes.limitsUnread |
| 便条区空态 | `no note in the ledger` | `panel-client-notes-empty` | notes.empty |
| 输入框（placeholder 与 aria-label 同一句） | `one note` | `panel-client-input` | input.label |
| 按钮（闲/忙） | `add note` / `adding…` | `panel-client-submit` | submit.idle / submit.busy |
| 失败行（每槽一条） | `<slot>: <code>: <detail>` | `panel-client-failure-line` | failure.line |
| 提交结果行 | `<code>: <detail>` | `panel-client-result-line` | copy.format.line |
| 拒绝行里没有码时 | `no code` | `panel-client-no-code` | refusal.noCode |
| 路由的拒怎么显示 | 路由的 code + message **原样**；客户端不重命名（原文在 view.ts，锚见第 3 格） | `panel-client-refusals-belong-route` | **不走字典**：那两片是路由自己的数据 |

上表覆盖的是 R189 冻结的那 16 条。字典里另有两条**不在**上表、本页照样给它们留了针：读数态的**三键**（锚 `panel-client-state-keys`）与条目元行 `item.meta`（锚 `panel-client-item-meta`）；键的**全量**清单归 copy 页（一份事实一个家）。

### 4.3 本节判不了什么（具名）

这些字有没有真的画在面板上、有没有被截断/换行、aria-label 有没有被辅助工具读到——**全都要像素**。本页的针只证明两件事：**键在字典里**、**那一处 `t()` 调用了它**；「键真的取到了值、值真的画出来了」是产品自检（C5/C6）与门 125 的读数，不是本页的。

### 4.4 这次重锚的逐条读数（对照 HEAD `0243340`）

R190 把文案搬进字典后，本页 17 条针的实测：`check-protocol-page --page docs/dev/notes-ui.md` 报 **`116 of 133`、exit 1**。下表左列是**当时**锚的原文与它在 **HEAD 版源码**里的行（HEAD = R190 契约那次提交 `0243340`，行号钉住不动），右列是**今天为真**的地方（针已改指它；行号只作阅读辅助，判据是页尾表的自愈针）。

| # | id | R189 锚的原文（HEAD 版的行） | 今天为真（针已改指） |
|---|---|---|---|
| 1 | `panel-client-title` | `export const PANEL_TITLE = 'LINK panel'`（`register.ts:21`） | `t('tab.title')`（`index.tsx:246`） |
| 2 | `panel-client-guide` | `export const PANEL_GUIDE_DESCRIPTION` 的整句英文（`register.ts:24`） | `t('guide.description')`（`register.ts:101`） |
| 3 | `panel-client-english-choice` | `/** … English: this package ships no locale namespace. */`（`register.ts:20`） | `ctx.locale.register(NS, { zh, en })`（`index.tsx:258`）；旧 id 按事实改名 `panel-client-copy-ns-registered` |
| 4 | `panel-client-english-choice-2` | `* … no locale namespace (the copy below is English, like the rest of this package).`（`index.tsx:18`） | `ctx.locale.bind(NS)`（`index.tsx:259`）；旧 id 改名 `panel-client-copy-bound`，另加 `panel-client-copy-keyset-source`（`locales.ts:76`） |
| 5 | `panel-client-notes-empty` | `… data-panel-empty="notes">no note in the ledger</li>`（`index.tsx:167`） | `t('notes.empty')`（`index.tsx:216`） |
| 6 | `panel-client-items-empty` | `… data-panel-empty="items">no visible item</li>`（`index.tsx:137`） | `t('items.empty')`（`index.tsx:186`） |
| 7 | `panel-client-refused-empty` | `… data-panel-empty="refused">nothing refused</li>`（`index.tsx:150`） | `t('refused.empty')`（`index.tsx:199`） |
| 8 | `panel-client-input` | `placeholder="one note" aria-label="one note"`（`index.tsx:172`） | `placeholder={t('input.label')} aria-label={t('input.label')}`（`index.tsx:221`） |
| 9 | `panel-client-submit` | `{busy ? 'adding…' : 'add note'}`（`index.tsx:175`） | `{busy ? t('submit.busy') : t('submit.idle')}`（`index.tsx:224`） |
| 10 | `panel-client-readonly-chip` | `… data-panel-readonly="">read-only</span>`（`index.tsx:124`） | `{t('panel.readonly')}`（`index.tsx:173`） |
| 11 | `panel-client-count` | `{String(view.notes.rows.length) + ' note(s)'}`（`index.tsx:161`） | `t('notes.count', { count: … })`（`index.tsx:210`） |
| 12 | `panel-client-limits-text` | `return 'limits: ' + String(notes) + ' live note(s)…'`（`index.tsx:57`） | `t('notes.limits', { maxNotes, maxChars })`（`index.tsx:95`） |
| 13 | `panel-client-limits-unread` | `typeof limits !== 'object')`（`index.tsx:52`）——**针还在、分片没了**：那行今天返回 `t('notes.limitsUnread')` | `t('notes.limitsUnread')`（`index.tsx:90`） |
| 14 | `panel-client-failure-line` | `{failure.source + ': ' + failure.code + ': ' + failure.detail}`（`index.tsx:132`） | `t('failure.line', { slot, code, detail })`（`index.tsx:181`） |
| 15 | `panel-client-result-line` | `{outcome.code + ': ' + outcome.detail}`（`index.tsx:181`） | `t('copy.format.line', { code: outcome.code, detail: outcome.detail })`（`index.tsx:230`） |
| 16 | `panel-client-no-code` | `{(row.code ?? 'no code') + ': ' + row.detail}`（`index.tsx:154`） | `t('copy.format.line', { code: row.code ?? t('refusal.noCode'), … })`（`index.tsx:203`） |
| 17 | `panel-client-reads-text` | `{'registry ' + view.reads.panel + ' · ledger ' + view.reads.notes}`（`index.tsx:127`） | `t('panel.reads', { panel: t(STATE_KEYS[view.reads.panel]), notes: … })`（`index.tsx:176`） |

**这次搬家的形态（一句话）**：源码里那些英文字面量**按设计消失**，同一批字进了 `locales.ts` 的 zh/en 两个字典，调用点从「写死一句话」改成「取一个键」⇒ 本页的锚也只能跟着从「那句话」搬到「那个键」。

## 五、本页自己的第三态与「亲手造的红」

- **谁在读它（R190 重测）**：**门 123 `notes-route`** 的**读数 11** 就是这条命令 —— 它跑 `check-protocol-page.mjs --page docs/dev/notes-ui.md`，要求打印的 `N of M` 满足 `N === M` 且 `M >= 10`（读数原文见锚 `gate123-reading11-page`）；**读数 12** 是它的成对反证：把页里一条引文改坏，同一条命令必须非零（锚 `gate123-reading12-page-reddens`）。门 124（`panel-live`）**不打开本页**。

  ```
  node scripts/check-protocol-page.mjs --page docs/dev/notes-ui.md
  ```

  ⚠ 这条要改口径（R189 的写法是「门 123 与门 124 都不打开本页」）：门 123 今天**确实**打开它 —— 这正是本轮 R190 的红：产品把文案搬进字典后，本页 17 条针失效（`116 of 133`、exit 1），门 123 的读数 11 跟着红。**修法是页跟着产品走**（重锚），不是回退产品、也不是改门。`scripts/verify-all.mjs` 里搜 `check-protocol-page` 仍是 **0 命中**；`verify-doc-citations.mjs` 默认的三份文档是硬编码的（`device-net-v1.md`/`PLAN.md`/`STATUS.md`），**不含本页**（锚 `gate-doc-citations-default-docs`）。
- **成对反证（做法 + 亲手造的红；R190 在这一版上实跑）**：① 就地改坏一条 needle（改成源码里不再出现的文本）⇒ 核对器报 **`140 of 141 citation(s) hold`**、exit 1，FAIL 行**具名**：`the file no longer contains "code: 'METHOD_ALLOWED',"`；② 用**逐字节**备份改回 ⇒ sha256 与改前**一致**、核对器回到 **`141 of 141`**/exit 0（读数与 sha 见 §5.1）。条数随本页行数变，做法不变。
- **反证的边界（照 R188 P4 踩过的坑）**：核对器的分片判定是**子串包含**（`scripts/check-protocol-page.mjs:97`）⇒ 把 needle 改成真文本的**前缀**照样绿；反证必须改到**不再是子串**，或者让它**不再唯一**（`path#text` 出现在两行也是红）。
- **本页读不到什么（具名）**：① 像素（面板在右栏长什么样、会不会被折叠）；② 活体那一侧的任何东西（写本页时全程离线）；③ 路由的**运行**行为（那是门 123 的读数，见 §2.5）；④ 翻译质量（zh 值今天在，但「翻得好不好」本页判不了）。

### 5.1 收尾读数（R190 重锚这一轮的验收，逐条命令原文）

| # | 命令 | 读数 |
|---|---|---|
| 1 | `node scripts/check-protocol-page.mjs --page docs/dev/notes-ui.md` | `141 of 141 citation(s) hold`、exit 0（重锚**前**：`116 of 133`、exit 1） |
| 2 | `node scripts/verify-notes-route.mjs` | `12 readings, 0 failed`、exit 0（门 123 复绿 —— 它的读数 11/12 就长在本页上） |
| 3 | 成对反证：就地改坏一条 needle（`panel-405-code`）⇒ 必红 ⇒ 逐字节改回 | 改坏 `panel-405-code` 那行的 needle（`code: 'METHOD_NOT_ALLOWED',` ⇒ `code: 'METHOD_ALLOWED',`）⇒ `140 of 141`、exit 1，FAIL 行具名 `the file no longer contains "code: 'METHOD_ALLOWED',"`；**逐字节**备份改回 ⇒ sha256 `4F20855D…81500` 与改前**一致**、`48412 B`、回到 `141 of 141`/exit 0 |
| 4 | `git status --porcelain` | 我这一轮**只多一条** ` M dsh-link/docs/dev/notes-ui.md`；其余是别人的在飞改动（`dsh-link-markdown/**`、`dsh-link-panel/**`、`dsh-link/docs/dev/client-copy-and-icons.md`、`dsh-link/scripts/verify-client-copy-and-icons.mjs`）与一条我进来之前就在的 ` M cef-probe/tauri-runtime-cef` |
| 5 | `node plugins/dsh-link-panel/test/panel-client-view.spec.mjs`（**产品的自检**：它的 C3 读本页 §4.2 的第三格） | `35 readings, 35 held, 0 failed`、exit 0；其中 **C3** = `15 row(s) read, 15 anchor(s) mapped`（第三格逐条 = en 字典）。**耦合可红的实测**：我中途把那一行的锚名也写成反引号 ⇒ C3 红（`no dictionary key is mapped to the page anchor`）⇒ 去掉反引号即绿 —— 这条耦合不是修辞 |
| 6 | 本页字节与哈希（**时刻读数**：这张表自己也会改字节） | 反证往返那一版 = `48412 B` / sha256 `4F20855D67A5396E33AA301617CC7A746A531848D238ACFF7A21A2ACA1581500`（**这张表写完之后本页又改了字** ⇒ 要拿**当前**字节的确定性身份，跑 `git hash-object docs/dev/notes-ui.md`，只读、不写 git） |

**我亲手造的红（点名列全）**：① 上面第 3 条那一次 —— 只在**本页**上改、并按**逐字节**备份改回，树上的本页回到原字节（sha 一致）；② 上面第 5 条那次**耦合红**（产品的 C3，因我给 §4.2 那行的锚名加了反引号而红，去掉即绿）—— 同样是「改了又改回」；③ **没有第三种**：没跑整套 `verify-all.mjs`、没碰内核、没碰别人的包/门、没做 git 写操作、没连任何活体端口（31761/31760/9222）。

## 六、这份页面的引文（机器核对，别只信人眼）

下面这张表是本页的**判据表**：每条规则钉到**真实存在的** `path:line`（pin 住的内核）或 `path#text`（会动的 `plugins/**` / 门 / 记档）与该处**必须含有的**文本上。核对器：

```
node scripts/check-protocol-page.mjs --page docs/dev/notes-ui.md
```

<!-- citations -- checked by scripts/check-protocol-page.mjs --page docs/dev/notes-ui.md; keep needles and fragments in sync; plugins/** and scripts/verify-all.mjs are self-healing path#text on purpose (they move this round). R190: the panel client half's copy moved into plugins/dsh-link-panel/src/client/locales.ts, so the copy rows name the KEY and the t() call site - never an English literal -->
| id | where | must contain |
|---|---|---|
| notes-shared-write-function | plugins/dsh-link-notes/src/index.ts#export async function appendNote( | - |
| notes-write-refuses-too-long | plugins/dsh-link-notes/src/index.ts#throw new Error(REFUSALS.TOO_LONG | REFUSALS.TOO_LONG ; shorten it and append again |
| notes-write-refuses-full | plugins/dsh-link-notes/src/index.ts#throw new Error(REFUSALS.FULL | REFUSALS.FULL ; nothing was appended |
| notes-refusals-frozen | plugins/dsh-link-notes/src/index.ts#export const REFUSALS = Object.freeze({ | - |
| notes-code-input | plugins/dsh-link-notes/src/index.ts#INPUT: 'NOTES_INPUT' | NOTES_INPUT |
| notes-code-too-long | plugins/dsh-link-notes/src/index.ts#TOO_LONG: 'NOTES_TOO_LONG' | NOTES_TOO_LONG |
| notes-code-full | plugins/dsh-link-notes/src/index.ts#FULL: 'NOTES_FULL' | NOTES_FULL |
| notes-limit-notes-default | plugins/dsh-link-notes/src/index.ts#export const DEFAULT_MAX_NOTES = 200 | 200 |
| notes-limit-chars-default | plugins/dsh-link-notes/src/index.ts#export const DEFAULT_MAX_CHARS = 100 | 100 |
| notes-agent-write-tool | plugins/dsh-link-notes/src/index.ts#export const ADD_TOOL = 'notes_add' | notes_add |
| notes-agent-read-tool | plugins/dsh-link-notes/src/index.ts#export const LIST_TOOL = 'notes_list' | notes_list |
| notes-only-two-tools | plugins/dsh-link-notes/src/index.ts#const TOOL_NAMES: readonly string[] = [LIST_TOOL, ADD_TOOL] | - |
| notes-tools-registered-host-layer | plugins/dsh-link-notes/src/index.ts#for (const definition of [listTool(store), addTool(store, limits)]) { | - |
| notes-ask-hook | plugins/dsh-link-notes/src/index.ts#ctx.on('tools/pre-execute' | - |
| notes-ask-decision | plugins/dsh-link-notes/src/index.ts#return { kind: 'ask' } | - |
| notes-ask-only-for-add | plugins/dsh-link-notes/src/index.ts#if (exec.name !== ADD_TOOL) return next() | - |
| notes-foldclaim-imported | plugins/dsh-link-notes/src/index.ts#const folded = foldClaim({ at: previous.at, seq: previous.seq } | foldClaim |
| notes-section-heading | plugins/dsh-link-notes/src/index.ts#const SECTION_HEADING = 'Notes ledger — live notes, oldest first:' | - |
| notes-readme-ask-every-call | plugins/dsh-link-notes/README.md#notes_add` (asks every call) | - |
| notes-readme-three-layers | plugins/dsh-link-notes/README.md#The thresholds, at three layers | - |
| rule-user-write-route | docs/handoff/R189-contract.md#**用户（在面板里敲）** | - |
| rule-state-route-readonly | docs/handoff/R189-contract.md#（只读：折叠 + 阈值 + 计数） | - |
| rule-author-defaults-user | docs/handoff/R189-contract.md#`author` 缺省 `user` | user |
| rule-405-for-other-verbs | docs/handoff/R189-contract.md#非 GET/POST ⇒ `405` | 405 |
| rule-one-note-per-call | docs/handoff/R189-contract.md#一次一条、字段固定 | - |
| rule-agent-cannot-reach-route | docs/handoff/R189-contract.md#**Agent 不许走窄写路由** | - |
| rule-not-a-tool | docs/handoff/R189-contract.md#不注册成任何工具 | - |
| rule-same-write-function | docs/handoff/R189-contract.md#它必须调用与工具**同一个**写函数 | - |
| rule-no-second-validation | docs/handoff/R189-contract.md#**不许**自己实现一套校验 | - |
| rule-no-second-validation-risk | docs/handoff/R189-contract.md#窄写路由与工具必须共用同一个写函数 | - |
| rule-bytes-identical | docs/handoff/R189-contract.md#与 `appendNote` **逐字节同一结果** | - |
| rule-same-origin-only | docs/handoff/R189-contract.md#只对本机同源开放 | - |
| rule-gate123-offline | docs/handoff/R189-contract.md#**门 123 `notes-route`**（offline） | - |
| rule-gate124-live | docs/handoff/R189-contract.md#**门 124 `panel-live`**（live，只读） | - |
| rule-p3-writes-this-page | docs/handoff/R189-contract.md#`docs/dev/notes-ui.md`（新文件） | - |
| panel-route-path | plugins/dsh-link-panel/src/index.ts#export const PANEL_ROUTE_PATH = '/api/dsh-link-panel/state' | - |
| panel-readonly-flag | plugins/dsh-link-panel/src/index.ts#readOnly: true, | - |
| panel-get-only | plugins/dsh-link-panel/src/index.ts#if (req.method !== 'GET' && req.method !== 'HEAD') { | - |
| panel-405-code | plugins/dsh-link-panel/src/index.ts#code: 'METHOD_NOT_ALLOWED', | - |
| panel-405-message | plugins/dsh-link-panel/src/index.ts#is read-only: GET is the only verb | - |
| panel-route-bound-boot | plugins/dsh-link-panel/src/index.ts#state route bound on | - |
| panel-kinds-closed | plugins/dsh-link-panel/src/index.ts#export const PANEL_KINDS: readonly string[] = Object.freeze(['pane', 'action', 'status']) | - |
| panel-pane-sink | plugins/dsh-link-panel/src/index.ts#pane: 'right-rail', | - |
| marker-key | plugins/dsh-link-markdown/src/client/register.ts#export const MARKER_KEY = '__dshLinkMarkdown' | - |
| marker-on-success | plugins/dsh-link-markdown/src/client/register.ts#globals[MARKER_KEY] = marker | - |
| marker-on-failure | plugins/dsh-link-markdown/src/client/register.ts#globals[MARKER_KEY] = { registered: false, failed: errorText(error) } | registered: false |
| marker-fail-closed | plugins/dsh-link-markdown/src/client/register.ts#markFailed(globals, error) | - |
| marker-in-built-bundle | plugins/dsh-link-markdown/lib/client.js#var MARKER_KEY = "__dshLinkMarkdown"; | - |
| live-gate-reads-marker | scripts/verify-client-plugin-live-rows.mjs#const MARKER_KEY = '__dshLinkMarkdown' | - |
| rule-marker-shape | docs/handoff/R189-contract.md#globalThis.__dshLinkPanel = { mounted, tabId, items, notes: { count, limits }, failed } | - |
| rule-marker-proves-view | docs/handoff/R189-contract.md#只证明「客户端半跑了并算出了视图」 | - |
| rule-marker-not-pixels | docs/handoff/R189-contract.md#要读像素得开面板（那要独占窗口） | - |
| rule-marker-three-states | docs/handoff/R189-contract.md#成功/失败/卸载三态都不许抛 | - |
| r188-marker-cdp | docs/handoff/R188-handoff.md#只读 CDP | - |
| r188-render-needs-panel | docs/handoff/R188-handoff.md#渲染门要开面板 | - |
| i18n-source-files | core/deepseek-harness/scripts/verify-client-ui-i18n.ts:319 | function sourceFiles(): string[] |
| i18n-corpus-plugin-client | core/deepseek-harness/scripts/verify-client-ui-i18n.ts:321 | globSync('packages/*/*/src/client/**/*.tsx' ; cwd: root |
| i18n-corpus-kernel-packages | core/deepseek-harness/scripts/verify-client-ui-i18n.ts:326 | globSync('packages/client/*/src/**/*.tsx' ; cwd: root |
| i18n-corpus-web-app | core/deepseek-harness/scripts/verify-client-ui-i18n.ts:330 | globSync('apps/web/src/**/*.{ts,tsx}' ; cwd: root |
| checker-self-healing-form | scripts/check-protocol-page.mjs:73 | EXACTLY ONCE ; self-healing |
| checker-fragments-are-substrings | scripts/check-protocol-page.mjs:97 | !text.includes(flat(fragment)) |
| checker-row-with-pipe-is-malformed | scripts/check-protocol-page.mjs:53 | malformed.push(line) |
| build-check-is-lib-drift | plugins/build.mjs#fail if lib/ differs from a fresh build | --check |
| gate-122-registered | scripts/verify-all.mjs#name: 'client-plugin-live-rows', kind: 'live' | - |
| gate-build-runs-the-check | scripts/verify-all.mjs#name: 'build', kind: 'offline' | plugins/build.mjs ; --check |
| gate-doc-citations-default-docs | scripts/verify-doc-citations.mjs:30 | docs/handoff/PLAN.md ; docs/handoff/STATUS.md |
| notes-route-state-path | plugins/dsh-link-notes/src/index.ts#export const NOTES_ROUTE_PATH = '/api/dsh-link-notes/state' | - |
| notes-route-add-path | plugins/dsh-link-notes/src/index.ts#export const NOTES_ADD_ROUTE_PATH = '/api/dsh-link-notes/add' | - |
| notes-route-author-user | plugins/dsh-link-notes/src/index.ts#export const ROUTE_AUTHOR = 'user' | user |
| notes-method-not-allowed-code | plugins/dsh-link-notes/src/index.ts#export const METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED' | - |
| notes-write-fields | plugins/dsh-link-notes/src/index.ts#const WRITE_FIELDS: readonly string[] = Object.freeze(['text', 'tags', 'author']) | - |
| notes-one-write-path | plugins/dsh-link-notes/src/index.ts#async function writeOneNote(store: NotesStore, raw: unknown, caller: { who: string, author: string }, limits: NotesLimits): Promise<NoteWrite> { | - |
| notes-only-appendnote-call-site | plugins/dsh-link-notes/src/index.ts#* THIS is the package's only `appendNote` call site. The `notes_add` tool and the narrow route | appendNote |
| notes-second-rule-rationale | plugins/dsh-link-notes/src/index.ts#* and false of another, which is what R189-contract.md §1 rules out. | §1 rules out |
| notes-tool-calls-one-write-path | plugins/dsh-link-notes/src/index.ts#const written = await writeOneNote(store, args, { who: ADD_TOOL, author: AGENT_AUTHOR }, limits) | AGENT_AUTHOR |
| notes-route-calls-one-write-path | plugins/dsh-link-notes/src/index.ts#const written = await writeOneNote(store, parsed, { who: NOTES_ADD_ROUTE_PATH, author: ROUTE_AUTHOR }, limits) | ROUTE_AUTHOR |
| notes-agent-author | plugins/dsh-link-notes/src/index.ts#const AGENT_AUTHOR = 'agent' | agent |
| notes-write-refuses-input | plugins/dsh-link-notes/src/index.ts#throw new Error(REFUSALS.INPUT + ': ' + caller.who + ' needs text: a non-empty string') | REFUSALS.INPUT ; caller.who |
| notes-refusal-status-map | plugins/dsh-link-notes/src/index.ts#const REFUSAL_STATUS: Readonly<Record<string, number>> = Object.freeze({ | - |
| notes-refusal-status-full-409 | plugins/dsh-link-notes/src/index.ts#[REFUSALS.FULL]: 409, | 409 |
| notes-refusal-verbatim | plugins/dsh-link-notes/src/index.ts#* The message is the original text and not a rewrite: this route is a second DOOR to one rule, and a | - |
| notes-state-get-only | plugins/dsh-link-notes/src/index.ts#if (req.method !== 'GET' && req.method !== 'HEAD') { | - |
| notes-add-post-only | plugins/dsh-link-notes/src/index.ts#if (req.method !== 'POST') { | - |
| notes-405-named | plugins/dsh-link-notes/src/index.ts#code: METHOD_NOT_ALLOWED, | - |
| notes-405-names-verb | plugins/dsh-link-notes/src/index.ts#message: noun + ' takes ' + allowed + ' and nothing else, so ' + String(req.method) + ' was refused', | refused |
| notes-state-readonly | plugins/dsh-link-notes/src/index.ts#readOnly: true, | - |
| notes-state-limits | plugins/dsh-link-notes/src/index.ts#limits: { maxNotes: limits.maxNotes, maxChars: limits.maxChars }, | - |
| notes-state-notes-rows | plugins/dsh-link-notes/src/index.ts#notes: live.map((note) => ({ id: note.id, text: note.text, tags: [...note.tags], state: note.state, author: note.author, at: note.at, seq: note.seq })), | text: note.text |
| notes-read-is-replay | plugins/dsh-link-notes/src/index.ts#return projectNotes(store.log.replay()) | - |
| notes-boot-state-route | plugins/dsh-link-notes/src/index.ts#console.log('[link-notes] state route bound on ' + NOTES_ROUTE_PATH + ' (GET, read-only: the fold, the tombstones and the two thresholds)') | GET, read-only |
| notes-boot-add-route | plugins/dsh-link-notes/src/index.ts#console.log('[link-notes] add route bound on ' + NOTES_ADD_ROUTE_PATH + ' (POST, one note per call, author defaults to "' + ROUTE_AUTHOR + '"; the notes_add tool is NOT this path)') | the notes_add tool is NOT this path |
| notes-routes-on-webserver | plugins/dsh-link-notes/src/index.ts#ctx.inject(['webServer'], () => registerRoutes()) | - |
| gate123-get-no-byte | scripts/verify-notes-route.mjs#* 04 A GET CHANGES NO LEDGER BYTE. The ledger's per-file bytes and sha256 are identical either side | - |
| gate123-byte-identical | scripts/verify-notes-route.mjs#'06-the-route-and-appendNote-write-byte-identical-ledgers', | - |
| gate123-code-too-long | scripts/verify-notes-route.mjs#* 08 NOTES_TOO_LONG TRAVELS OVER THE ROUTE AND WRITES NOTHING. A body of maxChars+1 code points | - |
| gate123-405-allow-header | scripts/verify-notes-route.mjs#* PATCH and POST-state answer 405 with a named code and the Allow header; HEAD is reported and | - |
| panel-client-marker-key | plugins/dsh-link-panel/src/client/register.ts#export const MARKER_KEY = '__dshLinkPanel' | - |
| panel-client-marker-shape | plugins/dsh-link-panel/src/client/view.ts#notes: { count: view.notes.rows.length, limits: view.notes.limits }, | - |
| panel-client-marker-fail | plugins/dsh-link-panel/src/client/view.ts#return { mounted: true, failed: first.code + ': ' + first.detail } | - |
| panel-client-marker-disposed | plugins/dsh-link-panel/src/client/register.ts#const marker: PanelMarkerDisposed = { mounted: false, disposed: true } | - |
| panel-client-mounted-before-reads | plugins/dsh-link-panel/src/client/register.ts#markView(globals, face.initial()) | - |
| panel-client-tab-id | plugins/dsh-link-panel/src/client/view.ts#export const PANEL_TAB_ID = 'dsh-link-panel' | - |
| panel-client-tab-kind | plugins/dsh-link-panel/src/client/view.ts#export const PANEL_TAB_KIND = 'pane' | pane |
| panel-client-title | plugins/dsh-link-panel/src/client/index.tsx#<span className="dsh-link-panel-title" data-panel-title="">{t('tab.title')}</span> | t('tab.title') |
| panel-client-guide | plugins/dsh-link-panel/src/client/register.ts#description: () => t('guide.description'), | t('guide.description') |
| panel-client-copy-ns-registered | plugins/dsh-link-panel/src/client/index.tsx#ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-panel: dictionaries') | ctx.locale.register(NS, { zh, en }) |
| panel-client-copy-bound | plugins/dsh-link-panel/src/client/index.tsx#const t = ctx.locale.bind(NS) | ctx.locale.bind(NS) |
| panel-client-copy-keyset-source | plugins/dsh-link-panel/src/client/locales.ts#export type PanelCopyKey = keyof typeof zh | keyof typeof zh |
| panel-client-user-author | plugins/dsh-link-panel/src/client/view.ts#export const USER_AUTHOR = 'user' | user |
| panel-client-no-own-rule | plugins/dsh-link-panel/src/client/index.tsx#* whole tab is the one note the person types. The pane applies no rule of its own to that note — not a | - |
| panel-client-refusals-belong-route | plugins/dsh-link-panel/src/client/view.ts#* or too long. Those three refusals belong to the route (NOTES_INPUT / NOTES_TOO_LONG / NOTES_FULL), | NOTES_INPUT ; NOTES_TOO_LONG ; NOTES_FULL |
| panel-client-readonly-chip | plugins/dsh-link-panel/src/client/index.tsx#<span className="dsh-link-panel-mode" data-panel-readonly="">{t('panel.readonly')}</span> | t('panel.readonly') |
| panel-client-state-keys | plugins/dsh-link-panel/src/client/index.tsx#const STATE_KEYS: Readonly<Record<ReadState, | state.pending ; state.failed |
| panel-client-item-meta | plugins/dsh-link-panel/src/client/index.tsx#{t('item.meta', { kind: shown(item, 'kind'), sink: sinkOf(view, shown(item, 'kind')), order: shown(item, 'order'), source: shown(item, 'source') })} | item.meta |
| panel-client-notes-empty | plugins/dsh-link-panel/src/client/index.tsx#? <li className="dsh-link-panel-empty" data-panel-empty="notes">{t('notes.empty')}</li> | t('notes.empty') |
| panel-client-items-empty | plugins/dsh-link-panel/src/client/index.tsx#? <li className="dsh-link-panel-empty" data-panel-empty="items">{t('items.empty')}</li> | t('items.empty') |
| panel-client-refused-empty | plugins/dsh-link-panel/src/client/index.tsx#<p className="dsh-link-panel-empty" data-panel-empty="refused">{t('refused.empty')}</p> | t('refused.empty') |
| panel-client-input | plugins/dsh-link-panel/src/client/index.tsx#placeholder={t('input.label')} aria-label={t('input.label')} | aria-label={t('input.label')} |
| panel-client-submit | plugins/dsh-link-panel/src/client/index.tsx#{busy ? t('submit.busy') : t('submit.idle')} | t('submit.busy') ; t('submit.idle') |
| panel-client-count | plugins/dsh-link-panel/src/client/index.tsx#{t('notes.count', { count: view.notes.rows.length })} | notes.count |
| panel-client-limits-text | plugins/dsh-link-panel/src/client/index.tsx#return t('notes.limits', { maxNotes: notes, maxChars: chars }) | notes.limits |
| panel-client-limits-unread | plugins/dsh-link-panel/src/client/index.tsx#typeof limits !== 'object') return t('notes.limitsUnread') | notes.limitsUnread |
| panel-client-failure-line | plugins/dsh-link-panel/src/client/index.tsx#{t('failure.line', { slot: failure.source, code: failure.code, detail: failure.detail })} | failure.line |
| panel-client-result-line | plugins/dsh-link-panel/src/client/index.tsx#{t('copy.format.line', { code: outcome.code, detail: outcome.detail })} | copy.format.line |
| panel-client-no-code | plugins/dsh-link-panel/src/client/index.tsx#{t('copy.format.line', { code: row.code ?? t('refusal.noCode'), detail: row.detail })} | refusal.noCode |
| panel-client-manifest-client | plugins/dsh-link-panel/package.json#"default": "./lib/client.js" | lib/client.js |
| panel-client-platform-web | plugins/dsh-link-panel/package.json#"platform": "web" | web |
| panel-client-build-entry | plugins/build.mjs#{ name: 'dsh-link-panel', client: 'src/client/index.tsx' }, | src/client/index.tsx |
| panel-client-submit-seat | plugins/dsh-link-panel/src/client/index.tsx#<button className="dsh-link-panel-submit" data-notes-submit="" type="submit" disabled={busy}> | disabled={busy} |
| panel-client-reads-seat | plugins/dsh-link-panel/src/client/index.tsx#<p className="dsh-link-panel-reads" data-panel-reads={'panel:' + view.reads.panel + ' notes:' + view.reads.notes}> | view.reads.notes |
| panel-client-reads-text | plugins/dsh-link-panel/src/client/index.tsx#{t('panel.reads', { panel: t(STATE_KEYS[view.reads.panel]), notes: t(STATE_KEYS[view.reads.notes]) })} | panel.reads |
| panel-client-notes-count-seat | plugins/dsh-link-panel/src/client/index.tsx#<span className="dsh-link-panel-notes-count" data-notes-count={String(view.notes.rows.length)}> | dsh-link-panel-notes-count |
| panel-client-limits-seat | plugins/dsh-link-panel/src/client/index.tsx#<span className="dsh-link-panel-notes-limits" data-notes-limits="">{limitsText(view.notes.limits)}</span> | limitsText(view.notes.limits) |
| panel-client-failure-seat | plugins/dsh-link-panel/src/client/index.tsx#data-panel-failure={failure.code} data-panel-failure-from={failure.from} data-panel-failure-slot={failure.source}> | data-panel-failure-from |
| panel-client-result-seat | plugins/dsh-link-panel/src/client/index.tsx#<p className="dsh-link-panel-result" data-notes-result={outcome.code} data-notes-result-from={outcome.from} | outcome.from |
| panel-copy-facts-home | docs/dev/client-copy-and-icons.md#文案：一律经 `ctx.locale` 命名空间 | ctx.locale |
| panel-selfcheck-reads-this-table | plugins/dsh-link-panel/test/panel-client-view.spec.mjs#/** The page's frozen verbatim cells, read from the shipped page rather than restated here. */ | read from the shipped page |
| r190-copy-rule-locale | docs/handoff/R190-contract.md#**文案**：一律经 `ctx.locale` 命名空间 | ctx.locale.bind(NS) |
| r190-gate125-declared | docs/handoff/R190-contract.md#**门 125 `client-copy-and-icons`**（offline） | client-copy-and-icons |
| gate123-reading11-page | scripts/verify-notes-route.mjs#* 11 THE CONTRACT PAGE HOLDS AND CARRIES AT LEAST 10 CITATIONS. check-protocol-page.mjs | AT LEAST 10 CITATIONS |
| gate123-reading12-page-reddens | scripts/verify-notes-route.mjs#* 12 PAIRED: THE PAGE REDDENS WHEN ONE ROW MOVES. A copy whose first path:line citation is shifted | THE PAGE REDDENS |
<!-- /citations -->
