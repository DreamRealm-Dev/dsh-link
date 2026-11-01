# Third-Party Notices

## Deepseek Harness EAC（dsh-desktop）

本项目（DSH Link）的下列设计**参照了** Deepseek Harness EAC 桌面端自研代码
（`dsh-desktop`，作者署名 "DSH Desktop"，`package.json` 声明 `license: MIT`）
所验证过的思路与参数：

| DSH Link 位置 | 参照的 EAC 模块 | 参照内容 |
|---|---|---|
| `src-tauri/src/core/shellpage.rs` | `resources/app/assets/loading.html`、壳内嵌加载页 | 启动加载页的视觉与文案结构：深色径向渐变、border spinner、单行状态、失败才展开详情 |
| `src-tauri/src/core/proxy.rs`（`relay_sockets` 心跳看门） | `sidecar/phone-bridge.js` | WebSocket 半开悬挂问题：对端静默消失（无 FIN/RST）时双向 pipe 永不结束；以心跳探测与超时拆链回收 |
| `src-tauri/src/core/supervisor.rs`（`wait_for_port_free`） | `sidecar/boot-server.js` | Windows 强杀延迟落地导致重启 EADDRINUSE 假阳性；重启前等待端口真正可绑定 |
| `src-tauri/src/core/liveness.rs`、`src/lib.rs`（`watch_window`） | `resources/app/renderer-recovery.js`、`watchdog.js` | 渲染进程崩溃无恢复动作导致永久黑屏；退避重载 → 升级到恢复页 → 周期限速的恢复循环 |
| `docs/eac-pitfalls.md`、`docs/eac-pitfalls-full.md` | 全部自研模块 | 踩坑清单的系统整理（精华对照 / 全量目录约 300 条） |

**性质声明**：DSH Link 仅借鉴上述模块针对的问题、失败模式与恢复策略（思路层面），
未复制、未翻译、未衍生其任何源代码；所有实现均为本项目针对自身架构（Tauri 壳 +
完整反向代理）独立编写。标注出于对原作者的尊重与 MIT 协议精神的自觉遵守。

EAC 本身的开源协议文本在其发行目录中（`LICENSE.electron.txt` 等为 Electron/Chromium
上游许可，与其自研代码的 MIT 声明并列）。
## WebView2 runtime — not bundled, not distributed

This shell used to ship Microsoft's **Fixed Version** WebView2 runtime beside the executable and
load it through `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`. That runtime contains licence files this
project cannot relicense — `Trust Protection Lists/Mu/LICENSE` and `.../Sigma/LICENSE` are
**GPL-3.0**, and `WidevineCdm/LICENSE` is Google's proprietary text — so bundling it put
copyleft into our distribution. **The shell no longer does that**:

- `src-tauri/tauri.conf.json` installs Microsoft's own runtime (`webviewInstallMode:
  downloadBootstrapper`), so the installer fetches it from Microsoft rather than carrying it;
- `pin_webview2_runtime()` is now a deliberate no-op and says why; the app uses the machine's
  evergreen runtime, and `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` still lets a machine's owner pin one;
- `scripts/fetch-webview2-fixed.mjs` refuses to run without `--evaluation-only`, so the download
  cannot quietly become part of a build again;
- `pack/LICENSES.md` and `scripts/verify-pack.mjs` rule 9 enforce the decision where it was made.

**Trade-off, stated rather than hidden**: the rendering engine is no longer the exact build this
app was tested against. That was the price of not redistributing a copyleft component.

A previously downloaded copy may still exist on this machine under `src-tauri/webview2-fixed/`;
`.gitignore` keeps it and every build tree out of the repository, so nothing of it is tracked
(verified: `git ls-files` reports zero paths under that directory).
## Bundled runtime artefacts and their licence files

The paths below were found on disk while auditing the machine's build trees. They are **not tracked**
(`git ls-files` reports none of them) and are not part of what this repository distributes; the table
is kept as the record of what those downloaded trees contain, and the gate now scans tracked files
only, because a downloaded binary must not decide this project's licence surface.

| Path | Holder / origin | Licence |
|---|---|---|
| `cef-probe/tauri-runtime-cef/LICENSE_MIT` | Tauri Apps Contributors | MIT |
| `cef-probe/tauri-runtime-cef/LICENSE_APACHE-2.0` | Apache Software Foundation | Apache-2.0 |
| `cef-probe/tauri-runtime-cef/LICENSE.spdx` | SPDX metadata document for the `tauri` package | CC0-1.0 (data licence) |
| `dsh-link/src-tauri/resources/pnpm/LICENSE` | Rico Sta. Cruz, Zoltan Kochan and other contributors | MIT |
| `dsh-link/src-tauri/webview2-fixed/WidevineCdm/LICENSE` | Google LLC (content decryption module) | proprietary terms, carried verbatim |
| `dsh-link/src-tauri/webview2-fixed/Trust Protection Lists/Mu/LICENSE` | Trust Protection Lists component bundled with the Microsoft WebView2 fixed runtime | **GPL-3.0** |
| `dsh-link/src-tauri/webview2-fixed/Trust Protection Lists/Sigma/LICENSE` | the same component, second list | **GPL-3.0** |

**Copyleft, stated plainly**: those GPL-3.0 texts belong to Microsoft's fixed WebView2 runtime and
are **not distributed by this project** — see the section above: the installer downloads Microsoft's
runtime, the shell loads the machine's evergreen build, the runtime folder is gitignored, and licence
gate rule 9 refuses a packaging configuration that would bundle it again. Both copies were found by
that gate rather than by hand, which is the point of having it.

**One more, from the kernel's own ignored build tree (observation, not distributed)**: the vendored
kernel's inspector package carries `axe-core` under `packages/**/lib/**`, whose licence is MPL-2.0.
MPL is file-level copyleft and would attach to *unmodified files of that component* if they were
distributed. The installer's `bundle.resources` currently ships only `resources/pnpm` (MIT) and the
shell binary; the kernel checkout is not part of the package, so nothing here is distributed. If a
future packaging step starts shipping `core/deepseek-harness/**/lib`, that step must carry axe-core's
licence and note it here — this paragraph is the reminder, and the gate cannot see an ignored tree by
design.

## Plugin pack

`pack/LICENSES.md` lists the coverage and points at the single MIT text in the root [`LICENSE`](./LICENSE),
which covers every plugin in `pack/pack.json`.
