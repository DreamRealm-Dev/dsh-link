# Host embed page (R195 P4): the contract, the recipe, and what is NOT true yet

> Deliverable: `docs/handoff/R195-contract.md:36` (§2 P4). Its inputs are §1 of the same contract
> (`docs/handoff/R195-contract.md:5-13`, the measured facts) and the survey behind it
> (`<workspace>\\.tmp\r195-tauri\report.md`).
> Writer = the round's P1/P4 author (same author by `docs/handoff/R195-contract.md:36`). The only files this round
> wrote are this page and `plugins/dsh-link-host/**`.
> **Entirely offline.** No connection to 31761 / 31760 / 9222; the client was not started or stopped; no
> `cargo build`, no `tauri build`; no git write. The one socket opened is the self-check's own ephemeral
> loopback port, printed on every run (`plugins/dsh-link-host/test/embed-routes.spec.mjs`).
> **Every claim below cites a `file:line`.** §9 is the same set as one table, so a reader can re-read it
> mechanically; the self-check re-reads the four origin sites off disk on every run
> (`plugins/dsh-link-host/test/embed-routes.spec.mjs`, reading `C3`).
> **What this page does NOT claim.** No cold `cargo build` time was measured on this machine: no log
> exists and this round did not build (`docs/handoff/R195-contract.md:41`, `<workspace>\\.tmp\r195-tauri\report.md:77`).
> No live window was opened by the author, and the Rust in §3 is illustrative: it was not compiled.

## 1. The one sentence to start with

**DSH-LINK is an application, not a library.** It builds its own `tauri::Builder::default()`
(`src-tauri/src/lib.rs:212`, inside `pub fn run()` at `src-tauri/src/lib.rs:196`) and creates its one window
`"main"` (`src-tauri/src/lib.rs:397`); the panel code finds that window by a hardcoded label
(`src-tauri/src/core/sidebar_panel.rs:1491`, failing text at `src-tauri/src/core/sidebar_panel.rs:1504`). So a host cannot
"contain" DSH-LINK's webview. What a host CAN do today is carry this round's page in a child webview
**the host creates itself**, and speak the mode protocol that page implements.

That is honest, and it is enough for the requirement (a right sidebar that becomes the full window):
**the switch is one rect on one webview, not two windows.** The shell's own switch is
`POST /__shell/panel` with `op=surface` (`src-tauri/src/core/proxy.rs:234`) or its pre-R178 alias
`op=set-bounds` (`src-tauri/src/core/proxy.rs:332`, alias rule at `src-tauri/src/core/proxy.rs:206-207`), which
reaches `sidebar_panel::surface()` (`src-tauri/src/core/sidebar_panel.rs:1733`) and ends in the child webview's
own `set_bounds` (`src-tauri/src/core/sidebar_panel.rs:1512`). A host makes the same move with its own runtime's
`set_bounds` on the same rect. What crosses the boundary is a **protocol**, not a command channel.

## 2. What this round ships: two read-only GET routes

Registered by the new host-plane row in `plugins/dsh-link-host/cordis.patch.yml` (row `link-host`, package
`dsh-link-host`), through the same lazy `ctx.get('webServer')` binding `plugins/dsh-link-notes/src/index.ts:877-993`
uses. Both answer GET and nothing else: any other verb is `405` with the named code
`METHOD_NOT_ALLOWED` and `Allow: GET` (`plugins/dsh-link-host/src/index.ts:660`). HEAD is refused too, and it is
the one verb whose refusal cannot carry the code in a body, because HTTP forbids a body on HEAD: it
answers 405 + `Allow: GET` and nothing else.

| route | answers | source |
|---|---|---|
| `GET /api/dsh-link-host/contract` | the embed contract as JSON data, version `1.0.0` | `plugins/dsh-link-host/src/index.ts:78`, body built at `plugins/dsh-link-host/src/index.ts:282` |
| `GET /api/dsh-link-host/embed` | one self-contained HTML page: no framework, no build step, no external ASSET, and one page that reads four same-origin routes of the kernel that serves it | `plugins/dsh-link-host/src/index.ts:81`, page built at `plugins/dsh-link-host/src/index.ts:381` |

