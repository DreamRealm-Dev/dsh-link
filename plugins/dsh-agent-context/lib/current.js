/**
 * dsh-agent-context — a Lead's window and handle on delegated-agent context.
 *
 * Why this package exists
 * -----------------------
 * In this deployment `dsh-web-app` moves the compaction backend out of the host
 * plane into every AGENT PRESET, and `/compact` is mounted there with it. That
 * is why a session can compact itself while the agent owning a delegated child
 * cannot see the child's pressure at all:
 *
 *  - a teammate or subagent session is a session with its own surface, and its
 *    automatic compaction only fires at the preset's pressure threshold (0.8 of
 *    the routed context window by default), which can be far away;
 *  - the Web composer refuses human commands for subagent sessions
 *    (`dsh-client-ui-commands` serves an empty command directory for a
 *    subagent-addressed session), so typing `/compact` in a child session is
 *    delivered to the child as ordinary text instead of compacting it;
 *  - nothing on the Lead's tool surface can measure or compact a child.
 *
 * This plugin closes the last gap with two model-facing tools for every agent
 * that actually delegates:
 *
 *  - `agent_context` — measured context status of every delegated agent the
 *                      caller can see (Team roster + live descendants), with
 *                      routed model, measured tokens, context window, pressure,
 *                      liveness, turn state, and reachability of `/compact`.
 *  - `compact_agent` — compacts ONE delegated agent's own history in place.
 *
 * How `compact_agent` reaches the backend
 * ---------------------------------------
 * `compaction` is a preset-realm service, so a host-plane plugin cannot resolve
 * `ctx.compaction` (verified live: `agent.ctx.get('compaction')` is undefined
 * for every agent, including its own preset's). The tool therefore drives the
 * SAME entry point the human `/compact` uses — `ctx.commands.execute(target,
 * '/compact', [], signal)` — which resolves the definition registered by
 * `dsh-command-compact` inside the target's own preset scope and calls
 * `compaction.compactNow(target, signal, commandId)` with the target as the
 * receiver. That path is backend-independent, needs no realm access, and writes
 * the ordinary `command/run`, `command/done`, and `compaction/*` records into
 * the TARGET session log, so the operation stays visible in the UI.
 *
 * Authority: a caller may compact itself, any member of the Team it leads, and
 * any of its own live descendants. Nothing else.
 *
 * Scope: the tools are installed into the scope of agents that participate in
 * delegation (Team members, agents with a parent, agents with live children),
 * mirroring how the shipped Team tools scope themselves, so a session that
 * never delegates pays nothing for this package.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Loader identity. */
export const name = 'agent-context'

/** The tool registry must be in scope to register model-facing tools. */
export const inject = ['tools']

/** Prompt section teaching the Lead when to reach for these tools. */
const SECTION_NAME = 'delegation:context'

/** Fallback order when the repository's own TEAM_POLICY placement is unavailable. */
const SECTION_ORDER_FALLBACK = 602

/** Two lines of policy, so the Lead compacts BEFORE a delegate hits the wall. */
const SECTION_TEXT = `Context of delegated agents (Agent Teams teammates and subagents):
- Read \`agent_context\` before piling more work onto a delegate and whenever one reports it is nearly out of context; it reports that agent's measured tokens, routed model, context window, and pressure.
- Free a delegate's context with \`compact_agent\` (its Team name, session id, or a unique id prefix): it compacts that agent's own history in place and reports what it freed. A teammate resting inactive is resumed for the operation and released again; a target that is mid-turn must be interrupted first. Report what you measured and what you compacted instead of guessing.`

/** Durable child rows never carry an empty name. */
const UNNAMED_AGENT = 'subagent'

/** Resolve loader configuration. */
function resolveConfig(config) {
  const source = config === undefined || config === null ? {} : config
  return {
    promptHint: source.promptHint !== false,
    reviveInactive: source.reviveInactive !== false,
    installRequiresDelegates: source.installRequiresDelegates === true,
    maxRows: Number.isSafeInteger(source.maxRows) && source.maxRows > 0 ? source.maxRows : 32,
    scanLimit: Number.isSafeInteger(source.scanLimit) && source.scanLimit > 0 ? source.scanLimit : 100000,
  }
}

