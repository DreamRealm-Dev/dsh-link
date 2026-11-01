#!/usr/bin/env node
/**
 * The linkGroups seam smoke test (producer-owned, R194 P1).
 *
 * The world is the REAL kernel, mounted the way gates 115 / 116 and this
 * package's self-check mount it: a fresh cordis `Context` with the real
 * `SystemPrompt`, `ToolRuntime`, `AgentRegistry` and `Session`, an agent scope
 * minted with the real `createScope`, group members registered through the real
 * `ctx.tools.register()` on the GLOBAL layer, and the SHIPPED artifact
 * (`lib/index.js`) loaded through an import rewrite so the plugin and the world
 * share one registry instance. Nothing here stands in a fake registry, and no
 * model is involved: every reading is arithmetic over `ctx.tools.schemas(agent)`,
 * the directory the plugin renders, and the objects the seam returns.
 *
 * What it judges: the contract of `registerGroup` / `groups()` — a group
 * registered AFTER the agent was installed reaches that agent without a restart,
 * through the same `ctx.tools.restrict` path (measured as: closed member answers
 * like a name nobody registered, open member runs), and its disposer returns the
 * face to exactly its prior bytes. Plus the named refusals and the fact that a
 * second page does not steal the service or fail the row.
 *
 *   node plugins/dsh-link-groups/test/seam-smoke.mjs
 *
 * Exit 0 every reading held | 1 a reading failed | 3 NOT MEASURED (the kernel
 * modules or the built artifact are not there, so no honest reading exists).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE = resolve(HERE, '..')
const PROJECT = resolve(PACKAGE, '..', '..')
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')
const ARTIFACT = join(PACKAGE, 'lib', 'index.js')

/** The service name the contract freezes. Spelled here, not read from the artifact. */
const SERVICE_NAME = 'linkGroups'

/** The kernel modules the plugin imports, by path, so both sides share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
}

const readings = []
const held = (id, ok, detail) => { readings.push({ id, ok: ok === true, detail: String(detail) }); return ok === true }
const notMeasured = (why) => { console.log('NOT MEASURED: ' + why); process.exit(3) }
const show = (value) => { try { const text = JSON.stringify(value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)

for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
  if (!existsSync(file)) notMeasured('the kernel module ' + specifier + ' is missing at ' + file + '; this smoke test mounts the real registry and will not stand in a fake one')
}
if (!existsSync(ARTIFACT)) notMeasured('the built artifact is missing at ' + ARTIFACT + ' (run: node plugins/build.mjs)')

/** Rewrite the plugin's bare kernel imports onto the exact module paths this file also imports. */
function stage(source) {
  let text = source
  for (const [specifier, file] of Object.entries(KERNEL_MODULES)) {
    const url = pathToFileURL(file).href
    for (const quote of ["'", '"', '`']) text = text.split(quote + specifier + quote).join(quote + url + quote)
  }
  return text
}

const scratch = mkdtempSync(join(tmpdir(), 'r194-p1-seam-'))
const stagedFile = join(scratch, 'groups.mjs')
writeFileSync(stagedFile, stage(readFileSync(ARTIFACT, 'utf8')))
const plugins = await import(pathToFileURL(stagedFile).href)

const { Context } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/cordis']).href)
const { createScope } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-scope']).href)
const { default: SystemPrompt } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-system-prompt']).href)
const { default: ToolRuntime, defineTool } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-tools']).href)
const { Session, SessionId } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-session']).href)
const { default: AgentRegistry } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-agent']).href)

/** The names this test writes into the world, so a reader can tell a test fact from a work one. */
const NEVER_REGISTERED = 'seam_never_registered'
const MEMBERS = ['cfg_one', 'cfg_two', 'third_alpha', 'third_beta']
const CONFIG = { groups: [{ id: 'cfg', title: 'Config group', summary: 'declared by the row', tools: ['cfg_one', 'cfg_two'], state: 'on' }] }
const CONFIG_BYTES = JSON.stringify(CONFIG)

/** A registry-ready tool whose execution echoes its name. */
const toolFile = (name) => defineTool({
  name,
  description: 'group member ' + name,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: () => 'ran:' + name,
})

const mintAgent = (id) => ({
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
})

