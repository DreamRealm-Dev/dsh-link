#!/usr/bin/env node
/**
 * R99 gate: team parent arbitration. Two legs, kept apart on purpose.
 *
 *   Leg A - the RULE, driven through the artifact's public export arbitrateTeamParents: non-null beats
 *           null, equal specificity is won by the earlier (at, then seq) record, and the loser is returned.
 *   Leg B - the WIRING, driven through the artifact's public export projectTeams over a real ledger FILE
 *           parsed here: the fold must adopt that arbitration, so the winner no longer depends on arrival
 *           order and the losing fact stays visible.
 *   Leg C - control and no-regression: the same world with one parent instead of two has no contention, and
 *           the single-parent fold is byte-identical to the frozen golden captured before the wiring landed.
 *
 * The expectation is this file's own fold (see foldRows / canonical), never the producer's private helpers.
 * --self-attack mutates the built artifact in a world whose root comes from R99_ROOT.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_ATTACK = process.argv.includes('--self-attack')
const JSON_OUT = process.argv.includes('--json')
const HERE = dirname(fileURLToPath(import.meta.url))

// Frozen before the wiring landed: a single-parent world's canonical fold. This is what ⑤ means.
const GOLDEN_SINGLE_PARENT = '{\x22teams\x22:[\x22P||\x22,\x22T|P|\x22],\x22roots\x22:[\x22P\x22],\x22children\x22:[\x22P:T\x22],\x22orphans\x22:[],\x22cycles\x22:0}'

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
const PROJECT = process.env.R99_PROJECT ?? findProject(HERE)
const ARTIFACT = process.env.R99_ARTIFACT ?? join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')

// --- this gate's own arbitration and fold (the expectation, never imported from the producer) ----------

function arbitrate(rows) {
  const winner = new Map()
  const losers = []
  for (const row of rows) {
    const current = winner.get(row.subject)
    if (current === undefined) { winner.set(row.subject, row); continue }
    if (current.parent === row.parent) continue
    const rowWins = (row.parent !== null && current.parent === null)
      || ((row.parent !== null) === (current.parent !== null) && (row.at < current.at || (row.at === current.at && row.seq < current.seq)))
    if (rowWins) {
      losers.push({ subject: row.subject, winner: row.parent, loser: current.parent, at: row.at, seq: row.seq })
      winner.set(row.subject, row)
    } else {
      losers.push({ subject: row.subject, winner: current.parent, loser: row.parent, at: row.seq, seq: row.seq })
    }
  }
  return { winner, losers }
}

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

function stateRowsOf(file) { return readLedgerFile(file).filter((row) => row.kind === 'team/state') }
function rowsFor(lines) { return lines.map((row) => ({ subject: row.subject, parent: row.parent, at: row.at, seq: row.seq })) }

// The canonical view of a fold: identity, shape, and nothing the wiring is allowed to add.
function canonical(projection) {
  const teams = [...projection.teams].map((team) => [team.id, team.parent, team.lead].join('|')).sort()
  const children = Object.keys(projection.children ?? {}).sort().map((key) => key + ':' + [...projection.children[key]].sort().join(','))
  return JSON.stringify({
    teams,
    roots: [...projection.roots].sort(),
    children,
    orphans: [...(projection.orphans ?? [])].sort(),
    cycles: (projection.cycles ?? []).length,
  })
}

// This gate's own fold of the ledger rows, used only to check the single-parent world against the artifact.
function foldRows(rows) {
  const { winner } = arbitrate(rows)
  const teams = [...winner.keys()].sort().map((id) => ({ id, parent: winner.get(id).parent, lead: winner.get(id).lead ?? null }))
  const children = {}
  for (const team of teams) {
    if (team.parent === null) continue
    children[team.parent] = [...(children[team.parent] ?? []), team.id]
  }
  for (const key of Object.keys(children)) children[key].sort()
  return canonical({
    teams,
    roots: teams.filter((team) => team.parent === null).map((team) => team.id),
    children,
    orphans: teams.filter((team) => team.parent !== null && winner.has(team.parent) === false).map((team) => team.id),
    cycles: [],
  })
}

// Every place the artifact may keep a losing fact, read through one accessor.
function losersIn(projection) {
  const out = []
  for (const entry of projection.contested ?? []) out.push({ subject: entry.subject, winner: entry.winner, loser: entry.loser })
  for (const team of projection.teams ?? []) {
    if (team.contested === true) {
      const bucket = Array.isArray(team.losers) ? team.losers : []
      if (bucket.length === 0) out.push({ subject: team.id, winner: team.parent, loser: 'unspecified' })
      for (const loser of bucket) out.push({ subject: team.id, winner: team.parent, loser: loser !== null && typeof loser === 'object' && 'parent' in loser ? loser.parent : loser })
    }
  }
  return out
}

const parentOf = (projection, id) => {
  for (const team of projection.teams ?? []) if (team.id === id) return team.parent
  return 'MISSING'
}

// --- worlds ---------------------------------------------------------------------------------

async function ledgerWorld(mod, lines) {
  const dir = mkdtempSync(join(tmpdir(), 'r99-gate-'))
  const log = mod.openControlLog({ dir: join(dir, 'ledger'), writer: 'r99-gate' })
  for (const line of lines) await log.append({ ...mod.teamRecord(line.subject, line.parent), at: line.at })
  await log.close()
  return { file: join(dir, 'ledger', 'control.jsonl'), cleanup: () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* temp world */ } } }
}

