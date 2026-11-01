#!/usr/bin/env node
/**
 * Spec (R206-P1) -- the ready set: what the ledger says may be started NOW.
 *
 * Subject: R206-contract.md section P1. The package's own test, written beside the function, for the
 * one question the dependency graph exists for: given the ledger as it stands, which tasks can be
 * started now, which are blocked and by what, and which blockers the ledger has never heard of.
 *
 * Every reading is taken from the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js), folded
 * from hand-written control records -- the ledger's own row shape, `kind: 'task/state'` with
 * `payload: { id, state, deps?, title? }` -- and never from the plugin's own report of what it did.
 * The rows below are written the way R180's recorder writes them: the task snapshot's `blockedBy`
 * arrives as `payload.deps`, and an EMPTY array is written too, so a later revision can clear a graph
 * an earlier one declared.
 *
 *   E  EXPORTED          the package's main export carries readySet, and an empty ledger answers the
 *                        five keys with five empty lists (nothing invented for an empty ledger).
 *   D  THE DIAMOND       a -> b,c -> d: the frontier is exactly {a}; b and c name a, d names b and c;
 *                        then a's latest row says done: the frontier advances to exactly {b, c}, a is
 *                        reported done and is NOT in ready, and d still names b and c.
 *   M  MISSING DEP       e -> ghost (declared by nobody), f -> e: ghost is reported under unknown and e
 *                        is not ready; f is blocked on e, not on ghost, and ghost is not invented as a
 *                        task.
 *   C  CYCLE             g -> h -> g: reported as ONE cycle [g, h] (so the wait is named), neither
 *                        member ready, and each member's waitingOn names the dependency that closes the
 *                        loop rather than an empty list - while an unrelated free task z is still ready.
 *   X  EMPTY DEPS        i first declares ['d'] and its next row declares []: i is ready again, while
 *                        the same ledger WITHOUT that second row keeps i blocked on d - the clearing
 *                        row is what moved it.
 *   N  NO DEPS           k's row carries no deps field at all: ready. "Declares nothing" is not
 *                        "declares something undeclared".
 *   L  LATEST ROW        m is completed then pending (latest wins => ready, not done) and n is pending
 *                        then completed (latest wins => done, not ready): the FIRST row does not decide.
 *   P  PURITY            the same records twice answer deep-equal documents, reversed order answers the
 *                        same document, a deep-frozen input is answered without being mutated, the
 *                        answer survives JSON round-tripping, and Date.now replaced by a thrower does
 *                        not change it.
 *   K  KEYS ON REQUEST   with { asKeys: true } every id is the board key the rest of the module uses,
 *                        and the same tasks are named.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 the artifact could not be imported.
 * Usage: node plugins/dsh-link-collab/test/ready-set.spec.mjs [--module <path>]
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..', '..')
const argv = process.argv.slice(2)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))

let module
try {
  module = await import(pathToFileURL(MODULE_PATH).href)
} catch (error) {
  console.error('could not import the artifact at ' + MODULE_PATH + ': ' + (error && error.message ? error.message : String(error)))
  process.exit(3)
}

const started = Date.now()
const TEAM = 'spec-team'
const T0 = 1700000000000
const show = (value) => { try { return JSON.stringify(value) } catch { return String(value) } }
/** Structural equality that does not depend on key order: the answer is data, not a spelling. */
const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  }
  return JSON.stringify(value === undefined ? null : value)
}
const same = (left, right) => canonical(left) === canonical(right)
const readings = []
const add = (id, ok, detail, evidence = []) => {
  readings.push({ id, ok })
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + detail)
  for (const line of evidence) console.log('      ' + line)
}

/**
 * One `task/state` row in the ledger's own shape.
 *
 * `deps` is the recorder's copy of the kernel's `blockedBy`: passing `undefined` writes no field at
 * all (the kernel published none, so the fold keeps the previous graph), and passing `[]` writes the
 * empty array the recorder writes when a revision blocks on nothing.
 */
