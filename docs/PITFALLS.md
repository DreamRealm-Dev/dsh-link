# 施工坑位清单（踩过的，别再踩）

> 每条都是**实测**出来的，不是猜。它们看起来都不像"这个问题"，会让你在错误的地方浪费几小时。

## 1. 构建产物被标了「低完整性」，托盘图标/窗口行为全废（最坑）

**症状**：`Shell_NotifyIcon` 返回 `FALSE`，`GetLastError=5 (拒绝访问)`；`tray-icon` 的 `rect()` 是 `Ok(None)`；日志写着 "tray icon ready" 但任务栏永远没有图标。更早还会表现为 Tauri 窗口都建不出来（`create_dir_all` 拒绝访问 → "Failed to setup app"）。

**根因**：DSH 会话里跑 `cargo build` 时进程令牌是**低完整性（Low Mandatory Level）**，低完整性进程创建的每个文件都继承该标签——包括 `target/debug/dsh-link.exe`。Windows 启动带 Low 标签的可执行文件时会把进程降为 Low，而 **Low 进程无权向 High 的任务栏发消息**（UIPI），`Shell_NotifyIcon` 因此被拒。

**判定（一条命令）**：

```powershell
icacls 'src-tauri\target\debug\dsh-link.exe' | Select-String 'Mandatory Label'
# 出现 Low Mandatory Level 就是这个坑
```

进程侧对照：`dsh-link` 为 `LOW`、`explorer` 为 `HIGH`、同会话 pwsh 探针为 `HIGH`（探针能显示、产品不能）——三者一比就锁定。

**修法**：

```powershell
icacls 'src-tauri\target' /setintegritylevel '(OI)(CI)High'   # 后续编译继承
icacls 'src-tauri\target\debug\dsh-link.exe' /setintegritylevel High
```

`scripts/restart-client.ps1` 已内置自检：发现 exe 是 Low 会自动改 High 并在报告里写明。

**推论**：完整性**跟着可执行文件路径走**——把 `whoami.exe` 复制进本仓库也会变 Low，同一份二进制在 System32 下是 High。"把 exe 拷到仓库外运行"不是玄学，是必要的对照实验。

## 2. Win32 的失败会被库吞掉，日志会假绿

`tray-icon 0.25.1`（`platform_impl/windows/mod.rs:159-162`）对 `Shell_NotifyIcon(NIM_ADD)` 被拒是**容错**的：不报错、等 `TaskbarCreated` 再来。任何在此基础上打印 "ready" 的代码都在撒谎。

**规矩**：加完图标必须**问外壳要一个矩形**（`Shell_NotifyIconGetRect`），失败就写进日志。实现见 `src-tauri/src/tray.rs`。

## 3. 用 pid 当身份，会被 pid 复用永久钉死

**症状**：LINK 面板与团队面板报 `NO_CAPABILITY：the linkCollab capability is not mounted ... no ledger to read`。

**根因**：协作总线写者锁只存 pid。被强杀的旧内核留下 `collab/.writer`，其 pid（9740）后来被系统分配给 `ShellHost.exe`，"持有者还活着"永远成立 → 新内核永远打不开账本 → 能力挂不上。

**修法**：锁带**心跳**（每 5 秒 touch，关闭时删除），30 秒不跳即判陈旧可回收。见 `plugins/dsh-link-collab/src/index.ts` 的 `openControlLog`。

## 4. Windows 11 默认把新托盘图标收进溢出区

即使注册成功，Win11 也会把新图标放进"隐藏的图标"。开关：设置 → 个性化 → 任务栏 → 其他系统托盘图标；注册表 `HKCU\Control Panel\NotifyIconSettings\<id>` 的 `IsPromoted`（为空 = 隐藏）。`restart-client.ps1` 会顺手置 1。

## 5. PowerShell 自动变量：`$home` 不能赋值

`$HOME` 是保留变量（不区分大小写）。写过 `$home = ...` 之后被测路径其实还指向 `C:\Users\<user>`，会得出"补丁文件丢了 / profile 是原版"这类**完全错误**的结论。用 `$kh`、`$root`。

## 6. 别在 `run_code` 里睡等构建

`cargo build` 约 3 分钟。"停进程 + 构建 + 重启 + 读日志"整条链交**后台任务**，起完立即返回、稍后一次**不阻塞**的读取看结果。

## 7. 夹具改过的世界要复原

夹具会改窗口尺寸、翻页面视口、开关侧边栏。收工要么重开 shell（窗口尺寸不持久化，回 1440x900），要么 `restart-client.ps1 -ResetViewport` 把 `browser.json` 写回 1280x800 固定。

