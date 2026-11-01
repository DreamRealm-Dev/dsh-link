#!/usr/bin/env node
/**
 * Gate 117 (R185) - tool-groups-live: ONE DECLARATION, JUDGED IN THE REAL CLIENT.
 *
 * Subject: the tool surface of a LIVE session in the running desktop client, moved by one
 * tool_groups_declare call the MODEL really makes. The shipped plugin (plugins/dsh-link-groups/lib
 * /index.js, the build the live profile is actually linked to) owns the mechanism; this gate owns the
 * question the mechanism has to answer outside its own world:
 *
 *   ONE DECLARATION => EXACTLY ONE request/header with reason 'change' + EXACTLY ONE developer/message,
 *   and the NEXT step's tool face is the previous face PLUS exactly the group's members - name for name.
 *
 * The route is the live one and it is the only one there is: CDP (9222) -> the shell page -> a
 * SAME-ORIGIN fetch('/api/session/create' | '/api/session/prompt' | '/api/session/page') with the
 * shell's own {type:'client-request', rpcId, method, payload:{args}} envelope. No UI is clicked, no
 * text is typed, no token is injected, no setting is changed, no client is started or stopped.
 *
 * ONE MESSAGE. This gate creates exactly ONE session and sends exactly ONE prompt; that model round is
 * the whole cost of the run. The declaration is the subject, so the message asks the model for the two
 * calls the plugin publishes (read the directory, then declare the id it read) and nothing else.
 *
 * WHAT THIS GATE READS (and what it refuses to read)
 *   - every fact is read out of the session's OWN event log (session/page): request/header (reason,
 *     names, and the serialized tool array), developer/message (tool-addition rows), tool/call,
 *     tool/result, approval/*, turn/end. Nothing is read from a printout of the plugin's, and the
 *     three cost numbers are checked AGAINST that header - entry count and byte count are the gate's own
 *     arithmetic over the header's own tools array, not a transcription of the result text.
 *   - the group table is read from the bundle layer the live profile is linked to (the profile's own
 *     package.json says which directory, that directory's package.json says which patch file). If a live
 *     patch layer names link-groups at all, this gate declines by name: it judges one table, and it will
 *     not guess which layer won.
 *   - the directory row (tool_groups' own answer) is compared with that table: id, membership, state,
 *     auto.when, and openability. A live world whose table and whose directory disagree is RED here.
 *
 * WHAT THIS GATE DOES NOT DO (the contract's live discipline)
 *   no pixels, no geometry, no approval driving, no PTC, no cross-agent propagation, no resume, and no
 *   judgement at all about whether the model "understood" the directory text: judgement is the execution
 *   record (the header, the developer message, the tool calls and their results).
 *
 * SINGLE RUN. This gate refuses (exit 3, by name) to run while another live consumer is running (a
 * verify-/probe- file from scripts/verify-all.mjs's live register) and is not part of any segmented
 * suite run: it spends a model round.
 *
 * NINE READINGS, each able to fail on its own evidence:
 *
 *   0-the-model-was-asked-once-and-did-what-the-message-named
 *                                            The model-compliance reading, and the one place a model
 *                                            that did not drive the gate is NAMED as not measured
 *                                            (exit 3) instead of being read as a product failure:
 *                                            no directory call, no declare call, more than one declare
 *                                            call, an empty open list, or an id the live table does not
 *                                            declare.
 *   1-one-message-and-the-very-same-world-throughout
 *                                            This gate's own discipline, as facts: one prompt, one new
 *                                            session, no other live consumer, the same client and the
 *                                            same kernel process from entry to exit, and the shipped
 *                                            module, its bundle patch and the live patch layers
 *                                            byte-identical before and after the round.
 *   2-the-live-directory-names-the-group-the-mounted-table-declares
 *                                            The directory the MODEL read (tool_groups' answer) carries
 *                                            exactly one row, and that row is the table's group: id,
 *                                            member names, state, auto.when, closed, openable, no
 *                                            blocked reason.
 *   3-the-declaring-step-could-not-see-the-new-tools
 *                                            The hard 'effective: next-step' criterion. The header in
 *                                            force at the declaring step (the last one written before
 *                                            the declare call) carries NONE of the members, no
 *                                            reason:change header exists before that call, and that
 *                                            face is the entry face name for name. A brand new session
 *                                            whose face is ALREADY open is a named third state here.
 *   4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message
 *                                            After the declare call: exactly one reason:change header,
 *                                            exactly one developer/message, the message's headerSeq is
 *                                            that header's seq, it belongs to that header's own
 *                                            (turn, step), and its tool-addition rows are exactly the
 *                                            group's members - no row missing, no row extra.
 *   5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members
 *                                            The change header's names against the entry face: added ==
 *                                            the members (name for name), removed == [], and the face
 *                                            with the members taken out is the entry face unchanged, in
 *                                            order.
 *   6-the-cost-trio-is-that-header-and-that-result
 *                                            entries / bytes / startsSeries, read from the applied row
 *                                            of the declaration AND checked against the change header:
 *                                            entries == that header's tool count == the face before plus
 *                                            the members; bytes == the gate's own
 *                                            Buffer.byteLength(JSON.stringify(that header's tools)):
 *                                            startsSeries == that header's own marker; and the reported
 *                                            effective point is 'next-step'.
 *   7-the-declaration-was-applied-and-nobody-was-asked
 *                                            The declaration answered exactly one applied row for the
 *                                            table's group, opened, with no refusal and nothing pending
 *                                            an approval; no approval/asked event exists in the round;
 *                                            and the turn ended as completed. A refusal by name is a
 *                                            named third state, not a product verdict.
 *   8-the-world-fingerprint-left-behind
 *                                            sessions before vs after: every pre-existing session has
 *                                            the same asOfSeq (this gate touched no other session), the
 *                                            only new session is this gate's own, and that session is
 *                                            LEFT OPEN as the evidence (its last header still carries
 *                                            the members).
 *
 * Self-attack: --self-attack (or --replay <transcript.json>) mutates THE TRANSCRIPT THIS RUN MEASURED,
 * one mutation per mutant, and prints the Chinese sentence declaration == observation for every mutant
 * plus the COVERAGE MATRIX. A mutant is a rewrite of one fact in the measured record; a mutant is
 * precise when the readings that redden are exactly the ones it declared. The baseline must be fully
 * green AND fully measured before the attack starts.
 *
 *   --replay <file>   attack a transcript written by an earlier run (ZERO prompts, the world is not
 *                     touched; this is how the judged record is re-read without paying for a round).
 *
 * Exit 0 all readings held | 1 a reading failed, or a mutant did not land where it declared | 3 this
 * gate could not measure here: no CDP page on the shell port, no shell answering, another live consumer
 * running, the live profile does not mount the plugin or declares no group this gate can open, the live
 * patch layers override the group table, the model did not drive the two calls the message named, the
 * declaration was refused by name, or the turn never reached its end. A reading that cannot be measured
 * is a named third state, never green.
 *
 * Usage: node scripts/verify-tool-groups-live.mjs [--port 31761] [--cdp 9222] [--plugin <dir>]
 *          [--profile <dir>] [--dump <file>] [--self-attack] [--replay <file>]
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The project root, found by walking up from this file: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'plugins', 'dsh-link-groups')) && existsSync(join(at, 'scripts', 'verify-all.mjs'))) return at
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
const PLUGIN_DIR = resolve(option('--plugin', join(PROJECT, 'plugins', 'dsh-link-groups')))
const PROFILE_OPTION = option('--profile', null)
const DUMP_OPTION = option('--dump', null)
const DEADLINE_MS = Number(option('--deadline-ms', '240000'))
const POLL_MS = Number(option('--poll-ms', '3000'))
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)

/** The bundle this gate drives, and the two tool names it publishes (the plugin's own names). */
const BUNDLE = 'dsh-link-groups'
const DIRECTORY_TOOL = 'tool_groups'
const DECLARE_TOOL = 'tool_groups_declare'
/** The only effective point the plugin is allowed to report (R185-A section 1). */
const EFFECTIVE = 'next-step'
/** The one message this gate sends. It names no group id: the model has to read the directory. */
const MESSAGE = [
  '\u8fd9\u662f\u4e00\u6b21\u5de5\u5177\u9762\u81ea\u68c0\uff0c\u8bf7\u4e25\u683c\u6309\u4e0b\u9762\u4e24\u6b65\u505a\uff0c\u4e0d\u8981\u505a\u522b\u7684\u4e8b\uff1a',
  '\u7b2c\u4e00\u6b65\uff1a\u8c03\u7528\u4e00\u6b21 tool_groups\uff08\u5b83\u4e0d\u5e26\u53c2\u6570\uff09\uff0c\u628a\u7ed3\u679c\u539f\u6837\u8bfb\u51fa\u6765\uff0c\u770b\u6e05\u695a\u76ee\u5f55\u91cc\u90a3\u4e2a\u7ec4\u7684\u786e\u5207 id\u3002',
  '\u7b2c\u4e8c\u6b65\uff1a\u7d27\u63a5\u7740\u8c03\u7528\u4e00\u6b21 tool_groups_declare\uff0c\u53c2\u6570 open: [<\u7b2c\u4e00\u6b65\u8bfb\u5230\u7684\u90a3\u4e2a\u7ec4\u7684 id>]\uff0c\u628a\u90a3\u4e2a\u7ec4\u6253\u5f00\u3002',
  '\u4e24\u6b65\u90fd\u505a\u5b8c\u4ee5\u540e\uff0c\u518d\u7528\u4e00\u53e5\u8bdd\u8bf4\u660e\u5de5\u5177\u9762\u6709\u6ca1\u6709\u771f\u7684\u53d8\u5316\u3002',
].join('\n')

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

