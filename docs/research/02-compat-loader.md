# 02 — The compat loader: prior art, and the architecture we should build

**Chapter decision: build a new loader; adopt nothing.**
Reason: every shipped DSH compatibility layer we found is either (a) an alias table that fails soft,
(b) a gate that blocks or quarantines rather than translates, or (c) a CI repair bot with no runtime
presence. None of them refuses *at load time*, and none of them owns the semantic-change class that
§01 showed is where every real failure lives. One of them — `dsh-loader`, published as
`@dsh-plugin/dsh-loader` — is the right *shape* but the wrong licence and the wrong scope for us.
We build the shape, not the package.

---

## 1. Prior art, on one axis table

Seven axes, fixed across every row, as the brief requires. Every cell in these tables is `[外部]`
with its source URL at the point of use; `NOT ESTABLISHED` means the sources did not support the cell
and nothing was guessed. Citations into **this** repository are tagged `[代码可证]` inline. Research
performed 2026-10-06; download figures are npm's week 2026-09-28 → 2026-10-04.

### 1.1 `dsh-loader` (published as `@dsh-plugin/dsh-loader`)

> Naming hazard, first: the bare name `dsh-loader` is **404 on npm**. The package is
> `@dsh-plugin/dsh-loader` ([registry](https://registry.npmjs.org/@dsh-plugin%2Fdsh-loader),
> [bare name 404](https://registry.npmjs.org/dsh-loader)). `@deepseek-ai/dsh-loader-smoke` is an
> unrelated official test harness.

| Axis | Finding |
|---|---|
| 定位 | A runtime compatibility shim for cordis bundle plugins: a **version-aware adapter registry** decoupling third-party plugins from DSH's internal service names, module paths, package names and RPC details. Audience: plugin authors; the README forbids plugins from declaring any `@deepseek-ai/*` dependency. [source](https://github.com/dsh-plugins/dsh-loader) |
| 机制 | Version probe from `node_modules/@deepseek-ai/dsh/package.json` or `DSHLOADER_DSH_VERSION`, cached in-process, mirrored to the client as `window.__DSHLOADER_VERSION__`; adapter selection = **exact → semver range (narrowest) → nearest-lower fallback with a warning** (`mode:'fallback'`) → `UnsupportedDshVersionError`. Adapters register service aliases (`ctx.reflect.provide` / `ctx.effect`), module hooks (host `Module._resolveFilename`; client `__ModuleLoader__.load` wrapper) and a client settings-RPC fetch interceptor. Stable facades `ctx.dshLoader.{settings,web,services}`, `window.__dshLoader__`, plus subpaths `@dsh-plugin/dsh-loader/{tools,llm,agent,settings,ui-primitives,…}`. Only one host adapter ships: `src/adapters/dsh-1-x.ts`. [design.md](https://github.com/dsh-plugins/dsh-loader/blob/main/docs/design.md) |
| 覆盖哪类破坏 | Service **rename** (`httpServer`→`webServer`; old injects hang forever), removal of deep `src` imports (`@deepseek-ai/dsh-client-runtime/src/…`), client UI package renames, and a hard-coded settings-namespace whitelist in `dsh-host-apiproxy`. **RPC envelope conversion is designed-for, but design.md states there is no evidence it ever differs** → not a covered case. |
| 失败模式 | **Fail-loud at boot**: an unsupported version throws `UnsupportedDshVersionError` and profile load fails, with distinct "too new" vs "too old" messages. Alias conflicts guarded by `ctx.get(from)===undefined`; the client fetch interceptor is whitelisted and `try/catch`es to `originalFetch`. Documented residual risk: plugins that still hardcode `@deepseek-ai/*` break. |
| 性能模型 | **NOT ESTABLISHED as measured.** Architectural: the version probe is cached; probing via a child-process `dsh --version` was deliberately rejected (startup latency, re-entrancy); the client bundle is preloaded at the `immediately` tier; cost = one resolve hook per `require` plus a facade/proxy hop per call. **No benchmarks published.** |
| 维护成本 | Loader maintainers add or update one adapter per DSH rename; plugin authors change nothing; adapters are keyed by semver range per DSH major. High cadence: **22 versions between 2026-08-19 and 2026-09-07** (many `-dev.<runid>`). |
| 许可 | **LGPL-3.0-only** ([npm manifest](https://registry.npmjs.org/@dsh-plugin%2Fdsh-loader)). GitHub's classifier reports NOASSERTION. |

Version table: partial — a subpath→real-package table labelled "dsh 1.x" (10 rows) plus design.md's
five selection rules; with a single `dsh-1-x` adapter, the fallback rule *is* the version policy.
Last publish 2026-09-07 (1.3.5); **405 downloads/week**; https://github.com/dsh-plugins/dsh-loader.

### 1.2 `@lanbaolu/dsh-compat`

| Axis | Finding |
|---|---|
| 定位 | "COMPAT 版本兼容层", the lightest tier: service-key and package-name renames get an alias fallback — explicitly "rename, no semantic translation", best-effort — and anything it cannot fake goes to a separate fail-soft isolation layer. Audience: the lanbaolu ecosystem (a marketplace plus a COMPAT badge and a `verify-plugin --compat` classification). [source](https://github.com/lanbaolu/dsh-compat) |
| 机制 | A data-driven `compat-registry.json` — `meta.forDSH`, `serviceAliases: {newKey: [oldKeys]}`, `packageAliases`, `reshape` — drives `applyServiceAliases()` → `ctx.provide(oldKey, lazyProxy)`; the Proxy resolves `ctx.get(newKey)` at **every member access** and binds functions; the `has` trap mirrors membership; idempotent; never throws. Package rewrites are declared in the registry and executed through an npm alias. A `compat_status` tool reports target DSH version, applied aliases and reshape count. [compat-registry.json](https://github.com/lanbaolu/dsh-compat/blob/main/compat-registry.json), [lib/compat.js](https://github.com/lanbaolu/dsh-compat/blob/main/lib/compat.js) |
| 覆盖哪类破坏 | Service renames (`httpServer`→`webServer`, `workspace`→`workspaceRegistry`, `compact`→`compaction`) and package **relocation** (`@deepseek-ai/dsh-host-webserver`→`dsh-web-server`). Explicitly out: semantic and behavioural translation, and cross-major backfill. The `reshape` table exists but is **empty in 0.1.0**. No DOM/CSS or client-module-contract coverage. |
| 失败模式 | **Fail-soft, which means no-op.** If the new service is not ready, member access returns `undefined` — no throw — and the old plugin fails on its own into the fail-soft layer; alias-application errors go to a `failed[]` list plus warnings, and boot continues. Documented risk: `undefined` defers the failure to first real use, and nothing is corrected semantically. |
| 性能模型 | **NOT ESTABLISHED as measured.** From source: one Proxy per alias; each member access = `ctx.get(newKey)` plus `Function.bind` with no memoisation visible; load cost = a few `provide` calls. |
| 维护成本 | The maintainer edits `compat-registry.json` per DSH release (`meta.forDSH = 0.1.0-rc.6`, updated 2026-08-20); adopters must opt into the badge and the compliance check. Codebase: `compat.js` 3.6 KB plus `index.js` 2.1 KB. |
| 许可 | MIT ([npm manifest](https://registry.npmjs.org/@lanbaolu%2Fdsh-compat)); **no LICENSE file** in the fetched repo-root listing. |

Version table: **yes — `compat-registry.json` *is* the table**, fetched verbatim (forDSH
0.1.0-rc.6; three service aliases; one package alias; empty `reshape`). Last publish 2026-08-20
(0.1.1, two versions total); **6 downloads/week**.

### 1.3 `dsh-compat-guard`

| Axis | Finding |
|---|---|
| 定位 | Compatibility **governance**, not a loader: upgrade pre-flight gate, storage-format fingerprint, `$DSH_HOME` backup, session migration, per-profile lockfile with rollback, and a machine-readable plugin × DSH compatibility matrix. Audience: teams and profiles. [source](https://github.com/Shizuku-keop/dsh-compat-guard) |
| 机制 | A standalone `dsh-guard` CLI plus wrapper discipline (`alias dsh='dsh-guard dsh'`) — because, per the author's source reading, `dsh plugin` is a thin pnpm forwarder with **no pre-hook**. The only in-tree part is a passive `guard-drift` row recording the DSH version to `$DSH_HOME/.guard-state.json` and warning about ungated upgrades (all `try/catch`, never fail-loud). Checks: plugin compatibility from a registry `compat.json` or author metadata `dsh.compat.{requires,tested}`; storage format by magic-byte fingerprint (zstd `28 B5 2F FD`, or sqlite) plus `session_projcache.json`'s `unit.version`; the matrix is generated in CI against an isolated `DSH_HOME` with a `--dump-config` boot smoke. |
| 覆盖哪类破坏 | Version and requirement gating, and **storage/format breaking changes** (it cites the rc.8 session-loss incident), sqlite→zstd-JSONL data migration, and dependency or content drift (sha256 of the plugin `package.json`). **It never renames an API or shims behaviour — it blocks or rolls back.** |
| 失败模式 | Exit 1 = BLOCKED, exit 2 = warnings for the wrapped CLI — but the gate is **advisory**: there is no launcher hook, and the in-tree probe only warns *after* an ungated upgrade has happened. Unknown storage format → warn, never silently convert; untested plugin → warning, not a block; unknown session-JSONL schema → warn. |
| 性能模型 | **NOT ESTABLISHED as measured.** Node 20 or newer, zero runtime dependencies, no boot-path work beyond the passive record; migration and backup are I/O-bound; matrix cost is CI-side (install plus boot per plugin × DSH cell). No runtime per-call claims. |
| 维护成本 | High curation: `lib/formats.json` is acknowledged seed data (only 0.1.1-rc.2 measured locally); the registry carries `storageFormats` per version; `compat.json` is regenerated per DSH release and per plugin, hosted at [Shizuku-keop/Blue-Whale-Harness](https://cdn.jsdelivr.net/gh/Shizuku-keop/Blue-Whale-Harness@main/compat/compat.json) behind jsDelivr with GitHub-API and local-cache fallbacks. |
| 许可 | MIT ([npm manifest](https://registry.npmjs.org/dsh-compat-guard), README). No `repository` field on npm; the GitHub repo is MIT, 0 stars, created and pushed 2026-08-25. |

Version table: **the strongest of the set** — per-version storage facts plus a published first-run
matrix (2 plugins × 4 DSH versions, 8/8 pass, 2026-08-25), with the caveat that rc.8 storage is still
"unknown". Last publish 2026-08-25 (0.1.0, one version); **10 downloads/week**.

### 1.4 `dsh-plugin-compat-guardian`

> Naming hazard, second, and this one is real: the **npm** package `dsh-compat-guardian` is a
> *different project* from the GitHub repo `LCYLYM/dsh-plugin-compat-guardian`. The GitHub one has
> **no npm package at all** ([404](https://registry.npmjs.org/dsh-plugin-compat-guardian)). Both are
> tabulated below, because conflating them would misstate both.

| Axis | Finding — `LCYLYM/dsh-plugin-compat-guardian` |
|---|---|
| 定位 | A repository-installed **CI repair bot**: a new DSH release triggers an isolated install and boot; if a verified regression exists it repairs with DSH, then an independent verify, then a merge-ready PR. It **never loads into a DSH profile**. Audience: plugin-repo maintainers. [source](https://github.com/LCYLYM/dsh-plugin-compat-guardian) |
| 机制 | An onboarding PR installs a GitHub Actions workflow pinned by an immutable 40-character SHA (`npm exec --package=github:LCYLYM/dsh-plugin-compat-guardian#<sha> -- … onboard`). The no-key verifier pins the DSH version, npm integrity and dependency graph, builds and tests, packs the plugin, installs into an isolated `DSH_HOME`, checks `--dump-config`, boots a real `dsh web`, runs a reviewed smoke assertion, then removes the plugin and checks for residue. A budgeted DeepSeek repair agent runs **only** when a trusted baseline passed and the candidate failed (repair DSH pinned to 0.1.1-rc.2; 1M tokens, about 10 CNY, 60 minutes, 2 attempts per repo+version campaign), then an independent verifier, then a PR (default) or auto-merge or direct push. [README.en.md](https://github.com/LCYLYM/dsh-plugin-compat-guardian/blob/main/README.en.md) |
| 覆盖哪类破坏 | Whatever the plugin's own reviewed smoke contract detects on a new DSH (install, build, boot, behaviour), with automated code repair. **No runtime compatibility coverage** — no shim, no alias table. |
| 失败模式 | Explicit terminal states: `ONBOARDING_BLOCKED` (no trusted baseline, no model call), `WAITING_FOR_NPM_ARTIFACT`, `WAITING_FOR_GITHUB_APPROVAL`, and `FROZEN` (still failing, or out of budget until a budget reset). Human review is forced for changes to tests, test commands, lifecycle scripts, and dependency majors/adds/removals; control files and credentials are protected from the repair agent. |
| 性能模型 | No runtime presence, so no per-call cost. Cost = CI minutes plus model tokens per campaign. A plugin that already passes gets a **no-model** verification. |
| 维护成本 | The maintainer updates the pinned Guardian ref and config plus the per-plugin smoke contract; each target DSH version gets exactly one automatic repair campaign; candidate discovery follows official `dsh-v*` releases, prereleases included. [failure-matrix.md](https://github.com/LCYLYM/dsh-plugin-compat-guardian/blob/main/docs/failure-matrix.md) |
| 许可 | MIT ([GitHub API](https://api.github.com/repos/LCYLYM/dsh-plugin-compat-guardian), README badge). |

Version table: none. It **pins** versions (candidate by release tag, commit SHA and npm integrity;
repair DSH pinned by default) and documents a *failure-coverage* matrix. Repo: 1 star, created
2026-08-22, last push 2026-09-04; git install only.

**And the other one, for the record** — npm `dsh-compat-guardian` (repo
[Han-1413141/dsh-compat-guardian](https://github.com/Han-1413141/dsh-compat-guardian), MIT, 0.2.1
published 2026-09-30, **518 downloads/week**): an in-tree checker plus a quarantine/recovery plugin
with a Web sidebar and a CLI usable when DSH will not boot. It reads plugin-declared metadata
`dshCompat` (DSH range, capabilities, requires and conflicts, exclusive services and tools,
permissions, platforms, priority — explicitly *not* an official standard), checks
version/Node/platform requirements, the dependency and conflict graph, duplicate top-level insert
ids, globally exclusive tools and services, and consecutive real-Loader load failures; it then
disables conflicting bundles (quarantine, the default) or removes them, with backups and atomic
locked writes. **Fail-safe quarantine instead of repair**; documented gaps: undeclared conflicts
cannot be found statically, it cannot intercept `process.exit()`, native crashes, or an early-exit
host (use the offline CLI), and a refused uninstall keeps the quarantine and retries next boot. 30 s
background check with a 2-failure debounce ([npm](https://registry.npmjs.org/dsh-compat-guardian)).

### 1.5 `@rvaim/dsh-compat` — the only true semantic translator found

| Axis | Finding |
|---|---|
| 定位 | A **foreign-ecosystem** compat layer: run Claude Code and Codex legacy plugins inside DSH as whole lifecycle units, keeping the original layout and semantics. Audience: users with existing Claude Code or Codex plugin collections. [source](https://github.com/rvaim/dsh-compat) |
| 机制 | A Source/Plugin model — parsers read Claude Code `.claude-plugin/marketplace.json` or Codex `.agents/plugins/marketplace.json` (or a single plugin, git, local dir, zip), convert Skill, MCP and Hook semantics into one unified structure, and adapters map them onto the DSH Skill Provider, `dsh-mcp-client` and the Hook protocol, with one parent cordis instance per plugin; a `ctx.compat.*` lifecycle API plus a Web settings page. |
| 覆盖哪类破坏 | Cross-harness **semantic** differences (frontmatter, hook event mapping, timeouts, stdout and exit-code merging, MCP stdio and streamable-http) plus atomic multi-plugin install with rollback. Unreliable capabilities produce structured error/warning/info diagnostics instead of silent coercion. |
| 失败模式 | Install and enable are separated; a static error keeps the record but blocks enable; name conflicts are diagnosed and never auto-renamed; **a failed plugin aborts the whole atomic batch.** |
| 性能模型 | **NOT ESTABLISHED** (one cordis instance per plugin implies a cost; unquantified). |
| 维护成本 | Targets DSH 0.1.0-rc.6 with Plugin parser 2.0.1 and Source parser 2.0.0 — the parsers must track DSH **and** two foreign formats; Node `^22.19` or `>=24`. |
| 许可 | MIT ([npm manifest](https://registry.npmjs.org/@rvaim%2Fdsh-compat)). |

Version table: states the target DSH plus parser versions; no matrix. 0.4.4 published 2026-08-15 (two
versions); **80 downloads/week**.

### 1.6 Anything better — the short list

| Package | Why it is worth a line | License and traction |
|---|---|---|
| `dsh-compat` 0.0.1 | A compat **matrix** plugin; its `compat_report` tool returns a built-in DSH rc-series breaking-change cheat sheet. Roadmap: manifest plus CLI query, smoke-mount probing, upgrade-path advice. [npm](https://registry.npmjs.org/dsh-compat) | MIT, 2026-08-20, 21 dl/wk |
| `dsh-bundle-dedup-guard` 0.1.0 | Guards the loader's "duplicate loader entry id" boot crash by replicating the `cordis-plugin-include` patch flattening and `EntryGroup.update` dedup in pure Node; a standalone CLI that works after a boot crash. [source](https://github.com/Lstalu/dsh-bundle-dedup-guard) | MIT, 2026-08-18, 33 dl/wk |
| `dsh-gpt-compat` 0.2.3 | **Fail-closed behavioural** compat: strips provably redundant `sandbox_permissions` and `justification` args from GPT and Codex calls, whitelisted by provider, tool and schema. This is the closest prior art to our B5. [source](https://github.com/YaoaY/dsh-gpt-compat) | MIT, 2026-08-21, 40 dl/wk |
| `dsh-model-compat-guard` | Reasoning-model compaction truncation, doomed sandbox-escalation fail-close, missing tool descriptions for GPT and Qwen. | MIT, pushed 2026-09-08 |
| `dsh-my-guardian` 0.4.4 | Staged loading: new or updated plugins hot-mount as candidates; success promotes, failure auto-disables, repeated failures freeze. | MIT, 2026-09-25, **1242 dl/wk** |
| `dsh-plugin-guard` 0.1.1 | Isolates broken user plugins inside the official web client so the UI stays up. [source](https://github.com/wuwei6666/dsh-pluginGuard) | MIT, 2026-09-04, 137 dl/wk |
| `@linxin666/dsh-skins` 0.2.9 | Not a loader, but a **package-rename compat vehicle**: "retired compatibility vehicle kept for one release cycle" that carries its successor through the dependency graph. Its sibling `@linxin666/dsh-web-all` has **28,511 dl/wk**, the highest here, and lists a "compat shim" child whose exact package is **NOT ESTABLISHED**. | MIT |
| `dsh-upstream-fixes` | Cited in dsh-loader's design.md as the precedent for the settings-whitelist RPC fix. No npm package (404) and the GitHub repo is unreachable through the API, so it is unpublished or private. | **NOT ESTABLISHED** |

### 1.7 What the prior art says, taken as a whole

**`[外部]` Six architectural families exist, and none of them is ours.**

1. **Runtime adapter registry** — `@dsh-plugin/dsh-loader`. Version probe, adapter, aliases, module
   hooks. Fail-loud. The right shape.
2. **Alias-table fallback** — `@lanbaolu/dsh-compat`. A JSON table plus a lazy Proxy. Fail-soft.
3. **Gate, quarantine and rollback** — `dsh-compat-guard`, npm `dsh-compat-guardian`,
   `dsh-my-guardian`, `dsh-bundle-dedup-guard`, `dsh-plugin-guard`. They block, isolate or revert;
   they never translate.
4. **CI detection plus AI repair** — `LCYLYM/dsh-plugin-compat-guardian`. No runtime presence.
5. **Foreign-ecosystem bridging** — `@rvaim/dsh-compat`. Genuinely semantic, but for Claude Code and
   Codex inputs, not for DSH's own breaking changes.
6. **Behavioural argument stripping** — `dsh-gpt-compat`, `dsh-model-compat-guard`. Narrow,
   whitelisted, fail-closed. The pattern our own `dsh-escalation-guard` already follows.

Three findings shape our design:

> **`[外部]` Only `dsh-loader` offers a stable API that plugins are *told* to depend on.** Every other
> layer patches a host table, gates a launch, or quarantines after the fact. If our capability
> vocabulary is to be a contract rather than an internal detail, we are choosing the road less
> travelled, and must therefore make the refusal path a first-class part of the surface rather than
> an error case bolted on.
>
> **`[外部]` Documented version tables exist in exactly three places** — dsh-loader's subpath table
> (dsh 1.x, one adapter), lanbaolu's `compat-registry.json`, and dsh-compat-guard's CI `compat.json`
> plus `storageFormats` — **and none of them spans more than one DSH major.** Our table is per-kernel
> (`compat/table/<kernel>.ts`), which is a *different* keying: it names the kernel rather than a
> range, and it is the only structure that can express "this kernel, this capability, resolved or
> refused".
>
> **`[外部]` No package publishes measured performance data.** Every 性能模型 cell above is
> architectural. That is a standing gap in the ecosystem, and our acceptance test should close it for
> our own layer rather than inherit it.

---

## 2. The architecture

The approved shape, restated as an implementable specification. Nothing here is a menu.

### 2.1 The contract: a capability vocabulary, and nothing else

A plugin never names a DSH internal. It names a **capability**. The vocabulary is closed and small;
each name is one string, and that string is the *only* thing we promise to keep stable across
kernels.

| Capability | Kind of thing | Pass-through target on `dsh-v0.2.1-alpha.1` |
|---|---|---|
| `sessions` | service | `ctx.sessions` |
| `tools.register` | service | `ctx.tools` |
| `settings.define` | facade | the volatile-field form (§01 B4) |
| `slots.register` | service | `ctx.slots` |
| `subagents.children` | rename | `listChildren` returns `kind` → `mode` (§01 B3) |
| `presets.declare` | relocation | `@deepseek-ai/dsh-agent-preset` rows (§01 B1) |
| `repeat.interceptionTable` | relocation | mount row `config` (§01 B6) |
| `client.menuSurface` | DOM hook | `[role="menu"], [data-menu-material]` (§01 B7) |
| `client.cornerShape` | DOM probe | computed `corner-shape` (§01 B8) |
| `module.loader` | client contract | `window.__ModuleLoader__.load({id, factory})` (§01 B9) |

**Ten names. That is the whole plugin-facing surface.** Adding an eleventh is a reviewed change to
this table, not an implementation detail — which is what makes the refusal path honest: a plugin that
asks for a name not in the table is asking for something we never promised.

Three capabilities are deliberately **absent**, and their absence is the design:

- `sandbox.escalation` — §01 B5. A semantic change; refuse, and route to the `tools/execute` wrapper
  the repo already ships — `[代码可证]` `plugins/dsh-escalation-guard/lib/index.js:41-57`.
- `session.turnTail` — §01 B2. A slot *kind* change; refuse, with both kinds in the message.
- `plugin.peerRange` — §01 B10. Refuse, and require the explicit human exemption.

### 2.2 The table

`compat/table/<kernel>.ts` — one file per kernel, keyed by the kernel identity the repo already uses
— `[代码可证]` `README.md:9`. No ranges, no nearest-lower fallback:

```ts
// compat/table/dsh-v0.2.1-alpha.1.ts
import type { CompatTable } from '../types.ts'

export const table: CompatTable = {
  kernel: 'dsh-v0.2.1-alpha.1',
  commit: '5badb15',
  capabilities: {
    sessions:                   { kind: 'passthrough', service: 'sessions' },
    'tools.register':           { kind: 'passthrough', service: 'tools' },
    'slots.register':           { kind: 'passthrough', service: 'slots' },
    'subagents.children':       { kind: 'rename', from: 'kind', to: 'mode' },
    'presets.declare':          { kind: 'relocation', from: 'directory', to: 'declarationRow' },
    'repeat.interceptionTable': { kind: 'relocation', from: 'settingsKey', to: 'rowConfig' },
    'settings.define':          { kind: 'facade', facade: 'settings' },
    'client.menuSurface':       { kind: 'domHook',
                                  selector: '[role="menu"], [data-menu-material]' },
    'client.cornerShape':       { kind: 'domProbe', read: 'cornerShape', fallback: 2 },
    'module.loader':            { kind: 'clientContract', queue: true },
  },
  refused: {
    'sandbox.escalation': {
      reason: 'the same field changes behaviour between kernels',
      suggestion: 'wrap tools/execute; see plugins/dsh-escalation-guard',
    },
    'session.turnTail': {
      reason: 'chain on 0.1.5, list on 0.2.x - the kind decides the registration contract',
      suggestion: 'register with both id and select',
    },
    'plugin.peerRange': {
      reason: 'a declared peer range is a claim, not a fact',
      suggestion: 'run dsh plugin allow-version <pkg>@<ver> explicitly',
    },
  },
}
```

**Two invariants the table's own type must enforce** — these are the load-time checks that make
§01's refusal rule mechanical:

1. **A `capabilities` row may not carry behaviour.** The row kinds are exactly
   `passthrough | rename | relocation | facade | domHook | domProbe | clientContract`. There is no
   field in which a caller could write "and also retry", "and also drop the field", or "and also read
   the computed style" — so the semantic changes of §01 are *unrepresentable*, not merely
   discouraged.
2. **A row key must be one of the ten names, and a name appears in `capabilities` or in `refused`,
   never both.** A table that puts a name in both fails at load. A test asserts this.

### 2.3 Ordering — the whole load sequence, in order

This is the part an implementer must not have to invent.

```
 1. Kernel identity is established (version and commit) from the resolved kernel package.json.
 2. compat/table/<kernel>.ts is imported for that identity.
      -> no file for that kernel: UnsupportedError{capability:'*', kernelVersion,
         reason:'no table for this kernel'}
 3. The table is validated against the two invariants above. A failure here is a build error,
    never a runtime surprise.
 4. The loader resolves the capability set each registered plugin declared, at load time,
    BEFORE any plugin apply() runs:
        a. passthrough       -> resolve the service once, cache the live reference, hand it over
        b. rename/relocation -> build the shim once, cache it, hand the shim over
        c. facade            -> construct the facade's three members (section 2.4), cache them
        d. domHook / domProbe / clientContract -> register the client-side descriptor
        e. refused           -> throw UnsupportedError, which fails that plugin's row
 5. Plugin apply() runs, against resolved references only. No plugin ever sees this loader again.
```

**Two ordering rules carry the design:**

- **Resolution precedes `apply`, unconditionally.** A plugin cannot begin work and *then* discover
  that its capability was refused — that is how §01's silent failures happen. A refused row is inert
  before its first line of code runs.
- **Resolution is once per process, at load.** A resolved reference is a direct object, not a proxy.
  This is where we deliberately diverge from `@lanbaolu/dsh-compat`, whose every member access
  re-resolves `ctx.get(newKey)` with no memoisation
  ([lib/compat.js](https://github.com/lanbaolu/dsh-compat/blob/main/lib/compat.js)) — a cost we would
  pay per model tool call, in the hottest path in the system, to buy a fallback we do not want.

### 2.4 Two interfaces, and when a plugin must use each

**Interface A — pass-through. `services.get(name)`.**

Returns the kernel's own service object, resolved once at load and cached. **Zero wrapper overhead per
call.** The plugin then owns compatibility with that kernel, including the right to break later. Use
this when the plugin needs control the facade does not expose: streaming, cancellation signals,
transcripts, tool metadata, per-session addressing.

```ts
const sessions = compat.services.get('sessions')   // the live ctx.sessions, or it throws
```

**Interface B — the simplified facade.** A deliberate, documented, lossy surface. Three members, and
no fourth without a reviewed change:

```ts
// session.getRecentMessages - the read shape most plugins actually want
await compat.session.getRecentMessages(sessionId, { limit })
//   -> readonly { role, text, seq }[]   (no attempt/stream/tool plumbing)

// tools.registerSimple - name, schema and one async handler, nothing else
compat.tools.registerSimple({ name, description, schema, execute })

// settings.define - declares volatility itself, which is the whole point
compat.settings.define({ namespace, fields: [{ name, schema, default }] })
//   -> every field is registered volatile() on the owning row (§01 B4)
```

`settings.define` is the single most valuable member, and the reason the facade exists at all. §01 B4
showed that "the field is in the schema" and "the field can be written at runtime" stopped being the
same statement, that the failure is a *silent* no-op, and that the fix is a declaration on the Host
schema the plugin author has no reason to know about. **A facade that cannot forget volatility
removes an entire class of failure from every future plugin.**

**The rule between them, stated so it can be enforced:** a plugin that uses Interface A for a
capability it could have used Interface B for is not wrong — it is opting out of the guarantee. The
loader records which interface each plugin used, per capability, and reports it; the choice is then
visible in review instead of inferable from behaviour.

### 2.5 Two halves

**Host half — cordis.** The loader is an ordinary profile bundle row. Its work is §2.3 steps 1-5.
Nothing about it is client-aware, and nothing about it touches the kernel checkout — `[代码可证]`
`README.md:37`.

**Client half — the module loader plus DOM hooks.** The client half must be *inside* the served
bundle, because the load queue is closed before it opens: the facade's `create()` refuses to run
twice, and registration is a queue drain
— `[代码可证]` `core/deepseek-harness/packages/client/modules/src/index.ts:556-575` — so an after-the-fact injection
has nowhere to register. Our emitter already produces exactly the right artifact shape —
`window.__ModuleLoader__.load({ id, factory: (require) => { … } })` — `[代码可证]` `plugins/build.mjs:79-82`.

The client half owns every capability whose subject is the page, and it owns them as **probes, not
constants**:

| Capability | Client-side implementation | Why not a constant |
|---|---|---|
| `client.menuSurface` | `[role="menu"], [data-menu-material]` | The hash suffix in `_material_<hash>_<n>` is regenerated every build; `data-menu-material` is hand-written and stable (`packages/client/ui-primitives/src/MenuSurface.tsx:35`). A recorded hash must be rejected at table-load time. |
| `client.cornerShape` | read the computed `corner-shape`, default `2` | §01 B8: the same `border-radius` draws a superellipse on one kernel and a circle on another, and `corner-shape` is not inherited (`core/deepseek-harness/docs/ui-radius.md:52`). |
| `module.loader` | assert the queue facade exists; refuse if absent | `[代码可证]` `modules/src/index.ts:556-575`; a duplicate `id` throws (`modules/tests/loader.client.spec.ts:583-584`). |

### 2.6 The refusal

One error type, four fields, thrown only from load-time resolution:

```ts
export class UnsupportedError extends Error {
  readonly capability: string      // the name the plugin asked for
  readonly kernelVersion: string   // 'dsh-v0.2.1-alpha.1'
  readonly reason: string          // from the table's refused block
  readonly suggestion: string      // the concrete alternative, from the same block
}
```

**Refusal semantics, fixed:**

- It **fails the row**, not the process. Other rows load. A refused plugin is inert.
- It is thrown **before** `apply`, so no partial side effect exists to clean up (§2.3).
- It **never degrades.** There is no "warn and continue" path: §01 showed that the warning-shaped
  outcome — a fallback, a no-op, a silently dropped tool — is precisely the outcome that costs a
  session to find.
- The message names the capability, the kernel, the reason and the suggestion, so the fix is a
  decision the reader can take without reading this loader's source.

---

## 3. Acceptance

Two tests carry the chapter. Both are specified so they can be written without further questions.

### 3.1 The version-matrix probe — the acceptance test

A script, `scripts/probe-compat-matrix.mjs`, that boots **every kernel in `compat/table/`** against a
**fixed reference plugin set**, and asserts the *outcome matrix* rather than any single behaviour.
This is the ecosystem's standing gap (§1.7: no package publishes a matrix or a measurement), and it
is the one artifact that makes a per-kernel table maintainable.

**Inputs.** A reference plugin set of exactly one plugin per outcome class:

| Reference plugin | Declares | Expected outcome per kernel |
|---|---|---|
| `ref-passthrough` | `sessions` | resolves; a live `session/list` read succeeds and returns `items` |
| `ref-rename` | `subagents.children` | on `dsh-v0.2.1-alpha.1` the child rows survive the `kind`→`mode` translation; row count greater than zero |
| `ref-relocation` | `repeat.interceptionTable` | on `dsh-v0.2.1-alpha.1` the table arrives in the row `config`; byte-compare against the source fragment |
| `ref-facade` | `settings.define` | the written field is readable after a restart **and** the entry is writable through the settings form |
| `ref-refused` | `sandbox.escalation` | `UnsupportedError` with a non-empty `suggestion`; **the row is inert and every other row still loads** |
| `ref-unknown` | a name not in the vocabulary | `UnsupportedError` naming that capability — see §3.2 |

**Assertions, per cell:**

1. The row's final state is exactly the expected one: `active` or `refused`.
2. A refused row produced **zero** side effects: no tool registered, no service provided, no settings
   write. Assert by diffing the tool catalog and the settings document before and after.
3. A refused row did **not** prevent any other row from loading.
4. The error, when expected, is an `UnsupportedError` carrying all four fields, and `reason` and
   `suggestion` are non-empty strings.
5. Timing is recorded per cell — wall clock from process start to the row's terminal state — and
   written to `.tmp/compat-matrix.json`. This closes the 性能模型 gap the prior art leaves open
   (§1.7). **No threshold is asserted**: the matrix *reports* the number so a regression is visible in
   a diff, because a threshold chosen before the first measurement is a guess.

**Acceptance bar for §3.1:** a full matrix with **zero unexpected cells**; a `.tmp/compat-matrix.json`
covering every kernel × reference-plugin cell; and `exit 0`. A matrix with a *missing* cell is a
failure, not a skip — a kernel with no reference-plugin result has not been tested.

### 3.2 The fake-capability test — a capability must be *provable*, not *faked*

The point of the loader is that a resolved capability is real. A loader that can be satisfied by a
plugin's own claim is worse than no loader, because it launders the claim into a guarantee. The test
has four parts, and all of them must pass.

**Part 1 — an unknown name is refused, not ignored.**

> A plugin declares `capability: 'sessions.definitelyNotAThing'`. Expected: `UnsupportedError` naming
> that capability. **Not** a no-op, **not** a warning, **not** `undefined`. A loader that silently
> accepts an unknown name has a naming convention, not a vocabulary.

**Part 2 — a known name on a kernel where its service does not exist is refused, not proxied.**

> `ref-passthrough` declares `sessions` while the `sessions` service is absent (start the boot with
> that provider disabled). Expected: `UnsupportedError` at load. This is the test
> **`@lanbaolu/dsh-compat` fails by construction** — its Proxy returns `undefined` and defers the
> failure to first use (§1.2) — and it is the single clearest line between a table and a promise.

**Part 3 — a table entry that points at nothing fails at table-load, before any kernel boots.**

> A fixture table whose `passthrough` row names a service the kernel does not provide, or whose
> `rename` row names a `to` key absent from the referenced source, must fail validation in §2.3 step
> 3 — as a build error. A stale table is a bug in *our* repo and should never reach a user's boot.

**Part 4 — the negation, so the test can fail.** A control run with a *correct* table and a *correct*
plugin must pass all of the above with no `UnsupportedError` anywhere. A suite that cannot fail proves
nothing; `docs/eac-pitfalls.md:63` records exactly this failure in the predecessor shell's own probe
("该探针从写下那天起就没真正测过它要防的回归").

**Acceptance bar for §3.2:** parts 1-4 green, and part 1's assertion written against the *error type
and its fields*, not against a log line.

---

## 4. What we adopt from the prior art, and what we do not

**Adopted:**

| From | What | Where it lands |
|---|---|---|
| `@dsh-plugin/dsh-loader` | Fail-loud at boot; a capability vocabulary as the plugin-facing contract; a stable facade in place of raw internals; the explicit decision *not* to probe with a child process | §2.1, §2.4, §2.6 |
| `@dsh-plugin/dsh-loader` | Version detection cached in-process and mirrored to the client | §2.5 |
| `@lanbaolu/dsh-compat` | The table *is* the artifact — a data file a maintainer edits per release | §2.2 |
| `dsh-compat-guard` | A generated, published compatibility matrix as the deliverable of a version bump | §3.1 |
| `LCYLYM/dsh-plugin-compat-guardian` | A pinned reference-plugin set, and a budgeted, no-model-on-success verification | §3.1 |
| `dsh-gpt-compat`, and our own `dsh-escalation-guard` | Behavioural fixes belong in a whitelisted, fail-closed wrapper at a named seam — never in a table | §2.1's three deliberate absences |

**Rejected, with the reason:**

| Not adopted | Why |
|---|---|
| `@dsh-plugin/dsh-loader` as a dependency | **LGPL-3.0-only** against this project's MIT — `[代码可证]` `README.md:392-395` — plus a scope far larger than ours: it targets arbitrary third-party plugins across a whole DSH major, while we need one kernel family. Reimplementing the shape costs less than adopting the licence and the surface. |
| `@lanbaolu/dsh-compat`'s fail-soft Proxy | Returns `undefined` on failure and re-resolves per member access. It converts a load-time error into a first-use error and pays a proxy hop in the hottest path (§2.3). |
| Gate, quarantine and rollback layers | They are the right answer to a *different* question: how to keep a shell booting with a bad plugin installed. §01's failures were all *silent*, so a gate that only sees boot failures cannot see them. |
| Nearest-lower fallback adapters (`mode:'fallback'`) | A kernel-version guess. Our table is keyed by exact kernel identity; an unknown kernel gets "no table", which is a refusal with a fix, not a fallback with a warning. |
| CI-repair delegation | Out of scope and premature: it needs a stable acceptance bar before it can repair toward one. §3.1 is that bar; a repair bot is a later decision. |

---

## 5. Things this chapter could not establish

- **No measured performance figure exists for any prior-art layer.** Every 性能模型 cell in §1 is
  architectural, and the ecosystem has no published matrix. §3.1 is written to produce ours; until it
  has run, this chapter states no performance number for our loader either.
- **dsh-loader's actual adapter contents were not read.** The classification of what it covers rests
  on its README and `docs/design.md`, not on `src/adapters/dsh-1-x.ts`. Its `mode:'fallback'`
  behaviour and its service-alias list are therefore taken from its own prose.
- **`LCYLYM/dsh-plugin-compat-guardian` has never published to npm** and was read from GitHub only;
  whether it is in use anywhere is **NOT ESTABLISHED**. Its star and download situation is recorded
  rather than characterised.
- **The two `dsh-compat-guardian` projects could not be fully disambiguated.** They share no code and
  no repository; the npm one has the traction (518 dl/wk) while the GitHub one has none, and the
  listing sites that mention both are snippets, not primary sources.
- **dsh-loader's download figure (405/wk) and `@linxin666/dsh-web-all`'s (28,511/wk) are not
  comparable**: one is a compat layer, the other a mega-bundle. No download figure here should be read
  as a measure of a compat layer's reliability.
- **The `@linxin666/dsh-web-all` "compat shim" child package is NOT ESTABLISHED** — the aggregate
  lists one, and the exact name was not resolvable from the fetched pages.
