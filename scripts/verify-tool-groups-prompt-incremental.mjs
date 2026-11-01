#!/usr/bin/env node
/**
 * Gate 130 (R194-P4) - tool-groups-prompt-incremental: WHICH SURFACE MOVES WHEN THE PROMPT
 * CHANGES, AND WHETHER A GROUP DECLARATION MOVES IT AT ALL.
 *
 * Subject: the shipped tool-group row (plugins/dsh-link-groups/lib/index.js), the shipped notes row
 * (plugins/dsh-link-notes/lib/index.js - the one shipped feature whose change is a system prompt
 * write), and the kernel's system-prompt admission they run under
 * (packages/core/agent-loop/src/runtime-context.ts:88-103, packages/core/agent-loop/src/agent.ts:404-418).
 * Authority: docs/handoff/R194-contract.md section 2 deliverable P4 and the audit's G-B spec in
 * .tmp/r194-groups/report.md. Written by a verifier who wrote neither plugin nor kernel.
 *
 * THE WORLD IS THE REAL KERNEL RUNNING THE REAL AGENT LOOP. A fresh cordis Context mounts the
 * kernel's own LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime,
 * AgentRegistry and AgentLoop; the agent is minted by ctx.agentLoop.create(), so its scope, its
 * session and every request/header, system/message, developer/message, request/context and
 * tool/result below is a genuine kernel event. Both shipped rows are applied through their own
 * apply() on that same context. The ONE substituted service is the MODEL (a scripted LlmAdapter),
 * an external nondeterministic input the gate is allowed to script; the loop, the registries, the
 * session and both plugins stay real.
 *
 * TWO ROUTES, ONE SCRIPT, ONE PAIR OF ARTIFACT BYTES. The artifacts are read ONCE, before either
 * world is built, and the same bytes are staged into both, so a concurrent rebuild cannot make the
 * two routes two different products. Each route runs the same three turns: talk, write one note
 * through the mounted notes store, declare one tool group through the groups row's own
 * tool_groups_declare.
 *
 *   route A  resolveModel() declares systemPromptUpdate: 'in-history' AND toolUpdate: 'addition-only'
 *            - the exact capability pair the shipped capable catalog entry declares
 *            (packages/llm/llm-deepseek/src/models.ts:6-14).
 *   route B  resolveModel() declares neither field - the shape the live route carries
 *            (report.md section 2: request/context measured as {provider, model, contextWindow}).
 *
 * WHY ROUTE A CARRIES toolUpdate TOO. agent.ts:414 restarts the request series whenever the
 * assembled tools change on a route with no toolUpdate, and runtime-context.ts:95-99 then
 * consolidates the retained in-history node back into the head. A route that declares in-history
 * WITHOUT toolUpdate therefore cannot append across a tool-group declaration at all. That coupling
 * is measurable on demand with --bare-in-history and is not the green path's subject here, for the
 * same reason gate 115 is not reddened by what the pinned kernel does: the subject is the shipped
 * rows, not the kernel decision.
 *
 * Readings (eight, each of which can fail on its own evidence and each of which reads its own
 * bytes; a reading this harness cannot take is printed NOT MEASURED with its reason, never green):
 *
 *   A1 ROUTE A: the note's prompt change is ONE append, on the step after the write.
 *      Route A commits exactly two system/message events - the node-0 reservation on the first
 *      request and the append carrying the note - and never a replacement; the appended node
 *      carries the note text and the head node does not.
 *   A2 ROUTE A: the wire keeps its prefix and gains a system node.
 *      The adapter sees the system message at index 0 byte-identical before and after the note, a
 *      second system message at the END of the message list, and the pre-note message list as a
 *      byte-identical prefix of the post-note one.
 *   A3 ROUTE A: the group declaration writes NO system prompt, and slides once.
 *      After the declaration's tool call: zero system/message, exactly one request/header
 *      reason:'change', exactly one developer/message whose tool-addition rows are exactly the
 *      declared group's members and which is bound to that header.
 *   A4 ROUTE A: the in-history capability really reached the loop.
 *      The session's own request/context names systemPromptUpdate:'in-history' - read from the log,
 *      not from this gate's object.
 *   B1 ROUTE B: the note's prompt change is ONE replacement of the head node.
 *      Route B commits exactly two system/message events - the node-0 reservation and one replace
 *      whose startSeq/endSeq are that head node's own seq - and never appends after the head.
 *   B2 ROUTE B: the incapable route reshapes the wire system field.
 *      One system message before and after, and its bytes changed to carry the note.
 *   B3 ROUTE B: the group declaration writes NO system prompt, and slides once.
 *      The same claim as A3 on the route the live world actually runs.
 *   C1 The capability is not ignored: the two routes do not produce the same surface.
 *      The note step's surfaceOp differs by route (append vs replace), the wire system count
 *      differs (2 vs 1), and each route's request/context names its own capability.
 *
 * WHAT THIS GATE CANNOT JUDGE, named rather than reported as a pass. It scripts the model, so it
 * says nothing about how a real backend behaves and nothing about cache hit rates: it reads WHICH
 * SURFACE MOVES, which is a mechanism reading, not a provider's cache economics
 * (R194-contract.md section 3). It does not mount a PTC preset, does not create a child agent, and
 * does not restart a client. --bare-in-history reruns route A with systemPromptUpdate alone, which
 * is how the toolUpdate coupling named above is measured instead of assumed.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject could not be measured here: a
 * kernel module or a shipped artifact is missing, the world could not be built, or a wire reading
 * could not be attributed to a step. A reading that cannot be measured is never a pass.
 *
 * Usage: node scripts/verify-tool-groups-prompt-incremental.mjs [--groups-module <path>] [--notes-module <path>]
 *        [--bare-in-history] [--keep]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-groups', 'lib', 'index.js'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const BARE_IN_HISTORY = has('--bare-in-history')
const KEEP = has('--keep')
const GROUPS_MODULE = resolve(option('--groups-module', join(PROJECT, 'plugins', 'dsh-link-groups', 'lib', 'index.js')))
const NOTES_MODULE = resolve(option('--notes-module', join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js')))
const COLLAB_MODULE = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')

/** The kernel modules the two subjects import, by path, so plugin and world share ONE instance each. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent-loop': join(KERNEL, 'packages', 'core', 'agent-loop', 'lib', 'index.js'),
  '@deepseek-ai/dsh-llm': join(KERNEL, 'packages', 'llm', 'llm', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session-projection': join(KERNEL, 'packages', 'session', 'session-projection', 'lib', 'index.js'),
}

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sortNames = (list) => [...(Array.isArray(list) ? list : [])].sort()
const sha12 = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12)
const bytesOf = (text) => Buffer.byteLength(String(text), 'utf8')
const QUOTES = [String.fromCharCode(39), String.fromCharCode(34), String.fromCharCode(96)]

// ---------------------------------------------------------------------------
// The gate's own names and its own configuration. Every name below is written into the world by
// this file, so a reader can tell a gate fact from a work fact.
// ---------------------------------------------------------------------------
const AGENT_ID = 'gate130-agent'
const SENTINEL = 'gate130:head'
const SENTINEL_TEXT = 'GATE130-HEAD-SENTINEL'
const WRITE_TOOL = 'gate130_write_note'
const WRITE_CALL = 'gate130-call-write'
const DECLARE_TOOL = 'tool_groups_declare'
const DECLARE_CALL = 'gate130-call-declare'
const NOTE_TEXT = 'gate130-note-bravo-the-prompt-must-move-for-this'
const GROUP_ID = 'gate130-probe'
const GROUP_MEMBERS = ['gate130_alpha', 'gate130_beta']
const ROUTE_A = 'route-a-in-history'
const ROUTE_B = 'route-b-incapable'
/** The exact pair packages/llm/llm-deepseek/src/models.ts:6-14 ships for its capable entry. */
const CAPABLE = Object.freeze({ systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' })
/** The shipped groups row's shape, with this gate's own one group as the whole table. */
const GROUPS_CONFIG = Object.freeze({
  groups: [{ id: GROUP_ID, title: 'Gate 130 probe group', summary: 'one declaration, two members', tools: GROUP_MEMBERS, state: 'auto', auto: { when: 'declare' } }],
  catalogPreamble: 'Tools are organised in groups; a closed group costs no schema budget.',
  deferredNotice: true,
})

// ---------------------------------------------------------------------------
// Staging: each shipped artifact is loaded with its bare kernel imports rewritten onto the exact
// module paths this gate also imports, and its relative collaboration-bus import pointed at the
// shipped bytes, so plugin and world share ONE registry instance.
// ---------------------------------------------------------------------------
const substitutions = () => Object.assign({}, KERNEL_MODULES, { '../../dsh-link-collab/lib/index.js': COLLAB_MODULE })
const stageSource = (source) => {
  let text = source
  for (const [specifier, file] of Object.entries(substitutions())) {
    const url = pathToFileURL(file).href
    for (const quote of QUOTES) text = text.split(quote + specifier + quote).join(quote + url + quote)
  }
  return text
}

// ---------------------------------------------------------------------------
// The scripted model: the ONE substituted service. Each route declares its own capabilities on
// resolveModel(); everything else about the adapter is identical.
// ---------------------------------------------------------------------------
const textResponse = (text) => [
  { type: 'block-start', index: 0, blockType: 'text' },
  ...Array.from(text, (char) => ({ type: 'text-delta', index: 0, text: char })),
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const toolCallResponse = (rawCallId, name, args) => {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: rawCallId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index: 0, id: rawCallId, name, argumentsDelta: argumentsJson.slice(5) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: rawCallId, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}
const makeAdapter = (LlmAdapter, capabilities) => class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.requests = [] }
  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...capabilities.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: capabilities.systemPromptUpdate },
      ...capabilities.toolUpdate === undefined ? {} : { toolUpdate: capabilities.toolUpdate },
    })
  }
  async * stream(options) {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('the scripted model ran out of scripted answers')
    const chunks = typeof entry === 'function' ? entry(options) : entry
    for (const chunk of chunks) {
      if (options.signal !== undefined && options.signal.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** A registry-ready tool the group can mask. */
const memberTool = (defineTool, name) => defineTool({
  name,
  description: 'gate 130 group member ' + name,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: () => 'ran:' + name,
})

// ---------------------------------------------------------------------------
// Session readers. Every number the judge uses comes from one of these, over the kernel's own log.
// ---------------------------------------------------------------------------
const textOfContent = (content) => (Array.isArray(content) ? content : []).filter((block) => block !== null && block !== undefined && block.type === 'text').map((block) => String(block.text)).join('')
const keyOf = (turn, step) => String(turn) + ':' + String(step)
const stepRows = (all) => all.filter((event) => event.type === 'step/start').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  return { seq: event.seq, turn: data.turn, step: data.step, key: keyOf(data.turn, data.step) }
})
const commitRows = (all) => all.filter((event) => event.type === 'system/message').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const raw = event.surfaceOp
  const op = raw === 'append' ? 'append' : (raw !== null && raw !== undefined && typeof raw === 'object' ? 'replace' : 'none')
  const text = textOfContent(data.message === null || data.message === undefined ? [] : data.message.content)
  return { seq: event.seq, turn: data.turn, step: data.step, key: keyOf(data.turn, data.step), op, startSeq: op === 'replace' ? Number(raw.startSeq) : null, endSeq: op === 'replace' ? Number(raw.endSeq) : null, text, bytes: bytesOf(text) }
})
const headerRows = (all) => all.filter((event) => event.type === 'request/header').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const header = data.header === null || data.header === undefined ? {} : data.header
  return { seq: event.seq, reason: String(data.reason === undefined ? '' : data.reason), startsSeries: data.startsSeries === true, tools: (Array.isArray(header.tools) ? header.tools : []).map((tool) => String(tool.name)) }
})
const developerRows = (all) => all.filter((event) => event.type === 'developer/message').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const message = data.message === null || data.message === undefined ? {} : data.message
  const source = message.source === null || message.source === undefined ? {} : message.source
  const content = Array.isArray(message.content) ? message.content : []
  return {
    seq: event.seq,
    turn: data.turn,
    step: data.step,
    key: keyOf(data.turn, data.step),
    headerSeq: data.headerSeq === undefined ? null : data.headerSeq,
    source: String(source.kind === undefined ? '' : source.kind),
    additions: content.filter((block) => block !== null && block !== undefined && block.type === 'tool-addition').map((block) => String(block.toolName)),
    removals: content.filter((block) => block !== null && block !== undefined && block.type === 'tool-removal').map((block) => String(block.toolName)),
  }
})
const contextRows = (all) => all.filter((event) => event.type === 'request/context').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  return { seq: event.seq, provider: data.provider === undefined ? null : String(data.provider), model: data.model === undefined ? null : String(data.model), contextWindow: data.contextWindow === undefined ? null : Number(data.contextWindow), systemPromptUpdate: data.systemPromptUpdate === undefined ? null : String(data.systemPromptUpdate) }
})
const callRows = (all) => all.filter((event) => event.type === 'tool/call').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  return { seq: event.seq, callId: data.callId === undefined ? null : String(data.callId), name: String(data.name === undefined ? '' : data.name), turn: data.turn, step: data.step, key: keyOf(data.turn, data.step) }
})
const resultRows = (all) => all.filter((event) => event.type === 'tool/result').map((event) => {
  const data = event.data === null || event.data === undefined ? {} : event.data
  const message = data.message === null || data.message === undefined ? {} : data.message
  return { seq: event.seq, callId: message.toolCallId === undefined ? null : String(message.toolCallId), isError: message.isError === true, text: textOfContent(message.content) }
})
/** The wire, as the adapter received it: system nodes with their indices, roles, and tool names. */
const requestRows = (requests) => requests.map((request, at) => {
  const messages = Array.isArray(request.messages) ? request.messages : []
  const roleOf = (message) => String(message === null || message === undefined ? '' : message.role)
  const textOf = (message) => textOfContent(message === null || message === undefined ? [] : message.content)
  const system = messages.map((message, index) => ({ index, role: roleOf(message), text: textOf(message) })).filter((row) => row.role === 'system')
  return {
    at,
    roles: messages.map(roleOf),
    system,
    systemCount: system.length,
    nonSystem: messages.map((message, index) => ({ index, role: roleOf(message), text: textOf(message) })).filter((row) => row.role !== 'system'),
    tools: Array.isArray(request.tools) ? request.tools.map((tool) => String(tool.name)) : [],
  }
})

