#!/usr/bin/env node
/**
 * Gate 115 (R185-B) - tool-groups: A GROUP IS THE UNIT OF THE FACE, AND A CLOSED GROUP IS
 * NOTHING BUT A NAME THAT NEVER EXISTED.
 *
 * Subject: the tool-group mechanism of R185 (docs/handoff/R185-contract.md sections 3.1-3.4,
 * appendix C rulings 3/6/7; producer record docs/handoff/R185-A-groups.md), shipped in
 * plugins/dsh-link-groups/lib/index.js. Written by a verifier who wrote neither the plugin nor
 * its self-check.
 *
 * THE WORLD IS THE REAL KERNEL RUNNING THE REAL AGENT LOOP. A fresh cordis Context mounts the
 * kernel's own LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime,
 * AgentRegistry and AgentLoop; the agent is minted by ctx.agentLoop.create(), so its scope, its
 * session and every request/header, step and tool/result below are genuine kernel events. The
 * group members are registered through the real ctx.tools.register() on the GLOBAL layer - the
 * only layer a restriction can filter - and the plugin is applied by calling the shipped
 * apply() on that same context. Nothing here is a hand-written tool registry standing in for
 * the kernel: the one substituted service is the MODEL (a scripted LlmAdapter), which is an
 * external, nondeterministic input the gate is allowed to script, and whose substitution leaves
 * the loop, the tools registry, the session and the plugin untouched. That substitution is what
 * makes reading A1-A4 possible at all: the kernel's own "tool face slides by one step" log
 * protocol (packages/core/agent-loop/src/agent.ts:626-648) is only emitted by a real step.
 *
 * Every number below is this gate OWN arithmetic over bytes it reads itself from the live
 * surface (ctx.tools.schemas(agent)) and from the session log; the producer self-check is never
 * the evidence. The two producer numbers reading F2 compares against are PARSED OUT of the
 * producer record at run time, so a stale constant cannot pass for a reproduction.
 *
 * Readings (each of which can fail on its own evidence):
 *
 *   A1 A single tool call opens TWO groups and the answer says next-step, honestly.
 *      The model's call reached the real executor and returned one opened row per group, each
 *      claiming effective: next-step; the request the model was answering while it declared
 *      carried the PRE-change face, and the changed header belongs to the FOLLOWING step. A
 *      build that claims immediate, or that opens only part of what was named, reddens here.
 *   A2 One declaration, ONE developer message, every row in it.
 *      For the whole session there is exactly one developer/message with source.kind
 *      'tool-registry', bound by headerSeq to the session's single reason:'change' header, and
 *      it carries one tool-addition row per member of BOTH groups and no removal row.
 *   A4 A refused declaration adds no second slide.
 *      The typo group's declaration is refused and the session's developer/message and
 *      reason:'change' counts are the same after it as before it: one declaration is one slide.
 *   B1 The three configured states are three different things.
 *      state:on is open at install with no declaration and is not offered; state:auto is closed
 *      and offered now; state:off is closed and the directory says opening it needs approval.
 *   B2 The configured value and the actual state are two fields that never swap.
 *      Every row reads state= one of on|off|auto, the actual state appears only as the
 *      OPEN/closed word, and after the batch the opened auto group reads OPEN while its state=
 *      still reads auto.
 *   B3 A group turned off by configuration cannot be opened, and the refusal is named.
 *      Declaring it is denied with GROUPS_OFF, and the directory and the face are byte-for-byte
 *      what they were: the denial is a refusal, not a smaller change.
 *   B4 A group that is already open is a no-op refusal, not a second slide.
 *   B5 An id that is not in the catalog is refused by name, with the known ids.
 *   C1 The group is the unit: one call adds exactly the union of the members its groups declare.
 *      Measured name for name against the gate own reading of the configuration, and nothing
 *      that was visible before disappears.
 *   C2 Closing is the same mechanism in reverse.
 *      The relockable group closes: exactly its member leaves the face, by name, and answers as
 *      a tool that never existed; a group configured relockable false refuses by name and the
 *      face is name-for-name identical.
 *   C3 A group whose declared names reach nothing is named, not guessed at.
 *      Its row is not offered and carries GROUPS_NO_TOOLS; every other row and the activation
 *      pair are unaffected.
 *   C4 An unmet dependency is a named refusal, not a silent wait: GROUPS_DEPENDENCY, naming the
 *      group it waits for.
 *   D1 A closed group member is indistinguishable from a nonexistent tool AT THE EXECUTION FACE.
 *      The two failures are the same text apart from the name (packages/AGENTS.md: schema
 *      omission is not enforcement), and the paired call on an open member still runs.
 *   E1 The restriction that hides the closed members does not hide the activation pair.
 *      In the very state where 9 of the 11 registered members are masked the face is exactly
 *      the two members of the open group plus tool_groups and tool_groups_declare, and both
 *      answer; the pair is still there after the batch and after a close.
 *   F1 The cost trio the declaration reports is the face the gate measures.
 *      entries and bytes equal this gate arithmetic over the live ctx.tools.schemas(agent).
 *   F2 The same trio equals the numbers the producer recorded.
 *      entries/bytes/startsSeries are compared against the trio row PARSED from
 *      docs/handoff/R185-A-groups.md section 4.2 for this exact scene.
 *   F3 The reported startsSeries is the one the session actually held.
 *      Compared against the last request/header in the log before the declaration answered.
 *   G1 The directory carries no schema: no parameters/properties/schema/"type" substring.
 *   G2 A closed group costs nothing: at install no member of any closed group is on the face.
 *   H1 Unloading the plugin restores the pre-plugin face exactly, in order, pair gone.
 *   H2 ...and the restriction is really gone: a masked member answers again afterwards.
 *   I1 An agent created after the plugin is installed gets its own installation, with its own
 *      group state: the second agent reads the same closed group as closed while the first has
 *      it open.
 *
 * Self-attack: --self-attack rewrites the SHIPPED ARTIFACT OWN BYTES (one string replacement per
 * mutant, applied to the file this gate reads) and re-runs the whole measurement against that
 * build, so every mutant is anchored on the product itself rather than on a fixture. It asserts,
 * per mutant, that the set of readings that moved is exactly the declared set, prints the Chinese
 * sentence 声明集 == 观测集 for each, requires every reading to be covered by at least one
 * mutant, and includes a control mutant that changes nothing.
 *
 * WHAT THIS GATE CANNOT JUDGE. It drives the model through a scripted adapter, so it says nothing
 * about how a real backend behaves; it never takes an approval (GROUPS_DEPENDENCY, GROUPS_OFF,
 * GROUPS_NO_TOOLS, GROUPS_UNKNOWN are exercised, the approval path belongs to gate 116); it does
 * not drive requestAutoOpen (the "device" condition's own path); it does not create a child agent,
 * so cross-agent inheritance is unmeasured; and it reads one provider-independent cost trio, not
 * any provider cache hit rate. None of those is reported as a pass: they are simply not claims
 * this gate makes.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject could not be measured here: a
 * kernel module or the shipped artifact is missing, the producer record no longer carries the
 * trio row F2 compares against, or the world could not be built at all. A reading that cannot be
 * measured is never a pass, and a subject that is not here is a NAMED third state, never green.
 *
 * Usage: node scripts/verify-tool-groups.mjs [--module <path>] [--record <path>] [--self-attack] [--keep]
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const SELF_ATTACK = has('--self-attack')
const KEEP = has('--keep')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-groups', 'lib', 'index.js')))
const RECORD_PATH = resolve(option('--record', join(PROJECT, 'docs', 'handoff', 'R185-A-groups.md')))

/** The kernel modules the plugin imports, by path, so both sides share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
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

const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

/** The names this gate writes into the world, so a reader can tell a test fact from a work fact. */
const AGENT_A = 'gate115-agent-a'
const AGENT_B = 'gate115-agent-b'
const CALL_BATCH = 'gate115-call-batch'
const CALL_TYPO = 'gate115-call-typo'
const NEVER_REGISTERED = 'gate115_never_registered_at_all'
const UNKNOWN_ID = 'gate115-no-such-group'
/** The one name the configuration declares but nobody registers: C3 is built out of this typo. */
const TYPO_NAME = 'typo_never_registered'

