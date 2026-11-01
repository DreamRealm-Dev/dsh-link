# 工具组契约页（md 第 10 条）：组是什么 · 两个扩展点 · 定义形状 · 拒绝码全集 · 代价 · 五条已知限制

> 本页是 **R194 P2** 的交付物，逐条对应 `docs/handoff/R194-contract.md:35`（P2 要的六项：组是什么、两个扩展点与何时用哪个、定义形状、拒绝码、代价、五条限制）。读者是**第三方插件作者**。
> 每条断言指到**真实存在的 `file:line`**；页尾 `<!-- citations -->` 表由 `node scripts/check-protocol-page.mjs --page docs/dev/tool-groups.md` 逐行机器核对（§八 是本轮实跑输出）。
> **本页没有出处的规则一行都不写。** 行号会随源码改动失效，**这是设计**：源码一动就得有人回来对齐，页不许悄悄过期。

## 〇、写就口径（可复现）

- **写就时刻**：2026-10-17（本机），写者 = R194 生产者 **P1/P2**。写范围只有 `plugins/dsh-link-groups/**` 与 `docs/dev/tool-groups.md`；**没碰** `core/deepseek-harness/**`（内核 pin 住，`kernel.lock.json:2`）、`scripts/**`、`docs/handoff/**`、活体端口 31761/31760/9222，也没跑任何会写盘的 git 命令。
- **四个读数**：`node plugins/build.mjs` 生成 `plugins/dsh-link-groups/lib/index.js`（**派生文件，不许手写**，`plugins/build.mjs:6`）；门 115 `node scripts/verify-tool-groups.mjs` → **22 readings, 0 failed**；门 116 `node scripts/verify-tool-groups-approval.mjs` → **23 readings, 0 failed**；本页配对的生产者冒烟 `node plugins/dsh-link-groups/test/seam-smoke.mjs` → **17 readings, 0 failed**（§三、§五 的读数行号都指它）。
- **本页判不了什么**（第三态，不当绿用）：缝在**真客户端**里的加载行为没有门（门 117 是单跑活体门，不在本轮范围）；`entries/bytes` **不是 token**，更不是缓存命中率（§五）；组状态不进会话日志（§六 第 1 条），所以「重启后还在」本页不承诺。

---

## 一、工具组是什么

**工具组 = 可同时开放、同时收回的一组工具**，外加两个永远在面上的入口工具：`tool_groups`（只读目录，无参数，`plugins/dsh-link-groups/src/index.ts:81`）与 `tool_groups_declare`（一次开关多组，`:84`）。两个入口注册在 **agent 自己的层**上，所以任何限制器都收不走它们（`plugins/dsh-link-groups/README.md:17`）。

**三个配置态**（`on` / `off` / `auto`）和一个**当前事实** `open: true|false`。两者是两个字段、永不互换：渲染时行首的 `OPEN`/`closed` 取 `open`（`src/index.ts:458`），`state=` 取配置值（`src/index.ts:459`）。`state: 'on'` 装上就开（`src/index.ts:232` 的 `initialOpen`），其余装上即关。

**关闭是硬门控，不是标签**：关闭组成员从模型可见的工具面消失（内核只在每一层都放行时才算可见，`core/deepseek-harness/packages/core/tools/src/index.ts:1200`），执行面回 `Error: unknown tool "…"`（同一个文件 `:1247` 的 `resolveExecution` 找不到定义就是 UNKNOWN_TOOL），与一个从未注册过的名字**逐字节同文**——生产者冒烟把这条件测成读数：关闭组员答 `Error: unknown tool "third_alpha"`，从未注册的名字答 `Error: unknown tool "seam_never_registered"`，除名字外逐字节相同（`plugins/dsh-link-groups/test/seam-smoke.mjs:209`）。

**生效点只有一个**：`const EFFECTIVE = 'next-step'`（`src/index.ts:113`）。声明的那一步看不到变化，变化落在**下一步的装配**。

