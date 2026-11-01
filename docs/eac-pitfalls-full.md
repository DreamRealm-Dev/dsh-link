# DSH EAC 自研代码全量踩坑目录

> 2026-10-05 地毯式通读 `<eac-checkout>` 全部自研代码后整理（v5.3.5；内核 0.1.0-rc.7 / 0.1.2-alpha.1 vendored）。
> 三路并行逐文件提取（dsh-desktop 顶层 19 模块 / lib·shared·scripts / Electron main.js 5001 行 + sidecar 四件套），合并去重后约 300 条独立条目。
> 本篇是**全量目录**；`docs/eac-pitfalls.md` 是精华对照与判定依据。思路参照、未复制代码，出处对照见根目录 `THIRD-PARTY-NOTICES.md`（EAC 自研为 MIT）。
>
> 判定标记：🔧 已移植进 dsh-link ｜ ✅ 已规避（架构免疫） ｜ 🟢 建议落地（可做） ｜ 🟡 条件适用 ｜ ➖ EAC 特有/不适用 ｜ ⚰️ 0.2.x 已失效/被官方覆盖

---

## 0. 版本时效性核对（对 0.2.1-alpha.1 内核源码实测）

| EAC 经验的前提 | 0.2.1 现状（出处） | 结论 |
|---|---|---|
| 0.1.2 token 一次性兑换 cookie | `browser-auth.ts:245` tokenMatches 对进程级 launchToken，**可重复兑换**；cookie 30 天（`connection/index.ts:113` 默认 30）、**authority 绑定** | 鉴权族经验仍全部适用 |
| `--no-open` 曾消失（PR #249） | `packages/bundle/web-app/src/index.ts:293` 仍在（openBrowser config） | 保持传入 + 升级内核时回归检查 |
| encodingMismatch 必死（Issue #77） | `session-persistence-jsonl/src/index.ts:1663` 仍在，且**新增** legacyLayout（flat-file 拒载） | D12 教训仍适用；勿混用编码 |
| LAN/Origin 信任全靠反代改写 | 0.2.1 **新增** `trustedHosts` + `resolveLanTrust`（web-app）| G3 类改写若做 LAN 访问可改走官方围栏 |
| 插件管理页错报/全核心（D13/D14） | 0.2.1 官方 `ui-plugin-manager`（manager-store：enable/disable/rowEnable/uninstall） | D13/D14 被官方实现覆盖，⚰️ |
| `globalThis.__DSH_MODULES__` 缺失（兼容垫片） | 0.2.1 仍是 `__ModuleLoader__` 队列契约、factory 单参 `(require)`（`modules/src/index.ts:556`、`tsdown.client.ts:617`） | 垫片经验 🟡 仅当要跑旧社区插件 |
| `dsh plugin add` 自动登记 bundles | 0.2.1 会登记（plugin-manager operations.ts:106），**但 pnpm 退出码非 0 时不登记**（dsh-opencode-go 实测） | 装完插件必验 bundles/dump-config |
| 共享 junction 被外部 dsh 抢（D9/D10） | 0.2.1 app-boot 只扫描 profile node_modules 内链接，机制已收敛；且我们 DSH_HOME 应用独占 | 风险大降，🟡 观察 |

---

## 1. 启动与引导（boot-server / stable-port）

1. `[boot-server:202-210]` stdout 就绪行**跨 chunk 行缓冲**——按块 split 会把 token URL 截成两半永久丢失 → 401 白屏 ｜ 🔧（Rust `BufRead::lines` 天然按行）
2. `[boot-server:258-295]` 就绪探测打**免鉴权资源**（favicon.svg）而非 `/`——0.1.2 起裸 `/` 401 只证端口活着 ｜ ✅（我们带 cookie 探 `/`，语义更强）
3. `[boot-server:258-295]` 探测胜出后**再等 token 行最多 30s**（300×100ms）——曾只等 5s，慢盘/杀软拖慢管道 → 回退裸 origin → 401 白屏 ｜ ✅（我们串行等 announcement 180s，无此死角）
4. `[boot-server:310-314]` boot 超时分档：首启（pnpm 装依赖）180s / 稳态 60s，`timer.unref()` ｜ ✅（我们固定 180s，仅起步阶段）
5. `[boot-server:317-321]` 探测 URL 拼接必须 `new URL('favicon.svg', url)`——`url+'/'` 把路径插到 `?token=` 前探测 404 ｜ ✅（Rust `Url::set_path/set_query` 分离）
6. `[boot-server:297-309]` exit 处理 `intentional` 守卫（重启中/进程已换代不误报"服务已死"）｜ ✅（supervisor 的 take+重启链已区分）
7. `[boot-server:43-96]` **.credentials.yaml 版式自愈**：引号 `version:"1"`（内核严格 ===1）与 rc.2 扁平文件都被拒启 → 拉起前文本级自愈；**旧正则 `\S` 只匹配单字符 → 多字符 API key 永不触发，潜伏半年**；凭据文件必须原子写 ｜ 🟡（我们凭据只由壳种过一次；用户手改坏版式会拒启——failure 消息可读即可）
8. `[stable-port:9-24]` localStorage 按 origin 隔离——`--port 0` 每次换 origin → 用户 UI 偏好丢失；固定端口 ｜ ✅（固定 31760/31761）
9. `[stable-port:13-24]` **Chromium 受限端口**（ERR_UNSAFE_PORT 白屏，90+ 个：6000、6665-6669、10080…）；随机命中重试 5 次 ｜ ✅（固定端口已避开；若将来允许改端口须校验）
10. `[boot-server:150-151]` `--use-system-ca`：MITM/企业代理下内置 node 默认 CA 验证失败 → 市场等对外 fetch 全挂 ｜ ✅（用系统 node，天然信任系统 CA）