const taskRow = (seq, id, state, deps, extra = {}) => ({
  seq,
  channel: 'control',
  at: T0 + seq,
  kind: 'task/state',
  actor: TEAM,
  subject: id,
  payload: {
    id,
    state,
    ...deps === undefined ? {} : { deps },
    ...extra,
  },
})
const ready = (answer) => (answer.ready ?? []).map((entry) => entry.id)
const blockedOf = (answer) => Object.fromEntries((answer.blocked ?? []).map((entry) => [entry.id, entry.waitingOn]))
const unknownOf = (answer) => Object.fromEntries((answer.unknown ?? []).map((entry) => [entry.id, entry.missing]))
/** Run fn with Date.now replaced by a thrower: a pure reader must answer anyway. */
const underDeadClock = (fn) => {
  const real = Date.now
  Date.now = () => { throw new Error('readySet read the clock') }
  try { return { ok: true, value: fn() } } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) } } finally { Date.now = real }
}

// ---------------------------------------------------------------------------
// E -- the export, and the empty ledger
// ---------------------------------------------------------------------------
{
  const issues = []
  if (typeof module.readySet !== 'function') issues.push('the package main export does not carry readySet (typeof = ' + typeof module.readySet + ')')
  let empty = null
  try { empty = module.readySet([]) } catch (error) { issues.push('readySet([]) threw: ' + (error && error.message ? error.message : String(error))) }
  if (empty !== null) {
    const keys = Object.keys(empty).sort()
    if (same(keys, ['blocked', 'cycles', 'done', 'ready', 'unknown']) === false) issues.push('the answer carries the keys ' + show(keys) + ', not the five the contract names')
    for (const key of ['ready', 'blocked', 'done', 'unknown', 'cycles']) {
      if (Array.isArray(empty[key]) === false) issues.push(key + ' is not an array: ' + show(empty[key]))
      else if (empty[key].length !== 0) issues.push(key + ' is ' + show(empty[key]) + ' for an empty ledger, not []')
    }
  }
  add('E-exported-and-empty', issues.length === 0,
    issues.length === 0
      ? 'the shipped artifact exports readySet, and an empty ledger answers exactly {ready:[], blocked:[], done:[], unknown:[], cycles:[]}'
      : issues.join('; '),
    ['module: ' + MODULE_PATH, 'typeof readySet = ' + typeof module.readySet, 'readySet([]) = ' + show(empty)])
}

// ---------------------------------------------------------------------------
// D -- the diamond: a -> b, c -> d
// ---------------------------------------------------------------------------
const diamondRows = [
  taskRow(1, 'a', 'pending', [], { title: 'lay the foundation' }),
  taskRow(2, 'b', 'pending', ['a'], { title: 'build the walls' }),
  taskRow(3, 'c', 'pending', ['a'], { title: 'lay the roof' }),
  taskRow(4, 'd', 'pending', ['b', 'c'], { title: 'paint it' }),
]
{
  const issues = []
  const before = module.readySet(diamondRows)
  if (same(ready(before), ['a']) === false) issues.push('the frontier is ' + show(ready(before)) + ', not exactly [a]')
  const a = (before.ready ?? [])[0] ?? {}
  if (a.id !== 'a' || a.team !== TEAM || a.title !== 'lay the foundation') issues.push('the ready member is ' + show(a) + ', not {id:a, team:' + TEAM + ', title:lay the foundation}')
  if (same(blockedOf(before), { b: ['a'], c: ['a'], d: ['b', 'c'] }) === false) issues.push('the blocked map is ' + show(blockedOf(before)))
  if (same(before.done, []) === false) issues.push('done is ' + show(before.done) + ' before anybody finished')

  // The frontier advances on the LATEST row: a's next row says completed.
  const afterRows = [...diamondRows, taskRow(5, 'a', 'completed', [], { title: 'lay the foundation' })]
  const after = module.readySet(afterRows)
  if (same(ready(after), ['b', 'c']) === false) issues.push('after a finished the frontier is ' + show(ready(after)) + ', not exactly [b, c]')
  if (same(after.done, ['a']) === false) issues.push('done is ' + show(after.done) + ', not [a]')
  if (ready(after).includes('a')) issues.push('a task whose latest row says done is STILL in ready')
  if (same(blockedOf(after), { d: ['b', 'c'] }) === false) issues.push('after a finished the blocked map is ' + show(blockedOf(after)) + ', not {d:[b, c]}')
  add('D-diamond-frontier', issues.length === 0,
    issues.length === 0
      ? 'the frontier of a -> b,c -> d is exactly [a] with b,c waiting on a and d on b,c; once a is done the frontier is exactly [b, c], a is in done and not in ready'
      : issues.join('; '),
    ['before: ready ' + show(ready(before)) + ' | blocked ' + show(blockedOf(before)) + ' | done ' + show(before.done),
      'after a is completed: ready ' + show(ready(after)) + ' | blocked ' + show(blockedOf(after)) + ' | done ' + show(after.done),
      'a ready member: ' + show(a)])
}