**目录不是 schema**：`renderCatalog`（`src/index.ts:477`）只渲染组 id、开/关、配置态、成员的**名字**和一行原因（正文从 `:478` 的 `catalogPreamble` 起）——一个关闭的组不占任何 schema 预算。

**一个组不是「某个插件的工具集合」**：成员是写下来的权威清单，一个组可以跨两个插件，同一个插件也可以按需要进几个组（`plugins/dsh-link-groups/README.md:97`、`:94`）。

---

## 二、两个扩展点，以及什么时候用哪个

只有两个地方能往目录里加组，二者共用一个目录、一条门控路径：`activate.restrict({ deny })`（`src/index.ts:773`）是它们**唯一**的执行机制。

| 扩展点 | 谁写、写在哪 | 生命周期 | 能决定 | 不能决定 |
|---|---|---|---|---|
| **配置行** `config.groups` | 部署档案里**唯一那一行** `link-groups`（shipped 样例 `plugins/dsh-link-groups/cordis.patch.yml:23` 起）；`resolveConfig` 只读自己这一行（`src/index.ts:149`） | 随档案；改它 = 改部署 | `state: on\|off\|auto`、`userDisabled`（开关要审批）、`relockable`、`provider` 交叉核对 | 插件不能在运行时增删 |
| **服务缝** `linkGroups` | 插件自己：服务名 `src/index.ts:121`，`apply` 里 `provide`（`:1064`），消费方 `ctx.get('linkGroups')` | 随插件：`registerGroup` 的 disposer 一跑就撤 | 只有「加一个关闭的 `state: 'auto'` 组」 | 不能 `on`/`off`/`userDisabled`/`relockable`（缝里的组固定 `src/index.ts:626`、`:628`、`:629`） |

**怎么选**（判据是所有权，不是喜好）：

- 组属于**部署口径**（装机就该开、或用户明说过关、或要跨插件编组、或要 `relockable`）⇒ **配置行**。这些决定只有部署者/用户能做（`plugins/dsh-link-groups/README.md:94`）。
- 组属于**这个插件自己的能力**（工具由它注册，能力由它决定何时可用），或不许改部署档案 ⇒ **服务缝**。插件卸载时组必须消失，这也是缝才有的性质。
- **两边都写同一个 id = 具名拒绝**，不是合并：`registerGroup` 抛 `LINK_GROUPS_DUPLICATE_GROUP`（`src/index.ts:705`）。冒烟把「抢 config 的 id」与「重复注册自己的 id」各测一次，且断言面与目录都没动（`plugins/dsh-link-groups/test/seam-smoke.mjs:253`）。

**`GROUPS_COLLISION` 不是缝的重复码**：它是「这个 agent 上已经解析得到 `tool_groups`/`tool_groups_declare` 这个名字，入口工具装不上它自己的层」（`src/index.ts:872`、`:873`），实际形态就是**同一份组合里插了第二行 `link-groups`**——那一行对这个 agent 的整次安装失败，第一行照旧。这个码的含义**没有被缝改写**（P1 的冻结要求见 `docs/handoff/R194-contract.md:29`）。冒烟 S16 观测到第二页：服务名被占 ⇒ `LINK_GROUPS_SERVICE_TAKEN` 警告 + `GROUPS_COLLISION`，服务本身仍由第一页回答（`seam-smoke.mjs:302`）。

**没有 page 时是什么样**：服务就是「什么都没提供」，`ctx.get('linkGroups')` 得 `undefined`（冒烟 `seam-smoke.mjs:172`）——「一个没有服务的 page 什么都不回答」。要**不许缺少**它的消费方，把 `'linkGroups'` 写进 `inject`（`plugins/dsh-link-groups/README.md:106`）：cordis 在服务出现前不会加载它，这就是「能命名它的缺席」。**反过来也成立**：第三方插件先声明、page 后到，cordis 在服务出现的那一刻加载它并完成注册——目录、mask 与卸载后的还原都测成了读数（冒烟 S17，`plugins/dsh-link-groups/test/seam-smoke.mjs:341`）。

