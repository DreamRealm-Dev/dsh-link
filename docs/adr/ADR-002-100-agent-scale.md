# ADR-002：「支撑 100+ 智能体」的落点

**状态**：生效。**依据**：`docs/handoff/R1-teammate-budget.md`（全部实测/代码可证）+ 用户需求行 34。

## 决定

「架构得能支撑起 100+ 智能体的协同压力」的**承载力落在外部 Agent 适配器**（`docs/research/03-collab-bus.md` 的 M6 六动词）+ 跨设备组队（`docs/research/04-device-interconnect.md`），**不落在 teammate 机制上**。
teammate 只承载「本会话的少数常驻角色」：web profile 实配上限 **8**，内核默认 **16**，本会话角色预算按 8 执行。

## 为什么

- teammate 名字是**不可回收资源**：`agent-team/src/roster.ts:271-272`（`TEAM_MEMBER_NAME_TAKEN`）、`src/types.ts:153` 自述 "Maximum immutable teammate names retained by one Team"；超限 `TEAM_MEMBER_LIMIT`（`roster.ts:275`）。
- 上限是 **profile 配置钉的值**，不是内核常量：`packages/experimental/agent-team-profile/cordis.patch.yml:20` 写死 `maxMembers: 8`；内核 `DEFAULT_MAX_MEMBERS = 16`（`agent-team/src/index.ts:41`）。0.1.1-rc.2 时该 profile 包尚不存在。
- 推论（本 ADR 的核心判断）：**按字面去扩 TeamService，只会得到一个上限 16 的"协作总线"**，且会话内名字会耗尽；100+ 的正确身份账本是**能力注册表 + 外部适配器**，teammate 是其中的一类节点。

## 影响面（会返工什么）

| 项 | 要求 |
|---|---|
| 能力注册表（§03 M1） | 必须同时装 teammates 与外部 Agent；`parent` 字段承载分形结构（行 176-183 的要求） |
| 消息总线（§03 M2） | 控制通道持久化（append-only）与数据通道 TTL 分离，**对两类节点一视同仁** |
| 组队（§03 M6） | 「外部 Agent 只装一个小桥接插件即可被 lead 接入任意会话」是 100+ 的唯一通道 |
| 本会话操作纪律 | teammate 名字当作有限预算用：常驻三角（挑刺/验证/模拟器）优先，其余走 subagent |

## 名字台账（`list_agents` 实测，2026-10-07 01:5x）

| 名字 | 来源 | 用途 | 状态 |
|---|---|---|---|
| `repeat-guard-fix` | 前一轮 | dsh-repeat-guard 设置写入修复 | inactive（名字已占用） |
| `shell-frame` | 前一轮 | Tauri 外壳自绘 + 圆角 + 启动页配色 | inactive |
| `skin-radius` | 前一轮 | 皮肤圆角 token 统一 | inactive |
| `radius-verify` | 前一轮 | 圆角/配色验证 | inactive |
| `critic` | 本会话常驻 | 挑刺（智囊） | 常驻 |
| `verifier` | 本会话常驻 | 独立复核 | 常驻 |
| `simulator` | 本会话常驻 | 模拟器 / 跨端验收 | 常驻 |
| （+ lead） | — | — | running |

**预算：8/8 已用满**（web profile `maxMembers: 8`），名字不可回收。因此硬约束两条：
1. **新岗位一律走 subagent**（只读调研、一次性实现、单文件验证都走它），不再新开名字。
2. 需要「长期持上下文 + 反复被唤醒 + 写文件」的岗位，只能**唤醒一个 inactive 名字并明确改派**（台账里注明新职责），不得新起名字。

## 回滚方式

回滚 = 承认"100+ 由 teammate 承载"（需同时改 profile 上限 + 接受名字耗尽），代价是重做注册表分层。**不建议**。若某天内核把名字改成可回收，本条决定仍成立（上限与回收性是两件事），但可重新评估。
