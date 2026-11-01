# DSH-LINK 设备网协议 v1：**别的 Harness 怎么加入**（§其他 8 / §坑 5）

> 这是在实测基础上写下的**我们自己的**协议，不是任何标准。写它的目的只有一个：让**非本家**的进程（别的 Harness、别的语言写的 Agent 宿主）能按这份文档加入设备网，而**不需要**装 DSH、不需要 cordis、也不需要我们的插件代码。
> 每条断言都指到**已出货产物**的 `file:line`（本机 `plugins/dsh-link-collab/src/index.ts`，sha 见 `STATUS.md`）。**没有出处的规则不许写进这份文档。**

## 一、传输：一条 HTTP 路由 + 一个共享密钥

- 路由缺省 `POST /api/dsh-link-collab/relay`（引文表 `relay-path`；可由挂载方改）。
- 认证头：`Authorization: Bearer <token>`，**方案名大小写不敏感**（RFC 7235），缺失或不匹配 → `401 {ok:false, code:'UNAUTHORIZED'}`（引文表 `auth-scheme` + `auth-refusal`）。**认证先于一切**——未认证的调用者不该从 `405` 里知道这条路由存在。
- 方法：非 `POST` → `405 METHOD`（引文表 `method-refusal`）；`Content-Type` 必须是 `application/json`（大小写不敏感）→ 否则 `415 CONTENT_TYPE`（`content-type-refusal`）；请求体超过 `RELAY_BODY_LIMIT` → `413 TOO_LARGE`（`body-limit` + `too-large-refusal`）。
- 请求体 = **一批记录**：`{ writer, instance, records: [ { seq, kind, actor?, subject?, payload?, at? } ], adopt? }`（引文表 `record-shape` / `batch-shape` / `adopt-field`；`adopt: true` 表示「我**自己的** writer 名换过账本，请收下新的那段历史」——**对别人的名字没有这回事**，见下面那节）。
- 成功 → `200 {ok:true, appended, skipped}`（引文表 `success-body`）；拒绝 → `400 {ok:false, code, error?}`（引文表 `refusal-body`），`code` 来自 ingest 的拒绝，可能的取值：`RELAY_GAP`（批次起点在已知高水位之后 → 中间有洞）／`RELAY_HOLE`（批次自己内部有洞）／`RELAY_WRITER_MISSING`（没写 writer 或 instance）／`RELAY_REWRITTEN`（**第三方**名字的同名 writer 换了 instance 又没 `adopt`；**名字若是接收方自己，一律走下面的 `RELAY_IMPERSONATION`，不受这一条描述**）／`RELAY_CONFLICT`（同一位置内容不同）／`RELAY_MALFORMED`（seq 不是互不相同的正整数）／`RELAY_IMPERSONATION`（冒充接收方自己的身份）（:301）。
- **两端是对称的**：每一端都既是服务端（应答别人的批次）又是客户端（把自己的批次 POST 给对方）。

### 你自己的名字**不可被采纳**（v1.1 补写，R57 实测后修；v1.2 收窄为一句话）
- 上面那批记录里的 `writer` 是**发送方**在网上的名字。因此：批次若带着**接收方自己的 `writer` 名**——**无论 `instance` 是不是接收方自己的、也无论有没有 `adopt: true`**——**一律拒**：`400 {code:'RELAY_IMPERSONATION'}`，账本不变。
- 理由两条：① `adopt` 的含义是「**我**重建了**我**的账本」，这话不可能对一个**不是你自己的名字**成立；② **一个端只会转发它自己产生的记录**（`ownPage` 的语义：转发来的记录不算自己的），所以**你自己的记录永远不需要绕回家**——一个把它们送回来的对端，要么在成环，要么在伪造。两端同时用一个名字，也正是 `LogOptions.writer` 那段文档要分开的配置。
- 一句话给实现者：**`adopt` 只能用于你自己的名字；别人的名字（尤其接收方自己的名字）没有「采纳」这回事**。
- **边界（写清楚）**：因此本协议**不支持**「把己方历史反向推回给起点端」的补历史设计；要补历史，由**持有方以它自己的名字**推。

### 日志身份（比 `seq` 更重要）
- **`writer`** = 你这一端在网上的名字；**`instance`** = 你这份账本的身份（重建账本要换新的 `instance`，并带 `adopt`）。
- 批次里每条记录的 **`seq` 是「你自己的流」里的位置**（从 1 开始，只数你自己产生的记录），**不是**合并账本里的位置（引文表 `own-stream-seq`；那一行的注释记下了这条代价：曾经用合并 `seq` 编号，导致对端合理地拒收你的回程）。
- 对端按 `(writer, instance)` 记高水位；**洞必须被拒**——带洞的折叠会报出一个没有任何写入者产生过的状态。

## 二、加入需要写下的**最少**记录（这是你被看见的方式）

所有记录都是「事实 + 折叠」：你只**追加**，不修改历史；读你的状态靠别人折叠。`kind` 与 payload 都要照下面的字段写，少一个字段别人就认不出你（fields 由 `stateOf`（引文表 `member-fields`）、`declarationOf`、`hostRecord`（`host-builder`）、`heartbeatRecord`（`heartbeat-builder`）、`dispatchOf`/`answerOf`（R53/R55 冻结）读取）。

| kind | payload | 作用 |
|---|---|---|
| `member/state` | `{ id, state:'active', name?, role? }` | 声明你这一端有一个成员。**团队归属**由记录的 `actor`（或 `payload.teamId` / `payload.team`）给出（`teamOf`，引文表 `team-attribution`）——三选一，不要都不写。 |
| `capability/state` | `{ id, capabilities:[...] }` | 声明这个成员**能做什么**。**能力是权威**：别人把活派给你之前会查它；你没声明的事，别人派过来会被拒。 |
| `member/heartbeat` | `{ id, at }` | 心跳。「活」在协议里是**账本事实**，不是 TCP 连接状态：别人按 `(now - at) >= timeoutMs` 判你「不算活」。 |
| `member/host` | `{ id, end, via, at }` | 你在哪一端、经谁中转（`via: null` = 直达）。**没有这条事实 = 你在本端**。 |
| `task/result` | `{ id, from, ok, value?, error?, at }` | 你对一次派活的回答。`from` **必须**等于派活点名的那个成员，否则会被当成 `wrong-writer` 拒掉（可见地拒）。**一次派活只有一条答案**（第二条一律 `duplicate-result`）。 |

### 你必须能**读** kinds

| kind | payload | 你要做什么 |
|---|---|---|
| `task/retry-lease` | `{ root, end, at, untilMs }` | 只在**你自己要重派**时才需要：读它知道这个 root 归谁，重派前写它声明归你。整条规则见 §五之三（引文表 `lease-kind` / `lease-builder`）。 |
| `task/dispatch` | `{ id, to, tool, args, at }` | 如果 `to` 是你的成员 id：执行 `tool`（用你的 `args`），然后写一条 `task/result` 回批。`id` 是派活端铸的 token——**不要复用别人的 id 去派活**（同 id 第二次派活会被判 `duplicate-id` 拒掉，不覆盖第一条）。 |

