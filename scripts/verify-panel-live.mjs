#!/usr/bin/env node
/**
 * Gate 124 (R189) - panel-live: IS THE PANEL'S CLIENT HALF DELIVERED, DID IT REGISTER, AND DID IT
 * REALLY READ THE TWO LIVE ROUTES BACK?
 *
 * Subject: the client half of dsh-link-panel - the right-rail tab R189 grew - inside the user's LIVE
 * desktop client (shell 31761 / kernel 31760 / CDP 9222). This gate READS that world; it never drives
 * it, never opens the panel, and never spends a model round.
 *
 * TWO HALVES, REPORTED SEPARATELY (R189 contract section 2, and docs/dev/notes-ui.md section 3.5):
 *   (a) REGISTRATION - the live page carries the read-only marker
 *       globalThis.__dshLinkPanel = { mounted: true, tabId: 'dsh-link-panel', items: [...],
 *       notes: { count, limits }, failed: null }. mounted === true AND failed === null prove ONE thing:
 *       the registration path ran to the end. They do NOT prove a single read came back - P3 measured in
 *       the page that markView(globals, face.initial()) runs BEFORE the first answer lands
 *       (plugins/dsh-link-panel/src/client/register.ts:139, then void face.load() at :140), and
 *       face.initial() is an empty, both-slots-pending view.
 *   (b) READ BACK - the marker's own items and notes.limits are compared, row by row and byte by byte,
 *       with what the REAL routes answer: GET http://127.0.0.1:31760/api/dsh-link-panel/state
 *       (declared.visible) and GET http://127.0.0.1:31760/api/dsh-link-notes/state (limits). Only (b)
 *       can tell "registered" apart from "read back", which is why the two halves are two readings.
 *
 * DELIVERY, OVER EVERY BLOCK (not over the first one)
 *   GET / is the shell's own boot page and it carries the preload expression 'plugins/??<names>&rev=<hash>'
 *   more than once: one big block near the top, one block per plugin after it, and the big block again at
 *   the end. The client row this gate looks for sits in a LATE block - a parser that stops at the first
 *   match reads 57 enterprise rows and never sees ours. So the instrument here walks EVERY match and the
 *   union of their members is the list. Reading 1 prints how many blocks it walked.
 *
 * WHAT THIS GATE READS - AND NOTHING ELSE
 *   1. GET http://127.0.0.1:31761/__shell/status   (twice: entry and exit, so the pid can be compared)
 *   2. GET http://127.0.0.1:31761/                 (twice: the block list and the page bytes before/after)
 *   3. GET http://127.0.0.1:31760/api/dsh-link-panel/state   (the real registry route)
 *   4. GET http://127.0.0.1:31760/api/dsh-link-notes/state   (the real ledger route; 200 expected)
 *   5. CDP 9222: GET /json/list and exactly ONE Runtime.evaluate whose whole expression is
 *      'JSON.stringify(globalThis.__dshLinkPanel ?? null)' - a value read, nothing else
 *   6. local reads only: the process list, this gate's own ancestor chain, git status --porcelain, and
 *      the bytes of the notes ledger the kernel home holds (read-only: sha256 before and after)
 *   http:// and NOT https://: both ports speak plaintext HTTP.
 *   NO POST ANYWHERE: the notes write mouth (POST /api/dsh-link-notes/add) is out of bounds this round -
 *   gate 123 (offline) is what pins the write path. Every request this gate makes is recorded in the
 *   transcript, and reading 8 judges that record against a strict allowlist.
 *
 * WHY THIS IS SAFE NEXT TO SOMEBODY WHO IS WORKING
 *   enforce_lease's call sites are the panel write mouths (surface / mount / unmount / tab-* / mode /
 *   viewport). This gate touches none of them: GET /__shell/status and GET / are the shell's own read
 *   pages, and the two kernel routes are read-only by their own contract (readOnly: true). It sends no
 *   prompt: ZERO model rounds.
 *
 * SINGLE RUN ONLY - NEVER IN A SEGMENTED RUN (永不进段跑)
 *   This gate must be the only live consumer of the world it reads. If any other registered live gate
 *   file (scripts/verify-all.mjs's own live register) is running as a process, this gate declines BY
 *   NAME with exit 3 instead of reading a world somebody else is driving. It is therefore never part of
 *   a segmented / --only run, and it must never be added to a suite that starts other live gates beside
 *   it. Registering this file is the Lead's act, not this file's.
 *
 * THE READINGS (each able to fail on its own evidence; all ten are covered by the self-attack)
 *   0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run
 *        Precondition self-证: phase == 'ready' both times, and the same kernel pid + the same desktop
 *        client process (pid@start-time) before and after, and the single-run guard saw nobody else. A
 *        restart in the middle is a NAMED THIRD STATE (exit 3) - never read as "the list lost a row".
 *   1-the-instrument-parsed-every-plugins-block-in-the-shells-own-page
 *        GET / answered 200 and the body really is the shell's boot page ('plugins/??', '&rev=<hex>',
 *        '__DSH_BOOT__'); the block walk yields at least one block, at least one row, and no malformed
 *        token. A body that is not that page is RED (the instrument changed under the reader).
 *   2-the-panel-client-half-is-on-the-live-preload-list
 *        Delivery: 'dsh-link-panel/client.js' is in the UNION over every block, with the block it came
 *        from and the page bytes around it.
 *   3-the-panel-client-half-registered-in-the-live-page
 *        Half (a): the marker is there, mounted === true, failed === null, tabId === 'dsh-link-panel'.
 *        The verbatim marker JSON is in the reading.
 *   4-the-marker-read-back-the-two-real-routes
 *        Half (b): the marker's items equal the route's declared.visible row by row and byte by byte,
 *        the marker's notes.limits equals the notes route's limits byte by byte, and the marker's
 *        notes.count equals the number of rows that route lists.
 *   5-the-live-negative-control-is-absent-from-the-list
 *        dsh-link-toolbar/client.js and dsh-link-responsive/client.js must NOT be there. If either
 *        appears, the parser or the world is wrong => RED, never green.
 *   6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch
 *        GET /api/dsh-link-notes/state answers 200 on the real kernel with readOnly: true, its path, the
 *        frozen thresholds {maxNotes:200,maxChars:100} and its counts; no POST went into the write
 *        mouth; and the ledger's per-file bytes AND sha256 are identical either side of the readings.
 *   7-what-this-gate-can-and-cannot-say-about-pixels
 *        The boundary, as a reading and not as prose: items / notes.count prove that the CLIENT HALF
 *        COMPUTED A VIEW and prove NO PIXEL AT ALL; reading a pixel needs the panel open, which needs
 *        an exclusive window. This gate performed zero panel operations (no POST, no /__shell/panel, no
 *        lease, no Input.*, no DOM write) and claims no pixel evidence.
 *   8-this-gate-only-read-the-world
 *        The recorded reads against the allowlist (GET-only, four paths, one CDP evaluate), the ports
 *        touched, and the single-run guard's verdict that it ran and could name the files it watched.
 *   9-the-world-fingerprint-left-behind
 *        The artifact fingerprint: the page bytes and the row set are identical before and after,
 *        'git status --porcelain' is identical before and after, and the only file this gate wrote is
 *        its transcript under .tmp/r189-g124/ (a git-ignored scratch path).
 *
 * Self-attack: --self-attack mutates THE TRANSCRIPT THIS RUN MEASURED - anchored on the measured page
 * bytes, the measured marker value and the measured route bodies - one mutation per mutant, and prints,
 * for every mutant, 声明 == 观测 / 声明 != 观测 plus the COVERAGE MATRIX. A mutant is precise when the
 * readings that go not-green are exactly the ones it declared. The baseline must be fully green AND
 * fully measured first.
 *
 *   --replay <file>   judge a transcript an earlier run wrote: ZERO reads, the live world is not touched
 *                     at all (no GET, no CDP, not even a process scan of the live world).
 *
 * Exit 0 all ten readings held | 1 a reading failed, or a mutant did not land where it declared |
 * 3 this gate could not measure here, BY NAME: no ready shell on the port, the shell restarted while the
 * gate was reading, another live consumer is running, the page never came back, the page could not be
 * reached over CDP, or the ledger could not be read. A reading that cannot be measured is a named third
 * state, never green.
 *
 * Usage: node scripts/verify-panel-live.mjs [--port 31761] [--kernel 31760] [--cdp 9222]
 *          [--dump <file>] [--self-attack] [--replay <transcript.json>]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'scripts', 'verify-all.mjs')) && existsSync(join(at, 'plugins', 'build.mjs'))) return at
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
  return at === -1 ? fallback : argv[at + 1]
}
const SELF_ATTACK = has('--self-attack')
const REPLAY_PATH = option('--replay', null)
const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel', '31760'))
const CDP_PORT = Number(option('--cdp', '9222'))
const DUMP_OPTION = option('--dump', null)
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const KERNEL_ORIGIN = 'http://127.0.0.1:' + String(KERNEL_PORT)

/** The one subject this round: one new client half, one marker, two real routes, two live controls. */
const SUBJECT = 'dsh-link-panel'
const SUBJECT_ROW = SUBJECT + '/client.js'
const MARKER_KEY = '__dshLinkPanel'
const MARKER_EXPRESSION = 'JSON.stringify(globalThis.' + MARKER_KEY + ' ?? null)'
const FROZEN_TAB_ID = 'dsh-link-panel'
const FROZEN_LIMITS = { maxNotes: 200, maxChars: 100 }
// R264: the second control was dsh-link-responsive until R222 MOUNTED it in the live profile - after that its client half
// is legitimately on the preload list and this reading went red for a change that is correct. The negatives are the client
// halves that are genuinely NOT in the profile's bundle roll call; measured against the live profile while writing this:
// dsh-link-toolbar and dsh-browser are the two that ship a lib/client.js and are not mounted.
const CONTROLS = ['dsh-link-toolbar/client.js']
const STATUS_PATH = '/__shell/status'
const PAGE_PATH = '/'
const PANEL_STATE_PATH = '/api/dsh-link-panel/state'
const NOTES_STATE_PATH = '/api/dsh-link-notes/state'
const NOTES_ADD_PATH = '/api/dsh-link-notes/add'
/** The ledger the notes row opens: dshHomePath('link-notes'), then its own 'notes' control log. */
const LEDGER_LEAF = 'link-notes'
const SCRATCH_DIR = join(PROJECT, '.tmp', 'r189-g124')
/** The only shell/kernel paths this gate is allowed to ask for, and the only CDP method it may call. */
const ALLOWED_SHELL_PATHS = [STATUS_PATH, PAGE_PATH]
const ALLOWED_KERNEL_PATHS = [PANEL_STATE_PATH, NOTES_STATE_PATH]
const ALLOWED_DASH_PURPOSES = ['ancestor-chain', 'single-run-guard', 'single-run-scan', 'client-identity', 'git-status']
const ALLOWED_FILE_PURPOSES = ['ledger-bytes-before', 'ledger-bytes-after']
const PORTS_THIS_GATE_MAY_SPEAK_TO = [PORT, KERNEL_PORT, CDP_PORT]
/** Words that must never appear in the record of what this gate did. */
const FORBIDDEN_IN_READS = /\bPOST\b|__shell\/panel|lease|Input\.|dispatchMouse|dispatchKey|callFunctionOn|Runtime\.callFunction|DOM\.|Page\.navigate|viewport|dispatchEvent|\bclick\b|\binject/i
/** The boundary this gate is not allowed to cross, in one sentence (R189 contract section 4.2). */
const PIXEL_BOUNDARY = 'items / notes.count 只证明客户端半算出了视图，不证明任何像素；要读像素必须开面板，那需要独占窗口'

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
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (list) => [...list].map(String).sort()
const sameSet = (left, right) => same(sorted(left), sorted(right))
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const pad = (text, width) => (String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length))
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const lines = (value) => String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
const readJson = (path) => {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { ok: false, why: describe(error) }
  }
}

// ---------------------------------------------------------------------------
// The instrument: EVERY 'plugins/??' block in the shell's own page, unioned
// ---------------------------------------------------------------------------