// The same world twice, differing only in the order the two parent facts arrive.
const CONFLICT_SPECIFIC = [
  { subject: 'T', parent: 'P', at: 100 },   // named parent, earlier
  { subject: 'T', parent: null, at: 200 },  // root claim, later
]
const CONFLICT_EQUAL = [
  { subject: 'T', parent: 'A', at: 100 },   // equal specificity: A is earlier
  { subject: 'T', parent: 'B', at: 200 },
]
const SINGLE_PARENT = [
  { subject: 'P', parent: null, at: 50 },
  { subject: 'T', parent: 'P', at: 100 },
]

// --- readings -------------------------------------------------------------------------------

async function measure(mod) {
  const results = new Map()
  const order = []
  const record = (id, what, ok, evidence) => {
    results.set(id, { id, what, ok: ok === true, evidence: String(evidence) })
    order.push(id)
  }
  const worlds = []
  try {
    // Leg A: the rule, at the function the artifact exports.
    const forward = mod.arbitrateTeamParents(rowsFor(CONFLICT_SPECIFIC))
    const reverse = mod.arbitrateTeamParents(rowsFor([...CONFLICT_SPECIFIC].reverse().map((row, index) => ({ ...row, seq: index + 1 }))))
    record('A1', 'a named parent beats a root claim in BOTH delivery orders (more specific wins)',
      forward.parents.get('T') === 'P' && reverse.parents.get('T') === 'P',
      'named-first=' + JSON.stringify(forward.parents.get('T')) + ' root-first=' + JSON.stringify(reverse.parents.get('T')))

    const equalForward = mod.arbitrateTeamParents(rowsFor(CONFLICT_EQUAL))
    const equalReverse = mod.arbitrateTeamParents(rowsFor([...CONFLICT_EQUAL].reverse().map((row, index) => ({ ...row, seq: index + 1 }))))
    record('A2', 'equal specificity is won by the earlier record (by at) in BOTH delivery orders',
      equalForward.parents.get('T') === 'A' && equalReverse.parents.get('T') === 'A',
      'A-first=' + JSON.stringify(equalForward.parents.get('T')) + ' B-first=' + JSON.stringify(equalReverse.parents.get('T'))
      + ' expectedA=' + JSON.stringify(arbitrate(rowsFor(CONFLICT_EQUAL)).winner.get('T').parent))

    const shown = (value) => value === null ? 'null' : value === undefined ? 'undefined' : String(value)
    const lost = (result) => (result.contested ?? []).map((entry) => [entry.subject, shown(entry.winner), shown(entry.loser)].join('/'))
    record('A3', 'the losing fact is returned, not dropped (winner and loser both named)',
      lost(forward).includes('T/P/null') && lost(equalForward).includes('T/A/B')
      && forward.contested.length === 1 && equalForward.contested.length === 1,
      'specific=' + JSON.stringify(lost(forward)) + ' equal=' + JSON.stringify(lost(equalForward)))

    // Leg B: the wiring, at the fold the artifact exports, over a ledger FILE read here.
    const namedFirst = await ledgerWorld(mod, CONFLICT_SPECIFIC)
    const rootFirst = await ledgerWorld(mod, [...CONFLICT_SPECIFIC].reverse())
    const equalWorld = await ledgerWorld(mod, CONFLICT_EQUAL)
    worlds.push(namedFirst, rootFirst, equalWorld)
    const rowsNamedFirst = stateRowsOf(namedFirst.file)
    const rowsRootFirst = stateRowsOf(rootFirst.file)
    const rowsEqual = stateRowsOf(equalWorld.file)
    const foldNamedFirst = mod.projectTeams(rowsNamedFirst)
    const foldRootFirst = mod.projectTeams(rowsRootFirst)
    const foldEqual = mod.projectTeams(rowsEqual)

    record('B1', 'the FOLD keeps the named parent when the root claim arrives later (wiring: not last-write-wins)',
      rowsNamedFirst.length === 2 && parentOf(foldNamedFirst, 'T') === 'P',
      'ledgerRows=' + rowsNamedFirst.length + ' foldedParent(T)=' + JSON.stringify(parentOf(foldNamedFirst, 'T'))
      + ' arrivalOrder=' + JSON.stringify(rowsNamedFirst.map((row) => row.payload.parent)))
    record('B2', 'the FOLD keeps the earlier parent when both name one (wiring: arrival order does not decide)',
      parentOf(foldEqual, 'T') === 'A',
      'foldedParent(T)=' + JSON.stringify(parentOf(foldEqual, 'T'))
      + ' arrivalOrder=' + JSON.stringify(rowsEqual.map((row) => row.payload.parent)))
    record('B3', 'the fold shows the loser (contested/losers) and the ledger lines themselves show the contention',
      losersIn(foldNamedFirst).length >= 1 && rowsRootFirst.length === 2
      && losersIn(foldRootFirst).some((entry) => entry.loser === null || entry.loser === 'unspecified'),
      'foldLosers=' + JSON.stringify(losersIn(foldNamedFirst)) + ' ledgerLines=' + rowsNamedFirst.length
      + ' rootFirstLosers=' + JSON.stringify(losersIn(foldRootFirst)))

    // Leg C: control and no-regression.
    const single = await ledgerWorld(mod, SINGLE_PARENT)
    worlds.push(single)
    const rowsSingle = stateRowsOf(single.file)
    const foldSingle = mod.projectTeams(rowsSingle)
    record('C1', 'the same world with one parent instead of two has no contention and folds as this gate folds it',
      losersIn(foldSingle).length === 0 && canonical(foldSingle) === foldRows(rowsFor(rowsSingle.map((row) => ({ subject: row.payload.team, parent: row.payload.parent, at: row.at, seq: row.seq })))),
      'losers=' + JSON.stringify(losersIn(foldSingle)) + ' canonical=' + canonical(foldSingle))
    record('C2', 'the single-parent fold is byte-identical to the golden captured before the wiring',
      GOLDEN_SINGLE_PARENT !== '__GOLDEN__' && canonical(foldSingle) === GOLDEN_SINGLE_PARENT,
      'measured=' + canonical(foldSingle) + ' golden=' + GOLDEN_SINGLE_PARENT)
  } finally {
    for (const world of worlds) world.cleanup()
  }
  return { results, order }
}

