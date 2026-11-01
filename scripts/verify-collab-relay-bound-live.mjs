#!/usr/bin/env node
/**
 * Gate (R203 P2) - collab-relay-bound-live: IS THE COLLAB RELAY BOUND, AND WHO SAYS SO?
 *
 * Subject: whether the collaboration relay (plugins/dsh-link-collab, row 'link-collab') is bound, and
 * under what identity - a fact that is unreadable from outside this machine today. The live boot log
 * (<%APPDATA%>/dev.dshlink.client/dsh-link/kernel-home/boot.log) carries NO line at all about the relay,
 * so "is it bound?" can only be answered by reading the live composition/config and by making a request,
 * never by reading a silence. This gate reads all three and names the difference.
 *
 * WHAT THIS GATE READS
 *   A  the live world     the live kernel process (its own command line), the kernel home, the live boot
 *                         log, the live profile's bundle list and the shipped module the profile links
 *                         to, and every config layer the live kernel applies (its --patch files, and the
 *                         profile's own cordis.yml / cordis.patch.yml). From those it answers one
 *                         question by measurement: does the LIVE composition configure relay.token for
 *                         row 'link-collab'? No layer does - so the relay is not bound, and the boot log
 *                         is obliged to say so.
 *   a  the live boot log  The current boot's section, read line by line, for any line naming the relay.
 *                         With no token configured the reading PASSES only on an absence the log states
 *                         by name (relay + not bound / no route / no token). Nothing else counts.
 *   B  one real kernel    A throwaway kernel booted from the live profile's own bundle set (the same
 *                         shipped module, through the same link) with the DOCUMENTED row config
 *                         relay: { token, path } on row 'link-collab' - the field README.md:85-92
 *                         documents and src/index.ts:9219 reads. That kernel's own composition report
 *                         (ctx.get('linkCollab').relay, written by .tmp/r1-probe/index.mjs:435-448) is
 *                         the answer to "bound": bound, path, accepted, refused, lastCode.
 *   b2/b3 the request     Three POSTs to that kernel's relay route: no token, a wrong token, the right
 *                         one. The first two must be refused 401 WITH A NAMED CODE and must not move the
 *                         ledger; the third must land exactly once, and the composition's counters must
 *                         agree with what this gate sent. Only the third writes, and it writes into the
 *                         throwaway home - never into the live ledger.
 *   C  restored + named   The live home is byte-identical before and after (boot.log only grows, as an
 *                         append-only prefix), the live collab ledger is byte-identical, the throwaway
 *                         home is gone, the lease is released, and every process this gate started or
 *                         stopped is NAMED - with the list of processes it RESTARTED, which is empty.
 *
 * WHY THE TOKEN IS SET IN A THROWAWAY KERNEL, NOT IN THE LIVE ONE
 *   The live row's config is read once, at apply() (src/index.ts:9219). Reading the relay as bound under
 *   a token would mean rewriting the live config and RESTARTING THE CLIENT, which this gate may not do
 *   and the contract forbids (P2 discipline: no client restart). So the token is set in the row config of
 *   a throwaway kernel that composes the live profile's bundles through the same link, and the live half
 *   of the question is answered by reading (A/a). The gate names which composition it measured rather
 *   than pretending the two are one kernel.
 *
 * WHAT THIS GATE DOES NOT DO
 *   no client start/stop, no shell/CDP drive, no model round, no write to any live file, and no socket to
 *   ports 31761 or 9222 at all. It reads the live kernel's own command line and its boot log.
 *
 * SINGLE RUN. It takes an exclusive lease (.tmp/r203-p2/lease.json, pid + ttl, refused by name while a
 * live holder is alive) and refuses (exit 3) while another live consumer from scripts/verify-all.mjs's
 * live register is running. It is not part of any segmented suite run.
 *
 * SIX READINGS, each able to fail on its own evidence:
 *   0-the-live-world-this-gate-judges
 *    a-the-live-boot-log-says-the-relay-is-not-bound
 *    b1-the-configured-composition-reports-relay-bound-true
 *    b2-a-request-with-no-token-or-a-wrong-token-is-refused-by-name
 *    b3-a-correct-token-lands-once-and-the-composition-counts-it
 *    c-restored-and-every-process-named
 *
 * Usage: node scripts/verify-collab-relay-bound-live.mjs [--deadline-ms 300000] [--poll-ms 500]
 *          [--scratch <dir>] [--dump <file>] [--replay <transcript.json>]
 *
 * Exit 0 every reading held | 1 a reading failed | 3 this gate could not measure here (a named third
 * state: no live kernel, no readable boot log, another live consumer, a lease held, a probe that never
 * wrote) - never a pass | 2 the instrument is missing (probe package, kernel checkout, built plugin).
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-collab')) && existsSync(join(at, 'scripts', 'verify-all.mjs'))) return at
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
const REPLAY_PATH = option('--replay', null)
const DEADLINE_MS = Number(option('--deadline-ms', '300000'))
const POLL_MS = Number(option('--poll-ms', '500'))
const SCRATCH = resolve(option('--scratch', join(PROJECT, '.tmp', 'r203-p2')))
const DUMP_OPTION = option('--dump', null)

/** The live kernel's port, the row this gate judges, and the names the product uses. */
const KERNEL_PORT = 31760
const SELF_FILE = 'verify-collab-relay-bound-live.mjs'
const COLLAB_BUNDLE = 'dsh-link-collab'
const ROW_ID = 'link-collab'
const RELAY_PATH = '/api/dsh-link-collab/relay'
const KERNEL_CHECKOUT = join(PROJECT, 'core', 'deepseek-harness')
const PROBE_RUNNER = join(PROJECT, 'scripts', 'probe-kernel-surface.mjs')
const SURFACE_PROBE = join(PROJECT, '.tmp', 'r1-probe', 'index.mjs')
const PLUGIN_DIR = join(PROJECT, 'plugins', 'dsh-link-collab')
const SRC = 'plugins/dsh-link-collab/src/index.ts'
const SRC_LINES = SRC + ':9219 (relay.token read) / 9223-9226 (the only no-route line, and only for a whitespace-only token) / 9232 (endpoint = null on the ordinary no-token path: silent) / 9258 (a webServer without register: bare return, silent) / 9265 (the only relay line the plugin prints)'

