#!/usr/bin/env node
/**
 * Gate 205 (R204 P1) - collab-tools-live-turn: a MODEL writes the declaration rows.
 *
 * Contract: docs/handoff/R204-contract.md section P1. Subject: the two tools the 'teams' group
 * carries for the collaboration bus - team_declare_capability and team_heartbeat - CALLED BY A MODEL
 * IN A LIVE SESSION, and the rows those calls leave in the control ledger. R196 section 2 measured
 * the hole this gate exists for: every declaration row the ledger held had been written by a TEST
 * SCRIPT, so 'an agent will use the team tools at all' was an assumption, not a measurement.
 *
 * THE DRIVE, and what it costs: ONE session through the shell's own HTTP api (the same
 * {type:'client-request', rpcId, method, payload:{args}} envelope the shell page uses), ONE prompt,
 * one model round. The prompt asks for four calls and nothing else: read the group directory
 * (tool_groups), open the one group whose members are the team_ tools (tool_groups_declare, which is
 * what makes the two tools visible at the NEXT step - gates 117's mechanism, measured there),
 * then in the next step call team_declare_capability once with an attribution this gate names, and
 * team_heartbeat once with the same attribution. No UI is clicked, no text is typed, no setting is
 * changed, and nothing is started or stopped: the client, the kernel and the CDP endpoint were
 * already running and this gate leaves them running.
 *
 * WHY THE ATTRIBUTION IS IN THE ARGUMENTS. The tools stamp the caller's 'team' argument onto the
 * record's own 'actor' field (plugins/dsh-link-collab/src/index.ts:7834, :7944), which is the field
 * the kernel's own team events carry the team in and the field the fold reads first. The prompt
 * therefore names team = the SESSION'S OWN ID PREFIX (session-xxxxxxxx, a legal ledger name: the
 * grammar at src/index.ts:7615 says so and a session id passes it), so 'this row is this session's'
 * is read from the ROW ITSELF and never from 'a row appeared while we were running'.
 *
 * SIX READINGS, each able to fail on its own evidence:
 *
 *   0-the-model-drove-the-two-calls
 *        The drive's premise and the only place model compliance is named: this reading is NEVER
 *        red. No call of either tool, two calls of one of them, or a result that is a named refusal
 *        (Error: DECLARE_*: ...) leaves it NOT MEASURED, and readings 1-3 NOT MEASURED with it - a
 *        named exit 3, which is a third state and not a verdict on the product.
 *   1-both-calls-are-one-each-in-the-prompted-turn
 *        Exactly one team_declare_capability call and exactly one team_heartbeat call, both in the
 *        turn the one prompt started, each answered by a tool/result event that answers THAT call id,
 *        and no result that failed with anything other than a named refusal. A lost result, a result
 *        bound to another call, or an unnamed internal failure is RED here and nowhere else.
 *   2-the-ledger-grew-by-exactly-two-rows-this-session-wrote
 *        The control log (control.jsonl, in the directory the teams route names) is read before and
 *        after: the first N bytes after the round hash to the bytes the whole file hashed to before
 *        (the log is appended to, not rewritten), and exactly TWO rows appeared - one capability/state
 *        and one member/heartbeat - whose OWN 'actor' field this session's id prefix, and whose
 *        payload.id is the one member. Every number in the detail is this gate's own arithmetic over
 *        the file.
 *   3-those-rows-fold-into-the-registry-the-route-serves
 *        GET /api/dsh-link-teams/state after the round: the capability registry lists that member
 *        with exactly the capabilities the row declared, from exactly that row's seq, with the
 *        capability index naming it under each; and the liveness fold holds the heartbeat row's own
 *        instant for that member, from that row's seq. The route re-folds on every GET, so this is
 *        the ledger's own fold and not a second opinion.
 *   4-the-team-tools-were-visible-only-because-the-group-opened
 *        Gate 117's evidence shape, applied to this round: the session's FIRST request/header carries
 *        none of the group's members, no reason:change header exists before the model's own
 *        tool_groups_declare call, exactly one reason:change header follows it, and the names that
 *        header adds are EXACTLY the group's members - name for name, in the table's order, nothing
 *        removed, nothing added. Both tools the model called are members of that group, which is what
 *        makes the visibility attributable to the opening.
 *        Scope, stated: the four names team_task_create/get/list/update are in this build's entry face
 *        because they are registered on the agent's own layer and a group cannot move them
 *        (plugins/dsh-link-groups/cordis.patch.yml:45-50, R185-F). They are NOT members of any group,
 *        so this reading names every team_* name the entry face carries and judges only the group's
 *        own members. A literal 'no team_* name at all' is false in this build by construction, and
 *        saying so is part of the reading rather than a hole in it.
 *   5-the-world-was-put-back
 *        The single-run lease is released and read back (held=false), the session this gate created
 *        is still in session/list left open as the evidence and still holds the group open in its last
 *        header, no other session moved (every asOfSeq the same as at entry), the only new session is
 *        this gate's own, and the client and kernel pids are the same at exit as at entry.
 *
 * WHAT THIS GATE DOES NOT JUDGE, by name: whether the capability the model declared is TRUE (that is
 * a claim about the model, not about the product); whether the model understood the directory text it
 * read; anything about pixels, the pane, approvals or a second turn. It sends no second prompt and it
 * writes nothing into any product store - the rows it reads are the ones the model's own calls wrote.
 *
 * THE LEASE. Other live gates drive the same client, so this gate claims the shell's panel lease
 * (POST /__shell/panel {op:'lease', leaseOp:'claim'}) before it touches anything, waits while somebody
 * else holds it (bounded), and exits 3 NAMING THE HOLDER if it never gets it. The release is read back
 * and judged (reading 5), not treated as housekeeping. It also refuses (exit 3, by name) to run while
 * another live consumer from scripts/verify-all.mjs's live register is running.
 *
 * --replay <file> judges a transcript this gate wrote with ZERO live reads: no shell call, no lease,
 * no CDP, no prompt. That is how the verdict is re-taken without paying for a round. The transcript is
 * written to %TEMP%/r204-p1-collab-tools-live/ by default (--dump <file> puts it elsewhere); this gate
 * writes no file inside the repository.
 *
 * Exit 0 all readings held | 1 a measured reading failed | 3 this gate could not measure here: no
 * shell answering, no teams route or no control log, the live table could not be resolved or a live
 * patch layer overrides it, another live consumer or another lease holder, the shell declined the
 * session or the prompt, the round never reached turn/end, or the model did not drive the two calls
 * the message names. A reading that cannot be measured is a named third state, never green.
 *
 * Usage: node scripts/verify-collab-tools-live-turn.mjs [--port 31761] [--kernel-port 31760]
 *          [--deadline-ms 240000] [--lease-wait-ms 180000] [--poll-ms 3000] [--dump <file>]
 *          [--replay <file>]
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callEndpoint, requestJson } from './lib/http.mjs'

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
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}

const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const REPLAY_PATH = option('--replay', null)
const DUMP_OPTION = option('--dump', null)
const DEADLINE_MS = Number(option('--deadline-ms', '240000'))
const LEASE_WAIT_MS = Number(option('--lease-wait-ms', '180000'))
const LEDGER_WAIT_MS = Number(option('--ledger-wait-ms', '20000'))
const POLL_MS = Number(option('--poll-ms', '3000'))
/** The lease outlives the whole run on purpose: a gate that dies must not leave the next one waiting. */
const LEASE_TTL_MS = 420000
const ORIGIN = 'http://127.0.0.1:' + String(PORT)
const ROUTE = '/api/dsh-link-teams/state'
const HOLDER = 'verify-collab-tools-live'
const LEDGER_FILE = 'control.jsonl'
const SCHEMA = 'r204-p1-collab-tools-live/1'
/** The two tools the one message asks the model for (the subject), and the two that open the way. */
const DECLARE_TOOL = 'team_declare_capability'
const HEARTBEAT_TOOL = 'team_heartbeat'
const TOUCHED_TOOLS = [DECLARE_TOOL, HEARTBEAT_TOOL]
const DIRECTORY_TOOL = 'tool_groups'
const OPEN_TOOL = 'tool_groups_declare'
/** The record kinds those two calls append, read from the plugin's own exports. */
const CAPABILITY_KIND = 'capability/state'
const HEARTBEAT_KIND = 'member/heartbeat'
/** The capability name the message asks for: a name, per the ledger's own grammar, not a sentence. */
const CAPABILITY = 'r204-live-turn-witness'
/** The bundle whose patch file declares the group table this gate anchors reading 4 on. */
const BUNDLE = 'dsh-link-groups'
/**
 * A thrown declaring tool renders as 'Error: <CODE>: <detail>' (DeclareRefusal, src/index.ts:7624), and
 * the only code family these two tools throw is DECLARE_* - so a refusal is recognised by its own
 * family rather than by 'the message has an upper-case word in front of a colon' (which would read an
 * ENOENT from an internal failure as a refusal and turn a red into a named third state).
 */
const NAMED_REFUSAL = /\bDECLARE_[A-Z0-9_]+:/

const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))
const obj = (value) => (value !== null && typeof value === 'object' ? value : {})
const list = (value) => (Array.isArray(value) ? value : [])
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
  return value.length <= width ? value : value.slice(0, width) + '...'
}
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sorted = (values) => values.map(String).slice().sort()
const sameSet = (left, right) => same(sorted(left), sorted(right))
const pad = (text, width) => (String(text).length >= width ? String(text) : String(text) + ' '.repeat(width - String(text).length))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Does this string carry the session id? The rule gate 134 states for the same question: equal,
 * prefixed or containing. The message names the bare prefix, so equality is the expected answer and
 * the other two forms are the same fact written with a suffix or a label in front.
 */
const carriesSession = (value, prefix) =>
  typeof value === 'string' && value !== '' && typeof prefix === 'string' && prefix !== ''
  && (value === prefix || value.startsWith(prefix) || value.includes(prefix))

/**
 * The attribution this gate names in the one message: session-xxxxxxxx, the head of the id the shell
 * hands back. It is a legal ledger name (1-64 of [A-Za-z0-9._:@-], starting with a letter or a digit),
 * and the member the message names carries it too, so both rows are readable as this session's.
 */
