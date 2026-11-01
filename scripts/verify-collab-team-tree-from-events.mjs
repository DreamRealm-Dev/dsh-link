#!/usr/bin/env node
/**
 * R95 gate: official subagent lifecycle events -> our external ledger's team/state facts.
 *
 * Independence: the artifact is DRIVEN through its exported seam, never used as the oracle. Every reading
 * is taken from the ledger FILE (control.jsonl) parsed here, and the team tree is folded here too - the
 * producer's projectTeams is never imported. The fold below is the same one .tmp/r95-gate/tree-oracle.mjs
 * carries, inlined so this gate is one self-contained file.
 *
 * --self-attack mutates the built artifact (copied into a world whose root comes from R95_ROOT) and requires
 * the measured flip set of every mutant to equal the declared one; a mutant nobody detects is an escaped defect.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_ATTACK = process.argv.includes('--self-attack')
const JSON_OUT = process.argv.includes('--json')
const HERE = dirname(fileURLToPath(import.meta.url))

function findProject(start) {
  let dir = start
  for (let step = 0; step < 8; step += 1) {
    try {
      readFileSync(join(dir, 'plugins', 'dsh-link-collab', 'lib', 'index.js'))
      return dir
    } catch { /* keep walking up */ }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('cannot locate the project root (plugins/dsh-link-collab/lib/index.js) from ' + start)
}
const PROJECT = process.env.R95_PROJECT ?? findProject(HERE)
const ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')

// --- the independent ledger reader and fold ------------------------------------------------

function readLedgerFile(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return { records: [], damaged: 0 } }
  const records = []
  let damaged = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try {
      const row = JSON.parse(line)
      if (row !== null && typeof row === 'object' && Number.isFinite(row.seq)) records.push(row)
      else damaged += 1
    } catch { damaged += 1 }
  }
  return { records, damaged }
}

// A later seq wins; on an equal seq the later at wins; on an exact tie the folded record stays.
function laterThan(prev, next) {
  if (next.seq !== prev.seq) return next.seq > prev.seq
  const a = prev.at === null || prev.at === undefined ? -Infinity : prev.at
  const b = next.at === null || next.at === undefined ? -Infinity : next.at
  return b > a
}

function foldTeams(records) {
  const latest = new Map()
  for (const rec of records) {
    if (rec.kind !== 'team/state') continue
    const p = rec.payload === null || rec.payload === undefined ? {} : rec.payload
    const id = typeof p.team === 'string' && p.team !== '' ? p.team : typeof rec.subject === 'string' ? rec.subject : ''
    if (id === '') continue
    const entry = {
      id,
      parent: typeof p.parent === 'string' && p.parent !== '' ? p.parent : null,
      lead: typeof p.lead === 'string' && p.lead !== '' ? p.lead : null,
      seq: rec.seq,
      at: Number.isFinite(rec.at) ? rec.at : null,
    }
    const prev = latest.get(id)
    if (prev === undefined || laterThan(prev, entry)) latest.set(id, entry)
  }
  return latest
}

function projectTeams(records) {
  const teams = foldTeams(records)
  const roots = []
  const children = new Map()
  for (const id of [...teams.keys()].sort()) {
    const team = teams.get(id)
    if (team.parent === null) { roots.push(id); continue }
    const bucket = children.get(team.parent)
    if (bucket === undefined) children.set(team.parent, [id])
    else bucket.push(id)
  }
  return { teams, roots, children }
}

function ancestorsOf(projection, id) {
  const out = []
  const seen = new Set([id])
  let cursor = projection.teams.get(id)
  while (cursor !== undefined && cursor.parent !== null) {
    if (seen.has(cursor.parent)) { out.push('cycle:' + cursor.parent); return out }
    seen.add(cursor.parent)
    out.push(cursor.parent)
    cursor = projection.teams.get(cursor.parent)
  }
  return out
}

function pathOf(projection, id) { return [...ancestorsOf(projection, id)].reverse().concat([id]) }

function descendantsOf(projection, id) {
  const out = []
  const queue = [...(projection.children.get(id) === undefined ? [] : projection.children.get(id))]
  const seen = new Set([id])
  while (queue.length > 0) {
    const next = queue.shift()
    if (seen.has(next)) continue
    seen.add(next)
    out.push(next)
    const kids = projection.children.get(next)
    if (kids !== undefined) queue.push(...kids)
  }
  return out
}

