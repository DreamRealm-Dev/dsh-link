#!/usr/bin/env node
/**
 * R1: the plugin's capability is reachable and usable inside a real kernel.
 *
 * A surface document proves a service exists. It does not prove that calling it works, that its
 * methods return what they promise, or that a plugin which only declares a capability has wired
 * it up. This project has paid for that distinction more than once: a plugin that mounted and
 * printed nothing, a registration that was silently replaced, a capability whose recorder was
 * written but never started.
 *
 * So this gate boots a throwaway kernel with this repository's profile — the same composition
 * the shell runs — asks the surface probe to exercise the capability the way a caller would,
 * and grades the report:
 *
 *   open        a log opens at a directory the caller names
 *   append      it returns a sequence, and the reader agrees with it
 *   read back   replay and a cursor page both see the record that was just written
 *   the data channel   accepts an entry, counts it, and hands it back
 *   the recorder       the built-in team recorder is present and initialized
 *   close       closing leaves no lock and no open handle
 *
 * It is a kernel-level gate: it starts a kernel of its own and takes roughly twenty seconds.
 *
 * Exit codes: 0 every step held; 1 a step failed; 2 the probe produced no report.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SERVICE = process.env.DSH_LINK_EXERCISE_SERVICE ?? 'linkCollab'
// gate delete each other's document, which reads downstream as "the kernel produced nothing".
const ROOT = mkdtempSync(join(PROJECT, '.tmp', 'capability-live-'))
const SURFACE = join(ROOT, 'surface.json')
const LOG_DIR = join(ROOT, 'log')

const boot = spawnSync('node', [
  'scripts/probe-kernel-surface.mjs',
  '--out', SURFACE,
  '--timeout', '240000',
], {
  cwd: PROJECT,
  encoding: 'utf8',
  env: {
    ...process.env,
    NO_COLOR: '1',
    DSH_LINK_PROBE_EXERCISE: SERVICE,
    DSH_LINK_PROBE_EXERCISE_OUT: LOG_DIR,
  },
  maxBuffer: 64 * 1024 * 1024,
})

if (!existsSync(SURFACE)) {
  console.error('the probe boot produced no surface document (probe exit ' + String(boot.status) + ')')
  console.error(((boot.stdout ?? '') + (boot.stderr ?? '')).split('\n').slice(-15).join('\n'))
  process.exit(2)
}

const document = JSON.parse(readFileSync(SURFACE, 'utf8'))
const report = document.exercise
if (report === null || report === undefined) {
  console.error('the probe produced no exercise report for ' + SERVICE)
  process.exit(2)
}

const steps = report.steps ?? []
const has = (prefix) => steps.some((step) => String(step).startsWith(prefix))
const record = (name, ok, detail) => {
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + name + ' — ' + detail)
  return ok
}

const results = [
  record('the capability opens a log', report.ok === true && report.error === null,
    report.error === null ? 'opened and closed without an error' : String(report.error)),
  record('append returns a sequence the reader agrees with',
    has('append -> 1') && steps.some((step) => String(step).startsWith('lastSeq 1')),
    steps.filter((step) => String(step).startsWith('append') || String(step).startsWith('lastSeq')).join(' | ')),
  record('the record is readable back through both reads',
    steps.some((step) => String(step) === 'replay 1 page(0,1) 1'),
    steps.find((step) => String(step).startsWith('replay')) ?? '(no read-back step)'),
  record('the data channel accepts, counts and returns an entry',
    steps.some((step) => String(step) === 'dataSize 1 taken 1'),
    steps.find((step) => String(step).startsWith('dataSize')) ?? '(no data step)'),
  record('the built-in recorder is present and initialized',
    steps.some((step) => String(step).includes('recorder counts') && String(step).includes('"recorded"')),
    steps.find((step) => String(step).includes('recorder counts')) ?? '(no recorder step)'),
  record('the capability exposes the fold as well as the log',
    steps.some((step) => String(step).includes('state fold:') && String(step).includes('"tasks"')),
    steps.find((step) => String(step).startsWith('state fold:')) ?? '(no fold step)'),
  record('closing leaves no lock behind',
    steps.includes('closed cleanly') && !existsSync(join(LOG_DIR, '.writer')),
    steps.includes('closed cleanly') ? 'closed cleanly and the writer lock is gone' : '(no close step)'),
]

// The exercise log is a throwaway; leaving it would make the next run read someone's tail.
rmSync(LOG_DIR, { recursive: true, force: true })

const failed = results.filter((ok) => !ok).length
console.log('')
console.log(SERVICE + ' exercised in a real kernel: ' + (results.length - failed) + ' of ' + results.length + ' steps held')
process.exit(failed > 0 ? 1 : 0)
