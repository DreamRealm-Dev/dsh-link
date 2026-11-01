# DSH Link

**English** | [简体中文](README.zh.md)

A Tauri desktop shell for **DeepSeek Harness**. The window renders the **official DSH
client**, served by the shell through an authenticating loopback proxy; the kernel is
DSH itself, run as a local child process.

| | |
|---|---|
| Kernel | `deepseek-ai/deepseek-harness` @ `dsh-v0.2.2-alpha.2` (tag commit `f3803c96`, patch branch `dsh-link/multilevel-team` @ `1ee84404fa`) |
| Shell | Tauri v2 (Rust) |
| Interface | the official DSH client, unmodified |
| Version | `v0.1.0-experimental.1` — [release notes](docs/release/0.2.2-alpha.2.md) |

## Positioning

**DSH LINK** = **DeepSeek Harness Lightweight Integration Nexus Kit** — a low-level framework
built on DeepSeek Harness. The core idea: **link what is needed, integrate it stably**.

| Letter | Word | Chinese | Positioning |
| --- | --- | --- | --- |
| **L** | Lightweight | 轻量 | No heavy runtime bundled; light on every platform first |
| **I** | Integration | 集成 / 联动 | A framework for software-to-software linkage |
| **N** | Nexus | 枢纽 / 连接点 | Extensibility: connect modules around the official core |
| **K** | Kit | 套件 | Follows the official design; an enhancement kit for official Harness, not a separate product |

- Stack: React + **Tauri** (v2+) | Rust (backend) | Vite (bundler) | system WebView + Servo
  (via **tauri-runtime-verso**, the next-generation Rust unified WebView architecture — cross-platform
  engine consistency needs early adaptation, but system WebView remains the primary target today).
- First platforms: Windows, Linux, macOS, Android.
- Baseline: currently pinned to **dsh-v0.2.2-alpha.2** (tracking upstream latest); the Tauri shell is
  already a stable, polished third-party DSH desktop baseline.
- Organization: **everything is a plugin; the kernel stays unmodified.** A capability is carried by one or
  more plugins that coordinate with each other. When requirements conflict, take the most "community"
  route; do not program toward a result — the framework must stay portable; new controls follow the
  existing design language (itself derived from DSH).

### Three innovation parts

#### 1. DSH cross-version loader (unblocks the bottom layer)

DSH upstream updates very frequently and often ships breaking changes, forcing old plugins into heavy
adaptation. Existing approaches each cover only part of the problem (dsh-loader's adapter registry,
@lanbaolu/dsh-compat's alias fallback, dsh-compat-guard's upgrade governance, dsh-plugin-compat-guardian's
CI automation), so LINK builds a **cross-version plugin loader**: DSH renames, moves, and re-shapes things;
plugin code does not change.

- **Two interface layers.** The **passthrough interface** (for plugins that need fine control) hands the
  original DSH service object through dshLoader.services.get('sessions') so no capability is lost. The
  **simple interface** (for most plugins) turns multi-step operations into one call and complex objects
  into plain data — for example session.getRecentMessages(sessionId, limit),
  tools.registerSimple(name, handler), settings.define(key, defaultValue, schema).
- **The passthrough interface works like a translator.** Plugins only speak "plain language" and only see
  the loader; the loader only sees DSH; in between sits a "dialect table" of what each capability is
  called in each DSH version, so an upgrade means adding one row. When a change cannot be translated, the
  loader says so plainly — "this capability is not available on the current DSH version" — **no guessing,
  no lying, no hidden landmines**.
- This layer delivers: plugins keep their original shape (an upgrade is none of their business); lightweight
  (the table is resolved once at startup); high performance (hot paths hold the translated reference with no
  extra forwarding); high reliability (an untranslatable capability raises a clear "unsupported" error
  instead of a result that looks successful but is wrong). Adaptation is rolling.

#### 2. Cross-software linker: one unified interconnect layer (unblocks the surface layer)

Move from "tool calls" to a "collaboration bus": every Agent is an equal compute node, and the bus is the
fabric connecting them. The "call tool" paradigm cannot be escaped (a model limitation), and it is enough —
like a team using a chat app to coordinate. The identity and trust layer matters: an Agent needs to know
roughly where it sits in the architecture, so the lead can decide how to dispatch based on the strengths
and weaknesses of different Agent frameworks and models.