## 2. 进程监管与收尾

11. `[proc.js:27-40 / main.js:277-335]` **先优雅后强杀**：taskkill 无 /F → 1500ms 查活 → /T /F；直接强杀撕裂 session.jsonl.zstd ｜ ✅（Rust `kill()`=TerminateProcess，无中间态）
12. `[proc.js:173-175 / boot-server:104-113]` **kill 后必须等真正退出再重拉**（`waitForProcExit(old, 20s)`，tasklist 200-500ms 轮询兜底）：Windows 控制台强杀 +1500ms 才落地，立即重拉必 EADDRINUSE（"启动失败"假阳性）｜ 🔧（`wait_for_port_free` ≤10s 探绑等待 + 放锁重查槽位）
13. `[main.js:578-590 / proc.js:108-114]` **子进程环境清洗**：删 DSH_WEB_URL/DSH_SESSION_ID/ELECTRON_RUN_AS_NODE/NODE_OPTIONS 等残留，防带病启动 ｜ 🔧（supervisor `env_remove` 四项）
14. `[proc.js:115-151]` settings.yaml mtime 记忆化（5s TTL）——每次 spawn 全量读+yaml.parse 是热点 ｜ ➖（我们 spawn 一次）
15. `[proc.js / boot-server]` 日志流 `close` 事件（而非 exit）才 end + **流写守卫**（stream-write-guard）：Writable 失败异步 emit，try/catch 包不住 write-after-end/EPIPE；write 前查 destroyed/writableEnded ｜ ✅（Rust `append()` 忽略写错误）
16. `[boot-server:128-147]` dsh-web.log 超 10MB 截尾保 2MB（append-only 数百 MB 膨胀）｜ ➖ 有意不做：stderr 内核直写同一文件，运行中截尾会稀疏损坏；boot.log 每启动已 truncate
17. `[watchdog.js]` 独立看门狗：poll 父 PID 2s；**EPERM 视为存活**（kill(pid,0) 权限不足≠死亡）；10min 窗口最多拉起 5 次、15s grace；`cleanExit` 标记区分自愿退出；poll 定时器不能 unref ｜ 🟡（dsh-link 无自拉起；若做崩溃自恢复可参照限速参数）
18. `[main.js:302-335]` 退出后 node.exe+conhost.exe **成对残留**：强杀补刀挂在 setTimeout 上随主进程湮灭；无 /F 的 taskkill 对控制台进程无效 → `killTreeAndWait` 全程有界（grace 1200ms / hard 4000ms）｜ ✅（Rust 同步 `kill()+wait()` 有界）
19. `[sc/server.js:82]` sidecar **全局兜底**：unhandledRejection 记日志继续跑；uncaughtException 记日志后退场（壳感知 server-died 走恢复链），好过无声僵死 ｜ 🟡（Tauri 壳可类比：panic hook + proxy 5xx 可读）
20. `[sc/server.js:289-293]` 退出不直接 process.exit——通知帧可能未冲刷；优雅退出由上层有界收口 ｜ ✅（Tauri RunEvent::Exit 链）

## 3. 渲染、窗口与 WebView2

21. `[renderer-recovery.js]` **渲染崩溃恢复状态机**（Issue #9，0xC0000005 黑屏）十条纪律：①稳定存活 30s 才清零 + failuresAtLoad 脏检查防"崩→愈→崩"慢循环；②挂起→crash 的 pendingHangCrash 10s 容忍窗防重复计数；③新故障取消在途恢复动作并 gen+1 使在途加载失效（防单飞跳级）；④did-fail-load 只看主框架、-3 ERR_ABORTED 跳过、loadFlight 防双计数；⑤心跳只对可见窗口（隐藏时定时器被节流）；⑥可见性用 show/hide 事件追踪而非 isVisible()（RDP/挂起误报）；⑦重新可见立即补心跳防托盘唤出误判；⑧gaveUp 后迟到加载成功强制回错误页；⑨load 超时只放弃等待绝不 kill webContents；⑩挂起宽限 20s 后 forcefullyCrashRenderer 统一走恢复 ｜ 🔧（`liveness.rs`+`watch_window` 移植了核心升级链：重载×3→恢复页→600s 冷却；上列细粒度参数在加码时参照）
22. `[sc/bridge.js:713-743]` **viewport-beat**：WebView2 在 DPI/副屏事件被吞时视口停留旧尺寸——侧边栏只剩图标+黑屏冻结；心跳上报视口尺寸与窗口实际超差即重申 bounds ｜ 🟢（WebView2 通病，Tauri 可用 set_bounds 自愈；副屏/DPI 用户可遇）
23. `[main.js:627-642]` **导航围栏**：origin 精确比较（前缀比较可被 `127.0.0.1.evil.com`、userinfo 逃逸）；file: 一律拦；will-navigate+will-redirect 同规则；外链转系统浏览器 ｜ 🟢（Tauri `on_navigation` 可做同款围栏；CSP 已部分覆盖）
24. `[main.js:1474-1555]` 浮窗 partition 隔离（persist:dsh-float）防 localStorage 会话选中态互踩；`additionalArguments` 传参不污染 URL ｜ ➖（无浮窗功能）
25. `[preload.js:390-397]` 自绘标题栏用 `data-dsh-title-bar-height` 属性声明高度，客户端插件据此自动下移防遮挡 ｜ ➖（不自绘 UI）
26. `[sc/bridge.js:398-506]` **内核 UI 稳定性垫片**（issue #217）：中栏抽搐/新建对话顶部不可滚达/弹层被盖/悬停浮层撑横滚条四类修复；**CSS Modules 哈希类名前缀随内核版本漂移** → 旧哈希仅兜底、锚定 data-phase 等稳定契约；弹层翻转救援用 WeakSet 记忆翻转态防 200ms 震荡、MutationObserver 用 rAF 合帧防流式输出期间全树 querySelectorAll 烧 CPU ｜ ➖（不改官方 UI；做壳内 CSS 注入时这些是必守纪律）
27. `[main.js:1651-1661]` 新老用户判定必须在**任何写盘之前**（settings.json 被迁移流程创建后就永远判不出新用户）｜ ➖（无向导）
28. `[main.js:4945-4956]` 单实例锁（双开双写 profile）；second-instance restore/focus ｜ 🟢（Tauri 有 single-instance 插件；值得加）