/** One text content block. */
function textContent(text) {
  return [{ type: 'text', text }]
}

/** Tool output whose model-visible text is the report execute already built. */
function reportOutput(schema) {
  return {
    schema,
    render: (_args, value) => {
      if (value !== null && typeof value === 'object' && typeof value.report === 'string') return textContent(value.report)
      return textContent(JSON.stringify(value))
    },
  }
}

/** Read one message string without touching live service objects. */
function errorMessage(error) {
  if (error === undefined || error === null) return 'unknown error'
  if (typeof error.message === 'string' && error.message.length > 0) return error.message
  return String(error)
}

/** Read an optional string field as a scalar. */
function optionalText(value) {
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  if (value === undefined || value === null) return undefined
  return String(value)
}

/** Read an optional safe-integer field as a scalar. */
function optionalInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/** Run one synchronous probe without letting a broken row kill the report. */
function attempt(fn) {
  try {
    return fn()
  } catch (_error) {
    return undefined
  }
}

/** Await one probe without letting a rejection kill the report. */
async function attemptAsync(fn) {
  try {
    return await fn()
  } catch (_error) {
    return undefined
  }
}

/** Format a token count with thousands separators. */
function formatTokens(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
}

/**
 * Mirrors `dsh-compaction-basic`'s durable entry-state inspection: the newest
 * unmatched `compaction/start` after the newest `session/end-seed` is the
 * session's compaction lock, and an unmatched `turn/start` means the agent is
 * mid-turn, where any manual compaction answers "busy".
 */
function readEntryState(session, scanLimit) {
  let unmatchedStartSeq
  let compactionKnown = false
  let endSeed = false
  let openTurn = null
  let turnKnown = false
  const last = session.seq
  for (let offset = 0; offset < scanLimit; offset += 1) {
    const seq = last - 1 - offset
    if (seq < 0) break
    const event = session.eventAt(seq)
    if (event === undefined) break
    if (!endSeed && event.type === 'session/end-seed') endSeed = true
    if (!compactionKnown) {
      if (event.type === 'compaction/start') {
        unmatchedStartSeq = event.seq
        compactionKnown = true
      } else if (event.type === 'compaction/end') compactionKnown = true
    }
    if (!turnKnown) {
      if (event.type === 'turn/start') {
        openTurn = optionalInteger(event.data === undefined ? undefined : event.data.turn) ?? null
        turnKnown = true
      } else if (event.type === 'turn/end') turnKnown = true
    }
    if (compactionKnown && turnKnown && endSeed) break
  }
  return {
    locked: unmatchedStartSeq !== undefined,
    lockedAtSeq: optionalInteger(unmatchedStartSeq) ?? null,
    openTurn,
  }
}

/** The routed provider/model of one session, read as scalars. */
function readRoute(session) {
  const header = attempt(() => session.requestHeader())
  const config = header === undefined ? undefined : header.config
  const context = attempt(() => session.requestContext())
  return {
    provider: optionalText(config === undefined ? undefined : config.provider) ?? optionalText(context === undefined ? undefined : context.provider),
    model: optionalText(config === undefined ? undefined : config.model) ?? optionalText(context === undefined ? undefined : context.model),
    declaredWindow: optionalInteger(context === undefined ? undefined : context.contextWindow),
  }
}

/**
 * Collect every delegated agent the caller can see: owned scalars plus the live
 * Agent handle used only to call services.
 */