The contract JSON names: the version (`plugins/dsh-link-host/src/index.ts:75`), the embed path, both modes
`sidebar` and `full` (`plugins/dsh-link-host/src/index.ts:84`), both ways to select one (the query parameter
`?mode=` and a `postMessage` of `{type:'dsh-link:mode', mode}`, `plugins/dsh-link-host/src/index.ts:95`), the three
query parameters (`mode`, `sidebarWidth`, `panel`), the bounds protocol the shell already speaks
(`POST /__shell/panel` with `op=surface` / `op=set-bounds`, plus `op=state` as the read-back at
`src-tauri/src/core/proxy.rs:232`), the three host capabilities (§4), and the four hardcoded-origin sites
(§5, `plugins/dsh-link-host/src/index.ts:145`). Two calls answer **identical bytes**: no clock, no counter, no
served counter (`plugins/dsh-link-host/test/embed-routes.spec.mjs`, reading `C6`).

The page is the part a host actually loads. Four properties matter, and each one is a reading:

- **It works when the host can only set a URL.** `?mode=sidebar` or `?mode=full` is read once at load, and the
  served `<html>` element already carries `data-dsh-link-mode="sidebar"` plus the default width, so the layout
  exists before any script runs (`plugins/dsh-link-host/src/index.ts:540`).
- **It refuses what it does not know, by name.** A mode that is not `sidebar` or `full` is refused with
  `EMBED_MODE_UNKNOWN` (`plugins/dsh-link-host/src/index.ts:114`) and the page stays in the last good mode; an
  unusable `?sidebarWidth=` is refused with `EMBED_WIDTH_UNUSABLE`; an unknown `?panel=` with
  `EMBED_PANEL_UNKNOWN`. A message whose type is not `dsh-link:mode` is **ignored**: counted, never acted on.
- **It states what it did.** `data-dsh-link-mode` on the html element, the body and the panel; the panel's own
  `offsetWidth` and `offsetHeight` as the geometry it chose; `data-dsh-link-refusal`; and
  `window.__DSH_LINK_MODE`, `window.__DSH_LINK_EMBEDDED`, `window.__DSH_LINK_EMBED__`.
- **It is a panel, and it reads the kernel it was served from.** Four cards - bus, team board, notes, browser
  panel - are four real same-origin `GET`s (`LIVE_ROUTES` at `plugins/dsh-link-host/src/index.ts:355`): the
  collaboration bus's status document (teams, members, ledger, relay, and R217's `messages` block), the team
  board, the note ledger, and the shell's own `/__shell/panel-start` entry, which is probed for reachability
  and opened in a new tab. A card whose route is absent says `HTTP 404` in its own line and draws NO figure -
  a zero would be a reading nobody took. There is no `setInterval`/no `setTimeout` in the page: it re-reads
  when a person presses refresh or the document becomes visible. The protocol prose is unchanged and moved
  into a `<details>` drawer at the bottom, closed by default (`plugins/dsh-link-host/src/index.ts:605`).

**One honesty note that costs a sentence and saves a debugging afternoon.** A Tauri child webview is a
separate document, not a frame: inside it `window.parent === window` is TRUE even while a host carries it. So
the page reports "no ancestor frame" rather than claiming to know it is not embedded
(`data-dsh-link-embedded`, set at `plugins/dsh-link-host/src/index.ts:605` onward). It also means a host that owns
the child cannot `window.parent.postMessage(...)` into it: it evaluates the same message into the child
instead, `window.postMessage({type:'dsh-link:mode', mode:'full'}, '*')`. That is exactly how the live gate is
specified to drive it (`docs/handoff/R195-contract.md:32`). An iframe or browser-tab host may post to
`window.parent` / `window.opener` normally, and the page answers by posting its mode back to whichever of those
it has, or states the mode on the document when it has neither.

## 3. Minimum viable integration

The Rust below is the shape, not a compiled sample (§0). Steps 3 and 4 are the two rules that are hard
won and easy to get wrong.

1. **Enable the multi-webview API.** `tauri = { version = "2", features = [..., "unstable"] }`
   (`src-tauri/Cargo.toml:20`). The feature gates `Window::add_child` and pulls in no new dependency
   (`src-tauri/Cargo.toml:17-19`).