/** The names and payload bytes one agent can call right now: the face the gates measure. */
const faceOf = (ctx, agent) => {
  const schemas = ctx.tools.schemas(agent)
  return { names: schemas.map((tool) => tool.name), bytes: Buffer.byteLength(JSON.stringify(schemas), 'utf8') }
}

/** Build one world: real kernel services, the members on the global layer, one installed agent. */
async function buildWorld(config) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const logs = []
  ctx.logger.exporter({ levels: { default: 3 }, export: (message) => { logs.push(String(message.type) + '|' + message.args.map((argument) => String(argument)).join(' ')) } })
  for (const name of MEMBERS) ctx.tools.register(toolFile(name))
  const agent = mintAgent('seam-smoke-agent')
  await ctx.plugin(Object.assign((inner) => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
  await ctx.agents.register(agent)
  const preInstall = faceOf(ctx, agent)
  const fiber = ctx.plugin(plugins, config)
  await fiber
  return { ctx, agent, logs, preInstall, fiber }
}

let sequence = 0
/** Ask the real executor for one tool, exactly as a model's call would reach it. */
async function run(ctx, name, args, agent) {
  sequence += 1
  try {
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'seam-smoke-' + String(sequence),
      name,
      arguments: args === undefined ? {} : args,
      agent,
    })
    const first = result.content[0]
    return { isError: result.isError === true, text: first !== undefined && first.type === 'text' ? first.text : JSON.stringify(result.content) }
  } catch (error) {
    return { isError: true, text: 'Error: ' + describe(error) }
  }
}

const lineOf = (text, id) => text.split('\n').filter((line) => line.startsWith('- ' + id + ' '))[0] ?? null
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const world = await buildWorld(CONFIG)
const { ctx, agent } = world
/** The face the install left: the pair present, no contributed member in it. */
const faceInstalled = faceOf(ctx, agent)

// -- S1 / S2: the service exists where a page provides it, and answers nothing where none does.
const service = ctx.get(SERVICE_NAME)
held('S1', service !== null && typeof service === 'object' && typeof service.registerGroup === 'function' && typeof service.groups === 'function',
  'ctx.get(\'' + SERVICE_NAME + '\') after apply() answers a service with ' + show(service === null || service === undefined ? null : Object.keys(service)) + ' and typeof registerGroup=' + typeof (service === null || service === undefined ? undefined : service.registerGroup))
const bare = new Context()
const absent = bare.get(SERVICE_NAME)
held('S2', absent === undefined, 'a context with no link-groups page answers nothing for ctx.get(\'' + SERVICE_NAME + '\'): ' + String(absent))
await bare.fiber.dispose()

// -- S3: the merged directory starts as the config row, origin named.
const rowsInstall = service.groups()
held('S3', rowsInstall.length === 1 && rowsInstall[0].id === 'cfg' && rowsInstall[0].origin === 'config'
  && rowsInstall[0].state === 'on' && same(rowsInstall[0].members, ['cfg_one', 'cfg_two']),
  'groups() before any contribution: ' + show(rowsInstall))

// -- S4: a contributed group registers after the agent was installed, and the directory shows it after the config row.
const definition = { id: 'third', title: 'Third-party group', members: ['third_alpha', 'third_beta'] }
const disposeThird = service.registerGroup(definition)
const rowsAfter = service.groups()
held('S4', typeof disposeThird === 'function' && rowsAfter.length === 2 && rowsAfter[1].id === 'third' && rowsAfter[1].origin === 'contributed'
  && rowsAfter[1].state === 'auto' && same(rowsAfter[1].members, ['third_alpha', 'third_beta']) && same(rowsAfter[1].autoWhen, { when: 'declare' }),
  'registerGroup returned typeof ' + typeof disposeThird + '; groups() then read ' + show(rowsAfter))

// -- S5: the ALREADY INSTALLED agent's own directory learned the group without a restart.
const directory = await run(ctx, 'tool_groups', {}, agent)
const thirdRow = lineOf(directory.text, 'third')
held('S5', directory.isError === false && thirdRow !== null && thirdRow.includes('closed') && thirdRow.includes('state=auto')
  && thirdRow.includes('tools(2): third_alpha, third_beta') && thirdRow.includes('openable now'),
  'the installed agent directory row: ' + show(thirdRow))