## 4. WebSocket / 反向代理 / 鉴权（phone-bridge 经验族）

29. `[phone-bridge:260-305]` token→cookie 服务端自兑 + 缓存；**兑换请求 8s 有界超时**——内核 accept 后不应答时 Promise 永不 settle，桥整体卡死 ｜ 🔧（壳预持 cookie；连接超时有界）
30. `[phone-bridge:613-632]` **WS 升级头必须发出前定稿**（无法 401 后重试）；101 后已到达的初始数据必须写给**浏览器**方向（误写上游丢帧断流）；上游 426 等状态码透传 ｜ ✅（cookie 预持；tungstenite 握手语义天然正确）
31. `[phone-bridge:634-668]` **WS 半开悬挂**：手机断网/杀进程常无 FIN/RST，pipe 永不 end → 内核会话永不回收；升级后 socket 脱离 http.Server 连接计数，closeAllConnections 不覆盖 ｜ 🔧（`relay_sockets` 15s 心跳探静默跳、45s 拆链）
32. `[phone-bridge:69-80]` **crypto.randomUUID polyfill**：LAN 明网 `http://192.168.x.x` 是非安全上下文，Chrome 92+ 不暴露 randomUUID → 内核 RpcId 生成崩、全部 RPC 失败 → HTML head 注入 polyfill（内核不动）｜ 🟡（我们 origin 127.0.0.1 是可信上下文；做 LAN 访问时必带）
33. `[phone-bridge:421-457]` 401 重放前**先整缓冲请求体**（流只能消费一次；重放空体 + 原 content-length = 内核按空载荷 200 收场，静默错误）｜ 🟡（我们一次性读 body 后转发，天然免疫）
34. `[phone-bridge:471-544]` 体重建后**双 framing 非法**（chunked+content-length）——缓冲/gzip/注入三处都要 delete transfer-encoding ｜ 🟡（我们不改写 body）
35. `[phone-bridge:514-525]` gzip 只压 unary JSON（SSE/WS/静态透传），蜂窝省 70-90%；`[phone-bridge:484-494]` **首字节后撤销空闲超时**（`setTimeout(0)`）防长间隔 SSE 被掐；`[phone-bridge:487-565]` `up.on('error')` 统一 destroy + `res.on('close')` 未写完 destroy 上游——三分支共用缺兜底则缓冲分支 end 永不触发 ｜ 🟢（relay_body 目前不设超时，天然无此坑；若加超时须记住这条）
36. `[phone-bridge:359-404]` 回环 API 的 **CSRF**（任意网页 `<img src=http://127.0.0.1:P/...>` 打进来）→ 只收 POST 且 Sec-Fetch-Site: cross-site 拒绝；**TOCTOU**：读 body 让出事件循环期间 token 可能轮换 → 先捕获 pairing 对象写回前复核 409 ｜ 🟡（我们 CORS 层已拒外域 Origin；无配对状态机）
37. `[phone-bridge:81-109]` LAN 地址选择优先 RFC1918，避开虚拟网卡 169.254.x ｜ ➖（无 LAN 功能）
38. `[phone-bridge:186-226]` 会话密钥轮换：断开连接必须轮换 cookie 值（静态 "1" 一年有效）；重启密钥不变免重配对 ｜ ➖

## 5. 插件树 / cordis.patch.yml / 插件管理（EAC 重灾区，多数被 0.2.x 官方化）

