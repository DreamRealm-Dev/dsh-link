# 01 — The upgrade surface: what actually broke between 0.1.5-era and `dsh-v0.2.1-alpha.1`

**Chapter decision: build (a compat loader), and scope it to the two translatable classes only.**
Reason: of the fifteen surfaces reconstructed below, five are renames or relocations that a
version-keyed table can translate mechanically, and six are semantic changes that a table
*must* refuse — translating them would silently produce a plugin that loads and then behaves
wrongly. A loader that refuses the second set is worth building; one that guesses at it is
worse than no loader at all.

---

## 1. Method, and what the evidence base actually is

The brief asked for a reconstruction "from this repository's own history". This repository has no
history to read:

> `[实测]` `git rev-parse --is-inside-work-tree` → `fatal: not a git repository` ("not a git
> repository (or any of the parent directories): .git"); `git log --oneline -n 5` → same. The tree at
> `<workspace>\\dsh-link` is not under version control, matching what
> `.tmp/baseline/BASELINE.md:2` already recorded ("工作区无 git，无法用 HEAD 还原").

So "history" here means the three records that do exist, and every claim below is tied to one of
them:

| Record | What it is | Where |
|---|---|---|
| **A. The port's own manifest** | `plugins/dsh-link-mods/README.md` — a per-package compatibility verdict written while the desktop edition's plugins were ported | `plugins/dsh-link-mods/README.md:19-32` |
| **B. The ported sources' own comments** | Migration notes written *at the line that had to change* | `plugins/dsh-continue-button/src/client/index.tsx:8-33`, `plugins/dsh-agent-context/lib/current.js:213-226` |
| **C. This session's measurements** | `.tmp/*/REPORT.txt` — CDP probes of the live client, the fallback baseline, and the shell's own regression reports | `.tmp/corners/`, `.tmp/menu-hunt/`, `.tmp/menu-jump/`, `.tmp/lensfix/`, `.tmp/popover-skin/`, `.tmp/styles/`, `.tmp/feel/`, `.tmp/bridge-sweep/`, `.tmp/diag-bottom/`, `.tmp/baseline/BASELINE.md` |
| **D. The kernel's own migration prose** | Upstream's statement of what moved, in the shipped skill and reference docs | `core/deepseek-harness/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:68-70` |

Two endpoints:

| | Old | New |
|---|---|---|
| Kernel | `0.1.5-rc.1` (the third-party desktop shell at `<install-dir>`) | `dsh-v0.2.1-alpha.1`, commit `5badb15` (`README.md:9`) |
| Kernel checkout used here | — | `core/deepseek-harness/` (vendored, pinned, not edited — `README.md:37`) |

The old endpoint is **not** in this tree. Nothing below claims to have read 0.1.5 source; where a
0.1.5-side fact appears it is quoted from a record that observed it (A, B, or D), and is tagged
accordingly. That is a real limit on this chapter and it is stated again in §6.

---

## 2. Where the surface actually was, in one screen

The fifteen surfaces this chapter reconstructed, grouped by class. The right-hand column is the
whole point of the chapter: **T** = a version-keyed table can translate it; **R** = the table must
refuse it and route to an explicit adapter or a human decision. Five are T (B1, B3, B6, B7's
attribute half, B12), six are R (B2, B4, B5, B8, B10, B11 — plus B7's hash half, refused as table
hygiene rather than as semantics), and four are neither: two invariants to pin (B9, B13), a package
that already declares both ranges (B14), and one consequence of B1 to clean up (B15).

| # | Surface | Class | Verdict |
|---|---|---|---|
| B1 | Agent presets: `.agent-presets/<id>/` directory → `@deepseek-ai/dsh-agent-preset` declaration row | **relocation** | T |
| B2 | `conversation.chat.turnTail` slot: `chain` → `list` | **semantic change** | R |
| B3 | `subagents.listChildren()` entry: `kind` → `mode` | **rename** | T |
| B4 | Live-editable settings: namespace → profile-entry id + `.volatile()` fields | **semantic change** | R |
| B5 | `sandbox_permissions`: "equal to the effective mode" fixed upstream, "narrower" still throws | **semantic change** | R |
| B6 | `repeat-guard` interception table: settings namespace → the mount row's `config` | **relocation** | T |
| B7 | Client material: hashed `_material_` class vs the stable `data-menu-material` attribute | **rename** (of the stable identifier only) | T for the attribute; R for the hash |
| B8 | `border-radius` now draws a superellipse (`corner-shape: superellipse(1.5)`) | **semantic change** | R |
| B9 | Client module contract `window.__ModuleLoader__.load({id, factory})` | *unchanged* | pin it |
| B10 | Peer-range preflight disables a row the user installed; \`dsh plugin add\` skips bundle registration when pnpm exits non-zero | **semantic change** | R |
| B11 | A `--patch` overlay row that overrides a form-edited row becomes **read-only** | **semantic change** | R |
| B12 | `dsh-lan-bridge` RPC failure value → 0.2.x structured error contract | **rename** | T |
| B13 | `--patch` file must parse as a top-level YAML array | *unchanged, but newly fatal* | pin it |
| B14 | Self-authored plugin packages: peer `>=0.1.7-0 \|\| >=0.2.0-0` | *compatible* | neither |
| B15 | The shell still seeds a `.agent-presets/` directory nothing reads | **dead seed** (a consequence of B1) | delete it (product code) |

---

## 3. Each breakage

### B1 — Agent presets moved from a scanned directory to a declaration row

**What changed.** 0.1.x discovered agent presets as directories under `$DSH_HOME/.agent-presets/<id>/`
holding `preset.yml` and `agent.cordis.yml`. 0.2.x removed directory discovery entirely: a preset is
now an ordinary `@deepseek-ai/dsh-agent-preset` configuration row carried by a profile bundle.

> `[代码可证]` Upstream states it outright: "Before declaration rows, a user preset was a directory
> `$DSH_HOME/.agent-presets/<id>/` holding `preset.yml` … **Nothing reads that directory any
> more.**" — `core/deepseek-harness/packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70`
>
> `[代码可证]` A repo-wide search for the literal `.agent-presets` under `core/deepseek-harness/`
> returns 4 matches: that SKILL.md line, and three recorded snapshots. **Zero** are code.

**How it surfaced.** The desktop edition shipped two home-made presets (`chat-mode`,
`minimal-tuned`) as directories. On 0.2.x they simply do not appear in the preset list — no error,
no diagnostic, an empty capability. A preset that does not exist composes nothing.

**The `file:line` that had to change.**

- `plugins/dsh-link-mods/README.md:8-9` declares the replacement carrier:
  `presets.patch.yml` — "两套自制 Agent 预设（chat-mode、minimal-tuned）的 0.2.x 声明".
- `plugins/dsh-link-mods/README.md:16-17` records that the compositions are carried
  "逐字搬运" (verbatim) — one relative-path row changed:
  `./anchored-lite.mjs` → the `dsh-anchored-lite` package (`README.md:337-338`).
- `[代码可证]` The live writable root survives only as a vestige: `src-tauri/src/core/profile.rs:159-163`
  still creates `home.join(".agent-presets")` on every launch, and no kernel code reads it (see B15).

**Class: relocation.** The artifact (a plugin composition) is unchanged; only its carrier and its
discovery path moved. A table can express this: `capability: 'agentPreset'` → resolve by
declaration row, and refuse a directory-shaped source with a message naming the migration.

> `[代码可证]` Note the second half of the upstream migration warning, which is *not* a
> relocation and is the trap in this item: "check each plugin name against
> `cordis-composition-reference` because **packages renamed since the preset was written fail at
> activation**" — `.../editing-cordis-compositions/SKILL.md:70`. The row loads; activation is where
> it fails.

---

### B2 — `conversation.chat.turnTail`: same name, different slot *kind*

**What changed.** The slot name is identical across both kernels. Its **kind** is not: 0.1.5
declared it a `chain` slot; 0.2.1 declares it a `list` slot. The kind is what decides the
registration contract, so the same `ctx.slots.register({ name, ... })` call is valid on one kernel
and invalid on the other.

> `[代码可证]` 0.2.1: `'conversation.chat.turnTail': { kind: 'list'; scope: 'session'; owner: TurnTailOwnerProps }`
> — `core/deepseek-harness/packages/client/ui-chat/src/client/contract/slots.ts:315` (mirrored at
> `ui-chat/src/client/chat/register-node-renderers.ts:70`).
>
> `[代码可证]` The 0.1.5 side, recorded at the line that had to absorb it: "两版
> `conversation.chat.turnTail` 的 kind 不同，而 kind 决定注册契约：· 0.1.5（桌面版）是 **chain**：
> register 必须给 `select`，否则内核直接 throw … 条目根本不上账 … · 0.2.x 是 **list**：要 `id`，
> 不看 `select`。`id` + `select` 同时给，两种形态都合法，因此一个注册覆盖两版。"
> — `plugins/dsh-continue-button/src/client/index.tsx:8-13`
>
> `[代码可证]` The kernel enforces the chain rule and says exactly the message quoted:
> `if (options.select === undefined) throw new Error(\`chain slot "${options.name}" requires options.select\`)`
> — `core/deepseek-harness/packages/client/ui-slots/src/index.ts:1237-1239`.

**How it surfaced.** *Silently on the old kernel, and this is the point.* The throw happened inside
the client plugin's registration path, the entry never landed, and the user-visible result was a
missing button with no console error the user would ever look for. The port's own note calls it
"曾因此整条尾部路径失效" — the whole tail path was dead.

**The `file:line` that had to change.** `plugins/dsh-continue-button/src/client/index.tsx:36-37`
(the slot constants) and the registration that follows, now passing **both** `id` and `select`
— `src/client/index.tsx:13`, verified by the plugin's own harness
`plugins/dsh-continue-button/verify-tail-host.mjs:141-142`:
`assert.equal(tailEntries.length, 1, 'turnTail entry registers')`;
`assert.equal(typeof tailEntries[0].select, 'function', 'turnTail carries select')`.

**Class: semantic change — refuse it.** The name did not move, so a name-keyed table finds a
match and reports "resolved". But the *same* registration call means two different things, and a
translation would have to guess which kernel the caller assumed. The correct loader behaviour is
to throw `UnsupportedError` naming the slot and its kind on both sides, and point at the
"pass both `id` and `select`" shape — which is a deliberate caller-side choice, not a table entry.

---

### B3 — `subagents.listChildren()` entries lost `kind`

**What changed.** 0.1.x entries carried a `kind` field. 0.2.x entries are `{ id, createdAt }` plus
`{ mode, label }`.

> `[代码可证]` `plugins/dsh-agent-context/lib/current.js:213-226`:
> "0.2.x 的 `listChildren` 条目不再携带 `kind` 字段（只有 `{id, createdAt}` 加 `{mode, label}`），
> **按 kind 过滤会把所有子代理滤掉，两个工具随之失明**。"
> The ported code reads `entry.mode === 'continuable'` at `lib/current.js:224`.

**How it surfaced.** Both tools (`agent_context`, `compact_agent`) went blind — the Lead saw an
empty roster of delegated agents and could not measure or compact any of them. No exception: the
filter was a predicate over a field that had become `undefined`, and `undefined` is a perfectly
good "not this one".

**The `file:line` that had to change.** `plugins/dsh-agent-context/lib/current.js:214-224` — one
predicate, and the tool surface came back.

**Class: rename — translate it.** The field carries the same fact under a new key with a new value
vocabulary (`mode: 'continuable' | ...` vs the old `kind`). Meaning is preserved, so a table entry
`{ capability: 'subagents.children', from: 'kind', to: 'mode' }` is safe, honest, and testable. This
is the canonical example of what the loader is *for*.

---

### B4 — A settings field being present no longer means it is writable

**What changed.** This is the largest semantic change in the set and it is invisible from the
outside. On 0.2.1 a settings surface is a **profile entry**, identified by its Loader row id, and
only fields the owning plugin declared with `.volatile()` may be written at runtime. Everything
else in the same schema is read-only, and a write is *rejected*.

> `[代码可证]` The form is keyed by entry id, and non-volatile writes throw:
> `const entry = this.ownerContext.configEditor.entries().find(row => row.options.id === ns)`;
> `if (entry === undefined || schema === undefined) throw new Error(\`No configurable plugin entry "${ns}"\`)`;
> `const form = volatileForm(schema)`;
> `if (form === undefined) throw new Error(\`Plugin entry "${ns}" has no volatile fields\`)`;
> `if (path.length && !isVolatilePath(schema, path)) throw new Error(\`Config field "${path.join('.')}" is not volatile\`)`
> — `core/deepseek-harness/packages/settings/settings/src/index.ts:382-388` and `:399-409`.
>
> `[代码可证]` The predicate: `volatileForm` returns `undefined` unless some field sits under a
> `.volatile()` node — `.../settings/src/schema.ts:37-47`; `isVolatilePath(schema, path)` walks the
> path looking for that node — `schema.ts:74-79`.
>
> `[代码可证]` The client half reads it by **entry id**, not by namespace:
> "Feature adapters use `ctx.configForms.get(entryId)` to obtain accepted values and a write
> queue shared by every editor of that Host entry."
> — `core/deepseek-harness/packages/client/ui-settings/README.md:34`.

**How it surfaced.** As a *missing* row and a *silent* no-op, in that order. Our two Theme fields
carry `.volatile()` today, and the session record shows why that is load-bearing:

> `[实测]` `.tmp/styles/REPORT.txt:12` (command: the live page over CDP 9222, viewport 1440x900):
> `glassPreset: z.union(['tahoe','golden-gate']).default('tahoe').volatile()` and
> `glassTransparency: z.union(['clear','default','tinted']).default('default').volatile()`.
> The same report records the failure mode that follows when the write is *refused or rejected*:
> "a refused OR rejected write now reports on its own row (the old handler only caught a resolved
> `false` and went silent on a rejection)."

The namespace/entry-id identity is the second half of the change:

> `[代码可证]` `plugins/dsh-theme-settings/cordis.patch.yml:1-5`: "The entry id IS the settings
> namespace the plugin's Config is published under, and the id the client half reads through
> `ctx.configForms.get()` — `- id: theme-settings`"; one identity, declared once at
> `plugins/dsh-theme-settings/src/settings.ts:8-9`: `export const SETTINGS_NAMESPACE = 'theme-settings'`.

**The `file:line` that had to change.** `plugins/dsh-theme-settings/src/index.ts:25` (the Host
schema, where `.volatile()` must be declared), `plugins/dsh-theme-settings/src/client/index.tsx:56`
(`inject` list — `configForms` is a required service), `src/client/index.tsx:83-88`
(`ctx.configForms.get(SETTINGS_NAMESPACE)`), and the row id itself in `cordis.patch.yml:5`.

**Class: semantic change — refuse it.** "The field is in the schema" and "the field can be set at
runtime" stopped being the same statement while the schema stayed byte-identical. A loader cannot
translate this: it cannot know whether an author *intended* a field to be live, and manufacturing
a `.volatile()` on someone else's schema would silently widen what a settings form may write.
The refusal is concrete and actionable: `settings.define` (the facade in §02) must declare
volatility itself, and a plugin that reaches for `ctx.configForms.get(ns)` for a namespace its own
row does not own must be refused with the entry-id/namespace rule in the message.

---

### B5 — `sandbox_permissions`: the same field, half redefined

**What changed.** 0.1.x shipped a defect: a `sandbox_permissions` request that was **not wider**
than the effective mode failed the whole tool call. The desktop edition patched the published
`@deepseek-ai/dsh-sandbox` lib on every install to fix it. 0.2.1 fixed *half* of it upstream —
"request equals effective mode" now returns directly — and still throws for a request to a
*narrower* mode.

> `[代码可证]` `plugins/dsh-link-mods/README.md:36-41`: "桌面版的 hotfix 直接改
> `@deepseek-ai/dsh-sandbox` 的发布 lib：`sandbox_permissions` 请求不比当前有效模式严格更宽时，
> 按有效模式放行而不是 throw。dsh-link 的内核是固定 checkout（不做源码改动），且 0.2.1 已把
> '请求等于有效模式' 修成直接返回，**剩下 '向更窄模式请求' 仍会 throw**。"
>
> `[代码可证]` The replacement is a runtime wrapper, not a patch:
> `ctx.on('tools/execute', async (exec, next) => { ... })` at
> `plugins/dsh-escalation-guard/lib/index.js:41`, catching a marker error (`:46`), deleting
> `args.sandbox_permissions` (`:51`) and retrying `return next()` (`:55`), justified by
> `:9-11`: "包装 `tools/execute`，捕到这个特征错误后，把 `sandbox_permissions` 从参数里剥掉再
> 放行一次——升级检查发生在工具体执行之前，首次 `next()` 没有任何副作用，重试是安全的。"

**How it surfaced.** As a whole-call failure, repeatedly, on a delegated path — `lib/index.js:7`
records that on the desktop "一个子代理会话因此连烧" (a subagent session burned through retries).

**The `file:line` that had to change.** The patch target no longer exists as a patch target:
the fix moved to `plugins/dsh-escalation-guard/lib/index.js:41-57`. Nothing in
`plugins/dsh-lan-bridge/` or the kernel is touched.

**Class: semantic change — refuse it.** This is the clearest case in the whole chapter. The field
name is identical, its *behaviour contract* differs by kernel, and the difference is not
expressible as a mapping: the correct handling is "catch a specific error, mutate the call
arguments, retry once, on a seam where the retry provably has no side effect". A compat table that
"translated" this would either drop the field always (silently downgrading every genuinely-widening
request) or pass it through always (restoring the original defect). **A compat layer must refuse
`sandbox_permissions` and route to an explicit `tools/execute` adapter — exactly what this repo
already did.**

---

### B6 — `repeat-guard`'s interception table moved carriers

**What changed.** The table lived in `settings.yaml` under a `repeat-guard:` key on 0.1.x and now
lives in the mount row's `config` on `dsh-repeat-guard@0.2.2`.

> `[代码可证]` `plugins/dsh-link-mods/README.md:24`: "拦截表从 settings 命名空间移到本行 entry
> Config"; and `:124-127`: "repeat-guard 拦截表原文：`patches/repeat-guard.fragments.yml`（0.1.x 放
> settings.yaml 的 `repeat-guard:` 键下；0.2.2 起改挂在挂载行的 entry Config 里，**两份内容一致**）".
> The two copies are byte-identical apart from their carrier.

**How it surfaced.** As an inert guard: the plugin loads, the table is not where it looks, and the
loop it was meant to stop is not stopped.

**The `file:line` that had to change.** The mount row's `config` in the profile patch — recorded
in `plugins/dsh-link-mods/patches/repeat-guard.fragments.yml`.

**Class: relocation — translate it.** "内容一致" is the direct evidence: the value moved, it did not
change. A table entry can move a settings-shaped block into a row `config` and is verifiable by
comparing the two documents.

---

### B7 — The client's own DOM hooks: a hashed class and a stable attribute

**What changed.** Nothing in *our* code renamed anything; the client's internals did, and this is
the archetype of the family. The popup material the skin has to recognise is a CSS-Modules class
`_material_<hash>_<n>` whose suffix is regenerated every build, while the client's own shape flag
`data-menu-material="translucent"` is a stable, hand-written attribute.

> `[代码可证]` The stable side: `<div {...props} ref={ref} data-menu-material="translucent"` —
> `core/deepseek-harness/packages/client/ui-primitives/src/MenuSurface.tsx:35`; consumed by the
> client's own theme at `packages/client/ui-theme/src/styles/gradient-shadow-text.css:23`.
>
> `[代码可证]` Our consumption of the *unstable* side is deliberately substring-based, and the
> source says why: "**Never a CSS-module hash.**" — `plugins/dsh-liquid-glass/src/client/index.ts:1022-1026`
> (`const MENU_SURFACES = '[role="menu"], [data-menu-material]'`), with the hash fallback kept only as a
> net at `src/client/index.ts:136,1183` (`'[class*="_material_"]'`) and
> `src/client/material.css:606` (`html[data-lg-style='liquid-glass'] [class*='_material_']`).
>
> `[实测]` The general rule was already written down after the previous shell's experience:
> `docs/eac-pitfalls-full.md:59` — "**CSS Modules 哈希类名前缀随内核版本漂移** → 旧哈希仅兜底、锚定
> `data-phase` 等稳定契约" (source: `[sc/bridge.js:398-506]`, the predecessor shell's own UI-shim
> code).
>
> `[实测]` And the probe recorded that the hash route is not merely fragile but *absent* in this
> build: `scripts/verify-shell-radius.mjs:924` reports "this client build carries no element with
> that class (0 with the skin on and 0 with it off)". The fallback never fires here.

