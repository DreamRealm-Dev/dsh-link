# dsh-continue-button

聊天界面的「继续生成」按钮，参考 DeepSeek 官网在"已停止"回复下提供的同名入口。

**背景**：防复读/防空转护栏（anti-repeat 三件套）宁可早掐的取向上，合法内容
（SVG 矩阵数值行等）被误判、或上游截断时，会话停在半截，只能打字"继续"。数字串
误判已在 `dsh-repetition-guard` 侧修复（只统计含字母的词）；本按钮是**对冲**：
任何原因停下来的回复都能一键续跑。

## 两个挂点，因为两版的 kind 不同

`conversation.chat.turnTail` 在 0.1.5 是 **chain**、在 0.2.x 是 **list**，而
kind 决定注册契约：

| 版本 | kind | 必填选项 | 缺了会怎样 |
|---|---|---|---|
| 0.1.5（桌面版） | chain | `select` | `register` 直接 throw，条目不上账（**整条尾部路径静默消失**） |
| 0.2.x（dsh-link） | list | `id` | 同上，报缺 `id` |

`id` + `select` 同时给，一份注册两版通用。0.1.5 上**只能**走 tail 位：它的
`TurnTailNodeView` 仅在收尾消息可寻址时渲染 `assistant-actions`
（`messageId === undefined ? null : renderSlot(...)`），而收尾消息取"最后一个有
非空 text 的已终局助手节点"（`finalized.findLast(hasText) ?? null`）——思考阶段被
截断的轮次只有 reasoning，`closing` 为 null，操作行整行不存在。

- 输出阶段被截断 → 有 text、有 messageId → 操作行存在 → `assistant-actions` 位生效；
- **思考阶段被截断** → `closing` 为 null → 操作行不存在 → `turnTail` 的 chain 是唯一宿主。

## 行为

- 认领（`select`，必须纯函数、不得抛错）：`turn-tail` 位置数据存在，且收尾消息为空
  或没有 messageId（中断冻结的部分消息），且本 turn 没有 deliverable。最后一条是
  不抢官方 `dsh-client-ui-deliverables` 的同一链位，条件与其 `selectDeliverables`
  逐字对齐。
- 显示（组件，用快照钩子判定）：会话空闲、只挂最后一轮（`timeline.turnOrder` 末位），
  且存在被掐信号——结束原因非 `completed`（内核直接区分 aborted / max-tokens /
  error / blocked），或本 turn 有 `interrupted` 的 assistant step。
- 点击：`session.prompt([{type:'text',text:'继续'}], 'queue')` —— 与输入框发送
  完全同路径（remote `session.prompt`），子代理会话同样可用。

## 结构

能力全在浏览器半（`lib/client.js`，esbuild 产物）。宿主半（`lib/index.js`）是
no-op：存在的唯一原因是让本包拥有一个 loader 行——客户端半扫描器按"组合里每一
行所在的包"读 `dsh.client` 字段。`cordis.patch.yml` 插入该行。

## 内容块判别字段

正文提取同时认 `kind`（0.1.5）与 `type`（0.2.x）：只认 `type` 时，0.1.5 上"收尾
正文"恒为空串，于是"结束消息没有正文"这条判据恒真——**完篇消息也会挂按钮**。

## 构建、验证、安装

```sh
node plugins/build.mjs                       # 与主题插件同一工具链
node plugins/build.mjs --check                # lib/ 是否与源码一致（发布前必跑）
node plugins/dsh-continue-button/verify-tail-host.mjs
```

验证脚本用**应用自带的真 slot core**（`@deepseek-ai/dsh-client-ui-slots`）加上
profile 实际加载的 `lib/client.js`，断言：缺 `select` 的 chain 注册被内核拒绝、
两条注册都上账、chain 选举与显示规则（思考截断显示、完篇不显示、交付截断走操作行、
deliverable 轮次让位、非末轮与生成中隐藏）、点击发出的 `prompt` 载荷。走另一份
安装时用 `DSH_APP=<install>` 覆盖。

profile 清单加两条：`"dsh-continue-button": "link:<repo>/plugins/dsh-continue-button"`
（dependencies）与 `"dsh-continue-button"`（`dsh.profile.bundles`），然后
`pnpm install --dir <DSH_HOME>/profiles/web`。桌面版（0.1.5）同样走 `link:` 依赖 +
bundles 列表，无版本豁免需求（不声明 peer）。浏览器半按页加载，改完 `lib/client.js`
刷新页面即生效；宿主半、清单或 `cordis.patch.yml` 改动需要重启内核。