const attributionOf = (sessionId) => {
  const head = String(sessionId).startsWith('session-') ? 'session-' : ''
  const rest = String(sessionId).slice(head.length)
  const prefix = head + rest.slice(0, 8)
  return { sessionPrefix: prefix, team: prefix, member: prefix + '-witness', capability: CAPABILITY }
}

/**
 * THE one message. It names the four tools, the exact arguments of the two that are the subject, and
 * the stop condition - nothing else. It deliberately does not decide what the group's id is: the model
 * has to read the directory, and it is told the one property that identifies the group (its members
 * are the team_ tools) rather than the id itself.
 */
const buildMessage = (attribution) => [
  '这是协作总线的一次自检，只做下面四步，不要做别的事：',
  '第一步：调用一次 ' + DIRECTORY_TOOL + '（它不带参数），把结果原样读出来，找到那个成员名全部以 team_ 开头的组，记下它的确切 id。',
  '第二步：紧接着调用一次 ' + OPEN_TOOL + '，参数严格是 open: [<第一步读到的那个组的确切 id>]，把这个组打开。这一步不要调用 ' + DECLARE_TOOL + '，也不要调用 ' + HEARTBEAT_TOOL + '：它们要到下一步才会出现在你的工具面里。',
  '第三步：在下一步（工具面已经变了以后），严格按下面的参数各调用一次：',
  '  - ' + DECLARE_TOOL + '，参数 member = "' + attribution.member + '"，capabilities = ["' + attribution.capability + '"]，team = "' + attribution.team + '"；',
  '  - ' + HEARTBEAT_TOOL + '，参数 member = "' + attribution.member + '"，team = "' + attribution.team + '"，不要传 at。',
  '这两个工具各只调用一次，不要重复调用，也不要调用别的工具。',
  '第四步：停下来，用一句话说明这两个工具各自返回了什么，不要再调用任何工具。',
].join('\n')

// ---------------------------------------------------------------------------
// The instrument: processes (identity and the single-run guard), files, the shell
// ---------------------------------------------------------------------------

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

const pwshOnce = (command, timeoutMs = 40000) => {
  try {
    return spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
  } catch (error) {
    return { status: -1, stdout: '', stderr: describe(error) }
  }
}

/** The identity of the desktop client: pid@start-time. A restart of this is a third state, not a red. */
const clientIdentity = () => {
  const done = pwshOnce("[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })", 30000)
  if (done.status !== 0) return null
  const text = String(done.stdout === undefined ? '' : done.stdout).trim()
  return text === '' ? null : text
}

/** This gate's own ancestor chain, so 'another consumer' is never this process's own parent. */
const ancestorPids = () => {
  const query = '$ids = @(); $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID);'
    + ' for ($i = 0; $i -lt 12 -and $p -ne $null; $i++) { $ids += [string]$p.ProcessId;'
    + ' if ($p.ParentProcessId -eq 0) { break }; $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [string]$p.ParentProcessId) -ErrorAction SilentlyContinue }'
    + ' [string]::Join(",", $ids)'
  const done = pwshOnce(query, 30000)
  if (done.status !== 0) return []
  return String(done.stdout === undefined ? '' : done.stdout).trim().split(',').map((id) => id.trim()).filter((id) => id !== '')
}

/** Every node process, so the guard and the kernel identity are read from the machine, not assumed. */
const nodeProcesses = () => {
  const query = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + [string]$_.CommandLine }'
  const done = pwshOnce(query)
  if (done.status !== 0) return { ok: false, why: 'the process list could not be read: ' + clip(String(done.stderr === undefined ? '' : done.stderr), 160), rows: [] }
  const rows = String(done.stdout === undefined ? '' : done.stdout)
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
  const patches = [...row.command.matchAll(/--patch\s+("([^"]+)"|(\S+))/g)].map((match) => match[2] === undefined ? match[3] : match[2])
  const port = /--port\s+(\d+)/.exec(row.command)
  return { pid: row.pid, command: clip(row.command, 300), patches, port: port === null ? null : Number(port[1]) }
}

/** Another live consumer, by the register's own list of live files and the processes running them. */
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) !== true) return { files: [], why: 'scripts/verify-all.mjs is not there' }
  const text = readFileSync(path, 'utf8')
  const files = new Set()
  let count = 0
  for (const row of text.matchAll(/\{\s*name:\s*'([^']+)',\s*kind:\s*'(offline|live|kernel)',\s*cmd:\s*\[([^\]]*)\]/g)) {
    count += 1
    if (row[2] !== 'live') continue
    for (const word of row[3].split(',')) {
      const clean = word.trim().replace(/^'|'$/g, '')
      if (/\.mjs$/.test(clean) === true) files.add(clean.split('/').pop())
    }
  }
  return { files: [...files], why: count === 0 ? 'the register could not be parsed, so every verify-*/probe-* process counts as a live consumer' : null, parsed: count }
}

const otherConsumers = (rows, live, ancestors) => {
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors === undefined ? [] : ancestors)])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  const SELF = 'verify-collab-tools-live-turn.mjs'
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

const readText = (path) => {
  try {
    return { ok: true, text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { ok: false, why: describe(error) }
  }
}
const readJsonFile = (path) => {
  const read = readText(path)
  if (read.ok !== true) return { ok: false, why: read.why }
  try {
    return { ok: true, value: JSON.parse(read.text) }
  } catch (error) {
    return { ok: false, why: 'not JSON: ' + describe(error) }
  }
}
const fileFacts = (path) => {
  try {
    const bytes = readFileSync(path)
    return { path, bytes: bytes.length, sha256: sha256(bytes) }
  } catch (error) {
    return { path, bytes: null, sha256: null, why: describe(error) }
  }
}

/**
 * The bundle layer's group table, parsed out of the patch file the plugin's own package.json names.
 * The parse is indentation-driven because that is what YAML is here, and it is kept to exactly the
 * keys this gate reads: '- id:' opens a group, 'tools:' swallows the '- name' items that follow it,
 * and state/auto.when are read by name. Comment lines are skipped (the patch file explains itself).
 */
const parseGroupTable = (text) => {
  const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/)
  const at = lines.findIndex((line) => /^\s*groups:\s*$/.test(line))
  if (at === -1) return { ok: false, why: 'the bundle patch has no groups: block' }
  const base = (lines[at].match(/^\s*/) === null ? [''] : lines[at].match(/^\s*/))[0].length
  const groups = []
  let current = null
  let mode = null
  for (let index = at + 1; index < lines.length; index += 1) {
    const raw = lines[index]
    if (/^\s*$/.test(raw) === true || /^\s*#/.test(raw) === true) continue
    const indent = (raw.match(/^\s*/) === null ? [''] : raw.match(/^\s*/))[0].length
    const body = raw.trim()
    if (indent <= base) break
    const id = body.match(/^-\s*id:\s*(\S+)\s*$/)
    if (id !== null) {
      current = { id: id[1], title: null, tools: [], state: null, autoWhen: null, provider: null }
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
    else if (key[1] === 'title') current.title = value
    else if (key[1] === 'provider') current.provider = value
    else if (key[1] === 'auto') mode = 'auto'
    else if (key[1] === 'when' && previous === 'auto') current.autoWhen = value
  }
  if (groups.length === 0) return { ok: false, why: 'the groups: block of the bundle patch declares no group' }
  return { ok: true, groups }
}

/**
 * Which table is live: the live profile's package.json says where this bundle is linked, that
 * directory's package.json says which patch file is its bundle layer, and THAT file is the table.
 * Any live patch layer that names the bundle at all makes this gate decline by name: it judges one
 * table and will not guess which layer won (gate 117's rule, unchanged).
 */
const resolveSubject = (kernel, appdata) => {
  let profileDir = null
  const patchHome = kernel !== null && kernel.patches.length > 0 ? dirname(resolve(kernel.patches[0])) : null
  if (patchHome !== null && existsSync(join(patchHome, 'profiles', 'web')) === true) profileDir = join(patchHome, 'profiles', 'web')
  else if (appdata !== null) {
    const guess = join(appdata, 'dev.dshlink.client', 'dsh-link', 'kernel-home', 'profiles', 'web')
    if (existsSync(guess) === true) profileDir = guess
  }
  if (profileDir === null) return { ok: false, why: 'the live profile could not be located (no --patch layer was read and no kernel-home/profile was found), so this gate cannot read the group table the live client is running' }
  const profilePkgPath = join(profileDir, 'package.json')
  const profilePkg = readJsonFile(profilePkgPath)
  if (profilePkg.ok !== true) return { ok: false, why: 'the live profile has no readable package.json at ' + profilePkgPath + ' (' + profilePkg.why + ')' }
  const bundles = list(obj(obj(profilePkg.value).dsh).profile ? obj(obj(profilePkg.value).dsh).profile.bundles : []).map(String)
  if (bundles.includes(BUNDLE) !== true) return { ok: false, why: 'the live profile does not mount ' + BUNDLE + ' (bundles: ' + show(bundles) + '), so there is no live group table to judge' }
  const link = String(obj(obj(profilePkg.value).dependencies)[BUNDLE] === undefined ? '' : obj(obj(profilePkg.value).dependencies)[BUNDLE])
  const pluginDir = link.startsWith('link:') ? resolve(link.slice('link:'.length)) : join(PROJECT, 'plugins', BUNDLE)
  const pluginPkg = readJsonFile(join(pluginDir, 'package.json'))
  if (pluginPkg.ok !== true) return { ok: false, why: 'the mounted package has no readable package.json at ' + join(pluginDir, 'package.json') + ' (' + pluginPkg.why + ')' }
  const patchName = typeof obj(obj(pluginPkg.value).dsh).bundle === 'object' && typeof obj(obj(obj(pluginPkg.value).dsh).bundle).patch === 'string' ? obj(obj(obj(pluginPkg.value).dsh).bundle).patch : 'cordis.patch.yml'
  const configPath = resolve(pluginDir, patchName)
  const configText = readText(configPath)
  if (configText.ok !== true) return { ok: false, why: 'the bundle layer ' + configPath + ' is not readable (' + configText.why + ')' }
  const layers = []
  for (const path of [...(kernel === null ? [] : kernel.patches), join(profileDir, 'cordis.patch.yml')]) {
    const absolute = resolve(path)
    if (existsSync(absolute) !== true) continue
    const text = readText(absolute)
    if (text.ok !== true) continue
    const mentions = text.text.split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter((row) => row.line.includes(BUNDLE) === true && row.line.startsWith('#') === false)
    layers.push({ path: absolute, file: fileFacts(absolute), mentions })
  }
  const overrides = layers.filter((layer) => layer.mentions.length > 0)
  if (overrides.length > 0) {
    return { ok: false, why: 'a live patch layer names ' + BUNDLE + ' (' + overrides.map((layer) => layer.path + ':' + layer.mentions.map((row) => row.number).join(',')).join('; ') + '), so the table this gate reads may not be the one the live kernel mounted; this gate will not guess which layer won' }
  }
  const table = parseGroupTable(configText.text)
  if (table.ok !== true) return { ok: false, why: 'the bundle layer ' + configPath + ' ' + table.why }
  const candidates = table.groups.filter((group) => TOUCHED_TOOLS.every((tool) => group.tools.includes(tool) === true))
  if (candidates.length !== 1) {
    return { ok: false, why: 'the live table declares ' + String(candidates.length) + ' group(s) carrying both ' + show(TOUCHED_TOOLS) + ' (from ' + configPath + ': ' + show(table.groups.map((group) => ({ id: group.id, tools: group.tools }))) + '), and this gate judges exactly one' }
  }
  const config = fileFacts(configPath)
  return {
    ok: true,
    profileDir,
    profilePkgPath,
    profilePkg: fileFacts(profilePkgPath),
    mounted: link,
    pluginDir,
    configPath,
    configBytes: config.bytes,
    configSha256: config.sha256,
    groups: table.groups,
    targetId: candidates[0].id,
    targetTools: candidates[0].tools,
    targetState: candidates[0].state,
    targetAutoWhen: candidates[0].autoWhen,
    layers: layers.map((layer) => ({ path: layer.path, file: layer.file, mentions: layer.mentions.length })),
    readAt: new Date().toISOString(),
  }
}

/**
 * The control log, read as bytes. The prefix facts exist so 'the log was appended to' is a measurement:
 * the first N bytes of the file after the round are hashed and compared with the whole file's hash
 * before it.
 */
const readLedger = (directory, prefixBytes = null) => {
  if (typeof directory !== 'string' || directory === '') return { ok: false, path: null, prefixBytes, prefixSha256: null, why: 'the teams route named no ledger directory' }
  const path = join(directory, LEDGER_FILE)
  let bytes = null
  try {
    bytes = readFileSync(path)
  } catch (error) {
    return { ok: false, path, prefixBytes, prefixSha256: null, why: describe(error) }
  }
  const text = bytes.toString('utf8')
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const parsed = []
  let unreadable = 0
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line))
    } catch {
      unreadable += 1
    }
  }
  const seqs = parsed.map((row) => Number(obj(row).seq)).filter((seq) => Number.isFinite(seq))
  const prefix = prefixBytes === null ? null : bytes.subarray(0, Math.min(prefixBytes, bytes.length))
  return {
    ok: true,
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    prefixBytes,
    prefixSha256: prefix === null ? null : sha256(prefix),
    rows: lines.length,
    parsed,
    unreadable,
    maxSeq: seqs.length === 0 ? null : Math.max.apply(null, seqs),
    endsWithNewline: /\n$/.test(text),
    why: null,
  }
}
/** What the transcript keeps of one read: everything the judge needs, and never the whole file. */
const ledgerFacts = (snapshot) => ({
  ok: snapshot.ok === true,
  path: snapshot.path,
  bytes: snapshot.ok === true ? snapshot.bytes : null,
  sha256: snapshot.ok === true ? snapshot.sha256 : null,
  prefixBytes: snapshot.prefixBytes === null || snapshot.prefixBytes === undefined ? null : snapshot.prefixBytes,
  prefixSha256: snapshot.prefixSha256 === undefined ? null : snapshot.prefixSha256,
  rows: snapshot.ok === true ? snapshot.rows : null,
  maxSeq: snapshot.ok === true ? snapshot.maxSeq : null,
  unreadable: snapshot.ok === true ? snapshot.unreadable : null,
  endsWithNewline: snapshot.ok === true ? snapshot.endsWithNewline : null,
  why: snapshot.why === undefined ? null : snapshot.why,
  at: new Date().toISOString(),
})