/**
 * The configuration the plugin is given. It is the gate own data: every expectation below is
 * computed from THIS array, never from the plugin own report of it.
 */
const GROUPS = [
  { id: 'live', title: 'Always on', summary: 'the group that is never closed', tools: ['live_alpha', 'live_beta'], state: 'on' },
  { id: 'declared', title: 'Declared on demand', summary: 'the ordinary auto group', tools: ['declared_one', 'declared_two'], state: 'auto', auto: { when: 'declare' } },
  { id: 'off', title: 'Turned off by configuration', summary: 'closed, and a declaration needs approval', tools: ['off_one'], state: 'off' },
  { id: 'device-b', title: 'Opened by a condition', summary: 'a condition its own plugin observes', tools: ['device_b_one'], state: 'auto', auto: { when: 'device' } },
  { id: 'gated', title: 'Disabled by the user', summary: 'opens only through an approval', tools: ['gated_one', 'gated_two'], state: 'auto', auto: { when: 'declare' }, userDisabled: true },
  { id: 'dependent', title: 'After another group', summary: 'waits for a group that is never opened', tools: ['dependent_one'], state: 'auto', auto: { when: 'after', after: 'device-b' } },
  { id: 'torn', title: 'A configuration typo', summary: 'one name exists, one does not', tools: ['torn_one', TYPO_NAME], state: 'auto', auto: { when: 'declare' } },
  { id: 'relock', title: 'Relockable', summary: 'the one group that may be closed again', tools: ['relock_one'], state: 'auto', auto: { when: 'declare' }, relockable: true },
]
const CONFIG = { groups: GROUPS, deferredNotice: true }
const KNOWN_IDS = GROUPS.map((group) => group.id)
const REGISTERED = GROUPS.flatMap((group) => group.tools).filter((name) => name !== TYPO_NAME)
const OPENED_BY_THE_BATCH = ['declared', 'relock']
const BATCH_MEMBERS = GROUPS.filter((group) => OPENED_BY_THE_BATCH.includes(group.id)).flatMap((group) => group.tools)
const REACHABLE_IN_ONLY = GROUPS.filter((group) => group.state === 'on').flatMap((group) => group.tools)
const NEVER_OPENABLE = GROUPS.filter((group) => group.state !== 'on').flatMap((group) => group.tools).filter((name) => name !== TYPO_NAME)
const ACTIVATION = ['tool_groups', 'tool_groups_declare']

// ---------------------------------------------------------------------------
// The mutant set: each rewrites one string in the shipped artifact OWN bytes and declares
// exactly which readings must move. Anchored on the product, not on a fixture.
// ---------------------------------------------------------------------------
const MUTANTS = [
  {
    name: 'the-effective-point-becomes-a-lie',
    from: 'var EFFECTIVE = "next-step"',
    to: 'var EFFECTIVE = "immediate"',
    expect: ['A1'],
  },
  {
    name: 'one-call-opens-only-the-first-group',
    from: 'for (const id of openable) {',
    to: 'for (const id of openable.slice(0, 1)) {',
    // The mutant opens only the first of the two groups while the ANSWER still lists both, because
    // the applied rows are built from the named list rather than from what actually opened (two
    // separate loops over the same array today). A1 catches it through the next step's request,
    // and C1/C2/F2 catch the state and the cost it then reports.
    expect: ['A1', 'A2', 'C1', 'C2', 'F2'],
  },
  {
    name: 'the-typo-opens-anyway',
    from: 'if (installation.missing.length > 0) {',
    to: 'if (false) {',
    expect: ['A4', 'C3'],
  },
  {
    name: 'everything-is-open-at-install',
    from: 'return group.state === "on";',
    to: 'return true;',
    expect: ['A1', 'A2', 'B1', 'B3', 'C1', 'C3', 'C4', 'D1', 'E1', 'F1', 'F2', 'F3', 'G2', 'I1'],
  },
  {
    name: 'the-state-field-reports-the-actual-state',
    from: 'parts.push("state=" + row.state);',
    to: 'parts.push("state=" + (row.open ? "open" : "closed"));',
    expect: ['B2'],
  },
  {
    name: 'the-off-group-opens-without-anyone-answering',
    from: 'return { kind: "deny", reason: REFUSALS.OFF + ": the user turned this group off, so a declaration cannot open it: " + off.join(", ") };',
    to: 'return next();',
    expect: ['B3'],
  },
  {
    name: 'an-unknown-id-is-refused-under-another-name',
    from: 'refused.push(refuse(id, REFUSALS.UNKNOWN, "unknown group id; known ids: " + (knownList.join(", ") || "(none)")));',
    to: 'refused.push(refuse(id, REFUSALS.INPUT, "not in the catalog"));',
    expect: ['B5'],
  },
  {
    name: 'a-group-that-was-not-offered-opens-all-the-same',
    from: 'if (state.open[id] === true) {',
    to: 'if (false) {',
    expect: ['B4'],
  },
  {
    name: 'relockable-is-ignored',
    from: 'if (group.relockable !== true) {',
    to: 'if (false) {',
    expect: ['C2'],  // the same mutation would close a plain group; I1 captures both agents before and after, so it does not follow.
  },
  {
    name: 'the-dependency-is-not-checked',
    from: 'if (state.open[dependency] !== true) return { code: REFUSALS.DEPENDENCY,',
    to: 'if (false) return { code: REFUSALS.DEPENDENCY,',
    expect: ['C4'],
  },
  {
    name: 'a-closed-group-is-not-masked',
    from: 'const mask = (id) => {',
    to: 'const mask = (id) => { if (true) return;',
    expect: ['A1', 'A2', 'C1', 'C2', 'D1', 'E1', 'F2', 'G2', 'I1'],
  },
  {
    name: 'the-reported-entry-count-is-not-the-face',
    from: 'entries: schemas.length,',
    to: 'entries: schemas.length + 1,',
    expect: ['F1', 'F2'],
  },
  {
    name: 'the-reported-byte-count-is-not-the-face',
    from: 'bytes: Buffer.byteLength(JSON.stringify(schemas), "utf8"),',
    to: 'bytes: Buffer.byteLength(JSON.stringify(schemas), "utf8") + 1,',
    expect: ['F1', 'F2'],
  },
  {
    name: 'the-reported-series-flag-is-not-the-log',
    from: 'startsSeries: header !== void 0 && header.startsSeries === true,',
    to: 'startsSeries: true,',
    expect: ['F2', 'F3'],
  },
  {
    name: 'the-directory-leaks-a-schema',
    from: 'const lines = [config.catalogPreamble, ""]',
    to: 'const lines = [config.catalogPreamble + " parameters: {properties: {a: {type: \\"string\\"}}}", ""]',
    expect: ['G1'],
  },
  {
    name: 'unloading-leaves-the-mask-behind',
    from: 'record.dispose = () => {',
    to: 'record.dispose = () => { return;',
    expect: ['H1', 'H2'],
  },
  {
    name: 'an-agent-created-later-is-never-installed',
    from: 'ctx.on("agent/created", () => maybeInstall());',
    to: 'void 0;',
    expect: ['I1'],
  },
  { name: 'control-nothing-changed', from: null, to: null, expect: [] },
]
// ---------------------------------------------------------------------------
// Staging: the shipped artifact is loaded with its bare kernel imports rewritten onto the exact
// module paths this gate also imports, so the plugin and the world share ONE registry instance.
// ---------------------------------------------------------------------------
const stageSource = (source) => {
  let text = source
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '\u0060']) text = text.split(quote + specifier + quote).join(quote + url + quote)
  }
  return text
}

