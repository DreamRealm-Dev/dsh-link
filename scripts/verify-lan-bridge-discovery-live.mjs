#!/usr/bin/env node
/**
 * Gate 203-P1 (R203) - lan-bridge-discovery-live: WHAT THE RUNNING CLIENT SAYS ABOUT ITS OWN DEVICE DISCOVERY.
 *
 * Subject: the lan-bridge device-discovery claim in the LIVE boot log
 *   %APPDATA%/dev.dshlink.client/dsh-link/kernel-home/boot.log
 * (read WHOLE, once per poll, never by offset: the client REWRITES this file when it starts and APPENDS to it
 * afterwards - lib/core/log.js:29-37 writes every plugin line here - so the file IS one boot session).
 * The producer is plugins/dsh-lan-bridge: lib/core/discovery.js:310-326 (per-NIC multicast egress, one
 * attempt per NIC per announce, failure logged, success silent), :251-263 (announce = multicast per NIC +
 * one loopback unicast send), :455 (the bind callback that prints "discovery listening on ... (addresses)"),
 * lib/core/service.js:1642 (the claim line) and lib/core/rpc.js:349/498/548/584 (the ui carriers).
 *
 * THE WORLD IS NOT THIS GATE'S TO REBUILD. The desktop client and its kernel are already running; this gate
 * NEVER starts, stops, restarts or reloads either of them, and it never binds, closes or reconfigures ports
 * 31760 / 31761 / 9222. It takes the SINGLE-RUN LEASE the other live gates take (POST /__shell/panel
 * leaseOp=claim, scripts/panel-lease.mjs) so a second live consumer cannot drive the same client at the same
 * time; a busy lease is retried and then exits 3 naming the holder. Its only writes are its own transcript,
 * plus a SCRATCH directory for the one child process it starts and kills.
 *
 * READINGS (each independently failable, printed with the raw numbers it was taken from):
 *   01 THE SUBJECT IS LIVE, THE LOG WAS READ WHOLE, AND THIS GATE HOLDS THE SINGLE-RUN LEASE. The lease is
 *      claimed under this gate's own holder, GET /dsh-lan-bridge/health answers 200 on the kernel origin
 *      and names the same role the boot log claims, the three "host ui carrier:" lines are corroborated by
 *      health.carriers, the boot log was read in one whole-file read (bytes + line count + sha256), and the
 *      client/kernel pids are read.
 *   02 (a) EVERY NIC THE SERVICE ANNOUNCES FROM HAS ITS RESULT RECORDED BY NAME. The address set comes from
 *      the service's own bind line; every non-loopback address must carry a result line for an announcement
 *      the socket could actually make (a line emitted AFTER the bind), and the announce's second delivery
 *      leg (loopback unicast) must not be a silence either. A recorded result that only says "the socket was
 *      not bound yet" is not a NIC result.
 *   03 (b) A SECOND INSTANCE ON THIS MACHINE IS SEEN WITHIN 30 s, AND THE PATH THAT SAW IT IS NAMED. This
 *      gate starts one child process - the plugin's own bridge service (lib/core/service.js), its own fresh
 *      identity and data dir, role bridge, port 0 (README: the second instance takes a random TCP port and
 *      the announce carries the real one) - and waits for the live host to log it by device id. The log
 *      names the address it arrived from, which names the leg (loopback unicast vs multicast per NIC). It is
 *      the plugin's service in its own process, not a second desktop client: no window, no shell, no port
 *      of the client's is touched.
 *   04 (c) THE ANNOUNCEMENT discoverable=true IS SUPPORTED BY AT LEAST ONE RECORDED EGRESS. The claim is
 *      cross-checked against the per-NIC results in the same boot: a claim with no recorded working egress
 *      is RED. (This reading is EXPECTED TO BE RED on the machine that motivated the round.)
 *   05 (d) THE NOTHING-DISCOVERABLE STATE IS NAMED, NOT A RED. When the boot says discoverable=false (or
 *      there is no NIC to announce from) the gate prints STATE NOTHING-DISCOVERABLE and exits 3 - but only
 *      after (a) and (c) were judged on the same facts.
 *   06 THE WORLD IS BACK: the child process is gone, the lease is released, the boot log still carries the
 *      same claim line and the peer line, and the kernel pid and carrier set are unchanged.
 *
 * --replay <file> re-judges a transcript this gate wrote and touches NOTHING (no lease, no HTTP, no child
 * process, no boot-log read); --replay with no file re-judges the newest transcript under the scratch path.
 * The transcript (the only file this gate writes, plus the peer's own log under the same scratch) goes to
 * .tmp/r203-p1/<stamp>/lan-bridge-discovery-live.json.
 *
 * WHAT THIS GATE CANNOT JUDGE, named so nobody reads a green as more than it is: whether a NIC marked
 * "unavailable" really cannot carry multicast (the record cannot say - that is reading 02's subject);
 * whether the claim was true when it was made (the gate measures the record, not the radio); whether the
 * live client toggled discoverability after boot (setDiscoverable writes no log line - service.js:1677-1684
 * - so a post-boot toggle is invisible here); whether another machine on the LAN sees this one; whether a
 * second DESKTOP CLIENT on this machine would be seen (this gate's peer is the plugin's service process,
 * which is the same announce path but not the same process shape); and whether the UI draws any of this
 * (no pixel is read).
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a reading could not be measured (the lease never came
 * free, the kernel health endpoint or its boot log is not readable, the live role does not match the log, no
 * peer could be started, a transcript to replay is missing/unreadable) OR the named state
 * NOTHING-DISCOVERABLE (this machine announces nothing) with (a) and (c) holding.
 *
 * Usage: node scripts/verify-lan-bridge-discovery-live.mjs [--port 31761] [--kernel-port 31760]
 *          [--boot <path>] [--peer-wait-ms 30000] [--lease-wait-ms 120000] [--replay [file]]
 *          [--scratch <dir>]
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { claimLease, panelPost, releaseLease } from './panel-lease.mjs'

/** The project root: found by walking up to the tree that owns the kernel and the plugins. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'core', 'deepseek-harness', 'package.json')) && existsSync(join(at, 'plugins'))) return at
    const up = resolve(at, '..')
    if (up === at) break
    at = up
  }
  return resolve(HERE, '..')
})()

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  if (at === -1) return fallback
  const next = argv[at + 1]
  return next === undefined || next.startsWith('--') ? fallback : next
}
const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const PEER_WAIT_MS = Number(option('--peer-wait-ms', '30000'))
const LEASE_WAIT_MS = Number(option('--lease-wait-ms', '120000'))
const POLL_MS = 250
const REPLAY = has('--replay') ? (option('--replay', null) ?? 'latest') : null
const SCRATCH = resolve(option('--scratch', join(PROJECT, '.tmp', 'r203-p1')))
/** One stamp for the whole run, so the transcript and the child instance's scratch sit together. */
const RUN_STAMP = new Date().toISOString().replace(/[:.]/gu, '-')
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const KERNEL_ORIGIN = 'http://127.0.0.1:' + String(KERNEL_PORT)
const HEALTH_PATH = '/dsh-lan-bridge/health'

/** The live boot log, unless the caller names another one (a replay world or a copied log). */
const BOOT_PATH = resolve(option('--boot', join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'dev.dshlink.client', 'dsh-link', 'kernel-home', 'boot.log')))