## 三、加入之后你得到什么

- 别人能**解析出到你这一端的一条路**（`routes`/`assignThrough`，R44）：你的成员可被派活，**只要整条链和你在 `timeoutMs` 内都活着**；你停跳 → 判词变 `route-down`/`member-silent`（**不是**无限等待）。
- 你的 `task/result` 被**采纳**的条件是：id 存在 ∧ `from` 正好是派活点名的成员 ∧ 这个 id 还没有被采纳过。三条缺一就会被**可见地**拒（进 `refusedResults`，不是静默丢弃）。
- 回答可以是失败：`ok:false` + `error`。**工具报错是结果**（别人会把它折成 `answered`，不是 pending）——这条在 R55/R56 是硬判据。

## 四、v1 **不**覆盖的东西（写清楚，免得你以为它比实际更强）

- **没有服务发现**：`url`/`token` 由人配置（或由既有设备发现流程给出）。协议本身不回答「网里有哪些端」。
- **没有加密协商**：信任模型只有那个共享密钥，所以它只适合局域网/已配对的链路。设备侧的 Ed25519/X25519/SPAKE2 是 `dsh-lan-bridge` 的**另一套**面，本协议不覆盖。
- **v1 只覆盖「加入 + 心跳 + 能力 + 收派活 + 回答案」**：任务板/锁、会话认领与交接、lead 间握手、分形团队**都不在** v1 里（它们的记录 kind 存在且可读，但「外部端按它们行动」没有实测，因此不写成承诺）。后面几节是**补写**（§五之二 中转、§五之三 跨端重派、§七 能力清单与衰减、§八 团队合并）：它们沿用同一条纪律——**只写已经实测过的规则**，各自的边界写在那一节里。
- **不是标准**：这套 kind 与 payload 是我们自己的；它能开放，是因为它够小、够可判，不是因为别人也在用。

## 五、参考实现与它的读数

- 参考实现：`dsh-link/tools/foreign-harness/foreign-end.mjs`（**不 import 我们任何代码**，纯 node：自己维护 append-only 日志与 `instance`、自己实现服务端与客户端两半、自己做洞/身份检查）。
- 自检：`dsh-link/tools/foreign-harness/join-selfcheck.mjs`（本端用已出货的 `createRelayEndpoint` 起真路由，另一端是上面那个真子进程）。
- 独立门：`scripts/verify-device-net-foreign.mjs`（由另一位作者写：它自己写出**不守规矩的**外部端做反例——冒充身份、跳过洞、`from` 写错、同 id 第二条答案——并要求这些都被**可见地**拒）。

## 五之二、中转端：把**对端的记录**转给下一跳（多跳的基础，R59 实测）

一个端可以站在中间，让**别的端**经由它互相看见与派活。这件事有一条**容易写错**的规则，本仓已经为它付过一次代价（见引文表 `regroup-helper`）：

- **`ownPage()` 是「一跳导出」**：它只导出**本端自己产生**的记录，转发进来的不算（引文表 `own-page-one-hop`）。所以中转端如果**只转发自己的页**，它**什么也没转发**——对端的记录一条都过不去。
- **正确的做法是按来源重新分组**：把它**持有的每一条记录**按记录最初来自谁（`writer` + `instance`，也就是批次头）分组，**每一组当作那一位自己的批次**发出去。这样**每一跳的形状都和第一跳一样**，接收端的高水位（按 `(writer, instance)` 记）才认得出它是谁的流。
- **信任模型要说清**：批次头是**声明**，不是证明——**看过一批记录的人都可能拿它去冒充原作者**（本仓的多跳门把这条也测了，见 `scripts/verify-collab-multihop.mjs`）。v1 的信任只有那个共享密钥，所以多跳**只适合已配对的链路**；要抗冒充就不是这份页面的范围（设备侧的 Ed25519/SPAKE2 在 `dsh-link-lan-bridge` 那套面里）。
- **一跳/多跳的判词在账本里**：`member/host` 的 `via` 串起每一跳，`routes`/`assignThrough` 沿链解析；中转**沉默**→ 链停在它那里（`route-down`），而**中转活着、末端的成员沉默**是另一个答案（`member-silent`）。两者不许合并。

参考实现的对应开关：`tools/foreign-harness/foreign-end.mjs` 的 `--forward <url[,url...]>`（按来源重新分组后转发，可给多个下一跳）、`--naive-forward`（只转发自己的页——**成对的负例**，用来说明上面那条规则不是装饰）、`--end`/`--via`（声明自己这一跳的 `member/host`）、`--beat-every`（持续心跳，于是「中转活着而末端沉默」有读数）。

读数（生产者自查 `tools/foreign-harness/multihop-selfcheck.mjs`，**6/6**）：末端成员**经中转**加入（记录跨两跳）→ `routes` 给出 `[end-A, T-end, B-end]`（hops 2）→ `assignThrough` 判 `ok`（hops 2）→ 派活**出两跳**、答案**回两跳**（末端算出的 `{sum:42}`）→ 中转沉默 → `route-down` 且链停在 `T-end` → **中转活着、末端沉默** → `member-silent`（路径完整，与上一条是不同的答案）。
## 五之三、跨端重派：一个 root 的下一趟尝试只有一个主人（R69 实测）

**先把一个词定死**：本章说的**尝试**（attempt）特指**带 `retryOf` 的 `task/dispatch`**——即「为某个 root 做的下一趟派遣」，它自己叫 `<root>#r<n>`；**不带 `retryOf`** 的那一条是**原始派活**（工作本身），**不是**尝试。这个区分是承重的：租约只约束尝试（引文表 `lease-retries-only`），把原始派活也算进去就等于让租约**抹掉自己的主语**。
为什么需要它：一条派活等太久（超过 `timeoutMs`）就该被重派，而**可能有好几个端同时**得出这个结论，各自写一条 `<root>#r<n>`。两份账本一合并，同一个序号上就出现两条尝试，而「谁该重派这个 root」**不是先到先得能回答的**——先到先得要求两端时钟可比，本协议的时钟信任只在本地（见 §二 `member/heartbeat` 那条边界）。所以主人身份**从账本自己算出来**，不需要握手、不需要额外信道。

| kind | payload | 作用 |
|---|---|---|
| `task/retry-lease` | `{ root, end, at, untilMs }` | 声明「这一端正在为这个 root 负责下一趟重派」。`root` 是被重派工作的根 id；`end` 是你这一端的成员名；`at` 与 `untilMs` 都是**毫秒整数**，`untilMs` 是这条租约**能活多久**（正整数，构造期校验：`lease-validation`）。 |