// ---------------------------------------------------------------------------
// The scripted model: the ONE substituted service (an external, nondeterministic input). The
// loop, the registry, the session and the plugin stay real.
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
const makeAdapter = (LlmAdapter, ToolCallId) => class ScriptedAdapter extends LlmAdapter {
  constructor(script) { super(); this.script = script; this.requests = [] }
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
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

/** A registry-ready group member. The description is the producer fixture own spelling. */
const toolFile = (defineTool, name) => defineTool({
  name,
  description: 'group member ' + name,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: () => 'ran:' + name,
})

/** The readings the gate takes of the live face: names, in the registry own order, and bytes. */
const faceNames = (ctx, agent) => ctx.tools.schemas(agent).map((tool) => tool.name)
const faceBytes = (ctx, agent) => Buffer.byteLength(JSON.stringify(ctx.tools.schemas(agent)), 'utf8')

// ---------------------------------------------------------------------------
// One world: real kernel, real loop, real plugin, scripted model.
// ---------------------------------------------------------------------------
const collect = async (label, mutate) => {
  const root = mkdtempSync(join(tmpdir(), 'r185-g115-' + label + '-'))
  const world = {
    label,
    root,
    fatal: null,
    artifact: { path: MODULE_PATH, mutated: mutate !== null, imports: [], bytes: 0, strippedMeaning: null },
    plugin: null,
    services: null,
    face: {},
    catalog: {},
    loop: { ran: false, error: null, requests: [], headers: [], developer: [], results: [], calls: [], counts: {} },
    exec: {},
    probes: {},
    second: null,
    teardown: null,
  }
  let ctx = null
  const close = async () => {
    try { if (ctx !== null) await ctx.fiber.dispose() } catch { /* the world is being thrown away */ }
    if (KEEP === true) console.log('        kept: ' + root)
    else { try { rmSync(root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
  }
  try {
    for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
      if (existsSync(file) === false) throw new Error('the kernel module ' + specifier + ' is missing at ' + file + '; this gate mounts the real kernel and will not stand in a fake registry')
    }
    if (existsSync(MODULE_PATH) === false) throw new Error('the shipped artifact is missing at ' + MODULE_PATH + ' (run: node plugins/build.mjs)')

    const shipped = readFileSync(MODULE_PATH, 'utf8')
    world.artifact.bytes = Buffer.byteLength(shipped, 'utf8')
    world.artifact.imports = [...shipped.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]).sort()
    const source = mutate === null ? shipped : mutate(shipped)
    if (mutate !== null) {
      world.artifact.mutatedBytes = Buffer.byteLength(source, 'utf8')
      world.artifact.strippedMeaning = source === shipped ? 'this mutant is a no-op on the shipped bytes' : null
    }
    const pluginFile = join(root, 'groups.mjs')
    writeFileSync(pluginFile, stageSource(source))
    const plugins = await import(pathToFileURL(pluginFile).href)
    world.plugin = {
      name: typeof plugins.name === 'string' ? plugins.name : null,
      inject: Array.isArray(plugins.inject) ? plugins.inject : null,
      hasDefault: plugins.default !== undefined,
      effective: typeof plugins.EFFECTIVE === 'string' ? plugins.EFFECTIVE : null,
      apply: typeof plugins.apply,
    }

    const { Context } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/cordis']).href)
    const { default: SystemPrompt } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-system-prompt']).href)
    const { default: ToolRuntime, defineTool } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-tools']).href)
    const { default: SessionStore, SessionId } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-session']).href)
    const { default: AgentRegistry } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-agent']).href)
    const { default: AgentLoop } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-agent-loop']).href)
    const { default: SessionProjectionRegistry } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-session-projection']).href)
    const llm = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-llm']).href)
    const LlmRuntime = llm.default === undefined ? llm.LlmRuntime : llm.default
    const { LlmAdapter, ToolCallId, createUserMessage } = llm
    if (typeof LlmRuntime !== 'function' || typeof LlmAdapter !== 'function' || typeof createUserMessage !== 'function') {
      throw new Error('the kernel LLM runtime does not export the runtime, the adapter base class and createUserMessage (LlmRuntime=' + String(typeof LlmRuntime) + ', LlmAdapter=' + String(typeof LlmAdapter) + ', createUserMessage=' + String(typeof createUserMessage) + ')')
    }
    const ScriptedAdapter = makeAdapter(LlmAdapter, ToolCallId)

    const script = [
      textResponse('first'),
      toolCallResponse(CALL_BATCH, 'tool_groups_declare', { open: OPENED_BY_THE_BATCH, why: 'gate 115: open two groups in one call' }),
      textResponse('two'),
      toolCallResponse(CALL_TYPO, 'tool_groups_declare', { open: ['torn'] }),
      textResponse('three'),
      textResponse('spare-1'), textResponse('spare-2'), textResponse('spare-3'), textResponse('spare-4'),
    ]
    const adapter = new ScriptedAdapter(script)
    const live = new Context()
    ctx = live
    await live.plugin(LlmRuntime)
    await live.plugin(SessionStore)
    await live.plugin(SessionProjectionRegistry)
    await live.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '' })
    await live.plugin(ToolRuntime)
    await live.plugin(AgentRegistry)
    await live.plugin(AgentLoop, { agents: [] })
    live.llm.registerAdapter(['mock'], adapter)
    for (const name of REGISTERED) live.tools.register(toolFile(defineTool, name))
    world.services = {
      tools: typeof live.tools.schemas,
      agents: typeof live.agents.list,
      loop: typeof live.agentLoop.create,
      llm: typeof live.llm.registerAdapter,
      registered: REGISTERED.length,
    }

    let probeCounter = 0
    const callTool = async (name, args, forAgent) => {
      probeCounter += 1
      try {
        const result = await live.tools.execute({
          signal: new AbortController().signal,
          callId: 'gate115-probe-' + String(probeCounter),
          name,
          arguments: args === undefined ? {} : args,
          agent: forAgent,
        })
        const block = result.content[0]
        return { ok: true, isError: result.isError === true, text: block !== undefined && block.type === 'text' ? block.text : show(result.content) }
      } catch (error) {
        return { ok: false, isError: true, text: 'Error: ' + describe(error) }
      }
    }
    const readFace = (forAgent) => ({ names: faceNames(live, forAgent), bytes: faceBytes(live, forAgent) })
    const readDirectory = async (forAgent) => (await callTool('tool_groups', {}, forAgent)).text
    const countsOf = (forAgent) => {
      const all = forAgent.session.snapshotEvents()
      return {
        developers: all.filter((event) => event.type === 'developer/message').length,
        headers: all.filter((event) => event.type === 'request/header').length,
        changes: all.filter((event) => event.type === 'request/header' && event.data !== null && event.data !== undefined && event.data.reason === 'change').length,
        toolResults: all.filter((event) => event.type === 'tool/result').length,
      }
    }
    const stepOf = (all, seq) => {
      let found = { turn: null, step: null }
      for (const event of all) {
        if (event.seq >= seq) break
        if (event.type === 'step/start' && event.data !== null && event.data !== undefined) found = { turn: event.data.turn, step: event.data.step }
      }
      return found
    }
    const textOf = (data) => {
      const message = data === null || data === undefined ? {} : data.message
      const content = message === null || message === undefined || Array.isArray(message.content) === false ? [] : message.content
      return content.filter((block) => block !== null && block !== undefined && block.type === 'text').map((block) => String(block.text)).join('')
    }

    const agent = await live.agentLoop.create(SessionId(AGENT_A), { provider: 'mock', model: 'model' })
    world.layers = { global: live.tools.schemas().map((tool) => tool.name) }
    world.face.before = readFace(agent)
    const fiber = live.plugin(plugins, CONFIG)
    await fiber
    world.face.afterInstall = readFace(agent)
    world.catalog.install = await callTool('tool_groups', {}, agent)

    // -- the loop scenes: one declaration of two groups, then one refused declaration --------
    const send = async (text) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    try {
      await send('first')
      await send('open the two groups')
      // The face the batch left behind, read BEFORE the next turn: what the batch did is a fact
      // about the batch, not about whatever a later declaration does.
      world.loop.counts.afterBatch = countsOf(agent)
      world.face.afterBatch = readFace(agent)
      world.catalog.afterBatch = await readDirectory(agent)
      await send('open the typo group')
      world.loop.ran = true
    } catch (error) {
      world.loop.error = describe(error)
    }
    world.loop.counts.final = countsOf(agent)
    world.loop.requests = adapter.requests.map((request, at) => ({ at, tools: Array.isArray(request.tools) ? request.tools.map((tool) => String(tool.name)) : [] }))
    const all = agent.session.snapshotEvents()
    world.loop.seq = agent.session.seq
    world.loop.headers = all.filter((event) => event.type === 'request/header').map((event) => {
      const data = event.data === null || event.data === undefined ? {} : event.data
      const header = data.header === null || data.header === undefined ? {} : data.header
      return {
        seq: event.seq,
        reason: String(data.reason === undefined ? '' : data.reason),
        startsSeries: data.startsSeries === true,
        tools: Array.isArray(header.tools) ? header.tools.map((tool) => String(tool.name)) : [],
        ...stepOf(all, event.seq),
      }
    })
    world.loop.developer = all.filter((event) => event.type === 'developer/message').map((event) => {
      const data = event.data === null || event.data === undefined ? {} : event.data
      const message = data.message === null || data.message === undefined ? {} : data.message
      const source = message.source === null || message.source === undefined ? {} : message.source
      const content = Array.isArray(message.content) ? message.content : []
      return {
        seq: event.seq,
        headerSeq: data.headerSeq === undefined ? null : data.headerSeq,
        source: String(source.kind === undefined ? '' : source.kind),
        rows: content.map((block) => ({ type: String(block.type === undefined ? '' : block.type), toolName: String(block.toolName === undefined ? '' : block.toolName) })),
        ...stepOf(all, event.seq),
      }
    })
    world.loop.results = all.filter((event) => event.type === 'tool/result').map((event) => {
      const data = event.data === null || event.data === undefined ? {} : event.data
      const message = data.message === null || data.message === undefined ? {} : data.message
      return {
        seq: event.seq,
        callId: message.toolCallId === undefined ? null : String(message.toolCallId),
        isError: message.isError === true,
        text: textOf(data),
        ...stepOf(all, event.seq),
      }
    })
    world.loop.calls = all.filter((event) => event.type === 'tool/call').map((event) => {
      const data = event.data === null || event.data === undefined ? {} : event.data
      return { seq: event.seq, callId: data.callId === undefined ? null : String(data.callId), name: String(data.name === undefined ? '' : data.name), ...stepOf(all, event.seq) }
    })
    world.loop.batch = world.loop.results.filter((row) => row.callId === CALL_BATCH)[0] === undefined ? null : world.loop.results.filter((row) => row.callId === CALL_BATCH)[0]
    world.loop.typo = world.loop.results.filter((row) => row.callId === CALL_TYPO)[0] === undefined ? null : world.loop.results.filter((row) => row.callId === CALL_TYPO)[0]

    // -- the execution face: a closed member, a name that never existed, an open member -------
    world.exec.closed = await callTool('off_one', {}, agent)
    world.exec.ghost = await callTool(NEVER_REGISTERED, {}, agent)
    world.exec.open = await callTool('live_alpha', {}, agent)
    world.exec.openedByBatch = await callTool('declared_one', {}, agent)
    world.exec.lookup = {
      closed: live.tools.get('off_one', agent) === undefined ? 'absent' : 'present',
      ghost: live.tools.get(NEVER_REGISTERED, agent) === undefined ? 'absent' : 'present',
      open: live.tools.get('live_alpha', agent) === undefined ? 'absent' : 'present',
    }

    // -- a group turned off by configuration, and an id that is not in the catalog -------------
    const probeUnchanged = async (args) => {
      const before = { names: faceNames(live, agent), directory: await readDirectory(agent) }
      const answer = await callTool('tool_groups_declare', args, agent)
      const after = { names: faceNames(live, agent), directory: await readDirectory(agent) }
      return { args, answer, before, after, moved: same(before, after) === false }
    }
    world.probes.off = await probeUnchanged({ open: ['off'] })
    world.probes.alreadyOpen = await probeUnchanged({ open: [GROUPS.filter((group) => group.state === 'on')[0].id] })
    world.probes.unknown = await probeUnchanged({ open: [UNKNOWN_ID] })
    world.probes.dependency = await probeUnchanged({ open: ['dependent'] })

    // -- closing in reverse: the relockable group closes, a plain group refuses ----------------
    const closeBefore = { names: faceNames(live, agent), directory: await readDirectory(agent) }
    world.probes.closeRelock = {
      args: { close: ['relock'] },
      answer: await callTool('tool_groups_declare', { close: ['relock'] }, agent),
      before: closeBefore,
    }
    world.exec.afterClose = await callTool('relock_one', {}, agent)
    world.exec.stillOpen = await callTool('declared_one', {}, agent)
    world.probes.closeRelock.after = { names: faceNames(live, agent), directory: await readDirectory(agent) }
    const plainBefore = { names: faceNames(live, agent), directory: await readDirectory(agent) }
    world.probes.closePlain = {
      args: { close: ['declared'] },
      answer: await callTool('tool_groups_declare', { close: ['declared'] }, agent),
      before: plainBefore,
    }
    world.probes.closePlain.after = { names: faceNames(live, agent), directory: await readDirectory(agent) }
    world.face.afterClose = readFace(agent)

    // -- a second agent, created after the plugin is installed ---------------------------------
    const agentB = await live.agentLoop.create(SessionId(AGENT_B), { provider: 'mock', model: 'model' })
    world.second = {
      face: readFace(agentB),
      before: await readDirectory(agentB),
      firstBefore: await readDirectory(agent),
      declareAnswer: await callTool('tool_groups_declare', { open: ['relock'] }, agentB),
      after: await readDirectory(agentB),
      firstAfter: await readDirectory(agent),
      faceAfter: readFace(agentB),
      pairAnswers: (await callTool('tool_groups', {}, agentB)).ok,
    }

    // -- teardown: unload the plugin and look at the scope again -------------------------------
    await fiber.dispose()
    world.teardown = {
      face: readFace(agent),
      directory: await readDirectory(agent),
      closedMember: await callTool('off_one', {}, agent),
      lookup: live.tools.get('off_one', agent) === undefined ? 'absent' : 'present',
    }
  } catch (error) {
    world.fatal = describe(error)
  }
  return { world, close }
}

