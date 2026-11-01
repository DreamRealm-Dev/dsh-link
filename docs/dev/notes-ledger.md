# 便条账本契约页（md 第 13 条）：阈值三层 · `effective` 语义 · `notes_*` 工具与审批 · 提示词代价

> 本页是 R186 的**接口冻结点**，冻结点来自 `docs/handoff/R186-contract.md` **§9「Lead 裁决（R186 开工令）」**（该节自述「与上文冲突处以本节为准」）。凡本页与 §0–§8 冲突，以 §9 为准。
> 每条断言指到**真实存在的 `file:line`**，页尾引文表由 `scripts/check-protocol-page.mjs --page docs/dev/notes-ledger.md` 逐行机器核对（行号会随源码改动而失效，**这是设计**：源码一动就得有人来对齐，页不许悄悄过期）。
> **本页没有出处的规则一行都不写。**

## 〇、写就时刻的世界口径（可复现）

- **写就时间**：2026-10-11 22:0x（本机）；写者 = R186 生产者 **P3**，写范围**只有本文件**。
- **22:34 校对（本轮）**：写者 = R186 **契约页校对者**（页主 P3 已收工）；**唯一写范围仍只有本文件**，scratch 在 `.tmp/r186-p3b/**`。**没碰**：`core/deepseek-harness/**`（pin）、`src-tauri/**`、活档案 `%APPDATA%\dev.dshlink.client\**`、活体端口 31761/31760/9222、`scripts/verify-all.mjs`、别人的门、git 写操作。本次把 **4 条会漂的行号形引文**改成自愈形、**新增 8 条自愈锚** ⇒ §九 共 **144 条**。
- **22:11 复核重跑（本次）**：上一批同样的活在这台机上被 **600 秒硬超时**中断（不是失败），留下了中间态。我（P3 重跑）先读现状再动手：**逐条复核了页里当时那 109 条引文**，并照 `scripts/check-protocol-page.mjs` 的规则自己另写了一版核对器复算（两次读数逐条一致：**96 成立 / 13 红**）；重写后本页共 **136 条**（§九；**22:34 校对后为 144 条**）。13 条红**全部**是 `plugins/dsh-link-notes/src/index.ts` 被 P1 插入 5 行注释后的**统一 +5 行位移**（**不是**人为突变：HEAD 版 `:274` 逐字就是页里引的那一行，`git diff` 读数是 +5/-1），已把这一族改钉**自愈形式**；§五 的现状改到 **22:18**。⚠ **世界在我复核的中途动过**：P1 在 22:11→22:18 之间把实现落进了 `plugins/dsh-link-notes/src/index.ts`（356 行 → **724 行 / 37131 B**）⇒ 本页凡写「22:11」的句子都是**那一刻的读数**，不是现在的事；§53 有 22:18 的读数列。
- **内核是 pin 住的**：`kernel.lock.json:2` 原文说「The vendored kernel is a pinned upstream checkout and is never edited.」，pin 的 commit 在 `kernel.lock.json:6`。⇒ 本页所有 `core/deepseek-harness/**` 的行号**在 pin 不变的前提下不会漂**。
- **一个必须知道的边界**：`core/deepseek-harness/**` 在本仓 `dsh-link` 里是**未纳入版本控制**的（`.gitignore` 忽略整个内核目录，`.gitignore:13` 即 `dsh-link/core/`；`git check-ignore -v` 报 `core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts` 命中该行）。这条事实决定了本页能不能进 `doc-citations` 门，见 **§九**。
- 被引文件在**本次校对时刻（2026-10-11 22:34，校对者逐条重测）**的 sha256 前 12 位 / 字节数（**本页的漂移基准**，不是判据）：`docs/handoff/R186-contract.md` `CCDE69FEC5CF` / 61996 B（22:34 时它含 Lead **尚未提交**的 §9 R2「插值」行；22:38:11 的 `4e47447` 之后该行已在 HEAD 里、`git status` 对它是空的）、`docs/handoff/STATUS.md` `F250B48A5AF8` / 164297 B（工作区与 HEAD 一致，`git status` 无改动）、`docs/handoff/R185-A-groups.md` `113E638B9F99`、`docs/handoff/R185-F-live-declare.md` `6360DEE4B4ED`、`plugins/dsh-link-notes/src/index.ts` `2C58232FE382` / **37255 B / 727 行**、`plugins/dsh-link-notes/lib/index.js` `79AD1A4CCE9A` / **15477 B / 325 行**（**P1 已收工**：22:11 读到 `60D93175465E` / 17689 B、22:18 读到 `72096A7BEC2A` / 37131 B / 724 行、写就时读到 `FEC85D3E203C` / 17224 B —— 四个读数都在，别拿 22:18 那个当「现状」）、`plugins/dsh-link-groups/cordis.patch.yml` `B4194F2D8B9B` / 3548 B（**P2 已落盘 notes 组**；写就时读到的是撤掉后的 `E4BDA6F138B4` / 3250 B）、`plugins/dsh-link-groups/src/index.ts` `16C3D2386DB2`、`runtime-context.ts` `4944EE5CBBC2`、`agent.ts` `9C985DD5CE36`、`system-prompt/src/index.ts` `9E3144254410`、`tools/src/index.ts` `9107A2B6447B`、`plugins/dsh-link-collab/src/index.ts` `53B0914BB6F3`、`kernel.lock.json` `A9B023E08172`、`scripts/verify-notes.mjs` `2419D9978842` / 56971 B（22:38:11 已随 `4e47447` 落进 HEAD、`git status` 对它是空的；22:11 它还是 632 行 → 22:18 `A82665F6156B` / 52452 B → 22:19:59 `2419D9978842` / 56971 B；本页对它的两条引用因此改成自愈锚）、`scripts/verify-all.mjs` `08CB5B2419E5` / 77682 B / 466 行（**每登记一道门就整体位移**：22:34 实测 `doc-citations` 的注册行从 `:159-160` 移到 `:161-162`，见 §九、§五）。
- **这一刻之后再有人改这两个 notes 包产物，门会点名（这正是设计）**：`src/index.ts` 的判据是 §九 那 14 条 `notes-*` 自愈锚 —— 锚里的文本被删掉、被改写、或变成两处，核对器就红并**点名那条 id**；`lib/index.js` 是 `src/index.ts` 的派生（`plugins/dsh-link-notes/package.json` 的 `main` / `exports` 都指它），由门 `build`（`scripts/verify-all.mjs#name: 'build', kind: 'offline'` ⇒ `node plugins/build.mjs --check`，该脚本第 6 行原文 `fail if lib/ differs from a fresh build`）点名。
- **同一句话要说清它判不了什么（第三态）**：自愈锚**不判行号位移**（文本没动、行号移了，本页照样绿），**也不判 `src` 的行为对不对**（那是门 118 / 119 的读数）；门 `build` 只判 `lib/` 与新鲜构建是否一致，**不判**行为是否正确。

---

## 一、阈值三层的词表：哪一层拒什么、用什么码

阈值默认 **`maxNotes = 200` / `maxChars = 100`**，`NotesConfig` 增两个**可选**正整数字段，**行配置可覆盖**（冻结：`docs/handoff/R186-contract.md:339`）。∎ 冻结的拒绝码**只有三个**（`docs/handoff/R186-contract.md:337`）：

| 码 | 含义 | 谁用它 |
|---|---|---|
| `NOTES_INPUT` | 形状/参数不合法 | 工具体边界（(a)） |
| `NOTES_TOO_LONG` | 单条超 `maxChars` | (a) 与 `appendNote`（(b)） |
| `NOTES_FULL` | 活便条已达 `maxNotes` | (a) 与 (b) |

**三层各自做什么**（冻结：`docs/handoff/R186-contract.md:344-349`）：

| 层 | 落点 | 超限时 | 码 |
|---|---|---|---|
| **(a) 工具体边界** | `notes_add` 的执行路径（P1 写范围 `plugins/dsh-link-notes/**`） | **工具错误**返回：模型能读到、**能改写**（`docs/handoff/R186-contract.md:345`） | 三个码 |
| **(b) `appendNote`** | `appendNote`（§九 的自愈锚那一族） | **同一码具名抛**（`docs/handoff/R186-contract.md:346`）。**静默截断与静默丢弃都不许**——账本是 append-only，写进去就永久存在 | 三个码 |
| **(c) 渲染路径** | `renderNotesSection(state, limits)`（从 `plugins/dsh-link-notes/src/index.ts` 具名导出） | **永不抛、确定性收敛**（`docs/handoff/R186-contract.md:347`）：只取**最新** `maxNotes` 条活便条；被省略的部分渲染成一行 `… (+K older note(s) elided)`（**非静默**，那行计数是**必需**的不是装饰）；单条超长按**码点**截到恰好 `maxChars`、末位是 `…`；同一批事实**任意到达顺序**渲染**逐字节相同** | **不拒**（渲染不产生码） |

