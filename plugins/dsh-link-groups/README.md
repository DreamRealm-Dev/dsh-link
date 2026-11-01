# dsh-link-groups

The mechanism kernel behind the tool surface's third state: **tool groups** that
are opened and closed together, with two always-open activation tools and an
approval gate in front of every group the user turned off.

Host half only. There is no browser half, no slot, and no UI surface, so this
package adds no icon or locale debt.

## What it adds to a session

| Name | Where it is registered | What it does |
|---|---|---|
| `tool_groups` | the agent's own layer (`agent.ctx`) | Reads the directory: every group id, whether it is open, its configured state, the tool names it would add, and — when it cannot be opened — the named reason. Takes no arguments, changes nothing. |
| `tool_groups_declare` | the agent's own layer (`agent.ctx`) | Opens and closes several groups in **one** call: `{ open?: string[], close?: string[], why?: string }`. |

Both are registered on `agent.ctx` on purpose. A restriction filters what a
scope *inherits* and never what its *own* layer registers
(`packages/core/tools/src/index.ts:1162-1175`), so an agent can always reach the
tools that open and close its own groups. For the same reason, every tool a group
may close must be registered on an **ancestor** layer (global or preset scope): a
member registered into the agent's own layer cannot be closed, and the group is
reported `broken` (`GROUPS_NO_TOOLS`) instead of pretending otherwise.

## The three states

| Configured `state` | At install | `declare({ open: [id] })` |
|---|---|---|
| `on` | open, never masked | already open |
| `off` | masked | refused `GROUPS_OFF`; the gate denies before anyone is asked |
| `auto` | masked | opens, or is refused with its named reason |

Configured state and the current reality are **two different fields**:
`state: 'on' | 'off' | 'auto'` is configuration, `open: true | false` is what the
session currently has. The directory reports both.

`auto.when` says who decides:

- `declare` — the model, through `tool_groups_declare`;
- `device` — the group's own plugin, through the exported `requestAutoOpen(ctx, agent, id, why)`, which runs the same open path a declaration does;
- `after` — nobody, until the group it names is open; until then the group is `openable: false` with `GROUPS_DEPENDENCY` naming the missing dependency. It is a reported refusal, never a silent wait.

`userDisabled: true` marks a group a human already turned off in configuration.
Both it and `state: 'off'` go through the approval gate: `tools/pre-execute`
returns `{ kind: 'ask' }`, and the kernel resolves it against the approval seam.
With no answerer the request fails closed and the group stays masked, so no
declaration can open it silently. A group that is neither `off` nor
`userDisabled` is never asked about.

## What a slide costs

Nothing here is free. The routed provider in this deployment declares neither
`toolUpdate` nor `systemPromptUpdate` and throws `UNSUPPORTED_CONTENT` on
`deferLoading`, so the next model request carries a rewritten `tools` section
whenever the surface changes. Every applied slide therefore reports three
measured numbers, in the tool result:

- `entries` — how many tools the agent can call after the slide;
- `bytes` — the UTF-8 size of exactly those schemas, as the kernel serializes them;
- `startsSeries` — whether the next `request/header` the session logs carries
  `startsSeries` (`packages/core/agent-loop/src/agent.ts:626-634`, which is also
  where the single batched `developer/message` with its `tool-addition` rows comes
  from, `:635-648`).

The effective point is always and only `effective: 'next-step'`. `assemble()`
runs in the step's `preStep` before the tool call, so the step that declares a
group cannot see it. A batch keeps the slide count at one per call, and closed
groups default to `relockable: false`, so an opened group is not removed again
inside a session and the names already published keep their positions.

## Configuration

Everything is data in the row's `config`, so a profile patch changes it without
editing this package.

```yaml
- insert:
    - id: link-groups
      name: dsh-link-groups
      config:
        groups:
          - id: teams
            title: Agent Teams
            summary: Create, message, and manage Agent Teams teammates and their tasks.
            tools: [team_create, team_list, team_message, team_task, team_status, team_leave, team_disband, team_wait, team_broadcast]
            provider: team_          # cross-check only; `tools` is authoritative
            state: auto
            auto: { when: declare }
        catalogPreamble: Tools are organised in groups; a closed group costs nothing.
        deferredNotice: true      # state the process-local consequence in the directory
        logProviderWarnings: true
```

A group entry is `{ id, title?, summary?, tools, provider?, state?, auto?, userDisabled?, relockable? }`.
`tools` is the **authoritative** membership: no package manifest in this
ecosystem carries a tool list, so the group cannot be derived from a package. A group
is therefore **not** the same thing as "the tools one plugin provides": a plugin
may contribute tools of several kinds, and one group may span two plugins.
`provider` is only a cross-check — when none of a group's tools starts with it,
the plugin logs one warning and keeps using `tools`.

## The third-party seam: `linkGroups`