判据（照做即可，全部是账本事实）：
- **活着**的租约：`now - at < untilMs`——**等号算过期**（引文表 `lease-liveness`；与心跳的 `>=` 是同一条边界纪律）。
- **主人** = 活租约里 `end` **字典序最小**的那个；`end` 相同再按 `at`、再按 `seq`（引文表 `lease-tiebreak`）。**结论与记录到达的顺序无关**（投影先按 `(at, seq)` 排序，引文表 `lease-projection`）——这是「两端各自折叠、结果相同」的前提。
- 计划期：别的端持有活租约 ⇒ 你**不计划**这一趟，判词 **`lease-held`**（引文表 `lease-held`）。
- 写入期：你**先写租约、再写尝试**（引文表 `lease-claim-first`），中间**按最新账本重新折叠重新判定**（引文表 `lease-refold`）。输掉竞态时账本上留下「有租约、没有尝试」，这是那场竞态**诚实的记录**，不是静默丢弃。
- 折叠期：**不是主人写的尝试不被当成有效派活**，进 `refusedDispatches`，判词 **`lease-mismatch`**（引文表 `lease-mismatch`）。你写的每条尝试都要带上自己的身份（`actor` = 你的成员名，引文表 `lease-actor`），否则折叠无法把它和租约对上。
- **租约约束的是「重试」，不是「工作本身」**：只有**带 `retryOf`** 的 `task/dispatch`（也就是一次**尝试**）才受租约约束；**原始派活（不带 `retryOf`）不受约束**，照旧进 `dispatches`（引文表 `lease-retries-only`）。**为什么这条必须写明**：若原始派活也被拒，租约会**抹掉自己的主语**——那条还在等答案的工作会从投影里消失，`expiredDispatches` 再也数不到它，「这条工作还在等」这件事就没有账本事实了。
- 账本必须能读这个 kind，否则它会被算成「读不懂的记录」（引文表 `lease-readable-kind`）。

**兼容性（可判，不是承诺）**：完全不用租约的端，在**没有任何租约**的世界里行为与加了这条规则之前**一致**——计划器只是在计划之前多问一句「这个 root 归谁」（引文表 `lease-owner`），没租约时答案恒为「没人认领」。一旦有端开始持有租约，非主人的尝试会被**拒**——而这件事在折叠上**可见**（进 `refusedDispatches`），不是静默丢弃。要加入这条规则，你只需要两件事：**能读 `task/retry-lease`** + **自己重派之前先写一条**（`lease-builder` 是它的构造）。

**一条直接后果**（照做之前先想清楚）：从不写租约的端**永远不可能是主人**——主人只从**活租约**里选（引文表 `lease-owner` / `lease-tiebreak`），因此只要**任何**别的端持有一条活租约，它的尝试一律被读成 `lease-mismatch`。这是规则本身，不是故障；要参与重派，就自己写租约。

**边界（写清楚，免得你以为它比实际更强）**：① 两端配了**同一个** `end` 时，租约退化成「同一个人」，此时**不挡重复**——这是配置错误，不是机制漏洞；跨端身份的唯一性仍由 relay 的 `writer` 面负责（`RELAY_IMPERSONATION`，见 §一之二）。② 租约是**事实不是锁**：它不阻止任何人写账本（账本是 append-only），它阻止的是「非主人写的尝试被当成有效派活」。③ 过期接手**不加锁**：两个端可以同时接手，但主人是**算出来的**（`end` 最小者），合并之后仍然只有一个主人。④ 这条规则只决定**谁**重派，不决定**该不该**重派（那是派活 id 与尝试上限那套规则），也不决定**多久**重派一次。

## 七、一个端能做什么：`end/manifest` 的最小写入与读取（R183 补写）

**先把结论说死**：要让网里别的端知道「我这一端能做什么」，你只写**一条**事实（kind ＝ `end/manifest`，引文表 `manifest-kind`）；而别人读到的「这个端现在能提供什么」**不由这一行说了算**——它是**沿每一跳的 `via` 逐跳取交集**的结果，**每一跳都必须有自己的 manifest**。**先别和既有词汇打架**：§二 的 `capability/state` 说的是**成员**能做什么（它就是**能力注册表**）；`end/manifest` 说的是**一个端**声明自己能做什么，而它的**能力名必须来自那个注册表**；设备面 `dsh-lan-bridge` 的 `intersectGrants` 是**权限（grant）**沿路径的 meet，本章是**能力清单**沿路径的衰减——两条衰减各有 owner，谁也不重算另一个。

### 你要写的那条记录：六个字段，一个都不许省

| 字段 | 类型 | 你说的这句话是什么意思 | 写错的时候（具名拒绝） |
|---|---|---|---|
| `end` | 非空名字 | 你这一端的名字。**与 `member/host` 的 `end` 同一个命名空间**（同一个词，不另起设备名体系；引文表 `manifest-end-namespace` / `host-builder`） | `MANIFEST_END` |
| `via` | 非空名字或 `null` | **下一跳**：本端自己直接可达 ⇒ `null`；否则填「把这条事实送到读它的那一端」的那一跳。**与 `member/host` 的 `via` 同一个词、同一个含义**（引文表 `manifest-via-same-word`） | `MANIFEST_VIA`（既不是 `null` 也不是非空名字，或者**指向自己**） |
| `platform` | 非空串 | 你是什么（harness 名／平台名），写入者的原话 | `MANIFEST_PLATFORM` |
| `protocolVersion` | 闭集里的一个版本 | 你按哪一版说话；本仓只认 `['dsh-link-device/1']`（引文表 `manifest-protocols`） | `MANIFEST_VERSION`（拒绝时**回带支持列表**，形状照适配器准入） |
| `capabilities` | 非空名字数组 | 你能做什么 | `MANIFEST_CAPABILITY`（名字不合文法／名字不在能力注册表里，同一个码两种 detail） |
| `at` | 有限毫秒整数 | 你盖的章 | `MANIFEST_AT` |