// ---------------------------------------------------------------------------
// One world: real kernel, real loop, both shipped rows, one scripted model.
// ---------------------------------------------------------------------------
const buildWorld = async (label, route, capabilities, subject) => {
  const world = {
    label,
    route,
    capabilities,
    fatal: null,
    steps: [],
    commits: [],
    headers: [],
    developers: [],
    contexts: [],
    calls: [],
    results: [],
    requests: [],
    surface: { nodes: [], contentGeneration: null },
    counts: {},
  }
  const root = mkdtempSync(join(tmpdir(), 'r194-g130-' + label + '-'))
  let ctx = null
  const close = async () => {
    try { if (ctx !== null) await ctx.fiber.dispose() } catch { /* the world is being thrown away */ }
    if (KEEP === true) console.log('        kept: ' + root)
    else { try { rmSync(root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
  }
  try {
    for (const [specifier, file] of Object.entries(substitutions())) {
      if (existsSync(file) === false) throw new Error('the module ' + specifier + ' is missing at ' + file + '; this gate mounts the real kernel and will not stand in a fake registry')
    }
    const staged = { groups: join(root, 'groups.mjs'), notes: join(root, 'notes.mjs'), ledger: join(root, 'ledger') }
    writeFileSync(staged.groups, stageSource(subject.groups.source))
    writeFileSync(staged.notes, stageSource(subject.notes.source))
    const notesModule = await import(pathToFileURL(staged.notes).href)
    const groupsModule = await import(pathToFileURL(staged.groups).href)
    if (typeof notesModule.appendNote !== 'function') throw new Error('the shipped notes artifact at ' + subject.notes.path + ' does not export appendNote, so this gate cannot write a note through it')

    const load = (key) => import(pathToFileURL(KERNEL_MODULES[key]).href)
    const { Context } = await load('@deepseek-ai/cordis')
    const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
    const { default: ToolRuntime, defineTool } = await load('@deepseek-ai/dsh-tools')
    const { default: SessionStore, SessionId } = await load('@deepseek-ai/dsh-session')
    const { default: AgentRegistry } = await load('@deepseek-ai/dsh-agent')
    const { default: AgentLoop } = await load('@deepseek-ai/dsh-agent-loop')
    const { default: SessionProjectionRegistry } = await load('@deepseek-ai/dsh-session-projection')
    const llm = await load('@deepseek-ai/dsh-llm')
    const LlmRuntime = llm.default === undefined ? llm.LlmRuntime : llm.default
    const { LlmAdapter, createUserMessage } = llm
    if (typeof LlmRuntime !== 'function' || typeof LlmAdapter !== 'function' || typeof createUserMessage !== 'function') {
      throw new Error('the kernel LLM runtime does not export the runtime, the adapter base class and createUserMessage (LlmRuntime=' + String(typeof LlmRuntime) + ', LlmAdapter=' + String(typeof LlmAdapter) + ', createUserMessage=' + String(typeof createUserMessage) + ')')
    }

    const script = [
      textResponse('route ' + route + ': first turn answered'),
      toolCallResponse(WRITE_CALL, WRITE_TOOL, { text: NOTE_TEXT }),
      textResponse('route ' + route + ': the note exists'),
      toolCallResponse(DECLARE_CALL, DECLARE_TOOL, { open: [GROUP_ID], why: 'gate 130: declare one group' }),
      textResponse('route ' + route + ': the group was declared'),
    ]
    const adapter = new (makeAdapter(LlmAdapter, capabilities))(script)
    const live = new Context()
    ctx = live
    await live.plugin(LlmRuntime)
    await live.plugin(SessionStore)
    await live.plugin(SessionProjectionRegistry)
    await live.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '', personaSuffix: '' })
    await live.plugin(ToolRuntime)
    await live.plugin(AgentRegistry)
    await live.plugin(AgentLoop, { agents: [] })
    live.llm.registerAdapter(['mock'], adapter)
    live.systemPrompt.section({ name: SENTINEL, order: 100, interpolate: false, text: () => SENTINEL_TEXT })
    for (const name of GROUP_MEMBERS) live.tools.register(memberTool(defineTool, name))
    live.tools.register(defineTool({
      name: WRITE_TOOL,
      description: 'gate 130 probe: append exactly one note through the mounted notes store own appendNote',
      parameters: { text: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async (args) => {
        const store = live.get('linkNotes')
        if (store === undefined) return 'gate130: the notes row published no store'
        const appended = await notesModule.appendNote(store, { text: String(args === null || args === undefined ? '' : args.text), tags: ['gate130'], author: 'gate130-writer' })
        return 'gate130-writer wrote one note ' + String(appended.id)
      },
    }))

    // The two shipped rows, applied on the host context by their own apply().
    await live.plugin(notesModule, { dir: staged.ledger })
    await live.plugin(groupsModule, GROUPS_CONFIG)

    const agent = await live.agentLoop.create(SessionId(AGENT_ID), { provider: 'mock', model: 'model' })
    const send = async (text) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    try {
      await send('one')
      await send('write one note')
      await send('declare one group')
    } catch (error) {
      world.fatal = 'the agent loop failed: ' + describe(error)
    }
    const all = agent.session.snapshotEvents()
    world.steps = stepRows(all)
    world.commits = commitRows(all)
    world.headers = headerRows(all)
    world.developers = developerRows(all)
    world.contexts = contextRows(all)
    world.calls = callRows(all)
    world.results = resultRows(all)
    world.requests = requestRows(adapter.requests)
    world.counts = { events: all.length, requests: world.requests.length, steps: world.steps.length }
    try {
      world.surface = { nodes: [...agent.session.surface.nodes].map(Number), contentGeneration: Number(agent.session.surface.contentGeneration) }
    } catch (error) {
      world.surface = { nodes: [], contentGeneration: null, why: describe(error) }
    }
  } catch (error) {
    world.fatal = describe(error)
  }
  return { world, close }
}

// ---------------------------------------------------------------------------
// The anchors: the step key of each scripted tool call, and the request that follows it. A request
// is only attributed to a step when the two lists line up one-for-one; when they do not, the wire
// readings are NOT MEASURED rather than guessed at.
// ---------------------------------------------------------------------------
const anchorsOf = (world) => {
  const stepOfCall = (callId) => {
    const call = world.calls.filter((row) => row.callId === callId)[0]
    return call === undefined ? null : { key: call.key, turn: call.turn, step: call.step, seq: call.seq }
  }
  const indexOfKey = (key) => world.steps.findIndex((row) => row.key === key)
  const keyAfter = (at) => {
    const index = at === null ? -1 : indexOfKey(at.key)
    return index === -1 || world.steps[index + 1] === undefined ? null : world.steps[index + 1].key
  }
  const requestAt = (key) => {
    const index = key === null ? -1 : indexOfKey(key)
    return index === -1 ? null : (world.requests[index] === undefined ? null : world.requests[index])
  }
  const write = stepOfCall(WRITE_CALL)
  const declare = stepOfCall(DECLARE_CALL)
  const afterWriteKey = keyAfter(write)
  const afterDeclareKey = keyAfter(declare)
  return {
    write,
    declare,
    afterWriteKey,
    afterDeclareKey,
    beforeNote: write === null ? null : requestAt(write.key),
    afterNote: requestAt(afterWriteKey),
    afterDeclaration: requestAt(afterDeclareKey),
    noteStepCommits: afterWriteKey === null ? [] : world.commits.filter((row) => row.key === afterWriteKey),
    declarationCommits: declare === null ? [] : world.commits.filter((row) => row.turn > declare.turn || (row.turn === declare.turn && row.step > declare.step)),
    headersAfterDeclaration: declare === null ? [] : world.headers.filter((row) => row.seq > declare.seq),
    developersAfterDeclaration: declare === null ? [] : world.developers.filter((row) => row.seq > declare.seq),
  }
}
/** Why the wire cannot be attributed to a step, or null when it can. */
const wireGap = (world) => {
  if (world === null) return 'the route world could not be built'
  if (world.steps.length === 0) return 'the session logged no step/start event, so a request cannot be attributed to a step'
  if (world.steps.length !== world.requests.length) return 'the session logged ' + String(world.steps.length) + ' step(s) but the adapter received ' + String(world.requests.length) + ' request(s), so requests cannot be attributed to steps'
  const anchors = anchorsOf(world)
  if (anchors.beforeNote === null || anchors.afterNote === null) return 'the note step (' + show(anchors.write === null ? null : anchors.write.key) + ') has no request pair to compare (' + show({ after: anchors.afterWriteKey }) + ')'
  return null
}
const declarationGap = (world) => {
  if (world === null) return 'the route world could not be built'
  const anchors = anchorsOf(world)
  if (anchors.declare === null) return 'the declaration tool call never reached the registry, so its step has no slide to read'
  return null
}
const describeCommits = (rows) => rows.map((row) => '#seq' + String(row.seq) + ' ' + row.key + ' ' + row.op + (row.startSeq === null ? '' : '(startSeq=' + String(row.startSeq) + ',endSeq=' + String(row.endSeq) + ')') + ' ' + String(row.bytes) + 'B')
const prefixHolds = (before, after) => {
  if (before === null || after === null) return false
  if (before.nonSystem.length > after.nonSystem.length) return false
  const left = before.nonSystem.map((row) => row.role + '\u0000' + row.text)
  const right = after.nonSystem.map((row) => row.role + '\u0000' + row.text)
  return left.every((line, at) => right[at] === line)
}

// ---------------------------------------------------------------------------
// The judge: one pure reading per claim, over the world measured above.
// ---------------------------------------------------------------------------
const judge = (a, b) => {
  const out = []
  const add = (id, ok, detail, evidence) => out.push({ id, ok: ok === null ? null : ok === true, detail: String(detail), evidence: (Array.isArray(evidence) ? evidence : []).map((line) => String(line)) })
  const slice = (world, key) => (world === null ? [] : world[key])

  // A1 -- route A: the note change is ONE append of a NEW node.
  {
    const gap = a === null ? 'the route A world could not be built' : null
    if (gap !== null) add('A1', null, gap, [])
    else {
      const at = anchorsOf(a)
      const commits = at.noteStepCommits
      const appends = commits.filter((row) => row.op === 'append')
      const beforeThisStep = a.commits.filter((row) => row.seq < (commits[0] === undefined ? Number.MAX_SAFE_INTEGER : commits[0].seq))
      const replacementsBefore = beforeThisStep.filter((row) => row.op === 'replace')
      const described = describeCommits(commits)
      const ok = commits.length === 1 && appends.length === 1 && replacementsBefore.length === 0
        && appends[0].text.includes(NOTE_TEXT)
        && beforeThisStep.every((row) => row.op === 'append') && beforeThisStep.length === 1
      add('A1', ok, 'the note step (' + show(at.afterWriteKey) + ') committed ' + String(commits.length) + ' system/message ' + show(described)
        + '; the ' + String(beforeThisStep.length) + ' earlier commit(s) in the session are ' + show(beforeThisStep.map((row) => row.op))
        + ' and ' + String(replacementsBefore.length) + ' of them replaced anything',
      ['every system/message route A committed: ' + show(a.commits.map((row) => ({ key: row.key, op: row.op, startSeq: row.startSeq, bytes: row.bytes, carriesTheNote: row.text.includes(NOTE_TEXT) }))),
        'the step the note was written in: ' + show(at.write === null ? null : { key: at.write.key, callId: WRITE_CALL }),
        'the tool result that wrote the note: ' + show(slice(a.results.filter((row) => row.callId === WRITE_CALL), 0))])
    }
  }

  // A2 -- route A: the wire keeps its prefix and gains a node at the end.
  {
    const gap = wireGap(a)
    if (gap !== null) add('A2', null, gap, [])
    else {
      const at = anchorsOf(a)
      const before = at.beforeNote
      const after = at.afterNote
      const headSame = before.system[0].text === after.system[0].text
      const prefix = prefixHolds(before, after)
      const last = after.system[after.system.length - 1]
      const ok = before.systemCount === 1 && after.systemCount === 2
        && headSame === true && prefix === true
        && last.index === after.roles.length - 1
        && after.system.map((row) => row.text).join('\n').includes(NOTE_TEXT)
        && before.system.map((row) => row.text).join('\n').includes(NOTE_TEXT) === false
      add('A2', ok, 'route A sent ' + String(before.systemCount) + ' system node(s) before the note and ' + String(after.systemCount) + ' after; the head bytes are unchanged: '
        + show(headSame) + ', the pre-note message list is a byte-identical prefix of the post-note one: ' + show(prefix)
        + ', the new system node sits at wire index ' + String(last.index) + ' of ' + String(after.roles.length) + ' messages',
      ['system node indices before: ' + show(before.system.map((row) => row.index)) + ' after: ' + show(after.system.map((row) => row.index)),
        'wire roles after the note: ' + show(after.roles),
        'the pre-note head text: ' + show(before.system[0].text),
        'the appended node text: ' + show(last.text)])
    }
  }

  // A3 -- route A: the declaration writes NO system prompt, and slides once.
  {
    const gap = declarationGap(a)
    if (gap !== null) add('A3', null, gap, [])
    else {
      const at = anchorsOf(a)
      const changes = at.headersAfterDeclaration.filter((row) => row.reason === 'change')
      const developers = at.developersAfterDeclaration
      const additions = developers.flatMap((row) => row.additions)
      const removals = developers.flatMap((row) => row.removals)
      const ok = at.declarationCommits.length === 0 && changes.length === 1 && developers.length === 1
        && same(sortNames(additions), sortNames(GROUP_MEMBERS)) && removals.length === 0
        && developers[0].source === 'tool-registry' && developers[0].headerSeq === changes[0].seq
      add('A3', ok, 'after route A declared ' + GROUP_ID + ' at step ' + show(at.declare.key) + ' the session committed ' + String(at.declarationCommits.length) + ' system/message event(s)'
        + ', ' + String(changes.length) + ' request/header reason:change and ' + String(developers.length) + ' developer/message carrying ' + String(additions.length) + ' tool-addition row(s) ' + show(sortNames(additions)),
      ['the declaration answer: ' + show(slice(a.results.filter((row) => row.callId === DECLARE_CALL).map((row) => row.text.slice(0, 300)), 0)),
        'the developer/message rows the declaration produced: ' + show(developers.map((row) => ({ seq: row.seq, headerSeq: row.headerSeq, source: row.source, additions: row.additions, removals: row.removals }))),
        'the request/header rows after it: ' + show(at.headersAfterDeclaration.map((row) => ({ seq: row.seq, reason: row.reason, startsSeries: row.startsSeries, tools: row.tools.length }))),
        'the gate own member list of the group it declared: ' + show(sortNames(GROUP_MEMBERS))])
    }
  }

  // A4 -- route A: the capability reached the loop, read from the session log.
  {
    if (a === null) add('A4', null, 'the route A world could not be built, so its request/context cannot be read', [])
    else {
      const last = a.contexts[a.contexts.length - 1] === undefined ? null : a.contexts[a.contexts.length - 1]
      const ok = last !== null && last.systemPromptUpdate === 'in-history'
      add('A4', ok, 'route A logged ' + String(a.contexts.length) + ' request/context row(s); the last reads ' + show(last === null ? null : { provider: last.provider, model: last.model, systemPromptUpdate: last.systemPromptUpdate }),
      ['every request/context row: ' + show(a.contexts.map((row) => ({ seq: row.seq, provider: row.provider, model: row.model, contextWindow: row.contextWindow, systemPromptUpdate: row.systemPromptUpdate }))),
        'the capabilities this gate scripted onto route A resolveModel(): ' + show(a.capabilities)])
    }
  }

  // B1 -- route B: the note change is ONE replacement of the head node.
  {
    if (b === null) add('B1', null, 'the route B world could not be built', [])
    else {
      const at = anchorsOf(b)
      const commits = at.noteStepCommits
      const replaces = commits.filter((row) => row.op === 'replace')
      const head = b.commits[0] === undefined ? null : b.commits[0].seq
      const appendsAfterHead = b.commits.filter((row, index) => index > 0 && row.op === 'append')
      const ok = commits.length === 1 && replaces.length === 1 && head !== null
        && replaces[0].startSeq === head && replaces[0].endSeq === head
        && b.commits.length === 2 && appendsAfterHead.length === 0
        && replaces[0].text.includes(NOTE_TEXT)
      add('B1', ok, 'route B committed ' + String(b.commits.length) + ' system/message event(s) in the whole session; the note step (' + show(at.afterWriteKey) + ') committed '
        + String(commits.length) + ' ' + show(describeCommits(commits)) + '; the head node is #seq' + show(head) + ' and the replacement names it: '
        + show(replaces.length === 1 && replaces[0].startSeq === head),
      ['every system/message route B committed: ' + show(b.commits.map((row) => ({ key: row.key, op: row.op, startSeq: row.startSeq, endSeq: row.endSeq, bytes: row.bytes, carriesTheNote: row.text.includes(NOTE_TEXT) }))),
        'the surface the session folded: ' + show(b.surface.nodes) + ' with contentGeneration ' + show(b.surface.contentGeneration),
        'the tool result that wrote the note: ' + show(slice(b.results.filter((row) => row.callId === WRITE_CALL).map((row) => row.text), 0))])
    }
  }

  // B2 -- route B: the wire system field IS reshaped.
  {
    const gap = wireGap(b)
    if (gap !== null) add('B2', null, gap, [])
    else {
      const at = anchorsOf(b)
      const before = at.beforeNote.system[0]
      const after = at.afterNote.system[0]
      const ok = at.beforeNote.systemCount === 1 && at.afterNote.systemCount === 1
        && before.text !== after.text && after.text.includes(NOTE_TEXT)
      add('B2', ok, 'route B sent ' + String(at.beforeNote.systemCount) + ' system node(s) before the note and ' + String(at.afterNote.systemCount) + ' after; the head text moved: '
        + show(before.text !== after.text) + ', ' + String(bytesOf(before.text)) + ' B -> ' + String(bytesOf(after.text)) + ' B',
      ['the pre-note head text: ' + show(before.text),
        'the post-note head text: ' + show(after.text)])
    }
  }

  // B3 -- route B: the declaration writes NO system prompt, and slides once.
  {
    const gap = declarationGap(b)
    if (gap !== null) add('B3', null, gap, [])
    else {
      const at = anchorsOf(b)
      const changes = at.headersAfterDeclaration.filter((row) => row.reason === 'change')
      const developers = at.developersAfterDeclaration
      const additions = developers.flatMap((row) => row.additions)
      const removals = developers.flatMap((row) => row.removals)
      const ok = at.declarationCommits.length === 0 && changes.length === 1 && developers.length === 1
        && same(sortNames(additions), sortNames(GROUP_MEMBERS)) && removals.length === 0
        && developers[0].source === 'tool-registry' && developers[0].headerSeq === changes[0].seq
      add('B3', ok, 'after route B declared ' + GROUP_ID + ' at step ' + show(at.declare.key) + ' the session committed ' + String(at.declarationCommits.length) + ' system/message event(s)'
        + ', ' + String(changes.length) + ' request/header reason:change and ' + String(developers.length) + ' developer/message carrying ' + String(additions.length) + ' tool-addition row(s) ' + show(sortNames(additions)),
      ['the declaration answer: ' + show(slice(b.results.filter((row) => row.callId === DECLARE_CALL).map((row) => row.text.slice(0, 300)), 0)),
        'the developer/message rows the declaration produced: ' + show(developers.map((row) => ({ seq: row.seq, headerSeq: row.headerSeq, source: row.source, additions: row.additions, removals: row.removals }))),
        'the request/header rows after it: ' + show(at.headersAfterDeclaration.map((row) => ({ seq: row.seq, reason: row.reason, startsSeries: row.startsSeries, tools: row.tools.length }))),
        'the gate own member list of the group it declared: ' + show(sortNames(GROUP_MEMBERS))])
    }
  }

  // C1 -- the capability is not ignored: the two routes do not produce the same surface.
  {
    if (a === null || b === null) add('C1', null, 'one of the two route worlds could not be built, so the comparison has nothing to compare', [])
    else {
      const atA = anchorsOf(a)
      const atB = anchorsOf(b)
      const opA = atA.noteStepCommits.map((row) => row.op)
      const opB = atB.noteStepCommits.map((row) => row.op)
      const countA = atA.afterNote === null ? null : atA.afterNote.systemCount
      const countB = atB.afterNote === null ? null : atB.afterNote.systemCount
      const contextA = a.contexts[a.contexts.length - 1] === undefined ? null : a.contexts[a.contexts.length - 1]
      const contextB = b.contexts[b.contexts.length - 1] === undefined ? null : b.contexts[b.contexts.length - 1]
      const ok = same(opA, ['append']) && same(opB, ['replace'])
        && countA === 2 && countB === 1
        && contextA !== null && contextA.systemPromptUpdate === 'in-history'
        && contextB !== null && contextB.systemPromptUpdate === null
      add('C1', ok, 'the same note step produced ' + show(opA) + ' on route A and ' + show(opB) + ' on route B; the wire carried '
        + show(countA) + ' system node(s) on A against ' + show(countB) + ' on B; request/context named '
        + show({ a: contextA === null ? null : contextA.systemPromptUpdate, b: contextB === null ? null : contextB.systemPromptUpdate }),
      ['route A capabilities scripted: ' + show(a.capabilities) + '; route B capabilities scripted: ' + show(b.capabilities),
        'route A system/message ops: ' + show(a.commits.map((row) => row.op)) + '; route B system/message ops: ' + show(b.commits.map((row) => row.op))])
    }
  }

  return out
}

const safeJudge = (a, b) => {
  try {
    return { readings: judge(a, b), error: null }
  } catch (error) {
    return { readings: [], error: describe(error) }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

/** The artifacts, read ONCE so both routes measure the same bytes even if something rebuilds them. */
const readSubject = () => {
  const rows = {}
  for (const [key, path] of [['groups', GROUPS_MODULE], ['notes', NOTES_MODULE]]) {
    if (existsSync(path) === false) throw new Error('the shipped artifact is missing at ' + path + ' (run: node plugins/build.mjs)')
    const bytes = readFileSync(path)
    rows[key] = { path, bytes: bytes.length, sha12: sha12(bytes), source: bytes.toString('utf8') }
  }
  return rows
}

const main = async () => {
  const started = Date.now()
  const routeACapabilities = BARE_IN_HISTORY ? Object.freeze({ systemPromptUpdate: CAPABLE.systemPromptUpdate }) : CAPABLE
  let subject = null
  try { subject = readSubject() } catch (error) { return NOT_MEASURED(describe(error) + '; the subject of this gate is the two shipped artifacts') }
  console.log('  the subject (read once, staged into both routes): ' + show({ groups: { path: subject.groups.path, bytes: subject.groups.bytes, sha12: subject.groups.sha12 }, notes: { path: subject.notes.path, bytes: subject.notes.bytes, sha12: subject.notes.sha12 } }))
  console.log('  the world: the real kernel at ' + KERNEL + ' mounted as SystemPrompt / ToolRuntime / AgentRegistry / AgentLoop / Session, the agent minted by ctx.agentLoop.create(' + AGENT_ID + ')')
  console.log('  the routes: A declares ' + show(routeACapabilities) + ' on resolveModel(); B declares nothing (the live shape, report.md section 2)')
  console.log('  the script, identical on both: three turns - talk, one note through the mounted notes store, one ' + DECLARE_TOOL + ' of ' + GROUP_ID + ' ' + show(GROUP_MEMBERS))
  const runA = await buildWorld('a', ROUTE_A, routeACapabilities, subject)
  const runB = await buildWorld('b', ROUTE_B, Object.freeze({}), subject)
  const worlds = [runA.world, runB.world]
  const fatal = worlds.filter((world) => world.fatal !== null)
  if (fatal.length > 0) {
    await runA.close(); await runB.close()
    return NOT_MEASURED('a route world could not be built: ' + fatal.map((world) => world.label + ': ' + world.fatal).join(' | '))
  }
  for (const world of worlds) {
    console.log('        ' + world.label + ' (' + world.route + ', capabilities ' + show(world.capabilities) + '): ' + String(world.counts.events) + ' session events, '
      + String(world.counts.steps) + ' step(s), ' + String(world.counts.requests) + ' request(s), ' + String(world.commits.length) + ' system/message, '
      + String(world.headers.length) + ' request/header, ' + String(world.developers.length) + ' developer/message, ' + String(world.contexts.length) + ' request/context')
  }
  const judged = safeJudge(runA.world, runB.world)
  if (judged.error !== null) { console.log('  FAIL  the judge threw over these worlds: ' + judged.error); await runA.close(); await runB.close(); return 1 }
  const readings = judged.readings
  for (const [at, reading] of readings.entries()) {
    const mark = reading.ok === true ? 'ok  ' : (reading.ok === null ? 'n/a ' : 'FAIL')
    console.log('  ' + mark + ' ' + String(at + 1) + '. ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  const unmeasured = readings.filter((reading) => reading.ok === null)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(unmeasured.length) + ' not measured | route A ' + (BARE_IN_HISTORY ? 'in-history only' : 'in-history + addition-only') + ' | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  await runA.close()
  await runB.close()
  if (failed.length > 0) return 1
  if (unmeasured.length > 0) return 3
  return 0
}

process.exitCode = await main()
