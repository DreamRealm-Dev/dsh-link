#!/usr/bin/env node
/**
 * Gate 135 (R198 P2) - notes-cost-live: ONE note change, priced against a CONTROL session.
 *
 * THE QUESTION, TURNED INTO A MEASUREMENT. R194 recorded a toDecide: a note change costs a
 * prompt-HEAD rewrite on the next request, because the live route declares no `systemPromptUpdate`
 * capability, so SystemPromptProjection.project takes the replace branch
 * (packages/core/agent-loop/src/runtime-context.ts:95-99 rewrites surface node 0 instead of appending
 * after it). R194 also left the only two adjacent readings on record pointing opposite ways - one
 * session's step after a change read `inputTokens=502 / cacheReadTokens=23040`, another read
 * `13130 / 8704` after `7064 / 14336` - and said in as many words that neither was a verdict
 * (.tmp/r194-groups/report.md section 5). This round's user input rewrote the premise: mainstream APIs
 * now update the system prompt without breaking every cache hit. So the cost is measured here, not
 * assumed, and the gate holds its reading either way.
 *
 * THE DRIVE - two sessions of identical content, ONE variable. Each repetition is a PAIR of brand-new
 * sessions built from the same two one-sentence prompts, run interleaved (A1 B1 A2 B2 ...) so that a
 * server-side cache flap cannot be mistaken for the variable:
 *
 *   arm A (variable):   prompt 1 -> ONE note added through the product's own write route
 *                       (POST /api/dsh-link-notes/add on the live kernel, the same writeOneNote the
 *                       notes_add tool calls) -> prompt 2
 *   arm B (control):    prompt 1 -> no note added -> prompt 2
 *
 * Both arms' second requests carry the SAME note set: A's own note is in the ledger by the time B
 * runs, and B never adds one, so at prompt 2 the two heads hold the same notes. The difference is
 * only whether the head CHANGED between that session's two requests. That is the variable.
 *
 * WHAT IS READ, from the sessions' OWN event logs (session/page): assistant/message data.usage
 * ({inputTokens, cacheReadTokens, ...} - the pair R194 pointed at), system/message (seq, surfaceOp,
 * text - the surface R194 measured the rewrite on), request/header (the tools face, so the gate can
 * show the tools were NOT the variable) and request/context (the route the sessions ran on).
 *
 * ONE READ RULE, STATED: usage.cacheReadTokens is an OPTIONAL field and this route omits it when
 * there is nothing to report, so a message without it is read as totalTokens - inputTokens -
 * outputTokens, and reading 2 checks that arithmetic against EVERY message that does carry the
 * field. (The rule was added after this gate's first live run showed the field omitted at zero; the
 * threshold below was not touched.)
 *
 * THE THRESHOLD IS STATED HERE, BEFORE THE RUN, and the transcript carries it so --replay applies the
 * same arithmetic. "Materially lower" means, for the step that carries the change (the first step of
 * turn 2) in EVERY repetition:
 *
 *     cacheReadTokens(A) < cacheReadTokens(B) - max(512, 0.5 x cacheReadTokens(B))
 *
 * i.e. A's cache read fell by more than half of the control's own cache read, and by more than 512
 * tokens. WHY THIS AND NOT SOMETHING ELSE: the mechanism under test is a head rewrite, so the whole
 * cached prefix should be gone and A's cache read should land near zero; the predicted delta is the
 * control's whole cache read. Half of it, floored at 512 tokens, is deliberately BELOW that
 * prediction, so a partial-block credit or ordinary run-to-run noise cannot trip it, while a real
 * head-level break cannot miss it. A threshold chosen after seeing the numbers would be
 * indistinguishable from fitting the answer; this one is fixed in the file and frozen into every
 * transcript. Two further numbers are fixed the same way and for the same reason: a pair is only
 * USABLE when the control arm's second request read more than 512 tokens from cache (a cold control
 * has no cache to lose, and comparing against zero would prove nothing), and the comparison is made
 * at the same step index in both arms.
 *
 * THE THIRD STATE, NAMED: provider-internal cache policy - eviction, TTL, block granularity, and where
 * the provider's cache actually keys - is NOT MEASURED. This gate measures this machine, this route,
 * these sessions, at these two moments. A "closed" verdict says this world showed no collapse of the
 * predicted size; it does not say the provider never evicts.
 *
 * EXIT CODE FOLLOWS THE READING BEING HELD, NOT THE VERDICT'S DIRECTION: 0 when the world was measured,
 * the adjacent pairs were recorded, the control was warm and the threshold was applied - WHETHER A's
 * cache read collapsed or did not. 1 when a reading failed (the change did not land in A, the control
 * moved, a pair is missing while others exist, the world was disturbed). 3 when this gate could not
 * measure here (ports dead, the single-run lease held by another live gate for the whole wait, a round
 * that failed twice, the control never warm, or the route reports no cache tokens at all).
 *
 * SINGLE RUN, and the lease is the register's own: this gate spends up to 2 arms x 2 repetitions x 2
 * prompts = 8 short model rounds, so it must be the only live consumer. It scans the node process list
 * for the files scripts/verify-all.mjs registers as live (plus any verify-/probe- file, and its own
 * name), waits up to --lease-ms (default 180000) for the current holder to finish, and exits 3 naming
 * the holder if the lease never frees. Nothing is started or stopped; no client, no kernel, no git.
 *
 * Usage: node scripts/verify-notes-cost-live.mjs [--port 31761] [--kernel-port 31760] [--cdp 9222]
 *          [--reps 2] [--deadline-ms 90000] [--poll-ms 2000] [--lease-ms 180000] [--dump <file>]
 *          [--replay <transcript.json>]
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}
const REPLAY_PATH = option('--replay', null)
const DUMP_OPTION = option('--dump', null)
const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const CDP_PORT = Number(option('--cdp', '9222'))
const REPS = Math.max(2, Number(option('--reps', '2')))
const DEADLINE_MS = Number(option('--deadline-ms', '90000'))
const POLL_MS = Number(option('--poll-ms', '2000'))
const LEASE_MS = Number(option('--lease-ms', '180000'))
const LEASE_POLL_MS = Number(option('--lease-poll-ms', '5000'))
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const KERNEL_ORIGIN = 'http://127.0.0.1:' + String(KERNEL_PORT)

/** The product's own two notes routes, bound by the live kernel row on its loopback web server. */
const NOTES_STATE_PATH = '/api/dsh-link-notes/state'
const NOTES_ADD_PATH = '/api/dsh-link-notes/add'

/** The two prompts. One sentence each, one word expected back: the reading is about the prompt. */
const PROMPT_1 = 'Reply with exactly this one word and nothing else: alpha.'
const PROMPT_2 = 'Reply with exactly this one word and nothing else: beta.'

const RUN_MARK = randomUUID().replace(/-/gu, '').slice(0, 8)
const NOTE_AUTHOR = 'r198-cost-gate'

/** The threshold, fixed before the run. See the header: this object is written into the transcript. */
const THRESHOLD = Object.freeze({ share: 0.5, floorTokens: 512, warmFloorTokens: 512 })
const THRESHOLD_STATEMENT = 'A is MATERIALLY lower than B when, in EVERY repetition, '
  + 'cacheReadTokens(B) - cacheReadTokens(A) > max(' + String(THRESHOLD.floorTokens) + ', '
  + String(THRESHOLD.share) + ' x cacheReadTokens(B)), read at the first step of turn 2 in both arms'