**为什么必须三层都有**（不是「保险起见」）：只拒写 ⇒ 历史超限数据（账本是 append-only，旧版本写进去的 101 字条目永远在）仍会让渲染行为不确定；只截断 ⇒ 用户数据**静默**丢失，本项目一贯不接受「静默」。留**最新**而不是留最旧的理由：账本序是时间序，最近写的才是当前上下文相关的（`docs/handoff/R186-contract.md:348`）。

**现状读数（两次，差 7 分钟——这个文件在飞）**：

- **22:11 读数**：`appendNote` **没有任何阈值**（只校验 `text` 是字符串、`author` 非空，再 `store.log.append`），`Config` **只有 `dir`**；`maxNotes`、`maxChars`、`NOTES_INPUT`、`NOTES_TOO_LONG`、`NOTES_FULL` 在该文件**全部 0 命中**。⇒ 那一刻三层都还不存在。
- **22:18 读数**（P1 已落盘，724 行 / 37131 B）：三个码**出现了**（`NOTES_INPUT` `:52`、`NOTES_TOO_LONG` `:54`、`NOTES_FULL` `:56`），`renderNotesSection(state, limits)` 已**具名导出**（`:339`），两个工具名已存在（`LIST_TOOL = 'notes_list'` `:76`、`ADD_TOOL = 'notes_add'` `:79`），section 名 `SECTION_NAME = 'notes:ledger'`（`:66`）、`interpolate: false`（`:713`）、审批线 `tools/pre-execute`（`:627`）与 `kind: 'ask'`（`:629`）都在；`Config` 仍是 `dir: z.string().default('')`（`:645`，可选字段是否已加**我没核**）。
- **22:34 校对者读数**（P1 已收工）：P3 留的那个「我没核」有答案了 —— `Config` 的两个可选字段**已加**：`maxNotes: z.number().default(DEFAULT_MAX_NOTES),`（`:649`）与 `maxChars: z.number().default(DEFAULT_MAX_CHARS),`（`:650`）；三个码现在在 `:55`/`:57`/`:59`、两个工具名在 `:79`/`:82`、`prompt.section({` 在 `:713`、`text: () => renderNotesSection(notesOf(store), limits),` 在 `:717`、`const dispose = registry.register(definition)` 在 `:621`。**行号只作阅读辅助，判据是 §九 的自愈锚。**
- ⚠ **这只证明「冻结的名字在文件里」，不证明实现是对的**：三层阈值是否真的都判了、审批是否真的每次都问、账本字节在 deny 时是否真的不变——那三条是**门 118 / 119 的读数**。**22:34 复核**：门 118 `notes-ledger` 的**文件已落地**（`scripts/verify-notes-ledger.mjs`，54409 B / sha256(12) `86D49BBCDBD2`）**且已登记**（`scripts/verify-all.mjs#name: 'notes-ledger', kind: 'offline'`，解析到第 147 行）；门 119 `notes-inject` **文件不存在**（`scripts/verify-notes-inject.mjs` ENOENT）、**注册表 0 命中**（§三 末条）。⇒ 本页对**这个文件**的引用一律用自愈形式 `path#text`（理由见 §九），行号只作阅读辅助。

**R48 兼容（成对读数的由来）**：R48 的数据面门里有一本**混合账本**，含不可用形状（`payload.text = 42`、无 id、别的 kind 的行）⇒ 渲染**必须对垃圾行保持全域**（跳过或按现有折叠规则处理），**不许抛**（`docs/handoff/R186-contract.md:349`）。今天 `projectNotes` 已经把「自己的字段读不出来」的行计入 `malformed` 并跳过，注释写明理由：`never throws: one bad line must not cost the reader every note in the ledger`（自愈锚 `plugins/dsh-link-notes/src/index.ts#never throws: one bad line must not cost the reader every note in the ledger`，计数 `malformed += 1` 紧随其后）；R48 那本混合账本里的垃圾形状本身也是**读数**（自愈锚 `scripts/verify-notes.mjs#text: 42`，§九 有行）；⚠ **那个门文件也在动**：22:11 读它 632 行 → 22:18 744 行 / 52452 B / `A82665F6156B` → 22:19:59 805 行 / 56971 B / `2419D9978842`。⇒ 行号在这里没有意义，改用它**那两条自愈锚**（`#text: 42`、`#await a.append(store, { text: "会话一：升级不许丢"…`）；22:20 的绿就是这两条锚当时的读数。

**审批与内核侧的拒绝：一律透传内核原文，不新造同义词**（冻结：`docs/handoff/R186-contract.md:337` 末句与 `:353`）。内核给的是**五条**具名 deny reason，一条 grant：

| 情形 | 内核原文（逐字） | 落点 |
|---|---|---|
| `allowed-once` | 放行（唯一的 grant） | `packages/core/tools/src/index.ts:1753` |
| `rejected` | `the user rejected tool "…"` | `:1755` |
| `cancelled` | `approval for tool "…" was cancelled`（且 `approvalCancelled: true`） | `:1759`（`:1760`） |
| `unavailable` | `tool "…" requires approval, but no approval channel is available` | `:1763` |
| 无 `approval` 服务（**问之前就拒**） | `tool "…" requires approval (not yet supported)`——除非调用方给了 `ask.reason` | `:1732`（分支）、`:1734`（那行） |
| 无 agent（**问之前就拒**） | `tool "…" requires approval, but the call has no agent to route it through` | `:1738`（分支）、`:1740`（那行） |
| 兜底 | `default: return assertNever(outcome, 'ApprovalOutcome')` | `:1766` |

四条 `ApprovalOutcome` 的定义在 `packages/interaction/user-approval/src/types.ts:32`：`allowed-once` / `rejected` / `cancelled` / `unavailable`。⇒ 说「四条具名 outcome」时指的是**这四条**；说「几条具名 deny」时是**五条**（三条 outcome 的非 grant 项 + 两条问之前的拒）。**这两个数字不是一回事，别混。** 数据面其它错误同样透传，例：改一个不存在的便条时 `setNoteState: no note "x" in this store`（自愈锚 `plugins/dsh-link-notes/src/index.ts#setNoteState: no note`）。

---

## 二、`effective` 语义：每步求值、逐字节来自折叠、`interpolate: false`

**段文本是一个 provider，每次组装求值。** `PromptSection.text` 的类型允许函数（`packages/core/system-prompt/src/index.ts:66`），`agent.ts` 在 `preStep` 里**每步**都调 `systemPrompt.assemble(...)`（`packages/core/agent-loop/src/agent.ts:272`）。⇒ 便条不是「启动时读一次的快照」，是**每步现算**的。

**逐字节来自折叠：没有第二份存储。** provider 的实现是 `projectNotes(store.log.replay())`（自愈锚 `plugins/dsh-link-notes/src/index.ts#return projectNotes(store.log.replay())`，`projectNotes` 本身在 `#export function projectNotes(` 具名导出）。账本文件是**唯一真源**；段里出现的每个字节都是现场折叠出来的，**不存在**「另存一份渲染结果」这条路。验收侧的同一条口径写在 `docs/handoff/R186-contract.md:154`（§3.3 落法）：**不另存一份便条文本**。

**空段被丢。** `renderPrompt` 在 `packages/core/system-prompt/src/index.ts:282` 做 `.filter(text => text.length > 0)` ⇒ **零便条 ⇒ 段为空 ⇒ 不产生任何 `system/message` 提交**。这条不是装饰：它是「未变不 churn」的基础（§四）。

**`interpolate: false` 是硬要求**（冻结：`docs/handoff/R186-contract.md:341`、`:342`）。机制在渲染器：`renderPrompt` 在 `packages/core/system-prompt/src/index.ts:281` 写的是 `section.interpolate === false ? section.text : interpolate(...)` ⇒ **只有显式 `false` 才原样取**。字段本体在 `:68`（`readonly interpolate?: boolean`；接口 `PromptSection` 从 `:53` 起），JSDoc 在 `:67`。

**为什么必须是 `false`**：便条是**用户文本不是模板**（`docs/handoff/R186-contract.md:342` 原文）。用户写一句 `{{sandbox_policy}}` 是在描述一个东西，**不该被内核当成变量吃掉**。⇒ 门 118 要有一条读数钉它：含 `{{…}}` 的便条渲染后**逐字节等于原文本**。

**section 名与顺序**：`notes:ledger`，`order: 700`（冻结：`docs/handoff/R186-contract.md:341`）。700 的位置理由：内核 `SECTION_ORDERS` 表在 `packages/core/system-prompt/src/index.ts:125-159`，其中 `TEAM_POLICY: 600`（`:129`）与 `PTC_ONLY: 800`（`:130`）之间是空档；便条是**部署面指令**，要排在工具说明段之前被读到、在 persona 之后。内核 `SECTION_ORDERS` **没有 NOTES 槽**，所以这个值只能由插件自取，而 `section()` 只要求它是**有限数**（`packages/core/system-prompt/src/index.ts:455` 就是那条抛：`if (!Number.isFinite(section.order))`）。

