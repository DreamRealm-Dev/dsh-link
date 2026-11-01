#!/usr/bin/env node
/**
 * R132 gate #92: locks are not retried hard (T50 / DSH-EAC S2, feature-pack-spec.md:73).
 *
 * The standard says: when pnpm meets a lock (EPERM/EBUSY) it does NOT retry; the CLI ends with a DEDICATED
 * exit code, the work is queued verbatim, and the next start resumes it in the lock-free window - exactly
 * once. This repository has that scar already (R76 retried a rename once, R87 rewrote a page silently), so
 * the slice under test is small on purpose: a lock predicate, an idempotent queue by key, and a resume that
 * attempts each entry exactly once and keeps what failed.
 *
 * AUTHOR DEBT: the producer is sessionprober; this gate is the Lead's (recorded in the round record).
 * Mutants patch a private copy of the artifact, and the shipped bytes are hashed before and after (G1).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.R132_PROJECT ?? join(HERE, '..'))
const ARTIFACT = join(PROJECT, 'plugins', 'dsh-link-upgrade', 'lib', 'index.js')
const WORLD = resolve(process.env.R132_WORLD ?? join(PROJECT, '.tmp', 'r132-gate'))
const MUTANT = process.env.R132_MUTANT ?? ''
const argv = process.argv.slice(2)

if (!existsSync(ARTIFACT)) {
  console.error('SKIP: the shipped artifact is not built at ' + ARTIFACT + ' (run: node plugins/build.mjs)')
  process.exit(3)
}

// Anchors are taken from the ARTIFACT (esbuild re-emits quotes and aliases: existsSync2, readFileSync2,
// writeFileSync2), never from src/. A dead anchor is a dead mutant, not a green one.
const MUTANTS = {
  'queue-duplicates-by-key': [{ from: '  if (held.some((row) => row.key === op.key)) return { queued: false, count: held.length };', to: '  if (false && held.some((row) => row.key === op.key)) return { queued: false, count: held.length };' }],
  'resume-repeats-entries': [{ from: '  const left = held.filter((op) => !resumed.includes(op.key));', to: '  const left = [...held];' }],
  'failed-entries-dropped': [{ from: '      failed.push({ key: op.key, error: error instanceof Error ? error.message : String(error) });', to: '      failed.push({ key: op.key, error: error instanceof Error ? error.message : String(error) });\n      resumed.push(op.key);' }],
  'lock-failure-detects-everything': [{ from: '  if (code === "EPERM" || code === "EBUSY") return true;', to: '  return true;' }],
  // The caller's own four ways to be wrong, each named by the property it breaks.
  'startup-throws-on-empty-queue': [{ from: '  if (held.length > 0 && typeof applyOp !== "function") {', to: '  if (typeof applyOp !== "function") {' }],
  'startup-drains-without-applier': [{ from: '  if (held.length > 0 && typeof applyOp !== "function") {', to: '  if (false) {' }],
  'startup-ignores-the-queue': [{ from: '  return { kernel, pending: resumePendingOps(root, applyOp) };', to: '  return { kernel, pending: { attempted: 0, resumed: [], failed: [], remaining: 0 } };' }],
  'startup-enforces-skipped': [{ from: '    assertRangesSatisfied(range2.pluginsDir, { closureDir: range2.closureDir, kernelRoot: range2.kernelRoot, lockFile: range2.lockFile });', to: '    void 0;' }],
  'corrupt-queue-reads-empty': [{ from: '    throw new TypeError("readPendingOps: " + path + " is not JSON: " + String(error?.message ?? error));', to: '    return [];' }],
}

// Hypotheses, corrected by measurement below. P1 (the slice exists) and G1 are premises/guards rather than
// mutant targets, exactly as the sibling gates treat theirs.
const DECLARED = {
  // Widened by measurement: with duplicate queueing allowed the queue holds three entries, so the resume
  // reading moves too (each entry once - there are simply more entries).
  'queue-duplicates-by-key': ['P2', 'P3'],
  // 24th widening (measured): with entries never removed, the caller's second startup attempts them again,
  // so P9 moves too.
  'resume-repeats-entries': ['P3', 'P4', 'P9'],
  'failed-entries-dropped': ['P4'],
  'lock-failure-detects-everything': ['P6'],
  'corrupt-queue-reads-empty': ['P5'],
  // Hypotheses for the caller: one mutant per property (quiet when empty, refuse when unappliable, resume
  // once, refuse before touching). Each carries the mechanism that should move it.
  'startup-throws-on-empty-queue': ['P7'],
  'startup-drains-without-applier': ['P8'],
  'startup-ignores-the-queue': ['P9', 'P10'],
  'startup-enforces-skipped': ['P10'],
}

const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const sourceText = readFileSync(ARTIFACT, 'utf8')
const sourceHash = hashOf(ARTIFACT)
const statusNow = () => {
  const out = spawnSync('git', ['status', '--short', '--', 'plugins'], { cwd: PROJECT, encoding: 'utf8' })
  return String(out.stdout ?? '').trim() === '' ? [] : String(out.stdout).trim().split(/\r?\n/).map((line) => line.trim()).sort()
}
const statusAtStart = statusNow()

let target = ARTIFACT
let mutationNote = 'baseline: the shipped artifact itself'
if (MUTANT !== '') {
  const patch = MUTANTS[MUTANT]
  if (patch === undefined) { console.error('pending-queue: unknown mutant ' + MUTANT); process.exit(2) }
  let text = sourceText
  for (const step of patch) {
    const next = text.replace(step.from, step.to)
    if (next === text) { console.error('pending-queue: mutant ' + MUTANT + ' changed nothing; anchor missing: ' + step.from.slice(0, 90)); process.exit(2) }
    text = next
  }
  const dir = join(WORLD, 'mutant-' + MUTANT)
  mkdirSync(dir, { recursive: true })
  target = join(dir, 'index.js')
  writeFileSync(target, text, 'utf8')
  mutationNote = 'mutant ' + MUTANT + ' patched a private copy at ' + target
}
const M = await import(pathToFileURL(target).href)

const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })

// --- P1: the slice exists in the SHIPPED artifact ------------------------------------------------------
const EXPORTS = ['isLockFailure', 'queuePendingOp', 'readPendingOps', 'resumePendingOps']
const CONSTANTS = ['PENDING_DIR', 'PENDING_FILE', 'LOCK_EXIT_CODE']
const surfaces = EXPORTS.map((name) => typeof M[name])
const constants = CONSTANTS.map((name) => (typeof M[name] === 'string' || typeof M[name] === 'number') ? M[name] : null)
held('P1', surfaces.every((kind) => kind === 'function') && constants.every((value) => value !== null),
  'the shipped artifact carries the lock-queue slice: exports=' + JSON.stringify(surfaces) + ' constants=' + JSON.stringify(constants))

const CASE = join(WORLD, MUTANT === '' ? 'case' : 'case-' + MUTANT)
rmSync(CASE, { recursive: true, force: true })
const root = join(CASE, 'root')
mkdirSync(root, { recursive: true })
const opOf = (key, at) => ({ key, kind: 'rename', at, detail: 'queued by gate 92' })

// --- P2: queueing is idempotent BY KEY, and the file is written deterministically ----------------------
const first = M.queuePendingOp(root, opOf('op-b', '2026-10-07T00:00:00.000Z'))
const again = M.queuePendingOp(root, opOf('op-b', '2026-10-07T00:00:01.000Z'))
const second = M.queuePendingOp(root, opOf('op-a', '2026-10-07T00:00:02.000Z'))
const queueText = readFileSync(join(root, M.PENDING_DIR, M.PENDING_FILE), 'utf8')
held('P2', first.queued === true && first.count === 1 && again.queued === false && again.count === 1 && second.count === 2
  && queueText.indexOf('op-a') < queueText.indexOf('op-b') && queueText.includes('\r') === false && queueText.endsWith('\n') && queueText.endsWith('\n\n') === false,
  'a lock queues one entry per key, deterministically: first=' + JSON.stringify(first) + ' again=' + JSON.stringify(again) + ' second=' + JSON.stringify(second) + ' sorted=' + String(queueText.indexOf('op-a') < queueText.indexOf('op-b')) + ' crlf=' + String(queueText.includes('\r')))

// --- P3: the resume attempts each entry exactly once and drains the queue -----------------------------
const calls = []
const resumedOnce = M.resumePendingOps(root, (op) => { calls.push(op.key) })
const callsAfterFirst = [...calls]
const resumedAgain = M.resumePendingOps(root, (op) => { calls.push(op.key) })
const queueAfter = M.readPendingOps(root)
held('P3', JSON.stringify(resumedOnce.resumed) === JSON.stringify(['op-a', 'op-b']) && callsAfterFirst.length === 2 && resumedOnce.remaining === 0
  && JSON.stringify(calls) === JSON.stringify(['op-a', 'op-b']) && resumedAgain.attempted === 0 && queueAfter.length === 0,
  'each queued entry is attempted exactly once, and a second resume does nothing: first=' + JSON.stringify({ attempted: resumedOnce.attempted, resumed: resumedOnce.resumed, remaining: resumedOnce.remaining }) + ' calls=' + JSON.stringify(calls) + ' second=' + JSON.stringify({ attempted: resumedAgain.attempted, remaining: resumedAgain.remaining }) + ' queueLength=' + String(queueAfter.length))

// --- P4: what failed stays queued, with its error, while what succeeded is gone ------------------------
M.queuePendingOp(root, opOf('op-c', '2026-10-07T00:00:03.000Z'))
M.queuePendingOp(root, opOf('op-d', '2026-10-07T00:00:04.000Z'))
const partial = M.resumePendingOps(root, (op) => { if (op.key === 'op-d') throw new Error('the destination is locked') })
const stillQueued = M.readPendingOps(root).map((op) => op.key)
held('P4', JSON.stringify(partial.resumed) === JSON.stringify(['op-c']) && partial.remaining === 1
  && Array.isArray(partial.failed) && partial.failed.length === 1 && partial.failed[0].key === 'op-d' && String(partial.failed[0].error).length > 0
  && JSON.stringify(stillQueued) === JSON.stringify(['op-d']),
  'a failed resume keeps that entry (with its error) and drops the ones that worked: resumed=' + JSON.stringify(partial.resumed) + ' failed=' + JSON.stringify(partial.failed) + ' stillQueued=' + JSON.stringify(stillQueued))

// --- P5: a missing queue is empty, a corrupt queue is loud --------------------------------------------
const emptyRoot = join(CASE, 'empty')
mkdirSync(emptyRoot, { recursive: true })
let missingResult = null
try { missingResult = M.readPendingOps(emptyRoot) } catch (error) { missingResult = error }
const brokenRoot = join(CASE, 'broken')
mkdirSync(join(brokenRoot, M.PENDING_DIR), { recursive: true })
writeFileSync(join(brokenRoot, M.PENDING_DIR, M.PENDING_FILE), '{not json', 'utf8')
let brokenResult = null
try { brokenResult = M.readPendingOps(brokenRoot) } catch (error) { brokenResult = error }
held('P5', Array.isArray(missingResult) && missingResult.length === 0 && brokenResult instanceof Error
  && readFileSync(join(brokenRoot, M.PENDING_DIR, M.PENDING_FILE), 'utf8') === '{not json',
  'no queue file means an empty queue, a corrupt one is an error and is left untouched: missing=' + JSON.stringify(Array.isArray(missingResult) ? missingResult : String(missingResult)) + ' brokenName=' + String(brokenResult?.name) + ' brokenUntouched=' + String(readFileSync(join(brokenRoot, M.PENDING_DIR, M.PENDING_FILE), 'utf8') === '{not json'))

// --- P6: only a lock counts as a lock -----------------------------------------------------------------
const locked = M.isLockFailure(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }))
const busy = M.isLockFailure(Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }))
const renumbered = M.isLockFailure(new Error('unknown error, rename EPERM (1175)'))
const full = M.isLockFailure(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))
const plain = M.isLockFailure(new Error('something else went wrong'))
held('P6', locked === true && busy === true && renumbered === true && full === false && plain === false
  && typeof M.LOCK_EXIT_CODE === 'number' && M.LOCK_EXIT_CODE !== 0 && M.LOCK_EXIT_CODE !== 1,
  'a lock is a lock and a real failure is not: EPERM=' + String(locked) + ' EBUSY=' + String(busy) + ' (1175)=' + String(renumbered) + ' ENOSPC=' + String(full) + ' other=' + String(plain) + ' LOCK_EXIT_CODE=' + String(M.LOCK_EXIT_CODE))

// --- P7..P10: the first real caller (R133) - the machines stop being unused ----------------------------
// startup(root, options) is where the two previously caller-less machines meet, and the ORDER is the
// claim: the range gate runs before the queue is touched at all. A queue that nobody can apply must not be
// drained either - so a non-empty queue without an applier is an error, not a silent no-op.
const START_ROOT = join(CASE, 'startup')
const START_OPTIONS = { kernelRoot: join(PROJECT, 'core', 'deepseek-harness'), lockFile: join(PROJECT, 'kernel.lock.json') }
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 1) + '\n', 'utf8') }
const withKernelClosure = (setDir) => writeJson(join(setDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), { name: '@deepseek-ai/dsh', version: '0.2.1' })
const BAD_SET = join(START_ROOT, 'bad', 'plugins')
writeJson(join(BAD_SET, 'p-out', 'package.json'), { name: 'p-out', version: '1.0.0', requires: { dsh: '^9.0.0' } })
withKernelClosure(join(START_ROOT, 'bad'))
const GOOD_SET = join(START_ROOT, 'good', 'plugins')
writeJson(join(GOOD_SET, 'p-ok', 'package.json'), { name: 'p-ok', version: '1.0.0', requires: { dsh: '^0.2.0' } })
withKernelClosure(join(START_ROOT, 'good'))
const queueFileOf = (root) => join(root, M.PENDING_DIR, M.PENDING_FILE)
const queueTextOf = (root) => existsSync(queueFileOf(root)) ? readFileSync(queueFileOf(root), 'utf8') : null
const mkQueue = (name, keys) => {
  const root = join(START_ROOT, name)
  mkdirSync(root, { recursive: true })
  for (const key of keys) M.queuePendingOp(root, { key, kind: 'rename', at: '2026-10-07T00:00:00.000Z' })
  return root
}
const callStartup = (root, options) => { try { return { report: M.startup(root, options) } } catch (error) { return { error } } }
const emptyQueueRoot = mkQueue('empty', [])
const quiet = callStartup(emptyQueueRoot, undefined)
held('P7', quiet.error === undefined && quiet.report?.pending?.attempted === 0 && quiet.report?.pending?.remaining === 0 && queueTextOf(emptyQueueRoot) === null && quiet.report?.kernel === null,
  'nothing queued means nothing to resume, and nothing is written: report=' + JSON.stringify(quiet.report ?? String(quiet.error)) + ' queueFile=' + JSON.stringify(queueTextOf(emptyRoot)))

const heldRoot = mkQueue('held', ['k1', 'k2'])
const beforeRefusal = queueTextOf(heldRoot)
const refused = callStartup(heldRoot, undefined)
held('P8', refused.error instanceof Error && String(refused.error.message).includes('applyOp') && String(refused.error.message).includes('2')
  && queueTextOf(heldRoot) === beforeRefusal && M.readPendingOps(heldRoot).length === 2,
  'a queue nobody can apply is refused rather than drained: name=' + String(refused.error?.name) + ' message=' + JSON.stringify(String(refused.error?.message ?? '').slice(0, 120)) + ' queueUnchanged=' + String(queueTextOf(heldRoot) === beforeRefusal) + ' stillQueued=' + String(M.readPendingOps(heldRoot).length))

const workRoot = mkQueue('work', ['k1', 'k2'])
const seen = []
const firstRun = callStartup(workRoot, { applyOp: (op) => { seen.push(op.key) } })
const secondRun = callStartup(workRoot, { applyOp: (op) => { seen.push(op.key) } })
held('P9', JSON.stringify(firstRun.report?.pending?.resumed) === JSON.stringify(['k1', 'k2']) && seen.length === 2
  && firstRun.report?.pending?.remaining === 0 && secondRun.report?.pending?.attempted === 0,
  'with an applier the queue is resumed exactly once: first=' + JSON.stringify(firstRun.report?.pending ?? String(firstRun.error)) + ' seen=' + JSON.stringify(seen) + ' second=' + JSON.stringify(secondRun.report?.pending ?? String(secondRun.error)))

const orderRoot = mkQueue('order', ['k1'])
const orderBefore = queueTextOf(orderRoot)
const orderSeen = []
const orderRefused = callStartup(orderRoot, { enforceKernelRange: true, kernelRange: { pluginsDir: BAD_SET, ...START_OPTIONS }, applyOp: (op) => { orderSeen.push(op.key) } })
const orderSatisfied = callStartup(mkQueue('order-ok', ['k1']), { enforceKernelRange: true, kernelRange: { pluginsDir: GOOD_SET, ...START_OPTIONS }, applyOp: () => {} })
const orderUnconfigured = callStartup(mkQueue('order-bare', ['k1']), { enforceKernelRange: true })
held('P10', orderRefused.error?.name === 'RangeError' && String(orderRefused.error.message).includes('p-out') && orderSeen.length === 0 && queueTextOf(orderRoot) === orderBefore
  && orderSatisfied.report?.pending?.attempted === 1 && orderUnconfigured.error?.name === 'TypeError' && String(orderUnconfigured.error.message).includes('kernelRange.pluginsDir'),
  'the refusal happens BEFORE the queue is touched: refusedName=' + String(orderRefused.error?.name) + ' applierCalls=' + String(orderSeen.length) + ' queueUnchanged=' + String(queueTextOf(orderRoot) === orderBefore) + ' | satisfiedAttempted=' + String(orderSatisfied.report?.pending?.attempted) + ' | flagWithoutInputs=' + String(orderUnconfigured.error?.name))

// --- G1: the shipped artifact was read, never written -------------------------------------------------
const afterHash = existsSync(ARTIFACT) ? hashOf(ARTIFACT) : 'missing'
const statusAtEnd = statusNow()
held('G1', afterHash === sourceHash && JSON.stringify(statusAtEnd) === JSON.stringify(statusAtStart),
  'the product was read, never written: sha256=' + sourceHash.slice(0, 16) + ' unchanged=' + String(afterHash === sourceHash) + ' trackedAtStart=' + JSON.stringify(statusAtStart) + ' trackedAtEnd=' + JSON.stringify(statusAtEnd) + ' run=' + mutationNote)

if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(MUTANTS)) {
    const child = spawnSync(process.execPath, [resolve(process.env.R132_SELF ?? process.argv[1]), '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 600000,
      env: { ...process.env, R132_MUTANT: name, R132_PROJECT: PROJECT, R132_WORLD: WORLD, R132_SELF: process.env.R132_SELF ?? process.argv[1] },
    })
    const line = ((child.stdout ?? '') + (child.stderr ?? '')).split(/\r?\n/).filter((row) => row.startsWith('[')).pop()
    if (line === undefined) { bad += 1; console.log('  FAIL  ' + name + '  produced no readings'); continue }
    const after = {}
    for (const row of JSON.parse(line)) after[row.id] = row.ok
    const flipped = [...new Set([...Object.keys(base), ...Object.keys(after)])].filter((id) => base[id] !== after[id]).sort()
    for (const id of flipped) moved.add(id)
    const ok = JSON.stringify(flipped) === JSON.stringify([...DECLARED[name]].sort())
    if (!ok) bad += 1
    console.log((ok ? '  ok    ' : '  FAIL  ') + name + '  flipped=' + (flipped.join(',') || '(none)') + ' declared=' + DECLARED[name].join(','))
  }
  const GUARDS = ['P1', 'G1']
  const uncovered = Object.keys(base).filter((id) => moved.has(id) === false && GUARDS.includes(id) === false)
  console.log('coverage: ' + String(moved.size) + ' of ' + String(Object.keys(base).length) + ' moved; uncovered=' + (uncovered.join(',') || '(none)'))
  console.log('declared-set mismatches: ' + String(bad))
  process.exit(bad === 0 && uncovered.length === 0 ? 0 : 1)
}
const failed = readings.filter((row) => row.ok === false).length
if (argv.includes('--json')) console.log(JSON.stringify(readings))
else {
  for (const row of readings) console.log('  ' + (row.ok ? 'ok    ' : 'FAIL  ') + row.id + '  |  ' + row.detail)
  console.log(String(readings.length) + ' readings, ' + String(readings.length - failed) + ' held, ' + String(failed) + ' failed')
}
process.exit(failed === 0 ? 0 : 1)