/** The shell prints its client rows as preload URLs: plugins/??<names, comma separated>&rev=<hash>. */
const LIST_PATTERN = /plugins\/\?\?([^"']*?)(?:&amp;rev=|&rev=)/g
const ROW_PATTERN = /^(?:@[^/@]+\/)?[^/@]+\/client\.js$/

/**
 * Walk EVERY 'plugins/??' block in the measured bytes and union their members.
 *
 * One match is not the list: the shell's page repeats the big enterprise block and puts one row per
 * plugin after it, and this round's row is in a LATE block. Reading only the first match would read 57
 * rows that are not ours. The blocks themselves are kept in the reading, so "walked every block" is a
 * number a reader can check rather than a claim.
 */
const parsePreloadList = (html) => {
  const text = String(html ?? '')
  const blocks = []
  for (const match of text.matchAll(new RegExp(LIST_PATTERN.source, 'g'))) {
    const members = match[1].split(',').map((name) => name.trim()).filter((name) => name !== '')
    blocks.push({ url: match[0], urlAt: match.index, members })
  }
  const names = blocks.flatMap((block) => block.members)
  const unique = [...new Set(names)]
  const malformed = unique.filter((name) => ROW_PATTERN.test(name) !== true)
  const ours = unique.filter((name) => name.startsWith('dsh-') && name.startsWith('@') === false)
  const fragmentOf = (name) => {
    const at = text.indexOf(name)
    if (at === -1) return null
    return clip(text.slice(Math.max(0, at - 46), at + name.length + 30), 168)
  }
  return {
    blocks,
    blockCount: blocks.length,
    names,
    unique,
    duplicates: names.length - unique.length,
    malformed,
    ours,
    fragmentOf,
    firstBlockOnly: blocks.length === 0 ? [] : [...new Set(blocks[0].members)],
    hasListMarker: text.includes('plugins/??'),
    hasBoot: text.includes('__DSH_BOOT__'),
    hasRev: /(?:&amp;|&)rev=[0-9a-fA-F]{6,}/.test(text),
  }
}

/**
 * Rewrite the member lists inside the measured page bytes, and only them: every mutant that touches the
 * list is anchored on these exact bytes (the URL shell, the separators and the rev hash are kept verbatim).
 */
const rewriteMembers = (html, edit) => {
  const text = String(html ?? '')
  let out = ''
  let at = 0
  let first = true
  for (const match of text.matchAll(new RegExp(LIST_PATTERN.source, 'g'))) {
    const members = match[1].split(',').map((name) => name.trim()).filter((name) => name !== '')
    const rev = /(?:&amp;|&)rev=([0-9a-fA-F]+)$/.exec(match[0])
    const separator = match[0].includes('&amp;rev=') ? '&amp;rev=' : '&rev='
    const next = edit(members.slice(), match[0], first)
    out += text.slice(at, match.index)
    if (Array.isArray(next) === true && next.length > 0) out += 'plugins/??' + next.join(',') + separator + (rev === null ? '' : rev[1])
    at = match.index + match[0].length
    first = false
  }
  out += text.slice(at)
  return out
}

/** The per-block row counts, run-length compressed: every block is counted, none is hidden behind a comma. */
const compressSizes = (sizes) => {
  const parts = []
  for (const size of sizes) {
    const last = parts[parts.length - 1]
    if (last !== undefined && last.size === size) last.count += 1
    else parts.push({ size, count: 1 })
  }
  return parts.map((part) => (part.count === 1 ? String(part.size) : String(part.size) + 'x' + String(part.count))).join(',')
}

/** One row's bytes, so "row by row, byte by byte" is a comparison and not an adjective. */
const rowsOf = (value) => (Array.isArray(value) ? value.map((row) => JSON.stringify(row === undefined ? null : row)) : null)
/** A stable spelling for the failure detail: sorted keys, so a difference in ORDER is told apart from one in value. */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map((entry) => canonical(entry))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// The live world: two GET ports, the single-run guard, one read-only evaluate, the ledger bytes
// ---------------------------------------------------------------------------

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

const pwsh = (command, timeoutMs = 40000) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })

/** The identity of the desktop client: pid@start-time. A restart of this is a third state, not a red. */
const clientIdentity = (record) => {
  const query = "[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })"
  record?.('client-identity')
  const done = pwsh(query, 30000)
  if (done.status !== 0) return null
  const text = String(done.stdout ?? '').trim()
  return text === '' ? null : text
}

/** This gate's own ancestor chain, so "another consumer" is never this process's own parent. */
const ancestorPids = (record) => {
  const query = '$ids = @(); $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID);'
    + ' for ($i = 0; $i -lt 12 -and $p -ne $null; $i++) { $ids += [string]$p.ProcessId;'
    + ' if ($p.ParentProcessId -eq 0) { break }; $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [string]$p.ParentProcessId) -ErrorAction SilentlyContinue }'
    + ' [string]::Join(",", $ids)'
  record?.('ancestor-chain')
  const done = pwsh(query, 30000)
  if (done.status !== 0) return []
  return String(done.stdout ?? '').trim().split(',').map((id) => id.trim()).filter((id) => id !== '')
}

/** Every node process, so the guard is read from the machine, not assumed. */
const nodeProcesses = (record) => {
  const query = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + [string]$_.CommandLine }'
  record?.('single-run-scan')
  const done = pwsh(query)
  if (done.status !== 0) return { ok: false, why: 'the process list could not be read: ' + clip(String(done.stderr ?? ''), 160), rows: [] }
  const rows = String(done.stdout ?? '')
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.includes('|'))
    .map((row) => {
      const first = row.indexOf('|')
      const second = row.indexOf('|', first + 1)
      return { pid: row.slice(0, first), ppid: row.slice(first + 1, second), command: row.slice(second + 1) }
    })
  return { ok: true, rows }
}

/** The register's own list of live gate files, out of scripts/verify-all.mjs (this gate writes nothing there). */
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) === false) return { files: [], why: 'scripts/verify-all.mjs is not there' }
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
  return { files: [...files], why: count === 0 ? 'the register could not be parsed, so every verify-*/probe-* process counts as a live consumer' : null, parsed: count }
}
const otherConsumers = (rows, live, ancestors) => {
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors ?? [])])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  const SELF = 'verify-panel-live.mjs'
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

/** git status --porcelain, normalized: the fingerprint that says this gate wrote no tracked file. */
const gitStatus = (record) => {
  record?.('git-status')
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', '& git -c core.quotepath=false status --porcelain; "[exit=" + $LASTEXITCODE + "]"'], { cwd: PROJECT, encoding: 'utf8', timeout: 40000, windowsHide: true })
  if (done.status !== 0) return { ok: false, why: clip(String(done.stderr ?? ''), 200), text: null, lines: [] }
  const rows = String(done.stdout ?? '').split(/\r?\n/).map((row) => row.replace(/\r$/, '')).filter((row) => row !== '' && /^\[exit=\d+\]$/.test(row) === false)
  return { ok: true, text: rows.join('\n'), lines: rows }
}

/** One read-only GET, recorded verbatim in the transcript (target, path and status, no more). */
const httpGet = async (target, path, reads, timeoutMs = 12000) => {
  const origin = target === 'shell' ? SHELL_ORIGIN : target === 'kernel' ? KERNEL_ORIGIN : 'http://127.0.0.1:' + String(CDP_PORT)
  const port = target === 'shell' ? PORT : target === 'kernel' ? KERNEL_PORT : CDP_PORT
  const record = { at: new Date().toISOString(), kind: 'http', method: 'GET', target, path, port, status: null, ok: false, why: null }
  reads.push(record)
  try {
    const answer = await fetch(origin + path, { signal: AbortSignal.timeout(timeoutMs) })
    record.status = answer.status
    const text = await answer.text()
    record.ok = answer.status === 200
    return { ok: answer.status === 200, status: answer.status, text, why: answer.status === 200 ? null : 'HTTP ' + String(answer.status) }
  } catch (error) {
    record.why = clip(describe(error), 200)
    return { ok: false, status: null, text: null, why: describe(error) }
  }
}

/** The one page evaluation: a value read, with the expression itself recorded so reading 8 can judge it. */
const readMarker = async (reads) => {
  const listed = await httpGet('cdp', '/json/list', reads)
  if (listed.ok !== true) return { read: false, why: 'CDP ' + String(CDP_PORT) + ' did not answer /json/list (' + String(listed.why) + '), so the live page cannot be reached at all' }
  let targets = null
  try {
    targets = JSON.parse(String(listed.text))
  } catch (error) {
    return { read: false, why: 'CDP ' + String(CDP_PORT) + ' answered /json/list with something that is not JSON (' + describe(error) + ')' }
  }
  const pages = (Array.isArray(targets) ? targets : []).filter((target) => target?.type === 'page')
  const page = pages.find((target) => String(target.url).includes(':' + String(PORT))) ?? null
  if (page === null) return { read: false, why: 'CDP has no page target on port ' + String(PORT) + ' (targets: ' + show(pages.map((target) => target.url)) + ')' }
  if (typeof WebSocket === 'undefined') return { read: false, why: 'this node has no global WebSocket, so the one read-only evaluate cannot be made' }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  reads.push({ at: new Date().toISOString(), kind: 'ws', target: 'cdp', port: CDP_PORT, method: 'connect', purpose: 'transport-for-one-read-only-evaluate', url: clip(String(page.url), 80) })
  const opened = await new Promise((settle) => {
    socket.addEventListener('open', () => settle(true), { once: true })
    socket.addEventListener('error', () => settle(false), { once: true })
    setTimeout(() => settle(false), 15000)
  })
  if (opened !== true) {
    try {
      socket.close()
    } catch {
      /* the socket is the OS's to reap */
    }
    return { read: false, why: 'the CDP socket of ' + String(page.url) + ' did not open' }
  }
  const answer = await new Promise((settle) => {
    const id = 1
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === id) settle(message)
    })
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: MARKER_EXPRESSION, returnByValue: true } }))
    setTimeout(() => settle(null), 15000)
  })
  reads.push({ at: new Date().toISOString(), kind: 'cdp', target: 'cdp', port: CDP_PORT, method: 'Runtime.evaluate', expression: MARKER_EXPRESSION, purpose: 'read-one-global-value' })
  try {
    socket.close()
  } catch {
    /* the socket is the OS's to reap */
  }
  if (answer === null) return { read: false, why: 'the one read-only Runtime.evaluate never answered' }
  const failure = answer?.result?.exceptionDetails?.text ?? answer?.error?.message ?? null
  if (failure !== null) return { read: false, why: 'the read-only Runtime.evaluate threw: ' + clip(failure, 200) }
  const raw = answer?.result?.result?.value
  if (raw === undefined) return { read: false, why: 'the read-only Runtime.evaluate answered without a value (' + show(answer?.result) + ')' }
  let value = null
  try {
    value = JSON.parse(String(raw))
  } catch (error) {
    return { read: true, why: null, raw: String(raw), value: null, unparsable: describe(error), page: String(page.url) }
  }
  return { read: true, why: null, raw: String(raw), value, unparsable: null, page: String(page.url) }
}

/**
 * The ledger's bytes, as a map of file -> {size, sha256} plus one digest over the whole map.
 *
 * The ledger is a file the kernel keeps, so "a GET changed nothing" is a claim about BYTES on disk and
 * not about the shape of an answer. Read-only throughout: this walks, reads and hashes, and writes nothing.
 */
const ledgerTree = (root) => {
  const files = []
  const walk = (dir, prefix) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      return 'the ledger directory ' + dir + ' could not be listed: ' + describe(error)
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      const name = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) {
        const why = walk(full, name)
        if (why !== null) return why
        continue
      }
      if (entry.isFile() !== true) continue
      try {
        const bytes = readFileSync(full)
        files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      } catch (error) {
        return 'the ledger file ' + full + ' could not be read: ' + describe(error)
      }
    }
    return null
  }
  if (existsSync(root) !== true) return { ok: false, why: 'the ledger directory ' + root + ' is not there', root, files: [], digest: null }
  const why = walk(root, '')
  if (why !== null) return { ok: false, why, root, files: [], digest: null }
  files.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  const digest = sha256(files.map((file) => file.name + ' ' + String(file.bytes) + ' ' + file.sha256).join('\n'))
  return { ok: true, why: null, root, files, digest }
}

// ---------------------------------------------------------------------------
// The measured world: read-only throughout
// ---------------------------------------------------------------------------

