# CEF runtime evaluation (for the DSH Link shell)

Evaluated 2026-10-05 on this machine (Windows 11, rustc/cargo 1.95.0, MSVC 14.51
via VS 18 BuildTools, CMake 4.4.0, Ninja 1.13.0). Candidate:
[`SableClient/tauri-runtime-cef`](https://github.com/SableClient/tauri-runtime-cef)
plus the two other CEF-for-Tauri options.

**Verdict up front: do not adopt.** The runtime *does* build and open a real
Chromium window on Windows (verified, screenshot in `<workspace>\\cef-probe\shot1.png`),
which is much further than the Linux-only README claims — but getting there
required downgrading the whole Tauri 2.x train from 2.12.1 to 2.11.6 and exact-pinning
five more crates, the upstream Windows shutdown fix is an **unmerged PR**, and the
only supported bundler bypasses `tauri build`. It buys nothing on Windows over the
already-pinned WebView2, and the platform it would actually help (macOS) has never
been run by anyone. Details, numbers and the reproduction recipe below.

---

## 1. Upstream reality

| Thing | Finding | How verified |
|---|---|---|
| `tauri-apps/tauri` `feat/cef` | **Alive but unreleased, and on the Tauri 3 dev line.** Last commit `c8c75b1f` **2026-09-12** "feat(cef): migrate to winit-gtk4 (#15787)". Crate `crates/tauri-runtime-cef` pins `cef = "=151.8.1"`, `tauri-runtime = { version = "2.11.2", path = … }`, and a **forked winit** (`tauri-apps/winit-gtk4`, gtk4). | GitHub API: branch list, commit list, `crates/tauri-runtime-cef/Cargo.toml` at that sha |
| Upstream Windows shutdown | A separate branch `fix/windows-shutdown-cef` (`9de58bd7`, 2026-08-17) adds `src/platform/windows/shutdown.rs` (191 lines) + `runtime.rs` changes. It is **not in `feat/cef`** — the `platform/windows/` listing at `c8c75b1f` has no `shutdown.rs`. | GitHub contents API at both refs |
| Is it shipped in a tauri release? | No. Published `tauri` 3 alphas in the index stop at `3.0.0-alpha.4` and its `Cargo.toml` contains no `cef` dependency or feature. | crates.io index (USTC mirror) + extracted `tauri-3.0.0-alpha.4` |
| `SableClient/tauri-runtime-cef` | Created **2026-07-27**, **2 stars**, 1 fork, 11 open items (all PRs — no open issues), **last push 2026-10-01** (`6568170a` "fix(linux): restore browser keyboard focus"). Weekly `sync/upstream-YYYYMMDD` branches through 2026-09-28. No tags, no releases. Apache-2.0 OR MIT. | GitHub API |
| Is it published on crates.io? | **No.** The index shard for `tauri-runtime-cef` 404s. It is a **git or path dependency**. | `mirrors.ustc.edu.cn/crates.io-index/ta/ur/tauri-runtime-cef` |
| CI coverage | `ubuntu-24.04` only (fmt / check / clippy). **No Windows or macOS job.** One test file, `tests/native-initialization.test.mjs`. | `.github/workflows/ci.yml` |
| The other CEF option | [`byeongsu-hong/tauri-runtime-cef`](https://github.com/byeongsu-hong/tauri-runtime-cef) — the earlier extraction (`cef = "=148.0.0"`), **archived 2026-07-13**, 0 stars. Dead end. | GitHub API |
| Other credible options | None found. `tauri-apps/cef-rs` is the *binding* (what this runtime uses), not a Tauri runtime; there is no third CEF-for-Tauri implementation. | `web_search` + repo survey |

So: **upstream is progressing, but not in a form a Tauri 2.x app can consume.** The
only usable artifact is one 2-star fork whose own README says "Verified on Linux (X11).
The macOS/Windows paths compile-ported blind — they need a real pass."

### Which Tauri versions does it force?

The manifest claims `tauri-runtime = "2.11.2"`, `tauri-utils = "2.9.2"`, `cef = "=150.2.1"`,
`winit = "0.31.0-beta.2"`, `windows = "0.61"`. The first two are **caret** ranges, and
those ranges resolve to versions the code was not written against. Measured against
this repo's current lock (tauri 2.12.1 / tauri-runtime 2.12.1 / tauri-utils 2.10.1 /
winit 0.31.0-beta.3) the crate fails with **13 errors in two clean groups**:

* **Tauri trait drift (6)** — `Runtime::primary_monitor`/`monitor_from_point`/`available_monitors`
  now return `Result<…>` (crate returns bare values); `WindowDispatch::set_fullscreen_on_monitor`
  and `WindowBuilder::no_redirection_bitmap` are new required items; `owner`/`parent` take
  `windows 0.62`'s `HWND` while the crate compiles against `windows 0.61`.
* **winit drift (7)** — `WindowEvent::DragEntered/DragDropped` gained `id`/`proposed_action`,
  `DragMoved` was removed.

It compiles only after pinning a coherent 2.11 set (**all six commands are required,
in this order** — `tauri-build` must fall before `tauri-utils`, and `tauri-runtime` first):

```powershell
cargo update -p tauri-build   --precise 2.6.3
cargo update -p tauri-runtime --precise 2.11.3
cargo update -p tauri-utils   --precise 2.9.3
cargo update -p tauri-macros  --precise 2.6.3
cargo update -p tauri-codegen --precise 2.6.3
cargo update -p winit         --precise 0.31.0-beta.2
# plus tauri = "=2.11.6" in Cargo.toml
```

**Answer to the question:** yes, it forces a Tauri downgrade, though a milder one than
`tauri-runtime-verso` did (2.12.1 → **2.11.6**, not → 2.7.0). The downgrade comes with a
hard exact-pin set on **six** crates because the crate's own ranges are too loose; and
unlike Verso, a future `tauri` 2.13 will silently break it again.

---

## 2. Platform reality

### Windows — it works (verified here, contrary to the README)

There is real Windows code, not stubs: `platform/windows/{window,webview,event_loop,monitor,icon}.rs`
(HWND management, `SetParent`/`SetWindowPos`, DWM extended frame bounds, taskbar
progress/overlay via `ITaskbarList3`, softbuffer background surface) and
`external_message_pump/windows.rs`, a faithful port of cefclient's message-only-window
`WM_TIMER`/`WM_HAVE_WORK` pump. 12 `cfg(windows)` sites in `window.rs`, 10 in
`window_builder.rs`.

What is actually required on Windows:

* **Feature flags**: `cef = { features = ["build-util", "linux-x11"] }`. The `linux-x11`
  feature is defined `linux-x11 = []` in the `cef` crate, so it is inert on Windows —
  it is untidy, not a blocker. The `sandbox` feature (default) is what selects
  `cef-dll-sys/sandbox` → `USE_SANDBOX=ON` for the C++ wrapper.
* **libcef.dll + resources**: `cef-dll-sys/build.rs` downloads
  `cef_binary_150.0.14+g7c1aa68+chromium-150.0.7871.129_windows64_minimal.tar.bz2`
  (**156.6 MiB**) from `https://cef-builds.spotifycdn.com` (override with `CEF_PATH` /
  `CEF_DOWNLOAD_URL`), extracts it to
  `target/debug/build/cef-dll-sys-*/out/cef_windows_x86_64` (**417.5 MB / 944 files**),
  builds `libcef_dll_wrapper` through **CMake + Ninja + cl.exe**, then copies the
  runtime next to the exe: **25 top-level files (385 MB) + `locales/` (48.5 MB)**.
  `libcef.dll` alone is **262.8 MB**.
* **Helper process**: none needed on Windows. CEF re-execs the *same* exe with
  `--type=…`; the app calls `run_cef_helper_process()`. Observed live: **6 `cef-probe`
  processes** for one window (browser + renderer/GPU/utility).
* **winit/softbuffer wiring**: already in the crate (`winit = "=0.31.0-beta.2"`,
  `softbuffer` for the window background). No work needed beyond the version pin.
* **Not present on Windows**: the `cef::library_loader`/`cef::sandbox` init block is
  `#[cfg(target_os = "macos")]`; Windows only sets `no_sandbox: !cfg!(feature = "sandbox")`.
  With the default `sandbox` feature the app still started and spawned helpers, but the
  GPU process **crashed once** (`exit_code=-2147483645`) before recovering — the first
  real desktop-behaviour blemish.
* **Windows shutdown is the known hole** (see the unmerged upstream PR above). The fork
  has no `shutdown.rs`. I did not exercise window-close: the probe was killed.

### Packaging story

* **Windows**: `cef::build_util::win::bundle` copies the CEF files into the output dir
  (skipping CEF's own `.exe`s), writes `{name}.exe.manifest`, and — with the default
  `sandbox` feature — **replaces `{name}.exe` with CEF's `bootstrap.exe` and ships the
  real application as `{name}.dll`**, also copying `{name}.pdb` unconditionally (a
  stripped release build would fail). This is invoked through the `cef` crate's
  `bundle-cef-app` binary. **`tauri build` / tauri-cli knows nothing about any of it**,
  so NSIS/WiX packaging, the updater, shortcuts and file associations all need custom
  scripting.
* **macOS**: needs `Chromium Embedded Framework.framework` plus **multiple helper app
  bundles** (`{Name} Helper(Alerts|GPU|Plugin|Renderer).app`) and a second bin target
  declared as `package.metadata.cef.bundle.helper_name` in `Cargo.toml`. README:
  "the published CLI doesn't do this. Bundle scripting lives with the consuming app for
  now." Notarization therefore has to sign/notarize the framework + each nested helper
  (CEF's own tracker: [chromiumembedded/cef#2744](https://github.com/chromiumembedded/cef/issues/2744)).
* **Size** (measured on this machine):

| Runtime | On-disk | Files | Notes |
|---|---|---|---|
| CEF 150 minimal (windows64) | **433 MB** app dir (385 + 48.5) | 25 + 220 | from 156.6 MiB download |
| WebView2 Fixed Version (already shipped by this repo) | **668.7 MB** | 257 | `src-tauri/webview2-fixed` |
| versoview.exe (parked experiment) | 101.4 MB | 1 | plus Tauri exe |

  So CEF is *smaller* than the Fixed Version WebView2 this repo already pins — size is
  not the argument against it. The 72.7 MB Chromium profile created under
  `%LOCALAPPDATA%\cef-probe` after ~20 s of use, and a shared `%LOCALAPPDATA%\CEF`
  directory, are additional first-run/lifecycle surface.
* **ACL**: nothing in CEF needs extra Windows ACLs, but the helper-exe pattern means a
  second executable inside the install dir that AV/SmartScreen reputation systems
  scrutinise; on macOS the hardened-runtime entitlements and the nested-signing chain
  are the real cost.

---

## 3. Smoke test (Windows, this machine)

All scratch under `<workspace>\\cef-probe\`; nothing under `dsh-link\` was touched.

**Probe**: `cef-probe` — a loopback HTTP server on 127.0.0.1:31781 (mirrors the shell's
proxy shape), then `WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))`
with `.title()/.inner_size()/.on_navigation(…)`, plus `is_visible()`, `eval()`,
`title()`, `url()`, `reload()` exercised from a watchdog thread — i.e. **exactly the
window API surface `dsh-link` uses**.

**Versions**: `tauri =2.11.6`, `tauri-runtime =2.11.3`, `tauri-utils =2.9.3`,
`tauri-build/tauri-macros/tauri-codegen =2.6.3`, `winit =0.31.0-beta.2`,
`cef =150.2.1+150.0.14` (= Chromium **150.0.7871.129**), `cef-dll-sys =150.2.1+150.0.14`.

```powershell
# once
New-Item -ItemType Directory <workspace>\\cef-probe
git clone --depth 1 https://github.com/SableClient/tauri-runtime-cef.git <workspace>\\cef-probe\tauri-runtime-cef   # via the gh-proxy insteadOf rewrite
# probe crate: path dep on the clone; tauri = "=2.11.6", default-features = false, features = ["test"]
# clone manifest: winit = "=0.31.0-beta.2"

# every build (MSVC env is required for the CEF C++ wrapper's CMake+Ninja step)
cmd /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && cd /d <workspace>\\cef-probe\probe && cargo build'
# → Finished dev profile in 3.55s (after the 417 MB CEF fetch + first full build)
```

**Result — it runs.** stdout:

```
PROBE-WINDOW built label=main
PROBE-NAV http://127.0.0.1:31781/      <- on_navigation fires
PROBE-VISIBLE true                     <- is_visible()
PROBE-EVAL ok                          <- eval()
PROBE-TITLE cef-probe                  <- title()
PROBE-URL http://127.0.0.1:31781/      <- url()
PROBE-RELOAD ok                        <- reload()
PROBE-NAV http://127.0.0.1:31781/      <- reload really navigated
PROBE-RESULT {"ok":true}
```

Screenshot `<workspace>\\cef-probe\shot1.png` (915×637) shows the page rendered in
Chromium, reporting:

| Probe | CEF 150 | Servo (Verso experiment) |
|---|---|---|
| `indexedDB` | `object` | **absent** |
| `ResizeObserver` | `function` | **absent** |
| `IntersectionObserver` | `function` | **absent** |
| `WebSocket`, `EventSource`, `Worker`, `crypto.randomUUID` | present | present |
| `SharedArrayBuffer` | undefined (no COOP/COEP headers — expected) | absent |

**Two caveats from the run, both real:**

1. CEF re-executes the binary for helpers. My probe started its HTTP server *before*
   the `--type=` guard, so every helper process panicked on `bind` (10048, AddrInUse) —
   harmless here, but it is direct evidence that **any global startup work in
   `main()` runs once per renderer/GPU/utility process** unless it sits behind the guard.
2. `[ERROR:gpu_process_host.cc:1089] GPU process exited unexpectedly: exit_code=-2147483645`
   once, then recovered.

---

## 4. Integration cost for `dsh-link`

**Shape** (feature + second bin), exactly as the README prescribes — published Tauri has
no `cef` feature / `tauri::Cef` / `#[tauri::cef_entry_point]`, so the app must alias the
generics itself and build `tauri` with `default-features = false`:

```rust
type Cef = tauri_runtime_cef::CefRuntime<tauri::EventLoopMessage>;
type AppHandle = tauri::AppHandle<Cef>;        // the whole shell must be generic or duplicated

fn main() {
    tauri_runtime_cef::configure(tauri_runtime_cef::CefConfig { identifier: "dev.dshlink.client".into(), ..Default::default() });
    if std::env::args().any(|a| a.starts_with("--type=")) { tauri_runtime_cef::run_cef_helper_process(); return; }
    tauri::Builder::<Cef>::default() /* … */
}
```

Plus a `cef` cargo feature, a second bin (`dsh-link-cef.exe`) calling a generic
`run_with<R: tauri::Runtime>` (the pattern already proven by the parked Verso work), and
a Windows build that needs CMake/Ninja/MSVC in every CI image.

**What breaks in the existing shell:**

| Existing code | Impact |
|---|---|
| `WebviewWindowBuilder::new(handle, "main", WebviewUrl::External(url))` + `.title/.inner_size/.min_inner_size/.resizable/.center()` | **Fine** — all present and exercised in the smoke test. |
| `.on_navigation(allow_navigation)` | **Fine** — wired through CEF's `on_before_browse` (`request_handler.rs:177-183`, returns 0/1, main-frame only). |
| `.disable_drag_drop_handler()` | **Fine** — implemented in `webview.rs:57` (not in `window_builder.rs`). |
| `window.is_visible() / reload() / eval() / url()` | **Fine** — all verified running. |
| single-instance plugin (`unminimize/show/set_focus`) | **Fine API-wise, hazardous** — the plugin must never initialise in a CEF helper process; the `--type=` guard has to come *before* `tauri::Builder`, or each renderer spawns a second-instance check. |
| `RunEvent::Exit` → `supervisor.stop_all_sync()` | **Works in the browser process**, but Windows shutdown is exactly the path upstream fixed on an unmerged branch. Needs its own test. |
| `pin_webview2_runtime()` + `bundle.windows.webviewInstallMode = fixedRuntime` + `src-tauri/webview2-fixed` (669 MB) | **Dead weight** in the CEF build — must be cfg-gated off and dropped from the CEF bundle. |
| `tauri build` packaging | **Does not exist for CEF.** The CEF files (433 MB) are not in `bundle.resources`; you must run `bundle-cef-app` (or script the copy + manifest) after/around tauri-cli, and under `sandbox` the exe becomes `bootstrap.exe` + `{name}.dll`, which the NSIS/WiX templates and the updater signature logic do not expect. |
| `links` metadata | The fork's `Cargo.toml` **omits `links = "tauri_runtime_cef"`** that upstream's crate declares so `tauri-build` can detect the runtime. Expect to re-check what tauri-build emits for the CEF bin. |

Blast radius: `src-tauri/Cargo.toml` (feature + downgraded pins), a new
`src/bin/dsh-link-cef.rs`, `src/lib.rs` genericised (or duplicated), `tauri.conf.json`
(second bundle config), the `--type=` guard moved ahead of every side effect in
`main`, and a Windows build/CI prerequisite (CMake+Ninja+MSVC).

---

## 5. Verdict

**(a) versus the current pinned WebView2 on Windows with system webviews elsewhere —
no.** On the primary target this is a downgrade in every axis except engine identity:
Tauri 2.12.1 → 2.11.6 plus six exact pins, a 2-star crate with Linux-only CI, an unmerged
Windows-shutdown fix, ~433 MB of runtime and a bespoke bundler that bypasses `tauri build`,
in exchange for a Chromium build that is *not* Microsoft's — for an app whose entire UI is
served from `http://127.0.0.1`, that has no user-visible value. The pinned WebView2 is
already a deterministic, updater-independent Chromium and costs no integration work.

**(b) versus Electron — Electron is the lower-risk way to buy the same thing.** CEF+Tauri
now lands strictly between the two: Chromium rendering with Tauri's Rust API surface, at
~433 MB per install and with no official bundler, while Electron ships the same Chromium
with a mature, first-class bundler/signing/updater story at roughly 80–120 MB per
installer. If "one Chromium on every platform" ever becomes the requirement, Electron is
the same bet with a decade of packaging work already done. CEF+Tauri only wins if keeping
Tauri's Rust side (plugins, `RunEvent`, the supervisor process model) is non-negotiable.

**Where CEF would actually help: macOS, and only as a rendering-parity play.** Windows
already has Chromium via WebView2. The remaining non-Chromium engine in this shell is
macOS's WKWebView — the same class of risk that killed the Servo attempt — and CEF is the
only route to unify on Chromium there. That is a real, narrow argument, and it is unbuilt:
nobody has run this runtime on macOS, the README says the bundle scripting is yours, and
helper-app signing/notarization is days of work, not hours.

## 6. Recommended next step

1. **Do not adopt now. Keep wry + pinned WebView2 on Windows.** No change to
   `dsh-link`.
2. **Re-evaluate on two triggers**: (i) upstream merges `fix/windows-shutdown-cef` and
   `feat/cef` ships either a Tauri 2.x-compatible crate or a released CEF runtime with
   tauri-cli bundling; (ii) `SableClient/tauri-runtime-cef` adds a Windows CI job (a red
   badge there is the cheapest early-warning signal).
3. **If macOS renderer parity becomes a hard requirement**, spend a time-boxed 2-day
   macOS spike *before* committing, using exactly the pin set recorded in §1 plus
   `winit =0.31.0-beta.2`; write the `.app` bundle script yourself and budget for
   Developer ID signing of the framework and every helper app. Success criterion: the DSH
   client boots and `ws://127.0.0.1:31761/api/remote.mux` stays connected — the same
   criterion that failed for Servo.
4. Otherwise leave the CEF question parked, exactly as the Verso experiment is.

## 7. Artifacts and reproduction

* Scratch: `<workspace>\\cef-probe\` — `tauri-runtime-cef\` (clone, winit pinned),
  `probe\` (the smoke-test crate), `build*.bat` / `*.log` (every build),
  `shot1.png` (the window), `pins*.log` (the downgrade trail), `x\` (extracted
  `tauri-runtime` 2.11.3/2.12.1 for the trait diff).
* The failing baseline (tauri 2.12.1 + winit beta.3) is `build1.log` / `build1-short.log`
  — 13 errors; the working set is `build6.log`.
* Nothing under `<workspace>\\dsh-link\` was modified except this file.

**Scratch state (pruned 2026-10-05).** The re-downloadable parts are gone:
`probe/target/` (3.6 GB, including the 156.5 MB CEF binary archive and two copies of
`libcef.dll`) and `x/` (extracted `tauri 3.0.0-alpha.4` / `tauri-runtime 2.11.3`
crates). Kept: the probe source and `Cargo.lock` (the working pin set), every build
log and `.bat`, `shot1.png`, and the `tauri-runtime-cef` clone — whose only local
change (`Cargo.toml`) is saved as `tauri-runtime-cef-Cargo.toml.patch`. Rebuilding the
smoke test therefore means re-downloading the CEF binary distribution (~157 MB).
