#!/usr/bin/env node
/**
 * Gate (R206-P2) — readySet(records) answers the question the dependency graph exists for: which
 * tasks can start NOW, which are blocked and by exactly which ids, what is done, which deps nobody
 * ever declared, and which tasks form a cycle.
 *
 * Subject: docs/handoff/R206-contract.md P1 — the SHIPPED dsh-link-collab module exports a pure
 * function:
 *     readySet(records, options?) -> {
 *       ready:   [{ id, team, title }],      // every dep is done (or there is none)
 *       blocked: [{ id, waitingOn: [ids] }], // at least one dep is not done
 *       done:    [ids],
 *       unknown: [{ id, missing: [ids] }],   // a dep id the ledger never declares
 *       cycles:  [[ids]],                    // a cycle, named rather than silently un-ready
 *     }
 * Written by a verifier who did not write the function, and every reading below is taken from the
 * artifact the package ships (plugins/dsh-link-collab/lib/index.js), never from a fixture the
 * function also produces.
 *
 * HOW THE WORLDS ARE MADE. Each row is appended through the module own recorder (openControlLog,
 * R180 copied the kernel blockedBy list into payload.deps) and read back with replay(), so the
 * function is fed the ControlRecord rows this package itself folds — seq / channel / at / writer /
 * instance / actor / subject / payload — and not a hand-written convenience object. Every row of
 * one world carries the same at (one injected clock), so "the LATEST state row per task" means the
 * same thing under both readings of the fold claim rule: this gate does not invent an ordering rule
 * of its own. Each world also has this gate independent answer to the same question (reference,
 * below), written from the rows alone; the hand-written expectation and that reference are
 * cross-checked before anybody product is judged, so a slip in either reads as an instrument fault
 * and not a product fault.
 *
 * Six readings, each of which can fail on its own evidence:
 *
 *  1-ready-set-is-exactly-the-frontier    A diamond (a -> b,c -> d) in both phases: with nothing done
 *        the frontier is exactly [a] and b,c,d are blocked; with a done the frontier is exactly
 *        [b,c] and only d is blocked. Compared as sets in BOTH directions in both phases (nothing
 *        missing, nothing invented), with the blocked map compared exactly, the ready entries
 *        carrying the {id, team, title} P1 declares, and — in the same reading — a task whose deps
 *        were cleared by an explicit empty array (R180) reads ready while an otherwise identical
 *        task whose one dep was left in place stays blocked on it: "cleared" cannot be confused with
 *        "deps ignored". The response SHAPE P1 declares is owned here too. A FIFTH world, beyond
 *        the four P2 names, asks the same ready rule where a blocker has already finished: f1 is
 *        completed while still declaring f2, and f2 is pending declaring f1 — P1 says f2 is ready
 *        (its only dep is done), and a finished task cannot be a member of a live waiting cycle.
 *  2-blocked-names-what-it-waits-on      For every task that is not done and has unmet deps, the
 *        answer must carry a blocked entry naming EXACTLY those ids: none it does not wait on, none
 *        of the ones it does. A task silently blocked (no entry at all) and an entry naming a
 *        satisfied dep are both failures, in every world. Cycle members are the one tolerated case
 *        and the code says why.
 *  3-a-done-task-never-appears-in-ready   No id the function calls done may appear in the set it
 *        calls ready, and no id THIS GATE folded as done from the rows may appear either, so a fold
 *        with an empty done list cannot slip a finished task into the frontier. The other direction
 *        is measured on the same rows: a task whose LATEST row is not done is never reported done (a
 *        fold that reads the FIRST row per task fails here), which is P1 "the LATEST state row, not
 *        the first" made observable.
 *  4-an-undeclared-dep-is-reported       A chain whose last link names a task nobody ever wrote: the
 *        missing ids are reported under unknown against the task that declares them, that task is
 *        NOT ready (never silently ignored), the undeclared id is not itself a task, and a task with
 *        no deps at all is still ready ("no deps" is not "unknown deps"). unknown is empty in every
 *        world where every dep is declared.
 *  5-a-cycle-is-reported-as-a-cycle      Two tasks waiting on each other are NAMED as one cycle, are
 *        not ready, leave a task beside them ready, and no acyclic world invents a cycle. A member
 *        that merely sits un-ready with nothing said is the failure this reading exists to catch.
 *  6-the-function-is-pure                The same records called twice answer deep-equal; a deeply
 *        frozen copy is answered without throwing and the caller records are unchanged afterwards
 *        (it does not mutate its input); and the answer is unchanged while the clock (Date.now,
 *        new Date, performance.now, Math.random), the environment (process.env emptied and every read
 *        counted) and the filesystem (node:fs poisoned in a CHILD process before the module is
 *        imported, so even a named import is poisoned) are armed. Every probe reports which poison
 *        actually armed and what the function touched, so a red line names the rule that broke.
 *
 * Offline discipline: no port, no CDP, no client, no kernel boot, nothing outside the OS temp dir.
 * It writes one throwaway directory under the temp dir and removes it unless --keep is given.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 the subject could not be measured here (the
 * module does not import, the export is missing, or the ledger recorder could not open a world). A
 * reading that cannot be measured is a failure, never a pass, and a missing export is reported as
 * exit 3 with the places that were searched — never as a green.
 *
 * Usage: node scripts/verify-collab-ready-set.mjs [--module <path>] [--keep]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const KEEP = has('--keep')
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
/** Where a producer would have written the function, so an exit 3 can say "declared but not built". */
const SOURCE_PATH = join(dirname(dirname(MODULE_PATH)), 'src', 'index.ts')

/** The instant every row of every world carries: one clock, so "latest" cannot mean two things. */
const T0 = 1760000000000
/** The separator boardKey uses, so an answer that speaks in keys is still readable as ids. */
const SEP = String.fromCharCode(0)

const DIAMOND = 'gate-r206-diamond'
const MISSING = 'gate-r206-missing'
const CYCLE = 'gate-r206-cycle'
const CLEARED = 'gate-r206-cleared'
const LATEST = 'gate-r206-latest'
const SPELLING = 'gate-r206-spelling'
const DONE_LIVE = 'gate-r206-done-live'

const msg = (error) => String(error && error.message ? error.message : error)
const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch (error) { return '<unserialisable: ' + msg(error) + '>' } }
const clip = (text, width) => { const line = String(text === undefined || text === null ? '' : text); return line.length <= width ? line : line.slice(0, width) + '...' }
const sameText = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (list) => [...list].sort()
/** An id as a reader says it: a board key (team + NUL + id) is still the id. */
const bare = (value) => String(value === undefined || value === null ? '' : value).split(SEP).pop()
const bareList = (list) => (Array.isArray(list) ? list.map(bare) : [])

