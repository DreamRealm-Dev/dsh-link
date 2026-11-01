#!/usr/bin/env node
/**
 * R197 gate 133 compat-mounted-live (LIVE READ) — docs/handoff/R197-contract.md section 2 P4.
 *
 * THE QUESTION THIS GATE ASKS THE USER RUNNING CLIENT, WITHOUT TOUCHING IT:
 *   (a) does the LIVE PROFILE declare the loader at all?
 *   (b) does the LIVE COMPOSITION that profile produces actually name its row?
 *   (c) did the CUSTOMER reach the loader? — the panel own state route must answer
 *       compat.present === true with compat.via === 'link.compat' and compat.role ===
 *       'http.registerRoute'. This is the reading mounting alone cannot fake: P1 can put the row
 *       in the profile and the composition can print it while the customer still asks the
 *       capability by the wrong word and silently falls back to ctx.server.
 *   (d) the loader OWN resolved/refused report — NOT MEASURED here, BY NAME (see below). It is
 *       printed as a declared third state: never green, and never inferred from a silence.
 *
 * R73 alive-control: present - this gate LAUNCHES the profile (CLI `--profile web --dump-config` in a child) and
 * holds no ctx of its own, so its witness is the child's announcement plus its exit code: `aliveVerdict` below is
 * that pair, recorded as a value the reading can be checked against, and reading (b) attributes the dump to the live
 * profile directory. (R272: the form was EXEMPT while the file spawns the CLI with `--profile`; the instrument
 * classifies that shape as a launcher, and a launcher's answer is a witness, not a waiver.)
 *
 * WHY (d) IS A DECLARED THIRD STATE AND NOT A GREEN OR A RED
 *   plugins/dsh-link-compat/lib/index.js:1009-1016 is the loader whole reporting path:
 *     const logger = ctx.logger?.("dsh-link-compat");
 *     logger?.info("kernel " + report.kernel + ": " + report.resolved.length + " capabilities
 *                   resolved, " + report.refused.length + " refused, in " + report.resolveMs + "ms");
 *     ... logger?.info("refused: " + refused + " — " + (row?.failures.join("; ") ?? ...))
 *   This composition sinks no ctx.logger to any file a gate can read (the live composition dump
 *   names no logger row at all — measured in (b), zero extra reads), so "the table resolved N and
 *   refused M" CANNOT BE TAKEN HERE. The gauntlet own mistake was reading a MISSING boot line as
 *   "not mounted"; this reading exists to stop exactly that, so it says "no instrument" out loud
 *   and this gate consults no silence — not the boot log, not a log directory.
 *   It becomes measurable the day the loader prints its report through console.log, or the
 *   composition grows a logger sink that reaches a file. Until then it is declared, not measured.
 *
 * BOTH SIDES OF (c) ARE MEASURED BELOW — AND THIS IS WHAT MUST NOT NORMALLY CHANGE
 *   MEASURED, both sides of the fix, by this file on 2026-10-17 (live, read-only, one GET each):
 *     - 06:17:16Z, before the fix reached a running client: compat = {present:true,
 *       via:'ctx.server', role:null, refused:"the loader's \"http\" capability has no callable
 *       \"register\" member for role http.registerRoute (got undefined)"} -> (c) RED, exit 1.
 *       The loader WAS mounted and reachable and refused the customer BY NAME, because the
 *       customer asked it with the wrong member word: the capability handle exposes ROLE WORDS
 *       (registerRoute, renderIndex) while register is the kernel MEMBER the table maps the role
 *       to (R197-contract.md:9, :27).
 *     - 06:18:21Z, after dsh-link-panel started calling registerRoute and the client was restarted:
 *       compat = {present:true, via:'link.compat', role:'http.registerRoute', refused:null} ->
 *       (c) GREEN, exit 0. (An intervening run at 06:17:31Z caught the restart itself and reported
 *       (c) UNAVAILABLE, exit 3 - the third state, not a verdict.)
 *   WHAT MUST NOT CHANGE: the judged shape is the contract's frozen one. This file must never be
 *   edited to accept via ctx.server, a refused string, or a null role - that is what keeps (c)
 *   falseable. `--replay` of the 06:17:14Z transcript reds on exactly that answer today, which is
 *   the proof this gate still refuses a fallback-based customer.
 *
 * IT STARTS NOTHING, STOPS NOTHING, CLICKS NOTHING
 *   * no client start/stop/restart, no CDP, no page, no DOM, no Input.*, no model round;
 *   * no POST of any kind (the notes write mouth and /__shell/panel are never touched);
 *   * exactly ONE live HTTP request: GET http://127.0.0.1:31760/api/dsh-link-panel/state;
 *   * exactly TWO local file reads: the live profile package.json (as TEXT — this gate writes no
 *     profile byte) and the loader own lib/index.js:1009-1016 (the anchor for (d));
 *   * exactly ONE subprocess beside the composition dump: a single pwsh process scan, which is the
 *     single-run lease (below);
 *   * the only thing it writes is its own transcript under dsh-link/.tmp/r197-g133/ (git-ignored).
 *
 * THE SINGLE-RUN LEASE — HELD ONLY LONG ENOUGH TO DO THE READS, AND SAID OUT LOUD
 *   The live world here is one kernel port and one user profile. This repo live gates must be the
 *   only live consumer of the world they read (verify-panel-live.mjs:50-55). This gate holds no
 *   lock file; its claim IS a process scan of node.exe against scripts/verify-all.mjs's own live
 *   register, its window is the file read + the composition dump + the one GET, and its release is
 *   the end of that window, followed by a confirming scan OUTSIDE the window. A second live
 *   consumer at claim time is a NAMED exit 3, never a reading taken over somebody shoulder. The
 *   transcript records the window in milliseconds and this gate prints it.
 *
 * --replay: THE JUDGEMENT WITHOUT THE WORLD
 *   The transcript carries the measured facts and nothing else the judge needs, and the judge is a
 *   pure function of it. --replay <file> (or bare --replay for the newest transcript in
 *   .tmp/r197-g133/) re-takes every verdict with ZERO live reads: no GET, no process scan, no
 *   kernel spawn, no profile read. Each measurement entry point refuses to run in replay mode, so
 *   "zero reads" is a structural fact, not a promise.
 *
 * Exit codes: 0 every measurable reading held (and (d) is still printed as the declared third
 *   state, never green) | 1 a reading failed | 3 a reading could not be taken BY NAME: no live
 *   kernel on the port, no readable profile, an unbuildable composition, or the lease held by
 *   another live consumer. An unavailable or skipped reading is never green.
 *
 * Usage: node scripts/verify-compat-mounted-live.mjs [--kernel-port 31760] [--node <node.exe>]
 *          [--kernel-home <dir>] [--dump <file>] [--replay [<transcript.json>]]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ------------------------------------------------------------------ the world */

