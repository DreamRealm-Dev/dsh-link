# dsh-link-mods

桌面版（`<install-dir>`，Electron 壳 + dsh `0.1.5-rc.1`）自制
插件与调参向 dsh-link（dsh `0.2.1-alpha.1`）的移植层。代码插件本体在 `plugins/` 下
各自的包里，本 bundle 只携带两类声明：

- `cordis.patch.yml` —— host 平面挂载行：护栏三件 + anti-repeat + escalation-guard
  （活跃），以及桌面版停用的四个能力行（镜像停用状态）。
- `presets.patch.yml` —— 两套自制 Agent 预设（chat-mode、minimal-tuned）的 0.2.x 声明。

## 为什么是 bundle 声明，而不是 `.agent-presets/` 目录

0.1.x 的 Agent 预设是 `$DSH_HOME/.agent-presets/<id>/` 目录，内核在启动时扫描；
0.2.x 废除了目录发现，预设是普通的 `@deepseek-ai/dsh-agent-preset` 声明行，随
bundle 补丁装载（官方 standard/ptc/minimal/cordis 四套即此形态）。因此桌面版
"把目录拷进 `.agent-presets/`" 的装法在 dsh-link 上不再成立——预设改为声明行，
组合内容逐字搬运。

## 包清单与兼容性结论

| 包 | 来源 | 0.2.1 状态 | 挂载 |
|---|---|---|---|
| `dsh-image-guard` | 自制（H:\mod） | 逐 API 兼容，零改动 | 活跃 |
| `dsh-repeat-guard` | npm `0.2.2`（桌面版锁 0.1.5 是因为 0.1.x 内核；0.2.2 的 peer `>=0.1.7-0 \|\| >=0.2.0-0` 直接覆盖本内核） | 兼容；拦截表从 settings 命名空间移到本行 entry Config | 活跃 |
| `@argszero/cordis-plugin-thinking-loop-guard` | npm `0.1.9` | **peer 上限 `<0.2.0`，需 `dsh plugin allow-version` 豁免**，否则该行被兼容性预检停用 | 活跃（需豁免） |
| `dsh-repetition-guard` | npm `0.1.0` | 无 peer 声明，兼容；**已打本地补丁**（见下"复读误判修复"），重装本包会丢失 | 活跃 |
| `dsh-escalation-guard` | 自制，本仓库新增 | `dsh-hotfix` 的运行时移植（见下） | 活跃 |
| `dsh-agent-context` | 自制（H:\mod） | 已修 1 处（`listChildren` 条目不再有 `kind` 字段）；其余逐 API 兼容 | 停用（镜像桌面版） |
| `dsh-lan-bridge` | 自制（H:\mod） | RPC 失败形状已对齐 0.2.x 结构化契约；其余逐 API 兼容 | 停用（镜像桌面版） |
| `dsh-browser` | 自制（H:\mod） | 逐 API 兼容，零改动 | 停用（镜像桌面版） |
| `dsh-delegation-model-choice` | 自制（H:\mod） | 逐 API 兼容，零改动 | 停用（桌面版即装而未挂） |
| `dsh-anchored-lite` | 自制（minimal-tuned 预设内联脚本） | 事件接缝未变 | 随 minimal-tuned 预设 |

### dsh-hotfix 为什么变成了插件

桌面版的 hotfix 直接改 `@deepseek-ai/dsh-sandbox` 的发布 lib：`sandbox_permissions`
请求不比当前有效模式严格更宽时，按有效模式放行而不是 throw。dsh-link 的内核是
固定 checkout（不做源码改动），且 0.2.1 已把"请求等于有效模式"修成直接返回，剩下
"向更窄模式请求"仍会 throw。`plugins/dsh-escalation-guard` 用 `tools/execute` 包装
复现同一语义：捕到特征错误后剥掉 `sandbox_permissions` 重试——升级检查发生在工具
体执行之前，首次 `next()` 无副作用，重试安全。

### 复读误判修复（2026-10-06）

`dsh-repetition-guard` 0.1.0 的"尾部连续 N 个相同单词"判据用 `[\p{L}\p{N}]+`
切词，纯数字也算"单词"：写 SVG `feColorMatrix values="1 0 0 0 0 …"`、坐标表、
补零这类合法长零串时必然凑满阈值（liquid-glass 会话实测连续数轮在矩阵行中间
被掐断，用户只能反复手点"继续"）。修复：运行计数只统计**含字母的词**
（`[^\W_]*\p{L}[^\W_]*`）——语言性空转（wait wait wait / 好 好 好）照抓，
纯数字长串不再误判。改动点只有 `trailingRepeatRun` 的切词一行，行为测试
（矩阵行放行、wait/中文/混合词循环照拦）已验证。