async function collectTargets(ctx, caller, signal) {
  const agents = ctx.get('agents')
  const team = ctx.get('agentTeams')
  const subagents = ctx.get('subagents')
  const rows = []
  const seen = new Set()
  const live = (agents === undefined ? undefined : attempt(() => agents.list())) ?? []
  const byId = new Map()
  for (const agent of live) byId.set(String(agent.id), agent)
  const callerId = String(caller.id)

  const children = (subagents === undefined ? undefined : await attemptAsync(() => subagents.listChildren(caller.id, signal))) ?? []
  const labelById = new Map()
  const childRows = []
  for (const entry of children) {
    // 0.2.x 的 listChildren 条目不再携带 `kind` 字段（只有 {id, createdAt} 加
    // {mode, label}），按 kind 过滤会把所有子代理滤掉，两个工具随之失明。
    if (entry === undefined) continue
    const id = optionalText(entry.id)
    if (id === undefined || id === callerId) continue
    const label = optionalText(entry.label) ?? UNNAMED_AGENT
    labelById.set(id, label)
    childRows.push({
      id,
      name: label,
      kind: entry.mode === 'continuable' ? 'subagent (continuable)' : 'subagent (one-shot)',
    })
  }

  const membership = team === undefined ? undefined : attempt(() => team.tryMembership(caller))
  if (team !== undefined && membership !== undefined) {
    const members = attempt(() => team.listMembers(caller)) ?? []
    for (const member of members) {
      const id = optionalText(member.id)
      if (id === undefined || id === callerId || seen.has(id)) continue
      seen.add(id)
      rows.push({
        id,
        name: optionalText(member.name) ?? UNNAMED_AGENT,
        kind: member.role === 'lead' ? 'teammate (lead)' : 'teammate',
        roster: optionalText(member.status),
        mode: 'continuable',
        revivable: true,
        agent: byId.get(id),
      })
    }
  }

  for (const row of childRows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push({
      ...row,
      roster: undefined,
      revivable: row.mode === 'continuable',
      agent: byId.get(row.id),
    })
  }

  const childrenOf = new Map()
  for (const agent of live) {
    const parent = optionalText(agent.session.header.parentSession)
    if (parent === undefined) continue
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(agent)
  }
  const queue = [callerId]
  const descendants = []
  while (queue.length > 0) {
    const parentId = queue.shift()
    for (const child of childrenOf.get(parentId) ?? []) {
      const id = String(child.id)
      descendants.push(child)
      queue.push(id)
    }
  }
  for (const agent of descendants) {
    const id = String(agent.id)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({ id, name: labelById.get(id) ?? UNNAMED_AGENT, kind: 'subagent (live child)', roster: undefined, mode: 'live', revivable: true, agent })
  }

  return rows
}

/** Decide whether one caller may act on one target row. */
function mayActOn(ctx, caller, row) {
  const callerId = String(caller.id)
  if (row.id === callerId) return true
  const team = ctx.get('agentTeams')
  if (team !== undefined) {
    const membership = attempt(() => team.tryMembership(caller))
    if (membership !== undefined && membership.role === 'lead') {
      const members = attempt(() => team.listMembers(caller)) ?? []
      for (const member of members) if (optionalText(member.id) === row.id) return true
    }
  }
  const agents = ctx.get('agents')
  let node = row.agent
  while (node !== undefined) {
    const parent = optionalText(node.session.header.parentSession)
    if (parent === undefined) return false
    if (parent === callerId) return true
    node = agents === undefined ? undefined : attempt(() => agents.get(parent))
  }
  return false
}

/** Resolve one agent token (Team name, session id, or unique id prefix). */
function matchRows(rows, token) {
  const needle = String(token).trim()
  if (needle.length === 0) return { matches: [], reason: 'empty target' }
  const lowered = needle.toLowerCase()
  const byName = rows.filter((row) => row.name.toLowerCase() === lowered)
  if (byName.length > 0) return { matches: byName }
  const exact = rows.filter((row) => row.id === needle)
  if (exact.length > 0) return { matches: exact }
  const prefixed = rows.filter((row) => row.id.startsWith(needle))
  if (prefixed.length === 1) return { matches: prefixed }
  if (prefixed.length > 1) return { matches: prefixed, reason: 'ambiguous id prefix' }
  return { matches: [] }
}