## 8. 对话视图的 renderer 内存没有上限——"加载更早"和"自动折叠"都救不了

**症状**：只开一个会话，LINK 窗口 renderer 内存随时间单调上涨（实测 90MB → 903MB → 1435MB → 1694MB/1.5h），
CPU 128–136%，直到 WebView2 假死（见 9）。同期会话 6384 events / 907 messages / 12 turns / 506 steps。

**别误判**：分页和折叠都在（`chat.loadOlder`、`transcriptView` 四种模式、完成时自动折叠），但：
- 500 条只是**一页**（`HISTORY_PAGE_OPTIONS`）；实时事件 `eventSource.append()` **无裁剪**，只有"更早"是分页的；
- 折叠是**显隐**（文档原话："只改变显隐与尺寸，不重建消息行"；隐藏内容仍可被页内查找命中）——不卸载 DOM/数据/图片；
- 消息列表**没有虚拟化**（`@tanstack/react-virtual` 只用于 TurnNavigator/TrajectoryTable）、图片解码后驻留。

**规避**：重开窗口（事件窗口重置回最近 500 条）或开新会话；截图/长日志只给文件路径 + 摘要，别塞进会话。
细节与证据见 `docs/handoff/R479-live-practice-bugs.md` B2。

## 9. LINK 窗口"假死/消失"：杀 renderer 不会自愈，用托盘 NewWindow 换新窗口

**症状**：窗口点不动但 `/__shell/status` 270ms 正常；WebView2 renderer 单进程 183% CPU。杀掉 renderer 后窗口空白、
WebView2 browser 进程退出、Tauri 不重新导航 → 窗口等于消失（只剩 15×15 隐藏窗口）。

**恢复（不用点托盘）**：

```powershell
$tray = FindWindow('DshLinkTrayWindow', $null)   # 或 EnumWindows 按标题 'DshLinkTray'
PostMessage($tray, 0x0111, 2, 0)                 # WM_COMMAND, ID_NEWWINDOW=2（src-tauri/src/tray.rs）
```

新窗口 = 新 WebView2，同 kernel 同会话，可继续发消息；旧空白窗口 `ShowWindow(hwnd,0)` 隐藏即可。
备用通道：浏览器开 `http://127.0.0.1:31761`（proxy 自带 cookie）。
**缺的自愈**：shell 没有 `WebView2 ProcessFailed → window.reload()`；`core/liveness` 只在"ready 且 60s 无 WS/无请求"
时 reload，renderer 死循环时 WS 还活着，检测不到。

**附带坑（B10）**：所有窗口的 CloseRequested 都是 prevent_close + hide（`lib.rs:520-531`），而托盘 Toggle 只认
`label=main`（`lib.rs:991`）；main 的 WebView2 死了以后，点"显示/隐藏主窗口"打开的是这个空白窗口，
"新窗口"创建的那个 extra window 又不在 Toggle 的视野里 → 表现就是"打不开主窗口"。恢复用 Win32
`ShowWindow(hwnd,9/5)+SetForegroundWindow` 显示活着的那个窗口（实测有效）。

## 10. agent 自由发挥的命令会把机器烧穿（实战两条）

- **裸递归扫描**：agent 发的 `Get-ChildItem -Recurse -File <workspace>\\study`（后半段没排除
  `node_modules|target`）累计烧了 **38,661 CPU 秒 ≈ 10.7 CPU 小时**，卡了 2 小时。团队纪律要明文禁止裸递归扫描。
- **构建/预览风暴**：12 个 agent 同时跑出 2 cargo / 5 rustc / 21 个 vite dev+preview（端口还重复）。
  需要 `.build.lock` 目录锁串行 + 固定端口复用 + 非关键成员 interrupt。
- 系统层兜底：把构建进程降 `BelowNormal`、WebView2 升 `AboveNormal`，UI 立刻能喘气。

## 11. 智能体团队面板：teammate 明明在跑却显示"空闲"

面板（`dsh-link-teams`）读的是**协作总线控制台账**（`/api/dsh-link-teams/state`），不是 kernel Agent Teams 的运行时：
mindmap 节点是"会话级 team"，状态取该 team 第一个成员（`mindmap.tsx:137`，空 → `idle`）。实测 teammate 的 team 行是
`declared:true, observed:false, members:0` → 恒 idle；成员行只挂在 Lead team 名下，其 `state:"active"` 是 claim 状态，
不是"正在跑"。**修法**：client 半轮询 `session/list` 拿 `running` 覆盖节点状态（重开窗口生效，无需重启内核）；
正统修法是 host 半并入 `ctx.agents` 的 availability。见 R479 B1。