// ---------------------------------------------------------------------------
// M -- a chain whose head depends on a task the ledger never declares
// ---------------------------------------------------------------------------
{
  const issues = []
  const rows = [
    taskRow(1, 'e', 'pending', ['ghost'], { title: 'wait for nobody' }),
    taskRow(2, 'f', 'pending', ['e'], { title: 'after e' }),
  ]
  const answer = module.readySet(rows)
  if (same(ready(answer), []) === false) issues.push('the frontier is ' + show(ready(answer)) + ', not empty: an undeclared blocker is not done')
  if (same(unknownOf(answer), { e: ['ghost'] }) === false) issues.push('unknown is ' + show(unknownOf(answer)) + ', not {e:[ghost]}')
  if (same(blockedOf(answer), { e: ['ghost'], f: ['e'] }) === false) issues.push('blocked is ' + show(blockedOf(answer)) + ', not {e:[ghost], f:[e]}')
  if ((answer.unknown ?? []).some((entry) => entry.id === 'ghost')) issues.push('the undeclared dependency was invented as a task: ' + show(answer.unknown))
  add('M-chain-with-a-missing-dep', issues.length === 0,
    issues.length === 0
      ? 'e waits on a dependency no row declares: it is reported under unknown, it is not ready, and f waits on e rather than on ghost'
      : issues.join('; '),
    ['ready ' + show(ready(answer)) + ' | blocked ' + show(blockedOf(answer)) + ' | unknown ' + show(unknownOf(answer))])
}

// ---------------------------------------------------------------------------
// C -- a cycle is named, not left un-ready and unexplained
// ---------------------------------------------------------------------------
{
  const issues = []
  const rows = [
    taskRow(1, 'g', 'pending', ['h']),
    taskRow(2, 'h', 'pending', ['g']),
    taskRow(3, 'z', 'pending', []),
  ]
  const answer = module.readySet(rows)
  const cycles = (answer.cycles ?? []).map((loop) => [...loop].sort())
  if (same(cycles, [['g', 'h']]) === false) issues.push('cycles is ' + show(answer.cycles) + ', not exactly one loop over [g, h]')
  if (ready(answer).includes('g') || ready(answer).includes('h')) issues.push('a task on a cycle is in ready: ' + show(ready(answer)))
  if (same(ready(answer), ['z']) === false) issues.push('the free task z is not the frontier: ready is ' + show(ready(answer)))
  const named = blockedOf(answer)
  if (same(named.g, ['h']) === false || same(named.h, ['g']) === false) issues.push('a cycle member does not name the dependency that closes the loop: ' + show(named))
  add('C-cycle-is-named', issues.length === 0,
    issues.length === 0
      ? 'g <-> h is reported as one cycle [g, h] and neither member is ready; each member names the dependency that closes the loop, so the wait is explained instead of being "blocked by nothing"'
      : issues.join('; '),
    ['cycles ' + show(answer.cycles) + ' | ready ' + show(ready(answer)) + ' | blocked ' + show(blockedOf(answer))])
}