---

## 三、`registerGroup` 的精确形状与生命周期

```js
const dispose = seam.registerGroup({
  id: 'notes',                           // 必填，小写标识符，规则与 config 组相同
  title: 'Notes',                        // 可省，省略 = id
  members: ['notes_list', 'notes_add'],  // 必填，非空工具名数组（权威成员表）
  autoWhen: 'declare',                   // 可省，缺省 'declare'；也可 'device' / 'after' / { when, after }
})
```

- **整体校验**：`resolveDefinition`（`src/index.ts:608`）要求对象（`:609`），`id` 匹配 `/^[a-z0-9][a-z0-9._-]*$/u`（`:613`），`members` 非空字符串数组（`:617`），`title` 省略取 `id`（`:622`）。
- **规范化后的组**：`state: 'auto'`（`:626`）、`userDisabled: false`（`:628`）、`relockable: false`（`:629`）——「装上就关、只能声明打开、不可再关回」。`autoWhen` 由 `resolveDefinitionAuto`（`:643`）解析：省略 = `{ when: 'declare' }`（`:644`），非法值 = `LINK_GROUPS_INPUT`（`:651`），`after` 必须点名依赖（`:655`）且不许自依赖（`:657`）。
- **返回值**：一个**幂等 disposer**（`src/index.ts:723`）。它把组从目录里删掉，并对**每个已安装 agent** 走 `record.retract`（`:729`）；`retract` 抬掉 mask、删掉状态（`:904`）。冒烟：dispose 之后工具面**逐字节**回到注册前（`seam-smoke.mjs:228`）。
- **`groups()` 的行**：`{ id, title, origin, state, members, autoWhen }`（`src/index.ts:671` 的 `definitionRow`），`origin` ∈ `'config'` | `'contributed'`；**config 行在前、contributed 行按注册顺序在后**（`src/index.ts:695`-`:697`）。config 行的 `tools`/`auto` 在行里读作 `members`/`autoWhen`（`src/index.ts:677`）。

**到达「已经装好的」agent（本轮的核心性质）**：

1. `registerGroup` 当场对每个在册安装调 `record.admit(group)`（`src/index.ts:713`）——**没有轮询、不用重启**。
2. `admit` **现读一次**工具面（`src/index.ts:890`），所以「组先注册、成员工具后注册」也认得出来；随后走与 config 组**同一条** `sync → mask → activate.restrict`（`:895`）。
3. 成员一个都不在 ⇒ 不抛，组读作 `broken` + `GROUPS_NO_TOOLS`（`src/index.ts:300`；冒烟 `seam-smoke.mjs:237`）。
4. 成员注册在 **agent 自己那层** ⇒ 限制器不能命名它，`admit` 记成 `unrestrictable`，组读作 `broken`，**不是**抛出去留半个 mask（`src/index.ts:901`；原因句在 `:294`；冒烟 `seam-smoke.mjs:288` 读到 `blocked: GROUPS_NO_TOOLS: registered on the agent own layer`）。
5. **自动路径同样可用**：`autoWhen: 'device'` 的贡献组由它自己的插件调 `requestAutoOpen(ctx, agent, id, why)`（`src/index.ts:984`）打开，走的还是同一条开放路径（冒烟 `seam-smoke.mjs:273`）。
6. 注册之前该组员还只是普通全局工具（冒烟 `seam-smoke.mjs:199` 读到 1769 B 的面），注册的一刻被 mask 掉（1549 B）。

---

## 四、拒绝码全集

**声明面/安装面的 9 个码**在工具结果里返回（模型可读）；**缝的 2 个码**抛给调用方（装配期就能看见）。两类不是一回事，别混。