const PLUGIN_DIR = join(PROJECT, 'plugins', 'dsh-lan-bridge')
const SERVICE_MODULE = join(PLUGIN_DIR, 'lib', 'core', 'service.js')
/** The node that runs the child instance: this process when it IS node, else node from PATH (a harness host is not one). */
const NODE_BIN = (() => {
  const base = String(process.execPath).replace(/\\/gu, '/').split('/').pop().toLowerCase()
  return base === 'node.exe' || base === 'node' ? process.execPath : (process.env.DSH_NODE ?? 'node')
})()

const GATE = 'gate-203-p1-lan-bridge-discovery-live'
const GATE_HOLDER = GATE
const SCHEMA = 'r203-p1-lan-bridge-discovery-live/1'
const PEER_SCHEMA = 'r203-p1-lan-bridge-discovery-peer/1'
/** The child service self-terminates after this, so a gate that dies cannot leave an instance behind. */
const PEER_LIFETIME_MS = 180000
/** The window the contract names for a same-machine peer to appear. */
const SEEN_WITHIN_MS = 30000
const LOOPBACK = '127.0.0.1'

const READING_IDS = [
  '01-the-subject-is-live-the-log-was-read-whole-and-this-gate-holds-the-single-run-lease',
  '02-a--every-nic-the-service-announces-from-has-its-result-recorded-by-name',
  '03-b--a-second-instance-on-this-machine-is-seen-within-30s-with-the-path-that-saw-it-named',
  '04-c--the-announcement-discoverable-true-is-supported-by-at-least-one-recorded-egress',
  '05-d--the-nothing-discoverable-state-is-named-not-a-red',
  '06-the-world-is-back-the-peer-is-gone-the-lease-is-released',
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const show = (value) => { try { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text } catch { return String(value) } }
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const clip = (text, n) => { const out = String(text === null || text === undefined ? '' : text); return out.length > n ? out.slice(0, n) + '...' : out }
const NOT_MEASURED = (why) => { console.log(''); console.log('SKIP (not measured): ' + why); console.log('STATE NOT-MEASURED (exit 3): ' + why); return 3 }
const quote = (line) => (line === null || line === undefined ? '(none)' : String(line.text))

// ---------------------------------------------------------------------------
// The boot log: one whole-file read, decoded with replacement so a torn byte is a fact, not a crash.
// ---------------------------------------------------------------------------
const readBootWhole = (path) => {
  let buffer = null
  try {
    buffer = readFileSync(path)
  } catch (error) {
    return { ok: false, why: 'the boot log at ' + path + ' is not readable (' + describe(error) + ')' }
  }
  const text = buffer.toString('utf8')
  const rows = text.split(/\r?\n/)
  const trailing = rows.length > 0 && rows[rows.length - 1] === ''
  const lines = trailing ? rows.slice(0, -1) : rows
  let invalid = 0
  for (const ch of text) if (ch === '\uFFFD') invalid += 1
  return {
    ok: true,
    why: null,
    path,
    bytes: buffer.length,
    lines,
    lineCount: lines.length,
    invalidUtf8: invalid,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    readAt: new Date().toISOString(),
    readWhole: true,
  }
}

// ---------------------------------------------------------------------------
// Parsing: the shapes the producer actually emits (lib/core/discovery.js, lib/core/service.js, rpc.js).
// The success shape is deliberately NOT hard-coded to one wording: any "multicast egress via <ip> ..."
// line that does not say "unavailable" is read as a recorded working egress, so a fixed producer turns
// readings 02/04 green without editing this gate.
// ---------------------------------------------------------------------------
const TAG = '[dsh-lan-bridge] '
const CLAIM_RE = /^\[dsh-lan-bridge\] host service started role=(\S+) discoverable=(true|false) port=(\d+) data=(.*)$/u
const LISTEN_RE = /^\[dsh-lan-bridge\] host\/discovery discovery listening on (\d+\.\d+\.\d+\.\d+):(\d+) \((.*)\)$/u
// R203: the loopback leg is an egress leg too, and the producer names it as one - accepting both labels here
// keeps the parser from requiring the loopback leg to be spelled as a multicast send. The success/failure rule is
// unchanged: "unavailable" is a failure, anything else is a recorded send.
const EGRESS_RE = /^\[dsh-lan-bridge\] host\/discovery (?:multicast|loopback) egress via (\d+\.\d+\.\d+\.\d+) (.+)$/u
const JOIN_RE = /^\[dsh-lan-bridge\] host\/discovery multicast join on (\d+\.\d+\.\d+\.\d+) skipped\b(.*)$/u
const PEER_RE = /^\[dsh-lan-bridge\] host\/discovery peer (.*) \(([A-Z0-9]+)\) at (\d+\.\d+\.\d+\.\d+):(\d+)$/u
const CARRIER_RE = /^\[dsh-lan-bridge\] host ui carrier: (.+)$/u
const READY_RE = /^\[dsh-lan-bridge\] host ready — device (\S+) \((.*)\), ui carriers: (\{.*\})$/u
const LOOPBACK_RESULT_RE = /(egress|unicast|loopback|announce).*127\.0\.0\.1|127\.0\.0\.1.*(egress|unicast|loopback|announce)/iu

const parseBoot = (boot) => {
  const claims = []
  const listens = []
  const egress = []
  const joins = []
  const carriers = []
  const ready = []
  const peersById = new Map()
  let peerLines = 0
  const unexpected = []
  for (let index = 0; index < boot.lines.length; index += 1) {
    const text = boot.lines[index]
    const lineNumber = index + 1
    if (text.startsWith('[dsh-lan-bridge]') !== true) continue
    let row = null
    if ((row = CLAIM_RE.exec(text)) !== null) { claims.push({ line: lineNumber, text, role: row[1], discoverable: row[2] === 'true', port: Number(row[3]), data: row[4] }); continue }
    if ((row = LISTEN_RE.exec(text)) !== null) { listens.push({ line: lineNumber, text, group: row[1], port: Number(row[2]), addresses: row[3].split(',').map((one) => one.trim()).filter((one) => one !== '') }); continue }
    if ((row = EGRESS_RE.exec(text)) !== null) { egress.push({ line: lineNumber, text, address: row[1], detail: row[2], kind: /unavailable/iu.test(row[2]) ? 'unavailable' : 'worked' }); continue }
    if ((row = JOIN_RE.exec(text)) !== null) { joins.push({ line: lineNumber, text, address: row[1], detail: row[2] }); continue }
    if ((row = PEER_RE.exec(text)) !== null) {
      peerLines += 1
      const entry = peersById.get(row[2]) ?? { deviceId: row[2], name: row[1], count: 0, lines: [] }
      entry.count += 1
      entry.name = row[1]
      entry.lines.push({ line: lineNumber, text, address: row[3], port: Number(row[4]) })
      peersById.set(row[2], entry)
      continue
    }
    if ((row = CARRIER_RE.exec(text)) !== null) { carriers.push({ line: lineNumber, text, what: row[1].trim() }); continue }
    if ((row = READY_RE.exec(text)) !== null) { ready.push({ line: lineNumber, text, deviceId: row[1], deviceName: row[2], carriers: row[3] }); continue }
    if (/host\/(discovery|link)|host (service|ui carrier|ready|device)/u.test(text)) unexpected.push({ line: lineNumber, text })
  }
  return { claims, listens, egress, joins, carriers, ready, peersById, peerLines, unexpected }
}

/**
 * The facts reading 02/04 judge, derived once from the whole log and stored in the transcript so --replay
 * re-judges the same numbers without reading anything.
 */
const derive = (parsed) => {
  const claim = parsed.claims.length === 0 ? null : parsed.claims[parsed.claims.length - 1]
  // The bind line that belongs to this claim: the first one after it, else the last one on record.
  const claimLine = claim === null ? 0 : claim.line
  const after = parsed.listens.filter((one) => one.line > claimLine)
  const governing = after.length > 0 ? after[0] : (parsed.listens.length > 0 ? parsed.listens[parsed.listens.length - 1] : null)
  const bindLine = governing === null ? null : governing.line
  const addresses = governing === null ? [] : governing.addresses
  const attempts = addresses.filter((address) => address !== LOOPBACK)
  const perNic = attempts.map((address) => {
    const rows = parsed.egress.filter((one) => one.address === address)
    return {
      address,
      recorded: rows.length,
      worked: rows.filter((one) => one.kind === 'worked').length,
      unavailable: rows.filter((one) => one.kind === 'unavailable').length,
      details: [...new Set(rows.map((one) => one.detail))],
      lines: rows.map((one) => ({ line: one.line, kind: one.kind, detail: one.detail, text: one.text })),
      /** True when every recorded result for this NIC predates the bind: a socket-state error, not a verdict. */
      preBind: rows.length > 0 && bindLine !== null && rows.every((one) => one.line < bindLine),
      afterBind: rows.filter((one) => bindLine !== null && one.line > bindLine).length,
    }
  })
  const loopbackResults = parsed.egress.filter((one) => one.address === LOOPBACK)
  return {
    claim: claim === null ? null : { line: claim.line, text: claim.text, role: claim.role, discoverable: claim.discoverable, port: claim.port, data: claim.data },
    claims: parsed.claims.length,
    listen: governing === null ? null : { line: governing.line, text: governing.text, group: governing.group, port: governing.port, addresses: governing.addresses },
    listens: parsed.listens.length,
    bindLine,
    addresses,
    attempts,
    perNic,
    recorded: perNic.reduce((sum, one) => sum + one.recorded, 0),
    worked: perNic.reduce((sum, one) => sum + one.worked, 0),
    unavailable: perNic.reduce((sum, one) => sum + one.unavailable, 0),
    preBind: perNic.filter((one) => one.preBind).length,
    loopbackResults: loopbackResults.length,
    joins: parsed.joins.length,
    joinLines: parsed.joins,
    carriers: parsed.carriers.map((one) => ({ line: one.line, text: one.text, what: one.what })),
    ready: parsed.ready.length === 0 ? null : parsed.ready[parsed.ready.length - 1],
    peerLines: parsed.peerLines,
    peerDevices: parsed.peersById.size,
    unexpected: parsed.unexpected.slice(0, 12),
  }
}

// ---------------------------------------------------------------------------
// The world: one read-only health GET on the kernel origin, and the client/kernel pids.
// ---------------------------------------------------------------------------
const httpGet = async (url, timeoutMs = 10000) => {
  try {
    const answer = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const text = await answer.text()
    return { ok: true, status: answer.status, text, why: null }
  } catch (error) {
    return { ok: false, status: 0, text: '', why: describe(error) }
  }
}

const readHealth = async () => {
  const answer = await httpGet(KERNEL_ORIGIN + HEALTH_PATH)
  let body = null
  try { body = JSON.parse(answer.text) } catch (error) { body = null }
  const value = body !== null && typeof body === 'object' && body.value !== null && typeof body.value === 'object' ? body.value : null
  return {
    status: answer.status,
    why: answer.why,
    plugin: value === null ? null : (value.plugin ?? null),
    role: value === null ? null : (value.role ?? null),
    accepts: value === null ? null : (value.accepts ?? null),
    carriers: value === null ? null : (value.carriers ?? null),
    pid: value === null ? null : (value.pid ?? null),
    node: value === null ? null : (value.node ?? null),
    hostBuild: value === null ? null : (value.hostBuild ?? null),
  }
}

const pwsh = (command, timeout = 20000) => {
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout, windowsHide: true })
  if (done.error !== undefined && done.error !== null) return { ok: false, why: describe(done.error), rows: [] }
  if (done.status !== 0) return { ok: false, why: clip(String(done.stderr ?? '').trim() || 'pwsh exited ' + String(done.status), 240), rows: [] }
  return { ok: true, why: null, rows: String(done.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '') }
}

