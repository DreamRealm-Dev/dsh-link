# 客户端文案与图标（R190 P3）：内核侧为什么不动 · 产品侧规则（测量值）· 今天的产品侧实数

> 本页是 R190 的**接口冻结点**，冻结点来自 `docs/handoff/R190-contract.md`：**§1 是 Lead 的裁决（硬要求）**、§2 是 P1/P2/P3 的交付与唯一写范围、§3 是口径（覆盖率不是绿、值相同要能逐条解释）。
> 写者 = R190 生产者 **P3**；**唯一写范围只有本文件**，scratch 在 `.tmp/r190-p3/**`。
> **全程离线**：没连 31761/31760/9222、没启停客户端、没改活档案、没碰 `core/deepseek-harness/**` 与 `src-tauri/**`、没跑整套 `verify-all.mjs`、没有 git 写操作。
> **读数时刻（2026-10-12 00:49 起；P1/P2 都落地后重测于 00:5x）**：P2（`dsh-link-markdown` 客户端半：13 键 + `FileTypeIcon`）与 P1（`dsh-link-panel` 客户端半：20 键 + `IconFlatListOutlineRegular`）**都已落盘**；§4 记的是**它们落地后的重测读数**（落地前的中间态——panel `locales.ts` 18 键、`index.tsx` 尚未接线——在 §4.4 具名）。**谁再动谁重测**（§4.5）：本页不替别人的后续改动背书。
>
> **R191 P1 后的重锚（重锚者：R191 的契约页维护者；写作时刻 2026-10-12 01:44）**：P1 把 `dsh-link-toolbar` 的**私有字典**换成内核 **locale 服务** ⇒ 本页两条针（原 `toolbar-private-dictionary` / `toolbar-inject-has-no-locale`）锚在**被退役的文本**上，写作时刻实测 `91 of 93`、exit 1。本轮**只改本文件**（scratch 在 `.tmp/r191-pageb/**`）：两条针重锚到今天为真处（旧文本 → 新事实在 §4.6 逐条具名；§6 的表逐条可跑），§〇 / §2.2 / §2.3 / §4.2 / §4.5 里同一批事实跟着改；**§5.1 是 R190 收口时刻的读数，本轮的重测在 §5.2**。**门 125 的声明集不是我改的**：写作时刻（01:44）它仍只声明 3 个包；**定稿复读（01:47）**时那位后继作者的**在飞、未提交**工作树改动已把第 4 个加进去——两个读数都在 §4.6 具名。
>
> **引文口径（三种形式，分工是故意的）**——与 `docs/dev/notes-ui.md`、`docs/dev/client-plugin-mount.md` 同一口径：
> - `core/deepseek-harness/**` 是 **pin 住的**内核（`kernel.lock.json`）⇒ `path:line`。行号会漂**是设计**：内核一动就得有人来对齐。
> - `plugins/**` 与 `scripts/verify-all.mjs` **本轮就会动** ⇒ **一律自愈形** `path#text`：那段文本必须在全文**恰好出现一次**才算一条引文。
> - 契约/记档（`docs/handoff/R190-contract.md`、`docs/handoff/PLAN.md`、`docs/dev/notes-ledger.md`）收口时还会被改 ⇒ 也用自愈形。
> **正文里的行号只作阅读辅助，判据是页尾那张表。**
> ⚠ 两条解剖学事实（我读核对器源码得到的）：① `path#text` 那个正则的 `(.*)` 是**贪婪**的（`scripts/check-protocol-page.mjs:78-80`）⇒ **needle 文本里不许再出现 `#`**；② `must contain` 格里出现 `|` 会让整行判成 malformed（`:53`），`-` 是「本行不带要求」的**故意拼法**（`:62`）。

## 〇、一句话

md 第 6 条要「汉化 + 图标补全 + 风格统一 + 深浅适配 + 不冗余」。**内核侧那半改不动**（§1 的三条堵死，每条都有源码落点）：`Auto review`/`EXP`、权限 glyph 缺口、19 条 `zh == en` 候选**保持具名欠账**，等用户裁政策。我们唯一能合法做的是**产品侧**那一半：**我们自己写的客户端半**，文案一律经 `ctx.locale` 命名空间（`bind` + `register`），图标优先用第一方集 `@deepseek-ai/dsh-client-ui-primitives`，没有合适件才自绘、且自绘件必须满足测量出来的规则（16×16、`currentColor`、描边 1 或 1.3）。§4 给今天的产品侧实数（11 个包有客户端半、**4 个**走 locale 服务、私有字典 **0 个**、其余硬编码——R191 P1 把第 4 个 `dsh-link-toolbar` 拉进了服务，见 §4.2/§4.6）。

## 一、内核侧为什么不动（三条堵死，各带落点）

### 1.1 堵死①：内核是 pin 住的上游检出，动它就是动门 `baseline`

- `kernel.lock.json:2` 原文：`The vendored kernel is a pinned upstream checkout and is never edited.`，同一句接着写 `verify-baseline.mjs refuses when the checkout is dirty or its HEAD is not this commit`；pin 的 commit 在 `:6`（`5badb15`）。
- 门注册表里 `baseline` 是 `kind: 'offline'`（页尾锚 `gate-baseline-registered`），命令是 `node scripts/verify-baseline.mjs`。
- **落点在哪一环**：md 点名的 `auto.label` 字典在 `core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:53`（zh）与 `:77`（en）；权限 glyph 表在 `core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:28`。两处都在内核树里 ⇒ 改它 = 改 pin 内核 = 门 `baseline` 直接拒。

### 1.2 堵死②：locale 命名空间**单一占用**（同一 `(ns, locale)` 只有一个 owner）

- 契约原文：`Duplicate (ns, locale) throws (single occupant; a namespace's texts have one owner)`（`core/deepseek-harness/packages/client/locale/src/client/index.ts:382-383`）。
- 实码：`throw new Error(\`locale namespace "${ns}" already has locale "${locale}"\`)`（同文件 `:417`）。
- 内核自己已经占掉了两个公共命名空间：`locale.register(COMMON_NS, { zh, en })`（`:579`）与 `locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn })`（`:580`）。
- **md 那条为什么落不下来**：`auto.label` 的 owner 是 `'permission.access'`（`ui-permission-presets/src/client/locales.ts:4`），该包自己在 `ui-permission-presets/src/client/index.ts:117` 注册了它 ⇒ 任何第三方插件再注册 `('permission.access', 'zh')` 会**抛**。想改那两个字，只有改内核（被 §1.1 挡住）。

### 1.3 堵死③：slot **声明即占用**（我们替不了内核那两条 tab）

- `core/deepseek-harness/packages/client/ui-slots/README.md:46`：`Declaring a slot is claiming it`——声明者成为**唯一**被允许渲染该 key 的条目，且「注册进未声明的槽 / 重复声明子槽」在 load 时抛。
- keyed 座的第二次注册也抛：`throw new Error(\`keyed slot "${options.name}" already has an entry for key "${options.key}" ...\`)`（`ui-slots/src/index.ts:1225`）。
- **今天已经被占的 key（我实测，tab 座 `sidebar.right.pane.tab` / `.title`）**：