39. `[patch-row-heal:4-19 / companion-sync:64-68]` **v2.0.0 持续崩溃循环**：dsh-soul-md schema 把 path 声明 required 无默认，sync 写的行只有 id+name → 行校验失败**整树崩溃**（dsh web exit 1）；exe 每次启动重写该行，用户删不掉 ｜ ⚰️（0.2.1 官方 CLI/UI 管行；我们不改行）
40. `[patch-row-heal:20-46]` **config 缩进纪律**：insert 块行 4 空格（config 6/keys 8）vs 顶层行 0（config 2/keys 4），错步 = YAML parse error = 整树崩；normalizeRowConfigIndent 幂等重排 ｜ ⚰️ 同上，🟡（手工编辑 profile patch 时是必守纪律）
41. `[patch-row-heal:119-130]` **重复 config 事故**（V4.4）：只看"紧跟一行"会漏 `name→disabled→config` 形态补出第二份 config → duplicated mapping key；改扫描**整个条目块** ｜ ⚰️ 同上
42. `[patch-row-heal:233-252 / builtin-collision / issue #16]` **overlay 行与 bundle 自带 patch 行重复 → duplicate loader entry id** 整树 abort；git/fork/link 安装的包名 ≠ 行包名，只按包名匹配永远删不掉 ｜ ⚰️（0.2.1 `dsh plugin add` 走 bundles 不写 overlay 行）🟡教训保留：装插件后查 duplicate entry
43. `[companion-sync:763-772]` 内核隐私开关用"编辑型"覆盖行（不在 insert 列表 = 改既有行 config）而非再 insert——同 id 双行 cordis 行为未定义 ｜ 🟡（写 overlay 时：改 `- id` 行而非 insert）
44. `[companion-sync:829-830]` `[]` 替换锚必须**整行锚定** `/^\s*\[\]\s*$/m`——裸 `/\[\]/m` 会命中 config 行的 `key: []` ｜ 🟡（同上）
45. `[plugin-manager-patch:218-222]` 禁用条目手术：贪婪正则会吞兄弟条目 → 逐行扫描"条目块"；`-`（空块项）与 `- id:` 两种官方写形都要兼容；hasEntryId 用 `(?![A-Za-z0-9_.-])` 负向断言防 `dsh-pet` 误命中 `dsh-pet-settings`；先清 insert 内层再补顶层 disabled，防双登记 ｜ ⚰️（0.2.1 官方管理页做这事）
46. `[plugin-manager-state:8-15 / issue #212]` 管理页 disabled 双登记点合并；core 白名单只认内核骨架（dsh-base/dsh-web-app/web-runtime…），第三方 bundles 可开关 ｜ ⚰️（官方 manager-store 已实现 enable/disable/uninstall）
47. `[companion-sync:1-26 / profile-module-heal]` **模块双实例**：pnpm hoist 核心包真实副本遮蔽 junction → Symbol 身份断裂 → "设置命名空间不可用"/"already registered"/模型列表瘫痪；heal = 删遮蔽拷贝回落 junction，且**只在 fallback 链接健康时才删**（否则删掉最后健康副本 brick 解析，Issue #7 guard）；Windows junction 必须 unlink（rmSync force 抛 EISDIR）；单目录 EBUSY 独立 try 不中断整体 ｜ 🟡（0.2.1 机制收敛 + 我们不改 profile 依赖；但**用户在 profile 里 pnpm add 过后**，这些症状仍可能复现——诊断时按此思路）
48. `[companion-sync:799-812]` bundle entry id 集合去重（读每个 bundle 包 `dsh.bundle.patch` 指向文件声明的 id 集合）｜ 🟡（诊断 duplicate entry 时有用）
49. `[main.js:2959-2973]` 社区插件**禁止写 profile package.json 依赖**（pnpm hoist 双实例根源）——只拷副本 ｜ 🟡（我们装 dsh-opencode-go 用官方 CLI 是对的；手工装社区包时警惕）
50. `[main.js:2982-2989]` dsh-pet 行必须带 config（apply 读 config.fullRoot 无守卫，undefined 拖垮整树）｜ ⚰️（不装该类行）
51. `[companion-sync:374-402 / issue #74]` 退役插件三处清理（行/包/依赖）+ **双键门控**（版本变化或退役清单 hash 变化才执行一次）——只比版本则同版本内新列入的退役条目永远清不到（5.1.0 实测）；直调无门控版会每次启动强制改写用户插件树 ｜ ➖（我们不内置插件）
52. `[companion-sync:664-678]` 内置清单标记文件（`.dsh-builtin-plugins.json`）防市场覆盖安装双实例 ｜ ➖
53. `[plugin-manager-state / plugin-ops]` "启用"保留顶层裸条目防 sync 插回 disabled；js-yaml 需注册 `tag:yaml.org,2002:js` 方言（dsh patch 用 `!!js` 表达式标量，默认 JSON_SCHEMA 解析失败）｜ 🟡（解析内核 patch 文件时需要 `!!js` 支持——我们 dump-config 走内核自身，无此需求；外部工具解析时记住）
54. `[main.js:3265-3340 / market.js]` 市场排队任务（服务运行中安装 EPERM：vec0.dll 被加载）→ 写标记文件在"无服务持锁窗口"执行；`CI=true` 让 pnpm v10 对 ignored-builds 静默放行（**ERR_PNPM_IGNORED_BUILDS 硬失败可这样绕**）；失败从输出 parse 包名写 allowBuilds 重试一次 ｜ 🟢（我们装 dsh-opencode-go 撞过 ERR_PNPM_IGNORED_BUILDS；下次 `dsh plugin add` 可带 `CI=true` 环境避免 bundles 漏登记）
55. `[market.js:252-257]` pnpm 后立刻清遮蔽拷贝 + artifacts 快照回填（pnpm 重写 node_modules 会清掉人工构建产物 lib/）｜ ➖
56. `[companion-sync:17]` rc.2 起首启重建共享层会清掉 dev 符号链接 → 需要的真实依赖副本落位（版本戳幂等）｜ ➖

## 6. 模块解析 / junction / 安装完整性