2. **Point the child at the embed URL** on the shell's origin, with the mode it should start in:
   `http://127.0.0.1:31761/api/dsh-link-host/embed?mode=sidebar`. The origin is the shell proxy's own
   (`src-tauri/src/lib.rs:40`); the proxy forwards `/api/*` to the kernel (`src-tauri/src/core/proxy.rs:184`).
3. **Do not call `add_child` from the thread that handled an HTTP request.** Measured in this tree: it
   deadlocks on Windows (`src-tauri/src/core/sidebar_panel.rs:1476-1479`), which is why the production code
   spawns a thread (`src-tauri/src/core/sidebar_panel.rs:1490`) and rendezvouses on a channel
   (`src-tauri/src/core/sidebar_panel.rs:1486-1508`). A host does the same.
4. **Wait for the window, then place it.** `add_child` returns before the renderer is usable; the shell waits
   for creation and then re-applies the rect (`src-tauri/src/core/sidebar_panel.rs:1508-1512`). A freshly created
   webview also refuses the first in-process protocol call for about a moment: the shell sleeps 250 ms,
   measured (`src-tauri/src/core/sidebar_panel.rs:1514-1517`).
5. **Resize it yourself; there is no proportional shortcut.** `auto_resize` only scales proportionally, which is
   why the shell's page measures its own column and posts the rect back
   (`src-tauri/src/core/panel_host.js:3-6`, post at `src-tauri/src/core/panel_host.js:78`). Two rects matter:
   the sidebar rect (the host's own column) and `surface(0, 0, W, H)` for the full window
   (`src-tauri/src/core/sidebar_panel.rs:1733`). A width or height of 0 or less means "the pane is gone" and
   unmounts rather than parking the webview at 0x0 (`src-tauri/src/core/sidebar_panel.rs:1739-1744`). The shell's
   own host loop refuses to place anything smaller than 48 px (`src-tauri/src/core/panel_host.js:31`).
6. **Switch modes one of two ways.** Load `?mode=full` into the child (a reload: in-page state is lost), or
   evaluate the message into the live document (no reload):
   `window.postMessage({type:'dsh-link:mode', mode:'full'}, '*')`. Then move the webview's rect to the full
   window. Nothing else changes - it is the same webview, so the tab, the session and the profile survive
   (`<workspace>\\.tmp\r195-tauri\report.md:9`; the switch ends in one `set_bounds` at
   `src-tauri/src/core/sidebar_panel.rs:1512`). Unmounting is a DIFFERENT op and does cost in-page state
   (`src-tauri/src/core/proxy.rs:241`, `src-tauri/src/core/sidebar_panel.rs:1759-1760`).
7. **Read back what happened** instead of assuming it: `data-dsh-link-mode` and the panel's
   `offsetWidth`/`offsetHeight` on the document, or `op=state` against the shell's panel route
   (`src-tauri/src/core/proxy.rs:232`) when the host is also the shell.

A host that wants the shell's own chrome strip and letterboxing should not expect it here: the shell
divides its declared surface itself and paints the tab strip in a second child webview placed in the
surface's top `CHROME_H` pixels (`src-tauri/src/core/sidebar_panel.rs:96-98`, division at
`src-tauri/src/core/sidebar_panel.rs:1534`). The embed page draws only the panel.

## 4. What the host must ALREADY be able to do

Read this before writing code. Three capabilities; the contract publishes the same three as data
(`plugins/dsh-link-host/src/index.ts:182`).

| capability | plainly | evidence |
|---|---|---|
| **a child webview it creates itself** | the host owns the webview that loads the page. Cross-process embedding of DSH-LINK's own webview is not a Tauri capability: `add_child` needs the parent window in the SAME app process | `docs/handoff/R195-contract.md:9`; `src-tauri/Cargo.toml:17-20`; production use at `src-tauri/src/core/sidebar_panel.rs:1499-1502` |
| **a CSP that admits the shell origin** | if the host renders pages from the shell, its policy must allow `http://127.0.0.1:31761` for `default-src` and `connect-src`, and must allow inline script and style, because the page IS one inline block | `src-tauri/tauri.conf.json:12` (the worked example); the page's inline block begins at `plugins/dsh-link-host/src/index.ts:480` |
| **same-origin HTTP to the shell** | the proxy refuses any request whose `Origin` header is not exactly `http://127.0.0.1:31761` (403), so a host document on another origin cannot `fetch` these routes | `src-tauri/src/core/proxy.rs:756-772`; the rule stated at `src-tauri/src/lib.rs:38-40` |