| key（注册身份） | 谁占 | 落点（写作时刻行号，会漂） |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-deliverables` | ui-deliverables | `ui-deliverables/src/client/index.ts:18` |
| `@deepseek-ai/dsh-client-ui-plan` | ui-plan | `ui-plan/src/client/index.ts:61` |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`（+ 6 个 /kind 子 id） | ui-sidebar-documentpreview | `ui-sidebar-documentpreview/src/client/index.ts:8-18` |
| `@deepseek-ai/dsh-client-ui-sidebar-files` | ui-sidebar-files | `ui-sidebar-files/src/client/index.ts:18` |
| `@deepseek-ai/dsh-client-ui-sidebar-browser` | ui-sidebar-browser | `ui-sidebar-browser/src/client/index.ts:12` |
| `@deepseek-ai/dsh-client-ui-sidebar-terminal` | ui-sidebar-terminal | `ui-sidebar-terminal/src/client/index.ts:52` |
| `@deepseek-ai/dsh-client-ui-schedule/task` | ui-schedule | `ui-schedule/src/client/index.ts:14` |
| `@deepseek-ai/dsh-client-ui-subagent` | ui-subagent | `ui-subagent/src/client/index.ts:18` |
| `@deepseek-ai/dsh-client-ui-sidebar-right/guide` | ui-sidebar-right（guide 页） | `ui-sidebar-right/src/client/index.ts:9` |

- **别读成「slot 挡住了汉化」**：这些 key 都是**内核包自己的 id**；我们的包用 `dsh-link-panel` / `dsh-link-markdown` 两个自己的 id 注册（`plugins/dsh-link-panel/src/client/view.ts` 的 `PANEL_TAB_ID`、`plugins/dsh-link-markdown/src/client/claim.ts` 的 `MARKDOWN_TAB_ID`），**不冲突**。slot 那条堵死的是「**替内核已有的 tab 改名/换图标**」，不是「我们自己的 tab 装不上」——后者门 122/124 已在读（§5）。

### 1.4 保持欠账的清单（三条，具名；政策未裁，本页只登记）

| # | 欠账 | 事实（读到的） |
|---|---|---|
| 1 | **`Auto review` + `EXP` 不汉化** | zh 的 `'auto.label': 'Auto review'`（`ui-permission-presets/src/client/locales.ts:53`）与 en 的同一键（`:77`）**逐字节相同**；`'auto.badge': 'EXP'` 同样是 ``(`:54` / `:78`)。是「有意保留英文产品名」还是漏译，**代码里判不了** |
| 2 | **权限 glyph 只有 3 项，且 `'auto'` 拿不到** | `const permissionGlyphs = new Map<string, ReactNode>([`（`PermissionSelect.tsx:28`）三键 = `read-only`/`workspace-write`/`danger-full-access`；机器值 `AUTO_REVIEW_PRESET = 'auto'`（`presentation.ts:7`）；注释自己承认 `names outside the design set get none`（`PermissionSelect.tsx:34`）。表是**模块内私有**，没有注入缝 |
| 3 | **R186 的 19 条 `zh == en` 候选** | 枚举读数在 `docs/dev/notes-ledger.md` §72：遍历内核 `.ts/.tsx` 的成对字典 ⇒ **27 文件 / 1047 个 zh 键 / 19 个键值逐字节相同 / 键集不对称 0**。口径是**「可机械发现的候选」不是「已确认的漏译」**（判不出「翻了但翻错」） |

**一条禁令（R186 已按它不动手，本页照抄）**：**不许**把 `packages/experimental/auto-review/icon.svg`（`width="36" height="36"`、`linearGradient`、固定色）塞进 16×16 `currentColor` 的 glyph 槽（理由见 §3.4）。

## 二、产品侧规则（我们唯一能合法做的那半）

### 2.1 文案：一律经 `ctx.locale` 命名空间（`bind` + `register`）

- **先例（内核自己的包，两条）**：
  - `ui-deliverables/src/client/index.ts:30` `import { en, NS, zh, type DeliverablesKey } from './locales.ts'`、`:38` 把键并进 `LocaleNamespaceMap`、`:60` `ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')`。
  - `ui-sidebar-right/src/client/index.ts:109` `const t = ctx.locale.bind(NS)`（**在 apply 顶层绑**）、`:162` `ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-right: dictionaries')`。
- **形状**：`const t = ctx.locale.bind(NS)` 取译函数 + `ctx.effect(() => ctx.locale.register(NS, { zh, en }), '<pkg>: dictionaries')` 注册字典（契约 §1.2 原文）。
- **注册必须是 effect**：注册返回 disposer，卸载时字典要跟着走。
- **座上的 `locale` 字段**：把 `t` 送进组件的正规路径是注册项的 `locale: NS` 声明（先例：`ui-deliverables/src/client/index.ts:66` 一带、`ui-plan/src/client/index.ts:110`、`ui-sidebar-browser/src/client/index.ts:83`）。今天产品侧两个包各自的做法：`plugins/dsh-link-markdown/src/client/register.ts` 在 tab body 的注册里写 `locale: NS`；`plugins/dsh-theme-settings/src/client/index.tsx` 走 `settings.general.item` 自己的注入面。

### 2.2 命名空间**按包唯一**（同一 `(ns, locale)` 再注册会抛）

见 §1.2：throw 在 `locale/src/client/index.ts:417`。⇒ 我们的包**各用各的`NS`常量**（今天：`settings.theme-style`、`dsh-link-markdown`、`dsh-link-panel`、`dsh-link-toolbar`——第 4 个是 R191 P1 落地的，§4.6），并且 `NS` 与包名同形，冲突时一眼看得出是谁占了。

### 2.3 zh 与 en 的**键集必须相同**

- **内核怎么强制**：typed 重载 `register<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void`（`locale/src/client/index.ts:389`）——每个内置 locale 都必须给、且键并进 `LocaleNamespaceMap` 后多一个少一个都是编译错（同文件 `:378-384` 的注释：`bilingual balance enforced at registration`）。
- **产品侧今天怎么钉**（三种写法，都是编译期）：
  - `plugins/dsh-link-panel/src/client/locales.ts`：`export const zh = { ... }` 为键集真源，`export type PanelCopyKey = keyof typeof zh`，en 写成 `export const en: Record<PanelCopyKey, string> = { ... }`。
  - `plugins/dsh-link-markdown/src/client/locales.ts` 与 `plugins/dsh-theme-settings/src/client/locales.ts`：zh 用 `satisfies Record<string, string>`，en 用 `satisfies Record<MarkdownKey, string>` / `satisfies Record<ThemeKey, string>`。
- **本页实测（落地后重测）**：`dsh-theme-settings` **24/24**、`dsh-link-toolbar` **12/12**（R191 P1 起走 locale 服务，§4.2/§4.6）、`dsh-link-markdown` **13/13**、`dsh-link-panel` **20/20**（更正：R190 初稿写 19，源码读数是 zh 20 / en 20，§4.2 的收口更正早就写了）。命令与读数见 §4.1。

### 2.4 值相同的每一条都要能**逐条解释**（标识符/单位 vs 真漏译）

口径（契约 §3 第三条）：**不许**为了让字典「看起来完整」而复制英文进 zh；值相同要么本来就是标识符/单位，要么写清楚为什么保留，**每一条都要能被逐条核**。

**今天产品侧的 `zh == en` 逐条清单（我实测，命令见 §4.1）**：