| Dimension | Old design (tool calls) | New design (collaboration bus) |
| --- | --- | --- |
| **Agent relation** | caller and callee | equal collaborating nodes |
| **Communication** | request-response API calls | asynchronous messaging + shared state |
| **Task model** | single-step tool execution | multi-step task DAG with dependencies |
| **Team structure** | flat | fractal, recursively nestable |
| **Failure handling** | error on the failed call | node isolation, task rescheduling |

Mechanisms:

- **Capability registry.** Every Agent declares identity and capabilities at startup (id / type /
  capabilities / parent / status); the registry keeps live state and supports dynamic discovery.
- **Message bus, control and data separated.** The control channel carries task assignment, status
  updates, and approval requests; it must be durable, written to an append-only event stream so it can be
  replayed and audited. The data channel carries token streams and intermediate results over temporary
  sessions with a TTL, so it never blocks control traffic.
- **Shared task board.** Tasks live as a DAG: dependency management (a task becomes ready only after all
  prerequisites complete), claim and lock (so two Agents never work the same task), and status
  synchronisation (pending → in progress → awaiting review → done) broadcast on the control channel.
- **Failure isolation and rescheduling.** A heartbeat timeout marks an Agent unhealthy, its in-flight task
  is released back to the board as ready, the board reschedules it from the capability registry, and the
  failed node is isolated until it recovers. One Agent failing does not stop the team.
- **Fractal team structure.** The root team (Team 0) is the DSH Agent the user talks to; the lead splits
  the goal and creates or recruits sub-teams (Team 1..N, whose leads may be DSH Agents or external Agents
  such as HanaAgent, OpenCode V2, Codex), recursively, until a task is small enough for one Agent. This
  matches the official dsh-experimental-agent-team: the session Agent becomes the Lead, creates named
  teammates, and shares the task board.
- **Three phases.** (1) control bus + task board + capability registry; (2) failure isolation and
  rescheduling; (3) fractal teams and multi-platform Agent access (an external Agent installs a small
  bridge plugin and can join any session; MCP is a faster but slightly compromised route).
- When needed, a sub-Agent can message peers, ancestors, or descendants directly with no middleman.
  Normally a sub-Agent inherits its parent's model selection; the parent may also designate one.

#### 3. Collaboration interconnect layer (unblocks device-to-device links)

**Module one: device-to-device networking.** Devices on the same LAN discover each other; device A (master)
connects to device B (slave):

1. **Continue across devices.** A attaches to a conversation on B (the Agent still runs on B) and manages
   it on A as if it were local — continuation, not task migration. A and B may be any device type
   (phone/desktop); one is the serving side, the other the receiving side.
2. **Cross-device access.** A's Agent reaches B's files and runs pwsh on B through tools, within the
   granted permissions.
3. **Cross-device teams.** A uses B's DSH as a relay to bring other Agents on B (or freshly created ones)
   into one Agent Teams.
4. **Cross-device network chains.** A (master) – B (slave) – C/D (under B, same level): A reaches C and D
   directly, with **permissions at the shortest path** (if A fully controls B but B only reads C, then A
   only reads C). Sandboxing is handled by the slave's own DSH.