// ---------------------------------------------------------------------------
// The shell: its own api envelope, its panel lease, its sessions
// ---------------------------------------------------------------------------

const callApi = async (endpoint, args) => callEndpoint(ORIGIN, endpoint, args)

const leaseCall = async (payload) => {
  try {
    const reply = await requestJson(ORIGIN + '/__shell/panel', { body: { op: 'lease', ...payload } })
    let body = null
    try {
      body = JSON.parse(reply.text)
    } catch {
      body = null
    }
    return {
      status: reply.status,
      lease: body === null || body.lease === undefined ? null : body.lease,
      error: body !== null && typeof body.error === 'string' ? body.error : null,
    }
  } catch (error) {
    return { status: 0, lease: null, error: describe(error) }
  }
}

/**
 * Claim the lease, waiting while another live gate holds it. The refusal names the holder, and that
 * name is what this gate reports when the wait is up: the next action belongs to whoever holds it.
 */
const claimLease = async (progress) => {
  const startedAt = Date.now()
  const until = startedAt + LEASE_WAIT_MS
  let last = null
  while (Date.now() < until) {
    const answer = await leaseCall({ leaseOp: 'claim', holder: HOLDER, ttlMs: LEASE_TTL_MS })
    const held = answer.lease !== null && answer.lease.held === true && answer.lease.holder === HOLDER
    if (held === true) return { held: true, waitedMs: Date.now() - startedAt, holder: null, fatal: null, status: answer.status }
    last = answer
    const holder = answer.lease !== null && typeof answer.lease.holder === 'string' ? answer.lease.holder : null
    const busy = answer.error !== null && answer.error.includes('leased by') === true
    if (busy !== true) {
      return { held: false, waitedMs: Date.now() - startedAt, holder, fatal: answer.error === null ? ('the lease claim answered status ' + String(answer.status) + ' with no readable holder') : answer.error, status: answer.status }
    }
    if (progress.length === 0) progress.push('the panel lease is held by ' + show(holder) + '; this gate waits for it (up to ' + String(LEASE_WAIT_MS) + ' ms)')
    await sleep(POLL_MS)
  }
  const holder = last !== null && last.lease !== null && typeof last.lease.holder === 'string' ? last.lease.holder : null
  return { held: false, waitedMs: Date.now() - startedAt, holder, fatal: null, status: last === null ? 0 : last.status }
}

const readRoute = async () => {
  try {
    const reply = await requestJson(ORIGIN + ROUTE, { method: 'GET' })
    let body = null
    try {
      body = JSON.parse(reply.text)
    } catch {
      body = null
    }
    return { at: new Date().toISOString(), status: reply.status, ok: reply.status === 200 && body !== null && body.ok === true, body, why: null }
  } catch (error) {
    return { at: new Date().toISOString(), status: 0, ok: false, body: null, why: describe(error) }
  }
}

/** One normalized session row: what moved since the last read is asOfSeq, and that is the check. */
const readSessions = async () => {
  const value = await callApi('session/list', { _request: {} })
  const items = list(obj(value).items)
  return {
    at: new Date().toISOString(),
    count: items.length,
    rows: items.map((item) => ({
      sessionId: String(obj(item).sessionId === undefined ? '' : obj(item).sessionId),
      asOfSeq: Number(obj(obj(item).projections).asOfSeq === undefined ? 0 : obj(obj(item).projections).asOfSeq),
      running: obj(item).running === true,
      blank: obj(item).blank === true,
    })),
  }
}

