#!/usr/bin/env node
/**
 * dsh-link-groups self-check (producer-owned).
 *
 * The world is the REAL kernel: a fresh cordis `Context` with the real
 * `SystemPrompt` and `ToolRuntime` mounted, the real `AgentRegistry` emitting
 * the real `agent/created` / `agent/disposed` lifecycle, the real `Session` and
 * the real `ApprovalService` — so every `tool/call`, `tool/result`,
 * `request/header`, `approval/asked` and `approval/decided` below is a genuine
 * kernel event. No hand-written tool registry stands in for it: the kernel's own
 * built modules are imported by absolute path, and the plugin's built artifact is
 * loaded through an import rewrite whose result must stay byte-identical to
 * `lib/index.js`.
 *
 * Every reading is paired with something that can make it fail, and
 * `--self-attack` mutates the measured artifact's own bytes (declared up front in
 * MUTANTS) to prove each reading can move.
 *
 *   node plugins/dsh-link-groups/test/group-state-selfcheck.mjs
 *   node plugins/dsh-link-groups/test/group-state-selfcheck.mjs --self-attack
 *   node plugins/dsh-link-groups/test/group-state-selfcheck.mjs --json
 *
 * Exit codes: 0 every reading held and every declared mutant moved what it
 * declared, 1 a reading failed or a mutant did not, 3 NOT MEASURED (the kernel
 * or the built artifact is not there, so no honest reading exists).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const SCRATCH = join(PROJECT, '.tmp', 'r185-a', 'stage')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')
const argv = process.argv.slice(2)
const MUTANT = process.env.R185_MUTANT ?? ''

/** The kernel modules the plugin imports, by path, so both sides share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
  '@deepseek-ai/dsh-user-approval': join(KERNEL, 'packages', 'interaction', 'user-approval', 'lib', 'index.js'),
}

const readings = []
const held = (id, ok, detail) => { readings.push({ id, ok: ok === true, detail: String(detail) }); return ok === true }
const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }

for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
  if (!existsSync(file)) notMeasured('the kernel module ' + specifier + ' is missing at ' + file + '; this self-check mounts the real registry and will not stand in a fake one')
}
if (!existsSync(ARTIFACT)) notMeasured('the built artifact is missing at ' + ARTIFACT + ' (run: node plugins/build.mjs)')

/** Rewrite the plugin's bare kernel imports onto the exact module paths this file also imports. */
function stage(source) {
  let text = source
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '\u0060']) text = text.split(quote + specifier + quote).join(quote + url + quote)
  }
  return text
}

/** Write one staged module and import it. */
async function loadStaged(name, source) {
  mkdirSync(SCRATCH, { recursive: true })
  const file = join(SCRATCH, name + '.mjs')
  writeFileSync(file, source)
  return await import(pathToFileURL(file).href)
}

// ---------------------------------------------------------------------------
// Mutants: each replaces one string in the artifact's own bytes, and declares
// which readings must move. A mutant that changes nothing is a broken instrument.
// ---------------------------------------------------------------------------
const MUTANTS = {
  'off-group-opens': {
    from: 'return { kind: "deny", reason: REFUSALS.OFF + ": the user turned this group off, so a declaration cannot open it: " + off.join(", ") };',
    to: 'return next();',
    expect: ['H1'],
  },
  // Every reading that asserts the current effective point moves, and no other.
  'effective-becomes-immediate': {
    from: 'var EFFECTIVE = "next-step"',
    to: 'var EFFECTIVE = "immediate"',
    expect: ['G1', 'G2', 'I1'],
  },
  // The mask itself is disabled, so a closed group's members stay callable —
  // exactly the enforcement failure the D1 reading exists to catch.
  'closed-group-not-masked': {
    from: 'const mask = (id) => {',
    to: 'const mask = (id) => { if (true) return;',
    expect: ['B2', 'D1', 'G3', 'H1', 'H2', 'H4'],
  },
  'catalog-leaks-schema': {
    from: 'const lines = [config.catalogPreamble, ""]',
    to: 'const lines = [config.catalogPreamble + " parameters: {properties: {a: {type: \\"string\\"}}}", ""]',
    expect: ['E1'],
  },
  'typo-kills-every-group': {
    from: 'if (installation.missing.length > 0) {',
    to: 'if (false) {',
    expect: ['C6', 'H3', 'I3'],
  },
  // The agent-visible cost reading moves together with the automatic opener's
  // own cost reading: both measure the same number, so both must notice.
  'cost-entries-hardcoded': {
    from: 'entries: schemas.length,',
    to: 'entries: schemas.length + 1,',
    expect: ['G4', 'I1'],
  },
  // Every reading that drives the automatic path must notice, and no other.
  'auto-open-skipped': {
    from: 'function autoOpenRecordFor(ctx, agent) {',
    to: 'function autoOpenRecordFor(ctx, agent) { if (true) return undefined;',
    expect: ['I1', 'I2', 'I3', 'I4', 'I5'],
  },
  'dependency-ignored': {
    from: "if (state.open[dependency] !== true) return { code: REFUSALS.DEPENDENCY,",
    to: "if (false) return { code: REFUSALS.DEPENDENCY,",
    expect: ['C7'],
  },
}