**How it surfaced.** As a material that silently stops applying to menus — the skin still dresses
everything it can name, and one surface quietly keeps the client's treatment. No error, no log.

**The `file:line` that had to change.** `plugins/dsh-liquid-glass/src/client/index.ts:1026`
(the selector), `src/client/material.css:663` (`[data-menu-material]`), `material.css:694`
(the menuitem row radius, resolved by role rather than by hash:
`:is([role='menu'], [data-menu-material]) :is(button[role='menuitem'])`).

**Class: rename for the stable attribute (translate it); refuse the hash.** A table can and should
map `capability: 'client.menuSurface'` → `[data-menu-material]`. It **cannot** map a hash, and any
attempt to record one must be rejected at table-load time — a recorded hash is a landmine that
looks like a fix. This is the one place where the refusal rule is about *table hygiene* rather
than about semantics.

---

### B8 — `border-radius` stopped drawing a circle

**What changed.** The client declares one continuous-corner shape for the whole app under a feature
guard, and `corner-shape` is not inherited:

> `[代码可证]` `@supports (corner-shape: superellipse(1.5)) { :root { --dsw-corner-shape: superellipse(1.5); } *, ::before, ::after { corner-shape: var(--dsw-corner-shape); } }`
> — quoted from the client by `plugins/dsh-liquid-glass/src/client/displacement.ts:43-47` and
> `src/client/material.css:1125-1127`; the guard and token are pinned by the kernel's own test at
> `core/deepseek-harness/packages/client/ui-theme/tests/corner-shape-styles.client.spec.ts:15-19`
> (`GUARD = '@supports (corner-shape: superellipse(1.5))'`, `TOKEN = '--dsw-corner-shape'`), and by
> the shipped rule "**`corner-shape` is not inherited**: the theme applies it to elements and their
> `::before`/`::after`" — `core/deepseek-harness/docs/ui-radius.md:52`.

