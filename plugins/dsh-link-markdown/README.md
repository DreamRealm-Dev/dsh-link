# dsh-link-markdown

右栏（Sidebar Right）的一个新标签类型 `markdown`：渲染工作区里的 `.md` / `.markdown` 文件，并**可原地编辑后保存**（R352 起有编辑，R377 起第一次被真点通：读、改、存、回读全链路有活体门 377）。

## 它是什么

- **一个包，两半**。host 半（`src/index.ts`）只有 loader 行和 claim 判定的再导出；真正的活在浏览器半（`src/client/index.tsx`）：把类型注册进 `ctx.sidebarRightTabs`，把 body 注入 keyed slot `sidebar.right.pane.tab`、chip 文本注入 `sidebar.right.pane.tab.title`，三者同用定义 `id` = `dsh-link-markdown`。
- **布局与样式**：`src/client/markdown.css` 是本包唯一的一张表（R480）。shell 给每个 tab body 的 `.tabBody` 是 `display:flex; column; height:100%; min-height:0; overflow:hidden`——面板自己不滚、也不给边距，文档就会被裁掉、字贴到栏边。这张表让根节点接管高度、head 固定、文档区 `overflow:auto` + 18px 边距，编辑区同构；色值/字号只用 `--dsw-*` 令牌。它通过 `apply()` 里的一条 `ctx.effect` 挂成插件独占的 `<style>`（与 `dsh-link-toolbar`/`dsh-link-teams` 同一惯用式，宿主没有 `styles` 服务）。
- **渲染复用内核**：公式与代码高亮不自己造。body 用 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`（内核渲染助手回复用的同一条 mdast→React 管线，TeX 走 KaTeX、围栏代码走 Shiki）。这个库在 web shell 预加载的模块表里（`compat/host-modules.json` 的 `clientBaseline`），所以本包**零第三方依赖**，`lib/client.js` 里也没有第二份渲染器。
- **内容读取**：元数据来自标准 `useResource(address)`（`file` provider），文本通过注入的 face 调 `remote.workspaceFiles.read` **分页**读到底（`src/client/read.ts`：offset 累加、`eof` 收口、0 行且非 eof ⇒ 具名 `page-made-no-progress` 停下而不是空转）。第三参数是内核声明的 `WorkspaceFileRange` **对象**（`{ offset }`），不是一个行号 —— R377 之前这里是行号，活页面在 wire 边界上就拒了（`wire field "range" failed boundary validation`），而假 reader 什么都收，所以三条离地门全绿。`test/markdown-view.spec.mjs` 的第 16b 条现在把这个形状钉在**内核自己生成的** `typert.remote-client.d.ts` 上。
- **claim 判定是纯函数**（`src/client/claim.ts`）：`patterns = ['*.md','*.markdown']`、`priority = 'extension'`、`canOpen` 只认 `dsh-resource://file/session/…` 且扩展名是 `.md`/`.markdown`。

## 文案契约与图标来源

### 文案：一个命名空间、两份字典、键集相同

- **命名空间** = `dsh-link-markdown`（`src/client/locales.ts` 的 `NS`），按包唯一。注册形状照内核先例（`ui-deliverables`／`ui-sidebar-right`／`dsh-theme-settings`）：`inject` 里加 `'locale'`，`apply` 里 `ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-markdown: dictionaries')`。
- **键集相同**：`zh` 是键集真源，`en` 用 `satisfies Record<MarkdownKey, string>` 钉住同一集合 —— 少一个键或多一个键都是编译错误。**同一 `(ns, locale)` 再注册会抛**（内核 `LocaleRuntime.register` 的单一占用），所以这个名字归本包独占，别的包不许用。
- **组件不写句子，只拿键**：body 的注册带 `locale: NS`，渲染器据此把标准的 `t` 座位注进 props（`ui-renderer/scoped-slots.tsx`）；标题注册**不带** `locale` —— 它的文本是文件名，没有可翻译的字（见下面的保留清单）。
- **22 个键**：`body.readonly`（头行的只读标记）、`body.edit`/`body.preview`（编辑与预览的切换）、`body.save`/`body.saved`/`body.dirty`/`body.saveHint`/`body.savedHint`/`body.stale`/`body.refused`（保存这一组：按钮、脏标记、三种结局）、`empty.noAddress`（标签没有地址时的空态）、`failure.reason.*` 九条（失败页的人名）、`markdown.copy` / `markdown.copied` / `markdown.footnotes`（转发给内核 `MarkdownText` 的 chrome 标签与复制反馈）。**不传 `toolbarLabels`**：那是"让内核接管换行偏好"的开关（`CodeBlock.tsx` 只在给了它时才画代码卡与换行按钮），本包不引入这个控件，也就不留内核的英文默认。
- **失败页 = 本地化的人名 + `code: message` 原样**：`code` 是标识符（`not-a-dsh-resource-file-address`、`page-made-no-progress`、远程的 `workspace-file/not-found` …），`message` 是带数据的诊断行。映射是纯函数（`src/client/failure.ts`），认得的 code 有九条，认不得的保留 code 原文并给人名 `failure.reason.unreadable`。