let artifactSource = readFileSync(ARTIFACT, 'utf8')
if (MUTANT !== '') {
  const mutant = MUTANTS[MUTANT]
  if (mutant === undefined) notMeasured('unknown mutant "' + MUTANT + '"')
  if (!artifactSource.includes(mutant.from)) notMeasured('mutant "' + MUTANT + '" cannot be applied: its source string is not in the artifact')
  artifactSource = artifactSource.replace(mutant.from, mutant.to)
}
const artifactImports = [...readFileSync(ARTIFACT, 'utf8').matchAll(/from\s+["']([^"']+)["']/gu)].map(match => match[1]).sort()
const stagedArtifact = stage(artifactSource)
const stagedImports = [...stagedArtifact.matchAll(/from\s+["']([^"']+)["']/gu)].map(match => match[1]).sort()
held('A1', JSON.stringify(artifactImports) === JSON.stringify(['@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-tools']) && stagedImports.every(specifier => specifier.startsWith('file:///')),
  'the artifact imports exactly ' + JSON.stringify(artifactImports) + ' and staging rewrote every one of them to an absolute kernel path (' + String(stagedImports.length) + ')')
const plugins = await loadStaged('groups' + (MUTANT === '' ? '' : '-' + MUTANT), stagedArtifact)
held('A2', plugins.name === 'dsh-link-groups' && JSON.stringify(plugins.inject) === '["tools","systemPrompt"]' && plugins.default === undefined,
  'named exports only: name=' + String(plugins.name) + ' inject=' + JSON.stringify(plugins.inject) + ' default=' + String(plugins.default))

// ---------------------------------------------------------------------------
// The world's data: eight groups that between them exercise every state.
// ---------------------------------------------------------------------------
const GROUPS = [
  { id: 'live', title: 'Always on', summary: 'the group that is never closed', tools: ['live_alpha', 'live_beta'], state: 'on' },
  { id: 'declared', title: 'Declared on demand', summary: 'the ordinary auto group', tools: ['declared_one', 'declared_two'], state: 'auto', auto: { when: 'declare' } },
  { id: 'closed', title: 'Turned off by configuration', summary: 'off, so a declaration cannot open it', tools: ['closed_one'], state: 'off' },
  { id: 'device', title: 'Opened by a device', summary: 'a condition its own plugin observes', tools: ['device_one'], state: 'auto', auto: { when: 'device' } },
  { id: 'device-b', title: 'Opened by a second condition', summary: 'never opened by an earlier reading', tools: ['device_b_one'], state: 'auto', auto: { when: 'device' } },
  { id: 'gated', title: 'Disabled by the user', summary: 'opens only through an approval', tools: ['gated_one', 'gated_two'], state: 'auto', auto: { when: 'declare' }, userDisabled: true },
  { id: 'dependent', title: 'After another group', summary: 'depends on the declared group', tools: ['dependent_one'], state: 'auto', auto: { when: 'after', after: 'declared' } },
  { id: 'torn', title: 'A configuration typo', summary: 'one name exists, one does not', tools: ['torn_one', 'typo_never_registered'], state: 'auto', auto: { when: 'declare' } },
  { id: 'relock', title: 'Relockable', summary: 'the one group that may be closed again', tools: ['relock_one'], state: 'auto', auto: { when: 'declare' }, relockable: true },
]
const CONFIG = { groups: GROUPS, deferredNotice: true }

