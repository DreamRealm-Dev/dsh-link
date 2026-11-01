# dsh-link-toolbar

会话头部（conversation header）的一个动作项：一个 `DSH LINK` 触发器，加一个菜单。菜单的每一行来自一个**纯函数**（`src/client/toolbar-items.ts`），所以在没有浏览器的地方也能逐行重算。

## 它是什么

- **一个包，两半**。host 半（`src/index.ts`）只有 loader 行 + 把纯函数与标记表再导出（供门 `toolbar` 从已构建产物重算，R49 的既有偏差，见 `scripts/verify-toolbar.mjs` 读数 11）；真正的活在浏览器半（`src/client/index.tsx`）。
- **一个贡献**：`ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({...}, ToolbarAction))`，槽是内核 `ui-conversation` 声明的 `kind: 'list'` / `scope: 'session'`，`priority = 100`（升序列表：内核自己的动作在下面，上面留给后来的插件）。
- **三态诚实的行**：每个标记（`data-dsh-link-layout` / `-notes` / `-glass` / `data-dsh-browser`）只有三种结局 —— 有值（启用并显示该值）、缺属性（`not-mounted`）、属性为空串（`empty-value`，**不**与"缺"合并）。没有任何一行只是"看起来能点"。
- **菜单用内核的 `Menu`**（`@deepseek-ai/dsh-client-ui-primitives`，web shell 预载的基线模块）⇒ 本包**零第三方依赖**，也没有第二套浮层。
- **样式**：`toolbar.css` 以 `ctx.effect` 挂一个本插件独占的 `<style>`（没有 `styles` 服务可用，`dsh-link-brand` 同样做法）；颜色/圆角全走 `var(--dsw-*)` 令牌，无字面色值。

## 文案契约与图标来源

### 文案：一个命名空间、两份字典、键集相同

- **命名空间** = `dsh-link-toolbar`（`src/client/locales.ts` 的 `NS`），按包唯一。注册形状照内核先例（`ui-jobs` 在**同一个槽**上、`ui-deliverables`、`ui-sidebar-right`、`dsh-link-markdown`/`dsh-link-panel`）：`inject` 里加 `'locale'`，`apply` 里

  ```
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-toolbar: dictionaries')
  ```

  注册是 `ctx.effect` ⇒ 卸载时字典跟着走。**同一 `(ns, locale)` 再注册会抛**（内核 `LocaleRuntime.register` 的单一占用，抛错原文点名命名空间），所以这个名字归本包独占。
- **键集相同**：`zh` 是键集真源，`en` 写成 `Record<ToolbarCopyKey, string>`（`ToolbarCopyKey = keyof typeof zh`）——少一个键或多一个键都是编译错误。
- **组件不写句子，只拿键**：动作项的注册带 `locale: NS`，渲染器据此把标准 `t` 座位注进 props（`ui-renderer/scoped-slots.tsx`：`kit['t'] = localeSeat(face, entry.locale)`）；组件里每一个可见字都是 `t('…')`。
- **R191 之前是什么样**：本包用**私有字典** + `text(key, locale = 'zh')`，切语言不生效、`inject` 里没有 `locale`（R190 记档 §4.2 的 B 档）。R191 把这一半拉进内核 locale 服务，私有的 `text()`/`dictionaries`/`ToolbarLocale` **退役**（树里没有第二份文案通路）。

### 12 个键（zh / en 各 12 个值）

| 键 | zh | en | 谁在问 |
|---|---|---|---|
| `toolbar.open` | DSH LINK | DSH LINK | 触发器文字（**两份同值，见下**） |
| `toolbar.openHint` | 打开 DSH LINK 状态 | Open DSH LINK status | 触发器的 `title` |
| `toolbar.menu` | DSH LINK 状态 | DSH LINK status | **今天没人问**（见"已知边界"） |
| `toolbar.close` | 关闭 | Close | **今天没人问** |
| `item.layout` | 响应式档位 | Responsive band | 菜单行：`data-dsh-link-layout` |
| `item.notes` | 便条 | Notes | 菜单行：`data-dsh-link-notes` |
| `item.glass` | 玻璃皮肤 | Glass skin | 菜单行：`data-dsh-link-glass` |
| `item.browser` | 内置浏览器 | Built-in browser | 菜单行：`data-dsh-browser` |
| `reason.not-mounted` | 未装载 | Not mounted | 行没启用且**标记缺失**时的原因 |
| `reason.empty-value` | 已装载但未给值 | Mounted with no value | 行没启用且**标记是空串**时的原因 |
| `state.on` | 已就绪 | Ready | **今天没人问** |
| `state.off` | 不可用 | Unavailable | **今天没人问** |

