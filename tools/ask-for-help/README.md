# ask-for-help —— LINK 里的 agent 向 Lead 喊话

```
DSH-LINK 内核 ── invoke(tools.expose/ask_for_help) ──▶ 常驻 peer 进程 ──▶ inbox/<ticket>.json
     ▲                                                        │
     │  session/prompt（答复以新消息回到会话）                  ▼
     └──────────── Lead 的命令行（reply / send）◀──── 等待任务发现新喊话后退出（唤醒 Lead）
```

这不是一个新插件，而是 **link-interconnect/1 的"软件主动适配"方向**（CLI 模式）：
本机有一个零依赖的软件 peer，DSH-LINK 按协议的 `/.well-known/link-interconnect.json`
读声明、问一次同意、把 `ask_for_help` 注册成内核工具。工具因此**默认开启**，LINK 里的
任何 agent 都能直接调用它，不需要在会话里再授权。

## 两条后台任务 + 命令

| 角色 | 命令 | 行为 |
| --- | --- | --- |
| 常驻 | `node tools/ask-for-help/ask-for-help.mjs serve` | 起 peer（默认 `127.0.0.1:19555`），把本机接入 LINK；LINK 重启后自动重新 add + 补同意（peer 的 bearer 只存内存，重启后行是 rejoin-required）。 |
| 等待 | `node tools/ask-for-help/ask-for-help.mjs wait` | 一次性等待：**有新喊话就打印报告并退出**；DSH-LINK 掉线、模型服务商探针失败、LINK 会话出现新的 agent/模型错误，也打印诊断并退出。后台任务退出会唤醒 Lead 的会话。 |
| 命令 | `reply <ticket> <文本>` | 记录对某条喊话的答复（收件箱状态 answered）。 |
| 命令 | `send [--session <id>] [--new] <文本>` | 把一条消息作为新 user 消息发进 LINK 会话（默认发最新会话；`--new` 新建）。这就是"把答复送回 agent"。 |
| 命令 | `status` / `inbox` | 看 peer 绑定、工具注册、收件箱、服务商探针。 |

退出码（等待任务）：`0` 新喊话 · `2` LINK 掉线 · `3` 模型服务商探针失败 ·
`4` 等待超时（`--max-seconds`）· `5` LINK 会话里新的 agent/模型错误 · `1` 用法错误。
（注意：作为后台任务由宿主收尾时，任何非零退出都被归一成 `exit code: 1`；**分类看报告里的
`kind:` 行**，不要看退出码。）

探针口径：每 60 s 做两项。服务商探针要**连续 3 次失败且已持续 ≥3 分钟**才判"服务商坏了"
（`--provider-failures`、`--provider-down-ms` 可调）；报告里会写"当时运行中的会话数"，
0 个时多半只是 Cloudflare 边缘抖动（2026-10-25/26 两次 2 分钟抖动曾在旧"连续 2 次"规则下误报，
读到时网关已经 200）。LINK 的 `session/modelCatalog.failures[]` 里出现 opendesign 仍要连续 2 次。
直接 `GET {gateway}/models`（网络/鉴权/网关）与 LINK 自己的目录读取，都不花 token。
掉线判定：shell 的 `/__shell/status` 连续 30 s 不是 `ready`（`--down-after` 可调）。
会话错误判定：只报等待任务启动之后**新增**的 durable `turn/end`，且 `reason.kind` 为
`error`（模型/服务商失败）或 `interrupted`（崩溃后被补关的轮次）；
`completed`/`max-tokens`/`aborted` 是正常结束，不报。注意内核**没有** durable 的
`agent/error` 会话事件（只在 WS `$events` / UI 上出现），所以扫事件里的 `agent/error`
永远是空操作，真正的判据是 `turn/end` 的 reason（core/agent-loop agent.ts 的 finally 写入）。

## 环境改动记录（实战期，profile patch 层，热应用）

LINK 的内核 profile patch（`kernel-home/profiles/web/cordis.patch.yml`）由 dsh-hmr 热监听，
下面两行都是**不重启内核**生效、并已用行为读数验证的：