const THRESHOLD_WHY = 'the mechanism under test is a prompt-head rewrite, so the whole cached prefix should be gone and A should read near zero: the predicted delta is the control whole cache read. Half of it, floored at 512 tokens, sits BELOW that prediction, so partial-block credit or noise cannot trip it while a real head-level break cannot miss it'
const WARM_STATEMENT = 'a pair is USABLE only when the control second request read more than '
  + String(THRESHOLD.warmFloorTokens) + ' tokens from cache in that repetition: a cold control has no cache to lose and a comparison against zero proves nothing'

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
const codePoints = (text) => Array.from(String(text)).length
const isInt = (value) => typeof value === 'number' && Number.isInteger(value)
const readText = (path) => {
  try {
    return { ok: true, text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { ok: false, why: describe(error) }
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
const pwsh = (command, timeoutMs = 40000) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

// ---------------------------------------------------------------------------
// The single-run lease, the way the register's live gates read it
// ---------------------------------------------------------------------------

/** Every node process, so the lease is a reading of the machine, not an assumption. */
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

/** The identity of the desktop client: pid@start-time. A restart is a third state, not a red. */
const clientIdentity = () => {
  const query = "[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })"
  const done = pwsh(query, 30000)
  if (done.status !== 0) return null
  const text = String(done.stdout ?? '').trim()
  return text === '' ? null : text
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

/** The register's own list of live gate files: the lease is what those processes hold. */
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
const SELF_FILE = 'verify-notes-cost-live.mjs'
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
 * Claim the single-run lease. The lease is the register's own discipline - "no other live consumer is
 * running" - so claiming it means reading the process list until it is clean. An unregistered
 * verify-/probe- file counts too: a gate nobody registered is still a live consumer.
 */
const claimLease = async () => {
  const live = liveGateFiles()
  const ancestors = ancestorPids()
  const attempts = []
  const until = Date.now() + LEASE_MS
  for (;;) {
    const processes = nodeProcesses()
    if (processes.ok !== true) return { ok: false, why: 'the lease could not be read (' + String(processes.why) + '), so this gate cannot promise it is alone', attempts, live, ancestors, holder: [] }
    const others = otherConsumers(processes.rows, live, ancestors)
    attempts.push({ at: new Date().toISOString(), others, nodeProcesses: processes.rows.length })
    if (others.length === 0) return { ok: true, attempts, live, ancestors, holder: [], nodeProcesses: processes.rows.length }
    if (Date.now() >= until) return { ok: false, why: 'the single-run lease was held for the whole ' + String(LEASE_MS) + ' ms wait', attempts, live, ancestors, holder: others }
    await sleep(LEASE_POLL_MS)
  }
}

// ---------------------------------------------------------------------------
// The live world: CDP -> the shell page -> same-origin /api calls; the notes routes on the kernel
// ---------------------------------------------------------------------------

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
      const timer = setTimeout(() => {
        pending.delete(id)
        settle({ error: { message: 'the CDP evaluate timed out after 60000 ms' } })
      }, 60000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        settle(message)
      })
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

const readSessions = async (cdp, rpcId) => {
  const answer = await cdp.call('session/list', { _request: {} }, rpcId)
  const items = Array.isArray(answer.value?.items) ? answer.value.items : []
  return {
    at: new Date().toISOString(),
    count: items.length,
    rows: items.map((row) => ({
      sessionId: String(row?.sessionId ?? ''),
      asOfSeq: Number(row?.projections?.asOfSeq ?? 0),
      running: row?.running === true,
      blank: row?.blank === true,
    })),
  }
}

/** The notes route's own fold, read the way the panel reads it: the live count and the two limits. */
const notesState = async () => {
  const at = new Date().toISOString()
  try {
    const answer = await fetch(KERNEL_ORIGIN + NOTES_STATE_PATH, { signal: AbortSignal.timeout(8000) })
    const text = await answer.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch (error) {
      return { ok: false, at, status: answer.status, why: 'the notes state route answered non-JSON (' + describe(error) + ')', raw: clip(text, 200) }
    }
    return {
      ok: answer.ok === true && body?.ok === true,
      at,
      status: answer.status,
      live: isInt(body?.counts?.live) ? body.counts.live : Number(body?.counts?.live ?? NaN),
      limits: body?.limits ?? null,
      ids: Array.isArray(body?.notes) ? body.notes.map((note) => ({ id: String(note?.id ?? ''), seq: note?.seq ?? null, author: note?.author ?? null })) : [],
      body,
    }
  } catch (error) {
    return { ok: false, at, status: null, why: describe(error) }
  }
}

/** ONE note, through the product's own narrow write route: the same writeOneNote the notes_add tool calls. */
const notesAdd = async (text, author) => {
  const at = new Date().toISOString()
  try {
    const answer = await fetch(KERNEL_ORIGIN + NOTES_ADD_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, author }),
      signal: AbortSignal.timeout(15000),
    })
    const raw = await answer.text()
    let body = null
    try {
      body = JSON.parse(raw)
    } catch (error) {
      return { ok: false, at, status: answer.status, why: 'the add route answered non-JSON (' + describe(error) + ')', raw: clip(raw, 300) }
    }
    return { ok: answer.ok === true && body?.ok === true, at, status: answer.status, seq: body?.seq ?? null, notes: body?.notes ?? null, body, raw: clip(raw, 300) }
  } catch (error) {
    return { ok: false, at, status: null, why: describe(error) }
  }
}

// ---------------------------------------------------------------------------
// The drive: interleaved A/B sessions, two short prompts each
// ---------------------------------------------------------------------------

const stripPage = (page) => {
  const records = Array.isArray(page?.records) ? page.records : []
  return {
    hasMore: page?.hasMore === true,
    records: records.map((record) => {
      const event = record?.event ?? null
      if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') return record
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      const copy = { ...event, data: { ...data } }
      // The stream chunks are this gate's bulk and none of its evidence: the usage is the reading.
      if (Array.isArray(copy.data.stream)) {
        copy.data.streamStripped = true
        delete copy.data.stream
      }
      return { ...record, event: copy }
    }),
  }
}

const waitForTurnEnd = async (cdp, sessionId, wantCount, label) => {
  const until = Date.now() + DEADLINE_MS
  let last = null
  let polls = 0
  let turnEnds = 0
  while (Date.now() < until) {
    polls += 1
    const list = await readSessions(cdp, 'g135-list-' + label + '-' + String(polls))
    const row = list.rows.find((one) => one.sessionId === sessionId) ?? null
    if (row !== null && row.asOfSeq > 0) {
      const read = await cdp.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: row.asOfSeq, maxMessages: 900 } }, 'g135-page-' + label + '-' + String(polls))
      const page = read.value ?? null
      last = { page, asOfSeq: row.asOfSeq }
      turnEnds = (page?.records ?? []).filter((record) => record?.event?.type === 'turn/end').length
      if (turnEnds >= wantCount) return { page, polls, ended: true, turnEnds, asOfSeq: row.asOfSeq }
    }
    await sleep(POLL_MS)
  }
  return { page: last?.page ?? null, polls, ended: false, turnEnds, asOfSeq: last?.asOfSeq ?? null }
}

