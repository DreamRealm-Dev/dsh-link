#!/usr/bin/env node
/**
 * Gate 129 (R194 P3) - tool-groups-thirdparty-seam: A THIRD PARTY THAT USES ONLY THE PUBLIC
 * SEAM GETS A HARD-GATED GROUP, WITHOUT TOUCHING THE CONFIG ROW.
 *
 * Subject: the `linkGroups` service of plugins/dsh-link-groups, required by
 * docs/handoff/R194-contract.md section 2 deliverable P3 and described for authors by
 * docs/dev/tool-groups.md. Shipped in plugins/dsh-link-groups/lib/index.js. Written by a verifier
 * who wrote neither the seam (P1), nor the contract page (P2), nor the producer's own smoke test.
 *
 * THE WORLD IS THE REAL KERNEL RUNNING THE SHIPPED ARTIFACT. A fresh cordis Context mounts the
 * kernel's own SystemPrompt, ToolRuntime, Session and AgentRegistry; the agent is minted with the
 * kernel's own createScope() and registered with the real ctx.agents.register(), so the tool face,
 * the directory text and the executor answers below are the kernel's, not a stand-in. The subject
 * is the ARTIFACT'S OWN BYTES: lib/index.js is read, its bare kernel imports are rewritten onto
 * the exact module paths this file imports, and the staged copy is loaded, so the plugin and the
 * world share ONE registry instance. No model is involved and no port is opened: every reading is
 * arithmetic over ctx.tools.schemas(agent), the text the tool_groups executor returns, the objects
 * the seam returns, and the bytes of the object the gate handed to apply().
 *
 * THE PRODUCER'S OWN TEST IS NOT USED. plugins/dsh-link-groups/test/seam-smoke.mjs exists and was
 * read for orientation only: it is never imported, never executed, and none of its numbers are
 * read here. A gate that calls the producer's test cannot fail on its own terms; this one drives
 * the artifact itself.
 *
 * SIX READINGS, each able to fail alone on its own evidence:
 *
 *   a. a synthetic third-party plugin's group is in the directory with its own id, members and
 *      state. The plugin is the gate's own: its whole API surface is ctx.tools.register() for its
 *      own members and ctx.get('linkGroups') for the seam. Its group must appear in the groups()
 *      read (origin 'contributed', state 'auto', its own members in its own order) and in the
 *      model-facing tool_groups text, row for row, after the config row.
 *   b. the link-groups config row is NOT rewritten. The very object handed to apply() is byte-
 *      identical at every checkpoint of the contribution (before the page, after it, after the
 *      contribution, after the disposer, after the declaration, after the second page), and the
 *      seam's own config-origin rows stay exactly the ones the row declared. Paired control: the
 *      same instrument reads the DIRECTORY change across those same checkpoints, so "unchanged"
 *      is not a blind comparison.
 *   c. hard gating holds for a CONTRIBUTED group. Before any declaration its members are off the
 *      tool face and the EXECUTOR answers unknown tool "<name>", byte-identically to a name that
 *      was never registered; after tool_groups_declare opens it they are on the face and they run.
 *      A build that only hides the schema reddens here.
 *   d. the disposer returns the face to exactly its prior bytes. The contributed group is disposed
 *      while it is CLOSED and still masking, and the face the disposer leaves must equal, byte for
 *      byte, the face this gate captured at the instant before that group was registered. The
 *      group is gone from the directory and its member runs again.
 *   e. a duplicate id is refused BY NAME and nothing is half-installed. Both a duplicate of a
 *      contributed id and a duplicate of a config id throw with LINK_GROUPS_DUPLICATE_GROUP; the
 *      face, the directory and the surviving row's membership do not move, and a tool named only
 *      by the refused definition is still on the face afterwards (a silent merge would mask it).
 *   f. two instances of dsh-link-groups still collide with GROUPS_COLLISION - the old behaviour,
 *      unchanged. A second apply() on the same context is refused per agent by name, the first
 *      instance keeps the service and its installation, the face does not move, and the activation
 *      pair still appears exactly once.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 the subject could not be measured here (a
 * kernel module or the shipped artifact is missing, or the world could not be built). A reading
 * that cannot be taken is printed as NOT MEASURED and the gate exits 3: it is never counted green.
 *
 * Self-attack: --self-attack rewrites the SHIPPED ARTIFACT'S OWN BYTES (one string replacement per
 * mutant, anchored on the product rather than on a fixture) and re-measures the whole world
 * against that build, requiring the set of readings that moved to EQUAL the declared set, with
 * every reading covered by at least one mutant and a control mutant that changes nothing.
 *
 * Usage: node scripts/verify-tool-groups-thirdparty-seam.mjs [--module <path>] [--self-attack] [--keep]
 */

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
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const KEEP = argv.includes('--keep')
const SELF_ATTACK = argv.includes('--self-attack')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-groups', 'lib', 'index.js')))
const PAGE_PATH = join(PROJECT, 'docs', 'dev', 'tool-groups.md')

/** The kernel modules the plugin imports, by path, so both sides share one instance. */
const KERNEL_MODULES = {
  '@deepseek-ai/cordis': join(KERNEL, 'vendor', 'cordis', 'lib', 'index.js'),
  '@deepseek-ai/dsh-scope': join(KERNEL, 'packages', 'core', 'scope', 'lib', 'index.js'),
  '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  '@deepseek-ai/dsh-system-prompt': join(KERNEL, 'packages', 'core', 'system-prompt', 'lib', 'index.js'),
  '@deepseek-ai/dsh-session': join(KERNEL, 'packages', 'core', 'session', 'lib', 'index.js'),
  '@deepseek-ai/dsh-agent': join(KERNEL, 'packages', 'core', 'agent', 'lib', 'index.js'),
}

