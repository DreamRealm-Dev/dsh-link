# 客户端半装载页（R188 P4）：三条装载前提 · 活页面清单怎么读 · 写作时刻的实数 · 挂了之后读什么

> 本页是 R188 的**接口冻结点**，冻结点来自 `docs/handoff/R188-contract.md` **§9「Lead 裁决（R188 开工令）」**（该节自述「凡与上文冲突处以本节为准」）。凡本页与 §0–§8 冲突，以 §9 为准。
> 写者 = R188 生产者 **P4**；**唯一写范围只有本文件**，scratch 在 `.tmp/r188-p4/**`。
> **全程离线**：没连活体端口 31761 / 31760 / 9222、没启停客户端、没跑整套 `verify-all.mjs`、没碰任何别人的门、没有 git 写操作。两处**只读**例外写在下面——不写清楚，下面的数字就不可信：
> ① 活档案 `%APPDATA%\dev.dshlink.client\dsh-link\kernel-home\profiles\web\**` 我**只读**读了（`package.json` 与 `node_modules` 的目录项），**一个字节都没改**；
> ② 本页所有「活页面清单」的读数都是**读来的**（来源逐条给到 `R188-contract.md`，页尾表里有行）——**P4 这一轮没有活体窗口，那条 `GET /` 不是我发的**。
>
> **引文口径（三种形式，分工是故意的）**
> - `core/deepseek-harness/**` 是 **pin 住的**内核（`kernel.lock.json`）⇒ 用 `path:line`。行号会漂**是设计**：内核一动就得有人来对齐，页不许悄悄过期。
> - `plugins/**` 与 `scripts/verify-all.mjs` **本轮就会动**（Lead 要往包表与门注册表里加行）⇒ **一律自愈形** `path#text`：那段文本必须在全文**恰好出现一次**才算一条引文。
> - 记档 `docs/handoff/R188-contract.md` 收口时还会被改 ⇒ 也用自愈形。**正文里的行号只作阅读辅助，判据是页尾那张表**（与 `docs/dev/notes-ledger.md` 同一口径）。

## 〇、一句话

「客户端半进了活页面」**不是**「构建里有 `lib/client.js`」，而是**三条前提同时成立**：①该包是**一条生效的 Loader 行**（名字能解析到本仓那个包）；②manifest 有 `dsh.client.platform = 'web'` **并且**有 `exports['./client']`；③那个 export 指到的文件**真的在**且在启动时被读进内存。

**写作时刻的实数**：本仓 **20** 个插件包里 **9** 个声明了客户端半，**只有 7 个真的在活页面清单里**（缺 `dsh-link-toolbar` / `dsh-link-responsive`）。⇒ **本页不许出现「客户端半已全部装载」这种话**；谁要写「全部」，先把 §三 的读数重跑一遍。

## 一、三条前提：每条读什么、缺了会怎样（具名）

| # | 前提 | 判据（读什么） | 内核依据（我自己逐行读的） | 缺了会怎样 |
|---|---|---|---|---|
| ① | **行被挂载** | 该包是一条**生效**的 Loader 行（`entry.fiber !== undefined` 且没被 `disabled`），且它的模块名**能解析到本仓那个包** | `core/deepseek-harness/packages/client/modules/src/index.ts:984`（活跃行过滤：`entry.fiber === undefined` 或 `entry.disabled` 直接跳过）、`:1016`（只有活跃行才 `resolveMeta`）；`core/deepseek-harness/packages/boot/app-boot/src/profile.ts:714`（名字解析不到就打 `cannot resolve profile bundle`） | 宿主半都不加载，更不会有 client 行。**R185 实测原文**：`skipping profile bundle … cannot resolve`（读来的；同一条也印证了「补上 `node_modules` 链接之后才挂上」） |
| ② | **manifest 声明** | `package.json` 的 `dsh.client.platform === 'web'`；且有 `exports['./client']`（字符串，或带字符串 `default` 的对象） | `client/modules/src/index.ts:836`（读 `pkg.dsh`）、`:837`（`parseDshClient`）、`:841`（`decl.platform !== 'web'` ⇒ 这个包**不算**客户端行）、`:845` + `:197`（取 `exports['./client']`）、`:847`；校验器在 `client/modules/src/client/manifest.ts:161` / `:167` | 没有 `dsh.client`、或平台不是 `web`：**静默**不作客户端行（不报错、不提示）；有 `dsh.client` 却没有 `exports['./client']`：**具名抛** `declares dsh.client but exports no "./client" bundle` |
| ③ | **`lib/client.js` 已构建** | manifest 那个 export 指到的文件真的存在、读得出来 | `client/modules/src/index.ts:850`（路径由 manifest 推出：`clientPath: join(dirname(pkgPath), clientRel)`）、`:962`（上树前 `readFileSync(clientPath)`）、`:966`（`ENOENT` ⇒ `MissingClientBundleError`）、`:92`（错误里原文指令 `run \`pnpm run build\` before launch`） | **具名抛**，并把**包名 + 绝对路径**一起打出来（`:103` 那句原文 `client bundle not found`），不是静默少一行 |