const driveRound = async (cdp, label, arm, rep) => {
  const round = {
    label,
    arm,
    rep,
    startedAt: new Date().toISOString(),
    endedAt: null,
    sessionId: null,
    prompts: [],
    waits: [],
    note: null,
    counts: { atStart: null, atP1End: null, afterAdd: null, atEnd: null },
    page: null,
    pageAsOfSeq: null,
    complete: false,
    problems: [],
  }
  round.counts.atStart = await notesState()
  const created = await cdp.call('session/create', { request: {} }, 'g135-create-' + label)
  const sessionId = String(created.value?.sessionId ?? '')
  if (sessionId === '') throw new NotMeasured('the shell created no session for arm ' + label + ' (session/create answered ' + show(created.value) + ')')
  round.sessionId = sessionId

  const roundTrip = async (which, text, wantEnds) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const requestId = randomUUID()
      const accepted = await cdp.call('session/prompt', { request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] } }, 'g135-prompt-' + label + '-' + which + '-' + String(attempt))
      const acceptedOk = accepted.value?.accepted === true
      round.prompts.push({ which, attempt, requestId, text, sentAt: new Date().toISOString(), accepted: acceptedOk, value: accepted.value ?? null })
      if (acceptedOk !== true) {
        round.problems.push('the ' + which + ' prompt of arm ' + label + ' was not accepted on attempt ' + String(attempt) + ': ' + show(accepted.value))
        continue
      }
      const waited = await waitForTurnEnd(cdp, sessionId, wantEnds, label + '-' + which + '-' + String(attempt))
      round.waits.push({ which, attempt, polls: waited.polls, ended: waited.ended, turnEnds: waited.turnEnds, asOfSeq: waited.asOfSeq })
      if (waited.ended === true) return waited
      round.problems.push('the ' + which + ' prompt of arm ' + label + ' produced no turn/end within ' + String(DEADLINE_MS) + ' ms on attempt ' + String(attempt) + ' (turn/end seen: ' + String(waited.turnEnds) + ', polls ' + String(waited.polls) + ')')
    }
    return null
  }

  const first = await roundTrip('P1', PROMPT_1, 1)
  if (first === null) {
    round.endedAt = new Date().toISOString()
    return round
  }
  round.counts.atP1End = await notesState()

  if (arm === 'A') {
    const text = 'R198G135-' + RUN_MARK + '-' + label + ' the one note arm ' + label + ' adds'
    let added = await notesAdd(text, NOTE_AUTHOR)
    if (added.ok !== true) {
      const retry = await notesAdd(text, NOTE_AUTHOR)
      round.problems.push('the note add of arm ' + label + ' answered ' + show(added.status) + ' (' + clip(show(added.body ?? added.why), 200) + ') and its one retry answered ' + show(retry.status) + ' (' + clip(show(retry.body ?? retry.why), 200) + ')')
      added = retry
    }
    round.counts.afterAdd = await notesState()
    round.note = { attempted: true, text, author: NOTE_AUTHOR, ok: added.ok === true, status: added.status, seq: added.seq, notes: added.notes, body: added.body ?? null, why: added.why ?? null }
  } else {
    // The control's own witness: the same read, at the same point, with no write.
    round.counts.afterAdd = await notesState()
    round.note = { attempted: false, text: null, author: null, ok: null, status: null, seq: null, notes: null, body: null, why: null }
  }

  const second = await roundTrip('P2', PROMPT_2, 2)
  round.counts.atEnd = await notesState()
  if (second === null) {
    round.endedAt = new Date().toISOString()
    return round
  }
  const list = await readSessions(cdp, 'g135-list-' + label + '-final')
  const row = list.rows.find((one) => one.sessionId === sessionId) ?? null
  if (row !== null && row.asOfSeq > 0) {
    const read = await cdp.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: row.asOfSeq, maxMessages: 900 } }, 'g135-page-' + label + '-final')
    round.page = stripPage(read.value ?? null)
    round.pageAsOfSeq = row.asOfSeq
  } else {
    round.page = stripPage(second.page)
    round.pageAsOfSeq = second.asOfSeq
    round.problems.push('the session ' + sessionId + ' of arm ' + label + ' is not in session/list after its second prompt, so the page read is the one taken at the turn end')
  }
  round.complete = true
  round.endedAt = new Date().toISOString()
  return round
}

const runWorld = async () => {
  const transcript = {
    schema: 'r198-g135-transcript/1',
    gate: '135 notes-cost-live (R198 P2)',
    startedAt: new Date().toISOString(),
    port: PORT,
    kernelPort: KERNEL_PORT,
    cdpPort: CDP_PORT,
    shellOrigin: SHELL_ORIGIN,
    kernelOrigin: KERNEL_ORIGIN,
    runMark: RUN_MARK,
    threshold: { share: THRESHOLD.share, floorTokens: THRESHOLD.floorTokens, warmFloorTokens: THRESHOLD.warmFloorTokens, statement: THRESHOLD_STATEMENT, why: THRESHOLD_WHY, warm: WARM_STATEMENT },
    design: {
      repetitions: REPS,
      interleave: Array.from({ length: REPS }, (_, index) => ['A' + String(index + 1), 'B' + String(index + 1)]).flat(),
      prompts: { P1: PROMPT_1, P2: PROMPT_2 },
      armA: 'one note added through POST ' + NOTES_ADD_PATH + ' between the two prompts (the product own writeOneNote, the same function the notes_add tool calls)',
      armB: 'no note added between the two prompts; the same read of the same route at the same point, and nothing written',
    },
    entry: { at: new Date().toISOString(), ports: null, client: null, kernel: null, ancestors: [], liveGateFiles: [], lease: null, sessions: null, notes: null },
    exit: { at: null, ports: null, client: null, kernel: null, sessions: null, notes: null },
    rounds: [],
    notes: [],
    problems: [],
    dumpPath: null,
  }

  const cdp = await openCdpPage()
  if (cdp.ok !== true) throw new NotMeasured(cdp.why)
  transcript.pageUrl = cdp.url
  try {
    const ports = {}
    for (const port of [PORT, KERNEL_PORT, CDP_PORT]) ports[String(port)] = await portAlive(port)
    transcript.entry.ports = ports
    const dead = Object.entries(ports).filter(([, alive]) => alive !== true).map(([port]) => port)
    if (dead.length > 0) throw new NotMeasured('the live world does not answer on port(s) ' + show(dead) + ' (shell ' + String(PORT) + ', kernel ' + String(KERNEL_PORT) + ', CDP ' + String(CDP_PORT) + '), so nothing below could be a live reading')

    transcript.entry.client = clientIdentity()
    if (transcript.entry.client === null) throw new NotMeasured('the desktop client process (dsh-link) is not running, so there is no live client to measure')

    const lease = await claimLease()
    transcript.entry.lease = lease
    transcript.entry.ancestors = lease.ancestors ?? []
    transcript.entry.liveGateFiles = (lease.live ?? {}).files ?? []
    if (lease.ok !== true) throw new NotMeasured(lease.why + ' - held by ' + show(lease.holder))

    const processes = nodeProcesses()
    transcript.entry.kernel = processes.ok === true ? kernelIdentity(processes.rows) : null
    if (transcript.entry.kernel === null) throw new NotMeasured('no live kernel process could be named (a node process running the CLI with --patch layers)')

    transcript.entry.notes = await notesState()
    if (transcript.entry.notes.ok !== true) {
      throw new NotMeasured('the live notes route ' + KERNEL_ORIGIN + NOTES_STATE_PATH + ' does not answer a readable fold (' + clip(show(transcript.entry.notes.body ?? transcript.entry.notes.why), 200) + '), so the one write this gate needs cannot be made or witnessed')
    }
    transcript.entry.sessions = await readSessions(cdp, 'g135-list-entry')

    for (let rep = 1; rep <= REPS; rep += 1) {
      for (const arm of ['A', 'B']) {
        const label = arm + String(rep)
        const round = await driveRound(cdp, label, arm, rep)
        transcript.rounds.push(round)
        console.log('  round ' + pad(label, 3) + ' session ' + String(round.sessionId) + ' prompts ' + String(round.prompts.length) + ' complete ' + String(round.complete) + (round.note?.attempted === true ? ' | note ' + show(round.note.status) + ' live ' + show(round.counts.atP1End?.live) + ' -> ' + show(round.counts.afterAdd?.live) : ' | no note added'))
        for (const problem of round.problems) console.log('    PROBLEM ' + problem)
      }
    }
  } catch (error) {
    if (error instanceof NotMeasured) transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    else transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error?.stack === undefined ? '' : '\n' + String(error.stack).split('\n').slice(0, 4).join('\n')))
  } finally {
    try {
      transcript.exit.at = new Date().toISOString()
      const ports = {}
      for (const port of [PORT, KERNEL_PORT, CDP_PORT]) ports[String(port)] = await portAlive(port)
      transcript.exit.ports = ports
      transcript.exit.client = clientIdentity()
      const processes = nodeProcesses()
      transcript.exit.kernel = processes.ok === true ? kernelIdentity(processes.rows) : null
      try {
        transcript.exit.sessions = await readSessions(cdp, 'g135-list-exit')
      } catch (error) {
        transcript.notes.push('note: the session list could not be read at exit (' + describe(error) + ')')
      }
      transcript.exit.notes = await notesState()
      if (transcript.entry.client !== null && transcript.exit.client !== null && transcript.entry.client !== transcript.exit.client) {
        transcript.notes.push('NOT MEASURED in the world: the client was RESTARTED while this gate was running (' + String(transcript.entry.client) + ' -> ' + String(transcript.exit.client) + '), so the client this gate measured no longer exists')
      }
      if (transcript.entry.kernel !== null && transcript.exit.kernel !== null && transcript.entry.kernel.pid !== transcript.exit.kernel.pid) {
        transcript.notes.push('NOT MEASURED in the world: the kernel process was replaced while this gate was running (pid ' + String(transcript.entry.kernel.pid) + ' -> ' + String(transcript.exit.kernel.pid) + '), so the route this gate measured is gone')
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
      const dir = DUMP_OPTION === null ? join(tmpdir(), 'r198-g135') : dirname(resolve(DUMP_OPTION))
      mkdirSync(dir, { recursive: true })
      const path = DUMP_OPTION === null ? join(dir, 'transcript-' + RUN_MARK + '.json') : resolve(DUMP_OPTION)
      writeFileSync(path, JSON.stringify(transcript, null, 1))
      transcript.dumpPath = path
    } catch (error) {
      transcript.notes.push('note: the transcript could not be written out (' + describe(error) + ')')
    }
  }
  return transcript
}

