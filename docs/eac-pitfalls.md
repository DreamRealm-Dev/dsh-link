# DSH EAC 桌面版踩坑对照报告

> 2026-10-05 通读 `<eac-checkout>` 的自研注释代码后整理。
> 目的：看 EAC 作者做 DSH 桌面端时踩了什么坑，逐条判断 DSH Link（Tauri 壳 + DSH 0.2.1-alpha.1 + 反代官方客户端）还会不会遇上。

## 0. EAC 的代码结构（两代壳共用一份自研代码）

| 层 | 位置 | 说明 |
|---|---|---|
| 旧代 v4.4.1（Electron） | `resources/app/main.js` 等 | 内核 0.1.0-rc.7，保留为可回退主线 |
| 现役代 v5.3.5（Tauri） | `dsh-eac-shell.exe` + `sidecar/*.js` + `dsh-desktop/lib/desktop/*` | 内核 0.1.2-alpha.1 vendored；Rust 壳 → stdio JSON-RPC → Node sidecar → 内核 |
| 自研业务模块 | `dsh-desktop/*.js`（18 个带注释的顶层模块） | 插件守护、端口、流守卫、会话监视等 |

关键发现：**EAC v5.x 本身就是 Tauri 壳 + 内核 Web UI**，其手机桥（`sidecar/phone-bridge.js`）做过"完整 Web UI 反向代理"，与 DSH Link 架构同源，注释极具参考价值。

## 1. EAC 的启动加载界面（DSH Link 新引导页的参照）

- **旧版** `resources/app/assets/loading.html`：深色径向渐变（`#1b2a6b → #0b1220`）+ 52px border 转圈（`border-top-color:#5b8cff`、0.9s linear）+ 文案"DeepSeek Harness 正在启动…"。
- **新版**：同样式内嵌在 Rust 壳里，34px spinner，"正在启动服务… / Starting services…"，另有 `/died` 失败页（错误码 + 日志路径 + 重载/重启按钮）。
- **作者实测后认为最不引发用户恐慌的组合**：深底径向渐变 + 单行状态文字 + 蓝色转圈 + "首次启动可能需要几十秒" + 日志路径提示。
- **就绪感知**：壳收到 sidecar 的 `boot.web-ready` 通知后才导航切主界面，不让 loading 页干等猜测；后端就绪判定用「stdout token 行」与「HTTP 免鉴权探测（favicon.svg）」**双通道赛跑**，探测胜出后再等最多 30s 拿 token 行。

DSH Link 已按此重写 `src-tauri/src/core/shellpage.rs`：同款渐变/spinner/单行状态 + 已耗时计时，失败时红色错误 + 重试按钮 + 底部脚注（版本/内核路径/日志路径），就绪后自动 `location.replace('/')`。

## 2. 坑清单与适用性判定

标记：✅ 已规避 ｜ ⚠️ 仍可能踩上（已核实/待办）｜ ➖ EAC 特有架构才有，不会遇上。

### A. 端口与加载

| 坑 | EAC 解法 | 判定 |
|---|---|---|
| A1 端口撞 Chromium 受限端口列表 → WebView 白屏 ERR_UNSAFE_PORT | 内置受限端口集合，选端口避开 | ✅ 31760/31761 都不在黑名单；但若将来允许改端口须校验 |
| A2 `--port 0` 随机端口 → 每次换 origin → localStorage 偏好丢失 | 持久化固定端口 | ✅ 固定 31761，天然免疫 |
| A3 站内预览 iframe 与长连接抢 HTTP/1.1 6 连接上限 | 独立回环端口只读静态服务 | ➖ 官方客户端自己管理资源；暂无此用法 |

### B. 鉴权 / 就绪探测（0.1.2 一族，0.2.x 同模型）