- 构造器是 `manifestRecord(input)`（**一个对象参数**，六个字段都在里面；引文表 `manifest-fields`），写入是 `appendManifest(state, log, input)`（引文表 `manifest-append`）。**八个码的落点**（引文表）：`MANIFEST_INPUT` ＝ `manifest-input-refusal`、`MANIFEST_END` ＝ `manifest-end-refusal`、`MANIFEST_VIA` ＝ `manifest-via-refusal`、`MANIFEST_PLATFORM` ＝ `manifest-platform-refusal`、`MANIFEST_VERSION` ＝ `manifest-version-refusal`、`MANIFEST_CAPABILITY` ＝ `manifest-capability-syntax` 与 `manifest-capability-registry`（两种 detail）、`MANIFEST_AT` ＝ `manifest-at-refusal`、`MANIFEST_NOT_AUTHORIZED` ＝ `manifest-not-authorized`（写入面）与 `manifest-not-authorized-relay`（接收面，同一句话的两个面，见下一条）。参数本身**不是对象** ⇒ `MANIFEST_INPUT`。
- **拒绝全部发生在 append 之前**：被拒的调用让账本**逐字节不变**（引文表 `manifest-refusal-before-write`）。
- **一条 `end/manifest` 行只许由它点名的那个端写**（引文表 `manifest-not-authorized` / `manifest-not-authorized-relay`）：**writer 不是被点名的那个端** ⇒ 具名拒 `MANIFEST_NOT_AUTHORIZED`，账本**逐字节不变**（拒绝发生在第一次 append 之前）。两个面各拒自己看得见的那一半：**接收面**（relay ingest）在一个批次里看到「writer 自己声明过 manifest（就在这一批里，或账本里已经有）」却替**别的端**写 manifest 行 ⇒ **整批**具名拒（一个批次一次性生效，什么都没写进去）；**写入面**（`appendManifest`）在一个账本**知道本端 writer 是哪个端**（那个 writer 写过关于自己的 manifest 行）时，写下一条点名**账本从没持有过的端**（没有 manifest 行、也没有成员跑在它上面）的行 ⇒ 拒。
- **不知道就不拒**（同一条规则的另一半，别把它读成漏洞）：批次头是**声明不是证明**（§五之二），所以一个**从没声明过自己**的 writer 替别人写的行**照旧收下**，折叠按事实读它——那条路会在它点名的那一跳上带着 `NO_MANIFEST` 断掉，而不是把它当成一条路。同理，账本**已经持有**的端，其 manifest 行可以由本账本自己的 writer 记下：**记账不是冒充**，被拒的是「替一个没人声明过的端说话」。
- **`via` 不是「一条路径数组」**（照 R44 的规矩）：**每一跳各写一条事实**；把整条路径塞进一行，会让「到那个端怎么走」有两个答案来源（引文表 `manifest-via-path-is-fold`）。
- **能力名的权威是能力注册表**：名字**必须**有成员用 `capability/state` 声明过（引文表 `manifest-registry-authority`）——**认不出的名字不许就近翻译**。写入期整条拒（`MANIFEST_CAPABILITY`）；如果是**别人**写了一条带着生名字的 manifest，折叠**照旧让这一行可见**：写入者的原话留在 `declared` 里、`capabilities` 只留注册表认得的、另外多计一个 `malformed`（引文表 `manifest-recognised-only` / `manifest-malformed-counted` / `manifest-declared-visible`）。**看不懂不许被读成没有**——一次静默丢弃会造出一个**没有任何写入者产生过的状态**。

### 别人怎么读你：折叠 → 衰减 → 键空间

1. **折叠**（引文表 `manifest-fold`：`projectManifests(records)` → `{ ends, malformed }`）：一个端一行，**胜者是 `seq` 最大的那条**（引文表 `manifest-winner-by-seq`）——所以**再声明一次、声明得更少 ＝ 撤回**（引文表 `manifest-withdrawal`），同一批记录换个到达顺序折出来的是**同一张表**（胜负由 `seq` 定，不由先来后到定）。写下去的那一刻也从这个折叠读回来，不是拿调用方的意图当答案（引文表 `manifest-readback`）；`end/manifest` 在「这个 build 读得懂的 kind」名单里（引文表 `readable-kinds`），所以**它不会被算成读不懂的记录**。
2. **沿路径衰减**（引文表 `decay-owner`：`effectiveCapabilities(state, end, now, { timeoutMs, localEnd? })` → `{ end, path, capabilities, missing, through }`）：链从 `end` 沿 `via` 一跳一跳往回走，**每一跳都必须有 manifest**，答案是各跳能力集合的**交集**（引文表 `decay-intersection`）——远端目录更小，能到读它的那一端就更小。`path` 只由这个函数逐跳解析出来，**别的地方不许再拼一条**（与 `routes` 同一纪律）；点名 `localEnd` 时链是 `[localEnd, ..., end]`（与 `routes` 同形，本端自己的 manifest 也是一跳；引文表 `decay-local-end-hop`）。
   - `missing[].code` **只有三个词，各是一个意思**（引文表 `decay-codes`）：`NO_MANIFEST`（这一跳从没声明过；引文表 `decay-no-manifest`）、`PEER_SILENT`（**你要问的那个端**自己沉默超过阈值）、`ROUTE_DOWN`（**路上**的中转沉默，断点被点名）——**后两个不许合并**（引文表 `decay-silence-vs-road`，这是 R59 立的规矩）。
   - 「沉默」的边界与心跳同一条：`sinceMs >= timeoutMs`，**等号算越界**（引文表 `decay-timeout-boundary`）；**从没打过心跳**的成员读作「不知道」，**不算沉默**（引文表 `decay-unknown-not-silent`）。
   - 纯函数：`now`、阈值、链全是参数，**不读墙上时钟**（引文表 `decay-pure`）。
3. **键空间（我们自己的远程 provider 门面）**：`brokerKeys(state, now, { timeoutMs, localEnd? })` 把「路走得通、名字也活下来」的能力折成一张键表，键是 `remote:<end>:<providerKey>`，**只有一个生成者**（引文表 `facade-key-format` / `facade-keys`），**本端自己的能力不进这张表**（点名 `localEnd` 时本端被排除：引文表 `facade-excludes-local-end`）——「远端 provider」只有一个答案来源。
   - `brokerCall(state, key, now, { now, timeoutMs, localEnd })` 的判词是**闭集**，六个各是一个意思（引文表 `facade-codes` / `facade-call`）：`ok`（路通、交换被授权、那个端上有提供者在答）、`unknown-key`（**从来没有哪个端声明过这个键**——「不知道有它」不等于「知道它没了」；引文表 `facade-unknown-key`）、`service-gone`（曾经有过、现在不可用）、`not-granted`（路通，但两个端在那个方向上没有 granted 的交换）、`no-provider`（**这个端上**没人认领这个名字）、`provider-silent`（有提供者在答，而这一端够不着它）。判定次序**冻结且全序**（引文表 `facade-precedence`）：`unknown-key` → `service-gone` → `not-granted` → `no-provider` → `provider-silent` → `ok`；遇到「这个问题回答不了的入参」（键不是非空串、没点名 `localEnd`）⇒ **抛 `TypeError`**——照 R56：不许默认成功、也不许默认失败。
   - `service-gone` ＝ 需求正本里「失败映射为服务消失」那一步：链路消失（manifest 撤回／心跳越界／路径断）之后，**那个键从 `brokerKeys` 里消失、调用一律 `service-gone`**（引文表 `facade-service-gone`）——**成对读数**：同一时刻同一个键，一次在表里、一次不在（引文表 `facade-service-gone-paired`）。
   - `not-granted` **只问 `mayExchange`**（既有 owner，不重算：引文表 `facade-not-granted`）；`no-provider` 只问「**这个端上**有没有人认领」——别处有人声明过不算（引文表 `facade-no-provider`）。
   - **这一句必须写下来**：它**不是**内核的 service broker、**也不是** RPC provider，而是**我们自己的门面**（`ctx.get('linkCollab').broker`；引文表 `facade-not-a-kernel-broker` / `facade-published`），**只读账本、不新开文件、不读时钟、不碰网络**（引文表 `facade-reads-ledger-only`）；键空间也只覆盖我们自己 capability 面里的东西。真正「把 B 的 provider 注入内核的 key 空间」这一步**本轮不做**（内核只读），**别把它读成内核能力**。