function foldKey(projection) {
  const rows = [...projection.teams.values()].map((t) => [t.id, t.parent, t.lead, t.seq].join('|')).sort()
  return JSON.stringify({ roots: [...projection.roots].sort(), rows })
}

function teamsOf(file) { return foldTeams(readLedgerFile(file).records) }
function teamRows(file) { return readLedgerFile(file).records.filter((row) => row.kind === 'team/state') }
const parentIn = (teams, id) => (teams.has(id) ? teams.get(id).parent : 'MISSING')

// --- the event surface the installer subscribes to -----------------------------------------

function scopeWith() {
  const listeners = new Map()
  return {
    on: (name, listener) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => { listeners.set(name, (listeners.get(name) ?? []).filter((row) => row !== listener)) }
    },
    emit: (name, info) => { for (const listener of [...(listeners.get(name) ?? [])]) listener(info) },
  }
}

const startOf = (id) => ({ runId: 'run-' + id, provider: 'spawn-in-process', id, local: true })
const settle = (ms = 140) => new Promise((done) => setTimeout(done, ms))

async function buildWorld(mod, options) {
  const dir = mkdtempSync(join(tmpdir(), 'r95-gate-'))
  const ledgerDir = join(dir, 'ledger')
  const log = mod.openControlLog({ dir: ledgerDir, writer: 'gate-' + String(process.pid) })
  const rootScope = scopeWith()
  const childScope = scopeWith()
  const reported = []
  const onError = (error) => reported.push(error.message)
  const disposeRoot = mod.installSubagentFacts(rootScope, log, { localTeamId: null, onError })
  const disposeChild = mod.installSubagentFacts(childScope, log, { localTeamId: 'B', onError })
  if (options.deliver === true) {
    rootScope.emit('subagent/start', startOf('B'))
    childScope.emit('subagent/start', startOf('C'))
  }
  await settle()
  return {
    dir, log, rootScope, childScope, reported, disposeRoot, disposeChild,
    file: join(ledgerDir, 'control.jsonl'),
    cleanup: () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp world */ } },
  }
}

// --- the readings -------------------------------------------------------------------------