// ---------------------------------------------------------------------------
// Reading the directory the plugin renders. The gate parses the MODEL-FACING TEXT itself: that
// text is what the model sees, so a field the model cannot read is a field that does not exist.
// ---------------------------------------------------------------------------
const parseRow = (line) => {
  const body = line.slice(2)
  const parts = body.split(' \u00b7 ')
  // The rendered row is '- <id> · <OPEN|closed> · state=<value> · ...': the id and the actual
  // state word are the first two parts, and the configured value has its own field.
  const id = parts[0]
  const stateWord = parts[1] === undefined ? null : parts[1]
  const statePart = parts.filter((part) => part.startsWith('state='))[0]
  const toolsPart = parts.filter((part) => /^tools\(\d+\):/u.test(part))[0]
  const blockedPart = parts.filter((part) => part.startsWith('blocked: '))[0]
  const toolList = toolsPart === undefined ? null : toolsPart.slice(toolsPart.indexOf(':') + 1).trim()
  return {
    id,
    stateWord,
    state: statePart === undefined ? null : statePart.slice('state='.length),
    tools: toolList === null || toolList === '(none)' ? [] : toolList.split(', ').map((name) => name.trim()),
    blocked: blockedPart === undefined ? null : (/^blocked: ([A-Z_]+)/u.exec(blockedPart) === null ? null : /^blocked: ([A-Z_]+)/u.exec(blockedPart)[1]),
    openable: parts.includes('openable now'),
    needsApproval: parts.some((part) => part.startsWith('USER-DISABLED')),
    relockable: parts.includes('relockable'),
    line,
  }
}
const parseDirectory = (text) => {
  const source = typeof text === 'string' ? text : ''
  return { text: source, rows: source.split('\n').filter((line) => line.startsWith('- ')).map(parseRow), bytes: Buffer.byteLength(source, 'utf8') }
}
const rowOf = (directory, id) => (directory === null || directory === undefined ? null : directory.rows.filter((row) => row.id === id)[0] === undefined ? null : directory.rows.filter((row) => row.id === id)[0])
const sortNames = (list) => [...(Array.isArray(list) ? list : [])].sort()
const costOfLine = (line) => {
  const surface = /surface now (\d+) tools \/ (\d+) bytes/u.exec(line)
  const series = /startsSeries=(true|false)/u.exec(line)
  return {
    id: /^- (?:opened|closed) (\S+)/u.exec(line) === null ? null : /^- (?:opened|closed) (\S+)/u.exec(line)[1],
    direction: /^- (opened|closed)/u.exec(line) === null ? null : /^- (opened|closed)/u.exec(line)[1],
    effective: /\(effective: ([a-z-]+)\)/u.exec(line) === null ? null : /\(effective: ([a-z-]+)\)/u.exec(line)[1],
    entries: surface === null ? null : Number(surface[1]),
    bytes: surface === null ? null : Number(surface[2]),
    startsSeries: series === null ? null : series[1] === 'true',
    line,
  }
}