/** One file the judgement leans on: its size and its hash, so "unchanged" is a measurement, not a hope. */
const fileFacts = (path) => {
  try {
    const bytes = readFileSync(path)
    return { ok: true, path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mtimeMs: statSync(path).mtimeMs }
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

/**
 * The bundle layer's group table, parsed out of the patch file the plugin's own package.json names.
 * The parse is indentation-driven because that is what YAML is here: 'groups:' opens the list, each
 * '- id: x' opens a group, a 'tools:' line swallows the '- name' items that follow it, and the scalar
 * keys are read by name. Comment lines are skipped: the patch file explains itself at length.
 */
const parseGroupTable = (text) => {
  const lines = String(text ?? '').split(/\r?\n/)
  const at = lines.findIndex((line) => /^\s*groups:\s*$/.test(line))
  if (at === -1) return { ok: false, why: 'the bundle patch has no groups: block' }
  const base = (lines[at].match(/^\s*/) ?? [''])[0].length
  const groups = []
  let current = null
  let mode = null
  for (let index = at + 1; index < lines.length; index += 1) {
    const raw = lines[index]
    if (/^\s*$/.test(raw) === true || /^\s*#/.test(raw) === true) continue
    const indent = (raw.match(/^\s*/) ?? [''])[0].length
    const body = raw.trim()
    if (indent <= base) break
    const id = body.match(/^-\s*id:\s*(\S+)\s*$/)
    if (id !== null) {
      current = { id: id[1], title: null, summary: null, tools: [], state: null, autoWhen: null, provider: null, relockable: false }
      groups.push(current)
      mode = null
      continue
    }
    if (current === null) continue
    if (/^tools:\s*$/.test(body) === true) {
      mode = 'tools'
      continue
    }
    const item = body.match(/^-\s*(\S+)\s*$/)
    if (mode === 'tools' && item !== null) {
      current.tools.push(item[1])
      continue
    }
    const previous = mode
    mode = null
    const key = body.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (key === null) continue
    const value = key[2].replace(/^['"]|['"]$/g, '')
    if (key[1] === 'state') current.state = value
    else if (key[1] === 'provider') current.provider = value
    else if (key[1] === 'relockable') current.relockable = value === 'true'
    else if (key[1] === 'title') current.title = value
    else if (key[1] === 'summary') current.summary = value
    else if (key[1] === 'auto') mode = 'auto'
    else if (key[1] === 'when' && previous === 'auto') current.autoWhen = value
  }
  if (groups.length === 0) return { ok: false, why: 'the groups: block of the bundle patch declares no group' }
  return { ok: true, groups }
}

/** The directory text tool_groups answers with, split into rows (the renderRow shape, one line each). */
const parseDirectory = (text) => {
  const body = String(text ?? '')
  const rows = []
  for (const line of body.split(/\r?\n/)) {
    const head = line.match(/^- (\S+) \u00b7 (OPEN|closed) \u00b7 state=([A-Za-z]+)(?: \u00b7 auto=([A-Za-z]+))? \u00b7 tools\((\d+)\): (.*)$/)
    if (head === null) continue
    const segments = head[6].split(' \u00b7 ')
    const names = segments[0] === '(none)' ? [] : segments[0].split(',').map((name) => name.trim()).filter((name) => name !== '')
    const tail = segments.slice(1)
    rows.push({
      id: head[1],
      word: head[2],
      state: head[3],
      auto: head[4] ?? null,
      declared: Number(head[5]),
      tools: names,
      provider: (tail.find((part) => part.startsWith('provider=')) ?? '').slice('provider='.length) || null,
      openable: tail.includes('openable now'),
      blocked: tail.find((part) => part.startsWith('blocked: ')) ?? null,
      needsApproval: tail.includes('USER-DISABLED: opening needs approval'),
      line,
    })
  }
  const total = body.match(/^Groups \((\d+) total, (\d+) open\):$/m)
  return { rows, total: total === null ? null : Number(total[1]), open: total === null ? null : Number(total[2]), text: body }
}

/** The declaration answer tool_groups_declare writes: applied / refused / pending rows, verbatim. */
const parseDeclaration = (text) => {
  const applied = []
  const refused = []
  const pending = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const opened = line.match(/^- (opened|closed) (\S+) \(effective: ([^)]+)\) \u00b7 surface now (\d+) tools \/ (\d+) bytes \u00b7 next request\/header\.startsSeries=(true|false)$/)
    if (opened !== null) {
      applied.push({ direction: opened[1], id: opened[2], effective: opened[3], entries: Number(opened[4]), bytes: Number(opened[5]), startsSeries: opened[6] === 'true', line })
      continue
    }
    const denied = line.match(/^- refused (\S+) \[([A-Z_]+)\] (.*)$/)
    if (denied !== null) {
      refused.push({ id: denied[1], code: denied[2], reason: denied[3], line })
      continue
    }
    const waiting = line.match(/^- not applied (\S+): (.*)$/)
    if (waiting !== null) pending.push({ id: waiting[1], reason: waiting[2], line })
  }
  const known = /^Known group ids \(configuration order\): (.*)$/m.exec(String(text ?? ''))
  return { applied, refused, pending, known: known === null ? [] : known[1].split(',').map((id) => id.trim()).filter((id) => id !== ''), text: String(text ?? '') }
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

/** The CDP page on the shell port, plus the two calls this gate makes through it. */
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
  /** One call in the page's own origin, with the shell's own request envelope. */
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

const pwsh = (command, timeoutMs = 40000) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })

/** The identity of the desktop client: pid@start-time. A restart of this is a third state, not a red. */
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
  const query = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + [string]$_.CommandLine }'
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

/** The live kernel: the node process that runs the CLI with --patch layers (its own words, not a guess). */
const kernelIdentity = (rows) => {
  const found = rows.filter((row) => row.command.includes('bin.ts') && row.command.includes('--patch'))
  if (found.length === 0) return null
  const row = found[0]
  const patches = [...row.command.matchAll(/--patch\s+("([^"]+)"|(\S+))/g)].map((match) => match[2] ?? match[3])
  const port = /--port\s+(\d+)/.exec(row.command)
  return { pid: row.pid, command: clip(row.command, 300), patches, port: port === null ? null : Number(port[1]) }
}

/** Another live consumer, by the register's own list of live files and the processes running them. */
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
  const SELF = 'verify-tool-groups-live.mjs'
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

/**
 * Which table is live: the profile's own package.json says whether this bundle is mounted and where it
 * is linked, that directory's package.json says which patch file is its bundle layer, and THAT file is
 * the table. Any live patch layer that names the bundle at all makes this gate decline by name: it
 * judges one table and will not guess which layer won.
 */
const resolveSubject = (kernel, appdata) => {
  let kernelHome = null
  let profileDir = PROFILE_OPTION === null ? null : resolve(PROFILE_OPTION)
  if (profileDir === null) {
    const patchHome = kernel !== null && kernel.patches.length > 0 ? dirname(resolve(kernel.patches[0])) : null
    if (patchHome !== null && existsSync(join(patchHome, 'profiles', 'web'))) kernelHome = patchHome
    else if (appdata !== null) {
      const guess = join(appdata, 'dev.dshlink.client', 'dsh-link', 'kernel-home')
      if (existsSync(join(guess, 'profiles', 'web'))) kernelHome = guess
    }
    if (kernelHome === null) return { ok: false, why: 'the live kernel home could not be located (no --patch layer was read and %APPDATA%/dev.dshlink.client/dsh-link/kernel-home is not there), so this gate cannot read the table the live profile is running' }
    profileDir = join(kernelHome, 'profiles', 'web')
  }
  const profilePkgPath = join(profileDir, 'package.json')
  const profilePkg = readJson(profilePkgPath)
  if (profilePkg.ok !== true) return { ok: false, why: 'the live profile has no readable package.json at ' + profilePkgPath + ' (' + profilePkg.why + ')' }
  const bundles = Array.isArray(profilePkg.value?.dsh?.profile?.bundles) ? profilePkg.value.dsh.profile.bundles.map(String) : []
  if (bundles.includes(BUNDLE) !== true) return { ok: false, why: 'the live profile does not mount ' + BUNDLE + ' (bundles: ' + show(bundles) + '), so there is no live group table to judge' }
  const link = String(profilePkg.value?.dependencies?.[BUNDLE] ?? '')
  const pluginDir = link.startsWith('link:') ? resolve(link.slice('link:'.length)) : PLUGIN_DIR
  if (existsSync(join(pluginDir, 'package.json')) !== true) return { ok: false, why: 'the live profile mounts ' + BUNDLE + ' as ' + show(link) + ' but ' + pluginDir + ' holds no package.json' }
  const pluginPkg = readJson(join(pluginDir, 'package.json'))
  if (pluginPkg.ok !== true) return { ok: false, why: 'the mounted package has no readable package.json (' + pluginPkg.why + ')' }
  const main = typeof pluginPkg.value?.main === 'string' ? pluginPkg.value.main : 'lib/index.js'
  const patchName = typeof pluginPkg.value?.dsh?.bundle?.patch === 'string' ? pluginPkg.value.dsh.bundle.patch : 'cordis.patch.yml'
  const modulePath = resolve(pluginDir, main)
  const configPath = resolve(pluginDir, patchName)
  const module = fileFacts(modulePath)
  const config = fileFacts(configPath)
  if (module.ok !== true) return { ok: false, why: 'the shipped module the profile mounts is not readable at ' + modulePath + ' (' + module.why + ')' }
  const configText = readText(configPath)
  if (configText.ok !== true) return { ok: false, why: 'the bundle layer ' + configPath + ' is not readable (' + configText.why + ')' }
  // The layers the live kernel itself was started with, plus the profile's own patch file.
  const layers = []
  for (const path of [...(kernel === null ? [] : kernel.patches), join(profileDir, 'cordis.patch.yml')]) {
    const absolute = resolve(path)
    if (existsSync(absolute) !== true) continue
    const text = readText(absolute)
    if (text.ok !== true) continue
    const mentions = text.text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), number: index + 1 })).filter((row) => row.line.includes(BUNDLE) && row.line.startsWith('#') === false)
    layers.push({ path: absolute, file: fileFacts(absolute), mentions })
  }
  const overrides = layers.filter((layer) => layer.mentions.length > 0)
  if (overrides.length > 0) {
    return { ok: false, why: 'a live patch layer names ' + BUNDLE + ' (' + overrides.map((layer) => layer.path + ':' + layer.mentions.map((row) => row.number).join(',')).join('; ') + '), so the table this gate reads may not be the one the live kernel mounted; this gate will not guess which layer won' }
  }
  const table = parseGroupTable(configText.text)
  if (table.ok !== true) return { ok: false, why: 'the bundle layer ' + configPath + ' (' + config.bytes + ' bytes) ' + table.why }
  const openable = table.groups.filter((group) => group.state === 'auto' && group.autoWhen === 'declare' && group.tools.length > 0)
  if (openable.length === 0) {
    return { ok: false, why: 'the live table declares no group a single declaration opens (from ' + configPath + ': ' + show(table.groups.map((group) => ({ id: group.id, state: group.state, auto: group.autoWhen, tools: group.tools.length }))) + ')' }
  }
  return {
    ok: true,
    profileDir,
    profilePkgPath,
    profilePkg: fileFacts(profilePkgPath),
    mounted: link,
    pluginDir,
    modulePath,
    module,
    configPath,
    config,
    table,
    openable: openable.map((group) => group.id),
    layers,
    kernelHome,
  }
}