行标签不是句子的来源：`toolbarItems` 返回的是 `labelKey`（`item.<id>`）与 `reason`（机器值），组件再把它翻成键 —— 也就是说**菜单能问到的每一个键**都在两份字典里，这一点由自检 T3 逐键重算（现在 8 个键被问到，4 个没被问到，见下）。

### 保留英文的清单（每条都能被扫到，理由逐条在 `test/keep-verbatim.json`）

| id | 是什么 | 为什么保留 |
|---|---|---|
| `kv-product-name` | 字典值 `toolbar.open` = `DSH LINK`（zh 与 en **逐字节相同**） | 按钮上就是**产品名**：它是标识符不是句子，两份同值是有意的（自检 T8 要求每一条 zh==en 的值都被这样点名） |
| `kv-effect-label-dictionaries` | `index.tsx` 的 `dsh-link-toolbar: dictionaries` | 注册字典的 `ctx.effect` 标签：日志/门的开发面标识，从不渲染 |
| `kv-effect-label-stylesheet` | `index.tsx` 的 `dsh-link-toolbar: entry stylesheet` | 同上：挂样式表的 `ctx.effect` 标签 |
| `kv-marker-attribute-layout` | `toolbar-items.ts` 的 `data-dsh-link-layout` | 标记属性名：别的半边写、本半边读的协议名字，逐字节对上才算读到 |
| `kv-marker-attribute-notes` | `toolbar-items.ts` 的 `data-dsh-link-notes` | 同上 |
| `kv-marker-attribute-glass` | `toolbar-items.ts` 的 `data-dsh-link-glass` | 同上 |
| `kv-marker-attribute-browser` | `toolbar-items.ts` 的 `data-dsh-browser` | 同上 |

另外三类**不是文案**，所以不进上面这份表，但也在这里点名，免得被读成"漏了"（自检 T5 会把 `src/client/**` 的**全部字面量**打出来，逐条附在这里的口径上）：

- **机器名字**：CSS 类名（`dsh-link-toolbar-button` …）、槽名 `conversation.session.header.actions`、服务名 `slots`/`locale`、`role="menuitem"`/`type="button"`、`tag.dataset.*` 的 `plugin`/`pluginCss`、`typeof … === 'undefined'` 探测串、`PLUGIN_ID` —— 都是要逐字节对上的名字。
- **协议值**：`MARKERS` 里的 `layout`/`notes`/`glass`/`browser`（同时是字典键的尾段）、`item.` 前缀、`not-mounted`/`empty-value`（`reason.*` 键的尾段）。断言机判据用判别式/稳定 id，从不判本地化文本。
- **宿主数据**：菜单行显示的那个值（`narrow`、`3`…）来自别的半边写在文档根上的属性，**逐字节照显，不译**。

### 图标

- **本包无 glyph 槽**（如实报，不是"已补全"）：本半边 `apply()` 注册的右栏 tab 类型 = **0**；`src/client/**` 里第一方 glyph 导入 = **0**、来自别处的 artwork 型导入 = **0**、自绘 `<svg>` = **0**（自检 T7 把这四个计数打出来，并把该读数具名判为 **NOT APPLICABLE**，不算绿）。
- 本包唯一从第一方集导入的件是 **`Menu`**（菜单面，不是图标）：门 125 的图标名判据（`/^(Icon|GuideArtwork|FileTypeIcon|…)/`）不把它算作 glyph。
- 如果哪天这里要装图标，规则是 R190 测量出来的那三条：**优先第一方集**（`@deepseek-ai/dsh-client-ui-primitives` 的 `Icon*`）、自绘件必须 **16×16**（`viewBox="0 0 16 16"`）、`currentColor`、描边 **1 或 1.3**、且不带固定色/渐变。T7 在"有 glyph"时会按同一套规则判红（`--self-attack` 的 `glyph-injected` 突变体演示的就是它从 n/a 翻成红）。

## 行为冻结（R191 只动文案的**来源**）

改造前后，**这一个动作项的形状逐项未动**：同一个槽 `conversation.session.header.actions`、同一个 `priority = 100`、同一个贡献数（1）、同一份行表与行序、同一套 `enabled`/`reason`/`value` 语义（`toolbar-items.ts` 与 `toolbar.css` 一个字节没改）。动的只有"字从哪来"：从私有 `text()` 改成座位上的 `t()`。