/** Measure one target row into owned scalars. */
async function describeRow(ctx, row, config, signal) {
  const entry = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    roster: row.roster,
    mode: row.mode,
    revivable: row.revivable === true,
    live: row.agent !== undefined,
  }
  if (row.agent === undefined) return entry
  const session = row.agent.session
  const tokenMeter = ctx.get('tokenMeter')
  const measurement = tokenMeter === undefined ? undefined : attempt(() => tokenMeter.measure(session))
  if (measurement !== undefined) {
    entry.tokens = optionalInteger(measurement.totalTokens)
    entry.surface = optionalInteger(measurement.surfaceTokens)
  }
  const route = readRoute(session)
  entry.provider = route.provider
  entry.model = route.model
  let contextWindow = route.declaredWindow
  const llm = ctx.get('llm')
  if (llm !== undefined && route.provider !== undefined && route.model !== undefined) {
    const info = await attemptAsync(() => llm.resolveModelInfo(route.provider, route.model, signal))
    const resolved = info === undefined ? undefined : optionalInteger(info.context === undefined ? undefined : info.context.contextWindow)
    if (resolved !== undefined) contextWindow = resolved
  }
  entry.contextWindow = contextWindow
  if (contextWindow !== undefined && contextWindow > 0 && entry.tokens !== undefined) {
    entry.usedPercent = Math.round((entry.tokens / contextWindow) * 1000) / 10
  }
  const state = attempt(() => readEntryState(session, config.scanLimit)) ?? { locked: false, lockedAtSeq: null, openTurn: null }
  entry.compactionLocked = state.locked
  entry.compactionLockedAtSeq = state.lockedAtSeq
  entry.openTurn = state.openTurn
  const commands = ctx.get('commands')
  entry.commandAvailable = commands === undefined ? undefined : attempt(() => commands.find(row.agent, 'compact') !== undefined)
  return entry
}

/** One human-auditable line per measured target. */
function formatRow(row) {
  const parts = [`- ${row.name} [${row.kind}] ${row.id}`]
  parts.push(row.live ? 'live' : `not live (${row.roster ?? 'inactive'})`)
  if (row.live && row.roster !== undefined) parts.push(row.roster)
  if (row.provider !== undefined || row.model !== undefined) parts.push(`${row.provider ?? '?'}/${row.model ?? '?'}`)
  if (row.tokens !== undefined) {
    const window = row.contextWindow === undefined ? 'unknown window' : formatTokens(row.contextWindow)
    const percent = row.usedPercent === undefined ? '' : ` (${row.usedPercent}%)`
    parts.push(`~${formatTokens(row.tokens)}/${window} tokens${percent}`)
  }
  if (row.live) {
    if (row.compactionLocked) parts.push(`compaction LOCKED at seq ${row.compactionLockedAtSeq}`)
    else if (row.openTurn !== null && row.openTurn !== undefined) parts.push(`mid-turn (turn ${row.openTurn})`)
    else parts.push('idle')
    parts.push(row.commandAvailable === true ? '/compact reachable' : '/compact NOT reachable in its scope')
  } else {
    parts.push(row.revivable ? 'compact_agent can resume it, compact it, then release it' : 'one-shot child: no agent can be resumed, compaction is no longer possible')
  }
  return parts.join(' · ')
}