// ---------------------------------------------------------------------------
// The reading: a pure function of the transcript (so --replay re-takes the verdict)
// ---------------------------------------------------------------------------

const surfaceLabel = (op) => {
  if (typeof op === 'string') return op
  if (op !== null && typeof op === 'object' && typeof op.op === 'string') return op.op + ':' + String(op.startSeq ?? '?') + '-' + String(op.endSeq ?? '?')
  return show(op)
}

const analyseRound = (round) => {
  const records = Array.isArray(round?.page?.records) ? round.page.records : []
  const events = records.map((record) => record?.event).filter((event) => event !== null && typeof event === 'object')
  /**
   * One usage reading. cacheReadTokens is an OPTIONAL field and the producer omits it when there is
   * nothing to report, so a message without it is not a missing reading: the total arithmetic is.
   * totalTokens = inputTokens + cacheReadTokens + outputTokens holds for every message that does
   * carry the field (reading 2 checks that against each one), so the difference is the cache read when
   * the field is absent - and there is no cacheWriteTokens on this route to confuse it with.
   */
  const usageOf = (event) => {
    const usage = event?.data?.usage
    if (usage === null || typeof usage !== 'object') return null
    const inputTokens = Number(usage.inputTokens ?? NaN)
    const outputTokens = Number(usage.outputTokens ?? NaN)
    const totalTokens = Number(usage.totalTokens ?? NaN)
    const field = usage.cacheReadTokens === undefined || usage.cacheReadTokens === null ? null : Number(usage.cacheReadTokens)
    const write = usage.cacheWriteTokens === undefined || usage.cacheWriteTokens === null ? null : Number(usage.cacheWriteTokens)
    const arithmetic = Number.isFinite(totalTokens) && Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
      ? totalTokens - inputTokens - outputTokens
      : null
    const derived = field === null && write === null && arithmetic !== null && arithmetic >= 0 ? arithmetic : null
    const cacheReadTokens = field !== null ? field : derived
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cacheReadTokens,
      cacheReadFrom: field !== null ? 'field' : (derived === null ? null : 'totalTokens-inputTokens-outputTokens'),
      hasCacheRead: cacheReadTokens !== null,
      arithmeticAgrees: field === null || arithmetic === null ? null : arithmetic === field,
      arithmetic,
    }
  }
  const assistants = events
    .filter((event) => event.type === 'assistant/message')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      turn: Number(event.data?.turn ?? -1),
      step: Number(event.data?.step ?? -1),
      usage: usageOf(event),
    }))
  const systems = events
    .filter((event) => event.type === 'system/message')
    .map((event) => {
      const content = Array.isArray(event.data?.message?.content) ? event.data.message.content : []
      const text = content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '[' + String(part?.type) + ']')).join('\n')
      return {
        seq: Number(event.seq ?? -1),
        turn: Number(event.data?.turn ?? -1),
        step: Number(event.data?.step ?? -1),
        surfaceOp: surfaceLabel(event.surfaceOp),
        text,
        chars: codePoints(text),
        sha256: sha256(Buffer.from(text, 'utf8')),
      }
    })
  const headers = events
    .filter((event) => event.type === 'request/header')
    .map((event) => {
      const tools = Array.isArray(event.data?.header?.tools) ? event.data.header.tools : []
      return {
        seq: Number(event.seq ?? -1),
        reason: String(event.data?.reason ?? ''),
        toolCount: tools.length,
        names: tools.map((tool) => String(tool?.name ?? '')),
        bytes: Buffer.byteLength(JSON.stringify(tools), 'utf8'),
      }
    })
  const contexts = events
    .filter((event) => event.type === 'request/context')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      provider: String(event.data?.provider ?? ''),
      model: String(event.data?.model ?? ''),
      contextWindow: event.data?.contextWindow ?? null,
      systemPromptUpdate: event.data?.systemPromptUpdate ?? null,
      toolUpdate: event.data?.toolUpdate ?? null,
    }))
  const turnSeqs = events
    .filter((event) => Number.isFinite(Number(event.data?.turn)))
    .map((event) => ({ seq: Number(event.seq ?? -1), turn: Number(event.data.turn) }))
  const turn2FirstSeq = turnSeqs.filter((row) => row.turn === 2).reduce((low, row) => (low === null || row.seq < low ? row.seq : low), null)
  const headBefore = systems.filter((row) => turn2FirstSeq !== null && row.seq < turn2FirstSeq).slice(-1)[0] ?? null
  const headAt = systems.slice(-1)[0] ?? null
  const faceAt1 = headers.filter((row) => turn2FirstSeq !== null && row.seq < turn2FirstSeq).slice(-1)[0] ?? null
  const faceAt2 = headers.slice(-1)[0] ?? null
  const turn1 = assistants.filter((row) => row.turn === 1)
  const turn2 = assistants.filter((row) => row.turn === 2)
  const p1 = turn1.slice(-1)[0] ?? null
  const p2 = turn2[0] ?? null
  const p2After = turn2[1] ?? null
  const noteText = typeof round?.note?.text === 'string' ? round.note.text : null
  const noteOffset = noteText === null || headAt === null ? null : headAt.text.indexOf(noteText)
  return {
    label: String(round?.label ?? ''),
    arm: String(round?.arm ?? ''),
    rep: Number(round?.rep ?? -1),
    sessionId: round?.sessionId ?? null,
    complete: round?.complete === true,
    problems: Array.isArray(round?.problems) ? round.problems : [],
    prompts: Array.isArray(round?.prompts) ? round.prompts : [],
    counts: round?.counts ?? {},
    note: round?.note ?? null,
    noteText,
    turnEnds: events.filter((event) => event.type === 'turn/end').length,
    turnStarts: events.filter((event) => event.type === 'turn/start').length,
    users: events.filter((event) => event.type === 'user/message').length,
    assistants,
    systems,
    headers,
    contexts,
    turn2FirstSeq,
    headBefore,
    headAt,
    headChanged: headBefore !== null && headAt !== null && headBefore.sha256 !== headAt.sha256,
    headCarriesNote: noteText !== null && headAt !== null && headAt.text.includes(noteText),
    headBeforeCarriesNote: noteText !== null && headBefore !== null && headBefore.text.includes(noteText),
    noteOffset,
    faceAt1,
    faceAt2,
    faceSame: faceAt1 !== null && faceAt2 !== null && faceAt1.toolCount === faceAt2.toolCount && faceAt1.bytes === faceAt2.bytes,
    faceChanged: headers.filter((row) => row.reason === 'change').length,
    p1,
    p2,
    p2After,
    route: contexts[0] ?? null,
  }
}