## 自检

```
node plugins/dsh-link-toolbar/test/toolbar-items.spec.mjs     # 既有的 6 条（行模型：三态、次序、确定性）
node plugins/dsh-link-toolbar/test/toolbar-copy.spec.mjs      # R191 的 8 条（T1–T8）
node plugins/dsh-link-toolbar/test/toolbar-copy.spec.mjs --self-attack
```

不需要浏览器、不需要 DSH，但**需要先构建**（`node plugins/build.mjs`）：T4/T6 读的是已构建的 `lib/client.js`。T1–T8 覆盖：

- **T1** 命名空间：字典模块的 `NS` 导出与注册点**两条通道**指向同一个（且只有这一个）名字。
- **T2** 两份字典：键集相同、值非空且不等于键名、`{name}` 占位符逐键一致。
- **T3** 文案面：这半边**能问到的每一个键**（静态 `t('…')`、菜单每行的 `labelKey`、每个可能的 `reason.*`）都在两份字典里；没人问的键以清单形式打印（**清单不是失败**）。
- **T4** 真注册：把内核**自己的**已构建 `LocaleRuntime`（`core/deepseek-harness/packages/client/locale/lib/client.js`）装上，跑本包**已构建**的 `lib/client.js`，读回它取的 `(NS, zh)`/`(NS, en)`、逐键在两种语言下取值、同对再注册被服务抛错（原文点名命名空间）、认不得的键原样返回键名。
- **T5** 半边里没有写死的文案：JSX 裸文本、被点名的属性白名单、copy 命名的成员、字典外的 CJK、**字典值写进代码**、读起来像句子的字面量 —— 每条命中都必须在 `test/keep-verbatim.json` 里被声明；清单本身的锚点也必须真的在树里。
- **T6** locale 接线：`inject` 含 `locale`、字典注册在带标签的 `ctx.effect` 里、那个唯一的贡献仍然进同一个槽/同一个 priority 且声明 `locale: NS`（`t` 座位就是这么来的）。
- **T7** 图标槽：量出来的四个计数；没有就具名 NOT APPLICABLE，有就按上面三条规则判。
- **T8** 保留英文：每一条 zh==en 的值都被 `key` 型清单条目点名并写明理由。

`--self-attack` 在 `.tmp/r191-p1/stage/**` 里对**包的副本**做 12 个突变（源码面 11 个 + 已构建产物 1 个），逐个打印「声明集 / 观测集 / exact」，并给覆盖矩阵：8 条读数每条都被至少一个突变体声明，**0 漏网**。

## 已知边界（本轮具名不做 / 具名怀疑）

- **4 个键今天没人问**：`toolbar.menu`、`toolbar.close`、`state.on`、`state.off` 是早期"自绘浮层 + 状态行"设计留下的字典条目（现在浮层交给内核 `Menu`，也没有状态行）。本轮**没有删**它们：删字典条目超出了"只动文案来源"的范围，而且它是产品面（翻译面）的取舍，不是本仪器的裁决。自检 T3 把它们当**清单**打印出来。
- **活体没验**：`dsh-link-toolbar` 的行**今天没挂载**（门 122/124 的阴性对照，R188-B-5；门 `toolbar` 读数 10 现场读回 `{"marker":false,"layout":false}` ⇒ SKIP）⇒ 活页面根本不加载本包的 `client.js`，所以"按钮上的字跟随语言切换"这件事**没有活体读数**，本轮只有源码面 + 已构建产物面。
- **`README.md` 没进 `package.json` 的 `files`**：本包是 `private`，发布面与运行面都不读它；要不要加进去（与本仓其它包一致）留给发布面那一轮，本轮不动 manifest。
- **渲染路径未读**：`t` 座位由渲染器按 `locale: NS` 注进 props（内核 `ui-renderer/scoped-slots.tsx`），本包只读到自己注册的 options 里带着它；"渲染器真的把 `t` 递进来了"这件事要活体才能读到。
- **R190 的页会出现两条漂移的针**：`docs/dev/client-copy-and-icons.md` 的 `toolbar-private-dictionary`（`export function text(...)`）与 `toolbar-inject-has-no-locale`（`export const inject = ['slots']`）锚在本轮退役的文本上 ⇒ `scripts/check-protocol-page.mjs --page docs/dev/client-copy-and-icons.md` 会变红。修法只能是"页跟着产品走"，而那页与门 125 的声明集都不在本轮写范围内（R190 §3 的同一课）。