// ---------------------------------------------------------------------------
// The producer record: the trio row reading F2 is compared against is PARSED at run time, so a
// stale constant in this file cannot pass itself off as the producer's own number.
// ---------------------------------------------------------------------------
const readRecordRow = (path) => {
  let text = null
  try { text = readFileSync(path, 'utf8') } catch { return { path, found: false, why: 'the producer record is not readable at ' + path } }
  const candidates = []
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim().startsWith('|') === false) continue
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 6) continue
    if (/relock/u.test(cells[1]) === false) continue
    if (/^\d+$/u.test(cells[2]) === false || /^\d+$/u.test(cells[3]) === false) continue
    candidates.push({
      line: line.trim(),
      subject: cells[1],
      entries: Number(cells[2]),
      bytes: Number(cells[3]),
      startsSeries: /false/u.test(cells[4]) ? false : (/true/u.test(cells[4]) ? true : null),
    })
  }
  if (candidates.length === 0) return { path, found: false, why: 'no table row of ' + path + ' names a relock scene with two integers (section 4.2 trio table)' }
  const disagree = candidates.some((row) => row.entries !== candidates[0].entries || row.bytes !== candidates[0].bytes || row.startsSeries !== candidates[0].startsSeries)
  if (disagree) return { path, found: false, why: 'more than one candidate trio row and they disagree: ' + show(candidates) }
  if (candidates[0].startsSeries === null) return { path, found: false, why: 'the candidate trio row records no boolean third number: ' + show(candidates[0]) }
  return { path, found: true, ...candidates[0], candidates: candidates.length }
}