/** The peer this gate posts as: a name nobody else on this machine holds. */
const PEER = { writer: 'r203-peer', instance: 'r203-peer-1' }
const BATCH = {
  writer: PEER.writer,
  instance: PEER.instance,
  records: [
    { seq: 1, kind: 'task/state', actor: 'team-R203', payload: { id: 'r203-1', state: 'pending' } },
    { seq: 2, kind: 'task/state', actor: 'team-R203', payload: { id: 'r203-1', state: 'completed', owner: 'r203-gate' } },
  ],
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const show = (value) => {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}
const clip = (text, width) => {
  const s = String(text === undefined || text === null ? '' : text)
  return s.length <= width ? s : s.slice(0, width) + '...'
}
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const pad = (text, width) => (String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const redactUrl = (text) => String(text).replace(/token=[^&\s"']+/gu, 'token=<redacted>')

const fileFacts = (path) => {
  try {
    const bytes = readFileSync(path)
    const stats = statSync(path)
    return { ok: true, path, bytes: bytes.length, sha256: sha256(bytes), mtimeMs: stats.mtimeMs, mtime: new Date(stats.mtimeMs).toISOString() }
  } catch (error) {
    return { ok: false, path, why: describe(error) }
  }
}
const readText = (path) => {
  try {
    return { ok: true, text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { ok: false, why: describe(error) }
  }
}
const readJson = (path) => {
  const read = readText(path)
  if (read.ok !== true) return { ok: false, why: read.why }
  try {
    return { ok: true, value: JSON.parse(read.text) }
  } catch (error) {
    return { ok: false, why: 'not JSON: ' + describe(error) }
  }
}
const pwsh = (command, timeoutMs = 40000) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
const pidAlive = (pid) => {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Every node process on this machine, with the command line its own process table holds. */
const nodeProcesses = () => {
  const query = 'Get-CimInstance Win32_Process -Filter "Name=' + "'node.exe'" + '" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + [string]$_.CreationDate + "|" + [string]$_.CommandLine }'
  const done = pwsh(query)
  if (done.status !== 0) return { ok: false, why: 'the process list could not be read: ' + clip(String(done.stderr ?? ''), 160), rows: [] }
  const rows = String(done.stdout ?? '')
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.includes('|'))
    .map((row) => {
      const first = row.indexOf('|')
      const second = row.indexOf('|', first + 1)
      const third = row.indexOf('|', second + 1)
      return { pid: row.slice(0, first), ppid: row.slice(first + 1, second), started: row.slice(second + 1, third), command: row.slice(third + 1) }
    })
  return { ok: true, rows }
}

/** The desktop client's identity: pid@start-time. A restart of this is a third state, not a red. */
const clientIdentity = () => {
  const query = "[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })"
  const done = pwsh(query, 30000)
  if (done.status !== 0) return null
  const text = String(done.stdout ?? '').trim()
  return text === '' ? null : text
}

/** This gate's own ancestor chain, so "another consumer" is never this process's own parent. */
const ancestorPids = () => {
  const query = '$ids = @(); $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID);'
    + ' for ($i = 0; $i -lt 12 -and $p -ne $null; $i++) { $ids += [string]$p.ProcessId;'
    + ' if ($p.ParentProcessId -eq 0) { break }; $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [string]$p.ParentProcessId) -ErrorAction SilentlyContinue }'
    + ' [string]::Join(",", $ids)'
  const done = pwsh(query, 30000)
  if (done.status !== 0) return []
  return String(done.stdout ?? '').trim().split(',').map((id) => id.trim()).filter((id) => id !== '')
}

/** The live register's own list of live files (scripts/verify-all.mjs), so "alone" is its word. */
const liveRegister = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) !== true) return { files: [], why: 'scripts/verify-all.mjs is not there', parsed: 0 }
  const text = readFileSync(path, 'utf8')
  const files = new Set()
  let count = 0
  for (const row of text.matchAll(/\{\s*name:\s*'([^']+)',\s*kind:\s*'(offline|live|kernel)',\s*cmd:\s*\[([^\]]*)\]/gu)) {
    count += 1
    if (row[2] !== 'live') continue
    for (const word of row[3].split(',')) {
      const clean = word.trim().replace(/^'|'$/gu, '')
      if (/\.mjs$/u.test(clean)) files.add(clean.split('/').pop())
    }
  }
  return { files: [...files], why: count === 0 ? 'the register could not be parsed' : null, parsed: count }
}

/** Another live consumer: a registered live gate running outside this process's own chain. */
const otherConsumers = (rows, live, ancestors) => {
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors ?? [])])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF_FILE)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/u.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

/** One TCP connect is the port reading; nothing is sent and nothing is changed. */
const portAnswers = async (port) => {
  const net = await import('node:net')
  return new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const finish = (ok) => {
      try { socket.destroy() } catch { /* the socket is the OS's to reap */ }
      done(ok)
    }
    socket.setTimeout(3000)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))
  })
}

// ---------------------------------------------------------------------------
// The lease: one live consumer at a time
// ---------------------------------------------------------------------------

const LEASE_PATH = join(SCRATCH, 'lease.json')
const LEASE_TTL_MS = 30 * 60 * 1000

const claimLease = () => {
  mkdirSync(SCRATCH, { recursive: true })
  const existing = readJson(LEASE_PATH)
  if (existing.ok === true && existing.value !== null && typeof existing.value?.pid === 'number') {
    const held = existing.value
    const age = Date.now() - Number(held.atMs ?? 0)
    const alive = pidAlive(held.pid) && held.pid !== process.pid
    if (alive && age < LEASE_TTL_MS) return { ok: false, why: 'the lease is held by pid ' + String(held.pid) + ' (' + String(held.gate ?? 'unknown gate') + ') since ' + String(held.at ?? '?'), holder: held }
    if (alive === false) writeFileSync(LEASE_PATH + '.reclaimed-' + String(Date.now()), JSON.stringify(held, null, 1) + '\n', 'utf8')
  }
  const lease = { gate: SELF_FILE, pid: process.pid, ppid: process.ppid, at: new Date().toISOString(), atMs: Date.now(), ttlMs: LEASE_TTL_MS }
  writeFileSync(LEASE_PATH, JSON.stringify(lease, null, 1) + '\n', 'utf8')
  const after = readJson(LEASE_PATH)
  const held = after.ok === true && after.value?.pid === process.pid
  return { ok: held, held, lease, why: held ? null : 'the lease file could not be read back as this process' }
}

const releaseLease = () => {
  try {
    const current = readJson(LEASE_PATH)
    if (current.ok === true && current.value?.pid === process.pid) {
      rmSync(LEASE_PATH, { force: true })
      return existsSync(LEASE_PATH) === false
    }
    return true
  } catch {
    return false
  }
}

// A lease this process still holds when it dies is given back on the way out: the OS stops the process,
// not the lease, and a stale lease would make the next run wait on a gate that is already gone.
process.on('exit', () => {
  try {
    releaseLease()
  } catch {
    // The file is the OS's to reap; losing this is not worth failing a run over.
  }
})

// ---------------------------------------------------------------------------
// Reading the live composition: does anything configure relay.token?
// ---------------------------------------------------------------------------

/**
 * The 'link-collab' row blocks a patch layer writes: the '- id: link-collab' line and the lines under it
 * until the next row or a shallower key. Line numbers are kept so a finding can cite the layer.
 */
const linkCollabBlocks = (text) => {
  const lines = String(text ?? '').split(/\r?\n/u)
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = /^(\s*)-\s*id:\s*['"]?link-collab['"]?\s*$/u.exec(lines[index])
    if (head === null) continue
    const base = head[1].length
    const block = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const raw = lines[next]
      if (/^\s*$/u.test(raw) || /^\s*#/u.test(raw)) continue
      const indent = (raw.match(/^\s*/u) ?? [''])[0].length
      if (indent <= base) break
      block.push({ number: next + 1, text: raw })
    }
    blocks.push({ idLine: index + 1, block })
  }
  return blocks
}

/**
 * Every layer the live kernel applies, in composition order (the profile's own layer, then the launcher's
 * --patch files, then a home-level layer when one exists), with the 'link-collab' block each one writes.
 */