What a host does NOT need: it does not need DSH-LINK to expose a command for the panel, because DSH-LINK
exposes none - the client drives the shell over same-origin HTTP and the crate registers no
`#[tauri::command]` at all (`<workspace>\\.tmp\r195-tauri\report.md:24`; the reasoning is at
`src-tauri/src/lib.rs:14-17`, and the capability file grants no remote IPC either,
`src-tauri/capabilities/default.json:9-18`). It does not need DSH-LINK's kernel either, unless it wants live
DSH data behind the page.

## 5. The four hardcoded-origin sites

`127.0.0.1:31761` is written down in four places (`docs/handoff/R195-contract.md:11`). A host that runs the
shell elsewhere, or that relaxes a policy, must reconcile all four or it has reconciled one of them. The
contract route serves this same table (`plugins/dsh-link-host/src/index.ts:145`), and the self-check reads each
line back off disk, so this page cannot silently go stale
(`plugins/dsh-link-host/test/embed-routes.spec.mjs`, reading `C3`).

| # | where | what it is |
|---|---|---|
| 1 | `src-tauri/src/lib.rs:40` | `SELF_ORIGIN`, the proxy's own origin: the window loads it (`src-tauri/src/lib.rs:382`, `:397`) and the CORS middleware compares every origin against it verbatim |
| 2 | `src-tauri/tauri.conf.json:12` | the app CSP: `default-src 'self' http://127.0.0.1:31761`, `connect-src` the same plus `ws://`, and `frame-src 'self' blob: data:` |
| 3 | `src-tauri/capabilities/default.json:7` | `remote.urls`, the remote origin the `"main"` window (`:5`) is granted a capability set for |
| 4 | `plugins/dsh-browser/lib/panel.js:35` | `DEFAULT_PANEL_ORIGIN`, the panel plugin's default, overridable by row config or `DSH_BROWSER_PANEL_ORIGIN` |

## 6. CSP facts: why an iframe is not the option

1. **The shell's own policy forbids framing a foreign origin.** `frame-src 'self' blob: data:`
   (`src-tauri/tauri.conf.json:12`) admits neither `http://127.0.0.1:31761` nor another app's origin. The
   contract records the iframe shortcut as blocked on this basis (`docs/handoff/R195-contract.md:10`).
2. **That behaviour was never measured here.** The survey lists "is an iframe of the shell origin actually
   loadable" as unmeasured, with the recipe to measure it (`<workspace>\\.tmp\r195-tauri\report.md:135`). Treat the policy
   reading as the fact and the runtime behaviour as untested.
3. **An iframe loses the two things this round is about.** It cannot create a child webview, and it cannot
   reach the in-process DevTools protocol the panel drives (`<workspace>\\.tmp\r195-tauri\report.md:82`).
4. **What the page needs from a CSP is small**: inline script, inline style, and no network at all. The
   page holds no `src=`, no `href=`, no `<link>`, no `@import`, no `url()` and no `fetch` - the self-check counts
   all of them and demands zero (`plugins/dsh-link-host/test/embed-routes.spec.mjs`, reading `E2`). So a
   policy like `script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'` is sufficient for the page
   itself, and the shell's policy already says both (`src-tauri/tauri.conf.json:12`).
5. **The kernel adds no CSP of its own to `/api/*` responses.** The only `content-security-policy` headers in
   the vendored kernel belong to the account platform's auth page and to a media route, not to the route
   this contract is served from (e.g.
   `core/deepseek-harness/packages/credentials/deepseek-account-platform/src/index.ts:645`; the same read of
   `core/deepseek-harness/packages` finds no other). So the policy that applies to the page is the one of
   the webview that loads it.