---

## 三、两个工具与审批：`notes_list` / `notes_add`

- **工具名只有这两个**（冻结：`docs/handoff/R186-contract.md:336`）。
- **注册层 = 祖先层**（冻结：`docs/handoff/R186-contract.md:340`）。写法照 `plugins/dsh-link-collab/src/index.ts:9120-9132` 的 `installDeclaringTools`：`inject.call(ctx, ['tools'], (scoped) => { ... scoped.get?.('tools') ... })` 再 `register(definition)`（`plugins/dsh-link-collab/src/index.ts:9127`）。`apply(ctx)` 是 host-plane 行 ⇒ 落在 host 层。**不许**注册到 `agent.ctx`（理由见 §五）。
- **每次 `notes_add` 都问**（冻结：`docs/handoff/R186-contract.md:351`）。通道是 `tools/pre-execute` 的 `{ kind: 'ask' }`（`packages/core/tools/src/index.ts:611`，`PreToolDecision` 联合从 `:607` 起）。**本轮不做**「同会话同内容不再问」——那是第二条语义（`:355`）。
- **`notes_list` 不问**：读不写（`:356`）。
- **fail-closed 是内核行为，不是我们要写的东西**（`docs/handoff/R186-contract.md:352`），实现在 `serviceAsk`（`packages/core/tools/src/index.ts:1727-1768`）。逐条原文见 §一那张表。**批准 ⇒ 恰好一条 `note/state` 事实**（不是零条，不是两条；`:354`）；无通道 ⇒ deny **且账本字节不变**（`:353`）。

**「恰好一条」在数据面是什么意思**：一条便条事实由 `noteRecord`（自愈锚 `plugins/dsh-link-notes/src/index.ts#export function noteRecord(`）造出，kind 固定为 `note/state`（`#export const NOTE_KIND = 'note/state'`），字段在 `#kind: NOTE_KIND, subject: id, payload: { id, text, tags:`。⇒ 「恰好一条」＝**恰好一次 `log.append`**，不是「恰好一条记录里的一个字段」。构造期校验是紧随其后的四条 `throw new TypeError('noteRecord: …')`，任何一条不合法**抛 TypeError**（不是返回错误码）——这是数据面，不是工具体。

**边界（我**没能**验证的）**：本节所有关于审批**运行时行为**的断言都是**冻结文字**，不是**产出物读数**。**22:34 校对者复核（本条已更新）**：门 118 `notes-ledger` **文件已落地且已登记**（`scripts/verify-notes-ledger.mjs` 54409 B / `86D49BBCDBD2`；`scripts/verify-all.mjs#name: 'notes-ledger', kind: 'offline'`），门 119 `notes-inject` **文件不存在、注册表 0 命中**（由 Lead 按 §9 R11.1 稍后落地并登记）。⇒ 本节的**三条运行时断言**（每次问、批准恰好一条、无通道账本不变）**门 118 不替它们背书**：门 118 的登记项自己写的读数是「三层阈值 / 折叠 / 渲染」（见 `scripts/verify-all.mjs` 里 `notes-ledger` 那条 `what:`），审批与组属于门 119。⇒ 这三条**等门 119 落地并被跑过**才算被验过，在那之前只是契约。

---

## 四、代价口径：**一次便条变化 = 一次 head 重写**（不许写成零代价，不许写成每步一次）

### 41 机制（本机路由上）

投影函数是 `SystemPromptProjection.project`（`packages/core/agent-loop/src/runtime-context.ts:88`）。本机路由 `dsh-opencode-go` 上 `systemPromptUpdate` **0 命中** ⇒ `input.inHistory` 恒 false（`agent.ts` 读的是 `preparedCall?.systemPromptUpdate === 'in-history'`，`packages/core/agent-loop/src/agent.ts:411`）⇒ 命中 `runtime-context.ts:95` 的第一分支：

```
if (!input.inHistory || input.startsSeries || rendered.length === 0) {   // :95
  const updates = nodes.slice(1).filter(node => node.text !== '').map(...)  // :96-97
  if (head.text !== rendered) updates.push(this.replace(head.seq, rendered)) // :98
  return updates
}
```

⇒ **`:98` 是那条闸**：**文本没变就不替换 head**。所以：

- **不是零代价**：文本一变就替换 head 节点，**前缀缓存失效**。
- **不是每步一次**：代价与**便条内容变化次数**成正比，**与步数无关**。便条不变、且段仍为空（`:282` 把空段滤掉）⇒ 那条 `if` 不成立 ⇒ **不提交任何 `system/message`**。
- **一条精确的边界（写清楚，别读成比实际更强）**：`:95` 分支里 `:96-97` 会**先**把除 head 之外**非空**的 system 节点逐个清空（每个都产出一条 `replace`）。所以「未变 ⇒ 恰好 0 条提交」成立的**前提**是**没有别的非空 system 节点**；有的话，它们照样会因为被清空而提交。门 119 的「未变 0 提交」读数要在这个前提下读。
- 另一条分支（`:101` 的 in-history 追加）在本机路由上**走不到**：`if (latest.text === rendered) return []`（`:101`），否则追加一条（`:102`）。

### 42 `startsSeries` **陷阱**（R185 踩过，必须继承）

**代价三数字**（照 R185 的纪律：`docs/handoff/R186-contract.md:166`）：本次提交的 section **字符数**、被重写的 **head 节点长度**、以及那一步 `request/header` 的 `startsSeries`。

⚠ **第三个数字读的是「会话里当下那一条 header 的值」，不是「下一步会不会开新序列」的预测**（`docs/handoff/R186-contract.md:167`）。两条原始读数：

- **G5**（`docs/handoff/R185-A-groups.md:97`）：`the trio reads the session header it actually has: before=undefined reading="startsSeries=true"`
- **G6**（`docs/handoff/R185-A-groups.md:98`）：`a header that does not start a series is reported false, so the reading can differ: "startsSeries=false"`

⇒ 两个后果，都要写进验收：(1) 同一个动作在**不同的 header 状态下**可以读出**不同的 `startsSeries`**（G6），所以它不是那个动作的固有属性；(2) **会话还没有任何 `request/header` 时这个数字拿不到**——前两次滑动就是这样（`docs/handoff/R185-A-groups.md:122`，原文 `before=undefined`）。**R186 的验收不许把 `startsSeries` 写成下一步的代价。**

### 43 预算上限（**读来的**，R186 必须自己复测）

200 条 ×107–109 字符的便条 ⇒ 渲染成 200 行提示词 ≈ **22,781 字符**（`docs/handoff/R186-contract.md:169`，标注为 R178-M 的读数）。≈5.7k token @4 字符/token，中文成本更高。**这就是这个 section 的预算上限**，验收时要报实测值。⚠ 本条我**没有**独立复测（不在我的写范围，且需要真数据面跑批）：**它是引用，不是我的实测读数**。

---

## 五、依赖耦合：成员名散落在两个包之间 + 「只能移动祖先层的工具」

### 51 一条名字住在两个包里（改一边必须改另一边）

`notes` 组的两个成员名**同时**出现在两处：

| 侧 | 位置 | 内容 |
|---|---|---|
| **声明侧** | `plugins/dsh-link-groups/cordis.patch.yml` 的组表：**22:11 已落盘**的 `notes` 组在 **`:55-64`**（§53 有读数列），**形状先例**是同一文件里 `teams` 组的 `tools:` 列表 `:36-44` | `- notes_list` / `- notes_add` |
| **注册侧** | `plugins/dsh-link-notes/**`（P1 的写范围） | 那两个工具的 `register(...)` 调用 |

两处的**拼写**钉在冻结文字里：工具名在 `docs/handoff/R186-contract.md:336`（**只有这两个**），组的形状在 `:360-371`（成员名 `:365`/`:366`、`provider: notes_` `:367`）。**为什么这里同时钉冻结文字与那个 yml 的行号，见 §53**（那个文件的行号会动，冻结文字不会）。

**这条耦合不是我们选的，是机制逼出来的**：`resolveGroup` 明文拒空 `tools`，理由写在同一条错误里——`the membership is written down because no package manifest carries a tool list`（`plugins/dsh-link-groups/src/index.ts:151-152`）。⇒ 组表**不可能**从注册侧自动推导出来；**没有包清单携带工具列表**。冻结侧的同一件事写在 `docs/handoff/R186-contract.md:373`（不加「组贡献接口」，代价如实写在契约页）。