| 码 | 谁产生 | 什么时候 | 出处 |
|---|---|---|---|
| `GROUPS_INPUT` | `tool_groups_declare` 返回 | 参数不是对象、列表不是字符串数组、什么都没点名、已经处于该状态、close 目标不 `relockable` | `src/index.ts:554` 的 `validateDeclare` |
| `GROUPS_UNKNOWN` | 同上 | id 不在目录里；已知 id 随结果回传 | `src/index.ts:554` |
| `GROUPS_DUP` | 同上 | 同一个 id 同时在 `open` 与 `close` | `src/index.ts:554` |
| `GROUPS_OFF` | `tools/pre-execute` **具名拒绝** | 声明要开一个 `state: 'off'` 的组；连问都不问（fail-closed） | 码表 `src/index.ts:109`，审批判定 `src/index.ts:325` |
| `GROUPS_DEPENDENCY` | 声明面返回 | `auto.when: 'after'` 的依赖没开 | `src/index.ts:290` 的 `blockedReason` |
| `GROUPS_NO_TOOLS` | 声明面返回 | 组成员**哪个层都够不到**，或成员在 agent 自己层 | `src/index.ts:300`、`:294` |
| `GROUPS_CHANNEL` | 安装/自动路径返回 | 拿不到 agent scope，限制器无处可装 | `src/index.ts:929` 的 `mountAgent` |
| `GROUPS_CATALOG` | `tool_groups` 抛 | 目录工具被塞了参数（它只报告、不改变） | `src/index.ts:81` 的工具定义 |
| `GROUPS_COLLISION` | 安装时**警告并跳过该 agent** | 入口工具名在这个 agent 上已经解析得到（一份组合里插了第二行） | `src/index.ts:872`-`:873` |
| `LINK_GROUPS_INPUT` | `registerGroup` **抛 TypeError** | 定义不是 `{ id, title, members, autoWhen? }` 或值不能用；**什么都没装** | `src/index.ts:131`、`:610`、`:613`、`:617` |
| `LINK_GROUPS_DUPLICATE_GROUP` | `registerGroup` **抛 Error** | id 已属于某个 config 组或另一个贡献组；**禁止静默合并**，什么都没装 | `src/index.ts:133`、`:705` |

**两类码的差别就是失败方式**：声明面的拒绝永远不改状态（门 116 读数 23 做的逐字节比较）；缝的拒绝是调用方写错了代码，必须在自己的装配期就炸，所以抛。

---

## 五、代价：三数字，和「落在下一步的 developer/message」

**每次 slide（一次声明）报三个数**（`src/index.ts:428` 的 `measureCost`）：`entries`（变化后 agent 能调多少件工具）、`bytes`（这些 schema 序列化后的 UTF-8 字节数）、`startsSeries`（下一步 `request/header` 是否起新序列）。模型看到的是这样一行（`src/index.ts:504`）：

```
- opened third (effective: next-step) · surface now 6 tools / 1769 bytes · next request/header.startsSeries=false
```

**变化真实落在哪**（不是承诺，是内核的日志协议）：工具面变了，内核写 **1 条 `request/header`、`reason: 'change'`**（`core/deepseek-harness/packages/core/agent-loop/src/agent.ts:626`、`:629`），并追加 **1 条 `developer/message`**，内容为每个新增工具的 `tool-addition` 行（`agent.ts:639`、`:643`），该条自己的 `surfaceOp` 是 `'append'`（`agent.ts:647`）。一个批量声明 = **一次** slide。

**组声明不写系统提示词**：这个插件**故意不监听** `system-prompt/assemble`（`src/index.ts:21`，理由：schema 省略不是强制）。所以组的变化**不产生任何 `system/message`**。会起 `system/message` 的是便条那条线，而本机活路由没有 `systemPromptUpdate: 'in-history'` 能力（`agent.ts:411` 读的就是这个能力），于是那条线是**头部重写**（`core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:95`-`:98`）——**那是便条的代价，不是组的代价**，别记到组头上。