**前提①里最容易读错的一点：`dsh.profile.bundles` 不是行的唯一来源。** 活档案今天 `dependencies` **20** 项、`dsh.profile.bundles` **21** 条（我 2026-10-12 只读复读，读数见 §三），而 `dsh-browser` **在 `dependencies` 里、不在 `bundles` 里**，它的行由 `dsh-link-mods` 的 patch 声明（自愈锚 `plugins/dsh-link-mods/cordis.patch.yml#name: dsh-browser`）——它的客户端半今天**在**活页面清单里。⇒ 判「行有没有被挂载」要看**生效的 Loader 行**，别只数那一个数组。

**改活档案的那一步（不是 P4 的活）**：照 §9 R6，编辑 `profiles/web/package.json` **不许**用 `JSON.stringify` 重写（R185 把这份用户文档从 CRLF 拍成 LF：今天读它仍是 **2300 B / `crlf=0` / 53 行**——我实测，见 §三）；要**保行尾风格**地插入，并在 profile 的 `node_modules` 里补符号链接（R185 实测：只改声明没有链接 ⇒ `cannot resolve`）。

## 二、活页面清单怎么读（唯一一条零面板操作的活体读数）

**命令原文**（注意是 **http**，不是 https）：

```
GET http://127.0.0.1:31761/
```

响应 HTML 里有一段 `plugins/??<名字，逗号分隔>&rev=<hash>` 的 preload 表达式；**逐个名字就是「进了活页面的客户端半」**（每项形如 `<包名>/client.js`）。切它用的正则、以及「77 行」那次读数，原样记在 `docs/handoff/R188-contract.md` 附录 A-2（页尾表里的 `contract-live-list-*` 几行）。

**一条别人踩过、必须抄对的坑**：31761 上跑的是**明文 HTTP**；用 `https.request` 一条读数都拿不到（记档原文：`改成 http 才有`）。门 122 的作者别抄错。

**为什么这条读法安全**（读来的，出处同上）：`enforce_lease` 的调用点只在 `surface` / `mount` / `unmount` / `tab-*` / `mode` / `viewport` 那几个写口上，而 `GET /` 走的是壳自己的静态页路由，**不触碰其中任何一个**。⇒ 它不需要面板、不需要租约、不需要模型回合，是「有人在活体窗口里干活」时**唯一一种可以安全跑**的活体读数。

**这条读数判不了什么（第三态，具名）**：
- 它只证明**投递**——「行在清单里」；**不证明它跑起来了**（那是 §四 的第二个标记）；
- 它**不判** body 抛错（「行在而 body 抛错」本轮明确不判）；
- 它**不覆盖 P2**：`dsh-link-panel` 本轮是宿主半、**没有客户端半**（照抄 §9 R4 的原文口径「本条不覆盖 P2」）。

## 三、写作时刻的实数（2026-10-12 0x:xx；**不是恒值**）

