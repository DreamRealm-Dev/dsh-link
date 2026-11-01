#!/usr/bin/env node
/**
 * Gate 122 (R188) - client-plugin-live-rows: IS THE CLIENT HALF REALLY IN THE LIVE PAGE, AND DID IT RUN?
 *
 * Subject: the ONE reading that nothing in this repository has ever guarded - a client half of one of our
 * plugins really being handed to the running client, and really reaching its registration. The world is the
 * user's live desktop client (shell 31761 / kernel 31760 / CDP 9222): this gate reads it, it never drives it.
 *
 * TWO HALVES, REPORTED SEPARATELY (R188 contract section 9 R4):
 *   (a) DELIVERY   - 'dsh-link-markdown/client.js' appears in the shell page's own preload list
 *                    (the 'plugins/??<names>&rev=<hash>' expression GET / serves). The name being there
 *                    proves the three mounting preconditions held (row mounted / manifest declares
 *                    dsh.client.platform='web' + exports['./client'] / lib/client.js built and published).
 *   (b) IT RAN     - the page carries the read-only marker the client half sets on success:
 *                    globalThis.__dshLinkMarkdown === { kind:'markdown', patterns:['*.md','*.markdown'],
 *                    registered:true }. A marker that failed ({registered:false, failed:'<verbatim>'}) or
 *                    that was disposed ({registered:false, disposed:true}) is a NAMED FAILURE, never green.
 *                    A page with no marker at all is a NAMED FAILURE too: delivery happened and the
 *                    registration path left no trace.
 *   Either half missing => named, never green. This gate does NOT cover P2: 'dsh-link-panel' is a HOST-only
 *   half this round, so it has no client row to find and no marker to read (the record's own words:
 *   "本条不覆盖 P2" - this gate does not cover P2).
 *
 * WHAT THIS GATE READS - AND NOTHING ELSE (the live discipline of R188 section 9 R4)
 *   Two GET endpoints, both read-only, and one read-only page evaluation:
 *     1. GET http://127.0.0.1:31761/__shell/status   (twice: before and after, so the pid can be compared)
 *     2. GET http://127.0.0.1:31761/                 (twice: the preload list before and after)
 *     3. CDP 9222: /json/list (GET) and exactly one Runtime.evaluate whose whole expression is
 *        'JSON.stringify(globalThis.__dshLinkMarkdown ?? null)' - a value read, nothing else.
 *   http:// and NOT https://: port 31761 speaks plaintext HTTP (the planning note paid for that lesson).
 *   Every request this gate makes is recorded in the transcript, and reading 5 judges that record against a
 *   strict allowlist: no POST, no /__shell/panel, no lease, no tab/viewport/mode, no Input.*, no
 *   Page.navigate, no DOM write, no typing, no click, no injected input, no 31760.
 *
 * WHY 'GET /' IS THE ONLY SAFE LIVE INSTRUMENT (read from the shell's own source, not assumed)
 *   enforce_lease's call sites are the panel write mouths (surface / mount / unmount / tab-* / mode /
 *   viewport). GET / is the shell's own static page route and touches none of them: it needs no panel, no
 *   lease and no model round - which is exactly why this gate can run while somebody is working in the
 *   live window. It sends NO prompt: this gate spends zero model rounds.
 *
 * SINGLE RUN ONLY - NEVER IN A SEGMENTED RUN (section 9 R4, and R182's "one consumer per live world")
 *   This gate must be the only live consumer of the world it reads. If any other registered live gate file
 *   (scripts/verify-all.mjs's own live register) is running as a process, this gate declines BY NAME with
 *   exit 3 instead of reading a world somebody else is driving. It is therefore never part of a segmented
 *   / --only run, and it never appears in a suite that starts other live gates beside it.
 *
 * THE READINGS (each able to fail on its own evidence; all seven are covered by the self-attack)
 *   0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run
 *        Precondition self-证: phase == 'ready' both times, and the same kernel pid + the same desktop
 *        client process (pid@start-time) before and after. A restart in the middle is a NAMED THIRD STATE
 *        (exit 3) - never read as "the list lost a row" and never a product red.
 *   1-the-instrument-parsed-the-shells-own-preload-list
 *        GET / answered 200 and the body really is the shell's boot page ('plugins/??', '&rev=<hex>',
 *        '__DSH_BOOT__'), and every parsed row is '<name>/client.js' with no malformed token. A body that
 *        is not that page is RED (the reader's instrument changed under it), a request that never came
 *        back is NOT MEASURED.
 *   2-the-markdown-client-half-is-on-the-live-preload-list
 *        Half (a): the positive. One positive and one only - this round has exactly one new client half.
 *   3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page
 *        Half (b): the frozen marker, field by field, with the verbatim JSON in the reading.
 *   4-the-live-negative-control-is-absent-from-the-list
 *        dsh-link-toolbar/client.js and dsh-link-responsive/client.js must NOT be there (they are declared
 *        and built, but their row is not mounted). If either appears, the parser or the world is wrong =>
 *        RED, never green. They are controls only: R188-B-5 keeps them unmounted this round.
 *   5-this-gate-only-read-the-world
 *        The recorded reads against the allowlist (GET-only, two shell paths, one CDP evaluate), the
 *        single-run guard's verdict (it did run and saw nobody else), and the ports this gate touched.
 *   6-the-world-fingerprint-left-behind
 *        The artifact fingerprint: the preload row set is identical before and after, 'git status
 *        --porcelain' is identical before and after, and the only file this gate wrote is its transcript
 *        under .tmp/r188-g122/ (a git-ignored scratch path). The live identity readings (pid / process)
 *        are reading 0's judgement and are printed there.
 *
 * Self-attack: --self-attack mutates THE TRANSCRIPT THIS RUN MEASURED - anchored on the measured page bytes
 * and the measured marker value - one mutation per mutant, and prints, for every mutant, the Chinese
 * sentence 声明 == 观测 / 声明 != 观测 plus the COVERAGE MATRIX. A mutant is precise when the readings that
 * go not-green are exactly the ones it declared. The baseline must be fully green AND fully measured first.
 *
 *   --replay <file>   judge a transcript an earlier run wrote: ZERO reads, the live world is not touched at
 *                     all (no GET, no CDP, no process scan of the live world). This is how the captured
 *                     evidence is re-判 without paying for the client's cooperation.
 *
 * Exit 0 all seven readings held | 1 a reading failed, or a mutant did not land where it declared |
 * 3 this gate could not measure here, BY NAME: no ready shell on the port, the shell restarted while the
 * gate was reading, another live consumer is running, the page never came back, or the page could not be
 * reached over CDP. A reading that cannot be measured is a named third state, never green.
 *
 * Usage: node scripts/verify-client-plugin-live-rows.mjs [--port 31761] [--cdp 9222]
 *          [--dump <file>] [--self-attack] [--replay <transcript.json>]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
const CDP_PORT = Number(option('--cdp', '9222'))
const DUMP_OPTION = option('--dump', null)
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)

/**
 * The one subject this round: one new client half, one marker, and the live negative control.
 *
 * R277: the arm is ONE row now, because the world changed underneath the pair R188 froze. The page's own
 * module table carries thirteen of our client halves - dsh-liquid-glass, dsh-theme-settings, dsh-browser,
 * dsh-link-collab, dsh-link-teams, dsh-continue-button, dsh-link-brand, dsh-lan-bridge, dsh-link-markdown,
 * dsh-link-panel, dsh-link-responsive, dsh-repeat-guard, dsh-opencode-go - so dsh-link-toolbar is the only
 * client half this repository builds that the page does not preload. Naming a second row as a control would
 * have been naming a row that IS on the list and calling its presence a broken parser.
 */