/**
 * The threshold, applied to the recorded pairs. Pure: the same function judges a live transcript and a
 * replayed one, and it reads the threshold out of the transcript so a replay cannot re-tune it.
 */
const applyThreshold = (transcript) => {
  const threshold = {
    share: Number(transcript?.threshold?.share ?? THRESHOLD.share),
    floorTokens: Number(transcript?.threshold?.floorTokens ?? THRESHOLD.floorTokens),
    warmFloorTokens: Number(transcript?.threshold?.warmFloorTokens ?? THRESHOLD.warmFloorTokens),
    statement: String(transcript?.threshold?.statement ?? THRESHOLD_STATEMENT),
    why: String(transcript?.threshold?.why ?? THRESHOLD_WHY),
    warm: String(transcript?.threshold?.warm ?? WARM_STATEMENT),
  }
  const rounds = (Array.isArray(transcript?.rounds) ? transcript.rounds : []).map(analyseRound)
  const byRep = new Map()
  for (const round of rounds) {
    if (round.arm !== 'A' && round.arm !== 'B') continue
    const slot = byRep.get(round.rep) ?? {}
    slot[round.arm] = round
    byRep.set(round.rep, slot)
  }
  const pairs = [...byRep.keys()].sort((left, right) => left - right).map((rep) => {
    const a = byRep.get(rep)?.A ?? null
    const b = byRep.get(rep)?.B ?? null
    const hitA = a?.p2?.usage?.cacheReadTokens ?? null
    const hitB = b?.p2?.usage?.cacheReadTokens ?? null
    const bar = hitB === null ? null : Math.max(threshold.floorTokens, threshold.share * hitB)
    const delta = hitA === null || hitB === null ? null : hitB - hitA
    return {
      rep,
      a,
      b,
      hitA,
      hitB,
      missA: a?.p2?.usage?.inputTokens ?? null,
      missB: b?.p2?.usage?.inputTokens ?? null,
      delta,
      bar,
      materiallyLower: delta === null || bar === null ? null : delta > bar,
      warm: hitB === null ? null : hitB > threshold.warmFloorTokens,
      cold: hitA !== null && hitB !== null && hitA === 0 && hitB === 0,
    }
  })
  const missing = pairs.filter((pair) => pair.hitA === null || pair.hitB === null)
  const coldPairs = pairs.filter((pair) => pair.cold === true)
  const notWarm = pairs.filter((pair) => pair.warm !== true)
  let verdict
  if (pairs.length === 0) verdict = { kind: 'not-measured', why: 'the transcript records no arm pair at all' }
  else if (missing.length > 0) verdict = { kind: 'not-measured', why: 'the pair(s) of repetition ' + show(missing.map((pair) => pair.rep)) + ' carry no cacheReadTokens reading on both arms, so the threshold has no number to apply' }
  else if (coldPairs.length > 0) verdict = { kind: 'not-measured', why: 'repetition ' + show(coldPairs.map((pair) => pair.rep)) + ' recorded zero cache read in BOTH arms: this route reported no cache for that step at all, so a comparison would be vacuous' }
  else if (notWarm.length > 0) verdict = { kind: 'not-measured', why: 'the control arm second request of repetition ' + show(notWarm.map((pair) => pair.rep)) + ' read ' + show(notWarm.map((pair) => pair.hitB)) + ' token(s) from cache, at or below the ' + String(threshold.warmFloorTokens) + '-token warm floor: a cold control has no cache to lose, so the pair is not usable' }
  else if (pairs.every((pair) => pair.materiallyLower === true)) verdict = { kind: 'material', why: 'A read materially less from cache than B in every repetition' }
  else verdict = { kind: 'no-material-cost', why: 'A did not read materially less from cache than B in every repetition: the rewrite showed no cost of the predicted size' }
  return { threshold, rounds, pairs, verdict }
}

const OK = (detail) => ({ ok: true, detail })
const BAD = (detail) => ({ ok: false, detail })
const NOT_MEASURED = (detail) => ({ ok: false, notMeasured: true, detail })

