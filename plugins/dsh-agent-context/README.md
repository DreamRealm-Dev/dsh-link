# dsh-agent-context

Two model-facing tools that give a DeepSeek Harness **Agent Teams Lead** a window
and a handle on the context of the agents it delegated to.

| Tool | What it does |
|---|---|
| `agent_context` | Measured context status of every delegated agent the caller can see: routed provider/model, measured tokens, that model's context window, pressure %, liveness, mid-turn vs idle, whether a compaction is already in flight, whether `/compact` resolves in the target's scope, and whether an inactive target can be resumed for compaction. |
| `compact_agent` | Compacts ONE delegated agent's own history in place — the same operation as the human `/compact`, addressed to that teammate/subagent instead of to the caller. An inactive teammate is resumed from persistence, compacted, and released again. |

Both are installed only into scopes that participate in delegation (Team members,
agents with a parent, agents with live children), the same way the shipped Team
tools scope themselves. A session that never delegates pays nothing.

## Why it exists

In this deployment `dsh-web-app` moves the compaction backend out of the host
plane into every agent preset, and `/compact` is mounted there with it:

* a teammate or subagent session compacts automatically only at the preset's
  pressure threshold (0.8 of the routed context window), which can be far away;
* the Web composer serves an **empty command directory for a subagent-addressed
  session** (`dsh-client-ui-commands`: `if (this.sessions().subagentAddress(sessionId) !== void 0) return []`),
  so typing `/compact` while viewing a teammate is delivered to that teammate as
  ordinary text instead of compacting it. Session evidence: the child's log holds
  a `user/message` whose text is `/compact` and **no** `command/run` record;
* a teammate is torn down between turns (`status: inactive`), so nothing on the
  Lead's tool surface could reach it at all;
* nothing on the Lead's tool surface could measure a child either.

## How `compact_agent` reaches the backend

`compaction` is a preset-realm service, so a host-plane plugin cannot resolve
`ctx.compaction` (verified live: `agent.ctx.get('compaction')` is `undefined` for
every agent). The tool therefore drives the same entry point the human command
uses:

```js
await ctx.commands.execute(targetAgent, '/compact', [], signal)
```

That resolves the definition registered by `dsh-command-compact` inside the
target's own preset scope and calls
`compaction.compactNow(target, signal, commandId)` with the target as the
receiver, writing the ordinary `command/run` + `command/done` + `compaction/*`
records into the **target** session log.

For a target whose agent no longer exists, the tool first resumes it the way the
subagent registry's own cold-resume does:

```js
await ctx.agents.resume({
  resumeSessionId: targetId,
  parentAgent: caller,                       // runtime ownership stays the caller's
  setup: (childCtx) => childCtx.get('agentPresets')?.composeFrom(childCtx, caller.ctx),
})
// … /compact on the resumed agent, then handle.dispose() in a finally block
```

## Authority

A caller may compact itself, any member of the Team it leads, and any of its own
live descendants. Every other target is refused.

## Limits

* A **mid-turn** target is refused with actionable text: `interrupt_agent` it,
  wait for the turn to end, then retry. This is the agent loop's own
  `runMaintenance` rule, not a policy this package adds.
* A finished **one-shot** child has no resumable conversation, so its history can
  no longer be compacted.
* Compaction cannot shrink the system prompt, the tool schemas, or one
  indivisible unit such as a single huge tool call.

## Verified behavior (this deployment, 2026-09-26)

| Check | Result |
|---|---|
| Row mounts live from the profile patch, tools appear in the Lead's catalog | pass |
| `agent_context` measures a real teammate (tokens / window / pressure / idle) | pass |
| `compact_agent` on an **inactive** teammate | pass — `Compacted 6 history items (~990 tokens)`; child log holds one complete `compaction/start` + `compaction/summary` + `compaction/end` bracket and a `command/done` success |
| Teammate still usable after compaction | pass — cold-resumed and answered |
| `compact_agent` on a **running** teammate | pass — refused with the interrupt hint |
| interrupt → compact recovery flow | pass — `Compacted 7 history items (~1356 tokens)` |

## Install (this deployment)

The package is linked into the `web` profile and its host-plane row is inserted
by the profile patch layer:

```yaml
# %APPDATA%\DeepSeek Harness\dsh-home\profiles\web\cordis.patch.yml
- insert:
    - id: agent-context
      name: dsh-agent-context/current
      config:
        promptHint: true
        reviveInactive: true
```

`patchReload: live` makes that patch take effect without restarting the host.
The row mounts the `/current` subpath on purpose: a live reload re-imports the
row's module, but Node's ESM cache is keyed by the resolved file URL, so a
running host would keep the old code if the default entry were edited in place.
A fresh host start resolves the default entry (`lib/index.js`), which re-exports
the very same implementation.

**Revert:** delete the insert block from the profile patch (live) and the two
tools disappear; or set `enabled: false` on the row.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `promptHint` | `true` | Add the short prompt section that tells the Lead when to check pressure and compact. |
| `reviveInactive` | `true` | Allow `compact_agent` to resume an inactive continuable child from persistence, compact it, and release it. |
| `installRequiresDelegates` | `false` | `false` (verified default): install into every live session, because the Team service reports `lead` for every root agent — an empty Team is still a Team. `true`: require a durable roster of more than one member, a parent, or a live child, keeping plain sessions and the `minimal` preset free of the extra schemas. |
| `maxRows` | `32` | Cap on rows listed by `agent_context`. |
| `scanLimit` | `100000` | Backward event scan bound when reading a target's compaction lock and turn state. |

## Optional follow-up: the human `/compact` in a child session

The composer's empty command directory is a client-side decision. A three-line
patch to `dsh-client-ui-commands/lib/client.js` (in the app install, so an app
upgrade overwrites it) would let `/compact` reach a child session that is **live
and idle**:

```js
this.directory = new CommandDirectory(async (sessionId) => {
  const result = await ctx.remote.commands.list(sessionId)
  if (!result.ok) throw new Error(`command.list failed: ${result.error.code}: ${result.error.message}`)
  if (this.sessions().subagentAddress(sessionId) !== void 0) {
    return result.value.filter((descriptor) => descriptor.name === 'compact')
  }
  return result.value
})
```

It does **not** replace `compact_agent`: an inactive child has no live agent, so
the host cannot run the command for it — only the Lead-side tool performs the
resume → compact → release cycle. This patch is therefore optional and left out
of the deployment on purpose.