async function measure(mod) {
  const results = new Map()
  const order = []
  const record = (id, what, ok, evidence) => {
    results.set(id, { id, what, ok: ok === true, evidence: String(evidence) })
    order.push(id)
  }
  const worlds = []
  try {
    const nested = await buildWorld(mod, { deliver: true })
    const control = await buildWorld(mod, { deliver: false })
    const ends = await buildWorld(mod, { deliver: false })
    const chainedRootFirst = await buildWorld(mod, { deliver: false })
    const chainedChildFirst = await buildWorld(mod, { deliver: false })
    worlds.push(nested, control, ends, chainedRootFirst, chainedChildFirst)

    const rowsNested = teamRows(nested.file)
    const teamsNested = teamsOf(nested.file)
    record('R1', 'two official starts leave exactly two team/state facts in the ledger FILE',
      rowsNested.length === 2,
      'rows=' + rowsNested.length + ' subjects=' + JSON.stringify(rowsNested.map((row) => row.subject)))
    record('R2', 'the fold puts B at the root and C under B (two-layer nesting)',
      teamsNested.has('B') === true && parentIn(teamsNested, 'B') === null && parentIn(teamsNested, 'C') === 'B'
      && JSON.stringify(pathOf(projectTeams(readLedgerFile(nested.file).records), 'C')) === JSON.stringify(['B', 'C']),
      'parent(B)=' + JSON.stringify(parentIn(teamsNested, 'B')) + ' parent(C)=' + JSON.stringify(parentIn(teamsNested, 'C'))
      + ' path(C)=' + JSON.stringify(pathOf(projectTeams(readLedgerFile(nested.file).records), 'C'))
      + ' roots=' + JSON.stringify(projectTeams(readLedgerFile(nested.file).records).roots))

    const catalog = { version: 0, childId: 'D', childCreatedAt: 1700000000000, mode: 'one-shot' }
    const rowsBeforeCatalogStep = teamRows(nested.file).length
    const firstCatalog = await mod.recordSubagentCatalog(nested.log, catalog, 'C')
    await settle(90)
    const rowsThird = teamRows(nested.file)
    const teamsThird = teamsOf(nested.file)
    record('R3', 'the durable subagent/catalog path adds the third layer C -> D',
      firstCatalog.appended === true && rowsThird.length === rowsBeforeCatalogStep + 1 && parentIn(teamsThird, 'D') === 'C'
      && JSON.stringify(pathOf(projectTeams(readLedgerFile(nested.file).records), 'D')) === JSON.stringify(['B', 'C', 'D']),
      'appended=' + firstCatalog.appended + ' rows=' + rowsBeforeCatalogStep + '->' + rowsThird.length + ' parent(D)=' + JSON.stringify(parentIn(teamsThird, 'D'))
      + ' descendants(B)=' + JSON.stringify(descendantsOf(projectTeams(readLedgerFile(nested.file).records), 'B')))

    const teamsBeforeCatalog = teamsOf(nested.file)
    const rowsBeforeCatalog = teamRows(nested.file).length
    const foldBeforeCatalog = foldKey(projectTeams(readLedgerFile(nested.file).records))
    const secondCatalog = await mod.recordSubagentCatalog(nested.log, catalog, 'C')
    await settle(90)
    const rowsAfterCatalog = teamRows(nested.file).length
    const foldAfterCatalog = foldKey(projectTeams(readLedgerFile(nested.file).records))
    record('R4', 're-delivering the same catalog event writes nothing and folds byte-identically (paired: the third-layer fact is held first)',
      teamsBeforeCatalog.has('D') === true && parentIn(teamsBeforeCatalog, 'D') === 'C'
      && secondCatalog.appended === false && secondCatalog.reason === 'already-recorded'
      && rowsAfterCatalog === rowsBeforeCatalog && foldAfterCatalog === foldBeforeCatalog,
      'heldFirst=' + String(teamsBeforeCatalog.has('D')) + '/' + JSON.stringify(parentIn(teamsBeforeCatalog, 'D'))
      + ' rows=' + rowsBeforeCatalog + '->' + rowsAfterCatalog + ' appended=' + secondCatalog.appended + ' reason=' + secondCatalog.reason
      + ' after=' + rowsAfterCatalog + ' foldIdentical=' + String(foldAfterCatalog === foldBeforeCatalog))

    const teamsBeforeReplay = teamsOf(nested.file)
    const rowsBeforeReplay = teamRows(nested.file).length
    const foldBeforeReplay = foldKey(projectTeams(readLedgerFile(nested.file).records))
    nested.rootScope.emit('subagent/start', startOf('B'))
    nested.childScope.emit('subagent/start', startOf('C'))
    await settle()
    const rowsAfterReplay = teamRows(nested.file).length
    const foldAfterReplay = foldKey(projectTeams(readLedgerFile(nested.file).records))
    record('R5', 're-delivering the same two starts writes nothing and folds byte-identically (paired: B and C hold their facts first)',
      teamsBeforeReplay.has('B') === true && teamsBeforeReplay.has('C') === true
      && rowsAfterReplay === rowsBeforeReplay && foldAfterReplay === foldBeforeReplay,
      'heldFirst=B:' + String(teamsBeforeReplay.has('B')) + ' C:' + String(teamsBeforeReplay.has('C'))
      + ' rows=' + rowsBeforeReplay + '->' + rowsAfterReplay + ' foldIdentical=' + String(foldAfterReplay === foldBeforeReplay))

    const rowsControl = teamRows(control.file)
    const teamsControl = teamsOf(control.file)
    record('R6', 'the SAME construction minus the delivery alone writes nothing (no hollow green: the pair differs by one variable)',
      rowsControl.length === 0 && teamsControl.size === 0 && rowsNested.length === 2,
      'main=' + rowsNested.length + ' rows, control=' + rowsControl.length + ' rows, controlTeams=' + teamsControl.size
      + ', sameBuilder=true, onlyVariable=deliver')

    control.rootScope.emit('subagent/start', startOf('E'))
    await settle()
    const rowsAfterE = teamRows(control.file).length
    control.disposeRoot()
    control.disposeChild()
    control.childScope.emit('subagent/start', startOf('F'))
    await settle()
    const rowsAfterF = teamRows(control.file).length
    record('R7', 'a live listener writes E; after dispose the same construction writes nothing more',
      rowsAfterE === 1 && rowsAfterF === 1 && teamsOf(control.file).has('F') === false,
      'afterEmit=' + rowsAfterE + ' afterDisposeEmit=' + rowsAfterF + ' hasF=' + String(teamsOf(control.file).has('F')))

    ends.rootScope.emit('subagent/end', { runId: 'run-Z', provider: 'spawn-in-process', id: 'Z', local: true, stopReason: 'completed' })
    await settle()
    const rowsAfterEnd = teamRows(ends.file).length
    const reportedAfterEnd = ends.reported.length
    ends.rootScope.emit('subagent/start', startOf('Y'))
    await settle()
    const rowsAfterY = teamRows(ends.file).length
    record('R10', 'an end with no start is NOT a failure (no fact, no error) while a start in the same world still records',
      rowsAfterEnd === 0 && reportedAfterEnd === 0 && rowsAfterY === 1,
      'afterEndRows=' + rowsAfterEnd + ' afterEndReported=' + reportedAfterEnd + ' afterStartRows=' + rowsAfterY)

    const rowsBeforeBad = teamRows(ends.file).length
    let threwPayload = null
    try { mod.subagentTeamRecord({ runId: 'run-bad', provider: 'p', local: false }, null) } catch (error) { threwPayload = error }
    ends.rootScope.emit('subagent/start', { runId: 'run-bad', provider: 'p', local: false })
    await settle()
    const rowsAfterBad = teamRows(ends.file).length
    record('R8', 'a start with no child session id is refused loudly and writes nothing',
      threwPayload instanceof TypeError && ends.reported.length === 1 && rowsAfterBad === rowsBeforeBad,
      'threw=' + String(threwPayload === null ? 'none' : threwPayload.constructor.name) + ' reported=' + ends.reported.length
      + ' rows=' + rowsBeforeBad + '->' + rowsAfterBad)

    const rowsBeforeName = teamRows(ends.file).length
    let threwName = null
    try { mod.subagentCatalogEventRecord({ name: 'session/event', data: { childId: 'D' } }, 'C') } catch (error) { threwName = error }
    let threwEmpty = null
    try { mod.subagentCatalogEventRecord({ name: 'subagent/catalog', data: {} }, 'C') } catch (error) { threwEmpty = error }
    await settle(90)
    const rowsAfterName = teamRows(ends.file).length
    record('R9', 'an event of another name and a catalog payload with no childId are both refused, writing nothing',
      threwName instanceof TypeError && threwEmpty instanceof TypeError && rowsAfterName === rowsBeforeName,
      'wrongName=' + String(threwName === null ? 'none' : threwName.constructor.name) + ' emptyPayload='
      + String(threwEmpty === null ? 'none' : threwEmpty.constructor.name) + ' rows=' + rowsBeforeName + '->' + rowsAfterName)

    let threwSurface = null
    try { mod.installSubagentFacts({}, ends.log, { localTeamId: null }) } catch (error) { threwSurface = error }
    record('R11', 'a context with no event surface is refused instead of installing a subscription that observes nothing',
      threwSurface instanceof TypeError,
      'threw=' + String(threwSurface === null ? 'none' : threwSurface.constructor.name + ': ' + threwSurface.message.slice(0, 70)))

    const chainOf = (world, order) => {
      for (const who of order) {
        if (who === 'root') world.rootScope.emit('subagent/start', startOf('C'))
        else world.childScope.emit('subagent/start', startOf('C'))
      }
    }
    chainOf(chainedRootFirst, ['root', 'child'])
    chainOf(chainedChildFirst, ['child', 'root'])
    await settle()
    const factsAbout = (world) => readLedgerFile(world.file).records.filter((row) => row.kind === 'team/state' && row.subject === 'C')
    const parentsOf = (world) => [...new Set(factsAbout(world).map((row) => (row.payload.parent === undefined || row.payload.parent === null ? 'null' : String(row.payload.parent))))].sort()
    const foldedAt = (world) => parentIn(teamsOf(world.file), 'C')
    record('R12', 'the same start seen by two scopes writes two disagreeing facts and the winner follows the DELIVERY order, in both directions (documented, not a pass)',
      factsAbout(chainedRootFirst).length === 2 && JSON.stringify(parentsOf(chainedRootFirst)) === JSON.stringify(['B', 'null'])
      && foldedAt(chainedRootFirst) === 'B'
      && factsAbout(chainedChildFirst).length === 2 && JSON.stringify(parentsOf(chainedChildFirst)) === JSON.stringify(['B', 'null'])
      && foldedAt(chainedChildFirst) === null,
      'root-first: facts=' + factsAbout(chainedRootFirst).length + ' parents=' + JSON.stringify(parentsOf(chainedRootFirst)) + ' folded=' + JSON.stringify(foldedAt(chainedRootFirst))
      + ' | child-first: facts=' + factsAbout(chainedChildFirst).length + ' parents=' + JSON.stringify(parentsOf(chainedChildFirst)) + ' folded=' + JSON.stringify(foldedAt(chainedChildFirst)))
  } finally {
    for (const world of worlds) world.cleanup()
  }
  return { results, order }
}