const readSessionPage = async (sessionId) => {
  const sessions = await readSessions()
  const row = sessions.rows.filter((one) => one.sessionId === sessionId)[0]
  if (row === undefined || row.asOfSeq <= 0) return { page: null, asOfSeq: row === undefined ? 0 : row.asOfSeq }
  const value = await callApi('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: row.asOfSeq, maxMessages: 800 } })
  return { page: value === null || value === undefined ? null : value, asOfSeq: row.asOfSeq }
}

// ---------------------------------------------------------------------------
// The measured world: guard, lease, one session, ONE prompt, read-only afterwards
// ---------------------------------------------------------------------------

const runWorld = async (bag) => {
  const transcript = {
    schema: SCHEMA,
    startedAt: new Date().toISOString(),
    port: PORT,
    kernelPort: KERNEL_PORT,
    shellOrigin: ORIGIN,
    route: ROUTE,
    holder: HOLDER,
    message: null,
    attribution: null,
    progress: [],
    guard: null,
    subject: null,
    lease: { claim: null, release: null, after: null },
    entry: { at: null, client: null, kernel: null, route: null, ledger: null, sessions: null, appdata: null },
    session: { sessionId: null, created: false, requestId: null, accepted: null, promptCount: 0, promptSentAt: null, polls: 0, turnEnded: false, deadlineMs: DEADLINE_MS },
    page: null,
    ledger: { before: null, after: null, newRows: [], waitedMs: null },
    routeAfter: null,
    exit: { at: null, client: null, kernel: null, sessions: null },
    notes: [],
    problems: [],
  }
  bag.transcript = transcript
  const progress = transcript.progress

  // --- the guard: alone, with a client and a kernel that can be named ------------------------------
  const processes = nodeProcesses()
  if (processes.ok !== true) throw new NotMeasured('the single-run guard could not read the process list (' + String(processes.why) + '), so this gate cannot promise it is alone')
  transcript.entry.client = clientIdentity()
  transcript.entry.kernel = kernelIdentity(processes.rows)
  const live = liveGateFiles()
  const ancestors = ancestorPids()
  const others = otherConsumers(processes.rows, live, ancestors)
  transcript.guard = { liveFiles: live.files, registerParsed: live.parsed === undefined ? 0 : live.parsed, parseNote: live.why, others, nodeProcesses: processes.rows.length, ancestors }
  if (others.length > 0) throw new NotMeasured('another live consumer is running, and this gate must run alone: ' + others.join(' | '))
  if (transcript.entry.client === null) throw new NotMeasured('the desktop client process (dsh-link) is not running, so there is no live client to judge')
  if (transcript.entry.kernel === null) throw new NotMeasured('no live kernel process could be named (a node process running the CLI with --patch layers), so the world this gate would drive cannot be identified')
  progress.push('alone: ' + String(live.files.length) + ' live gate file(s) in the register, ' + String(processes.rows.length) + ' node process(es) read, 0 other live consumers')

  // --- the lease: the coordination, taken before this gate touches anything ------------------------
  const claim = await claimLease(progress)
  transcript.lease.claim = { held: claim.held, waitedMs: claim.waitedMs, holder: claim.holder, fatal: claim.fatal, status: claim.status }
  if (claim.held !== true) {
    if (claim.fatal !== null) throw new NotMeasured('the shell would not answer the lease claim: ' + String(claim.fatal))
    throw new NotMeasured('the panel lease is held by ' + show(claim.holder) + ' and was not released within ' + String(LEASE_WAIT_MS) + ' ms, so this gate would be reading somebody else\'s world')
  }
  progress.push('the panel lease is held by ' + HOLDER + ' (waited ' + String(claim.waitedMs) + ' ms)')

  try {
    // --- the subject: the table the live profile is linked to -------------------------------------
    const appdataDone = pwshOnce('[string]$env:APPDATA', 20000)
    const appdata = appdataDone.status === 0 && String(appdataDone.stdout === undefined ? '' : appdataDone.stdout).trim() !== '' ? String(appdataDone.stdout).trim() : null
    transcript.entry.appdata = appdata
    const subject = resolveSubject(transcript.entry.kernel, appdata)
    transcript.subject = subject
    if (subject.ok !== true) throw new NotMeasured(subject.why)
    progress.push('the live table (' + subject.configPath + ', ' + String(subject.configBytes) + ' bytes, sha256 ' + clip(String(subject.configSha256), 16) + ') declares group ' + show(subject.targetId) + ' with ' + String(subject.targetTools.length) + ' member(s)')

    // --- the world before anything ---------------------------------------------------------------
    transcript.entry.at = new Date().toISOString()
    transcript.entry.route = await readRoute()
    if (transcript.entry.route.ok !== true) {
      throw new NotMeasured('GET ' + ROUTE + ' on the shell port answered status=' + String(transcript.entry.route.status) + (transcript.entry.route.why === null ? '' : ' (' + String(transcript.entry.route.why) + ')') + ', so there is no live teams surface to judge')
    }
    const directory = obj(obj(transcript.entry.route.body).ledger).directory
    const before = readLedger(directory)
    transcript.entry.ledger = ledgerFacts(before)
    // The same facts in the slot the judge reads: the before-read is the baseline of reading 2, and a
    // baseline that only existed as a local would leave 'the log grew' unmeasurable in the transcript.
    transcript.ledger.before = transcript.entry.ledger
    if (before.ok !== true) throw new NotMeasured('the control ledger the teams route names (' + show(directory) + ') could not be read: ' + String(before.why))
    const entrySessions = await readSessions()
    transcript.entry.sessions = entrySessions
    if (entrySessions.rows.some((row) => row.sessionId === '') === true) throw new NotMeasured('session/list answered with a row this gate cannot name, so the world fingerprint would be a guess')
    progress.push('entry: ledger ' + String(before.rows) + ' row(s) at seq ' + show(before.maxSeq) + ' (' + String(before.bytes) + ' bytes, sha256 ' + clip(before.sha256, 16) + '), ' + String(entrySessions.count) + ' session(s) on record')

    // --- ONE session and ONE prompt --------------------------------------------------------------
    const created = await callApi('session/create', { request: {} })
    const sessionId = String(obj(created).sessionId === undefined ? '' : obj(created).sessionId)
    if (sessionId === '') throw new NotMeasured('the shell created no session (session/create answered ' + show(created) + ')')
    transcript.session.sessionId = sessionId
    transcript.session.created = true
    const attribution = attributionOf(sessionId)
    transcript.attribution = attribution
    transcript.message = buildMessage(attribution)
    progress.push('one session created: ' + sessionId + ' (attribution: team ' + show(attribution.team) + ', member ' + show(attribution.member) + ')')
    const requestId = randomUUID()
    transcript.session.requestId = requestId
    const accepted = await callApi('session/prompt', { request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: transcript.message }] } })
    transcript.session.promptCount += 1
    transcript.session.accepted = obj(accepted).accepted === true
    transcript.session.promptSentAt = new Date().toISOString()
    if (transcript.session.accepted !== true) throw new NotMeasured('the one prompt this gate sends was not accepted (' + show(accepted) + ')')
    progress.push('one prompt sent (requestId ' + requestId + ')')

    // --- read-only from here: wait for the round to end, then keep the log ------------------------
    const until = Date.now() + DEADLINE_MS
    let page = null
    while (Date.now() < until) {
      transcript.session.polls += 1
      const read = await readSessionPage(sessionId)
      if (read.page !== null) {
        page = read.page
        const types = list(obj(page).records).map((record) => String(obj(obj(record).event).type))
        if (types.includes('turn/end') === true) {
          transcript.session.turnEnded = true
          break
        }
      }
      await sleep(POLL_MS)
    }
    transcript.page = page
    if (page === null) throw new NotMeasured('the session this gate created was polled ' + String(transcript.session.polls) + ' time(s) and never had a readable log within ' + String(DEADLINE_MS) + ' ms')
    if (transcript.session.turnEnded !== true) {
      transcript.notes.push('NOT MEASURED in the world: the round logged ' + String(list(obj(page).records).length) + ' event(s) but never reached turn/end within ' + String(DEADLINE_MS) + ' ms, so the record below is a round that had not finished')
    } else progress.push('the round ended: ' + String(list(obj(page).records).length) + ' event(s), turn/end seen')

    // --- the ledger the two calls wrote: wait a bounded moment for its two rows -------------------
    const waitedAt = Date.now()
    let after = readLedger(directory, before.bytes)
    while (after.ok === true && Date.now() - waitedAt < LEDGER_WAIT_MS) {
      const grown = after.parsed.filter((row) => Number(obj(row).seq) > (before.maxSeq === null ? 0 : before.maxSeq))
      if (grown.length >= 2) break
      await sleep(1000)
      after = readLedger(directory, before.bytes)
    }
    transcript.ledger.waitedMs = Date.now() - waitedAt
    transcript.ledger.after = ledgerFacts(after)
    if (after.ok === true) {
      const base = before.maxSeq === null ? 0 : before.maxSeq
      transcript.ledger.newRows = after.parsed
        .filter((row) => Number(obj(row).seq) > base)
        .map((row) => ({
          seq: Number(obj(row).seq),
          kind: obj(row).kind === undefined ? null : String(obj(row).kind),
          actor: obj(row).actor === undefined ? null : String(obj(row).actor),
          subject: obj(row).subject === undefined ? null : String(obj(row).subject),
          at: obj(row).at === undefined ? null : Number(obj(row).at),
          payload: obj(row).payload === null ? null : obj(row).payload,
          writer: obj(row).writer === undefined ? null : String(obj(row).writer),
          instance: obj(row).instance === undefined ? null : String(obj(row).instance),
        }))
    }
    progress.push('the ledger after the round: ' + String(after.ok === true ? after.rows : '?') + ' row(s) at seq ' + show(after.ok === true ? after.maxSeq : null) + ', ' + String(transcript.ledger.newRows.length) + ' new row(s) after seq ' + show(before.maxSeq) + ' (' + transcript.ledger.waitedMs + ' ms of waiting)')

    // --- the route, after the round --------------------------------------------------------------
    transcript.routeAfter = await readRoute()
    progress.push('the route after the round: status=' + String(transcript.routeAfter.status) + ', registry member(s) ' + show(list(obj(obj(transcript.routeAfter.body).registry).members).map((row) => obj(row).id)))
  } catch (error) {
    if (error instanceof NotMeasured) transcript.notes.push('NOT MEASURED in the world: ' + error.message)
    else transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error === undefined || error === null || error.stack === undefined ? '' : '\n' + String(error.stack).split('\n').slice(0, 4).join('\n')))
  } finally {
    // --- reading 5's two halves that are this gate's own to do: give the lease back, name the session
    try {
      const released = await leaseCall({ leaseOp: 'release', holder: HOLDER })
      const readBack = await leaseCall({ leaseOp: 'status', holder: HOLDER })
      transcript.lease.release = { status: released.status, error: released.error }
      transcript.lease.after = readBack.lease === null ? null : { held: readBack.lease.held === true, holder: readBack.lease.holder === undefined ? null : readBack.lease.holder, status: readBack.status, error: readBack.error }
      transcript.exit.at = new Date().toISOString()
      transcript.exit.client = clientIdentity()
      const processesNow = nodeProcesses()
      transcript.exit.kernel = processesNow.ok === true ? kernelIdentity(processesNow.rows) : null
      transcript.exit.sessions = await readSessions()
      if (transcript.entry.client !== null && transcript.exit.client !== null && transcript.entry.client !== transcript.exit.client) {
        transcript.notes.push('NOT MEASURED in the world: the client was RESTARTED while this gate was running (' + String(transcript.entry.client) + ' -> ' + String(transcript.exit.client) + '), so the client this gate measured no longer exists')
      }
      if (transcript.entry.kernel !== null && transcript.exit.kernel !== null && transcript.entry.kernel.pid !== transcript.exit.kernel.pid) {
        transcript.notes.push('NOT MEASURED in the world: the kernel process was replaced while this gate was running (pid ' + String(transcript.entry.kernel.pid) + ' -> ' + String(transcript.exit.kernel.pid) + '), so the plugin state this gate measured is gone')
      }
    } catch (error) {
      transcript.problems.push('the exit fingerprint could not be read: ' + describe(error))
    }
    // The dump is the evidence: the judged record is written out whether the round was green or not.
    try {
      const dir = DUMP_OPTION === null ? join(tmpdir(), 'r204-p1-collab-tools-live') : dirname(resolve(DUMP_OPTION))
      mkdirSync(dir, { recursive: true })
      const path = DUMP_OPTION === null ? join(dir, 'transcript-' + String(transcript.session.sessionId === null ? 'none' : transcript.session.sessionId) + '.json') : resolve(DUMP_OPTION)
      writeFileSync(path, JSON.stringify(transcript, null, 1))
      transcript.dumpPath = path
    } catch (error) {
      transcript.notes.push('note: the transcript could not be written out (' + describe(error) + ')')
    }
  }
  return transcript
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript, so --replay re-takes the verdict
// ---------------------------------------------------------------------------