// ---------------------------------------------------------------------------
// The worlds: the rows, the expectation this gate wrote, and its own answer
// ---------------------------------------------------------------------------

/**
 * One task/state row in exactly the shape the shipped recorder writes it.
 * payload.deps is the R180 copy of the kernel blockedBy list; an empty array is a real
 * declaration ("this version does not block") rather than an absence.
 */
const taskRow = (team, id, state, deps, title) => ({
  kind: 'task/state',
  actor: team,
  subject: id,
  payload: { id, state, deps: deps === undefined ? [] : deps, title: title === undefined ? 'T-' + id : title },
})

/**
 * The worlds this gate measures. rows is the world; expect is what this gate says the answer must
 * be, written before the function was read; reference (below) recomputes it from the rows alone.
 */
const WORLD_SPECS = [
  {
    name: 'diamond-pristine',
    team: DIAMOND,
    why: 'a diamond (a -> b,c -> d) with nothing done: the frontier is exactly a',
    rows: [
      ['a', 'pending', []],
      ['b', 'pending', ['a']],
      ['c', 'pending', ['a']],
      ['d', 'pending', ['b', 'c']],
    ],
    expect: { ready: ['a'], done: [], blocked: { b: ['a'], c: ['a'], d: ['b', 'c'] }, unknown: {}, cycles: [] },
  },
  {
    name: 'diamond-frontier',
    team: DIAMOND,
    why: 'the same diamond with a done: the frontier is exactly b,c and only d waits',
    rows: [
      ['a', 'completed', []],
      ['b', 'pending', ['a']],
      ['c', 'pending', ['a']],
      ['d', 'pending', ['b', 'c']],
    ],
    expect: { ready: ['b', 'c'], done: ['a'], blocked: { d: ['b', 'c'] }, unknown: {}, cycles: [] },
  },
  {
    name: 'chain-missing',
    team: MISSING,
    why: 'a chain whose last link names a task the ledger never declares',
    rows: [
      ['m1', 'pending', ['m2']],
      ['m2', 'pending', ['ghost']],
      ['m3', 'pending', []],
    ],
    expect: { ready: ['m3'], done: [], blocked: { m1: ['m2'], m2: ['ghost'] }, unknown: { m2: ['ghost'] }, cycles: [] },
  },
  {
    name: 'cycle',
    team: CYCLE,
    why: 'two tasks that wait on each other, beside one that does not',
    rows: [
      ['k1', 'pending', ['k2']],
      ['k2', 'pending', ['k1']],
      ['k3', 'pending', []],
    ],
    expect: { ready: ['k3'], done: [], blocked: { k1: ['k2'], k2: ['k1'] }, unknown: {}, cycles: [['k1', 'k2']] },
  },
  {
    name: 'cleared',
    team: CLEARED,
    why: 'r1 declared a dep and then cleared it with a later empty array; r3 kept the same dep',
    rows: [
      ['r1', 'pending', ['r2']],
      ['r2', 'pending', []],
      ['r3', 'pending', ['r2']],
      ['r1', 'pending', []],
    ],
    expect: { ready: ['r1', 'r2'], done: [], blocked: { r3: ['r2'] }, unknown: {}, cycles: [] },
  },
  {
    name: 'latest-row',
    team: LATEST,
    why: 'the latest state row per task decides done: d1 finished late, d2 went back to pending, d3 finished and releases d4',
    rows: [
      ['d1', 'pending', []],
      ['d2', 'completed', []],
      ['d3', 'pending', []],
      ['d4', 'pending', ['d3']],
      ['d1', 'completed', []],
      ['d2', 'pending', []],
      ['d3', 'completed', []],
    ],
    expect: { ready: ['d2', 'd4'], done: ['d1', 'd3'], blocked: {}, unknown: {}, cycles: [] },
  },
  {
    name: 'done-blocks-live',
    team: DONE_LIVE,
    why: 'P1 ready rule beyond the four worlds P2 names: f1 finished while still declaring f2, and f2 declares f1',
    staleLoop: true,
    rows: [
      ['f1', 'completed', ['f2']],
      ['f2', 'pending', ['f1']],
    ],
    expect: { ready: ['f2'], done: ['f1'], blocked: {}, unknown: {}, cycles: [] },
  },
  {
    name: 'spelling',
    team: SPELLING,
    why: 'evidence only: the other done spelling P1 does not name, plus a self-loop',
    evidenceOnly: true,
    rows: [
      ['s1', 'pending', []],
      ['s2', 'pending', ['s2']],
      ['s1', 'done', []],
    ],
    expect: { ready: [], done: ['s1'], blocked: { s2: ['s2'] }, unknown: {}, cycles: [['s2']] },
  },
]

/**
 * This gate own answer to the same question, from the rows and nothing else.
 *
 * The point is not to re-implement the product: it is that the hand-written expect above and this
 * fold are two independent statements of the rule, so a slip in either shows up as an INSTRUMENT
 * fault before the product is judged. It speaks in bare ids and never looks at keys.
 */
const reference = (rows) => {
  const latest = new Map()
  for (const [id, state, deps] of rows) latest.set(id, { id, state, deps: deps === undefined ? [] : [...deps] })
  const ids = [...latest.keys()].sort()
  const declared = new Set(ids)
  const isDone = (id) => { const row = latest.get(id); return row !== undefined && (row.state === 'completed' || row.state === 'done') }
  const depsOf = (id) => { const row = latest.get(id); return row === undefined ? [] : row.deps }
  const live = new Set(ids.filter((id) => isDone(id) === false))
  const edgesOf = (id) => depsOf(id).filter((dep) => declared.has(dep) && live.has(dep))
  const reaches = (from, to) => {
    const stack = [...edgesOf(from)]
    const seen = new Set()
    while (stack.length > 0) {
      const at = stack.pop()
      if (at === to) return true
      if (seen.has(at)) continue
      seen.add(at)
      stack.push(...edgesOf(at))
    }
    return false
  }
  const inCycle = ids.filter((id) => live.has(id) && reaches(id, id))
  const unmet = new Map(ids.map((id) => [id, depsOf(id).filter((dep) => isDone(dep) === false)]))
  const ready = ids.filter((id) => live.has(id) && unmet.get(id).length === 0)
  const blockedRows = ids.filter((id) => live.has(id) && unmet.get(id).length > 0).map((id) => [id, unmet.get(id)])
  const unknownRows = blockedRows.filter(([, deps]) => deps.some((dep) => declared.has(dep) === false)).map(([id, deps]) => [id, deps.filter((dep) => declared.has(dep) === false)])
  return {
    ids,
    declared: [...declared].sort(),
    done: ids.filter(isDone),
    ready,
    blocked: new Map(blockedRows),
    unknown: new Map(unknownRows),
    unmet,
    inCycle: sorted(inCycle),
    cycles: inCycle.length === 0 ? [] : [sorted(inCycle)],
  }
}