| 包 | 键 | 值 | 为什么不是漏译 |
|---|---|---|---|
| `dsh-link-panel` | `copy.format.line` | `{code}: {detail}` | **标点+占位符**，两片都是路由自己的数据（码与原文），翻译它等于给同一个事实起第二个名字 |
| `dsh-link-toolbar` | `toolbar.open` | `DSH LINK` | **产品名/标识符**（按钮上就是这四个字的品牌名，不译） |
| `dsh-theme-settings` | `controlStyle.liquidGlassHint` | `Apple Liquid Glass` | **产品名**（Apple 的材质名，Apple 自己的写法） |
| `dsh-theme-settings` | `glassPreset.tahoe` / `glassPreset.goldenGate` | `Tahoe` / `Golden Gate` | **专名**（macOS 版本代号，与 `:16/:18` 的提示句一起读；提示句本身是译的） |

P2 把「本来就该留英文的字符串」做成了**具名清单**而不是散落在字典里：`plugins/dsh-link-markdown/test/keep-verbatim.json`（一条一个 literal + 理由，自检要求「清单里每条都必须命中、命中的每条都必须在清单里」，并逐条进 README）。

### 2.5 冗余禁令（契约 §1.3）

产品侧**不新增**第二个 Drawer / 两个同义入口；面板项闭集里没被用到的 `kind` **不许**为了「补齐」而硬塞。（本页只登记这条；面板项闭集的事实见 `docs/dev/notes-ui.md`。）

## 三、图标规则（全部是**测量值**，不是口味）

### 3.1 第一方集在哪、怎么进活页面

- **包**：`@deepseek-ai/dsh-client-ui-primitives`。它在 `compat/host-modules.json` 的 `clientBaseline` 里（锚 `host-modules-baseline`）——**活页面预载**，插件导入它**不产生模块图请求**；内核侧同一份清单在 `core/deepseek-harness/packages/client/web/src/platform.ts:12`。
- **导出口**：`core/deepseek-harness/packages/client/ui-primitives/src/index.ts:109` `export * from './icons/index.tsx'`；图标族另有 `src/PermissionIcon.tsx`（如 `:45` `export function PermissionIconReadOnlyRegular(props: IconProps): ReactNode {`）。

### 3.2 命名法与测量值（`icons/index.tsx`，写作时刻）

| 测量 | 读数 | 命令 |
|---|---|---|
| 该模块 `export const/function` 总数 | **191** = 188 个 `Icon*` + `SHIELD_OUTLINE_PATH` + `ICON_REGULAR_STROKE` + `ICON_MEDIUM_STROKE` | `node -e` 逐行正则（见 §4.1 的仪器） |
| 命名法 | `Icon<名><风格><字重>`；风格 `Outline` 158 / `Fill` 20 / 无 10；字重 `Regular` 94 / `Medium` 94 | 同上 |
| 描边 | `export const ICON_REGULAR_STROKE = 1`（`:22`）、`export const ICON_MEDIUM_STROKE = 1.3`（`:25`） | 读源码 |
| 画布与颜色 | `viewBox="0 0 16 16"`、`stroke="currentColor"`（例 `:38-41`）；组件缺省 `size = 16` | 同上 |
| 颜色从哪来 | `IconProps`（`src/icons/props.ts:2`）只有 `size` 与 `className`：`color rides currentColor` | 读 props.ts |

⇒ **自绘件的三条硬条件**：**16×16**、**`currentColor`**、**描边 1 或 1.3**（并与现有构件同一构图语言）。

### 3.3 glyph 槽的注册形状：**chip 座没有 icon 字段，图标在 guide 条目上**

我读 `ui-sidebar-right/src/client/tab-registry.ts` 得到的事实（这条最容易抄错）：

- `SidebarRightTabDefinition`（`:94` 起）的字段是 `id`/`kind`/`multiple`/`keepMounted`/`patterns`/`priority`/`canOpen`/`title`/`guide`——**没有 `icon`**；`title` 是 thunk：`readonly title: (address: string) => string`（`:136`，注释 `:24` 说它在每次使用时重读，所以换语言不需要重新注册）。
- 图标只出现在 **guide 条目**上：`readonly icon?: ComponentType<IconProps>`（`:82`）；同一接口的 `title` 是 `() => string`（`:73`）、`description?` 是 `() => string`（`:80`）。
- ⇒ 「标签页图标」在产品侧的正确落点是 `sidebarRightTabs.register` 里那个 `guide[].icon`（页面型的 tab 靠 guide 条目进入），**不是** `sidebar.right.pane.tab.title` 座。

### 3.4 为什么品牌色件（36×36、带渐变/固定色）**不许**进 glyph 槽

- **它不是 glyph，是插画**：`packages/experimental/auto-review/icon.svg` 是 `width="36" height="36" viewBox="0 0 36 36"`（`:1`），填充走 `linearGradient`（`:8` `#7AC2FF` → `#4A65E8`）+ 白色描边。
- **深浅适配靠 `currentColor`，不靠两套资源**：glyph 槽的画法要求颜色**继承文字色**（`IconProps` 没有颜色字段，`PermissionSelect.tsx:25-26` 的注释把这条写成理由：`Permission glyphs follow currentColor so the trigger and menu rows tint the shared product artwork with their own text color`）。固定色的件不跟主题走 ⇒ 要适配就得**每个主题一套资源**，那正是「不冗余」要禁止的。
- **尺寸也不同源**：glyph 是 16×16 网格里的 1px/1.3px 描边；36×36 的件按 `size=16` 缩下去，1.5px 的视觉重量与描边会被缩成非整数像素，与相邻 glyph 对不齐。

### 3.5 自绘件的验收（可机械判，按 SVG 字节）

`<svg>` 上必须有 `viewBox="0 0 16 16"`（或 16×16 的 width/height 二选一写死）、颜色出现在 `currentColor` 上（不许出现字面色值/渐变 `stop-color`）、描边 `stroke-width` ∈ {1, 1.3}。**产品侧今天没有自绘 glyph**：唯一的自绘件是品牌（§4.3），走的是品牌槽不是 glyph 槽。

## 四、今天的产品侧实数（R190 写作时刻 2026-10-12 00:49:14；**R191 P1 后重测于 2026-10-12 01:44**：§4.2 的 `dsh-link-toolbar` 行与「读法」、§4.5、§4.6）

### 4.1 判据与仪器（先给可复跑的读数）

1. **「有客户端半」的判据是 `package.json` 里的 `dsh.client`**（不看文件名、不看 `lib/client.js` 在不在）。命令：`node -e` 遍历 `plugins/*/package.json` 打印 `dsh.client`。
2. **文案条数的判据（我写的仪器，写在 `.tmp/r190-p3/census-v2.mjs`，输出 `.tmp/r190-p3/census-v2.txt`）**：
   - 计数：`(a)` JSX **纯散文文本节点**、`(b)` 展示属性 `placeholder|aria-label|title|alt|label` 的字面量、`(c)` locale **字典值**（逐 locale 各算一条）。
   - 不计数：类名、`data-*` 值、导入说明符、路径、码、`console.*` 参数、注释。
   - **仪器的已知盲点（具名）**：拼接出来的句子按**每个字面量**各算一条；交给导入组件 prop 的字符串只在那 5 个属性名下才算；编译过的 `lib/client.js`（JSX 已展开）只能按 **CJK 字面量**粗数——所以 §4.2 的逐条清单是我**读源码**给的，仪器只用来给「有多少」一个可复跑的数。