**先记一条口径**：下面第 1、2 行是**读来的**（来源逐条给在页尾表里），第 3、4 行是我自己在这一分钟量的。**别把「读来的」写成「现状」。**

| # | 读数 | 来源 |
|---|---|---|
| 1 | 活页面清单 **77 个唯一 client 行**，其中 `dsh-*` **9 个** | 读来的（`R188-contract.md` 附录 A-2；规划者 2026-10-11 23:0x 的读数） |
| 2 | **我们的 7 个**：`dsh-liquid-glass`、`dsh-theme-settings`、`dsh-browser`、`dsh-link-teams`、`dsh-continue-button`、`dsh-link-brand`、`dsh-lan-bridge`；**不在**：`dsh-link-toolbar`、`dsh-link-responsive` | 读来的（同上） |
| 3 | 本仓 `plugins/` 下 **20** 个包，**9** 个声明 `dsh.client`，9 个都指 `./lib/client.js`，**9 个 `lib/client.js` 全部存在** | **我实测**（命令与读数见下） |
| 4 | 活档案：`dependencies` **20** 项、`dsh.profile.bundles` **21** 条、`node_modules` **17 条符号链接**、`package.json` **2300 B / `crlf=0`** | **我实测**（只读） |

我实测用的命令（`node -e`，在本仓根跑；逐字节可复跑）：

```powershell
node -e "const fs=require('fs');const P='plugins';let n=0;for(const d of fs.readdirSync(P)){const f=P+'/'+d+'/package.json';if(!fs.existsSync(f))continue;const j=JSON.parse(fs.readFileSync(f,'utf8'));if(!(j.dsh&&j.dsh.client))continue;n++;const t=j.exports&&j.exports['./client'];const r=typeof t==='string'?t:(t&&t.default);const b=P+'/'+d+'/'+String(r).replace('./','');const sc=fs.existsSync(P+'/'+d+'/src/client');console.log(d.padEnd(22)+' platform='+j.dsh.client.platform+'  '+r+'  '+(fs.existsSync(b)?fs.statSync(b).size+'B':'MISSING')+'  srcClientDir='+sc)}console.log('declared='+n+'/'+fs.readdirSync(P).filter(d=>fs.existsSync(P+'/'+d+'/package.json')).length)"
```

读数原文（`exit 0`）：

```
dsh-browser            platform=web  ./lib/client.js  14421B   srcClientDir=false
dsh-continue-button    platform=web  ./lib/client.js  9536B    srcClientDir=true
dsh-lan-bridge         platform=web  ./lib/client.js  153119B  srcClientDir=false
dsh-link-brand         platform=web  ./lib/client.js  12180B   srcClientDir=true
dsh-link-responsive    platform=web  ./lib/client.js  7317B    srcClientDir=true
dsh-link-teams         platform=web  ./lib/client.js  28034B   srcClientDir=false
dsh-link-toolbar       platform=web  ./lib/client.js  6881B    srcClientDir=true
dsh-liquid-glass       platform=web  ./lib/client.js  147914B  srcClientDir=true
dsh-theme-settings     platform=web  ./lib/client.js  29978B   srcClientDir=true
declared=9/20
```

**复核（就在这一轮里，世界动过一次——所以我把它写下来）**：我写下上面那张读数之后，P1/P2 的两个包落盘了，Lead 也往包表里加了行 ⇒ **同一条命令此刻再跑一次是 `declared=10/22`**（多出来的是 `dsh-link-markdown`：`platform=web`、`./lib/client.js` **12045 B**），`node plugins/build.mjs --check` 也已经把它算进去（读数原文里就有 `ok: dsh-link-markdown/lib/client.js`）。**上面 20/9 是写作时刻的读数，不是现在的**；但**三条前提与 7/9 那两个数字不受影响**：活档案此刻仍是 `dependencies` 20 / `bundles` 21 / `links` 17，`dsh-link-markdown` 与 `dsh-link-panel` 在 dep / bundle / link 三处**都还是 false**（我实测）——它们的行要等 Lead 的窗口。