**Module two: Agent Teams collaboration.** Agents talk through tools (send_message), and the user
participates deeply: one place to see the Agent cluster, ongoing exchanges, and task claims, to steer the
lead or ask it directly (frontend controls follow DSH's style). Free-form exchange: two Teams (A and B) in
one DSH instance can talk even when their work is unrelated — at first only lead-to-lead (like two heads of
state calling: A's lead discovers B's team through tools and sends requests; B's lead must agree before any
action; after the first virtual handshake the lead may assign an Agent to communicate, with the matching
tool permissions). When their work overlaps, A may recruit B or choose to be recruited by B. The
tool-calling Agent model means a message has a single "user", but tools let the model tell "who is who"
(DSH's built-in Agent Teams is tailor-made for the model; the two improve each other).

Device networking is not either-or: networks can also nest. Anything running DSH-LINK, or another Harness
with the DSH-LINK interconnect plugin installed, can connect.

### Other capabilities (planned / in progress)

A Markdown editor benchmarked against Obsidian, as tasteful as HanaAgent and tailored to Agent scenarios
(formulas and diagrams included, docked in the right sidebar); a fuller interconnect panel; a mobile
DSH-LINK that ships no kernel (Rust + React + Tauri; it can drive a desktop DSH, let Agents read phone
files, and act as microphone/camera, all with authorisation); chat mode (no tools or audit; the user
decides whether network access applies to the next turn); tool opening and withdrawal (a third "auto"
state beside on/off, tool groups, an activation tool, automatic on-demand opening); a self-written provider
router (opencode go/go plus, command code, and user-defined endpoints); an investigation of the
experimental Auto review permission option; Chinese localisation and icon completion (consistent style,
varied icons, light/dark); responsive layout; upgrades (the kernel ships with DSH-LINK; a DSH-LINK upgrade
must not lose conversations, drop capabilities, or fail to start); plugin ecosystem integration (official
and third-party markets, themes, interaction widgets, context-management plugins).

### Pitfalls and invariants (summary)

- Cordis inversion is one-sided and local: sending messages, writing files, network requests, browser
  actions, and cross-device pwsh are emissions and cannot be fully undone — only withheld, compensated,
  or reified into a coeffect. "No rollback" is acceptable, but it must be designed explicitly
  (compensation / roll-forward / isolation-and-discard / external persistence / soft-delete tombstones /
  rescheduling / version-level rollback / host restart).
- Persistence must live **outside the Fiber lifecycle** (not necessarily outside DSH): conversation
  history, task-board DAG, control-channel messages, notes, device pairing and grants, approvals and audit,
  and plugin configuration must be durable; data-channel messages, heartbeats, presence, transient UI state,
  and caches need not be. Prefer DSH's existing session, configuration, and plugin-state storage, and make
  persistence itself a coeffect provider (session.store, task.board, note.store) that other plugins read
  through ctx.get(...).
- Identity and trust: Agent identity = fiber uid + provider key + capability manifest; trust = interception
  metadata + provider policy; hierarchy = parent fiber + provider dependencies.

## Scope of this repository (experimental)

This is the source release of **v0.1.0-experimental.1**: kernel baseline dsh-v0.2.2-alpha.2 plus the LINK
patch series, verified on this machine (build, type checks, both package suites, compatibility gates, live
e2e; see the [release notes](docs/release/0.2.2-alpha.2.md)).

- The kernel is not vendored: follow "Building and running" to fetch the pinned tag and apply the patches in
  docs/kernel-patches/ in order.
- **Not included**: internal work documents, prompts, and third-party plugin analysis archives
  (docs/handoff/, docs/drss/, docs/frontend/, docs/codex/, .opencode/, compat/adaptation/) — they contain
  machine paths and internal process records and are not product source.
- **No third-party plugin code or keys**: third-party plugins (for example the opencode routing plugin) are
  installed by the user into their own profile; API keys and the like are DSH_HOME runtime data and are not
  in this repository.
- Build outputs, runtime data, .tmp/, node_modules/, and src-tauri/target/ are gitignored.

## Pitfalls

[docs/PITFALLS.md](docs/PITFALLS.md) —— 踩过的坑，每条带判定命令与修法。**先读第 1 条**：在 DSH 会话里编译出来的 exe 会被打上「低完整性」标签，托盘图标与窗口创建会因此静默失败。

## Why the official interface

DSH's frontend plugins — `dsh-chat-mode`, `dsh-svg-studio`, and anything else built on
`dsh.client` — extend the official client through its slot system. An interface drawn
from scratch has no slots, so every one of those plugins is invisible to it. Loading the
official client is what makes the plugin ecosystem apply.

The shell keeps only what the official client cannot provide for itself: the window, the
kernel process, the session credential, and a way to report a kernel that will not start.

## Layout

```
src-tauri/                    Rust shell — all of this project's code
  src/core/locator.rs         locate the kernel checkout and prove it is runnable
  src/core/profile.rs         DSH_HOME layout, the overlay seed, the profile-patch seed
  src/core/session.rs         launch-token capture and cookie exchange
  src/core/proxy.rs           reverse proxy for the kernel's whole HTTP surface
  src/core/bridge.rs          the client bridge injected into the index
  src/core/pnpm.rs            the bundled package manager and its shims
  src/core/update.rs          self-update from the project's GitHub releases
  src/core/shellpage.rs       the boot and recovery page shown before the kernel is up
  src/core/supervisor.rs      child-process supervision
  src/lib.rs                  wiring: bind the proxy, start the kernel, tray, updates
core/deepseek-harness/        the vendored kernel — a pinned checkout, do not edit
plugins/                      the Theme section, the Liquid Glass material, and
  build.mjs                     the desktop-edition port, as dsh profile bundles;
  dsh-liquid-glass/             esbuild is the whole toolchain (theme only)
  dsh-theme-settings/           the Theme section + the durable preference (both halves)
  dsh-image-guard/              desktop-edition port: image-count hard cap
  dsh-escalation-guard/         desktop-edition port: the sandbox hotfix, as a runtime guard
  dsh-agent-context/            desktop-edition port: delegation tools (mounted; measured 2026-10-07)
  dsh-browser/                  desktop-edition port: browser_* tools (mounted 2026-10-07: 14 tools, 9434 B of schemas)
  dsh-lan-bridge/               desktop-edition port: LAN bridge (mounted all along: 5 root-layer bridge_* tools)
  dsh-delegation-model-choice/  desktop-edition port: cross-model delegation (mounted all along)
  dsh-anchored-lite/            desktop-edition port: on-demand tool anchoring
  dsh-continue-button/          the conversation's 继续生成 button (client half)
  dsh-link-mods/                the mount rows and the two ported agent presets
dist/index.html               packaged fallback only; the window loads the proxy
scripts/cdp-shot.mjs          pixels of a running shell, over CDP (material review)
scripts/cdp-glass-live.mjs    inject the material's sources for visual iteration
scripts/verify-theme-section.mjs  acceptance for the Theme section, both directions
scripts/verify-accept.mjs     the menu's frame timeline, the corners, the probes
scripts/verify-radius-audit.mjs  the window's corner and every surface's, in pixels
scripts/probe-proxy.mjs       what the official client needs from the proxy
scripts/probe-bridge.mjs      what the live page sees of the injected bridge
scripts/e2e-session.mjs       the full session path through the proxy
scripts/verify-tray.ps1       closing the window must hide it, not quit the process
scripts/fetch-pnpm.mjs        download the pnpm bundle this install ships
```

## Why there is a proxy

Two reasons, and only the second is obvious.

**The cookie.** DSH 0.2.x authenticates *every* route, `/api` included:

1. At startup the kernel prints one line to stdout:
   `dsh web: http://127.0.0.1:31760/?token=<launch token>`
2. `GET /?token=…` answers `303` plus a signed cookie — `HttpOnly`, `SameSite=Strict`,
   bound to the request authority.
3. Every later request must present that cookie. Without it: `401`.

A browser cannot do this itself. `Cookie` is a forbidden fetch header, and the cookie is
unreadable from JavaScript. The official client sidesteps it because its Electron shell
holds the cookie out of band over Node IPC — which Rust cannot do. So the shell performs
the exchange itself and attaches the cookie on the way upstream.

**One origin.** The proxy mirrors the kernel's entire HTTP surface at its own root: the
index, every bundle, `/api` unary calls, and the WebSocket downlinks. The page and its API
are therefore same-origin, which means no CORS relaxation, no remote-domain IPC opt-in,
and a CSP that can stay strict.

The client never learns the kernel's address or its credential. It only ever sees
`http://127.0.0.1:31761`.

Two details of that mirroring are load-bearing:

- The index HTML must be forwarded byte for byte. The kernel's host writes the
  `window.__DSH_BOOT__` module manifest into it, and the client has nothing to boot from
  without it.
- Path and query must be set separately when building the upstream URL. Client bundles are
  addressed as `plugins/??@deepseek-ai/dsh-client-<name>/client.js&rev=<hash>`, where the
  `??` is part of the *path*. Folding them together percent-encodes the `?` and every
  plugin 404s, which surfaces as "Failed to load plugins" rather than as a routing bug.

## The client bridge

The official client gates every Desktop-only surface on one page global,
`window.dshDesktop`: account sign-in, the login-bonus notice, the account quota notice,
the account settings page, and the first-run onboarding. The Electron desktop supplies
it from its preload. A page served over HTTP has no preload, so the proxy injects a
same-origin script into the index instead (`core::bridge`), and the kernel's bytes are
otherwise forwarded untouched.

The script installs exactly the stub the official preload gives frames it does not own —
`{ protocolVersion: 1 }` — plus the two things a proxy cannot provide: an external link
has to reach the system browser, and the official onboarding asks whether a model
credential is configured. Nothing here grants a credential or an IPC surface: the account
operations that appear travel the kernel's own Remote API, which the Web profile already
mounts.

| Endpoint | Purpose |
|---|---|
| `GET /__shell/bridge.js` | the injected script |
| `GET /__shell/has-api-key` | whether a credential reference holds a value |
| `POST /__shell/open` | open an http(s) link in the system browser |

Two policies live in the same place, because a proxy has no window-open handler and no
install identity to fall back on:

- **Every external link leaves for the system browser.** The account page's Platform links,
  the usage and top-up links, the bonus notice's link and the feedback entry are
  `target="_blank"` anchors, which never call `window.open` — they ask the webview for a
  new window. Both paths are fenced: the injected script routes `window.open`, and the
  window builder denies `on_new_window` after handing http(s) to the OS. Without the
  second one the client's links open a **second window of this application** showing
  somebody else's page.

  Handing the URL over is a per-platform mechanism, not one command: Windows `ShellExecuteW`,
  macOS `open` (LaunchServices), Linux `xdg-open` with an embedded fallback script. Android
  and iOS have no such call at all — there the handoff is the platform's own Intent or
  UIApplication request — so the official `tauri-plugin-opener` is registered for those two
  targets and nothing else, and a desktop build keeps the in-process call instead of that
  plugin's PowerShell backend. The obvious-looking
  Windows alternative, `explorer <url>`, resolves its argument as a shell item and opens a
  file-manager window — on this machine the user's Documents folder — which is where every
  external link here, including the tray's "open in browser" and the automatic open of the
  Platform sign-in page, once landed instead of in a browser.
- **The account menu's feedback entry is removed.** It leads to DeepSeek's own
  questionnaire, and this install is not DeepSeek. The injected script drops that row when
  the menu renders and swallows a click that still reaches it. It matches the entry's copy,
  so an upstream rename makes the entry reappear; nothing else changes.

Sign-in then works the way the kernel already implements it: the client shows a dialog with
the Platform authorization link, and the kernel polls Platform for the result.

That link is **copied, never opened**. The Desktop shell opens it from its main process as
soon as an attempt starts, and that automatic jump is what makes signing in take over the
desktop — a browser window the user did not ask for, in front of everything. Here the URL
is read out of the relayed account frame (a proxy has no main process to subscribe with) and
put on the clipboard, so the window stays where it is and the user chooses when to leave for
a browser; pasting that copy works, and so does the dialog's own link. Nothing depends on
reading the frame beyond the copy.

The split is therefore: **a click opens, nothing else does.** `window.open`, a
`target="_blank"` link and an external navigation are the click paths and reach the system
browser; a link the shell merely learns about is only copied.

## Package manager

`dsh plugin add` shells out to pnpm, so a desktop install cannot assume the machine has
one. The shell ships the pnpm package's own bundle (`scripts/fetch-pnpm.mjs`, gitignored)
and hands it to the kernel twice: a generated `--patch` overlay names the shim as the
plugin manager's `pnpmCommand`, and the child's `PATH` carries the same shim for every
other caller. An install with no bundle falls back to the `pnpm` on `PATH`, exactly as
the kernel behaves without this shell.

The overlay is rewritten on every launch (`DSH_HOME/dsh-link.runtime.patch.yml`) because
it describes where the shell found its own bundle, which is an install fact rather than a
preference. The user's own `dsh-link.patch.yml` is never touched.

Two notes that cost real time to learn: a `--patch` overlay that overrides a row the
settings form edits makes that row **read-only** (the config editor refuses it), which is
why DSH Link's defaults for editable rows are seeded into the profile patch instead; and
`dsh plugin add` does not register the bundle when pnpm exits non-zero, so an install has
to be confirmed with `--dump-config` rather than trusted.

## Self-update

The tray's **检查并安装更新** item reads this project's GitHub releases, picks the newest
release that carries an asset for this platform, downloads it with resume, and hands it to
a detached helper that waits for this process to exit before installing and relaunching.
Publishing a release on GitHub is the whole distribution step; there is no feed to host
and no signing key involved.

```sh
dsh-link.exe --check-update                      # what the tray item would do
DSH_LINK_UPDATE_REPORT=report.txt dsh-link.exe --check-update
```

| Variable | Purpose |
|---|---|
| `DSH_LINK_UPDATE_REPO` | repository to read, `owner/name` |
| `DSH_LINK_UPDATE_API` | release API root, for a mirror or a test |
| `DSH_LINK_UPDATE_REPORT` | also write the result to this file |

Two field lessons from the DSH EAC updater are built in: the releases *list* is read rather
than the single latest release, because a project publishes assets for several shells and
only some releases carry this one; and prerelease identifiers are compared by semver's
rules, because ranking them by their first number puts beta.2 above rc.1. Installing is
Windows-only; elsewhere the check still reports and the install step refuses with that
reason.

## Window, tray, and start-up surface

Closing the window hides it to the tray, and only the tray's 退出 item ends the process
(with the supervisor stopping the kernel on the way out). A shell that dies with its window
cannot keep a long-running session alive in the background.

The window paints before any page renders, and WebView2's own default is white — in dark
mode that frame is a flashbang on every cold start. The shell therefore reads the system
appearance, paints the same surface the client's boot overlay uses, and pins the webview's
theme to the same reading, so the pre-paint frame, the shell's boot page and the client's
own overlay cannot disagree. The proxy is also bound **before** the window is created:
otherwise the window's first request arrives at nothing and the webview paints its own
connection-error page, which is exactly the white document this avoids.

### The window's corner

The window is undecorated and transparent, so its corner is drawn by the document
`src-tauri/src/core/frame.rs` injects. That corner is a *shape*, not just a radius:
`--dsh-shell-corner-shape` carries `superellipse(1.5)` — the continuous curve every surface
in this application is cut from, which the skin reads as its own `--lg-corner-shape` — and
`#dsh-shell-surface` wears it through `corner-shape`. A rounded `inset()` clip is circular
by definition and cannot follow that shape, and it wins wherever the two disagree, so the
frame script builds a `path()` from the radius, the shape and the window's size and the
body is clipped by it (`--dsh-shell-corner-clip`). An engine that cannot draw a continuous
corner keeps the circular one: `@supports not (corner-shape: superellipse(1.5))` sets the
shape token to `round` and the clip to the rounded inset this window has always worn, so
the fallback is never worse than the window people already have. `scripts/verify-radius-audit.mjs`
measures both branches on the live window.

## Ports

| Purpose | Port |
|---|---|
| Kernel (`dsh web`) | `31760` |
| Shell proxy — the window's origin | `31761` |

Chosen to stay clear of the other DSH installations on this machine (the official
Electron client uses `3080`; `<workspace>\-studio` uses `31750`/`31751`).

## Building and running

```sh
npm run setup          # kernel install + kernel build (long; do once)
cd src-tauri && cargo run
```

There is no frontend to build and no dev server: the window loads the proxy, and the
official client's bundles come from the kernel. `npm run tauri:build` packages the shell.

The kernel is a source checkout, so a fresh clone has no dependencies and no built web
frontend until the setup steps run. The shell reports which is missing instead of failing
to spawn.

A fresh clone also has no kernel checkout: it is a pinned upstream tree plus this project's
patch series, not vendored sources. Fetch the pinned tag and apply the series in order
before `npm run setup`:

```sh
git clone --depth 1 --branch dsh-v0.2.2-alpha.2 https://github.com/deepseek-ai/deepseek-harness.git core/deepseek-harness
cd core/deepseek-harness
git apply ../../docs/kernel-patches/R484-multilevel-team.patch
git apply ../../docs/kernel-patches/R459-page-nav-bridge.patch
git apply ../../docs/kernel-patches/R501-b2-event-window.patch
```

`docs/kernel-patches/README.md` carries the rebase/refresh procedure; `R510-draft.patch`
is an unapplied draft and needs rework against the current base before it is ready.

## Recovery

The kernel boots the whole official web profile, which takes a while on first run. Until
it holds a session the proxy answers the window's root request with its own boot page
(`/__shell/`), which polls `/__shell/status` for the phase, pid, and paths and reloads
into the client once the kernel is ready. If a boot fails, the page shows the failure and
the path to `DSH_HOME/boot.log`, where the kernel's output is mirrored with the launch
token redacted.

## Extending the kernel

`DSH_HOME` holds the kernel's sessions, settings, credentials, skills, and plugin state,
and is seeded on first launch with:

- `dsh-link.patch.yml` — a cordis overlay passed as `--patch`. The loader requires it to
  parse as a **top-level YAML array**, so the seed ends with `[]`; a comment-only document
  parses as `null` and is rejected.
- `settings.yaml` — the kernel's own settings document, hot-reloaded.
- `.agent-presets/` — writable agent-preset root.

The shell also seeds the **profile's own** patch document (`profiles/web/cordis.patch.yml`)
once, with `session-log-deepseek: enabled: false`: the upstream default uploads Session
Log with DeepSeek API requests, and that document is the one the settings form writes, so
seeding it there keeps the switch in Settings → General working. A row the form edits must
not be pinned from `--patch`; see the package-manager note above.

The shipped `web` profile already composes every official plugin, so the overlay starts
empty and exists purely as the supported extension point.

## Theme section: control styles

Settings → **主题 / Theme** carries **控件风格 / Control style**: the client's own
material, or Apple's Liquid Glass — the iOS 18 → iOS 26 change, applied to controls
rather than to the interface. Switching is one attribute on `<html>`, one
stylesheet, and no reload; switching back removes both.

It arrives as two plugins under `plugins/`, loaded as ordinary profile bundles:

| Package | Half | What it owns |
|---|---|---|
| `dsh-liquid-glass` | browser | the material engine: style registry, the gated stylesheet, the refraction filter |
| `dsh-theme-settings` | Host + browser | the Theme section, and the durable `controlStyle` preference |

Both reach the client only through official extension points — a
`settings.section` registration, the settings document (the entry's `Config`
schema), and CSS keyed on the client's own `data-slot` hooks. Nothing inside the
conversation is restyled and the background stays the client's own near-black; the
only geometry the material changes anywhere is the sidebar column's gutter, which is
what makes the panel read as floating. Glass is never nested inside glass: a control
that sits on a glass surface keeps the client's own treatment.

A surface also owns the ground it sits on. The client paints two of its own layers to
hide content behind surfaces that do not let anything through — the sidebar's list fade
and the composer seat's 36px fade into the page colour — and behind a pane of glass each
of those is content rather than a fade, drawing itself on the glass. Both are replaced
by the material, and the composer's replacement needs one measured fact the stylesheet
cannot express (how far the card's bottom sits above the seat's), which the engine
publishes as `--lg-composer-lip`.

```sh
node plugins/build.mjs --check              # lib/ is not stale
node scripts/verify-theme-section.mjs       # the section, both directions, over CDP
node scripts/probe-refraction.mjs 9222      # the refraction filter bends a backdrop
node scripts/probe-composer-fade.mjs        # the client's fade is not inherited, either palette
```

The refraction is a baked lens map — one canvas, a radial profile, handed to the
filter through `feImage` — ported from the MIT-licensed references rather than
hand-rolled, and `probe-refraction.mjs` is the proof that it bends. Two earlier
versions got this wrong in ways worth remembering: over a flat fill the material
collapses into a grey box, and `feTurbulence`'s alpha noise washes the whole
backdrop out to mid grey unless an `feColorMatrix` forces it opaque.
`plugins/README.md` has the install route, `plugins/dsh-liquid-glass/README.md` the
material's parameters and its five rules, and
`plugins/dsh-liquid-glass/THIRD_PARTY_NOTICES.md` the licence audit and the port
notes.

## Porting the desktop edition's own plugins

The third-party desktop shell this project replaces (`Q:\Program Files\DeepSeek
Harness`, dsh `0.1.5-rc.1`) carried several home-made plugins and agent presets
(`H:\mod`). They are ported verbatim into `plugins/` and mounted through the
`dsh-link-mods` bundle; `plugins/dsh-link-mods/README.md` has the per-plugin
compatibility notes, the install route, and the one `dsh plugin allow-version`
exemption the anti-repeat suite needs.

Two structural changes the port absorbed:

- **Presets became declarations.** 0.1.x discovered presets as
  `.agent-presets/<id>/` directories; 0.2.x dropped directory discovery and
  composes presets from `@deepseek-ai/dsh-agent-preset` declaration rows carried
  by bundle patches. The desktop's two home-made presets (chat-mode,
  minimal-tuned) therefore arrive as declarations in
  `plugins/dsh-link-mods/presets.patch.yml`, their compositions byte-identical
  apart from one relative-path row (`./anchored-lite.mjs` → the
  `dsh-anchored-lite` package).
- **The sandbox hotfix became a plugin.** The desktop patched the shipped
  `@deepseek-ai/dsh-sandbox` lib on every install so a non-widening
  `sandbox_permissions` request runs under the effective mode instead of failing
  the call. This checkout stays unpatched; `dsh-escalation-guard` reproduces the
  semantics at the `tools/execute` seam (the escalation check precedes any tool
  side effect, so catching the marker error and retrying without the field is
  safe).

**Mount state, corrected 2026-10-07.** The four rows above were listed in `dsh-link-mods` with
`disabled: true`, but three of those flags were **dead**: each of those plugins ships its own
bundle patch that inserts the *same id* again without `disabled` and sits later in the bundle
order, and the loader's entry store is id-keyed — the later row replaces the earlier one
(`vendor/loader/src/config/group.ts`, `entry.ts`). Measured, not assumed: the live kernel's
`boot.log` shows lan-bridge's host service starting, and the tool surface is byte-identical
with and without those flags. So agent-context, lan-bridge and delegation-model-choice were
mounted all along; **only `browser` was genuinely disabled** (it has no bundle patch of its
own), and it was enabled on 2026-10-07 with the numbers in
`docs/handoff/R3-enable-rows.md` (tools 6 → 20 at the root layer, 14 of them `browser_*`).
The dead flags and the duplicate rows are gone: every id now appears exactly once in the
composition, so the settings form can address it.

## Verifying

One command runs every gate this project has:

```sh
node scripts/verify-all.mjs           # everything that can run now; a skipped LIVE gate exits non-zero
node scripts/verify-all.mjs --live    # a gate that cannot run is a failure, not a skip
node scripts/verify-all.mjs --allow-skipped-live   # offline-only work: names the skipped live gates and accepts them
node scripts/verify-all.mjs --only compat-table,interconnect
```

It reports each gate as PASS, FAIL or SKIPPED-LIVE, and a gate that could not run is never a
pass. A live gate exits 3 when it declines to measure — a viewport too small to be a
window, for instance — and that maps to SKIPPED-LIVE here. **A skipped live gate is FATAL**:
the tail prints `live: R ran / K skipped of N` with their names and a `policy:` line saying
which flag was in force, and only `--allow-skipped-live` accepts a skip on purpose (`--live`
still wins over it). `exit 0` therefore can no longer coexist with every live gate having
been skipped. The same run also refuses when a
`scripts/verify-*.mjs` exists that the gate list never mentions, because two gates were
written and left unregistered before that check existed.

The gates themselves, each runnable alone:

```sh
node scripts/verify-baseline.mjs      # the kernel is unedited at its locked commit, and archived evidence still hashes to the lock
node scripts/verify-compat-table.mjs  # every capability resolves, translates or refuses as its kernel table declares
node scripts/verify-compat-future.mjs # a synthetic future kernel, described by editing data only
node scripts/verify-interconnect.mjs  # the LAN bridge suites, the grant lattice, the relay cells
node scripts/probe-proxy.mjs   # six checks against a running shell
node scripts/e2e-session.mjs   # create → list → projections → page → prompt → cancel
node scripts/verify-theme-section.mjs  # the Theme section, both directions
node scripts/verify-accept.mjs         # the account menu frame by frame, the corner tokens
node scripts/verify-radius-audit.mjs   # the window's corner, measured in pixels
node scripts/probe-composer-fade.mjs   # the composer's backdrop, over four grounds
pwsh scripts/verify-tray.ps1   # WM_CLOSE must hide the window, not end the process
cd src-tauri && cargo test     # version comparison, asset selection, seeds, bridge parse
```

The bridge is checked against the live page rather than against the proxy's own bytes: run
the shell with `DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=9222`, then

```sh
node scripts/probe-bridge.mjs            # what the page sees: dshDesktop, onboarding, routed opens
node scripts/probe-account.mjs           # the account menu's entries after the shell's policy
node scripts/probe-account.mjs --open-test   # also clicks a blank-target link (opens a browser tab)
```

A served script tag only proves the bytes arrived; this reports what the client's plugins
actually read, including the account entry whose activation depends on the bridge.

`scripts/probe-api.mjs <origin> <token> <endpoint>` talks to the kernel directly, which is
useful for confirming an endpoint contract without the proxy in the way.

Both scripts avoid `fetch` on purpose: its connection pool keeps idle sockets alive, and
Node aborts on Windows while tearing them down at exit, which makes a passing run report
a nonzero exit code. They share `scripts/lib/http.mjs`, which sets `agent: false`.

## Notes for this machine

- Cargo needs `CARGO_HTTP_CHECK_REVOKE=false` here: the configured registry mirror fails
  its certificate-revocation check with `CRYPT_E_REVOCATION_OFFLINE`.
- Do not edit Rust sources through PowerShell's `Set-Content`; it writes ANSI and corrupts
  the UTF-8 comments.
- Set `DSH_HOME` when running the kernel CLI by hand here: several DSH installs on this
  machine each have their own home, and an inherited `DSH_HOME` from another client makes
  `--dump-config` describe that install's profile rather than this one.

## License

The kernel under `core/deepseek-harness` is MIT, © DeepSeek. This project's own sources
are MIT.

**Brand artwork is a separate work.** The DSH Link logo, wordmark and icon plates are not MIT: they are
licensed **CC BY-NC-SA 4.0** in their own repository,
<https://github.com/DreamRealm-Dev/dsh-link-brand>. Copies of that artwork in this repository
(`plugins/dsh-link-brand/assets/`, `src-tauri/icons/` renders, the boot-page mark) stay under that
licence, not MIT. Scope, attribution and trademark rules: [BRAND-ASSETS.md](BRAND-ASSETS.md).