// ---------------------------------------------------------------------------
// X -- an empty deps array clears an earlier graph
// ---------------------------------------------------------------------------
{
  const issues = []
  const before = [
    taskRow(1, 'd', 'pending', []),
    taskRow(2, 'i', 'pending', ['d'], { title: 'was waiting on d' }),
  ]
  const cleared = [...before, taskRow(3, 'i', 'pending', [], { title: 'was waiting on d' })]
  const held = module.readySet(before)
  const freed = module.readySet(cleared)
  if (same(blockedOf(held), { i: ['d'] }) === false) issues.push('before the clearing row i is ' + show(blockedOf(held).i) + ', not blocked on [d]')
  if (ready(held).includes('i')) issues.push('i is ready before the clearing row')
  if (ready(freed).includes('i') === false) issues.push('after deps: [] i is not ready: ' + show(ready(freed)))
  if (blockedOf(freed).i !== undefined) issues.push('after deps: [] i is still blocked: ' + show(blockedOf(freed)))
  add('X-empty-deps-clears-the-graph', issues.length === 0,
    issues.length === 0
      ? 'i blocked on d; the next row for i carries deps: [] and i is ready again - and the same ledger without that row keeps it blocked'
      : issues.join('; '),
    ['without the clearing row: ready ' + show(ready(held)) + ' | blocked ' + show(blockedOf(held)),
      'with the clearing row:    ready ' + show(ready(freed)) + ' | blocked ' + show(blockedOf(freed))])
}

// ---------------------------------------------------------------------------
// N -- a task whose row never carried a deps field at all
// ---------------------------------------------------------------------------
{
  const issues = []
  const rows = [
    taskRow(1, 'k', 'pending', undefined, { title: 'nobody blocks me' }),
    taskRow(2, 'j', 'pending', ['k']),
  ]
  const answer = module.readySet(rows)
  if (same(ready(answer), ['k']) === false) issues.push('ready is ' + show(ready(answer)) + ', not [k]')
  if (same(blockedOf(answer), { j: ['k'] }) === false) issues.push('blocked is ' + show(blockedOf(answer)) + ', not {j:[k]}')
  if ((answer.unknown ?? []).length !== 0) issues.push('a row with no deps field was read as an unknown dependency: ' + show(answer.unknown))
  add('N-no-deps-is-unblocked', issues.length === 0,
    issues.length === 0
      ? 'a task whose row carries no deps field is on the frontier, and the task depending on it waits on it by name'
      : issues.join('; '),
    ['ready ' + show(ready(answer)) + ' | blocked ' + show(blockedOf(answer)) + ' | unknown ' + show(answer.unknown)])
}

// ---------------------------------------------------------------------------
// L -- the LATEST state row decides, not the first
// ---------------------------------------------------------------------------
{
  const issues = []
  const rows = [
    taskRow(1, 'a', 'pending', []),
    // m said completed once, then went back to pending: the latest row wins.
    taskRow(2, 'm', 'completed', []),
    taskRow(3, 'm', 'pending', []),
    // n said pending once, then completed: the latest row wins the other way.
    taskRow(4, 'n', 'pending', ['a']),
    taskRow(5, 'n', 'completed', ['a']),
  ]
  const answer = module.readySet(rows)
  if (ready(answer).includes('m') === false) issues.push('m is completed-then-pending and is not ready (ready ' + show(ready(answer)) + ')')
  if ((answer.done ?? []).includes('m')) issues.push('m is completed-then-pending and is still reported done: ' + show(answer.done))
  if ((answer.done ?? []).includes('n') === false) issues.push('n is pending-then-completed and is not done: ' + show(answer.done))
  if (ready(answer).includes('n')) issues.push('n is pending-then-completed and is STILL ready: ' + show(ready(answer)))
  if (blockedOf(answer).n !== undefined) issues.push('n is done and still reported blocked: ' + show(blockedOf(answer)))
  add('L-latest-state-row-wins', issues.length === 0,
    issues.length === 0
      ? 'a task completed-then-pending is ready and not done, and a task pending-then-completed is done and not ready: the first row decides nothing'
      : issues.join('; '),
    ['ready ' + show(ready(answer)) + ' | done ' + show(answer.done) + ' | blocked ' + show(blockedOf(answer))])
}

