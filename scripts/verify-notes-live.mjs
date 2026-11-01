#!/usr/bin/env node
/**
 * Gate 120 (R187) - notes-live: md item 13 IN THE RUNNING CLIENT.
 *
 * Subject: the three pieces R186 landed for the notes ledger (plugins/dsh-link-notes, the 'notes' group
 * row in plugins/dsh-link-groups/cordis.patch.yml) as the LIVE desktop client carries them. R186 owns the
 * offline halves (gates 118/119); this gate owns what only the running client can answer: the boot line
 * the live kernel printed, the tool face of a real session before and after ONE declaration the MODEL
 * really makes, a note this gate appends to the live ledger and the request that follows it, the approval
 * seam of a real 'notes_add' call, and the world fingerprint the run leaves behind.
 *
 * The route is the live one and it is the only one there is: CDP (9222) -> the shell page -> a
 * SAME-ORIGIN fetch('/api/session/create' | '/api/session/prompt' | '/api/session/page') with the shell's
 * own {type:'client-request', rpcId, method, payload:{args}} envelope. No UI is clicked, no text is typed,
 * no setting is changed, no client is started or stopped. The gate writes exactly one thing outside its own
 * transcript: ONE attributable note record appended to the live ledger (author 'r187-live-gate'), after
 * checking that the file is byte-identical to the snapshot it read. It never touches the live profile, the
 * writer lock, the instance file, or any other live file.
 *
 * THE PRECONDITIONS ARE THE MEASUREMENT. The live kernel must have loaded THE BUILD THIS GATE JUDGES, and
 * the only evidence for that is the two lines the build prints at load:
 *
 *   [link-notes] ready - N open note(s) at <dir>; section notes:ledger order 700; limits 200 live note(s), 100 character(s) each
 *   [link-groups] ready - 2 group(s) configured
 *
 * Missing ports, a boot log that does not carry those lines, a live profile that does not mount the notes
 * bundle, a live patch layer that names the bundle, or another live consumer: each is a NAMED third state
 * (exit 3) taken BEFORE any model round, because a green reading over a kernel that never loaded this code
 * would be a false green.
 *
 * SIX READINGS, each able to fail on its own evidence:
 *
 *   0-the-live-kernel-loaded-the-code-this-gate-judges
 *                                            Ports 31761/31760/9222 answer; the CURRENT boot log carries both
 *                                            ready lines (printed verbatim with its path, bytes and mtime, and
 *                                            shown to be newer than the kernel process); the live profile
 *                                            mounts dsh-link-notes; the live --patch layers name neither
 *                                            bundle; no other live consumer is running; the ledger is a file
 *                                            this gate can read.
 *   1-the-closed-group-is-not-in-the-first-face
 *                                            In the brand-new session the FIRST request/header carries neither
 *                                            notes_list nor notes_add (the group is auto/declare => closed
 *                                            until declared), with its entry count and byte count.
 *   2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message
 *                                            After the one declaration the MODEL made: exactly one
 *                                            reason:'change' header, exactly one developer/message pointing at
 *                                            it, its tool-addition rows exactly the two member names in the
 *                                            table's order, the face grown by exactly those two names with
 *                                            nothing lost, and the cost trio the plugin reported equal to the
 *                                            header's own numbers. The trio's startsSeries is the marker of the
 *                                            header the session actually holds - NEVER a prediction of the next
 *                                            step (R185-A G5/G6, R186 contract 3.3).
 *   3-a-ledger-change-and-the-two-request-witnesses
 *                                            The negative half first: the prompt in force while the ledger was
 *                                            unchanged carries no occurrence of the note text, and the ledger was
 *                                            byte-identical from entry to the pre-append snapshot. Then the
 *                                            append: ONE record, byte-for-byte the line the shipped product
 *                                            writes for this ledger, attributable to author 'r187-live-gate',
 *                                            append-only (the pre-append bytes are a byte-prefix of the result).
 *                                            Then the positive half: the request that follows the append carries
 *                                            the note text byte-for-byte, with the real prompt length and the
 *                                            section's own length. The boundary is a ROUND boundary here (the
 *                                            append lands between two prompts), and the reading says so.
 *   4-the-write-was-refused-by-name-and-the-ledger-did-not-move
 *                                            The model's real notes_add call is answered by the kernel with a
 *                                            NAMED refusal, and the ledger is byte-identical across the attempt.
 *                                            A grant, a missing call, or an ask that never resolves is a NAMED
 *                                            third state, never a pass.
 *   5-the-world-fingerprint-left-behind
 *                                            Client process, kernel process, every other session's asOfSeq, the
 *                                            ledger's own growth (exactly this gate's one line), the writer lock
 *                                            and instance files, the shipped module and patch, the profile
 *                                            package.json and the repository's porcelain: before vs after.
 *
 * Self-attack: --self-attack rewrites THE TRANSCRIPT THIS RUN MEASURED (one fact per mutant) and prints
 * declared == observed for every mutant plus the coverage matrix. --replay <file> attacks a transcript an
 * earlier run wrote (ZERO prompts, the world is not touched).
 *
 * SINGLE RUN. This gate spends model rounds. It refuses (exit 3, by name) while another live consumer is
 * running - by the register's own live file list, by the running processes, and by its own file name - and
 * it is NOT part of any segmented suite run: it must be run alone, after its world is prepared.
 *
 * Exit 0 all readings held | 1 a reading failed or a mutant did not land where it declared | 3 this gate
 * could not measure here (a named third state: preconditions, the model did not drive the named call, the
 * approval question was never answered, the second round never ran), never a pass.
 *
 * Usage: node scripts/verify-notes-live.mjs [--port 31761] [--cdp 9222] [--deadline-ms 300000]
 *          [--poll-ms 3000] [--scratch <dir>] [--dump <file>] [--self-attack] [--replay <file>]
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-notes')) && existsSync(join(at, 'scripts', 'verify-all.mjs'))) return at
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
const DEADLINE_MS = Number(option('--deadline-ms', '300000'))
const POLL_MS = Number(option('--poll-ms', '3000'))
const SCRATCH = resolve(option('--scratch', join(PROJECT, '.tmp', 'r187-g120')))
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const KERNEL = join(PROJECT, 'core', 'deepseek-harness')

/** The bundles this gate judges, the row it opens, and the two names the frozen interface uses. */
const NOTES_BUNDLE = 'dsh-link-notes'
const GROUPS_BUNDLE = 'dsh-link-groups'
const GROUP_ID = 'notes'
const MEMBERS = ['notes_list', 'notes_add']
const LIST_TOOL = 'notes_list'
const ADD_TOOL = 'notes_add'
const DIRECTORY_TOOL = 'tool_groups'
const DECLARE_TOOL = 'tool_groups_declare'
const SECTION_NAME = 'notes:ledger'
const SECTION_ORDER = 700
const DEFAULT_MAX_NOTES = 200
const DEFAULT_MAX_CHARS = 100
const EFFECTIVE = 'next-step'
/** The writer name every record this gate appends carries, and the author on the note itself. */
const NOTE_AUTHOR = 'r187-live-gate'
const RUN_MARK = randomUUID().replace(/-/gu, '').slice(0, 8)
/** The one note this gate appends: short, ASCII, and impossible to find in a prompt by accident. */
const NOTE_TEXT = 'R187LIVEGATE-' + RUN_MARK + ' note appended by ' + NOTE_AUTHOR
/** The body the model is told to try to add: it must never land. */
const PROBE_TEXT = 'R187LIVEGATE-' + RUN_MARK + ' add probe that must not land'

const ROUND1_MESSAGE = [
  '这是一次工具面自检，请严格按下面的顺序做，不要做别的事：',
  '第一步：只调用一次 ' + DECLARE_TOOL + '，参数 open: ["' + GROUP_ID + '"]，把这一个组打开。这一步不要同时调用别的工具。',
  '第二步：等工具面更新之后，调用一次 ' + LIST_TOOL + '，把它的结果原文逐字读出来。',
  '第三步：用一句话说明：第一步之后，你自己看到的工具面有没有真的变化。',
].join('\n')

const ROUND2_MESSAGE = [
  '继续同一件自检，请严格按顺序做，不要做别的事：',
  '第一步：调用一次 ' + LIST_TOOL + '，把它的结果原文逐字读出来，特别说清楚它报告账本里有几条便条。',
  '第二步：调用一次 ' + ADD_TOOL + '，参数 text=' + JSON.stringify(PROBE_TEXT) + '、author=' + JSON.stringify(NOTE_AUTHOR) + '，'
    + '把它返回的结果原文逐字读出来（无论成功、失败还是被拒绝，都照原样念）。',
].join('\n')

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
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (list) => [...list].map(String).sort()
const sameSet = (left, right) => same(sorted(left), sorted(right))
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const pad = (text, width) => (String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const codePoints = (text) => Array.from(String(text)).length

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
/** One TCP connect is the port reading: a listening port is what "the live world answers" means here. */
const portAlive = (port) => new Promise((done) => {
  const socket = netConnect({ host: '127.0.0.1', port })
  const finish = (ok) => {
    try { socket.destroy() } catch { /* the socket is the OS's to reap */ }
    done(ok)
  }
  socket.setTimeout(4000)
  socket.on('connect', () => finish(true))
  socket.on('timeout', () => finish(false))
  socket.on('error', () => finish(false))
})
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}
const pwsh = (command, timeoutMs = 40000) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })

/** The repository's own reading of what changed on disk. Read-only: this gate never commits anything. */
const porcelain = () => {
  const done = spawnSync('git', ['-C', PROJECT, 'status', '--porcelain'], { encoding: 'utf8', timeout: 90000, windowsHide: true })
  if (done.status !== 0) return { ok: false, why: 'git status exited ' + show(done.status) + ': ' + clip(String(done.stderr ?? ''), 160) }
  return { ok: true, text: String(done.stdout ?? '') }
}

/**
 * The ledger, read the way its readers read it: the file is the truth, every line is one record, and a
 * line that does not parse is counted rather than hidden.
 */
const ledgerSnapshot = (path) => {
  const facts = fileFacts(path)
  if (facts.ok !== true) return { ...facts, records: [], recordCount: 0, lastSeq: 0, brokenLines: [], noteCount: 0 }
  const text = readFileSync(path, 'utf8')
  const records = []
  const broken = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === '') continue
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed?.seq !== 'number' || !Number.isInteger(parsed.seq)) throw new Error('record without an integer sequence')
      records.push(parsed)
    } catch {
      broken.push(index + 1)
    }
  }
  records.sort((left, right) => left.seq - right.seq)
  return {
    ok: true,
    path,
    bytes: facts.bytes,
    sha256: facts.sha256,
    mtimeMs: facts.mtimeMs,
    mtime: facts.mtime,
    records: records.map((record) => ({
      seq: record.seq,
      kind: String(record.kind ?? ''),
      writer: record.writer === undefined ? null : String(record.writer),
      instance: record.instance === undefined ? null : String(record.instance),
      originSeq: record.originSeq === undefined ? null : record.originSeq,
      subject: record.subject === undefined ? null : String(record.subject),
      actor: record.actor === undefined ? null : String(record.actor),
      text: typeof record.payload?.text === 'string' ? record.payload.text : null,
      author: typeof record.payload?.author === 'string' ? record.payload.author : null,
      state: typeof record.payload?.state === 'string' ? record.payload.state : null,
      at: record.at === undefined ? null : record.at,
    })),
    recordCount: records.length,
    lastSeq: records.length === 0 ? 0 : Number(records[records.length - 1].seq),
    brokenLines: broken,
    noteCount: records.filter((record) => record.kind === 'note/state' && String(record.payload?.state ?? '') !== 'deleted').length,
  }
}

const bootFacts = (path) => {
  const facts = fileFacts(path)
  if (facts.ok !== true) return { ok: false, path, why: facts.why, notes: null, groups: null, lineCount: 0, matched: [] }
  const text = readFileSync(path, 'utf8')
  const rows = text.split(/\r?\n/)
  return {
    ok: true,
    path,
    bytes: facts.bytes,
    sha256: facts.sha256,
    mtimeMs: facts.mtimeMs,
    mtime: facts.mtime,
    lineCount: rows.length,
    notes: rows.find((line) => line.startsWith('[link-notes] ready')) ?? null,
    groups: rows.find((line) => line.startsWith('[link-groups] ready')) ?? null,
    matched: rows.filter((line) => line.startsWith('[link-notes]') || line.startsWith('[link-groups]')),
  }
}

/**
 * The group table the live groups bundle declares. The parse is indentation-driven because that is what
 * this YAML is here: 'groups:' opens the list, each '- id: x' opens a group, a 'tools:' line swallows the
 * '- name' items after it, and the scalar keys are read by name. Comment lines are skipped.
 */