const READINGS = [
  {
    id: '0-the-single-run-lease-and-the-live-world',
    judge: (f) => {
      const t = f.transcript
      const problems = []
      const lines = []
      const ports = t.entry?.ports ?? {}
      const dead = Object.entries(ports).filter(([, alive]) => alive !== true).map(([port]) => port)
      if (dead.length > 0) problems.push('port(s) ' + show(dead) + ' do not answer')
      else lines.push('ports ' + show(Object.keys(ports)) + ' all answer (shell ' + String(t.port) + ', kernel ' + String(t.kernelPort) + ', CDP ' + String(t.cdpPort) + ')')
      if (t.entry?.client === null || t.entry?.client === undefined) problems.push('the client process (dsh-link) could not be named')
      else lines.push('client ' + String(t.entry.client) + ' is running and was NOT started or stopped by this gate')
      if (t.entry?.kernel === null || t.entry?.kernel === undefined) problems.push('the live kernel process could not be named')
      else lines.push('live kernel pid ' + String(t.entry.kernel.pid) + ' on port ' + show(t.entry.kernel.port) + ' with ' + String((t.entry.kernel.patches ?? []).length) + ' --patch layer(s)')
      const lease = t.entry?.lease ?? null
      if (lease === null) problems.push('the single-run lease was never read')
      else if (lease.ok !== true) problems.push('the single-run lease was held: ' + String(lease.why) + ' - holder ' + show(lease.holder))
      else lines.push('single-run lease claimed after ' + String((lease.attempts ?? []).length) + ' scan(s) with ' + String((lease.live ?? {}).files?.length ?? 0) + ' live gate file(s) in the register and ' + String(lease.nodeProcesses ?? 0) + ' node process(es) read; no other consumer')
      const notes = t.entry?.notes ?? null
      if (notes === null || notes.ok !== true) problems.push('the live notes route did not answer a readable fold (' + clip(show(notes?.body ?? notes?.why), 200) + ')')
      else lines.push('the live notes route ' + String(t.kernelOrigin ?? '') + NOTES_STATE_PATH + ' answers ok with limits ' + show(notes.limits) + ' and ' + String(notes.live) + ' live note(s) before this gate wrote anything')
      const route = f.rounds.map((round) => round.route).find((row) => row !== null && row !== undefined) ?? null
      if (route !== null) lines.push('the route the sessions ran on: ' + String(route.provider) + ' / ' + String(route.model) + ', contextWindow ' + show(route.contextWindow) + ', systemPromptUpdate declared: ' + (route.systemPromptUpdate === null ? 'ABSENT' : show(route.systemPromptUpdate)) + ', toolUpdate: ' + (route.toolUpdate === null ? 'ABSENT' : show(route.toolUpdate)))
      if (t.entry?.sessions === null || t.entry?.sessions === undefined) problems.push('the session list could not be read at entry')
      else lines.push('sessions at entry: ' + String(t.entry.sessions.count))
      const drive = t.problems ?? []
      if (drive.length > 0) problems.push('the drive itself reported a problem: ' + clip(drive.join(' | '), 300))
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join('; '))
    },
  },
  {
    id: '1-the-change-really-happened-in-A-and-really-did-not-in-B',
    judge: (f) => {
      const problems = []
      const lines = []
      if (f.rounds.length === 0) return NOT_MEASURED('no round ran at all, so neither the change nor the control has a witness')
      for (const round of f.rounds) {
        const label = round.label
        if (round.complete !== true) {
          return NOT_MEASURED('arm ' + label + ' never reached its second turn/end (' + clip(round.problems.join(' | '), 300) + '), so the step that carries the change was never requested')
        }
        const before = round.counts?.atP1End ?? null
        const after = round.counts?.afterAdd ?? null
        const start = round.counts?.atStart ?? null
        const end = round.counts?.atEnd ?? null
        if (before === null || after === null || start === null || end === null) return NOT_MEASURED('arm ' + label + ' could not read the notes route around its step, so what the variable did is not witnessed')
        if (before.live !== start.live) problems.push('arm ' + label + ': the notes ledger moved between the start of the round (' + String(start.live) + ' live) and the first prompt (' + String(before.live) + ' live), so the round did not start from a settled ledger')
        if (round.arm === 'A') {
          if (round.note?.ok !== true) problems.push('arm ' + label + ': the one note this arm adds was not written (' + clip(show(round.note?.body ?? round.note?.why), 200) + ')')
          if (after.live !== before.live + 1) problems.push('arm ' + label + ': the notes route reports ' + String(before.live) + ' live note(s) before the add and ' + String(after.live) + ' after it, so the ledger did not gain exactly one')
          if (end.live !== after.live) problems.push('arm ' + label + ': the notes route moved again between the add (' + String(after.live) + ' live) and the end of the round (' + String(end.live) + ' live)')
          if (round.headBeforeCarriesNote === true) problems.push('arm ' + label + ': the head in force at the FIRST prompt already carried this arm own note (' + clip(String(round.note?.text), 60) + '), so the change was already in place before the variable')
          if (round.headCarriesNote !== true) problems.push('arm ' + label + ': the head in force at the second prompt does NOT carry this arm own note text, so the rewrite this gate would price never landed on the request')
          if (round.headChanged !== true) problems.push('arm ' + label + ': no system/message commit changed the head across the round, so nothing was rewritten')
          if (problems.length === 0) {
            lines.push('A/' + String(round.rep) + ': the head in force at prompt 1 (system/message seq ' + String(round.headBefore?.seq) + ', ' + String(round.headBefore?.chars) + ' char(s)) carries no occurrence of the note; the head in force at prompt 2 (seq ' + String(round.headAt?.seq) + ', ' + String(round.headAt?.chars) + ' char(s), surfaceOp ' + String(round.headAt?.surfaceOp) + ') carries it at character ' + String(round.noteOffset) + '; the notes route went ' + String(before.live) + ' -> ' + String(after.live) + ' live note(s) (the add answered ' + show(round.note?.status) + ', seq ' + show(round.note?.seq) + ')')
          }
        } else {
          if (round.note?.attempted !== false) problems.push('arm ' + label + ' is the control and it attempted a write')
          if (after.live !== before.live) problems.push('arm ' + label + ': the control writes nothing and the notes route moved ' + String(before.live) + ' -> ' + String(after.live) + ' live note(s)')
          if (end.live !== after.live) problems.push('arm ' + label + ': the control writes nothing and the notes route moved ' + String(after.live) + ' -> ' + String(end.live) + ' live note(s) by the end of the round')
          if (round.headChanged === true) problems.push('arm ' + label + ': the control head CHANGED (system/message seq ' + String(round.headBefore?.seq) + ' sha ' + clip(String(round.headBefore?.sha256), 12) + ' -> seq ' + String(round.headAt?.seq) + ' sha ' + clip(String(round.headAt?.sha256), 12) + '), so "no note change" is not true of this session')
          if (problems.length === 0) {
            lines.push('B/' + String(round.rep) + ': no write was attempted; the notes route held at ' + String(before.live) + ' live note(s) through the round; the head in force at prompt 2 is the SAME system/message the round started with (seq ' + String(round.headAt?.seq) + ', sha256 ' + clip(String(round.headAt?.sha256), 12) + ', ' + String(round.headAt?.chars) + ' char(s)), byte-identical')
          }
        }
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join('; '))
    },
  },
  {
    id: '2-the-adjacent-usage-pairs-are-recorded',
    judge: (f) => {
      const problems = []
      const lines = []
      if (f.rounds.length === 0) return NOT_MEASURED('no round ran, so no usage pair exists')
      const withCache = f.rounds.filter((round) => round.p1?.usage?.hasCacheRead === true || round.p2?.usage?.hasCacheRead === true)
      if (withCache.length === 0) {
        return NOT_MEASURED('no assistant/message in any round carries usage.cacheReadTokens, so this route reports no cache at all and the cost question cannot be read here')
      }
      for (const round of f.rounds) {
        const label = round.label
        if (round.complete !== true) return NOT_MEASURED('arm ' + label + ' never completed, so its pair is missing (' + clip(round.problems.join(' | '), 240) + ')')
        if (round.p1 === null || round.p1.usage === null) problems.push('arm ' + label + ': the first turn has no assistant/message with a usage object')
        if (round.p2 === null || round.p2.usage === null) problems.push('arm ' + label + ': the second turn has no assistant/message with a usage object')
        const accepted = round.prompts.filter((row) => row.accepted === true).length
        if (round.prompts.length !== 2 || accepted !== 2) problems.push('arm ' + label + ': this gate sent ' + String(round.prompts.length) + ' prompt(s) and ' + String(accepted) + ' was accepted, and this design sends exactly 2')
        if (round.turnStarts !== 2) problems.push('arm ' + label + ': the session logged ' + String(round.turnStarts) + ' turn/start(s) and this design runs exactly 2 prompts')
        if (round.turnEnds !== 2) problems.push('arm ' + label + ': the session logged ' + String(round.turnEnds) + ' turn/end(s) and this design runs exactly 2 prompts')
        if (round.faceAt1 === null || round.faceAt2 === null) problems.push('arm ' + label + ': the session logged no request/header on both sides of the variable')
        else if (round.faceSame !== true) problems.push('arm ' + label + ': the tools face moved across the variable (' + String(round.faceAt1.toolCount) + ' tools / ' + String(round.faceAt1.bytes) + ' bytes -> ' + String(round.faceAt2.toolCount) + ' tools / ' + String(round.faceAt2.bytes) + ' bytes), so the tools would be a second variable')
        if (round.faceChanged !== 0) problems.push('arm ' + label + ': the session logged ' + String(round.faceChanged) + ' reason:change header(s) and nothing in this design changes the tool surface')
        for (const message of round.assistants) {
          if (message.usage !== null && message.usage.arithmeticAgrees === false) {
            problems.push('arm ' + label + ': assistant/message seq ' + String(message.seq) + ' carries cacheReadTokens ' + String(message.usage.cacheReadTokens) + ' while its own total minus input minus output is ' + String(message.usage.arithmetic) + ', so the arithmetic this gate reads a missing field with does not hold here')
          }
        }
        if (round.p1 !== null && round.p2 !== null && round.p1.usage !== null && round.p2.usage !== null) {
          if (round.p1.usage.hasCacheRead !== true) problems.push('arm ' + label + ': the first request carries no cacheReadTokens and no total from which to read one')
          if (round.p2.usage.hasCacheRead !== true) problems.push('arm ' + label + ': the second request carries no cacheReadTokens and no total from which to read one')
          lines.push(round.arm + '/' + String(round.rep) + ': prompt 1 ' + show(round.p1.usage) + ' | prompt 2 ' + show(round.p2.usage) + (round.p2After === null ? '' : ' | step after it ' + show(round.p2After.usage)) + ' | tools face ' + String(round.faceAt1?.toolCount) + '/' + String(round.faceAt1?.bytes) + 'B unchanged')
        }
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      const steps = f.rounds.map((round) => round.p2?.step ?? null)
      return OK(lines.join('; ') + '; the step that carries the variable is turn 2 step 1 in every arm (' + show(steps) + '), and the tools face is the same number of names and bytes at both prompts')
    },
  },
  {
    id: '3-the-control-arm-was-warm-and-the-threshold-was-applied',
    judge: (f) => {
      const verdict = f.verdict
      const threshold = f.threshold
      const pairs = f.pairs
      if (verdict.kind === 'not-measured') {
        return NOT_MEASURED('the threshold could not be applied: ' + verdict.why + ' - the numbers recorded are ' + show(pairs.map((pair) => ({ rep: pair.rep, A: pair.hitA, B: pair.hitB }))))
      }
      const table = pairs.map((pair) => 'rep ' + String(pair.rep) + ': A cacheReadTokens ' + String(pair.hitA) + ' (uncached ' + String(pair.missA) + ') vs B ' + String(pair.hitB) + ' (uncached ' + String(pair.missB) + '), delta ' + String(pair.delta) + ', bar ' + String(pair.bar) + ', materially lower ' + String(pair.materiallyLower)).join(' | ')
      return OK('threshold ' + show({ share: threshold.share, floorTokens: threshold.floorTokens, warmFloorTokens: threshold.warmFloorTokens }) + ' applied to ' + String(pairs.length) + ' repetition(s): ' + table + ' => VERDICT ' + verdict.kind.toUpperCase() + ': ' + verdict.why)
    },
  },
  {
    id: '4-the-world-fingerprint-left-behind',
    judge: (f) => {
      const t = f.transcript
      const problems = []
      const lines = []
      const before = t.entry?.sessions ?? null
      const after = t.exit?.sessions ?? null
      if (t.entry?.client === null || t.entry?.client === undefined) problems.push('the client could not be named at entry')
      else if (t.exit?.client === null || t.exit?.client === undefined) problems.push('the client could not be named at exit')
      else if (t.entry.client !== t.exit.client) problems.push('the client was replaced during the run: ' + String(t.entry.client) + ' -> ' + String(t.exit.client))
      else lines.push('the client is the same process from entry to exit: ' + String(t.entry.client))
      if (t.entry?.kernel === null || t.entry?.kernel === undefined) problems.push('the kernel could not be named at entry')
      else if (t.exit?.kernel === null || t.exit?.kernel === undefined) problems.push('the kernel could not be named at exit')
      else if (t.exit.kernel.pid !== t.entry.kernel.pid) problems.push('the kernel was replaced during the run: ' + show(t.entry.kernel.pid) + ' -> ' + show(t.exit?.kernel?.pid))
      else lines.push('the live kernel is the same process from entry to exit: pid ' + String(t.entry.kernel.pid))
      const mine = new Set(f.rounds.map((round) => round.sessionId))
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
        const strays = born.filter((row) => mine.has(row.sessionId) === false)
        if (strays.length > 0) problems.push('the world gained session(s) this gate did not create: ' + show(strays.map((row) => row.sessionId)))
        if (born.length !== mine.size) problems.push('this gate created ' + String(mine.size) + ' session(s) and the world gained ' + String(born.length))
        else lines.push('sessions ' + String(before.count) + ' -> ' + String(after.count) + ' and the ' + String(born.length) + ' new one(s) are this gate own arms (' + show([...mine].map((id) => String(id).slice(0, 18))) + '), left in place as the evidence')
        if (moved.length === 0 && strays.length === 0) lines.push('every one of the ' + String(before.rows.length) + ' pre-existing session(s) kept its asOfSeq')
      }
      const entryNotes = t.entry?.notes ?? null
      const exitNotes = t.exit?.notes ?? null
      const aRounds = f.rounds.filter((round) => round.arm === 'A').length
      if (entryNotes?.ok !== true || exitNotes?.ok !== true) problems.push('the notes route was not readable on both sides of the run')
      else {
        const expected = entryNotes.live + aRounds
        if (exitNotes.live !== expected) problems.push('the notes route reads ' + String(exitNotes.live) + ' live note(s) at exit and this gate added exactly ' + String(aRounds) + ' to ' + String(entryNotes.live) + ', so the ledger moved by something else')
        else lines.push('the live ledger grew by exactly this gate own ' + String(aRounds) + ' note(s): ' + String(entryNotes.live) + ' -> ' + String(exitNotes.live) + ' live note(s), read from the product own route at both ends')
      }
      const stopped = (t.notes ?? []).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
      for (const note of stopped) problems.push(String(note))
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK(lines.join('; '))
    },
  },
]