const pidFingerprint = () => {
  const query = [
    '$rows = @()',
    'foreach ($port in @(' + [PORT, KERNEL_PORT].join(',') + ')) {',
    '  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if ($conn -eq $null) { $rows += ($port.ToString() + "||"); continue }',
    '  $procName = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName',
    '  $rows += ($port.ToString() + "|" + $conn.OwningProcess.ToString() + "|" + $procName)',
    '}',
    '$rows -join ([string][char]10)',
  ].join('\n')
  const done = pwsh(query)
  if (done.ok !== true) return { ok: false, why: done.why, rows: [] }
  const rows = done.rows.map((line) => {
    const [port, pid, name] = line.split('|')
    return { port: Number(port), pid: pid === '' ? null : Number(pid), name: name === '' ? null : name }
  })
  return { ok: true, why: null, rows }
}
const pidOf = (fingerprint, port) => {
  const row = (fingerprint?.rows ?? []).find((one) => one.port === port) ?? null
  return row === null || row.pid === null ? null : row
}
const pidText = (row) => (row === null ? '(not read)' : 'pid ' + String(row.pid) + ' ' + String(row.name))

/** True when nothing accepts on this loopback port any more (the child's listener is gone). */
const portClosed = async (port) => {
  if (typeof port !== 'number' || port <= 0) return null
  return await new Promise((done) => {
    const socket = net.connect({ port, host: LOOPBACK })
    const finish = (value) => { try { socket.destroy() } catch (error) { /* already gone */ } done(value) }
    socket.setTimeout(1500)
    socket.once('connect', () => finish(false))
    socket.once('error', () => finish(true))
    socket.once('timeout', () => finish(false))
  })
}
/** Wait for the listener to be gone: a terminated process releases its socket a moment later on Windows. */
const waitClosed = async (port, deadlineMs = 6000) => {
  if (typeof port !== 'number' || port <= 0) return { closed: null, afterMs: null }
  const started = Date.now()
  let last = null
  while (Date.now() - started < deadlineMs) {
    last = await portClosed(port)
    if (last === true) return { closed: true, afterMs: Date.now() - started }
    await sleep(200)
  }
  return { closed: last === true, afterMs: Date.now() - started }
}