const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (list) => [...(Array.isArray(list) ? list : [])].sort()
const NOT_MEASURED = (why) => { console.log('NOT MEASURED: ' + why); return 3 }

/** The names this gate writes into the world, so a reader can tell a test fact from a work one. */
const AGENT_ID = 'gate129-agent'
const SERVICE = 'linkGroups'
const NEVER_REGISTERED = 'gate129_never_registered_at_all'
const DECLARE_TOOL = 'tool_groups_declare'
const CATALOG_TOOL = 'tool_groups'
const ACTIVATION = [CATALOG_TOOL, DECLARE_TOOL]

/** The config row this deployment owns: ONE entry, 'on' at install, and the gate's own data. */
const CONFIG_GROUP = { id: 'cfg', title: 'The row the deployment owns', summary: 'a configured group', tools: ['cfg_one', 'cfg_two'], state: 'on' }
const CONFIG = { groups: [CONFIG_GROUP], deferredNotice: true }
const CONFIG_BYTES = JSON.stringify(CONFIG)
const CONFIG_SNAPSHOT = JSON.parse(CONFIG_BYTES)

/** What the synthetic third party contributes. Every expectation below is computed from THIS object. */
const TP_TOOLS = ['tp_search', 'tp_extra', 'tp_spare', 'tp_guard']
const TP_DEFINITION = { id: 'tp', title: 'Gate 129 third-party group', members: ['tp_search', 'tp_extra'] }
const TP_SIDE_DEFINITION = { id: 'tp-side', title: 'Gate 129 side group', members: ['tp_spare'] }
/** A tool no group names: if a refused registration were half-installed, this name would vanish. */
const GUARD_TOOL = 'tp_guard'

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

/** A registry-ready tool whose execution echoes its name. */
const toolFile = (defineTool, name) => defineTool({
  name,
  description: 'gate 129 member ' + name,
  parameters: {},
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
  execute: () => 'ran:' + name,
})

