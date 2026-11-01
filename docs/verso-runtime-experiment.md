# Verso runtime experiment (parked)

Record of the attempt to run this shell on `tauri-runtime-verso` (Servo engine)
instead of the system webview, and of the measurements that ended it. Kept so the
work is not repeated blind; the shipping build is untouched (wry, latest Tauri).

Status: **parked 2026-10-05**. The chosen direction is the pinned WebView2 engine
(see `tauri.conf.json` → `bundle.windows.webviewInstallMode`), which keeps wry and
therefore the macOS/Linux webviews.

## What was measured

`versoview.exe` (the pre-built Servo webview, versoview v0.0.9, 2025-09-27) was
pointed at the real DSH kernel, instrumented with a userscript injected through
`--userscripts-directory`, plus a local WebSocket echo server and a TCP
man-in-the-middle in front of the kernel.

| Probe | Result |
|---|---|
| Client bundles, module graph, Cordis boot | runs; 58 plugins end up `pending` |
| `WebSocket`, `EventSource`, `Worker`, `localStorage`, `crypto.randomUUID`, `fetch` | present |
| `indexedDB`, `ResizeObserver`, `IntersectionObserver`, `SharedArrayBuffer` | **absent** (the client bundle references the two observers) |
| `GET /` through the kernel's cookie auth | 200 |
| `ws://127.0.0.1:31760/api/remote.mux` | error, then close 1006 |
| Same socket through a MITM | kernel answers **403 Forbidden** |

Root cause of the 403 (captured handshake):

    GET /api/remote.mux HTTP/1.1
    Host: 127.0.0.1                 <-- the non-default port is dropped
    Origin: http://127.0.0.1:31760

DSH's Host/Origin fence (`packages/client/connection/src/api-request-trust.ts`)
compares `new URL(origin).host` with the Host authority, so `127.0.0.1:31760` ≠
`127.0.0.1` and the upgrade is refused. The client's `remote.*` services never
appear, which is what leaves every dependent plugin pending.

Note the shell's own proxy dodges this: `core/proxy.rs` forwards only the cookie
and content type upstream, so the kernel sees no Origin at all. The proxy path is
therefore viable on Servo — the engine gaps above are the remaining risk.

## Integration cost

Adding the runtime to this crate forces **`tauri = "=2.7.0"`** (tauri-runtime-verso
declares it, plus `tauri-runtime = "=2.7.1"` and `tauri-utils = "=2.6.0"`), because
the runtime depends on Tauri internals that were never feature-gated. In this repo
that downgraded: tauri 2.12.1 → 2.7.0, tauri-utils 2.10.1 → 2.6.0, tauri-build
2.7.1 → 2.3.1, tauri-plugin-single-instance 2.5.2 → 2.3.2.

Runtime trait coverage in `tauri-runtime-verso` (`src/webview.rs`, `src/window.rs`):
`eval_script`, `reload`, `url`, `navigate`, `cookies`, `is_visible` exist —
which is what this shell's watchdog needs — but **`on_navigation` is not wired at
all**, so `allow_navigation` in `src/lib.rs` would silently stop fencing the window;
`open_devtools`/`close_devtools` are empty; `set_size`/`set_position` are no-ops.

## Upstream status

- `versotile-org/verso` — **archived**, last push 2025-10-08.
- `tauri-apps/verso` — last `versoview` release **v0.0.9, 2025-09-27**.
- `versotile-org/tauri-runtime-verso` — last substantive commit 2025-10-03; 2026-09-10
  was an audit fix. Maintainer, issue #20 (2026-07-09): "Verso side is hard to push
  since there're way too many breaking changes from Servo that we simply couldn't keep
  up anymore. `tauri-runtime-verso` can be updated but is semi-blocking on the
  `NewWindowOpener` introduced in tauri 2.8 that never got feature gated."

## Reproducing the integration

The working variant was: a `runtime-verso` cargo feature, a second bin
(`dsh-link-verso.exe`) calling a generic `run_with<R: tauri::Runtime>(builder)`,
`build.rs` gated on the feature to fetch `versoview` as an external bin, and
`tauri-runtime-verso = { git = "https://github.com/versotile-org/tauri-runtime-verso.git" }`.
It compiled in 1m26s and produced `target/debug/dsh-link-verso.exe`; the crate is
back on wry now, so the exe is the only remnant besides this note.

Two build-environment facts worth keeping:

- Cargo's libgit2 fetch failed against github.com from this machine; the build needed
  `CARGO_NET_GIT_FETCH_WITH_CLI=true` plus a git `insteadOf` rewrite to
  `https://gh-proxy.org/https://github.com/`, which was ~15× faster (1.3s vs 21s
  timeout) for the same `git ls-remote`.
- The Verso build script downloads the pre-built `versoview` with `curl` into
  `src-tauri/versoview/versoview-{target}.exe`; pre-placing the file plus a
  `versoview-version.txt` containing the crate version skips it.