**判据是 `package.json` 的 `dsh.client`，不是「有没有 `src/client/` 目录」。** 上面 `srcClientDir=false` 的那三个（`dsh-browser`、`dsh-lan-bridge`、`dsh-link-teams`）**都真的在活页面上**，它们的客户端半是**手写的 `lib/client.js`**。⇒ 「数目录」会把 9 个数成 6；先例就是 `dsh-lan-bridge`（记档原文：它的客户端半是**一个已构建产物** `lib/client.js`）。

**两个阴性对照为什么不在：「声明 + 已构建 + 缺前提①」**（具名的第三态，既不是绿也不是红）：

- 它们**声明了** `dsh.client.platform='web'`（自愈锚 `plugins/dsh-link-toolbar/package.json#"platform": "web"`、`plugins/dsh-link-responsive/package.json#"platform": "web"`）；
- 它们的 `lib/client.js` **也构建了**——我在 bundle 第 1 行读到自注册行（自愈锚 `plugins/dsh-link-toolbar/lib/client.js#window.__ModuleLoader__.load({ id: "dsh-link-toolbar"`、`plugins/dsh-link-responsive/lib/client.js#window.__ModuleLoader__.load({ id: "dsh-link-responsive"`）；
- 但它们**不在**活档案 `dependencies`、**不在** `dsh.profile.bundles`、`node_modules` 里**也没有链接**（我实测：`toolbar dep=false bundle=false`、`responsive dep=false bundle=false`）⇒ 缺的**只有前提①**，②③ 都成立。

⇒ 别把它们的缺席读成「构建坏了」或「平台不对」；今天的读数是**行没被挂载**。

**⚠ 一条与契约不同的读数（留在这里，供下一个人复核）**：契约 §1.7 写「`dsh-anchored-lite` **不在** profile `node_modules` 的符号链接里」。我今天的读数**与它相反**：`anchored-lite dep=true bundle=false links=17 anchored-lite-linked=true`，那条链接指向 `<workspace>\\dsh-link\plugins\dsh-anchored-lite` 且 `realpathSync` 成功。⇒ §1.7 的「在 `dependencies` 里」与「只在 `minimal-tuned` 那条 preset 里被点名」两条我复核**成立**（`bundle=false` 也印证），但「**没有链接**」这半句、以及由它推出的「它连『装进去』都还没做到」——**至少理由不成立**。**这一条我没跑**那条 preset（要活体窗口），只说文件系统这一层；而且它随 Lead 的窗口会变。

第三态（「9 个都在活页面上」是绿，「一个都不在」是红，中间还有第三种）：**今天的实数是 7/9**；记档要求「挂完应为 8/9 或 9/9，如实报」，**不许预支**。

## 四、挂了之后要读什么：**两半必须分开报**

| 半 | 读什么 | 它证明什么 | 谁判 |
|---|---|---|---|
| **(a) 投递** | 活页面清单里出现 `dsh-link-markdown/client.js` | 前提 ①+②+③ 都成立，bundle 被发布成了一个 combo 行 | 门 122 的**阳性**那半（**只有一条**）；离线那半由门 121 判（manifest → 构建 → 上树 → 打包 → 组合行） |
| **(b) 跑起来了** | `globalThis.__dshLinkMarkdown.registered === true` | 客户端半**真的执行到了注册成功**这一步（不是「文件在那儿」） | 门 122 的**第二半**（§9 R3 加的全局标记；注册失败时是 `{ registered: false, failed: '<原文>' }`，fail-closed 不抛） |