// ---------------------------------------------------------------------------
// Reading an answer
// ---------------------------------------------------------------------------

/** Does this look like the object P1 declares? Shape is judged here; behaviour is judged by the rest. */
const SHAPE_KEYS = ['ready', 'blocked', 'done', 'unknown', 'cycles']
const shapeOf = (value) => {
  const answer = value !== null && typeof value === 'object' ? value : null
  const problems = []
  if (answer === null) { problems.push('the answer is not an object (' + typeof value + ')'); return { problems } }
  for (const key of SHAPE_KEYS) {
    if (Array.isArray(answer[key]) === false) problems.push('the ' + key + ' field is ' + (answer[key] === undefined ? 'absent' : Array.isArray(answer[key]) ? 'an array' : typeof answer[key]) + ', not the array P1 declares')
  }
  if (Array.isArray(answer.ready)) {
    for (const entry of answer.ready) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { problems.push('a ready entry is ' + show(entry) + ', not the {id, team, title} P1 declares'); break }
    }
  }
  return { problems }
}

/**
 * The answer, read into bare ids.
 *
 * A key (team + NUL + id) is stripped to the id a reader says, because which spelling the function
 * uses is not what P1 measures, but the ids it names are. Anything unreadable is left out of the
 * normalised view and shows up as a missing id in the reading that wanted it, never as a pass.
 */
const readAnswer = (value) => {
  const answer = value !== null && typeof value === 'object' ? value : {}
  const idOf = (entry) => {
    if (typeof entry === 'string') return bare(entry)
    if (entry !== null && typeof entry === 'object') {
      for (const key of ['id', 'key', 'task', 'name']) if (entry[key] !== undefined) return bare(entry[key])
    }
    return entry === undefined || entry === null ? null : bare(entry)
  }
  const idList = (list) => (Array.isArray(list) ? list.map(idOf).filter((id) => id !== null) : [])
  /** blocked is declared as [{id, waitingOn}]; a plain map is read too, so a spelling is not a rule. */
  const pairs = (source, field) => {
    const out = new Map()
    if (Array.isArray(source)) {
      for (const entry of source) {
        if (entry === null || typeof entry !== 'object') continue
        const id = idOf(entry)
        if (id === null) continue
        out.set(id, bareList(entry[field]))
      }
    } else if (source !== null && typeof source === 'object') {
      for (const [key, list] of Object.entries(source)) out.set(bare(key), bareList(list))
    }
    return out
  }
  const cycles = Array.isArray(answer.cycles) ? answer.cycles.map((cycle) => (Array.isArray(cycle) ? sorted(bareList(cycle)) : [bare(cycle)])) : []
  return {
    readyRaw: answer.ready,
    ready: idList(answer.ready),
    blocked: pairs(answer.blocked, 'waitingOn'),
    done: idList(answer.done),
    doneRaw: answer.done,
    unknown: pairs(answer.unknown, 'missing'),
    unknownRaw: answer.unknown,
    cycles,
    shape: shapeOf(value),
  }
}

// ---------------------------------------------------------------------------
// Building a world through the shipped recorder
// ---------------------------------------------------------------------------

const buildWorld = async (module, root, spec) => {
  const dir = join(root, spec.name)
  try { mkdirSync(dir, { recursive: true }) } catch (error) { return { error: 'mkdir ' + dir + ' failed: ' + msg(error) } }
  let log = null
  try { log = module.openControlLog({ dir, writer: 'gate-r206', now: () => T0 }) } catch (error) { return { error: 'openControlLog failed: ' + msg(error) } }
  try {
    for (const [id, state, deps, title] of spec.rows) await log.append(taskRow(spec.team, id, state, deps, title))
    const records = log.replay()
    return { dir, records }
  } catch (error) {
    return { error: 'the recorder refused a row: ' + msg(error) }
  } finally {
    try { log.close() } catch { /* the temp world is thrown away */ }
  }
}

// ---------------------------------------------------------------------------
// Purity: clock, environment, filesystem
// ---------------------------------------------------------------------------

/** Run fn with the clock and the random source armed as throwers; report which poisons actually armed. */
const underDeadClock = (fn) => {
  const real = { now: Date.now, date: globalThis.Date, perf: globalThis.performance, random: Math.random }
  const restore = []
  const armed = {}
  const arm = (label, install, undo, probe) => {
    try { install(); restore.push(undo); armed[label] = probe() } catch (error) { armed[label] = 'could not arm: ' + msg(error) }
  }
  const boom = (what) => { throw new Error('the function ' + what) }
  arm('Date.now',
    () => { Date.now = () => boom('read the clock (Date.now)') },
    () => { Date.now = real.now },
    () => { try { Date.now(); return 'did not throw' } catch (error) { return 'armed' } })
  arm('new Date',
    () => {
      globalThis.Date = new Proxy(real.date, {
        construct: () => boom('read the clock (new Date)'),
        apply: () => boom('read the clock (Date())'),
        get: (target, key) => (key === 'now' ? () => boom('read the clock (Date.now)') : target[key]),
      })
    },
    () => { globalThis.Date = real.date },
    () => { try { new Date(); return 'did not throw' } catch (error) { return 'armed' } })
  if (real.perf !== undefined && typeof real.perf.now === 'function') {
    const originalNow = real.perf.now
    arm('performance.now',
      () => { real.perf.now = () => boom('read the clock (performance.now)') },
      () => { real.perf.now = originalNow },
      () => { try { real.perf.now(); return 'did not throw' } catch (error) { return 'armed' } })
  }
  arm('Math.random',
    () => { Math.random = () => boom('drew a random number') },
    () => { Math.random = real.random },
    () => { try { Math.random(); return 'did not throw' } catch (error) { return 'armed' } })
  let value = null
  let error = null
  let ok = false
  try { value = fn(); ok = true } catch (thrown) { error = msg(thrown) } finally { for (const undo of restore.reverse()) { try { undo() } catch { /* restoring */ } } }
  return { ok, armed, value, error }
}

/** Run fn with process.env replaced by an EMPTY, read-counting proxy; report every name it asked for. */
const underEmptyEnv = (fn) => {
  const real = process.env
  const reads = []
  const empty = new Proxy({}, {
    get(_target, key) { if (typeof key === 'string') reads.push(key); return undefined },
    has() { return false },
    ownKeys() { return [] },
    getOwnPropertyDescriptor() { return undefined },
    set() { return true },
    deleteProperty() { return true },
  })
  let installed = false
  let value = null
  let error = null
  try {
    process.env = empty
    installed = process.env === empty
    value = fn()
  } catch (thrown) { error = msg(thrown) } finally { try { process.env = real } catch { /* restoring */ } }
  return { ok: installed && error === null, installed, armed: installed ? 'armed' : 'could not arm', reads: [...new Set(reads)], value, error }
}