/** Set by the approval answerer; a reading flips it to prove the gate is real. */
let approvalAnswer = 'rejected'
/** How many times the answerer was asked. */
let askedCount = 0

const { Context } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/cordis']).href)
const { createScope } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-scope']).href)
const { default: SystemPrompt } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-system-prompt']).href)
const { default: ToolRuntime, defineTool } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-tools']).href)
const { Session, SessionId } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-session']).href)
const { default: AgentRegistry } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-agent']).href)
const { default: ApprovalService } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-user-approval']).href)

/** A registry-ready tool whose execution echoes its name. */
function toolFile(name) {
  return defineTool({
    name,
    description: 'group member ' + name,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: () => 'ran:' + name,
  })
}

/** The names one agent can currently call, as the registry resolves them. */
const surfaceOf = (ctx, agent) => ctx.tools.schemas(agent).map(tool => tool.name).sort()

/** Register every group member on the GLOBAL layer, the only layer a restriction can filter. */
function registerMembers(ctx) {
  for (const group of GROUPS) for (const name of group.tools) {
    if (name === 'typo_never_registered') continue
    ctx.tools.register(toolFile(name))
  }
}

/** Build the world once: real kernel services, one live agent, then the plugin row. */
async function buildWorld() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  registerMembers(ctx)
  const id = 'r185a-agent'
  const agent = {
    id: SessionId(id),
    options: {},
    session: Session.create(SessionId(id)),
    inbox: { nextTurn: [], nextStep: [] },
    status: 'idle',
    ctx: undefined,
    send() {},
    followup() {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' }) }),
    inject() {},
    cancel() {},
    runMaintenance: (task) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  // The scope KEY is the agent itself, exactly as the kernel mints an agent's
  // scope: a registry view resolves a scope by the key it is asked about, so a
  // mismatched key reads an empty layer and hides every registration.
  await ctx.plugin(Object.assign((inner) => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
  const before = surfaceOf(ctx, agent)
  const fiber = ctx.plugin(plugins, CONFIG)
  await fiber
  const unregister = await ctx.agents.register(agent)
  return { ctx, agent, before, fiber, unregister }
}

/** Ask the real executor for one tool, exactly as the model's call would reach it. */
async function run(ctx, name, args, agent, callId) {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: callId ?? 'call-' + name + '-' + Math.random().toString(36).slice(2, 8),
    name,
    arguments: args ?? {},
    ...agent === undefined ? {} : { agent },
  })
  const first = result.content[0]
  return { text: first !== undefined && first.type === 'text' ? first.text : JSON.stringify(result.content), isError: result.isError === true }
}


/** Parse the rendered directory back into one row per group. */
function parseCatalog(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('- ')) continue
    const id = line.slice(2).split(' ')[0]
    const tools = /tools\((\d+)\)/u.exec(line)
    const blocked = /blocked: ([A-Z_]+)/u.exec(line)
    rows.push({
      id,
      open: line.includes(' OPEN '),
      state: (/state=([a-z]+)/u.exec(line) ?? [])[1],
      toolCount: tools === null ? -1 : Number(tools[1]),
      blocked: blocked === null ? undefined : blocked[1],
      approval: line.includes('USER-DISABLED'),
      relockable: line.includes('relockable') && !line.includes('relockable: false'),
      openable: line.includes('openable now'),
      auto: (/auto=([a-z]+)/u.exec(line) ?? [])[1],
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// 1. Shape: the two activation tools resolve on the agent's OWN layer.
// ---------------------------------------------------------------------------
const world = await buildWorld()
const { ctx, agent, before } = world
const after = surfaceOf(ctx, agent)
const activation = ['tool_groups', 'tool_groups_declare']
held('B1', before.length === 12 && !before.some(name => activation.includes(name)),
  'before the plugin: the agent sees exactly the ' + String(before.length) + ' registered members and no activation tool')
const added = after.filter(name => !before.includes(name)).sort()
held('B2', JSON.stringify(added) === JSON.stringify(activation) && after.length === 4,
  'after the plugin: exactly ' + JSON.stringify(added) + ' were added and the 7 members of closed groups are hidden (surface=' + after.join(',') + ')')

// ---------------------------------------------------------------------------
// 2. The three states, read through the catalog tool itself.
// ---------------------------------------------------------------------------
const catalogCall = await run(ctx, 'tool_groups', {}, agent)
const rows = parseCatalog(catalogCall.text)
const rowOf = (id) => rows.find(row => row.id === id)
held('C0', catalogCall.isError === false && rows.length > 0, 'the catalog tool answers and renders ' + String(rows.length) + ' rows')
held('C1', rows.length === GROUPS.length && JSON.stringify(rows.map(row => row.id)) === JSON.stringify(GROUPS.map(group => group.id)),
  'the directory lists every group in configuration order: ' + rows.map(row => row.id).join(','))
held('C2', rowOf('live').open === true && rowOf('live').state === 'on' && rowOf('live').openable === false,
  'state on => open from the start and not offered as openable: ' + JSON.stringify(rowOf('live')))
held('C3', rowOf('declared').open === false && rowOf('declared').openable === true && rowOf('declared').auto === 'declare',
  'state auto (declare) => closed but openable: ' + JSON.stringify(rowOf('declared')))
held('C4', rowOf('closed').state === 'off' && rowOf('closed').openable === true && rowOf('closed').approval === true,
  'state off => listed openable, and the directory says it needs an approval: ' + JSON.stringify(rowOf('closed')))
held('C5', rowOf('gated').approval === true && rowOf('gated').state === 'auto',
  'userDisabled => the directory says opening needs approval: ' + JSON.stringify(rowOf('gated')))
held('C6', rowOf('torn').blocked === 'GROUPS_NO_TOOLS' && rowOf('torn').openable === false,
  'a configuration typo makes that ONE group broken with a named code and it is not offered as openable: ' + JSON.stringify(rowOf('torn')))
held('C7', rowOf('dependent').blocked === 'GROUPS_DEPENDENCY' && rowOf('dependent').openable === false,
  'an after-dependency is a named refusal, not a silent wait: ' + JSON.stringify(rowOf('dependent')))
held('C8', rowOf('relock').relockable === true && rowOf('declared').relockable === false,
  'relockable is reported per group (default false): relock=' + String(rowOf('relock').relockable) + ' declared=' + String(rowOf('declared').relockable))
held('C9', rowOf('declared').toolCount === 2 && rowOf('live').toolCount === 2,
  'each row reports the number of tools it would add: declared=' + String(rowOf('declared').toolCount) + ' live=' + String(rowOf('live').toolCount))

// ---------------------------------------------------------------------------
// 3. Closed means unreachable at the EXECUTION surface, not merely absent from the schema.
// ---------------------------------------------------------------------------
const blockedExecution = await run(ctx, 'declared_one', {}, agent)
held('D1', blockedExecution.isError && /unknown tool "declared_one"/u.test(blockedExecution.text),
  'a closed group member is indistinguishable from a nonexistent tool: ' + JSON.stringify(blockedExecution.text))
const openExecution = await run(ctx, 'live_alpha', {}, agent)
held('D2', !openExecution.isError && openExecution.text === 'ran:live_alpha',
  'an open group member still executes: ' + JSON.stringify(openExecution.text))

// ---------------------------------------------------------------------------
// 4. The directory carries no schema.
// ---------------------------------------------------------------------------
const catalogText = catalogCall.text
held('E1', !catalogText.includes('properties') && !catalogText.includes('parameters') && !catalogText.includes('schema') && !catalogText.includes('"type"'),
  'tool_groups renders ' + String(catalogText.length) + ' chars with 0 occurrences of properties/parameters/schema/"type"')
held('E2', catalogText.includes('restart') && catalogText.includes('declared again'),
  'the directory states the process-local consequence instead of hiding it')

// ---------------------------------------------------------------------------
// 5. Refusals change nothing. The whole directory is compared, not one field.
// ---------------------------------------------------------------------------
const directoryBefore = catalogCall.text
const unknown = await run(ctx, 'tool_groups_declare', { open: ['nope'] }, agent)
held('F1', unknown.isError === false && unknown.text.includes('GROUPS_UNKNOWN') && unknown.text.includes('relock'),
  'an unknown id refuses and carries the known ids in configuration order: ' + JSON.stringify(unknown.text.slice(0, 200)))
const dup = await run(ctx, 'tool_groups_declare', { open: ['declared'], close: ['declared'] }, agent)
held('F2', !dup.isError && dup.text.includes('GROUPS_DUP'), 'one id on both sides refuses: ' + JSON.stringify(dup.text.slice(0, 160)))
const badInput = await run(ctx, 'tool_groups_declare', { open: [42] }, agent)
held('F3', badInput.isError && /must be a string/u.test(badInput.text),
  'a non-string list item is refused by the tool schema before the code runs, so nothing is coerced: ' + JSON.stringify(badInput.text.slice(0, 170)))
const empty = await run(ctx, 'tool_groups_declare', {}, agent)
held('F4', !empty.isError && empty.text.includes('GROUPS_INPUT') && empty.text.includes('nothing to do'), 'an empty declaration refuses: ' + JSON.stringify(empty.text.slice(0, 160)))
const catalogArgs = await run(ctx, 'tool_groups', { id: 'declared' }, agent)
held('F5', catalogArgs.isError && catalogArgs.text.includes('GROUPS_CATALOG'),
  'the catalog tool refuses arguments: ' + JSON.stringify(catalogArgs.text.slice(0, 140)))
const directoryNow = (await run(ctx, 'tool_groups', {}, agent)).text
held('F6', directoryNow === directoryBefore, 'after 5 refusals the directory is byte-identical (' + String(directoryNow.length) + ' chars)')

// ---------------------------------------------------------------------------
// 6. One call, several groups, one slide: the measured cost trio.
// ---------------------------------------------------------------------------
const batch = await run(ctx, 'tool_groups_declare', { open: ['declared', 'relock'], why: 'self-check batch' }, agent)
held('G1', !batch.isError && (batch.text.match(/^- opened /gmu) ?? []).length === 2 && (batch.text.match(/effective: next-step/gu) ?? []).length === 2,
  'one call opened two groups: ' + JSON.stringify(batch.text.slice(0, 300)))
held('G2', !/immediate/u.test(batch.text), 'the result never claims an effective point other than next-step')
const chainAfter = surfaceOf(ctx, agent)
const priorNames = ['live_alpha', 'live_beta', 'tool_groups', 'tool_groups_declare']
const positionKept = priorNames.every(name => chainAfter.includes(name))
const appendedHere = chainAfter.filter(name => !priorNames.includes(name))
held('G3', chainAfter.length === 7 && positionKept && JSON.stringify(appendedHere) === JSON.stringify(['declared_one', 'declared_two', 'relock_one']),
  'the session surface carries the 4 names it had before plus the 3 the slice added: all=' + JSON.stringify(chainAfter) + ' appended=' + JSON.stringify(appendedHere))
const costRows = [...batch.text.matchAll(/surface now (\d+) tools \/ (\d+) bytes/gu)]
const schemaBytes = Buffer.byteLength(JSON.stringify(ctx.tools.schemas(agent)), 'utf8')
held('G4', costRows.length === 2 && Number(costRows[0][1]) === chainAfter.length && Number(costRows[0][2]) === schemaBytes && costRows[1][2] === costRows[0][2],
  'the reported cost is the measured surface: entries=' + String(costRows[0]?.[1]) + ' bytes=' + String(costRows[0]?.[2]) + ' vs schemas()=' + String(chainAfter.length) + '/' + String(schemaBytes))

// The session logs the change, so the next header is real and its startsSeries is readable.
const headerBefore = agent.session.requestHeader()
const fixtureHeader = { config: { provider: 'fixture', model: 'fixture' }, tools: [{ name: 'live_alpha', description: 'x', parameters: { type: 'object' } }] }
agent.session.append('request/header', { header: fixtureHeader, reason: 'change', startsSeries: true })
const slideWithHeader = await run(ctx, 'tool_groups_declare', { open: ['device'] }, agent)
held('G5', headerBefore === undefined && agent.session.requestHeader() !== undefined && slideWithHeader.text.includes('startsSeries=true'),
  'the trio reads the session header it actually has: before=' + String(headerBefore) + ' reading=' + JSON.stringify((/startsSeries=\w+/u.exec(slideWithHeader.text) ?? [])[0]))
agent.session.append('request/header', { header: fixtureHeader, reason: 'change' })
const slideNoSeries = await run(ctx, 'tool_groups_declare', { open: ['dependent'] }, agent)
held('G6', slideNoSeries.text.includes('startsSeries=false'),
  'a header that does not start a series is reported false, so the reading can differ: ' + JSON.stringify((/startsSeries=\w+/u.exec(slideNoSeries.text) ?? [])[0]))
const folded = plugins.foldSurface(Array.from({ length: agent.session.seq }, (_unused, seq) => agent.session.eventAt(seq)).filter(event => event !== undefined))
held('G7', folded.headers.filter(header => header.reason === 'change').length === 2 && folded.additions.length === 0,
  'the fold over the real log sees ' + String(folded.headers.length) + ' headers (' + String(folded.headers.filter(header => header.reason === 'change').length) + ' changes) and ' + String(folded.additions.length) + ' registry additions')

// ---------------------------------------------------------------------------
// 7. Approval: a user-disabled group is gated, and an unanswerable ask fails closed.
// ---------------------------------------------------------------------------
const approval = new ApprovalService(agent.ctx, { policy: 'ask' })
agent.session.append('turn/start', { turn: 1 })
held('H0', ctx.approval !== undefined && agent.session.seq >= 3,
  'a real ApprovalService answers through the context and the session sits inside an open turn, which the audit pair requires (overrideOf=' + String(approval.overrideOf(agent.session)) + ')')
const closedGroup = await run(ctx, 'tool_groups_declare', { open: ['closed'], why: 'off group' }, agent)
held('H1', closedGroup.isError && closedGroup.text.includes('GROUPS_OFF') && askedCount === 0 && !surfaceOf(ctx, agent).includes('closed_one'),
  'a state:off group is refused by the gate itself without asking anyone, and stays masked: ' + JSON.stringify(closedGroup.text.slice(0, 210)))
const gatedGroup = await run(ctx, 'tool_groups_declare', { open: ['gated'] }, agent)
held('H2', gatedGroup.isError && /requires approval/u.test(gatedGroup.text) && !surfaceOf(ctx, agent).includes('gated_one'),
  'a userDisabled group is refused when no approval channel can answer, and stays masked: ' + JSON.stringify(gatedGroup.text.slice(0, 200)))
const tornGroup = await run(ctx, 'tool_groups_declare', { open: ['torn'] }, agent)
held('H3', !tornGroup.isError && tornGroup.text.includes('GROUPS_NO_TOOLS') && askedCount === 0,
  'the pair to H2: a group that is NOT userDisabled is reached by the same call shape with no approval question at all: ' + JSON.stringify(tornGroup.text.slice(0, 170)))
ctx.on('approval/request', () => { askedCount += 1; return Promise.resolve(approvalAnswer) })
approvalAnswer = 'rejected'
const declined = await run(ctx, 'tool_groups_declare', { open: ['gated'] }, agent)
held('H4', declined.isError && /rejected/u.test(declined.text) && askedCount === 1 && !surfaceOf(ctx, agent).includes('gated_one'),
  'a rejecting answerer leaves it closed and was asked exactly once: ' + JSON.stringify(declined.text.slice(0, 190)))
approvalAnswer = 'allowed-once'
const approved = await run(ctx, 'tool_groups_declare', { open: ['gated'], why: 'approved' }, agent)
const repeated = await run(ctx, 'tool_groups_declare', { open: ['gated'] }, agent)
const openedRows = (approved.text.match(/^- opened /gmu) ?? []).length + (repeated.text.match(/^- opened /gmu) ?? []).length
held('H5', !approved.isError && approved.text.includes('opened gated') && surfaceOf(ctx, agent).includes('gated_one') && openedRows === 1 && askedCount === 2,
  'after one approval exactly one slide opens it (' + String(openedRows) + ' opening row, ' + String(askedCount) + ' total asks): ' + JSON.stringify(approved.text.slice(0, 190)))

// ---------------------------------------------------------------------------
// 8. Automatic opening is the same path, decided by a condition instead of the model.
// ---------------------------------------------------------------------------
const autoDevice = plugins.requestAutoOpen(ctx, agent, 'device-b', 'a device became reachable')
held('I1', autoDevice.applied === true && autoDevice.effective === 'next-step' && autoDevice.cost.entries === surfaceOf(ctx, agent).length,
  'an observed condition opens the group through the same path and reports its own cost: ' + JSON.stringify(autoDevice).slice(0, 230))
const autoAgain = plugins.requestAutoOpen(ctx, agent, 'device-b', 'again')
held('I2', autoAgain.applied === false && autoAgain.code === 'GROUPS_INPUT',
  'opening an already-open group is a no-op refusal, not a second slide: ' + JSON.stringify(autoAgain).slice(0, 170))
const autoGated = plugins.requestAutoOpen(ctx, agent, 'torn', 'a typo group')
held('I3', autoGated.applied === false && autoGated.code === 'GROUPS_NO_TOOLS',
  'a broken group refuses with its named code on the automatic path too: ' + JSON.stringify(autoGated).slice(0, 190))
const autoUnknown = plugins.requestAutoOpen(ctx, agent, 'nosuch', 'x')
held('I4', autoUnknown.applied === false && autoUnknown.code === 'GROUPS_UNKNOWN' && autoUnknown.reason.includes('relock'),
  'an unknown id refuses and lists the known ids: ' + JSON.stringify(autoUnknown).slice(0, 210))
const autoDisabled = plugins.requestAutoOpen(ctx, agent, 'gated', 'a device tried to force it')
held('I5', autoDisabled.applied === false && autoDisabled.code === 'GROUPS_INPUT',
  'a user-disabled group that is already open is refused as already open, never silently re-opened: ' + JSON.stringify(autoDisabled).slice(0, 170))
const beforeSweep = surfaceOf(ctx, agent)
const force = await run(ctx, 'tool_groups_declare', { open: ['relock'], close: ['declared'] }, agent)
const afterSweep = surfaceOf(ctx, agent)
held('I6', force.isError === false && afterSweep.length === beforeSweep.length && beforeSweep.every((name, index) => afterSweep[index] === name),
  'a refused close leaves the surface name-for-name identical (' + String(beforeSweep.length) + ' names): ' + JSON.stringify(force.text.slice(0, 140)))

// ---------------------------------------------------------------------------
// 9. Teardown: the agent's surface returns to exactly what it was before the plugin.
// ---------------------------------------------------------------------------
await world.fiber.dispose()
const restored = surfaceOf(ctx, agent)
held('J1', JSON.stringify(restored) === JSON.stringify(before) && !restored.some(name => activation.includes(name)),
  'disposing the plugin fiber restores the pre-plugin surface name for name (' + String(restored.length) + ' names, activation tools gone)')
await world.unregister()
held('J2', JSON.stringify(surfaceOf(ctx, agent)) === JSON.stringify(before),
  'and the scope keeps no restriction after both owners tore down (' + String(surfaceOf(ctx, agent).length) + ' names)')

// ---------------------------------------------------------------------------
// 10. Where the state can live: a third-party plugin may not add a session event type.
// ---------------------------------------------------------------------------
const sessionModule = await import(pathToFileURL(join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js')).href)
const persistence = await import(pathToFileURL(join(KERNEL, 'packages', 'session', 'session-persistence', 'lib', 'types', 'storage-contract.js')).href)
const probeSession = Session.create(SessionId('r185a-probe'))
const beforeSeq = probeSession.seq
probeSession.append('turn/start', { turn: 1 })
const appendRefused = (() => {
  try {
    probeSession.append('tool-groups/state', { open: ['declared'] })
    return false
  } catch (_error) {
    return true
  }
})()
held('K1', appendRefused === false, 'a live append of an undeclared event type is NOT refused at runtime (seq ' + String(beforeSeq) + ' -> ' + String(probeSession.seq) + '), so nothing but the type system stands against it')
held('K1b', probeSession.snapshotEvents().some(event => event.type === 'tool-groups/state'),
  'the appended record really is in the log (seq ' + String(probeSession.seq) + '), which is what K2 then refuses on read')
const admitted = (() => {
  try {
    persistence.validateStoredEvents(probeSession.header, [...probeSession.snapshotEvents()])
    return 'accepted'
  } catch (error) {
    return String(error.message)
  }
})()
held('K2', typeof admitted === 'string' && /unknown to this harness and not marked ignorable/u.test(admitted),
  'the persistence read path refuses that log whole: ' + JSON.stringify(admitted.slice(0, 200)))
held('K3', sessionModule.KNOWN_SESSION_EVENT_TYPES.has('tool-groups/state') === false,
  'the generated vocabulary carries no third-party name (' + String(sessionModule.KNOWN_SESSION_EVENT_TYPES.size) + ' known types)')
const markedAdmitted = persistence.validateStoredEvents(probeSession.header, [{ type: 'external/info', seq: probeSession.seq + 1, time: 1, data: {}, ignorable: true }])
held('K4', Array.isArray(markedAdmitted) && markedAdmitted.length === 1,
  'an unknown type is admitted only when the WRITER marks it ignorable, which a live append cannot set')

// ---------------------------------------------------------------------------
// 11. The fold is order-independent, and that comparison can fail.
// ---------------------------------------------------------------------------
const sample = [
  { type: 'request/header', data: { header: { tools: [{ name: 'a' }] }, reason: 'initial' } },
  { type: 'developer/message', data: { message: { content: [{ type: 'tool-addition', toolName: 'b' }] } } },
  { type: 'request/header', data: { header: { tools: [{ name: 'a' }, { name: 'b' }] }, reason: 'change', startsSeries: true } },
]
const sortFold = (folded) => JSON.stringify({ headers: [...folded.headers].sort((left, right) => left.names.length - right.names.length), additions: [...folded.additions].sort() })
held('L1', sortFold(plugins.foldSurface(sample)) === sortFold(plugins.foldSurface([...sample].reverse())),
  'the same events fold to byte-identical state in either arrival order (' + String(sortFold(plugins.foldSurface(sample)).length) + ' bytes)')
held('L2', JSON.stringify(plugins.foldSurface(sample)) !== JSON.stringify(plugins.foldSurface([...sample].reverse())),
  'the pair is real: the raw folded arrays DO differ when the order is reversed, so L1 compares something that can move')

// ---------------------------------------------------------------------------
// 12. Report.
// ---------------------------------------------------------------------------
const failed = readings.filter(reading => reading.ok === false)
if (argv.includes('--json')) console.log(JSON.stringify(readings))
else {
  for (const reading of readings) console.log((reading.ok ? '  ok    ' : '  FAIL  ') + reading.id + '  |  ' + reading.detail)
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
}

if (argv.includes('--self-attack')) {
  const base = {}
  for (const reading of readings) base[reading.id] = reading.ok
  let bad = 0
  const moved = new Set()
  for (const [name, mutant] of Object.entries(MUTANTS)) {
    if (mutant.expect.length === 0) continue
    const runResult = spawnSync(process.execPath, [process.argv[1], '--json'], {
      encoding: 'utf8', timeout: 300000,
      env: { ...process.env, R185_MUTANT: name },
    })
    const line = ((runResult.stdout ?? '') + (runResult.stderr ?? '')).split(/\r?\n/u).filter(entry => entry.startsWith('[')).pop()
    if (line === undefined) { bad += 1; console.log('  FAIL  mutant ' + name + ' produced no readings'); continue }
    const afterMutant = {}
    for (const reading of JSON.parse(line)) afterMutant[reading.id] = reading.ok
    const flipped = Object.keys(afterMutant).filter(id => base[id] !== afterMutant[id]).sort()
    for (const id of flipped) moved.add(id)
    const ok = JSON.stringify(flipped) === JSON.stringify([...mutant.expect].sort())
    if (!ok) bad += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + 'mutant ' + name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + mutant.expect.join(','))
  }
  const uncovered = Object.keys(base).filter(id => !moved.has(id) && id !== 'A1' && id !== 'A2')
  console.log('coverage: ' + String(moved.size) + ' of ' + String(Object.keys(base).length) + ' readings moved; uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(bad))
  process.exit(failed.length === 0 && bad === 0 ? 0 : 1)
}
process.exit(failed.length === 0 ? 0 : 1)