const HERE = dirname(fileURLToPath(import.meta.url))
/** The project root, found by walking up: this gate runs from scripts/ or from a scratch copy. */
const PROJECT = (() => {
  const fromEnv = process.env.DSH_LINK_PROJECT
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'core', 'deepseek-harness')) && existsSync(join(at, 'plugins'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}
/** --replay with no path means "the newest transcript this gate wrote". */
const REPLAY = (() => {
  const at = argv.indexOf('--replay')
  if (at === -1) return null
  const next = argv[at + 1]
  return next === undefined || next.startsWith('--') ? '' : next
})()

const KERNEL = resolve(process.env.DSH_LINK_KERNEL ?? join(PROJECT, 'core', 'deepseek-harness'))
const KERNEL_HOME = resolve(option('--kernel-home', process.env.DSH_LINK_KERNEL_HOME ?? join(process.env.APPDATA ?? '', 'dev.dshlink.client', 'dsh-link', 'kernel-home')))
const PROFILE_DIR = join(KERNEL_HOME, 'profiles', 'web')
const PROFILE_PATH = join(PROFILE_DIR, 'package.json')
const KERNEL_CLI = join(KERNEL, 'apps', 'cli', 'src', 'bin.ts')
const PLUGIN_LIB = join(PROJECT, 'plugins', 'dsh-link-compat', 'lib', 'index.js')
const PLUGIN = 'dsh-link-compat'
const ROLE = 'http.registerRoute'
const KERNEL_PORT = Number(option('--kernel-port', process.env.DSH_LINK_KERNEL_PORT ?? '31760'))
const PANEL_STATE_PATH = '/api/dsh-link-panel/state'
const PANEL_STATE_URL = 'http://127.0.0.1:' + String(KERNEL_PORT) + PANEL_STATE_PATH
const DUMP_FILE = option('--dump', null)
const SCRATCH_DIR = join(PROJECT, '.tmp', 'r197-g133')
const SCRATCH_PREFIX = 'transcript-'
/** The frozen shape (c) must find: R197-contract.md:27, :37. Relaxing any of the four is forbidden. */
const FROZEN_COMPAT = { present: true, via: 'link.compat', role: ROLE, refused: null }
/** The only report path the loader has, read verbatim into (d) reason. */
const ANCHOR_FROM = 1009
const ANCHOR_TO = 1016
/** A dump that never mentions the live profile directory is not this profile composition. */
const ATTRIBUTION_NEEDLE = PROFILE_DIR.replace(/\\/g, '/').toLowerCase()

/* ------------------------------------------------------------------ helpers */

const show = (value) => {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}
const clip = (text, width) => {
  const value = String(text === undefined || text === null ? '' : text)
  return value.length <= width ? value : value.slice(0, width) + '…'
}
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const ms = (from) => Date.now() - from
const nowIso = () => new Date().toISOString()

/** The line-ending accounting, as three named states and never an average (R186 lesson). */
const endingsOf = (text) => {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length
  const bare = lf - crlf
  const style = crlf === 0 ? 'lf' : crlf === lf ? 'crlf' : 'mixed'
  const trailingNewline = text.endsWith('\n')
  const all = text.split('\n')
  return { crlf, lf, bare, style, trailingNewline, lines: all.length - (trailingNewline ? 1 : 0) }
}
const endingsWords = (one) =>
  'style=' + one.style + ' crlf=' + String(one.crlf) + ' lf=' + String(one.lf) + ' bare=' + String(one.bare) +
  ' lines=' + String(one.lines) + (one.trailingNewline ? ' (ends with a newline)' : ' (no final newline)')

const readTextFile = (path) => {
  try {
    const bytes = readFileSync(path)
    const stat = statSync(path)
    return { ok: true, text: bytes.toString('utf8'), bytes: bytes.length, sha256: sha256(bytes), mtime: stat.mtime.toISOString(), why: null }
  } catch (error) {
    return { ok: false, text: null, bytes: null, sha256: null, mtime: null, why: describe(error) }
  }
}

/* ------------------------------------------------------------------ the single-run lease */

/** Called at the top of every measuring entry point so "zero live reads" in replay is structural. */
const refuseInReplay = (what) => {
  if (REPLAY !== null) throw new Error('replay mode must not touch the live world, yet it asked for: ' + what)
}

/** ONE process scan: every node.exe row and this gate own ancestor chain (used by the lease). */
const PROCESS_QUERY = [
  'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { \'NODE|\' + $_.ProcessId + \'|\' + $_.ParentProcessId + \'|\' + $_.CommandLine }',
  '$ids = @()',
  '$p = Get-CimInstance Win32_Process -Filter (\'ProcessId=\' + $PID)',
  'for ($i = 0; $i -lt 12 -and $p -ne $null; $i++) { $ids += [string]$p.ProcessId; if ($p.ParentProcessId -eq 0) { break }; $p = Get-CimInstance Win32_Process -Filter (\'ProcessId=\' + [string]$p.ParentProcessId) -ErrorAction SilentlyContinue }',
  '\'ANC|\' + ($ids -join \',\')',
].join('\n')

const processScan = () => {
  refuseInReplay('a process scan')
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', PROCESS_QUERY], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (done.error !== undefined && done.error !== null) return { ok: false, why: 'pwsh could not be started: ' + describe(done.error), rows: [], ancestors: [] }
  if (String(done.stdout ?? '') === '') return { ok: false, why: 'the process scan produced nothing (exit ' + String(done.status) + '): ' + clip(String(done.stderr ?? ''), 160), rows: [], ancestors: [] }
  const rows = []
  let ancestors = []
  for (const raw of String(done.stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('NODE|')) {
      const parts = line.slice(5).split('|')
      if (parts.length >= 3) rows.push({ pid: parts[0], ppid: parts[1], command: parts.slice(2).join('|') })
      continue
    }
    if (line.startsWith('ANC|')) ancestors = line.slice(4).split(',').map((one) => one.trim()).filter((one) => one !== '')
  }
  return { ok: true, why: null, rows, ancestors }
}

/** The register own list of live gate files, out of scripts/verify-all.mjs (read-only, never edited). */
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) === false) return { files: [], parsed: 0, why: 'scripts/verify-all.mjs is not there' }
  const text = readFileSync(path, 'utf8')
  const files = new Set()
  let count = 0
  for (const row of text.matchAll(/\{\s*name:\s*'([^']+)',\s*kind:\s*'(offline|live|kernel)',\s*cmd:\s*\[([^\]]*)\]/g)) {
    count += 1
    if (row[2] !== 'live') continue
    for (const word of row[3].split(',')) {
      const clean = word.trim().replace(/^'|'$/g, '')
      if (/\.mjs$/.test(clean)) files.add(clean.split('/').pop())
    }
  }
  return { files: [...files], parsed: count, why: count === 0 ? 'the register could not be parsed, so every verify-*/probe-* process counts as a live consumer' : null }
}