| 坑 | EAC 解法 | 判定 |
|---|---|---|
| B1 裸 `/` 401 只证明端口活着；就绪探测必须打免鉴权资源 | 探测 `favicon.svg` | ✅ 我们探测 `/` 但**带 cookie** 断言 200，语义等价且更强 |
| B2 stdout token 行被管道分块截断 → token 永久丢失 → 401 白屏 | 跨 chunk 行缓冲 | ✅ Rust 侧 `BufRead::lines()` 天然按完整行 |
| B2' 探测胜出但 token 行迟迟不来（慢盘/杀软拖慢管道） | 探测后再等 30s 拿 token 行 | ⚠️ 我们是**串行**：先等 announcement（180s 上限）再做 token 交换再轮询 60×500ms。方向相反但覆盖面相同——announcement 不到会一直等，不存在"探测通了却拿不到 token"的死角。不改 |
| B3 `--no-open` 曾从内核消失 → 每次启动弹系统浏览器 | 契约测试钉住该 flag | ⚠️ 0.2.1-alpha.1 目前支持（已在用）；升级内核时留意 |
| B4 内置 node 不信任系统 CA → 企业代理下 fetch 失败 | `--use-system-ca` | ➖ 内核用系统 node；暂无此症状 |

### C. 进程监管

| 坑 | EAC 解法 | 判定 |
|---|---|---|
| C1 stdout 就绪行被缓冲吞掉 → 假超时 | 双通道赛跑 | ✅ 同 B2' |
| C2 重入启动不等旧进程真正退出 → EADDRINUSE 假阳性（Windows 强杀延迟落地） | kill 后 `waitForProcExit(20s)` | ✅ **已移植**（2026-10-05）：`supervisor.rs` 重启路径先 `wait_for_port_free(31760)`（≤10s 探绑等待），等待期间释放槽锁并重查槽位 |
| C3 `taskkill` 不加 `/F` 撕裂 zstd 会话文件 | 先优雅后强杀 | ✅ Rust `kill()` 即 TerminateProcess，无中间态 |
| C4 大备份同步 rm 冻结事件循环 → boot 超时 | 应答先行、清理推迟 30s 走 async | ✅ Rust 壳无事件循环问题；启动路径无大清理 |
| C5 逐文件同步 PowerShell 冻结启动 | 批量异步 | ✅ 无此代码 |
| C6 listen 未完成就 `address()` → null | await listening | ➖ Rust `TcpListener::bind` 同步返回 |
| C7 渲染进程 0xC0000005 崩溃黑屏无恢复 | 退避 reload → 重建 → 错误页，30s 稳定清零 | ✅ **已移植变体**（2026-10-05）：Tauri 2.12/wry 0.57 不暴露崩溃事件，改由代理观测失联（`core/liveness.rs`：就绪态下 60s 无 WS 且无请求 = 窗口死亡），`lib.rs` 看门狗执行 重载×3 → 恢复页 → 10min 冷却 的升级链，窗口恢复即清零 |
| C8 壳意外死亡无拉起 | 独立看门狗，10min/5 次限速 | ➖ 可选；DSH Link 无自动更新链路，暂缓 |
| C9 stdout 日志 append 无轮转 → 数百 MB | >10MB 截尾保留 2MB | ➖ **有意不做**：本壳 boot.log 每次启动 truncate，增长边界是单次会话输出；且 stderr 由内核直写同一文件，运行中截尾会与子进程的文件偏移打架（稀疏文件损坏），EAC 的截尾法在这里不安全 |

## 附：本轮移植中发现的自身问题（EAC"回归检查必须能失败"的活例子）

- `probe-proxy.mjs` 第 6 项的关闭检测是死代码（`raw` 在 upgrade 后从未更新，close 判断永远为假），socket 挂断也读作 PASS——该探针从写下那天起就没真正测过它要防的回归。已修复：换成合法的 Gateway `open` 帧上行（`ready` 是内核→客户端的下行帧，客户端发它会被内核秒断）、真帧解析检测 Close、补挂 close 事件。

### D. 插件树 / cordis.patch.yml（EAC 重灾区）

D1–D16 共 16 条：patch 行缩进/重复 config 拖垮整树、bundle 自带 patch 与 overlay 重复、pnpm hoist 遮蔽 junction、NSIS 卸载骨架化、市场安装撞文件锁……EAC 为此建了整套"守护启动"（快照→体检→自愈→回滚）。

**判定：➖ 整片不适用**。DSH Link 不写插件、不改 profile、无安装器——内核 profile 由官方 CLI 管理。唯一例外：