补丁已应用到两处：

- 桌面版源包 `H:\mod\dsh-anti-repeat-suite\packages\dsh-repetition-guard\lib\index.js`
  （junction 直通其 profile，重启桌面版生效）；
- dsh-link profile 里的 npm 安装副本
  `<DSH_HOME>/profiles/web/node_modules/dsh-repetition-guard/lib/index.js`。

补丁副本存档：`patches/repetition-guard.0.1.0.letter-fix.index.js`；上游若出
新版应以同样判据修订为准。

### dsh-continue-button（对冲按钮）

`plugins/dsh-continue-button`：助手消息操作行的「继续生成」按钮（参考官网
"已停止"回复下的同名入口）。护栏误掐或上游截断后一键续跑——点击经客户端
官方提交路径（remote `session.prompt`，mode `queue`）发送"继续"，与输入框
发送同路径。空闲时显示、只挂最后一轮、生成中隐藏。

**坑（2026-10-06 修正）**：`conversation.chat.turnTail` 在 0.1.5 是 **chain**、
0.2.x 是 **list**，并非"同名同形状"。chain 注册必须给 `select`，缺了内核直接
throw（`chain slot ... requires options.select`），条目**静默不上账**——0.1.5 上
尾部路径整条失效。且 0.1.5 的 `assistant-actions` 只在收尾消息可寻址时渲染，而
收尾消息取"最后一个有非空 text 的已终局助手节点"：思考阶段被截断的轮次
（`closing` 为 null）操作行整行不存在，只有 `turnTail` chain 能承载按钮。注册时
`id` + `select` 同时给，两端通用。桌面版与 dsh-link 的 profile 均以 link: 依赖 +
bundles 条目安装。

## 安装

profile 清单是记录（与 dsh-liquid-glass / dsh-theme-settings 同一路线）：

```jsonc
// <DSH_HOME>/profiles/web/package.json
"dependencies": {
  "dsh-image-guard": "link:<repo>/plugins/dsh-image-guard",
  "dsh-agent-context": "link:<repo>/plugins/dsh-agent-context",
  "dsh-browser": "link:<repo>/plugins/dsh-browser",
  "dsh-lan-bridge": "link:<repo>/plugins/dsh-lan-bridge",
  "dsh-delegation-model-choice": "link:<repo>/plugins/dsh-delegation-model-choice",
  "dsh-escalation-guard": "link:<repo>/plugins/dsh-escalation-guard",
  "dsh-anchored-lite": "link:<repo>/plugins/dsh-anchored-lite",
  "dsh-repeat-guard": "^0.2.2",
  "dsh-repetition-guard": "^0.1.0",
  "@argszero/cordis-plugin-thinking-loop-guard": "^0.1.9",
  "dsh-link-mods": "link:<repo>/plugins/dsh-link-mods"
},
"dsh": { "profile": { "bundles": [ /* …, */ "dsh-link-mods" ] } }
```

```sh
# with the package manager dsh itself uses
pnpm install --dir <DSH_HOME>/profiles/web
```

### thinking-loop-guard 的版本豁免

0.1.9 的 peer 声明上限是 `<0.2.0`，0.2.x 的兼容性预检会因此把该行整行停用。显式
接受风险：

```sh
DSH_HOME=<DSH_HOME> node --import tsx/esm <kernel>/apps/cli/src/bin.ts \
  plugin allow-version @argszero/cordis-plugin-thinking-loop-guard@0.1.9
```

## 未移植（第三方，非自制）

`dsh-search-failover`、`@mars-sea/dsh-commandcode-provider`、`dsh-opencode-go`、
`@rain-kl/dsh-preset-plus`、`dsh-routing-suite`（yjh051108）均为社区/第三方包，
不在"自制插件"范围内；如需可在 profile 清单里按 npm 包直接加装。

## 调参出处

- anti-repeat 三件套的挂载与调参：`H:\mod\dsh-anti-repeat-suite\patches\anti-repeat.rows.yml`
- repeat-guard 拦截表原文：`patches/repeat-guard.fragments.yml`（0.1.x 放
  settings.yaml 的 `repeat-guard:` 键下；0.2.2 起改挂在挂载行的 entry Config 里，
  两份内容一致）