57. `[bundle-integrity / main.js:4767-4796 / Issue #7]` **NSIS 卸载中断 → 空目录骨架**：Node 模块解析停在骨架不再上溯，profile fallback junction 指向同一坏树 → 必死无恢复；打包期记录每包文件数 manifest，启动逐包比对（目录缺失/package.json 丢失/文件数下降=damaged，多余容忍）；弹"程序文件受损"建议重装，选退出 markCleanExit（不让看门狗拉起已知损坏安装），留"仍然启动"逃生门 ｜ 🟢（我们 vendored 内核也是 node_modules 树；cargo build 不受影响，但**分发安装包时**该机制值得抄）
58. `[plugin-guard:559-573]` **悬空死链剪除**：0.1.2 升级后残留 104 条指向已卸载目录的死链，**内核 heal 只增链不清理永不可能自愈** → 模块解析反复 ENOENT；闭包没有的包名且目标已死才剪，目标活着的（原生新版才有）保留报告 ｜ 🟡（我们的 profile 无 junction 链；诊断 ENOENT 时想到这层）
59. `[junction-patrol / main.js:4412-4484]` junction 归属巡检：外部 npx dsh 把共享 junction 指向自己闭包（npx 缓存清理后悬空）；5min 周期（unref）、外部进程退出才修复（互不纠缠）、exec 异步（execSync 12s 卡死事件循环）、失败按"无外部进程"宁可漏报 ｜ ✅（0.2.1 机制收敛 + 独占 DSH_HOME）
60. `[runtime-patches:5-29]` 内核运行副本补丁覆盖三处 + **锚点失配自动跳过绝不损坏文件**；`[patch-deps:229-233]` 压缩 bundle 内锚点必须唯一（改前 grep）；`[patch-session-manage:212]` 幂等 + 升级规则自带 skipIf 防监听反复叠加 ｜ ➖（我们零改动 vendored 内核；若将来打补丁这是铁律）
61. `[patch-deps:381-402]` Node ≥24.11 内部 ESM resolveSync 签名是位置参数 `(specifier, parentURL)`——内核 v2 分支按对象参数调用，TypeError 被 catch 吞掉 → boot graph 静默清零（官方 UI 走 vite 不受影响故 CI 未发现）｜ 🟡（我们 node 24.16 跑 tsx 源码模式；若内核构建产物路径出怪错可查这）

## 7. 安装器与自更新（client-updater.js：全库坑密度最高）

62. `[client-updater:13-25]` **cmd /c 剥引号**：spawn('cmd.exe',['/c',script,args]) 时 cmd 剥首尾引号 → 路径空格断开 + stdio:'ignore' 吞错 → 脚本静默不执行（用户点"立即重启"毫无反应）；解法 `/d /s /c` + 整行引用 + windowsVerbatimArguments + Unicode 命令行传参（中文路径不受 ANSI 影响）｜ 🟡（Rust 壳将来做更新器时必守）
63. `[client-updater:910-916]` **batch 第 10 参数陷阱**：`%~10` 解析成 `%~1`+字面量 `0`（实测 NODEEXE 接成 `<第1参>0` → 备份静默跳过）；曾冤枉 shift，2×2 矩阵探针（32/32 e2e）证明无辜——探针自身缺陷（临时目录删除后才断言）｜ 🟡 同上
64. `[client-updater:941-974]` batch 实测坑群：环境变量统一 ENV_ 前缀（裸 MAN → ENOENT 中止回滚）；注册表 InstallLocation 被写脏（内嵌引号 → cmd 255 退出备份静默中断）→ 剥全部双引号；**robocopy 退出码 0..7 都是成功**（errorlevel ≥8 才失败）；`call` 而非 `start /wait`（隐藏控制台下偶发不返回）；/S 静默安装后 electron-builder 的 MUI_FINISHPAGE_RUN 不渲染 → **必须主动拉起新版**；批处理自删 `(goto) 2>nul & del "%~f0" & exit /b 0`；**括号块内 %VAR% 在解析期展开**恒为空 → 判定移出括号块，且不用 ENABLEDELAYEDEXPANSION（吃掉路径里字面 `!`）｜ 🟡 同上
65. `[client-updater:372-431]` 断点续传四坑：空闲超时 60s（非整体超时，167MB 慢链路十几分钟）；416 → .part 比远端长作废重来；**206 content-range 起点不符必须删 .part**（不删则恒撞 RESUME_INVALID 烧完重试次数）；服务器忽略 Range 回 200 必须**覆盖写**（append 会拼旧半截）｜ 🟡（同上）
66. `[client-updater:486-533]` 下载重试：RST 常态 → maxAttempts=10、指数退避 min(3000×2^(n-1),30000)、.part 续传；**ENOSPC 立即终止**；切源**丢弃 .part**（两源内容可能不一致）；分片名**掺版本号**（固定名跨版本同名 → 旧 .part 拼进新安装包）｜ 🟡
67. `[client-updater:599-607]` **SHA-256 强校验**（此前只比大小 ±2MB 告警 ≈ 不校验）；来源优先级：资产 digest → SHA256SUMS.txt → 告警放行；代理缓存污染 → URL 附加 `v=<version>&sha256=<hash>` 破缓存键 ｜ 🟡
68. `[client-updater:556-598]` **pipe 不转发写错误**——写侧 error 监听必须挂在拷贝循环之前，否则 ENOSPC/EIO 以 uncaught exception 杀进程 ｜ 🟡
69. `[client-updater:182-190]` `/releases` 列表替代 `/latest`（多平台仓库 latest release 可能只有 Linux 资产 → Windows 必然更新失败）；资产正则 `/setup.*x64\.exe$/i` + 明确拒 linux/arm64/deb/rpm（旧正则对 `-Setup-x64.exe` 永不匹配）｜ 🟡
70. `[client-updater:1094-1130]` **备份清理严禁同步 rm**（5.3.5 P0 实测：数 GB 镜像同步 rmSync 冻结事件循环数分钟 → 全部 RPC 卡死 + boot 180s 超时弹 died 页）；备份目录名三种真实格式（10 位秒/13 位毫秒/14 位本地时间）**混比会让 24h 保护窗形同虚设**——按位数归一化；mtime 拿不到宁留勿删 ｜ 🟡（通用纪律：大目录删除永远 async + 延迟）
71. `[client-updater:1179-1196]` 便携 .bak 清理**marker 必须最后删**（先删 marker 后删 .bak 失败 → 永久残留 2×exe 且无重试）；各文件独立 try ｜ 🟡
72. `[client-updater:877-887]` .crash 快照必须取自 `.bak`（此刻 %OLD% 已被覆盖为新版——取 %OLD% 得到新 exe，回退保险丝名存实亡）；M3：超时先回原位再启动（否则便携版从 updates 目录启动 → 新建 data 目录丢设置）｜ 🟡
73. `[updater.js]` agent 更新引擎：npm 镜像链（用户 .npmrc → npmmirror → npmjs）+ **停滞检测 300s 无输出判死切源**；`--ignore-scripts` 绝不现场 node-gyp（"卡 125/126"换镜像也无解）；**activeProcs 集合替代单例**（并发 abort 只杀到最后一个，其余孤儿跑满超时）；finishAfterKill **先锁 settled 再 kill**（Windows 子进程可在 taskkill 完成前 emit exit，错误被泛化 npm 退出码替换）；semver prerelease 按规范（数字段恒小于字母段——旧实现 beta.2 > rc.1）；swap 事务化两处 rename 都入 try + 配置全量快照 + agent-previous 保留至健康确认 ｜ 🟡（我们无自更新链路；做的时候全套照抄）
74. `[plugin-updater]` 插件更新：singleFlight 闸 + 按次随机 staging 子目录（并发互删半包）；失败结果**不进 TTL 缓存**（网络故障钉 10 分钟，重试无效）；worker pool 限流 4（Promise.all 22 个 npm 子进程尖峰）；engines.dsh 只取范围最低下界保守可比，**解析失败按放行**交守护启动兜底（不误拦）｜ 🟡