`provider: notes_`（冻结形状 `docs/handoff/R186-contract.md:367`）是**交叉校验、不是权威**：只有当**没有一个**成员以它开头时插件才**warn**（`plugins/dsh-link-groups/src/index.ts:837-840`，`:840` 原文 `is a cross-check only and \`tools\` stays authoritative`）。⇒ **写错 `provider` 只警告，写错成员名才拒组。** 冻结侧：`docs/handoff/R186-contract.md:367`。

### 52 一个组**只能移动注册在祖先层的工具**（硬规则）

- **机制**（组表自己的头注释）：`a restriction filters what a scope inherits and never what its own layer registers`（`plugins/dsh-link-groups/cordis.patch.yml:6`）；成员注册进 agent 自己那层 ⇒ 报 `broken`，**不半开**——`silently half-masked`（`:8`）。
- **活体证据**（我读的记档，不是我的实测）：`team_task_create/get/list/update` 四个名字**确在**那一步的工具面里，但注册在 **agent 自己那层** ⇒ 插件报 `blocked: GROUPS_NO_TOOLS` 并**拒整组**（`docs/handoff/R185-F-live-declare.md:213`）。
- **⇒ 冻结**：两个工具**必须**注册在**祖先层**（`docs/handoff/R186-contract.md:340`）。**门 119 的读数 ④ 就是钉这条的读数。**

### 53 现状（**22:34 校对者复核**）：**两侧都已落盘**

| 侧 | 22:11 的读数 | 证据 |
|---|---|---|
| **声明侧** | **已落盘**：`plugins/dsh-link-groups/cordis.patch.yml` **3548 B / 67 行 / sha256(12) `B4194F2D8B9B`**，`notes` 组在 **`:55-64`**（`:55` `- id: notes`、`:59`/`:60` 两个成员名、`:61` `provider: notes_`、`:62` `state: auto`、`:63-64` `auto.when: declare`）；`git diff --stat` 对该文件是 **+10 行** | §九 的四条 `cordis-patch-notes-*` 行 |
| **注册侧** | **已落盘（22:34 复核）**：`plugins/dsh-link-notes/src/index.ts` **37255 B / 727 行 / sha256(12) `2C58232FE382`**、派生的 `plugins/dsh-link-notes/lib/index.js` **15477 B / 325 行 / `79AD1A4CCE9A`**，两个工具名 `:79`/`:82`、三个码 `:55`/`:57`/`:59`、`renderNotesSection` 导出 `:342`、section 名 `:69`、`prompt.section({` `:713`、`text: () => renderNotesSection(notesOf(store), limits),` `:717`、`const dispose = registry.register(definition)` `:621`、审批线 `tools/pre-execute` `:630` 与 `kind: 'ask'` `:632` 都在（**行号只作阅读辅助，判据是 §九 的自愈锚与门 `build`**）；**22:11 时它还什么都没有**（356 行、这些名字 0 命中，只有文件头注释 +5 行）⇒ **半小时内变了三次** | §九 的 14 条 `notes-*` 自愈锚 + 门 `build` |

⇒ **两侧齐了**：声明侧 22:11 落盘、注册侧 22:34 复核仍在，两边的名字（`notes_list` / `notes_add`）现在是同一批字节。**门 118 已落地并登记**（`scripts/verify-notes-ledger.mjs` + `scripts/verify-all.mjs#name: 'notes-ledger', kind: 'offline'`，注册表 **118 条**），**门 119 仍没有文件、也没登记**（`notes-inject` 0 命中）⇒ 「两侧齐了」（组表声明了这两个名字 + 包注册了这两个工具）这件事**今天仍没有任何门在判**（门 118 判的是三层阈值 / 折叠 / 渲染）；在那之前，组相关的活体读数仍是 `blocked: GROUPS_NO_TOOLS`（活体窗口本轮没碰）。

**这个文件的行号会动——两条可复核的读数**：

1. **今天落盘的字节与写就时记过的中间态逐字节相同**：写就时那张 mtime 表里 `22:03:08` 那一版就是 **3548 B / `B4194F2D8B9B`**（`notes` 组在组序列里、`catalogPreamble`/`deferredNotice` 退回到组**之后**）⇒ 今天落盘的是**重排版**，不是最初那个错缩进版（`21:58:30`，3548 B、无 hash 记录）。同一个 sha256 前缀两次独立读到，这条是**交叉读数**。
2. **写就时它被改过三次**（mtime `21:58:30` → `22:03:08` → `22:04:42`），最后一版把 `notes` 组**整个撤掉**、与 HEAD 逐字节相同 ⇒ §51 把**成员名**同时钉在**冻结文字**（`docs/handoff/R186-contract.md:365`/`:366`）**和**今天落盘的行号上（§九 的 `cordis-patch-notes-*`）：任一漂了，门都会点名。

**一条标「推断」的观察（不是实测，但值得留着）**：写就时 `21:58:30` 那一版里，序列项 `- id: notes` 出现在 `catalogPreamble:` 这种**同级映射键**之后，按 YAML 的规矩**序列在那里已经闭合**，再出现同级序列项**应当是语法错**。我**没有**为那一版跑过解析器（它已经不是当前字节，事后跑不了）⇒ 这是**推断**，不是读数。写在这里只为说明一件事：**这一族改动有一个「看起来对、其实不合法」的失败模式**。今天这一版是合法形状（`notes` 项在 `groups` 序列内，`catalogPreamble` 在它之后退回到 `config` 层）。

**一条「在飞」的中间态（22:11 读到，22:18 已自愈）**：22:11 那次读数里 P1 删掉了 `import z from '@deepseek-ai/schemastery'` 而 `Config` 仍在用 `z` ⇒ 那一刻是**悬空标识符**（`node plugins/build.mjs --check` 会红）。**22:18 复读：`schemastery` 又出现 1 次、`z` 有定义**，这条已经不存在了。**我把 22:11 那一刻的红**（不是 P1 判定）**留在这里**，因为它是本页唯一一次「读数在几分钟内被推翻」的实证。

## 六、哪些话作废（免得照着过期口径干活）

### 61 `R186-contract.md` §1.5 点名的**两处过期 `STATUS` 口径**

| # | 过期的话（出处） | 现状 | 更正落在哪 |
|---|---|---|---|
| 1 | `STATUS.md:110` 第 6 条：「图标来源（官方设计系统 / FluentUI / COLR 字体）**未摸清**」 | **已摸清**（本页 §七 给出该结论的三条证据）。⚠ **22:11 复读：这一格原文仍是「未摸清」，且 `git status --porcelain` 里 `docs/handoff/STATUS.md` 没有任何改动**（工作区与 HEAD 一致）⇒ 这份文件**还没被改**，别以为它已经更新 | `docs/handoff/R186-contract.md:74` |
| 2 | `STATUS.md:518` 的涉便条欠账：「便条（第 13 条）**先要载体**」 | **已还**：载体行在 `plugins/dsh-link-notes/cordis.patch.yml:12`，`dsh.bundle.patch` 在 `plugins/dsh-link-notes/package.json:22`。⚠ 同 #1：22:11 复读，`STATUS.md:518` **原文仍是这条欠账**（该文件仍未被改） | `docs/handoff/R186-contract.md:75` |

**一处编号更正（我核了原文）**：`docs/handoff/R186-contract.md:75` 把那两条记成「`STATUS.md:518` 的『仍欠』**①②**」，但 `docs/handoff/STATUS.md:518` 的实际编号里，**①** 是「`health-markers` 要读到 `mounted` 需有人把 `link-groups` 行加进某个 bundle 的 patch」，**②** 是「真客户端里从没开过一次组」，而**便条那条是 ③**。⇒ **内容对得上，编号差一位**；引用时请写「① 与 ③」，别写「①②」。

### 62 §1 的**四条更正**（A/B/C/D）

| # | 更正 | 现状 | 出处 |
|---|---|---|---|
| A | 「Auto review 没图标」**在包层面是错的**：包自带 36×36 全彩品牌件；真正缺的是权限 glyph 这一族（16×16 `currentColor`），`permissionGlyphs` **只有 3 项**且 `'auto'` 拿不到 | 成立（证据见 §七） | `docs/handoff/R186-contract.md:38` |
| B | 「Auto review 真漏译」比 R178-K 记的**窄**：是 **2 个键**（`auto.label` / `auto.badge`），不是「整个功能没汉化」；且「是不是漏译」在**字节上不可区分**，代码里**判不了** | 成立 | `docs/handoff/R186-contract.md:44` |
| C | 图标来源已摸清，且与 md:295 的三条猜测**只对一条**（第一方设计系统对；FluentUI 依赖**不存在**；COLR/CFF 图标字体**不存在**） | 成立 | `docs/handoff/R186-contract.md:51` |
| D | 第 13 条的载体不是「缺」，是「**刚补上且明确空着**」：包自己写明不注册 section / 工具 / 阈值 | 成立**过一次，生命周期已经结束**：写就时那句注释就是「no prompt section, no tool, no threshold」，**22:18 复读它已被删掉**（该串 0 命中）——因为 P1 把 section / 工具 / 阈值真的落进了这个文件（§53、§一 的 22:18 读数）。**22:34 复核：新事实已钉进 §九 的 5 条自愈锚**——`notes-apply-registers-section`（`prompt.section({`）、`notes-section-text-is-the-fold`（`text: () => renderNotesSection(notesOf(store), limits),`）、`notes-tools-registered`（`const dispose = registry.register(definition)`）、`notes-config-limits`（`maxNotes: z.number().default(DEFAULT_MAX_NOTES),`）、`notes-row-comment-registers`（`plugins/dsh-link-notes/cordis.patch.yml` 注释里新写的「registers the `notes:ledger` prompt section and the two `notes` group tools」）⇒ 那句过期注释**不许再被当成现状** | `docs/handoff/R186-contract.md:64` |