3. **`zh == en` 的判据**：把每个包的 `locales.ts` 里 `zh`/`en` 两个对象按 `'key': 'value'` 逐行取出来比键集与值（脚本见 `.tmp/r190-p3/census-v2.mjs` 的姊妹命令）。

### 4.2 census（11 个包有客户端半；`plugins/*` 里带 `package.json` 的目录共 22 个）

| 包 | `dsh.client` | 客户端半源码 | **locale 命名空间** | 用户文案（写作时刻） | 图标 |
|---|---|---|---|---|---|
| `dsh-link-panel` | `{platform:web}` | `src/client/**` 4 文件 | **`dsh-link-panel`**（注册 `ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-panel: dictionaries')`、绑定 `const t = ctx.locale.bind(NS)`） | **20 键 ×2**（`copy.format.line` 两语同值；**收口更正**：初稿写 19 键，门 125 的 C1 读数与包内自检都报 20 vs 20，Lead 按读数改成 20） | **第一方 `IconFlatListOutlineRegular`**（guide 条目的 glyph，`dsh-link-panel: index.tsx` 的 `PANEL_GUIDE_ICON`） |
| `dsh-link-markdown` | `{platform:web}` | `src/client/**` 6 文件 | **`dsh-link-markdown`** | **13 键 ×2** | **第一方 `FileTypeIcon`（size 16）** |
| `dsh-theme-settings` | `{platform:web,inject:…}` | `src/client/**` 5 文件 | **`settings.theme-style`** | **24 键 ×2 = 48 值** | 无 |
| `dsh-link-toolbar` | `{platform:web,inject:[…]}` | `src/client/**` 3 文件 | **`dsh-link-toolbar`**（R191 P1 落地：`inject` 含 `locale`、`ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: dictionaries')`、注册项声明 `locale: NS`） | **12 键 ×2 = 24 值**；私有 `text()` / `ToolbarLocale` / 包内 `dictionaries` **已退役**（树里没有第二份文案通路，§4.6） | **本包无 glyph 槽**（`apply()` 注册的右栏 tab 类型 = 0、第一方 glyph 导入 = 0、自绘 `<svg>` = 0；`Menu` 是构件不是图标） |
| `dsh-browser` | `{platform:web}` | **只有 `lib/client.js`** | 无 | 26 条中文字面量（含模板串） | 探测 `IconGlobe16 || IconBrowser16 || IconWindow16` ⇒ **三个名字都不在第一方集** ⇒ `Icon` 落 `undefined`，退回 `🌐` |
| `dsh-lan-bridge` | `{platform:web}` | 只有 `lib/client.js` | 无（**读** `ctx.locale` 只读 + 自 `pick(zh,en)`） | 266 条中文字面量（中英成对手写） | 探测 `IconLinkOutline16` ⇒ **不在第一方集** ⇒ 落空，退回自绘 `bridgeIcon` |
| `dsh-link-teams` | `{platform:web}` | 只有 `lib/client.js` | 无 | 82 条中文字面量 | 探测链 `IconUsersOutline` → **`IconUsersOutlineRegular`（命中第一方）** → … |
| `dsh-continue-button` | `{platform:web,immediately:true}` | `src/client/**` 1 文件 | 无 | **5 条**（`继续生成`、`思考阶段被截断`、`输出被截断`、`本轮结束原因 ${…}`、`本轮流式输出被截断`）+ 1 条入模型的 `PROMPT_TEXT = '继续'` | 无 |
| `dsh-link-brand` | `{platform:web,inject:[…]}` | `src/client/**` 2 文件 | 无 | **0**（只有自绘 SVG） | **自绘品牌件**（`viewBox="0 0 96 96"` / `"0 0 141.43 27.9"`、固定色 `#4D6BFE`）——**品牌槽不是 glyph 槽** |
| `dsh-link-responsive` | `{platform:web}` | `src/client/**` 3 文件 | 无 | **0** | 无 |
| `dsh-liquid-glass` | `{platform:web}` | `src/client/**` 2 文件 | 无 | **0** | 无 |

**读法（三档，免得把「有字典」读成「合规」）**：**A 档**（走 locale 服务）**4 个** = `dsh-theme-settings` + `dsh-link-markdown` + `dsh-link-panel` + **`dsh-link-toolbar`**（R191 P1 落地）；**B 档**（有字典但服务没参与）**今天 0 个**——`dsh-link-toolbar` 是 B 档的**唯一历史成员**，P1 把它拉进了服务（旧形态 `text(key, locale='zh')` 切语言**不生效**、`inject` 里没有 `locale`，都在 §4.6 具名）；**C 档**（硬编码，无字典）**7 个**。**「4 个」是产品侧的事实，门 125 的声明集是另一条读数（两个时刻都留下）**：**写作时刻（2026-10-12 01:44）**门的 `SUBJECTS` 仍只有 **3 行**（panel / markdown / theme-settings）——`dsh-link-toolbar` **那时候还没进**，加它是门 125 **后继作者**的活；**定稿复读（01:47）**那位作者的工作树改动**已经加上第 4 行**（`{ name: 'dsh-link-toolbar', id: '4', … }`，**未提交、不是我改的**）⇒ 以工作树为准是 4、以 HEAD 为准仍是 3。本页不替在飞改动背书（§4.5/§4.6 同此）。`dsh-lan-bridge` 是第四种具名形态：**读服务但自己 `pick(zh, en)`**。

### 4.3 图标：谁用第一方件 / 谁探测落空 / 谁自绘（写作时刻）

- **用第一方件**：`dsh-link-markdown`（`<FileTypeIcon kind="markdown" size={16} …/>`）、`dsh-link-panel`（`import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'`，作 guide 条目的 `icon`）、`dsh-link-teams`（`IconUsersOutlineRegular`）。P1 在注释里把「为什么是这个件」写成了**排除法**（同形近邻已被占：`IconPanelLeftOutline*` 是壳自己的侧栏 chrome、`IconDataOutline*` 是模型选择器、`IconChecklistOutline*` 是 todo/job 行、`IconListPenOutline*` 是 `IconPlanOutline*` 的底稿）。
- **探测落空（名字不在第一方集）**：`dsh-browser`（3 个名字全部不存在）、`dsh-lan-bridge`（`IconLinkOutline16` 不存在）。⇒ 这两处今天**没有**第一方图标；它们的 SPA 与面板仍然能画，靠的是各自的后备（`🌐` / 自绘 `bridgeIcon`）。
- **自绘（且合法）**：`dsh-link-brand` 的两件——**在品牌槽里**，不是 glyph 槽，所以 §3.4 的禁令不适用它。
- **其余 5 个包**：今天一个图标都没有（`dsh-theme-settings`、`dsh-link-toolbar`、`dsh-link-responsive`、`dsh-liquid-glass`、`dsh-continue-button`）——「图标补全」在它们身上是**待做**，不是已完成。

### 4.4 本节读不到什么（具名，免得把 census 读成验收）

1. **像素**：一个图标**长什么样**、和相邻 glyph 对不齐——census 判不了，要开页面看（本页全程离线）。
2. **P1/P2 的最终形状**：本节是**落地后重测**的读数（panel 20 键 / markdown 13 键，两个包都走 locale 服务）；**落地前**我读到的中间态是 panel `locales.ts` 18 键、`index.tsx` 还在硬编码——两次读数都在这里具名，免得有人把中间态当结论。他们**再动**就得再测（§4.5）。
3. **编译过的 `lib/client.js` 的文案数**：那 26/266/82 是 **CJK 字面量**的粗数（含模板串与错误文案），不是「用户可见文案条数」的精确值。
4. **`plugin-contract` / 派生重投影**（`compat/**`、`pack/**`）：本轮我没跑、也没读那份读数。