// --- self-attack ---------------------------------------------------------------------------

function patch(text, find, replace) {
  const lines = text.split('\n')
  const wanted = find.map((line) => line.trim())
  const hits = []
  for (let i = 0; i + wanted.length <= lines.length; i += 1) {
    let ok = true
    for (let j = 0; j < wanted.length; j += 1) {
      if (lines[i + j].trim() !== wanted[j]) { ok = false; break }
    }
    if (ok) hits.push(i)
  }
  if (hits.length !== 1) throw new Error('mutation site matched ' + hits.length + ' times, expected exactly 1')
  const indent = (lines[hits[0]].match(/^[ \t]*/) ?? [''])[0]
  return [...lines.slice(0, hits[0]), ...replace.map((line) => indent + line), ...lines.slice(hits[0] + wanted.length)].join('\n')
}

const MUTANTS = [
  {
    id: 'M1',
    what: 'recordSubagentStart appends even when the same fact is already recorded',
    declared: ['R5'],
    find: ['async function recordSubagentStart(log, info, parentTeamId) {', 'const record = subagentTeamRecord(info, parentTeamId);',
      'const wanted = factKey(record);', 'for (const existing of log.replay()) {',
      'if (factKey(existing) === wanted) return { appended: false, reason: \x22already-recorded\x22, record };'],
    replace: ['async function recordSubagentStart(log, info, parentTeamId) {', 'const record = subagentTeamRecord(info, parentTeamId);',
      'const wanted = factKey(record);', 'for (const existing of log.replay()) {',
      'if (false) return { appended: false, reason: \x22already-recorded\x22, record };'],
  },
  {
    id: 'M2',
    what: 'recordSubagentCatalog appends even when the same fact is already recorded',
    declared: ['R4'],
    find: ['async function recordSubagentCatalog(log, info, parentTeamId) {', 'const record = subagentCatalogRecord(info, parentTeamId);',
      'const wanted = factKey(record);', 'for (const existing of log.replay()) {',
      'if (factKey(existing) === wanted) return { appended: false, reason: \x22already-recorded\x22, record };'],
    replace: ['async function recordSubagentCatalog(log, info, parentTeamId) {', 'const record = subagentCatalogRecord(info, parentTeamId);',
      'const wanted = factKey(record);', 'for (const existing of log.replay()) {',
      'if (false) return { appended: false, reason: \x22already-recorded\x22, record };'],
  },
  {
    id: 'M3',
    what: 'a payload with no child id is recorded as a nameless team instead of throwing',
    declared: ['R8'],
    find: ['if (typeof id !== \x22string\x22 || id === \x22\x22) {',
      'throw new TypeError(\x22subagent fact: the event carries no child session id; refusing to record a nameless team instead of skipping it\x22);', '}'],
    replace: ['if (typeof id !== \x22string\x22 || id === \x22\x22) {', 'return \x22unnamed\x22;', '}'],
  },
  {
    id: 'M4',
    what: 'the catalog mapper stops checking the event name',
    declared: ['R9'],
    find: ['if (event?.name !== \x22subagent/catalog\x22) {'],
    replace: ['if (false) {'],
  },
  {
    id: 'M5',
    what: 'the listener forgets the observing scope and files every child at the root',
    declared: ['R2', 'R3', 'R12'],
    find: ['void recordSubagentStart(log, info, options.localTeamId).catch((error) => {'],
    replace: ['void recordSubagentStart(log, info, null).catch((error) => {'],
  },
  {
    id: 'M6',
    what: 'the installer subscribes to subagent/end instead of subagent/start',
    declared: ['R1', 'R2', 'R3', 'R5', 'R6', 'R7', 'R8', 'R10', 'R12'],
    find: ['const dispose = ctx.on(\x22subagent/start\x22, listener);'],
    replace: ['const dispose = ctx.on(\x22subagent/end\x22, listener);'],
  },
  {
    id: 'M7',
    what: 'installing the facts records the observing scope own team before any event arrives',
    declared: ['R1', 'R6', 'R7', 'R10'],
    find: ['function installSubagentFacts(ctx, log, options) {', 'if (typeof ctx?.on !== \x22function\x22) {',
      'throw new TypeError(\x22installSubagentFacts: the context exposes no event surface; refusing to install a subscription that would observe nothing\x22);', '}'],
    replace: ['function installSubagentFacts(ctx, log, options) {', 'if (typeof ctx?.on !== \x22function\x22) {',
      'throw new TypeError(\x22installSubagentFacts: the context exposes no event surface; refusing to install a subscription that would observe nothing\x22);', '}',
      'if (options.localTeamId !== null) void recordSubagentStart(log, { id: options.localTeamId }, null);'],
  },
  {
    id: 'M8',
    what: 'a context with no event surface returns a quiet disposer instead of refusing',
    declared: ['R11'],
    find: ['function installSubagentFacts(ctx, log, options) {', 'if (typeof ctx?.on !== \x22function\x22) {',
      'throw new TypeError(\x22installSubagentFacts: the context exposes no event surface; refusing to install a subscription that would observe nothing\x22);', '}'],
    replace: ['function installSubagentFacts(ctx, log, options) {', 'if (typeof ctx?.on !== \x22function\x22) {', 'return () => {};', '}'],
  },
]