### 63 §9 追加的一条**当场作废**（顺带，不属 §1/§1.5）

`docs/handoff/R186-contract.md:12`（§1 引言）写的「门注册表 **实测 116 条**（live 18 / offline 98）……门 117 `tool-groups-live` 是『在飞』」，已被 §9 R1 **当场作废**：`docs/handoff/R186-contract.md:328` 实测 **117** 条，门 117 已落地、已跑绿、已登记。**我自己复数的读数**：用注册表原文里的 `{ name: '…', kind: '…'` 数，得 **117** 条（命令与读数见交付报告）。⇒ R186 的两个门从 **118** 起（`docs/handoff/R186-contract.md:329`），**120 `notes-live` 本轮不写**（`:330`）。⚠ **22:34 校对者复核（本条已更新）**：同一个数法今天读出 **118 条**（live 19 / offline 99）——**`notes-ledger`（门 118）已登记**（解析到第 147 行，文件 `scripts/verify-notes-ledger.mjs` 54409 B / `86D49BBCDBD2`），**`notes-inject` 仍没登记、文件也不存在**（`scripts/verify-notes-inject.mjs` ENOENT）⇒ 118 已落地，119 待 Lead。

---

## 七、第 6 条（汉化 / 图标）：本轮**只登记，不实现**

**政策前提原样留着等裁决**：`LINK 要不要、用什么方式改一份 pin 住的上游客户端文案/图标？`（`docs/handoff/R186-contract.md:382`）。§3.2 的三条证据说明它是**一条政策，不是一轮生产**；**本轮内核一个字节都不许动**（`:383`）。

### 71 三条硬事实（每条都有我读到的证据）

| # | 事实 | 我读到的落点 |
|---|---|---|
| 1 | **改内核 ⇒ 门 `baseline` 直接拒** | `kernel.lock.json:2`：`The vendored kernel is a pinned upstream checkout and is never edited.`（pin 的 commit 在 `:6`：`5badb15`）。而 `auto.label` 的字典与 `permissionGlyphs` 表都在 `core/deepseek-harness/packages/client/**` |
| 2 | **权限 glyph 只有 3 项，且模块内私有** | `packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:28` 起的 `const permissionGlyphs = new Map(...)`，三个键是 `read-only` / `workspace-write` / `danger-full-access`（`:29-31`）。**没有任何注入缝** |
| 3 | **`'auto'` 拿不到 glyph——由那条注释自己承认** | 机器值 `AUTO_REVIEW_PRESET = 'auto'`（`packages/client/ui-permission-presets/src/client/presentation.ts:7`，别名导入见 `PermissionSelect.tsx:19`）；而 `permissionGlyph()` 的注释是 `names outside the design set get none`（`PermissionSelect.tsx:34`） |

### 72 「19 个 `zh == en` 候选」的**枚举读数**（**读来的**，不是我的实测）

- 方法：遍历 `core/deepseek-harness/packages/**` 的 `.ts/.tsx`，抽出成对出现的 locale 字典对象，逐键比较。读数：命中 **27 个文件**、共比较 **1047 个 zh 键**、其中 **19 个键的 zh 值与 en 值逐字节相同**、zh/en 键集不对称 **0**（`docs/handoff/R186-contract.md:117`、`:118`、`:119`）。
- **我自己独立核了其中一条**（md 点名的那一条）：`ui-permission-presets` 的 zh 字典 `'auto.label': 'Auto review'`（`packages/client/ui-permission-presets/src/client/locales.ts:53`）与 en 字典的同一键（`:77`）**逐字节相同**；`auto.badge` 的 zh `:54` / en `:78` 也相同（都是 `EXP`）。⇒ 这一条**成立**，但**「有意保留英文产品名」不可排除**（`:53` 与 `:77` 就是同一串字节，代码里判不了）。
- **这条方法的边界（记档自己写了）**：它只能发现「值相同」，**判不出「翻了但翻错」**；`LocalizedText` 那条路径没覆盖。⇒ 口径是「**可机械发现的候选**」，**不是「已确认的漏译」**。

### 73 登记清单（收口时进 `STATUS.md` 欠账，不是本轮做）

① §2.3 的 **6 条**「看着像真漏」候选 + md 点名的 `Auto review` / `EXP`；② §1.1 的权限 glyph 缺口（`permissionGlyphs` 只有 3 项、模块内私有、`'auto'` 拿不到 glyph）——两件都写在 `docs/handoff/R186-contract.md:381`。**本轮不做任何实现**，也不拿 `experimental/auto-review/icon.svg`（36×36、带渐变、固定色）往 16×16 `currentColor` 的那个槽里塞。

---

## 八、§9 的其余裁决：收口纪律（本页没别的地方写）

§9 里还有四条裁决**不是接口**，但每个碰这个功能的人都得知道；**照抄冻结文字，不转述**：

| 裁决 | 冻结文字（原文要点） | 为什么写在这里 |
|---|---|---|
| **R8** 被钉住的工具面 | 「两个新工具名会进**模型可见工具面**，任何按名字或条数钉工具面的门都可能红……P1/P2 **不许碰任何门文件**：红了就**报出**「哪一道门、读到什么、期望该加宽成什么」，由 Lead 在同一轮里裁决加宽并写进记档」 | 两个工具落地后**别人的门可能红**，红的方式是「模型面上多两个名字」；先例是**记档点名 + 精确加宽**（`plugins/dsh-link-collab/src/index.ts:9148-9155`）——`notes-ledger` / `notes-inject` 自己**不许**去改那道门 |
| **R9** 派生读数 | 「**P4 从生产任务表里划掉，归 Lead**」；顺序：`read-composition-rows --all` → `compose-profile-rows` → `port-verdicts` → `check-plugin-contract --all --out compat/adaptation/plugin-contract.json` → `probe-live-composition` → `build-pack` | `compat/**` 与 `pack/**` 是**派生重投影**，两个写者同文件必然互相盖；P1 加工具名大概率动 `plugin-contract.json` 的工具面读数 |
| **R10** 写范围 | 每个成员**只写自己的前缀**（P1 `plugins/dsh-link-notes/**`；P2 只 `plugins/dsh-link-groups/cordis.patch.yml`；P3 只本页；门 118/119 各自一个新文件；Lead 拿 `scripts/verify-all.mjs`、`docs/handoff/R186-*.md`、`PLAN.md`、`STATUS.md`、`compat/**`、`pack/**`、git） | 这张表是本页之外的**唯一**写范围权威；另外两条同一节：**一律不许**动 `core/deepseek-harness/**`（pin）/ `src-tauri/**` / 活档案 / 活体端口 31761·31760·9222 / git 写操作 / 别人的门；**一律不许**跑整套 `verify-all.mjs`（它没有 `--list`，跑一次就是全部 117 道；R185 踩过一次） |
| **R11.3** 收口口径 | 记档必须把**「一次便条变化 ⇒ 一次 head 重写」**与**代价三数字**原样写进去；「**不许出现「零代价」，也不许写成「每步一次」**」 | 与本页 §四 同一条禁令：收口时**照抄本页 §四**，别改写成别的说法（`R11.6` 另有一条：**git 提交只有 Lead 做**） |

**本页自身在 22:11 未纳入版本控制**：`git ls-files -- docs/dev` **空**、`git status` 报 `?? dsh-link/docs/dev/` ⇒ 本页由 Lead 在收口时提交。这不是缺陷（`docs/dev/` 整个目录都是新的），但它意味着**这张表只在工作区里存在**，`git show HEAD:docs/dev/notes-ledger.md` 读不到东西。

## 九、这份页面的引文（**机器核对**，别只信人眼）

下面这张表是本页的**判据表**：把页里每条规则钉到**已出货源码**的 `path:line` 或 `path#text` 与**该处必须含有的文本**上。核对器是 `scripts/check-protocol-page.mjs`：

