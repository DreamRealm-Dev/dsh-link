#!/usr/bin/env node
/**
 * R0: the shell's whole plugin set activates, graded on a boot this gate performed itself.
 *
 * Three defects in this project shared one shape: a plugin that is composed, is not disabled,
 * and never reaches a working state. One row was replaced by a later bundle layer, so the
 * config everyone read was dead config. Another plugin printed its own failure and carried on
 * with a process that had no tools in it. None turned a gate red, because nothing compared
 * what the shell ships against what the kernel said while those plugins loaded.
 *
 * The obvious version of this gate reads `DSH_HOME/boot.log`. It is not used, and the reason
 * is a finding: that file is truncated on every shell launch and is written by whichever
 * process owns the shell, so a reader cannot establish its age. While this gate was being
 * written, the log's own browser failure came from a launch that had already ended.
 *
 * So the gate boots its own throwaway kernel through the surface probe's launcher and grades
 * only that boot. Three things must hold:
 *
 *   activation  no "did not activate" line and no "startup failed" block
 *   mounts      every plugin whose marker table declares a start line printed it
 *   failures    a declared failure line may appear ONLY if its declared recovery line also
 *               did.
 *
 * That third rule exists because of a false positive this gate produced on its first working
 * run. The browser plugin registers its tools from an optional lookup, warns when the
 * registry is not there yet, and re-registers when the registry activates later. In a real
 * boot both lines appear: the warning, then the registration. Grading the warning alone
 * reported a defect that did not exist. A failure line is evidence of a failure only when the
 * recovery line is missing.
 *
 * Exit codes: 0 clean; 1 a graded plugin was not mounted or failed without recovering;
 *             2 the inputs are missing or the boot produced no startup section.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARKERS = join(PROJECT, 'plugins', 'health-markers.json')
/** The kernel announces its URL when it is serving; nothing after that is startup. */
const STARTUP_END = /dsh web: http:\/\/|\/?token=/

if (!existsSync(MARKERS)) {
  console.error('no ' + MARKERS + ' — the marker table is what this gate grades against')
  process.exit(2)
}
const markers = JSON.parse(readFileSync(MARKERS, 'utf8'))

const startedAt = Date.now()
const probe = spawnSync('node', [
  'scripts/probe-kernel-surface.mjs',
  // A fixed scratch path let two concurrent runs of this gate (or of the suite beside it) delete the
// document the other had just written, which reads downstream as "the kernel printed nothing".
'--out', join(mkdtempSync(join(PROJECT, '.tmp', 'plugin-health-')), 'surface.json'),
  '--timeout', String(240_000),
], { cwd: PROJECT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 })

const output = (probe.stdout ?? '') + (probe.stderr ?? '')
const lines = output.split('\n').map((line) => line.replace(/^\[[^\]]*\] (kernel!? )?/, '').trim()).filter((line) => line !== '')
const end = lines.findIndex((line) => STARTUP_END.test(line))
const startup = end === -1 ? lines : lines.slice(0, end + 1)

if (startup.length === 0) {
  console.error('the probe boot produced no startup output (probe exit ' + String(probe.status) + ')')
  console.error(output.split('\n').slice(-15).join('\n'))
  process.exit(2)
}

const activationWarnings = startup.filter((line) => /did not activate/.test(line))
const startupFailures = startup.filter((line) => /startup failed|Failed plugins \(/.test(line))

const graded = markers.plugins.map((plugin) => {
  const failureHits = plugin.failed === undefined ? [] : startup.filter((line) => line.includes(plugin.failed))
  const startHits = plugin.started === undefined ? [] : startup.filter((line) => line.includes(plugin.started))
  const recovered = plugin.recovered !== undefined && startup.some((line) => line.includes(plugin.recovered))
  const announced = plugin.announces === undefined || startup.some((line) => line.includes(plugin.announces))
  // A declared failure line only counts as a failure when its recovery line is absent.
  const unrecovered = failureHits.length > 0 && !recovered
  const verdict = unrecovered ? 'FAILED'
    : plugin.started === undefined ? 'UNGRADED'
      : !announced ? 'NOT MOUNTED'
        : startHits.length > 0 ? 'mounted' : 'QUIET'
  return {
    plugin: plugin.plugin, row: plugin.row, kind: plugin.kind,
    verdict,
    recovered: failureHits.length > 0 && recovered,
    evidence: verdict === 'mounted' ? 'printed its start marker in this boot'
      : verdict === 'FAILED' ? failureHits[0]
        : verdict === 'NOT MOUNTED' ? 'the plugin never announced itself in this boot'
          : verdict === 'QUIET' ? 'announced itself but printed no start marker'
            : 'no marker declared; the kernel cannot grade it',
    note: plugin.note ?? null,
  }
})

const failed = graded.filter((row) => row.verdict === 'FAILED')
const notMounted = graded.filter((row) => row.verdict === 'NOT MOUNTED')
const recovered = graded.filter((row) => row.recovered === true)
const bad = activationWarnings.length > 0 || startupFailures.length > 0 || failed.length > 0 || notMounted.length > 0

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ bootMs: Date.now() - startedAt, probeExit: probe.status, activationWarnings, startupFailures, graded }, null, 2))
} else {
  console.log('probe boot: exit ' + String(probe.status) + ', ' + startup.length + ' startup line(s), ' + Math.round((Date.now() - startedAt) / 1000) + 's')
  console.log('activation: ' + (activationWarnings.length === 0 && startupFailures.length === 0
    ? 'clean — no "did not activate" line, no startup failure block'
    : activationWarnings.length + ' warning(s), ' + startupFailures.length + ' failure block(s)'))
  for (const line of [...activationWarnings, ...startupFailures].slice(0, 6)) console.log('  ' + line)
  console.log('')
  console.log('  verdict      plugin                        evidence')
  for (const row of graded) {
    const label = (row.verdict + '            ').slice(0, 15)
    console.log('  ' + label + row.plugin.padEnd(30) + row.evidence)
  }
  if (recovered.length > 0) {
    console.log('')
    console.log('  recovered within the same boot (a warning that named a missing service, then the registration):')
    for (const row of recovered) console.log('    ' + row.plugin)
  }
  console.log('')
  console.log('  ' + graded.filter((r) => r.verdict === 'mounted').length + ' mounted, ' + notMounted.length
    + ' not mounted, ' + failed.length + ' failed, ' + graded.filter((r) => r.verdict === 'UNGRADED').length + ' ungraded')
}

process.exit(bad ? 1 : 0)
