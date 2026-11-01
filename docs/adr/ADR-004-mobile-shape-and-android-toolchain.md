# ADR-004：手机版形态与安卓工具链代价

**状态**：形态部分为用户既定（«DSH LINK.md» 行 286）；工具链代价为本轮实测；下载决定**待批**。

## 决定

1. **形态（既定，记录以免被误读）**：手机版**不内置 DSH 内核**，是一个 Rust + React + Tauri 的**薄客户端**，通过互联层参与生态——把电脑上的 DSH 接到手机上操作、让 Agent 以只读方式访问手机文件、把手机当麦克风/摄像头（都需授权）。因此**手机端不执行 compat 词汇表**（见 ADR-003 的补充决定：桌面内核代执行），手机侧只需要 UI + RPC 客户端。
2. **安卓工程：已能零下载初始化**（本轮实测）。命令见下，产出 40 文件 / 30 目录 / 0.27 MB：
   ```powershell
   # 在 src-tauri 目录，进程内注入环境变量（未持久化）
   $env:ANDROID_HOME='<android-sdk>'; $env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
   $env:ANDROID_NDK_HOME='<android-sdk>\ndk\27.3.13750724'; $env:ANDROID_NDK_ROOT=$env:ANDROID_NDK_HOME
   node ..\node_modules\@tauri-apps\cli\tauri.js android init   # CLI 2.12.1，退出码 0，0.7 s，无下载
   ```
3. **不批准现在下载**：卡点在**第一次 build**，不是 init。实测三个硬缺口与其体积：`compileSdk/targetSdk = 37`（本机只有 platforms 34/35）→ platform-37 约 **64.2 MB**；gradle-wrapper 要 **9.6.1**（本机无）→ 约 **100–150 MB**（-bin）/ 228.5 MB（-all）；AGP 9.3.1 / Kotlin 2.2.10 / androidx 全不在缓存 → Maven 侧粗估 **150–400 MB**。**第一次 build 至少再下 ~280 MB，按 400–700 MB 预算**。C 盘剩 14.27 GB、Q 剩 12.85 GB，而行 45 要求各分区留 20–30 GB。⇒ 先定手机版的**功能面**（薄客户端里到底放什么），再为它申请下载；下载落地位置应优先 H（53 GB 空闲）与 `<android-sdk>`。

## 为什么这样定

- 薄客户端是唯一与「内核随 DSH-LINK 分发」不冲突的形态：手机上装不了也养不起第二份内核，而互联层（`plugins/dsh-lan-bridge`，7 套 462 项全绿、可一键复跑）已经把「连接、配对、权限取最短、失败映射」做实了。
- 先花钱买工具链再定功能面，等于把磁盘换成一个可能被推翻的实现；行 35「拒绝面向结果编程」在这里的具体含义是：**先写清薄客户端要哪几个能力（会话接续 / 只读文件 / 摄像头麦克风），再决定编哪些 Android target**。

## 已知代价与风险（实测）

| 项 | 值 | 出处 |
|---|---|---|
| 生成工程 | `src-tauri/gen/android/dsh_link/**` 40 文件 / 30 目录 / 0.27 MB | `docs/handoff/R4-android-init.md` |
| 磁盘净增 | C +0.02 GB、H +0.00 GB（就是那 0.27 MB） | 同上 |
| 模拟器 | MuMu `emulator-5554`，API 35 / x86_64 / 已 root ⇒ 构建应优先 `--target x86_64` | `docs/handoff/R2-simulator.md` |
| JDK | `JAVA_HOME` = JDK 25，与 AGP 9.3.1 / Gradle 9.6.1 的兼容性**无法判定** | 同上 |
| 网络 | PowerShell/HttpWebRequest 访问 `services.gradle.org` 15–25 s 超时是**客户端 TLS 假象**，`curl.exe` 实测 307→206 可下载、TCP 443 通 ⇒ **不要据此配代理**（`HTTP_PROXY`/`HTTPS_PROXY` 目前为空） | 同上 |

## 回滚方式

`android init` 的产物可以整目录删掉（0.27 MB，已记录在案）；环境变量本就只存在于那一次进程内，未写入用户环境。真要放弃安卓，删 `src-tauri/gen/android` 即可，桌面端不受影响。