**实测（活体，本轮审计记录）**：teams 组 61 件 / 53,678 B → 69 / 60,661 B（+6,983 B，8 件工具）；notes 组 61 / 53,678 B → 63 / 54,709 B（+1,031 B，2 件工具）（`docs/handoff/R194-contract.md:13`）。本机冒烟的小世界同一行读数是 `surface now 6 tools / 1769 bytes`（`plugins/dsh-link-groups/test/seam-smoke.mjs:220`）。

**这不是缓存命中率**：门 115 自己写明它读的是「provider 无关的代价三数字，不是任何 provider 的缓存命中率」（`scripts/verify-tool-groups.mjs:100`）。⇒ 本页只说「一次 slide 让下一请求的 `tools` 区变大多少」；**省了多少 token、缓存有没有被击穿，本页不承诺**。

---

## 六、五条已知限制（插件 README 自列，逐条）

1. **组状态活在进程里**：第三方插件不能往 `SessionEventMap` 加类型，持久化读路径会拒掉整份看不懂的日志，所以状态只在本进程、按 agent 记（`plugins/dsh-link-groups/README.md:157`；理由全文见 `src/index.ts:57` 起）。**重启或 resume 后组回到配置态**，要重新声明。⇒ 缝里注册的组一样：插件重新加载、重新 `registerGroup` 之后才回来。
2. **PTC preset 不许挂这一行**：`tools.restrict()` 拒绝命名 `run_code`，PTC 下模型直呼只能点那个传输，第三态在那种组合里没有定义（`plugins/dsh-link-groups/README.md:165`）。
3. **没有跨 agent 传播**：一个会话开了组，队友会话不会跟着开；子 agent 继承的是父的 preset 作用域键，不是父的组状态（`plugins/dsh-link-groups/README.md:169`）。
4. **没有 provider 自动发现**：`provider` 是配置里的交叉核对（成员名一个都不以它开头就警告一行），不是发现出来的事实（`plugins/dsh-link-groups/README.md:172`）。
5. **`auto.when: 'device'` 只发通道，不发触发器**：本包导出 `requestAutoOpen`（`src/index.ts:984`），把真实的设备/浏览器条件接到它身上，是拥有那个条件的插件的活（`plugins/dsh-link-groups/README.md:174`）。

---

## 七、最小示例：第三方插件加一个组

```js
// my-plugin/src/index.ts —— 只走公开的缝，不碰 link-groups 的配置行
export const name = 'my-plugin'
export const inject = ['tools', 'linkGroups']   // 没有 page 提供它，本插件不会被加载

export function apply(ctx) {
  ctx.tools.register(myTool('my_search'))       // 成员：本插件自己的工具
  const seam = ctx.get('linkGroups')
  ctx.effect(() => seam.registerGroup({
    id: 'my-search', title: 'My search', members: ['my_search'],
  }))
  // 若把 'linkGroups' 从 inject 去掉，就必须自己判 ctx.get('linkGroups') === undefined，
  // 那就是「能命名它的缺席」的另一种写法。
}
```

- 组进来是**关闭**的：模型要先用 `tool_groups_declare({ open: ['my-search'] })` 打开，**下一步**才看得见 `my_search`。
- `ctx.effect(...)` 在插件卸载时跑 disposer：组从目录里消失，工具面回到注册前的字节（`src/index.ts:723`）。
- id 撞了（config 组早用过）⇒ 抛 `LINK_GROUPS_DUPLICATE_GROUP`，装配期就炸，两条组不会悄悄并成一条（`src/index.ts:705`）。

---

## 八、核对器实跑（本页的自证）

```
$ node scripts/check-protocol-page.mjs --page docs/dev/tool-groups.md
  ok    tool-names  plugins/dsh-link-groups/src/index.ts:81  |  line 81 holds all 1 fragment(s)
  ok    smoke-s17  plugins/dsh-link-groups/test/seam-smoke.mjs:341  |  line 341 holds all 1 fragment(s)
  104 of 104 citation(s) hold

（上面两行是 104 行输出里的首尾两行，逐行的完整输出由该命令本身给出；退出码 0 = 每一行都成立。）
```