### 保留英文的清单（每条都能被扫到，理由逐条在 `test/keep-verbatim.json`）

| id | 是什么 | 为什么保留 |
|---|---|---|
| `kv-claim-detail-not-file` | `claim.ts` 的 `not a dsh-resource://file/ address: …` | 诊断行，带上被拒的那个地址；人名是 `failure.reason.notFileAddress` |
| `kv-claim-detail-malformed-id` | `claim.ts` 的 `session address without an id or a path: …` | 同上，人名 `failure.reason.malformed` |
| `kv-claim-detail-malformed-escape` | `claim.ts` 的 `address segment is not validly encoded: …` | 同上（URI 转义解析器的原话） |
| `kv-claim-detail-absolute` | `claim.ts` 的 `an absolute file address carries no Session to read through: …` | 同上，人名 `failure.reason.absoluteScope` |
| `kv-claim-detail-scope` | `claim.ts` 的 `unknown file address scope "…": …` | 同上，人名 `failure.reason.unknownScope` |
| `kv-read-detail-no-progress` | `read.ts` 的 `offset N returned 0 lines without eof` | 同上，人名 `failure.reason.noProgress` |
| `kv-register-effect-labels` | `register.ts` 的三条 `ctx.effect` 标签 | 开发面标识（日志与门 121 读），从不渲染 |
| `kv-index-effect-label` | `index.tsx` 的两条 `dsh-link-markdown: …` effect 标签（dictionaries / R480 的 pane stylesheet） | 同上 |


另外两类**不是字符串字面量**，所以不进上面这份表，但也在这里点名，免得被读成"漏了"：

- **文件名与地址**（chip 文本、头行路径、`title=` 悬停）：用户自己的数据，逐字节照显。
- **代码标识符**：`kind`/`patterns`/slot 名/CSS 类名/marker 键 `__dshLinkMarkdown`/失败码本身 —— 都是要逐字节对上的名字，不是文案。

### 图标

- **chip 图标用第一方件**：`FileTypeIcon kind="markdown" size={16}`，来自 `@deepseek-ai/dsh-client-ui-primitives`（web shell 预载的基线模块，`MarkdownText` 也来自它）。理由：**同一个 chip 座位**上，内核自己的三个 tab 类型都这么画 —— `ui-sidebar-files` 的 `FilesTitle.tsx:21`、`ui-sidebar-documentpreview` 的 `TextTitle.tsx:20`、`ui-plan` 的 `PlanPreview.tsx:53`（都是 `FileTypeIcon` + `size={16}`）；而本类型正是从 `text` 类型手里接走 `.md` 地址的**扩展档竞争者**，同一个文件保持同一枚文件图纸最不冗余。
- **为什么不自绘**：`ui-primitives/src/icons/index.tsx` 有 188 个 `Icon*` 导出（另加 `SHIELD_OUTLINE_PATH` 与两个描边常量），里面没有"文档/文件"这一族（`IconDeliverDocRegular` 是交付文档，语义不同）；自绘就必须满足 **16×16 / `currentColor` / 描边 1 或 1.3**，而 chip 座位的既有构图语言是文件图纸，自绘反而更不统一。
- **深浅适配**：文件图纸的颜色来自 `--dsw-static-*` 令牌（`FileTypeIcon.module.css` 的 `.markdown` 档，可用 `--dsh-file-type-icon-color` 覆盖），随主题走；只有自绘件才必须靠 `currentColor`。
- 本包**不引用任何品牌资产**（无 png/svg 图片、无渐变、无 36×36 件），自检会扫这一条。

## 已知边界（本轮具名不做 / 具名拒绝）