- **(a) 绿而 (b) 不读**，等于把「投递」当成「活着」——这正是 §9 R4 要分开报的两半；**任一半缺 ⇒ 具名，不报绿**。
- **P2 本轮没有客户端半**（`dsh-link-panel` 是宿主半）⇒ 门 122 **不覆盖它**，记档要如实写「本条不覆盖 P2」。
- **前提证据（缺它后面全假）**：内核启动时真的加载了 R188 的代码——`boot.log` 里两个新包各自的启动行。§8 验收 9 的原文口径：**活内核真的加载了 R188 的代码**。
- **第三态**：`registered === true` 只证明**注册路径**跑完了，**不证明**渲染正确、不证明面板里看得见、更不证明「行在而 body 抛错」那一类（后者本轮明确不判）。
- **两个阴性对照仍然要读**：`dsh-link-toolbar/client.js` 与 `dsh-link-responsive/client.js` **必须不在**清单里（§9 R5 / B-5：它们本轮**只当阴性对照**，不挂）。若它们出现了 ⇒ **判红**（说明解析器或世界不对），不许判绿。

## 五、哪些话作废（R188 契约 §1 的七条更正，逐条）

> 口径：**§1 的更正以 §9 为准**；下表是「过期的话 → 今天的口径」。**凡我没自己复跑的，标「读来的」。**

| # | 作废的话（原文出处） | 今天的口径 | 更正落在哪 |
|---|---|---|---|
| 1 | `STATUS.md:113`：「`dsh-browser` … **多标签页未见证据**」 | **两半都已被推翻**：壳侧标签（`MAX_TABS: usize = 4`、`tab_new`/`tab_close`/`tab_activate`/`tab_goto`）与 AI 侧四个 `browser_tab*` 工具**都已落地**；尺寸也不是「配置项」而是 8 个具名预设 + 自定义 200..5120。**唯一还没读的**是「停靠标签的真实画面与输入落点」（读来的，§1.1） | §1.1 |
| 2 | `STATUS.md:5`：「门的总账 … **93 个门**」（R134 的数） | 我实测注册表 **120 条**（live 20 / offline 100）⇒ 那句话已过期；第 10 条那行引的「活体滑动 61→69」是 **R185 那一次的世界**，不是恒值 | §1.2（+ §9 R1 的 120、两道新门 121/122） |
| 3 | 第 6 条附带的那句「`Auto review` … 缺的是权限 glyph 族」 | **成立、且今天仍然精确**：`permissionGlyphs` 只有 3 项、模块内私有、`'auto'` 拿不到 glyph；zh 里只有 2 个键与 en 逐字相同（**不是**「整个功能没汉化」） | §1.3 |
| 4 | `STATUS.md:108`：「**联网 A/B 未做**」 | **「联网」零命中是对的**，但第 4 条整体比它写的「已做一半」：`chat-mode` 预设、`complete: true`、`includeRuntimeContext: false` 都在树上；**联网没有任何落点**（全 `plugins/**` 搜 `networkMode|联网|onlineMode|webResource|searchMode` 只命中 1 行，就是 persona 里那句「不能…联网检索」） | §1.4 |
| 5 | 数「客户端半」的**方法**：用「有没有 `src/client/` 目录」数 | **错**：正确判据是 `package.json` 的 `dsh.client`。先例 `dsh-lan-bridge` 的客户端半是**一个已构建产物** `lib/client.js`（今天还有 `dsh-browser`、`dsh-link-teams` 两个同形，我实测）⇒ 数目录会把 **9 个数成 6** | §1.5 |
| 6 | `STATUS.md:125` 第 13 条：「数据面已落地（R48）；UI 与注入未做 …」 | **四件里三件已还**（阈值三层、`notes:ledger` 段、`notes_list`/`notes_add` + 审批 + `notes` 组），**只剩侧边栏 UI 入口**（那个包没有客户端半） | §1.6 |
| 7 | 契约 §1.7 自己那句「`dsh-anchored-lite` **不在** profile `node_modules` 的符号链接里」 | ⚠ **我今天的读数与它相反**（见 §三末条）：它在 `dependencies` 里、**也在** 17 条链接里、target 解析成功；「只在 minimal-tuned 里被点名」成立。⇒ 那句结论的理由不成立（**没跑 preset，只说文件系统这一层**） | §1.7（本页 §三 有读数） |