```
node scripts/check-protocol-page.mjs --page docs/dev/notes-ledger.md
```

（**22:34 读数：144 条逐条成立、`exit 0`**）。同一张表被**两个实现**各算了一遍——出厂的核对器，和我在 `.tmp/r186-p3b/**` 里照它的规则另写的一版——两次读数**逐条一致**（22:34 两次都是 `exit 0`）。**中间态如实记一笔（这两条红不是人为突变）**：Lead 为登记门 118 往 `scripts/verify-all.mjs` 插了 4 行，把 `doc-citations` 的注册行从 `:159-160` 推到 `:161-162`，本页那两条**行号形**引文因此红了 2 条——两个实现都读出 **134 of 136 / `exit 1`**，原文 `line 159 does not contain ["doc-citations"]` 与 `line 160 does not contain ["three tables (the device-net page, PLAN, STATUS)"]`；22:34 改成自愈形后回到全绿。这不是礼貌，是这不是礼貌，是「两个说谎者意见一致」那条风险的压法：仪器的规则我从源码读了（`scripts/check-protocol-page.mjs:78-99`：`path:line` 要求该行含全部分片；`path#text` 要求该文本在全文**恰好出现一次**），然后自己实现了一遍去对。 **一条仪器的第三态（22:34 我在最终稿上实测，两个实现同结论）**：核对器的分片判定是**子串包含**——把某条分片截短成**真文本的前缀**（`verify-notes-ledger.mjs` → `verify-notes-ledger.mj`）时，那一行**照样绿**（孤立实测：整页仍 `144 of 144`、`exit 0`）；只有截到**不再是子串**（`prompt.section({` → `prompt.section{`，实测原文 `the file no longer contains "prompt.section{"`）或把行号 +1（实测原文 `line 1754 does not contain ["case 'allowed-once'"]; it holds: case 'rejected': return {`）才会红。⇒ **做反证时要把分片改到「不再是子串」，光少一个尾字符不一定够。**

**两种引用形式的分工（自愈形式只用在会反复改的东西上；22:34 校对后是三类，理由在此）**：`path:line` 钉在 **pin 住的内核**与**已冻结的记档**上——行号会漂是**设计**（源码一动就得有人来对齐，页不许悄悄过期）。`path#text` 用在会反复改的三类上：①`plugins/dsh-link-notes/**`（`src/index.ts` 写就时 350 行、22:11 已 356 行、22:18 已 **724 行**、22:34 已 **727 行 / 37255 B**——往它里面钉行号等于给下一个人留一颗定时炸弹）；②`scripts/verify-notes.mjs`（805 行 / 56971 B，P1 在写）；③**`scripts/verify-all.mjs`**——它每登记一道门就整体位移（22:34 实测：`doc-citations` 的注册行从 `:159-160` 移到 `:161-162`），所以凡引它的行**一律**自愈形、**不许**再写行号。先例就在本仓：`docs/protocol/device-net-v1.md` 整张表都是自愈形（`scripts/verify-doc-citations.mjs:147` 的注释自己写着「the protocol table is now entirely `path#text` (self-healing)」）。

**一条必须写清楚的第三态（否则这张表的绿是空洞的）：本页不在 `doc-citations` 门的默认覆盖面里。**这不是猜测，是**源码读数**：

| # | 读数 | 命令 / 落点 | 原文 |
|---|---|---|---|
| 1 | 门的文档清单是**三份硬编码文档**，**不是目录**、也不扫任何目录 | `scripts/verify-doc-citations.mjs:30` | `const DOCS = (all('--doc').length > 0 ? all('--doc') : ['docs/protocol/device-net-v1.md', 'docs/handoff/PLAN.md', 'docs/handoff/STATUS.md']).map(at)` |
| 2 | 注册项自己这么写 | `scripts/verify-all.mjs#name: 'doc-citations', kind: 'offline'`（22:34 解析到第 **161** 行，`what:` 在 `:162`） | `{ name: 'doc-citations', kind: 'offline', cmd: ['node', 'scripts/verify-doc-citations.mjs'], what: '…three tables (the device-net page, PLAN, STATUS) all resolve…' }` |
| 3 | 门现在跑绿**与本页无关** | `node scripts/verify-doc-citations.mjs` | `exit 0`；`5 of 5 readings held`；R1 逐份读数 `device-net-v1.md: exit=0 checker=127 mine=127`；`PLAN.md: 7`；`STATUS.md: 9`——**三份里没有本页** |
| 4 | 把它塞进门里会红三条，**三条都是门自己的性质**（本页自身的自检在这一步是**绿**的） | `node scripts/verify-doc-citations.mjs --doc docs/dev/notes-ledger.md --doc docs/handoff/PLAN.md --doc docs/handoff/STATUS.md` | `exit 1`；`R1=**ok**`（22:34 原文 `docs\dev\notes-ledger.md: exit=0 checker=144 mine=144`——**本页自己的 144 条全成立，且两个实现计出的条数相同**）、`R2=FAIL`（22:34 原文 `a reworded fragment -> exit 0`；P3 当时读到的是 `a reworded fragment -> THE COPY DID NOT CHANGE, so nothing was measured`，同一件事的两种报法：R2 的突变锚点 `refuse(401, 'UNAUTHORIZED')` 钉死在 device-net 页上，换一份页它**匹配不到、于是什么都没测**）、`R4=FAIL`（22:34 原文 `36 of 160 row(s) pointing outside version control`；P3 当时是 `152 row(s)`，差 8 行正是 22:34 新增的那 8 条锚：本页引的 `core/deepseek-harness/**` 被 `.gitignore:13` 忽略，`git ls-files --error-unmatch` 认不出）、`R5=FAIL`（原文 `7 not on the built module: ["NOTE_KIND","noteRecord","projectNotes","renderNotesSection","SECTION_NAME","LIST_TOOL","ADD_TOOL"]`：R5 只看 `#` 后面那串字**拼不拼成 `export function X` / `export const X`**，然后拿 X 去 **`plugins/dsh-link-collab/lib/index.js`** 里找——**它不读被引的那个文件**，所以本页引**别的包**的导出时必然误判） |

⇒ 本页的绿**只有上面那条 `--page` 命令**能给；`node scripts/verify-doc-citations.mjs` 的 `exit 0` **不构成本页的绿**（它连本页都没打开：默认三份文档里没有本页）。把本页按 `--doc` 塞进去，本页那一条 R1 读数会变 `ok`（22:34 实测 `exit=0 checker=144 mine=144`），但**整条门仍然 `exit 1`**——红的是 R2 / R4 / R5。要把本页收编进那道门，得由**门作者**做三件事：①给「pin 住的内核前缀」开一条**具名白名单**（或在表里改用 `scripts/` 侧可追踪的替身）；②让 R2 的突变锚点**按页取**（这一条门已经做对了一半：`THE COPY DID NOT CHANGE, so nothing was measured` 这句就是它自己把「什么都没测」说了出来）；③让 R5 的 seam 检查**读被引的那个文件**，而不是一律去 `plugins/dsh-link-collab/lib/index.js` 里找。三件都是**门作者的写范围，不是 P3 的**。在那之前：**别用那道门来替本页背书。**