- **保存只有一条窄路**（`POST /api/dsh-link-markdown/write`，`src/index.ts` 的 `createWriteHandler`）：只 POST、只一个 JSON、上限 2 MiB、路径必须绝对且**文件已存在**（这条路由从不创建文件）。新鲜度用的是**内核自己的**事实，不是本包算的指纹：`expectedVersion` 就是 `workspaceFiles/read` 返回的那个不透明 `FsVersion`，写用内核 `fs` 服务的 `writeText(target, text, { kind: 'replaceIfVersion', version })` —— 原子、且在同一把 per-target 锁下再比一次版本。R377 之前这里本地算 `<mtimeMs>-<size>`，与内核令牌是两套词汇，于是**每一次保存都被判成 stale**（实测：文件没变也一样）。沙箱策略按**被保存的那个 Session** 解析（`sandboxPolicy.resolve({ session })`），所以 workspace-write 的边界就是该 Session 的 cwd —— 不传 session 时策略回落到进程根，实测会让内核在别的目录里 `EPERM` 建不出来临时目录。
- **mermaid（流程图）未引，读数是有了的**：MD 要求流程图，本包现在只把 ```mermaid 围栏当代码高亮显示。R384 把当初"先出读数再谈"的那两个读数取到了：
  - **许可**：mermaid 11.17.2，**MIT**（内核 checkout 里本来就有这份，随 website 的 VitePress 依赖进来，不在客户端模块表里）；
  - **体积**：`dist/mermaid.min.js` = **3.57 MB**（`mermaid.js` 8.25 MB，source map 13.3 MB）。
  这两个读数放在一起就变成一个权衡而不是一个任务：本包现在的 `lib/client.js` 是 **21 KB**，把 mermaid 打进去就是 **~170 倍**，而且**每次 shell 启动都要付**——客户端插件加载器只认一个 `lib/client.js`，没有懒加载分块的路径。所以它没有悄悄跳过，而是挂着等裁定：要么接受 3.57 MB 换流程图，要么维持"零第三方依赖、只做渲染管线复用"的现状。
- **不是 `.md`/`.markdown` 的地址一律不 claim**：`.txt`、无扩展名、`.mdx` 都不进这个类型。
- **不接管 builtin `text`**：`kind` 是 `markdown`，不是 `text`（`text` 是 Document Preview 的 fallback 所有者，R178-I:7 的裁定）。对 `.md` 地址，本类型是 extension band 的**路由竞争者**：它胜出时 Document Preview 退居备选，显式 `openResource(addr, { kind: 'text' })` 仍可打开原样。
- **`dsh-resource://file/absolute/` 地址不 claim**（具名拒绝：`absolute-scope-carries-no-session`）：这一 scope 不带 Session，而 `remote.workspaceFiles.read` 要靠 Session 解析工作区根 ⇒ 认了就会承诺一个读不出来的页面。
- **`dsh-resource://` 之外的 scheme 一律不放行**（具名拒绝：`not-a-dsh-resource-file-address`）；`dsh-resource://` 里非 `file` 的类型（如 `chat`）同样不认——pattern 不带 scheme 时匹配的是 URI 的 path，光靠 glob 会误伤，所以 `canOpen` 再挡一道。
- **无 backlink / outline / graph / 模板 / 双链**；CodeMirror 6 的所见即所得（Obsidian/HanaAgent 那套透明标记渲染）**未接**：编辑是纯 textarea，保存后由内核 `MarkdownText` 重新渲染（`docs/handoff/RESEARCH-EDITOR.md` 记了接法）。活体门是 `scripts/verify-markdown-live.mjs`（门 377），它自带前置条件：Session 工作区若落在 shell 内核写不进去的地方（父进程受限时会继承父进程的可写根），报具名第三态而不是把产品读红。
- **没有自己的 store / 不 keepMounted**：切走再切回会重新分页读一次；文件在磁盘上变了（resource 的 `version` 变了）会重读。

## 活体读数的两件事（给门 122）

1. 投递：活页面 `GET /` 的 preload 清单里应出现 `dsh-link-markdown/client.js`。
2. 活着：注册成功后挂只读标记 `globalThis.__dshLinkMarkdown = { kind: 'markdown', patterns: ['*.md','*.markdown'], registered: true }`；**注册失败不抛**，改挂 `{ registered: false, failed: '<错误原文>' }`；注册被撤下时挂 `{ registered: false, disposed: true }`。名字在清单里只证明投递，标记才证明它跑起来了。

> 本轮（R190）**没有改**这个标记的字段，也没有改 `kind`/`patterns`/`id`：门 122 读的还是同一份形状。

## 自检