**另外两条本轮不许被读成「已经做了」**：md 第 1 条的**写回路**、**mermaid**、**面板壳**、**便条 UI 入口**都在契约 §7 的「本轮不做」清单里（写回路与 mermaid 的裁决在 §9 R5：写回路下一轮开工前裁、mermaid 本轮不引）。

## 六、本页自己的第三态：谁在读它、它读不到什么

- **今天没有任何门打开本页**（我实测）：`scripts/verify-client-plugin-mount.mjs`（门 121）与 `scripts/verify-client-plugin-live-rows.mjs`（门 122）**文件都不存在**；`scripts/verify-all.mjs` 里搜 `check-protocol-page` **0 命中**；`doc-citations` 的默认清单是**三份硬编码文档**（`scripts/verify-doc-citations.mjs:30`），**不含本页**。⇒ 按开工令（`docs/handoff/R188-contract.md` 里 P4 的行与门 121 的行），本页会成为**门 121 的一条读数**，那时才有人替它背书；在那之前，本页的绿**只有**下面那条 `--page` 命令能给。
- **本页自己的读数**：`node scripts/check-protocol-page.mjs --page docs/dev/client-plugin-mount.md` ⇒ `exit 0` / `63 of 63 citation(s) hold`（我实测，见交付报告；条数以那时为准）。**反证**：把页里某条 needle 改到**不再是子串** ⇒ 必红；逐字节改回 ⇒ sha256 一致。⚠ **反证的边界**（记档里的第三态）：核对器的分片判定是**子串包含**（`scripts/check-protocol-page.mjs:97`），把分片截短成真文本的**前缀**时那一行**照样绿**——做反证要改到「**不再是子串**」。
- ⚠ **这两条是「时刻读数」，不是结论**：门 121/122 由另外两位作者在写，两个文件一落盘、`verify-all.mjs` 一登记，上面第一个小圆点就过期了（要改的是那一条，不是本页的判据表）。
- **本页读不到什么（具名）**：① 那条 `GET /` 我没发过（P4 没有活体窗口）；②「行在而 body 抛错」本轮**不判**；③ `dsh-link-markdown` 的客户端半在真页面里会不会因 slot 时序抛错——**只有挂上去才知道**（这正是门 122 要读的第一件事）；④ P2 本轮无客户端半 ⇒ 本页**一个字都不许**把它说成「装载已验证」。

## 七、这份页面的引文（机器核对，别只信人眼）

下面这张表是本页的**判据表**：每条规则钉到**真实存在的** `path:line`（pin 住的内核）或 `path#text`（会动的两个前缀 + 记档）与该处**必须含有的文本**上。核对器：

```
node scripts/check-protocol-page.mjs --page docs/dev/client-plugin-mount.md
```