const parseGroupTable = (text) => {
  const lines = String(text ?? '').split(/\r?\n/)
  const at = lines.findIndex((line) => /^\s*groups:\s*$/u.test(line))
  if (at === -1) return { ok: false, why: 'the bundle patch has no groups: block' }
  const base = (lines[at].match(/^\s*/u) ?? [''])[0].length
  const groups = []
  let current = null
  let mode = null
  for (let index = at + 1; index < lines.length; index += 1) {
    const raw = lines[index]
    if (/^\s*$/u.test(raw) === true || /^\s*#/u.test(raw) === true) continue
    const indent = (raw.match(/^\s*/u) ?? [''])[0].length
    const body = raw.trim()
    if (indent <= base) break
    const id = body.match(/^-\s*id:\s*(\S+)\s*$/u)
    if (id !== null) {
      current = { id: id[1], title: null, summary: null, tools: [], state: null, autoWhen: null, provider: null }
      groups.push(current)
      mode = null
      continue
    }
    if (current === null) continue
    if (/^tools:\s*$/u.test(body) === true) {
      mode = 'tools'
      continue
    }
    const item = body.match(/^-\s*(\S+)\s*$/u)
    if (mode === 'tools' && item !== null) {
      current.tools.push(item[1])
      continue
    }
    const previous = mode
    mode = null
    const key = body.match(/^([A-Za-z_]+):\s*(.*)$/u)
    if (key === null) continue
    const value = key[2].replace(/^['"]|['"]$/gu, '')
    if (key[1] === 'state') current.state = value
    else if (key[1] === 'provider') current.provider = value
    else if (key[1] === 'title') current.title = value
    else if (key[1] === 'summary') current.summary = value
    else if (key[1] === 'auto') mode = 'auto'
    else if (key[1] === 'when' && previous === 'auto') current.autoWhen = value
  }
  if (groups.length === 0) return { ok: false, why: 'the groups: block declares no group' }
  return { ok: true, groups }
}

/** The declaration answer tool_groups_declare writes: applied / refused / pending rows, verbatim. */
const parseDeclaration = (text) => {
  const applied = []
  const refused = []
  const pending = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const opened = line.match(/^- (opened|closed) (\S+) \(effective: ([^)]+)\) \u00b7 surface now (\d+) tools \/ (\d+) bytes \u00b7 next request\/header\.startsSeries=(true|false)$/u)
    if (opened !== null) {
      applied.push({ direction: opened[1], id: opened[2], effective: opened[3], entries: Number(opened[4]), bytes: Number(opened[5]), startsSeries: opened[6] === 'true', line })
      continue
    }
    const denied = line.match(/^- refused (\S+) \[([A-Z_]+)\] (.*)$/u)
    if (denied !== null) {
      refused.push({ id: denied[1], code: denied[2], reason: denied[3], line })
      continue
    }
    const waiting = line.match(/^- not applied (\S+): (.*)$/u)
    if (waiting !== null) pending.push({ id: waiting[1], reason: waiting[2], line })
  }
  return { applied, refused, pending, text: String(text ?? '') }
}

// ---------------------------------------------------------------------------
// The live world: CDP -> the shell page -> same-origin /api calls
// ---------------------------------------------------------------------------

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

const openCdpPage = async () => {
  const targets = await fetch('http://127.0.0.1:' + String(CDP_PORT) + '/json/list', { signal: AbortSignal.timeout(8000) })
    .then((answer) => answer.json())
    .catch(() => null)
  if (targets === null) return { ok: false, why: 'CDP ' + String(CDP_PORT) + ' did not answer /json/list, so the live shell page cannot be reached' }
  const pages = (Array.isArray(targets) ? targets : []).filter((target) => target?.type === 'page')
  const page = pages.find((target) => String(target.url).includes(':' + String(PORT))) ?? null
  if (page === null) return { ok: false, why: 'CDP has no page target on port ' + String(PORT) + ' (targets: ' + show(pages.map((target) => target.url)) + ')' }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const opened = await new Promise((settle) => {
    socket.addEventListener('open', () => settle(true), { once: true })
    socket.addEventListener('error', () => settle(false), { once: true })
    setTimeout(() => settle(false), 15000)
  })
  if (opened !== true) return { ok: false, why: 'the CDP socket of ' + String(page.url) + ' did not open' }
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)
    if (settle !== undefined) {
      pending.delete(message.id)
      settle(message)
    }
  })
  const evaluate = async (expression) => {
    const id = nextId
    nextId += 1
    const answer = await new Promise((settle) => {
      pending.set(id, settle)
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    const result = answer?.result?.result
    return { value: result?.value ?? null, exception: answer?.result?.exceptionDetails?.text ?? answer?.error?.message ?? null }
  }
  const call = async (method, args, rpcId) => {
    const expression = '(async () => { const r = await fetch(' + JSON.stringify('/api/' + method) + ', {'
      + ' method: "POST", headers: { "content-type": "application/json" },'
      + ' body: JSON.stringify(' + JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) + ') });'
      + ' return JSON.stringify({ status: r.status, body: await r.text() }); })()'
    const answer = await evaluate(expression)
    if (answer.exception !== null) throw new Error(method + ' evaluate failed: ' + String(answer.exception))
    const parsed = JSON.parse(String(answer.value))
    const envelope = JSON.parse(parsed.body)
    if (envelope?.result?.ok === false) throw new Error(method + ' was refused: ' + show(envelope.result.error))
    return { status: parsed.status, value: envelope?.result?.value }
  }
  return { ok: true, url: String(page.url), socket, evaluate, call }
}

/** The identity of the desktop client: pid@start-time. A restart is a third state, not a red. */
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

/** Every node process, so the guard and the kernel identity are read from the machine, not assumed. */
const nodeProcesses = () => {
  const query = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + $_.CreationDate.ToUniversalTime().ToString(\'o\') + "|" + [string]$_.CommandLine }'
  const done = pwsh(query)
  if (done.status !== 0) return { ok: false, why: 'the process list could not be read: ' + clip(String(done.stderr ?? ''), 160), rows: [] }
  const rows = String(done.stdout ?? '')
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.split('|').length >= 4)
    .map((row) => {
      const first = row.indexOf('|')
      const second = row.indexOf('|', first + 1)
      const third = row.indexOf('|', second + 1)
      return { pid: row.slice(0, first), ppid: row.slice(first + 1, second), created: row.slice(second + 1, third), command: row.slice(third + 1) }
    })
  return { ok: true, rows }
}

/** The live kernel: the node process that runs the CLI with --patch layers (its own words, not a guess). */
const kernelIdentity = (rows) => {
  const found = rows.filter((row) => row.command.includes('bin.ts') && row.command.includes('--patch'))
  if (found.length === 0) return null
  const row = found[0]
  const patches = [...row.command.matchAll(/--patch\s+("([^"]+)"|(\S+))/gu)].map((match) => match[2] ?? match[3])
  const port = /--port\s+(\d+)/u.exec(row.command)
  return { pid: row.pid, created: row.created, command: clip(row.command, 300), patches, port: port === null ? null : Number(port[1]) }
}

/** Another live consumer, by the register's own list of live files and the processes running them. */
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) === false) return { files: [], why: 'scripts/verify-all.mjs is not there' }
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
  return { files: [...files], why: count === 0 ? 'the register could not be parsed, so every verify-*/probe-* process counts as a live consumer' : null, parsed: count }
}
/** This gate's own file name, counted in the process list: an unregistered gate is still a live consumer. */
const SELF_FILE = 'verify-notes-live.mjs'
const otherConsumers = (rows, live, ancestors) => {
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors ?? [])])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF_FILE)) return true
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/u.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

/**
 * What the live client is running: the kernel home the --patch layers live in, the boot log it wrote, the
 * profile it mounts this bundle from, the two shipped files, the group row, and the ledger this gate may
 * append one record to. Anything that cannot be read is a named reason, never a default.
 */
const resolveSubject = (kernel) => {
  if (kernel === null) return { ok: false, why: 'no live kernel process could be named (a node process running the CLI with --patch layers), so the world this gate would drive cannot be identified' }
  const patch = (kernel.patches ?? []).map((path) => resolve(path)).find((path) => /\.ya?ml$/iu.test(path)) ?? (kernel.patches ?? []).map((path) => resolve(path))[0] ?? null
  if (patch === null) return { ok: false, why: 'the live kernel command names no --patch layer, so its kernel home cannot be derived' }
  const kernelHome = dirname(patch)
  if (existsSync(kernelHome) !== true) return { ok: false, why: 'the kernel home derived from the --patch layer ' + patch + ' does not exist' }
  const bootPath = join(kernelHome, 'boot.log')
  const boot = bootFacts(bootPath)
  const profileDir = join(kernelHome, 'profiles', 'web')
  const profilePkgPath = join(profileDir, 'package.json')
  const profilePkg = readJson(profilePkgPath)
  if (profilePkg.ok !== true) return { ok: false, why: 'the live profile has no readable package.json at ' + profilePkgPath + ' (' + profilePkg.why + ')' }
  const bundles = Array.isArray(profilePkg.value?.dsh?.profile?.bundles) ? profilePkg.value.dsh.profile.bundles.map(String) : []
  if (bundles.includes(NOTES_BUNDLE) !== true) return { ok: false, why: 'the live profile does not mount ' + NOTES_BUNDLE + ' (bundles: ' + show(bundles) + '), so no live session can carry the notes section or its tools' }
  if (bundles.includes(GROUPS_BUNDLE) !== true) return { ok: false, why: 'the live profile does not mount ' + GROUPS_BUNDLE + ' (bundles: ' + show(bundles) + '), so there is no live group to declare' }
  const dependencies = profilePkg.value?.dependencies ?? {}
  const pluginDirOf = (bundle) => {
    const link = String(dependencies[bundle] ?? '')
    return link.startsWith('link:') ? resolve(link.slice('link:'.length)) : join(PROJECT, 'plugins', bundle)
  }
  const pluginDir = pluginDirOf(NOTES_BUNDLE)
  const groupsDir = pluginDirOf(GROUPS_BUNDLE)
  const notesPkg = readJson(join(pluginDir, 'package.json'))
  if (notesPkg.ok !== true) return { ok: false, why: 'the mounted notes package has no readable package.json (' + notesPkg.why + ')' }
  const modulePath = resolve(pluginDir, typeof notesPkg.value?.main === 'string' ? notesPkg.value.main : 'lib/index.js')
  const configPath = resolve(pluginDir, typeof notesPkg.value?.dsh?.bundle?.patch === 'string' ? notesPkg.value.dsh.bundle.patch : 'cordis.patch.yml')
  const module = fileFacts(modulePath)
  const config = fileFacts(configPath)
  if (module.ok !== true) return { ok: false, why: 'the shipped module the live profile mounts is not readable at ' + modulePath + ' (' + module.why + ')' }
  const configText = readText(configPath)
  if (configText.ok !== true) return { ok: false, why: 'the notes bundle layer ' + configPath + ' is not readable (' + configText.why + ')' }
  const groupsPkg = readJson(join(groupsDir, 'package.json'))
  if (groupsPkg.ok !== true) return { ok: false, why: 'the mounted groups package has no readable package.json (' + groupsPkg.why + ')' }
  const groupsPatchPath = resolve(groupsDir, typeof groupsPkg.value?.dsh?.bundle?.patch === 'string' ? groupsPkg.value.dsh.bundle.patch : 'cordis.patch.yml')
  const groupsPatchText = readText(groupsPatchPath)
  if (groupsPatchText.ok !== true) return { ok: false, why: 'the groups bundle layer ' + groupsPatchPath + ' is not readable (' + groupsPatchText.why + ')' }
  const table = parseGroupTable(groupsPatchText.text)
  if (table.ok !== true) return { ok: false, why: 'the groups bundle layer ' + groupsPatchPath + ' ' + table.why }
  const group = table.groups.find((one) => one.id === GROUP_ID) ?? null
  if (group === null) return { ok: false, why: 'the live groups table declares ' + show(table.groups.map((one) => one.id)) + ' and not the ' + GROUP_ID + ' group this gate opens' }
  const layers = []
  for (const path of [...(kernel.patches ?? []), join(profileDir, 'cordis.patch.yml')]) {
    const absolute = resolve(path)
    if (existsSync(absolute) !== true) continue
    const text = readText(absolute)
    if (text.ok !== true) continue
    const mentions = text.text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), number: index + 1 })).filter((row) => row.line.startsWith('#') === false && (row.line.includes(NOTES_BUNDLE) || row.line.includes(GROUPS_BUNDLE)))
    layers.push({ path: absolute, file: fileFacts(absolute), mentions })
  }
  const overrides = layers.filter((layer) => layer.mentions.length > 0)
  if (overrides.length > 0) {
    return { ok: false, why: 'a live patch layer names ' + NOTES_BUNDLE + ' or ' + GROUPS_BUNDLE + ' (' + overrides.map((layer) => layer.path + ':' + layer.mentions.map((row) => row.number).join(',')).join('; ') + '), so the composition this gate reads may not be the one the live kernel mounted; this gate will not guess which layer won' }
  }
  const notesDir = join(kernelHome, 'link-notes')
  const ledgerPath = join(notesDir, 'notes', 'control.jsonl')
  const lockPath = join(notesDir, 'notes', '.writer')
  const instancePath = join(notesDir, 'notes', '.instance')
  if (existsSync(ledgerPath) !== true) return { ok: false, why: 'the live ledger this gate would append one attributable note to does not exist at ' + ledgerPath }
  const lockText = readText(lockPath)
  const instanceText = readText(instancePath)
  return {
    ok: true,
    kernelHome,
    bootPath,
    boot,
    profileDir,
    profilePkgPath,
    profilePkg: fileFacts(profilePkgPath),
    mounted: String(dependencies[NOTES_BUNDLE] ?? ''),
    pluginDir,
    modulePath,
    module,
    configPath,
    config,
    groupsDir,
    groupsPatchPath,
    groupsPatch: fileFacts(groupsPatchPath),
    table,
    group,
    layers,
    ledger: {
      dir: notesDir,
      path: ledgerPath,
      lockPath,
      instancePath,
      lock: fileFacts(lockPath),
      instance: fileFacts(instancePath),
      lockContent: lockText.ok === true ? String(lockText.text).trim() : null,
      instanceContent: instanceText.ok === true ? String(instanceText.text).trim() : null,
    },
    bootChecks: {
      notesLine: boot.ok === true && typeof boot.notes === 'string' ? boot.notes : null,
      groupsLine: boot.ok === true && typeof boot.groups === 'string' ? boot.groups : null,
      notesNamesSection: boot.ok === true && typeof boot.notes === 'string' && boot.notes.includes('section ' + SECTION_NAME),
      notesNamesOrder: boot.ok === true && typeof boot.notes === 'string' && boot.notes.includes('order ' + String(SECTION_ORDER)),
      notesNamesLimits: boot.ok === true && typeof boot.notes === 'string' && boot.notes.includes('limits ' + String(DEFAULT_MAX_NOTES) + ' live note(s), ' + String(DEFAULT_MAX_CHARS) + ' character(s) each'),
      groupsCount: boot.ok === true && typeof boot.groups === 'string' ? Number((/\[link-groups\] ready \u2014 (\d+) group\(s\) configured/u.exec(boot.groups) ?? [])[1] ?? NaN) : null,
    },
  }
}

