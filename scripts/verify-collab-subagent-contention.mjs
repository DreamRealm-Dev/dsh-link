#!/usr/bin/env node
/**
 * R103 gate: the contention signal for subagent facts. Independent recomputation:
 *   - the artifact is DRIVEN through its public seam (installSubagentFacts / recordSubagentStart);
 *   - every reading is taken from the LEDGER FILE parsed here and from the announcements THIS gate captures
 *     (a logger it installs itself, and console.log while it holds it), never from the producer's internals;
 *   - the tree is folded here too, and the artifact's projectTeams must agree with it.
 * --self-attack mutates the built artifact inside a world whose root comes from R103_ROOT.
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
    try { readFileSync(join(dir, 'plugins', 'dsh-link-collab', 'lib', 'index.js')); return dir } catch { /* walk up */ }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('cannot locate the project root from ' + start)
}
const PROJECT = process.env.R103_PROJECT ?? findProject(HERE)
const ARTIFACT = process.env.R103_ARTIFACT ?? join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')

// --- this gate's own ledger reader and fold ------------------------------------------------

function readLedgerFile(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const rows = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    try { rows.push(JSON.parse(line)) } catch { /* a torn tail line is not a fact */ }
  }
  return rows
}
const stateRowsOf = (file) => readLedgerFile(file).filter((row) => row.kind === 'team/state')
const factsAbout = (file, subject) => stateRowsOf(file).filter((row) => row.subject === subject)

// Non-null beats null; equal specificity goes to the earlier (at, then seq); losers stay visible.
function foldMine(rows) {
  const parents = new Map()
  const losers = []
  for (const row of rows) {
    const current = parents.get(row.subject)
    if (current === undefined) { parents.set(row.subject, row); continue }
    if (current.parent === row.parent) continue
    const rowWins = (row.parent !== null && current.parent === null)
      || ((row.parent !== null) === (current.parent !== null) && (row.at < current.at || (row.at === current.at && row.seq < current.seq)))
    if (rowWins) { losers.push({ subject: row.subject, winner: row.parent, loser: current.parent }); parents.set(row.subject, row) }
    else losers.push({ subject: row.subject, winner: current.parent, loser: row.parent })
  }
  return { parents, losers }
}

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
const shownText = (value) => String(JSON.stringify(value))

// One world: a real ledger file, two installers (team B and a root claim) over one child id, and the two
// announcement channels this gate owns - a logger it passes in, and stdout while it holds console.log.
async function world(mod, options) {
  const dir = mkdtempSync(join(tmpdir(), 'r103-gate-'))
  const log = mod.openControlLog({ dir: join(dir, 'ledger'), writer: 'r103-gate-' + String(process.pid) })
  const first = scopeWith()
  const second = scopeWith()
  const logger = []
  const errors = []
  const onError = (error) => errors.push(error.message)
  const ctxOne = options.withLogger === true ? { on: first.on, logger: { warn: (message) => logger.push(String(message)) } } : { on: first.on }
  const ctxTwo = options.withLogger === true ? { on: second.on, logger: { warn: (message) => logger.push(String(message)) } } : { on: second.on }
  const stdout = []
  const realLog = console.log
  console.log = (...args) => { stdout.push(args.map((part) => String(part)).join(' ')) }
  try {
    mod.installSubagentFacts(ctxOne, log, { localTeamId: options.firstTeam, onError })
    mod.installSubagentFacts(ctxTwo, log, { localTeamId: options.secondTeam, onError })
    if (options.deliver === true) first.emit('subagent/start', startOf(options.child))
    await settle()
    const afterFirst = { logger: logger.length, stdout: stdout.length }
    if (options.deliver === true) second.emit('subagent/start', startOf(options.child))
    await settle()
    return {
      log, dir, first, second, logger, stdout, errors, afterFirst,
      file: join(dir, 'ledger', 'control.jsonl'),
      restore: () => { console.log = realLog }, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp world */ } },
    }
  } finally { console.log = realLog }
}