// --- self-attack ----------------------------------------------------------------------------

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

const MUTANTS = [
  {
    id: 'M1',
    what: 'every later differing fact wins, i.e. arrival order decides again',
    declared: ['A1', 'A2', 'A3', 'B1', 'B2'],
    find: ['const candidateMoreSpecific = row.parent !== null && current.parent === null;'],
    replace: ['const candidateMoreSpecific = true;'],
  },
  {
    id: 'M2',
    what: 'the more-specific rule is dropped (a root claim may keep the field)',
    declared: ['A1', 'B3'],
    find: ['const candidateMoreSpecific = row.parent !== null && current.parent === null;'],
    replace: ['const candidateMoreSpecific = false;'],
  },
  {
    id: 'M3',
    what: 'the losing fact is no longer returned',
    declared: ['A3', 'B3'],
    find: ['contested.push({ subject: row.subject, winner: current.parent, loser: row.parent, at: row.at, seq: row.seq });'],
    replace: [';'],
  },
  {
    id: 'M4',
    what: 'equal specificity is won by the later record instead of the earlier one',
    declared: ['A2', 'A3', 'B2'],
    find: ['const equalSpecificityEarlier = row.parent === null === (current.parent === null) && (row.at < current.at || row.at === current.at && row.seq < current.seq);'],
    replace: ['const equalSpecificityEarlier = row.parent === null === (current.parent === null);'],
  },
  {
    id: 'M5',
    what: 'the fold keeps the arbitrated parent but stops showing the loser',
    declared: ['B3'],
    find: ['latest.set(id, { ...row, parent, contested: losers.length > 0, losers });'],
    replace: ['latest.set(id, { ...row, parent, contested: false, losers: [] });'],
  },
  {
    id: 'M6',
    what: 'the fold ignores the arbitration and keeps the last declaration again',
    declared: ['B1', 'B2'],
    find: ['const parent = arbitrated.parents.has(id) ? arbitrated.parents.get(id) ?? null : row.parent;'],
    replace: ['const parent = row.parent;'],
  },
  {
    id: 'M7',
    what: 'every declaration reaches the arbitration as a root claim (breaks the single-parent world too)',
    declared: ['B1', 'B2', 'B3', 'C1', 'C2'],
    find: ['declarations.push({ subject: id, parent, at: typeof record.at === \x22number\x22 && Number.isFinite(record.at) ? record.at : 0, seq: record.seq });'],
    replace: ['declarations.push({ subject: id, parent: null, at: 0, seq: record.seq });'],
  },
]