// ---------------------------------------------------------------------------
// The judge: one pure reading per claim, over the world measured above.
// ---------------------------------------------------------------------------
const judge = (world, record) => {
  const out = []
  const add = (id, ok, detail, evidence) => out.push({ id, ok: ok === true, detail: String(detail), evidence: (Array.isArray(evidence) ? evidence : []).map((line) => String(line)) })
  const installResult = world.catalog.install === null || world.catalog.install === undefined ? { ok: false, isError: true, text: '' } : world.catalog.install
  const dirInstall = parseDirectory(installResult.text)
  const dirBatch = parseDirectory(world.catalog.afterBatch)
  const faceBefore = (world.face.before === undefined ? { names: [], bytes: 0 } : world.face.before)
  const faceInstall = (world.face.afterInstall === undefined ? { names: [], bytes: 0 } : world.face.afterInstall)
  const faceBatch = (world.face.afterBatch === undefined ? { names: [], bytes: 0 } : world.face.afterBatch)
  const faceClose = (world.face.afterClose === undefined ? { names: [], bytes: 0 } : world.face.afterClose)
  const countsAfterBatch = world.loop.counts.afterBatch === null || world.loop.counts.afterBatch === undefined ? { developers: -1, changes: -1, headers: -1 } : world.loop.counts.afterBatch
  const countsFinal = world.loop.counts.final === null || world.loop.counts.final === undefined ? { developers: -2, changes: -2, headers: -2 } : world.loop.counts.final
  const batch = world.loop.batch
  const batchText = batch === null || batch === undefined ? '' : batch.text
  const batchRows = batchText.split('\n').filter((line) => line.startsWith('- ')).map(costOfLine)
  const openedRows = batchRows.filter((row) => row.direction === 'opened')
  const probes = world.probes === undefined ? {} : world.probes
  const headerChanges = world.loop.headers.filter((header) => header.reason === 'change')
  const worldGlobalNames = world.layers === undefined || world.layers === null ? [] : world.layers.global

  // A1 -- one call, two groups, and the effective point it reports is the one that happens.
  {
    const declaringRequest = world.loop.requests[1] === undefined ? { tools: [] } : world.loop.requests[1]
    const nextRequest = world.loop.requests[2] === undefined ? { tools: [] } : world.loop.requests[2]
    const declaringStep = batch === null || batch === undefined ? null : { turn: batch.turn, step: batch.step }
    const firstChange = headerChanges[0] === undefined ? null : headerChanges[0]
    const after = firstChange !== null && declaringStep !== null && declaringStep.turn !== null && firstChange.turn !== null
      && (firstChange.turn > declaringStep.turn || (firstChange.turn === declaringStep.turn && firstChange.step > declaringStep.step))
    const ok = batch !== null && batch !== undefined && batch.isError === false
      && openedRows.length === 2
      && openedRows[0].id === OPENED_BY_THE_BATCH[0] && openedRows[1].id === OPENED_BY_THE_BATCH[1]
      && openedRows.every((row) => row.effective === 'next-step')
      && same(sortNames(declaringRequest.tools), sortNames(faceInstall.names))
      && same(sortNames(nextRequest.tools), sortNames([...declaringRequest.tools, ...BATCH_MEMBERS]))
      && after === true
    add('A1', ok, openedRows.length + ' opened row(s) ' + show(openedRows.map((row) => row.id + '/' + row.effective))
      + '; the declaring step saw ' + show(sortNames(declaringRequest.tools)) + ' and the next step ' + show(sortNames(nextRequest.tools))
      + '; first change header at ' + show(firstChange === null ? null : { turn: firstChange.turn, step: firstChange.step, seq: firstChange.seq }) + ' vs the declaration at ' + show(declaringStep),
      ['one line per group: ' + show(openedRows.map((row) => row.line))])
  }

  // A2 -- one declaration, one developer message, every member in it.
  {
    const developer = world.loop.developer
    const first = developer[0] === undefined ? null : developer[0]
    const additions = first === null ? [] : first.rows.filter((row) => row.type === 'tool-addition').map((row) => row.toolName)
    const removals = first === null ? [] : first.rows.filter((row) => row.type === 'tool-removal')
    const boundSeq = headerChanges[0] === undefined ? null : headerChanges[0].seq
    const ok = countsAfterBatch.developers === 1 && countsAfterBatch.changes === 1
      && first !== null && first.headerSeq === boundSeq && first.source === 'tool-registry'
      && same(sortNames(additions), sortNames(BATCH_MEMBERS)) && removals.length === 0
    add('A2', ok, 'right after the batch the session held ' + String(countsAfterBatch.developers) + ' developer/message and ' + String(countsAfterBatch.changes)
      + ' reason:change header(s); the message carries ' + show(sortNames(additions)) + ' and ' + String(removals.length) + ' removal row(s), headerSeq='
      + show(first === null ? null : first.headerSeq) + ' against header ' + show(boundSeq),
      ['the message rows: ' + show(first === null ? null : first.rows), 'what the gate expected from its own configuration: ' + show(sortNames(BATCH_MEMBERS))])
  }

  // A4 -- a refused declaration adds no second slide.
  {
    const ok = same({ developers: countsFinal.developers, changes: countsFinal.changes, headers: countsFinal.headers },
      { developers: countsAfterBatch.developers, changes: countsAfterBatch.changes, headers: countsAfterBatch.headers })
    add('A4', ok, 'after the refused declaration the session counts are ' + show(countsFinal) + ' against ' + show(countsAfterBatch) + ' before it',
      ['the refused declaration answered: ' + show(world.loop.typo === null || world.loop.typo === undefined ? null : world.loop.typo.text.slice(0, 400))])
  }

  // B1 -- three states, three different behaviours.
  {
    const liveRow = rowOf(dirInstall, 'live')
    const declaredRow = rowOf(dirInstall, 'declared')
    const offRow = rowOf(dirInstall, 'off')
    const liveOnFace = REACHABLE_IN_ONLY.every((name) => faceInstall.names.includes(name))
    const ok = liveRow !== null && liveRow.stateWord === 'OPEN' && liveRow.openable === false
      && declaredRow !== null && declaredRow.stateWord === 'closed' && declaredRow.openable === true
      && offRow !== null && offRow.stateWord === 'closed' && offRow.needsApproval === true
      && liveOnFace === true
    add('B1', ok, 'on=' + show(liveRow === null ? null : { word: liveRow.stateWord, state: liveRow.state, openable: liveRow.openable })
      + ' auto=' + show(declaredRow === null ? null : { word: declaredRow.stateWord, state: declaredRow.state, openable: declaredRow.openable })
      + ' off=' + show(offRow === null ? null : { word: offRow.stateWord, state: offRow.state, openable: offRow.openable, approval: offRow.needsApproval })
      + '; the on group members on the face at install: ' + show(REACHABLE_IN_ONLY))
  }

  // B2 -- the configured value and the actual state are two fields that never swap.
  {
    const rows = [...dirInstall.rows, ...dirBatch.rows]
    const statesOk = rows.length === GROUPS.length * 2 && rows.every((row) => ['on', 'off', 'auto'].includes(row.state))
    const wordsOk = rows.every((row) => row.stateWord === 'OPEN' || row.stateWord === 'closed')
    const declaredBatch = rowOf(dirBatch, 'declared')
    const liveBatch = rowOf(dirBatch, 'live')
    const ok = statesOk && wordsOk
      && declaredBatch !== null && declaredBatch.stateWord === 'OPEN' && declaredBatch.state === 'auto'
      && liveBatch !== null && liveBatch.stateWord === 'OPEN' && liveBatch.state === 'on'
    add('B2', ok, 'every row reads one of on|off|auto in state= (' + String(statesOk) + ') and OPEN/closed in the actual word (' + String(wordsOk) + '); after the batch the opened auto group reads '
      + show(declaredBatch === null ? null : { word: declaredBatch.stateWord, state: declaredBatch.state }),
      ['the rows the parser read: ' + show(rows.map((row) => ({ id: row.id, word: row.stateWord, state: row.state })))])
  }

  // B3 -- a group turned off by configuration cannot be opened, and the refusal is named.
  {
    const probe = probes.off === undefined ? null : probes.off
    const ok = probe !== null && probe.answer.isError === true && /GROUPS_OFF/u.test(probe.answer.text) && probe.moved === false
    add('B3', ok, 'the off group declaration answered ' + show(probe === null ? null : probe.answer.text.slice(0, 200)) + '; the face and the directory moved: ' + show(probe === null ? null : probe.moved))
  }

  // B4 -- a group that is already open is a no-op refusal, not a second slide.
  {
    const probe = probes.alreadyOpen === undefined ? null : probes.alreadyOpen
    const onId = GROUPS.filter((group) => group.state === 'on')[0].id
    const ok = probe !== null && probe.answer.isError === false && /already open/u.test(probe.answer.text)
      && /- refused /u.test(probe.answer.text) && /- opened /u.test(probe.answer.text) === false
      && probe.moved === false
    add('B4', ok, 'declaring the already-open group ' + onId + ' answered ' + show(probe === null ? null : probe.answer.text.slice(0, 200)) + '; moved=' + show(probe === null ? null : probe.moved))
  }

  // B5 -- an id that is not in the catalog is refused by name, with the known ids.
  {
    const probe = probes.unknown === undefined ? null : probes.unknown
    const knownLine = 'known ids: ' + KNOWN_IDS.join(', ')
    const ok = probe !== null && probe.answer.isError === false && /GROUPS_UNKNOWN/u.test(probe.answer.text) && probe.answer.text.includes(knownLine) && probe.moved === false
    add('B5', ok, 'the unknown id answered ' + show(probe === null ? null : probe.answer.text.slice(0, 220)) + '; moved=' + show(probe === null ? null : probe.moved),
      ['the gate own known-id list: ' + knownLine])
  }

  // C1 -- the group is the unit: one call adds exactly the union of its groups' members.
  {
    const added = faceBatch.names.filter((name) => faceInstall.names.includes(name) === false)
    const removed = faceInstall.names.filter((name) => faceBatch.names.includes(name) === false)
    const ok = same(sortNames(added), sortNames(BATCH_MEMBERS)) && removed.length === 0
    add('C1', ok, 'the batch added ' + show(sortNames(added)) + ' and removed ' + show(removed),
      ['the gate own union of the two groups it named: ' + show(sortNames(BATCH_MEMBERS)),
        'the face before ' + show(faceInstall.names) + ' and after ' + show(faceBatch.names)])
  }

  // C2 -- closing is the same mechanism in reverse.
  {
    const relock = probes.closeRelock === undefined ? null : probes.closeRelock
    const plain = probes.closePlain === undefined ? null : probes.closePlain
    const afterClose = relock === null ? { names: [] } : relock.after.names
    const ok = relock !== null && relock.answer.isError === false && /- closed relock/u.test(relock.answer.text)
      && afterClose.includes('relock_one') === false && afterClose.includes('declared_one') === true
      && world.exec.afterClose.isError === true && world.exec.afterClose.text.includes('unknown tool "relock_one"')
      && world.exec.stillOpen.isError === false && world.exec.stillOpen.text === 'ran:declared_one'
      && plain !== null && /not relockable/u.test(plain.answer.text) && same(plain.before, plain.after)
    add('C2', ok, 'closing the relockable group answered ' + show(relock === null ? null : relock.answer.text.slice(0, 180))
      + '; the face after ' + show(afterClose) + '; the closed member answers ' + show(world.exec.afterClose.text.slice(0, 90))
      + '; closing a plain group answered ' + show(plain === null ? null : plain.answer.text.slice(0, 180)) + ' and moved=' + show(plain === null ? null : same(plain.before, plain.after) === false))
  }

  // C3 -- a group whose declared names reach nothing is named, not guessed at.
  {
    const torn = rowOf(dirInstall, 'torn')
    const typo = world.loop.typo
    const ok = torn !== null && torn.stateWord === 'closed' && torn.openable === false && torn.blocked === 'GROUPS_NO_TOOLS'
      && typo !== null && typo !== undefined && typo.isError === false && /GROUPS_NO_TOOLS/u.test(typo.text)
      && installResult.ok === true && dirInstall.rows.length === GROUPS.length
    add('C3', ok, 'the torn row is ' + show(torn === null ? null : { word: torn.stateWord, openable: torn.openable, blocked: torn.blocked })
      + '; declaring it answered ' + show(typo === null || typo === undefined ? null : typo.text.slice(0, 200))
      + '; the directory still lists ' + String(dirInstall.rows.length) + ' of ' + String(GROUPS.length) + ' groups')
  }

  // C4 -- an unmet dependency is a named refusal, not a silent wait.
  {
    const dependent = rowOf(dirInstall, 'dependent')
    const probe = probes.dependency === undefined ? null : probes.dependency
    const ok = dependent !== null && dependent.stateWord === 'closed' && dependent.openable === false && dependent.blocked === 'GROUPS_DEPENDENCY'
      && dependent.line.includes('device-b')
      && probe !== null && probe.answer.isError === false && /GROUPS_DEPENDENCY/u.test(probe.answer.text) && probe.moved === false
    add('C4', ok, 'the dependent row is ' + show(dependent === null ? null : { word: dependent.stateWord, openable: dependent.openable, blocked: dependent.blocked, namesTheDependency: dependent.line.includes('device-b') })
      + '; declaring it answered ' + show(probe === null ? null : probe.answer.text.slice(0, 200)) + '; moved=' + show(probe === null ? null : probe.moved))
  }

  // D1 -- a closed group member is indistinguishable from a tool that never existed.
  {
    const closed = world.exec.closed
    const ghost = world.exec.ghost
    const withoutName = (text, name) => String(text).split(name).join('<name>')
    const ok = closed.isError === true && ghost.isError === true
      && closed.text === 'Error: unknown tool "off_one"'
      && withoutName(closed.text, 'off_one') === withoutName(ghost.text, NEVER_REGISTERED)
      && world.exec.lookup.closed === 'absent' && world.exec.lookup.ghost === 'absent' && world.exec.lookup.open === 'present'
      && world.exec.open.isError === false && world.exec.open.text === 'ran:live_alpha'
    add('D1', ok, 'the closed member answers ' + show(closed.text) + ' and a name that never existed answers ' + show(ghost.text)
      + '; the same text apart from the name: ' + show(withoutName(closed.text, 'off_one') === withoutName(ghost.text, NEVER_REGISTERED))
      + '; lookup ' + show(world.exec.lookup) + '; the paired open member answers ' + show(world.exec.open.text))
  }

  // E1 -- the restriction that hides the closed members does not hide the activation pair.
  {
    const maskedState = GROUPS.filter((group) => group.state !== 'on').flatMap((group) => group.tools).filter((name) => name !== TYPO_NAME)
    const hidden = maskedState.filter((name) => faceInstall.names.includes(name) === false)
    const pairOnFace = ACTIVATION.every((name) => faceInstall.names.includes(name))
    const ok = pairOnFace === true && hidden.length === maskedState.length
      && same(sortNames(faceInstall.names), sortNames([...REACHABLE_IN_ONLY, ...ACTIVATION]))
      && ACTIVATION.every((name) => faceBatch.names.includes(name)) && ACTIVATION.every((name) => faceClose.names.includes(name))
      && probes.unknown !== undefined && probes.unknown.answer.ok === true
      && installResult.ok === true
      && ACTIVATION.every((name) => worldGlobalNames.includes(name) === false)
    add('E1', ok, 'at install ' + String(hidden.length) + ' of ' + String(maskedState.length) + ' members of closed groups are masked while the pair is on the face; the face is '
      + show(faceInstall.names) + '; the pair after the batch ' + show(ACTIVATION.filter((name) => faceBatch.names.includes(name)))
      + ' and after a close ' + show(ACTIVATION.filter((name) => faceClose.names.includes(name))) + '; the catalog answered ' + show(installResult.ok)
      + '; neither name is in the global registry the same context reads (' + show(worldGlobalNames) + '), so they can only come from the agent own layer')
  }

  // F1 -- the cost trio the declaration reports is the face the gate measures.
  {
    const first = batchRows.filter((row) => row.entries !== null)[0] === undefined ? null : batchRows.filter((row) => row.entries !== null)[0]
    const sameTrio = batchRows.length === 2 && batchRows.every((row) => row.entries === batchRows[0].entries && row.bytes === batchRows[0].bytes && row.startsSeries === batchRows[0].startsSeries)
    const ok = first !== null && sameTrio === true && first.entries === faceBatch.names.length && first.bytes === faceBatch.bytes
    add('F1', ok, 'the declaration reported ' + show(batchRows.map((row) => ({ id: row.id, entries: row.entries, bytes: row.bytes, startsSeries: row.startsSeries })))
      + ' against the live face the gate measured itself: ' + String(faceBatch.names.length) + ' entries / ' + String(faceBatch.bytes) + ' bytes')
  }

  // F2 -- the same trio equals the numbers the producer recorded.
  {
    const first = batchRows.filter((row) => row.entries !== null)[0] === undefined ? null : batchRows.filter((row) => row.entries !== null)[0]
    const ok = record.found === true && first !== null
      && first.entries === record.entries && first.bytes === record.bytes && first.startsSeries === record.startsSeries
    add('F2', ok, 'the measured trio ' + show(first === null ? null : { entries: first.entries, bytes: first.bytes, startsSeries: first.startsSeries })
      + ' against the record row ' + show(record.found === true ? { entries: record.entries, bytes: record.bytes, startsSeries: record.startsSeries } : record),
      ['the record row: ' + String(record.line === undefined ? '' : record.line)])
  }

  // F3 -- the reported startsSeries is the one the session actually held.
  {
    const first = batchRows.filter((row) => row.startsSeries !== null)[0] === undefined ? null : batchRows.filter((row) => row.startsSeries !== null)[0]
    const seq = batch === null || batch === undefined ? Number.MAX_SAFE_INTEGER : batch.seq
    const before = world.loop.headers.filter((header) => header.seq < seq)
    const last = before[before.length - 1] === undefined ? null : before[before.length - 1]
    const expected = last === null ? false : last.startsSeries
    const ok = first !== null && first.startsSeries === expected
    add('F3', ok, 'the declaration reported startsSeries=' + show(first === null ? null : first.startsSeries) + ' while the last request/header before it was '
      + show(last === null ? null : { seq: last.seq, reason: last.reason, startsSeries: last.startsSeries })
      + '; the change header the same declaration produced is ' + show(headerChanges[0] === undefined ? null : { seq: headerChanges[0].seq, reason: headerChanges[0].reason, startsSeries: headerChanges[0].startsSeries }))
  }

  // G1 -- the directory carries no schema.
  {
    const text = installResult.text
    const words = ['parameters', 'properties', 'schema', '"type"'].filter((word) => text.includes(word))
    const ok = installResult.ok === true && installResult.isError === false && words.length === 0
    add('G1', ok, 'the directory renders ' + String(text.length) + ' chars with ' + show(words) + ' of the schema words present')
  }

  // G2 -- a closed group costs nothing.
  {
    const closedMembers = GROUPS.filter((group) => group.state !== 'on').flatMap((group) => group.tools).filter((name) => name !== TYPO_NAME)
    const present = closedMembers.filter((name) => faceInstall.names.includes(name))
    const ok = present.length === 0 && REACHABLE_IN_ONLY.every((name) => faceInstall.names.includes(name))
    add('G2', ok, 'at install the face is ' + show(faceInstall.names) + '; members of closed groups on it: ' + show(present))
  }

  // H1 -- unloading restores the pre-plugin face exactly.
  {
    const teardown = world.teardown === null || world.teardown === undefined ? { face: { names: [], bytes: 0 }, lookup: 'absent' } : world.teardown
    const ok = same(teardown.face.names, faceBefore.names) && ACTIVATION.every((name) => teardown.face.names.includes(name) === false)
    add('H1', ok, 'after unloading the face is ' + show(teardown.face.names) + ' against the pre-plugin ' + show(faceBefore.names))
  }

  // H2 -- and the restriction is really gone.
  {
    const teardown = world.teardown === null || world.teardown === undefined ? { closedMember: { isError: true, text: '' }, lookup: 'absent' } : world.teardown
    const ok = teardown.closedMember.isError === false && teardown.closedMember.text === 'ran:off_one' && teardown.lookup === 'present'
    add('H2', ok, 'a member that was masked answers ' + show(teardown.closedMember.text) + ' after unloading and its definition is ' + show(teardown.lookup))
  }

  // I1 -- an agent created after the plugin is installed gets its OWN installation and its own
  // group state, and declaring for it leaves the first agent's directory where it was.
  {
    const second = world.second
    const empty = parseDirectory('')
    const beforeB = second === null || second === undefined ? empty : parseDirectory(second.before)
    const afterB = second === null || second === undefined ? empty : parseDirectory(second.after)
    const relockBefore = rowOf(beforeB, 'relock')
    const relockAfter = rowOf(afterB, 'relock')
    const ok = second !== null && second !== undefined
      && same(sortNames(second.face.names), sortNames([...REACHABLE_IN_ONLY, ...ACTIVATION]))
      && relockBefore !== null && relockBefore.stateWord === 'closed'
      && relockAfter !== null && relockAfter.stateWord === 'OPEN'
      && same(second.firstBefore, second.firstAfter)
      && second.pairAnswers === true
    add('I1', ok, 'the agent created after the install reads the face ' + show(second === null || second === undefined ? null : second.face.names)
      + '; its relock group goes ' + show(relockBefore === null ? null : relockBefore.stateWord) + ' -> ' + show(relockAfter === null ? null : relockAfter.stateWord)
      + ' while the first agent directory is byte-identical before and after: ' + show(second !== null && second !== undefined && same(second.firstBefore, second.firstAfter)))
  }

  return out.filter((reading) => reading.id !== null)
}