const OK = (detail) => ({ ok: true, notMeasured: false, detail })
const BAD = (detail) => ({ ok: false, notMeasured: false, detail })
const NA = (detail) => ({ ok: false, notMeasured: true, detail })

/**
 * Everything the readings below are allowed to look at, folded out of the measured record once.
 * --replay calls this on the file and nothing else: no clock, no file, no socket.
 */
const buildFacts = (transcript) => {
  const records = list(obj(transcript.page).records)
  const events = records.map((record) => obj(record).event).filter((event) => event !== null && typeof event === 'object')
  const headers = events.filter((event) => event.type === 'request/header').map((event) => {
    const data = obj(event.data)
    const tools = list(obj(data.header).tools)
    return {
      seq: Number(event.seq === undefined ? -1 : event.seq),
      reason: data.reason === undefined ? '' : String(data.reason),
      startsSeries: data.startsSeries === true,
      names: tools.map((tool) => (obj(tool).name === undefined ? '' : String(obj(tool).name))),
      toolCount: tools.length,
    }
  })
  const calls = events.filter((event) => event.type === 'tool/call').map((event) => {
    const data = obj(event.data)
    return {
      seq: Number(event.seq === undefined ? -1 : event.seq),
      turn: Number(data.turn === undefined ? -1 : data.turn),
      step: Number(data.step === undefined ? -1 : data.step),
      name: data.name === undefined ? '' : String(data.name),
      arguments: data.arguments === undefined ? '' : String(data.arguments),
      callId: data.callId === undefined ? '' : String(data.callId),
    }
  })
  const results = events.filter((event) => event.type === 'tool/result').map((event) => {
    const data = obj(event.data)
    const message = obj(data.message)
    const content = list(message.content)
    return {
      seq: Number(event.seq === undefined ? -1 : event.seq),
      turn: Number(data.turn === undefined ? -1 : data.turn),
      step: Number(data.step === undefined ? -1 : data.step),
      callId: message.toolCallId === undefined ? '' : String(message.toolCallId),
      isError: message.isError === true,
      text: content.map((part) => (obj(part).type === 'text' ? String(obj(part).text === undefined ? '' : obj(part).text) : '[' + String(obj(part).type) + ']')).join('\n'),
    }
  })
  const resultFor = (call) => {
    if (call === null || call === undefined) return null
    if (call.callId !== '') {
      const byId = results.filter((result) => result.callId !== '' && result.callId === call.callId)[0]
      if (byId !== undefined) return byId
    }
    const later = results.filter((result) => result.seq > call.seq).sort((left, right) => left.seq - right.seq)
    return later.length === 0 ? null : later[0]
  }
  const callsOf = (name) => calls.filter((call) => call.name === name)
  const turnStarts = events.filter((event) => event.type === 'turn/start').map((event) => Number(obj(event.data).turn === undefined ? -1 : obj(event.data).turn))
  const turnEnds = events.filter((event) => event.type === 'turn/end')
  const lastEnd = turnEnds.length === 0 ? null : turnEnds[turnEnds.length - 1]
  const turnEnd = lastEnd === null ? null : { seq: Number(lastEnd.seq === undefined ? -1 : lastEnd.seq), count: turnEnds.length, kind: String(obj(obj(lastEnd.data).reason).kind === undefined ? '' : obj(obj(lastEnd.data).reason).kind) }
  const promptTurn = turnStarts.length === 0 ? null : turnStarts[turnStarts.length - 1]

  const declareCalls = callsOf(DECLARE_TOOL)
  const heartbeatCalls = callsOf(HEARTBEAT_TOOL)
  const openCalls = callsOf(OPEN_TOOL)
  const directoryCalls = callsOf(DIRECTORY_TOOL)

  const drive = (() => {
    if (obj(transcript.session).created !== true) return { measured: false, why: 'this gate created no session, so no model round was paid for' }
    if (obj(transcript.session).accepted !== true) return { measured: false, why: 'the one prompt this gate sends was not accepted' }
    if (events.length === 0) return { measured: false, why: 'the session log could not be read, so what the model did is unknown' }
    const missing = []
    if (declareCalls.length === 0) missing.push('it never called ' + DECLARE_TOOL)
    if (heartbeatCalls.length === 0) missing.push('it never called ' + HEARTBEAT_TOOL)
    if (missing.length > 0) return { measured: false, why: missing.join(' and ') }
    const many = []
    if (declareCalls.length > 1) many.push(String(declareCalls.length) + ' calls of ' + DECLARE_TOOL)
    if (heartbeatCalls.length > 1) many.push(String(heartbeatCalls.length) + ' calls of ' + HEARTBEAT_TOOL)
    if (many.length > 0) return { measured: false, why: 'the model made ' + many.join(' and ') + ' in one round, and the message names one each' }
    const refused = []
    for (const call of [declareCalls[0], heartbeatCalls[0]]) {
      const result = resultFor(call)
      if (result === null) continue
      if (result.isError === true && NAMED_REFUSAL.test(result.text) === true) refused.push(call.name + ' -> ' + clip(result.text, 200))
    }
    if (refused.length > 0) return { measured: false, why: 'the tool refused the model by name: ' + refused.join(' | ') }
    return { measured: true, why: null }
  })()

  const subject = obj(transcript.subject)
  const groups = list(subject.groups)
  const openIds = []
  for (const call of openCalls) {
    let args = null
    try {
      args = JSON.parse(call.arguments)
    } catch {
      args = null
    }
    for (const id of list(obj(args).open)) openIds.push(String(id))
  }
  const groupById = (id) => groups.filter((group) => String(obj(group).id) === String(id))[0] === undefined ? null : groups.filter((group) => String(obj(group).id) === String(id))[0]
  const openedGroup = openIds
    .map(groupById)
    .filter((group) => group !== null && TOUCHED_TOOLS.every((tool) => list(obj(group).tools).map(String).includes(tool) === true))[0]
  const judgedGroup = openedGroup === null || openedGroup === undefined
    ? (subject.targetId === undefined || subject.targetId === null ? null : { id: String(subject.targetId), tools: list(subject.targetTools).map(String) })
    : { id: String(obj(openedGroup).id), tools: list(obj(openedGroup).tools).map(String) }

  return {
    transcript,
    events,
    headers,
    calls,
    results,
    resultFor,
    callsOf,
    turnStarts,
    turnEnd,
    promptTurn,
    declareCalls,
    heartbeatCalls,
    openCalls,
    directoryCalls,
    openIds,
    drive,
    subject,
    groups,
    openedGroup: openedGroup === null || openedGroup === undefined ? null : { id: String(obj(openedGroup).id), tools: list(obj(openedGroup).tools).map(String) },
    judgedGroup,
    sessionId: obj(transcript.session).sessionId === undefined ? null : obj(transcript.session).sessionId,
    attribution: obj(transcript.attribution),
    newRows: list(obj(transcript.ledger).newRows),
  }
}

const capabilityRowsOf = (facts) => facts.newRows.filter((row) => row.kind === CAPABILITY_KIND)
const heartbeatRowsOf = (facts) => facts.newRows.filter((row) => row.kind === HEARTBEAT_KIND)
const memberOfRow = (row) => String(obj(row.payload).id === undefined ? (row.subject === null ? '' : row.subject) : obj(row.payload).id)
const declaredOfRow = (row) => list(obj(row.payload).capabilities).map(String)