## 7. Engine findings, because "just embed a webview" has a trap door

All three notes are about WHOLE RUNTIMES. None of them lets a host choose an engine per webview, so none
of them changes the recipe in §3.

- **Stock wry / WebView2 is what ships.** Windows uses the system WebView2 with `downloadBootstrapper`
  (`src-tauri/tauri.conf.json:34-36`). A host on stock Tauri 2 gets the child webview API of §3 and nothing
  else needs to change.
- **CEF is a whole-runtime replacement.** `tauri-runtime-cef` means `Builder::<Cef>` and `tauri` with
  `default-features = false` (`docs/cef-runtime-evaluation.md:8-15`). Building it on Windows meant
  downgrading the whole Tauri train 2.12.1 -> 2.11.6 and exact-pinning six crates
  (`docs/cef-runtime-evaluation.md:11-12`, `:51-62`), with an **unmerged** upstream Windows shutdown fix
  (`docs/cef-runtime-evaluation.md:12-13`, the hole itself at `:106-107`) and `tauri build` knowing nothing
  about its packaging (`docs/cef-runtime-evaluation.md:111-118`). It did open a real Chromium window on this
  machine (`docs/cef-runtime-evaluation.md:9`, probe log at `:167`), and it does implement child webviews:
  `create_webview`, `set_bounds` and `WindowInfo::set_as_child` exist in the probe clone
  (`<workspace>\\cef-probe\tauri-runtime-cef\src\webview.rs:244`, `:205`, `:413`). That clone is outside
  this repository (`<workspace>\\.tmp\r195-tauri\report.md:46`, `:88`). NOT measured: a live render through that child
  path (`<workspace>\\.tmp\r195-tauri\report.md:136`). The only build number recorded is
  `Finished dev profile in 3.55s` after the first full build (`docs/cef-runtime-evaluation.md:167`) - not a
  cold build, and this page will not quote one.
- **Verso is parked.** `tauri-runtime-verso` forces `tauri = "=2.7.0"`
  (`docs/verso-runtime-experiment.md:44-48`), leaves `on_navigation` unwired and `set_size`/`set_position` as
  no-ops (`docs/verso-runtime-experiment.md:50-54`), and drops `indexedDB`, `ResizeObserver` and
  `IntersectionObserver` (`docs/verso-runtime-experiment.md:22`). It also loses the port in `Host:`, which the
  kernel answers with 403 (`docs/verso-runtime-experiment.md:27-36`). The experiment is parked
  (`docs/verso-runtime-experiment.md:7-9`), and its one build number is a second binary at 1m26s
  (`docs/verso-runtime-experiment.md:72`) - not a cold build either.

## 8. Named debt: what a host still cannot have

This round publishes a protocol, not a crate. Say it before someone integrates against a promise the
runtime cannot keep:

- **No `run_with`, no parameterised window label, no `#[tauri::command]` for the panel ops.** The shell builds
  its own window and looks it up as `"main"` (`src-tauri/src/lib.rs:212`, `:397`,
  `src-tauri/src/core/sidebar_panel.rs:1491`). Recorded as debt, not delivered
  (`docs/handoff/R195-contract.md:39-40`).
- **No cross-process embedding.** A host cannot acquire DSH-LINK's webview; multi-webview is one process
  and one app (`docs/handoff/R195-contract.md:9`, `<workspace>\\.tmp\r195-tauri\report.md:7-9`).
- **No cold build time claimed.** See the head of this page (`docs/handoff/R195-contract.md:41`).
- **No live verification by this page's author.** The offline self-check is
  `node plugins/dsh-link-host/test/embed-routes.spec.mjs`: 30 readings over a real socket on an ephemeral
  loopback port - both routes' status, type, cache and verb refusal, the contract's shape and values, the
  page's bytes, whether its inline script compiles, and the mode protocol driven in a fake DOM (sidebar ->
  full -> sidebar, an unknown mode refused by name, an unknown type ignored, a URL-only load, and the
  report posted back to an opener). The live readings - a real webview, a real window, a real geometry
  change - belong to the live gate (`docs/handoff/R195-contract.md:32`) and are NOT taken here.

## 9. The citations, as one table