const buildFacts = (transcript) => {
  const applied = applyThreshold(transcript)
  return { transcript, threshold: applied.threshold, rounds: applied.rounds, pairs: applied.pairs, verdict: applied.verdict }
}

const runJudges = (facts) => READINGS.map((reading) => {
  try {
    const verdict = reading.judge(facts)
    return { id: reading.id, ok: verdict.ok === true, notMeasured: verdict.notMeasured === true, detail: String(verdict.detail ?? '') }
  } catch (error) {
    return { id: reading.id, ok: false, notMeasured: false, detail: 'the reading threw: ' + describe(error) }
  }
})

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict of its own
// ---------------------------------------------------------------------------

const printTranscript = (t, f) => {
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell: ' + SHELL_ORIGIN + ' through CDP ' + String(CDP_PORT) + ' (page ' + String(t.pageUrl ?? '(unread)') + '); the client was already running - this gate never starts or stops it')
  console.log('  kernel: ' + (t.entry?.kernel === null || t.entry?.kernel === undefined ? '(not read)' : 'pid ' + String(t.entry.kernel.pid) + ' port ' + show(t.entry.kernel.port) + ' started ' + String(t.entry.kernel.created)) + ' | notes route ' + String(t.kernelOrigin) + NOTES_STATE_PATH)
  console.log('  client: ' + String(t.entry?.client ?? '(not read)') + ' at entry, ' + String(t.exit?.client ?? '(not read)') + ' at the end')
  console.log('  ports: ' + show(t.entry?.ports) + ' at entry, ' + show(t.exit?.ports) + ' at the end')
  const lease = t.entry?.lease ?? null
  console.log('  single-run lease: ' + (lease === null ? '(not read)' : (lease.ok === true ? 'claimed after ' + String((lease.attempts ?? []).length) + ' scan(s); ' + String(lease.nodeProcesses ?? 0) + ' node process(es); register ' + String((lease.live ?? {}).files?.length ?? 0) + ' live file(s)' : 'HELD: ' + String(lease.why) + ' - ' + show(lease.holder))))
  console.log('  the notes route at entry: limits ' + show(t.entry?.notes?.limits) + ', ' + String(t.entry?.notes?.live) + ' live note(s)')
  console.log('  the design: ' + show(t.design?.interleave) + ' with prompts ' + show(t.design?.prompts))
  for (const round of f.rounds) {
    console.log('  round ' + pad(round.label, 3) + ' session ' + String(round.sessionId) + ' | prompts ' + String(round.prompts.length) + ' accepted ' + show(round.prompts.map((row) => row.accepted)) + ' | user/message ' + String(round.users) + ', turn/end ' + String(round.turnEnds) + ', complete ' + String(round.complete))
    console.log('        notes route: start ' + show(round.counts?.atStart?.live) + ' -> before prompt 2 ' + show(round.counts?.atP1End?.live) + ' -> after the variable ' + show(round.counts?.afterAdd?.live) + ' -> end ' + show(round.counts?.atEnd?.live) + (round.note?.attempted === true ? ' | the add answered ' + show(round.note.status) + ' seq ' + show(round.note.seq) + ' with text ' + show(round.note.text) : ' | no write'))
    console.log('        prompt 1 ' + show(round.p1?.usage) + ' at seq ' + show(round.p1?.seq))
    console.log('        prompt 2 ' + show(round.p2?.usage) + ' at seq ' + show(round.p2?.seq) + (round.p2After === null ? '' : ' | the step after it ' + show(round.p2After?.usage) + ' at seq ' + String(round.p2After?.seq)))
    console.log('        system/message (' + String(round.systems.length) + '): ' + round.systems.map((row) => 'seq ' + String(row.seq) + ' ' + row.surfaceOp + ' ' + String(row.chars) + 'ch sha ' + clip(row.sha256, 12) + ' note=' + String(round.noteText !== null && row.text.includes(round.noteText))).join(' | '))
    console.log('        request/header (' + String(round.headers.length) + '): ' + round.headers.map((row) => 'seq ' + String(row.seq) + ' ' + row.reason + ' ' + String(row.toolCount) + ' tools / ' + String(row.bytes) + 'B').join(' | '))
    if (round.route !== null) console.log('        route: ' + String(round.route.provider) + ' / ' + String(round.route.model) + ' systemPromptUpdate=' + (round.route.systemPromptUpdate === null ? 'ABSENT' : show(round.route.systemPromptUpdate)))
    for (const problem of round.problems) console.log('        PROBLEM ' + problem)
  }
  console.log('  sessions: ' + String(t.entry?.sessions?.count ?? '?') + ' at entry -> ' + String(t.exit?.sessions?.count ?? '?') + ' at the end; the arm sessions are LEFT IN PLACE (they are the evidence)')
  console.log('  the dump of the judged record: ' + String(t.dumpPath ?? '(not written)'))
  for (const note of t.notes ?? []) console.log('  ' + note)
  for (const problem of t.problems ?? []) console.log('  PROBLEM ' + problem)
  console.log('')
  console.log('== the threshold, fixed before the run ==')
  console.log('  ' + f.threshold.statement)
  console.log('  why: ' + f.threshold.why)
  console.log('  ' + f.threshold.warm)
  console.log('  pairs (the step that carries the variable, turn 2 step 1, both arms):')
  for (const pair of f.pairs) {
    console.log('    rep ' + String(pair.rep) + ': A cacheReadTokens ' + pad(show(pair.hitA), 8) + ' uncached ' + pad(show(pair.missA), 7) + ' | B cacheReadTokens ' + pad(show(pair.hitB), 8) + ' uncached ' + pad(show(pair.missB), 7) + ' | delta ' + pad(show(pair.delta), 8) + ' bar ' + pad(show(pair.bar), 6) + ' warm ' + pad(show(pair.warm), 5) + ' -> materially lower ' + show(pair.materiallyLower))
  }
  console.log('  VERDICT: ' + f.verdict.kind + ' - ' + f.verdict.why)
  console.log('  NOT MEASURED (the third state, named): provider-internal cache policy - eviction, TTL, block granularity and where this route actually keys its cache. This gate measured this machine, this route, these sessions, at these two moments; a verdict of no-material-cost does not say the provider never evicts.')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const summary = (f, verdicts, where) => {
  const failed = verdicts.filter((entry) => entry.ok !== true && entry.notMeasured !== true)
  const notMeasured = verdicts.filter((entry) => entry.notMeasured === true)
  console.log('')
  console.log('==' + where + ': readings ==')
  for (const verdict of verdicts) {
    const mark = verdict.ok === true ? 'ok   ' : verdict.notMeasured === true ? 'n/a  ' : 'FAIL '
    console.log('  ' + mark + verdict.id)
    console.log('        ' + verdict.detail)
  }
  console.log('')
  console.log('notes-cost-live: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured')
  console.log('  verdict on the question: ' + f.verdict.kind.toUpperCase() + ' - ' + f.verdict.why)
  console.log('  NOT MEASURED (third state): provider-internal cache policy (eviction, TTL, block granularity)')
  if (failed.length > 0) {
    for (const verdict of failed) console.log('    FAILED ' + verdict.id + ' -> ' + clip(verdict.detail, 400))
    return 1
  }
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('    SKIP ' + verdict.id + ' -> ' + clip(verdict.detail, 400))
    return 3
  }
  return 0
}