/** One normalized session row: what moved since the last read is asOfSeq, and that is the check. */
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

// ---------------------------------------------------------------------------
// The measured world: create one session, send one message, read the log
// ---------------------------------------------------------------------------

const runWorld = async (bag) => {
  const transcript = {
    schema: 'r185-g117-transcript/1',
    startedAt: new Date().toISOString(),
    port: PORT,
    cdpPort: CDP_PORT,
    shellOrigin: SHELL_ORIGIN,
    message: MESSAGE,
    entry: { at: new Date().toISOString(), client: null, kernel: null, sessions: null, liveGateFiles: [], otherConsumers: [], appdata: null },
    exit: { at: null, client: null, kernel: null, sessions: null, subject: null },
    guard: null,
    subject: null,
    session: { sessionId: null, created: false, requestId: null, accepted: null, promptCount: 0, promptSentAt: null, turnEnded: false, polls: 0 },
    page: null,
    notes: [],
    problems: [],
  }
  bag.transcript = transcript

  // --- the instrument: the live page ---------------------------------------------------------------
  const cdp = await openCdpPage()
  if (cdp.ok !== true) throw new NotMeasured(cdp.why)
  transcript.page_url = cdp.url
  const appdataDone = pwsh('[string]$env:APPDATA', 20000)
  const appdata = appdataDone.status === 0 && String(appdataDone.stdout ?? '').trim() !== '' ? String(appdataDone.stdout).trim() : null
  transcript.entry.appdata = appdata

  try {
    // --- the guard: alone, with a client and a kernel that can be named -----------------------------
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
    if (transcript.entry.kernel === null) throw new NotMeasured('no live kernel process could be named (a node process running the CLI with --patch layers), so the world this gate would drive cannot be identified')

    // --- the subject: the table the live profile is linked to ---------------------------------------
    const subject = resolveSubject(transcript.entry.kernel, appdata)
    if (subject.ok !== true) throw new NotMeasured(subject.why)
    transcript.subject = subject

    // --- the world before anything ----------------------------------------------------------------
    const sessionsBefore = await readSessions(cdp, 'g117-list-before')
    transcript.entry.sessions = sessionsBefore
    if (sessionsBefore.rows.some((row) => row.sessionId === '') === true) throw new NotMeasured('session/list answered with a row this gate cannot name, so the world fingerprint would be a guess')

    // --- ONE session and ONE message --------------------------------------------------------------
    const created = await cdp.call('session/create', { request: {} }, 'g117-create')
    const sessionId = String(created.value?.sessionId ?? '')
    if (sessionId === '') throw new NotMeasured('the shell created no session (session/create answered ' + show(created.value) + ')')
    transcript.session.sessionId = sessionId
    transcript.session.created = true
    const requestId = crypto.randomUUID()
    transcript.session.requestId = requestId
    const accepted = await cdp.call('session/prompt', { request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: MESSAGE }] } }, 'g117-prompt')
    transcript.session.promptCount += 1
    transcript.session.accepted = accepted.value?.accepted === true
    transcript.session.promptSentAt = new Date().toISOString()
    if (transcript.session.accepted !== true) throw new NotMeasured('the one prompt this gate sends was not accepted (' + show(accepted.value) + ')')

    // --- read-only from here: wait for the round to end, then keep the log -------------------------
    const until = Date.now() + DEADLINE_MS
    let page = null
    while (Date.now() < until) {
      transcript.session.polls += 1
      const list = await readSessions(cdp, 'g117-list-' + String(transcript.session.polls))
      const row = list.rows.find((one) => one.sessionId === sessionId) ?? null
      if (row !== null && row.asOfSeq > 0) {
        const read = await cdp.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: row.asOfSeq, maxMessages: 600 } }, 'g117-page-' + String(transcript.session.polls))
        page = read.value ?? null
        const types = (page?.records ?? []).map((record) => record?.event?.type)
        if (types.includes('turn/end') === true) {
          transcript.session.turnEnded = true
          break
        }
      }
      await sleep(POLL_MS)
    }
    transcript.page = page
    if (page === null) throw new NotMeasured('the session this gate created was readable for ' + String(transcript.session.polls) + ' poll(s) and never reached turn/end within ' + String(DEADLINE_MS) + ' ms')
    if (transcript.session.turnEnded !== true) transcript.notes.push('NOT MEASURED in the world: the round reached ' + String((page?.records ?? []).length) + ' event(s) but never logged turn/end within ' + String(DEADLINE_MS) + ' ms, so the record below is a round that had not finished')
  } catch (error) {
    if (error instanceof NotMeasured) transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    else transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error?.stack === undefined ? '' : '\n' + String(error.stack).split('\n').slice(0, 4).join('\n')))
  } finally {
    // --- the world after: the exit fingerprint -----------------------------------------------------
    try {
      transcript.exit.at = new Date().toISOString()
      transcript.exit.client = clientIdentity()
      const processes = nodeProcesses()
      transcript.exit.kernel = processes.ok === true ? kernelIdentity(processes.rows) : null
      transcript.exit.sessions = await readSessions(cdp, 'g117-list-after')
      transcript.exit.subject = {
        module: fileFacts(transcript.subject?.modulePath ?? join(PLUGIN_DIR, 'lib', 'index.js')),
        config: fileFacts(transcript.subject?.configPath ?? join(PLUGIN_DIR, 'cordis.patch.yml')),
        profilePkg: fileFacts(transcript.subject?.profilePkgPath ?? ''),
        layers: (transcript.subject?.layers ?? []).map((layer) => ({ path: layer.path, file: fileFacts(layer.path) })),
      }
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
    // The dump is the evidence: the judged record is written out whether the round was green or not.
    try {
      const dir = DUMP_OPTION === null ? join(tmpdir(), 'r185-p117') : dirname(resolve(DUMP_OPTION))
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

/**
 * Everything the readings below are allowed to look at, folded out of the measured record once.
 * The mutant attack rewrites the transcript and re-folds; nothing here caches across calls.
 */
const buildFacts = (transcript) => {
  const records = Array.isArray(transcript?.page?.records) ? transcript.page.records : []
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
    .map((event) => {
      const message = event.data?.message === null || typeof event.data?.message !== 'object' ? {} : event.data.message
      const content = Array.isArray(message.content) ? message.content : []
      return {
        seq: Number(event.seq ?? -1),
        turn: Number(event.data?.turn ?? -1),
        step: Number(event.data?.step ?? -1),
        callId: String(message.toolCallId ?? ''),
        isError: message.isError === true,
        text: content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '[' + String(part?.type) + ']')).join('\n'),
      }
    })
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
  const approvals = {
    asked: events.filter((event) => event.type === 'approval/asked').length,
    decided: events.filter((event) => event.type === 'approval/decided').length,
  }
  const turnEnds = events.filter((event) => event.type === 'turn/end')
  const lastTurnEnd = turnEnds[turnEnds.length - 1] ?? null
  const turnEnd = lastTurnEnd === null ? null : { seq: Number(lastTurnEnd.seq ?? -1), count: turnEnds.length, turn: Number(lastTurnEnd.data?.turn ?? -1), kind: String(lastTurnEnd.data?.reason?.kind ?? '') }
  const policyOf = (type, key) => {
    const event = events.find((one) => one.type === type)
    return event === null || event === undefined ? null : String(event.data?.[key] ?? '') || null
  }
  const policy = { preset: policyOf('permission/preset', 'preset'), sandbox: policyOf('sandbox/mode', 'mode'), approval: policyOf('approval/policy', 'policy') }

  const directoryCalls = calls.filter((call) => call.name === DIRECTORY_TOOL)
  const declareCalls = calls.filter((call) => call.name === DECLARE_TOOL)
  const resultFor = (call) => {
    if (call === null || call === undefined) return null
    const byId = call.callId === '' ? null : results.find((result) => result.callId !== '' && result.callId === call.callId) ?? null
    if (byId !== null) return byId
    return results.filter((result) => result.seq > call.seq).sort((left, right) => left.seq - right.seq)[0] ?? null
  }
  const directoryResult = resultFor(directoryCalls[0] ?? null)
  const declareResults = declareCalls.map((call) => resultFor(call))
  const declareCall = declareCalls[0] ?? null
  const declareResult = declareResults[0] ?? null
  const entryFace = headers[0] ?? null
  const faceAt = (seq) => {
    let at = null
    for (const header of headers) {
      if (header.seq < seq) at = header
      else break
    }
    return at
  }
  const faceBeforeDeclare = declareCall === null ? null : faceAt(declareCall.seq)
  const changeHeaders = headers.filter((header) => header.reason === 'change')
  const changesBeforeDeclare = declareCall === null ? [] : changeHeaders.filter((header) => header.seq < declareCall.seq)
  const changesAfterDeclare = declareCall === null ? [] : changeHeaders.filter((header) => header.seq > declareCall.seq)
  const firstChangeAfterDeclare = changesAfterDeclare[0] ?? null
  const lastHeader = headers.length === 0 ? null : headers[headers.length - 1]
  const directory = directoryResult === null ? null : parseDirectory(directoryResult.text)
  const declaration = declareResult === null ? null : parseDeclaration(declareResult.text)
  const configGroups = Array.isArray(transcript?.subject?.table?.groups) ? transcript.subject.table.groups : []

  const declaredId = declaration !== null && declaration.applied.length > 0 ? declaration.applied[0].id : null
  let group = null
  let groupWhy = null
  if (declaredId !== null) {
    group = configGroups.find((one) => one.id === declaredId) ?? null
    if (group === null) groupWhy = 'the declaration opened ' + show(declaredId) + ' while the live table (' + String(transcript?.subject?.configPath ?? '(unread)') + ') declares ' + show(configGroups.map((one) => one.id))
  } else if (configGroups.length === 1) {
    group = configGroups[0]
    groupWhy = null
  } else if (configGroups.length === 0) {
    groupWhy = 'the live table declares no group at all'
  } else {
    groupWhy = 'the live table declares ' + show(configGroups.map((one) => one.id)) + ' and this round opened none of them, so there is no slide to attribute to a group'
  }
  const members = group === null ? [] : group.tools

  const worldStopped = (transcript?.notes ?? []).some((note) => String(note).startsWith('NOT MEASURED in the world'))
  return {
    transcript,
    worldStopped,
    events,
    headers,
    calls,
    results,
    developers,
    approvals,
    turnEnd,
    policy,
    stepOf,
    directoryCalls,
    declareCalls,
    declareResults,
    directoryResult,
    declareCall,
    declareResult,
    entryFace,
    faceBeforeDeclare,
    changeHeaders,
    changesBeforeDeclare,
    changesAfterDeclare,
    firstChangeAfterDeclare,
    lastHeader,
    directory,
    declaration,
    configGroups,
    group,
    groupWhy,
    members,
    sessionId: transcript?.session?.sessionId ?? null,
  }
}

const READINGS = [
  {
    id: '0-the-model-was-asked-once-and-did-what-the-message-named',
    judge: (f) => {
      const missing = []
      if (f.directoryCalls.length === 0) missing.push('it never called ' + DIRECTORY_TOOL)
      if (f.declareCalls.length === 0) missing.push('it never called ' + DECLARE_TOOL)
      if (missing.length > 0) {
        return NOT_MEASURED(missing.join(' and ') + ': the one message names both calls, and a round the model did not drive is not a product verdict (it is this gate that did not measure)')
      }
      if (f.declareCalls.length > 1) {
        return NOT_MEASURED('the model declared ' + String(f.declareCalls.length) + ' times in one round (' + show(f.declareCalls.map((call) => call.seq)) + '); one message names one declaration, and this gate does not read a model that ran twice as one slide')
      }
      let args = null
      try {
        args = JSON.parse(f.declareCall.arguments)
      } catch {
        args = null
      }
      if (args === null || typeof args !== 'object') return NOT_MEASURED('the declaration call carried arguments this gate cannot read as JSON: ' + show(clip(f.declareCall.arguments, 160)))
      const open = Array.isArray(args.open) ? args.open.map(String) : []
      if (open.length === 0) return NOT_MEASURED('the declaration named no group (open: ' + show(args.open) + '), so nothing was asked to open')
      const known = f.configGroups.map((one) => one.id)
      if (known.length > 0 && open.some((id) => known.includes(id) === false)) {
        return NOT_MEASURED('the model declared ' + show(open) + ' while the live table declares ' + show(known) + ': that is an id guessed rather than the id read from the directory the message names')
      }
      const order = f.directoryCalls[0].seq < f.declareCall.seq ? 'directory first, then the declaration' : 'the declaration came before the directory read'
      return OK('the model called ' + DIRECTORY_TOOL + '() at seq ' + String(f.directoryCalls[0].seq) + ' and ' + DECLARE_TOOL + '(' + show(args) + ') at seq ' + String(f.declareCall.seq) + ' in one message (' + order + '); exactly one declaration in the round')
    },
  },
  {
    id: '1-one-message-and-the-very-same-world-throughout',
    judge: (f) => {
      const t = f.transcript
      const problems = []
      const lines = []
      if (f.worldStopped === true && t.session.created !== true) {
        return NOT_MEASURED('the drive declined before it created a session, so there is no run of this gate\'s own to judge (this gate sent ' + String(t.session.promptCount) + ' prompt(s)): ' + String((t.notes ?? []).find((note) => String(note).startsWith('NOT MEASURED in the world'))))
      }
      if (t.session.promptCount !== 1) problems.push('this gate sent ' + String(t.session.promptCount) + ' prompt(s); the contract allows one')
      else lines.push('one session/prompt accepted (requestId ' + String(t.session.requestId) + ')')
      if (t.session.created !== true || f.sessionId === null) problems.push('no session of this gate\'s own was created')
      else lines.push('one session created: ' + String(f.sessionId))
      if ((t.entry.otherConsumers ?? []).length !== 0) problems.push('another live consumer was running: ' + show(t.entry.otherConsumers))
      else lines.push('no other live consumer: the register lists ' + String((t.entry.liveGateFiles ?? []).length) + ' live file(s) and ' + String(t.guard?.nodeProcesses ?? 0) + ' node process(es) were read, none of them one of those files')
      if (t.entry.client === null) problems.push('the client process could not be named at entry')
      else if (t.entry.client !== t.exit.client) problems.push('the client was replaced during the run: ' + String(t.entry.client) + ' -> ' + String(t.exit.client))
      else lines.push('the client is the same process from entry to exit: ' + String(t.entry.client))
      if (t.entry.kernel === null) problems.push('the live kernel could not be named at entry')
      else if (t.exit.kernel === null || t.exit.kernel.pid !== t.entry.kernel.pid) problems.push('the kernel was replaced during the run: ' + show(t.entry.kernel.pid) + ' -> ' + show(t.exit.kernel?.pid))
      else lines.push('the kernel is the same process from entry to exit: pid ' + String(t.entry.kernel.pid))
      const pairs = [
        { what: 'the shipped module', entry: t.subject?.module, exit: t.exit.subject?.module },
        { what: 'the bundle patch (the table)', entry: t.subject?.config, exit: t.exit.subject?.config },
        { what: 'the live profile package.json', entry: t.subject?.profilePkg, exit: t.exit.subject?.profilePkg },
      ]
      for (const layer of t.subject?.layers ?? []) {
        const after = (t.exit.subject?.layers ?? []).find((one) => one.path === layer.path) ?? null
        pairs.push({ what: 'the live layer ' + layer.path, entry: layer.file, exit: after?.file ?? null })
      }
      for (const pair of pairs) {
        if (pair.entry?.ok !== true) {
          problems.push(pair.what + ' could not be read at entry')
          continue
        }
        if (pair.exit?.ok !== true) {
          problems.push(pair.what + ' could not be read at exit')
          continue
        }
        if (pair.entry.sha256 !== pair.exit.sha256) problems.push(pair.what + ' changed during the run: sha256 ' + clip(pair.entry.sha256, 12) + ' -> ' + clip(pair.exit.sha256, 12))
        else lines.push(pair.what + ' is byte-identical before and after (sha256 ' + clip(pair.entry.sha256, 12) + ', ' + String(pair.entry.bytes) + ' bytes)')
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join('; '))
    },
  },
  {
    id: '2-the-live-directory-names-the-group-the-mounted-table-declares',
    judge: (f) => {
      if (f.directory === null) return NOT_MEASURED('the model never called ' + DIRECTORY_TOOL + ', so the live directory row was never read in this round')
      if (f.group === null) return NOT_MEASURED(String(f.groupWhy))
      const rows = f.directory.rows
      const group = f.group
      const problems = []
      // R215: this reading demanded EXACTLY ONE directory row, which was true only while the live table
      // declared one group. The round that added the notes group made a directory that lists both groups -
      // correctly - read as a failure. The subject was never 'one group exists': it is 'every row the
      // directory shows is the row the mounted table declares, and the group this round opened is among
      // them'. Compared row by row now, which is strictly more than the old single-row check asked.
      const byId = new Map(rows.map((row) => [row.id, row]))
      const declaredIds = f.configGroups.map((one) => one.id)
      const missing = declaredIds.filter((id) => byId.has(id) === false)
      const extra = rows.map((row) => row.id).filter((id) => declaredIds.includes(id) === false)
      if (missing.length > 0) problems.push('the directory does not list ' + show(missing) + ' of the ' + String(declaredIds.length) + ' group(s) the mounted table declares (' + show(declaredIds) + ')')
      if (extra.length > 0) problems.push('the directory lists ' + show(extra) + ', which the mounted table does not declare')
      if (byId.has(group.id) !== true) problems.push('the directory does not carry the group this round opened: ' + show(group.id))
      for (const declared of f.configGroups) {
        const seen = byId.get(declared.id)
        if (seen === undefined) continue
        if (sameSet(seen.tools, declared.tools) !== true) problems.push('the row for ' + show(declared.id) + ' lists ' + show(seen.tools) + ' and the table declares ' + show(declared.tools))
        if (seen.declared !== declared.tools.length) problems.push('the row for ' + show(declared.id) + ' says tools(' + String(seen.declared) + ') and lists ' + String(seen.tools.length))
        if (seen.state !== declared.state) problems.push('the row for ' + show(declared.id) + ' reads state=' + show(seen.state) + ' and the table says ' + show(declared.state))
        if (seen.auto !== declared.autoWhen) problems.push('the row for ' + show(declared.id) + ' reads auto=' + show(seen.auto) + ' and the table says auto.when=' + show(declared.autoWhen))
        if (seen.word !== 'closed') problems.push('the row for ' + show(declared.id) + ' reads ' + show(seen.word) + ' before any declaration')
        if (seen.openable !== true) problems.push('the row for ' + show(declared.id) + ' is not marked openable (blocked: ' + show(seen.blocked) + ')')
      }
      if (f.directory.total !== f.configGroups.length) problems.push('the directory counts ' + show(f.directory.total) + ' group(s) and the table declares ' + String(f.configGroups.length))
      if (f.directory.open !== 0) problems.push('the directory already counts ' + show(f.directory.open) + ' open group(s) before the declaration')
      if (problems.length > 0) return BAD(problems.join('; '))
      const row = byId.get(group.id)
      return OK('the directory the model read lists every group the mounted table declares (' + show(declaredIds) + '), each row equal to its table row; the row this round opened reads: ' + row.line + ' -- the ' + String(row.tools.length)
        + ' member names ([' + row.tools.join(', ') + ']), state=' + String(row.state) + ', auto=' + String(row.auto) + ' all equal the table at ' + String(f.transcript.subject.configPath) + ' (' + String(f.transcript.subject.config.bytes)
        + ' bytes, sha256 ' + clip(f.transcript.subject.config.sha256, 12) + '), and the row is closed and openable before the declaration')
    },
  },
  {
    id: '3-the-declaring-step-could-not-see-the-new-tools',
    judge: (f) => {
      if (f.declareCall === null) return NOT_MEASURED('no ' + DECLARE_TOOL + ' call exists in this round, so there is no declaring step to read')
      if (f.entryFace === null) return NOT_MEASURED('the session logged no request/header at all, so the face a step saw cannot be read')
      const inEntry = f.members.filter((name) => f.entryFace.names.includes(name))
      if (inEntry.length > 0) {
        return NOT_MEASURED('the first request/header of this brand-new session (seq ' + String(f.entryFace.seq) + ') already carried ' + String(inEntry.length) + ' of the group\'s member(s) ' + show(inEntry) + ': the surface was open before this gate declared anything, so the slide this reading is about has already happened')
      }
      if (f.faceBeforeDeclare === null) return NOT_MEASURED('no request/header precedes the declare call at seq ' + String(f.declareCall.seq) + ', so the face that step ran on cannot be read')
      const problems = []
      if (f.changesBeforeDeclare.length > 0) problems.push('the session already held ' + String(f.changesBeforeDeclare.length) + ' reason:change header(s) before the declaration (seq ' + show(f.changesBeforeDeclare.map((header) => header.seq)) + '), so a slide happened before the one this gate reads')
      const visible = f.members.filter((name) => f.faceBeforeDeclare.names.includes(name))
      if (visible.length > 0) problems.push('the header in force at the declaring step (seq ' + String(f.faceBeforeDeclare.seq) + ') already carried ' + show(visible))
      if (same(f.faceBeforeDeclare.names, f.entryFace.names) !== true) problems.push('the face the declaring step ran on is not the entry face: seq ' + String(f.entryFace.seq) + ' held ' + String(f.entryFace.toolCount) + ' name(s) and seq ' + String(f.faceBeforeDeclare.seq) + ' holds ' + String(f.faceBeforeDeclare.toolCount))
      if (problems.length > 0) return BAD(problems.join('; '))
      const step = f.stepOf(f.declareCall.seq)
      return OK('the declaring step (turn ' + show(step?.turn) + ' step ' + show(step?.step) + ', call at seq ' + String(f.declareCall.seq) + ') ran on the header at seq ' + String(f.faceBeforeDeclare.seq) + ' with ' + String(f.faceBeforeDeclare.toolCount) + ' tool(s), which is the entry face name for name, and carried none of the group\'s ' + String(f.members.length) + ' member(s); the session held 0 reason:change header(s) before that call')
    },
  },
  {
    id: '4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message',
    judge: (f) => {
      if (f.declareCall === null) return NOT_MEASURED('no ' + DECLARE_TOOL + ' call exists in this round')
      const problems = []
      let orderNote = null
      if (f.changesAfterDeclare.length !== 1) problems.push('after the declaration at seq ' + String(f.declareCall.seq) + ' the session holds ' + String(f.changesAfterDeclare.length) + ' request/header(s) with reason:change (seq ' + show(f.changesAfterDeclare.map((header) => header.seq)) + ')')
      if (f.developers.length !== 1) problems.push('the session holds ' + String(f.developers.length) + ' developer/message(s)')
      if (problems.length === 0) {
        const header = f.changesAfterDeclare[0]
        const message = f.developers[0]
        if (message.headerSeq !== header.seq) problems.push('the developer/message points at headerSeq ' + show(message.headerSeq) + ' and the change header is seq ' + String(header.seq))
        const step = f.stepOf(header.seq)
        if (step !== null && (message.turn !== step.turn || message.step !== step.step)) problems.push('the developer/message is logged at turn ' + String(message.turn) + ' step ' + String(message.step) + ' and the change header belongs to turn ' + String(step.turn) + ' step ' + String(step.step))
        if (message.seq <= header.seq) problems.push('the developer/message (seq ' + String(message.seq) + ') does not follow the change header (seq ' + String(header.seq) + ')')
        if (sameSet(message.additions, f.members) !== true) problems.push('the tool-addition rows are ' + show(message.additions) + ' and the group the table declares is ' + show(f.members))
        // R215: the ORDER of the tool-addition rows is not a promise, and this reading treated it as one.
        // The mounted table lists members in config order; the developer/message is written by the pinned
        // kernel, which emits additions in the order of the tools array it is handed
        // (core/deepseek-harness/packages/core/agent-loop/src/agent.ts:638-639) - the kernel registry order,
        // which the plugin does not choose. docs/dev/tool-groups.md:109 quotes the row COUNT, not a sequence.
        // The verdict stays on the SET (the line above); the difference is carried into the evidence instead.
        orderNote = same(message.additions, f.members) !== true && sameSet(message.additions, f.members) === true
          ? "the addition rows arrive in kernel order " + show(message.additions) + " while the table lists " + show(f.members) + " - a difference in order only, not in membership"
          : null
        const others = message.blocks.filter((kind) => kind !== 'tool-addition')
        if (others.length > 0) problems.push('the developer/message carries non-addition blocks: ' + show(others))
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      const header = f.changesAfterDeclare[0]
      const message = f.developers[0]
      return OK('one declaration wrote exactly one reason:change header (seq ' + String(header.seq) + ', after the call at seq ' + String(f.declareCall.seq) + ') and exactly one developer/message (seq ' + String(message.seq) + ', turn ' + String(message.turn) + ' step ' + String(message.step) + ', headerSeq ' + String(message.headerSeq) + '), whose tool-addition rows are exactly the ' + String(message.additions.length) + ' member(s) the table declares: ' + show(message.additions) + (orderNote === null ? '' : '; ' + orderNote))
    },
  },
  {
    id: '5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members',
    judge: (f) => {
      if (f.declareCall === null) return NOT_MEASURED('no ' + DECLARE_TOOL + ' call exists in this round')
      if (f.faceBeforeDeclare === null) return NOT_MEASURED('no request/header precedes the declare call, so there is no old face to compare against')
      if (f.firstChangeAfterDeclare === null) return BAD('no reason:change header follows the declaration at seq ' + String(f.declareCall.seq) + ', so the next step read the old face: the face did not slide')
      const after = f.firstChangeAfterDeclare
      const before = f.faceBeforeDeclare
      const added = after.names.filter((name) => before.names.includes(name) === false)
      const removed = before.names.filter((name) => after.names.includes(name) === false)
      const kept = after.names.filter((name) => f.members.includes(name) === false)
      const problems = []
      if (sameSet(added, f.members) !== true) problems.push('the names the next step gained are ' + show(added) + ' and the group declares ' + show(f.members))
      if (removed.length !== 0) problems.push('the next step lost ' + show(removed))
      if (after.toolCount !== before.toolCount + f.members.length) problems.push('the face went from ' + String(before.toolCount) + ' to ' + String(after.toolCount) + ' name(s) while the group declares ' + String(f.members.length))
      if (same(kept, before.names) !== true) problems.push('the old names did not keep their places: with the members taken out the next face reads ' + String(kept.length) + ' name(s) against the ' + String(before.names.length) + ' of the old face')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the next step read header seq ' + String(after.seq) + ' with ' + String(after.toolCount) + ' name(s): the ' + String(before.toolCount) + ' names of the old face (seq ' + String(before.seq) + ') unchanged and in order, plus exactly the ' + String(f.members.length) + ' member(s) [' + added.join(', ') + ']; removed 0 name(s)')
    },
  },
  {
    id: '6-the-cost-trio-is-that-header-and-that-result',
    judge: (f) => {
      if (f.declaration === null) return NOT_MEASURED('the declaration produced no result text this gate can read the cost from')
      if (f.declaration.applied.length !== 1) return NOT_MEASURED('the declaration answered ' + String(f.declaration.applied.length) + ' applied row(s), so there is no single reported cost to check (refused: ' + show(f.declaration.refused.map((row) => row.id + ' [' + row.code + ']')) + ')')
      const row = f.declaration.applied[0]
      if (f.firstChangeAfterDeclare === null) return BAD('the declaration reported a surface (' + String(row.entries) + ' tools / ' + String(row.bytes) + ' bytes) while no reason:change header follows it, so there is no face to check those numbers against')
      if (f.faceBeforeDeclare === null) return NOT_MEASURED('no request/header precedes the declare call, so the entry count cannot be checked against a measured face')
      const header = f.firstChangeAfterDeclare
      const problems = []
      if (row.direction !== 'opened') problems.push('the applied row says ' + show(row.direction))
      if (row.effective !== EFFECTIVE) problems.push('the applied row reports effective=' + show(row.effective) + ' and the plugin only ever reports ' + show(EFFECTIVE))
      if (row.entries !== header.toolCount) problems.push('the reported entry count ' + String(row.entries) + ' is not the change header\'s own ' + String(header.toolCount) + ' name(s)')
      if (row.entries !== f.faceBeforeDeclare.toolCount + f.members.length) problems.push('the reported entry count ' + String(row.entries) + ' is not the old face ' + String(f.faceBeforeDeclare.toolCount) + ' plus the group\'s ' + String(f.members.length) + ' member(s)')
      if (row.bytes !== header.bytes) problems.push('the reported ' + String(row.bytes) + ' bytes are not this gate\'s own arithmetic on that header (' + String(header.bytes) + ' bytes of JSON.stringify(header.tools))')
      if (row.startsSeries !== header.startsSeries) problems.push('the reported startsSeries=' + String(row.startsSeries) + ' is not the change header\'s own marker (' + String(header.startsSeries) + ')')
      if (header.startsSeries !== false) problems.push('the change header starts a new series (startsSeries=' + String(header.startsSeries) + '), which the plugin reported as ' + String(row.startsSeries))
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the applied row reads "' + row.line + '" and the change header agrees on all three: entries ' + String(row.entries) + ' == its ' + String(header.toolCount) + ' name(s) == the old face ' + String(f.faceBeforeDeclare.toolCount) + ' + the ' + String(f.members.length) + ' member(s); bytes ' + String(row.bytes) + ' == Buffer.byteLength(JSON.stringify(that header\'s tools)) measured here; startsSeries ' + String(row.startsSeries) + ' == that header\'s own marker (absent, i.e. not true)')
    },
  },
  {
    id: '7-the-declaration-was-applied-and-nobody-was-asked',
    judge: (f) => {
      if (f.declareResult === null) return NOT_MEASURED('the declaration call has no result event, so whether it was applied cannot be read')
      if (f.declaration === null) return NOT_MEASURED('the declaration result carries no readable text')
      if (f.declaration.refused.length > 0) {
        return NOT_MEASURED('the live declaration was refused by name: ' + f.declaration.refused.map((row) => row.line).join(' | ') + ' (the directory said: ' + (f.directory === null ? '(the directory was not read)' : f.directory.rows.map((row) => row.line).join(' | ')) + '); the slide this gate exists to read never happened, and a refused declaration is a configuration fact, not a product verdict')
      }
      if (f.declaration.applied.length !== 1) {
        return NOT_MEASURED('the declaration answered ' + String(f.declaration.applied.length) + ' applied row(s) and ' + String(f.declaration.pending.length) + ' pending-approval row(s): ' + show(f.declaration.text.split(/\r?\n/).slice(0, 3)))
      }
      const row = f.declaration.applied[0]
      const problems = []
      if (f.group !== null && row.id !== f.group.id) problems.push('the applied row is ' + show(row.id) + ' and the table declares ' + show(f.group.id))
      if (f.declaration.pending.length > 0) problems.push('the declaration left something pending an approval: ' + show(f.declaration.pending.map((one) => one.id)))
      if (f.approvals.asked !== 0 || f.approvals.decided !== 0) problems.push('the round asked a human (' + String(f.approvals.asked) + ' approval/asked, ' + String(f.approvals.decided) + ' approval/decided) although the table declares the group auto')
      if (f.declareResult.isError === true) problems.push('the declaration result is an error event although it carries applied rows')
      if (f.turnEnd === null) problems.push('the session logged no turn/end')
      else if (f.turnEnd.kind !== 'completed') return NOT_MEASURED('the round ended as ' + show(f.turnEnd.kind) + ' rather than completed, so this round is not a finished measurement of a finished declaration')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('the declaration answered exactly one applied row (' + row.line + ') for the table\'s group, refused 0 and left 0 pending; the round asked nobody (' + String(f.approvals.asked) + ' approval/asked, ' + String(f.approvals.decided) + ' approval/decided under the session\'s own policy ' + show(f.policy) + '); the turn ended as completed at seq ' + String(f.turnEnd.seq))
    },
  },
  {
    id: '8-the-world-fingerprint-left-behind',
    judge: (f) => {
      const t = f.transcript
      const before = t.entry.sessions
      const after = t.exit.sessions
      if (before === null || after === null) return NOT_MEASURED('the session list could not be read at ' + (before === null ? 'entry' : 'exit') + ', so the world fingerprint is not a measurement')
      const problems = []
      const moved = []
      for (const row of before.rows) {
        const now = after.rows.find((one) => one.sessionId === row.sessionId) ?? null
        if (now === null) problems.push('the session ' + String(row.sessionId) + ' that existed at entry is gone at exit')
        else if (now.asOfSeq !== row.asOfSeq) moved.push(String(row.sessionId) + ' ' + String(row.asOfSeq) + ' -> ' + String(now.asOfSeq))
      }
      if (moved.length > 0) problems.push('another session moved while this gate ran: ' + show(moved))
      const born = after.rows.filter((one) => before.rows.some((row) => row.sessionId === one.sessionId) === false)
      if (born.length !== 1) problems.push('this gate created one session and the world gained ' + String(born.length) + ': ' + show(born.map((row) => row.sessionId)))
      else if (f.sessionId === null || born[0].sessionId !== f.sessionId) problems.push('the new session is ' + show(born[0].sessionId) + ' and this gate\'s own session is ' + show(f.sessionId))
      const own = after.rows.find((one) => one.sessionId === f.sessionId) ?? null
      if (own === null || own.asOfSeq <= 0) problems.push('this gate\'s own session carries asOfSeq ' + show(own?.asOfSeq) + ', so the round did not land in the log')
      const openNow = f.lastHeader === null ? null : f.members.filter((name) => f.lastHeader.names.includes(name)).length
      if (f.members.length > 0 && openNow !== f.members.length) problems.push('the group is not left open in this gate\'s own session: the last header (seq ' + show(f.lastHeader?.seq) + ') carries ' + show(openNow) + ' of its ' + String(f.members.length) + ' member(s)')
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('sessions ' + String(before.count) + ' -> ' + String(after.count) + ' and the only new one is this gate\'s own ' + String(f.sessionId) + ' (left in place: it is the evidence, this gate deletes nothing); every one of the ' + String(before.rows.length) + ' pre-existing session(s) kept its asOfSeq, so no other session was written; the group is left OPEN in this session (last header seq ' + show(f.lastHeader?.seq) + ' carries all ' + String(f.members.length) + ' member(s), face ' + String(f.lastHeader?.toolCount ?? 0) + ' tools)')
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
const recordsOf = (t) => (Array.isArray(t?.page?.records) ? t.page.records : [])
const eventsOf = (t) => recordsOf(t).map((record) => record?.event).filter((event) => event !== null && typeof event === 'object')
const recordFor = (t, predicate) => recordsOf(t).find((record) => predicate(record?.event)) ?? null
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
const directoryText = (t) => {
  const record = recordFor(t, (event) => event?.type === 'tool/result' && String(event.data?.message?.content?.[0]?.text ?? '').includes('Tools are organised in groups'))
  return record === null ? null : String(record.event.data.message.content[0].text)
}
const declarationText = (t) => {
  const record = recordFor(t, (event) => event?.type === 'tool/result' && String(event.data?.message?.content?.[0]?.text ?? '').startsWith('- opened'))
  return record === null ? null : String(record.event.data.message.content[0].text)
}
const changeHeaderEvent = (t) => {
  const found = eventsOf(t).filter((event) => event.type === 'request/header' && event.data?.reason === 'change')
  return found[found.length - 1] ?? null
}
const initialHeaderEvent = (t) => eventsOf(t).find((event) => event.type === 'request/header') ?? null
const membersOfTranscript = (t) => {
  const text = directoryText(t)
  if (text === null) return []
  const rows = parseDirectory(text).rows
  return rows.length > 0 ? rows[0].tools : []
}

const MUTANTS = [
  {
    name: 'the-model-declared-twice',
    declared: ['0-the-model-was-asked-once-and-did-what-the-message-named'],
    what: 'a round in which the model issued a second declaration (the gate names it instead of reading one slide out of two calls)',
    apply: (t) => {
      const call = recordFor(t, (event) => event?.type === 'tool/call' && event.data?.name === DECLARE_TOOL)
      const result = recordFor(t, (event) => event?.type === 'tool/result' && String(event.data?.message?.content?.[0]?.text ?? '').startsWith('- opened'))
      if (call === null || result === null) return
      const index = recordsOf(t).indexOf(result)
      t.page.records.splice(index + 1, 0, clone(call), clone(result))
    },
  },
  {
    name: 'the-model-never-called-the-directory',
    declared: ['0-the-model-was-asked-once-and-did-what-the-message-named', '2-the-live-directory-names-the-group-the-mounted-table-declares'],
    what: 'a model that declared without reading the directory first',
    apply: (t) => {
      t.page.records = recordsOf(t).filter((record) => (record?.event?.type === 'tool/call' && record.event.data?.name === DIRECTORY_TOOL) === false && (record?.event?.type === 'tool/result' && String(record.event.data?.message?.content?.[0]?.text ?? '').includes('Tools are organised in groups')) === false)
    },
  },
  {
    name: 'a-second-prompt-was-sent',
    declared: ['1-one-message-and-the-very-same-world-throughout'],
    what: 'a gate that asked the model twice instead of once',
    apply: (t) => {
      t.session.promptCount = 2
    },
  },
  {
    name: 'the-client-was-restarted-during-the-round',
    declared: ['1-one-message-and-the-very-same-world-throughout'],
    what: 'the world this gate measured being replaced under it (a restart, read as a named state and not as a product verdict)',
    apply: (t) => {
      t.exit.client = '999999@2099-01-01T00:00:00.0000000Z'
    },
  },
  {
    name: 'another-live-consumer-was-running',
    declared: ['1-one-message-and-the-very-same-world-throughout'],
    what: 'the single-run discipline broken: a gate that drove a client somebody else was driving',
    apply: (t) => {
      t.entry.otherConsumers = ['pid 4242 node scripts/verify-browser-tabs-live.mjs']
    },
  },
  {
    name: 'the-shipped-module-was-rewritten-mid-run',
    declared: ['1-one-message-and-the-very-same-world-throughout'],
    what: 'the code under test changing between entry and exit, which makes the two halves of the run different builds',
    apply: (t) => {
      if (t.exit.subject?.module !== undefined) t.exit.subject.module.sha256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    },
  },
  {
    name: 'the-directory-names-another-group',
    declared: ['2-the-live-directory-names-the-group-the-mounted-table-declares'],
    what: 'a directory row whose id is not the id of the group the mounted table declares',
    apply: (t) => {
      const members = membersOfTranscript(t)
      editResultText(t, (text) => text.includes('Groups ('), (text) => (members.length === 0 ? text : text.replace('- ' + members.join(' ') , text)))
      const row = parseDirectory(directoryText(t) ?? '').rows[0]
      if (row !== undefined) {
        editResultText(t, (text) => text.includes(row.line), (text) => text.replace(row.line, row.line.replace('- ' + row.id + ' ', '- gate117_no_such_group ')))
      }
    },
  },
  {
    name: 'the-directory-lists-fewer-members',
    declared: ['2-the-live-directory-names-the-group-the-mounted-table-declares'],
    what: 'a directory that describes the group as smaller than the table declares it',
    apply: (t) => {
      const row = parseDirectory(directoryText(t) ?? '').rows[0]
      if (row === undefined || row.tools.length === 0) return
      const fewer = row.tools.slice(0, row.tools.length - 1)
      editResultText(t, (text) => text.includes(row.line), (text) => text.replace(row.line, row.line.replace('tools(' + String(row.declared) + '): ' + row.tools.join(', '), 'tools(' + String(fewer.length) + '): ' + fewer.join(', '))))
    },
  },
  {
    name: 'the-directory-says-the-group-is-blocked',
    declared: ['2-the-live-directory-names-the-group-the-mounted-table-declares'],
    what: 'a directory that reports the group as blocked while this gate watched it open',
    apply: (t) => {
      const row = parseDirectory(directoryText(t) ?? '').rows[0]
      if (row === undefined) return
      editResultText(t, (text) => text.includes(row.line), (text) => text.replace(row.line, row.line.replace('openable now', 'blocked: GROUPS_NO_TOOLS')))
    },
  },
  {
    name: 'a-change-header-existed-before-the-declaration',
    declared: ['3-the-declaring-step-could-not-see-the-new-tools'],
    what: 'a surface that had already slid before the declaration this gate reads',
    apply: (t) => {
      const header = initialHeaderEvent(t)
      const call = recordFor(t, (event) => event?.type === 'tool/call' && event.data?.name === DECLARE_TOOL)
      if (header === null || call === null) return
      const records = recordsOf(t)
      const at = records.indexOf(recordFor(t, (event) => event === call.event) ?? recordFor(t, (event) => event?.seq === call.event?.seq) ?? call)
      const index = records.findIndex((record) => record?.event === call.event)
      if (index === -1) return
      const copy = clone(records.find((record) => record?.event === header) ?? null)
      if (copy === null) return
      copy.event.data.reason = 'change'
      copy.event.seq = Math.max(0, Number(header.seq) + 0.5)
      records.splice(index, 0, copy)
      void at
    },
  },
  {
    name: 'the-developer-message-is-missing',
    declared: ['4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message'],
    what: 'a slide without the tool-addition line the kernel writes with it',
    apply: (t) => {
      t.page.records = recordsOf(t).filter((record) => record?.event?.type !== 'developer/message')
    },
  },
  {
    name: 'a-tool-addition-row-is-missing',
    declared: ['4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message'],
    what: 'a developer/message that names fewer members than the group it opened',
    apply: (t) => {
      const record = recordFor(t, (event) => event?.type === 'developer/message')
      const content = record?.event?.data?.message?.content
      if (Array.isArray(content) !== true || content.length === 0) return
      content.pop()
    },
  },
  {
    name: 'the-developer-message-points-at-another-header',
    declared: ['4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message'],
    what: 'a tool-addition line bound to a header that is not the one the slide wrote',
    apply: (t) => {
      const record = recordFor(t, (event) => event?.type === 'developer/message')
      if (record !== null && record.event.data.headerSeq !== undefined) record.event.data.headerSeq = Number(record.event.data.headerSeq) + 1
    },
  },
  {
    name: 'the-change-header-says-initial',
    declared: ['4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message', '5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members', '6-the-cost-trio-is-that-header-and-that-result'],
    what: 'the kernel logging the slide as something other than a change',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      if (header !== null) header.data.reason = 'initial'
    },
  },
  {
    name: 'a-second-change-header-was-written',
    declared: ['4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message'],
    what: 'one declaration paying for two slides',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      if (header === null) return
      const records = recordsOf(t)
      const last = records.findLastIndex((record) => record?.event?.type === 'turn/end')
      const copy = clone(records.find((record) => record?.event === header) ?? null)
      if (copy === null) return
      copy.event.seq = Number(header.seq) + 0.5
      records.splice(last === -1 ? records.length : last, 0, copy)
    },
  },
  {
    name: 'the-face-did-not-grow',
    // This mutant also leaves the session with the OLD face as its last header, so reading 8's
    // "the group is left open in this session" is red in that world too - not an accident: the
    // evidence session really would be closed again.
    declared: ['5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members', '6-the-cost-trio-is-that-header-and-that-result', '8-the-world-fingerprint-left-behind'],
    what: 'a declaration that reported a surface it never delivered (and so left the session closed again)',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      const initial = initialHeaderEvent(t)
      if (header === null || initial === null) return
      header.data.header.tools = clone(initial.data.header.tools)
    },
  },
  {
    name: 'an-extra-name-joined-the-face',
    declared: ['5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members', '6-the-cost-trio-is-that-header-and-that-result'],
    what: 'a face that grew by a name the group does not declare',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      if (header === null) return
      const tools = Array.isArray(header.data?.header?.tools) ? header.data.header.tools : []
      tools.push({ name: 'gate117_ghost', description: 'mutant', parameters: { type: 'object', properties: {} } })
    },
  },
  {
    name: 'a-name-left-the-face',
    declared: ['5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members', '6-the-cost-trio-is-that-header-and-that-result'],
    what: 'a slide that took a published name away (the group table contract says names only ever come back)',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      if (header === null) return
      const tools = Array.isArray(header.data?.header?.tools) ? header.data.header.tools : []
      if (tools.length > 0) tools.shift()
    },
  },
  {
    name: 'the-reported-entry-count-is-not-the-surface',
    declared: ['6-the-cost-trio-is-that-header-and-that-result'],
    what: 'a cost report that counts something other than the face it just wrote',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), (text) => text.replace(/surface now (\d+) tools/, (_all, count) => 'surface now ' + String(Number(count) + 1) + ' tools'))
    },
  },
  {
    name: 'the-reported-byte-count-is-not-the-surface',
    declared: ['6-the-cost-trio-is-that-header-and-that-result'],
    what: 'a byte count that is not the serialized surface',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), (text) => text.replace(/(\d+) bytes/, (_all, count) => String(Number(count) + 1) + ' bytes'))
    },
  },
  {
    name: 'the-reported-series-flag-is-a-lie',
    declared: ['6-the-cost-trio-is-that-header-and-that-result'],
    what: 'a report that claims the next request starts a new series',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), (text) => text.replace('startsSeries=false', 'startsSeries=true'))
    },
  },
  {
    name: 'the-effective-point-is-a-lie',
    declared: ['6-the-cost-trio-is-that-header-and-that-result'],
    what: 'the plugin claiming the change lands immediately',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), (text) => text.replace('effective: ' + EFFECTIVE, 'effective: immediate'))
    },
  },
  {
    name: 'the-declaration-was-refused',
    declared: ['2-the-live-directory-names-the-group-the-mounted-table-declares', '4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message', '5-the-next-step-face-is-the-old-face-plus-exactly-the-group-members', '6-the-cost-trio-is-that-header-and-that-result', '7-the-declaration-was-applied-and-nobody-was-asked'],
    what: 'a group the live world cannot open (the configuration fact this gate names instead of scoring)',
    apply: (t) => {
      editResultText(t, (text) => text.startsWith('- opened'), () => '- refused teams [GROUPS_NO_TOOLS] declared tools registered on no layer this agent can call: ' + membersOfTranscript(t).join(', ') + '\nKnown group ids (configuration order): teams')
    },
  },
  {
    name: 'the-round-asked-a-human',
    declared: ['7-the-declaration-was-applied-and-nobody-was-asked'],
    what: 'an auto group opening through an approval question nobody had to answer',
    apply: (t) => {
      const records = recordsOf(t)
      const last = records.findLastIndex((record) => record?.event?.type === 'turn/end')
      records.splice(last === -1 ? records.length : last, 0, { type: 'event', event: { type: 'approval/asked', seq: 999.1, time: Date.now(), data: { toolName: DECLARE_TOOL, question: 'mutant' } } })
    },
  },
  {
    name: 'the-round-did-not-complete',
    declared: ['7-the-declaration-was-applied-and-nobody-was-asked'],
    what: 'a turn that was cut off before its end',
    apply: (t) => {
      const record = recordFor(t, (event) => event?.type === 'turn/end')
      if (record !== null) record.event.data.reason = { kind: 'interrupted' }
    },
  },
  {
    name: 'another-session-moved',
    declared: ['8-the-world-fingerprint-left-behind'],
    what: 'this gate writing into a session that is not its own',
    apply: (t) => {
      const rows = t.exit.sessions?.rows ?? []
      const other = rows.find((row) => row.sessionId !== t.session.sessionId) ?? null
      if (other !== null) other.asOfSeq = Number(other.asOfSeq) + 7
    },
  },
  {
    name: 'the-group-was-closed-again-after-the-round',
    declared: ['4-one-declaration-wrote-exactly-one-change-header-and-exactly-one-developer-message', '8-the-world-fingerprint-left-behind'],
    what: 'the evidence session left with a closed surface, so the next reader cannot see what this gate opened',
    apply: (t) => {
      const header = changeHeaderEvent(t)
      const initial = initialHeaderEvent(t)
      if (header === null || initial === null) return
      const records = recordsOf(t)
      const last = records.findLastIndex((record) => record?.event?.type === 'turn/end')
      const copy = clone(records.find((record) => record?.event === header) ?? null)
      if (copy === null) return
      copy.event.seq = Number(header.seq) + 0.75
      copy.event.data.header.tools = clone(initial.data.header.tools)
      records.splice(last === -1 ? records.length : last, 0, copy)
    },
  },
  {
    name: 'control-nothing-changes',
    declared: [],
    what: 'the control: a transcript nobody touched must redden nothing',
    apply: () => {},
  },
]