```
node plugins/dsh-link-markdown/test/markdown-view.spec.mjs    # 33 条：claim、注册、标记、分页、文案、图标
node plugins/dsh-link-markdown/test/save-route.spec.mjs        # 9 条：保存路由的窄度与版本守卫
node plugins/dsh-link-markdown/test/save-rules.spec.mjs        # 11 条：什么时候可以编辑、什么算脏、拒绝怎么读
node scripts/verify-markdown-live.mjs                          # 10 条活体：右栏 → 页面类型菜单/引导 → 文件树 → 文件 → 编辑 → 保存 → 回读
```

前两条离线门读的是**已构建**产物（先 `node plugins/build.mjs`）；活体门要 shell 在跑（CDP 9222），并且它会在 Session 工作区里写一个 `dsh-link-editor-probe.md` 再删掉，不碰别的文件。

不需要浏览器、不需要 DSH，但**需要先构建**（`node plugins/build.mjs`）：第 25、29 条读的是已构建的 `lib/client.js`，不是源码。前 23 条是 claim 判定、注册形状、标记写入、失败路径不抛、分页累加与收口；
第 24–31 条是 R190 加的文案与图标读数：

- **24**：命名空间与键集（`zh`/`en` 同集合、每个键两边都有非空文本、两个 `satisfies` 守卫在源码里）。
- **25**：**真注册**——把内核自己的 `LocaleRuntime`（`core/deepseek-harness/packages/client/locale/lib/client.js`）装进一个只读 ctx，跑本包**已构建**的 `lib/client.js` 的 `apply()`，然后逐键取值：zh 全中、切到 en 也全中；顺带读回 `inject` 含 `'locale'`、body 注册带 `locale: NS`、标题注册不带、两条 `ctx.effect` 与两个座位都到位。
- **26**：单一占用（同 `(ns, locale)` 再注册抛，且错误里点名命名空间）与兜底（认不得的键原样返回键名）；顺带读回内置语言表的回退链。
- **27**：源码里没有硬编码文案——字典值逐字出现在代码里 ⇒ 红、带字母的 JSX 裸文本节点 ⇒ 红、`title`/`aria-label`/`alt`/`placeholder` 写成字面量 ⇒ 红；任何"看着像文案"的字面量必须在 `test/keep-verbatim.json` 里被点名，而每条点名又必须真覆盖到东西、必须写理由。
- **28**：每条 `t('…')` 的键都在两份字典里；每个字典键都在源码里被引用；九个具名失败码与 `claim.ts`+`read.ts` 声明的码集相等；认不得的码返回 `undefined`（由占位人名接手）。
- **29**：**已构建**产物里没有 `children: "…"` 这样的字面量、没有写死的 chrome 标签，五个文案键都在产物里被 `t()` 取。
- **30**：chip 图标来自第一方包且是 16px 的 markdown 文件图纸；源码里若有自绘 `<svg>`，必须满足 16×16 / `currentColor` / 不带固定色与渐变 / 不是 16 以外的尺寸；不引用品牌资产。
- **31**：活体门读的冻结形状在产物里没丢（marker 键、`kind`、`patterns`），README 有本节并且点名了每条保留英文。

**反证读数**（四条，全部在 `.tmp/p2-markdown/` 里对**包的副本**做，真树一个字节没动；做法是把整个包复制过去、改副本、再跑副本自己的 `test/markdown-view.spec.mjs`）：

| 突变（改副本） | 读数 |
|---|---|
| 两份字典都删掉 `markdown.copied`（组件还在 `t()` 它） | exit 1：**28** 红（`unknownKeys: ["markdown.copied"]`） |
| 只从 `en` 删掉 `markdown.copied` | exit 1：**24** 红（`keySetsEqual:false`）+ **25** 红（en 少一个键）+ **28** 红 |
| 把两个围栏标签写成 `'Copy'`/`'Copied'`（并重建副本产物） | exit 1：**27** 红（`index.tsx:97 writes a dictionary value into code`）+ **29** 红（产物里 `copyLabel` 绑的不是 `t()`） |
| 把 chip 件换成自绘 36×36 渐变色 svg | exit 1：**30** 红（不是 16px 的第一方图纸 + 自绘件带固定色/渐变/非 16 尺寸） |

脚本：`.tmp/p2-markdown/reverse-proof.mjs`（不随包提交；重建副本产物用 `.tmp/p2-markdown/build-markdown.mjs --package <副本目录>`，它与 `node plugins/build.mjs` 逐字节一致 —— 由 `node plugins/build.mjs --check` exit 0 持有）。