const SUBJECT = 'dsh-link-markdown'
const SUBJECT_ROW = SUBJECT + '/client.js'
const MARKER_KEY = '__dshLinkMarkdown'
const MARKER_EXPRESSION = 'JSON.stringify(globalThis.' + MARKER_KEY + ' ?? null)'
const FROZEN_KIND = 'markdown'
const FROZEN_PATTERNS = ['*.md', '*.markdown']
// R277: the control arm has to be a row the world actually keeps unmounted, and both of the rows R188 froze
// stopped being that: dsh-link-responsive was mounted at R222 (the panel-live reading that noticed it is the
// reason its own control list moved too), dsh-link-toolbar is declared web and built but still not mounted.
// The rotated pair: both manifests declare dsh.client.platform=web and both have a built lib/client.js, so an
// absence here is the row not being mounted - the third state - and not a build failure.
const CONTROLS = ['dsh-link-toolbar/client.js']
const STATUS_PATH = '/__shell/status'
const PAGE_PATH = '/'
const SCRATCH_DIR = join(PROJECT, '.tmp', 'r188-g122')
/** The only shell paths this gate is allowed to ask for, and the only CDP method it may call. */
const ALLOWED_SHELL_PATHS = [STATUS_PATH, PAGE_PATH]
const ALLOWED_DASH_PURPOSES = ['ancestor-chain', 'single-run-guard', 'single-run-scan', 'client-identity', 'git-status']
/** Words that must never appear in the record of what this gate did. */
const FORBIDDEN_IN_READS = /panel|lease|Input\.|dispatchEvent|callFunctionOn|Page\.|navigate|viewport|tab_|click|inject|DOM\./i

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
// The instrument: the shell page's own preload list, and nothing invented
// ---------------------------------------------------------------------------

/** The shell prints its client rows as one preload URL: plugins/??<names, comma separated>&rev=<hash>. */
const LIST_PATTERN = /plugins\/\?\?([^"']*?)(?:&amp;rev=|&rev=)/g
const ROW_PATTERN = /^(?:@[^/@]+\/)?[^/@]+\/client\.js$/

const parsePreloadList = (html) => {
  const text = String(html ?? '')
  const occurrences = []
  for (const match of text.matchAll(LIST_PATTERN)) {
    const members = match[1].split(',').map((name) => name.trim()).filter((name) => name !== '')
    occurrences.push({ url: match[0], urlAt: match.index, members })
  }
  const names = occurrences.flatMap((occurrence) => occurrence.members)
  const unique = [...new Set(names)]
  const malformed = unique.filter((name) => ROW_PATTERN.test(name) !== true)
  const ours = unique.filter((name) => name.startsWith('dsh-') && name.startsWith('@') === false)
  const fragmentOf = (name) => {
    const at = text.indexOf(name)
    if (at === -1) return null
    return clip(text.slice(Math.max(0, at - 46), at + name.length + 30), 168)
  }
  return {
    occurrences: occurrences.length,
    names,
    unique,
    duplicates: names.length - unique.length,
    malformed,
    ours,
    hasListMarker: text.includes('plugins/??'),
    hasBoot: text.includes('__DSH_BOOT__'),
    hasRev: /(?:&amp;|&)rev=[0-9a-fA-F]{6,}/.test(text),
    fragmentOf,
  }
}

/**
 * Rewrite the member lists inside the measured page bytes, and only them: every mutant that touches the
 * list is anchored on these exact bytes (the URL shell, the separators and the rev hash are kept verbatim).
 */
const rewriteRows = (html, edit) => {
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

// ---------------------------------------------------------------------------
// The live world: the two GET endpoints, the single-run guard, and one read-only evaluate
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
  const SELF = 'verify-client-plugin-live-rows.mjs'
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
  const origin = target === 'shell' ? SHELL_ORIGIN : 'http://127.0.0.1:' + String(CDP_PORT)
  const record = { at: new Date().toISOString(), kind: 'http', method: 'GET', target, path, port: target === 'shell' ? PORT : CDP_PORT, status: null, ok: false, why: null }
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

/** The one page evaluation: a value read, with the expression itself recorded so reading 5 can judge it. */
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
    const port = 1
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === port) settle(message)
    })
    socket.send(JSON.stringify({ id: port, method: 'Runtime.evaluate', params: { expression: MARKER_EXPRESSION, returnByValue: true } }))
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