const main = async () => {
  console.log('gate 135 notes-cost-live (R198 P2) - what ONE note change costs this provider cache (shell ' + SHELL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  the threshold is fixed before the run: ' + THRESHOLD_STATEMENT)
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
    if (transcript?.schema !== 'r198-g135-transcript/1') {
      console.log('')
      console.log('SKIP: the file at ' + resolve(REPLAY_PATH) + ' is not a transcript this gate wrote (schema ' + show(transcript?.schema) + ')')
      return 3
    }
    console.log('  replay: judging ' + resolve(REPLAY_PATH) + ' - the world is NOT touched and NO prompt is sent')
  } else {
    try {
      transcript = await runWorld()
    } catch (error) {
      if (error instanceof NotMeasured) {
        console.log('')
        console.log('SKIP: ' + error.message)
        console.log('notes-cost-live: 0 readings - this gate declined to measure [exit 3]')
        return 3
      }
      console.log('')
      console.log('SKIP: the gate could not run at all: ' + describe(error))
      console.log(String(error?.stack ?? '').split('\n').slice(0, 5).join('\n'))
      return 3
    }
  }
  const facts = buildFacts(transcript)
  if (REPLAY_PATH === null && (transcript.problems ?? []).length > 0) {
    console.log('')
    console.log('== the drive did not complete ==')
    for (const problem of transcript.problems) console.log('  ' + problem)
    for (const note of transcript.notes ?? []) console.log('  ' + note)
    console.log('notes-cost-live: the world could not be driven to the end, so nothing was judged [exit 3]')
    return 3
  }
  try {
    printTranscript(transcript, facts)
  } catch (error) {
    console.log('  (the printout of the measured transcript failed: ' + describe(error) + ' - the readings below are unaffected)')
  }
  const verdicts = runJudges(facts)
  const code = summary(facts, verdicts, REPLAY_PATH === null ? ' live run' : ' replay of ' + String(REPLAY_PATH))
  const stopped = (transcript.notes ?? []).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
  if (stopped.length > 0 && code === 0) {
    for (const note of stopped) console.log('SKIP: ' + note)
    return 3
  }
  console.log('exit ' + String(code) + (code === 0 ? ' - the readings held and the threshold was applied (the verdict direction does not choose the code)' : code === 1 ? ' - a reading failed' : ' - a named third state: this gate could not measure it here'))
  return code
}

process.exitCode = await main()