### 4.5 谁落地谁重测（清单）

| 谁 | 落地后必须重测什么 |
|---|---|
| **P1**（`dsh-link-panel`） | 已落地并已重测（20 键、`IconFlatListOutlineRegular`）；**再动一次就要再测一次** §4.2/§4.3，并跑 `node plugins/build.mjs --check`——**我这次跑它是红的**（见 §5），红的是 P1 的 `lib/client.js` 落后于它自己的 `src/**`，不是本页 |
| **P2**（`dsh-link-markdown`） | 已落地并已重测：13 键 + `FileTypeIcon`；再动再测 |
| **R191 P1**（`dsh-link-toolbar`） | 已落地并已重测（§4.6/§5.2）：私有字典 → 内核 locale 服务（12 键 ×2、`inject` 含 `locale`、注册项带 `locale: NS`）；**声明集那一步不是它的**（见下一行） |
| **门 125 的作者** | §4.1/§4.2 的覆盖读数（「有客户端半但没声明本地化」的包必须**点名**，不是失败也不能算绿）；**R191 把第 4 个包 `dsh-link-toolbar` 加进声明集**：写作时刻（01:44）`SUBJECTS` 仍 3 行 ⇒ **定稿复读（01:47）**在飞、未提交的工作树改动已加上（§4.6；以 HEAD 为准仍是 3） |
| **Lead** | 内核侧三条欠账（§1.4）的政策裁决；本页 §1.2/§1.3 的内核行号随内核升级对齐 |

### 4.6 R191 P1 的漂移：旧文本 → 新事实（两条针、逐条具名）

P1 把 `dsh-link-toolbar` 的**私有字典**（`text(key, locale = 'zh')`）换成内核 **locale 服务**（注册 + 座位上的 `t`）。本页原来那两条针正好锚在**被退役的文本**上 ⇒ 写作时刻实测 `91 of 93 citation(s) hold`、exit 1，红的就是这两条。修法是本页的老规矩「**页跟着产品走**」：针重锚到今天为真处（§6 表逐条可跑），**退役的旧文本不留在针上**，但**这次漂移按 §4.4 的写法具名留在页里**：

| 旧行 id（退役） | 旧针（写作时刻已不在树里） | 新行 id | 新针（今天为真） |
|---|---|---|---|
| `toolbar-private-dictionary` | `plugins/dsh-link-toolbar/src/client/locales.ts#export function text(key: ToolbarKey, locale: ToolbarLocale = 'zh'): string {` | `toolbar-register-dictionaries` | `plugins/dsh-link-toolbar/src/client/index.tsx#ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: dictionaries')` |
| `toolbar-inject-has-no-locale` | `plugins/dsh-link-toolbar/src/client/index.tsx#export const inject = ['slots']` | `toolbar-inject-declares-locale` | `plugins/dsh-link-toolbar/src/client/index.tsx#export const inject = ['slots', 'locale']` |

- **退役的是三件**：私有 `text()`、`ToolbarLocale`、包内 `dictionaries` 表。判据不是人眼——`plugins/dsh-link-toolbar/{src,lib}` 全扫 `ToolbarLocale|export function text\(` **0 命中**（命令与读数在下）。
- **换上来的是服务**：字典经 `ctx.effect` 注册（卸载跟着走）、注册项声明 `locale: NS`（`t` 座位由此而来）、组件只拿键不拿句子 ⇒ §6 的 `toolbar-*` 六行逐条钉住（`NS` / zh 键集真源 / en 按 `Record<ToolbarCopyKey, string>` 键入 / 注册 / `inject` / 座位声明）。
- **键数（今天的源码读数）**：`zh` **12 键**、`en` **12 键**（×2 = 24 值）；同值的那条仍是 `toolbar.open` = `DSH LINK`（§2.4 的产品名，理由在包内 `test/keep-verbatim.json`）。
- **被守的包数 3 → 4：「谁还没做」要读准（两个时刻，别混）**。产品侧走 locale 服务的客户端半从 3 个变 **4 个**（第 4 个 = `dsh-link-toolbar`）。门的声明集分两次读：**写作时刻（01:44）** `dsh-link-toolbar` **还没进**（`SUBJECTS` 只有 3 行：panel / markdown / theme-settings），按 `docs/handoff/PLAN.md` 的 R191 段点名，加它是门 125 **后继作者**的活——**不是 P1 的、也不是本页的**（本页写范围只有本文件，`scripts/**` 一字未动）；**定稿复读（01:47）**那位作者的**在飞、未提交**改动已经把第 4 行加进去了（`{ name: 'dsh-link-toolbar', id: '4', … }`）⇒ **以 HEAD 为准今天仍是 3，以工作树为准是 4**。本页**不替那份在飞改动背书**（它可能再变、也可能在提交前被改回）。
- **本包无 glyph 槽**（如实登记，不是「已补全」）：`apply()` 注册的右栏 tab 类型 = 0、第一方 glyph 导入 = 0（唯一从第一方集导入的是菜单构件 `Menu`）、自绘 `<svg>` = 0 ⇒ §4.3 的「图标补全」在它身上仍是**待做**。
- **同一批事实的其它落点（本轮跟着改，具名）**：§〇 的一句、§2.2 的 `NS` 清单、§2.3 的实测行（顺带把 `dsh-link-panel` 的 19/19 对齐成 20/20——源码读数是 zh 20 / en 20，§4.2 的收口更正早就写了）、§4.2 的 census 行与「读法」、§4.5 的清单。**功能面一个字没动**（槽、`priority`、行表、`enabled`/`reason`/`value` 语义都不在本页的写范围里）。

**读数（今天的源码；工作目录 `dsh-link/`；命令原文照抄，逐条可复跑）**：

```
$ node -e "const s=require('node:fs').readFileSync('plugins/dsh-link-toolbar/src/client/locales.ts','utf8');const o=(n)=>((s.split(n)[1]||'').split('\n}')[0].match(/'[^']+':/g)||[]).length;console.log('zh',o('export const zh = {'));console.log('en',o('export const en: Record<ToolbarCopyKey, string> = {'))"
zh 12
en 12
$ node -e "for (const l of require('node:fs').readFileSync('plugins/dsh-link-toolbar/src/client/index.tsx','utf8').split(/\r?\n/)) if (l.includes('export const inject')) console.log(l.trim())"
export const inject = ['slots', 'locale']
$ node -e "const fs=require('node:fs'),p=require('node:path');const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);const hits=['src','lib'].flatMap(d=>walk(p.join('plugins/dsh-link-toolbar',d))).flatMap(f=>fs.readFileSync(f,'utf8').split(/\r?\n/).filter(l=>/ToolbarLocale|export function text\(/.test(l)).map(l=>f+': '+l.trim()));console.log('hits',hits.length);hits.forEach(h=>console.log(h))"
hits 0
```

## 五、与既有门的交界（★ 不许弄红它们）

本轮的写范围里，**只有新页 + 客户端半自己的文案**，所以下面三条是硬边界（我一个字都没碰）：