<!-- citations -- checked by scripts/check-protocol-page.mjs --page docs/dev/client-plugin-mount.md; keep needles and fragments in sync -->
| id | where | must contain |
|---|---|---|
| dsh-load-row-must-be-active | core/deepseek-harness/packages/client/modules/src/index.ts:1005 | entry.fiber === undefined ; entry.disabled |
| dsh-load-resolve-meta-per-active-row | core/deepseek-harness/packages/client/modules/src/index.ts:1037 | const resolved = this.resolveMeta(loaderName, baseUrl) |
| dsh-load-platform-web-or-not-a-row | core/deepseek-harness/packages/client/modules/src/index.ts:862 | decl.platform !== 'web' |
| dsh-load-reads-dsh-field | core/deepseek-harness/packages/client/modules/src/index.ts:857 | const dsh = pkg.dsh |
| dsh-load-parse-dsh-client | core/deepseek-harness/packages/client/modules/src/index.ts:858 | const decl = parseDshClient( |
| dsh-load-client-export-helper | core/deepseek-harness/packages/client/modules/src/index.ts:866 | clientExportOf(packageName, pkg.exports) |
| dsh-load-throws-without-client-export | core/deepseek-harness/packages/client/modules/src/index.ts:868 | declares dsh.client but exports no "./client" bundle |
| dsh-load-built-path-from-manifest | core/deepseek-harness/packages/client/modules/src/index.ts:871 | clientPath: join(dirname(pkgPath), clientRel) |
| dsh-load-reads-built-bytes | core/deepseek-harness/packages/client/modules/src/index.ts:983 | const bundle = readFileSync(clientPath) |
| dsh-load-missing-bundle-named-throw | core/deepseek-harness/packages/client/modules/src/index.ts:987 | throw new MissingClientBundleError(pkgName, clientPath, error) |
| dsh-load-build-instruction | core/deepseek-harness/packages/client/modules/src/index.ts:93 | run `pnpm run build` before launch |
| dsh-load-exports-client-key | core/deepseek-harness/packages/client/modules/src/index.ts:198 | ['./client'] |
| dsh-load-two-sources-refused | core/deepseek-harness/packages/client/modules/src/index.ts:1052 | resolves from multiple active Loader sources |
| dsh-load-combo-route-shape | core/deepseek-harness/packages/client/modules/src/index.ts:231 | ??${resources}&rev=${rev} |
| dsh-load-manifest-platform-is-string | core/deepseek-harness/packages/client/modules/src/client/manifest.ts:179 | typeof decl.platform !== 'string' |
| dsh-load-manifest-parser | core/deepseek-harness/packages/client/modules/src/client/manifest.ts:173 | export function parseDshClient(pkgName: string, value: unknown) |
| dsh-load-profile-bundle-cannot-resolve | core/deepseek-harness/packages/boot/app-boot/src/profile.ts:722 | cannot resolve profile bundle ; from the dsh installation or ${profileDir} |
| precedent-lan-bridge-export-target | plugins/dsh-lan-bridge/package.json#"default": "./lib/client.js" | - |
| precedent-lan-bridge-platform | plugins/dsh-lan-bridge/package.json#"platform": "web" | - |
| example-browser-platform | plugins/dsh-browser/package.json#"platform": "web" | - |
| example-browser-row-comes-from-mods | plugins/dsh-link-mods/cordis.patch.yml#name: dsh-browser | - |
| control-toolbar-platform | plugins/dsh-link-toolbar/package.json#"platform": "web" | - |
| control-toolbar-bundle-registers-id | plugins/dsh-link-toolbar/lib/client.js#window.__ModuleLoader__.load({ id: "dsh-link-toolbar" | - |
| control-responsive-platform | plugins/dsh-link-responsive/package.json#"platform": "web" | - |
| control-responsive-bundle-registers-id | plugins/dsh-link-responsive/lib/client.js#window.__ModuleLoader__.load({ id: "dsh-link-responsive" | - |
| build-check-is-lib-drift | plugins/build.mjs#fail if lib/ differs from a fresh build | - |
| gate-build-runs-the-check | scripts/verify-all.mjs#name: 'build', kind: 'offline' | plugins/build.mjs ; --check |
| contract-live-list-instrument | docs/handoff/R188-contract.md#活页面客户端半清单（这是本轮最值钱的一条仪器） | http://127.0.0.1:31761/ ; 200 |
| contract-live-list-parse | docs/handoff/R188-contract.md#切出并去重 | 77 个唯一 client 行 ; `dsh-*` 共 **9 个** |
| contract-https-pitfall | docs/handoff/R188-contract.md#端口 31761 上跑的是 | 明文 HTTP ; https.request |
| contract-ours-are-7 | docs/handoff/R188-contract.md#**我们的 7 个**（其余两个是别人的包） | lan-bridge |
| contract-negative-controls-absent | docs/handoff/R188-contract.md#`dsh-link-toolbar`、**没有** `dsh-link-responsive` | - |
| contract-criterion-is-dsh-client | docs/handoff/R188-contract.md#正确判据是 `package.json` 的 `dsh.client` | - |
| contract-lan-bridge-half-is-lib-client | docs/handoff/R188-contract.md#它的客户端半是**一个已构建产物** `lib/client.js` | - |
| contract-live-archive-reading | docs/handoff/R188-contract.md#17 条符号链接 | **20** 项 ; **21** 条 ; 不含 toolbar/responsive |
| contract-1-1-item9 | docs/handoff/R188-contract.md#1.1 更正 1（最重要） | - |
| contract-1-2-gate-count | docs/handoff/R188-contract.md#1.2 更正 2 | 93 门 ; 119 门 |
| contract-1-3-glyph | docs/handoff/R188-contract.md#1.3 更正 3 | 图标来源已摸清 ; glyph |
| contract-1-4-chat-network | docs/handoff/R188-contract.md#1.4 更正 4 | 联网 A/B ; 零命中 |
| contract-1-5-count-trap | docs/handoff/R188-contract.md#1.5 更正 5 | dsh-lan-bridge ; 9 个数成 6 |
| contract-1-6-notes-stale | docs/handoff/R188-contract.md#1.6 更正 6 | STATUS.md:125 ; 已过期 |
| contract-1-7-anchored-lite | docs/handoff/R188-contract.md#1.7 更正 7 | dsh-anchored-lite ; 符号链接 |
| contract-1-7-claim-read-again | docs/handoff/R188-contract.md#17 条链接里**没有它** | - |
| contract-r1-gate-numbers | docs/handoff/R188-contract.md#不写 123 | 121 `client-plugin-mount` ; 122 `client-plugin-live-rows` |
| contract-r3-package-names | docs/handoff/R188-contract.md#dsh-link-markdown`、`dsh-link-panel | - |
| contract-r3-frozen-manifest | docs/handoff/R188-contract.md#dsh.client.platform = 'web' | - |
| contract-r3-markdown-claim | docs/handoff/R188-contract.md#**不许**接管 builtin | kind: 'markdown' ; priority: 'extension' |
| contract-r3-liveness-marker | docs/handoff/R188-contract.md#globalThis.__dshLinkMarkdown | registered: true ; fail-closed |
| contract-r4-two-halves-separate | docs/handoff/R188-contract.md#R3 的全局标记 | 投递 ; 跑起来了 |
| contract-r4-negative-controls-kept | docs/handoff/R188-contract.md#两个阴性对照保留 | dsh-link-toolbar ; dsh-link-responsive |
| contract-r4-p2-not-covered | docs/handoff/R188-contract.md#P2 本轮是宿主半、无客户端半 ⇒ 如实写成 | 本条不覆盖 P2 |
| contract-r5-negative-controls-only | docs/handoff/R188-contract.md#只当阴性对照 | - |
| contract-r6-no-json-stringify | docs/handoff/R188-contract.md#不许用 `JSON.stringify` 重写 | CRLF |
| contract-acceptance-bootlog | docs/handoff/R188-contract.md#活内核真的加载了 R188 的代码 | - |
| contract-121-judges-the-chain | docs/handoff/R188-contract.md#两个新包的 manifest 真被 import | - |
| contract-today-is-7-of-9 | docs/handoff/R188-contract.md#活页面清单的**实数** | 今天 7/9 ; 挂完应为 8/9 或 9/9 |
| contract-out-of-scope | docs/handoff/R188-contract.md#不做 Markdown 的写回路 | - |
| contract-p4-write-scope | docs/handoff/R188-contract.md#docs/dev/client-plugin-mount.md`（新文件） | - |
| contract-p4-stays-offline | docs/handoff/R188-contract.md#P1/P2/P4/门 121 全程离线 | 31761/31760/9222 |
| contract-122-single-positive | docs/handoff/R188-contract.md#只有一条**——`dsh-link-markdown/client.js` | - |
| doc-citations-default-docs | scripts/verify-doc-citations.mjs:30 | ['docs/protocol/device-net-v1.md', 'docs/handoff/PLAN.md', 'docs/handoff/STATUS.md'] |
| checker-reads-rows | scripts/check-protocol-page.mjs:83 | readFileSync(file, 'utf8').split(/\r?\n/) |
| checker-fragments-are-substrings | scripts/check-protocol-page.mjs:97 | !text.includes(flat(fragment)) |
<!-- /citations -->