## 12. provider 瞬时失败会打死整轮；判据只看 durable `turn/end`

网关抖一下即可让模型流以 `terminated` 结束，agent loop 展平成 `turn/end reason=error{code:UNKNOWN}`，整轮停。
内核**没有** durable 的 `agent/error` 会话事件（只在 WS/UI 出现），所以"任务崩溃"的唯一可靠判据是
`turn/end.reason.kind`（error/interrupted；max-tokens/aborted 是正常结束）。
**修法**：挂 `dsh-ocgo-retry`（12 次重试、指数退避），provider 抖动在同一个 step 内消化；
预算耗尽才终态失败，再走"确认恢复 → 发继续"。

## 13. 侧栏 tab 类型必须自己带样式表和滚动容器

shell 给每个右栏 tab body 的容器（`ui-sidebar-right/src/client/shell/SidebarRight.module.css` 的
`.tabBody`）是 `display:flex; flex-direction:column; height:100%; min-height:0; overflow:hidden`——
**它不给内边距，也不做滚动**。一个只注册了 slot、没带样式表的 tab 类型（R480 前的 `dsh-link-markdown`）
表现就是：文档被裁掉（滚不动）、文字贴着栏边。

**规矩**：新 tab 类型至少要有
```css
.root { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; height:100%; overflow:hidden; }
.root .doc { flex:1 1 auto; min-height:0; overflow:auto; padding:14px 18px 28px; box-sizing:border-box; }
```
并在 `apply()` 里用 `ctx.effect` 挂一张插件独占的 `<style>`（`dsh-link-toolbar`/`dsh-link-teams`/`dsh-link-markdown`
的同一惯用式；宿主没有 `styles` 服务）。色值/字号只用 `--dsw-*` 令牌。

## 14. 大批 agent 并行会撞会员并发上限（OpenDesign 11/10）

实测（`ocgo-retry/retry.log`，2026-10-25T08:10Z）：12 个 agent 同时发请求时，opendesign 返回
`400 [code=tier_limit_exceeded] membership concurrency limit exceeded: 11/10`，同段还有 `upstream_stream` 错误。
重试层只能把 400 当普通失败重试。**规矩**：同时活跃的 agent 控制在会员并发数以内（当前档位 10），
其余用 `send_message` 串行唤醒/错峰启动；要更多并发先升级档位。

## 15. 网络类健康探针要「持续时间」，不要「连续次数」

ask-for-help 等待任务原来的服务商探针是"60s 一次、连续 2 次失败即报警"，结果两次 Cloudflare 边缘
约 2 分钟抖动（timeout/EHOSTUNREACH/ECONNRESET）都触发了 `provider-broken`，复测时网关已经 200。
**规矩**：网络探针要求"连续 N 次 **且**已持续 T 分钟"，并在报告里带上"当时有没有正在跑的任务"；
恢复时打一行恢复日志而不是静默重置。当前实现：连续 3 次且 ≥3 分钟（`--provider-failures` / `--provider-down-ms`）。

## 16. `useMemo → useEffect → setState(新对象)` 会自激成 50Hz 渲染循环

团队面板的标题 effect 依赖 `layout`（useMemo，依赖里含 `titles`），而 `setTitles(old => ({...old, ...body.titles}))`
每次都造新对象 → layout 重算 → effect 再跑 → 再 fetch：实测 `/session-title` 每 ~20ms 一发（250ms 12 条），
面板持续重渲染、读数发旧。**规矩**：这种链路里 setState 必须先比内容，没变就返回**旧对象**。
修复后 3s 内重复请求 = 0。


## 17. 工具输出 schema 必须声明你返回的每个属性（R484-P1，实测）

多层级 Agent Teams 的 roster 行会带 `depth` / `spawnedBy`，但 `spawn_teammate` / `list_agents` 的
模型输出契约是 `additionalProperties: false` 的静态 schema。只加返回值不加声明 → 服务端操作成功，
模型却收到 `ToolOutputError INVALID_TOOL_OUTPUT`（实测 builder seq9793），并**考虑重试 → 重复 spawn**。
教训：凡是"按配置条件返回的新字段"，其 schema 也必须静态声明为 optional；默认配置不产生值，
模型可见输出才与上游一致。改完必须同时跑 `tsc`（契约类型）和 tool 测试。