const READINGS = [
  {
    id: '0-the-model-drove-the-two-calls',
    judge: (f) => {
      const t = f.transcript
      if (obj(t.session).created !== true) return NA('this gate created no session, so no model round was paid for')
      if (obj(t.session).accepted !== true) return NA('the one prompt this gate sends was not accepted (' + show(obj(t.session).accepted) + '), so the model was never asked')
      if (f.drive.measured !== true) return NA(f.drive.why + ' - compliance is a fact about the model, not a verdict on the product, and this gate paid exactly one prompt for it')
      const declare = f.declareCalls[0]
      const beat = f.heartbeatCalls[0]
      const declareResult = f.resultFor(declare)
      const beatResult = f.resultFor(beat)
      return OK('the model called ' + DECLARE_TOOL + ' once (seq ' + String(declare.seq) + ', turn ' + String(declare.turn) + ' step ' + String(declare.step) + ', arguments ' + clip(declare.arguments, 220) + ') and ' + HEARTBEAT_TOOL + ' once (seq ' + String(beat.seq) + ', turn ' + String(beat.turn) + ' step ' + String(beat.step) + ', arguments ' + clip(beat.arguments, 220) + '); neither result is an error (' + clip(declareResult === null ? '(no result row)' : declareResult.text, 160) + ' | ' + clip(beatResult === null ? '(no result row)' : beatResult.text, 160) + '); the one message also asked for ' + DIRECTORY_TOOL + ' (' + String(f.directoryCalls.length) + ' call) and ' + OPEN_TOOL + ' (' + String(f.openCalls.length) + ' call) to make them visible, and whether they were is reading 4')
    },
  },
  {
    id: '1-both-calls-are-one-each-in-the-prompted-turn',
    judge: (f) => {
      if (f.drive.measured !== true) return NA('the drive this reading is about did not happen: ' + f.drive.why)
      const problems = []
      const lines = []
      if (f.turnStarts.length !== 1) problems.push('the session logged ' + String(f.turnStarts.length) + ' turn(s) (' + show(f.turnStarts) + ') for the one prompt this gate sent, so which turn is the prompted one is not one answer')
      else lines.push('one turn (' + String(f.promptTurn) + ') for the one prompt sent')
      for (const call of [f.declareCalls[0], f.heartbeatCalls[0]]) {
        if (call.turn !== f.promptTurn) problems.push(call.name + ' (seq ' + String(call.seq) + ') is logged at turn ' + String(call.turn) + ' and the prompt started turn ' + show(f.promptTurn))
        const result = f.resultFor(call)
        if (result === null) {
          problems.push(call.name + ' (seq ' + String(call.seq) + ') has no tool/result event: the engine answered the call with nothing this gate can read')
          continue
        }
        if (call.callId !== '' && result.callId !== '' && result.callId !== call.callId) {
          problems.push('the result at seq ' + String(result.seq) + ' answers call id ' + show(result.callId) + ' while the call at seq ' + String(call.seq) + ' carries ' + show(call.callId))
        }
        if (result.isError === true && NAMED_REFUSAL.test(result.text) !== true) {
          problems.push(call.name + ' failed with something other than a named refusal: ' + clip(result.text, 220))
        }
        lines.push(call.name + ' at seq ' + String(call.seq) + ' answered by result seq ' + String(result.seq) + ' (turn ' + String(result.turn) + ' step ' + String(result.step) + ', isError ' + String(result.isError) + ')')
      }
      if (f.turnEnd === null) problems.push('the session logged no turn/end, so how the round ended is not a measurement')
      if (problems.length > 0) return BAD(problems.join('; '))
      if (f.turnEnd.kind !== 'completed') return NA('the round ended as ' + show(f.turnEnd.kind) + ' rather than completed, so this round is not a finished measurement of two finished calls')
      return OK('exactly one ' + DECLARE_TOOL + ' call and exactly one ' + HEARTBEAT_TOOL + ' call, both in the prompted turn: ' + lines.join('; ') + '; the turn ended as completed at seq ' + show(obj(f.turnEnd).seq))
    },
  },
  {
    id: '2-the-ledger-grew-by-exactly-two-rows-this-session-wrote',
    judge: (f) => {
      if (f.drive.measured !== true) return NA('the drive that would write the rows did not happen: ' + f.drive.why)
      const t = f.transcript
      const before = obj(obj(t.ledger).before)
      const after = obj(obj(t.ledger).after)
      if (before.ok !== true) return NA('the control log could not be read before the round (' + show(before.why) + '), so "grew" has no baseline')
      if (after.ok !== true) return NA('the control log could not be read after the round (' + show(after.why) + '), so the growth cannot be counted')
      const prefix = String(obj(t.attribution).sessionPrefix === undefined ? '' : obj(t.attribution).sessionPrefix)
      const problems = []
      if (after.prefixBytes !== before.bytes) problems.push('the read-back prefix covers ' + show(after.prefixBytes) + ' byte(s) and the log stood at ' + String(before.bytes) + ' byte(s) before the round')
      else if (after.prefixSha256 !== before.sha256) problems.push('the first ' + String(before.bytes) + ' byte(s) of the log after the round hash to ' + clip(String(after.prefixSha256), 16) + ' and the whole file hashed to ' + clip(String(before.sha256), 16) + ' before it: the file was rewritten rather than appended to')
      else if (Number(after.bytes) < Number(before.bytes)) problems.push('the log shrank from ' + String(before.bytes) + ' to ' + String(after.bytes) + ' byte(s)')
      const capabilityRows = capabilityRowsOf(f)
      const heartbeatRows = heartbeatRowsOf(f)
      if (f.newRows.length !== 2) problems.push('the log grew by ' + String(f.newRows.length) + ' row(s) after seq ' + show(before.maxSeq) + ' (' + show(f.newRows.map((row) => ({ seq: row.seq, kind: row.kind, actor: row.actor }))) + ') and this round asked for exactly two')
      if (capabilityRows.length !== 1) problems.push('the new rows carry ' + String(capabilityRows.length) + ' ' + CAPABILITY_KIND + ' row(s)')
      if (heartbeatRows.length !== 1) problems.push('the new rows carry ' + String(heartbeatRows.length) + ' ' + HEARTBEAT_KIND + ' row(s)')
      for (const row of f.newRows) {
        if (carriesSession(row.actor, prefix) !== true) {
          problems.push('row seq ' + String(row.seq) + ' (' + String(row.kind) + ') carries actor ' + show(row.actor) + ' in its own field, and the session this gate created is ' + show(prefix) + ': the row does not name it')
        }
      }
      if (capabilityRows.length === 1 && heartbeatRows.length === 1 && memberOfRow(capabilityRows[0]) !== memberOfRow(heartbeatRows[0])) {
        problems.push('the two rows name different members (' + show(memberOfRow(capabilityRows[0])) + ' and ' + show(memberOfRow(heartbeatRows[0])) + ')')
      }
      if (problems.length > 0) return BAD(problems.join('; '))
      const capabilityRow = capabilityRows[0]
      const heartbeatRow = heartbeatRows[0]
      return OK('the control log ' + String(before.rows) + ' -> ' + String(after.rows) + ' row(s) (' + String(before.bytes) + ' -> ' + String(after.bytes) + ' bytes) and the first ' + String(before.bytes) + ' byte(s) still hash to ' + clip(String(before.sha256), 16) + ', so the round appended and did not rewrite; exactly two rows appeared after seq ' + show(before.maxSeq) + ': ' + CAPABILITY_KIND + ' at seq ' + String(capabilityRow.seq) + ' (actor ' + show(capabilityRow.actor) + ', member ' + show(memberOfRow(capabilityRow)) + ', capabilities ' + show(declaredOfRow(capabilityRow)) + ') and ' + HEARTBEAT_KIND + ' at seq ' + String(heartbeatRow.seq) + ' (actor ' + show(heartbeatRow.actor) + ', member ' + show(memberOfRow(heartbeatRow)) + ', at ' + show(obj(heartbeatRow.payload).at) + '); both actors are this session\'s id prefix ' + show(prefix) + ' and the attribution is the rows\' own field')
    },
  },
  {
    id: '3-those-rows-fold-into-the-registry-the-route-serves',
    judge: (f) => {
      if (f.drive.measured !== true) return NA('the drive that would write the rows did not happen: ' + f.drive.why)
      const capabilityRow = capabilityRowsOf(f)[0]
      const heartbeatRow = heartbeatRowsOf(f)[0]
      if (capabilityRow === undefined) return NA('the ledger holds no ' + CAPABILITY_KIND + ' row of this round, so there is no member to look for in the registry')
      if (heartbeatRow === undefined) return NA('the ledger holds no ' + HEARTBEAT_KIND + ' row of this round, so the liveness fold has nothing of this round to hold')
      const member = memberOfRow(capabilityRow)
      const declared = declaredOfRow(capabilityRow)
      const after = obj(f.transcript.routeAfter)
      if (after === null || Number(after.status === undefined ? 0 : after.status) === 0) return NA('GET ' + ROUTE + ' did not answer after the round (' + show(after.why) + '), so the fold cannot be read')
      const body = obj(after.body)
      if (after.ok !== true) return BAD('GET ' + ROUTE + ' answered status=' + String(after.status) + ' ok=' + show(body.ok) + ', so the surface that serves the fold is not serving a world at all')
      const registry = obj(body.registry)
      const rows = list(registry.members)
      const entry = rows.filter((row) => String(obj(row).id) === member)[0]
      const problems = []
      if (entry === undefined) {
        problems.push('the registry the route serves lists ' + String(rows.length) + ' member(s) ' + show(rows.map((row) => obj(row).id)) + ' and NONE of them is ' + show(member) + ', the member the ledger row names')
      } else {
        const held = list(obj(entry).capabilities).map(String)
        if (sameSet(held, declared) !== true) problems.push('the registry holds ' + show(held) + ' for ' + show(member) + ' and the row declared ' + show(declared))
        if (Number(obj(entry).seq) !== Number(capabilityRow.seq)) problems.push('the registry entry says it came from seq ' + show(obj(entry).seq) + ' and the row the model wrote is seq ' + String(capabilityRow.seq))
      }
      const index = obj(registry.byCapability)
      for (const capability of declared) {
        const who = list(index[capability]).map(String)
        if (who.includes(member) !== true) problems.push('the registry\'s capability index does not list ' + show(member) + ' under ' + show(capability) + ' (it lists ' + show(who) + ')')
      }
      const liveness = obj(body.liveness)
      const lastHeartbeat = obj(liveness.lastHeartbeat)
      const beatAt = Number(obj(heartbeatRow.payload).at)
      const heldAt = Number(lastHeartbeat[member])
      if (Number.isFinite(beatAt) !== true) problems.push('the heartbeat row carries no readable instant (' + show(obj(heartbeatRow.payload).at) + ')')
      else if (heldAt !== beatAt) problems.push('the liveness fold holds ' + show(lastHeartbeat[member] === undefined ? null : lastHeartbeat[member]) + ' for ' + show(member) + ' and the row the model wrote says ' + show(beatAt))
      const beatSeq = obj(liveness.beatSeq)
      if (beatSeq[member] !== undefined && Number(beatSeq[member]) !== Number(heartbeatRow.seq)) problems.push('the liveness fold says that beat came from seq ' + show(beatSeq[member]) + ' and the row is seq ' + String(heartbeatRow.seq))
      if (problems.length > 0) return BAD(problems.join('; '))
      return OK('GET ' + ROUTE + ' folds this round\'s rows: the registry lists ' + show(member) + ' with ' + show(declared) + ' from seq ' + show(obj(entry).seq) + ' (the row\'s own seq), the capability index names it under ' + show(declared) + ', and the liveness fold holds the heartbeat row\'s own instant ' + show(beatAt) + ' for it (beat seq ' + show(beatSeq[member] === undefined ? null : beatSeq[member]) + ')')
    },
  },
  {
    id: '4-the-team-tools-were-visible-only-because-the-group-opened',
    judge: (f) => {
      const subject = f.subject
      if (subject.ok !== true) return NA('the live group table could not be read (' + show(subject.why) + '), so the members that should have slid are not a measurement')
      const entry = f.headers[0]
      if (entry === undefined) return NA('the session logged no request/header at all, so the face this round started on cannot be read')
      const called = f.declareCalls.length + f.heartbeatCalls.length
      if (f.openCalls.length === 0) {
        if (called === 0) return NA('this round logged neither a group declaration nor a call of the two tools the message names, so there is no slide to read')
        const visible = TOUCHED_TOOLS.filter((tool) => entry.names.includes(tool) === true)
        return BAD('the round logged ' + String(called) + ' call(s) of the group\'s own tools but no ' + OPEN_TOOL + ' call at all: ' + (visible.length > 0 ? show(visible) + ' were already in the very first header (seq ' + String(entry.seq) + ')' : 'and they were not in the entry face either') + ', so their visibility did not come from a group opening in this round')
      }
      if (f.openCalls.length > 1) return NA('the model declared groups ' + String(f.openCalls.length) + ' time(s); one declaration writes one slide, and this gate reads one slide')
      if (f.openedGroup === null) return NA('the declaration opened ' + show(f.openIds) + ' and the live table (' + String(subject.configPath) + ') declares ' + show(f.groups.map((group) => ({ id: obj(group).id, tools: list(obj(group).tools).length }))) + ': none of those is a group carrying both ' + show(TOUCHED_TOOLS))
      const members = f.openedGroup.tools
      const openSeq = f.openCalls[0].seq
      const beforeOpen = f.headers.filter((header) => header.seq < openSeq)
      const faceBefore = beforeOpen.length === 0 ? null : beforeOpen[beforeOpen.length - 1]
      const changesBefore = beforeOpen.filter((header) => header.reason === 'change')
      const changesAfter = f.headers.filter((header) => header.seq > openSeq && header.reason === 'change')
      const problems = []
      const notes = []
      const inEntry = members.filter((name) => entry.names.includes(name) === true)
      if (inEntry.length > 0) problems.push('the first request/header of this session (seq ' + String(entry.seq) + ') already carried ' + String(inEntry.length) + ' of the group\'s ' + String(members.length) + ' member(s) ' + show(inEntry) + ': the surface was open before this round declared anything')
      if (changesBefore.length > 0) problems.push('the session already held ' + String(changesBefore.length) + ' reason:change header(s) before the declaration at seq ' + String(openSeq) + ' (seq ' + show(changesBefore.map((header) => header.seq)) + ')')
      if (changesAfter.length !== 1) problems.push('after the declaration at seq ' + String(openSeq) + ' the session holds ' + String(changesAfter.length) + ' reason:change header(s) (seq ' + show(changesAfter.map((header) => header.seq)) + ')')
      if (changesAfter.length === 1) {
        const header = changesAfter[0]
        const added = faceBefore === null ? header.names.slice() : header.names.filter((name) => faceBefore.names.includes(name) === false)
        const removed = faceBefore === null ? [] : faceBefore.names.filter((name) => header.names.includes(name) === false)
        const extra = added.filter((name) => members.includes(name) === false)
        const missing = members.filter((name) => added.includes(name) === false)
        if (same(added, members) !== true) {
          if (sameSet(added, members) === true) problems.push('the change header carries the group\'s names in a different order than the table (' + show(added) + ' against ' + show(members) + ')')
          else if (extra.length > 0 && extra.every((name) => f.groups.some((group) => list(obj(group).tools).map(String).includes(name) === true))) {
            return NA('the change header carries the ' + String(extra.length) + ' name(s) of a SECOND group (' + show(extra) + ') next to the ' + String(missing.length) + ' missing member(s) ' + show(missing) + ': the model opened more than the one group the message names, and one slide of two groups is not the slide this reading is about')
          } else problems.push('the change header added ' + show(added) + ' and the group declares ' + show(members) + ' (missing ' + show(missing) + ', extra ' + show(extra) + ')')
        }
        if (removed.length !== 0) problems.push('the change header took ' + String(removed.length) + ' name(s) away: ' + show(removed))
        if (faceBefore !== null && header.toolCount !== faceBefore.toolCount + members.length) problems.push('the face went from ' + String(faceBefore.toolCount) + ' to ' + String(header.toolCount) + ' name(s) while the group declares ' + String(members.length))
        notes.push('the change header at seq ' + String(header.seq) + ' carries ' + String(header.toolCount) + ' name(s) against ' + String(faceBefore === null ? 0 : faceBefore.toolCount) + ' before it')
      }
      const notMembers = TOUCHED_TOOLS.filter((tool) => members.includes(tool) === false)
      if (notMembers.length > 0) problems.push('the model called ' + show(notMembers) + ' and the group it opened declares ' + show(members))
      if (problems.length > 0) return BAD(problems.join('; '))
      const entryTeams = entry.names.filter((name) => name.startsWith('team_') === true)
      const outside = entryTeams.filter((name) => members.includes(name) === false)
      return OK('the group ' + show(f.openedGroup.id) + ' opened once, by the model\'s own ' + OPEN_TOOL + ' call at seq ' + String(openSeq) + ', and wrote exactly one reason:change header: the ' + String(members.length) + ' name(s) ' + show(members) + ' added, ' + '0 removed, ' + notes.join(', ') + '. The first header (seq ' + String(entry.seq) + ', ' + String(entry.toolCount) + ' name(s)) carried none of them, and 0 reason:change header existed before that call - so these tools were visible only because the group opened. Scope, stated: that first header does carry ' + String(entryTeams.length) + ' team_* name(s) ' + show(entryTeams) + ', of which ' + String(outside.length) + ' ' + show(outside) + ' are members of no group (the agent-layer team_task_* names, which a group cannot move per R185-F); this reading judges the group\'s own members and names the rest rather than pretending they are absent')
    },
  },
  {
    id: '5-the-world-was-put-back',
    judge: (f) => {
      const t = f.transcript
      const problems = []
      const lines = []
      const lease = obj(t.lease)
      const claim = obj(lease.claim)
      const after = lease.after === undefined || lease.after === null ? null : obj(lease.after)
      if (claim.held !== true) problems.push('this gate never held the panel lease, so what it released is not a measurement')
      else if (after === null) problems.push('the lease could not be read back after the release, so the release is not a measurement')
      else if (after.held === true) problems.push('the panel lease is still held by ' + show(after.holder) + ' after this gate released it')
      else if (after.holder !== null && after.holder !== undefined) problems.push('the panel lease reads held=false with holder ' + show(after.holder))
      else lines.push('the panel lease was claimed by ' + HOLDER + ' after ' + String(claim.waitedMs) + ' ms and is released (held=false, holder=null)')
      const released = obj(lease.release)
      if (released.error !== null && released.error !== undefined) problems.push('the release call answered ' + show(released.error))
      const before = obj(t.entry.sessions)
      const exit = obj(t.exit.sessions)
      if (list(before.rows).length === 0 || list(exit.rows).length === 0) return NA('the session list could not be read at entry or at exit, so the world fingerprint is not a measurement')
      const own = f.sessionId === null || f.sessionId === '' ? null : String(f.sessionId)
      const ownRow = own === null ? undefined : list(exit.rows).filter((row) => row.sessionId === own)[0]
      if (own === null) problems.push('this gate created no session, so there is no evidence session left behind')
      else if (ownRow === undefined) problems.push('the session this gate created (' + own + ') is GONE from session/list at exit, so the evidence was deleted')
      else if (Number(ownRow.asOfSeq) <= 0) problems.push('this gate\'s own session carries asOfSeq ' + show(ownRow.asOfSeq) + ', so the round did not land in the log')
      else lines.push('the session this gate created (' + own + ') is still in session/list at asOfSeq ' + String(ownRow.asOfSeq) + ': left open as the evidence')
      const born = list(exit.rows).filter((row) => list(before.rows).every((one) => one.sessionId !== row.sessionId))
      if (born.length !== 1) problems.push('the world gained ' + String(born.length) + ' session(s) ' + show(born.map((row) => row.sessionId)) + ' and this gate creates exactly one')
      else if (own !== null && born[0].sessionId !== own) problems.push('the new session is ' + show(born[0].sessionId) + ' and this gate\'s own is ' + show(own))
      const moved = []
      for (const row of list(before.rows)) {
        const now = list(exit.rows).filter((one) => one.sessionId === row.sessionId)[0]
        if (now === undefined) problems.push('the session ' + String(row.sessionId) + ' that existed at entry is gone at exit')
        else if (Number(now.asOfSeq) !== Number(row.asOfSeq)) moved.push(String(row.sessionId) + ' ' + String(row.asOfSeq) + ' -> ' + String(now.asOfSeq))
      }
      if (moved.length > 0) problems.push('another session moved while this gate ran: ' + show(moved))
      else lines.push('every one of the ' + String(list(before.rows).length) + ' pre-existing session(s) kept its asOfSeq')
      const entryClient = obj(t.entry).client
      const exitClient = obj(t.exit).client
      if (entryClient === null || entryClient === undefined) problems.push('the client process could not be named at entry')
      else if (exitClient === null || exitClient === undefined) problems.push('the client process could not be named at exit')
      else if (entryClient !== exitClient) problems.push('the client was replaced during the run: ' + String(entryClient) + ' -> ' + String(exitClient))
      else lines.push('the client is the same process from entry to exit: ' + String(entryClient))
      const entryKernel = obj(obj(t.entry).kernel)
      const exitKernel = obj(t.exit).kernel
      if (entryKernel.pid === undefined || entryKernel.pid === null) problems.push('the kernel process could not be named at entry')
      else if (exitKernel.pid === undefined || exitKernel.pid === null) problems.push('the kernel process could not be named at exit')
      else if (String(exitKernel.pid) !== String(entryKernel.pid)) problems.push('the kernel was replaced during the run: pid ' + String(entryKernel.pid) + ' -> ' + String(exitKernel.pid))
      else lines.push('the kernel is the same process from entry to exit: pid ' + String(entryKernel.pid))
      const expected = f.judgedGroup === null ? [] : f.judgedGroup.tools
      const last = f.headers.length === 0 ? null : f.headers[f.headers.length - 1]
      if (expected.length > 0) {
        const held = last === null ? [] : expected.filter((name) => last.names.includes(name) === true)
        if (held.length !== expected.length) problems.push('the evidence session does not end with the group open: its last header (seq ' + show(last === null ? null : last.seq) + ') carries ' + String(held.length) + ' of the ' + String(expected.length) + ' member(s)')
        else lines.push('the last header of the evidence session (seq ' + show(last.seq) + ', ' + String(last.toolCount) + ' name(s)) still carries all ' + String(expected.length) + ' member(s) of ' + show(obj(f.judgedGroup).id))
      }
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
      return { id: reading.id, ok: verdict.ok === true, notMeasured: verdict.notMeasured === true, detail: String(verdict.detail === undefined ? '' : verdict.detail) }
    } catch (error) {
      return { id: reading.id, ok: false, notMeasured: false, detail: 'the reading threw: ' + describe(error) }
    }
  })
}