// -- S6: the members are hidden from the face the moment the group arrives.
const faceBefore = faceOf(ctx, agent)
const withoutThird = faceInstalled.names.filter((name) => name !== 'third_alpha' && name !== 'third_beta')
held('S6', faceInstalled.names.includes('third_alpha') && faceInstalled.names.includes('third_beta')
  && faceBefore.names.includes('third_alpha') === false && faceBefore.names.includes('third_beta') === false
  && same(faceBefore.names, withoutThird) && faceBefore.bytes < faceInstalled.bytes,
  'the two members were on the face before the group existed (' + show(faceInstalled.names) + ', ' + String(faceInstalled.bytes) + ' bytes)'
  + ' and registerGroup masked exactly them (' + show(faceBefore.names) + ', ' + String(faceBefore.bytes) + ' bytes)')

// -- S7: closed is the hard gate, not a label: the member answers like a name nobody registered.
const closedAnswer = await run(ctx, 'third_alpha', {}, agent)
const ghostAnswer = await run(ctx, NEVER_REGISTERED, {}, agent)
const openAnswer = await run(ctx, 'cfg_one', {}, agent)
held('S7', closedAnswer.isError === true && ghostAnswer.isError === true
  && closedAnswer.text.replace('third_alpha', 'SAME') === ghostAnswer.text.replace(NEVER_REGISTERED, 'SAME')
  && openAnswer.text === 'ran:cfg_one',
  'the closed member answered ' + show(closedAnswer.text) + ' and a never-registered name answered ' + show(ghostAnswer.text) + '; the config group member still answered ' + show(openAnswer.text))

// -- S8: the config row was not rewritten by a contribution.
held('S8', JSON.stringify(CONFIG) === CONFIG_BYTES, 'the config object handed to the row is ' + (JSON.stringify(CONFIG) === CONFIG_BYTES ? 'byte-identical' : 'CHANGED') + ' after registerGroup: ' + show(CONFIG))

// -- S9: a declaration opens it, next step only, and the members reach the face.
const declared = await run(ctx, 'tool_groups_declare', { open: ['third'] }, agent)
const faceOpen = faceOf(ctx, agent)
held('S9', declared.isError === false && declared.text.includes('- opened third (effective: next-step)')
  && faceOpen.names.includes('third_alpha') && faceOpen.names.includes('third_beta'),
  'the declaration answered ' + show(declared.text.split('\n')[0]) + '; the face then read ' + show(faceOpen.names))

// -- S10: the disposer leaves the face exactly as it was, and the directory forgets the group.
disposeThird()
const faceDisposed = faceOf(ctx, agent)
const directoryAfter = await run(ctx, 'tool_groups', {}, agent)
held('S10', same(faceDisposed, faceInstalled) && service.groups().length === 1 && lineOf(directoryAfter.text, 'third') === null,
  'after the disposer the face is ' + show(faceDisposed.names) + ' (' + String(faceDisposed.bytes) + ' bytes)'
  + ' against the pre-registration face ' + show(faceInstalled.names) + ' (' + String(faceInstalled.bytes) + ' bytes)'
  + '; the closed-and-masked face it knew in between was ' + show(faceBefore.names) + '; groups() has ' + String(service.groups().length) + ' row(s)')

// -- S11: a group whose member reaches no layer is registered and reported broken, never half-masked.
const disposeGhostGroup = service.registerGroup({ id: 'ghostgroup', title: 'A member nobody registered', members: [NEVER_REGISTERED] })
const ghostDirectory = await run(ctx, 'tool_groups', {}, agent)
const ghostRow = lineOf(ghostDirectory.text, 'ghostgroup')
held('S11', typeof disposeGhostGroup === 'function' && ghostRow !== null && ghostRow.includes('blocked: GROUPS_NO_TOOLS') && ghostRow.includes('openable now') === false,
  'a group whose only member reaches no layer: ' + show(ghostRow))
disposeGhostGroup()