const selfAttack = (transcript) => {
  const baseline = runJudges(transcript)
  const green = baseline.filter((entry) => entry.ok === true)
  const notGreen = baseline.filter((entry) => entry.ok !== true)
  console.log('')
  console.log('== self-attack: ' + String(MUTANTS.length) + ' mutants over the MEASURED transcript of this run ==')
  console.log('  baseline: ' + String(green.length) + ' green, ' + String(notGreen.length) + ' not green (no mutant is applied to the world; the client is not touched)')
  if (notGreen.length > 0) {
    console.log('  the attack does not start: the baseline is not green, and a mutant over a red baseline proves nothing')
    for (const entry of notGreen) console.log('    ' + entry.id + ' -> ' + clip(entry.detail, 200))
    return 1
  }
  const coverage = new Map(READINGS.map((reading) => [reading.id, 0]))
  let problems = 0
  for (const mutant of MUTANTS) {
    const copy = clone(transcript)
    let applied = true
    try {
      mutant.apply(copy)
    } catch (error) {
      applied = false
      console.log('  BROKEN ' + pad(mutant.name, 46) + ' the mutation threw: ' + describe(error))
    }
    const verdicts = runJudges(copy)
    const observed = verdicts.filter((entry) => entry.ok !== true).map((entry) => entry.id)
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) ?? 0) + 1)
    const exact = applied === true && same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 46) + ' declared=' + show(mutant.declared.map((id) => id.split('-')[0])) + ' observed=' + show(observed.map((id) => id.split('-')[0])))
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
  console.log('  kernel: ' + (t.entry.kernel === null ? '(not read)' : 'pid ' + String(t.entry.kernel.pid) + ' port ' + show(t.entry.kernel.port) + ' patches ' + show(t.entry.kernel.patches)))
  console.log('  live profile: ' + String(t.subject?.profileDir ?? '(unread)') + ' mounts ' + BUNDLE + ' as ' + show(t.subject?.mounted))
  console.log('  subject: ' + String(t.subject?.modulePath ?? '(unread)') + ' (' + String(t.subject?.module?.bytes ?? '?') + ' bytes, sha256 ' + clip(String(t.subject?.module?.sha256 ?? '?'), 16) + ')')
  console.log('  table:   ' + String(t.subject?.configPath ?? '(unread)') + ' (' + String(t.subject?.config?.bytes ?? '?') + ' bytes, sha256 ' + clip(String(t.subject?.config?.sha256 ?? '?'), 16) + ')')
  for (const group of t.subject?.table?.groups ?? []) {
    console.log('    group ' + pad(group.id, 12) + ' state=' + String(group.state) + ' auto=' + String(group.autoWhen) + ' provider=' + String(group.provider) + ' tools(' + String(group.tools.length) + '): ' + group.tools.join(', '))
  }
  console.log('  single-run guard: ' + String((t.entry.liveGateFiles ?? []).length) + ' live gate file(s) in the register' + (t.guard?.parseNote === null || t.guard?.parseNote === undefined ? '' : ' (' + String(t.guard.parseNote) + ')') + ', ' + String(t.guard?.nodeProcesses ?? 0) + ' node process(es) read, other live consumers: ' + String((t.entry.otherConsumers ?? []).length))
  for (const consumer of t.entry.otherConsumers ?? []) console.log('    ' + consumer)
  console.log('  one message, one round: session ' + String(t.session?.sessionId ?? '(none)') + ', requestId ' + String(t.session?.requestId ?? '(none)') + ', accepted ' + show(t.session?.accepted) + ', prompt(s) sent ' + String(t.session?.promptCount) + ', polls ' + String(t.session?.polls) + ', turn/end seen ' + String(t.session?.turnEnded))
  console.log('  the message: ' + JSON.stringify(MESSAGE).slice(0, 200) + ' ...')
  console.log('  the session\'s own policy: ' + show(facts.policy) + ' (approval/asked ' + String(facts.approvals.asked) + ', approval/decided ' + String(facts.approvals.decided) + ')')
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
  console.log('  the calls the model made (' + String(facts.calls.length) + '):')
  for (const call of facts.calls) console.log('    seq=' + pad(String(call.seq), 4) + ' turn ' + String(call.turn) + ' step ' + String(call.step) + ' ' + pad(call.name, 22) + ' ' + clip(call.arguments, 120))
  console.log('  the results the engine wrote (' + String(facts.results.length) + '):')
  for (const result of facts.results) console.log('    seq=' + pad(String(result.seq), 4) + ' turn ' + String(result.turn) + ' step ' + String(result.step) + ' isError=' + String(result.isError) + ' ' + JSON.stringify(clip(result.text, 400)))
  console.log('  developer/message(s) (' + String(facts.developers.length) + '):')
  for (const message of facts.developers) console.log('    seq=' + pad(String(message.seq), 4) + ' turn ' + String(message.turn) + ' step ' + String(message.step) + ' headerSeq=' + pad(String(message.headerSeq), 5) + ' blocks=' + show(message.blocks) + ' additions=' + show(message.additions))
  console.log('  turn/end: ' + show(facts.turnEnd))
  console.log('  sessions: ' + String(t.entry.sessions?.count ?? '?') + ' at entry -> ' + String(t.exit.sessions?.count ?? '?') + ' at the end' + (facts.sessionId === null || facts.sessionId === 'null' ? '; no session of this gate\'s own was created' : '; the new one is this gate\'s own ' + String(facts.sessionId) + ' and it is LEFT IN PLACE (it is the evidence)'))
  console.log('  the dump of the judged record: ' + String(t.dumpPath ?? '(not written)'))
  for (const note of t.notes) console.log('  ' + note)
  for (const problem of t.problems) console.log('  PROBLEM ' + problem)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('gate 117 tool-groups-live - one declaration in the real client (shell ' + SHELL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  one session, ONE prompt, read-only afterwards; the self-attack mutates THIS run\'s transcript and never drives the world twice')
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
    if (transcript?.schema !== 'r185-g117-transcript/1' || transcript.session === undefined || transcript.page === undefined || transcript.subject === undefined) {
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
        console.log('tool-groups-live: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
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
    console.log('tool-groups-live: the world could not be driven to the end, so nothing was judged (exit 3)')
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
  const stopped = (transcript.notes ?? []).filter((note) => note.startsWith('NOT MEASURED in the world'))
  console.log('')
  if (SELF_ATTACK === true) {
    if (stopped.length > 0 || failed.length > 0 || notMeasured.length > 0) {
      console.log('tool-groups-live: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a baseline that is not green and measured')
      for (const verdict of notMeasured) console.log('    not measured: ' + verdict.id + ' -> ' + clip(verdict.detail, 200))
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('tool-groups-live --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED'))
    return attack === 0 ? 0 : 1
  }
  const sessionPhrase = transcript.session?.created === true
    ? 'session ' + String(facts.sessionId) + ' left in place as the evidence'
    : 'no session of this gate\'s own was created'
  console.log('tool-groups-live: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live client at ' + SHELL_ORIGIN + '; prompt(s) sent ' + String(transcript.session?.promptCount ?? 0) + '; ' + sessionPhrase + ']')
  if (stopped.length > 0) {
    for (const note of stopped) console.log('SKIP: ' + note)
    console.log('tool-groups-live: NOT MEASURED in the world, so nothing above is a verdict on the product [exit 3]')
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