const SELF_FILE = basename(fileURLToPath(import.meta.url))

/**
 * Who else is a live consumer. This gate own pid and its ancestors are not; a SECOND copy of this
 * very file is, unless it is an ancestor - "single run" has to mean one instance, not one gate
 * name. When the register cannot be parsed, every verify-... or probe-... process is a consumer.
 */
const otherConsumers = (rows, live, ancestors) => {
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors ?? [])])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '' && row.ppid !== '0') mine.add(row.ppid)
  }
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file)) || row.command.includes(SELF_FILE)
      return /(verify|probe)-[a-z0-9-]+\.mjs/.test(row.command) || row.command.includes(SELF_FILE)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 160))
}

/* ------------------------------------------------------------------ reading (a): the live profile */

const readProfile = () => {
  refuseInReplay('a live profile read')
  const file = readTextFile(PROFILE_PATH)
  if (file.ok !== true) return { path: PROFILE_PATH, read: false, why: file.why, exists: existsSync(PROFILE_PATH) }
  const text = file.text
  const endings = endingsOf(text)
  // Read as TEXT first: the raw lines are the evidence, so a row is judged by the bytes a reader
  // can see, not only by a parse. The parse is reported beside it, and the two must agree.
  const rawLines = text.split(/\r?\n/)
  const depAt = rawLines.findIndex((line) => /^\s*"dsh-link-compat"\s*:/.test(line))
  const bundleAt = rawLines.findIndex((line) => /^\s*"dsh-link-compat"\s*,?\s*$/.test(line))
  let pkg = null
  let parseWhy = null
  try {
    pkg = JSON.parse(text)
  } catch (error) {
    parseWhy = describe(error)
  }
  const dependencies = pkg !== null && typeof pkg.dependencies === 'object' && pkg.dependencies !== null ? pkg.dependencies : {}
  const bundles = pkg !== null && Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  return {
    path: PROFILE_PATH,
    read: true,
    why: null,
    bytes: file.bytes,
    sha256: file.sha256,
    mtime: file.mtime,
    endings,
    endingsWords: endingsWords(endings),
    parsed: pkg !== null,
    parseWhy,
    dependencyCount: Object.keys(dependencies).length,
    bundleCount: bundles.length,
    depValue: Object.prototype.hasOwnProperty.call(dependencies, PLUGIN) ? dependencies[PLUGIN] : null,
    inDependencies: Object.prototype.hasOwnProperty.call(dependencies, PLUGIN),
    inBundles: bundles.includes(PLUGIN),
    bundleIndex: bundles.indexOf(PLUGIN),
    depLine: depAt === -1 ? null : { n: depAt + 1, text: rawLines[depAt] },
    bundleLine: bundleAt === -1 ? null : { n: bundleAt + 1, text: rawLines[bundleAt] },
  }
}

/* ------------------------------------------------------------------ reading (b): the live composition */

const resolveNode = () => {
  const explicit = option('--node', process.env.DSH_LINK_NODE ?? '')
  if (typeof explicit === 'string' && explicit !== '') return explicit
  // NOT process.execPath blindly: under the desktop shell that is "DeepSeek Harness.exe", which
  // answers a spawn with two bytes of nothing. Only a real node binary is acceptable here.
  return /[\\/]node(\.exe)?$/i.test(process.execPath) ? process.execPath : 'node'
}