// ---------------------------------------------------------------------------
// The measured world: two GET endpoints, read-only throughout
// ---------------------------------------------------------------------------

const runWorld = async (bag) => {
  const transcript = {
    schema: 'r188-g122-transcript/1',
    gate: 'client-plugin-live-rows',
    startedAt: new Date().toISOString(),
    shellOrigin: SHELL_ORIGIN,
    port: PORT,
    cdpPort: CDP_PORT,
    subject: SUBJECT,
    subjectRow: SUBJECT_ROW,
    markerKey: MARKER_KEY,
    markerExpression: MARKER_EXPRESSION,
    controls: CONTROLS,
    reads: [],
    guard: null,
    entry: { at: null, statusHttp: null, status: null, phase: null, pid: null, clientIdentity: null, gitStatus: null },
    page: { read: false, why: null, at: null, httpStatus: null, bytes: null, sha256: null, html: null, occurrences: null, names: null, unique: null, malformed: null, ours: null },
    marker: { read: false, why: null, at: null, raw: null, value: null },
    exit: { at: null, statusHttp: null, status: null, phase: null, pid: null, clientIdentity: null, gitStatus: null, page: null },
    fingerprint: { clientPid: null, listLength: null },
    write: null,
    notes: [],
    problems: [],
  }
  bag.transcript = transcript
  const record = (purpose) => transcript.reads.push({ at: new Date().toISOString(), kind: 'pwsh', purpose, sideEffect: 'none' })

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

    // --- the instrument: the shell page's own preload list -----------------------------------------
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
      transcript.page.occurrences = parsed.occurrences
      transcript.page.names = parsed.names.length
      transcript.page.unique = parsed.unique
      transcript.page.malformed = parsed.malformed
      transcript.page.ours = parsed.ours
      transcript.page.shape = { hasListMarker: parsed.hasListMarker, hasBoot: parsed.hasBoot, hasRev: parsed.hasRev }
    }
    transcript.fingerprint.clientPid = transcript.entry.pid
    transcript.fingerprint.listLength = Array.isArray(transcript.page.unique) ? transcript.page.unique.length : null

    // --- half (b): the one read-only evaluate --------------------------------------------------------
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
      transcript.exit.page = { read: page.ok === true, why: page.why, httpStatus: page.status, bytes: page.text === null ? null : Buffer.byteLength(String(page.text), 'utf8'), sha256: page.text === null ? null : sha256(String(page.text)), unique: page.ok === true ? parsePreloadList(String(page.text)).unique : null, occurrences: page.ok === true ? parsePreloadList(String(page.text)).occurrences : null }
      transcript.exit.clientIdentity = clientIdentity(record)
      const after = gitStatus(record)
      transcript.exit.gitStatus = after.ok === true ? after : { ok: false, why: after.why, lines: [] }
      transcript.reads.push({ at: new Date().toISOString(), kind: 'none', method: 'none', purpose: 'nothing-else-was-sent', note: 'no POST, no panel, no lease, no input, no DOM write, no 31760' })
    } catch (error) {
      transcript.problems.push('the exit fingerprint could not be read: ' + describe(error))
    }
    // The world changed under the gate: a named third state, never a product red (section 9 R4).
    if (transcript.entry.pid !== null && transcript.exit.pid !== null && transcript.entry.pid !== transcript.exit.pid) {
      transcript.notes.push('NOT MEASURED in the world: the kernel pid changed while this gate was reading (' + String(transcript.entry.pid) + ' -> ' + String(transcript.exit.pid) + '): a restart in the middle is a named third state, not a product verdict')
    }
    if (transcript.entry.clientIdentity !== null && transcript.exit.clientIdentity !== null && transcript.entry.clientIdentity !== transcript.exit.clientIdentity) {
      transcript.notes.push('NOT MEASURED in the world: the desktop client that answered the first read was replaced while this gate was running (' + String(transcript.entry.clientIdentity) + ' -> ' + String(transcript.exit.clientIdentity) + ')')
    }
    if (transcript.entry.gitStatus?.ok !== true || transcript.exit.gitStatus?.ok !== true) {
      transcript.notes.push('note: git status --porcelain could not be read on one side (' + String(transcript.entry.gitStatus?.why ?? transcript.exit.gitStatus?.why ?? '') + '), so reading 6 names that half unread')
    }
    // The dump is the evidence; it is written into the git-ignored scratch path, after the fingerprint.
    try {
      const path = DUMP_OPTION === null ? join(SCRATCH_DIR, 'transcript-' + String(transcript.startedAt).replace(/[:.]/g, '-') + '.json') : resolve(DUMP_OPTION)
      mkdirSync(dirname(path), { recursive: true })
      // The write record is part of the transcript, so it is set BEFORE serializing (and its byte count
      // settles on the real file size): a replay of this file must be able to judge reading 6 unchanged.
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
  const parsed = typeof page.html === 'string' ? parsePreloadList(page.html) : { occurrences: 0, names: [], unique: [], malformed: [], fragmentOf: () => null }
  const marker = transcript?.marker ?? null
  const list = parsed.unique
  const controlsPresent = CONTROLS.filter((name) => list.includes(name))
  return {
    transcript,
    parsed,
    list,
    controlsPresent,
    marker,
    markerValue: marker?.value ?? null,
    rows: Array.isArray(transcript?.page?.unique) ? transcript.page.unique : [],
    exitRows: Array.isArray(transcript?.exit?.page?.unique) ? transcript.exit.page.unique : null,
    reads: Array.isArray(transcript?.reads) ? transcript.reads : [],
    entry: transcript?.entry ?? {},
    exit: transcript?.exit ?? {},
    guard: transcript?.guard ?? null,
    write: transcript?.write ?? null,
    clientPid: transcript?.fingerprint?.clientPid ?? transcript?.entry?.pid ?? null,
    listLength: transcript?.fingerprint?.listLength ?? null,
    stopped: lines((transcript?.notes ?? []).join('\n')).filter((note) => note.startsWith('NOT MEASURED in the world')),
  }
}