const readSessions = async (cdp, rpcId) => {
  const answer = await cdp.call('session/list', { _request: {} }, rpcId)
  const items = Array.isArray(answer.value?.items) ? answer.value.items : []
  return {
    count: items.length,
    rows: items.map((row) => ({
      sessionId: String(row?.sessionId ?? ''),
      asOfSeq: Number(row?.projections?.asOfSeq ?? 0),
      running: row?.running === true,
      blank: row?.blank === true,
    })),
    at: new Date().toISOString(),
  }
}

/** The staged copy of the shipped product, so the record this gate appends is the product's own bytes. */
const stageProduct = (scratch) => {
  const stageDir = join(scratch, '.staged-' + String(process.pid))
  const rewrites = {
    '@deepseek-ai/schemastery': join(KERNEL, 'vendor', 'schemastery', 'lib', 'index.mjs'),
    '@deepseek-ai/dsh-tools': join(KERNEL, 'packages', 'core', 'tools', 'lib', 'index.js'),
  }
  const stage = (from, to, rewrite) => {
    mkdirSync(dirname(to), { recursive: true })
    let text = readFileSync(from, 'utf8')
    const rewritten = []
    if (rewrite === true) {
      for (const [specifier, file] of Object.entries(rewrites)) {
        const url = pathToFileURL(file).href
        const before = text
        for (const quote of ["'", '"', String.fromCharCode(96)]) text = text.split(quote + specifier + quote).join(quote + url + quote)
        if (text !== before) rewritten.push(specifier + ' -> ' + url)
      }
    }
    writeFileSync(to, text, 'utf8')
    return { from, to, rewritten, file: fileFacts(to) }
  }
  const notes = stage(join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js'), join(stageDir, 'dsh-link-notes', 'lib', 'index.js'), true)
  const collab = stage(join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js'), join(stageDir, 'dsh-link-collab', 'lib', 'index.js'), false)
  return { stageDir, notes, collab }
}

/**
 * Append exactly ONE note to the live ledger, and measure every step of it.
 *
 * The bytes are not hand-written here: the SHIPPED product writes them. This gate stages the shipped
 * module (the same staging the offline gates use: the bare kernel specifiers rewritten to the kernel's
 * absolute files, the collab neighbour kept at the same relative depth) and lets its own appendNote write
 * one note into a scratch copy of the live ledger. The last line of that scratch file is then what the
 * live ledger gains, so the record - its seq, its writer, its instance, its instant - is the product's own
 * arithmetic over this ledger's own bytes. The live ledger is re-read immediately before and after, and the
 * write is refused unless the file is still byte-identical to the snapshot this function took.
 */
const appendOneNote = async (transcript, subject) => {
  const problems = []
  const before = ledgerSnapshot(subject.ledger.path)
  const staged = stageProduct(SCRATCH)
  const runDir = join(SCRATCH, 'run-' + RUN_MARK)
  const scratchLedger = join(runDir, 'notes', 'control.jsonl')
  mkdirSync(dirname(scratchLedger), { recursive: true })
  writeFileSync(scratchLedger, readFileSync(subject.ledger.path))
  let notesMod = null
  try {
    notesMod = await import(pathToFileURL(staged.notes.to).href)
  } catch (error) {
    problems.push('the shipped notes artifact could not be imported from its staged copy (' + describe(error) + '), so this gate cannot append a note with the product own code')
    return { ok: false, problems, staged, after: before, before }
  }
  const uses = typeof notesMod?.openNotesStore === 'function' && typeof notesMod?.appendNote === 'function' && typeof notesMod?.noteRecord === 'function'
  if (uses !== true) {
    problems.push('the staged artifact does not expose openNotesStore/appendNote/noteRecord, so there is no product write path to use')
    return { ok: false, problems, staged, after: before, before }
  }
  const store = notesMod.openNotesStore(runDir, { writer: NOTE_AUTHOR })
  let appended = null
  let failure = null
  try {
    appended = await notesMod.appendNote(store, { text: NOTE_TEXT, tags: [], author: NOTE_AUTHOR })
  } catch (error) {
    failure = describe(error)
  }
  await store.close()
  if (appended === null) {
    problems.push('the shipped appendNote refused this gate own note (' + String(failure) + '), so nothing was appended to the live ledger')
    return { ok: false, problems, staged, after: before, before }
  }
  const scratchText = readFileSync(scratchLedger, 'utf8')
  const scratchLines = scratchText.split('\n').filter((line) => line !== '')
  const line = scratchLines[scratchLines.length - 1] + '\n'
  const record = JSON.parse(line)
  const liveBytesAtSnapshot = readFileSync(subject.ledger.path).length
  const scratchPrefixHeld = sha256(Buffer.from(scratchText.slice(0, liveBytesAtSnapshot), 'utf8')) === before.sha256
  // The live ledger must not have moved while the scratch copy was being made.
  const still = ledgerSnapshot(subject.ledger.path)
  if (still.sha256 !== before.sha256) {
    problems.push('the live ledger changed between the snapshot (' + clip(before.sha256, 12) + ') and the append (' + clip(still.sha256, 12) + '), so this gate refuses to write: it will not append onto a file somebody else moved')
    return { ok: false, problems, staged, after: still, before, scratch: { line, record, prefixHeld: scratchPrefixHeld } }
  }
  let wrote = null
  try {
    appendFileSync(subject.ledger.path, line)
    wrote = 'appended'
  } catch (error) {
    wrote = 'refused: ' + describe(error)
  }
  const after = ledgerSnapshot(subject.ledger.path)
  const bytes = readFileSync(subject.ledger.path)
  const exactLineHeld = bytes.length === before.bytes + Buffer.byteLength(line)
  const prefixHeld = bytes.length >= before.bytes && sha256(bytes.subarray(0, before.bytes)) === before.sha256
  const recordsHeld = after.recordCount === before.recordCount + 1
  const noteHeld = after.records.some((row) => row.seq === record.seq && row.kind === 'note/state' && row.text === NOTE_TEXT && row.author === NOTE_AUTHOR && row.writer === NOTE_AUTHOR)
  if (wrote !== 'appended') problems.push('the append to the live ledger did not happen: ' + String(wrote))
  if (exactLineHeld !== true) problems.push('the live ledger grew by ' + String(bytes.length - before.bytes) + ' byte(s) and the appended line is ' + String(Buffer.byteLength(line)) + ' byte(s)')
  if (prefixHeld !== true) problems.push('the live ledger first ' + String(before.bytes) + ' byte(s) are not byte-identical to the snapshot this gate read, so the append was not append-only')
  if (recordsHeld !== true || noteHeld !== true) problems.push('the live ledger holds ' + String(after.recordCount) + ' record(s) after the append (' + String(before.recordCount) + ' before) and the note record reads ' + show(after.records.filter((row) => row.seq === record.seq)))
  // The product's own renderer, over the live file's own records: what the section SHOULD be.
  const readRecords = (path) => {
    const text = readFileSync(path, 'utf8')
    return text.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line)).sort((left, right) => left.seq - right.seq)
  }
  const limits = { maxNotes: DEFAULT_MAX_NOTES, maxChars: DEFAULT_MAX_CHARS }
  const sectionAfter = notesMod.renderNotesSection(notesMod.projectNotes(readRecords(subject.ledger.path)), limits)
  const sectionBefore = notesMod.renderNotesSection(notesMod.projectNotes(before.records.map((row) => ({ seq: row.seq, kind: row.kind, at: row.at, subject: row.subject, payload: { id: row.subject, text: row.text, tags: [], state: row.state, author: row.author } }))), limits)
  // The live ledger's own writer lock is held by the kernel: opening it from this process must be refused by name.
  let openRefusal = null
  const lockPid = subject.ledger.lockContent !== null && /^\d+$/u.test(subject.ledger.lockContent) ? Number(subject.ledger.lockContent) : null
  if (lockPid !== null && pidAlive(lockPid) === true) {
    try {
      notesMod.openNotesStore(subject.ledger.dir, { writer: NOTE_AUTHOR })
      openRefusal = { attempted: true, refused: false, message: 'the live ledger OPENED from this gate process' }
    } catch (error) {
      openRefusal = { attempted: true, refused: true, message: describe(error) }
    }
  } else {
    openRefusal = { attempted: false, refused: null, message: 'the writer lock holds ' + show(subject.ledger.lockContent) + ', which names no live process, so this gate did not try to open the live ledger at all' }
  }
  return {
    ok: problems.length === 0,
    problems,
    staged: { stageDir: staged.stageDir, notes: staged.notes, collab: staged.collab, sourceModule: fileFacts(join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js')) },
    before,
    after,
    id: appended.id,
    seq: appended.seq,
    line,
    lineBytes: Buffer.byteLength(line),
    lineSha256: sha256(Buffer.from(line, 'utf8')),
    record,
    scratch: { dir: runDir, ledger: scratchLedger, prefixHeld: scratchPrefixHeld, record },
    wrote,
    exactLineHeld,
    prefixHeld,
    recordsHeld,
    noteHeld,
    sections: {
      before: sectionBefore,
      after: sectionAfter,
      beforeChars: codePoints(sectionBefore),
      afterChars: codePoints(sectionAfter),
      afterCarriesNote: sectionAfter.includes(NOTE_TEXT),
    },
    openRefusal,
  }
}

// ---------------------------------------------------------------------------
// The measured world: one session, two prompts, one appended note
// ---------------------------------------------------------------------------

const runWorld = async (bag) => {
  const transcript = {
    schema: 'r187-g120-transcript/1',
    startedAt: new Date().toISOString(),
    port: PORT,
    cdpPort: CDP_PORT,
    shellOrigin: SHELL_ORIGIN,
    runMark: RUN_MARK,
    note: { text: NOTE_TEXT, author: NOTE_AUTHOR, codePoints: codePoints(NOTE_TEXT) },
    probe: { text: PROBE_TEXT, author: NOTE_AUTHOR },
    messages: { round1: ROUND1_MESSAGE, round2: ROUND2_MESSAGE },
    entry: { at: new Date().toISOString(), ports: null, client: null, kernel: null, ancestors: [], liveGateFiles: [], otherConsumers: [], appdata: null, sessions: null, repo: null },
    exit: { at: null, ports: null, client: null, kernel: null, sessions: null, subject: null, ledger: null, boot: null, repo: null },
    guard: null,
    subject: null,
    session: { sessionId: null, created: false, prompts: [], polls: 0, round1Ended: false, round2Ended: false },
    ledger: { entry: null, beforeAppend: null, afterAppend: null, beforeAttempt: null, exit: null },
    append: null,
    page1: null,
    page: null,
    notes: [],
    problems: [],
  }
  bag.transcript = transcript

  // --- the instrument: the live page ---------------------------------------------------------------
  const cdp = await openCdpPage()
  if (cdp.ok !== true) throw new NotMeasured(cdp.why)
  transcript.page_url = cdp.url
  try {
    // --- reading 0's preconditions, taken BEFORE any model round ------------------------------------
    const ports = {}
    for (const port of [PORT, 31760, CDP_PORT]) ports[String(port)] = await portAlive(port)
    transcript.entry.ports = ports
    const dead = Object.entries(ports).filter(([, alive]) => alive !== true).map(([port]) => port)
    if (dead.length > 0) throw new NotMeasured('the live world does not answer on port(s) ' + show(dead) + ' (shell ' + String(PORT) + ', kernel 31760, CDP ' + String(CDP_PORT) + '), so nothing below could be a live reading')
    const appdataDone = pwsh('[string]$env:APPDATA', 20000)
    const appdata = appdataDone.status === 0 && String(appdataDone.stdout ?? '').trim() !== '' ? String(appdataDone.stdout).trim() : null
    transcript.entry.appdata = appdata
    const processes = nodeProcesses()
    if (processes.ok !== true) throw new NotMeasured('the single-run guard could not read the process list (' + String(processes.why) + '), so this gate cannot promise it is alone')
    transcript.entry.client = clientIdentity()
    transcript.entry.kernel = kernelIdentity(processes.rows)
    const live = liveGateFiles()
    const ancestors = ancestorPids()
    transcript.entry.ancestors = ancestors
    const others = otherConsumers(processes.rows, live, ancestors)
    transcript.entry.liveGateFiles = live.files
    transcript.entry.otherConsumers = others
    transcript.guard = { liveFiles: live.files, registerParsed: live.parsed ?? 0, parseNote: live.why, others, nodeProcesses: processes.rows.length, ancestors }
    if (others.length > 0) throw new NotMeasured('another live consumer is running, and this gate must run alone: ' + others.join(' | '))
    if (transcript.entry.client === null) throw new NotMeasured('the desktop client process (dsh-link) is not running, so there is no live client to judge')
    if (transcript.entry.kernel === null) throw new NotMeasured('no live kernel process could be named (a node process running the CLI with --patch layers)')
    const subject = resolveSubject(transcript.entry.kernel)
    if (subject.ok !== true) throw new NotMeasured(subject.why)
    transcript.subject = subject
    if (subject.boot.ok !== true) throw new NotMeasured('the boot log at ' + subject.bootPath + ' is not readable (' + String(subject.boot.why) + '), and the two load lines are the only evidence that the live kernel loaded the build this gate judges')
    if (subject.bootChecks.notesLine === null) throw new NotMeasured('the current boot log ' + subject.bootPath + ' (' + String(subject.boot.bytes) + ' bytes, mtime ' + String(subject.boot.mtime) + ') carries no "[link-notes] ready" line, so the live kernel did not print the notes row load line: this gate would be judging code the kernel may never have loaded')
    if (subject.bootChecks.notesNamesSection !== true || subject.bootChecks.notesNamesOrder !== true || subject.bootChecks.notesNamesLimits !== true) {
      throw new NotMeasured('the live boot line does not name this build: ' + show(subject.bootChecks.notesLine))
    }
    if (subject.bootChecks.groupsLine === null) throw new NotMeasured('the current boot log carries no "[link-groups] ready" line, so the live group composition cannot be confirmed')
    if (subject.bootChecks.groupsCount !== subject.table.groups.length) {
      throw new NotMeasured('the live boot line reports ' + show(subject.bootChecks.groupsCount) + ' configured group(s) while the mounted table declares ' + String(subject.table.groups.length) + ': ' + show(subject.bootChecks.groupsLine))
    }
    const kernelCreated = transcript.entry.kernel.created === undefined ? null : Date.parse(transcript.entry.kernel.created)
    transcript.subject.bootAfterKernel = kernelCreated === null || Number.isFinite(kernelCreated) !== true ? null : subject.boot.mtimeMs >= kernelCreated
    if (transcript.subject.bootAfterKernel === false) throw new NotMeasured('the boot log ' + subject.bootPath + ' (mtime ' + String(subject.boot.mtime) + ') is older than the kernel process (started ' + String(transcript.entry.kernel.created) + '), so it is not this boot log and the lines in it are not evidence for the running build')
    transcript.ledger.entry = ledgerSnapshot(subject.ledger.path)
    transcript.entry.repo = porcelain()
    const sessionsBefore = await readSessions(cdp, 'g120-list-before')
    transcript.entry.sessions = sessionsBefore
    if (sessionsBefore.rows.some((row) => row.sessionId === '') === true) throw new NotMeasured('session/list answered with a row this gate cannot name, so the world fingerprint would be a guess')

    // --- ROUND ONE: the declaration the model makes --------------------------------------------------
    const created = await cdp.call('session/create', { request: {} }, 'g120-create')
    const sessionId = String(created.value?.sessionId ?? '')
    if (sessionId === '') throw new NotMeasured('the shell created no session (session/create answered ' + show(created.value) + ')')
    transcript.session.sessionId = sessionId
    transcript.session.created = true
    const sendPrompt = async (label, text, rpcSuffix) => {
      const requestId = randomUUID()
      const accepted = await cdp.call('session/prompt', { request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] } }, rpcSuffix)
      transcript.session.prompts.push({ label, requestId, sentAt: new Date().toISOString(), accepted: accepted.value?.accepted === true, value: accepted.value ?? null })
      if (accepted.value?.accepted !== true) throw new NotMeasured('the ' + label + ' prompt was not accepted (' + show(accepted.value) + ')')
      return requestId
    }
    const waitForTurnEnd = async (wantCount, label) => {
      const until = Date.now() + DEADLINE_MS
      let last = null
      let polls = 0
      while (Date.now() < until) {
        polls += 1
        transcript.session.polls += 1
        const list = await readSessions(cdp, 'g120-list-' + label + '-' + String(polls))
        const row = list.rows.find((one) => one.sessionId === sessionId) ?? null
        if (row !== null && row.asOfSeq > 0) {
          const read = await cdp.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: row.asOfSeq, maxMessages: 900 } }, 'g120-page-' + label + '-' + String(polls))
          const page = read.value ?? null
          last = page
          const ends = (page?.records ?? []).filter((record) => record?.event?.type === 'turn/end').length
          if (ends >= wantCount) return { page, polls, ended: true, turnEnds: ends }
        }
        await sleep(POLL_MS)
      }
      return { page: last, polls, ended: false, turnEnds: last === null ? 0 : (last.records ?? []).filter((record) => record?.event?.type === 'turn/end').length }
    }

    await sendPrompt('round1', ROUND1_MESSAGE, 'g120-prompt-1')
    const round1 = await waitForTurnEnd(1, 'r1')
    transcript.page1 = round1.page
    transcript.session.round1Ended = round1.ended
    transcript.session.round1Polls = round1.polls
    if (round1.page === null) transcript.notes.push('NOT MEASURED in the world: the first round was readable for ' + String(round1.polls) + ' poll(s) and never produced a session page within ' + String(DEADLINE_MS) + ' ms')
    else if (round1.ended !== true) transcript.notes.push('NOT MEASURED in the world: the first round reached ' + String((round1.page.records ?? []).length) + ' event(s) and ' + String(round1.turnEnds) + ' turn/end within ' + String(DEADLINE_MS) + ' ms (the model may still be running, or a tool call may still be pending)')

    // --- the ledger between the rounds, then ONE appended note (reading 3) ---------------------------
    transcript.ledger.beforeAppend = ledgerSnapshot(subject.ledger.path)
    mkdirSync(SCRATCH, { recursive: true })
    const appended = await appendOneNote(transcript, subject)
    if (appended.problems.length > 0) transcript.problems.push(...appended.problems)
    transcript.append = appended
    transcript.ledger.afterAppend = appended.after

    // --- ROUND TWO: the request that follows the append, then the notes_add attempt ------------------
    transcript.ledger.beforeAttempt = ledgerSnapshot(subject.ledger.path)
    await sendPrompt('round2', ROUND2_MESSAGE, 'g120-prompt-2')
    const round2 = await waitForTurnEnd(2, 'r2')
    transcript.session.round2Ended = round2.ended
    transcript.session.round2Polls = round2.polls
    if (round2.page !== null) transcript.page = round2.page
    if (round2.ended !== true) transcript.notes.push('NOT MEASURED in the world: the second round never reached its second turn/end within ' + String(DEADLINE_MS) + ' ms (polls ' + String(round2.polls) + ', turn/end seen ' + String(round2.turnEnds) + ')')
    transcript.ledger.exit = ledgerSnapshot(subject.ledger.path)
  } catch (error) {
    if (error instanceof NotMeasured) transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    else transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error?.stack === undefined ? '' : '\n' + String(error.stack).split('\n').slice(0, 4).join('\n')))
  } finally {
    try {
      transcript.exit.at = new Date().toISOString()
      const ports = {}
      for (const port of [PORT, 31760, CDP_PORT]) ports[String(port)] = await portAlive(port)
      transcript.exit.ports = ports
      transcript.exit.client = clientIdentity()
      const processes = nodeProcesses()
      transcript.exit.kernel = processes.ok === true ? kernelIdentity(processes.rows) : null
      transcript.exit.sessions = await readSessions(cdp, 'g120-list-after')
      transcript.exit.subject = {
        module: fileFacts(transcript.subject?.modulePath ?? join(PROJECT, 'plugins', 'dsh-link-notes', 'lib', 'index.js')),
        config: fileFacts(transcript.subject?.configPath ?? join(PROJECT, 'plugins', 'dsh-link-notes', 'cordis.patch.yml')),
        groupsPatch: fileFacts(transcript.subject?.groupsPatchPath ?? join(PROJECT, 'plugins', 'dsh-link-groups', 'cordis.patch.yml')),
        profilePkg: fileFacts(transcript.subject?.profilePkgPath ?? ''),
        layers: (transcript.subject?.layers ?? []).map((layer) => ({ path: layer.path, file: fileFacts(layer.path) })),
      }
      if (transcript.subject !== null && transcript.subject !== undefined && transcript.subject.ok === true) {
        transcript.exit.ledger = {
          file: ledgerSnapshot(transcript.subject.ledger.path),
          lock: fileFacts(transcript.subject.ledger.lockPath),
          instance: fileFacts(transcript.subject.ledger.instancePath),
        }
      }
      transcript.exit.boot = bootFacts(transcript.subject?.bootPath ?? join(PROJECT, 'boot.log'))
      transcript.exit.repo = porcelain()
      if (transcript.entry.client !== null && transcript.exit.client !== null && transcript.entry.client !== transcript.exit.client) {
        transcript.notes.push('NOT MEASURED in the world: the client was RESTARTED while this gate was running (' + String(transcript.entry.client) + ' -> ' + String(transcript.exit.client) + '), so the client this gate measured no longer exists')
      }
      if (transcript.entry.kernel !== null && transcript.exit.kernel !== null && transcript.entry.kernel.pid !== transcript.exit.kernel.pid) {
        transcript.notes.push('NOT MEASURED in the world: the kernel process was replaced while this gate was running (pid ' + String(transcript.entry.kernel.pid) + ' -> ' + String(transcript.exit.kernel.pid) + '), so the plugin state this gate measured is gone')
      }
    } catch (error) {
      transcript.problems.push('the exit fingerprint could not be read: ' + describe(error))
    }
    try {
      cdp.socket.close()
    } catch {
      /* the socket is the OS's to reap */
    }
    try {
      const dir = DUMP_OPTION === null ? join(tmpdir(), 'r187-g120') : dirname(resolve(DUMP_OPTION))
      mkdirSync(dir, { recursive: true })
      const path = DUMP_OPTION === null ? join(dir, 'transcript-' + String(transcript.session.sessionId ?? 'none') + '.json') : resolve(DUMP_OPTION)
      writeFileSync(path, JSON.stringify(transcript, null, 1))
      transcript.dumpPath = path
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

/** The kernel's own sentences for a refused ask. Anything else is not a refusal this gate can name. */
const REFUSAL_SENTENCES = [
  'the user rejected tool "' + ADD_TOOL + '"',
  'tool "' + ADD_TOOL + '" requires approval, but no approval channel is available',
  'approval for tool "' + ADD_TOOL + '" was cancelled',
  'tool "' + ADD_TOOL + '" requires approval, but the call has no agent to route it through',
  'Auto review rejected tool "' + ADD_TOOL + '"',
]

const textOfMessage = (message) => {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '[' + String(part?.type) + ']')).join('\n')
}