A plugin that owns tools of its own contributes a group without editing this
row or the profile at all. The package provides one service; a consumer reaches
it with `ctx.get('linkGroups')` (declare `inject: ['linkGroups']` when it must
not load without it — that is how the absence of the service is named).

```js
export const inject = ['tools', 'linkGroups']

export function apply(ctx) {
  const seam = ctx.get('linkGroups')
  ctx.effect(() => seam.registerGroup({
    id: 'notes', title: 'Notes', members: ['notes_list', 'notes_add'], autoWhen: 'declare',
  }))
}
```

- `registerGroup({ id, title, members, autoWhen? })` returns the disposer that
  removes the group again. Duplicate ids are refused **by name**
  (`LINK_GROUPS_DUPLICATE_GROUP`); a silent merge does not exist.
- `groups()` reads the merged directory: config rows first, contributed rows
  after, every row naming its `origin` (`'config'` | `'contributed'`).
- A contributed group is `state: 'auto'` — closed until the model declares it —
  and is never `userDisabled` and never `relockable`, because those are
  configuration decisions a third party cannot make.
- The group reaches every **already installed** agent in the registering call
  (no restart, no polling) and is masked by the same `ctx.tools.restrict` call a
  config group uses. Disposing it returns the tool face to exactly its prior
  bytes.

`docs/dev/tool-groups.md` is the contract page: definition shape, the two
extension points, every refusal code, the measured cost, and the limits below.

## Named refusals

A refusal never changes any state. The reading that proves it is that every
group's `state`/`open` is identical before and after the call.

| Code | When |
|---|---|
| `GROUPS_INPUT` | The argument object is not an object, a list field is not an array of strings, the declaration names nothing, an id is already in that state, or a close targets a group that is not `relockable`. |
| `GROUPS_UNKNOWN` | The id is not in the directory; the known ids travel back in configuration order. |
| `GROUPS_DUP` | One id appears in both `open` and `close`. |
| `GROUPS_OFF` | A group configured `state: 'off'` was declared open; the gate denies it before any approval question. |
| `GROUPS_DEPENDENCY` | An `auto.when: 'after'` group whose dependency is not open. |
| `GROUPS_NO_TOOLS` | A declared tool name reaches no layer its agent can call. That one group is `broken`; a typo does not take the rest of the surface down. |
| `GROUPS_CHANNEL` | No agent scope is reachable, so no restriction could be applied. The reason repeats the kernel's own message. |
| `GROUPS_CATALOG` | `tool_groups` was given arguments. |
| `GROUPS_COLLISION` | An activation tool name already resolves for the agent — in practice what a second `link-groups` row in one composition produces. It is not the seam's duplicate-id refusal. |
| `LINK_GROUPS_INPUT` | Thrown by `registerGroup` when the definition is not `{ id, title, members, autoWhen? }` with usable values. |
| `LINK_GROUPS_DUPLICATE_GROUP` | Thrown by `registerGroup` when the id already belongs to a config group or another contributed group. Nothing is installed. |

## Known limitations and deferred work

- **Group state lives in this process.** A third-party plugin may not add a
  `SessionEventMap` type: the persistence read path refuses a whole log that
  contains a type it does not know unless the writer marked it `ignorable: true`
  (`packages/session/session-persistence/src/storage-contract.ts:75-80`), and a
  live append cannot set that marker. **After a restart or a resume the groups
  fall back to their configured state and must be declared again.** The directory
  says so in its own text; nothing here is silently degraded. The self-check
  measures this (`K1`–`K4`).
- **PTC presets must not mount this row.** `tools.restrict()` refuses to name
  `run_code` (`packages/core/tools/src/index.ts:1111-1113`), and under PTC a
  model-direct call may only name that transport, so the third state is undefined
  there.
- **No cross-agent propagation.** A group opened in one session is not opened in
  its teammates; a child inherits the parent's preset scope key, not the parent's
  group state.
- **No provider auto-discovery.** `provider` is a configured cross-check, not a
  discovered fact.
- **`auto.when: 'device'` ships the open path, not a device trigger.** This
  package exports `requestAutoOpen`; wiring a real device or browser condition to
  it belongs to the plugin that owns that condition.

## Self-check

```sh
node plugins/dsh-link-groups/test/group-state-selfcheck.mjs             # readings only, exit 0/1
node plugins/dsh-link-groups/test/group-state-selfcheck.mjs --json      # machine-readable
node plugins/dsh-link-groups/test/group-state-selfcheck.mjs --self-attack
```

The world is mounted from the real kernel's own built modules: a fresh
`Context`, the real `SystemPrompt`, `ToolRuntime`, `AgentRegistry`,
`Session` and `ApprovalService`; the plugin's built artifact is loaded through an
import rewrite so the self-check and the world share one module instance. Exit
`3` with a `NOT MEASURED:` line means the kernel or the artifact was not there —
that is not a pass.