/** The judge, contained: a judge that throws is a named failure, never a crash. */
const safeJudge = (world, record) => {
  try {
    return { readings: judge(world, record), error: null }
  } catch (error) {
    return { readings: [], error: describe(error) }
  }
}

// ---------------------------------------------------------------------------
// Self-attack: rewrite the shipped artifact own bytes and re-measure.
// ---------------------------------------------------------------------------
const runSelfAttack = async (started, record) => {
  const baseline = await collect('baseline', null)
  const world = baseline.world
  if (world.fatal !== null) { console.log('        fatal: ' + world.fatal); await baseline.close(); return NOT_MEASURED('the baseline world could not be built: ' + world.fatal) }
  const baseJudge = safeJudge(world, record)
  if (baseJudge.error !== null) { await baseline.close(); return NOT_MEASURED('the judge threw over the baseline world: ' + baseJudge.error) }
  const base = baseJudge.readings
  const baseRed = base.filter((reading) => reading.ok === false)
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' failed')
  await baseline.close()
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: red=' + show(baseRed.map((reading) => reading.id)))
    for (const reading of baseRed) console.log('        ' + reading.id + '. ' + reading.detail)
    return 1
  }
  console.log('  each mutant below rewrites ONE string in the shipped artifact own bytes and is measured by the same judge:')
  let failures = 0
  let built = 0
  const moved = new Map()
  for (const [at, mutant] of MUTANTS.entries()) {
    const apply = mutant.from === null ? null : (source) => {
      if (source.includes(mutant.from) === false) throw new Error('the mutant cannot be applied: its source string is not in the shipped artifact')
      return source.replace(mutant.from, mutant.to)
    }
    const run = await collect('mutant-' + String(at), apply)
    let observed = []
    let note = ''
    if (run.world.fatal !== null) {
      note = ' (the mutant world could not be built: ' + run.world.fatal + ')'
      observed = base.map((reading) => reading.id)
    } else {
      const judged = safeJudge(run.world, record)
      if (judged.error !== null) {
        note = ' (the judge threw over the mutant world: ' + judged.error + ')'
        observed = base.map((reading) => reading.id)
      } else {
        observed = judged.readings.filter((reading) => reading.ok === false).map((reading) => reading.id).sort()
      }
    }
    await run.close()
    built += 1
    const declared = [...mutant.expect].sort()
    const precise = same(observed, declared)
    if (precise === false) failures += 1
    for (const id of declared) moved.set(id, (moved.get(id) === undefined ? 0 : moved.get(id)) + 1)
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' — 声明集 == 观测集: declared=' + show(declared) + ' observed=' + show(observed) + note)
  }
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  let uncovered = 0
  for (const reading of base) {
    const count = moved.get(reading.id) === undefined ? 0 : moved.get(reading.id)
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id)
  }
  if (uncovered > 0) console.log('  FAIL  ' + String(uncovered) + ' reading(s) are covered by no mutant, so nothing here says they can fail')
  console.log('  ' + String(built) + ' mutants, ' + String(failures) + ' imprecise, ' + String(MUTANTS.filter((mutant) => mutant.expect.length > 0).length) + ' of them declare a target, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  return failures === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  const started = Date.now()
  const record = readRecordRow(RECORD_PATH)
  if (record.found === false) return NOT_MEASURED('the producer trio row reading F2 compares against could not be read: ' + record.why)
  console.log('  the trio row this gate reproduces, parsed from the record: ' + show({ path: record.path, entries: record.entries, bytes: record.bytes, startsSeries: record.startsSeries }))
  if (SELF_ATTACK) return await runSelfAttack(started, record)
  const run = await collect('gate', null)
  const world = run.world
  if (world.fatal !== null) { await run.close(); return NOT_MEASURED('the world could not be built: ' + world.fatal) }
  console.log('        the subject: ' + MODULE_PATH + ' (' + String(world.artifact.bytes) + ' bytes, imports ' + show(world.artifact.imports) + ', name=' + show(world.plugin.name) + ', inject=' + show(world.plugin.inject) + ', default export=' + show(world.plugin.hasDefault) + ')')
  console.log('        the world: ' + String(world.services.registered) + ' group members registered on the global layer through the real ctx.tools.register(), the agent minted by ctx.agentLoop.create('
    + AGENT_A + '), the shipped apply() called on the same context')
  console.log('        the model was scripted: ' + show(world.loop.requests.map((request) => request.tools.length)) + ' tools per request; the agent session holds '
    + String(world.loop.seq) + ' events, ' + String(world.loop.headers.length) + ' request/header(s) and ' + String(world.loop.developer.length) + ' developer/message')
  const judged = safeJudge(world, record)
  if (judged.error !== null) { console.log('  FAIL  the judge threw over this world: ' + judged.error); await run.close(); return 1 }
  const readings = judged.readings
  for (const reading of readings) {
    console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  await run.close()
  return failed.length > 0 ? 1 : 0
}

process.exitCode = await main()