const artifactText = readFileSync(ARTIFACT, 'utf8')
const artifactSha = createHash('sha256').update(artifactText).digest('hex')
const realModule = await import(pathToFileURL(ARTIFACT).href)
const baseline = await measure(realModule)

for (const id of baseline.order) {
  const row = baseline.results.get(id)
  console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + id + '  ' + row.what)
  console.log('        ' + row.evidence)
}
const failed = baseline.order.filter((id) => baseline.results.get(id).ok === false)
console.log('')
console.log(String(baseline.order.length) + ' readings, ' + String(baseline.order.length - failed.length) + ' held, ' + String(failed.length) + ' failed')

let summary = {
  artifact: ARTIFACT,
  sha256: artifactSha,
  readings: baseline.order.length,
  held: baseline.order.length - failed.length,
  failed,
  mutants: 0,
  declaredMismatches: [],
  escaped: [],
  uncovered: [],
}
let exitCode = failed.length === 0 ? 0 : 1

if (SELF_ATTACK && exitCode === 0) {
  const root = process.env.R95_ROOT
  if (root === undefined || root === '') {
    console.error('self-attack: R95_ROOT is not set; the mutant world root is passed in, never derived from this file')
    process.exit(2)
  }
  mkdirSync(root, { recursive: true })
  const flipped = new Map()
  for (const mutant of MUTANTS) {
    const dir = join(root, 'mut-' + mutant.id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'index.js')
    writeFileSync(file, patch(artifactText, mutant.find, mutant.replace), 'utf8')
    const mod = await import(pathToFileURL(file).href + '?v=' + mutant.id + '-' + String(Date.now()))
    const run = await measure(mod)
    const changed = []
    for (const id of baseline.order) {
      const before = baseline.results.get(id).ok
      const after = run.results.has(id) ? run.results.get(id).ok : false
      if (before !== after) changed.push(id)
    }
    changed.sort()
    for (const id of changed) {
      const bucket = flipped.get(id) ?? []
      bucket.push(mutant.id)
      flipped.set(id, bucket)
    }
    const declared = [...mutant.declared].sort()
    const same = JSON.stringify(changed) === JSON.stringify(declared)
    console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + mutant.id + '  ' + mutant.what)
    console.log('        declared=' + JSON.stringify(declared) + ' measured=' + JSON.stringify(changed))
    if (changed.length === 0) summary.escaped.push(mutant.id)
    if (same === false) summary.declaredMismatches.push({ mutant: mutant.id, declared, measured: changed })
  }
  summary.uncovered = baseline.order.filter((id) => flipped.has(id) === false)
  summary.mutants = MUTANTS.length
  console.log('')
  console.log(String(MUTANTS.length) + ' mutants, ' + String(summary.declaredMismatches.length) + ' declared-set mismatches, '
    + String(summary.escaped.length) + ' escaped, ' + String(summary.uncovered.length) + ' readings no mutant detects'
    + (summary.uncovered.length === 0 ? '' : ' (' + summary.uncovered.join(', ') + ')'))
  console.log('  coverage: ' + baseline.order.map((id) => id + '=' + (flipped.get(id) ?? []).join('/')).join(' '))
  if (summary.declaredMismatches.length > 0 || summary.escaped.length > 0) exitCode = 1
}

console.log('  artifact sha256 ' + artifactSha)
if (JSON_OUT) console.log(JSON.stringify(summary, null, 1))
process.exit(exitCode)