const buildFacts = (transcript) => {
  const records = Array.isArray(transcript?.page?.records) ? transcript.page.records : (Array.isArray(transcript?.page1?.records) ? transcript.page1.records : [])
  const events = records.map((record) => record?.event).filter((event) => event !== null && typeof event === 'object')
  const headers = events
    .filter((event) => event.type === 'request/header')
    .map((event) => {
      const data = event.data === null || typeof event.data !== 'object' ? {} : event.data
      const header = data.header === null || typeof data.header !== 'object' ? {} : data.header
      const tools = Array.isArray(header.tools) ? header.tools : []
      return {
        seq: Number(event.seq ?? -1),
        reason: String(data.reason ?? ''),
        startsSeries: data.startsSeries === true,
        names: tools.map((tool) => String(tool?.name ?? '')),
        toolCount: tools.length,
        bytes: Buffer.byteLength(JSON.stringify(tools), 'utf8'),
      }
    })
  const stepOf = (seq) => {
    let at = null
    for (const event of events) {
      if (event.type !== 'step/start') continue
      if (Number(event.seq ?? -1) < seq) at = { turn: Number(event.data?.turn ?? -1), step: Number(event.data?.step ?? -1) }
      else break
    }
    return at
  }
  const calls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      turn: Number(event.data?.turn ?? -1),
      step: Number(event.data?.step ?? -1),
      name: String(event.data?.name ?? ''),
      arguments: String(event.data?.arguments ?? ''),
      callId: String(event.data?.callId ?? ''),
    }))
  const results = events
    .filter((event) => event.type === 'tool/result')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      turn: Number(event.data?.turn ?? -1),
      step: Number(event.data?.step ?? -1),
      callId: String(event.data?.message?.toolCallId ?? ''),
      isError: event.data?.message?.isError === true,
      text: textOfMessage(event.data?.message),
    }))
  const developers = events
    .filter((event) => event.type === 'developer/message')
    .map((event) => {
      const message = event.data?.message === null || typeof event.data?.message !== 'object' ? {} : event.data.message
      const content = Array.isArray(message.content) ? message.content : []
      return {
        seq: Number(event.seq ?? -1),
        turn: Number(event.data?.turn ?? -1),
        step: Number(event.data?.step ?? -1),
        headerSeq: event.data?.headerSeq === undefined ? null : Number(event.data.headerSeq),
        blocks: content.map((block) => String(block?.type ?? '')),
        additions: content.filter((block) => block?.type === 'tool-addition').map((block) => String(block.toolName ?? '')),
      }
    })
  const systemMessages = events
    .filter((event) => event.type === 'system/message')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      turn: Number(event.data?.turn ?? -1),
      step: Number(event.data?.step ?? -1),
      surfaceOp: typeof event.surfaceOp === 'string' ? event.surfaceOp : show(event.surfaceOp ?? null),
      text: textOfMessage(event.data?.message),
    }))
  const approvals = {
    asked: events.filter((event) => event.type === 'approval/asked').length,
    decided: events.filter((event) => event.type === 'approval/decided').length,
    decidedRows: events.filter((event) => event.type === 'approval/decided').map((event) => String(event.data?.outcome ?? '')),
  }
  const turnEnds = events.filter((event) => event.type === 'turn/end')
  const lastTurnEnd = turnEnds[turnEnds.length - 1] ?? null
  const turnEnd = lastTurnEnd === null ? null : { seq: Number(lastTurnEnd.seq ?? -1), count: turnEnds.length, turn: Number(lastTurnEnd.data?.turn ?? -1), kind: String(lastTurnEnd.data?.reason?.kind ?? '') }
  const policyOf = (type, key) => {
    const event = events.find((one) => one.type === type)
    return event === null || event === undefined ? null : String(event.data?.[key] ?? '') || null
  }
  const policy = { preset: policyOf('permission/preset', 'preset'), sandbox: policyOf('sandbox/mode', 'mode'), approval: policyOf('approval/policy', 'policy') }

  const resultFor = (call) => {
    if (call === null || call === undefined) return null
    const byId = call.callId === '' ? null : results.find((result) => result.callId !== '' && result.callId === call.callId) ?? null
    if (byId !== null) return byId
    return results.filter((result) => result.seq > call.seq).sort((left, right) => left.seq - right.seq)[0] ?? null
  }
  const declareCalls = calls.filter((call) => call.name === DECLARE_TOOL)
  const declareCall = declareCalls[0] ?? null
  const directoryCalls = calls.filter((call) => call.name === DIRECTORY_TOOL)
  const declareResult = resultFor(declareCall)
  const addCall = calls.filter((call) => call.name === ADD_TOOL)[0] ?? null
  const addResult = resultFor(addCall)
  const listCalls = calls.filter((call) => call.name === LIST_TOOL)
  const listResults = listCalls.map((call) => resultFor(call)).filter((row) => row !== null)
  const entryFace = headers[0] ?? null
  const changeHeaders = headers.filter((header) => header.reason === 'change')
  const changesAfterDeclare = declareCall === null ? [] : changeHeaders.filter((header) => header.seq > declareCall.seq)
  const firstChangeAfterDeclare = changesAfterDeclare[0] ?? null
  const declaration = declareResult === null ? null : parseDeclaration(declareResult.text)
  const lastHeader = headers.length === 0 ? null : headers[headers.length - 1]

  // The round boundary: the second turn's first event is the line between "the ledger had not changed"
  // and "the ledger carries this gate's note".
  const turn2Seq = (() => {
    const rows = events.filter((event) => Number(event.data?.turn ?? -1) === 2).map((event) => Number(event.seq ?? -1)).filter((seq) => seq >= 0)
    return rows.length === 0 ? null : Math.min(...rows)
  })()
  const promptBeforeBoundary = turn2Seq === null ? (systemMessages.length === 0 ? null : systemMessages[systemMessages.length - 1]) : (systemMessages.filter((row) => row.seq < turn2Seq).slice(-1)[0] ?? null)
  const promptAtBoundary = turn2Seq === null ? null : (systemMessages.filter((row) => row.seq >= turn2Seq).slice(-1)[0] ?? null)
  const promptInForceAfter = systemMessages.length === 0 ? null : systemMessages[systemMessages.length - 1]
  const commitsAfterBoundary = turn2Seq === null ? [] : systemMessages.filter((row) => row.seq >= turn2Seq)

  const group = transcript?.subject?.group ?? null
  const members = group === null || !Array.isArray(group.tools) ? [] : group.tools
  const worldStopped = (transcript?.notes ?? []).some((note) => String(note).startsWith('NOT MEASURED in the world'))
  return {
    transcript,
    worldStopped,
    events,
    headers,
    calls,
    results,
    developers,
    systemMessages,
    approvals,
    turnEnd,
    policy,
    stepOf,
    entryFace,
    declareCall,
    declareCalls,
    directoryCalls,
    declareResult,
    declaration,
    changeHeaders,
    changesAfterDeclare,
    firstChangeAfterDeclare,
    lastHeader,
    addCall,
    addResult,
    listCalls,
    listResults,
    turn2Seq,
    promptBeforeBoundary,
    promptAtBoundary,
    promptInForceAfter,
    commitsAfterBoundary,
    group,
    members,
    ledger: transcript?.ledger ?? {},
    append: transcript?.append ?? null,
    /** The note and probe bodies THIS TRANSCRIPT measured: a replay in another process has its own marks. */
    noteText: String(transcript?.note?.text ?? NOTE_TEXT),
    probeText: String(transcript?.probe?.text ?? PROBE_TEXT),
    bootChecks: transcript?.subject?.bootChecks ?? null,
    sessionId: transcript?.session?.sessionId ?? null,
  }
}