The consequence for us: the skin bakes a lens map, and it had baked that map from a *circular*
field while the boundary the client draws is a superellipse. Four different curves were live at
once (client boundary, lens, window clip, and the skin's own radius) and only two of them matched.

> `[实测]` `.tmp/corners/REPORT.txt:4-10` (command: CDP 9222 against the live client, 31761,
> Chromium 154, dpr 1.5; probe `.tmp/corners/probe-corner.mjs`). Free fits of the drawn locus:
> `r=12 → r 12.38 / n 3.08`, `r=20 → 20.36 / 2.99`, `r=30 → 30.50 / 2.95`, sidebar `→ n 3.02`;
> a plain `border-radius` box follows `n = 2.95..3.02` at rms `0.07-0.08px` where the best *circular*
> fit is "25% off in radius at 0.34-6.7px rms"; and a `corner-shape: round` control recovers
> circles of `11.65/19.64/29.63`. Fit residuals against the drawn boundary: circular
> `1.392 / 2.265 / 3.332px` (r12/20/30) vs continuous `0.053 / 0.151 / 0.302px`.
> The mapping is stated at `displacement.ts:49`: "`corner-shape: superellipse(k)` is this family
> with **n = 2k**" — `superellipse(1.5)` ⇒ `n = 3`.

**How it surfaced.** As an edge that does not line up: a 1-3px band where the lens bends along a
circle under a squircle boundary, plus a window corner that draws a third curve. Visually "wrong
and slightly blurry", never an error.

**The `file:line` that had to change.** `plugins/dsh-liquid-glass/src/client/displacement.ts:41-58`
(`CORNER_EXPONENT = 3`) and `:165-180` (`cornerExponentOf`, which *reads* each surface's computed
`corner-shape` instead of assuming one); the property name at
`plugins/dsh-liquid-glass/src/client/index.ts:40` (`CORNER_SHAPE_PROPERTY = 'corner-shape'`);
the gated stylesheet at `src/client/material.css:1170-1188`
(`corner-shape: var(--lg-corner-shape, superellipse(1.5))`).

**Class: semantic change — refuse it.** Identical property, identical number, different drawing.
The number is the whole input to the old code path, so a table keyed on values cannot see the
change at all. Worse, a "translate the radius" entry would be *actively harmful*: the correct
implementation reads the engine's own computed value at runtime
(`cornerExponentOf`) and degrades to `n = 2` on an engine without the property. **The rule: the
compat layer may not carry any geometry fact; it must expose the probe
(`getComputedStyle(el).cornerShape`) and refuse a caller that asserts one.**

---

### B9 — The client module contract did *not* break (and that matters)

**What changed.** Nothing. This is the one item in the set that is stable across the boundary, and
it is recorded as such because it is the contract a client-side compat half has to be built on.

> `[代码可证]` `docs/eac-pitfalls-full.md:20`: "`globalThis.__DSH_MODULES__` 缺失（兼容垫片） →
> 0.2.1 仍是 `__ModuleLoader__` 队列契约、factory 单参 `(require)`（`modules/src/index.ts:556`、
> `tsdown.client.ts:617`）".
>
> `[代码可证]` The contract itself, from the kernel: the injected facade is
> `window.__ModuleLoader__={ mode:"queue", pendingQueue, load(registration){pendingQueue.push(registration)}, create(options){ if(this.mode!=="queue") throw … } }`
> — `core/deepseek-harness/packages/client/modules/src/index.ts:556-575`; the factory receives one
> `require`: `const exports=registration.factory(specifier=>{…})` at `:566`.
>
> `[代码可证]` Our packaging honours it: `const wrapped = 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(name) + ', factory: (require) => { … } });'`
> — `plugins/build.mjs:79-82`; and the emitter keeps `id` outside the module body so a
> registration can never be anonymous (`plugins/README.md:32-35`).

**Two properties here that a loader must respect, both pinned by the kernel's own tests:**

1. **Registration happens in a queue, before boot.** A bundle that evaluates after
   `create()` has already run cannot register — the facade refuses
   (`modules/src/index.ts:561`). Any client-side compat half therefore has to be *in* the served
   bundle, not injected later.
2. **A duplicate `id` throws.** `core/deepseek-harness/packages/client/modules/tests/loader.client.spec.ts:583-584`
   calls `load` twice with `id: 'x'` and expects a throw.

**Class: neither — pin it as an invariant.** This is the one contract the client-side half of the
loader is allowed to depend on without a table entry. If the assertion ever fails, the loader has
no client-side story left, and the failure should be a load-time `UnsupportedError` naming the
queue contract, not a silent no-op.

---

### B10 — A row the user installed can be in a *disabled* state for a reason that is not a load error

**What changed.** 0.2.x added a compatibility preflight over `peerDependencies` with
`includePrerelease: true`. A row whose declared upper bound excludes the running kernel is not
loaded — it is **disabled**.

> `[代码可证]` `plugins/dsh-link-mods/README.md:25`:
> `@argszero/cordis-plugin-thinking-loop-guard` 0.1.9 — "**peer 上限 `<0.2.0`，需
> `dsh plugin allow-version` 豁免**，否则该行被兼容性预检停用"; and `:24` for the counter-case
> (`dsh-repeat-guard` 0.2.2's peer `>=0.1.7-0 || >=0.2.0-0` "直接覆盖本内核" — it loads).
>
> `[代码可证]` The exemption is a human act, recorded verbatim at `plugins/dsh-link-mods/README.md:108-114`:
> `plugin allow-version @argszero/cordis-plugin-thinking-loop-guard@0.1.9`.

**How it surfaced.** As a row that simply is not there. `README.md:350` records the wider pattern
in the same family: "`dsh plugin add` 在 pnpm 退出码非 0 时**不会**登记 bundles"→ install
"succeeds" and the plugin never loads.

**The `file:line` that had to change.** The profile manifest's `dsh.profile.bundles` entry plus the
single allow-version exemption; `plugins/dsh-link-mods/README.md:106-114` is the record.

**Class: semantic change — refuse it.** The peer range is the *only* thing the preflight trusts,
and it is frequently wrong in both directions (a 0.1.x package that works fine on 0.2.x is
disabled; a package that declares support may still be broken). A compat layer that "widened" the
range would take on a correctness claim it cannot support, and would do it invisibly. **Refuse:
surface the row, its declared range, the running kernel, and require the explicit exemption.** The
repo's own choice — one exemption, written down with its reason — is the shape to keep.

---

### B11 — A `--patch` overlay can silently make a settings row read-only

**What changed.** Not a rename; a new side effect of an unchanged mechanism.

> `[代码可证]` `README.md:172-177`: "a `--patch` overlay that overrides a row the settings form
> edits makes that row **read-only** (the config editor refuses it), which is why DSH Link's
> defaults for editable rows are seeded into the profile patch instead".

**How it surfaced.** As a settings row that renders and refuses every write — the same
user-visible symptom as B4, from an unrelated cause. Two different bugs, one appearance. That
alone is an argument for the loader's error to *name which* of the two it is.

**The `file:line` that had to change.** `src-tauri/src/core/profile.rs:165-170` — the overlay seed
and `seed_profile_patch`; `README.md:263-267` records that the one default that must stay
editable (`session-log-deepseek: enabled: false`) was moved into the **profile's own** patch
document `profiles/web/cordis.patch.yml`, i.e. the file the settings form writes.

**Class: semantic change — refuse it.** "Which file a value lives in" now decides "whether it can
be changed", and that is a property of the *composition*, not of the value. A table cannot encode
it. The loader's job is to detect the overlap (a row id present in both an overlay and the
form-editable document) and throw with both paths in the message.

---

### B12 — `dsh-lan-bridge`: the RPC failure value became a structured object

**What changed.** The failure value returned from a remote call became a 0.2.x structured error,
and the plugin's parse had to follow.

> `[代码可证]` `plugins/dsh-link-mods/README.md:29`: "`dsh-lan-bridge` … **RPC 失败形状已对齐
> 0.2.x 结构化契约**；其余逐 API 兼容". The line that consumes it and re-raises with the code
> intact: `throw new Error(\`${error.code}: ${error.detail ?? ''}\`.trim())` —
> `plugins/dsh-lan-bridge/lib/core/service.js:1513`; `error.code` is set at `:630`.

**How it surfaced.** As an opaque failure: a readable kernel refusal (`not-granted`,
`peer-offline`) arriving at the model as `undefined` or `[object Object]`, so a policy denial
looked like a crash.

**The `file:line` that had to change.** `plugins/dsh-lan-bridge/lib/core/service.js:1513` (and the
error construction at `:630`).

**Class: rename — translate it.** Same fact, new container. A table entry keyed on the failure
value is safe and testable, and the failure mode it prevents (an unreadable refusal) is exactly
the kind of thing the loader should centralise rather than leave to each plugin.

---

### B13 / B14 / B15 — two invariants, one non-breakage, one consequence

**B13 — `--patch` must be a top-level YAML array.** `[代码可证]` `README.md:256-259`:
"a comment-only document parses as `null` and is rejected", hence the seed ends with `[]`.
`[代码可证]` `src-tauri/src/core/profile.rs:165-168` writes `OVERLAY_SEED` only when the file is
absent. Unchanged across the boundary, but newly *fatal* because the loader now composes an empty
overlay by design (`README.md:269-270`). Pin it as an invariant.

**B14 — the peer range that already covers both kernels.** `[代码可证]`
`plugins/dsh-link-mods/README.md:24`: `dsh-repeat-guard` 0.2.2 declares
`>=0.1.7-0 || >=0.2.0-0`, which "直接覆盖本内核". Not a breakage; listed because it is the shape
a *portable* plugin should declare, and it is the counter-example that keeps B10 an honest
refusal rather than a blanket rule.

**B15 — the dead seed.** `[代码可证]` `src-tauri/src/core/profile.rs:157-163` creates
`kernel-home/.agent-presets` on every launch; `[代码可证]`
`.../preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:70` says of that exact path
"Nothing reads that directory any more"; `[代码可证]` a full-tree search of
`core/deepseek-harness/` for the literal `.agent-presets` finds 4 matches, none of them code.
A consequence of B1 that outlived the migration. **Not a compat-layer item** — just delete the
seed, and note that deleting it is a product-code change, i.e. it belongs to the implementation
phase, not to this report.

---

## 4. The three classes, defined against this evidence

| Class | Test | Chapter example | What a compat layer may do |
|---|---|---|---|
| **Rename** | Same fact, new key. Meaning survives a bijection. | B3 (`kind`→`mode`), B12 (error value → error object), B7's attribute half | Translate, and prove the bijection with a round-trip test |
| **Relocation** | Same value, new carrier. A byte-comparison of the payload passes. | B1 (preset directory → declaration row), B6 (settings key → row `config`), B11 (bundle registration) | Translate, and prove it by comparing the two documents |
| **Semantic change** | Same name and often the same value; **different behaviour**. | B2 (chain→list), B4 (schema presence ≠ writability), B5 (`sandbox_permissions`), B8 (`corner-shape`), B10 (peer preflight), B13 (overlay read-only), B7's hash half | **Refuse.** Throw `UnsupportedError{capability, kernelVersion, reason, suggestion}`; never guess |

**The refusal test, stated as one rule an implementer can apply without asking:**

> If two kernels accept the *identical* call with the identical arguments and the observable
> result differs, the item is a semantic change. It must not appear in the table. The table's
> schema should make that unrepresentable — a table row is `(capability, fromKey, toKey)` or
> `(capability, fromCarrier, toCarrier)`, and it has no field in which a behaviour can be written
> down.

The corollary matters as much: **a table row that cannot be verified by comparing two documents
should not exist.** B1, B6 and B12 qualify (the payload is byte-comparable). B2, B4, B5, B8, B10
and B13 do not, and that is precisely why they are refusals.

---

## 5. What this chapter concludes for §02

**Build.** The translatable class is real but small — B1's carrier move, B3, B6, B7's attribute,
B12, and B10's registration check — and none of them is individually worth a loader. What *is* worth a loader is
the refusal path: six of the fifteen items are semantic changes, **every one of them failed
silently in the field rather than loudly** (a missing button, a blind tool, an unwritten setting,
a lens bending along the wrong curve, a row that is simply absent), and the cost of each was
measured in a session, not in a stack trace. A loader that does nothing but make those eight fail
loudly, at load time, with the capability and both kernel versions in the message, is the entire
return on the work. The translation table is a bonus; the refusal table is the product.

---

## 6. Things this chapter could not establish

- **0.1.5 source was never read.** There is no 0.1.5 checkout in this tree and no git history
  (`[实测]` above). Every 0.1.5-side statement is quoted from a record that observed it:
  `plugins/dsh-continue-button/src/client/index.tsx:8-13`,
  `plugins/dsh-agent-context/lib/current.js:213-226`,
  `plugins/dsh-link-mods/README.md:19-32`, and
  `.../editing-cordis-compositions/SKILL.md:68-70`. A kernel-side diff would be strictly better
  evidence and is not available here.
- **The exact old `kind` value vocabulary for B3 is not recoverable.** The port's comment records
  the *shape* of the change (`kind` gone, `mode`+`label` present) and that filtering by `kind`
  emptied the list, but not the old enumerated values.
- **B10's preflight implementation was not read.** The claim rests on the two recorded peer ranges
  and the observed disablement (`plugins/dsh-link-mods/README.md:24-25`), not on the preflight's
  own source.
- **Whether the 0.2.1 `sandbox_permissions` narrowing case (B5) still throws was not re-verified
  against a live kernel in this session.** The claim is quoted from
  `plugins/dsh-link-mods/README.md:36-41`, which recorded it as measured at port time.
- **No live-UI interaction was performed for this chapter.** As instructed, the running app was
  not driven; every UI number cited above is quoted from this session's own recorded probes under
  `.tmp/`, with the command and the value, and attributed to the file it is recorded in.