<!-- citations
| id | where | must |
|---|---|---|
| tool-names | plugins/dsh-link-groups/src/index.ts:81 | export const CATALOG_TOOL = 'tool_groups' |
| declare-tool | plugins/dsh-link-groups/src/index.ts:84 | export const DECLARE_TOOL = 'tool_groups_declare' |
| no-system-prompt-listener | plugins/dsh-link-groups/src/index.ts:21 | system-prompt/assemble |
| restrict-is-the-mechanism | plugins/dsh-link-groups/src/index.ts:773 | activate.restrict({ deny: wanted }) |
| effective | plugins/dsh-link-groups/src/index.ts:113 | export const EFFECTIVE = 'next-step' |
| service-name | plugins/dsh-link-groups/src/index.ts:121 | export const SERVICE = 'linkGroups' |
| seam-input-code | plugins/dsh-link-groups/src/index.ts:131 | INPUT: 'LINK_GROUPS_INPUT' |
| seam-duplicate-code | plugins/dsh-link-groups/src/index.ts:133 | DUPLICATE: 'LINK_GROUPS_DUPLICATE_GROUP' |
| collision-code | plugins/dsh-link-groups/src/index.ts:109 | COLLISION: 'GROUPS_COLLISION' |
| config-resolve | plugins/dsh-link-groups/src/index.ts:149 | export function resolveConfig(config) { |
| initial-open | plugins/dsh-link-groups/src/index.ts:232 | export function initialOpen(group) { |
| row-render-open-word | plugins/dsh-link-groups/src/index.ts:458 | row.open ? 'OPEN' : 'closed' |
| row-render-state | plugins/dsh-link-groups/src/index.ts:459 | row.state |
| catalog-render | plugins/dsh-link-groups/src/index.ts:477 | export function renderCatalog(config, catalog) { |
| catalog-text-only | plugins/dsh-link-groups/src/index.ts:478 | catalogPreamble |
| measure-cost | plugins/dsh-link-groups/src/index.ts:428 | export function measureCost(schemas, header, changeCount) { |
| cost-line | plugins/dsh-link-groups/src/index.ts:504 | (effective: ' |
| definition | plugins/dsh-link-groups/src/index.ts:608 | export function resolveDefinition(definition) { |
| definition-object | plugins/dsh-link-groups/src/index.ts:609 | typeof definition !== 'object' |
| definition-id | plugins/dsh-link-groups/src/index.ts:613 | ^[a-z0-9][a-z0-9._-]*$ |
| definition-members | plugins/dsh-link-groups/src/index.ts:617 | Array.isArray(members) |
| definition-title | plugins/dsh-link-groups/src/index.ts:622 | definition.title === 'string' |
| definition-state | plugins/dsh-link-groups/src/index.ts:626 | state: 'auto', |
| definition-userdisabled | plugins/dsh-link-groups/src/index.ts:628 | userDisabled: false, |
| definition-relockable | plugins/dsh-link-groups/src/index.ts:629 | relockable: false, |
| autowhen-wired | plugins/dsh-link-groups/src/index.ts:627 | auto: resolveDefinitionAuto(definition.autoWhen, id), |
| autowhen-fn | plugins/dsh-link-groups/src/index.ts:643 | function resolveDefinitionAuto(input, id) { |
| autowhen-default | plugins/dsh-link-groups/src/index.ts:644 | return { when: 'declare' } |
| autowhen-invalid | plugins/dsh-link-groups/src/index.ts:651 | autoWhen must be one of |
| autowhen-after | plugins/dsh-link-groups/src/index.ts:655 | needs autoWhen.after |
| autowhen-self | plugins/dsh-link-groups/src/index.ts:657 | cannot depend on itself |
| row-shape | plugins/dsh-link-groups/src/index.ts:671 | export function definitionRow(group, origin) { |
| row-members | plugins/dsh-link-groups/src/index.ts:677 | members: [...group.tools], |
| groups-order | plugins/dsh-link-groups/src/index.ts:695 | const groups = () => [ |
| groups-config-first | plugins/dsh-link-groups/src/index.ts:696 | definitionRow(group, 'config') |
| groups-contributed-after | plugins/dsh-link-groups/src/index.ts:697 | definitionRow(group, 'contributed') |
| register-verb | plugins/dsh-link-groups/src/index.ts:699 | const registerGroup = (definition) => { |
| duplicate-refusal | plugins/dsh-link-groups/src/index.ts:705 | SEAM_REFUSALS.DUPLICATE |
| admit-on-register | plugins/dsh-link-groups/src/index.ts:713 | record.admit(group) |
| disposer | plugins/dsh-link-groups/src/index.ts:723 | return () => { |
| disposer-retracts | plugins/dsh-link-groups/src/index.ts:729 | record.retract(group.id) |
| admit-fresh-surface | plugins/dsh-link-groups/src/index.ts:890 | ctx.tools.schemas().map |
| admit-syncs | plugins/dsh-link-groups/src/index.ts:895 | sync(group.id) |
| admit-unrestrictable | plugins/dsh-link-groups/src/index.ts:901 | unrestrictable: [...installations[group.id].resolved] |
| retract | plugins/dsh-link-groups/src/index.ts:904 | record.retract = (id) => { |
| no-tools-reason | plugins/dsh-link-groups/src/index.ts:300 | declared tool |
| own-layer-reason | plugins/dsh-link-groups/src/index.ts:294 | registered on the agent own layer |
| mount-agent | plugins/dsh-link-groups/src/index.ts:929 | export function mountAgent(ctx, agent, config) { |
| request-auto-open | plugins/dsh-link-groups/src/index.ts:984 | export function requestAutoOpen(ctx, agent, id, why) { |
| provide | plugins/dsh-link-groups/src/index.ts:1064 | ctx.provide(SERVICE, { registerGroup: seam.registerGroup, groups: seam.groups }) |
| service-taken | plugins/dsh-link-groups/src/index.ts:1070 | LINK_GROUPS_SERVICE_TAKEN |
| merged-view | plugins/dsh-link-groups/src/index.ts:694 | const merged = { ...resolved, groups: [...resolved.groups] } |
| collision-check | plugins/dsh-link-groups/src/index.ts:872 | if (activate.get(tool.name, scopeKey) !== undefined) { |
| collision-return | plugins/dsh-link-groups/src/index.ts:873 | return { code: REFUSALS.COLLISION |
| install-masks-each-group | plugins/dsh-link-groups/src/index.ts:876 | for (const group of resolved.groups) { |
| validate-declare | plugins/dsh-link-groups/src/index.ts:554 | export function validateDeclare(args, config, state, installations) { |
| needs-approval | plugins/dsh-link-groups/src/index.ts:325 | export function needsApproval(group) { |
| blocked-reason | plugins/dsh-link-groups/src/index.ts:290 | export function blockedReason(group, state, installation, known) { |
| state-in-process | plugins/dsh-link-groups/src/index.ts:57 | Where group state lives |
| config-entry-shape | plugins/dsh-link-groups/README.md:94 | A group entry is |
| group-not-plugin-tools | plugins/dsh-link-groups/README.md:97 | not** the same thing as |
| readme-seam | plugins/dsh-link-groups/README.md:102 | ## The third-party seam: `linkGroups` |
| readme-inject | plugins/dsh-link-groups/README.md:106 | inject: ['linkGroups'] |
| readme-limits-heading | plugins/dsh-link-groups/README.md:155 | ## Known limitations and deferred work |
| limit-process | plugins/dsh-link-groups/README.md:157 | **Group state lives in this process.** |
| limit-ptc | plugins/dsh-link-groups/README.md:165 | **PTC presets must not mount this row.** |
| limit-cross-agent | plugins/dsh-link-groups/README.md:169 | **No cross-agent propagation.** |
| limit-provider | plugins/dsh-link-groups/README.md:172 | **No provider auto-discovery.** |
| limit-device | plugins/dsh-link-groups/README.md:174 | auto.when: 'device' |
| readme-agent-layer | plugins/dsh-link-groups/README.md:17 | agent.ctx |
| kernel-restrict | core/deepseek-harness/packages/core/tools/src/index.ts:1097 | restrict(filter: ToolRestriction) |
| kernel-restrict-unknown | core/deepseek-harness/packages/core/tools/src/index.ts:1117 | names unknown global tool |
| kernel-visible-map | core/deepseek-harness/packages/core/tools/src/index.ts:1200 | layer.admits(name) |
| kernel-resolve-execution | core/deepseek-harness/packages/core/tools/src/index.ts:1247 | private resolveExecution( |
| kernel-schemas | core/deepseek-harness/packages/core/tools/src/index.ts:1260 | schemas(scope?: ScopeKey) |
| kernel-change-header | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:626 | !headerEquals(baseline, header) |
| kernel-change-reason | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:629 | reason: 'change', |
| kernel-tool-addition | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:639 | type: 'tool-addition' |
| kernel-developer-message | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:643 | session.append('developer/message', { |
| kernel-surface-append | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:647 | surfaceOp: 'append' |
| kernel-in-history | core/deepseek-harness/packages/core/agent-loop/src/agent.ts:411 | systemPromptUpdate === 'in-history' |
| head-rewrite-branch | core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:95 | input.inHistory |
| head-replace | core/deepseek-harness/packages/core/agent-loop/src/runtime-context.ts:98 | updates.push(this.replace(head.seq, rendered)) |
| cost-caveat | scripts/verify-tool-groups.mjs:100 | provider-independent cost trio |
| p2-requirement | docs/handoff/R194-contract.md:35 | docs/dev/tool-groups.md |
| collision-meaning | docs/handoff/R194-contract.md:29 | two *patches of the same config row* collide |
| live-bytes | docs/handoff/R194-contract.md:13 | +6,983 B |
| live-bytes-notes | docs/handoff/R194-contract.md:13 | +1,031 B |
| kernel-pin | kernel.lock.json:2 | pinned upstream checkout |
| build-derives-lib | plugins/build.mjs:6 | fail if lib/ differs from a fresh build |
| smoke-s1 | plugins/dsh-link-groups/test/seam-smoke.mjs:168 | held('S1' |
| smoke-s2 | plugins/dsh-link-groups/test/seam-smoke.mjs:172 | held('S2' |
| smoke-s5 | plugins/dsh-link-groups/test/seam-smoke.mjs:192 | held('S5' |
| smoke-s6 | plugins/dsh-link-groups/test/seam-smoke.mjs:199 | held('S6' |
| smoke-s7 | plugins/dsh-link-groups/test/seam-smoke.mjs:209 | held('S7' |
| smoke-s9 | plugins/dsh-link-groups/test/seam-smoke.mjs:220 | held('S9' |
| smoke-s10 | plugins/dsh-link-groups/test/seam-smoke.mjs:228 | held('S10' |
| smoke-s11 | plugins/dsh-link-groups/test/seam-smoke.mjs:237 | held('S11' |
| smoke-s12 | plugins/dsh-link-groups/test/seam-smoke.mjs:253 | held('S12' |
| smoke-s13 | plugins/dsh-link-groups/test/seam-smoke.mjs:264 | held('S13' |
| smoke-s14 | plugins/dsh-link-groups/test/seam-smoke.mjs:273 | held('S14' |
| smoke-s15 | plugins/dsh-link-groups/test/seam-smoke.mjs:288 | held('S15' |
| smoke-s16 | plugins/dsh-link-groups/test/seam-smoke.mjs:302 | held('S16' |
| smoke-s17 | plugins/dsh-link-groups/test/seam-smoke.mjs:341 | held('S17' |
<!-- /citations -->