// --- readings ------------------------------------------------------------------------------

async function measure(mod) {
  const results = new Map()
  const order = []
  const record = (id, what, ok, evidence) => { results.set(id, { id, what, ok: ok === true, evidence: String(evidence) }); order.push(id) }
  const worlds = []
  try {
    const logged = await world(mod, { withLogger: true, deliver: true, firstTeam: 'B', secondTeam: null, child: 'C' })
    const bare = await world(mod, { withLogger: false, deliver: true, firstTeam: 'B', secondTeam: null, child: 'C' })
    worlds.push(logged, bare)

    record('R1', 'the first parent for a subject announces nothing (a normal arrival is not contention)',
      logged.afterFirst.logger === 0 && logged.afterFirst.stdout === 0,
      'afterFirstArrival logger=' + logged.afterFirst.logger + ' stdout=' + logged.afterFirst.stdout)

    const message = logged.logger[0] ?? ''
    record('R2', 'a second, different parent for the same subject announces exactly once, naming the known and the incoming parent',
      logged.logger.length === 1 && logged.stdout.length === 0 && message.includes('C') && message.includes(shownText('B')) && message.includes(shownText(null)),
      'announcements=' + logged.logger.length + ' viaLogger=' + logged.logger.length + ' viaStdout=' + logged.stdout.length + ' text=' + JSON.stringify(message.slice(0, 200)))

    const rows = factsAbout(logged.file, 'C')
    const parentsOnRecord = [...new Set(rows.map((row) => (row.payload.parent === undefined || row.payload.parent === null ? 'null' : String(row.payload.parent))))].sort()
    record('R3', 'both facts are in the ledger: contention never swallows a row',
      rows.length === 2 && JSON.stringify(parentsOnRecord) === JSON.stringify(['B', 'null']),
      'ledgerRows=' + rows.length + ' parents=' + JSON.stringify(parentsOnRecord))

    const mine = foldMine(rows.map((row) => ({ subject: row.subject, parent: row.payload.parent ?? null, at: row.at ?? 0, seq: row.seq })))
    const theirs = mod.projectTeams(rows)
    const theirTeam = [...theirs.teams].find((team) => team.id === 'C') ?? null
    const theirLosers = theirTeam !== null && Array.isArray(theirTeam.losers) ? theirTeam.losers.length : 0
    record('R4', 'the fold semantics are unchanged: the named parent holds and the loser stays visible',
      theirTeam !== null && theirTeam.parent === 'B' && mine.parents.get('C').parent === 'B'
      && mine.losers.length === 1 && mine.losers[0].loser === null && theirTeam.contested === true && theirLosers === 1,
      'artifactParent=' + JSON.stringify(theirTeam === null ? 'MISSING' : theirTeam.parent) + ' mineParent=' + JSON.stringify(mine.parents.get('C').parent)
      + ' mineLosers=' + JSON.stringify(mine.losers) + ' artifactContested=' + String(theirTeam === null ? 'MISSING' : theirTeam.contested) + ' artifactLosers=' + theirLosers)

    const bareMessage = bare.stdout[0] ?? ''
    record('R5', 'with no logger the warning still reaches stdout, and the logger channel stays empty (paired with R2)',
      bare.logger.length === 0 && bare.stdout.length === 1 && bareMessage.includes('[dsh-link-collab]')
      && bareMessage.includes('C') && bareMessage.includes(shownText('B')) && bareMessage.includes(shownText(null)),
      'bareLogger=' + bare.logger.length + ' bareStdout=' + bare.stdout.length + ' text=' + JSON.stringify(bareMessage.slice(0, 200)))

    const before = logged.logger.length + logged.stdout.length
    logged.first.emit('subagent/start', startOf('C'))
    await settle()
    const after = logged.logger.length + logged.stdout.length
    record('R6', 're-delivering the SAME fact announces nothing (an already-recorded fact is not contention either)',
      after === before, 'announcements before=' + before + ' after=' + after)

    const marker = await world(mod, { withLogger: true, deliver: false, firstTeam: 'B', secondTeam: null, child: 'D' })
    worlds.push(marker)
    const firstResult = await mod.recordSubagentStart(marker.log, startOf('D'), 'B')
    const secondResult = await mod.recordSubagentStart(marker.log, startOf('D'), null)
    record('R7', 'the record point itself returns the contention marker (false first, then the known and incoming parent)',
      firstResult.contested?.contested === false && secondResult.contested?.contested === true
      && secondResult.contested.knownParent === 'B' && secondResult.contested.incomingParent === null,
      'first=' + shownText(firstResult.contested) + ' second=' + shownText(secondResult.contested))
  } finally {
    for (const entry of worlds) { entry.restore(); entry.cleanup() }
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
    for (let j = 0; j < wanted.length; j += 1) if (lines[i + j].trim() !== wanted[j]) { ok = false; break }
    if (ok) hits.push(i)
  }
  if (hits.length !== 1) throw new Error('mutation site matched ' + hits.length + ' times, expected exactly 1')
  const indent = (lines[hits[0]].match(/^[ \t]*/) ?? [''])[0]
  return [...lines.slice(0, hits[0]), ...replace.map((line) => indent + line), ...lines.slice(hits[0] + wanted.length)].join('\n')
}

