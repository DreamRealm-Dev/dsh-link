#!/usr/bin/env node
// R73 alive-control: present - a second row ('link-surface-alive-control', written into the throwaway home) reads the ROOT-provided service dshHomePath from inside the booted tree at mount and records a verdict in the run's output, so 'the surface row never ran' is distinguishable from 'the whole composition was never up'.
/**
 * Kernel surface probe runner.
 *
 * Boots the DSH kernel against a throwaway profile seeded from this install's own
 * kernel home — the same profile, the same overlay, the same plugin set — and mounts
 * one extra row: the surface probe. The kernel then writes a JSON document describing
 * every declared context property, its reachable value, and every live event name to
 * the path named by the command line.
 *
 * The profile is throwaway on purpose: the probe row must never land in the profile a
 * user launches. Nothing outside the throwaway home and the output file is written,
 * and the kernel is stopped on the way out.
 *
 * Usage:
 *   node scripts/probe-kernel-surface.mjs [--out <file>] [--profile web] [--timeout 300000] [--keep-alive]
 *
 * Exit codes: 0 document written; 1 boot failed, timed out, or the probe never wrote.
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The pinned kernel this project runs; --checkout points the probe at another one. */
const DEFAULT_CHECKOUT = join(PROJECT, 'core', 'deepseek-harness')
/** The CLI entry inside a checkout; --entry selects another one (a built lib/ entry, for example). */
const DEFAULT_ENTRY = 'apps/cli/src/bin.ts'
const PROBE_DIR = join(PROJECT, '.tmp', 'r1-probe')

/**
 * Kernel home this install launches with, unless --home names another one.
 *
 * The probe profile is seeded from it; --home none skips seeding entirely, which is
 * what a probe of a checkout this machine does not run under needs: no path from the
 * throwaway home back into a real install's documents.
 */
const DEFAULT_HOME = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'dev.dshlink.client', 'dsh-link', 'kernel-home')

/**
 * Home entries the throwaway profile links back to instead of copying.
 *
 * Only entries the kernel reads rather than writes belong here. Session and storage state
 * is deliberately absent: a probe boot runs under danger-full-access by design, so linking
 * that state would let a probe write into the very files a user's own sessions live in.
 * Those entries are created fresh and empty instead — see ISOLATED.
 */
const LINKED = ['profiles', 'cache', '.agent-presets']

/** Entries the probe owns outright: created empty, discarded with the throwaway home. */
const ISOLATED = ['sessions', 'storages', 'attachments', 'logs', 'lan-bridge']

const stamp = () => new Date().toISOString().slice(11, 19)
const log = (line) => console.log(`[${stamp()}] ${line}`)

/** Read one `--name value` option. */
function option(argv, name, fallback) {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}

const argv = process.argv.slice(2)
const profile = option(argv, '--profile', 'web')
const timeoutMs = Number(option(argv, '--timeout', '300000'))
const keepAlive = argv.includes('--keep-alive')
const outPath = resolve(option(argv, '--out', join(PROJECT, '.tmp', 'r1-surface', `${profile}.json`)))
const CHECKOUT = resolve(option(argv, '--checkout', DEFAULT_CHECKOUT))
const ENTRY = option(argv, '--entry', DEFAULT_ENTRY)
const homeOption = option(argv, '--home', DEFAULT_HOME)
/** null means: seed nothing, start from an empty throwaway home. */
const SOURCE_HOME = homeOption === 'none' ? null : resolve(homeOption)

if (!existsSync(join(CHECKOUT, ENTRY))) {
  console.error(`no kernel entry at ${join(CHECKOUT, ENTRY)} (pass --entry)`)
  process.exit(1)
}

/**
 * Kernel identity as the compat table is keyed by it: the version in the checkout's
 * own manifest, and the commit it is at. Both are handed to the probe so the surface
 * document says which kernel it describes; neither is guessed.
 */
