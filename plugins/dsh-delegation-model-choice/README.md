# dsh-delegation-model-choice

让 Agent 创建 **Agent Teams teammate（子 Agent）** 或 **subagent（子代理）** 时可以选择其他模型，
默认继承当前会话的模型，只有在用户明确要求时才换模型，并且**换模型必须经过用户审批**。

## 先回答：DSH 本来有这个功能吗？

**一半有。**

| 委派路径 | DSH 0.1.5-rc.2 的现状 |
| --- | --- |
| `subagent` / `subagent_fork` 工具 | **有**内建的模型选择：宿主设置 `subagent-model-selection`（Settings → 插件 → 插件配置 → Subagent 卡片）打开后，工具会多出 `provider` / `model` / `reasoning_effort` 字段，并注册 `list_subagent_models`。授权方式是**设置里的精确路由白名单**（用户预先批准哪些模型），不是每次调用的审批；且**只对新会话生效**。 |
| Agent Teams `spawn_teammate` | **没有**。`SpawnTeammateRequest`（`@deepseek-ai/dsh-experimental-agent-team`）只有 `name/description/prompt/context/provider/signal`，`provider` 是 subagent 后端名（spawn/fork）而不是模型；`spawnAdmitted()` 调用 `ctx.subagents.startContinuable({... request:{prompt,parent}})` 时**不传 `agentOptions`**，所以 teammate 永远继承 Lead 的模型。`list_agents` 里看到的 `model` 只是实时 agent 的 `options.model`，agent 不活跃时回退显示 Lead 的模型。 |

本插件补的是第二行，并给两条路径都加上**每次调用的用户审批**。

## 它做什么

宿主平面（host plane）的 Cordis 插件，只注册工具和一段 system-prompt 段落，不发布服务、不需要 realm：

- **`list_delegation_models`** — 列出本部署当前真实可用的 provider/model 路由，以及本会话自己的路由。
- **`spawn_teammate_model`** — 创建 teammate（仅 Team Lead 可调用），可选指定 `provider`/`model`/`reasoning_effort`。
- **`spawn_subagent_model`** — 创建 durable continuable 子代理，可选指定模型。
- **prompt 段落 `delegation:model-choice`**（顺序紧跟 `TEAM_POLICY`）— 写明默认继承、只有用户明确点名才换模型、换模型必须先拿到用户审批。

审批：请求的路由与会话自身路由不同时，工具会通过 `ctx.userQuestions` 弹出 **Approve / Decline** 卡片；
用户点 Decline 时不会创建任何 delegate，工具返回 `ok:false` 并提示改用会话路由，且**不会被记住**。

**首次同意后、同对话下次自动**：用户点 Approve 后，本对话（该 Session）就记住了这条 **provider/model 路由**——
同一对话里再委派到**同一路由**不再弹卡，直接创建（工具结果仍是 `approved: true`）。粒度与边界：

- 记忆以 **Session（主对话）** 为单位：换一个对话仍会问。
- 记忆以 **精确路由** 为单位：`commandcode/gpt-6-luna` 同意过，不影响 `tokenrhythm/glm-5`，后者仍会问。
- teammate 的**名字**不同不影响命中：名字每次都变，用户同意的是模型。
- 记忆在插件进程内存里（`lib/index.js` 的 `conversationGrants`，最多同时记 128 个对话）：
  **宿主重启后每个路由重新问一次**。要长期免问请用设置里的路由白名单，或把 `rememberApproval` 关掉只用审批。
- `rememberApproval: false` 恢复成每次都问。

### teammate 换模型是怎么实现的

`ctx.agentTeams.spawnTeammate` 不接收 `agentOptions`，而 `ctx.subagents.startContinuable` 只在
`request.agentOptions` 里解析子级路由（provider 的 `agentRouteDefaults` 只是 `dsh-tool-subagent`
工具侧的默认值提示，continuation 路径根本不读它）。所以本插件在**用户要求换模型时**复刻 Team 服务
自己的两段式日志协议：

1. 往 Lead 会话追加 `team/member`（`phase: provisioning`）并 flush；
2. `ctx.subagents.startContinuable({ childId, provider, label, request: { prompt, parent, agentOptions } })`
   带上显式路由启动子级；
3. 追加 `team/member`（`phase: active`）并 flush；失败时追加 `phase: failed` 并带上错误信息。