| 门 | 冻结什么 | 我的动作 |
|---|---|---|
| **门 122** `client-plugin-live-rows`（live） | 活页面里 `globalThis.__dshLinkMarkdown` 的形状：`kind`/`patterns`/`registered` **逐字段冻结**，且**多一个键就红**（`const extra = Object.keys(value).filter((key) => ['kind', 'patterns', 'registered'].includes(key) === false)`） | 不碰 `plugins/dsh-link-markdown/src/client/register.ts` 的标记形状；本页只在 §2 引它 |
| **门 124** `panel-live`（live） | 标记的 `items` 与 `notes.limits` 和**真路由**的回答**逐字节相同**；`items[].title` 是**宿主数据** | 不碰 `view.ts` 的 `markerFrom`、不碰 `items` 的来源、不翻译任何宿主数据 |
| **门 21** `build`（offline） | `node plugins/build.mjs --check`：`lib/` 与一次新构建**逐字节相同** | 只改 `src/**` 的包必须重跑它（P1/P2 的活）。**我跑它的读数（00:5x）：exit 1，唯一红的是 `stale: dsh-link-panel/lib/client.js`**——那是 P1 正在接线时的中间态，**不是我弄红的**（我的写范围只有本页） |

**我跑了什么、没跑什么（点名）**：

- **跑了**：`node scripts/check-protocol-page.mjs --page docs/dev/client-copy-and-icons.md`（本页的验收 ⇒ `88 of 88`、exit 0）、`node plugins/build.mjs --check`（离线 ⇒ **exit 1**，唯一红是 P1 的 `lib/client.js` 落后，见上表）。
- **没跑、为什么（具名）**：① **整套 `verify-all.mjs`** —— 纪律禁止（跑一次就是全部，且含 live 门）；② **门 122 `client-plugin-live-rows`** 与 **门 124 `panel-live`** —— 都是 **live** 门（要 31761/31760/9222 + 独占 + 只读求值），本页全程离线 ⇒ 由 Lead 兜底跑；③ **门 123 `notes-route`（offline）** —— 它读的是便条路由，与本轮写范围无交集，我没有跑它；④ **门 121 `client-plugin-mount`（offline）** —— 同理没跑（我没改装载链）；⑤ **`doc-citations`** —— 它的默认文档清单是三份硬编码文档，本页**不在其中**（所以它的绿不构成本页的绿，本页的绿只有上面那条 `--page` 命令能给）。

### 5.1 收尾读数（我这一轮的验收，逐条命令原文）

| # | 命令 | 读数 |
|---|---|---|
| 1 | `node scripts/check-protocol-page.mjs --page docs/dev/client-copy-and-icons.md` | `93 of 93 citation(s) hold`、`exit 0` |
| 2 | 成对反证（三条突变，各自必红） | ① **needle 改成不再是子串**（本页就地改一处 needle）⇒ `92 of 93`、exit 1，红的就是那一行；**逐字节改回** ⇒ sha256 `6673f2ac…045a` 与改前**一致**、`93 of 93`、exit 0。② **表格里的行号 +1**（副本）⇒ `92 of 93`、exit 1（`line 381 does not contain …`）。③ **`path#text` 的名字不唯一**（副本 + scratch 里放两行同一文本）⇒ `92 of 93`、exit 1（`appears on 2 lines`） |
| 3 | `node plugins/build.mjs --check` | **exit 1**：`stale: dsh-link-panel/lib/client.js`——P1 正在接线的中间态，**不是我弄红的**（本页是文档，不进任何构建） |
| 4 | `git status --porcelain` | 我这一轮**只新增** `?? dsh-link/docs/dev/client-copy-and-icons.md`；其余条目是 P1/P2 在飞的包（`dsh-link-markdown/**`、`dsh-link-panel/**`）与一条**我进来之前就在**的 ` M cef-probe/tauri-runtime-cef` |
| 5 | 本页的字节与哈希（**时刻读数**：这张表自己也会改字节） | 反证往返那一版 = `40643 B` / sha256 `6673F2ACE0F51F94CFD8E559079F7C4B153BC961A9D24A9A1BCD5A7D34B1045A`；要拿**当前**字节的确定性身份，跑 `git hash-object docs/dev/client-copy-and-icons.md`（只读，不写 git） |

**我亲手造的红（点名列全）**：① 上面第 2 条的三条突变——**全部只在副本或「改了又逐字节改回」**，树上的本页回到原字节；② **没有第三种**：我没跑整套 `verify-all.mjs`、没碰内核、没碰别人的包/门、没做 git 写操作。

### 5.2 R191 P1 后的重锚读数（重锚者：R191 契约页维护者；写作时刻 2026-10-12 01:44）

§5.1 是 R190 收口时刻的读数（那时 `93 of 93`）。本页动过就得按「谁再动谁重测」重测，本节是重锚后的读数（命令原文照抄；**全程没有 git 写操作**）：

| # | 命令 | 读数 |
|---|---|---|
| 1 | `node scripts/check-protocol-page.mjs --page docs/dev/client-copy-and-icons.md` | 重锚**前**：`91 of 93 citation(s) hold`、exit 1（红的就是 §4.6 那两条旧针）；重锚**后**：**97 of 97 citation(s) hold**、**exit 0** |
| 2 | 成对反证：两条新针**就地**各改到一个不再是子串的文本 ⇒ 必红；**逐字节**改回 ⇒ sha 一致 | 改坏后：`95 of 97 citation(s) hold`、exit 1（FAIL 的正是 `toolbar-register-dictionaries` 与 `toolbar-inject-declares-locale`，判词 `the file no longer contains …`）；改回后：`97 of 97`、exit 0，sha256 往返 `A95CE8D6…A1995`（改前 = 改回后，**逐字节一致**，全串见下第 5 行） |
| 3 | `node plugins/build.mjs --check`（**为什么没跑**） | 本页是文档、不进任何构建；`dsh-link-toolbar/lib/client.js` 的重构建是 P1 的活——本轮 `git status` 里它是**在飞的 P1 改动**，不是我弄的 |
| 4 | `git status --porcelain` | **我改的只有本页**（` M dsh-link/docs/dev/client-copy-and-icons.md`）；其余条目都是别人的在飞改动（`dsh-link-toolbar/**`、`scripts/verify-panel-render.mjs`、**定稿时出现的** `scripts/verify-client-copy-and-icons.mjs`——门 125 后继作者正在把第 4 个包加进声明集）与**我进来之前就在**的 ` M cef-probe/tauri-runtime-cef` |
| 5 | 本页字节与哈希（时刻读数：这张表自己也会改字节） | 填表前那一版 = `52025 B` / sha256 `A95CE8D6A60DA6AE7B318C7D8A562A86F9991DDD528D417FF0A805279A1A1995`；要拿**当前**字节的确定性身份，跑 `git hash-object docs/dev/client-copy-and-icons.md`（只读，不写 git） |

**我亲手造的红（点名列全）**：只有上表第 2 条那一对——**只在「就地改坏又逐字节改回」的往返里**，树上的本页回到原字节；没跑整套 `verify-all.mjs`、没碰内核、没碰 `plugins/**`、没碰 `scripts/**`、没做 git 写操作。

改坏那一刻核对器的原文（贴红的两行与汇总）：