Each row is a claim above, the file it came from, and the text that must be found there. A reader can
re-read the whole page with a loop over this table; the rows that name a line range name the line the
claim is about.

<!-- citations
| id | where | must contain |
|---|---|---|
| A1 | src-tauri/src/lib.rs:196 | pub fn run() |
| A2 | src-tauri/src/lib.rs:212 | tauri::Builder::default() |
| A3 | src-tauri/src/lib.rs:397 | WebviewWindowBuilder::new(handle, "main" |
| A4 | src-tauri/src/lib.rs:382 | SELF_ORIGIN |
| A5 | src-tauri/src/lib.rs:40 | http://127.0.0.1:31761 |
| A6 | src-tauri/src/lib.rs:14 | needs no IPC |
| A7 | src-tauri/Cargo.toml:20 | unstable |
| A8 | src-tauri/Cargo.toml:17 | multiwebview |
| B1 | src-tauri/src/core/sidebar_panel.rs:1491 | get_window("main") |
| B2 | src-tauri/src/core/sidebar_panel.rs:1504 | no window labelled main |
| B3 | src-tauri/src/core/sidebar_panel.rs:1500 | add_child(builder |
| B4 | src-tauri/src/core/sidebar_panel.rs:1478 | deadlocks on Windows |
| B5 | src-tauri/src/core/sidebar_panel.rs:1490 | std::thread::spawn |
| B6 | src-tauri/src/core/sidebar_panel.rs:1512 | set_bounds |
| B7 | src-tauri/src/core/sidebar_panel.rs:1517 | from_millis(250) |
| B8 | src-tauri/src/core/sidebar_panel.rs:1733 | pub fn surface |
| B9 | src-tauri/src/core/sidebar_panel.rs:1739 | w <= 0.0 |
| B10 | src-tauri/src/core/sidebar_panel.rs:1200 | pub fn set_bounds |
| B11 | src-tauri/src/core/sidebar_panel.rs:94 | sidebar-panels/p0 |
| B12 | src-tauri/src/core/sidebar_panel.rs:98 | CHROME_LABEL |
| B13 | src-tauri/src/core/sidebar_panel.rs:1534 | fn place_all |
| B14 | src-tauri/src/core/sidebar_panel.rs:1211 | /__shell/panel.js |
| C1 | src-tauri/src/core/proxy.rs:234 | "surface" |
| C2 | src-tauri/src/core/proxy.rs:332 | "set-bounds" |
| C3 | src-tauri/src/core/proxy.rs:232 | "state" |
| C4 | src-tauri/src/core/proxy.rs:241 | "unmount" |
| C5 | src-tauri/src/core/proxy.rs:206 | pre-R178 names |
| C6 | src-tauri/src/core/proxy.rs:184 | /api/{*endpoint} |
| C7 | src-tauri/src/core/proxy.rs:756 | fn cors |
| C8 | src-tauri/src/core/proxy.rs:764 | SELF_ORIGIN |
| D1 | src-tauri/tauri.conf.json:12 | frame-src 'self' blob: data: |
| D2 | src-tauri/tauri.conf.json:34 | webviewInstallMode |
| D3 | src-tauri/capabilities/default.json:7 | "urls" |
| D4 | src-tauri/capabilities/default.json:5 | "windows": ["main"] |
| E1 | plugins/dsh-browser/lib/panel.js:35 | DEFAULT_PANEL_ORIGIN |
| E2 | src-tauri/src/core/panel_host.js:31 | var MIN = 48 |
| E3 | src-tauri/src/core/panel_host.js:44 | data-dsh-link-surface |
| E4 | src-tauri/src/core/panel_host.js:78 | op: 'set-bounds' |
| F1 | docs/cef-runtime-evaluation.md:9 | verified |
| F2 | docs/cef-runtime-evaluation.md:51 | all six commands are required |
| F3 | docs/cef-runtime-evaluation.md:106 | Windows shutdown is the known hole |
| F4 | docs/cef-runtime-evaluation.md:116 | tauri build |
| F5 | docs/cef-runtime-evaluation.md:167 | Finished dev profile in 3.55s |
| G1 | docs/verso-runtime-experiment.md:22 | ResizeObserver |
| G2 | docs/verso-runtime-experiment.md:44 | =2.7.0 |
| G3 | docs/verso-runtime-experiment.md:52 | on_navigation |
| G4 | docs/verso-runtime-experiment.md:54 | no-ops |
| G5 | docs/verso-runtime-experiment.md:72 | 1m26s |
| G6 | docs/verso-runtime-experiment.md:7 | parked |
| H1 | plugins/dsh-link-host/src/index.ts:75 | CONTRACT_VERSION |
| H2 | plugins/dsh-link-host/src/index.ts:78 | /api/dsh-link-host/contract |
| H3 | plugins/dsh-link-host/src/index.ts:81 | /api/dsh-link-host/embed |
| H4 | plugins/dsh-link-host/src/index.ts:84 | ['sidebar', 'full'] |
| H5 | plugins/dsh-link-host/src/index.ts:95 | dsh-link:mode |
| H6 | plugins/dsh-link-host/src/index.ts:114 | EMBED_MODE_UNKNOWN |
| H7 | plugins/dsh-link-host/src/index.ts:145 | ORIGIN_SITES |
| H8 | plugins/dsh-link-host/src/index.ts:182 | HOST_CAPABILITIES |
| H9 | plugins/dsh-link-host/src/index.ts:282 | contractBody |
| H10 | plugins/dsh-link-host/src/index.ts:357 | embedPage |
| H11 | plugins/dsh-link-host/src/index.ts:436 | data-dsh-link-mode |
| H12 | plugins/dsh-link-host/src/index.ts:480 | <script> |
| H13 | plugins/dsh-link-host/src/index.ts:660 | methodNotAllowed |
| I1 | plugins/dsh-link-notes/src/index.ts:877 | function installRoutes |
| I2 | <workspace>\\.tmp\r195-tauri\report.md:24 | #[tauri::command] |
| I3 | <workspace>\\.tmp\r195-tauri\report.md:77 | 冷全量构建时间未测 |
| I4 | <workspace>\\.tmp\r195-tauri\report.md:136 | 没有活体读数 |
| I5 | docs/handoff/R195-contract.md:9 | ONE process and ONE app |
| I6 | docs/handoff/R195-contract.md:11 | 127.0.0.1:31761 |
| I7 | docs/handoff/R195-contract.md:32 | window.postMessage |
| I8 | docs/handoff/R195-contract.md:41 | NOT MEASURED |
-->

## 10. R281: the parameterisation COMPILED (requirement D''s first real step)

The note at the top of this page says the Rust in §3 was illustrative and never compiled. That is still true of §3
- and it is no longer true of the crate''s entry point, which now carries the three things a host needs:

| what a host needs | where it lives now | evidence |
| --- | --- | --- |
| a crate it can depend on | `src-tauri/src/embed.rs` behind `pub mod embed` (`src-tauri/src/lib.rs:37`) | `cargo check --lib` exit 0 |
| a way in with ITS configuration | `embed::run_with(HostEmbed)` -> records the configuration once, then runs the one application entry point (`run_configured`) | the same check; `run()` installs `HostEmbed::default()` first, so a standalone launch is unchanged |
| a window label that is not hard-coded | `embed::window_label()` answers the label; the seven lookups that used the literal `"main"` now ask it (single-instance handler, tray show/hide, boot window creation, the reload tick, the sidebar panel''s placement path, the focus restore, and `shellprefs`''s `apply`) | the same check; `cargo test --lib embed` **3 passed** |

Two facts about the compile, quoted so a reader does not have to take this on faith:

    cargo check --manifest-path src-tauri/Cargo.toml --package dsh-link --lib
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.67s            (exit 0)

    cargo test --manifest-path src-tauri/Cargo.toml --package dsh-link --lib embed
    test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured

What is still NOT done, in the same voice as the rest of this page: DSH-LINK still creates its OWN webview window,
so "inside a host''s existing window" remains the next step; the label is installed once per process and a second
`run_with` panics by name rather than pretending to apply; and no second Tauri application has been built against
this entry point yet - the way `foreign-app-agent-live` built one for the AGENT case.