// -- S12: a duplicate id is refused by name, and nothing is half-installed.
const faceBeforeDuplicate = faceOf(ctx, agent)
const disposeTwice = service.registerGroup({ id: 'twice', title: 'Registered twice', members: ['third_alpha'] })
const faceWithTwice = faceOf(ctx, agent)
const rowsWithTwice = service.groups().length
let sameIdRefusal = null
try { service.registerGroup({ id: 'twice', title: 'A silent merge', members: ['third_beta'] }) } catch (error) { sameIdRefusal = describe(error) }
let configIdRefusal = null
try { service.registerGroup({ id: 'cfg', title: 'Steal the config row', members: ['cfg_two'] }) } catch (error) { configIdRefusal = describe(error) }
const faceAfterRefusals = faceOf(ctx, agent)
const rowsAfterRefusals = service.groups().length
disposeTwice()
held('S12', sameIdRefusal !== null && sameIdRefusal.includes('LINK_GROUPS_DUPLICATE_GROUP') === true
  && configIdRefusal !== null && configIdRefusal.includes('LINK_GROUPS_DUPLICATE_GROUP') === true
  && same(faceAfterRefusals, faceWithTwice) && rowsAfterRefusals === rowsWithTwice && same(faceOf(ctx, agent), faceBeforeDuplicate) && service.groups().length === 1,
  'a second registration of the same id was refused with ' + show(sameIdRefusal) + '; the config id with ' + show(configIdRefusal)
  + '; the face and the directory did not move (' + String(rowsWithTwice) + ' -> ' + String(rowsAfterRefusals) + ' rows)')

// -- S13: a malformed definition is refused with the seam's input code and installs nothing.
const malformed = []
for (const bad of [null, { id: 'UPPER', members: ['cfg_one'] }, { id: 'ok', members: [] }, { id: 'ok2', members: ['cfg_one'], autoWhen: 'never' }]) {
  try { service.registerGroup(bad) } catch (error) { malformed.push(describe(error)) }
}
held('S13', malformed.length === 4 && malformed.every((message) => message.includes('LINK_GROUPS_INPUT')) && service.groups().length === 1 && same(faceOf(ctx, agent), faceBeforeDuplicate),
  'four malformed definitions each refused with the input code, nothing installed: ' + show(malformed.map((message) => message.slice(0, 90))))

// -- S14: a contributed group whose condition is observed by its own plugin opens through requestAutoOpen.
const disposeDevice = service.registerGroup({ id: 'devicegroup', title: 'Opened by a condition', members: ['third_alpha', 'third_beta'], autoWhen: 'device' })
const faceDeviceClosed = faceOf(ctx, agent)
const opened = plugins.requestAutoOpen(ctx, agent, 'devicegroup', 'a device became reachable')
const faceDeviceOpen = faceOf(ctx, agent)
disposeDevice()
held('S14', opened.applied === true && opened.effective === 'next-step' && opened.cost.entries === faceDeviceOpen.names.length
  && faceDeviceClosed.names.includes('third_alpha') === false && faceDeviceOpen.names.includes('third_alpha') && same(faceOf(ctx, agent), faceBeforeDuplicate),
  'the automatic path opened the contributed group: ' + show({ applied: opened.applied, effective: opened.effective, entries: opened.cost === undefined ? null : opened.cost.entries })
  + '; the face went ' + show(faceDeviceClosed.names) + ' -> ' + show(faceDeviceOpen.names) + ' and back to ' + show(faceOf(ctx, agent).names) + ' after the disposal')

// -- S15: a member registered on the agent's OWN layer cannot be masked, so the group reads broken instead of throwing.
const disposeOwn = agent.ctx.tools.register(toolFile('own_layer_tool'))
const faceOwn = faceOf(ctx, agent)
let ownRefusal = null
let disposeOwnGroup = null
try { disposeOwnGroup = service.registerGroup({ id: 'ownheld', title: 'A member on the agent layer', members: ['own_layer_tool'] }) } catch (error) { ownRefusal = describe(error) }
const ownDirectory = await run(ctx, 'tool_groups', {}, agent)
const ownRow = lineOf(ownDirectory.text, 'ownheld')
const faceOwnAfter = faceOf(ctx, agent)
if (disposeOwnGroup !== null) disposeOwnGroup()
held('S15', ownRefusal === null && typeof disposeOwnGroup === 'function' && ownRow !== null
  && ownRow.includes('blocked: GROUPS_NO_TOOLS: registered on the agent own layer') && faceOwnAfter.names.includes('own_layer_tool'),
  'a member on the agent own layer: registerGroup answered ' + show(ownRefusal) + ', the row reads ' + show(ownRow)
  + ', and the unmaskable member stayed on the face (' + String(faceOwn.names.length) + ' -> ' + String(faceOwnAfter.names.length) + ' names)')