/**
 * The child that poisons node:fs BEFORE importing the module, so even a named import
 * (import { readFileSync } from node:fs) is the poisoned function: mutating the module AFTER the
 * import would leave a snapshot of the original function in place and prove nothing.
 */
/**
 * The child that runs the call under Node PERMISSION model, with read access granted to the
 * module own file and nothing else.
 *
 * Monkeypatching node:fs cannot answer this question: once THIS process has imported node:fs, its
 * named exports are a snapshot, so a wrapper installed afterwards is invisible to a module that
 * imported the same functions (measured: the namespace handed to a later importer still holds the
 * ORIGINAL function). The permission model denies at the binding layer instead, so a read anywhere
 * else fails whatever spelling the function used. The child proves its own arm with a canary read of
 * the node binary, which must come back ERR_ACCESS_DENIED, and only then imports and calls.
 */
const FILE_PROBE_SOURCE = [
  '(async () => {',
  '  const { pathToFileURL } = await import("node:url")',
  '  const { readFileSync } = await import("node:fs")',
  '  const records = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"))',
  '  const modulePath = process.argv[2]',
  '  let canary = "not measured"',
  '  try { readFileSync(process.execPath); canary = "READ ALLOWED" } catch (error) { canary = String(error && error.code ? error.code : error && error.message ? error.message : error) }',
  '  let loaded = null',
  '  let importError = null',
  '  try { loaded = await import(pathToFileURL(modulePath).href) } catch (error) { importError = String(error && error.code ? error.code + ": " + error.message : error) }',
  '  let answer = null',
  '  let error = null',
  '  try { answer = loaded === null ? null : loaded.readySet(records) } catch (thrown) { error = String(thrown && thrown.code ? thrown.code : thrown && thrown.message ? thrown.message : thrown) }',
  '  console.log(JSON.stringify({ mode: "permission-model", canary, importError, hasAnswer: answer !== null && answer !== undefined, answer: answer === undefined ? null : answer, error }))',
  '})().catch((error) => { console.log(JSON.stringify({ fatal: String(error && error.message ? error.message : error) })) })',
].join('\n')

const underPoisonedFiles = (recordsJson) => {
  const encoded = Buffer.from(FILE_PROBE_SOURCE, 'utf8').toString('base64')
  const evalText = 'eval(Buffer.from(' + JSON.stringify(encoded) + ', "base64").toString())'
  const recordsB64 = Buffer.from(recordsJson, 'utf8').toString('base64')
  const args = ['--permission', '--allow-fs-read=' + MODULE_PATH, '-e', evalText, recordsB64, MODULE_PATH]
  let run = null
  try {
    run = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    return { ok: false, why: 'the child process could not be started: ' + msg(error) }
  }
  if (run.error !== undefined && run.error !== null) return { ok: false, why: 'the child process failed: ' + msg(run.error) }
  const stdout = String(run.stdout === undefined || run.stdout === null ? '' : run.stdout)
  const stderr = String(run.stderr === undefined || run.stderr === null ? '' : run.stderr)
  const line = stdout.trim().split(/\r?\n/).filter((entry) => entry.startsWith('{')).pop()
  if (line === undefined) return { ok: false, why: 'the child answered nothing (status ' + show(run.status) + ', stderr ' + clip(stderr, 240) + ')' }
  let parsed = null
  try { parsed = JSON.parse(line) } catch (error) { return { ok: false, why: 'the child answered something that is not JSON: ' + clip(line, 200) } }
  if (parsed.fatal !== undefined) return { ok: false, why: 'the child crashed: ' + clip(parsed.fatal, 300) }
  return { ok: true, status: run.status, ...parsed }
}

/** The purity probes, on ONE world rows. Every probe compares against the clean answer by text. */
const purityOf = (module, records, cleanJson) => {
  const call = () => { try { return { ok: true, value: module.readySet(records) } } catch (error) { return { ok: false, error: msg(error) } } }
  const beforeJson = JSON.stringify(records)
  const first = call()
  const second = call()
  const twice = first.ok === true && second.ok === true && sameText(first.value, second.value)
  const frozen = records.map((row) => Object.freeze({ ...row, payload: row.payload !== null && typeof row.payload === 'object' ? Object.freeze({ ...row.payload, deps: Array.isArray(row.payload.deps) ? Object.freeze([...row.payload.deps]) : row.payload.deps }) : row.payload }))
  Object.freeze(frozen)
  let frozenAnswer = null
  let frozenError = null
  try { frozenAnswer = module.readySet(frozen) } catch (error) { frozenError = msg(error) }
  const unchanged = JSON.stringify(records) === beforeJson
  const clock = underDeadClock(() => module.readySet(records))
  const env = underEmptyEnv(() => module.readySet(records))
  const files = underPoisonedFiles(JSON.stringify(records))
  return {
    cleanJson,
    twice,
    twiceRaw: { first: first.ok === true ? clip(show(first.value), 120) : first.error, second: second.ok === true ? clip(show(second.value), 120) : second.error },
    frozen: { threw: frozenError, answers: frozenError === null && first.ok === true && sameText(frozenAnswer, first.value) },
    unchanged,
    clock: { ok: clock.ok === true && first.ok === true && sameText(clock.value, first.value), armed: clock.armed, error: clock.error },
    env: { ok: env.ok === true && first.ok === true && sameText(env.value, first.value), armed: env.armed, installed: env.installed, reads: env.reads, error: env.error },
    files: { ok: files.ok === true && files.canary === 'ERR_ACCESS_DENIED' && files.importError === null && files.error === null && files.hasAnswer === true && first.ok === true && sameText(files.answer, first.value), ...files },
  }
}

// ---------------------------------------------------------------------------
// Collection: build every world through the product, then answer it
// ---------------------------------------------------------------------------

const loadModule = async () => {
  try { return { ok: true, module: await import(pathToFileURL(MODULE_PATH).href) } } catch (error) { return { ok: false, error: msg(error) } }
}

