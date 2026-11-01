# Android: side-loading a custom WebView (reserved)

This shell's engine choice is per-platform: WKWebView on macOS, WebKitGTK on Linux,
and on Windows the Fixed Version WebView2 runtime pinned by `pin_webview2_runtime`
(see `tauri.conf.json` → `bundle.windows.webviewInstallMode`). Android is the one
platform where the engine is not part of the OS *image* but a replaceable APK, so
"use a custom WebView" is a real, user-visible choice there.

Status: **reserved, not implemented.** The seam exists so the Android port does not
have to be redesigned later; nothing installs or selects a provider today. The kernel
side is surveyed at the bottom of this note — the short version is that the community
runs the full DSH kernel on the phone under PRoot, so Android is a packaging decision
(≈143MB APK, ≈400MB unpacked) rather than a capability wall.

## What Android actually permits

The WebView implementation is a provider APK (the stock one is `com.google.android.webview`
or `com.android.webview`). An app cannot switch providers programmatically — there is
no such API. What exists:

- **The user picks one** under Developer options → WebView implementation.
- **A debuggable device accepts adb**: `adb shell cmd webviewupdate set-webview-implementation <package>`.
- **An app can only observe** the current provider, through
  `androidx.webkit.WebViewCompat.getCurrentWebViewPackage(context)`, and can hand the
  user to the platform chooser.

So "side-load a custom WebView" means: ship or install a provider APK, get it selected
through one of the two paths above, and let the app report which provider is live. A
third-party Chromium WebView APK (the Bromite/Mulch lineage) is the usual reason to
want this; the alternative — embedding your own engine inside the app, e.g. GeckoView
or CEF for Android — removes the device dependency entirely at the cost of APK size,
and needs no provider selection at all.

## What is reserved in this repo

| Piece | Where | Contract |
|---|---|---|
| Plan resolution | `src-tauri/src/core/mobile.rs` → `plan()` | `DSH_LINK_WEBVIEW_PROVIDER=<package>` names a provider to prefer; unset or blank means the system provider |
| Selection handoff | `core/mobile.rs` → `select_provider()` | The single place that would act on the plan. Returns a "reserved" error on Android and an "Android-only" error on desktop |
| Startup report | `core/mobile.rs` → `report()`, called from `run()` | Logs a side-loaded request instead of silently falling back to the system provider |

Implementing `select_provider` on Android means a small JNI/Kotlin shim that: reads the
current provider via `WebViewCompat`, surfaces it in the shell's boot/recovery page
(the client cannot see its own engine), deep-links the platform chooser where the
platform exposes one, and verifies after a restart that the requested package is the
one in use. That work is deliberately deferred until an Android build exists to test
against — this machine has a JDK but **no Android SDK/NDK**, so no Android artifact can
be produced or verified here.

## How the community runs DSH on Android (surveyed 2026-10-05)

Five shapes exist. **None of them is Tauri, and all of them put the client in the
system WebView** — which is why the provider seam below is the right thing to reserve.