disposeOwn()

// -- S16: a second page on the same context does not steal the service and does not fail the row.
const secondLogs = []
const applySecond = (inner) => {
  try { plugins.apply(inner, CONFIG) } catch (error) { secondLogs.push('threw|' + describe(error)) }
}
applySecond(ctx)
const stillTheFirst = ctx.get(SERVICE_NAME)
const activation = faceOf(ctx, agent).names.filter((name) => name === 'tool_groups' || name === 'tool_groups_declare')
held('S16', secondLogs.length === 0 && stillTheFirst !== undefined && typeof stillTheFirst.groups === 'function'
  && stillTheFirst.groups().length === 1 && activation.length === 2
  && world.logs.some((line) => line.includes('LINK_GROUPS_SERVICE_TAKEN')) && world.logs.some((line) => line.includes('GROUPS_COLLISION')),
  'the second apply() answered ' + show(secondLogs) + '; the service still answers (' + String(stillTheFirst === undefined ? 'nothing' : stillTheFirst.groups().length) + ' config row(s))'
  + '; the activation pair appears ' + String(activation.length) + ' time(s); its log lines named '
  + show(world.logs.filter((line) => line.includes('LINK_GROUPS_SERVICE_TAKEN') || line.includes('GROUPS_COLLISION')).map((line) => line.slice(0, 150))))

// -- S17: a third-party plugin declared BEFORE the page lands anyway, because inject withholds it until the service appears.
const late = new Context()
await late.plugin(SystemPrompt, {})
await late.plugin(ToolRuntime)
await late.plugin(AgentRegistry)
for (const name of MEMBERS) late.tools.register(toolFile(name))
const lateAgent = mintAgent('seam-smoke-late')
await late.plugin(Object.assign((inner) => { lateAgent.ctx = createScope(inner, lateAgent).ctx }, { inject: ['tools', 'systemPrompt'] }))
await late.agents.register(lateAgent)
const beforePage = { service: late.get(SERVICE_NAME), face: faceOf(late, lateAgent) }
const thirdParty = {
  name: 'seam-smoke-third-party',
  inject: [SERVICE_NAME],
  apply(inner) {
    const seam = inner.get(SERVICE_NAME)
    inner.effect(() => seam.registerGroup({ id: 'late', title: 'Registered before the page', members: ['third_alpha'] }))
  },
}
const thirdFiber = late.plugin(thirdParty, {})
await new Promise((done) => setTimeout(done, 20))
const pageFiber = late.plugin(plugins, { groups: [] })
await pageFiber
await new Promise((done) => setTimeout(done, 20))
const lateSeam = late.get(SERVICE_NAME)
const lateRows = lateSeam === undefined ? [] : lateSeam.groups().map((row) => row.id + ':' + row.origin)
const lateDirectory = lineOf((await run(late, 'tool_groups', {}, lateAgent)).text, 'late')
const afterPage = faceOf(late, lateAgent)
await pageFiber.dispose()
await new Promise((done) => setTimeout(done, 20))
const afterUnload = { service: late.get(SERVICE_NAME), face: faceOf(late, lateAgent) }
await thirdFiber
await late.fiber.dispose()
held('S17', beforePage.service === undefined && beforePage.face.names.includes('third_alpha')
  && lateSeam !== undefined && same(lateRows, ['late:contributed'])
  && lateDirectory !== null && afterPage.names.includes('third_alpha') === false
  && afterUnload.service === undefined && afterUnload.face.names.includes('third_alpha'),
  'declared before the page: service ' + String(beforePage.service) + ' and third_alpha on the face; after the page: rows ' + show(lateRows)
  + ', the directory row ' + show(lateDirectory) + ', the member masked (' + show(afterPage.names) + '); unloading the page gave the member back (' + show(afterUnload.face.names) + ')')

// -- done.
await world.fiber.dispose()
rmSync(scratch, { recursive: true, force: true })

const failed = readings.filter((reading) => reading.ok === false)
const width = Math.max(...readings.map((reading) => reading.id.length))
for (const reading of readings) console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id.padEnd(width) + '  ' + reading.detail)
console.log('seam-smoke: ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed')
process.exit(failed.length === 0 ? 0 : 1)