/** Build both tools. */
function buildTools(ctx, config) {
  const contextTool = defineTool({
    name: 'agent_context',
    description: `Report the measured context status of the agents you delegated to: Agent Teams teammates and your own subagents. Each row carries the routed provider/model, measured tokens against that model's context window, the resulting pressure, whether the target is live, whether it is mid-turn or idle, whether a compaction is already in flight, and whether /compact resolves in its scope. Pass "target" (a Team name, session id, or unique id prefix) for one agent only. Call this before assigning more work to a delegate and whenever a delegate reports it is running out of context.`,
    parameters: {
      target: {
        type: 'string',
        description: 'Optional teammate name, session id, or unique session-id prefix. Omit to list every delegated agent you can see.',
      },
    },
    output: reportOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        report: { type: 'string', required: true },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
              kind: { type: 'string', required: true },
              live: { type: 'boolean', required: true },
              status: { type: 'string' },
              model: { type: 'string' },
              tokens: { type: 'integer' },
              contextWindow: { type: 'integer' },
              usedPercent: { type: 'number' },
              compaction: { type: 'string' },
              compactable: { type: 'boolean' },
              note: { type: 'string' },
            },
          },
        },
      },
    }),
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === undefined) throw new Error('agent_context requires an agent Session')
      const all = await collectTargets(ctx, caller, exec.signal)
      const token = args === null || args === undefined ? undefined : optionalText(args.target)
      let selected = all
      let note
      if (token !== undefined) {
        const matched = matchRows(all, token)
        if (matched.matches.length === 0) throw new Error(`agent_context: no delegated agent matches "${token}"`)
        if (matched.matches.length > 1) {
          throw new Error(`agent_context: "${token}" is ambiguous — candidates: ${matched.matches.map((row) => `${row.name} (${row.id})`).join(', ')}`)
        }
        selected = matched.matches
      }
      if (selected.length > config.maxRows) {
        note = `showing ${config.maxRows} of ${selected.length} rows`
        selected = selected.slice(0, config.maxRows)
      }
      const described = []
      for (const row of selected) described.push(await describeRow(ctx, row, config, exec.signal))
      const lines = []
      if (described.length === 0) lines.push('No delegated agents: no Team roster rows and no subagent children are visible to you.')
      else lines.push(`Delegated agent context (${described.length}):`)
      for (const row of described) lines.push(formatRow(row))
      if (note !== undefined) lines.push(`(${note})`)
      return {
        report: lines.join('\n'),
        rows: described.map((row) => {
          const out = { id: row.id, name: row.name, kind: row.kind, live: row.live }
          if ((row.kind === 'teammate' || row.kind === 'teammate (lead)') && row.roster !== undefined) out.status = row.roster
          if (row.provider !== undefined || row.model !== undefined) out.model = `${row.provider ?? '?'}/${row.model ?? '?'}`
          if (row.tokens !== undefined) out.tokens = row.tokens
          if (row.contextWindow !== undefined) out.contextWindow = row.contextWindow
          if (row.usedPercent !== undefined) out.usedPercent = row.usedPercent
          if (row.live) {
            if (row.compactionLocked) out.compaction = `locked at seq ${row.compactionLockedAtSeq}`
            else if (row.openTurn !== null && row.openTurn !== undefined) out.compaction = `mid-turn ${row.openTurn}`
            else out.compaction = 'idle'
            out.compactable = row.commandAvailable === true
          } else {
            out.compaction = row.revivable ? 'inactive (resumable)' : 'inactive (one-shot, not resumable)'
            out.compactable = row.revivable === true
            out.note = row.revivable === true
              ? 'compact_agent resumes this session from persistence, compacts it, then releases it again'
              : 'a finished one-shot child has no agent to resume, so its history can no longer be compacted'
          }
          return out
        }),
      }
    },
  })

  const compactTool = defineTool({
    name: 'compact_agent',
    description: `Compact one delegated agent's own context in place — the same operation as the human /compact, addressed to that teammate or subagent instead of to you. It replaces the target's oldest history with a summary and keeps its recent tail, so a long-running delegate can continue instead of dying at the context limit. A target that is mid-turn must be interrupted first (interrupt_agent); an inactive teammate is resumed from persistence, compacted, and released again, while a one-shot child that already finished can no longer be compacted. Returns what was compacted, or why it could not run.`,
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Teammate name, session id, or a unique session-id prefix of the agent whose context should be compacted.',
      },
      reason: {
        type: 'string',
        description: 'Optional one-line reason recorded for the reader; it does not change the operation.',
      },
    },
    output: reportOutput({
      type: 'object',
      additionalProperties: false,
      properties: {
        report: { type: 'string', required: true },
        ok: { type: 'boolean', required: true },
        target: { type: 'string' },
        name: { type: 'string' },
        reason: { type: 'string' },
      },
    }),
    async execute(args, exec) {
      const caller = exec.agent
      if (caller === undefined) throw new Error('compact_agent requires an agent Session')
      const token = args === null || args === undefined ? undefined : optionalText(args.target)
      if (token === undefined) throw new Error('compact_agent requires a target (teammate name, session id, or unique id prefix)')
      const all = await collectTargets(ctx, caller, exec.signal)
      const matched = matchRows(all, token)
      if (matched.matches.length === 0) {
        const known = all.length === 0 ? 'no delegated agents are visible' : `known targets: ${all.map((row) => `${row.name} (${row.id})`).join(', ')}`
        return { report: `compact_agent: no delegated agent matches "${token}" — ${known}.`, ok: false, reason: 'unknown-target' }
      }
      if (matched.matches.length > 1) {
        return {
          report: `compact_agent: "${token}" is ambiguous — candidates: ${matched.matches.map((row) => `${row.name} (${row.id})`).join(', ')}.`,
          ok: false,
          reason: 'ambiguous-target',
        }
      }
      const row = matched.matches[0]
      if (!mayActOn(ctx, caller, row)) {
        return {
          report: `compact_agent: ${row.name} (${row.id}) is not yours to compact — you may compact yourself, the teammates you lead, and your own descendants.`,
          ok: false,
          target: row.id,
          reason: 'not-authorized',
        }
      }
      if (row.agent === undefined && (config.reviveInactive !== true || row.revivable !== true)) {
        return {
          report: `compact_agent: ${row.name} (${row.id}) is not live (${row.roster ?? 'inactive'}) and cannot be resumed, so its compaction backend cannot run. A one-shot child that already finished cannot be compacted at all.`,
          ok: false,
          target: row.id,
          name: row.name,
          reason: 'not-live',
        }
      }
      const commands = ctx.get('commands')
      if (commands === undefined) {
        return { report: 'compact_agent: the human-command registry is not mounted, so /compact cannot be addressed.', ok: false, target: row.id, name: row.name, reason: 'no-command-registry' }
      }

      // An inactive continuable child has no Agent to run maintenance on, so a
      // compaction can only happen after resuming its persisted session. The
      // resume mirrors the subagent registry's own cold-resume setup (join the
      // parent's preset), runs under this caller as the live parent, and is
      // released again once the compaction has been written.
      let live = row.agent
      let resumed
      if (live === undefined) {
        const agents = ctx.get('agents')
        if (agents === undefined) {
          return { report: 'compact_agent: the agent registry is not mounted, so an inactive target cannot be resumed.', ok: false, target: row.id, name: row.name, reason: 'no-agent-registry' }
        }
        const handle = await attemptAsync(() => agents.resume({
          resumeSessionId: row.id,
          parentAgent: caller,
          signal: exec.signal,
          setup: (childCtx) => {
            attempt(() => childCtx.get('agentPresets')?.composeFrom(childCtx, caller.ctx))
          },
        }))
        if (handle === undefined || handle.agent === undefined) {
          return {
            report: `compact_agent: could not resume ${row.name} (${row.id}) from persistence, so its history could not be compacted.`,
            ok: false,
            target: row.id,
            name: row.name,
            reason: 'resume-failed',
          }
        }
        live = handle.agent
        resumed = handle
      }
      try {
        if (attempt(() => commands.find(live, 'compact') !== undefined) !== true) {
          return {
            report: `compact_agent: ${row.name} (${row.id}) does not resolve /compact in its own scope, so its compaction backend cannot be reached. Check that its agent preset mounts the compaction group (compaction-basic + command-compact).`,
            ok: false,
            target: row.id,
            name: row.name,
            reason: 'command-unavailable',
          }
        }
        const state = attempt(() => readEntryState(live.session, config.scanLimit)) ?? { locked: false, lockedAtSeq: null, openTurn: null }
        if (state.locked) {
          return {
            report: `compact_agent: ${row.name} (${row.id}) already holds a compaction (unfinished compaction/start at seq ${state.lockedAtSeq}); wait for it to settle before retrying.`,
            ok: false,
            target: row.id,
            name: row.name,
            reason: 'compaction-locked',
          }
        }
        let execution
        try {
          execution = await commands.execute(live, '/compact', [], exec.signal)
        } catch (error) {
          return {
            report: `compact_agent: compacting ${row.name} (${row.id}) failed: ${errorMessage(error)}`,
            ok: false,
            target: row.id,
            name: row.name,
            reason: 'threw',
          }
        }
        if (execution === undefined) {
          return {
            report: `compact_agent: /compact did not resolve for ${row.name} (${row.id}) at execution time.`,
            ok: false,
            target: row.id,
            name: row.name,
            reason: 'unresolved',
          }
        }
        const result = execution.result
        const message = optionalText(result.text) ?? ''
        const revived = resumed === undefined ? '' : ' (resumed from persistence for this compaction)'
        if (result.kind === 'error') {
          const busy = /not idle|active compaction/iu.test(message)
          const hint = busy ? ' The target was mid-turn or another compaction was running; call interrupt_agent, wait for that turn to end, then retry.' : ''
          return {
            report: `compact_agent: could not compact ${row.name} (${row.id})${revived}: ${message}${hint}`,
            ok: false,
            target: row.id,
            name: row.name,
            reason: busy ? 'busy' : 'failed',
          }
        }
        const requested = args === null || args === undefined ? undefined : optionalText(args.reason)
        const suffix = requested === undefined ? '' : ` (requested: ${requested})`
        return {
          report: `compact_agent: ${row.name} (${row.id})${revived} — ${message}${suffix}`,
          ok: true,
          target: row.id,
          name: row.name,
        }
      } finally {
        if (resumed !== undefined) await attemptAsync(() => resumed.dispose())
      }
    },
  })

  return [contextTool, compactTool]
}