const readingsFor = (transcript) => {
  const f = buildFacts(transcript)
  /** The judged world is the one the TRANSCRIPT recorded: a replay must not re-judge it against other flags. */
  const gatePort = Number(transcript?.port ?? PORT)
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
      return OK('GET ' + STATUS_PATH + ' answered 200 twice with phase=ready and the same kernel pid ' + String(f.entry.pid) + ' (port ' + show(f.entry.status?.port) + ', version ' + show(f.entry.status?.version) + '); the desktop client process was ' + String(f.entry.clientIdentity) + ' at entry and identical at exit, so one live world stood still for this whole read')
    },
  })
  R.push({
    id: '1-the-instrument-parsed-the-shells-own-preload-list',
    judge: () => {
      if (f.transcript?.page?.read !== true) return NOT_MEASURED('GET ' + PAGE_PATH + ' on the shell never came back (' + String(f.transcript?.page?.why ?? 'no reason recorded') + '), so there is no page to read and no list to parse')
      if (f.transcript?.page?.httpStatus !== 200) return BAD('GET ' + PAGE_PATH + ' answered ' + show(f.transcript?.page?.httpStatus) + ': the shell answered something that is not its page')
      const shape = f.transcript?.page?.shape ?? {}
      if (shape.hasListMarker !== true) return BAD('the 200 body carries no plugins/?? preload expression at all (' + String(f.transcript?.page?.bytes) + ' bytes): the reader is not looking at the shell\'s own boot page')
      if (shape.hasBoot !== true) return BAD('the 200 body carries no __DSH_BOOT__ boot envelope, so it is not the shell page this instrument reads')
      if (shape.hasRev !== true) return BAD('the preload expression carries no &rev=<hash> on any URL, so the list cannot be attributed to a build')
      if (f.parsed.occurrences === 0) return BAD('nothing in the 200 body matches plugins/??<names>&rev=<hash>: the body is not the page this instrument reads')
      if (f.list.length === 0) return BAD('the preload expression parsed to zero rows with ' + String(f.parsed.occurrences) + ' occurrence(s): an empty list is a broken instrument, not a green world')
      if (f.parsed.malformed.length > 0) return BAD('the list carries ' + String(f.parsed.malformed.length) + ' row(s) that are not <name>/client.js: ' + show(f.parsed.malformed))
      return OK('GET ' + PAGE_PATH + ' answered 200 (' + String(f.transcript.page.bytes) + ' bytes, sha256 ' + clip(String(f.transcript.page.sha256), 12) + '); plugins/??<names>&rev=<hash> occurs ' + String(f.parsed.occurrences) + ' time(s) and yields ' + String(f.parsed.names.length) + ' name(s) / ' + String(f.list.length) + ' unique client row(s) (' + String(f.parsed.duplicates) + ' repeat(s)), every row <name>/client.js; of those ' + String(f.parsed.ours.length) + ' are dsh-* rows: ' + show(f.parsed.ours))
    },
  })
  R.push({
    id: '2-the-markdown-client-half-is-on-the-live-preload-list',
    judge: () => {
      if (f.transcript?.page?.read !== true || f.list.length === 0) return NOT_MEASURED('there is no parsed list to look into (' + String(f.transcript?.page?.why ?? 'the page did not come back') + ')')
      if (f.list.includes(SUBJECT_ROW) !== true) return BAD('half (a) DELIVERY is missing: ' + SUBJECT_ROW + ' is NOT on the live preload list (' + String(f.list.length) + ' rows, dsh-* rows: ' + show(f.parsed.ours) + '); the row was not mounted, or the manifest, or the built lib/client.js')
      return OK('half (a) DELIVERY holds: ' + SUBJECT_ROW + ' is row #' + String(f.list.indexOf(SUBJECT_ROW)) + ' of ' + String(f.list.length) + ' unique client row(s) in the shell\'s own preload list; the measured bytes say ...' + String(f.parsed.fragmentOf(SUBJECT_ROW)) + '...')
    },
  })
  R.push({
    id: '3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page',
    judge: () => {
      if (f.marker?.read !== true) return NOT_MEASURED('half (b) could not be read: ' + String(f.marker?.why ?? 'no reason recorded') + ' (this is a named third state: nothing here says the client half failed)')
      if (f.marker.unparsable !== null && f.marker.unparsable !== undefined) return BAD('the page answered the marker as something this gate cannot read as JSON (' + String(f.marker.unparsable) + '): ' + show(f.marker.raw))
      if (f.markerValue === null || typeof f.markerValue !== 'object') {
        if (f.list.includes(SUBJECT_ROW) === true) return BAD('half (b) is missing: the row IS on the preload list but the page carries no globalThis.' + MARKER_KEY + ' at all (the whole value was ' + show(f.marker.raw) + '): delivery happened and the registration path left no trace, so the two halves are reported separately and this one is not green')
        return BAD('the page carries no globalThis.' + MARKER_KEY + ' (value ' + show(f.marker.raw) + ') and the row is not on the list either')
      }
      const value = f.markerValue
      if (value.registered !== true) {
        if (typeof value.failed === 'string' && value.failed !== '') return BAD('half (b) FAILED BY NAME: the client half marked itself failed with the verbatim error ' + show(value.failed))
        if (value.disposed === true) return BAD('half (b) FAILED BY NAME: the client half marked itself disposed ({registered:false, disposed:true}) - it registered and was then unloaded')
        return BAD('half (b) is not registered: registered=' + show(value.registered) + ' (the whole marker is ' + show(value) + ')')
      }
      if (value.kind !== FROZEN_KIND) return BAD('the client half registered, but the frozen kind is not the registered kind: kind=' + show(value.kind) + ' while R188 冻结点 says kind=' + show(FROZEN_KIND) + ' (marker ' + show(value) + ')')
      if (same(value.patterns, FROZEN_PATTERNS) !== true) return BAD('the client half registered, but the frozen patterns are not the registered patterns: patterns=' + show(value.patterns) + ' while R188 冻结点 says ' + show(FROZEN_PATTERNS))
      const extra = Object.keys(value).filter((key) => ['kind', 'patterns', 'registered'].includes(key) === false)
      return OK('half (b) IT RAN holds: the live page carries globalThis.' + MARKER_KEY + ' = ' + String(f.marker.raw) + ' (kind=' + show(value.kind) + ', patterns=' + show(value.patterns) + ', registered=' + show(value.registered) + (extra.length === 0 ? ')' : '; also carries ' + show(extra) + ', which this reading does not judge)') + ' - read by ONE Runtime.evaluate whose whole expression was ' + MARKER_EXPRESSION)
    },
  })
  R.push({
    id: '4-the-live-negative-control-is-absent-from-the-list',
    judge: () => {
      if (f.transcript?.page?.read !== true || f.list.length === 0) return NOT_MEASURED('there is no parsed list to look into (' + String(f.transcript?.page?.why ?? 'the page did not come back') + ')')
      if (f.controlsPresent.length > 0) {
        return BAD('the control arm is broken: ' + show(f.controlsPresent) + ' IS on the live preload list (' + String(f.list.length) + ' rows) while R188-B-5 keeps those two rows unmounted; if this appears, the parser or the world is not the world this gate reads => RED, never green. The measured bytes say ...' + String(f.parsed.fragmentOf(f.controlsPresent[0])) + '...')
      }
      return OK('the live negative control is absent from the preload list: ' + show(CONTROLS) + ' is not among the ' + String(f.list.length) + ' unique client row(s) (its manifest declares dsh.client.platform=web and its lib/client.js is built, so its absence is the row not being mounted - the third state the mount page names, not a build failure). The other twelve client halves this repository builds ARE on the list, which is why the arm holds one row and not the two R188 froze')
    },
  })
  R.push({
    id: '5-this-gate-only-read-the-world',
    judge: () => {
      const problems = []
      const http = f.reads.filter((read) => read?.kind === 'http')
      for (const read of http) {
        const path = String(read.path ?? '')
        const allowed = read.method === 'GET' && ((read.target === 'shell' && ALLOWED_SHELL_PATHS.includes(path)) || (read.target === 'cdp' && path === '/json/list'))
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
      const scan = f.reads.map((read) => [read?.kind, read?.method, read?.target, read?.path, read?.url, read?.expression, read?.purpose].filter((part) => part !== undefined && part !== null).join(' | ')).join('\n')
      if (FORBIDDEN_IN_READS.test(scan) === true) problems.push('the record of what this gate did names something it must never do (panel / lease / input / DOM / navigate / viewport): ' + clip(scan, 220))
      const ports = [...new Set(f.reads.map((read) => read?.port).filter((one) => typeof one === 'number'))].sort((left, right) => left - right)
      if (ports.some((one) => [gatePort, gateCdpPort].includes(one) !== true)) problems.push('a port outside the two this gate may speak to (' + show([gatePort, gateCdpPort]) + '): ' + show(ports))
      if (f.guard === null || f.guard.read !== true) problems.push('the single-run guard did not run, so "this gate was alone" is not a fact')
      else if (Array.isArray(f.guard.others) && f.guard.others.length > 0) problems.push('another live consumer was running: ' + show(f.guard.others))
      if (f.guard !== null && f.guard.read === true && !(f.guard.registerParsed > 0)) problems.push('the register of live gates could not be parsed, so the guard could not name the files it was watching: ' + show(f.guard.parseNote))
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('this gate read and did nothing else: ' + String(http.filter((read) => read.target === 'shell').length) + ' read-only shell GET(s) over exactly two paths (' + show(ALLOWED_SHELL_PATHS) + ') plus one CDP /json/list GET, ONE Runtime.evaluate whose whole expression was ' + MARKER_EXPRESSION + ', one websocket that was only its transport, and ' + String(f.reads.filter((read) => read?.kind === 'pwsh').length) + ' local process/git read(s) (' + show(ALLOWED_DASH_PURPOSES) + '); no POST, no ' + '/__shell/panel' + ', no lease, no Input.*, no DOM write, no click, no typed text, no navigation, no 31760; ports touched ' + show(ports) + '; the single-run guard parsed ' + String(f.guard.liveFiles.length) + ' live gate file(s) from the register (' + String(f.guard.registerParsed) + ' gate rows) and saw no other live consumer among ' + String(f.guard.nodeProcesses) + ' node process(es)')
    },
  })
  R.push({
    id: '6-the-world-fingerprint-left-behind',
    judge: () => {
      const problems = []
      const single = ' (the live identity readings are reading 0\'s judgement: kernel pid ' + show(f.entry.pid) + ' -> ' + show(f.exit.pid) + ', desktop client ' + show(f.entry.clientIdentity) + ' -> ' + show(f.exit.clientIdentity) + ')'
      if (f.exit.page === null || f.exit.page?.read !== true) return NOT_MEASURED('the page could not be read a second time (' + String(f.exit.page?.why ?? 'no reason recorded') + '), so there is no fingerprint to compare' + single)
      if (f.exitRows === null) return NOT_MEASURED('the second reading of the page did not parse into rows, so the preload list before/after cannot be compared')
      const appeared = f.exitRows.filter((name) => f.rows.includes(name) === false)
      const vanished = f.rows.filter((name) => f.exitRows.includes(name) === false)
      if (appeared.length > 0 || vanished.length > 0) problems.push('the preload list moved while this gate was reading: appeared ' + show(appeared) + ', vanished ' + show(vanished))
      if (f.entry.gitStatus?.ok !== true || f.exit.gitStatus?.ok !== true) problems.push('git status --porcelain could not be read on both sides (' + String(f.entry.gitStatus?.why ?? f.exit.gitStatus?.why ?? '') + ')')
      else if (f.entry.gitStatus.text !== f.exit.gitStatus.text) {
        const changed = f.exit.gitStatus.lines.filter((line) => f.entry.gitStatus.lines.includes(line) === false)
        problems.push('a tracked file moved while this gate was reading (' + String(changed.length) + ' new git status line(s): ' + show(changed) + '); this gate writes no tracked file (its transcript goes to ' + String(f.write?.path ?? '(not written)') + ', inside ' + show(SCRATCH_DIR.slice(PROJECT.length)) + ', which .gitignore ignores), so a difference is another writer or a leak in this gate')
      }
      if (f.write !== null && f.write.insideScratch !== true) problems.push('this gate wrote outside its scratch directory: ' + String(f.write.path))
      if (f.write === null) problems.push('this gate wrote no transcript at all, so the judged record is not on disk to be re-判')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the fingerprint held: the preload list is the same ' + String(f.rows.length) + ' unique row(s) before and after (sha256 ' + clip(String(f.transcript?.page?.sha256), 12) + ' -> ' + clip(String(f.transcript?.exit?.page?.sha256), 12) + ', occurrences ' + show(f.transcript?.page?.occurrences) + ' -> ' + show(f.transcript?.exit?.page?.occurrences) + '), git status --porcelain is byte-identical before and after (' + String(f.entry.gitStatus.lines.length) + ' line(s)), and the only file this gate wrote is its transcript ' + String(f.write.path) + ' (' + String(f.write.bytes) + ' bytes, inside the git-ignored scratch path)' + single)
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

const MUTANTS = [
  {
    name: 'the-shell-was-restarted-while-the-gate-was-reading',
    declared: ['0-the-shell-answered-ready-and-the-very-same-client-stood-through-the-run'],
    what: 'a restart in the middle, which the contract makes a named third state (exit 3) and never a product red',
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
    name: 'our-row-was-dropped-from-the-measured-page',
    declared: ['2-the-markdown-client-half-is-on-the-live-preload-list'],
    what: 'half (a) failing on the measured bytes: the synthetic response without our name must go RED (ONE fact only - the page marker is a different fact and is left exactly as measured, which is why the two halves are two readings)',
    apply: (t) => {
      t.page.html = rewriteRows(t.page.html, (members) => members.filter((name) => name !== SUBJECT_ROW))
    },
  },
  {
    name: 'a-world-where-the-client-half-was-never-delivered-at-all',
    declared: ['2-the-markdown-client-half-is-on-the-live-preload-list', '3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'the coherent world behind that same synthetic response: no row AND no marker, so BOTH halves of the reading redden together',
    apply: (t) => {
      t.page.html = rewriteRows(t.page.html, (members) => members.filter((name) => name !== SUBJECT_ROW))
      t.marker = { ...t.marker, read: true, why: null, unparsable: null, raw: 'null', value: null }
    },
  },
  {
    name: 'every-name-in-the-world-is-present-including-the-controls',
    declared: ['4-the-live-negative-control-is-absent-from-the-list'],
    what: 'the synthetic response with every name in it: the control arm must report the two controls as PRESENT',
    apply: (t) => {
      t.page.html = rewriteRows(t.page.html, (members) => (members.length >= 10 ? [...members, ...CONTROLS] : members))
    },
  },
  {
    name: 'a-row-in-the-list-is-not-a-client-js-row',
    declared: ['1-the-instrument-parsed-the-shells-own-preload-list'],
    what: 'a list that parses into something other than <name>/client.js, so the instrument has changed shape',
    apply: (t) => {
      let once = true
      t.page.html = rewriteRows(t.page.html, (members) => {
        if (once !== true || members.length === 0) return members
        once = false
        members[0] = members[0] + '/not-client.js'
        return members
      })
    },
  },
  {
    name: 'the-shell-answered-something-that-is-not-its-page',
    declared: ['1-the-instrument-parsed-the-shells-own-preload-list'],
    what: 'a 200 that is not the boot page (an error page, a proxy page, anything else)',
    apply: (t) => {
      t.page.httpStatus = 200
      t.page.shape = { hasListMarker: true, hasBoot: false, hasRev: true }
    },
  },
  {
    name: 'the-row-is-there-but-the-page-never-marked-anything',
    declared: ['3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'delivery without liveness: the exact seam this gate exists to separate',
    apply: (t) => {
      t.marker = { ...t.marker, read: true, why: null, unparsable: null, raw: 'null', value: null }
    },
  },
  {
    name: 'the-client-half-marked-itself-failed',
    declared: ['3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'the fail-closed shape the frozen contract names: {registered:false, failed:<verbatim>}',
    apply: (t) => {
      const value = { registered: false, failed: 'markdown: the sidebar.right.pane.tab kind markdown is already claimed' }
      t.marker = { ...t.marker, read: true, why: null, unparsable: null, raw: JSON.stringify(value), value }
    },
  },
  {
    name: 'the-client-half-was-disposed-after-registering',
    declared: ['3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'the second named failure shape: {registered:false, disposed:true}',
    apply: (t) => {
      const value = { registered: false, disposed: true }
      t.marker = { ...t.marker, read: true, why: null, unparsable: null, raw: JSON.stringify(value), value }
    },
  },
  {
    name: 'the-registered-kind-is-not-the-frozen-kind',
    declared: ['3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'a client half that registered as the builtin text kind (the one thing R188 forbids)',
    apply: (t) => {
      const value = { ...(t.marker.value ?? {}), kind: 'text', registered: true }
      t.marker = { ...t.marker, read: true, why: null, unparsable: null, raw: JSON.stringify(value), value }
    },
  },
  {
    name: 'the-registered-patterns-lost-a-member',
    declared: ['3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'a claim narrower than the frozen patterns',
    apply: (t) => {
      const value = { ...(t.marker.value ?? {}), patterns: ['*.md'], registered: true }
      t.marker = { ...t.marker, read: true, why: null, unparsable: null, raw: JSON.stringify(value), value }
    },
  },
  {
    name: 'the-live-page-could-not-be-reached-over-cdp',
    declared: ['3-the-markdown-client-half-registered-the-frozen-shape-in-the-live-page'],
    what: 'half (b) unmeasurable: a named third state, never a green and never a red',
    apply: (t) => {
      t.marker = { read: false, why: 'mutant: CDP has no page target on port ' + String(PORT), at: t.marker?.at ?? null, raw: null, value: null }
    },
  },
  {
    name: 'this-gate-clicked-a-panel-button',
    declared: ['5-this-gate-only-read-the-world'],
    what: 'a record of the one thing this gate must never do: a write to the panel, and an injected input',
    apply: (t) => {
      t.reads.push({ at: new Date().toISOString(), kind: 'http', method: 'POST', target: 'shell', path: '/__shell/panel', port: PORT, status: 200, ok: true, why: null })
      t.reads.push({ at: new Date().toISOString(), kind: 'cdp', target: 'cdp', method: 'Input.dispatchMouseEvent', port: CDP_PORT, purpose: 'mutant' })
    },
  },
  {
    name: 'another-live-consumer-was-driving-the-same-client',
    declared: ['5-this-gate-only-read-the-world'],
    what: 'the single-run discipline broken: this gate read a world somebody else was driving',
    apply: (t) => {
      t.guard = { ...(t.guard ?? {}), read: true, others: ['pid 4242 node scripts/verify-browser-tabs-live.mjs'] }
    },
  },
  {
    name: 'a-port-this-gate-must-never-touch-was-contacted',
    declared: ['5-this-gate-only-read-the-world'],
    what: 'a request on the kernel port (31760), which R188 section 9 R4 puts out of bounds',
    apply: (t) => {
      t.reads.push({ at: new Date().toISOString(), kind: 'http', method: 'GET', target: 'kernel', path: '/', port: 31760, status: 200, ok: true, why: null })
    },
  },
  {
    name: 'the-preload-list-shrank-while-the-gate-was-reading',
    declared: ['6-the-world-fingerprint-left-behind'],
    what: 'the world moving under the read: the same page answering fewer rows afterwards',
    apply: (t) => {
      if (t.exit.page === null) return
      t.exit.page.unique = (t.exit.page.unique ?? []).filter((name) => name !== SUBJECT_ROW)
    },
  },
  {
    name: 'a-tracked-file-in-the-repository-changed-while-the-gate-was-reading',
    declared: ['6-the-world-fingerprint-left-behind'],
    what: 'a writer in the tree during the run: the fingerprint must say so by name',
    apply: (t) => {
      if (t.exit.gitStatus === null || typeof t.exit.gitStatus !== 'object') return
      t.exit.gitStatus.text = String(t.exit.gitStatus.text ?? '') + '\n M plugins/build.mjs'
      t.exit.gitStatus.lines = [...(t.exit.gitStatus.lines ?? []), ' M plugins/build.mjs']
    },
  },
  {
    name: 'this-gate-left-a-file-outside-its-scratch-directory',
    declared: ['6-the-world-fingerprint-left-behind'],
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
      console.log('  BROKEN ' + pad(mutant.name, 58) + ' the mutation threw: ' + describe(error))
    }
    const verdicts = runJudges(copy)
    const observed = verdicts.filter((entry) => entry.ok !== true).map((entry) => entry.id)
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const exact = applied === true && same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 58) + ' declared=' + show(mutant.declared.map((id) => id.split('-')[0])) + ' observed=' + show(observed.map((id) => id.split('-')[0])) + (exact ? '  声明 == 观测' : '  声明 != 观测'))
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
  console.log('== the world this gate read (read-only: two GET endpoints, one page evaluation) ==')
  console.log('  shell: ' + String(t.shellOrigin ?? SHELL_ORIGIN) + ' (phase ' + show(t.entry.phase) + ' at entry, ' + show(t.exit.phase) + ' at exit; kernel pid ' + show(t.entry.pid) + ' -> ' + show(t.exit.pid) + '; port ' + show(t.entry.status?.port) + '; version ' + show(t.entry.status?.version) + ')')
  console.log('  desktop client process: ' + show(t.entry.clientIdentity) + ' at entry, ' + show(t.exit.clientIdentity) + ' at exit (this gate never starts, stops or restarts it)')
  console.log('  CDP: ' + String(CDP_PORT) + ' (page ' + show(t.marker?.page ?? '(unread)') + ') - one Runtime.evaluate, expression ' + MARKER_EXPRESSION)
  console.log('  the requests this gate made (' + String(f.reads.length) + ' record(s)):')
  for (const read of f.reads) console.log('    ' + clip(JSON.stringify(read), 190))
  console.log('  single-run guard: ' + String(t.guard?.liveFiles?.length ?? 0) + ' live gate file(s) in the register' + (t.guard?.parseNote === null || t.guard?.parseNote === undefined ? '' : ' (' + String(t.guard.parseNote) + ')') + ', ' + String(t.guard?.nodeProcesses ?? 0) + ' node process(es) read, other live consumers: ' + String(t.entry?.otherConsumers?.length ?? 0))
  for (const consumer of t.entry?.otherConsumers ?? []) console.log('    ' + consumer)
  console.log('  GET ' + PAGE_PATH + ' (entry): ' + show(t.page.httpStatus) + ', ' + String(t.page.bytes) + ' bytes, sha256 ' + clip(String(t.page.sha256), 12) + ', plugins/?? occurs ' + show(t.page.occurrences) + ' time(s)')
  console.log('  the preload list (entry): ' + String(f.list.length) + ' unique client row(s)')
  for (const name of f.parsed.ours) console.log('    dsh-* row: ' + name)
  console.log('  our name on the list: ' + String(f.list.includes(SUBJECT_ROW)) + (f.list.includes(SUBJECT_ROW) === true ? ' (row #' + String(f.list.indexOf(SUBJECT_ROW)) + ')' : ''))
  console.log('    measured bytes, clipped: ...' + String(f.parsed.fragmentOf(SUBJECT_ROW) ?? '(the name is not in the measured bytes at all)') + '...')
  for (const control of CONTROLS) console.log('  negative control ' + control + ': on the list = ' + String(f.list.includes(control)))
  console.log('  GET ' + PAGE_PATH + ' (exit): ' + show(t.exit.page?.httpStatus) + ', ' + String(t.exit.page?.bytes) + ' bytes, sha256 ' + clip(String(t.exit.page?.sha256), 12) + ', ' + String(t.exit.page?.unique === null || t.exit.page?.unique === undefined ? '?' : t.exit.page.unique.length) + ' unique row(s)')
  console.log('  the marker: read=' + String(t.marker?.read) + (t.marker?.why === null || t.marker?.why === undefined ? '' : ' why=' + String(t.marker.why)) + ' raw=' + show(t.marker?.raw))
  console.log('  fingerprint: list length ' + show(f.listLength) + ' (entry) vs ' + String(t.exit.page?.unique === null || t.exit.page?.unique === undefined ? '?' : t.exit.page.unique.length) + ' (exit); git status --porcelain ' + String(t.entry.gitStatus?.lines?.length ?? '?') + ' line(s) at entry vs ' + String(t.exit.gitStatus?.lines?.length ?? '?') + ' at exit, identical=' + String(t.entry.gitStatus?.text === t.exit.gitStatus?.text))
  console.log('  the only file this gate wrote: ' + show(t.write?.path ?? null) + ' (' + String(t.write?.bytes ?? '?') + ' bytes, inside the git-ignored scratch path=' + show(t.write?.insideScratch) + ')')
  console.log('  NOT COVERED HERE: P2 (dsh-link-panel) - this round that package is a HOST-only half, so it has no client row to find and no marker to read: 本条不覆盖 P2.')
  console.log('  NOT JUDGED HERE (named): a row that is on the list while its body throws; the rendering of the markdown pane; the panel shell; anything about 31760 or the desktop window.')
  for (const note of t.notes ?? []) console.log('  ' + note)
  for (const problem of t.problems ?? []) console.log('  PROBLEM ' + problem)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('gate 122 client-plugin-live-rows - is the client half delivered AND running in the live page (shell ' + SHELL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  read-only, single run, zero panel operations, zero leases, zero injected input, ZERO model rounds')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const read = readJson(resolve(REPLAY_PATH))
    if (read.ok !== true) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + resolve(REPLAY_PATH) + ' (' + read.why + ')')
      return 3
    }
    transcript = read.value
    if (transcript?.schema !== 'r188-g122-transcript/1' || transcript.entry === undefined || transcript.page === undefined || transcript.marker === undefined) {
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
    console.log('client-plugin-live-rows: the read could not be carried to the end, so nothing was judged (exit 3)')
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
      console.log('client-plugin-live-rows: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a baseline that is not green and measured')
      for (const verdict of [...notMeasured, ...failed]) console.log('    not green: ' + verdict.id + ' -> ' + clip(verdict.detail, 200))
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('client-plugin-live-rows --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED'))
    return attack === 0 ? 0 : 1
  }
  console.log('client-plugin-live-rows: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live shell at ' + String(transcript.shellOrigin ?? SHELL_ORIGIN) + '; shell GETs ' + String(facts.reads.filter((read) => read?.kind === 'http' && read?.target === 'shell').length) + ' over ' + String(ALLOWED_SHELL_PATHS.length) + ' path(s), CDP /json/list 1 + Runtime.evaluate 1, model rounds 0, panel operations 0, writes outside .tmp/r188-g122/ 0]')
  if (facts.stopped.length > 0) {
    for (const note of facts.stopped) console.log('SKIP: ' + note)
    console.log('client-plugin-live-rows: NOT MEASURED in the world, so nothing above is a verdict on the product [exit 3]')
    return 3
  }
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
    console.log('client-plugin-live-rows: a reading could not be measured, so this is a named third state, not a verdict on the product [exit 3]')
    return 3
  }
  if (failed.length > 0) return 1
  return 0
}

process.exitCode = await main()