const relayConfigLayers = (kernel, kernelHome) => {
  const profileDir = join(kernelHome, 'profiles', 'web')
  const paths = []
  const add = (path) => {
    const absolute = resolve(path)
    if (paths.some((one) => one.toLowerCase() === absolute.toLowerCase()) === false) paths.push(absolute)
  }
  if (existsSync(join(profileDir, 'cordis.yml')) === true) add(join(profileDir, 'cordis.yml'))
  if (existsSync(join(profileDir, 'cordis.patch.yml')) === true) add(join(profileDir, 'cordis.patch.yml'))
  for (const patch of kernel?.patches ?? []) add(patch)
  if (existsSync(join(kernelHome, 'cordis.patch.yml')) === true) add(join(kernelHome, 'cordis.patch.yml'))
  const layers = []
  for (const path of paths) {
    const text = readText(path)
    if (text.ok !== true) {
      layers.push({ path, readable: false, why: text.why, blocks: [] })
      continue
    }
    const blocks = linkCollabBlocks(text.text).map((block) => {
      const find = (key) => block.block.find((row) => new RegExp('^\\s*' + key + '\\s*:', 'u').test(row.text)) ?? null
      const scalar = (key) => {
        const row = find(key)
        if (row === null) return null
        const value = row.text.replace(new RegExp('^\\s*' + key + '\\s*:\\s*', 'u'), '').trim().replace(/^['"]|['"]$/gu, '')
        return { line: row.number, value, empty: value === '' || value === '~' || value === 'null' }
      }
      const relayRow = find('relay')
      return {
        idLine: block.idLine,
        relay: relayRow === null ? null : relayRow.number,
        token: scalar('token'),
        path: scalar('path'),
        disabled: (find('disabled') ?? { text: '' }).text.trim() === 'disabled: true',
      }
    })
    layers.push({ path, readable: true, file: fileFacts(path), blocks })
  }
  const withBlocks = layers.filter((layer) => layer.blocks.length > 0)
  const tokens = []
  for (const layer of withBlocks) {
    for (const block of layer.blocks) {
      if (block.disabled === true) continue
      if (block.token !== null && block.token.empty === false) tokens.push({ path: layer.path, line: block.token.line })
    }
  }
  return { layers, withBlocks, tokens, tokenConfigured: tokens.length > 0 }
}

// ---------------------------------------------------------------------------
// The live boot log: the current boot's section, and every line in it that names the relay
// ---------------------------------------------------------------------------

const BOOT_HEAD = /^dsh web: http:\/\/127\.0\.0\.1:\d+\//u
const RELAY_MENTION = /\[dsh-link-collab\][^\n]*\brelay\b/iu
const RELAY_ABSENCE = /(not bound|no route|unbound|not configured|no token|no secret|no relay|disabled|not exposed|no endpoint)/iu
const RELAY_BOUND = /(route bound|relay bound|bound on)/iu
const COLLAB_LINE = /^\[dsh-link-collab\]/u

/**
 * The current boot's section of an append-only log.
 *
 * boot.log is opened append-only by the client (src-tauri/src/core/supervisor.rs:533-536), so a machine
 * that has been restarted holds several boots in one file. Each boot announces itself once, with
 * 'dsh web: http://127.0.0.1:<port>/', printed AFTER every plugin row has loaded. With one announcement
 * the whole file is the current boot. With several, the section starts after the previous boot's own
 * announcement: the previous boot's plugin lines all precede it, and this boot's all follow it.
 */
const bootSection = (text) => {
  const lines = String(text ?? '').split(/\r?\n/u)
  const heads = []
  for (let index = 0; index < lines.length; index += 1) if (BOOT_HEAD.test(lines[index].trim()) === true) heads.push(index)
  let from = 0
  let rule = 'the whole file: it carries one boot announcement, so it is this boot'
  if (heads.length > 1) {
    const previous = heads[heads.length - 2]
    from = previous + 1
    rule = 'after the previous boot announcement (line ' + String(previous + 1) + '): this file carries ' + String(heads.length) + ' boots'
  }
  const section = lines.slice(from).map((textLine, offset) => ({ number: from + offset + 1, text: textLine }))
  return { from, rule, total: lines.length, heads: heads.length, section }
}

const scanBoot = (path) => {
  const facts = fileFacts(path)
  if (facts.ok !== true) return { ok: false, why: 'the live boot log is not readable at ' + path + ' (' + facts.why + ')' }
  const text = readFileSync(path, 'utf8')
  const section = bootSection(text)
  const collab = section.section.filter((row) => COLLAB_LINE.test(row.text) === true)
  const relay = section.section.filter((row) => RELAY_MENTION.test(row.text) === true)
  const absence = relay.find((row) => RELAY_ABSENCE.test(row.text) === true) ?? null
  const bound = relay.find((row) => RELAY_BOUND.test(row.text) === true) ?? null
  return {
    ok: true,
    path,
    bytes: facts.bytes,
    sha256: facts.sha256,
    mtime: facts.mtime,
    mtimeMs: facts.mtimeMs,
    section: { from: section.from, rule: section.rule, total: section.total, boots: section.heads, lines: section.section.length },
    collabLines: collab.map((row) => ({ number: row.number, text: row.text })),
    relayLines: relay.map((row) => ({ number: row.number, text: row.text })),
    absence,
    bound,
  }
}

// ---------------------------------------------------------------------------
// The live world
// ---------------------------------------------------------------------------

/** The live kernel: the node process the client launched, running bin.ts with --patch layers on KERNEL_PORT. */
const findLiveKernel = (rows) => {
  const found = rows.filter((row) => row.command.includes('bin.ts') && row.command.includes('--patch') && new RegExp('--port\\s+' + String(KERNEL_PORT) + '\\b', 'u').test(row.command))
  if (found.length === 0) return null
  const row = found[0]
  const patches = [...row.command.matchAll(/--patch\s+("([^"]+)"|(\S+))/gu)].map((match) => match[2] ?? match[3])
  return { pid: row.pid, ppid: row.ppid, started: row.started, command: clip(row.command, 400), patches, port: KERNEL_PORT }
}

const resolveLiveWorld = (kernel) => {
  if (kernel === null) return { ok: false, why: 'no live kernel process could be named (a node process running bin.ts with --patch layers on port ' + String(KERNEL_PORT) + '), so the composition this gate reads cannot be identified' }
  const patch = (kernel.patches ?? []).map((path) => resolve(path)).find((path) => /\.ya?ml$/iu.test(path)) ?? (kernel.patches ?? []).map((path) => resolve(path))[0] ?? null
  if (patch === null) return { ok: false, why: 'the live kernel command names no --patch layer, so its kernel home cannot be derived' }
  const kernelHome = dirname(patch)
  if (existsSync(kernelHome) !== true) return { ok: false, why: 'the kernel home derived from the --patch layer ' + patch + ' does not exist' }
  const bootPath = join(kernelHome, 'boot.log')
  const profileDir = join(kernelHome, 'profiles', 'web')
  const profilePkgPath = join(profileDir, 'package.json')
  const profilePkg = readJson(profilePkgPath)
  if (profilePkg.ok !== true) return { ok: false, why: 'the live profile has no readable package.json at ' + profilePkgPath + ' (' + profilePkg.why + ')' }
  const bundles = Array.isArray(profilePkg.value?.dsh?.profile?.bundles) ? profilePkg.value.dsh.profile.bundles.map(String) : []
  if (bundles.includes(COLLAB_BUNDLE) !== true) return { ok: false, why: 'the live profile does not mount ' + COLLAB_BUNDLE + ' (bundles: ' + show(bundles) + '), so the live boot log cannot carry a line about this relay' }
  const link = String(profilePkg.value?.dependencies?.[COLLAB_BUNDLE] ?? '')
  const pluginDir = link.startsWith('link:') ? resolve(link.slice('link:'.length)) : PLUGIN_DIR
  const pluginPkg = readJson(join(pluginDir, 'package.json'))
  if (pluginPkg.ok !== true) return { ok: false, why: 'the mounted collab package has no readable package.json (' + pluginPkg.why + ')' }
  const modulePath = resolve(pluginDir, typeof pluginPkg.value?.main === 'string' ? pluginPkg.value.main : 'lib/index.js')
  const configPath = resolve(pluginDir, typeof pluginPkg.value?.dsh?.bundle?.patch === 'string' ? pluginPkg.value.dsh.bundle.patch : 'cordis.patch.yml')
  const module = fileFacts(modulePath)
  if (module.ok !== true) return { ok: false, why: 'the shipped module the live profile mounts is not readable at ' + modulePath + ' (' + module.why + ')' }
  const config = fileFacts(configPath)
  if (config.ok !== true) return { ok: false, why: 'the bundle layer ' + configPath + ' is not readable (' + config.why + ')' }
  const relay = relayConfigLayers(kernel, kernelHome)
  const unreadable = relay.layers.filter((layer) => layer.readable !== true)
  if (unreadable.length > 0) return { ok: false, why: 'a config layer the live kernel applies is not readable: ' + unreadable.map((layer) => layer.path + ' (' + layer.why + ')').join('; ') }
  return {
    ok: true,
    kernelHome,
    bootPath,
    profile: { dir: profileDir, packagePath: profilePkgPath, bundles, dependency: link, linksToThisRepository: new RegExp('plugins[\\\\/]' + COLLAB_BUNDLE, 'iu').test(link) },
    plugin: { dir: pluginDir, modulePath, module, configPath, config },
    relay,
    liveLedgerPath: join(kernelHome, 'collab', 'control.jsonl'),
  }
}

// ---------------------------------------------------------------------------
// One real kernel, one documented config field, three requests
// ---------------------------------------------------------------------------

/**
 * Boot one throwaway kernel from the live profile's own bundle set with the documented row config
 * relay: { token, path }, wait for the route, post the three requests the contract names, and read the
 * composition's own report. Returns facts only: the judgement happens in judge().
 */
const runComposition = async () => {
  const runDir = join(SCRATCH, 'run-' + new Date().toISOString().replace(/[:.]/gu, '-'))
  mkdirSync(runDir, { recursive: true })
  const surfacePath = join(runDir, 'surface.json')
  const notePath = join(runDir, 'kernel-lines.txt')
  const token = 'r203-' + randomBytes(16).toString('hex')
  const facts = {
    runDir,
    startedAt: new Date().toISOString(),
    tokenSha256: sha256(token),
    probe: { pid: null, exit: null, out: [], err: [] },
    kernelPid: null,
    kernelCommand: null,
    home: null,
    overlayPath: null,
    port: null,
    boundLine: null,
    note: [],
    posts: {},
    ledger: {},
    surface: null,
    surfacePath,
    notePath,
    homeRemoved: null,
    errors: [],
  }
  const probe = spawn(process.execPath, [PROBE_RUNNER, '--out', surfacePath, '--timeout', String(Math.max(DEADLINE_MS, 180000))], {
    cwd: PROJECT,
    env: {
      ...process.env,
      NO_COLOR: '1',
      DSH_LINK_PROBE_NOTE: notePath,
      DSH_LINK_PROBE_RELAY_TOKEN: token,
      DSH_LINK_PROBE_RELAY_PATH: RELAY_PATH,
      // The report is written late enough for this gate to post first and read the counters after.
      DSH_LINK_PROBE_DELAY_MS: '90000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  facts.probe.pid = probe.pid ?? null
  let settled = false
  const exited = new Promise((done) => probe.once('exit', (code) => { facts.probe.exit = code; settled = true; done(code) }))
  probe.once('error', (error) => {
    facts.errors.push('the probe could not be started: ' + describe(error))
    if (settled !== true) {
      settled = true
      facts.probe.exit = -1
    }
  })
  probe.stdout.setEncoding('utf8')
  probe.stderr.setEncoding('utf8')
  probe.stdout.on('data', (chunk) => { for (const line of chunk.split('\n')) if (line.trim() !== '') facts.probe.out.push(clip(redactUrl(line), 400)) })
  probe.stderr.on('data', (chunk) => { for (const line of chunk.split('\n')) if (line.trim() !== '') facts.probe.err.push(clip(redactUrl(line), 400)) })
  const homeFromProbe = () => {
    for (const line of facts.probe.out) {
      const match = /(?:^|\s)home=(.+)$/u.exec(line)
      if (match !== null) return match[1].trim()
    }
    return null
  }

  const noteLines = () => (existsSync(notePath) ? readFileSync(notePath, 'utf8').split(/\r?\n/u).filter((line) => line !== '') : [])
  const until = Date.now() + DEADLINE_MS
  while (Date.now() < until) {
    const lines = noteLines()
    facts.note = lines.map((line) => clip(redactUrl(line), 400))
    facts.home = homeFromProbe()
    const urlLine = lines.map((line) => line.trim()).find((line) => /^dsh web: http:\/\/127\.0\.0\.1:\d+\//u.test(line)) ?? null
    const boundLine = lines.map((line) => line.trim()).find((line) => /^\[dsh-link-collab\] relay route bound on /u.test(line)) ?? null
    if (urlLine !== null && boundLine !== null && facts.home !== null) {
      facts.port = Number(/^dsh web: http:\/\/127\.0\.0\.1:(\d+)\//u.exec(urlLine)[1])
      facts.boundLine = boundLine
      break
    }
    if (facts.probe.exit !== null) break
    await sleep(POLL_MS)
  }
  facts.home = homeFromProbe()
  facts.overlayPath = facts.home === null ? null : join(facts.home, 'probe.overlay.yml')

  // Which node process is the kernel this gate booted: the probe's own direct child running bin.ts.
  if (facts.probe.pid !== null) {
    const rows = nodeProcesses()
    if (rows.ok === true) {
      const child = rows.rows.find((row) => row.ppid === String(facts.probe.pid) && row.command.includes('bin.ts')) ?? null
      if (child !== null) {
        facts.kernelPid = child.pid
        facts.kernelCommand = clip(redactUrl(child.command), 400)
      }
    }
  }

  const ledgerSnapshot = (path) => {
    if (path === null || existsSync(path) !== true) return { exists: false, bytes: 0, lines: 0, sha256: null }
    const bytes = readFileSync(path)
    const text = bytes.toString('utf8')
    return { exists: true, bytes: bytes.length, lines: text.split('\n').filter((line) => line.trim() !== '').length, sha256: sha256(bytes) }
  }
  const ledgerPath = facts.home === null ? null : join(facts.home, 'collab', 'control.jsonl')
  facts.ledger.path = ledgerPath

  if (facts.port !== null) {
    const url = 'http://127.0.0.1:' + String(facts.port) + RELAY_PATH
    const post = async (presented) => {
      const headers = { 'content-type': 'application/json' }
      if (presented !== null) headers.authorization = 'Bearer ' + presented
      const startedAt = Date.now()
      try {
        const answer = await fetch(url, { method: 'POST', headers, body: JSON.stringify(BATCH), signal: AbortSignal.timeout(20000) })
        const text = await answer.text()
        let body = null
        try { body = JSON.parse(text) } catch { body = null }
        return {
          status: answer.status,
          code: typeof body?.code === 'string' ? body.code : null,
          ok: body?.ok === true,
          appended: typeof body?.appended === 'number' ? body.appended : null,
          bodyBytes: Buffer.byteLength(text),
          ms: Date.now() - startedAt,
          error: null,
        }
      } catch (error) {
        return { status: 0, code: null, ok: false, appended: null, bodyBytes: 0, ms: Date.now() - startedAt, error: String(error?.code ?? error?.message ?? error) }
      }
    }
    facts.posts.noToken = await post(null)
    facts.posts.wrongToken = await post(token + '-wrong')
    facts.ledger.afterRefusals = ledgerSnapshot(ledgerPath)
    facts.posts.right = await post(token)
    facts.ledger.afterLanding = ledgerSnapshot(ledgerPath)
  } else {
    facts.posts.notSent = 'the kernel never announced both a bound route and a web address within ' + String(DEADLINE_MS) + ' ms'
  }

  // The composition's own report, written at DSH_LINK_PROBE_DELAY_MS after the probe row mounts.
  const surfaceUntil = Date.now() + Math.max(DEADLINE_MS, 120000)
  while (Date.now() < surfaceUntil && existsSync(surfacePath) !== true && facts.probe.exit === null) await sleep(POLL_MS)
  const surface = readJson(surfacePath)
  facts.surface = surface.ok === true
    ? {
        kernel: surface.value?.kernel ?? null,
        env: surface.value?.env ?? null,
        relay: surface.value?.relay ?? null,
        relayCounts: surface.value?.relayCounts ?? null,
        relayRecords: surface.value?.relayRecords ?? null,
        relayWriters: surface.value?.relayWriters ?? null,
        relayError: surface.value?.relayError ?? null,
      }
    : { missing: true, why: surface.why }
  if (facts.probe.exit === null) await Promise.race([exited, sleep(120000)])
  if (facts.probe.exit === null) {
    facts.errors.push('the probe did not exit; this gate is stopping it by pid')
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(facts.probe.pid), '/T', '/F'], { stdio: 'ignore' })
      else probe.kill('SIGKILL')
    } catch (error) {
      facts.errors.push('the probe could not be stopped: ' + describe(error))
    }
    await Promise.race([exited, sleep(10000)])
  }
  if (facts.home === null) facts.home = homeFromProbe()
  facts.homeRemoved = facts.home === null ? null : existsSync(facts.home) !== true
  facts.probe.out = facts.probe.out.map((line) => clip(redactUrl(line), 400))
  return facts
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript
// ---------------------------------------------------------------------------

const OK = (detail) => ({ ok: true, detail })
const BAD = (detail) => ({ ok: false, detail })
const NOT_MEASURED = (detail) => ({ ok: false, notMeasured: true, detail })

/** Where the product would have to say it, named once so every red can cite the same lines. */
const PRODUCT_SILENCE = SRC_LINES

const layoutLines = (layers) => layers.map((layer) => layer.path + ' (' + (layer.blocks.length === 0 ? 'no link-collab row' : layer.blocks.map((block) => 'row at line ' + String(block.idLine) + (block.token === null ? ', no token' : ', token at line ' + String(block.token.line) + (block.token.empty ? ' (empty)' : ''))).join(', ')) + ')').join('; ')

const judge = (t) => {
  const readings = []
  const world = t?.world ?? null
  const boot = t?.boot ?? null
  const relay = world?.relay ?? null
  const guard = t?.guard ?? null
  const entry = t?.entry ?? null
  const kernel = t?.kernel ?? null
  const exit = t?.exit ?? null

  // --- 0: the world this gate judges ---------------------------------------------------------------
  readings.push((() => {
    const id = '0-the-live-world-this-gate-judges'
    if (world === null || world.ok !== true) return { id, ...NOT_MEASURED('the live world was not read: ' + String(world?.why ?? 'no reading was taken')) }
    if ((guard?.others ?? []).length > 0) return { id, ...NOT_MEASURED('another live consumer is running and this gate must run alone: ' + guard.others.join(' | ')) }
    if (t?.lease?.ok !== true) return { id, ...NOT_MEASURED('the single-run lease was not held: ' + String(t?.lease?.why ?? 'no lease was claimed')) }
    if (entry?.client === null || entry?.client === undefined) return { id, ...NOT_MEASURED('the desktop client process (dsh-link) is not running, so there is no live client to judge') }
    if (entry?.kernel === null || entry?.kernel === undefined) return { id, ...NOT_MEASURED('no live kernel process could be named (a node process running bin.ts with --patch layers on port ' + String(KERNEL_PORT) + ')') }
    if (entry?.kernelAlive !== true) return { id, ...NOT_MEASURED('port ' + String(KERNEL_PORT) + ' did not answer a TCP connect, so the kernel named by the process table may already be gone') }
    if (boot === null || boot.ok !== true) return { id, ...NOT_MEASURED(String(boot?.why ?? 'the live boot log was not read')) }
    return { id, ...OK('client ' + String(entry.client) + '; kernel pid ' + String(entry.kernel.pid) + ' ' + clip(entry.kernel.command, 120) + '; home ' + String(world.kernelHome) + '; boot.log ' + String(boot.bytes) + ' bytes, mtime ' + String(boot.mtime) + ', ' + String(boot.section.boots) + ' boot announcement(s), section lines ' + String(boot.section.from + 1) + '-' + String(boot.section.from + boot.section.lines) + ' (' + String(boot.section.rule) + '); profile mounts ' + COLLAB_BUNDLE + ' as ' + String(world.profile.dependency) + '; module ' + String(world.plugin.modulePath) + ' sha256 ' + String(world.plugin.module.sha256).slice(0, 16) + '; layers read: ' + layoutLines(world.relay.layers)) }
  })())

  // --- a: the live boot log says whether the relay is bound ----------------------------------------
  readings.push((() => {
    const id = 'a-the-live-boot-log-says-the-relay-is-not-bound'
    if (boot === null || boot.ok !== true) return { id, ...NOT_MEASURED(String(boot?.why ?? 'the live boot log was not read, so this gate cannot say what it says')) }
    if (relay === null) return { id, ...NOT_MEASURED('the live relay config layers were not read') }
    const loadLine = (boot.collabLines ?? []).find((row) => /control channel ready/u.test(row.text)) ?? (boot.collabLines ?? [])[0] ?? null
    const where = 'boot.log ' + String(boot.path) + ' section lines ' + String(boot.section.from + 1) + '-' + String(boot.section.from + boot.section.lines) + ' (' + String(boot.section.rule) + ')'
    if (relay.tokenConfigured === true) {
      if (boot.bound !== null) return { id, ...OK(where + ' carries the bound line: ' + JSON.stringify(boot.bound.text)) }
      const configuredIn = world.relay.layers.filter((layer) => layer.blocks.some((block) => block.token !== null && block.token.empty === false))
      return { id, ...BAD(where + ' carries no line saying the relay bound, while the live composition configures relay.token at ' + layoutLines(configuredIn)) }
    }
    if (boot.absence !== null && loadLine !== null) {
      return { id, ...OK(where + ' names the relay and states the absence: ' + JSON.stringify(boot.absence.text) + ' (no relay.token in any layer: ' + String(world.relay.layers.length) + ' layers read)') }
    }
    if (loadLine === null) {
      return { id, ...BAD(where + ' carries no [dsh-link-collab] line at all, so this boot never reached the control channel and says nothing about the relay; the composition this boot ran configures no relay.token (' + String(world.relay.layers.length) + ' layers read, none with a link-collab token). The statement belongs in the product, not in this gate: ' + PRODUCT_SILENCE) }
    }
    const mentions = (boot.relayLines ?? []).length === 0 ? 'no relay line at all' : 'relay lines that state no verdict: ' + JSON.stringify((boot.relayLines ?? []).map((row) => row.text))
    return { id, ...BAD(where + ' names the plugin at line ' + String(loadLine.number) + ' (' + JSON.stringify(loadLine.text) + ') and carries ' + mentions + ', while the live composition configures no relay.token (layers read: ' + layoutLines(world.relay.layers) + '). A peer cannot read "not bound" from this log. The statement belongs in the product, not in this gate: ' + PRODUCT_SILENCE + ' - this reading can only see a boot line; a read-only state route would answer a different reading and would be added as one, never read into this one') }
  })())

  // --- b1: the configured composition reports relay.bound = true -----------------------------------
  readings.push((() => {
    const id = 'b1-the-configured-composition-reports-relay-bound-true'
    if (kernel === null) return { id, ...NOT_MEASURED('the token-configured kernel was never booted (the live world was not measurable)') }
    const surface = kernel.surface ?? null
    if (surface === null || surface.missing === true) return { id, ...NOT_MEASURED('the kernel wrote no composition report (' + String(surface?.why ?? 'unknown') + '); probe output tail: ' + clip((kernel.probe?.out ?? []).slice(-5).join(' | '), 300)) }
    if (surface.relayError !== null && surface.relayError !== undefined) return { id, ...NOT_MEASURED('the composition report could not read linkCollab.relay: ' + String(surface.relayError)) }
    const report = surface.relay
    if (report === null || report === undefined) return { id, ...BAD('the kernel booted with relay.token configured but serves no linkCollab.relay at all, so the composition reports nothing about the relay') }
    if (report.accepted === 0 && report.refused === 0) return { id, ...NOT_MEASURED("the composition report was written before this gate's requests arrived (accepted 0, refused 0): the report and the requests did not meet, so this reading has nothing to grade") }
    const detail = 'kernel ' + String(surface.kernel?.id ?? '?') + ' pid ' + String(surface.kernel?.pid ?? '?') + ' home ' + String(surface.env?.DSH_HOME ?? '?') + '; report relay=' + show(report) + '; boot line ' + JSON.stringify(kernel.boundLine) + '; config set on row ' + ROW_ID + ' in the throwaway overlay ' + String(kernel.overlayPath ?? '(unnamed)') + ': relay.token (sha256 ' + String(kernel.tokenSha256).slice(0, 12) + '), relay.path ' + RELAY_PATH + ' - the live home was never written'
    if (report.bound === true && report.path === RELAY_PATH && typeof kernel.boundLine === 'string' && kernel.boundLine.includes(RELAY_PATH)) return { id, ...OK(detail) }
    return { id, ...BAD(detail + ' - bound=' + show(report.bound) + ', path=' + show(report.path) + ', bound line ' + (kernel.boundLine === null ? 'absent (the route never registered)' : 'present')) }
  })())

  // --- b2: a request with no token or a wrong token is refused by name -----------------------------
  readings.push((() => {
    const id = 'b2-a-request-with-no-token-or-a-wrong-token-is-refused-by-name'
    if (kernel === null || kernel.posts?.notSent !== undefined) return { id, ...NOT_MEASURED('no request was sent: ' + String(kernel?.posts?.notSent ?? 'the kernel arm never ran')) }
    const anonymous = kernel.posts?.noToken ?? null
    const wrong = kernel.posts?.wrongToken ?? null
    if (anonymous === null || wrong === null) return { id, ...NOT_MEASURED('the refusal posts were not sent') }
    const named = (answer) => answer.status === 401 && typeof answer.code === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(answer.code)
    const report = kernel.surface?.relay ?? null
    const refusedCount = report === null ? null : report.refused
    const ledgerAfter = kernel.ledger?.afterRefusals ?? null
    const detail = 'noToken=' + show(anonymous) + ' wrongToken=' + show(wrong) + '; composition refused=' + show(refusedCount) + ' lastCode=' + show(report?.lastCode) + '; ledger after the two refusals=' + show(ledgerAfter)
    if (named(anonymous) && named(wrong) && refusedCount === 2 && (ledgerAfter === null || ledgerAfter.bytes === 0)) {
      return { id, ...OK(detail + ' - both refused with a named code and nothing was appended') }
    }
    const why = []
    if (named(anonymous) !== true) why.push('the no-token request was not a named 401 (status ' + String(anonymous.status) + ', code ' + show(anonymous.code) + ')')
    if (named(wrong) !== true) why.push('the wrong-token request was not a named 401 (status ' + String(wrong.status) + ', code ' + show(wrong.code) + ')')
    if (refusedCount !== 2) why.push('the composition counted ' + show(refusedCount) + ' refusals, not the 2 this gate sent')
    if (ledgerAfter !== null && ledgerAfter.bytes !== 0) why.push('the ledger moved across the refusals (' + show(ledgerAfter) + ')')
    return { id, ...BAD(detail + ' - ' + why.join('; ')) }
  })())

  // --- b3: a correct token lands once, and the composition counts it --------------------------------
  readings.push((() => {
    const id = 'b3-a-correct-token-lands-once-and-the-composition-counts-it'
    if (kernel === null || kernel.posts?.right === undefined) return { id, ...NOT_MEASURED('no authorised request was sent: ' + String(kernel?.posts?.notSent ?? 'the kernel arm never ran')) }
    const right = kernel.posts.right
    const report = kernel.surface?.relay ?? null
    if (report !== null && report.accepted === 0 && report.refused === 0) return { id, ...NOT_MEASURED("the composition report was written before this gate's requests arrived (accepted 0, refused 0), so its counters cannot answer whether the authorised batch landed") }
    const surface = kernel.surface ?? null
    const ledgerAfter = kernel.ledger?.afterLanding ?? null
    const writers = Array.isArray(surface?.relayWriters) ? surface.relayWriters : []
    const detail = 'authorised=' + show(right) + '; report=' + show(report) + '; records in its ledger=' + show(surface?.relayRecords) + ' writers=' + show(writers) + '; ledger file=' + show(ledgerAfter) + '; counts=' + show(surface?.relayCounts)
    const ok = right.status === 200 && right.ok === true && right.appended === BATCH.records.length
      && report !== null && report.accepted === 1 && report.refused === 2 && report.lastCode === (kernel.posts?.wrongToken?.code ?? 'UNAUTHORIZED')
      && surface?.relayRecords === BATCH.records.length
      && writers.includes(PEER.writer + '/' + PEER.instance)
      && ledgerAfter !== null && ledgerAfter.lines === BATCH.records.length
    if (ok) return { id, ...OK(detail + ' - landed exactly once and the composition agrees with what this gate sent') }
    return { id, ...BAD(detail + ' - the authorised batch did not land as one applied batch the composition counts (expected status 200, appended ' + String(BATCH.records.length) + ', accepted 1, refused 2, lastCode UNAUTHORIZED, records ' + String(BATCH.records.length) + ', writer ' + PEER.writer + '/' + PEER.instance + ')') }
  })())

  // --- c: restored, and every process named --------------------------------------------------------
  readings.push((() => {
    const id = 'c-restored-and-every-process-named'
    if (exit === null) return { id, ...NOT_MEASURED('the exit fingerprint was never taken') }
    if (world === null || world.ok !== true) return { id, ...NOT_MEASURED('the live world was not read, so this gate has no restored state to report: ' + String(world?.why ?? 'no reading was taken')) }
    if (boot === null || boot.ok !== true) return { id, ...NOT_MEASURED('the live boot log was not read, so the append-only comparison across the run does not exist') }
    const problems = []
    if ((exit.restarts ?? []).length > 0) problems.push('this gate restarted ' + exit.restarts.join(', ') + ' - it may not restart anything')
    const changedFiles = (exit.files ?? []).filter((row) => row.same !== true && row.kind !== 'boot')
    if (changedFiles.length > 0) problems.push('files this gate found and did not leave as found: ' + changedFiles.map((row) => row.path + ' (' + String(row.before?.sha256 ?? 'absent').slice(0, 12) + ' -> ' + String(row.after?.sha256 ?? 'absent').slice(0, 12) + ')').join('; '))
    if (exit.bootPrefix?.prefixOk !== true) problems.push('the live boot log was not append-only across the run (' + show(exit.bootPrefix) + ')')
    if (exit.ledger?.same !== true) problems.push('the live collab ledger moved across the run (' + show(exit.ledger) + ')')
    if (exit.homeRemoved !== true) problems.push('the throwaway kernel home was not removed (' + show(exit.homeRemoved) + ')')
    if (exit.leaseReleased !== true) problems.push('the single-run lease was not released')
    const named = 'started ' + show(exit.started ?? []) + ', stopped ' + show(exit.stopped ?? []) + ', restarted ' + show(exit.restarts ?? []) + '; client ' + String(exit.client) + ' (was ' + String(entry?.client) + '); live kernel pid ' + show(exit.kernel?.pid) + ' (was ' + show(entry?.kernel?.pid) + ')'
    const detail = 'live files compared=' + String((exit.files ?? []).length) + ' (all unchanged: ' + String((exit.files ?? []).every((row) => row.same === true || row.kind === 'boot') && exit.bootPrefix?.prefixOk === true) + '); live ledger ' + show(exit.ledger) + '; throwaway home removed=' + show(exit.homeRemoved) + '; lease released=' + show(exit.leaseReleased) + '; ' + named
    if (problems.length === 0) return { id, ...OK(detail) }
    return { id, ...BAD(detail + ' - ' + problems.join('; ')) }
  })())

  return readings
}

const printReadings = (readings) => {
  for (const reading of readings) {
    const word = reading.notMeasured === true ? 'NOT MEASURED' : (reading.ok === true ? 'ok' : 'FAIL')
    console.log('  ' + pad(word, 13) + '  ' + reading.id + ' — ' + reading.detail)
  }
}

const exitCode = (readings) => {
  if (readings.some((reading) => reading.ok !== true && reading.notMeasured !== true)) return 1
  if (readings.some((reading) => reading.notMeasured === true)) return 3
  return 0
}

const report = (readings) => {
  const failed = readings.filter((reading) => reading.ok !== true && reading.notMeasured !== true)
  const notMeasured = readings.filter((reading) => reading.notMeasured === true)
  const held = readings.filter((reading) => reading.ok === true)
  console.log('')
  console.log(readings.length + ' readings, ' + String(held.length) + ' held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured')
  if (failed.some((reading) => reading.id.startsWith('a-')) === true) {
    console.log('where the product would have to say it: ' + PRODUCT_SILENCE)
  }
  console.log('exit ' + String(exitCode(readings)))
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Every file this gate read before it started and compares after it stopped. */
const liveFilePaths = (world) => {
  const paths = [world.bootPath, world.profile.packagePath, world.plugin.modulePath, world.plugin.configPath, world.liveLedgerPath, ...world.relay.layers.map((layer) => layer.path)]
  const unique = []
  for (const path of paths) {
    if (path === null || path === undefined || path === '') continue
    if (unique.some((one) => one.toLowerCase() === path.toLowerCase()) === false) unique.push(path)
  }
  return unique
}

const sha256OfPrefix = (path, bytes) => {
  try {
    const buffer = readFileSync(path)
    return sha256(buffer.subarray(0, bytes))
  } catch {
    return null
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/gu, '-')

const main = async () => {
  if (REPLAY_PATH !== null) {
    const replay = readJson(resolve(REPLAY_PATH))
    if (replay.ok !== true) {
      console.error('[gate] the transcript at ' + resolve(REPLAY_PATH) + ' is not readable (' + replay.why + ')')
      process.exit(3)
    }
    console.log('[gate] --replay ' + resolve(REPLAY_PATH) + ' — the recorded facts are re-judged; no kernel is booted, no request sent, no process touched')
    const readings = judge(replay.value)
    printReadings(readings)
    report(readings)
    process.exit(exitCode(readings))
  }

  const missing = []
  if (existsSync(PROBE_RUNNER) !== true) missing.push('the kernel-surface runner is not at ' + PROBE_RUNNER)
  if (existsSync(SURFACE_PROBE) !== true) missing.push('the surface probe package is not at ' + SURFACE_PROBE)
  if (existsSync(join(KERNEL_CHECKOUT, 'apps', 'cli', 'src', 'bin.ts')) !== true) missing.push('the kernel checkout entry is not at ' + join(KERNEL_CHECKOUT, 'apps', 'cli', 'src', 'bin.ts'))
  if (existsSync(join(PLUGIN_DIR, 'lib', 'index.js')) !== true) missing.push('the collab plugin is not built at ' + join(PLUGIN_DIR, 'lib', 'index.js'))
  if (missing.length > 0) {
    console.error('[gate] the instrument is missing: ' + missing.join('; '))
    process.exit(2)
  }

  const transcript = {
    schema: 'r203-p2-transcript/1',
    startedAt: new Date().toISOString(),
    gate: SELF_FILE,
    project: PROJECT,
    deadlineMs: DEADLINE_MS,
    notes: [],
    problems: [],
    lease: null,
    guard: null,
    entry: { at: new Date().toISOString(), client: null, kernel: null, kernelAlive: null, files: [] },
    world: null,
    boot: null,
    kernel: null,
    exit: null,
  }

  console.log('[gate] R203 P2 collab-relay-bound-live — one live read (boot log + composition config) and one real kernel (row config relay.token, three requests)')

  try {
    transcript.lease = claimLease()
    if (transcript.lease.ok !== true) {
      transcript.world = { ok: false, why: 'the single-run lease was refused: ' + String(transcript.lease.why) }
    } else {
      const rows = nodeProcesses()
      const live = liveRegister()
      const ancestors = ancestorPids()
      transcript.guard = { liveFiles: live.files, registerParsed: live.parsed, parseNote: live.why ?? null, ancestors, others: [], nodeProcesses: rows.rows.length }
      transcript.entry.client = clientIdentity()
      if (rows.ok !== true) {
        transcript.world = { ok: false, why: String(rows.why) }
      } else {
        transcript.guard.others = otherConsumers(rows.rows, live, ancestors)
        const liveKernel = findLiveKernel(rows.rows)
        transcript.entry.kernel = liveKernel
        transcript.entry.kernelAlive = await portAnswers(KERNEL_PORT)
        transcript.world = resolveLiveWorld(liveKernel)
        if (transcript.world.ok === true) {
          transcript.boot = scanBoot(transcript.world.bootPath)
          transcript.entry.files = liveFilePaths(transcript.world).map((path) => ({ path, kind: path.toLowerCase() === transcript.world.bootPath.toLowerCase() ? 'boot' : 'file', before: fileFacts(path) }))
          console.log('[gate] live kernel pid ' + String(liveKernel.pid) + ' (port ' + String(liveKernel.port) + ', patches ' + show(liveKernel.patches) + ') home ' + transcript.world.kernelHome)
          if (transcript.boot.ok === true) {
            console.log('[gate] live boot log ' + transcript.boot.path + ' (' + String(transcript.boot.bytes) + ' bytes, mtime ' + transcript.boot.mtime + ', section lines ' + String(transcript.boot.section.from + 1) + '-' + String(transcript.boot.section.from + transcript.boot.section.lines) + ')')
            console.log('[gate] live boot log lines about the collab row: ' + show((transcript.boot.collabLines ?? []).map((row) => row.text)))
            console.log('[gate] live boot log lines that name the relay: ' + show((transcript.boot.relayLines ?? []).map((row) => row.text)))
          } else {
            console.log('[gate] live boot log unreadable: ' + String(transcript.boot.why))
          }
          console.log('[gate] live composition relay.token configured: ' + String(transcript.world.relay.tokenConfigured) + '; layers read: ' + layoutLines(transcript.world.relay.layers))
        } else {
          console.log('[gate] the live world was not read: ' + String(transcript.world.why))
        }
      }
    }
  } catch (error) {
    transcript.problems.push('the gate stopped on an unexpected error before the kernel arm: ' + describe(error))
  }

  if (transcript.world?.ok === true && transcript.guard?.others?.length > 0) {
    transcript.notes.push('NOT MEASURED in the world: another live consumer is running (' + transcript.guard.others.join(' | ') + '), so this gate did not boot its own kernel')
  }
  if (transcript.world?.ok === true && transcript.entry.kernel === null) {
    transcript.notes.push('NOT MEASURED in the world: no live kernel process on port ' + String(KERNEL_PORT) + ' was named, so the live half of the question has nothing to read')
  }

  const measurable = transcript.world?.ok === true
    && transcript.boot?.ok === true
    && (transcript.guard?.others ?? []).length === 0
    && transcript.entry.client !== null
    && transcript.entry.kernel !== null
    && transcript.entry.kernelAlive === true
  if (measurable === true) {
    try {
      transcript.kernel = await runComposition()
      console.log('[gate] throwaway kernel pid ' + String(transcript.kernel.kernelPid) + ' on port ' + String(transcript.kernel.port) + ', home ' + String(transcript.kernel.home) + ', bound line ' + JSON.stringify(transcript.kernel.boundLine))
      console.log('[gate] posts: ' + show(transcript.kernel.posts))
      console.log('[gate] composition report: relay=' + show(transcript.kernel.surface?.relay) + ' records=' + show(transcript.kernel.surface?.relayRecords) + ' writers=' + show(transcript.kernel.surface?.relayWriters))
    } catch (error) {
      transcript.problems.push('the kernel arm stopped on an unexpected error: ' + describe(error))
    }
  } else if (transcript.world?.ok === true) {
    transcript.notes.push('NOT MEASURED in the world: the token-configured kernel was not booted, so b1/b2/b3 have no composition to read')
  }

  // The exit fingerprint: what the gate found, what it left, and every process it may have touched.
  transcript.exit = {
    at: new Date().toISOString(),
    client: clientIdentity(),
    kernel: null,
    kernelAlive: await portAnswers(KERNEL_PORT),
    files: [],
    bootPrefix: null,
    ledger: null,
    homeRemoved: transcript.kernel?.homeRemoved ?? null,
    leaseReleased: null,
    started: [],
    stopped: [],
    restarts: [],
  }
  try {
    const rows = nodeProcesses()
    if (rows.ok === true) transcript.exit.kernel = findLiveKernel(rows.rows)
  } catch (error) {
    transcript.problems.push('the exit process list could not be read: ' + describe(error))
  }
  transcript.exit.files = (transcript.entry.files ?? []).map((row) => {
    const after = fileFacts(row.path)
    return { path: row.path, kind: row.kind, before: row.before, after, same: row.before?.sha256 === after?.sha256 && row.before?.ok === after?.ok }
  })
  const bootRow = transcript.exit.files.find((row) => row.kind === 'boot') ?? null
  if (bootRow !== null && bootRow.before?.ok === true) {
    transcript.exit.bootPrefix = {
      beforeBytes: bootRow.before.bytes,
      afterBytes: bootRow.after?.bytes ?? null,
      prefixSha256: sha256OfPrefix(bootRow.path, bootRow.before.bytes),
      beforeSha256: bootRow.before.sha256,
      prefixOk: sha256OfPrefix(bootRow.path, bootRow.before.bytes) === bootRow.before.sha256 && (bootRow.after?.bytes ?? 0) >= bootRow.before.bytes,
    }
  }
  const ledgerRow = transcript.exit.files.find((row) => row.path.toLowerCase() === String(transcript.world?.liveLedgerPath ?? '').toLowerCase()) ?? null
  transcript.exit.ledger = ledgerRow === null ? { same: true, note: 'the live ledger was not part of the compared set' } : { path: ledgerRow.path, before: ledgerRow.before, after: ledgerRow.after, same: ledgerRow.same === true }
  transcript.exit.leaseReleased = releaseLease()

  const probePid = transcript.kernel?.probe?.pid ?? null
  const kernelPid = transcript.kernel?.kernelPid ?? null
  if (probePid !== null) {
    transcript.exit.started.push('probe-kernel-surface.mjs pid ' + String(probePid))
    transcript.exit.stopped.push('probe-kernel-surface.mjs pid ' + String(probePid) + ' (exit ' + String(transcript.kernel?.probe?.exit) + ')')
  }
  if (kernelPid !== null) {
    transcript.exit.started.push('the throwaway kernel pid ' + String(kernelPid))
    transcript.exit.stopped.push('the throwaway kernel pid ' + String(kernelPid) + (pidAlive(kernelPid) === true ? ' (STILL ALIVE)' : ' (gone)'))
  }
  if (transcript.entry.client !== null && transcript.exit.client !== null && transcript.entry.client !== transcript.exit.client) {
    transcript.exit.restarts.push('the desktop client ' + String(transcript.entry.client) + ' -> ' + String(transcript.exit.client))
  }
  if (transcript.entry.kernel?.pid !== undefined && transcript.exit.kernel?.pid !== undefined && transcript.entry.kernel.pid !== transcript.exit.kernel.pid) {
    transcript.exit.restarts.push('the live kernel pid ' + String(transcript.entry.kernel.pid) + ' -> ' + String(transcript.exit.kernel.pid))
  }

  const readings = judge(transcript)
  printReadings(readings)
  report(readings)
  try {
    mkdirSync(SCRATCH, { recursive: true })
    const path = DUMP_OPTION === null ? join(SCRATCH, 'transcript-' + stamp() + '.json') : resolve(DUMP_OPTION)
    writeFileSync(path, JSON.stringify(transcript, null, 1) + '\n', 'utf8')
    console.log('the judged record: ' + path + ' (re-judge it with --replay ' + path + ')')
  } catch (error) {
    console.error('[gate] the transcript could not be written (' + describe(error) + ')')
  }
  if ((transcript.problems ?? []).length > 0) {
    for (const problem of transcript.problems) console.log('[gate] problem: ' + problem)
  }
  if ((transcript.notes ?? []).length > 0) {
    for (const note of transcript.notes) console.log('[gate] note: ' + note)
  }
  process.exit(exitCode(readings))
}

await main()