```
  FAIL  toolbar-register-dictionaries  plugins/dsh-link-toolbar/src/client/index.tsx#ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: translation tables')  |  the file no longer contains "ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: translation tables')"
  FAIL  toolbar-inject-declares-locale  plugins/dsh-link-toolbar/src/client/index.tsx#export const inject = ['slots', 'locale', 'toolbar']  |  the file no longer contains "export const inject = ['slots', 'locale', 'toolbar']"
95 of 97 citation(s) hold
```


## 六、这份页面的引文（机器核对，别只信人眼）

下面这张表是本页的**判据表**：每条规则钉到**真实存在的** `path:line`（pin 住的内核，行号会漂是设计）或 `path#text`（会动的 `plugins/**`、门、记档；那段文本必须在全文**恰好出现一次**）与该处**必须含有的**文本上。核对器：

```
node scripts/check-protocol-page.mjs --page docs/dev/client-copy-and-icons.md
```

⚠ 两条边界（照 R186/R188/R189 踩过的坑写）：① 分片判定是**子串包含**（`scripts/check-protocol-page.mjs:97`）⇒ 把 needle 改成真文本的**前缀**照样绿，做反证必须改到**不再是子串**、或让它**不再唯一**；② 核对器**看不见被整行删掉的引用**（`:135` 的注释自己承认），覆盖由跑它的那道门负责——本页今天**没有门**打开它（只有上面那条命令）。