/**
 * Install the prompt section and both tools for one delegation-participating
 * agent scope, returning the exact disposer that removes them again.
 */
function installScope(scope, services, config, helpers) {
  const disposers = []
  const prompt = scope.get('systemPrompt')
  if (prompt !== undefined && config.promptHint) {
    let order = SECTION_ORDER_FALLBACK
    try {
      order = prompt.getSectionOrder('TEAM_POLICY') + 1
    } catch (_error) {
      order = SECTION_ORDER_FALLBACK
    }
    disposers.push(prompt.section({ name: SECTION_NAME, order, text: SECTION_TEXT }))
  }
  for (const tool of buildTools(services, config)) disposers.push(helpers.register(scope, tool))
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (_error) {
        // A scope being torn down may already have disposed its own registry.
      }
    }
  }
}

/**
 * Mount `agent_context` and `compact_agent` into every live and later-published
 * agent scope that participates in delegation.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const helpers = { define: defineTool, register: (scope, tool) => scope.tools.register(tool) }
  const installed = new Map()

  /**
   * Whether one agent either delegates, is delegated to, or belongs to a Team.
   *
   * `tryMembership` reports `lead` for EVERY root agent — an empty Team is still
   * a Team — so the default is deliberately broad: every session gets the two
   * tools and no session has to be reopened to gain them. Set
   * `installRequiresDelegates: true` to require a durable roster of more than one
   * member (or a parent / live child) instead, which keeps plain sessions and the
   * `minimal` preset free of the extra schemas.
   */
  const participatesInDelegation = (agent, parentIds) => {
    if (agent.session.header.parentSession !== undefined) return true
    if (parentIds.has(String(agent.id))) return true
    const team = ctx.get('agentTeams')
    if (team === undefined) return false
    if (resolved.installRequiresDelegates !== true) return attempt(() => team.tryMembership(agent)) !== undefined
    const members = attempt(() => team.listMembers(agent)) ?? []
    return members.length > 1
  }

  const maybeInstall = () => {
    const agents = ctx.get('agents')
    if (agents === undefined) return
    const live = attempt(() => agents.list()) ?? []
    const parentIds = new Set()
    for (const agent of live) {
      const parent = optionalText(agent.session.header.parentSession)
      if (parent !== undefined) parentIds.add(parent)
    }
    for (const agent of live) {
      if (installed.has(agent)) continue
      if (!participatesInDelegation(agent, parentIds)) continue
      installed.set(agent, installScope(agent.ctx, ctx, resolved, helpers))
    }
    for (const [agent, dispose] of [...installed]) {
      if (live.includes(agent)) continue
      installed.delete(agent)
      dispose()
    }
  }

  maybeInstall()
  ctx.on('agent/created', () => maybeInstall())
  ctx.on('agent/disposed', () => maybeInstall())
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'agent-context.scopedTools()')
}