| 行 | 键 | 默认 → 现值 | 为什么 | 验证读数 |
| --- | --- | --- | --- | --- |
| `agent-team` | `maxMembers` | 8 → 24 | agent-team-profile 把上限钉成 8，三层团队第 9 人报 `Team member limit 8 reached` | 重试后 roster 从 9 → 12 人（lead+3L2+8L3），新增 critic-ux / critic-feature / critic-integration |
| `subagent` | `maxActiveSubagents` | 8 → 24 | 每个活跃 teammate 占一个 active child 槽，第 9 个报 `subagent limit reached (active child limit: 8)` | 12/12 个 session 同时 running（此前 8 个）；analyst-qa / builder-launcher-core 被成功唤醒 |

注意：patch 行是**整行替换**，所以只写要改的键时其余键回到 schema 默认值；这两行都只写了一个键，
且该键之外的行为与改前一致（agent-team 其余默认 maxTasks 256 / maxMessageBytes 65536 /
disposalTimeoutMs 5000；subagent 的 maxDepth 默认 1，与改前相同）。

**teammate 子会话不能从外部 prompt**：`send --session <teammate-session>` 会被内核拒绝
（`session/agent-busy ... owned by subagent routing`）。要唤醒某个 teammate，只能把话发给
Lead 会话，由 Lead 用 `send_message` 转达（或由它的 L2 唤醒）；Lead 会话本身可以直接 `send`。

## 实战铁律（Lead 必须遵守）

> **会话因非正常原因停止（`turn/end reason=error|interrupted`）时，修完根因后必须把「继续」发回该会话。**

````
node tools/ask-for-help/ask-for-help.mjs send --session <sessionId> "继续"
```

原因：模型/服务商失败会把这一轮直接终止，会话停在半途，不会自己接上；只修配置不补消息，
用户的实战任务就永远停在那里。恢复顺序固定为：**确认服务商恢复（`status` 里 provider/catalog 都 ok）
→ `send --session <id> "继续"` → 重新挂 `wait`**。等待任务在 `turn-error` 报告里会直接打印这条
命令，不需要临时想。

## 为什么是"双后台任务"

LINK 的 peer 调用有 15 秒超时（`LIMITS.timeoutMs`），人的应答不可能塞进一次工具调用里。
所以 `ask_for_help` 是**投递型**：立即返回 `{delivered:true,ticket}`，不阻塞 agent。
"叫醒 Lead" 这件事由第二个后台任务承担——它退出即事件，Lead 的会话被唤醒后读报告、
处理，再用 `send` 把答复作为普通消息发回原会话。两边都是普通 HTTP/文件，没有魔法。

## 状态与文件

默认状态目录 `<repo>/.tmp/ask-for-help/`：

- `state.json` 常驻任务心跳（pid / peer url / LINK 状态）
- `inbox/<ticket>.json` 每条喊话：`pending → notified → answered`
- `replies/<ticket>.json` Lead 的答复
- `events.ndjson` 事件流（apply / consent / invoke / send / probe / error）
- `waiter.json` 等待任务的会话错误游标（只报"新"错误，不重复报历史）

环境变量：`ASK_FOR_HELP_STATE`（状态目录）、`ASK_FOR_HELP_PORT`（默认 19555）、
`LINK_ORIGIN`（默认 `http://127.0.0.1:31761`）、`DSH_LINK_KERNEL_HOME`、
`OPENDESIGN_BASE_URL`（服务商探针目标，默认官方网关）。

## 一次完整回合（实测）

1. LINK 里的 agent 调 `ask_for_help({message:"..."})` → 工具结果立刻返回
   `{"ok":true,"result":{"delivered":true,"ticket":"h-…"}}`（内核日志：
   `tools registered from peer svc_lead_ask_for_help: ask_for_help`）。
2. 等待任务发现 `inbox/h-….json` 是新的，打印 ticket/正文/最近会话，退出 0 → Lead 被唤醒。
3. Lead 跑 `send --session <id> "<答复>"`，答复作为 user 消息进入该会话，agent 继续。
4. 重新挂一个 `wait`。

故障排练（已在真机做过一次）：把 LINK 里 opendesign-go 的 `baseURL` 临时改到死端口，
LINK 的模型调用报 `OpenDesign transport failure: connect ECONNREFUSED …`，等待任务读到
`turn/end reason=error`，打印会话 id + 错误原文后退出（`kind: turn-error`）；
把 `baseURL` 改回来，下一轮 `provider=dsh-opendesign-go` 正常完成。