<!-- citations -- checked by scripts/check-protocol-page.mjs --page docs/dev/client-copy-and-icons.md; plugins/** and scripts/verify-all.mjs are self-healing path#text on purpose (they move this round) -->
| id | where | must contain |
|---|---|---|
| checker-self-healing-exactly-once | scripts/check-protocol-page.mjs:73 | EXACTLY ONCE ; self-healing |
| checker-fragments-substrings | scripts/check-protocol-page.mjs:97 | !text.includes(flat(fragment)) |
| checker-removed-row-blind | scripts/check-protocol-page.mjs:135 | a removed row is NOT caught here |
| kernel-pin-note | kernel.lock.json:2 | pinned upstream checkout ; never edited ; verify-baseline.mjs refuses |
| gate-baseline-registered | scripts/verify-all.mjs#name: 'baseline', kind: 'offline' | - |
| build-registered | scripts/verify-all.mjs#name: 'build', kind: 'offline' | plugins/build.mjs ; --check |
| gate-122-registered | scripts/verify-all.mjs#name: 'client-plugin-live-rows', kind: 'live' | - |
| gate-124-registered | scripts/verify-all.mjs#name: 'panel-live', kind: 'live' | - |
| locale-single-occupant-doc | core/deepseek-harness/packages/client/locale/src/client/index.ts:382 | Duplicate (ns, locale) throws ; single occupant |
| locale-single-occupant-owner | core/deepseek-harness/packages/client/locale/src/client/index.ts:383 | one owner |
| locale-single-occupant-throw | core/deepseek-harness/packages/client/locale/src/client/index.ts:417 | already has locale |
| locale-typed-overload | core/deepseek-harness/packages/client/locale/src/client/index.ts:389 | Record<BuiltInLocaleId, LocaleDictOf<N>> |
| locale-common-occupied | core/deepseek-harness/packages/client/locale/src/client/index.ts:579 | locale.register(COMMON_NS, { zh, en }) |
| locale-settings-occupied | core/deepseek-harness/packages/client/locale/src/client/index.ts:580 | locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn }) |
| precedent-deliverables-import | core/deepseek-harness/packages/client/ui-deliverables/src/client/index.ts:30 | import { en, NS, zh, type DeliverablesKey } |
| precedent-deliverables-nsmap | core/deepseek-harness/packages/client/ui-deliverables/src/client/index.ts:38 | 'deliverables': DeliverablesKey |
| precedent-deliverables-register | core/deepseek-harness/packages/client/ui-deliverables/src/client/index.ts:60 | ctx.locale.register(NS, { zh, en }) ; ui-deliverables: dictionaries |
| precedent-sidebar-bind | core/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:109 | const t = ctx.locale.bind(NS) |
| precedent-sidebar-register | core/deepseek-harness/packages/client/ui-sidebar-right/src/client/index.ts:162 | ctx.locale.register(NS, { zh, en }) ; ui-sidebar-right: dictionaries |
| slot-declaration-is-claim | core/deepseek-harness/packages/client/ui-slots/README.md:46 | Declaring a slot is claiming it |
| slot-keyed-second-registration-throws | core/deepseek-harness/packages/client/ui-slots/src/index.ts:1225 | already has an entry for key |
| tab-definition-has-no-icon | core/deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:94 | export interface SidebarRightTabDefinition |
| tab-guide-icon-field | core/deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:82 | readonly icon?: ComponentType<IconProps> |
| tab-title-is-thunk | core/deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:136 | readonly title: (address: string) => string |
| tab-thunked-copy-reread | core/deepseek-harness/packages/client/ui-sidebar-right/src/client/tab-registry.ts:24 | Thunked copy ; read again |
| icon-stroke-regular | core/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:22 | export const ICON_REGULAR_STROKE = 1 |
| icon-stroke-medium | core/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:25 | export const ICON_MEDIUM_STROKE = 1.3 |
| icon-naming-example | core/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:28 | export const IconNewChatOutlineRegular |
| icon-default-size-16 | core/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:37 | size = 16 ; WeightedIconProps |
| icon-canvas | core/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:38 | viewBox="0 0 16 16" ; fill="none" |
| icon-color-is-current-color | core/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx:39 | stroke="currentColor" |
| icon-props-size-classname | core/deepseek-harness/packages/client/ui-primitives/src/icons/props.ts:2 | export interface IconProps { |
| icon-props-current-color | core/deepseek-harness/packages/client/ui-primitives/src/icons/props.ts:5 | currentColor |
| icon-set-reexported | core/deepseek-harness/packages/client/ui-primitives/src/index.ts:109 | export * from './icons/index.tsx' |
| permission-icon-family | core/deepseek-harness/packages/client/ui-primitives/src/PermissionIcon.tsx:45 | export function PermissionIconReadOnlyRegular |
| platform-preloads-primitives | core/deepseek-harness/packages/client/web/src/platform.ts:12 | '@deepseek-ai/dsh-client-ui-primitives' |
| host-modules-baseline | compat/host-modules.json#"@deepseek-ai/dsh-client-ui-primitives", | - |
| plugins-readme-baseline | plugins/README.md#ui-primitives | - |
| brand-icon-is-36 | core/deepseek-harness/packages/experimental/auto-review/icon.svg:1 | width="36" height="36" |
| brand-icon-gradient | core/deepseek-harness/packages/experimental/auto-review/icon.svg:8 | stop-color="#7AC2FF" |
| auto-label-zh-same-bytes | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:53 | 'auto.label': 'Auto review' |
| auto-badge-zh-same-bytes | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:54 | 'auto.badge': 'EXP' |
| auto-label-en-same-bytes | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:77 | 'auto.label': 'Auto review' |
| auto-badge-en-same-bytes | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:78 | 'auto.badge': 'EXP' |
| permission-namespace | core/deepseek-harness/packages/client/ui-permission-presets/src/client/locales.ts:4 | PERMISSION_ACCESS_NS = 'permission.access' |
| permission-namespace-registered | core/deepseek-harness/packages/client/ui-permission-presets/src/client/index.ts:117 | ctx.locale.register(PERMISSION_ACCESS_NS |
| permission-glyphs-map | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:28 | const permissionGlyphs = new Map<string, ReactNode>([ |
| permission-glyph-get-none | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:34 | names outside the design set get none |
| permission-glyph-current-color | core/deepseek-harness/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx:25 | follow currentColor |
| permission-auto-is-auto | core/deepseek-harness/packages/client/ui-permission-presets/src/client/presentation.ts:7 | AUTO_REVIEW_PRESET = 'auto' |
| rule-kernel-untouched | docs/handoff/R190-contract.md#**内核侧**：不改。 | 保持具名欠账 |
| rule-product-bind-register | docs/handoff/R190-contract.md#**文案**：一律经 `ctx.locale` 命名空间 | ctx.locale.bind(NS) |
| rule-icon-measured | docs/handoff/R190-contract.md#**16×16、`currentColor`（深浅自适应）、描边 1 或 1.3、与现有构件同一构图语言** | 16×16 |
| rule-no-brand-color-glyph | docs/handoff/R190-contract.md#**不许**把品牌色件（36×36、带渐变/固定色）放进 glyph 槽 | 36×36 |
| rule-coverage-is-not-green | docs/handoff/R190-contract.md#**覆盖率不是绿** | 如实点名 |
| rule-identical-values | docs/handoff/R190-contract.md#**不许**为了让字典「看起来完整」而复制英文进 zh | 要么是因为那本来就是标识符/单位 |
| plan-p1-sixteen-copy | docs/handoff/PLAN.md#16 条用户文案 → zh/en 字典 + 标签页图标 | 16 条 |
| r186-19-candidates | docs/dev/notes-ledger.md#共比较 **1047 个 zh 键** | 19 个键 |
| r186-candidate-boundary | docs/dev/notes-ledger.md#可机械发现的候选 | 不是「已确认的漏译」 |
| r186-glyph-private | docs/dev/notes-ledger.md#起的 `const permissionGlyphs = new Map(...)` | 没有任何注入缝 |
| gate122-frozen-marker | scripts/verify-client-plugin-live-rows.mjs#globalThis.__dshLinkMarkdown === { kind:'markdown', patterns:['*.md','*.markdown'], | kind:'markdown' |
| gate122-extra-keys-red | scripts/verify-client-plugin-live-rows.mjs#const extra = Object.keys(value).filter((key) => ['kind', 'patterns', 'registered'].includes(key) === false) | - |
| gate124-marker-shape | scripts/verify-panel-live.mjs#globalThis.__dshLinkPanel = { mounted: true, tabId: 'dsh-link-panel', items: [...], | - |
| gate124-byte-compare | scripts/verify-panel-live.mjs#the marker's items equal the route's declared.visible row by row and byte by byte, | byte by byte |
| gate124-limits-byte | scripts/verify-panel-live.mjs#the marker's notes.limits equals the notes route's limits byte by byte | byte by byte |
| panel-ns | plugins/dsh-link-panel/src/client/locales.ts#export const NS = 'dsh-link-panel' | - |
| panel-zh-keyset-source | plugins/dsh-link-panel/src/client/locales.ts#export const zh = { | - |
| panel-en-keyset-typed | plugins/dsh-link-panel/src/client/locales.ts#export type PanelCopyKey = keyof typeof zh | PanelCopyKey |
| panel-client-half-declared | plugins/dsh-link-panel/package.json#"platform": "web" | web |
| panel-marker-key | plugins/dsh-link-panel/src/client/register.ts#export const MARKER_KEY = '__dshLinkPanel' | - |
| panel-register-dictionaries | plugins/dsh-link-panel/src/client/index.tsx#ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-panel: dictionaries') | - |
| panel-bind-translate | plugins/dsh-link-panel/src/client/index.tsx#const t = ctx.locale.bind(NS) | - |
| panel-guide-icon-first-party | plugins/dsh-link-panel/src/client/index.tsx#import { IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives' | - |
| panel-guide-icon-constant | plugins/dsh-link-panel/src/client/index.tsx#const PANEL_GUIDE_ICON = IconFlatListOutlineRegular | - |
| panel-tab-body-declares-locale | plugins/dsh-link-panel/src/client/register.ts#locale: NS, | - |
| markdown-ns | plugins/dsh-link-markdown/src/client/locales.ts#export const NS = 'dsh-link-markdown' | - |
| markdown-en-keyset | plugins/dsh-link-markdown/src/client/locales.ts#} satisfies Record<MarkdownKey, string> | MarkdownKey |
| markdown-register-dictionaries | plugins/dsh-link-markdown/src/client/index.tsx#ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-markdown: dictionaries') | - |
| markdown-filetype-icon | plugins/dsh-link-markdown/src/client/index.tsx#<FileTypeIcon kind="markdown" size={16} className="dsh-link-markdown-title-icon" /> | size={16} |
| markdown-keep-verbatim | plugins/dsh-link-markdown/test/keep-verbatim.json#"note": "The English that stays English in the browser half, one entry per literal | - |
| markdown-client-half-declared | plugins/dsh-link-markdown/package.json#./lib/client.js | lib/client.js |
| theme-settings-register | plugins/dsh-theme-settings/src/client/index.tsx#ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'dsh-theme-settings: section dictionaries') | - |
| theme-settings-bind | plugins/dsh-theme-settings/src/client/index.tsx#const t = ctx.locale.bind(SETTINGS_NS) | - |
| theme-settings-en-keyset | plugins/dsh-theme-settings/src/client/locales.ts#} satisfies Record<ThemeKey, string> | ThemeKey |
| toolbar-ns | plugins/dsh-link-toolbar/src/client/locales.ts#export const NS = 'dsh-link-toolbar' | - |
| toolbar-zh-keyset-source | plugins/dsh-link-toolbar/src/client/locales.ts#export const zh = { | - |
| toolbar-en-keyset-typed | plugins/dsh-link-toolbar/src/client/locales.ts#export const en: Record<ToolbarCopyKey, string> = { | ToolbarCopyKey |
| toolbar-register-dictionaries | plugins/dsh-link-toolbar/src/client/index.tsx#ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: dictionaries') | - |
| toolbar-inject-declares-locale | plugins/dsh-link-toolbar/src/client/index.tsx#export const inject = ['slots', 'locale'] | - |
| toolbar-seat-declares-locale | plugins/dsh-link-toolbar/src/client/index.tsx#locale: NS } | - |
| browser-icon-probe-misses | plugins/dsh-browser/lib/client.js#const Icon = primitives && (primitives.IconGlobe16 | IconBrowser16 ; IconWindow16 |
| lan-bridge-hand-rolled-pick | plugins/dsh-lan-bridge/lib/client.js#function pick(zh, en) { return isEnglish() ? en : zh } | - |
| lan-bridge-icon-probe-misses | plugins/dsh-lan-bridge/lib/client.js#const Icon = primitivesExport("IconLinkOutline16") | - |
| teams-icon-probe-hits | plugins/dsh-link-teams/lib/client.js#primitives.IconUsersOutlineRegular | - |
| brand-mark-own-svg | plugins/dsh-link-brand/src/client/marks.tsx#viewBox="0 0 96 96" | - |
| continue-button-hard-coded | plugins/dsh-continue-button/src/client/index.tsx#const PROMPT_TEXT = '继续' | - |
| liquid-glass-no-dictionary | plugins/dsh-liquid-glass/src/client/index.ts#export function apply(ctx: ClientContext): void { | - |
<!-- /citations -->