const START_BLOCK = [
  'async function recordSubagentStart(log, info, parentTeamId) {',
  'const record = subagentTeamRecord(info, parentTeamId);',
  'const contested = contestedParentOf(log, record.subject, parentTeamId);',
  'const wanted = factKey(record);',
  'for (const existing of log.replay()) {',
  'if (factKey(existing) === wanted) return { appended: false, reason: "already-recorded", record, contested };',
  '}',
  'await log.append(record);',
]

// Each declared set below is the flip set MEASURED against the current artifact, not a wish. The baseline went
// green when the idempotent re-delivery fix landed (contestedParentOf now returns not-contested when a row with the
// same parent already exists), and R6's membership moved with it: R6 asks "does an idempotent re-delivery announce
// anything?", so a mutant that stops announcing (M1) leaves it green and only a mutant that ADDS an announcement
// flips it (M2 warns on every arrival, M7 puts the old scanning bug back). Nothing is kept for company - every entry
// flips at least one reading, and M7 exists to guard exactly the fix this round is about.
const MUTANTS = [
  {
    id: 'M1',
    what: 'the contention warning is never emitted',
    // No announcement at all keeps R6 green, so this mutant now only takes out the two announcement readings.
    declared: ['R2', 'R5'],
    find: ['if (result.contested?.contested !== true) return;'],
    replace: ['if (true) return;'],
  },
  {
    id: 'M2',
    what: 'every arrival warns, so a normal first fact is reported as contention',
    // Warning on every arrival also makes the re-delivery announce, so R6 flips here: a false alarm is exactly what
    // R6 was written to catch, and after the fix this is the mutant that demonstrates it still can.
    declared: ['R1', 'R2', 'R5', 'R6'],
    find: ['if (result.contested?.contested !== true) return;'],
    replace: ['if (false) return;'],
  },
  {
    id: 'M3',
    what: 'the warning ignores a logger the composition provided and only writes to stdout',
    // The announcement still happens, just on the other channel, so the count R6 watches is unchanged.
    declared: ['R2'],
    find: ['const announce = (message) => {', 'if (typeof ctx.logger?.warn === "function") {', 'ctx.logger.warn(message);', 'return;', '}'],
    replace: ['const announce = (message) => {', 'if (false) {', 'ctx.logger.warn(message);', 'return;', '}'],
  },
  {
    id: 'M4',
    what: 'the stdout fallback drops the message, so a logger-less composition hears nothing',
    declared: ['R5'],
    find: ['console.log("[dsh-link-collab] " + message);'],
    replace: ['void message;'],
  },
  {
    id: 'M5',
    what: 'the record point stops computing the contention marker',
    // With no marker there is no announcement, so R6 stays green for the same reason it does under M1.
    declared: ['R2', 'R5', 'R7'],
    find: START_BLOCK,
    replace: ['async function recordSubagentStart(log, info, parentTeamId) {',
      'const record = subagentTeamRecord(info, parentTeamId);',
      'const contested = void 0;',
      'const wanted = factKey(record);',
      'for (const existing of log.replay()) {',
      'if (factKey(existing) === wanted) return { appended: false, reason: "already-recorded", record, contested };',
      '}',
      'await log.append(record);'],
  },
  {
    id: 'M6',
    what: 'a contested fact is dropped instead of appended, so contention swallows a row',
    // Dropping the row removes the second arrival too, so the re-delivery has nothing left to warn about.
    declared: ['R3', 'R4'],
    find: START_BLOCK,
    replace: ['async function recordSubagentStart(log, info, parentTeamId) {',
      'const record = subagentTeamRecord(info, parentTeamId);',
      'const contested = contestedParentOf(log, record.subject, parentTeamId);',
      'const wanted = factKey(record);',
      'for (const existing of log.replay()) {',
      'if (factKey(existing) === wanted) return { appended: false, reason: "already-recorded", record, contested };',
      '}',
      'if (contested?.contested !== true) await log.append(record);'],
  },
  {
    id: 'M7',
    what: 'the re-delivery fix is undone: a row with the same parent no longer stops the scan',
    // This is the regression guard for R104 itself. The fix is the early return below; removing it restores the old
    // behaviour, where re-delivering an already-recorded fact scans on to the other parent and announces a
    // contention that never happened (appended=false while the warning claims an arrival).
    declared: ['R6'],
    find: ['if (knownParent === incomingParent) return { contested: false, knownParent, incomingParent };'],
    replace: ['if (false) return { contested: false, knownParent, incomingParent };'],
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
const summary = { artifact: ARTIFACT, sha256: artifactSha, readings: baseline.order.length, failed, mutants: 0, declaredMismatches: [], escaped: [], uncovered: [] }
let exitCode = failed.length === 0 ? 0 : 1

if (SELF_ATTACK) {
  const root = process.env.R103_ROOT
  if (root === undefined || root === '') {
    console.error('self-attack: R103_ROOT is not set; the mutant world root is passed in, never derived from this file')
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
    for (const id of changed) { const bucket = flipped.get(id) ?? []; bucket.push(mutant.id); flipped.set(id, bucket) }
    const declared = [...mutant.declared].sort()
    const same = JSON.stringify(changed) === JSON.stringify(declared)
    console.log('  ' + (same ? 'ok  ' : 'FAIL') + '  ' + mutant.id + '  ' + mutant.what)
    console.log('        declared=' + JSON.stringify(declared) + ' measured=' + JSON.stringify(changed))
    if (changed.length === 0) summary.escaped.push(mutant.id)
    if (same === false) summary.declaredMismatches.push({ mutant: mutant.id, declared, measured: changed })
  }
  summary.mutants = MUTANTS.length
  summary.uncovered = baseline.order.filter((id) => flipped.has(id) === false)
  console.log('')
  console.log(String(MUTANTS.length) + ' mutants, ' + String(summary.declaredMismatches.length) + ' declared-set mismatches, ' + String(summary.escaped.length) + ' escaped, ' + String(summary.uncovered.length) + ' readings no mutant detects')
  console.log('  coverage: ' + baseline.order.map((id) => id + '=' + (flipped.get(id) ?? []).join('/')).join(' '))
  if (summary.declaredMismatches.length > 0 || summary.escaped.length > 0) exitCode = 1
}
console.log('  artifact sha256 ' + artifactSha)
if (JSON_OUT) console.log(JSON.stringify(summary, null, 1))
process.exit(exitCode)