## 八、团队互相招募／被招募：合并的授权纪律（R183 补写）

**先把结论说死**：两个团队要变成一棵树，只有一条规矩能让「谁是父」只有一个答案——**合并永远不写别人的 `team/state`**。**被并入方自己的 lead 写自己团队的那一行**（它的 `parent` ＝ 并入方团队），`team/merge` 只记录「这次改动是**谁**授权的」。申请方替别人写 parent ⇒ 具名拒 `MERGE_NOT_AUTHORIZED`，账本**逐字节不变**。既有的 `team-parent-arbitration` / `subagent-contention` 两道门守的就是「一棵树只有一个写 parent 的人」这个形状，招募不许成为把它破坏掉的新入口。

### 事实与方向

| 字段 | 意思 |
|---|---|
| `from` | **申请方**团队，也是这条记录的 `subject`：一个**有序对** `(from, to)` 就是它的地址——反方向是另一个问题，不是「同一件事的另一种说法」 |
| `to` | 被申请的团队 |
| `mode` | 方向：`join` / `absorb`（见下表）。**方向是数据**，因为「B 加入 A」与「A 加入 B」是两个事实（引文表 `merge-modes`） |
| `state` | `requested` / `granted` / `denied`——**只有 `granted` 会改树**（引文表 `merge-states`）；`requested` 与 `denied` 都是账本上诚实的事实，不是「没发生」 |
| `by` | 写这一行的人：请求时＝申请方自己的 lead；同意／拒绝时＝**被并入方自己的 lead** |
| `at` | 有限毫秒整数 |

构造器是 `mergeRecord(input)`（一个对象参数；引文表 `merge-record-fields`），kind 名是 `team/merge`（引文表 `merge-kind`）。

**方向语义（冻结，别猜）**：

| `mode` | 谁被并入谁 | 被并入方（**唯一**合法的同意者） |
|---|---|---|
| `join` | 申请方 `from` 被 `to` 招募：`from` 成为 `to` 的子团队（引文表 `merge-mode-join`） | **`from`** |
| `absorb` | 申请方 `from` 招募 `to`：`to` 成为 `from` 的子团队（引文表 `merge-mode-absorb`） | **`to`** |

⇒ **方向决定谁是被并入方；同意行只能由被并入方自己的 lead 写**——两种方向都不例外（引文表 `merge-not-authorized` / `merge-only-merged-in-answers`）。

### 四条纪律（照 lead 间握手那条线，一条不少）

1. **请求 ≠ 许可**：`requested` **不改任何树**——只有请求时 `mayMerge` 读 false（引文表 `merge-request-not-permission` / `merge-pair-granted` / `merge-may-merge`）；回答工具里「不是布尔」的 `grant` 也被拒（`MERGE_GRANT`）。
2. **同意行只能由被并入方自己的 lead 写**：写 parent 的人不是被并入方自己的 lead ⇒ `MERGE_NOT_AUTHORIZED`，**账本与树都不变**。三种情形都拒：这个 writer 在本账本里**没有**领的团队；点名的 `team` **不是**这个 writer 领的；点名的 `team` **不是被并入方**（引文表 `merge-not-authorized`）。申请方**替别人写 parent** 也归这一条。
3. **`denied` 清 `granted`：按 `seq` 定胜负，不按到达顺序**：同一个有序对 `(from, to)` 里更晚的事实胜（引文表 `merge-winner-by-seq` / `merge-pairs`），所以一个更晚的 `denied` 清掉更早的 `granted`——不需要第二套机制。折出来的**胜者**进 `pairs`，而**整段历史**留在 `merges` 里（引文表 `merge-fold`），因此「这一对有没有被同意过」是可查的。**成对读数**：把同一对的三行**重新编号**，「denied」拿最小 `seq` 与拿最大 `seq` 折出**相反**的答案——赢家是 `seq`，不是词。
4. **先握手后合并**：`mayExchange(state, from, to)` 必须为真，否则 `MERGE_PEER_REQUIRED`（**请求侧与回答侧都查**；引文表 `merge-handshake-first` / `merge-peer-required`）——「两个 lead 能不能通话」的**唯一 owner 仍是 `mayExchange`**，合并不许自己再算一遍（引文表 `merge-handshake-owner`）。

### 一次授权 ＝ 两行（两条事实、一个调用）

- `granted` 的那一次调用**先写被并入方自己的 `team/state`**（`parent` ＝ 并入方团队，并保留那一队原有的 lead），**再写授权行 `team/merge`**（引文表 `merge-grant-writes-tree` / `merge-answer-row` / `merge-two-facts-one-call`）；`denied` **只写一行**、不动树（引文表 `merge-denial-one-row`）。
- **合并只动被并入方一个节点**：别人的 `team/state` 一行都不写——这是上面第 2 条的另一面。
- 门要数的形状：**授权 ⇒ 恰好 2 行；拒绝 ⇒ 恰好 1 行**——一行不许漏，也不许有第三行（**两个写 parent 的人就是两个答案**，所以这条不是格式问题）。

### 具名拒绝（写清什么时候出现）

| 码 | 什么时候出现 | 落点（引文表） |
|---|---|---|
| `MERGE_INPUT` | 参数不是对象 | `merge-input-refusal` |
| `MERGE_SELF` | `from` 与 `to` 相同（一个团队不能当自己的父） | `merge-self-refusal` |
| `MERGE_MODE` | `mode` 不是 `join` 也不是 `absorb` | `merge-mode-refusal` |
| `MERGE_STATE` | `state` 不在这三个词里 | `merge-state-refusal` |
| `MERGE_AT` | `at` 不是有限的毫秒数 | `merge-at-refusal` |
| `MERGE_GRANT` | 回答工具里 `grant` 不是布尔——**请求不是回答** | `merge-grant-refusal` |
| `MERGE_LOCAL_TEAM` | 这个 writer 在本账本里领的团队**不是恰好一个**（0 个或 2 个以上都拒：请求只来自一个团队） | `merge-local-team-refusal` |
| `MERGE_REQUEST_NONE` | 要回答的那个有序对在账本里**没有站立的行**（反方向是另一对） | `merge-request-none` |
| `MERGE_REQUEST_AMBIGUOUS` | 同一个 `from` 有多条站立行，而你**没点名** `team`——**不猜哪棵树要动** | `merge-request-ambiguous` |
| `MERGE_ALREADY_GRANTED` | 已经 `granted` 了又再发一次请求（请求会静默清掉已经谈成的同意 ⇒ 拒绝；要重开就回答 `denied`） | `merge-already-granted` |
| `MERGE_PEER_REQUIRED` | 两个团队在那个方向上**没有 granted 的握手**（请求侧与回答侧都查） | `merge-peer-required` |
| `MERGE_NOT_AUTHORIZED` | 写 parent 的人不是被并入方自己的 lead（三种情形见上面第 2 条） | `merge-not-authorized` |
| `MERGE_FROM_EMPTY` / `MERGE_FROM_NAME` / `MERGE_TEAM_EMPTY` / `MERGE_TEAM_NAME` | 字段**空**或**不是合法名字**：由同一个合成器给出（前缀 ＋ 大写字段名 ＋「空」/「不是名字」后缀），所以名字是**可预测**的——`from` 走前者那一对，`team` 走后者那一对；记录层同一个合成器还管 `to` 与 `by`（后缀同前，本页不逐条列） | `merge-field-codes-request` / `merge-field-codes-answer` / `merge-field-codes` |