const runWorld = async (bag) => {
  const transcript = {
    schema: 'r189-g124-transcript/1',
    gate: 'panel-live',
    startedAt: new Date().toISOString(),
    shellOrigin: SHELL_ORIGIN,
    kernelOrigin: KERNEL_ORIGIN,
    port: PORT,
    kernelPort: KERNEL_PORT,
    cdpPort: CDP_PORT,
    subject: SUBJECT,
    subjectRow: SUBJECT_ROW,
    markerKey: MARKER_KEY,
    markerExpression: MARKER_EXPRESSION,
    controls: CONTROLS,
    frozenTabId: FROZEN_TAB_ID,
    frozenLimits: FROZEN_LIMITS,
    /** The boundary this gate may not cross, stated where the transcript carries it (reading 7 judges it). */
    boundary: {
      statement: PIXEL_BOUNDARY,
      panelOperations: 0,
      pixelReadings: 0,
      pixelReading: false,
      needs: 'an exclusive window: opening the pane takes the window away from whoever is using it, so a render gate is a separate, scheduled act',
      forbiddenHere: ['POST of any kind', 'POST ' + NOTES_ADD_PATH, 'POST /__shell/panel', 'a panel lease', 'Input.*', 'a DOM write', 'Page.navigate'],
    },
    reads: [],
    guard: null,
    entry: { at: null, statusHttp: null, status: null, phase: null, pid: null, clientIdentity: null, gitStatus: null, otherConsumers: null },
    ledger: { before: null, after: null },
    page: { read: false, why: null, at: null, httpStatus: null, bytes: null, sha256: null, html: null, occurrences: null, names: null, unique: null, malformed: null, ours: null, shape: null },
    routes: {
      panel: { read: false, why: null, at: null, httpStatus: null, bytes: null, sha256: null, body: null },
      notes: { read: false, why: null, at: null, httpStatus: null, bytes: null, sha256: null, body: null },
    },
    marker: { read: false, why: null, at: null, raw: null, value: null, page: null },
    exit: { at: null, statusHttp: null, status: null, phase: null, pid: null, clientIdentity: null, gitStatus: null, page: null },
    fingerprint: { clientPid: null, listLength: null, blockCount: null },
    write: null,
    notes: [],
    problems: [],
  }
  bag.transcript = transcript
  const record = (purpose) => transcript.reads.push({ at: new Date().toISOString(), kind: 'pwsh', purpose, sideEffect: 'none' })
  const noteLedger = (purpose) => {
    const root = transcript.ledgerRoot ?? null
    const tree = root === null ? { ok: false, why: 'the kernel home was not read, so the ledger could not be located', root: null, files: [], digest: null } : ledgerTree(root)
    transcript.reads.push({ at: new Date().toISOString(), kind: 'file', target: 'ledger', root: tree.root, files: tree.files.length, digest: tree.digest, purpose, sideEffect: 'none' })
    return tree
  }

  try {
    // --- the single-run guard, before anything in the live world is touched --------------------------
    const live = liveGateFiles()
    const ancestors = ancestorPids(record)
    const processes = nodeProcesses(record)
    if (processes.ok !== true) throw new NotMeasured('the single-run guard could not read the process list (' + String(processes.why) + '), so this gate cannot promise it is alone')
    const others = otherConsumers(processes.rows, live, ancestors)
    transcript.guard = { read: true, liveFiles: live.files, registerParsed: live.parsed ?? 0, parseNote: live.why, others, nodeProcesses: processes.rows.length, ancestors }
    transcript.entry.otherConsumers = others
    if (others.length > 0) throw new NotMeasured('another live consumer is running, and this gate must be the only reader of this world: ' + others.join(' | '))

    transcript.entry.at = new Date().toISOString()
    transcript.entry.clientIdentity = clientIdentity(record)
    const before = gitStatus(record)
    transcript.entry.gitStatus = before.ok === true ? before : { ok: false, why: before.why, lines: [] }

    // --- the precondition: the shell's own words ----------------------------------------------------
    const status = await httpGet('shell', STATUS_PATH, transcript.reads)
    transcript.entry.statusHttp = status.status
    if (status.ok === true) {
      try {
        transcript.entry.status = JSON.parse(String(status.text))
      } catch (error) {
        transcript.entry.status = null
        transcript.notes.push('NOT MEASURED in the world: ' + STATUS_PATH + ' answered 200 with something that is not JSON (' + describe(error) + ')')
      }
    }
    transcript.entry.phase = transcript.entry.status?.phase ?? null
    transcript.entry.pid = transcript.entry.status?.pid ?? null

    // --- the ledger, located from the shell's own reported home, and hashed BEFORE any reading ------
    const home = typeof transcript.entry.status?.home === 'string' ? transcript.entry.status.home : null
    transcript.ledgerRoot = home === null ? null : join(home, LEDGER_LEAF)
    transcript.ledger.before = noteLedger('ledger-bytes-before')

    // --- the instrument: every block of the shell's own preload list -------------------------------
    const page = await httpGet('shell', PAGE_PATH, transcript.reads)
    transcript.page.read = page.ok === true
    transcript.page.why = page.why
    transcript.page.at = new Date().toISOString()
    transcript.page.httpStatus = page.status
    if (page.ok === true) {
      const html = String(page.text)
      const parsed = parsePreloadList(html)
      transcript.page.bytes = Buffer.byteLength(html, 'utf8')
      transcript.page.sha256 = sha256(html)
      transcript.page.html = html
      transcript.page.occurrences = parsed.blockCount
      transcript.page.names = parsed.names.length
      transcript.page.unique = parsed.unique
      transcript.page.malformed = parsed.malformed
      transcript.page.ours = parsed.ours
      transcript.page.blocks = parsed.blocks.map((block) => ({ url: clip(block.url, 90), members: block.members.length }))
      transcript.page.firstBlockOnly = parsed.firstBlockOnly
      transcript.page.shape = { hasListMarker: parsed.hasListMarker, hasBoot: parsed.hasBoot, hasRev: parsed.hasRev }
    }
    transcript.fingerprint.clientPid = transcript.entry.pid
    transcript.fingerprint.listLength = Array.isArray(transcript.page.unique) ? transcript.page.unique.length : null
    transcript.fingerprint.blockCount = transcript.page.occurrences ?? null

    // --- the two REAL routes, read on the kernel port ----------------------------------------------
    for (const [slot, path] of [['panel', PANEL_STATE_PATH], ['notes', NOTES_STATE_PATH]]) {
      const answer = await httpGet('kernel', path, transcript.reads)
      const bucket = transcript.routes[slot]
      bucket.read = answer.ok === true
      bucket.why = answer.why
      bucket.at = new Date().toISOString()
      bucket.httpStatus = answer.status
      if (answer.text !== null) {
        bucket.bytes = Buffer.byteLength(String(answer.text), 'utf8')
        bucket.sha256 = sha256(String(answer.text))
      }
      if (answer.ok === true) {
        try {
          bucket.body = JSON.parse(String(answer.text))
        } catch (error) {
          bucket.body = null
          bucket.why = 'the route answered 200 with something that is not JSON (' + describe(error) + ')'
        }
      }
    }

    // --- half (a) and (b): the one read-only evaluate ----------------------------------------------
    transcript.marker.at = new Date().toISOString()
    const marker = await readMarker(transcript.reads)
    transcript.marker = { ...transcript.marker, ...marker, at: transcript.marker.at }
  } catch (error) {
    if (error instanceof NotMeasured) transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    else transcript.problems.push('the read-only run stopped on an unexpected error: ' + describe(error) + (error?.stack === undefined ? '' : '\n' + String(error.stack).split('\n').slice(0, 4).join('\n')))
  } finally {
    try {
      transcript.exit.at = new Date().toISOString()
      const status = await httpGet('shell', STATUS_PATH, transcript.reads)
      transcript.exit.statusHttp = status.status
      if (status.ok === true) {
        try {
          transcript.exit.status = JSON.parse(String(status.text))
        } catch {
          transcript.exit.status = null
        }
      }
      transcript.exit.phase = transcript.exit.status?.phase ?? null
      transcript.exit.pid = transcript.exit.status?.pid ?? null
      const page = await httpGet('shell', PAGE_PATH, transcript.reads)
      transcript.exit.page = {
        read: page.ok === true,
        why: page.why,
        httpStatus: page.status,
        bytes: page.text === null ? null : Buffer.byteLength(String(page.text), 'utf8'),
        sha256: page.text === null ? null : sha256(String(page.text)),
        unique: page.ok === true ? parsePreloadList(String(page.text)).unique : null,
        occurrences: page.ok === true ? parsePreloadList(String(page.text)).blockCount : null,
      }
      transcript.ledger.after = noteLedger('ledger-bytes-after')
      transcript.exit.clientIdentity = clientIdentity(record)
      const after = gitStatus(record)
      transcript.exit.gitStatus = after.ok === true ? after : { ok: false, why: after.why, lines: [] }
      transcript.reads.push({ at: new Date().toISOString(), kind: 'none', method: 'none', purpose: 'nothing-else-was-sent', note: 'no write was sent: no POST, no panel write mouth, no lease, no injected input, no DOM write, no model round' })
    } catch (error) {
      transcript.problems.push('the exit fingerprint could not be read: ' + describe(error))
    }
    // The world changed under the gate: a named third state, never a product red.
    if (transcript.entry.pid !== null && transcript.exit.pid !== null && transcript.entry.pid !== transcript.exit.pid) {
      transcript.notes.push('NOT MEASURED in the world: the kernel pid changed while this gate was reading (' + String(transcript.entry.pid) + ' -> ' + String(transcript.exit.pid) + '): a restart in the middle is a named third state, not a product verdict')
    }
    if (transcript.entry.clientIdentity !== null && transcript.exit.clientIdentity !== null && transcript.entry.clientIdentity !== transcript.exit.clientIdentity) {
      transcript.notes.push('NOT MEASURED in the world: the desktop client that answered the first read was replaced while this gate was running (' + String(transcript.entry.clientIdentity) + ' -> ' + String(transcript.exit.clientIdentity) + ')')
    }
    if (transcript.entry.gitStatus?.ok !== true || transcript.exit.gitStatus?.ok !== true) {
      transcript.notes.push('note: git status --porcelain could not be read on one side (' + String(transcript.entry.gitStatus?.why ?? transcript.exit.gitStatus?.why ?? '') + '), so reading 9 names that half unread')
    }
    if (transcript.ledger.before?.ok !== true || transcript.ledger.after?.ok !== true) {
      transcript.notes.push('note: the ledger bytes could not be read on one side (' + String(transcript.ledger.before?.why ?? transcript.ledger.after?.why ?? '') + '), so reading 6 names that half unread')
    }
    // The dump is the evidence; it is written into the git-ignored scratch path, after the fingerprint.
    try {
      const path = DUMP_OPTION === null ? join(SCRATCH_DIR, 'transcript-' + String(transcript.startedAt).replace(/[:.]/g, '-') + '.json') : resolve(DUMP_OPTION)
      mkdirSync(dirname(path), { recursive: true })
      // The write record is part of the transcript, so it is set BEFORE serializing (and its byte count
      // settles on the real file size): a replay of this file must be able to judge reading 9 unchanged.
      transcript.write = { path, bytes: 0, insideScratch: resolve(path).startsWith(resolve(SCRATCH_DIR)) === true, at: new Date().toISOString() }
      let settled = -1
      for (let pass = 0; pass < 4; pass += 1) {
        writeFileSync(path, JSON.stringify(transcript, null, 1))
        const size = statSync(path).size
        if (size === settled) break
        settled = size
        transcript.write.bytes = size
      }
    } catch (error) {
      transcript.notes.push('note: the transcript could not be written out (' + describe(error) + ')')
    }
  }
  return transcript
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript
// ---------------------------------------------------------------------------

const OK = (detail) => ({ ok: true, detail })
const BAD = (detail) => ({ ok: false, detail })
const NOT_MEASURED = (detail) => ({ ok: false, notMeasured: true, detail })

const buildFacts = (transcript) => {
  const page = transcript?.page ?? {}
  const parsed = typeof page.html === 'string' ? parsePreloadList(page.html) : { blocks: [], blockCount: 0, names: [], unique: [], malformed: [], ours: [], firstBlockOnly: [], fragmentOf: () => null, hasListMarker: false, hasBoot: false, hasRev: false }
  const marker = transcript?.marker ?? null
  const list = parsed.unique
  const controlsPresent = CONTROLS.filter((name) => list.includes(name))
  const panelBody = transcript?.routes?.panel?.body ?? null
  const notesBody = transcript?.routes?.notes?.body ?? null
  return {
    transcript,
    parsed,
    list,
    controlsPresent,
    marker,
    markerValue: marker?.value ?? null,
    panelBody,
    panelVisible: panelBody !== null && typeof panelBody === 'object' && Array.isArray(panelBody.declared?.visible) ? panelBody.declared.visible : null,
    notesBody,
    notesLimits: notesBody !== null && typeof notesBody === 'object' ? notesBody.limits ?? null : null,
    notesRows: notesBody !== null && typeof notesBody === 'object' && Array.isArray(notesBody.notes) ? notesBody.notes : null,
    rows: Array.isArray(transcript?.page?.unique) ? transcript.page.unique : [],
    exitRows: Array.isArray(transcript?.exit?.page?.unique) ? transcript.exit.page.unique : null,
    reads: Array.isArray(transcript?.reads) ? transcript.reads : [],
    entry: transcript?.entry ?? {},
    exit: transcript?.exit ?? {},
    guard: transcript?.guard ?? null,
    write: transcript?.write ?? null,
    ledger: transcript?.ledger ?? {},
    boundary: transcript?.boundary ?? null,
    listLength: transcript?.fingerprint?.listLength ?? null,
    stopped: lines((transcript?.notes ?? []).join('\n')).filter((note) => note.startsWith('NOT MEASURED in the world')),
  }
}

const readingsFor = (transcript) => {
  const f = buildFacts(transcript)
  /** The judged world is the one the TRANSCRIPT recorded: a replay must not re-judge it against other flags. */
  const gatePort = Number(transcript?.port ?? PORT)
  const gateKernelPort = Number(transcript?.kernelPort ?? KERNEL_PORT)
  const gateCdpPort = Number(transcript?.cdpPort ?? CDP_PORT)
  const R = []
  R.push({
    id: '0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run',
    judge: () => {
      if (f.entry.statusHttp !== 200 || f.entry.status === null) {
        return NOT_MEASURED('the precondition does not hold: GET ' + STATUS_PATH + ' answered ' + show(f.entry.statusHttp) + (f.entry.status === null ? ' with no readable body' : '') + ', so there is no ready shell to read')
      }
      if (f.exit.statusHttp !== 200 || f.exit.status === null) {
        return NOT_MEASURED('the shell stopped answering ' + STATUS_PATH + ' while this gate was reading (exit read: ' + show(f.exit.statusHttp) + '), so the list this gate read cannot be attributed to one live client')
      }
      if (f.entry.phase !== 'ready' || f.exit.phase !== 'ready') return NOT_MEASURED('the shell does not say ready (entry phase=' + show(f.entry.phase) + ', exit phase=' + show(f.exit.phase) + '): the client is not in a state this gate can read')
      if (f.entry.pid === null || f.exit.pid === null) return NOT_MEASURED('the shell reported no pid (' + show(f.entry.pid) + ' -> ' + show(f.exit.pid) + '), so "the same client stood through the run" cannot be shown')
      if (f.entry.pid !== f.exit.pid) return NOT_MEASURED('the kernel pid changed while this gate was reading (' + String(f.entry.pid) + ' -> ' + String(f.exit.pid) + '): a restart in the middle is a NAMED THIRD STATE (exit 3), not a product red and not "the list lost a row"')
      if (f.entry.clientIdentity === null || f.exit.clientIdentity === null) return NOT_MEASURED('the desktop client process could not be named on both sides (' + show(f.entry.clientIdentity) + ' -> ' + show(f.exit.clientIdentity) + ')')
      if (f.entry.clientIdentity !== f.exit.clientIdentity) return NOT_MEASURED('the desktop client was replaced while this gate was reading (' + String(f.entry.clientIdentity) + ' -> ' + String(f.exit.clientIdentity) + '): a named third state')
      if (f.guard === null || f.guard.read !== true) return NOT_MEASURED('the single-run guard did not run, so "this gate was alone with this world" is not a fact')
      if (Array.isArray(f.guard.others) && f.guard.others.length > 0) return NOT_MEASURED('another live consumer is running, and this gate must be the only reader of this world: ' + show(f.guard.others))
      return OK('GET ' + STATUS_PATH + ' answered 200 twice with phase=ready and the same kernel pid ' + String(f.entry.pid) + ' (port ' + show(f.entry.status?.port) + ', version ' + show(f.entry.status?.version) + ', home ' + show(f.entry.status?.home) + '); the desktop client process was ' + String(f.entry.clientIdentity) + ' at entry and identical at exit, so one live world stood still for this whole read; the single-run guard read ' + String(f.guard.nodeProcesses) + ' node process(es) against the register\'s ' + String(f.guard.liveFiles.length) + ' live gate file(s) and saw nobody else')
    },
  })
  R.push({
    id: '1-the-instrument-parsed-every-plugins-block-in-the-shells-own-page',
    judge: () => {
      if (f.transcript?.page?.read !== true) return NOT_MEASURED('GET ' + PAGE_PATH + ' on the shell never came back (' + String(f.transcript?.page?.why ?? 'no reason recorded') + '), so there is no page to read and no list to parse')
      if (f.transcript?.page?.httpStatus !== 200) return BAD('GET ' + PAGE_PATH + ' answered ' + show(f.transcript?.page?.httpStatus) + ': the shell answered something that is not its page')
      const shape = f.transcript?.page?.shape ?? {}
      if (shape.hasListMarker !== true) return BAD('the 200 body carries no plugins/?? preload expression at all (' + String(f.transcript?.page?.bytes) + ' bytes): the reader is not looking at the shell\'s own boot page')
      if (shape.hasBoot !== true) return BAD('the 200 body carries no __DSH_BOOT__ boot envelope, so it is not the shell page this instrument reads')
      if (shape.hasRev !== true) return BAD('the preload expression carries no &rev=<hash> on any URL, so the list cannot be attributed to a build')
      if (f.parsed.blockCount === 0) return BAD('walking EVERY plugins/?? block in the 200 body matched nothing: the body is not the page this instrument reads')
      if (f.list.length === 0) return BAD('the block walk parsed ' + String(f.parsed.blockCount) + ' block(s) to zero rows: an empty list is a broken instrument, not a green world')
      if (f.parsed.malformed.length > 0) return BAD('the list carries ' + String(f.parsed.malformed.length) + ' row(s) that are not <name>/client.js: ' + show(f.parsed.malformed))
      const perBlock = compressSizes(f.parsed.blocks.map((block) => block.members.length))
      return OK('GET ' + PAGE_PATH + ' answered 200 (' + String(f.transcript.page.bytes) + ' bytes, sha256 ' + clip(String(f.transcript.page.sha256), 12) + '); the instrument walked EVERY plugins/?? block - ' + String(f.parsed.blockCount) + ' block(s) with ' + String(f.parsed.names.length) + ' member(s) between them (' + perBlock + ' rows per block) - and the union is ' + String(f.list.length) + ' unique client row(s) (' + String(f.parsed.duplicates) + ' repeat(s)), every row <name>/client.js; of those ' + String(f.parsed.ours.length) + ' are dsh-* rows: ' + show(f.parsed.ours) + '; the FIRST block alone holds ' + String(f.parsed.firstBlockOnly.length) + ' row(s), which is why a parser that stopped at the first match would be a different instrument')
    },
  })
  R.push({
    id: '2-the-panel-client-half-is-on-the-live-preload-list',
    judge: () => {
      if (f.transcript?.page?.read !== true || f.list.length === 0) return NOT_MEASURED('there is no parsed list to look into (' + String(f.transcript?.page?.why ?? 'the page did not come back') + ')')
      if (f.list.includes(SUBJECT_ROW) !== true) return BAD('DELIVERY is missing: ' + SUBJECT_ROW + ' is NOT in the union over the page\'s ' + String(f.parsed.blockCount) + ' plugins/?? block(s) (' + String(f.list.length) + ' unique rows, dsh-* rows: ' + show(f.parsed.ours) + '); the row was not mounted, or the manifest, or the built lib/client.js')
      const blockAt = f.parsed.blocks.findIndex((block) => block.members.includes(SUBJECT_ROW))
      return OK('DELIVERY holds: ' + SUBJECT_ROW + ' is row #' + String(f.list.indexOf(SUBJECT_ROW)) + ' of ' + String(f.list.length) + ' unique client row(s), and it came out of block #' + String(blockAt) + ' of ' + String(f.parsed.blockCount) + ' (it is NOT in the first block, which holds ' + String(f.parsed.firstBlockOnly.length) + ' rows: only the union over every block sees it); the measured bytes say ...' + String(f.parsed.fragmentOf(SUBJECT_ROW)) + '...')
    },
  })
  R.push({
    id: '3-the-panel-client-half-registered-in-the-live-page',
    judge: () => {
      if (f.marker?.read !== true) return NOT_MEASURED('half (a) could not be read: ' + String(f.marker?.why ?? 'no reason recorded') + ' (this is a named third state: nothing here says the client half failed)')
      if (f.marker.unparsable !== null && f.marker.unparsable !== undefined) return BAD('the page answered the marker as something this gate cannot read as JSON (' + String(f.marker.unparsable) + '): ' + show(f.marker.raw))
      if (f.markerValue === null || typeof f.markerValue !== 'object') {
        if (f.list.includes(SUBJECT_ROW) === true) return BAD('half (a) is missing: the row IS on the preload list but the page carries no globalThis.' + MARKER_KEY + ' at all (the whole value was ' + show(f.marker.raw) + '): delivery happened and the registration path left no trace, so the two halves are reported separately and this one is not green')
        return BAD('the page carries no globalThis.' + MARKER_KEY + ' (value ' + show(f.marker.raw) + ') and the row is not on the list either')
      }
      const value = f.markerValue
      if (value.disposed === true) return BAD('half (a) FAILED BY NAME: the client half marked itself disposed ({mounted:false, disposed:true}) - it registered and was then unloaded')
      if (value.mounted !== true) return BAD('half (a) is not mounted: mounted=' + show(value.mounted) + ' (the whole marker is ' + show(value) + ')')
      if (typeof value.failed === 'string' && value.failed !== '') return BAD('half (a) FAILED BY NAME: the client half marked itself failed with the verbatim error ' + show(value.failed))
      if (value.failed !== null) return BAD('the frozen marker carries failed: null on success, and this one carries failed=' + show(value.failed) + ' (the whole marker is ' + show(value) + ')')
      if (value.tabId !== FROZEN_TAB_ID) return BAD('half (a) registered under a tab id this round does not freeze: tabId=' + show(value.tabId) + ' while R189 freezes ' + show(FROZEN_TAB_ID) + ' (marker ' + show(value) + ')')
      const extra = Object.keys(value).filter((key) => ['mounted', 'tabId', 'items', 'notes', 'failed'].includes(key) === false)
      return OK('half (a) REGISTRATION holds: the live page carries globalThis.' + MARKER_KEY + ' = ' + String(f.marker.raw) + ' (mounted=' + show(value.mounted) + ', tabId=' + show(value.tabId) + ', failed=' + show(value.failed) + (extra.length === 0 ? ')' : '; also carries ' + show(extra) + ', which this reading does not judge)') + ' - read by ONE Runtime.evaluate whose whole expression was ' + MARKER_EXPRESSION + '. THIS READING PROVES ONE THING ONLY: the registration path ran. mounted===true is written before the first answer lands (markView(globals, face.initial()) then void face.load()), so whether the two routes were READ BACK is reading 4\'s judgement, not this one')
    },
  })
  R.push({
    id: '4-the-marker-read-back-the-two-real-routes',
    judge: () => {
      if (f.transcript?.routes?.panel?.read !== true) return NOT_MEASURED('half (b) cannot be judged without the real route: GET ' + PANEL_STATE_PATH + ' on the kernel never came back (' + String(f.transcript?.routes?.panel?.why ?? 'no reason recorded') + ')')
      if (f.transcript?.routes?.panel?.httpStatus !== 200) return BAD('the real registry route answered ' + show(f.transcript?.routes?.panel?.httpStatus) + ' instead of 200, so there is nothing to compare the marker against')
      if (f.panelVisible === null) return BAD('the real registry route answered 200 with no declared.visible array (' + clip(show(f.panelBody), 200) + '), so the marker cannot be held to it')
      if (f.marker?.read !== true) return NOT_MEASURED('half (b) could not be read: ' + String(f.marker?.why ?? 'no reason recorded') + ' (a named third state: nothing here says the client half failed)')
      if (f.marker.unparsable !== null && f.marker.unparsable !== undefined) return BAD('the page answered the marker as something this gate cannot read as JSON (' + String(f.marker.unparsable) + '): ' + show(f.marker.raw))
      if (f.markerValue === null || typeof f.markerValue !== 'object') return BAD('the page carries no marker object at all (' + show(f.marker.raw) + '), so the read-back cannot be shown: registration and reading-back are different facts and neither stands in for the other')
      const value = f.markerValue
      if (typeof value.failed === 'string' && value.failed !== '') return BAD('half (b) FAILED BY NAME on the client side: the marker says ' + show(value.failed) + ', so at least one of the two reads did not come back clean')
      if (value.failed !== null) return BAD('the frozen marker carries failed: null on success, and this one carries failed=' + show(value.failed))
      const markerRows = rowsOf(value.items)
      if (markerRows === null) return BAD('the marker carries no items array, so nothing was read back from the registry route (the whole marker is ' + show(value) + ')')
      const routeRows = rowsOf(f.panelVisible)
      if (same(markerRows, routeRows) !== true) {
        const width = Math.max(markerRows.length, routeRows.length)
        let firstAt = -1
        for (let index = 0; index < width; index += 1) {
          if (markerRows[index] !== routeRows[index]) {
            firstAt = index
            break
          }
        }
        const orderOnly = same(canonical(value.items), canonical(f.panelVisible)) === true
        return BAD('half (b) FAILED: the marker\'s items are not the route\'s declared.visible. marker has ' + String(markerRows.length) + ' row(s) and the route lists ' + String(routeRows.length) + '; first difference at index ' + String(firstAt) + ' - marker ' + show(clip(String(markerRows[firstAt] ?? '(none)'), 160)) + ' vs route ' + show(clip(String(routeRows[firstAt] ?? '(none)'), 160)) + (orderOnly === true ? ' (the values match once keys are sorted, so this is a KEY-ORDER difference, which is still a byte difference)' : ''))
      }
      if (f.transcript?.routes?.notes?.read !== true) return NOT_MEASURED('half (b) cannot be judged without the real ledger route: GET ' + NOTES_STATE_PATH + ' on the kernel never came back (' + String(f.transcript?.routes?.notes?.why ?? 'no reason recorded') + ')')
      if (f.transcript?.routes?.notes?.httpStatus !== 200) return BAD('the real ledger route answered ' + show(f.transcript?.routes?.notes?.httpStatus) + ' instead of 200, so there is nothing to compare the marker against')
      const markerLimits = value.notes === null || typeof value.notes !== 'object' ? null : value.notes.limits ?? null
      if (same(markerLimits, f.notesLimits) !== true) return BAD('half (b) FAILED on the thresholds: the marker carries notes.limits=' + show(markerLimits) + ' while the real ledger route answers limits=' + show(f.notesLimits) + '; the pane shows the route\'s own thresholds and must carry them verbatim')
      if (f.notesRows === null) return BAD('the real ledger route answered 200 with no notes array (' + clip(show(f.notesBody), 200) + '), so the drawn count cannot be held to it')
      const drawn = value.notes.count
      const liveCount = f.notesRows.length
      // R277: the count is a FOLD-INSTANT observation, not a clock. The pane publishes it when it reads, and the
      // ledger keeps moving afterwards - an agent tool or another window can append a note between that fold and
      // this GET, which made an honest panel read as a stale one whenever the page had been open for a while (this
      // reading was red at R263 for exactly that: marker 20, ledger 22). What can be judged without a second fold
      // is direction: a pane that claims MORE notes than the ledger holds is wrong whatever the instant, and a
      // pane that claims FEWER is reporting an older instant, which is named here with its own size instead of
      // being called a failure. Equality is still judged when it holds.
      if (drawn > liveCount) return BAD('half (b) FAILED on the count: the marker says the pane drew notes.count=' + show(drawn) + ' row(s) while the real ledger route lists only ' + String(liveCount) + ' live note(s) - a pane cannot have drawn notes that do not exist')
      if (drawn < liveCount) return NOT_MEASURED('the two numbers are from different instants: the pane folded notes.count=' + String(drawn) + ' and the ledger now lists ' + String(liveCount) + ' live note(s), so ' + String(liveCount - drawn) + ' note(s) arrived after that fold. Nothing here says the pane is wrong - it publishes each fold and re-reads when its tab is opened - but equality cannot be judged from a fold that has already been overtaken', [String('marker notes.count=') + String(drawn), 'ledger notes.length=' + String(liveCount)])
      return OK('half (b) READ BACK holds. The marker\'s items are the real route\'s declared.visible, ROW BY ROW AND BYTE BY BYTE: ' + show(value.items) + ' === ' + show(f.panelVisible) + ' (' + String(markerRows.length) + ' row(s), every row equal as bytes, whole arrays equal as bytes). The marker\'s notes.limits === the real ledger route\'s limits: ' + show(markerLimits) + ' === ' + show(f.notesLimits) + '. The drawn count notes.count=' + String(drawn) + ' equals the ' + String(f.notesRows.length) + ' live note(s) the ledger route lists. Both answers came from the REAL routes on port ' + String(gateKernelPort) + ' (' + PANEL_STATE_PATH + ' sha256 ' + clip(String(f.transcript.routes.panel.sha256), 12) + ', ' + NOTES_STATE_PATH + ' sha256 ' + clip(String(f.transcript.routes.notes.sha256), 12) + ') while the marker was read once over CDP')
    },
  })
  R.push({
    id: '5-the-live-negative-control-is-absent-from-the-list',
    judge: () => {
      if (f.transcript?.page?.read !== true || f.list.length === 0) return NOT_MEASURED('there is no parsed list to look into (' + String(f.transcript?.page?.why ?? 'the page did not come back') + ')')
      if (f.controlsPresent.length > 0) {
        return BAD('the control arm is broken: ' + show(f.controlsPresent) + ' IS in the union over the page\'s ' + String(f.parsed.blockCount) + ' block(s) (' + String(f.list.length) + ' rows) while this round keeps those two rows unmounted; if this appears, the parser or the world is not the world this gate reads => RED, never green. The measured bytes say ...' + String(f.parsed.fragmentOf(f.controlsPresent[0])) + '...')
      }
      return OK(show(CONTROLS) + ' are not among the ' + String(f.list.length) + ' unique client row(s) read out of ' + String(f.parsed.blockCount) + ' block(s) (their manifests declare dsh.client.platform=web and their lib/client.js is built, so their absence is the row not being mounted - the third state the mount page names, not a build failure)')
    },
  })
  R.push({
    id: '6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch',
    judge: () => {
      const notesRead = f.transcript?.routes?.notes ?? null
      if (notesRead === null || notesRead.read !== true) return NOT_MEASURED('the live reading offline work cannot make could not be made here either: GET ' + NOTES_STATE_PATH + ' on port ' + String(gateKernelPort) + ' never came back (' + String(notesRead?.why ?? 'no reason recorded') + ')')
      if (notesRead.httpStatus !== 200) return BAD('GET ' + NOTES_STATE_PATH + ' on the real kernel answered ' + show(notesRead.httpStatus) + ' instead of 200, so the route is not answering a reader')
      const body = f.notesBody
      if (body === null || typeof body !== 'object') return BAD('the route answered 200 with a body this gate cannot read as an object: ' + show(notesRead.body))
      if (body.ok !== true) return BAD('the route answered 200 without ok:true (' + clip(show(body), 200) + ')')
      if (body.readOnly !== true) return BAD('the route does not carry readOnly:true (' + clip(show(body), 200) + '): a read route that does not say it is one is not a read route this gate may use')
      if (body.path !== NOTES_STATE_PATH) return BAD('the route answered under a path it does not name: body.path=' + show(body.path) + ' while it answered on ' + NOTES_STATE_PATH)
      const limits = body.limits ?? null
      if (same(limits, FROZEN_LIMITS) !== true) return BAD('the live thresholds are not the frozen ones: the route answers limits=' + show(limits) + ' while R189 freezes ' + show(FROZEN_LIMITS))
      const counts = body.counts
      if (counts === null || typeof counts !== 'object') return BAD('the route carries no counts object (' + clip(show(body), 200) + ')')
      for (const key of ['live', 'deleted', 'notes', 'open', 'done', 'malformed']) {
        if (typeof counts[key] !== 'number') return BAD('counts.' + key + ' is not a number: counts=' + show(counts))
      }
      if (f.notesRows === null) return BAD('the route carries no notes array, so its own counts cannot be held to it: ' + clip(show(body), 200))
      if (counts.live !== f.notesRows.length) return BAD('the route contradicts itself: counts.live=' + String(counts.live) + ' while it lists ' + String(f.notesRows.length) + ' live note(s)')
      if (counts.notes !== counts.live + counts.deleted) return BAD('the route\'s own arithmetic does not hold: counts.notes=' + String(counts.notes) + ' while counts.live + counts.deleted=' + String(counts.live + counts.deleted))
      if (counts.open + counts.done !== counts.live) return BAD('the route\'s own arithmetic does not hold: counts.open + counts.done=' + String(counts.open + counts.done) + ' while counts.live=' + String(counts.live))
      const writes = f.reads.filter((read) => read?.kind === 'http' && String(read?.method ?? '').toUpperCase() === 'POST' && String(read?.path ?? '') === NOTES_ADD_PATH)
      if (writes.length > 0) return BAD('the write mouth was used: this gate must send no POST at all, and it made ' + String(writes.length) + ' POST(s) to ' + NOTES_ADD_PATH + ' (the write path is gate 123\'s, offline)')
      const before = f.ledger?.before ?? null
      const after = f.ledger?.after ?? null
      if (before === null || before.ok !== true) return NOT_MEASURED('the ledger bytes could not be read before the readings (' + String(before?.why ?? 'no reason recorded') + '), so "a GET changed no byte" cannot be shown')
      if (after === null || after.ok !== true) return NOT_MEASURED('the ledger bytes could not be read after the readings (' + String(after?.why ?? 'no reason recorded') + '), so "a GET changed no byte" cannot be shown')
      if (before.root !== after.root) return BAD('the ledger this gate hashed moved between the two readings: ' + String(before.root) + ' -> ' + String(after.root))
      if (same(before.files, after.files) !== true || before.digest !== after.digest) {
        const moved = (after.files ?? []).filter((file) => JSON.stringify((before.files ?? []).find((one) => one.name === file.name) ?? null) !== JSON.stringify(file))
        const gone = (before.files ?? []).filter((file) => (after.files ?? []).some((one) => one.name === file.name) !== true)
        return BAD('a byte of the ledger moved while this gate was reading: digest ' + clip(String(before.digest), 12) + ' -> ' + clip(String(after.digest), 12) + '; changed or new ' + show(moved) + ', gone ' + show(gone))
      }
      const perFile = (before.files ?? []).map((file) => file.name + ' ' + String(file.bytes) + 'B sha256 ' + clip(file.sha256, 12)).join('; ')
      return OK('GET ' + NOTES_STATE_PATH + ' answered 200 on the real kernel (port ' + String(gateKernelPort) + ', ' + String(notesRead.bytes) + ' bytes, sha256 ' + clip(String(notesRead.sha256), 12) + ', readOnly=' + show(body.readOnly) + ', path=' + show(body.path) + '). Its limits are the frozen pair ' + show(limits) + ' and its counts are ' + show(counts) + '. The ledger under ' + String(before.root) + ' is BYTE-IDENTICAL either side of every reading - ' + String((before.files ?? []).length) + ' file(s), digest ' + clip(String(before.digest), 12) + ' before and ' + clip(String(after.digest), 12) + ' after (' + perFile + ') - and this gate sent no POST: ' + String(f.reads.filter((read) => read?.kind === 'http').length) + ' HTTP read(s), every one a GET, none of them to ' + NOTES_ADD_PATH)
    },
  })
  R.push({
    id: '7-what-this-gate-can-and-cannot-say-about-pixels',
    judge: () => {
      const problems = []
      const boundary = f.boundary
      if (boundary === null || typeof boundary !== 'object') {
        problems.push('the transcript carries no boundary record at all, so "this gate claims no pixel" is not a fact anybody can re-check')
      } else {
        if (boundary.pixelReading !== false) problems.push('this gate declares a pixel reading (boundary.pixelReading=' + show(boundary.pixelReading) + ') while a marker read over CDP cannot read a single pixel: reading a pixel needs the panel open, which needs an exclusive window')
        if (boundary.pixelReadings !== 0) problems.push('this gate declares ' + show(boundary.pixelReadings) + ' pixel reading(s); a render gate is a separate, scheduled act')
        if (boundary.panelOperations !== 0) problems.push('this gate declares ' + show(boundary.panelOperations) + ' panel operation(s)')
        if (typeof boundary.statement !== 'string' || boundary.statement.length === 0) problems.push('the boundary sentence is missing from the transcript')
      }
      const writes = f.reads.filter((read) => read?.kind === 'http' && String(read?.method ?? '').toUpperCase() !== 'GET')
      if (writes.length > 0) problems.push('a non-GET request was made: ' + show(writes.map((read) => read.method + ' ' + read.path)))
      const panelMouth = f.reads.filter((read) => String(read?.path ?? '').includes('/__shell/panel'))
      if (panelMouth.length > 0) problems.push('a panel write mouth was contacted: ' + show(panelMouth.map((read) => read.method + ' ' + read.path)))
      const injected = f.reads.filter((read) => read?.kind === 'cdp' && read?.method !== 'Runtime.evaluate')
      if (injected.length > 0) problems.push('a CDP call that is not a value read: ' + show(injected.map((read) => read.method)))
      // The fields judged are the record of what was DONE (purpose/method/path). The free-text note is
      // this gate telling a reader what it did NOT send, so it is deliberately not judged here.
      const leased = f.reads.filter((read) => /\blease\b|viewport|Input\./i.test([read?.purpose, read?.method, read?.path].filter((part) => typeof part === 'string').join(' | ')))
      if (leased.length > 0) problems.push('a lease, a viewport or an injected input: ' + show(leased.map((read) => read.purpose ?? read.method)))
      if (f.markerValue !== null && typeof f.markerValue === 'object') {
        const claimed = Object.keys(f.markerValue).filter((key) => /pixel|render|screenshot|paint|drawn/i.test(key))
        if (claimed.length > 0) problems.push('the marker itself claims something about pixels: ' + show(claimed) + ' (the frozen marker has no such field)')
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('THE BOUNDARY, as a reading and not as prose: ' + PIXEL_BOUNDARY + '. What this gate read - the marker\'s items and notes.count, and the two routes\' answers - shows that the CLIENT HALF COMPUTED A VIEW; it does not show one pixel, a tab being visible, a pane being open, or a character being legible. A pixel needs the panel open, and opening it takes the window away from whoever is using it, which is why the render gate is a separate, scheduled act. This gate performed ZERO PANEL OPERATIONS: no POST of any kind, no /__shell/panel, no lease, no viewport, no Input.*, no DOM write, no Page.navigate (' + String(f.reads.length) + ' recorded reads, all of them GETs, value reads, or local process/file reads; boundary=' + show(f.boundary) + ')')
    },
  })
  R.push({
    id: '8-this-gate-only-read-the-world',
    judge: () => {
      const problems = []
      const http = f.reads.filter((read) => read?.kind === 'http')
      for (const read of http) {
        const path = String(read.path ?? '')
        const allowed = read.method === 'GET' && ((read.target === 'shell' && ALLOWED_SHELL_PATHS.includes(path)) || (read.target === 'kernel' && ALLOWED_KERNEL_PATHS.includes(path)) || (read.target === 'cdp' && path === '/json/list'))
        if (allowed !== true) problems.push('a request outside the allowlist: ' + show({ kind: read.kind, method: read.method, target: read.target, path }))
      }
      const cdp = f.reads.filter((read) => read?.kind === 'cdp')
      if (cdp.length !== 1) problems.push('this gate must make exactly one CDP call and it made ' + String(cdp.length) + ': ' + show(cdp.map((read) => read.method)))
      for (const read of cdp) {
        if (read.method !== 'Runtime.evaluate') problems.push('a CDP method that is not a value read: ' + show(read.method))
        if (read.expression !== MARKER_EXPRESSION) problems.push('a page expression that is not the one frozen read: ' + show(read.expression))
      }
      const ws = f.reads.filter((read) => read?.kind === 'ws')
      if (ws.length !== 1 || ws.some((read) => read.purpose !== 'transport-for-one-read-only-evaluate')) problems.push('a websocket that is not the transport of the one read: ' + show(ws.map((read) => read.purpose)))
      for (const read of f.reads.filter((one) => one?.kind === 'pwsh')) {
        if (ALLOWED_DASH_PURPOSES.includes(String(read.purpose)) !== true) problems.push('a shell call outside the allowlist: ' + show(read.purpose))
      }
      for (const read of f.reads.filter((one) => one?.kind === 'file')) {
        if (ALLOWED_FILE_PURPOSES.includes(String(read.purpose)) !== true) problems.push('a file read outside the allowlist: ' + show(read.purpose))
      }
      const scan = f.reads.map((read) => [read?.kind, read?.method, read?.target, read?.path, read?.url, read?.expression, read?.purpose].filter((part) => part !== undefined && part !== null).join(' | ')).join('\n')
      if (FORBIDDEN_IN_READS.test(scan) === true) problems.push('the record of what this gate did names something it must never do (a write, the panel mouth, a lease, an injected input, DOM, navigation, a viewport): ' + clip(scan, 220))
      const ports = [...new Set(f.reads.map((read) => read?.port).filter((one) => typeof one === 'number'))].sort((left, right) => left - right)
      if (ports.some((one) => PORTS_THIS_GATE_MAY_SPEAK_TO.includes(one) !== true)) problems.push('a port outside the ones this gate may speak to (' + show(PORTS_THIS_GATE_MAY_SPEAK_TO) + '): ' + show(ports))
      if (f.guard === null || f.guard.read !== true) problems.push('the single-run guard did not run, so "this gate was alone" is not a fact')
      if (f.guard !== null && f.guard.read === true && !(f.guard.registerParsed > 0)) problems.push('the register of live gates could not be parsed, so the guard could not name the files it was watching: ' + show(f.guard.parseNote))
      if (problems.length > 0) return BAD(problems.join('; '))
      const kernelReads = http.filter((read) => read.target === 'kernel')
      return OK('this gate read and did nothing else: ' + String(http.filter((read) => read.target === 'shell').length) + ' read-only shell GET(s) over exactly two paths (' + show(ALLOWED_SHELL_PATHS) + '), ' + String(kernelReads.length) + ' read-only kernel GET(s) over exactly two state routes (' + show(ALLOWED_KERNEL_PATHS) + ') - no write mouth, no tool face, no POST - plus one CDP /json/list GET, ONE Runtime.evaluate whose whole expression was ' + MARKER_EXPRESSION + ', one websocket that was only its transport, ' + String(f.reads.filter((read) => read?.kind === 'pwsh').length) + ' local process/git read(s) (' + show(ALLOWED_DASH_PURPOSES) + ') and ' + String(f.reads.filter((read) => read?.kind === 'file').length) + ' ledger read(s) (' + show(ALLOWED_FILE_PURPOSES) + '); no POST, no /__shell/panel, no lease, no Input.*, no DOM write, no click, no typed text, no navigation, no viewport, no model round; ports touched ' + show(ports) + '; the single-run guard parsed ' + String(f.guard.liveFiles.length) + ' live gate file(s) from the register (' + String(f.guard.registerParsed) + ' gate rows) and saw no other live consumer among ' + String(f.guard.nodeProcesses) + ' node process(es)')
    },
  })
  R.push({
    id: '9-the-world-fingerprint-left-behind',
    judge: () => {
      const problems = []
      const single = ' (the live identity readings are reading 0\'s judgement: kernel pid ' + show(f.entry.pid) + ' -> ' + show(f.exit.pid) + ', desktop client ' + show(f.entry.clientIdentity) + ' -> ' + show(f.exit.clientIdentity) + ')'
      if (f.exit.page === null || f.exit.page?.read !== true) return NOT_MEASURED('the page could not be read a second time (' + String(f.exit.page?.why ?? 'no reason recorded') + '), so there is no fingerprint to compare' + single)
      if (f.exitRows === null) return NOT_MEASURED('the second reading of the page did not parse into rows, so the list before/after cannot be compared')
      if (f.transcript?.page?.sha256 !== f.transcript?.exit?.page?.sha256) problems.push('the shell page is not the same page it was at entry: sha256 ' + clip(String(f.transcript?.page?.sha256), 12) + ' -> ' + clip(String(f.transcript?.exit?.page?.sha256), 12) + ', ' + String(f.transcript?.page?.bytes) + ' -> ' + String(f.transcript?.exit?.page?.bytes) + ' bytes')
      const appeared = f.exitRows.filter((name) => f.rows.includes(name) === false)
      const vanished = f.rows.filter((name) => f.exitRows.includes(name) === false)
      if (appeared.length > 0 || vanished.length > 0) problems.push('the preload row set moved while this gate was reading: ' + String(f.rows.length) + ' -> ' + String(f.exitRows.length) + ' row(s), appeared ' + show(appeared) + ', vanished ' + show(vanished))
      if (f.entry.gitStatus?.ok !== true || f.exit.gitStatus?.ok !== true) problems.push('git status --porcelain could not be read on both sides (' + String(f.entry.gitStatus?.why ?? f.exit.gitStatus?.why ?? '') + ')')
      else if (f.entry.gitStatus.text !== f.exit.gitStatus.text) {
        const changed = f.exit.gitStatus.lines.filter((line) => f.entry.gitStatus.lines.includes(line) === false)
        problems.push('a tracked file moved while this gate was reading (' + String(changed.length) + ' new git status line(s): ' + show(changed) + '); this gate writes no tracked file (its transcript goes to ' + String(f.write?.path ?? '(not written)') + ', inside ' + show(SCRATCH_DIR.slice(PROJECT.length)) + ', which .gitignore ignores), so a difference is another writer or a leak in this gate')
      }
      if (f.write !== null && f.write.insideScratch !== true) problems.push('this gate wrote outside its scratch directory: ' + String(f.write.path))
      if (f.write === null) problems.push('this gate wrote no transcript at all, so the judged record is not on disk to be re-判')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the fingerprint held: the page is the same ' + String(f.transcript.page.bytes) + ' bytes with sha256 ' + clip(String(f.transcript.page.sha256), 12) + ' before and after, its ' + String(f.listLength) + ' unique client row(s) over ' + show(f.transcript?.page?.occurrences) + ' block(s) are the same set (' + String(f.rows.length) + ' -> ' + String(f.exitRows.length) + '), git status --porcelain is byte-identical before and after (' + String(f.entry.gitStatus.lines.length) + ' line(s)), and the only file this gate wrote is its transcript ' + String(f.write.path) + ' (' + String(f.write.bytes) + ' bytes, inside the git-ignored scratch path)' + single)
    },
  })
  return R
}

const runJudges = (transcript) => {
  const readings = readingsFor(transcript)
  return readings.map((reading) => {
    try {
      const verdict = reading.judge()
      return { id: reading.id, ok: verdict.ok === true, notMeasured: verdict.notMeasured === true, detail: String(verdict.detail ?? '') }
    } catch (error) {
      return { id: reading.id, ok: false, notMeasured: false, detail: 'the reading threw: ' + describe(error) }
    }
  })
}

// ---------------------------------------------------------------------------
// The self-attack: mutants of THE MEASURED TRANSCRIPT, one per mutant
// ---------------------------------------------------------------------------

const clone = (value) => JSON.parse(JSON.stringify(value))

const withMarker = (t, value) => {
  t.marker = { ...(t.marker ?? {}), read: true, why: null, unparsable: null, raw: JSON.stringify(value), value }
}
const markerOf = (t) => {
  const value = t?.marker?.value
  return value !== null && typeof value === 'object' ? value : {}
}

const MUTANTS = [
  {
    name: 'the-shell-was-restarted-while-the-gate-was-reading',
    declared: ['0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run'],
    what: 'a restart in the middle, which R189 makes a named third state (exit 3) and never a product red',
    apply: (t) => {
      t.exit.pid = Number(t.entry.pid ?? 1) + 1
      if (t.exit.status !== null && typeof t.exit.status === 'object') t.exit.status.pid = t.exit.pid
    },
  },
  {
    name: 'the-shell-never-said-ready',
    declared: ['0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run'],
    what: 'a client that is starting or dead, so there is no live world to read',
    apply: (t) => {
      t.entry.phase = 'starting'
      if (t.entry.status !== null && typeof t.entry.status === 'object') t.entry.status.phase = 'starting'
    },
  },
  {
    name: 'the-desktop-client-process-was-replaced-under-the-gate',
    declared: ['0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run'],
    what: 'the same kernel pid behind a different desktop client process: still one world, replaced',
    apply: (t) => {
      t.exit.clientIdentity = '424242@2099-01-01T00:00:00.0000000Z'
    },
  },
  {
    name: 'another-live-consumer-was-driving-the-same-client',
    declared: ['0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run'],
    what: 'the single-run discipline broken: this gate read a world somebody else was driving',
    apply: (t) => {
      t.guard = { ...(t.guard ?? {}), read: true, others: ['pid 4242 node scripts/verify-notes-live.mjs'] }
    },
  },
  {
    name: 'the-shell-page-carries-no-plugins-expression-at-all',
    declared: ['1-the-instrument-parsed-every-plugins-block-in-the-shells-own-page', '2-the-panel-client-half-is-on-the-live-preload-list', '5-the-live-negative-control-is-absent-from-the-list'],
    what: 'the instrument losing its whole subject: no block parses, so there is no list and no control arm to judge',
    apply: (t) => {
      t.page.html = String(t.page.html ?? '').split('plugins/??').join('plugins/')
    },
  },
  {
    name: 'a-row-in-the-list-is-not-a-client-js-row',
    declared: ['1-the-instrument-parsed-every-plugins-block-in-the-shells-own-page'],
    what: 'a list that parses into something other than <name>/client.js, so the instrument has changed shape',
    apply: (t) => {
      let once = true
      t.page.html = rewriteMembers(t.page.html, (members) => {
        if (once !== true || members.length === 0) return members
        once = false
        members[0] = members[0] + '/not-client.js'
        return members
      })
    },
  },
  {
    name: 'the-shell-answered-something-that-is-not-its-page',
    declared: ['1-the-instrument-parsed-every-plugins-block-in-the-shells-own-page'],
    what: 'a 200 that is not the boot page (an error page, a proxy page, anything else)',
    apply: (t) => {
      t.page.httpStatus = 200
      t.page.shape = { hasListMarker: true, hasBoot: false, hasRev: true }
    },
  },
  {
    name: 'our-row-was-dropped-from-the-measured-page',
    declared: ['2-the-panel-client-half-is-on-the-live-preload-list'],
    what: 'delivery failing on the measured bytes: a page without our name must go RED (ONE fact only - the marker is left exactly as measured, which is why the two halves are two readings)',
    apply: (t) => {
      t.page.html = rewriteMembers(t.page.html, (members) => members.filter((name) => name !== SUBJECT_ROW))
    },
  },
  {
    name: 'the-row-is-there-but-the-page-never-marked-anything',
    declared: ['3-the-panel-client-half-registered-in-the-live-page', '4-the-marker-read-back-the-two-real-routes'],
    what: 'delivery without liveness: the exact seam this gate exists to separate',
    apply: (t) => {
      t.marker = { ...(t.marker ?? {}), read: true, why: null, unparsable: null, raw: 'null', value: null }
    },
  },
  {
    name: 'the-client-half-marked-itself-failed',
    declared: ['3-the-panel-client-half-registered-in-the-live-page', '4-the-marker-read-back-the-two-real-routes'],
    what: 'the fail-closed shape the frozen contract names: {mounted:true, failed:"<verbatim>"}',
    apply: (t) => {
      withMarker(t, { mounted: true, failed: 'client: the panel registry route answered 500' })
    },
  },
  {
    name: 'the-client-half-was-disposed-after-registering',
    declared: ['3-the-panel-client-half-registered-in-the-live-page', '4-the-marker-read-back-the-two-real-routes'],
    what: 'the third named state: {mounted:false, disposed:true}',
    apply: (t) => {
      withMarker(t, { mounted: false, disposed: true })
    },
  },
  {
    name: 'the-tab-id-is-not-this-packages-id',
    declared: ['3-the-panel-client-half-registered-in-the-live-page'],
    what: 'a pane that registered under somebody else\'s address while every read came back',
    apply: (t) => {
      withMarker(t, { ...markerOf(t), tabId: 'dsh-link-another-pane' })
    },
  },
  {
    name: 'the-live-page-could-not-be-reached-over-cdp',
    declared: ['3-the-panel-client-half-registered-in-the-live-page', '4-the-marker-read-back-the-two-real-routes'],
    what: 'half (a) unmeasurable: a named third state, never a green and never a red',
    apply: (t) => {
      t.marker = { read: false, why: 'mutant: CDP has no page target on port ' + String(PORT), at: t.marker?.at ?? null, raw: null, value: null, page: null }
    },
  },
  {
    name: 'the-marker-kept-an-old-view-while-the-route-moved-on',
    declared: ['4-the-marker-read-back-the-two-real-routes'],
    what: 'registered and read once, but the marker is not what the route says NOW: the read-back is the claim, not the registration',
    apply: (t) => {
      const visible = t.routes?.panel?.body?.declared?.visible
      if (Array.isArray(visible) && visible.length > 0 && typeof visible[0] === 'object') visible[0].title = 'LINK panel (moved on)'
    },
  },
  {
    name: 'the-marker-lost-a-note-in-the-count',
    declared: ['4-the-marker-read-back-the-two-real-routes'],
    what: 'a view that draws fewer rows than the ledger route lists',
    apply: (t) => {
      const value = { ...markerOf(t) }
      value.notes = { ...(value.notes ?? {}), count: 0 }
      withMarker(t, value)
    },
  },
  {
    name: 'the-marker-carried-someone-elses-thresholds',
    declared: ['4-the-marker-read-back-the-two-real-routes'],
    what: 'a pane that re-derived a threshold instead of carrying the route\'s own: the marker and the route disagree',
    apply: (t) => {
      const value = { ...markerOf(t) }
      value.notes = { ...(value.notes ?? {}), limits: { maxNotes: 99, maxChars: 9 } }
      withMarker(t, value)
    },
  },
  {
    name: 'the-panel-route-that-the-marker-mirrors-never-answered',
    declared: ['4-the-marker-read-back-the-two-real-routes'],
    what: 'half (b) unmeasurable on the registry side: a named third state, never green',
    apply: (t) => {
      t.routes.panel = { read: false, why: 'mutant: the registry route never answered', at: t.routes?.panel?.at ?? null, httpStatus: null, bytes: null, sha256: null, body: null }
    },
  },
  {
    name: 'every-name-in-the-world-is-present-including-the-controls',
    declared: ['5-the-live-negative-control-is-absent-from-the-list'],
    what: 'the synthetic response with every name in it: the control arm must report the two controls as PRESENT',
    apply: (t) => {
      t.page.html = rewriteMembers(t.page.html, (members, url, first) => (first === true ? [...members, ...CONTROLS] : members))
    },
  },
  {
    name: 'the-notes-route-stopped-answering-on-the-real-kernel',
    declared: ['4-the-marker-read-back-the-two-real-routes', '6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch'],
    what: 'the live reading this round exists for, gone: both the read-back and the route reading go not-green',
    apply: (t) => {
      t.routes.notes = { read: false, why: 'mutant: the ledger route never answered', at: t.routes?.notes?.at ?? null, httpStatus: null, bytes: null, sha256: null, body: null }
    },
  },
  {
    name: 'the-notes-route-moved-on-and-the-marker-kept-the-old-pair',
    declared: ['4-the-marker-read-back-the-two-real-routes', '6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch'],
    what: 'the route changing its threshold under a marker that did not follow: the read-back AND the frozen pair both fail',
    apply: (t) => {
      if (t.routes?.notes?.body !== null && typeof t.routes?.notes?.body === 'object') t.routes.notes.body.limits = { maxNotes: 99, maxChars: 9 }
    },
  },
  {
    name: 'both-sides-agree-on-a-pair-that-is-not-the-frozen-one',
    declared: ['6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch'],
    what: 'the marker following the route faithfully is not enough: reading 6 judges the FROZEN pair on the route itself, so agreement alone must not go green',
    apply: (t) => {
      if (t.routes?.notes?.body !== null && typeof t.routes?.notes?.body === 'object') t.routes.notes.body.limits = { maxNotes: 99, maxChars: 9 }
      const value = { ...markerOf(t) }
      value.notes = { ...(value.notes ?? {}), limits: { maxNotes: 99, maxChars: 9 } }
      withMarker(t, value)
    },
  },
  {
    name: 'the-ledger-bytes-moved-while-the-gate-was-reading',
    declared: ['6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch'],
    what: 'a writer landing on the ledger during a read-only run: the bytes are the claim, so the bytes must be compared',
    apply: (t) => {
      if (t.ledger?.after?.ok !== true) return
      t.ledger.after.digest = 'f'.repeat(64)
      t.ledger.after.files = (t.ledger.after.files ?? []).map((file, index) => (index === 0 ? { ...file, bytes: file.bytes + 1, sha256: 'e'.repeat(64) } : file))
    },
  },
  {
    name: 'a-POST-was-sent-into-the-notes-write-mouth',
    declared: ['6-the-note-routes-live-reading-and-the-ledger-it-did-not-touch', '7-what-this-gate-can-and-cannot-say-about-pixels', '8-this-gate-only-read-the-world'],
    what: 'the one thing this round forbids outright: a write into the mouth gate 123 pins offline',
    apply: (t) => {
      t.reads.push({ at: new Date().toISOString(), kind: 'http', method: 'POST', target: 'kernel', path: NOTES_ADD_PATH, port: KERNEL_PORT, status: 200, ok: true, why: null })
    },
  },
  {
    name: 'the-marker-claimed-the-panel-was-drawn',
    declared: ['7-what-this-gate-can-and-cannot-say-about-pixels'],
    what: 'the over-claim R189 section 4.2 forbids in words: a marker field about pixels, while every read is exactly as measured',
    apply: (t) => {
      withMarker(t, { ...markerOf(t), rendered: true })
    },
  },
  {
    name: 'this-gate-claimed-it-read-pixels',
    declared: ['7-what-this-gate-can-and-cannot-say-about-pixels'],
    what: 'the boundary record itself lying: a pixel reading declared by a CDP value read',
    apply: (t) => {
      t.boundary = { ...(t.boundary ?? {}), pixelReading: true, pixelReadings: 1 }
    },
  },
  {
    name: 'this-gate-clicked-a-panel-button',
    declared: ['7-what-this-gate-can-and-cannot-say-about-pixels', '8-this-gate-only-read-the-world'],
    what: 'a record of the one thing this gate must never do: the panel write mouth, and an injected input',
    apply: (t) => {
      t.reads.push({ at: new Date().toISOString(), kind: 'http', method: 'POST', target: 'shell', path: '/__shell/panel', port: PORT, status: 200, ok: true, why: null })
      t.reads.push({ at: new Date().toISOString(), kind: 'cdp', target: 'cdp', method: 'Input.dispatchMouseEvent', port: CDP_PORT, purpose: 'mutant' })
    },
  },
  {
    name: 'a-kernel-path-outside-the-two-state-routes-was-contacted',
    declared: ['8-this-gate-only-read-the-world'],
    what: 'the kernel port reached for something other than the two read-only state routes',
    apply: (t) => {
      t.reads.push({ at: new Date().toISOString(), kind: 'http', method: 'GET', target: 'kernel', path: '/', port: KERNEL_PORT, status: 200, ok: true, why: null })
    },
  },
  {
    name: 'a-port-this-gate-must-never-speak-to-was-contacted',
    declared: ['8-this-gate-only-read-the-world'],
    what: 'a request on a port outside the three this gate may speak to',
    apply: (t) => {
      t.reads.push({ at: new Date().toISOString(), kind: 'http', method: 'GET', target: 'shell', path: STATUS_PATH, port: 31670, status: 200, ok: true, why: null })
    },
  },
  {
    name: 'the-preload-list-shrank-while-the-gate-was-reading',
    declared: ['9-the-world-fingerprint-left-behind'],
    what: 'the world moving under the read: the same page answering fewer rows afterwards',
    apply: (t) => {
      if (t.exit.page === null) return
      t.exit.page.unique = (t.exit.page.unique ?? []).filter((name) => name !== SUBJECT_ROW)
    },
  },
  {
    name: 'the-page-changed-shape-between-the-two-reads',
    declared: ['9-the-world-fingerprint-left-behind'],
    what: 'a second reading that is a different page (a rebuild landing mid-run): the same row set is not enough',
    apply: (t) => {
      if (t.exit.page === null) return
      t.exit.page.sha256 = 'd'.repeat(64)
    },
  },
  {
    name: 'a-tracked-file-in-the-repository-changed-while-the-gate-was-reading',
    declared: ['9-the-world-fingerprint-left-behind'],
    what: 'a writer in the tree during the run: the fingerprint must say so by name',
    apply: (t) => {
      if (t.exit.gitStatus === null || typeof t.exit.gitStatus !== 'object') return
      t.exit.gitStatus.text = String(t.exit.gitStatus.text ?? '') + '\n M plugins/build.mjs'
      t.exit.gitStatus.lines = [...(t.exit.gitStatus.lines ?? []), ' M plugins/build.mjs']
    },
  },
  {
    name: 'this-gate-left-a-file-outside-its-scratch-directory',
    declared: ['9-the-world-fingerprint-left-behind'],
    what: 'a gate that writes where it must not: the fingerprint names it',
    apply: (t) => {
      t.write = { path: join(PROJECT, 'scripts', 'verify-all.mjs'), bytes: 12, insideScratch: false, at: new Date().toISOString() }
    },
  },
  {
    name: 'control-nothing-changes',
    declared: [],
    what: 'the control: a transcript nobody touched must turn nothing not-green',
    apply: () => {},
  },
]

const selfAttack = (transcript) => {
  const baseline = runJudges(transcript)
  const green = baseline.filter((entry) => entry.ok === true)
  const notGreen = baseline.filter((entry) => entry.ok !== true)
  console.log('')
  console.log('== self-attack: ' + String(MUTANTS.length) + ' mutants over the MEASURED transcript of this run ==')
  console.log('  baseline: ' + String(green.length) + ' green, ' + String(notGreen.length) + ' not green (no mutant is applied to the world; the live client is not touched, no request is sent)')
  if (notGreen.length > 0) {
    console.log('  the attack does not start: the baseline is not green, and a mutant over a red baseline proves nothing')
    for (const entry of notGreen) console.log('    ' + entry.id + ' -> ' + clip(entry.detail, 200))
    return 1
  }
  const readings = readingsFor(transcript).map((reading) => reading.id)
  const coverage = new Map(readings.map((id) => [id, 0]))
  let problems = 0
  for (const mutant of MUTANTS) {
    const copy = clone(transcript)
    let applied = true
    try {
      mutant.apply(copy)
    } catch (error) {
      applied = false
      console.log('  BROKEN ' + pad(mutant.name, 62) + ' the mutation threw: ' + describe(error))
    }
    const verdicts = runJudges(copy)
    const observed = verdicts.filter((entry) => entry.ok !== true).map((entry) => entry.id)
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const exact = applied === true && same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 62) + ' declared=' + show(mutant.declared.map((id) => id.split('-')[0])) + ' observed=' + show(observed.map((id) => id.split('-')[0])) + (exact ? '  声明 == 观测' : '  声明 != 观测'))
    console.log('        ' + mutant.what)
    if (exact !== true) {
      const unexpected = observed.filter((id) => mutant.declared.includes(id) === false)
      const missed = mutant.declared.filter((id) => observed.includes(id) === false)
      if (unexpected.length > 0) console.log('        UNEXPECTED not-green: ' + show(unexpected))
      if (missed.length > 0) console.log('        MISSED not-green: ' + show(missed))
    }
  }
  console.log('  coverage matrix (mutants declaring each reading; every reading needs at least one):')
  let uncovered = 0
  for (const [id, count] of coverage) {
    if (count === 0) uncovered += 1
    console.log('    ' + pad(String(count), 3) + ' ' + id)
  }
  console.log('  declared sets == observed sets for ' + String(MUTANTS.length - problems) + ' of ' + String(MUTANTS.length) + ' mutants; readings with no mutant (漏网): ' + String(uncovered))
  return problems === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict
// ---------------------------------------------------------------------------

const printTranscript = (t, f) => {
  console.log('')
  console.log('== the world this gate read (read-only: four GET endpoints, one page evaluation, the ledger bytes) ==')
  console.log('  shell: ' + String(t.shellOrigin ?? SHELL_ORIGIN) + ' (phase ' + show(t.entry.phase) + ' at entry, ' + show(t.exit.phase) + ' at exit; kernel pid ' + show(t.entry.pid) + ' -> ' + show(t.exit.pid) + '; port ' + show(t.entry.status?.port) + '; version ' + show(t.entry.status?.version) + '; home ' + show(t.entry.status?.home) + ')')
  console.log('  kernel: ' + String(t.kernelOrigin ?? KERNEL_ORIGIN) + ' (the two state routes, GET, read-only)')
  console.log('  desktop client process: ' + show(t.entry.clientIdentity) + ' at entry, ' + show(t.exit.clientIdentity) + ' at exit (this gate never starts, stops or restarts it)')
  console.log('  CDP: ' + String(CDP_PORT) + ' (page ' + show(t.marker?.page ?? '(unread)') + ') - one Runtime.evaluate, expression ' + MARKER_EXPRESSION)
  console.log('  the reads this gate made (' + String(f.reads.length) + ' record(s)):')
  for (const read of f.reads) console.log('    ' + clip(JSON.stringify(read), 200))
  console.log('  single-run guard: ' + String(t.guard?.liveFiles?.length ?? 0) + ' live gate file(s) in the register' + (t.guard?.parseNote === null || t.guard?.parseNote === undefined ? '' : ' (' + String(t.guard.parseNote) + ')') + ', ' + String(t.guard?.nodeProcesses ?? 0) + ' node process(es) read, other live consumers: ' + String(t.entry?.otherConsumers?.length ?? 0))
  for (const consumer of t.entry?.otherConsumers ?? []) console.log('    ' + consumer)
  console.log('  GET ' + PAGE_PATH + ' (entry): ' + show(t.page.httpStatus) + ', ' + String(t.page.bytes) + ' bytes, sha256 ' + clip(String(t.page.sha256), 12) + ', plugins/?? blocks walked: ' + show(t.page.occurrences))
  console.log('  the preload list (entry): ' + String(f.list.length) + ' unique client row(s) out of ' + String(t.page.names) + ' member(s)')
  for (const name of f.parsed.ours) console.log('    dsh-* row: ' + name)
  console.log('  our name on the list: ' + String(f.list.includes(SUBJECT_ROW)) + (f.list.includes(SUBJECT_ROW) === true ? ' (row #' + String(f.list.indexOf(SUBJECT_ROW)) + ')' : ''))
  console.log('    measured bytes, clipped: ...' + String(f.parsed.fragmentOf(SUBJECT_ROW) ?? '(the name is not in the measured bytes at all)') + '...')
  for (const control of CONTROLS) console.log('  negative control ' + control + ': on the list = ' + String(f.list.includes(control)))
  console.log('  GET ' + PAGE_PATH + ' (exit): ' + show(t.exit.page?.httpStatus) + ', ' + String(t.exit.page?.bytes) + ' bytes, sha256 ' + clip(String(t.exit.page?.sha256), 12) + ', ' + String(t.exit.page?.unique === null || t.exit.page?.unique === undefined ? '?' : t.exit.page.unique.length) + ' unique row(s)')
  console.log('  GET ' + PANEL_STATE_PATH + ' (kernel): ' + show(t.routes?.panel?.httpStatus) + ', ' + String(t.routes?.panel?.bytes) + ' bytes, sha256 ' + clip(String(t.routes?.panel?.sha256), 12) + ' - declared.visible = ' + show(f.panelVisible))
  console.log('  GET ' + NOTES_STATE_PATH + ' (kernel): ' + show(t.routes?.notes?.httpStatus) + ', ' + String(t.routes?.notes?.bytes) + ' bytes, sha256 ' + clip(String(t.routes?.notes?.sha256), 12))
  console.log('    limits = ' + show(f.notesLimits) + '; counts = ' + show(f.notesBody?.counts ?? null) + '; notes = ' + String(Array.isArray(f.notesRows) ? f.notesRows.length : '?') + ' row(s)')
  console.log('    the route\'s own words, clipped: ' + clip(JSON.stringify(t.routes?.notes?.body ?? null), 300))
  console.log('  the ledger: ' + show(t.ledger?.before?.root ?? null) + ' - ' + String(t.ledger?.before?.files?.length ?? 0) + ' file(s), digest ' + clip(String(t.ledger?.before?.digest), 12) + ' (before) vs ' + clip(String(t.ledger?.after?.digest), 12) + ' (after), identical=' + String(same(t.ledger?.before?.files, t.ledger?.after?.files) && t.ledger?.before?.digest === t.ledger?.after?.digest))
  for (const file of t.ledger?.before?.files ?? []) console.log('    ledger file: ' + file.name + ' ' + String(file.bytes) + 'B sha256 ' + clip(file.sha256, 12))
  console.log('  the marker: read=' + String(t.marker?.read) + (t.marker?.why === null || t.marker?.why === undefined ? '' : ' why=' + String(t.marker.why)) + ' raw=' + show(t.marker?.raw))
  console.log('  fingerprint: list length ' + show(f.listLength) + ' (entry) vs ' + String(t.exit.page?.unique === null || t.exit.page?.unique === undefined ? '?' : t.exit.page.unique.length) + ' (exit); page sha256 ' + clip(String(t.page?.sha256), 12) + ' vs ' + clip(String(t.exit.page?.sha256), 12) + '; git status --porcelain ' + String(t.entry.gitStatus?.lines?.length ?? '?') + ' line(s) at entry vs ' + String(t.exit.gitStatus?.lines?.length ?? '?') + ' at exit, identical=' + String(t.entry.gitStatus?.text === t.exit.gitStatus?.text))
  console.log('  the only file this gate wrote: ' + show(t.write?.path ?? null) + ' (' + String(t.write?.bytes ?? '?') + ' bytes, inside the git-ignored scratch path=' + show(t.write?.insideScratch) + ')')
  console.log('  THE BOUNDARY: ' + PIXEL_BOUNDARY + ' (zero panel operations: no POST, no /__shell/panel, no lease, no Input.*, no DOM write; a render gate needs an exclusive window and is a separate act)')
  console.log('  NOT JUDGED HERE (named): any pixel, whether the tab is visible or collapsed, whether the pane draws the view it computed, the notes write mouth (POST ' + NOTES_ADD_PATH + ', which gate 123 pins offline), the model\'s notes_add approval path, and anything about a second client or a second shell.')
  for (const note of t.notes ?? []) console.log('  ' + note)
  for (const problem of t.problems ?? []) console.log('  PROBLEM ' + problem)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('gate 124 panel-live - is the panel client half delivered, registered, and read back (shell ' + SHELL_ORIGIN + ', kernel ' + KERNEL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  read-only, single run, zero panel operations, zero leases, zero injected input, ZERO model rounds, never in a segmented run')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const read = readJson(resolve(REPLAY_PATH))
    if (read.ok !== true) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + resolve(REPLAY_PATH) + ' (' + read.why + ')')
      return 3
    }
    transcript = read.value
    if (transcript?.schema !== 'r189-g124-transcript/1' || transcript.entry === undefined || transcript.page === undefined || transcript.marker === undefined || transcript.routes === undefined) {
      console.log('')
      console.log('SKIP: the file at ' + resolve(REPLAY_PATH) + ' is not a transcript this gate wrote (schema ' + show(transcript?.schema) + ')')
      return 3
    }
    console.log('  replay: judging ' + resolve(REPLAY_PATH) + ' - ZERO reads are made, the live world is not touched, not even a GET')
  } else {
    const bag = {}
    try {
      transcript = await runWorld(bag)
    } catch (error) {
      console.log('')
      console.log('SKIP: the gate could not run at all: ' + describe(error))
      console.log(String(error?.stack ?? '').split('\n').slice(0, 5).join('\n'))
      return 3
    }
  }
  const facts = buildFacts(transcript)
  if ((transcript.problems ?? []).length > 0) {
    console.log('')
    console.log('== the read did not complete ==')
    for (const problem of transcript.problems) console.log('  ' + problem)
    for (const note of transcript.notes ?? []) console.log('  ' + note)
    console.log('panel-live: the read could not be carried to the end, so nothing was judged (exit 3)')
    return 3
  }
  try {
    printTranscript(transcript, facts)
  } catch (error) {
    console.log('  (the printout of the measured transcript failed: ' + describe(error) + ' - the readings below are unaffected)')
  }
  const verdicts = runJudges(transcript)
  console.log('')
  console.log('== readings ==')
  for (const verdict of verdicts) {
    const mark = verdict.ok === true ? 'ok   ' : verdict.notMeasured === true ? 'n/a  ' : 'FAIL '
    console.log('  ' + mark + verdict.id)
    console.log('        ' + verdict.detail)
  }
  const failed = verdicts.filter((verdict) => verdict.ok !== true && verdict.notMeasured !== true)
  const notMeasured = verdicts.filter((verdict) => verdict.notMeasured === true)
  const held = verdicts.filter((verdict) => verdict.ok === true)
  console.log('')
  if (SELF_ATTACK === true) {
    if (failed.length > 0 || notMeasured.length > 0 || facts.stopped.length > 0) {
      console.log('panel-live: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a baseline that is not green and measured')
      for (const verdict of [...notMeasured, ...failed]) console.log('    not green: ' + verdict.id + ' -> ' + clip(verdict.detail, 200))
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('panel-live --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED'))
    return attack === 0 ? 0 : 1
  }
  console.log('panel-live: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live shell at ' + String(transcript.shellOrigin ?? SHELL_ORIGIN) + '; shell GETs ' + String(facts.reads.filter((read) => read?.kind === 'http' && read?.target === 'shell').length) + ' over ' + String(ALLOWED_SHELL_PATHS.length) + ' path(s), kernel GETs ' + String(facts.reads.filter((read) => read?.kind === 'http' && read?.target === 'kernel').length) + ' over ' + String(ALLOWED_KERNEL_PATHS.length) + ' state route(s), CDP /json/list 1 + Runtime.evaluate 1, model rounds 0, panel operations 0, POSTs 0, writes outside .tmp/r189-g124/ 0]')
  if (facts.stopped.length > 0) {
    for (const note of facts.stopped) console.log('SKIP: ' + note)
    console.log('panel-live: NOT MEASURED in the world, so nothing above is a verdict on the product [exit 3]')
    return 3
  }
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
    console.log('panel-live: a reading could not be measured, so this is a named third state, not a verdict on the product [exit 3]')
    return 3
  }
  if (failed.length > 0) return 1
  return 0
}

process.exitCode = await main()