const processAlive = (pid) => {
  if (typeof pid !== 'number' || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// ---------------------------------------------------------------------------
// The transcript.
// ---------------------------------------------------------------------------
const transcript = {
  schema: SCHEMA,
  gate: GATE,
  at: new Date().toISOString(),
  args: { port: PORT, kernelPort: KERNEL_PORT, boot: BOOT_PATH, peerWaitMs: PEER_WAIT_MS, leaseWaitMs: LEASE_WAIT_MS },
  subject: { bootPath: BOOT_PATH, bytes: null, lineCount: null, sha256: null, invalidUtf8: null, readAt: null, readWhole: null, derived: null, firstLine: null, lastLine: null },
  world: { entry: null, exit: null },
  lease: { claimed: null, holder: GATE_HOLDER, attempts: 0, waitMs: null, refusedDetail: null, entryHolder: null, released: null, exit: null },
  peer: { started: null, pid: null, spawnedAtMs: null, ready: null, seen: null, seenAfterMs: null, seenWithinMs: null, killed: null, pidGone: null, listenerClosed: null, listenerClosedAfterMs: null, addresses: [], lines: [], identity: null, logLines: [], logTail: [], dataDir: null, why: null },
  bootAtExit: null,
  problems: [],
}

const writeTranscript = () => {
  const dir = join(SCRATCH, RUN_STAMP)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'lan-bridge-discovery-live.json')
  writeFileSync(path, JSON.stringify(transcript, null, 2))
  return path
}
const newestTranscript = () => {
  if (existsSync(SCRATCH) !== true) return null
  for (const stamp of readdirSync(SCRATCH).sort().reverse()) {
    const candidate = join(SCRATCH, stamp, 'lan-bridge-discovery-live.json')
    if (existsSync(candidate)) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// The child peer: the plugin's own service, its own identity, its own data dir, port 0 (README: it falls
// back to a random TCP port and the announce carries the real one). It writes its identity facts to
// peer.json and its own log to peer.log, so this gate never depends on pipe capture.
// ---------------------------------------------------------------------------
const startPeer = () => {
  const peerDir = join(SCRATCH, RUN_STAMP, 'peer')
  mkdirSync(peerDir, { recursive: true })
  const code = [
    "import fs from 'node:fs'",
    "import path from 'node:path'",
    'const OUT = ' + JSON.stringify(peerDir),
    'const write = (line) => { try { fs.appendFileSync(path.join(OUT, "peer.log"), line + "\\n") } catch (error) { /* the log is evidence, never a dependency */ } }',
    'const makeLog = (scope) => ({',
    '  info: (message, extra) => write("[info] " + scope + " " + message + (extra === undefined ? "" : " \\u2014 " + extra)),',
    '  warn: (message, extra) => write("[warn] " + scope + " " + message + (extra === undefined ? "" : " \\u2014 " + extra)),',
    '  error: (message) => write("[error] " + scope + " " + message),',
    '  child: (sub) => makeLog(scope + "/" + sub),',
    '})',
    'const log = makeLog("peer")',
    'const fatal = (error) => { write("[fatal] " + String(error && error.stack ? error.stack : error)); process.exit(9) }',
    'const bye = (service) => { try { void service.stop().finally(() => process.exit(0)) } catch { process.exit(0) } }',
    'try {',
    '  const { createBridgeService } = await import(' + JSON.stringify(pathToFileURL(SERVICE_MODULE).href) + ')',
    '  const service = createBridgeService({',
    '    ctx: {},',
    '    config: { role: "bridge", port: 0, discoverable: true, dataDir: path.join(OUT, "data") },',
    '    log,',
    '  })',
    '  await service.start()',
    '  const snapshot = service.snapshot()',
    '  fs.writeFileSync(path.join(OUT, "peer.json"), JSON.stringify({',
    '    schema: ' + JSON.stringify(PEER_SCHEMA) + ',',
    '    deviceId: snapshot.deviceId,',
    '    deviceName: snapshot.deviceName,',
    '    port: snapshot.port,',
    '    role: snapshot.role,',
    '    discoverable: snapshot.discoverable,',
    '    accepts: snapshot.accepts,',
    '    pid: process.pid,',
    '    startedAtMs: Date.now(),',
    '    node: process.version,',
    '  }, null, 2))',
    '  write("[peer-ready] " + snapshot.deviceId + " port " + snapshot.port + " role " + snapshot.role + " discoverable " + snapshot.discoverable)',
    '  process.on("SIGTERM", () => bye(service))',
    '  process.on("SIGINT", () => bye(service))',
    '  setTimeout(() => bye(service), ' + String(PEER_LIFETIME_MS) + ')',
    '} catch (error) { fatal(error) }',
  ].join('\n')
  let child = null
  try {
    child = spawn(NODE_BIN, ['--input-type=module', '-e', code], { cwd: PROJECT, stdio: 'ignore', windowsHide: true })
  } catch (error) {
    return { ok: false, why: 'the child peer could not be spawned (' + describe(error) + ')', child: null, peerDir }
  }
  return { ok: true, why: null, child, peerDir }
}

const readJsonFile = (path) => {
  if (existsSync(path) !== true) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { return null }
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------
const takeLease = async () => {
  const started = Date.now()
  const quiet = async (fn) => {
    const real = console.log
    const lines = []
    console.log = (line) => { lines.push(String(line)) }
    try { return { value: await fn(), lines } } finally { console.log = real }
  }
  for (;;) {
    transcript.lease.attempts += 1
    const attempt = await quiet(() => claimLease(PORT, GATE_HOLDER, 240000))
    if (attempt.value === true) {
      transcript.lease.claimed = true
      transcript.lease.waitMs = Date.now() - started
      return { ok: true, why: null }
    }
    const panelState = await panelPost(PORT, { op: 'state' })
    if (panelState === null) return { ok: false, why: 'the shell panel API did not answer op=state on ' + SHELL_ORIGIN + ', so the single-run lease cannot be held' }
    const holder = panelState?.lease?.holder ?? null
    transcript.lease.entryHolder = holder
    transcript.lease.refusedDetail = clip(String((attempt.lines ?? []).slice(-1)[0] ?? 'lease held by ' + show(holder)).trim(), 240)
    if (Date.now() - started >= LEASE_WAIT_MS) {
      transcript.lease.claimed = false
      transcript.lease.waitMs = Date.now() - started
      return { ok: false, why: 'the single-run lease stayed busy for ' + String(Math.round((Date.now() - started) / 1000)) + 's: it is held by ' + show(holder) + ', and this gate does not take it from anybody' }
    }
    await sleep(1000)
  }
}

const runWorld = async () => {
  // --- the world before anything is touched -------------------------------------------------------
  const lease = await takeLease()
  if (lease.ok !== true) throw new Error('the world is not fit: ' + lease.why)
  const health = await readHealth()
  if (health.status !== 200) throw new Error('the world is not fit: GET ' + HEALTH_PATH + ' on ' + KERNEL_ORIGIN + ' answered ' + String(health.status) + ' (' + String(health.why ?? 'no body') + '), so the boot log cannot be tied to the running kernel')
  if (health.plugin !== 'dsh-lan-bridge') throw new Error('the world is not fit: GET ' + HEALTH_PATH + ' answered plugin=' + show(health.plugin) + ', not dsh-lan-bridge')
  const boot = readBootWhole(BOOT_PATH)
  if (boot.ok !== true) throw new Error('the world is not fit: ' + boot.why)
  const parsed = parseBoot(boot)
  const derived = derive(parsed)
  if (derived.claim === null) throw new Error('the boot log at ' + BOOT_PATH + ' carries no "host service started" line, so there is no claim to judge (' + String(boot.lineCount) + ' lines read whole)')
  if (derived.listen === null) throw new Error('the boot log at ' + BOOT_PATH + ' carries no "discovery listening on ..." line, so the address set the service announces from is not on record')
  if (health.role !== derived.claim.role) throw new Error('the world is not fit: the live kernel health endpoint says role=' + show(health.role) + ' and the boot log claims role=' + show(derived.claim.role) + ', so this log is not this kernel boot')
  const pids = pidFingerprint()
  transcript.subject = {
    bootPath: BOOT_PATH,
    bytes: boot.bytes,
    lineCount: boot.lineCount,
    sha256: boot.sha256,
    invalidUtf8: boot.invalidUtf8,
    readAt: boot.readAt,
    readWhole: boot.readWhole,
    firstLine: boot.lines.length > 0 ? boot.lines[0] : null,
    lastLine: boot.lines.length > 0 ? boot.lines[boot.lines.length - 1] : null,
    derived,
  }
  transcript.world.entry = {
    at: new Date().toISOString(),
    health,
    pids: { ok: pids.ok, why: pids.why, rows: pids.rows },
  }

  // --- (b) the one child process this gate starts, and the window it is seen in --------------------
  const peer = startPeer()
  const peerSpawnedAt = Date.now()
  transcript.peer.spawnedAtMs = peerSpawnedAt
  transcript.peer.dataDir = join(peer.peerDir, 'data')
  transcript.peer.why = peer.why
  let peerJson = null
  let seen = null
  const child = peer.child
  if (child !== null) {
    transcript.peer.started = true
    transcript.peer.pid = child.pid
    const readyDeadline = Date.now() + Math.min(PEER_WAIT_MS, 20000)
    while (Date.now() < readyDeadline) {
      peerJson = readJsonFile(join(peer.peerDir, 'peer.json'))
      if (peerJson !== null) break
      if (processAlive(child.pid) === false) break
      await sleep(200)
    }
    transcript.peer.ready = peerJson !== null
    transcript.peer.identity = peerJson
    if (peerJson !== null) {
      const deadline = Date.now() + PEER_WAIT_MS
      while (Date.now() < deadline) {
        const reread = readBootWhole(BOOT_PATH)
        if (reread.ok === true) {
          const hit = parseBoot(reread).peersById.get(peerJson.deviceId) ?? null
          if (hit !== null) {
            seen = { at: new Date().toISOString(), elapsedMs: Date.now() - peerSpawnedAt, lines: hit.lines, count: hit.count }
            break
          }
        }
        if (processAlive(child.pid) === false) break
        await sleep(POLL_MS)
      }
      transcript.peer.seen = seen !== null
      transcript.peer.seenAfterMs = seen === null ? null : seen.elapsedMs
      transcript.peer.seenWithinMs = seen === null ? null : seen.elapsedMs <= SEEN_WITHIN_MS
      transcript.peer.lines = seen === null ? [] : seen.lines
      transcript.peer.addresses = seen === null ? [] : [...new Set(seen.lines.map((one) => one.address))]
    }
    const logPath = join(peer.peerDir, 'peer.log')
    // Bounded, best effort: the live host announces every ~3 s, so give the child one round to hear it. This
    // only feeds a context line (the host's own egress working) and is never evidence for a reading.
    const hostId = derived.ready?.deviceId ?? null
    if (hostId !== null) {
      const hearUntil = Date.now() + 4000
      while (Date.now() < hearUntil) {
        const text = existsSync(logPath) === true ? readFileSync(logPath, 'utf8') : ''
        if (text.includes('(' + hostId + ')')) break
        await sleep(200)
      }
    }
    if (existsSync(logPath) === true) {
      const logLines = readFileSync(logPath, 'utf8').split(/\r?\n/).filter((one) => one !== '')
      transcript.peer.logLines = logLines.slice(0, 200)
      transcript.peer.logTail = logLines.slice(-6)
    }
    // --- put the peer away, whatever happened ----------------------------------------------------
    try {
      child.kill('SIGTERM')
    } catch (error) {
      transcript.problems.push('the child peer could not be signalled: ' + describe(error))
    }
    transcript.peer.killed = true
    const goneDeadline = Date.now() + 8000
    while (Date.now() < goneDeadline && processAlive(child.pid) !== false) await sleep(100)
    transcript.peer.pidGone = processAlive(child.pid) === false
    if (transcript.peer.pidGone !== true) {
      try { child.kill('SIGKILL') } catch (error) { transcript.problems.push('the child peer could not be killed: ' + describe(error)) }
      await sleep(1000)
      transcript.peer.pidGone = processAlive(child.pid) === false
    }
    const closed = await waitClosed(peerJson?.port)
    transcript.peer.listenerClosed = closed.closed
    transcript.peer.listenerClosedAfterMs = closed.afterMs
    await sleep(1200)
  } else {
    transcript.peer.started = false
  }

  // --- the boot log after the peer is gone ---------------------------------------------------------
  const after = readBootWhole(BOOT_PATH)
  if (after.ok === true) {
    const parsedAfter = parseBoot(after)
    const peerHit = peerJson === null ? null : (parsedAfter.peersById.get(peerJson.deviceId) ?? null)
    const sameClaim = parsedAfter.claims.length > 0 && derived.claim !== null && parsedAfter.claims[parsedAfter.claims.length - 1].text === derived.claim.text
    transcript.bootAtExit = {
      at: new Date().toISOString(),
      bytes: after.bytes,
      lineCount: after.lineCount,
      sha256: after.sha256,
      rewritten: after.lineCount < (transcript.subject.lineCount ?? 0),
      claimStillSameLine: sameClaim,
      peerLineStillPresent: peerHit !== null,
      peerLinesAfterKill: peerHit === null ? 0 : peerHit.lines.filter((one) => seen === null || one.line > (seen.lines[seen.lines.length - 1]?.line ?? 0)).length,
    }
  } else {
    transcript.bootAtExit = { why: after.why }
  }

  // --- the world after ---------------------------------------------------------------------------
  const exitHealth = await readHealth()
  const exitPids = pidFingerprint()
  transcript.world.exit = {
    at: new Date().toISOString(),
    health: exitHealth,
    pids: { ok: exitPids.ok, why: exitPids.why, rows: exitPids.rows },
  }
}

// ---------------------------------------------------------------------------
// The judge: pure, so --replay re-judges exactly what a live run recorded.
// ---------------------------------------------------------------------------
const readingOf = (id, ok, detail, evidence) => ({ id, ok, detail, evidence: evidence.filter((row) => row !== null && row !== undefined) })

const stateOf = (t) => {
  const claim = t?.subject?.derived?.claim ?? null
  if (claim === null) return 'NOT-MEASURED'
  // The state is what the BOOT says this machine does, not what the NIC list would allow: a machine that
  // claims discoverable=true with no NIC to announce from is CLAIMED and red on (c), never this state.
  return claim.discoverable === true ? 'DISCOVERABLE-CLAIMED' : 'NOTHING-DISCOVERABLE'
}

const judge = (t) => {
  const d = t?.subject?.derived ?? {}
  const claim = d.claim ?? null
  const health = t?.world?.entry?.health ?? null
  const pids = t?.world?.entry?.pids ?? null
  const readings = []

  // 01 -------------------------------------------------------------------------------------------
  {
    const carriersBound = health?.carriers !== null && health?.carriers !== undefined && health.carriers.fence === true && health.carriers.health === true && health.carriers.route === true
    const ok = t?.lease?.claimed === true
      && health?.status === 200 && health?.plugin === 'dsh-lan-bridge'
      && claim !== null && health?.role === claim.role
      && t?.subject?.readWhole === true && (t?.subject?.bytes ?? 0) > 0 && (t?.subject?.lineCount ?? 0) > 0
      && Array.isArray(d.carriers) && d.carriers.length === 3 && carriersBound
    readings.push(readingOf(READING_IDS[0], ok, 'the boot log at ' + String(t?.subject?.bootPath ?? '?') + ' was read whole in one read (' + String(t?.subject?.bytes ?? '?') + ' bytes, ' + String(t?.subject?.lineCount ?? '?') + ' lines, sha256 ' + String(t?.subject?.sha256 ?? '?').slice(0, 16) + '...), the live kernel health endpoint answers 200 for plugin dsh-lan-bridge role ' + show(health?.role) + ' (kernel pid ' + String(health?.pid ?? '?') + '), the boot log claims role ' + show(claim?.role) + ', the three ui-carrier lines are corroborated by health.carriers, and the single-run lease is held under ' + show(t?.lease?.holder) + '.', [
      'boot log ' + String(t?.subject?.bootPath ?? '?') + ' read at ' + String(t?.subject?.readAt ?? '?') + ' (whole file, no offset); ' + String(t?.subject?.invalidUtf8 ?? 0) + ' byte(s) in it are not valid UTF-8 and were read as U+FFFD, not dropped',
      'the claim line ' + String(claim?.line ?? '?') + ': ' + quote(claim),
      'GET ' + KERNEL_ORIGIN + HEALTH_PATH + ' -> ' + String(health?.status ?? '?') + ' plugin=' + show(health?.plugin) + ' role=' + show(health?.role) + ' accepts=' + show(health?.accepts) + ' pid=' + show(health?.pid),
      'health carriers ' + show(health?.carriers) + ' vs the three "host ui carrier:" lines at ' + (Array.isArray(d.carriers) ? d.carriers.map((one) => one.line).join(', ') : '?'),
      'client ' + pidText(pidOf(pids, PORT)) + '; kernel ' + pidText(pidOf(pids, (t?.args?.kernelPort ?? KERNEL_PORT))),
      'the lease: claimed=' + String(t?.lease?.claimed) + ' by ' + show(t?.lease?.holder) + ' after ' + String(t?.lease?.attempts) + ' attempt(s) in ' + String(t?.lease?.waitMs) + 'ms',
    ]))
  }

  // 02 -------------------------------------------------------------------------------------------
  {
    const attempts = Array.isArray(d.attempts) ? d.attempts : []
    const perNic = Array.isArray(d.perNic) ? d.perNic : []
    const anyAttempt = attempts.length > 0
    const a2 = anyAttempt && perNic.every((one) => one.recorded > 0)
    const a3 = anyAttempt && perNic.every((one) => one.afterBind > 0)
    const a4 = anyAttempt && (d.loopbackResults ?? 0) > 0
    // With no NIC to announce from there is no result that could be a silence: the address set on the bind
    // line is the record of that absence, and (c) is what judges the claim made on top of it.
    const ok = anyAttempt ? (a2 && a3 && a4) : true
    const evidence = [
      'the address set the service binds and announces from (line ' + String(d.listen?.line ?? '?') + '): ' + (Array.isArray(d.addresses) ? d.addresses.join(', ') : '?'),
      'NICs attempted (everything but loopback): ' + String(attempts.length) + ' -> ' + (attempts.length === 0 ? '(none)' : attempts.join(', ')) + '; the bind line is line ' + String(d.bindLine ?? '?'),
      'result lines per NIC: ' + (perNic.length === 0 ? '(none)' : perNic.map((one) => one.address + ' -> ' + String(one.recorded) + ' line(s), ' + String(one.afterBind) + ' after the bind').join('; ')),
      ...perNic.flatMap((one) => one.lines.map((row) => 'line ' + String(row.line) + (one.preBind === true ? ' (BEFORE the bind)' : '') + ': ' + String(row.text))),
      'loopback announce-leg result lines in this boot: ' + String(d.loopbackResults ?? 0),
    ]
    for (const row of (Array.isArray(d.joinLines) ? d.joinLines : [])) evidence.push('membership line ' + String(row.line) + ': ' + String(row.text))
    evidence.push('why a pre-bind EBADF is not a NIC verdict, in the package\'s own words: src/proto/discovery.js:12-15 - "Multicast only loops back to the same host when the egress interface is a real NIC ... Option calls before bind fail (EBADF ...)"')
    const peerEgress = (Array.isArray(t?.peer?.logLines) ? t.peer.logLines : []).filter((one) => String(one).includes('multicast egress')).length
    if (peerEgress > 0 && t?.peer?.seen === true) {
      evidence.push('context (does NOT soften this reading): the child instance this gate started wrote the same ' + String(peerEgress) + ' pre-bind "unavailable" line(s) into its own log, and its own announce - made after its bind - reached the live host after ' + String((t?.peer?.seenAfterMs ?? '?') + ' ms') + '. The same NIC set can carry multicast; the "unavailable" verdict is about WHEN the call was made, not what the NIC can do.')
    }
    const detail = anyAttempt !== true
      ? 'no NIC is attempted on this machine (the bind line names ' + (Array.isArray(d.addresses) ? d.addresses.join(', ') : '?') + '), so there is no per-NIC result that could be a silence; the absence is named by the address set and by the claim.'
      : ok === true
      ? 'every one of the ' + String(attempts.length) + ' attempted NIC(s) has a result line for an announcement the socket could make, and the announce\'s loopback leg is recorded too.'
      : 'RED: ' + String(attempts.length) + ' NIC(s) attempted, ' + String(a2 ? attempts.length : perNic.filter((one) => one.recorded > 0).length) + ' with any line at all, ' + String(perNic.filter((one) => one.afterBind > 0).length) + ' with a line for an announcement made AFTER the bind. ' + String(d.preBind ?? 0) + ' of ' + String(attempts.length) + ' NIC result(s) are pre-bind "setMulticastInterface EBADF" lines, which say the socket was not bound yet, not what the NIC can do; ' + String(d.worked ?? 0) + ' result(s) record an egress that worked; and the announce\'s loopback leg has ' + String(d.loopbackResults ?? 0) + ' result line(s), so a failure there is a silence (its send callback is a no-op, discovery.js:290).'
    readings.push(readingOf(READING_IDS[1], ok, detail, evidence))
  }

  // 03 -------------------------------------------------------------------------------------------
  {
    const peer = t?.peer ?? {}
    const lines = Array.isArray(peer.lines) ? peer.lines : []
    const addresses = Array.isArray(peer.addresses) ? peer.addresses : []
    const measured = peer.started === true && peer.ready === true && peer.identity !== null && peer.identity !== undefined
    const ok = measured && peer.seen === true && peer.seenAfterMs !== null && peer.seenAfterMs <= SEEN_WITHIN_MS && addresses.length > 0
    const legOf = (address) => address === LOOPBACK
      ? 'loopback unicast announce (send to 127.0.0.1, discovery.js:258)'
      : 'multicast announce out NIC ' + address + ' (setMulticastInterface(' + address + '), discovery.js:317)'
    const evidence = [
      'the child instance: pid ' + String(peer.pid ?? '(none)') + ', device ' + show(peer.identity?.deviceId) + ' (' + show(peer.identity?.deviceName) + '), role ' + show(peer.identity?.role) + ', discoverable ' + show(peer.identity?.discoverable) + ', accepts ' + show(peer.identity?.accepts) + ', TCP port ' + String(peer.identity?.port ?? '?') + ', data ' + String(peer.dataDir ?? '?'),
      'the host logged it after ' + String(peer.seenAfterMs === null || peer.seenAfterMs === undefined ? '(never)' : peer.seenAfterMs + ' ms') + ' (window ' + String(SEEN_WITHIN_MS) + ' ms, ' + String(lines.length) + ' line(s))',
      ...lines.map((one) => 'line ' + String(one.line) + ': ' + String(one.text) + '  -> ' + legOf(one.address)),
      ...(Array.isArray(peer.logTail) ? peer.logTail.map((one) => 'peer.log: ' + clip(String(one), 200)) : []),
    ]
    readings.push(readingOf(READING_IDS[2], measured ? ok : null, measured
      ? (ok === true
        ? 'a second instance on this machine was seen by the live host ' + String(peer.seenAfterMs) + ' ms after it started (inside the 30 s window), on ' + String(addresses.length) + ' leg(s): ' + addresses.map(legOf).join(' + ') + '.'
        : 'RED: the child instance started (device ' + show(peer.identity?.deviceId) + ') but the live host logged it ' + (peer.seen === true ? 'only after ' + String(peer.seenAfterMs) + ' ms, outside the 30 s window' : 'nowhere within ' + String(SEEN_WITHIN_MS) + ' ms') + '.')
      : 'the child instance never became ready (' + String(peer.why ?? 'no peer.json was written') + '), so the 30 s window could not be measured.', evidence))
  }

  // 04 -------------------------------------------------------------------------------------------
  {
    const attempts = Array.isArray(d.attempts) ? d.attempts : []
    const worked = d.worked ?? 0
    const claimed = claim?.discoverable === true
    const ok = claimed !== true || worked > 0
    const quoted = [claim, ...(Array.isArray(d.perNic) ? d.perNic.flatMap((one) => one.lines) : [])]
    const evidence = [
      'the claim (line ' + String(claim?.line ?? '?') + '): ' + quote(claim),
      ...quoted.slice(1).map((one) => 'the per-NIC result (line ' + String(one.line) + '): ' + String(one.text)),
      'recorded egress results in this ' + String(t?.subject?.lineCount ?? '?') + '-line boot: ' + String(worked) + ' worked, ' + String(d.unavailable ?? 0) + ' unavailable, over ' + String(attempts.length) + ' attempted NIC(s)',
      'the claim is not derived from any of them: service.js:1642 prints state.discoverable (config or prefs.json, service.js:273), and discovery.js:224 signs that same flag into every announce',
    ]
    if (peerHeardHost(t) !== null) evidence.push('context (does NOT soften this reading): a second instance on this machine did hear the host at ' + String(peerHeardHost(t)) + ', which is evidence the world works and the record is wrong - both are the finding: the claim is unconditional and the record cannot support it.')
    readings.push(readingOf(READING_IDS[3], ok, ok === true
      ? 'the announcement ' + show(claim?.discoverable) + ' is consistent with the per-NIC record (' + String(worked) + ' recorded working egress).'
      : 'RED: the boot claims discoverable=' + show(claim?.discoverable) + ' at line ' + String(claim?.line ?? '?') + ' while all ' + String(attempts.length) + ' per-NIC result(s) on record say the egress did not work: ' + String(worked) + ' of ' + String(attempts.length) + ' NIC(s) have a recorded working egress. The announcement is emitted unconditionally, so it is contradicted by the only egress records the machine writes.', evidence))
  }

  // 05 -------------------------------------------------------------------------------------------
  {
    const state = stateOf(t)
    const a = readings[1].ok
    const c = readings[3].ok
    const ok = state === 'NOTHING-DISCOVERABLE' ? (a === true && c === true) : state === 'DISCOVERABLE-CLAIMED'
    readings.push(readingOf(READING_IDS[4], ok, state === 'NOTHING-DISCOVERABLE'
      ? 'STATE NOTHING-DISCOVERABLE: this machine announces nothing (claim discoverable=' + show(claim?.discoverable) + ', ' + String((Array.isArray(d.attempts) ? d.attempts.length : 0)) + ' NIC(s) to announce from). That is a named third state, not a red: this gate exits 3 for it - and only because (a)=' + String(a) + ' and (c)=' + String(c) + ' still hold.'
      : 'STATE DISCOVERABLE-CLAIMED: the boot says discoverable=' + show(claim?.discoverable) + ' with ' + String((Array.isArray(d.attempts) ? d.attempts.length : 0)) + ' NIC(s) to announce from, so the nothing-discoverable branch is not entered on this machine. The state is named on every run (the STATE line the summary prints) and the exit rule is stated: 3 only when nothing is discoverable AND (a)/(c) hold; a red (a) or (c) is 1, not 3.', [
      'state rule: the boot claim discoverable=false -> NOTHING-DISCOVERABLE; claim true -> DISCOVERABLE-CLAIMED (even with no NIC to announce from: that is a false claim, which (c) calls red, never this state)',
      'what this branch would require: (a) and (c) judged on the same log, then exit 3 (not 1) for the named state',
    ]))
  }

  // 06 -------------------------------------------------------------------------------------------
  {
    const peer = t?.peer ?? {}
    const entry = t?.world?.entry ?? null
    const exit = t?.world?.exit ?? null
    const sameRole = entry?.health?.role === exit?.health?.role
    const sameCarriers = JSON.stringify(entry?.health?.carriers ?? null) === JSON.stringify(exit?.health?.carriers ?? null)
    const samePid = entry?.health?.pid !== null && entry?.health?.pid !== undefined && entry?.health?.pid === exit?.health?.pid
    const ok = peer.killed === true && peer.pidGone === true && peer.listenerClosed === true
      && t?.lease?.released === true && t?.lease?.exit?.held === false
      && t?.bootAtExit?.claimStillSameLine === true && t?.bootAtExit?.peerLineStillPresent === true
      && t?.bootAtExit?.peerLinesAfterKill === 0
      && samePid && sameRole && sameCarriers
    const missing = [
      peer.killed === true && peer.pidGone === true && peer.listenerClosed === true ? null : 'the child instance is not fully gone',
      t?.lease?.released === true && t?.lease?.exit?.held === false ? null : 'the lease was not given back',
      t?.bootAtExit?.claimStillSameLine === true ? null : 'the boot log no longer carries the same claim line',
      t?.bootAtExit?.peerLineStillPresent === true ? null : 'the peer line is gone from the boot log',
      t?.bootAtExit?.peerLinesAfterKill === 0 ? null : 'the peer logged again after the kill',
      samePid === true ? null : 'the kernel pid changed',
      sameRole === true && sameCarriers === true ? null : 'the kernel role or carrier set changed',
    ].filter((one) => one !== null)
    readings.push(readingOf(READING_IDS[5], ok, ok === true
      ? 'the child instance is gone (pid ' + String(peer.pid ?? '?') + ' signalled, pid gone, its listener closed), the lease is released (held at exit ' + show(t?.lease?.exit?.held) + '), the boot log still carries the same claim line and the peer line with nothing from the peer after the kill, and the kernel pid/role/carrier set are unchanged.'
      : 'RED: the world is not the way this gate found it: ' + missing.join('; ') + '.', [
      'the child instance: pid ' + String(peer.pid ?? '?') + ' signalled ' + String(peer.killed) + ', pid gone ' + String(peer.pidGone) + ', its TCP listener on 127.0.0.1:' + String(peer.identity?.port ?? '?') + ' closed: ' + String(peer.listenerClosed) + ' after ' + String(peer.listenerClosedAfterMs ?? '?') + ' ms',
      'peer lines for ' + show(peer.identity?.deviceId) + ' after the kill: ' + String(t?.bootAtExit?.peerLinesAfterKill ?? '?'),
      'boot log at exit: ' + String(t?.bootAtExit?.lineCount ?? '?') + ' lines (was ' + String(t?.subject?.lineCount ?? '?') + '), claim line unchanged=' + String(t?.bootAtExit?.claimStillSameLine) + ', peer line still present=' + String(t?.bootAtExit?.peerLineStillPresent) + ', rewritten=' + String(t?.bootAtExit?.rewritten),
      'health at exit: status ' + String(exit?.health?.status ?? '?') + ' pid ' + show(exit?.health?.pid) + ' role ' + show(exit?.health?.role) + ' carriers ' + show(exit?.health?.carriers),
      'client ' + pidText(pidOf(exit?.pids ?? null, t?.args?.port ?? PORT)) + '; kernel ' + pidText(pidOf(exit?.pids ?? null, t?.args?.kernelPort ?? KERNEL_PORT)) + ' (client starts/stops by this gate: 0)',
      ...(Array.isArray(t?.problems) ? t.problems.map((one) => 'problem: ' + one) : []),
    ]))
  }

  return readings
}

/** The host-side address the child instance heard the live host at, or null (a fact, never evidence for 04). */
const peerHeardHost = (t) => {
  const own = t?.subject?.derived?.ready?.deviceId ?? null
  const rows = Array.isArray(t?.peer?.logLines) ? t.peer.logLines : []
  if (own === null) return null
  const hit = rows.find((one) => String(one).includes('peer ' + own) || String(one).includes('(' + own + ')'))
  if (hit === undefined) return null
  const found = /at (\d+\.\d+\.\d+\.\d+:\d+)/u.exec(String(hit))
  return found === null ? null : found[1]
}

const printTranscript = (t) => {
  const d = t?.subject?.derived ?? {}
  console.log('')
  console.log('== what the live boot log says ==')
  console.log('  ' + String(t?.subject?.bootPath ?? '?') + ' read WHOLE: ' + String(t?.subject?.bytes ?? '?') + ' bytes, ' + String(t?.subject?.lineCount ?? '?') + ' lines, sha256 ' + String(t?.subject?.sha256 ?? '?').slice(0, 32) + '..., ' + String(t?.subject?.invalidUtf8 ?? '?') + ' byte(s) not valid UTF-8')
  console.log('  the claim: line ' + String(d.claim?.line ?? '?') + '  ' + quote(d.claim))
  console.log('  the bind : line ' + String(d.listen?.line ?? '?') + '  ' + quote(d.listen))
  console.log('  NICs attempted ' + String((d.attempts ?? []).length) + ': ' + (Array.isArray(d.attempts) ? d.attempts.join(', ') : '?'))
  for (const one of (Array.isArray(d.perNic) ? d.perNic : [])) {
    for (const row of one.lines) console.log('    ' + String(one.address) + '  line ' + String(row.line) + (one.preBind === true ? ' PRE-BIND' : '') + '  ' + String(row.text))
  }
  console.log('  per-NIC record: ' + String(d.worked ?? 0) + ' worked, ' + String(d.unavailable ?? 0) + ' unavailable, ' + String(d.loopbackResults ?? 0) + ' line(s) about the loopback announce leg')
  console.log('  ui carriers: ' + (Array.isArray(d.carriers) ? d.carriers.map((one) => one.what).join(' | ') : '?'))
  console.log('  peer lines in this boot: ' + String(d.peerLines ?? '?') + ' over ' + String(d.peerDevices ?? '?') + ' device(s)')
  console.log('  the child instance this gate started: ' + (t?.peer?.started === true ? 'pid ' + String(t?.peer?.pid) + ', device ' + show(t?.peer?.identity?.deviceId) + ', seen ' + String(t?.peer?.seen) + ' after ' + String(t?.peer?.seenAfterMs) + ' ms on ' + show(t?.peer?.addresses) : 'not started (' + String(t?.peer?.why ?? '?') + ')'))
  console.log('  the single-run lease: claimed ' + String(t?.lease?.claimed) + ' by ' + show(t?.lease?.holder) + ' after ' + String(t?.lease?.attempts) + ' attempt(s) / ' + String(t?.lease?.waitMs) + 'ms; at exit ' + show(t?.lease?.exit) + '; released ' + String(t?.lease?.released))
  const fatal = t?.fatal ?? null
  if (fatal !== null) console.log('  FATAL ' + fatal)
  for (const problem of (Array.isArray(t?.problems) ? t.problems : [])) console.log('  PROBLEM ' + problem)
}

const printReadings = (readings) => {
  console.log('')
  console.log('== readings ==')
  for (const reading of readings) {
    const tag = reading.ok === true ? '[GREEN]        ' : (reading.ok === null ? '[NOT MEASURED] ' : '[RED]          ')
    console.log('')
    console.log(tag + reading.id)
    console.log('  ' + reading.detail)
    for (const row of reading.evidence) console.log('    - ' + row)
  }
  console.log('')
}

const summarise = (t, readings) => {
  const red = readings.filter((reading) => reading.ok === false)
  const notMeasured = readings.filter((reading) => reading.ok === null)
  const green = readings.filter((reading) => reading.ok === true)
  const state = stateOf(t)
  console.log('gate 203-P1 lan-bridge-discovery-live: ' + String(readings.length) + ' readings, ' + String(green.length) + ' green, ' + String(red.length) + ' red, ' + String(notMeasured.length) + ' not measured [boot log ' + String(t?.subject?.lineCount ?? '?') + ' lines; one child instance started and killed (' + String(t?.peer?.identity?.deviceId ?? 'none') + '); lease ' + (t?.lease?.claimed === true ? 'held then released' : 'not taken') + '; client starts/stops 0]')
  console.log('STATE ' + state + (state === 'NOTHING-DISCOVERABLE' ? ' (the named third state: exit 3 when (a) and (c) hold)' : ''))
  for (const reading of red) console.log('  RED ' + reading.id + ': ' + clip(reading.detail, 400))
  for (const reading of notMeasured) console.log('  NOT MEASURED ' + reading.id + ': ' + clip(reading.detail, 400))
  if (red.length > 0) return 1
  if (state === 'NOTHING-DISCOVERABLE') return 3
  if (notMeasured.length > 0) return 3
  return 0
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  console.log('gate 203-P1 lan-bridge-discovery-live (R203, LIVE) - what the running client says about its own device discovery')
  console.log('  boot log ' + BOOT_PATH)
  if (REPLAY === null) console.log('  kernel ' + KERNEL_ORIGIN + ' (one read-only health GET); lease on ' + SHELL_ORIGIN + '; one child instance on this machine; the desktop client is never started or stopped')

  if (REPLAY !== null) {
    const path = REPLAY === 'latest' ? newestTranscript() : resolve(REPLAY)
    if (path === null || path === undefined || existsSync(path) !== true) return NOT_MEASURED('no transcript to replay at ' + String(path ?? SCRATCH))
    let parsed = null
    try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { return NOT_MEASURED('the transcript at ' + path + ' is not JSON (' + describe(error) + ')') }
    if (parsed?.schema !== SCHEMA) return NOT_MEASURED('the file at ' + path + ' is not a transcript this gate wrote (schema ' + show(parsed?.schema) + ')')
    console.log('  replay: judging ' + path + ' - the world is NOT touched (no lease, no HTTP, no child process, no boot-log read)')
    const readings = judge(parsed)
    printTranscript(parsed)
    printReadings(readings)
    return summarise(parsed, readings)
  }

  let leaseTaken = false
  let fatal = null
  try {
    await runWorld()
    leaseTaken = transcript.lease.claimed === true
  } catch (error) {
    fatal = describe(error)
    console.log('')
    console.log('SKIP (not measured): ' + fatal)
  } finally {
    if (leaseTaken === true || transcript.lease.claimed === true) {
      try {
        await releaseLease(PORT, GATE_HOLDER)
        transcript.lease.released = true
      } catch (error) {
        transcript.lease.released = false
        transcript.problems.push('the lease could not be released: ' + describe(error))
      }
    }
    // The lease state is read AFTER the release: a reading that says "the lease is back" must not be taken
    // while this gate still holds it.
    const leaseState = await panelPost(PORT, { op: 'state' }).catch(() => null)
    transcript.lease.exit = leaseState === null ? null : { held: leaseState?.lease?.held === true, holder: leaseState?.lease?.holder ?? null }
    transcript.fatal = fatal
    const written = writeTranscript()
    console.log('  transcript: ' + written)
  }

  const readings = judge(transcript)
  printTranscript(transcript)
  printReadings(readings)
  const code = summarise(transcript, readings)
  if (fatal !== null) {
    console.log('  the run did not reach a measurement: ' + fatal)
    console.log('STATE ' + stateOf(transcript) + ' (not measured: exit 3)')
    return 3
  }
  return code
}

const code = await main()
process.exit(code)