// ---------------------------------------------------------------------------
// The printout: evidence, never a verdict
// ---------------------------------------------------------------------------

const printTranscript = (t) => {
  const facts = buildFacts(t)
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell: ' + ORIGIN + ' (the client was already running - this gate never starts or stops anything)')
  console.log('  client: ' + String(obj(t.entry).client === null || obj(t.entry).client === undefined ? '(not read)' : obj(t.entry).client) + ' at entry, ' + String(obj(t.exit).client === null || obj(t.exit).client === undefined ? '(not read)' : obj(t.exit).client) + ' at the end')
  const kernel = obj(obj(t.entry).kernel)
  console.log('  kernel: ' + (kernel.pid === undefined ? '(not read)' : 'pid ' + String(kernel.pid) + ' port ' + show(kernel.port) + ' patches ' + show(kernel.patches)))
  const subject = obj(t.subject)
  console.log('  profile: ' + String(subject.profileDir === undefined ? '(unread)' : subject.profileDir) + ' mounts ' + BUNDLE + ' as ' + show(subject.mounted))
  console.log('  table:   ' + String(subject.configPath === undefined ? '(unread)' : subject.configPath) + ' (' + String(subject.configBytes === undefined ? '?' : subject.configBytes) + ' bytes, sha256 ' + clip(String(subject.configSha256 === undefined ? '?' : subject.configSha256), 16) + ')')
  for (const group of list(subject.groups)) {
    const groupObj = obj(group)
    console.log('    group ' + pad(String(groupObj.id), 12) + ' state=' + String(groupObj.state) + ' auto=' + String(groupObj.autoWhen) + ' provider=' + String(groupObj.provider) + ' tools(' + String(list(groupObj.tools).length) + '): ' + list(groupObj.tools).join(', '))
  }
  console.log('  single-run guard: ' + String(list(obj(t.guard).liveFiles).length) + ' live gate file(s) in the register, ' + String(obj(t.guard).nodeProcesses === undefined ? 0 : obj(t.guard).nodeProcesses) + ' node process(es) read, other live consumers: ' + String(list(obj(t.guard).others).length))
  for (const consumer of list(obj(t.guard).others)) console.log('    ' + consumer)
  const claim = obj(obj(t.lease).claim)
  const leaseAfter = obj(t.lease).after === undefined || obj(t.lease).after === null ? null : obj(obj(t.lease).after)
  console.log('  lease: held ' + String(claim.held) + ' by ' + HOLDER + ' after ' + String(claim.waitedMs === undefined ? '?' : claim.waitedMs) + ' ms; read back after release: ' + (leaseAfter === null ? '(not read)' : 'held=' + String(leaseAfter.held) + ' holder=' + show(leaseAfter.holder)))
  const attribution = obj(t.attribution)
  console.log('  attribution: session ' + String(facts.sessionId === null ? '(none)' : facts.sessionId) + ' -> team ' + show(attribution.team) + ', member ' + show(attribution.member) + ', capability ' + show(attribution.capability))
  console.log('  one prompt: requestId ' + String(obj(t.session).requestId) + ', accepted ' + show(obj(t.session).accepted) + ', prompt(s) sent ' + String(obj(t.session).promptCount) + ', poll(s) ' + String(obj(t.session).polls) + ', turn/end seen ' + String(obj(t.session).turnEnded))
  if (t.message !== null && t.message !== undefined) console.log('  the message: ' + JSON.stringify(String(t.message).split('\n').slice(0, 3).join(' / ')) + ' ...')
  const before = obj(obj(t.ledger).before)
  const after = obj(obj(t.ledger).after)
  console.log('  control ledger: ' + String(before.path === undefined ? '(unread)' : before.path))
  console.log('    before: ' + String(before.rows) + ' row(s), highest seq ' + show(before.maxSeq) + ', ' + String(before.bytes) + ' byte(s), sha256 ' + clip(String(before.sha256), 16))
  console.log('    after:  ' + String(after.rows) + ' row(s), highest seq ' + show(after.maxSeq) + ', ' + String(after.bytes) + ' byte(s), sha256 ' + clip(String(after.sha256), 16))
  console.log('    prefix: the first ' + String(after.prefixBytes) + ' byte(s) after the round hash to ' + clip(String(after.prefixSha256), 16) + (after.prefixSha256 === before.sha256 ? ' == the whole file before it' : ' != the whole file before it'))
  console.log('    new row(s) (' + String(list(obj(t.ledger).newRows).length) + ') after seq ' + show(before.maxSeq) + ':')
  for (const row of list(obj(t.ledger).newRows)) {
    const rowObj = obj(row)
    console.log('      seq=' + pad(String(rowObj.seq), 4) + ' ' + pad(String(rowObj.kind), 18) + ' actor=' + pad(show(rowObj.actor), 24) + ' subject=' + pad(show(rowObj.subject), 30) + ' payload=' + clip(show(rowObj.payload), 160))
  }
  const route = obj(t.routeAfter)
  console.log('  GET ' + ROUTE + ' after the round: status=' + String(route.status) + ' ok=' + show(obj(route.body).ok) + ' counts=' + show(obj(route.body).counts))
  console.log('    registry: ' + show(obj(obj(route.body).registry).members))
  console.log('    liveness: ' + clip(show(obj(obj(route.body).liveness).lastHeartbeat), 400))
  console.log('  the session\'s own log (' + String(facts.events.length) + ' event(s)):')
  console.log('    request/header(s) (' + String(facts.headers.length) + '):')
  for (const header of facts.headers) {
    const teams = header.names.filter((name) => name.startsWith('team_') === true)
    console.log('      seq=' + pad(String(header.seq), 4) + ' reason=' + pad(JSON.stringify(header.reason), 10) + ' tools=' + pad(String(header.toolCount), 4) + ' team_*=' + show(teams))
  }
  console.log('    the calls the model made (' + String(facts.calls.length) + '):')
  for (const call of facts.calls) console.log('      seq=' + pad(String(call.seq), 4) + ' turn ' + String(call.turn) + ' step ' + String(call.step) + ' ' + pad(call.name, 26) + ' ' + clip(call.arguments, 200))
  console.log('    the results the engine wrote (' + String(facts.results.length) + '):')
  for (const result of facts.results) console.log('      seq=' + pad(String(result.seq), 4) + ' turn ' + String(result.turn) + ' step ' + String(result.step) + ' isError=' + String(result.isError) + ' ' + JSON.stringify(clip(result.text, 260)))
  console.log('    turn/end: ' + show(facts.turnEnd) + ' (turn(s) started: ' + show(facts.turnStarts) + ')')
  console.log('  sessions: ' + String(obj(obj(t.entry).sessions).count === undefined ? '?' : obj(obj(t.entry).sessions).count) + ' at entry -> ' + String(obj(obj(t.exit).sessions).count === undefined ? '?' : obj(obj(t.exit).sessions).count) + ' at the end' + (facts.sessionId === null ? '; no session of this gate\'s own was created' : '; the new one is this gate\'s own ' + String(facts.sessionId) + ' and it is LEFT IN PLACE (it is the evidence)'))
  console.log('  the dump of the judged record: ' + String(t.dumpPath === undefined ? '(not written)' : t.dumpPath))
  for (const line of list(t.progress)) console.log('  ' + line)
  for (const note of list(t.notes)) console.log('  ' + note)
  for (const problem of list(t.problems)) console.log('  PROBLEM ' + problem)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log('gate 205 collab-tools-live-turn - a MODEL writes the collaboration ledger rows (shell ' + ORIGIN + ', kernel port ' + String(KERNEL_PORT) + ')')
  console.log('  one session, ONE prompt, read-only afterwards: ' + DIRECTORY_TOOL + ' -> ' + OPEN_TOOL + ' -> ' + DECLARE_TOOL + ' + ' + HEARTBEAT_TOOL + ', judged from the session\'s own log, the ledger file and the teams route')
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
    if (obj(transcript).schema !== SCHEMA || obj(transcript).session === undefined || obj(transcript).page === undefined || obj(transcript).subject === undefined) {
      console.log('')
      console.log('SKIP: the file at ' + resolve(REPLAY_PATH) + ' is not a transcript this gate wrote (schema ' + show(obj(transcript).schema) + ')')
      return 3
    }
    console.log('  replay: judging ' + resolve(REPLAY_PATH) + ' - the world is NOT touched, NO lease is taken and NO prompt is sent')
  } else {
    const bag = {}
    try {
      transcript = await runWorld(bag)
    } catch (error) {
      if (error instanceof NotMeasured) {
        const partial = bag.transcript === undefined ? null : bag.transcript
        if (partial !== null) {
          try {
            printTranscript(partial)
          } catch {
            console.log('  (the partial printout failed; the readings below do not exist)')
          }
        }
        console.log('')
        console.log('SKIP: ' + error.message)
        console.log('collab-tools-live-turn: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
        return 3
      }
      console.log('')
      console.log('SKIP: the gate could not run at all: ' + describe(error))
      console.log(String(error === undefined || error === null || error.stack === undefined ? '' : error.stack).split('\n').slice(0, 5).join('\n'))
      return 3
    }
  }
  if (list(obj(transcript).problems).length > 0) {
    console.log('')
    console.log('== the drive did not complete ==')
    try {
      printTranscript(transcript)
    } catch {
      console.log('  (the printout of the partial transcript failed)')
      for (const problem of list(obj(transcript).problems)) console.log('  PROBLEM ' + problem)
    }
    console.log('collab-tools-live-turn: the world could not be driven to the end, so nothing was judged (exit 3)')
    return 3
  }
  try {
    printTranscript(transcript)
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
  const stopped = list(obj(transcript).notes).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
  console.log('')
  const sessionPhrase = obj(obj(transcript).session).created === true ? 'session ' + String(obj(obj(transcript).session).sessionId) + ' left in place as the evidence' : 'no session of this gate\'s own was created'
  console.log('collab-tools-live-turn: ' + String(verdicts.length) + ' readings, ' + String(held.length) + ' held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live client at ' + ORIGIN + '; prompt(s) sent ' + String(obj(obj(transcript).session).promptCount) + '; ' + sessionPhrase + ']')
  if (stopped.length > 0) {
    for (const note of stopped) console.log('SKIP: ' + note)
    console.log('collab-tools-live-turn: NOT MEASURED in the world, so nothing above is a verdict on the product [exit 3]')
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