## 8. 原子写与文件系统

75. `[atomic-json.js:36-73]` **原子写两步换入**：旧目标 rename `.old-<rand>` → tmp→file → 删 old；换入失败还原 old——"先删旧再 rename"两步间被杀 = 数据只剩 .tmp（数据全丢）；**tmp 名必须带随机后缀**（Date.now() 同毫秒并发互相踩踏 ENOENT）；写前清扫同目录自产孤儿 ｜ 🔧（我们暂无原子写需求；profile/settings 写盘时按此实现——🟢 写 `ensure()` 之外的用户文档时采用）
76. `[atomic-json / plugin-guard:152-161 / patch 落盘]` **启动关键文件（cordis.patch.yml/settings.yaml/credentials）裸写中断即截断 → boot 死循环**——全项目统一 writeFileAtomic ｜ 🟢（同上，profile.rs 若扩展种子内容时必须）
77. `[market.js:41-56]` 标记文件删除带重试（5×200ms）+ **改名兜底** `.stale-<ts>`（残留进程短暂持锁 rmSync 静默失败 → 标记"复活"反复触发 pnpm）；BOM 剥离（外部编辑器 UTF-8 BOM → JSON.parse 失败误删有效任务）｜ 🟡
78. `[feature-pack:620-636 / sc/server.js:295-340]` zip 解压防目录穿越（`..` 段 skip）；**NTFS 8.3 短名绕过**（`.credentials-probe-zz.yaml` 的 `CREDEN~1.YAM` 不匹配 dotfile 拒绝且 realpath 不展开短名，实测全盘任意读）→ 短名经目录枚举+dev/ino 比对还原真实名再判定 ｜ 🟡（若做壳层文件服务，安全铁律）
79. `[sc/server.js:1030-1055]` files.authorize-open：**realpath 先归一化**再前缀比对（`..`/大小写/符号链接骗过字面匹配 + ShellExecuteW 无二次校验 = 任意文件打开）；DANGEROUS_EXT 黑名单（bat/cmd/exe/ps1/lnk/…）；`files.revert` 多处匹配要报 occurrences ｜ 🟡（同上）
80. `[market.js / installer.js:118-128]` rename 跨不过已存在目标（Windows）→ 先 rmrf 正式位再 rename；rmrf 带重试 3×150ms；`.staging/.trash` boot 期清扫、`.rollback` 每插件留 3 份 ｜ 🟡

## 9. 插件宿主隔离（extension-host——若 dsh-link 将来做 SDK 插件宿主）