const READINGS = [
  {
    id: '0-the-live-kernel-loaded-the-code-this-gate-judges',
    judge: (f) => {
      const t = f.transcript
      const problems = []
      const lines = []
      const ports = t.entry?.ports ?? {}
      const dead = Object.entries(ports).filter(([, alive]) => alive !== true).map(([port]) => port)
      if (dead.length > 0) problems.push('port(s) ' + show(dead) + ' do not answer')
      else lines.push('ports ' + show(Object.keys(ports)) + ' all answer (shell ' + String(t.port) + ', kernel 31760, CDP ' + String(t.cdpPort) + ')')
      if (t.entry?.client === null || t.entry?.client === undefined) problems.push('the client process (dsh-link) could not be named')
      else lines.push('client ' + String(t.entry.client) + ' is running and was NOT started or stopped by this gate')
      if (t.entry?.kernel === null || t.entry?.kernel === undefined) problems.push('the live kernel process could not be named')
      else lines.push('live kernel pid ' + String(t.entry.kernel.pid) + ' on port ' + show(t.entry.kernel.port) + ' with ' + String((t.entry.kernel.patches ?? []).length) + ' --patch layer(s)')
      if ((t.entry?.otherConsumers ?? []).length !== 0) problems.push('another live consumer was running: ' + show(t.entry.otherConsumers))
      else lines.push('single-run guard: ' + String((t.entry?.liveGateFiles ?? []).length) + ' live file(s) in the register and ' + String(t.guard?.nodeProcesses ?? 0) + ' node process(es) read, none of them another consumer')
      const boot = t.subject?.boot ?? null
      if (boot === null || boot.ok !== true) problems.push('the boot log could not be read (' + show(boot?.why) + ')')
      else {
        lines.push('boot log ' + String(boot.path) + ' (' + String(boot.bytes) + ' bytes, sha256 ' + clip(String(boot.sha256), 12) + ', mtime ' + String(boot.mtime) + ')')
        const checks = t.subject?.bootChecks ?? {}
        if (checks.notesLine === null) problems.push('the boot log carries no [link-notes] ready line')
        else {
          lines.push('the notes load line, verbatim: ' + String(checks.notesLine))
          if (checks.notesNamesSection !== true) problems.push('that line does not name section ' + SECTION_NAME)
          if (checks.notesNamesOrder !== true) problems.push('that line does not name order ' + String(SECTION_ORDER))
          if (checks.notesNamesLimits !== true) problems.push('that line does not name limits ' + String(DEFAULT_MAX_NOTES) + '/' + String(DEFAULT_MAX_CHARS))
        }
        if (checks.groupsLine === null) problems.push('the boot log carries no [link-groups] ready line')
        else {
          lines.push('the groups load line, verbatim: ' + String(checks.groupsLine))
          if (checks.groupsCount !== t.subject.table.groups.length) problems.push('that line reports ' + show(checks.groupsCount) + ' configured group(s) and the mounted table declares ' + String(t.subject.table.groups.length))
        }
        if (t.subject?.bootAfterKernel === false) problems.push('the boot log is older than the kernel process, so it is not this boot log')
        else if (t.subject?.bootAfterKernel === true) lines.push('the boot log is newer than the kernel process, so it is this boot own log')
      }
      const layerMentions = (t.subject?.layers ?? []).flatMap((layer) => layer.mentions ?? [])
      if (layerMentions.length > 0) problems.push('a live patch layer names the bundle at line(s) ' + show(layerMentions.map((row) => row.number)))
      else lines.push('no live patch layer names ' + NOTES_BUNDLE + ' or ' + GROUPS_BUNDLE + ', so the mounted bundle layers are the table this gate read')
      const ledger = t.ledger?.entry ?? null
      if (ledger === null || ledger.ok !== true) problems.push('the live ledger could not be read (' + show(ledger?.why) + ')')
      else lines.push('the live ledger ' + String(ledger.path) + ' holds ' + String(ledger.recordCount) + ' record(s) / ' + String(ledger.bytes) + ' byte(s) (sha256 ' + clip(String(ledger.sha256), 12) + ') before this gate wrote anything')
      const drive = t.problems ?? []
      if (drive.length > 0) problems.push('the drive itself reported a problem: ' + clip(drive.join(' | '), 300))
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join('; '))
    },
  },
  {
    id: '1-the-closed-group-is-not-in-the-first-face',
    judge: (f) => {
      if (f.entryFace === null) return NOT_MEASURED('the session logged no request/header at all, so the face a brand-new session starts from was never read')
      const present = f.members.filter((name) => f.entryFace.names.includes(name))
      if (present.length > 0) return BAD('the first request/header (seq ' + String(f.entryFace.seq) + ', reason ' + show(f.entryFace.reason) + ') already carries ' + show(present) + ': the notes group is state auto/declare, so a brand-new session must start with it closed')
      return OK('the first request/header (seq ' + String(f.entryFace.seq) + ', reason ' + show(f.entryFace.reason) + ', startsSeries ' + String(f.entryFace.startsSeries) + ') carries ' + String(f.entryFace.toolCount) + ' tool(s) / ' + String(f.entryFace.bytes) + ' byte(s) of schema and neither of the group members ' + show(f.members) + '; the session policy is ' + show(f.policy))
    },
  },
  {
    id: '2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message',
    judge: (f) => {
      if (f.declareCall === null) return NOT_MEASURED('the model never called ' + DECLARE_TOOL + ' in the first round: the one message names that call, and a round the model did not drive is not a product verdict')
      if (f.declareCalls.length > 1) return NOT_MEASURED('the model declared ' + String(f.declareCalls.length) + ' times in one round (' + show(f.declareCalls.map((call) => call.seq)) + '), so there is no single slide to attribute')
      let args = null
      try {
        args = JSON.parse(f.declareCall.arguments)
      } catch {
        args = null
      }
      const open = args !== null && Array.isArray(args.open) ? args.open.map(String) : []
      if (open.includes(GROUP_ID) !== true) return NOT_MEASURED('the declaration named ' + show(args?.open ?? null) + ' and not the live table ' + show(GROUP_ID) + ' group')
      if (f.declaration !== null && f.declaration.refused.length > 0) {
        return NOT_MEASURED('the live declaration was refused by name: ' + f.declaration.refused.map((row) => row.line).join(' | ') + ' (a refused declaration is a configuration fact, not a product verdict)')
      }
      const problems = []
      if (f.changesAfterDeclare.length !== 1) problems.push('after the declaration at seq ' + String(f.declareCall.seq) + ' the session holds ' + String(f.changesAfterDeclare.length) + ' reason:change header(s) (seq ' + show(f.changesAfterDeclare.map((header) => header.seq)) + ')')
      if (f.developers.length !== 1) problems.push('the session holds ' + String(f.developers.length) + ' developer/message(s)')
      if (f.entryFace === null) problems.push('the session logged no request/header, so the face before the declaration cannot be read')
      if (problems.length === 0) {
        const header = f.changesAfterDeclare[0]
        const message = f.developers[0]
        if (message.headerSeq !== header.seq) problems.push('the developer/message points at headerSeq ' + show(message.headerSeq) + ' and the change header is seq ' + String(header.seq))
        const step = f.stepOf(header.seq)
        if (step !== null && (message.turn !== step.turn || message.step !== step.step)) problems.push('the developer/message is logged at turn ' + String(message.turn) + ' step ' + String(message.step) + ' while the change header belongs to turn ' + String(step.turn) + ' step ' + String(step.step))
        if (sameSet(message.additions, f.members) !== true) problems.push('the tool-addition rows are ' + show(message.additions) + ' and the live table declares ' + show(f.members) + ', so the rows are not the group members name for name')
        const membersInFaceOrder = header.names.filter((name) => f.members.includes(name))
        if (same(message.additions, membersInFaceOrder) !== true) problems.push('the tool-addition rows read ' + show(message.additions) + ' while the face the same slide wrote carries those names as ' + show(membersInFaceOrder) + ': the kernel writes these rows from the names the face gained, in the face own order (packages/core/agent-loop/src/agent.ts:638-639), and this gate reads them against that face')
        const others = message.blocks.filter((kind) => kind !== 'tool-addition')
        if (others.length > 0) problems.push('the developer/message carries non-addition blocks: ' + show(others))
        const added = header.names.filter((name) => f.entryFace.names.includes(name) === false)
        const removed = f.entryFace.names.filter((name) => header.names.includes(name) === false)
        const kept = header.names.filter((name) => f.members.includes(name) === false)
        if (sameSet(added, f.members) !== true) problems.push('the face the declaration wrote gained ' + show(added) + ' and the group declares ' + show(f.members))
        if (removed.length !== 0) problems.push('the declaration took ' + show(removed) + ' away')
        if (same(kept, f.entryFace.names) !== true) problems.push('the old names did not keep their places: with the members taken out the new face reads ' + String(kept.length) + ' name(s) against the ' + String(f.entryFace.names.length) + ' of the entry face')
        if (header.toolCount !== f.entryFace.toolCount + f.members.length) problems.push('the face went from ' + String(f.entryFace.toolCount) + ' to ' + String(header.toolCount) + ' name(s) while the group declares ' + String(f.members.length))
        if (f.declaration !== null && f.declaration.applied.length === 1) {
          const row = f.declaration.applied[0]
          if (row.id !== GROUP_ID) problems.push('the applied row is ' + show(row.id))
          if (row.effective !== EFFECTIVE) problems.push('the applied row reports effective=' + show(row.effective) + ' and the plugin only ever reports ' + show(EFFECTIVE))
          if (row.entries !== header.toolCount) problems.push('the reported entry count ' + String(row.entries) + ' is not the change header own ' + String(header.toolCount))
          if (row.bytes !== header.bytes) problems.push('the reported ' + String(row.bytes) + ' bytes are not this gate own arithmetic on that header (' + String(header.bytes) + ' bytes of JSON.stringify(header.tools))')
          if (row.startsSeries !== header.startsSeries) problems.push('the reported startsSeries=' + String(row.startsSeries) + ' is not the change header own marker (' + String(header.startsSeries) + ')')
        } else if (f.declaration !== null) {
          problems.push('the declaration answered ' + String(f.declaration.applied.length) + ' applied row(s), so the reported cost cannot be checked against the header')
        }
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      const header = f.changesAfterDeclare[0]
      const message = f.developers[0]
      const row = f.declaration !== null && f.declaration.applied.length === 1 ? f.declaration.applied[0] : null
      return OK('one declaration (' + show(args) + ' at seq ' + String(f.declareCall.seq) + ') wrote exactly one reason:change header (seq ' + String(header.seq) + ') and exactly one developer/message (seq ' + String(message.seq) + ', headerSeq ' + String(message.headerSeq) + ') whose tool-addition rows are ' + show(message.additions) + ' and the group members ' + show(f.members) + ' name for name; the rows follow the FACE own order (the kernel writes them from the names the face gained: packages/core/agent-loop/src/agent.ts:638-639), which here is not the table configuration order; the face went from ' + String(f.entryFace.toolCount) + ' to ' + String(header.toolCount) + ' name(s) with added == ' + show(f.members) + ' and removed == []; the cost trio read from that header is entries ' + String(header.toolCount) + ' / bytes ' + String(header.bytes) + ' / startsSeries ' + String(header.startsSeries) + (row === null ? '' : ' (the plugin reported "' + row.line + '" and all three numbers equal the header own)') + '. startsSeries is the marker of the header the session ACTUALLY holds, not a prediction of the next step.')
    },
  },
  {
    id: '3-a-ledger-change-and-the-two-request-witnesses',
    judge: (f) => {
      const t = f.transcript
      const append = f.append
      const entry = t.ledger?.entry ?? null
      const beforeAppend = t.ledger?.beforeAppend ?? null
      if (append === null || append.ok !== true) {
        return NOT_MEASURED('this gate could not append its own attributable note to the live ledger (' + clip((append?.problems ?? ['the append step did not run']).join(' | '), 400) + '), so the ledger never changed and neither half of this reading could be measured')
      }
      const problems = []
      const lines = []
      if (entry === null || beforeAppend === null) problems.push('the ledger was not snapshotted before the append')
      else if (entry.sha256 !== beforeAppend.sha256) problems.push('the ledger moved before this gate appended anything (' + clip(String(entry.sha256), 12) + ' -> ' + clip(String(beforeAppend.sha256), 12) + ')')
      else lines.push('the live ledger was byte-identical from entry (sha256 ' + clip(String(entry.sha256), 12) + ', ' + String(entry.bytes) + ' bytes) to the moment before this gate appended, so nothing else moved it')
      if (append.exactLineHeld !== true) problems.push('the ledger did not grow by exactly the one line this gate appended')
      if (append.prefixHeld !== true) problems.push('the pre-append bytes are not a byte-prefix of the result, so this was not an append-only write')
      if (append.noteHeld !== true) problems.push('the record the live ledger carries is not this gate note (' + show(append.record) + ')')
      if (append.sections?.afterCarriesNote !== true) problems.push('the shipped renderer, over the live file own records, does not render this gate note into the section text')
      if (problems.length === 0) {
        lines.push('this gate appended exactly one note with the SHIPPED product own appendNote (' + String(append.lineBytes) + ' bytes, seq ' + String(append.seq) + ', id ' + String(append.id) + ', author ' + String(append.record?.payload?.author) + ', writer ' + String(append.record?.writer) + '); the file grew by exactly that line and the old bytes are unchanged underneath it')
        lines.push('the shipped renderer over that file own records answers a section of ' + String(append.sections.afterChars) + ' character(s) that carries the note text byte-for-byte')
      }
      // The negative half: a request assembled while the ledger had not changed carries no occurrence of it.
      if (f.promptBeforeBoundary === null) problems.push('the session logged no system prompt before the two rounds, so the negative half has no witness')
      else if (f.promptBeforeBoundary.text.includes(f.noteText)) problems.push('the prompt in force before the ledger changed already carried the note text (system/message seq ' + String(f.promptBeforeBoundary.seq) + '), so "the ledger had not changed" is not true of that request')
      else lines.push('negative half: the prompt in force while the ledger was unchanged (system/message seq ' + String(f.promptBeforeBoundary.seq) + ', ' + String(codePoints(f.promptBeforeBoundary.text)) + ' character(s)) carries no occurrence of the note text')
      if (problems.length > 0) return BAD(problems.join('; '))
      // The positive half. It is a ROUND boundary here: the append lands between the two prompts.
      if (f.turn2Seq === null) {
        return NOT_MEASURED('the second round never ran, so there is no request after the append: ' + clip((t.notes ?? []).filter((note) => note.startsWith('NOT MEASURED')).join(' | '), 300))
      }
      const carried = f.promptInForceAfter !== null && f.promptInForceAfter.text.includes(f.noteText)
      if (carried !== true) {
        const listResult = f.listResults.length === 0 ? null : f.listResults[f.listResults.length - 1]
        const kernelView = listResult === null ? '(the model never called ' + LIST_TOOL + ')' : clip(listResult.text, 300)
        const openRefusal = append.openRefusal === null || append.openRefusal === undefined ? null : String(append.openRefusal.message ?? '');
        return NOT_MEASURED('the request that follows the append does NOT carry the note text, and this gate will not report green for it: the live kernel ledger view is the control log it opened when the plugin loaded (its replay is a process-local view read at open), so a record another process appends to the file is invisible to this window until the plugin is loaded again; the shipped product itself will not open that ledger from a second process (' + clip(openRefusal, 220) + '); the kernel own ' + LIST_TOOL + ' answered: ' + kernelView + '. Measured facts: the ledger file grew by this gate one line (' + String(append.lineBytes) + ' bytes, seq ' + String(append.seq) + ', author ' + String(append.record?.payload?.author) + '), the shipped renderer over that file carries the note (' + String(append.sections.afterChars) + ' character(s)), the prompt in force after the boundary is system/message seq ' + show(f.promptInForceAfter?.seq) + ' with ' + show(f.promptInForceAfter === null ? null : codePoints(f.promptInForceAfter.text)) + ' character(s), and ' + String(f.commitsAfterBoundary.length) + ' system/message commit(s) landed in the second round. The in-process write path (' + ADD_TOOL + ') is the one that would reach the prompt, and it is answered by the approval question - see reading 4.')
      }
      const prompt = f.promptInForceAfter
      const section = String(append.sections.after)
      const sectionIndex = prompt.text.indexOf(section)
      const detail = 'positive half (a ROUND boundary: the note was appended between the two prompts, so this is not a step-level reading): the request that follows the append carries the note text byte-for-byte - system/message seq ' + String(prompt.seq) + ' (' + String(prompt.surfaceOp) + ', turn ' + String(prompt.turn) + ' step ' + String(prompt.step) + ') is ' + String(codePoints(prompt.text)) + ' character(s) and contains the note; the section the shipped renderer answers is ' + String(append.sections.afterChars) + ' character(s) and ' + (sectionIndex === -1 ? 'is NOT present as one byte-identical block' : 'sits at character ' + String(sectionIndex) + ' byte-for-byte') + '; ' + String(f.commitsAfterBoundary.length) + ' system/message commit(s) landed in the second round; negative half: the pre-append prompt carried none of it'
      if (sectionIndex === -1) return BAD(detail + ' - but the section as a whole does not appear byte-for-byte in that prompt')
      return OK(detail)
    },
  },
  {
    id: '4-the-write-was-refused-by-name-and-the-ledger-did-not-move',
    judge: (f) => {
      const t = f.transcript
      if (f.addCall === null) {
        return NOT_MEASURED('the model never called ' + ADD_TOOL + ' in the second round, so the live approval seam was never exercised: the one message names that call, and a call that never happened is not a product verdict')
      }
      if (f.addResult === null) {
        return NOT_MEASURED('the ' + ADD_TOOL + ' call at seq ' + String(f.addCall.seq) + ' has no tool/result event, so the seam produced no answer this gate can read (' + String(f.approvals.asked) + ' approval/asked, ' + String(f.approvals.decided) + ' approval/decided in the session; the round ended ' + show(f.turnEnd?.kind) + ')')
      }
      const beforeAttempt = t.ledger?.beforeAttempt ?? null
      const exit = t.ledger?.exit ?? null
      if (beforeAttempt === null || exit === null) return NOT_MEASURED('the ledger around the attempt was not snapshotted, so "the ledger did not move" cannot be measured')
      const named = REFUSAL_SENTENCES.find((sentence) => f.addResult.text.includes(sentence)) ?? null
      const granted = /^added note /u.test(f.addResult.text.trim()) || f.addResult.text.includes('added note n-')
      if (granted === true) {
        return NOT_MEASURED('the live world GRANTED the ' + ADD_TOOL + ' call instead of refusing it (result: ' + clip(f.addResult.text, 200) + '), so the fail-closed seam was not exercised by this run; the ledger went from ' + String(beforeAttempt.recordCount) + ' to ' + String(exit.recordCount) + ' record(s)')
      }
      if (named === null) return BAD('the ' + ADD_TOOL + ' result is neither a grant nor one of the kernel own refusals: ' + clip(f.addResult.text, 300) + ' (isError ' + String(f.addResult.isError) + ')')
      const problems = []
      if (beforeAttempt.sha256 !== exit.sha256) problems.push('the ledger moved during the attempt (' + clip(String(beforeAttempt.sha256), 12) + ' -> ' + clip(String(exit.sha256), 12) + ', ' + String(beforeAttempt.recordCount) + ' -> ' + String(exit.recordCount) + ' record(s))')
      if (exit.records.some((row) => row.author === 'agent' || row.text === f.probeText) === true) problems.push('the ledger holds a record the tool call would have written: ' + show(exit.records.filter((row) => row.author === 'agent' || row.text === f.probeText)))
      if (f.turnEnd === null) problems.push('the session logged no turn/end')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the ' + ADD_TOOL + ' call at seq ' + String(f.addCall.seq) + ' (turn ' + String(f.addCall.turn) + ' step ' + String(f.addCall.step) + ') was answered with the kernel own refusal ' + show(named) + ' (isError ' + String(f.addResult.isError) + '), and the live ledger is byte-identical across the attempt (' + String(exit.bytes) + ' bytes, sha256 ' + clip(String(exit.sha256), 12) + ', ' + String(exit.recordCount) + ' record(s)): the approval question asked ' + String(f.approvals.asked) + ' time(s) and was decided ' + String(f.approvals.decided) + ' time(s) ' + show(f.approvals.decidedRows) + ' under the session policy ' + show(f.policy))
    },
  },
  {
    id: '5-the-world-fingerprint-left-behind',
    judge: (f) => {
      const t = f.transcript
      const problems = []
      const lines = []
      const before = t.entry?.sessions ?? null
      const after = t.exit?.sessions ?? null
      if (t.entry?.client === null || t.entry?.client === undefined) problems.push('the client could not be named at entry')
      else if (t.entry.client !== t.exit.client) problems.push('the client was replaced during the run: ' + String(t.entry.client) + ' -> ' + String(t.exit.client))
      else lines.push('the client is the same process from entry to exit: ' + String(t.entry.client))
      if (t.entry?.kernel === null || t.entry?.kernel === undefined) problems.push('the kernel could not be named at entry')
      else if (t.exit.kernel === null || t.exit.kernel.pid !== t.entry.kernel.pid) problems.push('the kernel was replaced during the run: ' + show(t.entry.kernel.pid) + ' -> ' + show(t.exit.kernel?.pid))
      else lines.push('the live kernel is the same process from entry to exit: pid ' + String(t.entry.kernel.pid))
      if (before === null || after === null) problems.push('the session list could not be read at ' + (before === null ? 'entry' : 'exit'))
      else {
        const moved = []
        for (const row of before.rows) {
          const now = after.rows.find((one) => one.sessionId === row.sessionId) ?? null
          if (now === null) problems.push('the session ' + String(row.sessionId) + ' that existed at entry is gone at exit')
          else if (now.asOfSeq !== row.asOfSeq) moved.push(String(row.sessionId) + ' ' + String(row.asOfSeq) + ' -> ' + String(now.asOfSeq))
        }
        if (moved.length > 0) problems.push('another session moved while this gate ran: ' + show(moved))
        const born = after.rows.filter((one) => before.rows.some((row) => row.sessionId === one.sessionId) === false)
        if (born.length !== 1) problems.push('this gate created one session and the world gained ' + String(born.length) + ': ' + show(born.map((row) => row.sessionId)))
        else if (f.sessionId === null || born[0].sessionId !== f.sessionId) problems.push('the new session is ' + show(born[0].sessionId) + ' and this gate own session is ' + show(f.sessionId))
        else lines.push('sessions ' + String(before.count) + ' -> ' + String(after.count) + ' and the only new one is this gate own ' + String(f.sessionId) + ', left in place (it is the evidence; this gate deletes nothing)')
        if (moved.length === 0 && born.length === 1) lines.push('every one of the ' + String(before.rows.length) + ' pre-existing session(s) kept its asOfSeq')
      }
      const entryLedger = t.ledger?.entry ?? null
      const afterAppend = t.ledger?.afterAppend ?? null
      const exitLedger = t.exit?.ledger?.file ?? null
      if (entryLedger === null || afterAppend === null || exitLedger === null) problems.push('the ledger snapshots are incomplete')
      else {
        if (afterAppend.sha256 === entryLedger.sha256 && f.append !== null && f.append.ok === true) problems.push('the ledger did not change although this gate appended a note')
        if (exitLedger.sha256 !== afterAppend.sha256) problems.push('the ledger moved after this gate one append (' + clip(String(afterAppend.sha256), 12) + ' -> ' + clip(String(exitLedger.sha256), 12) + ', ' + String(afterAppend.recordCount) + ' -> ' + String(exitLedger.recordCount) + ' record(s))')
        else lines.push('the ledger holds exactly this gate one appended record from ' + String(entryLedger.recordCount) + ' to ' + String(exitLedger.recordCount) + ' record(s) / ' + String(exitLedger.bytes) + ' byte(s) (sha256 ' + clip(String(exitLedger.sha256), 12) + ' at exit, unchanged after the append)')
        const note = f.append?.record ?? null
        if (note !== null && exitLedger.records.some((row) => row.seq === note.seq && row.text === f.noteText && row.author === NOTE_AUTHOR) !== true) problems.push('the note this gate appended is not in the ledger at exit')
        else if (note !== null) lines.push('the gate own note is in the ledger at exit: seq ' + String(note.seq) + ', id ' + String(note.subject) + ', author ' + String(note.payload?.author))
      }
      const entryLock = t.subject?.ledger?.lock ?? null
      const exitLock = t.exit?.ledger?.lock ?? null
      for (const pair of [
        { what: 'the writer lock ' + String(t.subject?.ledger?.lockPath ?? ''), entry: entryLock, exit: exitLock },
        { what: 'the instance file ' + String(t.subject?.ledger?.instancePath ?? ''), entry: t.subject?.ledger?.instance ?? null, exit: t.exit?.ledger?.instance ?? null },
        { what: 'the shipped module', entry: t.subject?.module ?? null, exit: t.exit?.subject?.module ?? null },
        { what: 'the notes bundle patch', entry: t.subject?.config ?? null, exit: t.exit?.subject?.config ?? null },
        { what: 'the groups bundle patch (the table)', entry: t.subject?.groupsPatch ?? null, exit: t.exit?.subject?.groupsPatch ?? null },
        { what: 'the live profile package.json', entry: t.subject?.profilePkg ?? null, exit: t.exit?.subject?.profilePkg ?? null },
      ]) {
        if (pair.entry === null || pair.exit === null) problems.push(pair.what + ' could not be read on both sides')
        else if (pair.entry.sha256 !== pair.exit.sha256) problems.push(pair.what + ' changed during the run: sha256 ' + clip(String(pair.entry.sha256), 12) + ' -> ' + clip(String(pair.exit.sha256), 12))
        else lines.push(pair.what + ' is byte-identical before and after (sha256 ' + clip(String(pair.entry.sha256), 12) + ', ' + String(pair.entry.bytes) + ' bytes)')
      }
      for (const layer of t.subject?.layers ?? []) {
        const now = (t.exit?.subject?.layers ?? []).find((one) => one.path === layer.path) ?? null
        if (now === null || now.file.sha256 !== layer.file.sha256) problems.push('the live layer ' + layer.path + ' changed during the run')
        else lines.push('the live layer ' + layer.path + ' is byte-identical before and after (sha256 ' + clip(String(layer.file.sha256), 12) + ')')
      }
      const entryRepo = t.entry?.repo ?? null
      const exitRepo = t.exit?.repo ?? null
      if (entryRepo?.ok !== true || exitRepo?.ok !== true) problems.push('the repository porcelain could not be read (' + show(entryRepo?.why ?? exitRepo?.why) + ')')
      else if (entryRepo.text !== exitRepo.text) problems.push('the working tree changed during the run (git status --porcelain differs): before ' + show(clip(entryRepo.text, 200)) + ', after ' + show(clip(exitRepo.text, 200)))
      else lines.push('the repository own porcelain is unchanged by this run (' + String(entryRepo.text.split('\n').filter((line) => line !== '').length) + ' entry/entries before and after)')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join('; '))
    },
  },
]