const collect = async (module, root) => {
  const worlds = {}
  for (const spec of WORLD_SPECS) {
    const ref = reference(spec.rows)
    const built = await buildWorld(module, root, spec)
    if (built.error !== undefined) return { fatal: 'world ' + spec.name + ' could not be opened by the shipped recorder: ' + built.error }
    let answer = null
    try { answer = { ok: true, value: module.readySet(built.records) } } catch (error) { answer = { ok: false, error: msg(error), name: error && error.name ? error.name : null } }
    worlds[spec.name] = { spec, ref, records: built.records, dir: built.dir, answer, read: answer.ok === true ? readAnswer(answer.value) : null }
  }
  const subjects = ['diamond-frontier', 'cycle']
  const purity = {}
  for (const name of subjects) {
    const world = worlds[name]
    purity[name] = world.answer.ok === true ? purityOf(module, world.records, JSON.stringify(world.answer.value)) : { cleanJson: null, skipped: 'the clean answer threw: ' + world.answer.error }
  }
  return { worlds, purity, subjects }
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

/** The readings this gate reports, in order, so a run still names what it measured. */
const READING_IDS = [
  '1-ready-set-is-exactly-the-frontier',
  '2-blocked-names-what-it-waits-on',
  '3-a-done-task-never-appears-in-ready',
  '4-an-undeclared-dep-is-reported',
  '5-a-cycle-is-reported-as-a-cycle',
  '6-the-function-is-pure',
]

const judge = (collected) => {
  const readings = []
  const add = (id, problems, detail, evidence) => readings.push({ id, ok: problems.length === 0, detail: problems.length === 0 ? detail : problems.slice(0, 6).join('; '), evidence: evidence ?? [] })
  const worlds = collected.worlds
  const ruleWorlds = Object.keys(worlds).filter((name) => worlds[name].spec.evidenceOnly !== true)
  const readyText = (world) => '[' + world.read.ready.join(',') + ']'
  const blockedText = (world) => [...world.read.blocked].map(([id, deps]) => id + ' -> [' + deps.join(',') + ']').join(' ')

  // 1 -------------------------------------------------------------------- the frontier
  {
    const problems = []
    const evidence = []
    for (const name of ['diamond-pristine', 'diamond-frontier', 'cleared', 'done-blocks-live']) {
      const world = worlds[name]
      if (world.answer.ok !== true) { problems.push(name + ': readySet threw: ' + clip(world.answer.error, 160)); continue }
      if (world.read.shape.problems.length > 0) problems.push(name + ': the answer is not the shape P1 declares — ' + world.read.shape.problems.join('; '))
      const wantReady = sorted(world.ref.ready)
      const gotReady = sorted(world.read.ready)
      const missing = wantReady.filter((id) => gotReady.includes(id) === false)
      const invented = gotReady.filter((id) => wantReady.includes(id) === false)
      if (missing.length > 0) problems.push(name + ': the frontier is missing ' + show(missing) + ' (the answer offers ' + show(gotReady) + ')')
      if (invented.length > 0) problems.push(name + ': the answer offers ' + show(invented) + ' as ready although a dep is not done')
      const wantBlocked = [...world.ref.blocked]
      const wantIds = sorted(wantBlocked.map(([id]) => id))
      const gotIds = sorted([...world.read.blocked.keys()])
      if (sameText(wantIds, gotIds) === false) problems.push(name + ': the blocked set is ' + show(gotIds) + ', expected ' + show(wantIds))
      for (const [id, deps] of wantBlocked) {
        const named = world.read.blocked.get(id)
        if (named === undefined) continue
        const want = sorted(deps)
        const extra = named.filter((dep) => want.includes(dep) === false)
        const absent = want.filter((dep) => named.includes(dep) === false)
        if (extra.length > 0 || absent.length > 0) problems.push(name + ': ' + id + ' waits on ' + show(want) + ' but the answer names ' + show(named))
      }
      evidence.push(name + ' (' + world.spec.why + '): ready ' + readyText(world) + ' | blocked ' + (blockedText(world) || '(none)') + ' | this gate folds ready [' + wantReady.join(',') + ']')
    }
    // The entries carry what P1 says they carry.
    const frontierWorld = worlds['diamond-frontier']
    if (frontierWorld.answer.ok === true) {
      const entries = Array.isArray(frontierWorld.read.readyRaw) ? frontierWorld.read.readyRaw : []
      const entry = entries.find((item) => item !== null && typeof item === 'object' && bare(item.id) === 'b') ?? null
      if (entry === null) problems.push('diamond-frontier: no ready entry for b, so the {id, team, title} P1 declares cannot be read from ' + show(entries))
      else {
        if (bare(entry.team) !== DIAMOND) problems.push('diamond-frontier: the ready entry for b carries team ' + show(entry.team) + ', not the actor the row wrote (' + show(DIAMOND) + ')')
        if (entry.title !== 'T-b') problems.push('diamond-frontier: the ready entry for b carries title ' + show(entry.title) + ', not the title the row wrote (' + show('T-b') + ')')
      }
      evidence.push('ready entries as answered: ' + show(entries))
    }
    // R180 cleared graph: the same task ready once its deps are cleared, blocked while they are not.
    const cleared = worlds.cleared
    if (cleared.answer.ok === true) {
      if (cleared.read.ready.includes('r1') !== true) problems.push('cleared: r1 cleared its dep with an explicit empty array and is still not ready (' + readyText(cleared) + ')')
      if (cleared.read.blocked.has('r1')) problems.push('cleared: r1 cleared its dep but is still reported blocked by ' + show(cleared.read.blocked.get('r1')))
      if (cleared.read.ready.includes('r3') === true) problems.push('cleared: r3 never cleared its dep and is offered as ready, so "cleared" and "ignored" are one answer here')
      if ((cleared.read.blocked.get('r3') ?? []).includes('r2') !== true) problems.push('cleared: r3 kept its dep on r2 and the answer does not name it (' + show(cleared.read.blocked.get('r3') ?? null) + ')')
      evidence.push('cleared world: r1 (cleared by a later empty deps array) ready=' + show(cleared.read.ready.includes('r1')) + ' | r3 (same dep kept) blocked by ' + show(cleared.read.blocked.get('r3') ?? null))
    }
    add(READING_IDS[0], problems,
      'the diamond frontier is exactly what the graph says in both phases (' + show(sorted(worlds['diamond-pristine'].ref.ready)) + ' then ' + show(sorted(worlds['diamond-frontier'].ref.ready)) + '), every ready entry carries {id, team, title}, and a dep cleared by an empty array reads ready while the same dep left in place still blocks',
      evidence)
  }

  // 2 -------------------------------------------------------------------- blocked names its ids
  {
    const problems = []
    const evidence = []
    for (const name of ruleWorlds) {
      const world = worlds[name]
      if (world.answer.ok !== true) { problems.push(name + ': readySet threw: ' + clip(world.answer.error, 160)); continue }
      const line = []
      for (const [id, deps] of world.read.blocked) {
        const unmet = world.ref.unmet.get(id) ?? []
        line.push(id + ' -> [' + deps.join(',') + ']')
        if (world.ref.done.includes(id)) { problems.push(name + ': ' + id + ' is done but carries a blocked entry waiting on ' + show(deps)); continue }
        if (unmet.length === 0) { problems.push(name + ': ' + id + ' waits on nothing but carries a blocked entry ' + show(deps)); continue }
        const real = sorted(unmet)
        const declaredReal = real.filter((dep) => world.ref.declared.includes(dep))
        if (deps.length === 0) { problems.push(name + ': ' + id + ' is blocked by ' + show(real) + ' and its waitingOn names nothing'); continue }
        const phantom = deps.filter((dep) => real.includes(dep) === false)
        if (phantom.length > 0) problems.push(name + ': ' + id + ' does not wait on ' + show(phantom) + ' (it waits on ' + show(real) + ')')
        const unnamed = declaredReal.filter((dep) => deps.includes(dep) === false)
        if (unnamed.length > 0) problems.push(name + ': ' + id + ' waits on ' + show(unnamed) + ' and the answer does not name it (names ' + show(deps) + ')')
      }
      for (const [id, unmet] of world.ref.unmet) {
        if (world.ref.done.includes(id) || unmet.length === 0) continue
        if (world.read.blocked.has(id)) continue
        // A cycle member is contracted to be NAMED AS A CYCLE; whether it also carries a blocked
        // entry is not what P1 says (a cycle is reported as a cycle), so it is not judged here.
        if (world.ref.inCycle.includes(id)) { line.push(id + ' (cycle member, no blocked entry)'); continue }
        problems.push(name + ': ' + id + ' waits on ' + show(sorted(unmet)) + ' and has no blocked entry at all')
      }
      evidence.push(name + ': blocked ' + (line.join(' ') || '(none)') + ' | this gate: ' + ([...world.ref.unmet].filter(([id, deps]) => deps.length > 0 && world.ref.done.includes(id) === false).map(([id, deps]) => id + ' -> [' + sorted(deps).join(',') + ']').join(' ') || '(nothing waits)'))
    }
    add(READING_IDS[1], problems,
      'every task that is not done and waits on something carries a blocked entry naming exactly the ids it waits on, in every world, and no entry names a dep that is already satisfied',
      evidence)
  }

  // 3 -------------------------------------------------------------------- done never ready
  {
    const problems = []
    const evidence = []
    for (const name of ruleWorlds) {
      const world = worlds[name]
      if (world.answer.ok !== true) { problems.push(name + ': readySet threw: ' + clip(world.answer.error, 160)); continue }
      const overlap = world.read.done.filter((id) => world.read.ready.includes(id))
      if (overlap.length > 0) problems.push(name + ': ' + show(overlap) + ' is reported in done AND in ready')
      const wantDone = sorted(world.ref.done)
      const gotDone = sorted(world.read.done)
      const fromRows = wantDone.filter((id) => gotDone.includes(id) === false)
      const invented = gotDone.filter((id) => wantDone.includes(id) === false)
      if (fromRows.length > 0) problems.push(name + ': the latest row of ' + show(fromRows) + ' says done and done omits it (' + show(gotDone) + ')')
      if (invented.length > 0) problems.push(name + ': done reports ' + show(invented) + ' although its latest row is not done')
      const leaked = wantDone.filter((id) => world.read.ready.includes(id))
      if (leaked.length > 0) problems.push(name + ': ' + show(leaked) + ' is done by its latest row and is still offered as ready')
      evidence.push(name + ': done ' + show(gotDone) + ' | ready ' + readyText(world) + ' | overlap ' + show(overlap) + ' | this gate folds done ' + show(wantDone))
    }
    const latest = worlds['latest-row']
    if (latest.answer.ok === true) {
      for (const id of ['d1', 'd3']) if (latest.read.done.includes(id) !== true) problems.push('latest-row: the latest row of ' + id + ' is completed and done omits it (' + show(latest.read.done) + ')')
      if (latest.read.done.includes('d2')) problems.push('latest-row: the latest row of d2 is pending but done reports it — the answer is reading the FIRST row per task')
      for (const id of ['d2', 'd4']) if (latest.read.ready.includes(id) !== true) problems.push('latest-row: ' + id + ' has every dep done and is not ready (' + readyText(latest) + ')')
      evidence.push('latest-row: d1 pending->completed reads done=' + show(latest.read.done.includes('d1')) + ' | d2 completed->pending reads done=' + show(latest.read.done.includes('d2')) + ' (must be false) | d4 waiting on a completed d3 reads ready=' + show(latest.read.ready.includes('d4')))
    }
    const spelling = worlds.spelling
    if (spelling !== undefined && spelling.answer.ok === true) evidence.push('EVIDENCE ONLY (P1 does not name the spellings): a latest row of state "done" reads as done=' + show(spelling.read.done.includes('s1')) + ' | a self-loop s2 -> s2 is named as a cycle=' + show(spelling.read.cycles))
    add(READING_IDS[2], problems,
      'no finished task is offered as ready (in the function own terms and in this gate fold of the same rows), and the LATEST state row per task is the one that decides — d1 finished late, d2 went back to pending',
      evidence)
  }

  // 4 -------------------------------------------------------------------- undeclared dep
  {
    const problems = []
    const evidence = []
    const world = worlds['chain-missing']
    if (world.answer.ok !== true) problems.push('chain-missing: readySet threw: ' + clip(world.answer.error, 160))
    else {
      const unknown = [...world.read.unknown]
      const ghost = unknown.find(([id]) => id === 'm2') ?? null
      if (ghost === null) problems.push('chain-missing: m2 names ghost, which no row declares, and unknown does not report it (unknown is ' + show(unknown) + ')')
      else if (sameText(sorted(ghost[1]), ['ghost']) === false) problems.push('chain-missing: the unknown entry for m2 names ' + show(ghost[1]) + ', not the undeclared id [ghost]')
      const extra = unknown.filter(([id]) => id !== 'm2').map(([id]) => id)
      if (extra.length > 0) problems.push('chain-missing: unknown also reports ' + show(extra) + ', whose deps are all declared')
      if (world.read.ready.includes('m2')) problems.push('chain-missing: m2 waits on an undeclared id and is offered as ready — the undeclared dep was silently ignored')
      if (world.read.ready.includes('ghost')) problems.push('chain-missing: ghost is offered as ready although no row ever declares it, so it is a task in the answer')
      if (world.read.ready.includes('m3') !== true) problems.push('chain-missing: m3 has no deps at all and is not ready (' + readyText(world) + ') — "no deps" was read as "unknown deps"')
      if (world.read.ready.includes('m1')) problems.push('chain-missing: m1 waits on m2, which is not done, and is offered as ready')
      if ((Array.isArray(world.read.unknownRaw) ? world.read.unknownRaw : []).some((entry) => entry !== null && typeof entry === 'object' && Array.isArray(entry.missing) && entry.missing.length === 0)) problems.push('chain-missing: an unknown entry carries an empty missing list')
      evidence.push('chain-missing: unknown ' + show(unknown) + ' | ready ' + readyText(world) + ' | m1 blocked by ' + show(world.read.blocked.get('m1') ?? null) + ' | this gate: unknown [["m2",["ghost"]]], ready [m3]')
    }
    const others = ruleWorlds.filter((name) => name !== 'chain-missing')
    for (const name of others) {
      const other = worlds[name]
      if (other.answer.ok !== true) continue
      if (other.read.unknown.size > 0) problems.push(name + ': every dep in this world is declared, and unknown reports ' + show([...other.read.unknown]))
    }
    evidence.push('unknown across the fully-declared worlds: ' + others.map((name) => name + '=' + (worlds[name].read === null ? 'threw' : show([...worlds[name].read.unknown]))).join(' '))
    add(READING_IDS[3], problems,
      'a dep the ledger never declares is reported against the task that declares it, that task is not ready, the undeclared id is not a task, a task with no deps is still ready, and unknown stays empty where every dep is declared',
      evidence)
  }

  // 5 -------------------------------------------------------------------- cycles
  {
    const problems = []
    const evidence = []
    const world = worlds.cycle
    const want = ['k1', 'k2']
    if (world.answer.ok !== true) problems.push('cycle: readySet threw: ' + clip(world.answer.error, 160))
    else {
      const cycles = world.read.cycles
      const match = cycles.filter((cycle) => sameText(sorted(cycle), want))
      if (match.length !== 1) problems.push('cycle: k1 and k2 wait on each other and are reported ' + show(cycles) + ', not exactly one cycle over ' + show(want))
      for (const id of want) {
        if (world.read.ready.includes(id)) problems.push('cycle: ' + id + ' is on the cycle and is offered as ready')
        if (cycles.some((cycle) => cycle.includes(id)) !== true) problems.push('cycle: ' + id + ' is left un-ready with nothing naming it as a cycle — the silent wait this reading exists to catch')
      }
      if (world.read.ready.includes('k3') !== true) problems.push('cycle: k3 is beside the cycle with no deps and is not ready (' + readyText(world) + ')')
      evidence.push('cycle world: cycles ' + show(cycles) + ' | ready ' + readyText(world) + ' | k1 blocked by ' + show(world.read.blocked.get('k1') ?? null) + ', k2 by ' + show(world.read.blocked.get('k2') ?? null) + ' | this gate: one cycle over ' + show(want))
    }
    // A world whose cycle member is DONE is not asked about here: its stale edge is one root
    // cause and reading 1 already reports it against P1's ready rule, so it is reddened once.
    const others = ruleWorlds.filter((name) => name !== 'cycle' && worlds[name].spec.staleLoop !== true)
    for (const name of others) {
      const other = worlds[name]
      if (other.answer.ok !== true) continue
      if (other.read.cycles.length > 0) problems.push(name + ': this graph has no cycle and the answer reports ' + show(other.read.cycles))
    }
    evidence.push('cycles across the acyclic worlds: ' + others.map((name) => name + '=' + (worlds[name].read === null ? 'threw' : show(worlds[name].read.cycles))).join(' '))
    add(READING_IDS[4], problems,
      'the two tasks that wait on each other are named as exactly one cycle and are not ready, a task beside them stays ready, and no acyclic world invents a cycle',
      evidence)
  }

  // 6 -------------------------------------------------------------------- purity
  {
    const problems = []
    const evidence = []
    for (const name of collected.subjects) {
      const purity = collected.purity[name] ?? {}
      if (purity.skipped !== undefined) { problems.push(name + ': ' + purity.skipped); continue }
      if (purity.twice !== true) problems.push(name + ': two calls with the same records did not answer deep-equal (' + clip(show(purity.twiceRaw), 220) + ')')
      if (purity.frozen.threw !== null) problems.push(name + ': a frozen copy of the records made the call throw (' + clip(purity.frozen.threw, 160) + '), so it writes to its input')
      else if (purity.frozen.answers !== true) problems.push(name + ': a frozen copy of the same records answered differently')
      if (purity.unchanged !== true) problems.push(name + ': the records this gate handed in were mutated by the call')
      if (purity.clock.ok !== true) problems.push(name + ': the answer changed or threw while the clock was forbidden (' + clip(purity.clock.error ?? 'a different answer', 160) + ')')
      if (purity.env.ok !== true) problems.push(name + ': the answer changed or threw with the environment emptied (' + clip(purity.env.error ?? 'a different answer', 160) + ')')
      if (purity.files.ok !== true) problems.push(name + ': ' + (purity.files.why !== undefined ? purity.files.why : purity.files.error !== null && purity.files.error !== undefined ? 'the call threw with every file but the module unreadable (' + clip(purity.files.error, 160) + ')' : purity.files.canary !== 'ERR_ACCESS_DENIED' ? 'the filesystem arm was not armed (canary answered ' + show(purity.files.canary ?? null) + '), so nothing was measured' : purity.files.importError !== null && purity.files.importError !== undefined ? 'the module could not even be imported inside the permission model (' + clip(purity.files.importError, 160) + ')' : 'the child answered differently with every file but the module unreadable'))
      evidence.push(name + ': twice deep-equal ' + show(purity.twice) + ' | frozen input ' + show({ threw: purity.frozen.threw, sameAnswer: purity.frozen.answers }) + ' | records unchanged ' + show(purity.unchanged))
      evidence.push(name + ': clock armed ' + show(purity.clock.armed) + ' -> ' + (purity.clock.ok ? 'same answer' : 'DIFFERENT/THREW')
        + ' | env armed ' + show(purity.env.armed) + ' -> ' + (purity.env.ok ? 'same answer' : 'DIFFERENT/THREW') + ', env names read ' + show(purity.env.reads ?? null)
        + ' | fs ' + show(purity.files.mode ?? null) + ' canary ' + show(purity.files.canary ?? null) + ' -> ' + (purity.files.ok === true ? 'same answer, read no file' : 'DIFFERENT/THREW'))
    }
    add(READING_IDS[5], problems,
      'called twice with the same records it answers deep-equal, a frozen copy is answered without throwing and the caller rows are unchanged, and the answer survives a forbidden clock, an emptied environment and a poisoned filesystem',
      evidence)
  }

  return readings
}

// ---------------------------------------------------------------------------
// Pre-flight: the gate own expectation against its own fold
// ---------------------------------------------------------------------------

const preflight = () => {
  const problems = []
  const pairs = (map) => sorted([...map].map(([id, deps]) => id + ' -> [' + sorted(deps).join(',') + ']'))
  for (const spec of WORLD_SPECS) {
    const ref = reference(spec.rows)
    const wantBlocked = sorted(Object.entries(spec.expect.blocked ?? {}).map(([id, deps]) => id + ' -> [' + sorted(deps).join(',') + ']'))
    const wantUnknown = sorted(Object.entries(spec.expect.unknown ?? {}).map(([id, deps]) => id + ' -> [' + sorted(deps).join(',') + ']'))
    if (sameText(sorted(ref.ready), sorted(spec.expect.ready)) === false) problems.push(spec.name + ': expectation ready ' + show(sorted(spec.expect.ready)) + ' but the rows fold to ' + show(sorted(ref.ready)))
    if (sameText(sorted(ref.done), sorted(spec.expect.done)) === false) problems.push(spec.name + ': expectation done ' + show(sorted(spec.expect.done)) + ' but the rows fold to ' + show(sorted(ref.done)))
    if (sameText(pairs(ref.blocked), wantBlocked) === false) problems.push(spec.name + ': expectation blocked ' + show(wantBlocked) + ' but the rows fold to ' + show(pairs(ref.blocked)))
    if (sameText(pairs(ref.unknown), wantUnknown) === false) problems.push(spec.name + ': expectation unknown ' + show(wantUnknown) + ' but the rows fold to ' + show(pairs(ref.unknown)))
    if (sameText(ref.cycles.map((cycle) => sorted(cycle).join('|')), (spec.expect.cycles ?? []).map((cycle) => sorted(cycle).join('|'))) === false) problems.push(spec.name + ': expectation cycles ' + show(spec.expect.cycles) + ' but the rows fold to ' + show(ref.cycles))
  }
  return problems
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Why the export is not there, said precisely enough to act on. */
const explainMissing = (module) => {
  const lines = []
  lines.push('the shipped module ' + MODULE_PATH + ' does not export a function named readySet (typeof module.readySet === ' + show(typeof module.readySet) + ')')
  lines.push('exports that mention the board at all: ' + show(Object.keys(module).filter((name) => /ready|frontier|claim|board|task/i.test(name))))
  try {
    if (existsSync(SOURCE_PATH)) {
      const source = readFileSync(SOURCE_PATH, 'utf8')
      const mentions = /\breadySet\b/.test(source)
      lines.push('the source ' + SOURCE_PATH + ' ' + (mentions ? 'MENTIONS readySet, so the shipped artifact is behind the source: rebuild plugins/dsh-link-collab and re-run' : 'does not mention readySet either, so the producer has not landed it yet'))
    } else lines.push('no source at ' + SOURCE_PATH)
  } catch (error) { lines.push('the source could not be read: ' + msg(error)) }
  return lines
}

const main = async () => {
  const started = Date.now()
  const loaded = await loadModule()
  if (loaded.ok !== true) {
    console.log('SKIP: importing ' + MODULE_PATH + ' threw: ' + clip(loaded.error, 300))
    console.log('  SUMMARY 0 readings, 0 failed, 1 not measured -> exit 3')
    return 3
  }
  const module = loaded.module
  if (typeof module.readySet !== 'function') {
    for (const line of explainMissing(module)) console.log('SKIP: ' + line)
    console.log('SKIP: no reading was taken — a gate that cannot measure its subject reports exit 3, never a green.')
    console.log('  SUMMARY 0 readings, 0 failed, 1 not measured (the export is missing) -> exit 3')
    return 3
  }
  if (typeof module.openControlLog !== 'function') {
    console.log('SKIP: ' + MODULE_PATH + " exports readySet but no openControlLog, so this gate cannot build its worlds out of the ledger row shape")
    console.log('  SUMMARY 0 readings, 0 failed, 1 not measured -> exit 3')
    return 3
  }

  const preflightProblems = preflight()
  if (preflightProblems.length > 0) {
    console.log('  INSTRUMENT  this gate hand-written expectation and its own fold of the same rows disagree:')
    for (const line of preflightProblems) console.log('        ' + line)
    console.log('  SUMMARY 0 readings, 0 failed, 1 instrument fault -> exit 1')
    return 1
  }

  const root = mkdtempSync(join(tmpdir(), 'r206-ready-set-'))
  try {
    const collected = await collect(module, root)
    if (collected.fatal !== undefined) {
      console.log('SKIP: ' + collected.fatal)
      console.log('  SUMMARY 0 readings, 0 failed, 1 not measured -> exit 3')
      return 3
    }
    console.log('  subject  readySet exported by ' + MODULE_PATH)
    for (const spec of WORLD_SPECS) {
      const world = collected.worlds[spec.name]
      const kinds = [...new Set(world.records.map((row) => row.kind))]
      const withDeps = world.records.filter((row) => row.payload !== null && typeof row.payload === 'object' && Array.isArray(row.payload.deps)).length
      console.log('  world    ' + spec.name + ' — ' + spec.why)
      console.log('        ' + world.records.length + ' row(s) out of the shipped recorder, kind ' + show(kinds) + ', ' + withDeps + ' carrying payload.deps, seq ' + show(world.records.map((row) => row.seq)) + ', every row at ' + T0 + ', actor ' + show(spec.team))
      console.log('        rows ' + world.records.map((row) => row.payload.id + ':' + row.payload.state + '[' + row.payload.deps.join(',') + ']').join(' '))
      console.log('        answer ' + (world.answer.ok === true ? clip(show(world.answer.value), 420) : 'THREW ' + clip(world.answer.error, 200)))
    }
    const readings = judge(collected)
    for (const reading of readings) {
      console.log('  ' + (reading.ok === true ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
      for (const line of reading.evidence ?? []) console.log('        ' + line)
    }
    const failed = readings.filter((reading) => reading.ok === false)
    console.log('  ' + readings.length + ' readings, ' + failed.length + ' failed | elapsed ' + (Math.round((Date.now() - started) / 100) / 10) + 's')
    const code = failed.length > 0 ? 1 : 0
    console.log('  SUMMARY readySet on ' + MODULE_PATH + ': ' + readings.length + ' readings, ' + failed.length + ' failed' + (failed.length > 0 ? ' (' + failed.map((reading) => reading.id).join(', ') + ')' : '') + ' -> exit ' + code)
    return code
  } finally {
    if (KEEP !== true) { try { rmSync(root, { recursive: true, force: true }) } catch { /* the temp world is disposable */ } }
    else console.log('        kept: ' + show(root))
  }
}

process.exitCode = await main()