`team/member` v2 是 `dsh-session` 的已知事件类型、有持久化 disposition，`agentTeam` 投影就是靠它折叠
roster；因此成员随后在 `list_agents`、`send_message`、共享任务板、teardown 里都是一等公民。
**不换模型时**（默认情况）插件直接调用 `ctx.agentTeams.spawnTeammate`，保留上游自己的 provisioning
与恢复逻辑。插件内部按 Lead 串行化自己的日志写入，避免并发 spawn 撞名。

## 安装

```sh
dsh plugin --profile web add <本目录路径>
# 例如：dsh plugin --profile web add H:\mod\dsh-delegation-model-choice
```

然后**重启 web 端**（bundle 列表在 profile 的 `package.json` 里，重启才生效）。
包自带 `cordis.patch.yml`，会插入一行 `delegation-model-choice`。

卸载：

```sh
dsh plugin --profile web remove dsh-delegation-model-choice
```

## 配置

`cordis.patch.yml` 里那一行的 `config`：

```yaml
- insert:
    - id: delegation-model-choice
      name: dsh-delegation-model-choice
      config:
        requireApproval: true   # false = 只保留提示词约束，不做硬审批
        rememberApproval: true  # true = 同对话内同一路由首次同意后不再询问（进程内存，重启后重问）
        maxMembers: 8           # 与 Team 服务的成员上限保持一致
        freshProvider: spawn
        forkProvider: fork
```

## 动态插件与免重启验证

正在运行的宿主只会在**下次启动**时加载 `lib/index.js` 的新代码（profile 的 bundle 行在启动时求值）。
要在**不重启**的前提下立刻生效，本会话另外挂了一个动态 Cordis 插件 `dqgrnt-3`（`pkg-6`）：
它监听 `user-questions/request` 瀑布，用与上面完全相同的语义（同对话 + 同路由 + 只有 Approve 才记住）
在宿主根作用域里替用户回答第二次及以后的同一路由审批。宿主重启后该动态插件消失，
行为由本包原生接管，两者语义一致、不会重复。

它的自检结果（挂载时写回本会话）：
`registeredOn=root`、6/6 自检通过（首次问、同路由不同名字自动、换路由仍问、Decline 不记、
记忆按对话隔离、无关问题不拦截）、`liveWiring=ok replayed=Approve`（证明监听器确实在真实瀑布链上）。

## 动态插件沙箱说明

`build.mjs` 从 `lib/index.js` 抽出核心逻辑，生成 `dyn-host.js`（动态 Cordis 插件用的纯 JS 函数体）。
动态插件在**独立的 VM realm** 里求值，它创建的对象/数组原型不属于宿主 realm，会被 api-gateway 的
`isRemoteJsonValue` 判为非无损 JSON，导致审批卡片发不出去。因此动态版本额外注入一个 `hostRequest`
适配器，用宿主 realm 的容器（`ctx.subagents.list()` 的数组 + `ctx.tools.schemas()` 的对象）重建问题载荷。
**正式插件（`lib/index.js`）运行在宿主 realm，不需要也不使用这个适配器。**

## 已验证

- 动态实例在本会话真实运行：`list_delegation_models` 返回 36 条实时路由，`policySection: true`（段落确实进了 system prompt）。
- 用 `tokenrhythm/glm-5` 真实创建了一个 teammate（用户审批卡片通过）：`list_agents` 显示 `lead` + `glm5-check`。
- 子会话自己的日志证明模型覆盖生效：
  `subagent/descriptor {mode:continuable, provider:spawn, agentProvider:tokenrhythm, agentModel:glm-5}`、
  `request/header config={provider:tokenrhythm, model:glm-5}`、system prompt 里写着 "powered by the glm-5 model"。
- 该 teammate 随后失败在**服务商侧**：`turn/end error 400 status code (no body) / CONTEXT_WINDOW_EXCEEDED`
  （用户事先说明该服务商有问题）。插件链路本身无误。

`spawn_subagent_model` 尚未做真实委派（用户要求本次最多一个子代理），代码路径与 `dsh-tool-subagent`
的 continuable 委派相同。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 插件本体（唯一真源，Cordis 宿主平面插件） |
| `cordis.patch.yml` | bundle 层：插入插件行 |
| `build.mjs` | 从 `lib/index.js` 生成 `dyn-host.js`（动态实例用） |
| `dyn-host.js` | 生成物，动态 Cordis 插件函数体 |
| `tools/read-session.mjs` | 诊断脚本：解出 zstd 分帧的会话日志并摘要打印 |
| `tools/test-conversation-grant.mjs` | 单测：同对话/同路由记忆的 9 项行为检查（`node tools/test-conversation-grant.mjs`） |
