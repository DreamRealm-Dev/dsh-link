#!/usr/bin/env node
/**
 * R134 gate #93: the lock queue finally has a user - a CLI whose EXIT CODE is the reading.
 *
 * EAC S2 says a lock ends the command with a DEDICATED code and the work waits for the next lock-free
 * window. Gate #92 measured the machinery; this gate runs the real process and reads its real exit code,
 * because "a driver can come back later" is only true if the process says so. The lock itself is induced
 * the way Windows actually behaves (measured by the producer): a read-only DESTINATION makes rename fail
 * with EPERM - a read-only SOURCE does not, which is the counterexample my first brief had wrong.
 *
 * AUTHOR DEBT: producer is compatbuilder; the gate is the Lead's (recorded in the round record). Mutants
 * patch a PRIVATE COPY of the whole plugin directory, so the shipped CLI and artifact are never written.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(process.env.R134_PROJECT ?? join(HERE, '..'))
const PLUGIN = join(PROJECT, 'plugins', 'dsh-link-upgrade')
const CLI = join(PLUGIN, 'bin', 'resume.mjs')
const LIB = join(PLUGIN, 'lib', 'index.js')
const WORLD = resolve(process.env.R134_WORLD ?? join(PROJECT, '.tmp', 'r134-gate'))
const MUTANT = process.env.R134_MUTANT ?? ''
const argv = process.argv.slice(2)

if (!existsSync(CLI) || !existsSync(LIB)) {
  console.error('SKIP: the resume CLI is not built at ' + CLI + ' (needs plugins/dsh-link-upgrade/{bin,lib})')
  process.exit(3)
}

const MUTANTS = {
  'cli-usage-exit-is-zero': [{ from: 'const USAGE_EXIT = 2', to: 'const USAGE_EXIT = 0' }],
  'cli-final-exit-always-zero': [{ from: '  const exit = lock ? LOCK_EXIT_CODE : failed.length > 0 ? 1 : 0', to: '  const exit = 0' }],
  'cli-final-exit-always-locked': [{ from: '  const exit = lock ? LOCK_EXIT_CODE : failed.length > 0 ? 1 : 0', to: '  const exit = LOCK_EXIT_CODE' }],
  // R6 leaves through the other door (startup refuses BEFORE any resume, so its exit is decided in the
  // refusal branch), which the two final-exit mutants cannot reach - measured, and that is why this mutant
  // exists: a reading with no mutant is a reading nobody is keeping honest.
  'cli-refusal-exit-always-zero': [{ from: '    const exit = lock ? LOCK_EXIT_CODE : 1', to: '    const exit = 0' }],
  'cli-report-drops-the-lock-flag': [{ from: '    lock: locked.has(row.key) || isLockFailure(row.error),', to: '    lock: false,' }],
  'cli-report-drops-resumed': [{ from: 'resumed: report.pending.resumed', to: 'resumed: []' }],
}
const DECLARED = {
  'cli-usage-exit-is-zero': ['R1'],
  // Corrected by measurement: the corrupt-queue reading exits through the REFUSAL branch, so this mutant
  // does not reach it.
  'cli-final-exit-always-zero': ['R3', 'R5'],
  'cli-final-exit-always-locked': ['R2', 'R4', 'R5'],
  'cli-report-drops-the-lock-flag': ['R3'],
  'cli-report-drops-resumed': ['R4'],
  'cli-refusal-exit-always-zero': ['R6'],
}

const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const statusNow = () => { const out = spawnSync('git', ['status', '--short', '--', 'plugins'], { cwd: PROJECT, encoding: 'utf8' }); return String(out.stdout ?? '').trim() === '' ? [] : String(out.stdout).trim().split(/\r?\n/).map((line) => line.trim()).sort() }
const cliHashBefore = hashOf(CLI)
const libHashBefore = hashOf(LIB)
const statusAtStart = statusNow()

let cli = CLI
let mutationNote = 'baseline: the shipped CLI itself'
if (MUTANT !== '') {
  const patch = MUTANTS[MUTANT]
  if (patch === undefined) { console.error('resume-cli: unknown mutant ' + MUTANT); process.exit(2) }
  const copy = join(WORLD, 'mutant-' + MUTANT, 'dsh-link-upgrade')
  rmSync(dirname(copy), { recursive: true, force: true })
  mkdirSync(dirname(copy), { recursive: true })
  cpSync(PLUGIN, copy, { recursive: true })
  const copyCli = join(copy, 'bin', 'resume.mjs')
  let text = readFileSync(copyCli, 'utf8')
  for (const step of patch) {
    const next = text.replace(step.from, step.to)
    if (next === text) { console.error('resume-cli: mutant ' + MUTANT + ' changed nothing; anchor missing: ' + step.from.slice(0, 80)); process.exit(2) }
    text = next
  }
  writeFileSync(copyCli, text, 'utf8')
  cli = copyCli
  mutationNote = 'mutant ' + MUTANT + ' patched a private copy at ' + copyCli
}

const readings = []
const held = (id, ok, detail) => readings.push({ id, ok: ok === true, detail: String(detail) })
const run = (args, cwd) => { const out = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60000 }); return { code: out.status, stdout: String(out.stdout ?? ''), stderr: String(out.stderr ?? '') } }
const parseReport = (stdout) => { try { return JSON.parse(stdout.trim()) } catch { return null } }
const CASE = join(WORLD, MUTANT === '' ? 'case' : 'case-' + MUTANT)
rmSync(CASE, { recursive: true, force: true })
// The CLI is spawned with CASE as its working directory, so the directory has to exist BEFORE the first
// spawn: a missing cwd makes spawnSync fail with ENOENT and hands back a null status with empty streams,
// which reads like a gate bug on the product's side (measured in R134, on the first version of this file).
mkdirSync(CASE, { recursive: true })
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 1) + '\n', 'utf8') }
const queueOf = (name, ops) => {
  const root = join(CASE, name)
  mkdirSync(join(root, '.ops'), { recursive: true })
  writeJson(join(root, '.ops', 'pending.json'), ops)
  return root
}
const attrib = (file, flag) => spawnSync('cmd', ['/c', 'attrib', flag, file.replaceAll('/', '\\')], { encoding: 'utf8' })

// --- R1: a usage error is not a completion status ------------------------------------------------------
const usage = run(['--root'], CASE)
held('R1', usage.code === 2 && usage.stdout.trim() === '' && usage.stderr.trim() !== '',
  'a wrong command line exits 2 with nothing on stdout: code=' + String(usage.code) + ' stdout=' + JSON.stringify(usage.stdout.slice(0, 60)) + ' stderr=' + JSON.stringify(usage.stderr.slice(0, 80)))

// --- R2: nothing queued is quiet success --------------------------------------------------------------
const emptyRoot = queueOf('empty-root', [])
const emptyRun = run(['--root', emptyRoot], CASE)
const emptyReport = parseReport(emptyRun.stdout)
held('R2', emptyRun.code === 0 && emptyReport !== null && emptyReport.attempted === 0 && emptyReport.remaining === 0 && emptyReport.exit === 0
  && JSON.stringify(Object.keys(emptyReport).sort()) === JSON.stringify(['attempted', 'exit', 'failed', 'remaining', 'resumed'])
  && emptyRun.stdout.trim().split('\n').length === 1,
  'an empty queue exits 0 with one JSON line: code=' + String(emptyRun.code) + ' report=' + JSON.stringify(emptyReport))

// --- R3: a real lock exits with the DEDICATED code and keeps the work ---------------------------------
const lockRoot = join(CASE, 'locked')
const lockFrom = join(lockRoot, 'a.txt')
const lockTo = join(lockRoot, 'b.txt')
mkdirSync(lockRoot, { recursive: true })
writeFileSync(lockFrom, 'payload-a', 'utf8')
writeFileSync(lockTo, 'old-b', 'utf8')
queueOf('locked', [{ key: 'k-lock', kind: 'rename', at: '2026-10-07T00:00:00.000Z', from: lockFrom, to: lockTo }])
attrib(lockTo, '+R')
const lockedRun = run(['--root', join(CASE, 'locked')], CASE)
const lockedReport = parseReport(lockedRun.stdout)
held('R3', lockedRun.code === 75 && lockedReport?.failed?.length === 1 && lockedReport.failed[0].lock === true
  && lockedReport.remaining === 1 && readFileSync(lockFrom, 'utf8') === 'payload-a' && readFileSync(lockTo, 'utf8') === 'old-b'
  && JSON.parse(readFileSync(join(CASE, 'locked', '.ops', 'pending.json'), 'utf8')).length === 1,
  'a locked rename ends the process with the dedicated code and nothing moves: code=' + String(lockedRun.code) + ' report=' + JSON.stringify(lockedReport))
attrib(lockTo, '-R')

// --- R4: the next lock-free window finishes exactly that work ----------------------------------------
const resumedRun = run(['--root', join(CASE, 'locked')], CASE)
const resumedReport = parseReport(resumedRun.stdout)
const secondRun = run(['--root', join(CASE, 'locked')], CASE)
const secondReport = parseReport(secondRun.stdout)
held('R4', resumedRun.code === 0 && JSON.stringify(resumedReport?.resumed) === JSON.stringify(['k-lock'])
  && existsSync(lockFrom) === false && readFileSync(lockTo, 'utf8') === 'payload-a'
  && JSON.parse(readFileSync(join(CASE, 'locked', '.ops', 'pending.json'), 'utf8')).length === 0
  && secondRun.code === 0 && secondReport?.attempted === 0,
  'the lock-free window resumes it once and really moves the file: code=' + String(resumedRun.code) + ' report=' + JSON.stringify(resumedReport) + ' fromGone=' + String(existsSync(lockFrom) === false) + ' target=' + JSON.stringify(readFileSync(lockTo, 'utf8')) + ' secondRun=' + JSON.stringify(secondReport))

// --- R5: a failure that is NOT a lock must not get the lock code --------------------------------------
const goneRoot = queueOf('gone', [{ key: 'k-gone', kind: 'rename', at: '2026-10-07T00:00:00.000Z', from: join(CASE, 'gone', 'missing.txt'), to: join(CASE, 'gone', 'out.txt') }])
const goneRun = run(['--root', goneRoot], CASE)
const goneReport = parseReport(goneRun.stdout)
held('R5', goneRun.code === 1 && goneRun.code !== 75 && goneReport?.failed?.length === 1 && goneReport.failed[0].lock === false
  && JSON.parse(readFileSync(join(goneRoot, '.ops', 'pending.json'), 'utf8')).length === 1,
  'a real failure is not dressed up as a lock: code=' + String(goneRun.code) + ' report=' + JSON.stringify(goneReport))

// --- R6: a corrupt queue is loud, not an empty queue ---------------------------------------------------
const brokenRoot = join(CASE, 'broken')
mkdirSync(join(brokenRoot, '.ops'), { recursive: true })
writeFileSync(join(brokenRoot, '.ops', 'pending.json'), '{not json', 'utf8')
const brokenRun = run(['--root', brokenRoot], CASE)
held('R6', brokenRun.code === 1 && readFileSync(join(brokenRoot, '.ops', 'pending.json'), 'utf8') === '{not json',
  'a corrupt queue fails as a failure (not as a lock, not as empty): code=' + String(brokenRun.code) + ' untouched=' + String(readFileSync(join(brokenRoot, '.ops', 'pending.json'), 'utf8') === '{not json'))

// --- G1: neither the CLI nor the artifact was written by this run -------------------------------------
held('G1', hashOf(CLI) === cliHashBefore && hashOf(LIB) === libHashBefore && JSON.stringify(statusNow()) === JSON.stringify(statusAtStart),
  'the product was read, never written: cliUnchanged=' + String(hashOf(CLI) === cliHashBefore) + ' libUnchanged=' + String(hashOf(LIB) === libHashBefore) + ' trackedBefore=' + JSON.stringify(statusAtStart) + ' trackedAfter=' + JSON.stringify(statusNow()) + ' run=' + mutationNote)

if (argv.includes('--self-attack')) {
  const base = {}
  for (const row of readings) base[row.id] = row.ok
  let bad = 0
  const moved = new Set()
  for (const name of Object.keys(MUTANTS)) {
    const child = spawnSync(process.execPath, [resolve(process.env.R134_SELF ?? process.argv[1]), '--json'], {
      cwd: PROJECT, encoding: 'utf8', timeout: 600000,
      env: { ...process.env, R134_MUTANT: name, R134_PROJECT: PROJECT, R134_WORLD: WORLD, R134_SELF: process.env.R134_SELF ?? process.argv[1] },
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
  const GUARDS = ['G1']
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