81. `[host-bootstrap]` **init 前零插件代码**（混合围栏安全性前提）；二次 init 拒绝（工具重复注册）；collect-context 每 provider 500ms 限时（卡住的 provider 不阻塞回合）；uncaughtException 留最后一行 stderr 后 exit(1) 快速退出让 Supervisor 感知 ｜ 🟡
82. `[job-fence]` Windows Job Object 围栏：kill=TerminateJobObject（回收含孙进程整树）、dispose=KILL_ON_JOB_CLOSE；**Node 26 libuv 已不用 CRT fd 表**——Node spawn 持 stdio + Rust assignToJob 的混合围栏，spawn/assign 毫秒级窗口由协议闭合；spawn 失败是异步 error 事件必须有人接（否则击穿 Supervisor）｜ 🟡
83. `[rpc.js]` 帧协议防护：超 4MB 断开；缺 kind 断开；迟到响应丢弃；**跨 chunk 半帧缓存在常驻 FrameDecoder**（不可每帧新建）；notify handler（第三方代码）异常隔离转 stderr——绝不污染协议 stdout ｜ 🟡
84. `[manager.js]` 宿主状态机六修复：残留 running 态对账（上次异常终止的 stale 标记让插件永不拉起）；retrying 顺延 +250ms 缓冲防毫秒竞态丢重试；stdio 流 error 显式吞（EPIPE 击穿进程）；started 被拒走 killHost 统一清理（僵尸 Host：心跳照跑工具仍可 invoke）；stopping 守卫防刚停用插件被复活；心跳判死先记 stillTracked 防主动停止被当崩溃 ｜ 🟡
85. `[sdk/index.js]` win32 路径围栏大小写不敏感（`c:\data\x` 被误拒）；meta.name 强制等于注册键（否则注册成功必报 unknown tool）；spawn 失败 err.code 字符串(ENOENT)≠数字(退出码)——5.3.2 前一律回落 0 误报成功 ｜ 🟡

## 10. 日志 / PII / 诊断包

86. `[logger.js]` PII 脱敏细节：prefix 规则**按长度降序匹配**（sk-ant- 先于 sk-）；占位符协议用 `\x01/\x02`（不在 token 字符集内，防 JWT/email 规则二次掩码命中占位符）；**getter 抛错时旧实现 catch 里再取值 → 未脱敏原对象进日志**（读不到置 undefined）；循环引用 WeakMap 在遍历**之前**注册；Buffer 只取前 2048 字节；**半行残留也要走 shallow 掩码**；home 目录动态正则（C:\Users\<name> → %USERPROFILE%）｜ 🟢（我们只脱敏 launch token；若日志面扩大按此清单）
87. `[logger.js:479-513]` 启动滚动修复：直接 'w' 截断会把上次会话日志全毁（"10 文件轮转"名存实亡）→ 启动时先按链滚一次再开新文件 ｜ 🟡
88. `[logger.js:894-905]` archiver 出错**绝不在 EventEmitter 回调里 throw**（=uncaughtException 崩主进程）→ 转错误通道 + destroy 输出流让 await finished 拿到拒绝；失败不留半成品 zip ｜ 🟡
89. `[logger.js:994-997]` 诊断包里 cordis.patch.yml 根在 **dshHome** 不是 userDataDir（误用 → 诊断静默缺关键文件）｜ 🟡（我们 boot.log/home 路径已统一 ProfilePaths）
90. `[main.js:226-246 / issue #4]` 日志时间用本地时区 + 显式 UTC±HH:MM 偏移（toISOString 是 UTC，排查时间对不上）；双通道：纯文本 + 结构化 JSON lines ｜ 🟢（Rust eprintln 无时间戳——debug.mjs 已带；壳日志可加）

## 11. 诊断 / 救援 / 兜底

91. `[rescue-agent.js]` 救援器存活原则：所有函数绝不意外抛错；readTail open+fstat+seek 只读尾部（48KB）绝不 readFileSync 大文件，从第二个换行截断去半行；崩溃循环 30min 窗口 3 次阈值 → 进救援页不再无限重试；AI 修复：动作白名单 9 种 + 提示词纪律（优先低风险）+ 三级容错解析 + **写后 parse 校验** + high-risk 一律人工确认；**显式 stream:false**（部分本地网关默认 SSE → JSON.parse 失败）；本地 http 网关走 node:http ｜ 🟢（若做"启动失败自诊断"页，全套参数照抄）
92. `[main.js:915-941]` **guardedBoot 总链**：快照（只备 4 个声明性小文件秒级）→ 拉起 → 失败 → 静态体检 → 自动修复 → 重试 → 回滚最后良好快照 → 再试 → 事故报告；**preRetry 汇聚钩子**：体检只扫插件层，数据/配置层崩溃（pnpm 构建封锁、encodingMismatch）要靠**错误文本特征匹配 + 针对性自愈再重试**——报错详情常只落内核日志尾部 → 补解析尾部 40000 字符 ｜ 🟢（dsh-link 的"启动失败"页目前只给日志路径；特征匹配 + 一键修复是现成路线图）
93. `[main.js:1247-1349]` 启动失败**按钮矩阵**：第一按钮永远"进入救援模式" → 停用归因插件 → 回滚快照 → 回退上一版本 → 回退内置版本 → 重试/退出；崩溃计数达阈值直接进救援不弹窗；**起不来的用户走不到自动更新** → 失败链末尾主动触发修复版自愈；fatal 里 markCleanExit 防看门狗拉起已知失败 ｜ 🟢（分级回退思路）
94. `[main.js:673-753 / plugin-guard]` **启动失败归因**：5 组正则（duplicate loader entry / already registered / cannot find module / failed to load…）提取包名 → 匹配 patch 行 → bundles → dependencies，失败弹窗直接给"停用该插件"按钮 ｜ 🟢
95. `[main.js:406-456]` 便携版更新崩溃自回退：`%EXE%.bak` + marker 只在健康启动成功链上清除；崩溃自动回退，崩溃副本留 `.crash-<ts>` 诊断 ｜ ➖（无便携分发）
96. `[main.js:1918-1943]` 更新前强制快照，**快照失败即中止更新**（"宁可不动，不可让用户失去回滚点"）｜ 🟡