**模型侧的写入口**是我们自己的两个**默认注册**的工具（`team_request_merge` / `team_answer_merge`，引文表 `merge-tools-registered`）；它们只做一件事：按上面这些规则写上面那几条事实——**判据是这一页，工具只是这套规则的一个写者**。

**边界（写清楚，免得你以为它比实际更强）**：① 合并**不是输赢**：`requested`、`denied` 都留在账本上，被拒之后账本上留下的是「有人试过」这件事本身。② 本章只覆盖**同构账本面**（网内可达、走 relay 中继的端）；真平台（HanaAgent / OpenCode / Codex 这类）的招募**不在**本轮，别把「机制在」读成「平台已接」。③ 合并**不改别人的 `team/state`**：两个团队各自的 lead 仍各自领自己的队，合并只写被并入方的 `parent`。

## 六、这份页面的引文（**机器核对**，别只信人眼）

下面这张表是这份页面的**判据表**：它把「页里写的每条规则」钉到**已出货源码**的 `file:line` 与**该行必须含有的文本**上。`scripts/check-protocol-page.mjs` 每次都会逐行核对——**行号会随源码改动而失效，这是设计**：源码一动、这张表就得有人来对齐，页不许悄悄过期。

<!-- citations -- checked by scripts/check-protocol-page.mjs; keep line numbers and fragments in sync -->
| id | where | must contain |
|---|---|---|
| own-page-one-hop | plugins/dsh-link-collab/src/index.ts:191 | This log's own records, in the order this log produced them. |
| regroup-helper | scripts/verify-collab-multihop.mjs:50 | const regroupByOrigin = (log) => { |
| writer-name-doc | plugins/dsh-link-collab/src/index.ts:147 | relays them. Two devices sharing one name is the configuration this replaces. |
| record-shape | plugins/dsh-link-collab/src/index.ts:240 | export interface RelayRecord { |
| batch-shape | plugins/dsh-link-collab/src/index.ts:256 | export interface RelayBatch { |
| adopt-field | plugins/dsh-link-collab/src/index.ts:268 | readonly adopt?: boolean |
| body-limit | plugins/dsh-link-collab/src/index.ts:354 | const RELAY_BODY_LIMIT = 4 * 1024 * 1024 |
| relay-path | plugins/dsh-link-collab/src/index.ts:357 | const RELAY_PATH = '/api/dsh-link-collab/relay' |
| auth-scheme | plugins/dsh-link-collab/src/index.ts:483 | authorization.replace(/^bearer[ \t]+/i, '') |
| auth-refusal | plugins/dsh-link-collab/src/index.ts:485 | refuse(401, 'UNAUTHORIZED') |
| method-refusal | plugins/dsh-link-collab/src/index.ts:486 | refuse(405, 'METHOD') |
| content-type-refusal | plugins/dsh-link-collab/src/index.ts:489 | refuse(415, 'CONTENT_TYPE') |
| too-large-refusal | plugins/dsh-link-collab/src/index.ts:501 | refuse(413, 'TOO_LARGE') |
| success-body | plugins/dsh-link-collab/src/index.ts:515 | answer(res, 200, { ok: true, appended: result.appended, skipped: result.skipped }) |
| refusal-body | plugins/dsh-link-collab/src/index.ts:475 | detail === undefined ? { ok: false, code } : { ok: false, code, error: detail } |
| refusal-codes | plugins/dsh-link-collab/src/index.ts:307 | readonly code: 'RELAY_GAP' ; RELAY_HOLE ; RELAY_WRITER_MISSING ; RELAY_REWRITTEN ; RELAY_CONFLICT ; RELAY_MALFORMED ; RELAY_IMPERSONATION |
| member-fields | plugins/dsh-link-collab/src/index.ts:1619 | record.payload as { id?: unknown, state?: unknown, owner?: unknown, deps?: unknown } |
| team-attribution | plugins/dsh-link-collab/src/index.ts:1362 | return text(record.actor) ?? text(payload?.teamId) ?? text(payload?.team) |
| heartbeat-builder | plugins/dsh-link-collab/src/index.ts:2764 | export function heartbeatRecord(memberId: string, at: number) |
| host-builder | plugins/dsh-link-collab/src/index.ts:3952 | export function hostRecord(memberId: string, end: string, via: string |
| conflict-throw | plugins/dsh-link-collab/src/index.ts:961 | throw new RelayError('RELAY_CONFLICT' |
| own-name-refusal | plugins/dsh-link-collab/src/index.ts:881 | if (batch.writer === localWriter) { |
| own-stream-seq | plugins/dsh-link-collab/src/index.ts:91 | readonly originSeq?: number |
| lease-kind | plugins/dsh-link-collab/src/index.ts:6873 | export const RETRY_LEASE_KIND = 'task/retry-lease' |
| lease-builder | plugins/dsh-link-collab/src/index.ts:6912 | export function retryLeaseRecord(root: string, end: string, at: number, untilMs: number) |
| lease-fields | plugins/dsh-link-collab/src/index.ts:6916 | return { kind: RETRY_LEASE_KIND, subject: root, payload: { root, end, at, untilMs } } |
| lease-validation | plugins/dsh-link-collab/src/index.ts:6915 | retryLeaseRecord: untilMs must be a positive integer |
| lease-projection | plugins/dsh-link-collab/src/index.ts:6951 | return rows.sort((left, right) => left.at - right.at |
| lease-owner | plugins/dsh-link-collab/src/index.ts:6969 | export function retryOwner(leases: readonly RetryLease[], options: { root: string, localEnd: string, now: number }) |
| lease-liveness | plugins/dsh-link-collab/src/index.ts:6972 | const live = relevant.filter((lease) => options.now - lease.at < lease.untilMs) |
| lease-tiebreak | plugins/dsh-link-collab/src/index.ts:6974 | const ordered = [...live].sort( |
| lease-held | plugins/dsh-link-collab/src/index.ts:7020 | blocked.push({ from: id, attempt: next, reason: 'lease-held' }) |
| lease-claim-first | plugins/dsh-link-collab/src/index.ts:7072 | written.push(await log.append(retryLeaseRecord(root, options.localEnd, options.now, options.timeoutMs))) |
| lease-refold | plugins/dsh-link-collab/src/index.ts:7073 | Re-folded from the ledger rather than patched in memory |
| lease-actor | plugins/dsh-link-collab/src/index.ts:7092 | actor: options.localEnd, |
| lease-mismatch | plugins/dsh-link-collab/src/index.ts:6422 | refusedDispatches.push({ id: request.id, at: request.at, seq: record.seq, reason: 'lease-mismatch' }) |
| lease-readable-kind | plugins/dsh-link-collab/src/index.ts:7105 | DISPATCH_KIND, RESULT_KIND, RETRY_LEASE_KIND |
| lease-retries-only | plugins/dsh-link-collab/src/index.ts:6417 | if (request.retryOf !== undefined) { |
| heartbeat-liveness | plugins/dsh-link-collab/src/index.ts:2862 | liveness: (sinceMs >= timeoutMs ? 'unhealthy' : 'healthy') |
| dispatch-stale | plugins/dsh-link-collab/src/index.ts:6563 | now - entry.at >= threshold ? 'stale' : 'pending' |
| route-down | plugins/dsh-link-collab/src/index.ts:4152 | reason: 'route-down', path: stopped, loop: [] |
| member-silent | plugins/dsh-link-collab/src/index.ts:4256 | if ((livenesses.get(member) ?? 'unknown') !== 'healthy') return { ok: false, reason: 'member-silent' |
| manifest-kind | plugins/dsh-link-collab/src/index.ts:4293 | export const MANIFEST_KIND = 'end/manifest' |
| manifest-protocols | plugins/dsh-link-collab/src/index.ts:4303 | MANIFEST_PROTOCOLS: readonly string[] = ['dsh-link-device/1'] |
| manifest-end-namespace | plugins/dsh-link-collab/src/index.ts:4290 | the same namespace `member/host` already uses for `end` |
| manifest-via-same-word | plugins/dsh-link-collab/src/index.ts:4270 | the same word with the same meaning |
| manifest-fields | plugins/dsh-link-collab/src/index.ts:4458 | export function manifestRecord(input: unknown) ; protocolVersion: string, capabilities: string[], at: number |
| manifest-input-refusal | plugins/dsh-link-collab/src/index.ts:4460 | MANIFEST_INPUT |
| manifest-end-refusal | plugins/dsh-link-collab/src/index.ts:4464 | MANIFEST_END ; end is required and must be a non-empty name |
| manifest-via-refusal | plugins/dsh-link-collab/src/index.ts:4472 | MANIFEST_VIA ; names the end itself |
| manifest-platform-refusal | plugins/dsh-link-collab/src/index.ts:4476 | MANIFEST_PLATFORM |
| manifest-version-refusal | plugins/dsh-link-collab/src/index.ts:4480 | MANIFEST_VERSION ; supported: |
| manifest-capability-syntax | plugins/dsh-link-collab/src/index.ts:4489 | MANIFEST_CAPABILITY ; which is not a name |
| manifest-capability-registry | plugins/dsh-link-collab/src/index.ts:4544 | MANIFEST_CAPABILITY ; not in the capability registry |
| manifest-at-refusal | plugins/dsh-link-collab/src/index.ts:4495 | MANIFEST_AT |
| manifest-registry-authority | plugins/dsh-link-collab/src/index.ts:4542 | membersWith(state, name).length === 0 |
| manifest-append | plugins/dsh-link-collab/src/index.ts:4540 | export async function appendManifest(state: TeamState, log: ControlLog, input: unknown) |
| manifest-refusal-before-write | plugins/dsh-link-collab/src/index.ts:4530 | A refusal happens before the append |
| manifest-readback | plugins/dsh-link-collab/src/index.ts:4565 | projectManifests(log.replay()).ends.find((row) => row.end === draft.payload.end) |
| manifest-fold | plugins/dsh-link-collab/src/index.ts:4591 | export function projectManifests(records: readonly ControlRecord[]): ManifestState |
| manifest-winner-by-seq | plugins/dsh-link-collab/src/index.ts:4620 | previous.seq > record.seq |
| manifest-withdrawal | plugins/dsh-link-collab/src/index.ts:4619 | declare it again with less |
| manifest-recognised-only | plugins/dsh-link-collab/src/index.ts:4615 | const capabilities = declared.filter((name) => known.has(name)) |
| manifest-malformed-counted | plugins/dsh-link-collab/src/index.ts:4616 | if (capabilities.length !== declared.length) malformed += 1 |
| manifest-declared-visible | plugins/dsh-link-collab/src/index.ts:4356 | name the registry does not recognise is visible here |
| manifest-via-path-is-fold | plugins/dsh-link-collab/src/index.ts:4272 | never an array inside one row ; the failure R44 removed |
| readable-kinds | plugins/dsh-link-collab/src/index.ts:7105 | MANIFEST_KIND, MERGE_KIND |
| decay-owner | plugins/dsh-link-collab/src/index.ts:4689 | export function effectiveCapabilities(state: TeamState, end: string, now: number, options: CapabilityOptions) |
| decay-codes | plugins/dsh-link-collab/src/index.ts:4627 | export type CapabilityMissCode ; 'NO_MANIFEST' ; 'PEER_SILENT' ; 'ROUTE_DOWN' |
| decay-intersection | plugins/dsh-link-collab/src/index.ts:4743 | if (reached.every((row) => row.capabilities.includes(name))) capabilities.push(name) |
| decay-no-manifest | plugins/dsh-link-collab/src/index.ts:4730 | missing.push({ hop, code: 'NO_MANIFEST' }) |
| decay-silence-vs-road | plugins/dsh-link-collab/src/index.ts:4736 | hop === end ? 'PEER_SILENT' : 'ROUTE_DOWN' |
| decay-timeout-boundary | plugins/dsh-link-collab/src/index.ts:4653 | The boundary is `sinceMs >= timeoutMs`: the threshold counts as out |
| decay-unknown-not-silent | plugins/dsh-link-collab/src/index.ts:4678 | never beat reads `unknown` ; is **not** silence here either |
| decay-pure | plugins/dsh-link-collab/src/index.ts:4682 | come from the caller ; no clock is read |
| decay-local-end-hop | plugins/dsh-link-collab/src/index.ts:4717 | arrived !== local && byEnd.get(arrived)?.via === null |
| facade-key-format | plugins/dsh-link-collab/src/index.ts:4772 | return 'remote:' + end + ':' + providerKey |
| facade-keys | plugins/dsh-link-collab/src/index.ts:4788 | export function brokerKeys(state: TeamState, now: number, options: CapabilityOptions) |
| facade-excludes-local-end | plugins/dsh-link-collab/src/index.ts:4792 | if (local !== null && manifest.end === local) continue |
| facade-codes | plugins/dsh-link-collab/src/index.ts:4804 | export type BrokerCode ; 'ok' ; 'unknown-key' ; 'no-provider' ; 'provider-silent' ; 'not-granted' ; 'service-gone' |
| facade-precedence | plugins/dsh-link-collab/src/index.ts:4833 | The precedence is fixed and total ; each answer means one thing |
| facade-call | plugins/dsh-link-collab/src/index.ts:4859 | export function brokerCall(state: TeamState, key: string, now: number, options: BrokerCallOptions) |
| facade-unknown-key | plugins/dsh-link-collab/src/index.ts:4871 | if (hit === undefined) return { code: 'unknown-key' |
| facade-service-gone | plugins/dsh-link-collab/src/index.ts:4874 | return { code: 'service-gone' ; reading.missing[0].code |
| facade-service-gone-paired | plugins/dsh-link-collab/src/index.ts:4839 | paired with {@link brokerKeys} by construction |
| facade-not-granted | plugins/dsh-link-collab/src/index.ts:4882 | if (!mayExchange(state, local, hit.end)) return { code: 'not-granted' |
| facade-no-provider | plugins/dsh-link-collab/src/index.ts:4889 | if (onEnd.length === 0) return { code: 'no-provider' |
| facade-not-a-kernel-broker | plugins/dsh-link-collab/src/index.ts:9871 | our own facade ; not the kernel's service |
| facade-reads-ledger-only | plugins/dsh-link-collab/src/index.ts:9873 | no file is opened, no clock is read, no socket is touched |
| facade-published | plugins/dsh-link-collab/src/index.ts:9875 | keys: (state, now, options) => brokerKeys(state, now, options) |
| merge-kind | plugins/dsh-link-collab/src/index.ts:4932 | export const MERGE_KIND = 'team/merge' |
| merge-modes | plugins/dsh-link-collab/src/index.ts:4941 | export type MergeMode ; 'join' ; 'absorb' |
| merge-states | plugins/dsh-link-collab/src/index.ts:4944 | export type MergeStateName ; 'requested' ; 'granted' ; 'denied' |
| merge-mode-join | plugins/dsh-link-collab/src/index.ts:4937 | is taken in by ; becomes `to`'s child |
| merge-mode-absorb | plugins/dsh-link-collab/src/index.ts:4938 | takes `to` in ; becomes `from`'s child |
| merge-record-fields | plugins/dsh-link-collab/src/index.ts:5011 | export function mergeRecord(input: unknown) ; payload: { from: string, to: string, state: MergeStateName, mode: MergeMode, by: string, at: number } |
| merge-input-refusal | plugins/dsh-link-collab/src/index.ts:5013 | MERGE_INPUT ; describeValue(input) |
| merge-self-refusal | plugins/dsh-link-collab/README.md:605 | MERGE_SELF |
| merge-mode-refusal | plugins/dsh-link-collab/src/index.ts:5025 | MERGE_MODE ; the asking team is taken in ; the asking team takes the other in |
| merge-state-refusal | plugins/dsh-link-collab/src/index.ts:5029 | MERGE_STATE ; is not one of the three this vocabulary holds |
| merge-at-refusal | plugins/dsh-link-collab/src/index.ts:5033 | MERGE_AT |
| merge-fold | plugins/dsh-link-collab/src/index.ts:5048 | export function projectMerges(records: readonly ControlRecord[]): MergeState |
| merge-winner-by-seq | plugins/dsh-link-collab/src/index.ts:5065 | Rows are already in sequence order, so the last write for a pair is the winner |
| merge-pairs | plugins/dsh-link-collab/src/index.ts:5068 | winners.set(row.from + '->' + row.to, row) |
| merge-may-merge | plugins/dsh-link-collab/src/index.ts:5088 | export function mayMerge(state: TeamState, from: string, to: string): boolean |
| merge-handshake-first | plugins/dsh-link-collab/src/index.ts:5089 | if (!mayExchange(state, from, to)) return false |
| merge-pair-granted | plugins/dsh-link-collab/src/index.ts:5090 | state.merges.pairs.find((pair) => pair.from === from && pair.to === to) ; === 'granted' |
| merge-request-not-permission | plugins/dsh-link-collab/src/index.ts:9072 | const: 'requested' ; a request is not a permission |
| merge-local-team-refusal | plugins/dsh-link-collab/src/index.ts:9089 | MERGE_LOCAL_TEAM |
| merge-handshake-owner | plugins/dsh-link-collab/src/index.ts:9098 | The question is mayExchange's and nothing else's |
| merge-peer-required | plugins/dsh-link-collab/src/index.ts:9100 | MERGE_PEER_REQUIRED ; have no granted handshake in that direction ; ' and ' + team + ' |
| merge-already-granted | plugins/dsh-link-collab/src/index.ts:9108 | MERGE_ALREADY_GRANTED ; a request would clear it |
| merge-two-facts-one-call | plugins/dsh-link-collab/src/index.ts:9136 | A grant is the moment a tree changes |
| merge-denial-one-row | plugins/dsh-link-collab/src/index.ts:9179 | Absent on a denial: a denial writes one row |
| merge-grant-refusal | plugins/dsh-link-collab/src/index.ts:9194 | MERGE_GRANT ; grant must be true or false |
| merge-request-none | plugins/dsh-link-collab/src/index.ts:9207 | MERGE_REQUEST_NONE |
| merge-request-ambiguous | plugins/dsh-link-collab/src/index.ts:9214 | MERGE_REQUEST_AMBIGUOUS |
| merge-not-authorized | plugins/dsh-link-collab/src/index.ts:9236 | MERGE_NOT_AUTHORIZED ; a merge writes the parent of |
| merge-only-merged-in-answers | plugins/dsh-link-collab/src/index.ts:9237 | is not it; only that party ; two writers of one parent is two answers to one question |
| merge-grant-writes-tree | plugins/dsh-link-collab/src/index.ts:9250 | treeSeq = await log.append({ ...declaration, actor: log.writer }) |
| merge-answer-row | plugins/dsh-link-collab/src/index.ts:9254 | const seq = await log.append({ ...record, actor: mergedIn }) |
| merge-field-codes | plugins/dsh-link-collab/src/index.ts:7999 | const code = prefix + field.toUpperCase() |
| merge-tools-registered | plugins/dsh-link-collab/src/index.ts:9487 | ...mergeTools({ log }) |
| merge-field-codes-request | plugins/dsh-link-collab/README.md:605 | team_request_merge ; MERGE_TEAM_EMPTY ; MERGE_TEAM_NAME |
| merge-field-codes-answer | plugins/dsh-link-collab/README.md:606 | team_answer_merge ; MERGE_FROM_EMPTY ; MERGE_FROM_NAME |
| manifest-not-authorized | plugins/dsh-link-collab/src/index.ts:4559 | MANIFEST_NOT_AUTHORIZED ; this ledger knows its writer |
| manifest-not-authorized-relay | plugins/dsh-link-collab/src/index.ts:909 | MANIFEST_NOT_AUTHORIZED ; carries an end/manifest row for |
<!-- /citations -->

规则：**`must contain` 里用 ` ; ` 分隔的每一段都必须出现**（用于一行里要同时出现的多个片段）；核对时空白会被归一化，但**字符串本身不许改写**。