- ⚠️ **D4/D11 变体现在真实出现了**：2026-10-05 往 profile 装 `dsh-opencode-go` 时，官方 `dsh plugin add` 因 pnpm `ERR_PNPM_IGNORED_BUILDS` 退出码 1，**bundles 条目没有自动登记**（pnpm 失败 → reconcile 未执行），需要手工补 `"dsh-opencode-go"` 进 `dsh.profile.bundles`，否则插件装了也不加载。这与 EAC 文档 D 系列的教训一致：**装完插件必须确认 bundles 登记与组合树（`--dump-config`）**。已写进 GOAL.md 的安装记录。

### E. Windows 文件系统 / 原子写

E1/E2（tmp 踩踏、先删后 rename 两步间被杀）：⚠️ 通用最佳实践——DSH Link 目前只写 overlay 种子（exists 才跳过），风险面极小；将来写 settings/凭据时按此实现。E3–E5 为 EAC 插件拷贝特有 ➖。

### F. 更新器

F1–F5（cmd 剥引号、npm 卡死、prerelease 比较错、并发互删 staging、GH 加速域名易主）：➖ DSH Link 无自更新链路。将来做 zip 自更新时 F1/F4 有现成答案。

### G. 流式 / WS / 反代（与 DSH Link 最相关）

| 坑 | EAC 解法 | 判定 |
|---|---|---|
| G1 write-after-end 异步抛出不可 try 捕获（进程 exit 后迟到的日志写崩流） | stream error 收编 + writableEnded 检查；`close` 才 end | ✅ Rust 侧 `append()` 忽略写错误，语义等价 |
| G2 WS 双向 pipe 半开悬挂（对端静默断网无 FIN/RST → 内核 WS 会话永不回收） | 两端 TCP keepalive 30s + 一端 close 显式 destroy 对端 | ✅ **已移植变体**（2026-10-05）：`relay_sockets` 每 15s 对静默跳发 WS Ping，静默跨两次未应答（45s）即拆链回收；心跳节奏参照 EAC phone-bridge。实测：健康客户端跨两个心跳 tick 存活 70s，静默链路按设计回收 |
| G3 反代改写 Host/Origin 为内核 origin（信任围栏同源） | 改写头 | ✅ 窗口与内核同经 127.0.0.1 反代，天然同源；若做 LAN/手机访问必须补 |
| G4 WS 升级头发出后无法重试 → cookie 先兑换再升级 | 缓存 cookie 同步兑换 | ✅ 我们的 cookie 由壳预先持有，升级请求直接带上 |
| G5 RPC 通道断线重连纪律 | 1500ms 退避、未就绪排队、30s 超时 | ✅ 官方客户端自带重连；壳无自研 RPC |

### H. 数据/性能杂项

- H1 会话通知基线、H2 cwd 扫描缓存、H3 退役清单无条件比对 ➖（EAC 自研功能特有）。
- H4 无人值守弹窗 fail-closed（绝不自动答"立即更新"）：⚠️ 通用原则，将来加任何自动确认 UI 时遵守。
- H5 日志 PII 脱敏：✅ 已做（launch token 写日志前替换为 `<launch-token>`）。
- H6 内核补丁文件原子写：➖ 不改内核源码。
- H7 "体检救不了的配置级崩溃"要靠错误文本特征匹配 + 针对性自愈：⚠️ 方法论，留给将来的故障恢复页。

## 3. 结论

DSH Link 的纯反代架构天然免疫 EAC 坑列表的 **80%**（D/F 系列整片、Electron 专属、EAC 自研功能层）。真正带走的是五组：

1. **就绪探测语义**（B1）——已规避，"端口活着 ≠ 可用"，我们带 cookie 探测。
2. **进程收尾时序**（C2）——已移植（`wait_for_port_free`）。
3. **WS 半开回收**（G2）——已移植（`relay_sockets` 心跳看门）。
4. **渲染进程崩溃恢复**（C7）——已移植变体（代理观测失联 + 重载→恢复页→冷却升级链）。
5. **日志轮转**（C9）——有意不做，理由见上表。

另有一条安装链路教训（D4 变体）：`dsh plugin add` 在 pnpm 退出码非 0 时**不会**登记 bundles 条目，装完插件必须 `--dump-config` 或启动日志确认挂载。

> 署名说明：以上移植均为**思路参照**（问题、失败模式、恢复策略与参数节奏），未复制 EAC 任何源码；实现针对本壳架构独立编写。出处对照见项目根 `THIRD-PARTY-NOTICES.md`（EAC 自研代码为 MIT）。