/** The agent row the kernel's own registry accepts: id and session id must agree. */
const mintAgent = (Session, SessionId, id) => ({
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

/**
 * The synthetic third-party plugin: the ONLY extension it uses is the public seam. It registers
 * its own tools through ctx.tools.register() (the kernel's public registration, which is how a
 * plugin owns a tool at all) and reaches the group directory through ctx.get('linkGroups').
 * 'linkGroups' is in its inject list, which is the documented way for a consumer that cannot work
 * without the service to name its absence: cordis withholds this plugin until a page provides one.
 * @param faceOf - the gate's own face reader, closed over the live world.
 * @param spec - the record the gate reads afterwards; every value in it is a live measurement.
 * @returns the plugin object handed to ctx.plugin().
 */
const makeThirdParty = (faceOf, spec) => ({
  name: 'gate129-third-party',
  inject: ['tools', SERVICE],
  apply(inner) {
    const seam = inner.get(SERVICE)
    spec.seamKeys = seam === undefined ? null : sorted(Object.keys(seam))
    spec.seamAnswers = seam !== undefined && typeof seam.registerGroup === 'function' && typeof seam.groups === 'function'
    if (seam === undefined) throw new Error('gate 129: ctx.get(linkGroups) answered nothing, so the seam this gate judges does not exist')
    for (const name of TP_TOOLS) inner.effect(() => inner.tools.register(toolFile(spec.defineTool, name)))
    spec.facePrior = faceOf()
    spec.rowsBefore = seam.groups().map((row) => String(row.id) + ':' + String(row.origin))
    const disposeMain = seam.registerGroup(TP_DEFINITION)
    spec.faceClosedMain = faceOf()
    const disposeSide = seam.registerGroup(TP_SIDE_DEFINITION)
    spec.faceClosedBoth = faceOf()
    spec.rowsAfter = seam.groups().map((row) => String(row.id) + ':' + String(row.origin))
    spec.disposers = { main: disposeMain, side: disposeSide }
    // Owned the way a real third-party plugin owns them: unloading the plugin takes the group out.
    inner.effect(() => () => { disposeMain(); disposeSide() })
  },
})

// ---------------------------------------------------------------------------
// One world: real kernel, real registry, the shipped artifact applied, the synthetic third party.
// ---------------------------------------------------------------------------
const collect = async (label, mutate) => {
  const root = mkdtempSync(join(tmpdir(), 'r194-g129-' + label + '-'))
  const world = {
    label,
    root,
    fatal: null,
    artifact: { path: MODULE_PATH, mutated: mutate !== null, bytes: 0, imports: [], mutatedBytes: 0 },
    plugin: null,
    boot: [],
    logs: [],
    service: {},
    config: [],
    face: {},
    rows: {},
    catalog: {},
    third: {},
    probes: {},
    disposal: {},
    duplicates: {},
    collision: {},
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
    world.artifact.mutatedBytes = Buffer.byteLength(source, 'utf8')
    const pluginFile = join(root, 'groups.mjs')
    writeFileSync(pluginFile, stageSource(source))
    const plugins = await import(pathToFileURL(pluginFile).href)
    world.plugin = {
      name: typeof plugins.name === 'string' ? plugins.name : null,
      inject: Array.isArray(plugins.inject) ? plugins.inject : null,
      hasDefault: plugins.default !== undefined,
      apply: typeof plugins.apply,
    }

    const { Context } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/cordis']).href)
    const { createScope } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-scope']).href)
    const { default: SystemPrompt } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-system-prompt']).href)
    const { default: ToolRuntime, defineTool } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-tools']).href)
    const { Session, SessionId } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-session']).href)
    const { default: AgentRegistry } = await import(pathToFileURL(KERNEL_MODULES['@deepseek-ai/dsh-agent']).href)

    // A fresh copy of the row per world: a mutant that rewrites the object it was handed must not
    // leak into the next world, and CONFIG_BYTES stays the one canonical set of bytes.


    const live = new Context()
    ctx = live
    await live.plugin(SystemPrompt, {})
    await live.plugin(ToolRuntime)
    await live.plugin(AgentRegistry)
    live.logger.exporter({
      levels: { default: 3 },
      export: (message) => { world.logs.push(String(message.type) + ' | ' + (Array.isArray(message.args) ? message.args : []).map(String).join(' ')) },
    })
    for (const name of CONFIG_GROUP.tools) live.tools.register(toolFile(defineTool, name))

    const agent = mintAgent(Session, SessionId, AGENT_ID)
    await live.plugin(Object.assign((inner) => { agent.ctx = createScope(inner, agent).ctx }, { inject: ['tools', 'systemPrompt'] }))
    await live.agents.register(agent)

    /** The names and payload bytes one agent can call right now: the face every reading stands on. */
    const faceOf = () => {
      const schemas = live.tools.schemas(agent)
      const json = JSON.stringify(schemas)
      return { names: schemas.map((tool) => tool.name), json, bytes: Buffer.byteLength(json, 'utf8') }
    }
    let sequence = 0
    /** Ask the real executor for one tool, exactly as a model's call reaches it. */
    const run = async (name, args) => {
      sequence += 1
      try {
        const result = await live.tools.execute({
          signal: new AbortController().signal,
          callId: 'gate129-' + String(sequence),
          name,
          arguments: args === undefined ? {} : args,
          agent,
        })
        const first = result.content[0]
        return { isError: result.isError === true, text: first !== undefined && first.type === 'text' ? first.text : show(result.content) }
      } catch (error) {
        return { isError: true, text: 'Error: ' + describe(error) }
      }
    }
    const seamOf = () => live.get(SERVICE)
    const rowsOf = () => { const seam = seamOf(); return seam === undefined ? null : seam.groups() }
    const sealOf = () => {
      const seam = seamOf()
      if (seam === undefined) return { present: false, keys: null }
      return { present: true, keys: sorted(Object.keys(seam)) }
    }
    /**
     * Apply one plugin with console.log captured for the WHOLE apply, so the package's own boot line
     * is evidence the gate reads instead of noise on its own stdout. ctx.plugin() runs apply on a
     * later tick, so the capture window has to span the await.
     */
    const applyQuiet = async (factory) => {
      const original = console.log
      console.log = (...args) => { world.boot.push(args.map(String).join(' ')) }
      try {
        const fiber = factory()
        await fiber
        return fiber
      } finally { console.log = original }
    }
    const config = JSON.parse(CONFIG_BYTES)
    const checkpoint = (at) => { world.config.push({ at, bytes: JSON.stringify(config), rows: rowsOf() }) }

    world.face.beforePage = faceOf()
    world.service.beforePage = sealOf().present ? 'present' : 'absent'
    checkpoint('before the page is applied')

    // ---- the page: the shipped artifact applied with this gate's own config row ----------------
    await applyQuiet(() => live.plugin(plugins, config))
    world.service.afterPage = sealOf()
    world.face.afterPage = faceOf()
    world.rows.afterPage = rowsOf()
    world.catalog.afterPage = (await run(CATALOG_TOOL, {})).text
    checkpoint('after the page is applied')

    // ---- the third party: its own tools, then its two groups, through the public seam ---------
    world.third.defineTool = defineTool
    await applyQuiet(() => live.plugin(makeThirdParty(faceOf, world.third)))
    world.face.afterContribution = faceOf()
    world.rows.afterContribution = rowsOf()
    world.catalog.afterContribution = (await run(CATALOG_TOOL, {})).text
    checkpoint('after the contribution')

    // ---- (c) before the declaration: a closed contributed member is a name that never existed --
    world.probes.closedSearch = await run('tp_search', {})
    world.probes.closedExtra = await run('tp_extra', {})
    world.probes.closedSpare = await run('tp_spare', {})
    world.probes.ghost = await run(NEVER_REGISTERED, {})
    world.probes.guardClosedPhase = await run(GUARD_TOOL, {})

    // ---- (d) the disposer, taken while the side group is CLOSED and still masking --------------
    const disposeSide = world.third.disposers === undefined ? null : world.third.disposers.side
    if (disposeSide === null) throw new Error('gate 129: the synthetic third party returned no disposer for its second group')
    disposeSide()
    world.disposal = {
      prior: world.third.faceClosedMain,
      after: faceOf(),
      rows: rowsOf(),
      catalog: (await run(CATALOG_TOOL, {})).text,
      memberRuns: await run('tp_spare', {}),
    }
    checkpoint('after the disposer')

    // ---- (e) duplicate ids: refused by name, nothing half-installed ----------------------------
    const seam = seamOf()
    const attempt = (definition) => {
      try {
        const dispose = seam.registerGroup(definition)
        if (typeof dispose === 'function') dispose()
        return { threw: false, message: null, disposeType: typeof dispose }
      } catch (error) {
        return { threw: true, message: describe(error), disposeType: null }
      }
    }
    world.duplicates.before = { face: faceOf(), rows: rowsOf() }
    world.duplicates.sameId = attempt({ id: TP_DEFINITION.id, title: 'A silent merge', members: [GUARD_TOOL] })
    world.duplicates.afterSameId = { face: faceOf(), rows: rowsOf() }
    world.duplicates.configId = attempt({ id: CONFIG_GROUP.id, title: 'Steal the config row', members: [GUARD_TOOL] })
    world.duplicates.afterConfigId = { face: faceOf(), rows: rowsOf() }
    world.duplicates.guardRuns = await run(GUARD_TOOL, {})
    world.duplicates.row = (rowsOf() ?? []).filter((row) => row.id === TP_DEFINITION.id)

    // ---- (c) after the declaration: the contributed members reach the face and run -------------
    world.probes.declare = await run(DECLARE_TOOL, { open: [TP_DEFINITION.id], why: 'gate 129: open the contributed group' })
    world.face.afterDeclare = faceOf()
    world.probes.declaredSearch = await run('tp_search', {})
    world.probes.declaredExtra = await run('tp_extra', {})
    world.rows.afterDeclare = rowsOf()
    world.catalog.afterDeclare = (await run(CATALOG_TOOL, {})).text
    checkpoint('after the declaration')

    // ---- (f) a second instance of this package: the old collision, unchanged -------------------
    const logStart = world.logs.length
    world.collision.faceBefore = faceOf()
    world.collision.rowsBefore = rowsOf()
    await applyQuiet(() => live.plugin(plugins, config))
    world.collision.faceAfter = faceOf()
    world.collision.rowsAfter = rowsOf()
    world.collision.service = sealOf()
    world.collision.catalog = (await run(CATALOG_TOOL, {})).text
    world.collision.lines = world.logs.slice(logStart)
    world.collision.bootLines = world.boot.slice(-1)
    checkpoint('after the second page')
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
  const parts = line.slice(2).split(' \u00b7 ')
  const statePart = parts.filter((part) => part.startsWith('state='))[0]
  const toolsPart = parts.filter((part) => /^tools\(\d+\):/u.test(part))[0]
  const toolList = toolsPart === undefined ? null : toolsPart.slice(toolsPart.indexOf(':') + 1).trim()
  return {
    id: parts[0],
    stateWord: parts[1] === undefined ? null : parts[1],
    state: statePart === undefined ? null : statePart.slice('state='.length),
    tools: toolList === null || toolList === '(none)' ? [] : toolList.split(', ').map((name) => name.trim()),
    openable: parts.includes('openable now'),
    needsApproval: parts.some((part) => part.startsWith('USER-DISABLED')),
    relockable: parts.includes('relockable'),
    line,
  }
}
const directoryRows = (text) => (typeof text === 'string' ? text : '').split('\n').filter((line) => line.startsWith('- ')).map(parseRow)
const rowOf = (rows, id) => (Array.isArray(rows) ? rows : []).filter((row) => row.id === id)[0] ?? null

// ---------------------------------------------------------------------------
// The judge: one reading per claim, over its OWN evidence.
// ---------------------------------------------------------------------------
const judge = (world) => {
  const out = []
  const add = (id, status, detail, evidence) => out.push({ id, status, detail: String(detail), evidence: (Array.isArray(evidence) ? evidence : []).map((line) => String(line)) })
  const face = (name) => world.face[name] ?? { names: [], json: '', bytes: -1 }
  const rowsAt = (name) => (Array.isArray(world.rows[name]) ? world.rows[name] : [])
  const catalogAt = (name) => directoryRows(world.catalog[name])
  const third = world.third ?? {}
  const probes = world.probes ?? {}

  // (a) -- the contributed group is in the directory with the id, members and state it declared.
  {
    const rows = rowsAt('afterContribution')
    const contributed = rows.filter((row) => row.origin === 'contributed').map((row) => row.id + ':' + row.origin)
    const row = rows.filter((candidate) => candidate.id === TP_DEFINITION.id)[0] ?? null
    const dirRow = rowOf(catalogAt('afterContribution'), TP_DEFINITION.id)
    // Whether the group arrives closed is reading (c)'s subject, not this one: this reading judges
    // that the directory carries the id, the members and the configured state the third party wrote.
    const ok = row !== null && row.origin === 'contributed' && row.state === 'auto'
      && same(row.members, [...TP_DEFINITION.members]) && same(row.autoWhen, { when: 'declare' })
      && same(contributed, [TP_DEFINITION.id + ':contributed', TP_SIDE_DEFINITION.id + ':contributed'])
      && dirRow !== null && (dirRow.stateWord === 'closed' || dirRow.stateWord === 'OPEN') && dirRow.state === 'auto'
      && same(dirRow.tools, [...TP_DEFINITION.members])
      && rows[0] !== undefined && rows[0].id === CONFIG_GROUP.id && rows[0].origin === 'config'
    add('a-third-party-group-in-the-directory', rows.length === 0 ? 'not-measured' : ok ? 'ok' : 'fail',
      'groups() read ' + show(rows.map((candidate) => candidate.id + ':' + candidate.origin + ':' + candidate.state + ':' + candidate.members.join('+')))
      + '; the model-facing directory row for "' + TP_DEFINITION.id + '" read ' + show(dirRow === null ? null : dirRow.line),
      ['the definition the synthetic third party passed to registerGroup: ' + show(TP_DEFINITION),
        'the groups() row as the seam returned it: ' + show(row),
        'the seam the plugin reached: ctx.get(' + SERVICE + ') keys ' + show(third.seamKeys) + ', registerGroup and groups both functions: ' + show(third.seamAnswers),
        'rows before the contribution ' + show(third.rowsBefore) + ' -> after ' + show(third.rowsAfter)])
  }

  // (b) -- the config row is not rewritten, and the instrument is not blind.
  {
    const checkpoints = Array.isArray(world.config) ? world.config : []
    const bytes = checkpoints.map((entry) => entry.bytes)
    const identical = bytes.length >= 6 && bytes.every((value) => value === CONFIG_BYTES)
    const deep = checkpoints.length > 0 && checkpoints.every((entry) => same(JSON.parse(entry.bytes), CONFIG_SNAPSHOT))
    // The first checkpoint is taken before any page exists, so no seam can answer there: only the
    // checkpoints with a live directory can carry a config-origin row, and all of them must agree.
    const configRows = checkpoints.filter((entry) => Array.isArray(entry.rows)).map((entry) => entry.rows.filter((row) => row.origin === 'config'))
    const configStable = configRows.length >= 5 && configRows.every((rows) => rows.length === 1 && rows[0].id === CONFIG_GROUP.id
      && same(rows[0].members, [...CONFIG_GROUP.tools]) && rows[0].state === CONFIG_GROUP.state)
    const grew = checkpoints.some((entry) => Array.isArray(entry.rows) && entry.rows.length === 3)
    const ok = identical && deep && configStable && grew
    add('b-the-config-row-is-not-rewritten', checkpoints.length === 0 ? 'not-measured' : ok ? 'ok' : 'fail',
      'the object handed to apply() is ' + String(bytes.length) + ' checkpoint(s) ' + (identical ? 'byte-identical' : 'CHANGED') + ' to the ' + String(Buffer.byteLength(CONFIG_BYTES, 'utf8')) + ' bytes it started as '
      + show(CONFIG_BYTES) + '; its config-origin rows ' + (configStable ? 'stayed exactly [' + CONFIG_GROUP.id + ':' + CONFIG_GROUP.state + ':' + CONFIG_GROUP.tools.join('+') + ']' : 'MOVED')
      + '; paired control, the same reader saw the directory ' + show(checkpoints.map((entry) => (Array.isArray(entry.rows) ? entry.rows.length : 'no seam yet'))) + ' rows',
      ['checkpoints: ' + show(checkpoints.map((entry) => entry.at + ' => ' + String(Buffer.byteLength(entry.bytes, 'utf8')) + ' B'))])
  }

  // (c) -- a contributed group is hard-gated at the EXECUTOR, not only in the schema.
  {
    const closed = [probes.closedSearch, probes.closedExtra, probes.closedSpare, probes.ghost]
    const closedOk = closed.every((answer) => answer !== undefined && answer.isError === true)
    const strip = (text, name) => String(text).split(name).join('<NAME>')
    const identical = probes.ghost !== undefined && probes.closedSearch !== undefined && probes.closedExtra !== undefined
      && strip(probes.closedSearch.text, 'tp_search') === strip(probes.ghost.text, NEVER_REGISTERED)
      && strip(probes.closedExtra.text, 'tp_extra') === strip(probes.ghost.text, NEVER_REGISTERED)
    const faceClosed = face('afterContribution')
    const absentBefore = TP_DEFINITION.members.every((name) => faceClosed.names.includes(name) === false)
      && TP_SIDE_DEFINITION.members.every((name) => faceClosed.names.includes(name) === false)
    const guardWorks = probes.guardClosedPhase !== undefined && probes.guardClosedPhase.text === 'ran:' + GUARD_TOOL
    const declaredText = String(probes.declare === undefined ? '' : probes.declare.text)
    const opened = probes.declare !== undefined && probes.declare.isError === false
      && declaredText.includes('- opened ' + TP_DEFINITION.id + ' (effective: next-step)')
    const faceOpen = face('afterDeclare')
    const presentAfter = TP_DEFINITION.members.every((name) => faceOpen.names.includes(name) === true)
    const runAfter = probes.declaredSearch !== undefined && probes.declaredExtra !== undefined
      && probes.declaredSearch.text === 'ran:tp_search' && probes.declaredExtra.text === 'ran:tp_extra'
    const dirOpen = rowOf(catalogAt('afterDeclare'), TP_DEFINITION.id)
    const dirOpenOk = dirOpen !== null && dirOpen.stateWord === 'OPEN'
    const ok = closedOk && identical && absentBefore && guardWorks && opened && presentAfter && runAfter && dirOpenOk
    add('c-the-contributed-group-is-hard-gated', probes.ghost === undefined ? 'not-measured' : ok ? 'ok' : 'fail',
      'before the declaration the face was ' + show(faceClosed.names) + ' and the executor answered '
      + show([probes.closedSearch, probes.closedExtra, probes.closedSpare].map((answer) => (answer === undefined ? '(not asked)' : answer.text)))
      + '; a never-registered name answered ' + show(probes.ghost === undefined ? null : probes.ghost.text)
      + '; after the declaration the face is ' + show(faceOpen.names) + ' and the members answered '
      + show([probes.declaredSearch, probes.declaredExtra].map((answer) => (answer === undefined ? '(not asked)' : answer.text))),
      ['byte-identity apart from the name: closed ' + show(probes.closedSearch === undefined ? null : strip(probes.closedSearch.text, 'tp_search'))
        + ' vs ghost ' + show(probes.ghost === undefined ? null : strip(probes.ghost.text, NEVER_REGISTERED)),
        'a tool no group names kept working throughout: ' + show(probes.guardClosedPhase === undefined ? null : probes.guardClosedPhase.text),
        'the whole declaration answer: ' + show(declaredText),
        'the directory row after the declaration: ' + show(dirOpen === null ? null : dirOpen.line)])
  }

  // (d) -- the disposer returns the face to exactly its prior bytes.
  {
    const disposal = world.disposal ?? {}
    const prior = disposal.prior ?? { names: [], json: '', bytes: -1 }
    const after = disposal.after ?? { names: [], json: '', bytes: -1 }
    const ok = typeof prior.json === 'string' && prior.json.length > 0 && prior.json === after.json
      && same(prior.names, after.names) && (disposal.rows ?? []).every((row) => row.id !== TP_SIDE_DEFINITION.id)
      && String(disposal.memberRuns === undefined ? '' : disposal.memberRuns.text) === 'ran:tp_spare'
    add('d-the-disposer-restores-the-face-bytes', world.disposal === undefined || String(prior.json).length === 0 ? 'not-measured' : ok ? 'ok' : 'fail',
      'the face before the group was registered was ' + String(prior.bytes) + ' B ' + show(prior.names) + ' and after its disposer it is '
      + String(after.bytes) + ' B ' + show(after.names) + ' (byte-identical: ' + show(prior.json === after.json) + '); the disposed member answered '
      + show(disposal.memberRuns === undefined ? null : disposal.memberRuns.text),
      ['the group disposed here is "' + TP_SIDE_DEFINITION.id + '" with members ' + show(TP_SIDE_DEFINITION.members) + '; it was still CLOSED when disposed, so the mask had to be lifted',
        'rows after the disposer: ' + show((disposal.rows ?? []).map((row) => row.id + ':' + row.origin)),
        'the directory forgot the row: ' + show(rowOf(directoryRows(disposal.catalog), TP_SIDE_DEFINITION.id) === null)])
  }

  // (e) -- a duplicate id is refused BY NAME and nothing is half-installed.
  {
    const duplicates = world.duplicates ?? {}
    const before = duplicates.before ?? { face: { json: '', names: [] }, rows: [] }
    const sameId = duplicates.sameId ?? { threw: false, message: null }
    const configId = duplicates.configId ?? { threw: false, message: null }
    const named = sameId.threw === true && String(sameId.message).includes('LINK_GROUPS_DUPLICATE_GROUP')
      && configId.threw === true && String(configId.message).includes('LINK_GROUPS_DUPLICATE_GROUP')
    const faceHeld = before.face.json.length > 0 && same(before.face.json, (duplicates.afterSameId ?? {}).face === undefined ? null : duplicates.afterSameId.face.json) === true
      && same(before.face.json, (duplicates.afterConfigId ?? {}).face === undefined ? null : duplicates.afterConfigId.face.json) === true
    const rowsHeld = same((before.rows ?? []).map((row) => row.id + ':' + row.origin), ((duplicates.afterConfigId ?? {}).rows ?? []).map((row) => row.id + ':' + row.origin))
    const membershipHeld = (duplicates.row ?? []).length === 1 && same((duplicates.row ?? [])[0].members, [...TP_DEFINITION.members])
    const guardLives = duplicates.guardRuns !== undefined && duplicates.guardRuns.text === 'ran:' + GUARD_TOOL
    const ok = named && faceHeld && rowsHeld && membershipHeld && guardLives
    add('e-a-duplicate-id-is-refused-and-nothing-lingers', duplicates.before === undefined ? 'not-measured' : ok ? 'ok' : 'fail',
      'a duplicate of the contributed id answered ' + show(sameId.message) + ' and a duplicate of the config id answered ' + show(configId.message)
      + '; the face stayed at ' + String(before.face.bytes) + ' B (' + show(faceHeld) + '), the directory stayed ' + show((before.rows ?? []).map((row) => row.id + ':' + row.origin))
      + ', the declared row still reads ' + show((duplicates.row ?? []).map((row) => row.members.join('+')))
      + ', and the tool only the refused definition named still answered ' + show(duplicates.guardRuns === undefined ? null : duplicates.guardRuns.text),
      ['the refused definitions were { id: "' + TP_DEFINITION.id + '", members: ["' + GUARD_TOOL + '"] } and { id: "' + CONFIG_GROUP.id + '", members: ["' + GUARD_TOOL + '"] }',
        'the face either side of both refusals: ' + String((duplicates.before ?? {}).face === undefined ? -1 : duplicates.before.face.bytes) + ' B -> '
        + String(((duplicates.afterConfigId ?? {}).face ?? {}).bytes) + ' B, name for name ' + show((duplicates.afterConfigId ?? {}).face === undefined ? null : duplicates.afterConfigId.face.names)])
  }

  // (f) -- two instances still collide with GROUPS_COLLISION, and the first one is untouched.
  {
    const collision = world.collision ?? {}
    const lines = Array.isArray(collision.lines) ? collision.lines : []
    const collisionLine = lines.filter((line) => line.includes('GROUPS_COLLISION'))[0] ?? null
    const takenLine = lines.filter((line) => line.includes('LINK_GROUPS_SERVICE_TAKEN'))[0] ?? null
    const faceHeld = collision.faceBefore !== undefined && collision.faceAfter !== undefined && collision.faceBefore.json === collision.faceAfter.json
    const rowsHeld = collision.rowsBefore !== undefined && same((collision.rowsBefore ?? []).map((row) => row.id + ':' + row.origin), (collision.rowsAfter ?? []).map((row) => row.id + ':' + row.origin))
    const serviceHeld = collision.service !== undefined && collision.service.present === true && same(collision.service.keys, ['groups', 'registerGroup'])
    const pairOnce = collision.faceAfter !== undefined && ACTIVATION.every((name) => collision.faceAfter.names.filter((seen) => seen === name).length === 1)
    const namesAgent = collisionLine !== null && collisionLine.includes(AGENT_ID)
    const ok = namesAgent && takenLine !== null && faceHeld && rowsHeld && serviceHeld && pairOnce
    add('f-two-instances-still-collide', collision.faceBefore === undefined ? 'not-measured' : ok ? 'ok' : 'fail',
      'the second apply() logged ' + show(collisionLine === null ? null : collisionLine.slice(0, 300)) + ' and ' + show(takenLine === null ? null : takenLine.slice(0, 220))
      + '; the face stayed at ' + String(collision.faceBefore === undefined ? -1 : collision.faceBefore.bytes) + ' B (identical: ' + show(faceHeld) + ')'
      + ', the first instance still answers ' + show(collision.service) + ', and the activation names appear '
      + show(ACTIVATION.map((name) => name + ' x' + String((collision.faceAfter === undefined ? [] : collision.faceAfter.names).filter((seen) => seen === name).length))),
      ['every log line the second apply() produced: ' + show(lines),
        'the second instance booted: ' + show(collision.bootLines),
        'the directory the FIRST instance still serves after the second apply: ' + show(directoryRows(collision.catalog).map((row) => row.id + ':' + row.stateWord))])
  }

  return out
}

// ---------------------------------------------------------------------------
// The contract page cross-check. docs/dev/tool-groups.md is P2's deliverable, not this gate's
// subject: the artifact wins every disagreement and this block only NAMES one. It never changes
// the exit code, and a missing page is a named third state, not a green.
// ---------------------------------------------------------------------------
const pageCrossCheck = (world) => {
  if (existsSync(PAGE_PATH) === false) return { present: false, lines: [], disagreements: 0 }
  const text = readFileSync(PAGE_PATH, 'utf8')
  const rows = Array.isArray(world.rows.afterContribution) ? world.rows.afterContribution : []
  const contributed = rows.filter((row) => row.origin === 'contributed')[0] ?? null
  const dirRow = rowOf(directoryRows(world.catalog.afterContribution), TP_DEFINITION.id)
  const checks = [
    {
      claim: 'the service is named linkGroups and answers registerGroup + groups()',
      where: 'section 2 table, section 3',
      pageHas: text.includes('linkGroups') && text.includes('registerGroup') && text.includes('groups()'),
      artifact: same((world.service.afterPage ?? {}).keys, ['groups', 'registerGroup']),
    },
    {
      claim: 'one groups() row is { id, title, origin, state, members, autoWhen }',
      where: 'section 3, the groups() row',
      pageHas: text.includes('autoWhen') && text.includes('origin') && text.includes('members'),
      artifact: contributed !== null && same(sorted(Object.keys(contributed)), ['autoWhen', 'id', 'members', 'origin', 'state', 'title']),
    },
    {
      claim: 'config rows come first, contributed rows after, each naming its origin',
      where: 'section 3, the groups() row',
      pageHas: text.includes('config') && text.includes('contributed'),
      artifact: rows.length > 1 && rows[0].origin === 'config' && rows.slice(1).every((row) => row.origin === 'contributed'),
    },
    {
      claim: 'a duplicate id is refused with LINK_GROUPS_DUPLICATE_GROUP',
      where: 'section 4 table',
      pageHas: text.includes('LINK_GROUPS_DUPLICATE_GROUP'),
      artifact: String((world.duplicates.sameId ?? {}).message ?? '').includes('LINK_GROUPS_DUPLICATE_GROUP'),
    },
    {
      claim: 'GROUPS_COLLISION means the activation tool name already resolves for that agent',
      where: 'section 2, the GROUPS_COLLISION paragraph',
      pageHas: text.includes('GROUPS_COLLISION') && text.includes('tool_groups'),
      artifact: (Array.isArray(world.collision.lines) ? world.collision.lines : []).some((line) => line.includes('GROUPS_COLLISION') && line.includes('already resolves for this agent')),
    },
    {
      claim: 'a contributed group is always state: auto, never user-disabled, never relockable',
      where: 'section 3, the normalized group',
      pageHas: text.includes("state: 'auto'") || text.includes('state: auto'),
      artifact: contributed !== null && contributed.state === 'auto' && dirRow !== null && dirRow.needsApproval === false && dirRow.relockable === false,
    },
  ]
  const lines = checks.map((check) => (check.pageHas === false ? 'page-omits-claim' : check.artifact === true ? 'agree' : 'DISAGREE') + '  ' + check.claim + '  [' + check.where + ']')
  return { present: true, lines, disagreements: lines.filter((line) => line.startsWith('DISAGREE')).length }
}


// ---------------------------------------------------------------------------
// The mutant set: each rewrites ONE string in the SHIPPED ARTIFACT'S OWN BYTES and declares
// exactly which readings must move. Anchored on the product, never on a fixture.
// ---------------------------------------------------------------------------
const R = {
  a: 'a-third-party-group-in-the-directory',
  b: 'b-the-config-row-is-not-rewritten',
  c: 'c-the-contributed-group-is-hard-gated',
  d: 'd-the-disposer-restores-the-face-bytes',
  e: 'e-a-duplicate-id-is-refused-and-nothing-lingers',
  f: 'f-two-instances-still-collide',
}
const MUTANTS = [
  {
    name: 'the-contributed-row-is-listed-before-the-config-row',
    from: 'const groups = () => [\n    ...resolved.groups.map((group) => definitionRow(group, "config")),\n    ...[...contributed.values()].map((group) => definitionRow(group, "contributed"))\n  ];',
    to: 'const groups = () => [\n    ...[...contributed.values()].map((group) => definitionRow(group, "contributed")),\n    ...resolved.groups.map((group) => definitionRow(group, "config"))\n  ];',
    expect: [R.a],
  },
  {
    name: 'the-seam-writes-into-the-callers-own-config-object',
    from: 'const resolved = resolveConfig(rawConfig);',
    to: 'const resolved = resolveConfig(rawConfig);\n  rawConfig.contributedBy = "dsh-link-groups";',
    expect: [R.b],
  },
  {
    name: 'a-contributed-group-arrives-open',
    from: 'state.open[group.id] = initialOpen(group);',
    to: 'state.open[group.id] = true;',
    expect: [R.c],
  },
  {
    name: 'the-disposer-does-nothing',
    from: 'let live = true;\n    return () => {\n      if (!live) return;',
    to: 'let live = true;\n    return () => {\n      if (live) return;',
    expect: [R.d],
  },
  {
    name: 'the-duplicate-refusal-loses-its-name',
    from: "throw new Error(SEAM_REFUSALS.DUPLICATE + ': group id \"'",
    to: "throw new Error('LINK_GROUPS_ALREADY_THERE' + ': group id \"'",
    expect: [R.e],
  },
  {
    name: 'the-per-agent-collision-loses-its-name',
    from: '" not installed [" + record.code + "] "',
    to: '" not installed [GROUPS_DUP] "',
    expect: [R.f],
  },
  { name: 'control-nothing-changed', from: null, to: null, expect: [] },
]

/**
 * The self-attack: re-measure the whole world against the artifact with ONE string replaced, and
 * require the set of readings that moved to be exactly the declared set.
 * @param started - the process start, for the elapsed line.
 * @returns the process exit code.
 */
const runSelfAttack = async (started) => {
  const baseline = await collect('baseline', null)
  const baseWorld = baseline.world
  if (baseWorld.fatal !== null) { await baseline.close(); return NOT_MEASURED('the baseline world could not be built: ' + baseWorld.fatal) }
  const base = judge(baseWorld)
  const baseRed = base.filter((reading) => reading.status !== 'ok')
  console.log('  baseline in this world: ' + String(base.length) + ' readings, ' + String(baseRed.length) + ' not ok')
  await baseline.close()
  if (baseRed.length > 0) {
    console.log('  FAIL  the attack needs a green baseline: ' + show(baseRed.map((reading) => reading.id + ':' + reading.status)))
    for (const reading of baseRed) console.log('        ' + reading.id + '. ' + reading.detail)
    return 1
  }
  console.log('  each mutant below rewrites ONE string in the shipped artifact own bytes and is measured by the same judge:')
  let failures = 0
  const moved = new Map()
  for (const [at, mutant] of MUTANTS.entries()) {
    const apply = mutant.from === null ? null : (source) => {
      if (source.includes(mutant.from) === false) throw new Error('the mutant cannot be applied: its source string is not in the shipped artifact')
      return source.replace(mutant.from, mutant.to)
    }
    const run = await collect('mutant-' + String(at), apply)
    let observed
    let note = ''
    if (run.world.fatal !== null) {
      note = ' (the mutant world could not be built: ' + run.world.fatal + ')'
      observed = base.map((reading) => reading.id).sort()
    } else {
      observed = judge(run.world).filter((reading) => reading.status !== 'ok').map((reading) => reading.id).sort()
    }
    await run.close()
    const declared = [...mutant.expect].sort()
    const precise = same(observed, declared)
    if (precise === false) failures += 1
    for (const id of declared) moved.set(id, (moved.get(id) ?? 0) + 1)
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ' — declared=' + show(declared) + ' observed=' + show(observed) + note)
  }
  console.log('  coverage matrix (every reading must be declared by at least one mutant):')
  let uncovered = 0
  for (const reading of base) {
    const count = moved.get(reading.id) ?? 0
    if (count === 0) uncovered += 1
    console.log('    ' + (count === 0 ? 'FAIL' : 'ok  ') + '  ' + String(count) + ' mutant(s)  ' + reading.id)
  }
  console.log('  ' + String(MUTANTS.length) + ' mutants, ' + String(failures) + ' imprecise, ' + String(uncovered) + ' reading(s) uncovered | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  return failures === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  const started = Date.now()
  if (SELF_ATTACK) return await runSelfAttack(started)
  const run = await collect('gate', null)
  const world = run.world
  if (world.fatal !== null) { await run.close(); return NOT_MEASURED('the world could not be built: ' + world.fatal) }
  console.log('        the subject: ' + MODULE_PATH + ' (' + String(world.artifact.bytes) + ' bytes, imports ' + show(world.artifact.imports) + ', name=' + show(world.plugin.name) + ', inject=' + show(world.plugin.inject) + ', default export=' + show(world.plugin.hasDefault) + ')')
  console.log('        the world: the real kernel (SystemPrompt, ToolRuntime, Session, AgentRegistry), the agent minted with createScope(' + AGENT_ID + '), the config row ' + show(CONFIG_BYTES) + '; no model is involved and no port is opened')
  console.log('        the producer test plugins/dsh-link-groups/test/seam-smoke.mjs was NOT imported and NOT run: this gate drives the shipped artifact itself')
  console.log('        boot lines the applies printed: ' + show(world.boot))
  const page = pageCrossCheck(world)
  if (page.present === false) console.log('        contract page: NOT PRESENT at ' + PAGE_PATH + ' (P2 is a separate deliverable; reported, not judged)')
  else for (const line of page.lines) console.log('        contract page: ' + line)
  const readings = judge(world)
  for (const reading of readings) {
    const mark = reading.status === 'ok' ? 'ok  ' : reading.status === 'fail' ? 'FAIL' : 'NOT MEASURED'
    console.log('  ' + mark + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.status === 'fail')
  const notMeasured = readings.filter((reading) => reading.status === 'not-measured')
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured | elapsed ' + String(Math.round((Date.now() - started) / 100) / 10) + 's')
  await run.close()
  if (failed.length > 0) return 1
  return notMeasured.length > 0 ? 3 : 0
}

process.exitCode = await main()