## 12. 内核交互细节（0.1.x→0.2.x 演进中仍有效的）

97. `[main.js:1138-1167 / V4.2/V4.4]` pnpm 构建封锁与 encodingMismatch 都是"体检救不了"的配置/数据层问题 → preRetry 钩子模式（错误文本特征 → 修复 → 单次重试）｜ 🟢（同 92）
98. `[sc/server.js:699-763]` **boot 应答必须立刻返回**，桌面集成全挪 setImmediate（两拍）——串行跑完同步重活会让应答迟到叠加超时弹 died 页（5.3.5 首发实测）｜ ✅（Rust async 天然分离；同构教训：启动关键路径禁止同步重活）
99. `[sc/server.js:553-579]` 大目录清理推迟 30s 且走 fs.promises.rm（数百 MB 同步 rm 冻结数分钟 → 全 RPC 卡死）｜ ✅（同上）
100. `[sc/server.js:230-243]` 桥接桩修复教训：**硬编码桩（恒 false/恒 null）接线会把自家进程判成"外部进程"**——共享真实状态而非桩 ｜ 🟡（通用工程纪律）
101. `[sc/server.js:765-770]` 停服清 currentWebInfo：拿旧 webUrl 的调用方逐请求打死端口 502，置 null 才有语义正确的 503 ｜ 🟡（我们 proxy 对内核未就绪统一 503 可读 JSON ✅）
102. `[sc/server.js:74]` 长寿命进程 Map 泄漏（会话记录从不清理）→ size≥500 淘汰最旧一半 ｜ 🟡（session-watcher 同款：外部分析器删文件后清扫 Map 防泄漏）
103. `[main.js:44 / client-updater]` MIN_VALID_BYTES=64MB 防错误页当 exe；`[main.js:2697-2702]` copy-text ≤2048 字符；`[main.js:2585-2599]` 粘贴图片 15MB/文件名清洗/固定目录 ｜ ➖

## 13. 杂项（会话/通知/余额/快捷方式）

104. `[session-watcher]` 会话通知：**baseline 语义**（首见前的事件是历史绝不 toast，只有 LIVE turn/end）；旧格式回退 assistant/message 计数；delegationDepth>0 子代理日志跳过；zstd 帧扫描零依赖（magic 28 B5 2F FD）+ **tornStart 容错**（尾部正在写入必有半帧，立即停扫保留已有）；轮询 2000ms unref ｜ ➖（无通知功能；做的时候照抄）
105. `[main.js:2032-2058]` 同会话通知 30s 限频 Map ｜ ➖
106. `[balance.js:169-176]` **`req.setTimeout` 是 socket 空闲超时**——慢速滴水响应永不触发 → Promise 永不 settle 小部件永久转圈；总超时定时器必须无条件加（15s destroy）；响应体 1MB 上限；readActiveModel 先定位 `agent-default-model:` 块再匹配 model 行（防命中其他配置块）｜ 🟢（通用 HTTP 客户端纪律；我们 reqwest 已有 timeout ✅）
107. `[shortcuts]` 快捷方式：按 `.lnk target 是否指向本应用 exe` 识别（任意文件名）——按文件名匹配会在用户换图标后重复创建；用户自定义图标/改名/加参数一律保留；相同创建者的重复不删（无法区分软件重复与用户手动复制）；安装版桌面交给 NSIS；临时目录运行告警（%TEMP% 被清理 = 程序"消失"）｜ ➖
108. `[sc/server.js:77]` chromeIcon 缓存（146KB 图标 base64 每次 WS 回环重发）｜ ➖
109. `[main.js:51]` 预览静态服务独立端口（HTTP/1.1 同主机 6 连接被长连接占满 → iframe 排队卡死）；仅回环、GET/HEAD、Host 校验（DNS rebinding）｜ ➖（我们无预览功能）
110. `[sc/bridge.js:675-703]` 首启重载窗口期 chrome.init 可能超时 → 指数退避重试 5 次 ｜ ➖

---

## 14. 落地路线建议（按价值排序，均未实施）

1. 🟢 单实例锁（Tauri single-instance 插件）——双开双写 DSH_HOME 是真实风险。
2. 🟢 viewport-beat（DPI/副屏黑屏自愈）——WebView2 通病，用户可遇。
3. 🟢 导航围栏（on_navigation origin 精确比较 + 外链转系统浏览器）。
4. 🟢 渲染恢复加码：稳定 30s 清零、可见性事件、pendingHangCrash 容忍窗（现版 watchdog 已有骨架）。
5. 🟢 启动失败归因 + preRetry 特征自愈（duplicate entry / already registered / cannot find module → 定位到插件/包）。
6. 🟢 原子写 util（profile/settings 扩展时）——EAC 全项目统一 writeFileAtomic 的教训。
7. 🟡 将来任何"更新器/文件服务/SDK 宿主"计划，直接按本目录对应小节实现。

> 署名说明：全部条目为**思路参照**（问题、失败模式、解法与参数节奏），未复制 EAC 源码；实现均针对本壳架构独立编写。见 `THIRD-PARTY-NOTICES.md`。