<!-- citations -- checked by scripts/check-protocol-page.mjs --page docs/dev/notes-ledger.md; keep line numbers and fragments in sync -->
| id | where | must contain |
|---|---|---|
| contract-freeze-reject-codes | docs/handoff/R186-contract.md:337 | NOTES_INPUT ; NOTES_TOO_LONG ; NOTES_FULL |
| contract-freeze-defaults | docs/handoff/R186-contract.md:339 | maxNotes = 200 ; maxChars = 100 ; 正整数，行配置可覆盖 |
| contract-layer-a-tool | docs/handoff/R186-contract.md:345 | 工具错误 + R2 的具名码 |
| contract-layer-b-append | docs/handoff/R186-contract.md:346 | 同一码**具名抛** ; 静默截断与静默丢弃都不许 |
| contract-layer-c-render | docs/handoff/R186-contract.md:347 | 永不抛 ; 只取**最新** ; elided |
| contract-newest-not-oldest | docs/handoff/R186-contract.md:348 | 为什么留最新而不是留最旧 |
| contract-r48-compat | docs/handoff/R186-contract.md:349 | 渲染必须对垃圾行保持全域 |
| appendnote-text-check | plugins/dsh-link-notes/src/index.ts#appendNote: text must be a string | - |
| appendnote-author-check | plugins/dsh-link-notes/src/index.ts#appendNote: author must be a non-empty string | - |
| appendnote-appends | plugins/dsh-link-notes/src/index.ts#store.log.append(noteRecord(id, input.text, input.tags ?? [], OPEN, input.author)) | - |
| config-only-dir | plugins/dsh-link-notes/src/index.ts#dir: z.string().default('') | - |
| note-kind | plugins/dsh-link-notes/src/index.ts#export const NOTE_KIND = 'note/state' | - |
| noterecord-export | plugins/dsh-link-notes/src/index.ts#export function noteRecord( | - |
| noterecord-fields | plugins/dsh-link-notes/src/index.ts#kind: NOTE_KIND, subject: id, payload: { id, text, tags: | - |
| projectnotes-export | plugins/dsh-link-notes/src/index.ts#export function projectNotes( | - |
| malformed-never-throws | plugins/dsh-link-notes/src/index.ts#never throws: one bad line must not cost the reader every note in the ledger | - |
| fold-is-the-only-source | plugins/dsh-link-notes/src/index.ts#return projectNotes(store.log.replay()) | - |
| setnotestate-verbatim | plugins/dsh-link-notes/src/index.ts#setNoteState: no note | - |
| contract-refusal-passthrough | docs/handoff/R186-contract.md:353 | 无 `approval` 通道 ; 账本字节不变 |
| contract-exactly-one-fact | docs/handoff/R186-contract.md:354 | 恰好一条 ; note/state |
| contract-ask-every-time | docs/handoff/R186-contract.md:351 | 每次 `notes_add` 都问 |
| contract-list-does-not-ask | docs/handoff/R186-contract.md:356 | notes_list |
| kernel-pretooldecision | core/deepseek-harness/packages/core/tools/src/index.ts:607 | export type PreToolDecision |
| kernel-ask-variant | core/deepseek-harness/packages/core/tools/src/index.ts:611 | kind: 'ask' |
| kernel-serviceask | core/deepseek-harness/packages/core/tools/src/index.ts:1727 | private async serviceAsk( |
| kernel-deny-no-approval-service | core/deepseek-harness/packages/core/tools/src/index.ts:1732 | approval === undefined |
| kernel-no-approval-reason | core/deepseek-harness/packages/core/tools/src/index.ts:1734 | requires approval (not yet supported) |
| kernel-deny-no-agent | core/deepseek-harness/packages/core/tools/src/index.ts:1738 | exec.agent === undefined |
| kernel-no-agent-reason | core/deepseek-harness/packages/core/tools/src/index.ts:1740 | no agent to route it through |
| kernel-grant | core/deepseek-harness/packages/core/tools/src/index.ts:1753 | case 'allowed-once' |
| kernel-deny-rejected | core/deepseek-harness/packages/core/tools/src/index.ts:1755 | the user rejected tool |
| kernel-deny-cancelled | core/deepseek-harness/packages/core/tools/src/index.ts:1759 | was cancelled |
| kernel-deny-unavailable | core/deepseek-harness/packages/core/tools/src/index.ts:1763 | but no approval channel is available |
| kernel-assertnever | core/deepseek-harness/packages/core/tools/src/index.ts:1766 | assertNever(outcome, 'ApprovalOutcome') |
| approval-outcome-type | core/deepseek-harness/packages/interaction/user-approval/src/types.ts:32 | export type ApprovalOutcome |
| section-text-is-provider | core/deepseek-harness/packages/core/system-prompt/src/index.ts:66 | readonly text: string |
| section-interpolate-field | core/deepseek-harness/packages/core/system-prompt/src/index.ts:68 | readonly interpolate?: boolean |
| render-interpolate-false | core/deepseek-harness/packages/core/system-prompt/src/index.ts:281 | section.interpolate === false |
| render-drops-empty | core/deepseek-harness/packages/core/system-prompt/src/index.ts:282 | filter(text => text.length > 0) |
| section-registration | core/deepseek-harness/packages/core/system-prompt/src/index.ts:454 | section(section: PromptSection): () => void |
| section-order-must-be-finite | core/deepseek-harness/packages/core/system-prompt/src/index.ts:455 | Number.isFinite(section.order) |
| section-order-team-policy | core/deepseek-harness/packages/core/system-prompt/src/index.ts:129 | TEAM_POLICY: 600 |
| section-order-ptc-only | core/deepseek-harness/packages/core/system-prompt/src/index.ts:130 | PTC_ONLY: 800 |
| prestep-assembles-every-step | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:272 | systemPrompt.assemble |
| contract-freeze-section-name | docs/handoff/R186-contract.md:341 | notes:ledger ; order: 700 ; interpolate: false |
| contract-interpolate-why | docs/handoff/R186-contract.md:342 | 用户文本不是模板 |
| contract-no-second-copy | docs/handoff/R186-contract.md:154 | 逐字节来自折叠 |
| project-head-rewrite | core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:88 | project(rendered: string |
| project-inhistory-gate | core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:95 | input.inHistory |
| project-commits-only-on-change | core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:98 | head.text !== rendered |
| project-inhistory-equal | core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:101 | latest.text === rendered |
| agent-inhistory-source | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:411 | systemPromptUpdate === 'in-history' |
| contract-cost-three-numbers | docs/handoff/R186-contract.md:166 | 代价三数字 ; startsSeries |
| contract-starts-series-trap | docs/handoff/R186-contract.md:167 | 读的是**会话里当下那一条 header 的值** |
| r185-reading-g5 | docs/handoff/R185-A-groups.md:97 | G5 ; the trio reads the session header it actually has |
| r185-reading-g6 | docs/handoff/R185-A-groups.md:98 | G6 ; a header that does not start a series is reported false |
| r185-before-undefined | docs/handoff/R185-A-groups.md:122 | before=undefined |
| contract-budget-ceiling | docs/handoff/R186-contract.md:169 | 22,781 字符 |
| group-shape-precedent-teams | plugins/dsh-link-groups/cordis.patch.yml:28 | - id: teams |
| group-shape-teams-tools-open | plugins/dsh-link-groups/cordis.patch.yml:36 | tools: |
| group-shape-teams-tools-close | plugins/dsh-link-groups/cordis.patch.yml:44 | - team_request_peer |
| group-tools-array-required | plugins/dsh-link-groups/src/index.ts:151 | !Array.isArray(tools) |
| contract-group-members-frozen-list | docs/handoff/R186-contract.md:365 | - notes_list |
| contract-group-members-frozen-add | docs/handoff/R186-contract.md:366 | - notes_add |
| contract-group-yaml-shape | docs/handoff/R186-contract.md:360 | yaml |
| group-ancestor-layer-rule | plugins/dsh-link-groups/cordis.patch.yml:5 | registered on an ANCESTOR layer |
| group-filter-inherits-only | plugins/dsh-link-groups/cordis.patch.yml:6 | filters what a scope inherits and never what its own layer registers |
| group-never-half-masked | plugins/dsh-link-groups/cordis.patch.yml:8 | silently half-masked |
| group-no-manifest-carries-tools | plugins/dsh-link-groups/src/index.ts:152 | the membership is written down because no package manifest carries a tool list |
| group-provider-warn-only | plugins/dsh-link-groups/src/index.ts:840 | is a cross-check only and |
| live-evidence-ancestor-layer | docs/handoff/R185-F-live-declare.md:213 | blocked: GROUPS_NO_TOOLS |
| contract-register-on-ancestor | docs/handoff/R186-contract.md:340 | ctx.inject.call(ctx, ['tools'] ; 祖先层 |
| contract-tools-only-two | docs/handoff/R186-contract.md:336 | notes_list ; notes_add ; 只有这两个 |
| contract-group-provider-ref | docs/handoff/R186-contract.md:367 | provider: notes_ ; 交叉校验 |
| declaring-tools-pattern | plugins/dsh-link-collab/src/index.ts:9127 | inject.call(ctx, ['tools'] |
| declaring-tools-export | plugins/dsh-link-collab/src/index.ts:9120 | export function installDeclaringTools |
| notes-apply-provides-store | plugins/dsh-link-notes/src/index.ts#ctx.provide('linkNotes', store) | - |
| notes-row-mounted | plugins/dsh-link-notes/cordis.patch.yml#id: link-notes | link-notes |
| notes-bundle-patch | plugins/dsh-link-notes/package.json#./cordis.patch.yml | cordis.patch.yml |
| status-icon-source-stale | docs/handoff/STATUS.md:110 | 图标来源（官方设计系统 / FluentUI / COLR 字体）未摸清 |
| status-notes-carrier-debt | docs/handoff/STATUS.md:518 | 便条（第 13 条）先要载体 |
| contract-status110-row | docs/handoff/R186-contract.md:74 | STATUS.md:110 |
| contract-status518-row-numbering | docs/handoff/R186-contract.md:75 | STATUS.md:518 ; 仍欠」①② |
| contract-correction-a | docs/handoff/R186-contract.md:38 | 1.1 A |
| contract-correction-b | docs/handoff/R186-contract.md:44 | 1.2 B |
| contract-correction-c | docs/handoff/R186-contract.md:51 | 1.3 C |
| contract-correction-d | docs/handoff/R186-contract.md:64 | 1.4 D |
| contract-old-gate-count | docs/handoff/R186-contract.md:11 | 门注册表 **实测 116 条** |
| contract-new-gate-count | docs/handoff/R186-contract.md:328 | 共 **117** 条 |
| contract-gate-numbers | docs/handoff/R186-contract.md:329 | 118 `notes-ledger` ; 119 `notes-inject` |
| contract-no-gate-120 | docs/handoff/R186-contract.md:330 | 120 `notes-live` 本轮不写 |
| glyphs-only-three | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:28 | const permissionGlyphs = new Map |
| glyph-third-entry | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:30 | workspace-write |
| glyph-gap-admitted | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:34 | names outside the design set get none |
| glyph-alias-import | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:19 | AUTO_REVIEW_PRESET as AUTO_REVIEW |
| auto-review-machine-value | core/deepseek-harness/packages/client/ui-permission-presets/src/client/presentation.ts:7 | AUTO_REVIEW_PRESET = 'auto' |
| auto-label-zh | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:53 | 'auto.label': 'Auto review' |
| auto-label-en | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:77 | 'auto.label': 'Auto review' |
| auto-badge-zh | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:54 | 'auto.badge': 'EXP' |
| auto-badge-en | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:78 | 'auto.badge': 'EXP' |
| kernel-pin-never-edited | kernel.lock.json:2 | never edited |
| kernel-pin-commit | kernel.lock.json:6 | 5badb15 |
| contract-item6-register-only | docs/handoff/R186-contract.md:381 | permissionGlyphs ; 只有 3 项 |
| contract-item6-policy-open | docs/handoff/R186-contract.md:382 | 一条政策，不是一轮生产 |
| contract-kernel-untouched | docs/handoff/R186-contract.md:383 | 本轮内核一个字节都不许动 |
| missed-translation-method | docs/handoff/R186-contract.md:117 | 27 个文件 ; 1047 个 zh 键 |
| missed-translation-count | docs/handoff/R186-contract.md:118 | 19 个键的 zh 值与 en 值逐字节相同 |
| missed-translation-keyset | docs/handoff/R186-contract.md:119 | zh/en 键集不对称 = 0 |
| cordis-patch-notes-group | plugins/dsh-link-groups/cordis.patch.yml:55 | - id: notes |
| cordis-patch-notes-member-list | plugins/dsh-link-groups/cordis.patch.yml:59 | - notes_list |
| cordis-patch-notes-member-add | plugins/dsh-link-groups/cordis.patch.yml:60 | - notes_add |
| cordis-patch-notes-provider | plugins/dsh-link-groups/cordis.patch.yml:61 | provider: notes_ |
| cordis-patch-notes-state-auto | plugins/dsh-link-groups/cordis.patch.yml:62 | state: auto |
| gate-doc-citations-default-docs | scripts/verify-doc-citations.mjs:30 | ['docs/protocol/device-net-v1.md', 'docs/handoff/PLAN.md', 'docs/handoff/STATUS.md'] |
| gate-doc-citations-registered | scripts/verify-all.mjs#name: 'doc-citations', kind: 'offline' | doc-citations ; verify-doc-citations.mjs |
| gate-doc-citations-three-tables | scripts/verify-all.mjs#three tables (the device-net page, PLAN, STATUS) | three tables ; PLAN ; STATUS |
| gate-doc-citations-tracks-citations | scripts/verify-doc-citations.mjs:107 | --error-unmatch |
| gate-doc-citations-r2-anchor | scripts/verify-doc-citations.mjs:157 | refuse(401, 'UNAUTHORIZED') |
| gate-doc-citations-self-healing-precedent | scripts/verify-doc-citations.mjs:147 | the protocol table is now entirely |
| checker-resolves-cited-path | scripts/check-protocol-page.mjs:81 | join(root, (exact ?? search)[1]) |
| r48-mixed-ledger-unusable-shape | scripts/verify-notes.mjs#text: 42 | - |
| r48-note-texts-are-short | scripts/verify-notes.mjs#await a.append(store, { text: "会话一：升级不许丢", tags: ["beta", "alpha", "beta"], author: "verifier" }) | - |
| contract-r8-gates-not-edited | docs/handoff/R186-contract.md:386 | 不许碰任何门文件 |
| contract-r9-p4-belongs-to-lead | docs/handoff/R186-contract.md:390 | P4 从生产任务表里划掉，归 Lead |
| contract-r10-write-scopes | docs/handoff/R186-contract.md:393 | 唯一写范围 |
| contract-r10-no-verify-all | docs/handoff/R186-contract.md:402 | 跑整套 |
| contract-r11-no-zero-cost | docs/handoff/R186-contract.md:408 | 不许出现「零代价」 |
| contract-r11-git-only-lead | docs/handoff/R186-contract.md:411 | git 提交只有 Lead 做 |
| gate-seam-check-reads-collab | scripts/verify-doc-citations.mjs:28 | plugins/dsh-link-collab/lib/index.js |
| gate-seam-claimed-by-spelling | scripts/verify-doc-citations.mjs:115 | exec(hash[2]) |
| notes-render-export | plugins/dsh-link-notes/src/index.ts#export function renderNotesSection(state: NotesState, limits: NotesLimits): string { | - |
| notes-section-name | plugins/dsh-link-notes/src/index.ts#export const SECTION_NAME = 'notes:ledger' | - |
| notes-tool-name-list | plugins/dsh-link-notes/src/index.ts#export const LIST_TOOL = 'notes_list' | - |
| notes-tool-name-add | plugins/dsh-link-notes/src/index.ts#export const ADD_TOOL = 'notes_add' | - |
| notes-interpolate-false | plugins/dsh-link-notes/src/index.ts#interpolate: false | - |
| notes-approval-line | plugins/dsh-link-notes/src/index.ts#kind: 'ask' | - |
| notes-apply-registers-section | plugins/dsh-link-notes/src/index.ts#prompt.section({ | - |
| notes-section-text-is-the-fold | plugins/dsh-link-notes/src/index.ts#text: () => renderNotesSection(notesOf(store), limits), | renderNotesSection |
| notes-tools-registered | plugins/dsh-link-notes/src/index.ts#const dispose = registry.register(definition) | registry.register(definition) |
| notes-config-limits | plugins/dsh-link-notes/src/index.ts#maxNotes: z.number().default(DEFAULT_MAX_NOTES), | DEFAULT_MAX_NOTES |
| notes-row-comment-registers | plugins/dsh-link-notes/cordis.patch.yml#registers the `notes:ledger` prompt section and | notes:ledger |
| gate-notes-ledger-registered | scripts/verify-all.mjs#name: 'notes-ledger', kind: 'offline' | verify-notes-ledger.mjs |
| gate-build-checks-lib | scripts/verify-all.mjs#name: 'build', kind: 'offline' | plugins/build.mjs ; --check |
| build-check-means-lib-drift | plugins/build.mjs:6 | fail if lib/ differs from a fresh build |
<!-- /citations -->

---

## 十、Lead 收口补记（2026-10-11 22:5x）

上面 §〇 与 §53 是**写作时刻（22:34）**的口径，收口时有两件事变了，这里如实补记，**不改上文**：

- **门 119 `notes-inject` 已落地并登记**（`scripts/verify-notes-inject.mjs`，87936 B，sha256 前 12 位 `ec7b5055a130`；注册表 **119 道** = live 19 / offline 100）。它的 8 条读数正是本页 §一/§三/§四 里那些「契约」句子的运行时证据：步级语义（本步不带/下一步带，未变回合 `0 system/message commit(s)`）、审批四条 outcome 具名拒且账本字节不变、`allowed-once` ⇒ 恰好一条 `note/state`、`notes` 组 closed ⇒ 执行面 `unknown tool`、一次声明 ⇒ 恰好一条 `reason:'change'` header + 一条 `developer/message`（代价 `entries 6 / bytes 2763 / startsSeries=false`）、挂载侧 `{order:700, interpolate:false}`。⇒ 本页 §53 的「注册侧仍未落盘」只对**那一刻**为真。
- **门 118 的读数也已由 Lead 复跑**：`10 readings, 10 held`，`--self-attack` 12 突变体 / `0 reading(s) uncovered`。
- **套件状态**：开工普查（87 道离线门）`86 passed, 1 failed`（唯一的红是挂载门的行尾前置，已修）；修复后同一批 **0 红**；收口家族 + 派生 17 道 `17 passed, 0 failed, 0 skipped`。完整记档：`docs/handoff/R186-handoff.md`。
- **仍未验**：活体（门 120 未写，缺窗口）、PTC 预设上的组遮罩、跨进程写账本、真后端缓存行为 —— 与 `R186-handoff.md` §4 同一份清单。