| Project | Kernel | Client | What it teaches |
|---|---|---|---|
| [itiswdwa/dsh-android](https://github.com/itiswdwa/dsh-android) | PRoot + Ubuntu rootfs **inside the APK** (141MB zip → ~400MB unpacked on first run) | system WebView → `127.0.0.1:3080` | foreground service + WakeLock; a token-guarded control bridge on `127.0.0.1:8399` injected as `window.DshAndroid`; its own PTY server; no root |
| [ajwyunsx/deepseek-harness-mobile](https://github.com/ajwyunsx/deepseek-harness-mobile) | proot + Ubuntu 22.04, downloaded on first run (~200MB) | system WebView → `127.0.0.1:3080` + injected `mobile.css` | **solves the cookie without a proxy**: reads the persistent signing secret from `.credentials.yaml` → `client-connection/browser-session`, self-signs an HMAC-SHA256 cookie bound to `host:port`, writes it into the WebView, then loads the clean root path |
| [duke5am/deepseek-harness-on-android](https://github.com/duke5am/deepseek-harness-on-android) | Termux + proot-distro + Ubuntu (user installs it) | phone browser | the no-APK path; Node 22 + `dsh web` under PRoot |
| [Vengisk/deepseek-harness-termux](https://github.com/Vengisk/deepseek-harness-termux) | Termux, patched native modules | phone browser | the patch list that any on-device kernel inherits: `koffi`/`sharp`/`node-pty` Android builds, `link(2)` → `rename(2)` for session persistence, `bwrap` blocked by Android sepolicy |
| [Hakunm/dsh-android-app](https://github.com/Hakunm/dsh-android-app) | **none on the phone** — pairs with a desktop kernel via the `dsh-workspace` plugin | native Compose client | the remote-kernel shape, i.e. the LAN-bridge path |

## What that means for this shell

The earlier reading here — "Android cannot spawn child processes, so the kernel must
live elsewhere" — was too strong. Android cannot run the **system's** Node, but an app
can exec binaries **it ships**: the community bundles a glibc userspace plus Node and
runs it under PRoot, which translates syscalls with ptrace and needs no root. The
kernel therefore has two viable placements, and the choice is about size, not about
what Android allows:

1. **On the phone, self-contained**: the PRoot payload (≈143MB APK, ≈400MB unpacked,
   ~2 min first launch). This is where dsh-link's architecture ports most directly:
   `core/proxy.rs` already performs the token→cookie exchange and re-originates the
   client, so it replaces the community's cookie self-signing with the same loopback
   proxy the desktop shell uses; `core/supervisor.rs` would launch PRoot instead of
   `node`. Two facts from the survey are load-bearing: PRoot creates **no network
   namespace**, so "the sandbox's server" is just `127.0.0.1` for the WebView, and
   `DSH_PERMISSION_MODE=danger-full-access` is pinned because `bwrap`/Landlock cannot
   work under PRoot (DSH reports `SANDBOX_UNAVAILABLE` otherwise).
2. **On another machine, remote**: pair with a desktop kernel over LAN (the
   `dsh-workspace`/dsh-mobile shape). The shell keeps the proxy and drops the
   supervisor; the APK stays small.

Either way the client is a WebView rendering the official UI, so the shell would also
need the community's mobile adaptation (injected narrow-screen CSS / drawer sidebar) —
a desktop-sized window layout is the first thing that breaks on a phone.

Until the kernel placement is chosen, only the engine seam is worth reserving, which is
exactly what this note and `core/mobile.rs` do.

## Weight: what actually makes the PRoot port heavy, and the lighter shapes

The community's self-contained APK is heavy for one reason, not several: **glibc**. DSH
requires Node `^22.19.0 || >=24.0.0`, and npm's prebuilt native modules are compiled
for glibc. Only three of them reach the kernel — `koffi` (FFI: fs, directory picker,
session persistence, subprocess), `sharp` (attachments, spill) and `node-pty`
(subprocess) — while `playwright` and `esbuild` belong to the web/benchmark apps and
HMR and are not needed on a phone. Android's own Node builds are bionic, so the choice
has been "ship a glibc userland" (Ubuntu under PRoot: 141MB zip → ~400MB unpacked) or
"recompile the whole native chain for bionic and maintain it forever".

Measured, the payload is the app; the WebView and the client are not.

| Shape | Payload | Trade |
|---|---|---|
| **Remote kernel, thin client** | ~10–20MB APK | needs a desktop kernel on the LAN; unusable offline; nothing to patch |
| **Termux + glibc-runner** | official `node` linux-arm64 + dsh deps, no distro | needs Termux (or its bootstrap, tens of MB); a small patch set to maintain |
| **APK without payload** | small base APK, ~200MB fetched on first run | first run needs network; the ~2 min unpack stays |
| **bionic rebuild** | smallest | forks dsh's entire native chain into a second build to maintain |
| **Trimmed PRoot rootfs** | 141MB zip today | limited gain; unpack and PRoot overhead stay |

[ErEbusE/dsh-termux](https://github.com/ErEbusE/dsh-termux) is the precedent for the
middle row: it runs the **official** Node linux-arm64 binary on Termux's glibc runtime
(`glibc-repo` + `glibc-runner`) instead of a chroot, so upstream dsh and its prebuilt
modules run unmodified and nothing is compiled on device; only SELinux link policy,
browser handoff, Landlock tmpdir grants and cross-site cookies need patching.
`nodejs-mobile` is **not** an option: its last release is Node 18 (2024-10), below
DSH's engine requirement.

For this shell, the remote-kernel shape is the one that keeps the APK at shell size and
keeps the reserved provider seam meaningful — the client is a WebView either way, and on
an old device the system WebView is the weak link the seam exists to replace.

## Generating the Android project (when the toolchain is available)

```sh
npm run tauri android init      # creates src-tauri/gen/android, needs ANDROID_HOME + NDK
npm run tauri android dev       # or: tauri android build
```

The generated project is where the provider shim (a Kotlin plugin plus its JNI entry)
would live; `DSH_LINK_WEBVIEW_PROVIDER` is then supplied by the Android manifest or the
launch environment, not by the desktop process.