// ---------------------------------------------------------------------------
// P -- purity: identical input, identical answer, and nothing ambient read
// ---------------------------------------------------------------------------
{
  const issues = []
  const rows = [...diamondRows, taskRow(6, 'i', 'pending', ['d']), taskRow(7, 'i', 'pending', [])]
    .map((row) => Object.freeze({ ...row, payload: Object.freeze({ ...row.payload }) }))
  const frozen = Object.freeze(rows)
  let first = null
  let second = null
  try {
    first = module.readySet(frozen)
    second = module.readySet(frozen)
  } catch (error) {
    issues.push('readySet threw on a deep-frozen input (a reader that writes to its input cannot answer one): ' + (error && error.message ? error.message : String(error)))
  }
  if (first !== null && same(first, second) === false) issues.push('two calls on the same records answered different documents: ' + show(first) + ' vs ' + show(second))
  if (first !== null) {
    const reversed = module.readySet([...rows].reverse())
    if (same(reversed, first) === false) issues.push('the same records in reversed order answered a different document: ' + show(reversed))
    let roundTripped = null
    try { roundTripped = JSON.parse(JSON.stringify(first)) } catch (error) { issues.push('the answer is not plain JSON: ' + (error && error.message ? error.message : String(error))) }
    if (roundTripped !== null && same(roundTripped, first) === false) issues.push('the answer does not survive a JSON round trip (it carries non-data values)')
    const page = module.readySet({ rows })
    if (same(page, first) === false) issues.push('a records() page and its own rows answered different documents: ' + show(page))
    // A fold already holds the board, so it is answered without re-reading the log; the fold keeps no
    // title, so the two answers are compared with the titles set aside rather than pretended equal.
    const folded = module.readySet(module.projectTeamState(rows))
    const titlesSetAside = { ...first, ready: (first.ready ?? []).map((entry) => ({ ...entry, title: null })) }
    if (same(folded, titlesSetAside) === false) issues.push('a folded state and the rows it was folded from answered different frontiers: ' + show(folded))
    const dead = underDeadClock(() => module.readySet(frozen))
    if (dead.ok !== true) issues.push('with Date.now replaced by a thrower readySet threw: ' + show(dead.error))
    else if (same(dead.value, first) === false) issues.push('the answer changed once the clock was forbidden: ' + show(dead.value))
  }
  add('P-pure-identical-input-identical-answer', issues.length === 0,
    issues.length === 0
      ? 'twice on the same deep-frozen records: deep-equal; reversed order: deep-equal; JSON round trip: deep-equal; a records() page: deep-equal; under a throwing Date.now: deep-equal'
      : issues.join('; '),
    ['answer ' + show(first)])
}

// ---------------------------------------------------------------------------
// K -- every id in the answer can be asked for as a board key
// ---------------------------------------------------------------------------
{
  const issues = []
  const keyed = module.readySet(diamondRows, { asKeys: true })
  const ids = ready(keyed)
  const expected = ['a'].map((id) => TEAM + '\u0000' + id)
  if (same(ids, expected) === false) issues.push('with asKeys the ready ids are ' + show(ids) + ', not ' + show(expected))
  if ((keyed.blocked ?? []).some((entry) => entry.waitingOn.some((dep) => dep.includes('\u0000') === false))) issues.push('with asKeys a waitingOn entry is not a board key: ' + show(keyed.blocked))
  const plain = module.readySet(diamondRows)
  if (same(ready(plain), ['a']) === false) issues.push('without options the ids are ' + show(ready(plain)) + ', not bare ids')
  add('K-keys-on-request', issues.length === 0,
    issues.length === 0
      ? 'asKeys spells every id the way the rest of the module does (team NUL id), and the default answer still speaks in bare ids'
      : issues.join('; '),
    ['asKeys ready ' + show(ids) + ' | blocked ' + show(keyed.blocked), 'default ready ' + show(ready(plain))])
}

const failed = readings.filter((reading) => reading.ok === false)
console.log('')
console.log(readings.length + ' readings, ' + failed.length + ' failed, ' + (Date.now() - started) + 'ms')
if (failed.length > 0) {
  console.log('failed: ' + failed.map((reading) => reading.id).join(', '))
  process.exit(1)
}
console.log('声明集 == 观测集')