const manifest = JSON.parse(readFileSync(join(CHECKOUT, 'package.json'), 'utf8'))
const kernelId = typeof manifest.version === 'string' ? `dsh-v${manifest.version}` : null
const kernelCommit = (() => {
  try {
    return spawnSync('git', ['-C', CHECKOUT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null
  } catch {
    return null
  }
})()
if (!existsSync(PROBE_DIR)) {
  console.error(`no probe package at ${PROBE_DIR}`)
  process.exit(1)
}

mkdirSync(dirname(outPath), { recursive: true })
// The wait below is "the document exists", so a document from an earlier run must
// not be mistaken for this run's answer.
rmSync(outPath, { force: true })

// Seed the throwaway home: linked bulk, copied documents. A missing source entry is
// reported rather than silently skipped — the probe profile must match the real one.
const home = mkdtempSync(join(tmpdir(), 'dsh-link-probe-'))
const seed = []
function link(entry) {
  if (SOURCE_HOME === null) return
  const source = join(SOURCE_HOME, entry)
  if (!existsSync(source)) { seed.push(`${entry}: absent in source home`); return }
  try {
    symlinkSync(source, join(home, entry), 'junction')
    seed.push(`${entry}: linked`)
  } catch (error) {
    seed.push(`${entry}: link failed (${error.message})`)
  }
}
function copy(entry) {
  if (SOURCE_HOME === null) return
  const source = join(SOURCE_HOME, entry)
  if (!existsSync(source)) { seed.push(`${entry}: absent in source home`); return }
  copyFileSync(source, join(home, entry))
  seed.push(`${entry}: copied`)
}
for (const entry of LINKED) link(entry)
for (const entry of ISOLATED) {
  mkdirSync(join(home, entry), { recursive: true })
  seed.push(`${entry}: fresh empty (probe isolation)`)
}
for (const entry of ['.credentials.yaml', 'settings.yaml', 'dsh-link.patch.yml', 'dsh-link.runtime.patch.yml']) copy(entry)

const probeUrl = new URL('file:///' + PROBE_DIR.replaceAll('\\', '/') + '/index.mjs').href
// R73: the alive control is a second row of our own, generated here, whose only job is to answer
// "was the tree this probe read still up". It reads a service only the kernel's boot provides, at the
// instant it mounts and again on its own disposal, and writes what it saw to a file the runner owns.
const aliveMarker = join(home, 'alive-control.jsonl')
const aliveModule = join(home, 'alive-control.mjs')
writeFileSync(aliveModule, [
  "import { appendFileSync } from 'node:fs'",
  "const note = (event, extra) => { try { appendFileSync(process.env.DSH_LINK_SURFACE_ALIVE, JSON.stringify({ event, at: Date.now(), ...extra }) + String.fromCharCode(10)) } catch { /* best effort */ } }",
  "const aliveVerdict = (ctx) => { try { return { rootAlive: ctx.reflect.get('dshHomePath', false) !== undefined, profileContext: ctx.reflect.get('profileContext', false) !== undefined } } catch (error) { return { rootAlive: false, profileContext: false, threw: String(error?.message ?? error) } } }",
  "export const name = 'link-surface-alive-control'",
  'export function apply(ctx) {',
  "  const settled = aliveVerdict(ctx)",
  "  note('root-control-settled', { ...settled, verdict: settled.rootAlive ? 'alive' : 'gone' })",
  "  if (ctx.effect !== undefined) ctx.effect(() => () => { const disposed = aliveVerdict(ctx); note('root-control-disposed', { ...disposed, verdict: disposed.rootAlive ? 'alive' : 'gone' }) })",
  '}',
].join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8')
const aliveUrl = new URL('file:///' + aliveModule.replaceAll('\\', '/')).href
const relayToken = process.env.DSH_LINK_PROBE_RELAY_TOKEN ?? ''
const relayPath = process.env.DSH_LINK_PROBE_RELAY_PATH ?? '/api/dsh-link-collab/relay'
const overlay = join(home, 'probe.overlay.yml')
writeFileSync(overlay, [
  '# Generated by scripts/probe-kernel-surface.mjs — the surface probe, and nothing else.',
  '#',
  '# The web profile binds 3080 by default and this machine already runs an official',
  '# DSH client there, so the probe profile asks the OS for a free port instead. The',
  '# probe reads its answer from a file, so the assigned port never has to be known.',
  '# A row patch replaces the row config wholesale, so all five fields are restated.',
  '- id: webserver',
  '  config:',
  "    host: '127.0.0.1'",
  '    port: 0',
  "    compression: 'none'",
  '    compressionLevel: 1',
  '    compressionThresholdBytes: 1024',
  // The relay row exists only when a caller asks for it: the endpoint is a write surface, so no
  // default composition carries one, and a gate that needs it says so explicitly.
  ...(relayToken === '' ? [] : [
    '- id: link-collab',
    '  config:',
    '    relay:',
    '      token: ' + JSON.stringify(relayToken),
    '      path: ' + JSON.stringify(relayPath),
  ]),
  '- insert:',
  '    - id: link-surface-probe',
  '      name: ' + JSON.stringify(probeUrl),
  '    - id: link-surface-alive-control',
  '      name: ' + JSON.stringify(aliveUrl),
  '',
].join('\n'), 'utf8')

log(`kernel=${kernelId ?? 'unknown'} commit=${kernelCommit ?? 'unknown'} checkout=${CHECKOUT}`)
log(`entry=${ENTRY} profile=${profile} home=${home}`)
log(`seed source=${SOURCE_HOME ?? '(none: empty throwaway home)'}`)
for (const line of seed) log(`  seed ${line}`)
log(`overlay row: ${probeUrl}`)
if (relayToken !== '') log(`overlay relay row: ${relayPath}`)

// A .ts entry runs through tsx; a built .js entry runs on plain Node.
const launcher = ENTRY.endsWith('.ts') ? ['--import', 'tsx/esm'] : []
const child = spawn('node', [
  ...launcher, ENTRY,
  '--profile', profile,
  '--patch', overlay,
  '--no-open',
], {
  cwd: CHECKOUT,
  env: {
    ...process.env,
    DSH_HOME: home,
    DSH_LINK_SURFACE_OUT: outPath,
    DSH_LINK_SURFACE_ALIVE: aliveMarker,
    DSH_LINK_PROFILE: profile,
    DSH_LINK_KERNEL_COMMIT: kernelCommit ?? '',
    DSH_LINK_KERNEL_VERSION: kernelId ?? '',
    DSH_PERMISSION_MODE: 'danger-full-access',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
// A gate that has to act while the kernel runs needs the kernel's output while the kernel runs:
// waiting for the process to exit means the port it prints arrives too late to use. The note file
// is that window, and it is only opened when a caller asks for it.
const notePath = process.env.DSH_LINK_PROBE_NOTE
const note = (line) => {
  if (notePath === undefined || notePath === '') return
  try { appendFileSync(notePath, line + '\n') } catch { /* a note that cannot be written is not fatal */ }
}
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
  for (const line of chunk.split('\n')) if (line.trim() !== '') {
    note(line)
    log(`kernel ${line}`)
  }
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  stderr += chunk
  for (const line of chunk.split('\n')) if (line.trim() !== '') {
    note(line)
    log(`kernel! ${line}`)
  }
})

/** Stop the kernel and everything it started. */
function stop() {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

const deadline = Date.now() + timeoutMs
let outcome = 1
let reason = 'the wait ended without a reason'
for (;;) {
  // The document is checked first: a run whose file lands in the same tick as the process ending is
  // a completed run, and reporting it as "the kernel exited" would be a fact about the check order.
  if (existsSync(outPath)) { outcome = 0; reason = 'the probe wrote the document'; break }
  if (child.exitCode !== null) { reason = 'the kernel exited with code ' + String(child.exitCode); break }
  const failed = (stdout + stderr).split('\n').find((line) => /boot failed|failed to start|StartupFailure/i.test(line))
  if (failed !== undefined) { reason = 'a startup-failure line matched: ' + failed.trim(); break }
  if (Date.now() > deadline) { reason = 'the wait timed out after ' + String(timeoutMs) + 'ms'; break }
  await new Promise((wake) => setTimeout(wake, 250))
}
log('wait ended: ' + reason)

if (outcome === 0) {
  const document = JSON.parse(readFileSync(outPath, 'utf8'))
  log(`document: ${outPath}`)
  log(`kernel ${document.kernel.id ?? '(unnamed)'} @ ${document.kernel.commit ?? '(no commit)'}`)
  log('counts ' + JSON.stringify(document.counts))
  // The two fields that were empty until this run: a document that still reports
  // them empty cannot key a table, so say so here rather than downstream.
  if (document.counts.events === 0 || document.counts.tools === null) {
    log('incomplete: events=0 and/or tools=null; the probe did not observe that surface')
  }
} else {
  log('the probe wrote nothing; kernel output follows — ' + reason)
  log('--- stdout tail ---')
  console.log(stdout.split('\n').slice(-25).join('\n'))
  log('--- stderr tail ---')
  console.log(stderr.split('\n').slice(-25).join('\n'))
}

// R73: the aliveness verdict, read before the throwaway home is removed. A run that cannot show a root
// service resolving says nothing about the composition it claims to describe, so a missing or negative
// settled reading is a failure rather than a footnote ('my row never ran' must not read like 'the tree was
// never up' and vice versa).
const aliveEvents = existsSync(aliveMarker)
  ? readFileSync(aliveMarker, 'utf8').split('\n').filter((line) => line !== '').map((line) => { try { return JSON.parse(line) } catch { return null } }).filter((event) => event !== null)
  : []
const settledEvent = aliveEvents.find((event) => event.event === 'root-control-settled') ?? null
const disposedEvent = aliveEvents.find((event) => event.event === 'root-control-disposed') ?? null
const aliveControl = {
  settled: settledEvent === null ? 'missing' : settledEvent.verdict,
  rootAlive: settledEvent === null ? null : settledEvent.rootAlive,
  disposed: disposedEvent === null ? 'not observed (the kernel is stopped by force)' : disposedEvent.verdict,
  events: aliveEvents.length,
}
log('alive-control ' + JSON.stringify(aliveControl))
if (aliveControl.settled !== 'alive') {
  outcome = 1
  reason = 'the alive-control row did not read a root-provided service at mount (settled=' + String(aliveControl.settled) + '), so this run cannot say the composition it read was up'
  log('alive-control guard: ' + reason)
}

if (keepAlive) {
  log(`--keep-alive: kernel pid ${child.pid} left running; press Ctrl+C to stop it`)
  process.on('SIGINT', () => { stop(); process.exit(outcome) })
} else {
  stop()
  rmSync(home, { recursive: true, force: true })
  log('throwaway home removed')
}
process.exit(outcome)