const runJudges = (transcript) => {
  const facts = buildFacts(transcript)
  return READINGS.map((reading) => {
    try {
      const verdict = reading.judge(facts)
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
const recordsOf = (t) => (Array.isArray(t?.page?.records) ? t.page.records : (Array.isArray(t?.page1?.records) ? t.page1.records : []))
const eventsOf = (t) => recordsOf(t).map((record) => record?.event).filter((event) => event !== null && typeof event === 'object')
const editResultText = (t, predicate, edit) => {
  for (const record of recordsOf(t)) {
    const event = record?.event
    if (event?.type !== 'tool/result') continue
    const content = event.data?.message?.content
    if (Array.isArray(content) !== true) continue
    const part = content.find((one) => one?.type === 'text' && predicate(String(one.text ?? '')))
    if (part === undefined) continue
    part.text = edit(String(part.text))
    return true
  }
  return false
}
const changeHeaderEvent = (t) => {
  const found = eventsOf(t).filter((event) => event.type === 'request/header' && event.data?.reason === 'change')
  return found[found.length - 1] ?? null
}
const initialHeaderEvent = (t) => eventsOf(t).find((event) => event.type === 'request/header') ?? null
const systemMessageEvents = (t) => eventsOf(t).filter((event) => event.type === 'system/message')

const MUTANTS = [
  {
    name: 'control-nothing-changes',
    declared: [],
    what: 'the control: a transcript nobody touched must redden nothing',
    apply: () => {},
  },
  {
    name: 'the-live-boot-line-is-not-this-build',
    declared: ['0-the-live-kernel-loaded-the-code-this-gate-judges'],
    what: 'a boot log whose notes line does not name the section/order/limits this gate judges (the evidence that the live kernel loaded this build)',
    apply: (t) => {
      if (t.subject?.bootChecks !== undefined && typeof t.subject.bootChecks.notesLine === 'string') {
        t.subject.bootChecks.notesLine = t.subject.bootChecks.notesLine.replace('order 700', 'order 699')
        t.subject.bootChecks.notesNamesOrder = false
      }
    },
  },
  {
    name: 'another-live-consumer-was-running',
    declared: ['0-the-live-kernel-loaded-the-code-this-gate-judges'],
    what: 'the single-run discipline broken: a gate that drove a client somebody else was driving',
    apply: (t) => {
      t.entry.otherConsumers = ['pid 4242 node scripts/verify-browser-tabs-live.mjs']
    },
  },
  {
    name: 'the-first-face-already-had-the-notes-tools',
    declared: ['1-the-closed-group-is-not-in-the-first-face', '2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message'],
    what: 'a brand-new session whose face was already open, so the slide this gate reads had already happened',
    apply: (t) => {
      const header = initialHeaderEvent(t)
      const members = t.subject?.group?.tools ?? []
      if (header === null || members.length === 0) return
      const tools = Array.isArray(header.data?.header?.tools) ? header.data.header.tools : []
      tools.push(...members.map((name) => ({ name, description: 'mutant', parameters: { type: 'object', properties: {} } })))
    },
  },
  {
    name: 'a-tool-addition-row-is-missing',
    declared: ['2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message'],
    what: 'a developer/message that names fewer members than the group it opened',
    apply: (t) => {
      const record = recordsOf(t).find((one) => one?.event?.type === 'developer/message') ?? null
      const content = record?.event?.data?.message?.content
      if (Array.isArray(content) !== true || content.length === 0) return
      content.pop()
    },
  },
  {
    name: 'a-second-change-header-was-written',
    declared: ['2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message'],
    what: 'one declaration paying for two slides',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      if (header === null) return
      const records = recordsOf(t)
      const copy = clone(records.find((record) => record?.event === header) ?? null)
      if (copy === null) return
      copy.event.seq = Number(header.seq) + 0.5
      const last = records.findLastIndex((record) => record?.event?.type === 'turn/end')
      records.splice(last === -1 ? records.length : last, 0, copy)
    },
  },
  {
    name: 'the-declaration-reported-another-entry-count',
    declared: ['2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message'],
    what: 'a cost report that counts something other than the face it just wrote',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), (text) => text.replace(/surface now (\d+) tools/u, (_all, count) => 'surface now ' + String(Number(count) + 1) + ' tools'))
    },
  },
  {
    name: 'the-reported-series-flag-is-a-lie',
    declared: ['2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message'],
    what: 'a report that claims the next request starts a new series',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), (text) => text.replace(/startsSeries=(true|false)/u, 'startsSeries=true'))
    },
  },
  {
    name: 'the-declaration-was-refused',
    declared: ['2-one-declaration-wrote-exactly-one-change-header-and-one-developer-message'],
    what: 'a group the live world cannot open (the configuration fact this gate names instead of scoring)',
    apply: (t) => {
      const members = (t.subject?.group?.tools ?? []).join(', ')
      editResultText(t, (text) => text.startsWith('- opened'), () => '- refused ' + GROUP_ID + ' [GROUPS_NO_TOOLS] declared tools registered on no layer this agent can call: ' + members + '\nKnown group ids (configuration order): teams, ' + GROUP_ID)
    },
  },
  {
    name: 'the-append-was-not-append-only',
    declared: ['3-a-ledger-change-and-the-two-request-witnesses'],
    what: 'a write that rewrote the ledger instead of growing it: the pre-append bytes are no longer a byte-prefix of the result',
    apply: (t) => {
      if (t.append === undefined || t.append === null) return
      t.append.prefixHeld = false
    },
  },
  {
    name: 'the-note-was-already-in-the-earlier-request',
    declared: ['3-a-ledger-change-and-the-two-request-witnesses'],
    what: 'a request assembled while the ledger was unchanged that already carried the note text',
    apply: (t) => {
      const rows = systemMessageEvents(t)
      if (rows.length === 0) return
      const target = rows[0]
      const content = Array.isArray(target?.data?.message?.content) ? target.data.message.content : []
      const part = content.find((one) => one?.type === 'text')
      if (part === undefined) return
      part.text = String(part.text) + '\n' + String(t.note?.text ?? NOTE_TEXT) + '\n'
    },
  },
  {
    name: 'the-write-was-granted',
    declared: ['4-the-write-was-refused-by-name-and-the-ledger-did-not-move'],
    what: 'a live world that answered the notes_add call with a note instead of a refusal',
    apply: (t) => {
      editResultText(t, (text) => text.includes('requires approval') || text.includes('rejected tool') || text.includes('was cancelled') || text.includes('Auto review rejected'), () => 'added note n-mutant (seq 9, author r187-live-gate). The ledger holds 1 live note(s); the notes:ledger section is now 60 character(s), so the next request carries it and the prompt head is written once.')
    },
  },
  {
    name: 'the-ledger-moved-during-the-attempt',
    declared: ['4-the-write-was-refused-by-name-and-the-ledger-did-not-move'],
    what: 'a record appearing in the ledger across the refused attempt',
    apply: (t) => {
      if (t.ledger?.beforeAttempt === undefined || t.ledger.beforeAttempt === null) return
      t.ledger.beforeAttempt.sha256 = 'mutant0000000000000000000000000000000000000000000000000000000000'
    },
  },
  {
    name: 'another-session-moved',
    declared: ['5-the-world-fingerprint-left-behind'],
    what: 'this gate writing into a session that is not its own',
    apply: (t) => {
      const rows = t.exit?.sessions?.rows ?? []
      const other = rows.find((row) => row.sessionId !== t.session?.sessionId) ?? null
      if (other !== null) other.asOfSeq = Number(other.asOfSeq) + 7
    },
  },
  {
    name: 'the-ledger-grew-after-the-append',
    declared: ['5-the-world-fingerprint-left-behind'],
    what: 'a ledger that kept moving after this gate one append',
    apply: (t) => {
      if (t.exit?.ledger?.file === undefined || t.exit.ledger.file === null) return
      t.exit.ledger.file.sha256 = 'mutant1111111111111111111111111111111111111111111111111111111111'
      t.exit.ledger.file.recordCount = Number(t.exit.ledger.file.recordCount) + 2
      t.exit.ledger.file.bytes = Number(t.exit.ledger.file.bytes) + 120
    },
  },
  {
    name: 'the-writer-lock-was-touched',
    declared: ['5-the-world-fingerprint-left-behind'],
    what: 'this gate taking the live ledger writer lock, which it must never do',
    apply: (t) => {
      if (t.exit?.ledger?.lock === undefined || t.exit.ledger.lock === null) return
      t.exit.ledger.lock.sha256 = 'mutant2222222222222222222222222222222222222222222222222222222222'
    },
  },
  {
    name: 'the-shipped-module-was-rewritten-mid-run',
    declared: ['5-the-world-fingerprint-left-behind'],
    what: 'the code under test changing between entry and exit',
    apply: (t) => {
      if (t.exit?.subject?.module !== undefined && t.exit.subject.module !== null) t.exit.subject.module.sha256 = 'mutant3333333333333333333333333333333333333333333333333333333333'
    },
  },
  {
    name: 'the-working-tree-changed',
    declared: ['5-the-world-fingerprint-left-behind'],
    what: 'a run that moved something in the repository it does not own',
    apply: (t) => {
      if (t.exit?.repo !== undefined && t.exit.repo !== null && t.exit.repo.ok === true) t.exit.repo.text = String(t.exit.repo.text) + ' M plugins/dsh-link-notes/lib/index.js\n'
    },
  },
]