const readComposition = () => {
  refuseInReplay('the live composition dump')
  const nodeBin = resolveNode()
  const started = Date.now()
  const done = spawnSync(nodeBin, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--dump-config'], {
    cwd: KERNEL,
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, DSH_HOME: KERNEL_HOME, NO_COLOR: '1' },
  })
  // R73 launcher witness: a child that exited 0 and printed a composed tree is a profile that really ran; anything
  // else means this gate has nothing to compare against and must say so rather than read an empty dump.
  const aliveVerdict = done.status === 0 && /^- id:/m.test(String(done.stdout ?? ''))
  const facts = {
    aliveVerdict,
    command: [nodeBin, '--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--dump-config'],
    cwd: KERNEL,
    dshHome: KERNEL_HOME,
    ran: false,
    why: null,
    status: done.status,
    signal: done.signal ?? null,
    spawnError: done.error === undefined || done.error === null ? null : describe(done.error),
    ms: ms(started),
    stdoutBytes: null,
    stdoutSha256: null,
    stderrTail: clip(String(done.stderr ?? '').replace(/\s+/g, ' ').trim(), 300),
    lineCount: null,
    trailingNewline: null,
    occurrences: null,
    header: null,
    idLine: null,
    nameLine: null,
    rowLines: [],
    attribution: { needle: ATTRIBUTION_NEEDLE, mentions: 0 },
    loggerMentions: null,
  }
  const stdout = String(done.stdout ?? '')
  if (facts.spawnError !== null) {
    facts.why = 'the kernel CLI could not be spawned (' + facts.spawnError + ')'
    return facts
  }
  if (done.status !== 0) {
    facts.why = 'the composition dump exited ' + String(done.status) + ', so this composition cannot be built here'
    return facts
  }
  if (stdout.trim() === '') {
    facts.why = 'the composition dump printed nothing'
    return facts
  }
  const lines = stdout.split('\n')
  const trailingNewline = stdout.endsWith('\n')
  if (trailingNewline) lines.pop()
  const at = (pattern) => {
    for (let index = 0; index < lines.length; index += 1) if (pattern.test(lines[index])) return { n: index + 1, text: lines[index] }
    return null
  }
  const header = at(/^# == dsh-link-compat\s*$/)
  const idLine = at(/^\s*-\s*id:\s*dsh-link-compat\s*$/)
  const nameLine = at(/^\s*name:\s*['"]?dsh-link-compat['"]?\s*$/)
  const normalized = stdout.replace(/\\/g, '/').toLowerCase()
  const rowFrom = header === null ? lines.length : header.n
  return Object.assign({}, facts, {
    ran: true,
    why: null,
    stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
    stdoutSha256: sha256(stdout),
    lineCount: lines.length,
    trailingNewline,
    occurrences: (stdout.match(/dsh-link-compat/g) ?? []).length,
    header,
    idLine,
    nameLine,
    rowLines: lines.slice(rowFrom - 1, Math.min(lines.length, rowFrom + 3)).map((text, offset) => ({ n: rowFrom + offset, text })),
    attribution: { needle: ATTRIBUTION_NEEDLE, mentions: normalized.split(ATTRIBUTION_NEEDLE).length - 1 },
    loggerMentions: lines.filter((line) => /logger/i.test(line)).length,
  })
}

/* ------------------------------------------------------------------ reading (c): the customer */

/**
 * The one GET. A read-only request is idempotent, so a CONNECT failure is retried a bounded number
 * of times and every attempt is recorded: measured on this host, 127.0.0.1:31760 refuses the FIRST
 * connection after a quiet minute and answers the next one immediately, and a gate that read that
 * refusal as "the port is dead" would flip a product verdict on a socket's mood. A port that is
 * really down fails every attempt and is still a NAMED absence.
 */
const ATTEMPTS = 3
const ATTEMPT_PAUSE_MS = 400

const readCustomer = async () => {
  refuseInReplay('the one live GET')
  const facts = { url: PANEL_STATE_URL, read: false, at: null, status: null, why: null, bytes: null, sha256: null, bodyText: null, body: null, compat: null, bodyAt: null, served: null, attempts: [] }
  if (typeof fetch !== 'function') {
    facts.why = 'this node has no global fetch, so the one GET cannot be made'
    return facts
  }
  let answer = null
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const startedAt = Date.now()
    try {
      answer = await fetch(PANEL_STATE_URL, { signal: AbortSignal.timeout(15000) })
      facts.attempts.push({ attempt, at: nowIso(), ms: ms(startedAt), ok: true, status: answer.status, why: null })
      break
    } catch (error) {
      const cause = error?.cause === undefined || error?.cause === null ? null : (error.cause.code ?? error.cause.message ?? null)
      facts.attempts.push({ attempt, at: nowIso(), ms: ms(startedAt), ok: false, status: null, why: describe(error) + (cause === null ? '' : ' (' + String(cause) + ')') })
      if (attempt === ATTEMPTS) {
        facts.why = 'the kernel port ' + String(KERNEL_PORT) + ' did not answer in ' + String(ATTEMPTS) + ' attempt(s); last: ' + describe(error) + (cause === null ? '' : ' (' + String(cause) + ')')
        return facts
      }
      await new Promise((settle) => setTimeout(settle, ATTEMPT_PAUSE_MS))
    }
  }
  facts.at = nowIso()
  facts.status = answer.status
  let text = null
  try {
    text = await answer.text()
  } catch (error) {
    facts.why = 'the route answered ' + String(answer.status) + ' with a body that could not be read (' + describe(error) + ')'
    return facts
  }
  facts.read = true
  facts.bytes = Buffer.byteLength(text, 'utf8')
  facts.sha256 = sha256(text)
  facts.bodyText = clip(text, 4000)
  if (answer.status !== 200) {
    facts.why = 'the route answered HTTP ' + String(answer.status) + ' instead of 200'
    return facts
  }
  try {
    facts.body = JSON.parse(text)
  } catch (error) {
    facts.why = 'the route answered 200 with something that is not JSON (' + describe(error) + ')'
    return facts
  }
  facts.compat = facts.body !== null && typeof facts.body === 'object' && Object.prototype.hasOwnProperty.call(facts.body, 'compat') ? facts.body.compat : null
  facts.bodyAt = facts.body?.at ?? null
  facts.served = facts.body?.served ?? null
  return facts
}

/* ------------------------------------------------------------------ reading (d): the missing instrument */

const readAnchor = () => {
  refuseInReplay('the loader own report path')
  const file = readTextFile(PLUGIN_LIB)
  const facts = { path: PLUGIN_LIB, relative: 'plugins/dsh-link-compat/lib/index.js', from: ANCHOR_FROM, to: ANCHOR_TO, read: false, why: null, bytes: null, calls: [] }
  if (file.ok !== true) {
    facts.why = 'the loader own bytes could not be read (' + String(file.why) + ')'
    return facts
  }
  const lines = file.text.split(/\r?\n/)
  facts.read = true
  facts.bytes = file.bytes
  for (let n = ANCHOR_FROM; n <= Math.min(ANCHOR_TO, lines.length); n += 1) facts.calls.push({ n, text: lines[n - 1] })
  return facts
}

/* ------------------------------------------------------------------ the measured world */

/** A world this gate refuses to read is a NAMED absence in every reading, never a green. */
const nothingWasRead = (transcript, reason) => {
  transcript.notes.push('NOT MEASURED in the world: ' + reason)
  transcript.a = { path: PROFILE_PATH, read: false, why: reason, exists: existsSync(PROFILE_PATH) }
  transcript.b = { ran: false, why: reason }
  transcript.c = { url: PANEL_STATE_URL, read: false, why: reason }
  transcript.d = { relative: 'plugins/dsh-link-compat/lib/index.js', from: ANCHOR_FROM, to: ANCHOR_TO, read: false, why: reason, calls: [] }
}

const measure = async () => {
  const startedAt = nowIso()
  const started = Date.now()
  const transcript = {
    schema: 'r197-g133-transcript/1',
    gate: 'compat-mounted-live',
    contract: 'docs/handoff/R197-contract.md section 2 P4',
    startedAt,
    measuredMs: null,
    exitCode: null,
    world: {
      project: PROJECT,
      kernel: KERNEL,
      kernelHome: KERNEL_HOME,
      profileDir: PROFILE_DIR,
      profilePath: PROFILE_PATH,
      panelStateUrl: PANEL_STATE_URL,
      kernelPort: KERNEL_PORT,
      pluginLib: PLUGIN_LIB,
      plugin: PLUGIN,
      role: ROLE,
      frozenCompat: FROZEN_COMPAT,
      nodeBin: resolveNode(),
      nodeVersion: null,
    },
    boundary: {
      statement: 'starts nothing, stops nothing, clicks nothing: one GET, two file reads, one composition dump, no POST, no CDP, no model round, and no profile byte written',
      gets: 1,
      filesRead: 2,
      dumps: 1,
      posts: 0,
      cdps: 0,
      modelRounds: 0,
    },
    lease: { claimed: false, refused: null, claimedAt: null, releasedAt: null, heldMs: null, others: [], nodeProcesses: 0, ancestors: [], liveFiles: [], registerParsed: 0, parseNote: null, confirmingScan: null },
    a: null,
    b: null,
    c: null,
    d: null,
    notes: [],
  }

  // --- the single-run lease: claim, read inside the window, release, confirm outside it ----------
  const live = liveGateFiles()
  const claim = processScan()
  transcript.lease.liveFiles = live.files
  transcript.lease.registerParsed = live.parsed
  transcript.lease.parseNote = live.why
  if (claim.ok !== true) {
    transcript.lease.refused = 'the single-run lease could not be claimed: ' + String(claim.why)
    nothingWasRead(transcript, transcript.lease.refused)
    transcript.measuredMs = ms(started)
    return transcript
  }
  const others = otherConsumers(claim.rows, live, claim.ancestors)
  transcript.lease.nodeProcesses = claim.rows.length
  transcript.lease.ancestors = claim.ancestors
  transcript.lease.others = others
  if (others.length > 0) {
    transcript.lease.refused = 'another live consumer is running, and this gate must be the only reader of this world: ' + others.join(' | ')
    nothingWasRead(transcript, transcript.lease.refused)
    transcript.measuredMs = ms(started)
    return transcript
  }
  transcript.lease.claimed = true
  transcript.lease.claimedAt = nowIso()

  // --- inside the window: one file read, one dump, one GET, one more file read -------------------
  try {
    transcript.a = readProfile()
    transcript.b = readComposition()
    transcript.c = await readCustomer()
    transcript.d = readAnchor()
  } catch (error) {
    transcript.notes.push('the read-only window stopped on an unexpected error: ' + describe(error))
    if (transcript.a === null) transcript.a = { path: PROFILE_PATH, read: false, why: 'the window stopped before this reading: ' + describe(error) }
    if (transcript.b === null) transcript.b = { ran: false, why: 'the window stopped before this reading: ' + describe(error) }
    if (transcript.c === null) transcript.c = { url: PANEL_STATE_URL, read: false, why: 'the window stopped before this reading: ' + describe(error) }
    if (transcript.d === null) transcript.d = { relative: 'plugins/dsh-link-compat/lib/index.js', from: ANCHOR_FROM, to: ANCHOR_TO, read: false, why: 'the window stopped before this reading: ' + describe(error), calls: [] }
  } finally {
    transcript.lease.releasedAt = nowIso()
    transcript.lease.heldMs = ms(started)
  }

  // --- a confirming scan OUTSIDE the window: nobody started while this gate read -----------------
  const after = processScan()
  if (after.ok === true) {
    const late = otherConsumers(after.rows, live, after.ancestors)
    transcript.lease.confirmingScan = { at: nowIso(), read: true, others: late, nodeProcesses: after.rows.length }
    if (late.length > 0) transcript.notes.push('NOT MEASURED in the world: another live consumer appeared during this gate window: ' + late.join(' | '))
  } else {
    transcript.lease.confirmingScan = { at: nowIso(), read: false, others: null, why: String(after.why) }
    transcript.notes.push('note: the confirming scan outside the lease window could not be taken (' + String(after.why) + ')')
  }
  transcript.measuredMs = ms(started)
  return transcript
}

/* ------------------------------------------------------------------ the judge: a pure function */

/**
 * Four verdicts, and the fourth kind is the point: 'declared' is a third state that is never green.
 * The judge reads NOTHING but the transcript, which is what makes --replay an honest re-taking.
 */
const VERDICT = { green: 'green', red: 'red', unavailable: 'unavailable', declared: 'declared' }
const green = (id, name, detail, evidence) => ({ id, name, verdict: VERDICT.green, detail, evidence: evidence ?? [] })
const red = (id, name, detail, evidence) => ({ id, name, verdict: VERDICT.red, detail, evidence: evidence ?? [] })
const unavailable = (id, name, detail, evidence) => ({ id, name, verdict: VERDICT.unavailable, detail, evidence: evidence ?? [] })
const declared = (id, name, detail, evidence) => ({ id, name, verdict: VERDICT.declared, detail, evidence: evidence ?? [] })

/** The four frozen members and nothing else: the frozen shape is compared as a whole. */
const sameCompat = (value) =>
  value !== null && typeof value === 'object' &&
  value.present === FROZEN_COMPAT.present &&
  value.via === FROZEN_COMPAT.via &&
  value.role === FROZEN_COMPAT.role &&
  value.refused === FROZEN_COMPAT.refused &&
  Object.keys(value).length === Object.keys(FROZEN_COMPAT).length

const judge = (transcript) => {
  const a = transcript?.a ?? {}
  const b = transcript?.b ?? {}
  const c = transcript?.c ?? {}
  const d = transcript?.d ?? {}
  const readings = []

  // (a) the live profile declares it ---------------------------------------------------------------
  {
    const id = 'a'
    const name = 'the live profile declares it: dsh-link-compat is in dependencies AND in dsh.profile.bundles (read as text)'
    const evidence = []
    if (a.read !== true) {
      readings.push(unavailable(id, name, 'the live profile could not be read, so no manifest row was judged: ' + String(a.why ?? 'no reason recorded') + ' - path ' + String(a.path ?? PROFILE_PATH) + ' (exists=' + String(a.exists) + ')', evidence))
    } else {
      evidence.push('file: ' + String(a.path) + ' - ' + String(a.bytes) + ' bytes, sha256 ' + clip(String(a.sha256), 16) + ', mtime ' + String(a.mtime))
      evidence.push('line endings: ' + String(a.endingsWords))
      evidence.push('dependencies block: ' + String(a.dependencyCount) + ' entries; the row sits at ' + (a.depLine === null ? 'NO LINE' : 'line ' + String(a.depLine.n) + ' | ' + clip(a.depLine.text, 150)))
      evidence.push('dsh.profile.bundles: ' + String(a.bundleCount) + ' entries; the row sits at ' + (a.bundleLine === null ? 'NO LINE' : 'line ' + String(a.bundleLine.n) + ' | ' + clip(a.bundleLine.text, 150)))
      evidence.push('parsed reading: dependencies["' + PLUGIN + '"] = ' + show(a.depValue) + ', bundles index ' + String(a.bundleIndex) + ' of ' + String(a.bundleCount) + ' = ' + show(a.inBundles === true ? PLUGIN : null))
      const problems = []
      if (a.parsed !== true) problems.push('the file is not parseable JSON (' + String(a.parseWhy) + ')')
      if (a.inDependencies !== true) problems.push(PLUGIN + ' is NOT a dependency')
      if (a.inBundles !== true) problems.push(PLUGIN + ' is NOT a bundle')
      if (a.depLine === null) problems.push('no dependencies LINE carries "' + PLUGIN + '", whatever the parse says')
      if (a.bundleLine === null) problems.push('no bundles LINE carries "' + PLUGIN + '", whatever the parse says')
      if (problems.length > 0) readings.push(red(id, name, problems.join(' | '), evidence))
      else {
        readings.push(green(id, name,
          'the live profile declares it twice: line ' + String(a.depLine.n) + ' of the dependencies block (' + clip(String(a.depValue), 90) + ') and line ' + String(a.bundleLine.n) + ' of dsh.profile.bundles (index ' + String(a.bundleIndex) + ' of ' + String(a.bundleCount) + '); the FILE is ' + String(a.bytes) + ' bytes and its own ending accounting is ' + String(a.endingsWords),
          evidence))
      }
    }
  }

  // (b) the LIVE COMPOSITION names the row --------------------------------------------------------
  {
    const id = 'b'
    const name = 'the LIVE COMPOSITION names the row: the dump from the live DSH_HOME prints the compat section header and its name'
    const evidence = []
    if (b.ran !== true) {
      readings.push(unavailable(id, name, 'the composition could not be built or dumped here, so nothing about the live composition was judged: ' + String(b.why ?? 'no reason recorded'), evidence))
    } else {
      evidence.push('command: ' + show(b.command) + ' - cwd ' + String(b.cwd) + ', DSH_HOME ' + String(b.dshHome))
      evidence.push('exit ' + String(b.status) + ' in ' + String(b.ms) + ' ms; stdout ' + String(b.stdoutBytes) + ' bytes, sha256 ' + clip(String(b.stdoutSha256), 16) + '; stderr tail ' + (b.stderrTail === '' ? '(empty)' : String(b.stderrTail)))
      evidence.push('total line count: ' + String(b.lineCount) + (b.trailingNewline === true ? ' (ends with a newline)' : ' (no final newline)') + '; occurrences of "' + PLUGIN + '": ' + String(b.occurrences))
      for (const row of b.rowLines ?? []) evidence.push('dump line ' + String(row.n) + ': ' + row.text)
      evidence.push('attribution: the dump mentions the live profile directory ' + String(b.attribution?.mentions) + ' time(s) (' + String(b.attribution?.needle) + ')')
      const problems = []
      if (b.header === null) problems.push('the dump carries NO "# == ' + PLUGIN + '" section header, so the row was not composed')
      if (b.nameLine === null) problems.push('the dump carries no name: line for ' + PLUGIN + ' (a header without its row is not a row)')
      if (b.idLine === null) problems.push('the dump carries no "- id: ' + PLUGIN + '" line')
      if ((b.attribution?.mentions ?? 0) === 0) problems.push('the dump never mentions the live profile directory, so it is not the composition this profile produces')
      if (problems.length > 0) readings.push(red(id, name, problems.join(' | '), evidence))
      else {
        readings.push(green(id, name,
          'the dump from DSH_HOME=' + String(b.dshHome) + ' names the row ' + String(b.occurrences) + ' time(s) in ' + String(b.lineCount) + ' lines - section header at line ' + String(b.header.n) + ', id at ' + String(b.idLine.n) + ', name at ' + String(b.nameLine.n) + ' - and mentions the live profile directory ' + String(b.attribution.mentions) + ' time(s), so this is that profile own composition',
          evidence))
      }
    }
  }

  // (c) the CUSTOMER reached the loader ------------------------------------------------------------
  {
    const id = 'c'
    const name = 'the customer reached the loader: the panel state route answers compat.present === true, via === link.compat, role === ' + ROLE + ', refused === null'
    const evidence = []
    const attempts = Array.isArray(c.attempts) ? c.attempts : []
    if (attempts.length > 0) {
      evidence.push('the one GET, every attempt: ' + attempts.map((one) => '#' + String(one.attempt) + ' ' + (one.ok === true ? 'answered HTTP ' + String(one.status) : 'FAILED ' + String(one.why)) + ' (' + String(one.ms) + ' ms)').join(' | '))
    }
    if (c.read !== true) {
      readings.push(unavailable(id, name, 'no live answer to judge: ' + String(c.why ?? 'no reason recorded') + ' (GET ' + String(c.url ?? PANEL_STATE_URL) + ')', evidence))
    } else {
      evidence.push('GET ' + String(c.url) + ' -> HTTP ' + String(c.status) + ' at ' + String(c.at) + ', ' + String(c.bytes) + ' bytes, sha256 ' + clip(String(c.sha256), 16))
      if (c.bodyAt !== null && c.bodyAt !== undefined) evidence.push('the route own clock: at=' + String(c.bodyAt) + ', served=' + String(c.served) + ' (a live answer, not a cached byte)')
      evidence.push('compat as the route answered it: ' + show(c.compat))
      evidence.push('the shape the contract freezes: ' + show(FROZEN_COMPAT))
      if (c.why !== null && c.why !== undefined) {
        readings.push(red(id, name, 'the route answered, but not with a state this gate can judge: ' + String(c.why), evidence))
      } else if (c.compat === null || c.compat === undefined) {
        readings.push(red(id, name, 'the route answered 200 with NO compat member at all (' + clip(String(c.bodyText), 220) + '): the panel never reported which path registered its route', evidence))
      } else if (sameCompat(c.compat) === true) {
        readings.push(green(id, name, 'the customer reached the loader: compat = ' + show(c.compat) + ' - via is link.compat and role is ' + ROLE + ' with no refusal, which mounting alone cannot produce', evidence))
      } else {
        const why = []
        if (c.compat.present !== true) why.push('present=' + show(c.compat.present) + ' (the loader is not there)')
        if (c.compat.via !== FROZEN_COMPAT.via) why.push('via=' + show(c.compat.via) + ' instead of link.compat')
        if (c.compat.role !== FROZEN_COMPAT.role) why.push('role=' + show(c.compat.role) + ' instead of ' + ROLE)
        if (c.compat.refused !== null) why.push('refused=' + show(c.compat.refused) + ' instead of null')
        if (why.length === 0) why.push('the compat object carries keys outside the frozen shape (' + show(Object.keys(c.compat)) + ')')
        const refusalNote = typeof c.compat.refused === 'string' && c.compat.refused !== ''
          ? ' The customer DID reach the loader and was refused BY NAME, then fell back to ' + show(c.compat.via) + ': the fix (the role word registerRoute instead of the member register) has not landed, and this reading must stay RED until it does.'
          : ''
        readings.push(red(id, name, 'the customer did not reach the loader: ' + why.join(', ') + '.' + refusalNote, evidence))
      }
    }
  }

  // (d) the loader own report - DECLARED not-measured, never green ---------------------------------
  {
    const id = 'd'
    const name = 'the loader own resolved/refused report - NOT MEASURED here, by name'
    const evidence = []
    if (d.read === true) {
      for (const line of d.calls ?? []) evidence.push(String(d.relative) + ':' + String(line.n) + ' | ' + clip(line.text, 170))
    } else {
      evidence.push('the anchor could not be read: ' + String(d.why ?? 'no reason recorded'))
    }
    const sink = b.ran === true
      ? 'the live composition dump names ' + String(b.loggerMentions) + ' line(s) matching /logger/i in ' + String(b.lineCount) + ' lines, so nothing in this composition sinks ctx.logger to a file a gate can read'
      : 'the live composition dump was not available, so the sink question is unmeasured here'
    evidence.push(sink)
    evidence.push('no silence was consulted: this gate read no boot log and no log directory, and it does not infer the table from a missing line')
    evidence.push('it becomes measurable when the loader prints its report through console.log, or when the composition grows a logger sink that reaches a file')
    readings.push(declared(id, name,
      'a reading about the table cannot be taken in this composition: the loader reports only through ctx.logger at plugins/dsh-link-compat/lib/index.js:' + String(ANCHOR_FROM) + '-' + String(ANCHOR_TO) + ', and ' + sink + '. This is a named third state: never green, and not a verdict on the table either way.',
      evidence))
  }

  return { readings }
}

/* ------------------------------------------------------------------ the report */

const TAGS = { green: 'ok  ', red: 'FAIL', unavailable: 'NM  ', declared: 'DECL' }
const LABELS = { green: 'green        ', red: 'RED          ', unavailable: 'UNAVAILABLE  ', declared: 'NOT-MEASURED ' }

const tally = (readings) => readings.reduce((count, entry) => { count[entry.verdict] += 1; return count }, { green: 0, red: 0, unavailable: 0, declared: 0 })

/** The exit code is a function of the verdicts and of nothing else: red beats absent, absent is 3. */
const codeOf = (readings) => {
  const count = tally(readings)
  if (count.red > 0) return 1
  if (count.unavailable > 0) return 3
  return 0
}

const announce = (readings, context) => {
  const count = tally(readings)
  const code = codeOf(readings)
  if (count.red > 0) {
    console.log('FAIL - ' + String(count.red) + ' reading(s) failed: ' + readings.filter((entry) => entry.verdict === 'red').map((entry) => '(' + entry.id + ')').join(', '))
    return code
  }
  if (count.unavailable > 0) {
    console.log('NOT MEASURED - ' + String(count.unavailable) + ' reading(s) could not be taken here: ' + readings.filter((entry) => entry.verdict === 'unavailable').map((entry) => '(' + entry.id + ')').join(', ') + '. Nothing above is a verdict on the product, and nothing above is green.')
    return code
  }
  console.log('PASS - the live profile declares the loader, the live composition names its row, and the customer reached it through link.compat.')
  console.log('(d) remains a NAMED THIRD STATE: not measured here, never green, and not inferred from any silence.')
  if (context?.replayed === true) console.log('REPLAY - every verdict above came from a transcript; this run made ZERO live reads (no GET, no process scan, no kernel spawn, no profile read).')
  return code
}

const render = (transcript, readings, context) => {
  const lease = transcript?.lease ?? {}
  console.log('== gate 133 compat-mounted-live - a LIVE READ of ' + String(transcript?.world?.kernelHome ?? KERNEL_HOME) + ' ==')
  console.log('   profile ' + String(transcript?.world?.profilePath ?? PROFILE_PATH))
  console.log('   port    ' + String(transcript?.world?.kernelPort ?? KERNEL_PORT) + ' (only ' + PANEL_STATE_PATH + ' is asked)')
  console.log('')
  for (const reading of readings) {
    console.log('  ' + TAGS[reading.verdict] + '  (' + reading.id + ') ' + reading.name)
    console.log('        ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
    console.log('')
  }
  const leaseLine = lease.claimed === true
    ? 'claimed ' + String(lease.claimedAt) + ', released ' + String(lease.releasedAt) + ' (' + String(lease.heldMs) + ' ms held; no lock file - the claim IS the process scan), against ' + String((lease.liveFiles ?? []).length) + ' live gate file(s) in the register and ' + String(lease.nodeProcesses) + ' node process(es): nobody else was running'
    : 'NOT CLAIMED - ' + String(lease.refused ?? 'unknown')
  const confirming = lease.confirmingScan === null || lease.confirmingScan === undefined
    ? 'the confirming scan outside the window was not taken'
    : lease.confirmingScan.read === true
      ? 'the scan after release saw ' + String((lease.confirmingScan.others ?? []).length) + ' late consumer(s) among ' + String(lease.confirmingScan.nodeProcesses) + ' node process(es)'
      : 'the confirming scan outside the window could not be taken (' + String(lease.confirmingScan.why) + ')'
  console.log('  the single-run lease: ' + leaseLine + '; ' + confirming)
  console.log('  the boundary: ' + String(transcript?.boundary?.statement ?? 'starts nothing, stops nothing, clicks nothing') + '. This run made ' + String(context.gets) + ' GET(s), ' + String(context.filesRead) + ' file read(s), ' + String(context.dumps) + ' composition dump(s), and wrote ' + String(context.writes) + '.')
  for (const note of transcript?.notes ?? []) console.log('  note: ' + note)
  console.log('')
  const count = tally(readings)
  console.log('summary')
  for (const entry of readings) console.log('  ' + LABELS[entry.verdict] + '(' + entry.id + ') ' + entry.name)
  console.log('')
  const measurable = count.green + count.red + count.unavailable
  const declaredIds = readings.filter((entry) => entry.verdict === 'declared').map((entry) => '(' + entry.id + ')').join(', ')
  console.log(String(readings.length) + ' readings: ' + String(count.green) + ' green, ' + String(count.red) + ' red, ' + String(count.unavailable) + ' unavailable out of ' + String(measurable) + ' measurable, plus ' + String(count.declared) + ' declared third state ' + (declaredIds === '' ? '(none)' : declaredIds) + ' that is never green')
  console.log('')
  return count
}

/* ------------------------------------------------------------------ replay: no live read at all */

const newestTranscript = () => {
  if (existsSync(SCRATCH_DIR) === false) return null
  const candidates = readdirSync(SCRATCH_DIR)
    .filter((name) => name.startsWith(SCRATCH_PREFIX) && name.endsWith('.json'))
    .map((name) => ({ path: join(SCRATCH_DIR, name), mtime: statSync(join(SCRATCH_DIR, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
  return candidates.length === 0 ? null : candidates[0].path
}

const replay = () => {
  const target = REPLAY === '' ? newestTranscript() : resolve(REPLAY)
  if (target === null) {
    console.log('NOT MEASURED - there is no transcript to replay under ' + SCRATCH_DIR + '; run the gate once against the live client first.')
    return 3
  }
  const file = readTextFile(target)
  if (file.ok !== true) {
    console.log('NOT MEASURED - the transcript ' + target + ' could not be read (' + String(file.why) + ')')
    return 3
  }
  let transcript = null
  try {
    transcript = JSON.parse(file.text)
  } catch (error) {
    console.log('NOT MEASURED - the transcript ' + target + ' is not JSON (' + describe(error) + ')')
    return 3
  }
  if (transcript?.schema !== 'r197-g133-transcript/1' || transcript?.gate !== 'compat-mounted-live') {
    console.log('NOT MEASURED - ' + target + ' is not a transcript of THIS gate (schema ' + show(transcript?.schema) + ', gate ' + show(transcript?.gate) + ')')
    return 3
  }
  const { readings } = judge(transcript)
  console.log('replaying ' + target)
  console.log('measured ' + String(transcript.startedAt) + ' in ' + String(transcript.measuredMs) + ' ms, recorded exit code ' + String(transcript.exitCode))
  console.log('')
  render(transcript, readings, { gets: 0, filesRead: 0, dumps: 0, writes: 'no byte at all (a replay judges a transcript and writes nothing)' })
  const code = announce(readings, { replayed: true })
  const recorded = transcript.exitCode === null || transcript.exitCode === undefined ? 'not recorded' : String(transcript.exitCode)
  console.log('replay agreement: the recorded exit code is ' + recorded + ', this re-judged one is ' + String(code) + ': ' + (recorded === 'not recorded' ? 'not comparable' : String(transcript.exitCode === code ? 'they agree' : 'THEY DISAGREE')))
  return code
}

/* ------------------------------------------------------------------ the run */

const main = async () => {
  if (REPLAY !== null) return replay()

  // Nothing live is touched before the lease: these are file-existence checks and a version read.
  const missing = []
  if (existsSync(KERNEL_CLI) !== true) missing.push('the kernel CLI ' + KERNEL_CLI)
  if (existsSync(PROFILE_PATH) !== true) missing.push('the live profile ' + PROFILE_PATH)
  if (existsSync(PLUGIN_LIB) !== true) missing.push('the loader ' + PLUGIN_LIB)
  const nodeBin = resolveNode()
  const version = spawnSync(nodeBin, ['--version'], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  const nodeVersion = version.status === 0 ? String(version.stdout ?? '').trim() : 'unavailable (' + clip(String(version.error === undefined ? String(version.stderr ?? '') : describe(version.error)), 120) + ')'

  const transcript = await measure()
  transcript.world.nodeBin = nodeBin
  transcript.world.nodeVersion = nodeVersion
  if (missing.length > 0) transcript.notes.push('NOT MEASURED in the world: this gate cannot read the live world from here; missing: ' + missing.join(' | '))

  const { readings } = judge(transcript)
  transcript.exitCode = codeOf(readings)
  // The transcript is the evidence and the only byte this gate writes; .tmp/ is git-ignored.
  try {
    const target = DUMP_FILE === null ? join(SCRATCH_DIR, SCRATCH_PREFIX + String(transcript.startedAt).replace(/[:.]/g, '-') + '.json') : resolve(DUMP_FILE)
    mkdirSync(dirname(target), { recursive: true })
    transcript.transcriptPath = target
    writeFileSync(target, JSON.stringify(transcript, null, 1))
  } catch (error) {
    transcript.transcriptPath = null
    transcript.notes.push('note: the transcript could not be written out (' + describe(error) + ')')
  }

  render(transcript, readings, {
    gets: transcript.boundary.gets,
    filesRead: transcript.boundary.filesRead,
    dumps: transcript.boundary.dumps,
    writes: 'its own transcript only (' + String(transcript.transcriptPath ?? 'not written') + ')',
  })
  const code = announce(readings, {})
  if (transcript.transcriptPath !== null) console.log('transcript: ' + transcript.transcriptPath + ' - re-take this judgement with zero live reads: node scripts/verify-compat-mounted-live.mjs --replay')
  return code
}

process.exitCode = await main()