const artifactText = readFileSync(ARTIFACT, 'utf8')
const artifactSha = createHash('sha256').update(artifactText).digest('hex')
const realModule = await import(pathToFileURL(ARTIFACT).href)
if (process.argv.includes('--golden')) {
  const world = await ledgerWorld(realModule, SINGLE_PARENT)
  console.log(canonical(realModule.projectTeams(stateRowsOf(world.file))))
  world.cleanup()
  process.exit(0)
}
const baseline = await measure(realModule)

for (const id of baseline.order) {
  const row = baseline.results.get(id)
  console.log('  ' + (row.ok ? 'ok  ' : 'FAIL') + '  ' + id + '  ' + row.what)
  console.log('        ' + row.evidence)
}
const failed = baseline.order.filter((id) => baseline.results.get(id).ok === false)
console.log('')
console.log(String(baseline.order.length) + ' readings, ' + String(baseline.order.length - failed.length) + ' held, ' + String(failed.length) + ' failed')
const legs = { A: ['A1', 'A2', 'A3'], B: ['B1', 'B2', 'B3'], C: ['C1', 'C2'] }
for (const [leg, ids] of Object.entries(legs)) {
  const red = ids.filter((id) => baseline.results.get(id).ok === false)
  console.log('  leg ' + leg + ': ' + String(ids.length - red.length) + '/' + String(ids.length) + ' held' + (red.length === 0 ? '' : ' (red: ' + red.join(', ') + ')'))
}

const summary = { artifact: ARTIFACT, sha256: artifactSha, readings: baseline.order.length, failed, mutants: 0, declaredMismatches: [], escaped: [], uncovered: [] }
let exitCode = failed.length === 0 ? 0 : 1

if (SELF_ATTACK) {
  const root = process.env.R99_ROOT
  if (root === undefined || root === '') {
    console.error('self-attack: R99_ROOT is not set; the mutant world root is passed in, never derived from this file')
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
  summary.mutants = MUTANTS.length
  summary.uncovered = baseline.order.filter((id) => flipped.has(id) === false)
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