/**
 * A reading's verdict is one of three CLASSES, and a mutant "moves" a reading when its class changes.
 * That is what makes the attack honest on a transcript that already carries a NAMED THIRD STATE: a
 * reading this world could not measure is not silently counted as reddened by every mutant, and a mutant
 * that turns it into a failure (or, symmetrically, that turns it green) is still exactly declared.
 */
const classOf = (verdict) => (verdict.ok === true ? 'ok' : verdict.notMeasured === true ? 'not-measured' : 'FAILED')

const selfAttack = (transcript) => {
  const baseline = runJudges(transcript)
  const baseClass = new Map(baseline.map((entry) => [entry.id, classOf(entry)]))
  const green = baseline.filter((entry) => classOf(entry) === 'ok')
  const third = baseline.filter((entry) => classOf(entry) === 'not-measured')
  const red = baseline.filter((entry) => classOf(entry) === 'FAILED')
  console.log('')
  console.log('== self-attack: ' + String(MUTANTS.length) + ' mutants over the MEASURED transcript of this run ==')
  console.log('  baseline: ' + String(green.length) + ' green, ' + String(third.length) + ' named third state(s), ' + String(red.length) + ' failed (no mutant is applied to the world; the client is not touched)')
  for (const entry of third) console.log('    named third state in the baseline (measured, not green, not red): ' + entry.id)
  if (red.length > 0) {
    console.log('  the attack does not start: a reading FAILED in the baseline, and a mutant over a red baseline proves nothing')
    for (const entry of red) console.log('    ' + entry.id + ' -> ' + clip(entry.detail, 200))
    return 1
  }
  console.log('  a mutant moves a reading when its verdict class changes against the baseline; declared sets below are class moves.')
  const coverage = new Map(READINGS.map((reading) => [reading.id, 0]))
  let problems = 0
  for (const mutant of MUTANTS) {
    const copy = clone(transcript)
    let applied = true
    try {
      mutant.apply(copy)
    } catch (error) {
      applied = false
      console.log('  BROKEN ' + pad(mutant.name, 52) + ' the mutation threw: ' + describe(error))
    }
    const verdicts = runJudges(copy)
    const observed = verdicts.filter((entry) => classOf(entry) !== baseClass.get(entry.id)).map((entry) => entry.id)
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const exact = applied === true && same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 52) + ' declared=' + show(mutant.declared.map((id) => id.split('-')[0])) + ' observed=' + show(observed.map((id) => id.split('-')[0])))
    console.log('        ' + mutant.what)
    if (exact !== true) {
      const unexpected = observed.filter((id) => mutant.declared.includes(id) === false)
      const missed = mutant.declared.filter((id) => observed.includes(id) === false)
      if (unexpected.length > 0) console.log('        UNEXPECTED red: ' + show(unexpected))
      if (missed.length > 0) console.log('        MISSED red: ' + show(missed))
    }
  }
  console.log('  coverage matrix (mutants declaring each reading; every reading needs at least one):')
  let uncovered = 0
  for (const [id, count] of coverage) {
    if (count === 0) uncovered += 1
    console.log('    ' + pad(String(count), 3) + ' ' + id)
  }
  console.log('  declared sets == observed sets for ' + String(MUTANTS.length - problems) + ' of ' + String(MUTANTS.length) + ' mutants; readings with no mutant: ' + String(uncovered))
  return problems === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict
// ---------------------------------------------------------------------------

const printTranscript = (t, facts) => {
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell: ' + SHELL_ORIGIN + ' through CDP ' + String(CDP_PORT) + ' (page ' + String(t.page_url ?? '(unread)') + '; the client was already running - this gate never starts or stops it)')
  console.log('  client: ' + String(t.entry.client ?? '(not read)') + ' at entry, ' + String(t.exit.client ?? '(not read)') + ' at the end')
  console.log('  kernel: ' + (t.entry.kernel === null || t.entry.kernel === undefined ? '(not read)' : 'pid ' + String(t.entry.kernel.pid) + ' port ' + show(t.entry.kernel.port) + ' started ' + String(t.entry.kernel.created) + ' patches ' + show(t.entry.kernel.patches)))
  console.log('  ports: ' + show(t.entry.ports) + ' at entry, ' + show(t.exit.ports) + ' at the end')
  console.log('  boot log: ' + String(t.subject?.boot?.path ?? '(unread)') + ' (' + String(t.subject?.boot?.bytes ?? '?') + ' bytes, ' + String(t.subject?.boot?.lineCount ?? '?') + ' lines, mtime ' + String(t.subject?.boot?.mtime ?? '?') + ')')
  for (const line of t.subject?.boot?.matched ?? []) console.log('    ' + line)
  console.log('  live profile: ' + String(t.subject?.profileDir ?? '(unread)') + ' mounts ' + NOTES_BUNDLE + ' as ' + show(t.subject?.mounted))
  console.log('  subject: ' + String(t.subject?.modulePath ?? '(unread)') + ' (' + String(t.subject?.module?.bytes ?? '?') + ' bytes, sha256 ' + clip(String(t.subject?.module?.sha256 ?? '?'), 12) + ')')
  console.log('  table:   ' + String(t.subject?.groupsPatchPath ?? '(unread)') + ' (' + String(t.subject?.groupsPatch?.bytes ?? '?') + ' bytes, sha256 ' + clip(String(t.subject?.groupsPatch?.sha256 ?? '?'), 12) + ')')
  for (const group of t.subject?.table?.groups ?? []) {
    console.log('    group ' + pad(group.id, 10) + ' state=' + String(group.state) + ' auto=' + String(group.autoWhen) + ' provider=' + String(group.provider) + ' tools(' + String(group.tools.length) + '): ' + group.tools.join(', '))
  }
  console.log('  ledger: ' + String(t.subject?.ledger?.path ?? '(unread)') + ' lock=' + show(t.subject?.ledger?.lockContent) + ' instance=' + show(t.subject?.ledger?.instanceContent))
  for (const row of [['entry', t.ledger?.entry], ['before the append', t.ledger?.beforeAppend], ['after the append', t.ledger?.afterAppend], ['before the attempt', t.ledger?.beforeAttempt], ['exit', t.ledger?.exit ?? t.exit?.ledger?.file]]) {
    const when = row[0]
    const snap = row[1]
    if (snap === null || snap === undefined) { console.log('    ' + pad(when, 18) + ' (not read)'); continue }
    console.log('    ' + pad(when, 18) + String(snap.bytes) + ' bytes, ' + String(snap.recordCount ?? '?') + ' record(s), lastSeq ' + String(snap.lastSeq ?? '?') + ', sha256 ' + clip(String(snap.sha256), 12))
  }
  if (t.append !== null && t.append !== undefined) {
    console.log('  the note this gate appended: ' + clip(JSON.stringify(t.append.line), 320))
    console.log('    line ' + String(t.append.lineBytes) + ' bytes sha256 ' + clip(String(t.append.lineSha256), 12) + '; exact-line ' + String(t.append.exactLineHeld) + ', prefix ' + String(t.append.prefixHeld) + ', records ' + String(t.append.recordsHeld) + ', note ' + String(t.append.noteHeld))
    console.log('    the shipped renderer over the live file: before ' + String(t.append.sections?.beforeChars) + ' character(s) (empty ' + String((t.append.sections?.before ?? '') === '') + '), after ' + String(t.append.sections?.afterChars) + ' character(s), carries the note ' + String(t.append.sections?.afterCarriesNote))
    console.log('    the shipped product opening the LIVE ledger from this process: ' + (t.append.openRefusal?.attempted === true ? (t.append.openRefusal.refused === true ? 'refused by name: ' + clip(String(t.append.openRefusal.message), 200) : 'OPENED (it should have been refused)') : clip(String(t.append.openRefusal?.message), 200)))
  }
  console.log('  single-run guard: ' + String((t.entry.liveGateFiles ?? []).length) + ' live gate file(s) in the register' + (t.guard?.parseNote === null || t.guard?.parseNote === undefined ? '' : ' (' + String(t.guard.parseNote) + ')') + ', ' + String(t.guard?.nodeProcesses ?? 0) + ' node process(es) read, other live consumers: ' + String((t.entry.otherConsumers ?? []).length))
  for (const consumer of t.entry.otherConsumers ?? []) console.log('    ' + consumer)
  console.log('  prompts: ' + String((t.session?.prompts ?? []).length) + ' sent' + ((t.session?.prompts ?? []).length === 0 ? '' : ' (' + (t.session.prompts).map((row) => row.label + ' accepted=' + String(row.accepted)).join(', ') + ')') + ', session ' + String(t.session?.sessionId ?? '(none)') + ', polls ' + String(t.session?.polls) + ', round 1 ended ' + String(t.session?.round1Ended) + ', round 2 ended ' + String(t.session?.round2Ended))
  console.log('  the session own policy: ' + show(facts.policy) + ' (approval/asked ' + String(facts.approvals.asked) + ', approval/decided ' + String(facts.approvals.decided) + ' ' + show(facts.approvals.decidedRows) + ')')
  console.log('  request/header(s) this session logged (' + String(facts.headers.length) + '):')
  for (const header of facts.headers) {
    console.log('    seq=' + pad(String(header.seq), 4) + ' reason=' + pad(JSON.stringify(header.reason), 10) + ' tools=' + pad(String(header.toolCount), 4) + ' bytes=' + pad(String(header.bytes), 7) + ' startsSeries=' + String(header.startsSeries))
  }
  if (facts.entryFace !== null && facts.firstChangeAfterDeclare !== null) {
    const before = facts.entryFace.names
    const after = facts.firstChangeAfterDeclare.names
    console.log('    face diff (seq ' + String(facts.entryFace.seq) + ' -> seq ' + String(facts.firstChangeAfterDeclare.seq) + '):')
    console.log('      added   (' + String(after.filter((name) => before.includes(name) === false).length) + '): ' + show(after.filter((name) => before.includes(name) === false)))
    console.log('      removed (' + String(before.filter((name) => after.includes(name) === false).length) + '): ' + show(before.filter((name) => after.includes(name) === false)))
  }
  console.log('  system/message commits (' + String(facts.systemMessages.length) + '):')
  for (const row of facts.systemMessages) {
    console.log('    seq=' + pad(String(row.seq), 4) + ' turn ' + String(row.turn) + ' step ' + String(row.step) + ' op=' + pad(String(row.surfaceOp), 8) + ' chars=' + pad(String(codePoints(row.text)), 7) + ' carries-the-note=' + String(row.text.includes(String(t.note?.text ?? ''))))
  }
  console.log('  the calls the model made (' + String(facts.calls.length) + '):')
  for (const call of facts.calls) console.log('    seq=' + pad(String(call.seq), 4) + ' turn ' + String(call.turn) + ' step ' + String(call.step) + ' ' + pad(call.name, 22) + ' ' + clip(call.arguments, 120))
  console.log('  the results the engine wrote (' + String(facts.results.length) + '):')
  for (const result of facts.results) console.log('    seq=' + pad(String(result.seq), 4) + ' turn ' + String(result.turn) + ' step ' + String(result.step) + ' isError=' + String(result.isError) + ' ' + JSON.stringify(clip(result.text, 400)))
  console.log('  developer/message(s) (' + String(facts.developers.length) + '):')
  for (const message of facts.developers) console.log('    seq=' + pad(String(message.seq), 4) + ' turn ' + String(message.turn) + ' step ' + String(message.step) + ' headerSeq=' + pad(String(message.headerSeq), 5) + ' blocks=' + show(message.blocks) + ' additions=' + show(message.additions))
  console.log('  turn/end: ' + show(facts.turnEnd))
  console.log('  sessions: ' + String(t.entry.sessions?.count ?? '?') + ' at entry -> ' + String(t.exit.sessions?.count ?? '?') + ' at the end' + (facts.sessionId === null ? '; no session of this gate own was created' : '; the new one is this gate own ' + String(facts.sessionId) + ' and it is LEFT IN PLACE (it is the evidence)'))
  console.log('  the dump of the judged record: ' + String(t.dumpPath ?? '(not written)'))
  for (const note of t.notes) console.log('  ' + note)
  for (const problem of t.problems) console.log('  PROBLEM ' + problem)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('gate 120 notes-live - the notes ledger in the running client (shell ' + SHELL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  two prompts at most, read-only afterwards except ONE attributable note appended to the live ledger; the self-attack mutates THIS run transcript and never drives the world twice')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const read = readText(resolve(REPLAY_PATH))
    if (read.ok !== true) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + resolve(REPLAY_PATH) + ' (' + read.why + ')')
      return 3
    }
    try {
      transcript = JSON.parse(read.text)
    } catch (error) {
      console.log('')
      console.log('SKIP: the transcript at ' + resolve(REPLAY_PATH) + ' is not JSON (' + describe(error) + ')')
      return 3
    }
    if (transcript?.schema !== 'r187-g120-transcript/1') {
      console.log('')
      console.log('SKIP: the file at ' + resolve(REPLAY_PATH) + ' is not a transcript this gate wrote (schema ' + show(transcript?.schema) + ')')
      return 3
    }
    console.log('  replay: judging ' + resolve(REPLAY_PATH) + ' - the world is NOT touched and NO prompt is sent')
  } else {
    const bag = {}
    try {
      transcript = await runWorld(bag)
    } catch (error) {
      if (error instanceof NotMeasured) {
        const partial = bag.transcript ?? null
        if (partial !== null) {
          try {
            printTranscript(partial, buildFacts(partial))
          } catch {
            console.log('  (the partial printout failed; the readings below do not exist)')
          }
        }
        console.log('')
        console.log('SKIP: ' + error.message)
        console.log('notes-live: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
        return 3
      }
      console.log('')
      console.log('SKIP: the gate could not run at all: ' + describe(error))
      console.log(String(error?.stack ?? '').split('\n').slice(0, 5).join('\n'))
      return 3
    }
  }
  const facts = buildFacts(transcript)
  if ((transcript.problems ?? []).length > 0) {
    console.log('')
    console.log('== the drive did not complete ==')
    for (const problem of transcript.problems) console.log('  ' + problem)
    for (const note of transcript.notes ?? []) console.log('  ' + note)
    console.log('notes-live: the world could not be driven to the end, so nothing was judged (exit 3)')
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
  const stopped = (transcript.notes ?? []).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
  console.log('')
  if (SELF_ATTACK === true) {
    if (stopped.length > 0 || failed.length > 0) {
      console.log('notes-live: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a baseline with a failed reading' + (stopped.length > 0 ? ' or a stopped world' : ''))
      for (const verdict of failed) console.log('    failed: ' + verdict.id + ' -> ' + clip(verdict.detail, 200))
      for (const note of stopped) console.log('    stopped the world: ' + clip(note, 200))
      return 1
    }
    if (notMeasured.length > 0) {
      console.log('  the baseline carries ' + String(notMeasured.length) + ' NAMED THIRD STATE(s): ' + show(notMeasured.map((verdict) => verdict.id.split('-')[0])) + ' - the attack starts anyway, and a mutant moves such a reading only when it changes its verdict class (a named third state is never counted as reddened by every mutant)')
    }
    const attack = selfAttack(transcript)
    console.log('notes-live --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED'))
    return attack === 0 ? 0 : 1
  }
  const sessionPhrase = transcript.session?.created === true
    ? 'session ' + String(facts.sessionId) + ' left in place as the evidence'
    : 'no session of this gate own was created'
  console.log('notes-live: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live client at ' + SHELL_ORIGIN + '; prompt(s) sent ' + String((transcript.session?.prompts ?? []).length) + '; note appended ' + String(transcript.append?.ok === true) + '; ' + sessionPhrase + ']')
  if (stopped.length > 0) {
    for (const note of stopped) console.log('SKIP: ' + note)
    console.log('notes-live: NOT MEASURED in the world, so nothing above is a verdict on the product [exit 3]')
    return 3
  }
  if (failed.length > 0) return 1
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
    return 3
  }
  return 0
}

process.exitCode = await main()
