#!/usr/bin/env node
/**
 * Gate 126 (R191) - panel-render: WHAT IS ACTUALLY PAINTED IN THE RIGHT RAIL.
 *
 * Subject: the R190 deliverable plugins/dsh-link-panel (its client half: a right-rail pane of kind
 * 'pane', offered on the rail's guide page) and the two read-only routes it draws from
 * (GET /api/dsh-link-panel/state, GET /api/dsh-link-notes/state). Written from the R191 contract and
 * from the LIVE DOM - never from the source comments of the thing it judges.
 *
 * WHY THIS GATE EXISTS: three rounds of readings say the panel is DELIVERED (a row in the manifest),
 * RUNNING (a marker in the live page) and READ BACK (its marker equals the real routes). None of them
 * ever looked at one drawn word. This gate opens the pane, reads the pixels, and puts the world back.
 *
 * WHAT IT DOES (and what it is allowed to do)
 *   - premises first, self-witnessed: the three ports answer, the shell's own status says phase=ready,
 *     the kernel pid and the desktop client's pid@start-time are the same before and after, and the
 *     single-run guard sees no other registered live gate running (it reads the register, never writes it).
 *   - it OWNS the panel the R153 way: claim the lease (scripts/panel-lease.mjs) before touching anything,
 *     re-read the lease after every click, release it in the restore step. Claimed FIRST on purpose: the
 *     page host stands down while it is held (so selecting the browser tab during the walk cannot make the
 *     host open the native panel behind this gate), and R179's lesson - an input that lands while somebody
 *     else owns the turn is recorded against THEM.
 *   - it reaches its tab through the door the world ACTUALLY has. A tab type with priority:'extension' is
 *     NOT a chip in the rail's strip (measured): it is a capsule on the guide page, reached through the
 *     guide's own chip or the strip's add control. This gate reports WHICH door it used, prints the rail's
 *     real tab list and the guide's real capsule list, and when no door and no capsule can be found it
 *     declines BY NAME (exit 3) instead of inventing one. It never changes the registration's priority.
 *   - the ONLY input it sends is left mouse press/release: selecting the guide, selecting its own capsule,
 *     and the restore clicks (guide back, its own tab closed, the entry tab reselected). No key events, no
 *     typing, no navigation, no DOM write: every Runtime.evaluate it sends is an expression whose whole
 *     body is a JSON.stringify of DOM reads, recorded verbatim in the transcript and audited by reading 7.
 *   - it never starts, stops or rebuilds the client, never writes the live archive, never takes a model turn.
 *   - the one fact it reads off the world besides the pixels: the SEAT own glyph-size rule, parsed out of
 *     the guide module that draws every capsule and corroborated against the live sheet and against the
 *     sizes the seat drew for its other capsules. "The box must be 22" is therefore never a number this
 *     gate brought with it; it is the number the seat's own rule produces for THIS capsule's drawn shape.
 *
 * THE READINGS (each able to fail on its own evidence; every one is covered by a mutant)
 *   0-premises-ports-ready-and-the-same-two-processes
 *   1-the-panel-lease-was-ours-before-every-input
 *   2-our-tab-was-reached-through-the-door-this-world-has
 *   3-the-drawn-words-are-the-declared-words
 *   4-the-glyph-is-our-glyph-on-a-16-canvas-sized-by-the-seat-rule
 *   5-the-pane-is-really-on-screen-with-pixels
 *   6-the-world-was-put-back
 *   7-this-gate-only-clicked-and-never-wrote
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a named third state (a premise this world does not
 * meet, or a reading that could not be measured). Reading 4 judges the two SEPARATE invariants the R191
 * contract keeps apart (section 2 item 4, corrected after this gate's first round measured a 22px box):
 * (1) the CANVAS is viewBox="0 0 16 16"; (2) the RENDERED BOX is the number the SEAT'S OWN DRAWING RULE
 * produces for this capsule - read as data every run, never assumed, and corroborated live by the box the
 * skin reserves for that glyph holder and by the sizes the seat drew for the guide's other capsules. A box
 * that is not that number is a product failure (exit 1). This gate has NO "deviation" verdict left.
 *
 * Usage: node scripts/verify-panel-render.mjs [--port 31761] [--kernel-port 31760] [--cdp-port 9222]
 *        [--holder gate-r191-panel-render-<pid>] [--out <transcript.json>] [--replay <transcript.json>]
 *        [--self-attack]
 *   --replay   judges a transcript this gate wrote, with ZERO operations: no fetch, no CDP, no pwsh, no click.
 *   --self-attack  mutates the MEASURED transcript in memory, one mutant per reading, and requires the
 *                  declared set of reddened readings to equal the observed set for every mutant.
 *
 * This gate is SINGLE-RUN ONLY and never belongs in a segmented run: it drives the rail and opens a pane,
 * so a live gate beside it would be judging a world this gate is moving.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { claimLease, releaseLease } from './panel-lease.mjs'
import { connect as connectCdp } from './cdp-drive.mjs'
import { decode, stats } from './lib/png.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => {
  const at = argv.indexOf(name)
  return at === -1 ? fallback : argv[at + 1]
}

const PORT = Number(option('--port', '31761'))
const KERNEL_PORT = Number(option('--kernel-port', '31760'))
const CDP_PORT = Number(option('--cdp-port', '9222'))
const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const KERNEL_ORIGIN = 'http://127.0.0.1:' + String(KERNEL_PORT)
const SELF_ATTACK = has('--self-attack')
const REPLAY_PATH = option('--replay', null)
const DUMP_OPTION = option('--out', null)
const HOLDER = String(option('--holder', 'gate-r191-panel-render-' + String(process.pid)))
const LEASE_TTL_MS = 180000

const SCRATCH_DIR = join(PROJECT, '.tmp', 'r191-g126')
const DICTIONARY_PATH = join(PROJECT, 'plugins', 'dsh-link-panel', 'src', 'client', 'locales.ts')
const BUILT_PATH = join(PROJECT, 'plugins', 'dsh-link-panel', 'lib', 'client.js')
const PANEL_STATE_PATH = '/api/dsh-link-panel/state'
const NOTES_STATE_PATH = '/api/dsh-link-notes/state'
const MANIFEST_PATHS = [join(PROJECT, 'pack', 'pack.json'), join(PROJECT, 'plugins', 'dsh-link-panel', 'cordis.patch.yml')]

/** The canvas our package's own artwork is drawn on (ui-primitives IconFlatListOutlineRegular). */
const GLYPH_VIEWBOX = '0 0 16 16'
/**
 * The SEAT's own drawing rule, read as data at run time: the guide module that draws every capsule and hands
 * its glyph a size. Its "size={description === undefined ? A : B}" IS the rule, and this file carries neither
 * A nor B as a constant, so the box can only be judged against what the world itself states.
 */
const SEAT_RULE_PATH = join(PROJECT, 'core', 'deepseek-harness', 'packages', 'client', 'ui-sidebar-right', 'src', 'client', 'tabs', 'guide', 'GuideBody.tsx')
/** The dictionary key whose zh value is the tab chip's text. */
const TITLE_KEY = 'tab.title'
/** The purposes an input of this gate may have. Nothing else may be clicked. */
const INPUT_PURPOSES = Object.freeze(['select-guide', 'select-our-tab', 'restore-guide', 'restore-select-our-tab', 'restore-close-our-tab', 'restore-entry-tab'])
const WALK_PURPOSE = (title) => 'walk-chip:' + String(title)
const CDP_METHODS = Object.freeze(['Runtime.evaluate', 'Page.captureScreenshot', 'Input.dispatchMouseEvent'])
const PANEL_OPS = Object.freeze(['state', 'lease'])

const HOLD = (ms) => new Promise((done) => setTimeout(done, ms))
const show = (value) => {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return text === undefined ? String(value) : text
  } catch (error) {
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
const pad = (text, width) => {
  const s = String(text)
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const readJson = (path) => {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    return { ok: false, why: describe(error) }
  }
}
const fileDigest = (path) => {
  try {
    const bytes = readFileSync(path)
    return { path, exists: true, bytes: bytes.length, sha256: sha256(bytes) }
  } catch (error) {
    return { path, exists: false, bytes: null, sha256: null, why: describe(error) }
  }
}

class NotMeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NotMeasured'
  }
}

const pwsh = (command, timeoutMs) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: PROJECT, encoding: 'utf8', timeout: timeoutMs === undefined ? 40000 : timeoutMs, windowsHide: true })

/** The identity of the desktop client: pid@start-time. A restart of this is a third state, never a red. */
const clientIdentity = (t) => {
  const query = "[string](Get-Process dsh-link -ErrorAction SilentlyContinue | Select-Object -First 1 | ForEach-Object { $_.Id.ToString() + '@' + $_.StartTime.ToUniversalTime().ToString('o') })"
  t.calls.push({ kind: 'pwsh', purpose: 'client-identity', command: query })
  const done = pwsh(query, 30000)
  if (done.status !== 0) return null
  const text = String(done.stdout === undefined || done.stdout === null ? '' : done.stdout).trim()
  return text === '' ? null : text
}

/** This gate's own ancestor chain, so "another consumer" is never this process's own parent. */
const ancestorPids = (t) => {
  const query = '$ids = @(); $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID);'
    + ' for ($i = 0; $i -lt 12 -and $p -ne $null; $i++) { $ids += [string]$p.ProcessId;'
    + ' if ($p.ParentProcessId -eq 0) { break }; $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [string]$p.ParentProcessId) -ErrorAction SilentlyContinue }'
    + ' [string]::Join(",", $ids)'
  t.calls.push({ kind: 'pwsh', purpose: 'ancestor-chain', command: query })
  const done = pwsh(query, 30000)
  if (done.status !== 0) return []
  return String(done.stdout === undefined || done.stdout === null ? '' : done.stdout).trim().split(',').map((id) => id.trim()).filter((id) => id !== '')
}

const nodeProcesses = (t) => {
  const query = 'Get-CimInstance Win32_Process -Filter "Name=\u0027node.exe\u0027" | ForEach-Object { [string]$_.ProcessId + "|" + [string]$_.ParentProcessId + "|" + [string]$_.CommandLine }'
  t.calls.push({ kind: 'pwsh', purpose: 'single-run-scan', command: query })
  const done = pwsh(query)
  if (done.status !== 0) return { ok: false, why: 'the process list could not be read: ' + clip(String(done.stderr === undefined || done.stderr === null ? '' : done.stderr), 160), rows: [] }
  const rows = String(done.stdout === undefined || done.stdout === null ? '' : done.stdout)
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

/** The register's own list of live gate files, out of scripts/verify-all.mjs (read only; the register is the Lead's). */
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) === false) return { files: [], why: 'scripts/verify-all.mjs is not there', parsed: 0 }
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
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors === undefined ? [] : ancestors)])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  const SELF = 'verify-panel-render.mjs'
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

const guardRead = (t) => {
  const live = liveGateFiles()
  const scan = nodeProcesses(t)
  const ancestors = ancestorPids(t)
  const others = scan.ok === true ? otherConsumers(scan.rows, live, ancestors) : ['(the process list could not be read: ' + String(scan.why) + ')']
  return { liveFiles: live.files.length, parsed: live.parsed, parseNote: live.why, scanOk: scan.ok, scanWhy: scan.why === undefined ? null : scan.why, others, ownPid: String(process.pid) }
}

const gitStatus = (t) => {
  const command = '& git -c core.quotepath=false status --porcelain; "[exit=" + $LASTEXITCODE + "]"'
  t.calls.push({ kind: 'pwsh', purpose: 'git-status', command })
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: PROJECT, encoding: 'utf8', timeout: 40000, windowsHide: true })
  if (done.status !== 0) return { ok: false, why: clip(String(done.stderr === undefined ? '' : done.stderr), 200), text: null, lines: [] }
  const rows = String(done.stdout === undefined ? '' : done.stdout).split(/\r?\n/).map((row) => row.replace(/\r$/, '')).filter((row) => row !== '' && /^\[exit=\d+\]$/.test(row) === false)
  return { ok: true, text: rows.join('\n'), lines: rows }
}

const manifestDigests = () => MANIFEST_PATHS.map((path) => fileDigest(path))

// ---------------------------------------------------------------------------
// The dictionary: the declared words this gate compares the drawn words against
// ---------------------------------------------------------------------------

/** Read the zh block out of the plugin's own locale source. Copied values are how a gate lies. */
const readDictionary = () => {
  if (existsSync(DICTIONARY_PATH) !== true) throw new NotMeasured('the dictionary this gate compares against is not there: ' + DICTIONARY_PATH)
  const text = readFileSync(DICTIONARY_PATH, 'utf8')
  const start = text.indexOf('export const zh = {')
  if (start === -1) throw new NotMeasured('the dictionary source has no "export const zh = {" block: ' + DICTIONARY_PATH)
  const end = text.indexOf('\n}', start)
  const block = text.slice(start, end === -1 ? text.length : end)
  const table = {}
  for (const match of block.matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g)) table[match[1]] = match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  const title = table[TITLE_KEY]
  if (typeof title !== 'string' || title === '') throw new NotMeasured('the zh dictionary carries no "tab.title" value')
  return { path: DICTIONARY_PATH, sha256: sha256(text), keys: Object.keys(table).length, title, description: table['guide.description'] === undefined ? null : table['guide.description'], table }
}

/** What the artifact the page actually runs carries: the title in its literal or its escaped form. */
const readBuilt = (title) => {
  const digest = fileDigest(BUILT_PATH)
  if (digest.exists !== true) return { ...digest, carriesTitle: null, howNamed: 'the built artifact is not there' }
  const text = readFileSync(BUILT_PATH, 'utf8')
  let escaped = ''
  for (const character of title) {
    const code = character.codePointAt(0)
    escaped += code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : character
  }
  // The bundler writes \uXXXX with UPPERCASE hex (measured: "LINK \u9762\u677F"), so the escape is
  // normalised to one case before it is looked for. Matching the two spellings is the reading; neither
  // is assumed.
  const lowered = text.replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => '\\u' + String(hex).toLowerCase())
  const literal = text.includes(title)
  const asEscape = escaped !== title && lowered.includes(escaped)
  return { ...digest, carriesTitle: literal || asEscape, howNamed: literal ? 'literal' : asEscape ? 'escaped as ' + escaped : 'absent from the built bytes' }
}

/**
 * The seat's glyph-size rule, out of the module that draws the guide capsules. Same discipline as the
 * dictionary: the rule is PARSED out of the world, never restated as a constant here, and the two numbers
 * it names are what reading 4 computes its expected box from. A module whose rule cannot be found is a
 * named third state, never a silently assumed 16 or 22.
 */
const readSeatRule = () => {
  if (existsSync(SEAT_RULE_PATH) !== true) throw new NotMeasured('the seat that sizes the guide capsule glyphs is not there: ' + SEAT_RULE_PATH)
  const text = readFileSync(SEAT_RULE_PATH, 'utf8')
  const size = /\bsize=\{([A-Za-z_$][\w$]*) === undefined \? (\d+) : (\d+)\}/.exec(text)
  if (size === null) throw new NotMeasured('the seat module no longer states "size={<flag> === undefined ? <bare> : <described>}", so the box this gate has to judge against cannot be read: ' + SEAT_RULE_PATH)
  const threshold = /const MAX_DESCRIBED_ENTRIES = (\d+)/.exec(text)
  if (threshold === null) throw new NotMeasured('the seat module no longer states MAX_DESCRIBED_ENTRIES, so the condition under which a capsule keeps its description cannot be read: ' + SEAT_RULE_PATH)
  return {
    path: SEAT_RULE_PATH, sha256: sha256(text), source: size[0], flag: size[1],
    bare: Number(size[2]), described: Number(size[3]), maxDescribed: Number(threshold[1]),
    readAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// The live instruments: the shell's own routes, and CDP reads
// ---------------------------------------------------------------------------

const record = (t, entry) => { t.reads.push({ at: new Date().toISOString(), ...entry }) }

const httpGet = async (t, target, url, purpose, timeoutMs) => {
  const entry = { kind: 'http', method: 'GET', target, url, purpose, status: null, ok: false, why: null }
  try {
    const answer = await fetch(url, { signal: AbortSignal.timeout(timeoutMs === undefined ? 12000 : timeoutMs) })
    const text = await answer.text()
    entry.status = answer.status
    entry.ok = answer.status === 200
    let body = null
    try { body = JSON.parse(text) } catch (error) { entry.parse = 'not JSON: ' + clip(text, 120) }
    record(t, entry)
    return { ok: answer.status === 200, status: answer.status, text, body, why: answer.status === 200 ? null : 'HTTP ' + String(answer.status) }
  } catch (error) {
    entry.why = clip(describe(error), 200)
    record(t, entry)
    return { ok: false, status: null, text: null, body: null, why: describe(error) }
  }
}

const shellStatus = (t) => httpGet(t, 'shell', SHELL_ORIGIN + '/__shell/status', 'premise: phase + kernel pid')

/** The CDP page target this gate drives, read (and recorded) so it is a fingerprint rather than a silence. */
const cdpTarget = async (t, purpose) => {
  const list = await httpGet(t, 'cdp', 'http://127.0.0.1:' + String(CDP_PORT) + '/json/list', purpose)
  if (list.ok !== true || Array.isArray(list.body) !== true) return { ok: false, why: list.why, targetId: null, page: null, targets: null }
  const page = list.body.filter((row) => row.type === 'page' && String(row.url).includes(':' + String(PORT)))[0]
  return { ok: true, why: null, targetId: page === undefined ? null : page.id, page: page === undefined ? null : page.url, targets: list.body.length }
}

/** One panel op, recorded. The only two ops this gate may send are state and lease. */
const panelOp = async (t, op, payload, purpose) => {
  if (PANEL_OPS.includes(op) !== true) throw new NotMeasured('this gate tried to send a panel op outside its allowlist: ' + show(op))
  const entry = { kind: 'panel', op, purpose, status: null, ok: false, error: null, body: null }
  try {
    const answer = await fetch(SHELL_ORIGIN + '/__shell/panel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...payload }), signal: AbortSignal.timeout(15000),
    })
    const text = await answer.text()
    entry.status = answer.status
    entry.ok = answer.status === 200
    try { entry.body = JSON.parse(text) } catch (error) { entry.error = 'not JSON: ' + clip(text, 160) }
    if (entry.ok !== true && entry.error === null) entry.error = clip(String(entry.body === null ? text : (entry.body.error === undefined ? text : entry.body.error)), 200)
  } catch (error) {
    entry.error = clip(describe(error), 200)
  }
  entry.state = entry.body === null ? null : (entry.body.state === undefined ? entry.body : entry.body.state)
  record(t, entry)
  return entry
}

const readPanelState = (t, purpose) => panelOp(t, 'state', {}, purpose)

const panelFingerprint = (state) => (state === null || state === undefined ? null : {
  exists: state.exists, mounted: state.mounted, count: state.count, limit: state.limit,
  active: state.active === undefined ? null : state.active,
  tabs: Array.isArray(state.tabs) ? state.tabs.map((row) => row.id) : (state.tabs === undefined ? null : state.tabs),
  viewport: state.viewport, mode: state.mode,
})

const leaseLine = (state) => (state === null || state === undefined || state.lease === undefined ? null : {
  held: state.lease.held, holder: state.lease.holder,
  revokedBy: state.lease.revokedBy === undefined ? null : state.lease.revokedBy,
  revokedHolder: state.lease.revokedHolder === undefined ? null : state.lease.revokedHolder,
  revokedKind: state.lease.revokedKind === undefined ? null : state.lease.revokedKind,
  userInputReports: state.userInputReports === undefined ? null : state.userInputReports,
  lastUserInput: state.lastUserInput === undefined ? null : state.lastUserInput,
})

const cdpCall = async (t, cdp, method, params, purpose) => {
  if (CDP_METHODS.includes(method) !== true) throw new NotMeasured('this gate tried to send a CDP method outside its allowlist: ' + show(method))
  t.cdpCalls.push({ method, purpose, at: new Date().toISOString() })
  return cdp.call(method, params)
}

/** Every page read this gate makes is a JSON.stringify of DOM reads: reading 7 audits exactly that. */
const cdpJson = async (t, cdp, probeName, expression, purpose) => {
  const source = 'JSON.stringify(' + expression + ')'
  t.probes.push({ name: probeName, purpose, source, sha256: sha256(source) })
  const answer = await cdpCall(t, cdp, 'Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true }, purpose)
  const value = answer === undefined || answer === null ? undefined : (answer.result === undefined ? undefined : answer.result.result === undefined ? undefined : answer.result.result.value)
  if (typeof value !== 'string') {
    const why = answer === null || answer === undefined ? 'no answer' : (answer.result === undefined ? String(answer.error === undefined ? 'no answer' : answer.error.message) : String(answer.result.exceptionDetails === undefined ? value : answer.result.exceptionDetails.text))
    return { ok: false, why: 'the probe did not answer a string: ' + clip(why, 200), value: null }
  }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch (error) {
    return { ok: false, why: 'the probe did not answer JSON: ' + describe(error), value: null }
  }
}

const clickSpot = async (t, cdp, spot, purpose) => {
  const base = { x: Math.round(spot.x), y: Math.round(spot.y), button: 'left', pointerType: 'mouse', clickCount: 1 }
  t.inputs.push({ kind: 'mouse', type: 'mousePressed', x: base.x, y: base.y, purpose, at: new Date().toISOString() })
  await cdpCall(t, cdp, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 }, purpose)
  t.inputs.push({ kind: 'mouse', type: 'mouseReleased', x: base.x, y: base.y, purpose, at: new Date().toISOString() })
  await cdpCall(t, cdp, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 }, purpose)
  await HOLD(650)
  return { x: base.x, y: base.y }
}

/** The counter-diff R179 asks for: who the turn was taken from, and by what kind. */
const noteLeaseAfterInput = async (t, purpose) => {
  const read = await readPanelState(t, 'lease after input: ' + purpose)
  const line = { purpose, at: new Date().toISOString(), status: read.status, ...(leaseLine(read.state) === null ? { held: null } : leaseLine(read.state)) }
  t.drive.leaseAfterInput.push(line)
  return line
}

const ensureLease = async (t, purpose) => {
  const before = await readPanelState(t, 'lease before ' + purpose)
  const line = leaseLine(before.state)
  const claim = { purpose, at: new Date().toISOString(), status: before.status, before: line }
  t.drive.claims.push(claim)
  if (line !== null && line.held === true && line.holder === HOLDER) {
    claim.action = 'already ours'
    return true
  }
  if (line !== null && line.held === true && line.holder !== HOLDER) throw new NotMeasured('the panel is leased by ' + show(line.holder) + ' while this gate wants it (' + purpose + ')')
  const held = await claimLease(PORT, HOLDER, LEASE_TTL_MS)
  const after = await readPanelState(t, 'lease after claim for ' + purpose)
  const now = leaseLine(after.state)
  claim.action = 'claim'
  claim.held = held
  claim.after = now
  if (held !== true) throw new NotMeasured('the panel lease could not be taken by ' + HOLDER + ' (' + purpose + '): ' + show(now))
  return true
}

// ---------------------------------------------------------------------------
// The page probes: written as REAL functions and shipped through toString()
// ---------------------------------------------------------------------------
// (The same instrument decision cdp-drive.mjs made for its column probe: an expression assembled from
// quoted strings stops matching the moment the DOM moves, and the labels here are Chinese. The page only
// RUNS what this file parses.)

/** The rail: its box, its chips, and whether the door (the guide) is already on screen. */
function railProbe(ourTitle) {
  const boxOf = (el) => {
    if (el === null || el === undefined) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const rail = document.querySelector('[data-rightbar-col]')
  const chips = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]')).map((tab) => {
    const titleEl = tab.querySelector('[data-dockkit-tab-title]')
    return {
      id: tab.getAttribute('data-dockkit-tab'),
      title: titleEl === null ? null : titleEl.textContent,
      selected: tab.getAttribute('aria-selected') === 'true',
      box: boxOf(tab),
      closeBox: boxOf(tab.querySelector('button[data-dockkit-tab-close]')),
    }
  })
  const addControl = document.querySelector('button[data-dockkit-add-tab]')
  const selected = chips.filter((chip) => chip.selected)[0]
  const ours = chips.filter((chip) => chip.title === ourTitle)[0]
  const guide = document.querySelector('[data-sidebar-right-guide]')
  return {
    href: location.href,
    viewport: [Math.round(window.innerWidth), Math.round(window.innerHeight)],
    dpr: window.devicePixelRatio,
    rail: boxOf(rail),
    chips: chips,
    selected: selected === undefined ? null : selected.title,
    addControl: boxOf(addControl),
    addControlFor: addControl === null ? null : addControl.getAttribute('data-dockkit-add-tab'),
    guideOpen: guide !== null,
    surfaceCount: document.querySelectorAll('[data-dsh-link-surface]').length,
    ourChip: ours === undefined ? null : ours,
    ourTitleSeats: document.querySelectorAll('[data-panel-title]').length,
    ourBodies: document.querySelectorAll('[data-panel-tab]').length,
  }
}

/** The guide page: every capsule the world offers, and the glyph on the one that is ours. */
function guideProbe(ourTitle) {
  const boxOf = (el) => {
    if (el === null || el === undefined) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const rail = document.querySelector('[data-rightbar-col]')
  /**
   * Every box the LIVE sheets declare for this element: the skin's own word on how big the seat draws at
   * this holder. Rules are matched with el.matches, so what is collected is what this very element obeys;
   * a sheet whose rules cannot be read is skipped rather than guessed at.
   */
  const declaredBoxes = (el) => {
    if (el === null || el === undefined) return []
    const out = []
    for (const sheet of Array.from(document.styleSheets)) {
      let rules
      try { rules = sheet.cssRules } catch (error) { continue }
      for (const rule of Array.from(rules)) {
        if (rule.style === undefined || rule.style === null || typeof rule.selectorText !== 'string') continue
        const width = rule.style.getPropertyValue('width')
        const height = rule.style.getPropertyValue('height')
        if (/^[0-9.]+px$/.test(width) !== true || width !== height) continue
        try { if (el.matches(rule.selectorText) !== true) continue } catch (error) { continue }
        out.push({ selector: rule.selectorText, width: width, height: height, px: Number.parseFloat(width), sheet: sheet.href === null ? '(inline style tag)' : sheet.href.split('/').pop() })
      }
    }
    return out
  }
  const entries = Array.from(document.querySelectorAll('[data-sidebar-right-guide-entry]')).map((entry) => {
    const children = Array.from(entry.children)
    const iconHolder = children[0] === undefined ? null : children[0]
    const textHolder = children[1] === undefined ? null : children[1]
    const svg = iconHolder === null ? null : iconHolder.querySelector('svg')
    const style = svg === null ? null : getComputedStyle(svg)
    const titleEl = textHolder === null ? null : textHolder.children[0]
    const descriptionEl = textHolder === null ? null : textHolder.children[1]
    return {
      kind: entry.getAttribute('data-sidebar-right-guide-entry'),
      box: boxOf(entry),
      text: entry.textContent,
      titleText: titleEl === undefined || titleEl === null ? null : titleEl.textContent,
      descriptionText: descriptionEl === undefined || descriptionEl === null ? null : descriptionEl.textContent,
      textChildren: textHolder === null ? null : textHolder.children.length,
      describedLine: textHolder === null ? null : textHolder.children.length > 1,
      shortcutText: children.length > 2 && children[2] !== null ? children[2].textContent : null,
      icon: svg === null ? null : {
        box: boxOf(svg),
        holderBox: boxOf(iconHolder),
        reservedBoxes: declaredBoxes(iconHolder),
        viewBox: svg.getAttribute('viewBox'),
        widthAttr: svg.getAttribute('width'),
        heightAttr: svg.getAttribute('height'),
        strokeAttr: svg.getAttribute('stroke'),
        fillAttr: svg.getAttribute('fill'),
        stroke: style.stroke,
        fill: style.fill,
        color: style.color,
        strokeWidth: style.strokeWidth,
        holderColor: iconHolder === null ? null : getComputedStyle(iconHolder).color,
        capsuleColor: getComputedStyle(entry).color,
        paths: svg.querySelectorAll('path').length,
        ariaHidden: svg.getAttribute('aria-hidden'),
        inRail: rail !== null && rail.contains(svg),
      },
    }
  })
  const oursIndex = entries.map((row) => row.titleText).indexOf(ourTitle)
  const ours = oursIndex === -1 ? undefined : entries[oursIndex]
  const selectedTab = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]')).filter((tab) => tab.getAttribute('aria-selected') === 'true')[0]
  return {
    guideOpen: document.querySelector('[data-sidebar-right-guide]') !== null,
    rail: boxOf(rail),
    entries: entries,
    oursIndex: oursIndex,
    ours: ours === undefined ? null : ours,
    selected: selectedTab === undefined ? null : selectedTab.textContent,
  }
}

/** The pane we opened: its chip, its body box and visibility, and every word it drew. */
function tabProbe(ourTitle) {
  const boxOf = (el) => {
    if (el === null || el === undefined) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const rail = document.querySelector('[data-rightbar-col]')
  const railBox = boxOf(rail)
  const chips = Array.from(document.querySelectorAll('[role=tab][data-dockkit-tab]')).map((tab) => {
    const titleEl = tab.querySelector('[data-dockkit-tab-title]')
    const close = tab.querySelector('button[data-dockkit-tab-close]')
    return {
      id: tab.getAttribute('data-dockkit-tab'),
      title: titleEl === null ? null : titleEl.textContent,
      selected: tab.getAttribute('aria-selected') === 'true',
      box: boxOf(tab),
      closeBox: boxOf(close),
      closeId: close === null ? null : close.getAttribute('data-dockkit-tab-close'),
    }
  })
  const chip = chips.filter((row) => row.title === ourTitle)[0]
  const body = document.querySelector('[data-panel-tab]')
  const bodyBox = boxOf(body)
  const style = body === null ? null : getComputedStyle(body)
  const intersects = bodyBox === null || railBox === null ? null
    : (bodyBox.x + bodyBox.w > railBox.x && railBox.x + railBox.w > bodyBox.x && bodyBox.y + bodyBox.h > railBox.y && railBox.y + railBox.h > bodyBox.y)
  const reads = document.querySelector('[data-panel-reads]')
  const host = document.querySelector('[data-dockkit-pane-active="true"]')
  const rows = Array.from(document.querySelectorAll('[data-panel-item]')).map((row) => {
    const titleEl = row.querySelector('[data-panel-item-title]')
    const metaEl = row.querySelector('[data-panel-item-meta]')
    return {
      id: row.getAttribute('data-panel-item'),
      kind: row.getAttribute('data-panel-item-kind'),
      sink: row.getAttribute('data-panel-item-sink'),
      title: titleEl === null ? null : titleEl.textContent,
      meta: metaEl === null ? null : metaEl.textContent,
      box: boxOf(row),
    }
  })
  const notes = Array.from(document.querySelectorAll('[data-note-row]')).map((row) => {
    const textEl = row.querySelector('[data-note-text]')
    const authorEl = row.querySelector('[data-note-author]')
    return {
      id: row.getAttribute('data-note-row'),
      state: row.getAttribute('data-note-state'),
      text: textEl === null ? null : textEl.textContent,
      author: authorEl === null ? null : authorEl.textContent,
      box: boxOf(row),
    }
  })
  const titleSeat = chip === undefined ? null : document.querySelector('[data-dockkit-tab="' + chip.id + '"] [data-panel-title]')
  return {
    chips: chips,
    chip: chip === undefined ? null : chip,
    chipSelected: chip === undefined ? null : chip.selected,
    chipTitleText: chip === undefined ? null : chip.title,
    titleSpanText: titleSeat === null ? null : titleSeat.textContent,
    body: {
      box: bodyBox,
      display: style === null ? null : style.display,
      visibility: style === null ? null : style.visibility,
      opacity: style === null ? null : style.opacity,
      checkVisibility: body === null ? null : (typeof body.checkVisibility === 'function' ? body.checkVisibility() : null),
      textLength: body === null ? null : body.textContent.length,
    },
    railBox: railBox,
    intersectsRail: intersects,
    paneHostBox: boxOf(host),
    readsAttr: reads === null ? null : reads.getAttribute('data-panel-reads'),
    itemRows: rows,
    noteRows: notes,
    refusedRows: document.querySelectorAll('[data-panel-refusal]').length,
    failureRows: Array.from(document.querySelectorAll('[data-panel-failure]')).map((row) => ({ code: row.getAttribute('data-panel-failure'), text: row.textContent })),
    emptyRows: Array.from(document.querySelectorAll('[data-panel-empty]')).map((row) => row.getAttribute('data-panel-empty')),
    surfaceCount: document.querySelectorAll('[data-dsh-link-surface]').length,
  }
}

const probeExpression = (fn, argument) => '(' + fn.toString() + ')(' + JSON.stringify(argument) + ')'

// ---------------------------------------------------------------------------
// Pixels: the crop, and how much of it is not its own background
// ---------------------------------------------------------------------------

/** Count the pixels that are not the crop's own commonest colour: "is anything INKED here at all". */
const inkCount = (image) => {
  const counts = new Map()
  const keyAt = (at) => String(image.pixels[at]) + ',' + String(image.pixels[at + 1]) + ',' + String(image.pixels[at + 2])
  for (let at = 0; at < image.pixels.length; at += image.channels) {
    const key = keyAt(at)
    counts.set(key, (counts.get(key) === undefined ? 0 : counts.get(key)) + 1)
  }
  let background = '0,0,0'
  let best = -1
  for (const row of counts) if (row[1] > best) { best = row[1]; background = row[0] }
  const parts = background.split(',').map(Number)
  let ink = 0
  for (let at = 0; at < image.pixels.length; at += image.channels) {
    const delta = Math.max(Math.abs(image.pixels[at] - parts[0]), Math.abs(image.pixels[at + 1] - parts[1]), Math.abs(image.pixels[at + 2] - parts[2]))
    if (delta > 10) ink += 1
  }
  return { background, distinctColours: counts.size, ink, pixels: image.width * image.height }
}

/** One rectangle of the live window, in device pixels. The clip is given in CSS pixels (measured: CDP multiplies by devicePixelRatio). */
const screenshot = async (t, cdp, box, purpose) => {
  if (box === null || box === undefined || box.w <= 0 || box.h <= 0) return { ok: false, why: 'the rectangle to capture is empty: ' + show(box), box: box === undefined ? null : box }
  const clipRect = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(1, box.w), height: Math.max(1, box.h), scale: 1 }
  const answer = await cdpCall(t, cdp, 'Page.captureScreenshot', { format: 'png', clip: clipRect }, purpose)
  const base64 = answer === null || answer === undefined ? undefined : (answer.result === undefined ? undefined : answer.result.data)
  if (base64 === undefined) return { ok: false, why: 'the capture failed: ' + clip(show(answer).slice(0, 200), 200), clip: clipRect }
  try {
    const buffer = Buffer.from(base64, 'base64')
    const image = decode(buffer)
    const summary = stats(image)
    const ink = inkCount(image)
    return {
      ok: true, clip: clipRect, bytes: buffer.length, width: image.width, height: image.height, channels: image.channels,
      mean: summary.mean, spread: summary.spread, nonBlank: ink.ink, background: ink.background,
      distinctColours: ink.distinctColours, sha256: clip(sha256(buffer), 16),
    }
  } catch (error) {
    return { ok: false, why: 'the capture could not be decoded: ' + describe(error), clip: clipRect }
  }
}

// ---------------------------------------------------------------------------
// The drive: one pass over the live world
// ---------------------------------------------------------------------------

const runWorld = async (bag) => {
  const t = {
    schema: 'r191-g126-transcript/1',
    startedAt: new Date().toISOString(),
    shellOrigin: SHELL_ORIGIN, kernelOrigin: KERNEL_ORIGIN,
    ports: { shell: PORT, kernel: KERNEL_PORT, cdp: CDP_PORT },
    holder: HOLDER, gatePid: process.pid,
    dictionary: null, built: null, seatRule: null,
    entry: null, drive: null, restore: null, exit: null,
    inputs: [], cdpCalls: [], probes: [], reads: [], calls: [], notes: [], problems: [],
  }
  const cdp = await connectCdp({ port: CDP_PORT })
  if (cdp === null) throw new NotMeasured('no CDP page on port ' + String(CDP_PORT) + ', so nothing can be looked at')
  // The socket is handed to the caller so EVERY exit path closes it: an open WebSocket keeps the Node
  // event loop alive, and a gate that declines (exit 3) must still EXIT - measured: the first version hung
  // forever on the missing-premise path with the process still alive after its last line had printed.
  if (bag !== undefined && bag !== null) bag.cdp = cdp

  // ---- premises ----
  const status = await shellStatus(t)
  if (status.ok !== true || status.body === null) throw new NotMeasured('the shell did not answer GET /__shell/status (' + String(status.why) + ')')
  if (status.body.phase !== 'ready') throw new NotMeasured('the shell reports phase=' + show(status.body.phase) + ', not ready')
  const panelRoute = await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'premise: the registry route the pane draws from')
  if (panelRoute.ok !== true || panelRoute.body === null || panelRoute.body.ok !== true) throw new NotMeasured('GET ' + PANEL_STATE_PATH + ' did not answer 200 ok=true: ' + show({ status: panelRoute.status, why: panelRoute.why }))
  const notesRoute = await httpGet(t, 'kernel', KERNEL_ORIGIN + NOTES_STATE_PATH, 'premise + the ledger this pane draws')
  if (notesRoute.ok !== true || notesRoute.body === null || notesRoute.body.ok !== true) throw new NotMeasured('GET ' + NOTES_STATE_PATH + ' did not answer 200 ok=true: ' + show({ status: notesRoute.status, why: notesRoute.why }))

  const dictionary = readDictionary()
  const TITLE = dictionary.title
  t.dictionary = {
    path: dictionary.path, sha256: dictionary.sha256, keys: dictionary.keys, titleKey: TITLE_KEY,
    title: TITLE, guideDescription: dictionary.description, readAt: new Date().toISOString(),
  }
  t.built = readBuilt(TITLE)
  t.seatRule = readSeatRule()

  const rail = await cdpJson(t, cdp, 'rail-at-entry', probeExpression(railProbe, TITLE), 'premise: the rail as this gate found it')
  if (rail.ok !== true) throw new NotMeasured('the rail could not be read: ' + String(rail.why))
  if (rail.value.chips.length === 0) throw new NotMeasured('the rail holds no tab at all: ' + show(rail.value))
  const stateAtEntry = await readPanelState(t, 'entry fingerprint')
  const cdpAtEntry = await cdpTarget(t, 'premise: the CDP page target this gate drives')
  t.entry = {
    status: { phase: status.body.phase, pid: status.body.pid === undefined ? null : status.body.pid, port: status.body.port === undefined ? null : status.body.port, version: status.body.version === undefined ? null : status.body.version, message: status.body.message === undefined ? null : status.body.message },
    client: clientIdentity(t),
    cdp: { targetId: cdpAtEntry.targetId, page: cdp.page, port: CDP_PORT, readOk: cdpAtEntry.ok, targets: cdpAtEntry.targets },
    rail: rail.value,
    panel: panelFingerprint(stateAtEntry.state),
    lease: leaseLine(stateAtEntry.state),
    routes: {
      panel: { status: panelRoute.status, body: panelRoute.body },
      notes: { status: notesRoute.status, body: notesRoute.body },
    },
    manifest: manifestDigests(),
    gitStatus: gitStatus(t),
  }
  t.entry.guard = guardRead(t)
  if (t.entry.lease !== null && t.entry.lease.held === true && t.entry.lease.holder !== HOLDER) throw new NotMeasured('the panel was already leased by ' + show(t.entry.lease.holder) + ' when this gate arrived')
  if (t.entry.guard.others.length > 0) throw new NotMeasured('another live consumer is running beside this gate: ' + t.entry.guard.others.join(' | '))

  // ---- the lease, before anything that clicks ----
  t.drive = { claims: [], leaseAfterInput: [], door: { used: null, walk: [], guideOpenBefore: rail.value.guideOpen }, guide: null, entry: null, capsuleClick: null, tab: null, routes: null, screenshots: {}, shape: null, waits: [] }
  await ensureLease(t, 'before the door was opened')

  /**
   * The strip re-lays itself out when a tab arrives (measured: our chip sat at x=1092 right after the guide
   * came back and at x=1144 once the strip settled, and the first close click therefore landed on the chip
   * BODY and only reselected our tab). A box is only clicked after it has been read twice and found unchanged.
   */
  const stableOurChip = async (rounds) => {
    let previous = null
    let seen = null
    for (let round = 0; round < rounds; round += 1) {
      const answer = await cdpJson(t, cdp, 'our-chip-stable', probeExpression(railProbe, TITLE), 'our own chip, read twice, so only a box that is not moving is clicked')
      seen = answer.ok === true ? (answer.value.ourChip === undefined ? null : answer.value.ourChip) : null
      if (seen !== null && previous !== null && same(seen, previous) === true) return { chip: seen, rounds: round + 1, stable: true }
      previous = seen
      if (seen === null) return { chip: null, rounds: round + 1, stable: false }
      await HOLD(400)
    }
    return { chip: seen, rounds, stable: false }
  }

  // ---- the door: the world's own way into an extension tab ----
  let railNow = rail.value
  if (railNow.ourChip !== null && railNow.ourChip !== undefined) {
    t.notes.push('note: the rail already carried our tab as a chip at entry (' + show(railNow.ourChip.title) + '); the door is walked anyway, so the glyph reading has its scene')
  }
  if (railNow.guideOpen !== true) {
    if (railNow.addControl !== null && railNow.addControl !== undefined) {
      t.drive.door.used = 'the strip own add control (button[data-dockkit-add-tab])'
      await ensureLease(t, 'before opening the guide with the add control')
      await clickSpot(t, cdp, { x: railNow.addControl.x + Math.round(railNow.addControl.w / 2), y: railNow.addControl.y + Math.round(railNow.addControl.h / 2) }, 'select-guide')
      await noteLeaseAfterInput(t, 'select-guide')
      await HOLD(700)
    } else {
      t.drive.door.used = 'the rail own chips, walked from the last to the first'
      const order = [...railNow.chips].reverse()
      for (const chip of order) {
        if (chip.box === null || chip.box === undefined) continue
        await ensureLease(t, 'before walking to the chip ' + show(chip.title))
        await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, WALK_PURPOSE(chip.title))
        await noteLeaseAfterInput(t, 'walk-chip:' + String(chip.title))
        const seen = await cdpJson(t, cdp, 'guide-after-walk', 'document.querySelector("[data-sidebar-right-guide]") !== null', 'did this chip open the guide')
        const opened = seen.ok === true && seen.value === true
        t.drive.door.walk.push({ chip: chip.title, clicked: true, guideOpen: opened })
        if (opened === true) break
      }
    }
  } else {
    t.drive.door.used = 'the guide was already the selected tab when this gate arrived'
  }
  const guide = await cdpJson(t, cdp, 'guide-page', probeExpression(guideProbe, TITLE), 'the guide page and its capsules')
  t.drive.guide = guide.ok === true ? guide.value : { error: guide.why, entries: [], ours: null }
  t.drive.entry = t.drive.guide.ours === undefined ? null : t.drive.guide.ours
  t.drive.door.found = t.drive.entry !== null
  if (t.drive.entry === null) {
    t.notes.push('the rail\'s real tab list: ' + show(railNow.chips.map((chip) => chip.title + (chip.selected ? '*' : ''))))
    t.notes.push('the guide\'s real capsule list: ' + show((t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).map((row) => row.titleText + ' [' + row.kind + ']')))
    t.problems.push('no door to our tab was found: the guide offers ' + String((t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length) + ' capsule(s), none titled ' + show(TITLE))
    return t
  }
  t.drive.screenshots.glyph = await screenshot(t, cdp, t.drive.entry.icon === null ? null : t.drive.entry.icon.box, 'the glyph our package contributed, as the guide draws it')

  // ---- the click that opens our tab ----
  const capsule = t.drive.entry
  await ensureLease(t, 'before clicking our capsule')
  const landed = await clickSpot(t, cdp, { x: capsule.box.x + Math.round(capsule.box.w / 2), y: capsule.box.y + Math.round(capsule.box.h / 2) }, 'select-our-tab')
  await noteLeaseAfterInput(t, 'select-our-tab')
  t.drive.capsuleClick = { x: landed.x, y: landed.y, box: capsule.box, title: capsule.titleText }
  t.drive.shape = railNow.ourChip === null || railNow.ourChip === undefined ? 'opened-by-this-gate' : 'already-open-at-entry'

  const deadline = Date.now() + 12000
  let probe = null
  for (;;) {
    await HOLD(600)
    const seen = await cdpJson(t, cdp, 'pane-after-click', probeExpression(tabProbe, TITLE), 'the pane our click opened')
    probe = seen.ok === true ? seen.value : { error: seen.why }
    const ready = probe.chip !== null && probe.chip !== undefined && probe.chipSelected === true && probe.body !== null && probe.body !== undefined && probe.body.box !== null && probe.body.box !== undefined
    if (ready === true || Date.now() > deadline) break
  }
  t.drive.tab = probe
  t.drive.waits.push({ until: 'our chip selected and its body box non-empty', reached: probe !== null && probe.chip !== null && probe.chip !== undefined && probe.chipSelected === true && probe.body !== null && probe.body !== undefined && probe.body.box !== null && probe.body.box !== undefined, at: new Date().toISOString() })
  t.drive.routes = {
    panel: await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'the registry as it stands while the pane is drawn'),
    notes: await httpGet(t, 'kernel', KERNEL_ORIGIN + NOTES_STATE_PATH, 'the ledger as it stands while the pane is drawn'),
  }
  if (probe !== null && probe.body !== null && probe.body !== undefined && probe.body.box !== null && probe.body.box !== undefined) {
    t.drive.screenshots.body = await screenshot(t, cdp, probe.body.box, 'our pane own rectangle, in pixels')
  }

  // ---- the restore ----
  t.restore = { steps: [], openedByThisGate: t.drive.shape === 'opened-by-this-gate', leaseReleased: false, guideBack: false, ourTabClosed: false, entryTabReselected: false, railAfter: null, leaseAfter: null }
  try {
    if (t.restore.openedByThisGate === true) {
      const railAfter = await cdpJson(t, cdp, 'rail-before-restore', probeExpression(railProbe, TITLE), 'the rail before it is put back')
      const addControl = railAfter.ok === true ? railAfter.value.addControl : null
      if (addControl !== null && addControl !== undefined) {
        await ensureLease(t, 'before bringing the guide back')
        await clickSpot(t, cdp, { x: addControl.x + Math.round(addControl.w / 2), y: addControl.y + Math.round(addControl.h / 2) }, 'restore-guide')
        await noteLeaseAfterInput(t, 'restore-guide')
        const back = await cdpJson(t, cdp, 'guide-back', 'document.querySelector("[data-sidebar-right-guide]") !== null', 'did the guide come back')
        t.restore.guideBack = back.ok === true && back.value === true
        t.restore.steps.push('the guide was brought back through the strip own add control: ' + show(t.restore.guideBack))
      } else {
        t.restore.steps.push('the strip offered no add control after our tab replaced the guide: this gate cannot put the door back by itself')
      }
      let closed = false
      for (let attempt = 0; attempt < 3 && closed !== true; attempt += 1) {
        const settled = await stableOurChip(5)
        const chip = settled.chip
        if (chip === null || chip === undefined) {
          closed = true
          t.restore.steps.push('our chip was already gone before the close click (attempt ' + String(attempt + 1) + ')')
          break
        }
        // The product shows a chip close control on the ACTIVE chip (.tabClose is opacity 0, .tabActive .tabClose
        // is 1 - dockkit.module.css:433/443; measured: a click at the control of a non-active chip only SELECTED
        // that chip). So our chip is selected first and only then is its own control clicked.
        let current = chip
        if (current.selected !== true) {
          await ensureLease(t, 'before selecting our own chip, so its own close control is the one on show')
          await clickSpot(t, cdp, { x: current.box.x + Math.round(current.box.w / 2), y: current.box.y + Math.round(current.box.h / 2) }, 'restore-select-our-tab')
          await noteLeaseAfterInput(t, 'restore-select-our-tab')
          await HOLD(450)
          const again = await stableOurChip(5)
          current = again.chip
          if (current === null || current === undefined) {
            closed = true
            t.restore.steps.push('our chip went away while it was being selected (attempt ' + String(attempt + 1) + ')')
            break
          }
        }
        const close = current.closeBox === undefined ? null : current.closeBox
        if (close === null) {
          t.restore.steps.push('our chip carried no close control, so this gate could not close the tab it opened (chip box ' + show(current.box) + ')')
          break
        }
        await ensureLease(t, 'before closing our own tab')
        await clickSpot(t, cdp, { x: close.x + Math.round(close.w / 2), y: close.y + Math.round(close.h / 2) }, 'restore-close-our-tab')
        await noteLeaseAfterInput(t, 'restore-close-our-tab')
        await HOLD(500)
        const gone = await cdpJson(t, cdp, 'our-tab-gone', probeExpression(railProbe, TITLE), 'did our chip go')
        closed = gone.ok === true && (gone.value.ourChip === null || gone.value.ourChip === undefined)
        t.restore.steps.push('our own tab closed through its chip own close control: ' + show(closed) + ' (attempt ' + String(attempt + 1) + ', close box ' + show(close) + ', box unchanged over ' + String(settled.rounds) + ' read(s)=' + show(settled.stable) + ')')
      }
      t.restore.ourTabClosed = closed
    }
    const wantEntry = t.entry.rail.selected
    const beforeEntry = await cdpJson(t, cdp, 'rail-before-reselect', probeExpression(railProbe, TITLE), 'the rail before the entry tab is reselected')
    if (beforeEntry.ok === true && beforeEntry.value.selected !== wantEntry && wantEntry !== null && wantEntry !== undefined) {
      const chip = beforeEntry.value.chips.filter((row) => row.title === wantEntry)[0]
      if (chip !== undefined && chip.box !== null && chip.box !== undefined) {
        await ensureLease(t, 'before reselecting the entry tab')
        await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, 'restore-entry-tab')
        await noteLeaseAfterInput(t, 'restore-entry-tab')
        t.restore.steps.push('the entry tab ' + show(wantEntry) + ' was reselected')
      } else {
        t.restore.steps.push('the entry tab ' + show(wantEntry) + ' is no longer in the rail, so it could not be reselected')
      }
    } else {
      t.restore.steps.push('the entry tab was already selected again: ' + show(wantEntry))
    }
    t.restore.entryTabReselected = true
    const afterRail = await cdpJson(t, cdp, 'rail-after-restore', probeExpression(railProbe, TITLE), 'the rail as this gate leaves it')
    t.restore.railAfter = afterRail.ok === true ? afterRail.value : null
  } catch (error) {
    t.restore.steps.push('the restore stopped: ' + describe(error))
  } finally {
    await releaseLease(PORT, HOLDER)
    const released = await readPanelState(t, 'lease after release')
    t.restore.leaseReleased = released.state === null || released.state.lease === undefined || released.state.lease.held !== true
    t.restore.leaseAfter = leaseLine(released.state)
    if (t.restore.railAfter === null || t.restore.railAfter === undefined) {
      const afterRail = await cdpJson(t, cdp, 'rail-after-release', probeExpression(railProbe, TITLE), 'the rail as this gate leaves it, read after the lease went back')
      t.restore.railAfter = afterRail.ok === true ? afterRail.value : null
    }
  }

  // ---- the exit fingerprint ----
  const statusAfter = await shellStatus(t)
  const stateAfter = await readPanelState(t, 'exit fingerprint')
  const cdpAtExit = await cdpTarget(t, 'exit fingerprint: the CDP page target')
  t.exit = {
    status: statusAfter.body === null ? null : { phase: statusAfter.body.phase, pid: statusAfter.body.pid === undefined ? null : statusAfter.body.pid, port: statusAfter.body.port === undefined ? null : statusAfter.body.port, version: statusAfter.body.version === undefined ? null : statusAfter.body.version, message: statusAfter.body.message === undefined ? null : statusAfter.body.message },
    client: clientIdentity(t),
    cdp: { targetId: cdpAtExit.targetId, page: cdp.page, port: CDP_PORT, readOk: cdpAtExit.ok, targets: cdpAtExit.targets },
    rail: t.restore.railAfter,
    panel: panelFingerprint(stateAfter.state),
    lease: leaseLine(stateAfter.state),
    routes: {
      panel: await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'exit fingerprint: the registry'),
      notes: await httpGet(t, 'kernel', KERNEL_ORIGIN + NOTES_STATE_PATH, 'exit fingerprint: the ledger'),
    },
    manifest: manifestDigests(),
    gitStatus: gitStatus(t),
  }
  // The tree is shared: another author editing a tracked file while this gate runs moves git status, and
  // R191 section 3 says a world moved by somebody else is a NAMED THIRD STATE, never a product red. What
  // stays judgeable is whether a file THIS GATE wrote shows up in the difference - its only write is its
  // own transcript, inside the git-ignored scratch.
  const ourWrites = t.calls.filter((row) => row.kind === 'file-write').map((row) => row.path)
  if (t.entry.gitStatus.ok === true && t.exit.gitStatus.ok === true && t.entry.gitStatus.text !== t.exit.gitStatus.text) {
    const entryLines = new Set(t.entry.gitStatus.lines)
    const exitLines = new Set(t.exit.gitStatus.lines)
    const appeared = [...exitLines].filter((line) => entryLines.has(line) === false)
    const vanished = [...entryLines].filter((line) => exitLines.has(line) === false)
    const ours = appeared.filter((line) => ourWrites.some((path) => line.includes(path))).concat(vanished.filter((line) => ourWrites.some((path) => line.includes(path))))
    t.worldMoved = { appeared, vanished, ours, ourWrites, at: new Date().toISOString() }
    t.notes.push('NOT MEASURED in the world: git status --porcelain is not the same at both ends - appeared ' + show(appeared) + ', vanished ' + show(vanished) + '. This gate wrote exactly ' + show(ourWrites) + ' (all inside the git-ignored scratch ' + String(SCRATCH_DIR) + '), and none of it is in that difference' + (ours.length > 0 ? ' EXCEPT ' + show(ours) + ', which is this gate own doing' : '') + ': the rest is somebody else working in the same tree, printed here so it can be told from this gate own writes')
  }
  t.notes.push('this round OPENED a pane: kind=pane (dsh-link-panel) was brought on screen in the right rail and taken down again by this gate, and the rail was put back on the tab that was selected when it arrived (' + show(t.entry.rail.selected) + ')')
  t.finishedAt = new Date().toISOString()
  cdp.close()
  return t
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript
// ---------------------------------------------------------------------------

const OK = (detail) => ({ ok: true, detail })
const BAD = (detail) => ({ ok: false, detail })
const NOT_MEASURED = (detail) => ({ ok: false, notMeasured: true, detail })

/** What a registry answer DECLARES, without the per-request counter and timestamp this gate own reads move. */
const stableRoute = (route) => (route === null || route === undefined || route.body === null || route.body === undefined ? null : { readOnly: route.body.readOnly, path: route.body.path, registry: route.body.registry, declared: route.body.declared, mounted: route.body.mounted })

/** What a ledger answer DECLARES, without its per-request counter and timestamp. */
const stableLedger = (route) => (route === null || route === undefined || route.body === null || route.body === undefined ? null : { readOnly: route.body.readOnly, path: route.body.path, limits: route.body.limits, counts: route.body.counts, notes: route.body.notes })

/**
 * The seat's own numbers as the transcript recorded them. NOTHING in this file answers "how big should the
 * box be": the answer is the seat module's own rule, evaluated for the shape THIS capsule was drawn with,
 * and held against two live witnesses - the box the running skin reserves for that glyph holder, and the
 * sizes the seat drew for the guide's other capsules carrying a glyph of the same drawn shape.
 */
const seatFacts = (t, guide, caps, icon) => {
  const rule = t !== null && t !== undefined && t.seatRule !== undefined && t.seatRule !== null ? t.seatRule : null
  const entries = Array.isArray(guide.entries) ? guide.entries : []
  const oursIndex = typeof guide.oursIndex === 'number' && guide.oursIndex >= 0 ? guide.oursIndex
    : entries.map((row) => (row === null || row === undefined ? null : row.titleText)).indexOf(caps === null || caps === undefined ? null : caps.titleText)
  // What the SEAT DREW for this capsule: a description line under the title or a bare title. The registry
  // entry may well declare a description (ours does) and the seat may still drop it - what counts is drawn.
  const described = caps === null || caps === undefined ? null
    : (caps.describedLine === undefined || caps.describedLine === null
      ? (caps.descriptionText === null || caps.descriptionText === undefined ? false : true)
      : caps.describedLine === true)
  const expected = rule === null || Number.isFinite(rule.bare) !== true || Number.isFinite(rule.described) !== true
    ? null
    : (described === true ? rule.described : rule.bare)
  const peers = entries.filter((row, at) => at !== oursIndex && row !== null && row !== undefined
    && row.icon !== null && row.icon !== undefined && row.describedLine === described
    && row.icon.box !== null && row.icon.box !== undefined)
  const peerBoxes = peers.map((row) => ({ kind: row.kind, title: row.titleText, box: row.icon.box, declared: String(row.icon.widthAttr) + 'x' + String(row.icon.heightAttr) }))
  const peerSizes = [...new Set(peerBoxes.map((row) => row.box.w))]
  const reserve = icon === null || icon === undefined || Array.isArray(icon.reservedBoxes) !== true ? null : icon.reservedBoxes
  return {
    rule, described, expected, entries: entries.length, oursIndex,
    peers: peerBoxes, peerSizes, consensus: peerSizes.length === 1 ? peerSizes[0] : null,
    reserve, reserveSizes: [...new Set((reserve === null ? [] : reserve).map((row) => row.px))],
    holder: icon === null || icon === undefined || icon.holderBox === undefined ? null : icon.holderBox,
  }
}

const factsOf = (t) => {
  const title = t !== null && t !== undefined && t.dictionary !== null && t.dictionary !== undefined ? t.dictionary.title : null
  const entry = (t === null || t === undefined ? null : t.entry) === undefined ? {} : t.entry
  const drive = (t === null || t === undefined ? null : t.drive) === undefined ? {} : t.drive
  const guide = drive.guide === null || drive.guide === undefined ? {} : drive.guide
  const caps = guide.ours === undefined ? null : guide.ours
  const icon = caps === null || caps === undefined ? null : (caps.icon === undefined ? null : caps.icon)
  const tab = drive.tab === null || drive.tab === undefined ? {} : drive.tab
  const body = tab.body === null || tab.body === undefined ? {} : tab.body
  const route = drive.routes === null || drive.routes === undefined ? {} : drive.routes
  const visible = route.panel === null || route.panel === undefined || route.panel.body === null || route.panel.body === undefined || Array.isArray(route.panel.body.declared === undefined ? null : route.panel.body.declared.visible) !== true ? null : route.panel.body.declared.visible
  const ledger = route.notes === null || route.notes === undefined || route.notes.body === null || route.notes.body === undefined || Array.isArray(route.notes.body.notes) !== true ? null : route.notes.body.notes
  const itemRows = Array.isArray(tab.itemRows) ? tab.itemRows : []
  const noteRows = Array.isArray(tab.noteRows) ? tab.noteRows : []
  const seat = seatFacts(t, guide, caps, icon)
  return { t, title, entry, drive, guide, caps, icon, tab, body, route, visible, ledger, itemRows, noteRows, seat }
}

const READINGS = [
  {
    id: '0-premises-ports-ready-and-the-same-two-processes',
    judge: (t) => {
      const problems = []
      const entry = t.entry === null || t.entry === undefined ? {} : t.entry
      if (entry.status === undefined || entry.status === null || entry.status.phase !== 'ready') problems.push('the shell did not report phase=ready at entry: ' + show(entry.status === undefined ? null : entry.status.phase))
      if (t.exit === null || t.exit === undefined || t.exit.status === null || t.exit.status.phase !== 'ready') problems.push('the shell did not report phase=ready at exit: ' + show(t.exit === null || t.exit === undefined || t.exit.status === null ? null : t.exit.status.phase))
      if (entry.status === undefined || entry.status === null || entry.status.pid === null || entry.status.pid === undefined) problems.push('the shell reports no kernel pid, so a restart could not be told from a steady world')
      else if (t.exit === null || t.exit.status === null || t.exit.status.pid !== entry.status.pid) problems.push('the kernel pid moved during this gate: ' + show(entry.status.pid) + ' -> ' + show(t.exit === null || t.exit.status === null ? null : t.exit.status.pid))
      if (entry.client === null || entry.client === undefined) problems.push('the desktop client own pid@start-time could not be read at entry: the world own process is not witnessed')
      else if (t.exit === null || t.exit.client !== entry.client) problems.push('the desktop client was replaced during this gate: ' + show(entry.client) + ' -> ' + show(t.exit === null ? null : t.exit.client))
      if (entry.cdp === undefined || entry.cdp === null || t.exit === null || t.exit.cdp === null || t.exit.cdp.targetId !== entry.cdp.targetId) problems.push('the CDP page target was replaced during this gate: ' + show(entry.cdp === undefined || entry.cdp === null ? null : entry.cdp.targetId) + ' -> ' + show(t.exit === null || t.exit.cdp === null ? null : t.exit.cdp.targetId))
      if (entry.guard !== undefined && entry.guard !== null && entry.guard.others !== undefined && entry.guard.others.length > 0) problems.push('another live consumer was running beside this gate: ' + entry.guard.others.join(' | '))
      const routes = [entry.routes === undefined || entry.routes === null ? null : entry.routes.panel === undefined ? null : entry.routes.panel.status, entry.routes === undefined || entry.routes === null ? null : entry.routes.notes === undefined ? null : entry.routes.notes.status]
      if (routes[0] !== 200 || routes[1] !== 200) problems.push('the kernel routes this pane draws from did not both answer 200 at entry: ' + show(routes))
      return problems.length === 0
        ? OK('phase=ready at both ends, the kernel pid, the desktop client own pid@start-time and the CDP page target are the same process throughout, no other live gate was running, and both kernel routes answered 200')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '1-the-panel-lease-was-ours-before-every-input',
    judge: (t) => {
      const problems = []
      const claims = t.drive === null || t.drive === undefined || t.drive.claims === undefined ? [] : t.drive.claims
      const inputs = Array.isArray(t.inputs) ? t.inputs : []
      if (claims.length === 0) problems.push('this gate never claimed the panel lease')
      for (const claim of claims) {
        const held = claim.action === 'already ours'
          ? claim.before !== null && claim.before !== undefined && claim.before.held === true && claim.before.holder === t.holder
          : claim.after !== null && claim.after !== undefined && claim.after.held === true && claim.after.holder === t.holder
        if (held !== true) problems.push('the lease was not held by ' + String(t.holder) + ' at ' + show(claim.purpose) + ': ' + show(claim.after === undefined ? claim.before : claim.after))
      }
      if (inputs.length === 0) problems.push('this gate sent no input at all, so there was nothing to hold the lease against')
      const after = t.drive === null || t.drive === undefined || t.drive.leaseAfterInput === undefined ? [] : t.drive.leaseAfterInput
      for (const line of after) {
        if (line.held === true && line.holder === t.holder) continue
        if (line.held === false && line.revokedKind !== null && line.revokedKind !== undefined) {
          problems.push('an input of this gate (' + show(line.purpose) + ') was recorded against a taken turn: held=false revokedBy=' + show(line.revokedBy) + ' revokedKind=' + show(line.revokedKind) + ' revokedHolder=' + show(line.revokedHolder))
        } else {
          problems.push('the lease came back unheld with no revokedKind after ' + show(line.purpose) + ': ' + show(line))
        }
      }
      if (t.restore === null || t.restore === undefined || t.restore.leaseReleased !== true) problems.push('the lease was not released at the end')
      const last = t.restore === null || t.restore === undefined ? null : t.restore.leaseAfter
      if (last !== null && last !== undefined && last.held === true) problems.push('the lease is still held after the release: ' + show(last))
      return problems.length === 0
        ? OK('the lease was held by ' + String(t.holder) + ' before every one of the ' + String(inputs.length / 2) + ' click(s) this gate sent, re-read after each one (revokedKind stayed ' + show((after[0] === undefined ? {} : after[0]).revokedKind === undefined ? null : after[0].revokedKind) + ' and userInputReports stayed ' + show((after[0] === undefined ? {} : after[0]).userInputReports === undefined ? null : after[0].userInputReports) + '), and it was released at the end')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '2-our-tab-was-reached-through-the-door-this-world-has',
    judge: (t) => {
      const f = factsOf(t)
      const problems = []
      if (f.drive.door === null || f.drive.door === undefined || f.drive.door.found !== true) {
        problems.push('no door to our tab exists in this world: the rail offers ' + show((f.entry.rail === undefined || f.entry.rail === null ? [] : f.entry.rail.chips).map((chip) => chip.title)) + ' and the guide offers ' + show((f.guide.entries === undefined ? [] : f.guide.entries).map((row) => row.titleText + ' [' + row.kind + ']')) + ' - none of them is titled ' + show(f.title))
      }
      if (f.drive.door !== null && f.drive.door !== undefined && (f.drive.door.used === null || f.drive.door.used === undefined)) problems.push('this gate never named the door it used')
      if (f.drive.capsuleClick === null || f.drive.capsuleClick === undefined) problems.push('the capsule carrying our title was found but never clicked')
      if (f.tab.chip === null || f.tab.chip === undefined) problems.push('after the click no rail chip carries our title (' + show(f.title) + '): the tabs are ' + show((f.tab.chips === undefined ? [] : f.tab.chips).map((chip) => chip.title)))
      else if (f.tab.chipSelected !== true) problems.push('our chip exists but is not the selected tab')
      if (f.body === null || f.body === undefined || f.body.box === null || f.body.box === undefined) problems.push('no pane body ([data-panel-tab]) is in the document after the click')
      if (f.entry.rail !== undefined && f.entry.rail !== null && f.entry.rail.ourChip !== null && f.entry.rail.ourChip !== undefined && f.drive.shape !== 'already-open-at-entry') problems.push('the entry rail already carried our chip while this gate recorded the tab as opened by itself')
      return problems.length === 0
        ? OK('our tab was reached through the door the world has (' + String(f.drive.door.used) + '); the rail own chips were ' + show((f.entry.rail === undefined || f.entry.rail === null ? [] : f.entry.rail.chips).map((chip) => chip.title)) + ' at entry, the guide offered ' + String((f.guide.entries === undefined ? [] : f.guide.entries).length) + ' capsule(s) and the one titled ' + show(f.caps.titleText) + ' is kind=' + show(f.caps.kind) + ' - a priority:extension page type is not a chip in the strip, it is a capsule on the guide page - and the click left our chip selected with a live pane body')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '3-the-drawn-words-are-the-declared-words',
    judge: (t) => {
      const f = factsOf(t)
      const problems = []
      if (f.title === null) problems.push('the dictionary was not read, so nothing can be compared')
      if (f.tab.chipTitleText !== f.title) problems.push('the chip draws ' + show(f.tab.chipTitleText) + ' while the dictionary zh value for "tab.title" is ' + show(f.title))
      if (f.tab.titleSpanText !== f.title) problems.push('the title seat inside the chip draws ' + show(f.tab.titleSpanText) + ' while the dictionary says ' + show(f.title))
      if (t.built === null || t.built === undefined || t.built.carriesTitle !== true) problems.push('the built artifact the page runs does not carry that title at all (' + String(t.built === null || t.built === undefined ? '(unread)' : t.built.howNamed) + '), so the drawn word and the shipped word cannot be the same word')
      if (f.visible === null) problems.push('the registry route carried no declared.visible array while the pane was on screen')
      else {
        const wanted = f.visible.map((row) => row.title)
        const drawn = f.itemRows.map((row) => row.title)
        if (sameSet(wanted, drawn) !== true) problems.push('the item rows draw ' + show(drawn) + ' while the registry declares ' + show(wanted))
        if (f.itemRows.length !== f.visible.length) problems.push('the pane drew ' + String(f.itemRows.length) + ' item row(s) for ' + String(f.visible.length) + ' declared item(s)')
        for (const item of f.visible) {
          const row = f.itemRows.filter((entry) => entry.id === item.id)[0]
          if (row === undefined) problems.push('the declared item ' + show(item.id) + ' has no drawn row (data-panel-item)')
          else if (row.title !== item.title) problems.push('the row for ' + show(item.id) + ' draws ' + show(row.title) + ' while the registry says ' + show(item.title))
        }
      }
      if (f.ledger === null) problems.push('the ledger route carried no notes array while the pane was on screen')
      else {
        const wanted = f.ledger.map((row) => row.text)
        const drawn = f.noteRows.map((row) => row.text)
        if (sameSet(wanted, drawn) !== true) problems.push('the note rows draw ' + show(drawn) + ' while the ledger holds ' + show(wanted))
      }
      if (f.tab.readsAttr !== 'panel:ok notes:ok') problems.push('the pane own read state is ' + show(f.tab.readsAttr) + ', so at least one of its two reads was not ok when it was drawn')
      return problems.length === 0
        ? OK('the chip own text and the title seat inside it are the dictionary zh ' + show(f.title) + ' byte for byte; ' + String(f.itemRows.length) + ' item row(s) draw the registry own titles ' + show(f.itemRows.map((row) => row.title)) + '; ' + String(f.noteRows.length) + ' note row(s) draw the ledger own text ' + show(f.noteRows.map((row) => clip(row.text, 60))) + '; and the pane itself reports both reads ok')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '4-the-glyph-is-our-glyph-on-a-16-canvas-sized-by-the-seat-rule',
    judge: (t) => {
      const f = factsOf(t)
      if (f.icon === null || f.icon === undefined) return NOT_MEASURED('NOT MEASURED: the capsule carrying our title draws no svg, so this gate cannot say what our glyph is')
      // The rule is DATA. It is parsed live out of the seat own module and travels in the transcript, and the
      // two live witnesses below decide whether it is the rule this page is running at all: a rule this gate
      // cannot trust is a NAMED THIRD STATE, never a silently assumed 16 and never a silently assumed 22.
      const seat = f.seat
      if (seat.rule === null) return NOT_MEASURED('NOT MEASURED: no seat own glyph rule travelled with this transcript (it is parsed live out of ' + SEAT_RULE_PATH + '), so there is no rule for the box to be judged against')
      if (Number.isFinite(seat.rule.bare) !== true || Number.isFinite(seat.rule.described) !== true || Number.isFinite(seat.rule.maxDescribed) !== true) return NOT_MEASURED('NOT MEASURED: the seat own rule was read but does not carry two numeric branches and a description threshold: ' + show(seat.rule))
      if (seat.rule.bare === seat.rule.described) return NOT_MEASURED('NOT MEASURED: the seat own rule names one size (' + String(seat.rule.bare) + ') for a capsule with and without a description, so "the box the seat means" has nothing to be judged against')
      if (seat.described === null) return NOT_MEASURED('NOT MEASURED: the capsule carrying our title drew neither a title nor a description line this gate could count, so which branch of the seat own rule applies cannot be said')
      if (seat.reserve === null || seat.reserve.length === 0) return NOT_MEASURED('NOT MEASURED: no live sheet declares a box for this capsule own glyph holder, so the rule read out of ' + String(seat.rule.path) + ' cannot be held against the skin this page actually runs')
      if (seat.reserveSizes.some((px) => px !== seat.rule.described)) return NOT_MEASURED('NOT MEASURED: the running skin declares this glyph holder at ' + show(seat.reserveSizes) + ' while the seat own module states ' + String(seat.rule.described) + ' for the described glyph, so the rule this gate read is not the rule this page runs (' + show(seat.reserve.map((row) => row.selector + ' from ' + row.sheet + ' { width: ' + row.width + '; height: ' + row.height + ' }')) + ')')
      if (seat.peers.length === 0) return NOT_MEASURED('NOT MEASURED: the guide drew no other capsule glyph of the same drawn shape to contrast the seat own rule against, and this gate will not judge a size on the module alone')
      if (seat.consensus === null) return NOT_MEASURED('NOT MEASURED: the seat drew its own capsule glyphs at more than one size for one drawn shape (' + show(seat.peers) + '), so the rule read out of ' + String(seat.rule.path) + ' does not account for what this guide does')
      if (seat.consensus !== seat.expected) return NOT_MEASURED('NOT MEASURED: the seat own module gives ' + String(seat.expected) + ' for this capsule while the seat itself drew its other capsule glyph(s) at ' + String(seat.consensus) + ', so the two ways of reading the rule disagree and neither is settled')
      const shape = seat.described === true ? 'a description line under its title' : 'a bare title, no description line drawn'
      const pixels = f.drive.screenshots === undefined || f.drive.screenshots.glyph === undefined ? null : f.drive.screenshots.glyph
      const problems = []
      // (1) the canvas: the artwork own 16x16 viewBox, whatever size the seat draws it at.
      if (f.icon.viewBox !== GLYPH_VIEWBOX) problems.push('the glyph viewBox is ' + show(f.icon.viewBox) + ', not ' + show(GLYPH_VIEWBOX) + ': this is not drawn on the canvas the artwork owns')
      // (2) the rendered box: the seat own rule evaluated for THIS capsule, plus the rest of the glyph facts.
      if (f.icon.box === null || f.icon.box === undefined || f.icon.box.w <= 0 || f.icon.box.h <= 0) problems.push('the glyph box is empty: ' + show(f.icon.box))
      else {
        if (f.icon.inRail !== true) problems.push('the glyph is drawn outside the rail rectangle: glyph ' + show(f.icon.box) + ' against rail ' + show(f.guide.rail))
        if (f.icon.box.w !== Number(f.icon.widthAttr) || f.icon.box.h !== Number(f.icon.heightAttr)) problems.push('the box ' + show(f.icon.box) + ' does not honour the width/height the element declares (' + show(f.icon.widthAttr) + 'x' + show(f.icon.heightAttr) + ')')
        if (f.icon.box.w !== seat.expected || f.icon.box.h !== seat.expected) problems.push('the box is ' + String(f.icon.box.w) + 'x' + String(f.icon.box.h) + ' while the seat own rule for this capsule draws its glyph at ' + String(seat.expected) + 'px: ' + String(seat.rule.path) + ' states "' + String(seat.rule.source) + '", this capsule was drawn with ' + shape + ' (the guide holds ' + String(seat.entries) + ' capsule(s) against the seat own MAX_DESCRIBED_ENTRIES=' + String(seat.rule.maxDescribed) + '), and the seat drew its ' + String(seat.peers.length) + ' other same-shape capsule glyph(s) at ' + show(seat.peerSizes) + ' - so ' + String(seat.expected) + ' is the number the seat own rule produces here')
        if (pixels === null || pixels.ok !== true) problems.push('no pixels of the glyph could be read: ' + show(pixels === null ? null : pixels.why))
        else if (pixels.nonBlank <= 0) problems.push('the glyph own rectangle is blank: ' + String(pixels.nonBlank) + ' non-background pixel(s) in ' + String(pixels.width) + 'x' + String(pixels.height))
      }
      // (3) the ink: currentColor resolving to the colour of the place the glyph is drawn in.
      if (f.icon.strokeAttr !== 'currentColor') problems.push('the artwork own stroke attribute is ' + show(f.icon.strokeAttr) + ', not "currentColor"')
      if (f.icon.stroke !== f.icon.color) problems.push('the resolved ink (' + show(f.icon.stroke) + ') is not the colour of the place it is drawn (' + show(f.icon.color) + '): a hardcoded colour cannot follow the theme')
      if (f.icon.color !== f.icon.holderColor) problems.push('the glyph colour ' + show(f.icon.color) + ' is not the colour its holder hands down (' + show(f.icon.holderColor) + ')')
      return problems.length === 0
        ? OK('the glyph our package contributed is drawn on its own canvas viewBox=' + show(f.icon.viewBox) + ' at ' + String(f.icon.box.w) + 'x' + String(f.icon.box.h) + ', the number the SEAT own rule produces for this capsule: ' + String(seat.rule.path) + ' states "' + String(seat.rule.source) + '", this capsule was drawn with ' + shape + ' (the guide holds ' + String(seat.entries) + ' capsule(s) against the seat own MAX_DESCRIBED_ENTRIES=' + String(seat.rule.maxDescribed) + ') => ' + String(seat.expected) + 'px; the running skin reserves this holder at ' + show(seat.reserveSizes) + ' (the described size: ' + show(seat.reserve.map((row) => row.selector + ' from ' + row.sheet)) + ') and the seat drew its ' + String(seat.peers.length) + ' other capsule glyph(s) of the same shape at ' + show(seat.peerSizes) + ' (' + show(seat.peers.map((row) => row.kind + '=' + String(row.box.w))) + '). Inside the rail, in the ink of the place it is drawn (' + show(f.icon.stroke) + ' resolved from currentColor = the holder own ' + show(f.icon.holderColor) + ', not a fixed hex), with ' + String(pixels === null ? 0 : pixels.nonBlank) + ' non-background pixel(s) in its rectangle')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '5-the-pane-is-really-on-screen-with-pixels',
    judge: (t) => {
      const f = factsOf(t)
      if (f.body === null || f.body === undefined || f.body.box === null || f.body.box === undefined) return NOT_MEASURED('NOT MEASURED: no pane body was found, so there is nothing to look at')
      const problems = []
      if (f.body.box.w <= 0 || f.body.box.h <= 0) problems.push('the pane body box is empty: ' + show(f.body.box))
      if (f.tab.intersectsRail !== true) problems.push('the pane body does not intersect the rail rectangle: body ' + show(f.body.box) + ' against rail ' + show(f.tab.railBox))
      if (f.body.display === 'none' || f.body.visibility === 'hidden' || Number(f.body.opacity) === 0) problems.push('the pane body is not visible: ' + show({ display: f.body.display, visibility: f.body.visibility, opacity: f.body.opacity }))
      if (f.body.checkVisibility === false) problems.push('the element itself reports it is not visible (checkVisibility false)')
      const pixels = f.drive.screenshots === undefined || f.drive.screenshots.body === undefined ? null : f.drive.screenshots.body
      if (pixels === null || pixels.ok !== true) problems.push('the pane could not be captured: ' + show(pixels === null ? null : pixels.why))
      else {
        const dpr = f.entry.rail === undefined || f.entry.rail === null || f.entry.rail.dpr === undefined ? 1 : f.entry.rail.dpr
        if (pixels.width !== Math.round(f.body.box.w * dpr) || pixels.height !== Math.round(f.body.box.h * dpr)) problems.push('the capture is ' + String(pixels.width) + 'x' + String(pixels.height) + ' while the pane rectangle at this window devicePixelRatio (' + String(dpr) + ') is ' + String(Math.round(f.body.box.w * dpr)) + 'x' + String(Math.round(f.body.box.h * dpr)))
        if (pixels.nonBlank <= 0) problems.push('the pane rectangle is blank: ' + String(pixels.nonBlank) + ' non-background pixel(s)')
      }
      return problems.length === 0
        ? OK('our pane body is on screen at ' + show(f.body.box) + ', inside the rail ' + show(f.tab.railBox) + ', drawn (' + show({ display: f.body.display, visibility: f.body.visibility, checkVisibility: f.body.checkVisibility }) + '; ' + String(pixels.width) + 'x' + String(pixels.height) + ' device pixel(s) of it captured with ' + String(pixels.nonBlank) + ' non-background pixel(s), mean ' + String(pixels.mean) + ', spread ' + String(pixels.spread) + ' over ' + String(pixels.distinctColours) + ' distinct colour(s))')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '6-the-world-was-put-back',
    judge: (t) => {
      const problems = []
      if (t.drive === null || t.drive === undefined || (t.drive.shape !== 'opened-by-this-gate' && t.drive.shape !== 'already-open-at-entry')) problems.push('this gate never recorded what it did to the rail: ' + show(t.drive === null || t.drive === undefined ? null : t.drive.shape))
      const entryRail = t.entry === null || t.entry === undefined ? null : t.entry.rail
      const exitRail = t.exit === null || t.exit === undefined ? null : t.exit.rail
      if (entryRail === null || entryRail === undefined) problems.push('the rail was never read at entry')
      if (exitRail === null || exitRail === undefined) problems.push('the rail was never read at exit, so "put back" cannot be shown')
      if (entryRail !== null && entryRail !== undefined && exitRail !== null && exitRail !== undefined) {
        const entryTitles = entryRail.chips.map((chip) => chip.title)
        const exitTitles = exitRail.chips.map((chip) => chip.title)
        if (same(entryTitles, exitTitles) !== true) problems.push('the rail chips are not the ones this gate found: entry ' + show(entryTitles) + ' exit ' + show(exitTitles))
        if (exitRail.selected !== entryRail.selected) problems.push('the rail is left on ' + show(exitRail.selected) + ' while it was on ' + show(entryRail.selected) + ' when this gate arrived')
        if (exitRail.surfaceCount !== entryRail.surfaceCount) problems.push('the number of sidebar surfaces moved: ' + String(entryRail.surfaceCount) + ' -> ' + String(exitRail.surfaceCount))
      }
      if (t.restore === null || t.restore === undefined || t.restore.leaseReleased !== true) problems.push('the lease was not given back')
      if (t.exit !== null && t.exit !== undefined && t.exit.lease !== null && t.exit.lease !== undefined && t.exit.lease.held === true) problems.push('the lease is held at exit: ' + show(t.exit.lease))
      const entryPanel = t.entry === null || t.entry === undefined ? null : t.entry.panel
      const exitPanel = t.exit === null || t.exit === undefined ? null : t.exit.panel
      if (same(entryPanel, exitPanel) !== true) problems.push('the panel own numbers moved: entry ' + show(entryPanel) + ' exit ' + show(exitPanel))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.client !== t.exit.client) problems.push('the desktop client changed: ' + show(t.entry === null || t.entry === undefined ? null : t.entry.client) + ' -> ' + show(t.exit === null || t.exit === undefined ? null : t.exit.client))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.status === null || t.exit.status === null || t.entry.status.pid !== t.exit.status.pid) problems.push('the kernel pid changed: ' + show(t.entry === null || t.entry === undefined || t.entry.status === null ? null : t.entry.status.pid) + ' -> ' + show(t.exit === null || t.exit === undefined || t.exit.status === null ? null : t.exit.status.pid))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(t.entry.manifest, t.exit.manifest) !== true) problems.push('the manifest changed under this gate: entry ' + show(t.entry === null || t.entry === undefined ? null : t.entry.manifest) + ' exit ' + show(t.exit === null || t.exit === undefined ? null : t.exit.manifest))
      // The routes carry a per-request counter and a timestamp (measured: "served" grows on every GET), so what is
      // compared is what the route DECLARES, not the envelope this gate own reads move.
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(stableRoute(t.entry.routes === undefined ? null : t.entry.routes.panel), stableRoute(t.exit.routes === undefined ? null : t.exit.routes.panel)) !== true) problems.push('the live registry changed under this gate: entry ' + show(stableRoute(t.entry === null || t.entry === undefined || t.entry.routes === undefined ? null : t.entry.routes.panel)) + ' exit ' + show(stableRoute(t.exit === null || t.exit === undefined || t.exit.routes === undefined ? null : t.exit.routes.panel)))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(stableLedger(t.entry.routes === undefined ? null : t.entry.routes.notes), stableLedger(t.exit.routes === undefined ? null : t.exit.routes.notes)) !== true) problems.push('the live ledger changed under this gate')
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.gitStatus === null || t.exit.gitStatus === null || t.entry.gitStatus.ok !== true || t.exit.gitStatus.ok !== true) problems.push('git status could not be read on one side: ' + show({ entry: t.entry === null || t.entry === undefined || t.entry.gitStatus === null ? null : t.entry.gitStatus.why === undefined ? null : t.entry.gitStatus.why, exit: t.exit === null || t.exit === undefined || t.exit.gitStatus === null ? null : t.exit.gitStatus.why === undefined ? null : t.exit.gitStatus.why }))
      else if (t.entry.gitStatus.text !== t.exit.gitStatus.text) {
        // R191 section 3: a world moved by somebody ELSE is a named third state (the note the drive wrote, and
        // the exit code main() gives it), never a product red. What reddens THIS reading is a file this gate
        // wrote turning up in the difference.
        const moved = t.worldMoved === undefined || t.worldMoved === null ? { appeared: [], vanished: [], ours: [] } : t.worldMoved
        if (moved.ours.length > 0) problems.push('a file THIS GATE wrote appeared in git status --porcelain: ' + show(moved.ours))
      }
      return problems.length === 0
        ? OK('the rail is back on the tab it was left on (' + show(t.entry.rail.selected) + ') with the same chips ' + show(t.entry.rail.chips.map((chip) => chip.title)) + ', the lease is given back (' + show(t.exit.lease === null ? null : t.exit.lease.held) + '), and the panel own numbers, the kernel pid, the desktop client, the manifests, both live routes and git status --porcelain are all identical before and after - and this gate records that IT OPENED the pane this round')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '7-this-gate-only-clicked-and-never-wrote',
    judge: (t) => {
      const problems = []
      const inputs = Array.isArray(t.inputs) ? t.inputs : []
      if (inputs.length % 2 !== 0) problems.push('the input list holds ' + String(inputs.length) + ' event(s): presses and releases do not pair')
      const pressed = inputs.filter((row) => row.type === 'mousePressed').length
      const released = inputs.filter((row) => row.type === 'mouseReleased').length
      if (pressed !== released) problems.push('presses ' + String(pressed) + ' and releases ' + String(released) + ' differ')
      for (const row of inputs) {
        if (row.kind !== 'mouse' || (row.type !== 'mousePressed' && row.type !== 'mouseReleased')) problems.push('an input that is not a mouse press/release was sent: ' + show(row))
        const allowed = INPUT_PURPOSES.includes(row.purpose) || String(row.purpose).startsWith('walk-chip:')
        if (allowed !== true) problems.push('an input carried a purpose outside the allowlist: ' + show(row.purpose))
        if (Number.isFinite(row.x) !== true || Number.isFinite(row.y) !== true) problems.push('an input carried no usable coordinate: ' + show(row))
      }
      for (const call of t.cdpCalls === undefined ? [] : t.cdpCalls) {
        if (CDP_METHODS.includes(call.method) !== true) problems.push('a CDP method outside the allowlist was sent: ' + show(call.method))
        if (call.method === 'Input.dispatchMouseEvent' && String(call.purpose).startsWith('walk-chip:') !== true && INPUT_PURPOSES.includes(call.purpose) !== true) problems.push('a mouse event carried a purpose outside the allowlist: ' + show(call.purpose))
      }
      for (const probe of t.probes === undefined ? [] : t.probes) {
        if (String(probe.source).startsWith('JSON.stringify(') !== true) problems.push('a page expression was sent that is not a JSON.stringify of DOM reads: ' + clip(probe.source, 120))
      }
      for (const read of t.reads === undefined ? [] : t.reads) {
        if (read.kind === 'panel' && PANEL_OPS.includes(read.op) !== true) problems.push('a panel op outside the allowlist was sent: ' + show(read.op))
        if (read.kind === 'http' && String(read.method) !== 'GET') problems.push('a non-GET request was made: ' + show(read))
      }
      const writes = (t.calls === undefined ? [] : t.calls).filter((row) => row.kind === 'file-write')
      if (writes.length > 1) problems.push('this gate wrote ' + String(writes.length) + ' file(s): ' + show(writes.map((row) => row.path)))
      for (const row of writes) if (String(row.purpose) !== 'this gate own transcript') problems.push('this gate wrote a file that is not its transcript: ' + show(row))
      return problems.length === 0
        ? OK('the only input was ' + String(inputs.length / 2) + ' left click(s) ' + show([...new Set(inputs.map((row) => row.purpose))]) + ', every page expression was a JSON.stringify of DOM reads, the only CDP methods were ' + show([...new Set((t.cdpCalls === undefined ? [] : t.cdpCalls).map((call) => call.method))]) + ', the only panel ops were ' + show([...new Set((t.reads === undefined ? [] : t.reads).filter((read) => read.kind === 'panel').map((read) => read.op))]) + ', every HTTP request was a GET, and the only file written was this gate own transcript (' + show(writes.length === 0 ? null : writes[0].path) + ')')
        : BAD('FAIL: ' + problems.join(' | '))
    },
  },
]

const runJudges = (transcript) => READINGS.map((reading) => {
  let verdict
  try {
    verdict = reading.judge(transcript)
  } catch (error) {
    verdict = { ok: false, detail: 'the reading itself threw: ' + describe(error) }
  }
  return { id: reading.id, ...verdict }
})

// ---------------------------------------------------------------------------
// Self-attack: mutate the MEASURED transcript, not a fixture
// ---------------------------------------------------------------------------

const clone = (value) => {
  if (Array.isArray(value)) return value.map((entry) => clone(entry))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = clone(value[key])
    return out
  }
  return value
}

const PREMISES = '0-premises-ports-ready-and-the-same-two-processes'
const LEASE = '1-the-panel-lease-was-ours-before-every-input'
const DOOR = '2-our-tab-was-reached-through-the-door-this-world-has'
const WORDS = '3-the-drawn-words-are-the-declared-words'
const GLYPH = '4-the-glyph-is-our-glyph-on-a-16-canvas-sized-by-the-seat-rule'
const ONSCREEN = '5-the-pane-is-really-on-screen-with-pixels'
const PUTBACK = '6-the-world-was-put-back'
const AUDIT = '7-this-gate-only-clicked-and-never-wrote'

const MUTANTS = [
  { name: 'the-shell-is-not-ready', declared: [PREMISES], what: 'the world is not the one this gate requires', apply: (t) => { t.entry.status.phase = 'failed' } },
  { name: 'the-kernel-restarted-mid-run', declared: [PREMISES, PUTBACK], what: 'a restart under the gate: the premise moved and the world is not the one found', apply: (t) => { t.exit.status.pid = Number(t.entry.status.pid) + 1 } },
  { name: 'the-client-was-replaced', declared: [PREMISES, PUTBACK], what: 'a different desktop client answered the exit read', apply: (t) => { t.exit.client = '99999@2000-01-01T00:00:00.0000000Z' } },
  { name: 'another-live-consumer-ran-beside-us', declared: [PREMISES], what: 'two live gates on one world', apply: (t) => { t.entry.guard.others = ['pid 4242 node scripts/verify-sidebar-content.mjs'] } },
  { name: 'the-lease-was-never-ours', declared: [LEASE], what: 'the gate touched the rail without owning the turn', apply: (t) => { const claim = t.drive.claims[0]; claim.action = 'claim'; claim.after = { held: false, holder: null, revokedBy: null, revokedHolder: null, revokedKind: null } } },
  { name: 'an-input-was-recorded-against-a-taken-turn', declared: [LEASE], what: 'somebody else input was recorded while this gate held the turn', apply: (t) => { const line = t.drive.leaseAfterInput.filter((row) => row.held === true)[0] === undefined ? t.drive.leaseAfterInput[0] : t.drive.leaseAfterInput.filter((row) => row.held === true)[0]; line.held = false; line.revokedBy = 'user-input'; line.revokedKind = 'pointerdown'; line.revokedHolder = t.holder } },
  { name: 'the-lease-was-left-held', declared: [LEASE, PUTBACK], what: 'a gate that walks away still holding the panel', apply: (t) => { t.restore.leaseReleased = false; t.exit.lease = { held: true, holder: t.holder, revokedBy: null, revokedHolder: null, revokedKind: null } } },
  { name: 'the-door-was-never-named', declared: [DOOR], what: 'how our tab was reached was never recorded', apply: (t) => { t.drive.door.used = null } },
  { name: 'no-door-carries-our-title', declared: [DOOR], what: 'the rail and the guide offer no capsule titled like our dictionary', apply: (t) => { t.drive.door.found = false } },
  { name: 'our-chip-exists-but-is-not-selected', declared: [DOOR], what: 'the click landed our tab without selecting it', apply: (t) => { t.drive.tab.chipSelected = false } },
  { name: 'the-chip-draws-the-english-word', declared: [WORDS], what: 'the drawn chip text is not the zh dictionary value', apply: (t) => { t.drive.tab.chipTitleText = 'LINK panel'; t.drive.tab.titleSpanText = 'LINK panel' } },
  { name: 'an-item-row-draws-its-own-title', declared: [WORDS], what: 'a row that is not the registry own title', apply: (t) => { t.drive.tab.itemRows[0].title = 'invented row' } },
  { name: 'a-note-row-is-quoted-wrong', declared: [WORDS], what: 'the ledger own text drawn with a word changed', apply: (t) => { t.drive.tab.noteRows[0].text = String(t.drive.tab.noteRows[0].text) + ' (edited)' } },
  { name: 'one-route-was-not-read', declared: [WORDS], what: 'a pane drawn before one of its reads settled', apply: (t) => { t.drive.tab.readsAttr = 'panel:ok notes:pending' } },
  { name: 'the-glyph-left-its-own-canvas', declared: [GLYPH], what: 'artwork drawn on a canvas that is not ours', apply: (t) => { t.drive.guide.ours.icon.viewBox = '0 0 24 24' } },
  { name: 'the-glyph-ink-is-a-fixed-hex', declared: [GLYPH], what: 'a colour that cannot follow the theme', apply: (t) => { t.drive.guide.ours.icon.stroke = 'rgb(77, 107, 254)' } },
  { name: 'the-glyph-is-drawn-outside-the-rail', declared: [GLYPH], what: 'a glyph floating away from the column it belongs to', apply: (t) => { t.drive.guide.ours.icon.box = { x: 10, y: 10, w: 22, h: 22 }; t.drive.guide.ours.icon.inRail = false } },
  { name: 'the-glyph-rectangle-is-blank', declared: [GLYPH], what: 'nothing inked where the glyph should be', apply: (t) => { t.drive.screenshots.glyph.nonBlank = 0 } },
  { name: 'the-canvas-is-a-36-square-in-a-fixed-ink', declared: [GLYPH], what: 'the canvas swapped for a 36x36 piece in a fixed colour: neither the artwork own viewBox nor an ink that can follow the theme', apply: (t) => { const icon = t.drive.guide.ours.icon; icon.viewBox = '0 0 36 36'; icon.strokeAttr = null; icon.stroke = '#4d6bfe'; icon.strokeWidth = '2px' } },
  { name: 'the-box-is-not-the-number-the-seat-rule-gives', declared: [GLYPH], what: 'the glyph drawn at the size the seat keeps for a DESCRIBED capsule while this capsule draws a bare title: the number comes from the transcript own seat rule, not from a constant here', apply: (t) => { const icon = t.drive.guide.ours.icon; const rule = t.seatRule === null || t.seatRule === undefined ? null : t.seatRule; const other = rule === null || rule.described === rule.bare ? Number(t.drive.guide.ours.icon.box.w) + 2 : rule.described; icon.box = { x: icon.box.x, y: icon.box.y, w: other, h: other }; icon.widthAttr = String(other); icon.heightAttr = String(other) } },
  { name: 'the-pane-is-not-on-screen', declared: [ONSCREEN], what: 'a body outside the rail', apply: (t) => { t.drive.tab.body.box = { x: 5, y: 5, w: 10, h: 10 }; t.drive.tab.intersectsRail = false } },
  { name: 'the-pane-rectangle-is-blank', declared: [ONSCREEN], what: 'a rectangle with no pixels in it', apply: (t) => { t.drive.screenshots.body.nonBlank = 0 } },
  { name: 'the-rail-is-left-on-another-tab', declared: [PUTBACK], what: 'the world handed to the next gate on a different tab', apply: (t) => { t.exit.rail.selected = t.entry.rail.chips.filter((chip) => chip.title !== t.entry.rail.selected)[0].title } },
  { name: 'our-tab-was-left-open', declared: [PUTBACK], what: 'the chips this gate found are not the chips it left', apply: (t) => { t.exit.rail.chips = t.exit.rail.chips.concat([{ id: 'tab99', title: t.dictionary.title, selected: false, box: { x: 1, y: 1, w: 10, h: 10 } }]) } },
  { name: 'this-gate-wrote-a-tracked-file', declared: [PUTBACK, AUDIT], what: 'a gate that leaves a tracked file of its own behind: the world fingerprint and the write audit both see it', apply: (t) => { t.calls.push({ kind: 'file-write', path: '<workspace>//dsh-link/scripts/verify-panel-render.mjs', purpose: 'a second write' }); t.exit.gitStatus.text = String(t.exit.gitStatus.text) + '\n M dsh-link/scripts/verify-panel-render.mjs'; t.exit.gitStatus.lines = t.exit.gitStatus.lines.concat([' M dsh-link/scripts/verify-panel-render.mjs']); t.worldMoved = { appeared: [' M dsh-link/scripts/verify-panel-render.mjs'], vanished: [], ours: [' M dsh-link/scripts/verify-panel-render.mjs'], ourWrites: t.calls.filter((row) => row.kind === 'file-write').map((row) => row.path) } } },
  { name: 'the-manifest-moved-under-the-gate', declared: [PUTBACK], what: 'the delivered roster changed mid-run', apply: (t) => { t.exit.manifest[0].sha256 = 'deadbeef' } },
  { name: 'a-key-event-was-sent', declared: [AUDIT], what: 'typing, which this gate may never do', apply: (t) => { t.inputs.push({ kind: 'key', type: 'keyDown', x: 0, y: 0, purpose: 'type-a-note' }); t.inputs.push({ kind: 'key', type: 'keyUp', x: 0, y: 0, purpose: 'type-a-note' }) } },
  { name: 'a-page-expression-was-not-a-read', declared: [AUDIT], what: 'an evaluate that could write the DOM', apply: (t) => { t.probes.push({ name: 'invented', purpose: 'dom-write', source: 'document.body.innerHTML = "x"' }) } },
  { name: 'a-navigating-cdp-method-was-sent', declared: [AUDIT], what: 'navigation, which this gate may never do', apply: (t) => { t.cdpCalls.push({ method: 'Page.navigate', purpose: 'go-elsewhere' }) } },
  { name: 'a-panel-op-outside-the-allowlist', declared: [AUDIT], what: 'a panel operation that is not a read of the turn', apply: (t) => { t.reads.push({ kind: 'panel', op: 'open', purpose: 'open-it-myself' }) } },
]

const selfAttack = (transcript) => {
  const baseline = runJudges(transcript)
  const green = baseline.filter((entry) => entry.ok === true)
  const red = baseline.filter((entry) => entry.ok !== true)
  console.log('')
  console.log('== self-attack: ' + String(MUTANTS.length) + ' mutants over the MEASURED transcript ==')
  console.log('  baseline: ' + String(green.length) + ' green, ' + String(red.length) + ' not green')
  if (red.length > 0) {
    console.log('  the attack does not start: the baseline is not green, and a mutant over a red baseline proves nothing')
    for (const entry of red) console.log('    ' + entry.id + ' -> ' + clip(entry.detail, 200))
    return 1
  }
  const coverage = new Map(READINGS.map((reading) => [reading.id, 0]))
  let problems = 0
  for (const mutant of MUTANTS) {
    const copy = clone(transcript)
    mutant.apply(copy)
    const verdicts = runJudges(copy)
    const observed = verdicts.filter((entry) => entry.ok !== true).map((entry) => entry.id)
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) === undefined ? 0 : coverage.get(id)) + 1)
    const exact = same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 46) + ' declared=' + show(mutant.declared) + ' observed=' + show(observed))
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
  for (const row of coverage) {
    if (row[1] === 0) uncovered += 1
    console.log('    ' + pad(String(row[1]), 3) + ' ' + row[0])
  }
  console.log('  declared sets == observed sets for ' + String(MUTANTS.length - problems) + ' of ' + String(MUTANTS.length) + ' mutants; readings with no mutant: ' + String(uncovered))
  return problems === 0 && uncovered === 0 ? 0 : 1
}

// ---------------------------------------------------------------------------
// The printout
// ---------------------------------------------------------------------------

const printTranscript = (t) => {
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell ' + SHELL_ORIGIN + ' | kernel ' + KERNEL_ORIGIN + ' | CDP ' + String(CDP_PORT) + ' (the client was already running: this gate never starts, stops or rebuilds it)')
  console.log('  holder ' + String(t.holder) + ' | transcript schema ' + String(t.schema) + (t.elapsedMs === undefined ? '' : ' | elapsed ' + String(t.elapsedMs) + ' ms'))
  console.log('  dictionary ' + String(t.dictionary === null ? '(unread)' : t.dictionary.path) + ' sha256 ' + clip(String(t.dictionary === null ? '' : t.dictionary.sha256), 12) + ' | "' + String(t.dictionary === null ? '' : t.dictionary.titleKey) + '" = ' + show(t.dictionary === null ? null : t.dictionary.title) + ' (' + String(t.dictionary === null ? '?' : t.dictionary.keys) + ' key(s) in zh)')
  console.log('  the built artifact carries that title: ' + show(t.built === null ? null : t.built.carriesTitle) + ' (' + String(t.built === null ? '(unread)' : t.built.howNamed) + '; sha256 ' + clip(String(t.built === null ? '' : t.built.sha256), 12) + ')')
  const seatRule = t.seatRule === undefined || t.seatRule === null ? null : t.seatRule
  console.log('  the SEAT own glyph rule (read as data, never assumed here): ' + String(seatRule === null ? '(unread)' : seatRule.path) + ' sha256 ' + clip(String(seatRule === null ? '' : seatRule.sha256), 12) + ' | "' + String(seatRule === null ? '' : seatRule.source) + '" => bare ' + show(seatRule === null ? null : seatRule.bare) + 'px / described ' + show(seatRule === null ? null : seatRule.described) + 'px, MAX_DESCRIBED_ENTRIES=' + show(seatRule === null ? null : seatRule.maxDescribed))
  console.log('  ENTRY: phase=' + show(t.entry === null ? null : t.entry.status.phase) + ' kernel pid=' + show(t.entry === null ? null : t.entry.status.pid) + ' version=' + show(t.entry === null ? null : t.entry.status.version) + ' | client ' + show(t.entry === null ? null : t.entry.client) + ' | CDP target ' + show(t.entry === null ? null : t.entry.cdp.targetId))
  console.log('  ENTRY rail: box ' + show(t.entry === null ? null : t.entry.rail.rail) + ' chips ' + show((t.entry === null ? [] : t.entry.rail.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' selected ' + show(t.entry === null ? null : t.entry.rail.selected) + ' guideOpen ' + show(t.entry === null ? null : t.entry.rail.guideOpen) + ' addControl ' + show(t.entry === null ? null : t.entry.rail.addControl) + ' surfaceCount ' + show(t.entry === null ? null : t.entry.rail.surfaceCount))
  console.log('  ENTRY panel: ' + show(t.entry === null ? null : t.entry.panel) + ' | lease ' + show(t.entry === null ? null : t.entry.lease))
  console.log('  ENTRY routes: panel visible=' + show((t.entry === null ? [] : (t.entry.routes.panel.body.declared === undefined ? [] : t.entry.routes.panel.body.declared.visible)).map((row) => row.id + ':' + row.title)) + ' | ledger notes=' + show((t.entry === null ? [] : t.entry.routes.notes.body.notes).map((row) => row.id)) + ' limits=' + show(t.entry === null ? null : t.entry.routes.notes.body.limits))
  console.log('  single-run guard: ' + String(t.entry === null ? '?' : t.entry.guard.liveFiles) + ' live gate file(s) in the register, other node processes running them: ' + String(t.entry === null ? '?' : t.entry.guard.others.length) + (t.entry !== null && t.entry.guard.others.length > 0 ? ' -> ' + t.entry.guard.others.join(' | ') : ''))
  for (const claim of t.drive === null ? [] : t.drive.claims) console.log('  lease [' + pad(claim.purpose, 34) + '] -> ' + String(claim.action) + ' status=' + String(claim.status) + ' after=' + show(claim.after === undefined ? claim.before : claim.after))
  for (const line of t.drive === null ? [] : t.drive.leaseAfterInput) console.log('    after ' + pad(line.purpose, 22) + ' status=' + String(line.status) + ' held=' + show(line.held) + ' holder=' + show(line.holder) + ' revokedBy=' + show(line.revokedBy) + ' revokedKind=' + show(line.revokedKind) + ' userInputReports=' + show(line.userInputReports))
  console.log('  the door: ' + String(t.drive === null ? null : t.drive.door.used) + (t.drive !== null && t.drive.door.walk.length > 0 ? ' | walk: ' + show(t.drive.door.walk.map((row) => row.chip + ' => guideOpen=' + row.guideOpen)) : ''))
  console.log('  the guide offers ' + String((t.drive === null || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length) + ' capsule(s):')
  for (const row of t.drive === null || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries) console.log('    kind=' + pad(row.kind, 14) + ' title=' + pad(show(row.titleText), 22) + ' description=' + pad(show(row.descriptionText), 34) + ' box=' + show(row.box) + ' icon=' + show(row.icon === null ? null : { box: row.icon.box, viewBox: row.icon.viewBox, size: String(row.icon.widthAttr) + 'x' + String(row.icon.heightAttr), strokeAttr: row.icon.strokeAttr, stroke: row.icon.stroke, color: row.icon.color, holderColor: row.icon.holderColor, paths: row.icon.paths, inRail: row.icon.inRail }))
  console.log('  our capsule: ' + show(t.drive === null || t.drive.entry === null ? null : { kind: t.drive.entry.kind, title: t.drive.entry.titleText, box: t.drive.entry.box, clickedAt: t.drive.capsuleClick }))
  const seatLine = factsOf(t).seat
  console.log('  the seat own numbers for our capsule: drawn shape=' + (seatLine.described === true ? 'a description line under the title' : 'a bare title (no description line drawn)') + ' of ' + String(seatLine.entries) + ' capsule(s) => the rule gives ' + show(seatLine.expected) + 'px | the running skin reserves that holder at ' + show(seatLine.reserveSizes) + ' ' + show((seatLine.reserve === null ? [] : seatLine.reserve).map((row) => row.selector + ' from ' + row.sheet)) + ' | the seat drew its other same-shape capsule glyph(s) at ' + show(seatLine.peerSizes) + ' ' + show(seatLine.peers.map((row) => row.kind + '=' + String(row.box.w) + 'x' + String(row.box.h))))
  console.log('  the pane our click opened: chip=' + show(t.drive === null ? null : t.drive.tab.chip.id) + ' chipText=' + show(t.drive === null ? null : t.drive.tab.chipTitleText) + ' titleSeat=' + show(t.drive === null ? null : t.drive.tab.titleSpanText) + ' selected=' + show(t.drive === null ? null : t.drive.tab.chipSelected) + ' shape=' + String(t.drive === null ? null : t.drive.shape))
  console.log('    body box ' + show(t.drive === null ? null : t.drive.tab.body.box) + ' display=' + show(t.drive === null ? null : t.drive.tab.body.display) + ' visibility=' + show(t.drive === null ? null : t.drive.tab.body.visibility) + ' checkVisibility=' + show(t.drive === null ? null : t.drive.tab.body.checkVisibility) + ' intersectsRail=' + show(t.drive === null ? null : t.drive.tab.intersectsRail) + ' rail=' + show(t.drive === null ? null : t.drive.tab.railBox))
  console.log('    its own read state: ' + show(t.drive === null ? null : t.drive.tab.readsAttr) + ' | failures ' + show(t.drive === null ? null : t.drive.tab.failureRows) + ' | refusals ' + show(t.drive === null ? null : t.drive.tab.refusedRows) + ' | empty rows ' + show(t.drive === null ? null : t.drive.tab.emptyRows))
  console.log('    item rows drawn: ' + show((t.drive === null ? [] : t.drive.tab.itemRows).map((row) => row.id + ' kind=' + row.kind + ' title=' + show(row.title) + ' meta=' + clip(String(row.meta), 70))))
  console.log('    registry route read at the same moment: ' + show((t.drive === null || t.drive.routes === null || t.drive.routes.panel.body === null ? [] : t.drive.routes.panel.body.declared.visible).map((row) => row.id + ':' + row.title)))
  console.log('    note rows drawn: ' + show((t.drive === null ? [] : t.drive.tab.noteRows).map((row) => row.id + ' state=' + row.state + ' text=' + show(clip(String(row.text), 70)) + ' author=' + show(row.author))))
  console.log('    ledger route read at the same moment: ' + show((t.drive === null || t.drive.routes === null || t.drive.routes.notes.body === null ? [] : t.drive.routes.notes.body.notes).map((row) => row.id + ':' + clip(String(row.text), 70))))
  console.log('  pixels glyph: ' + show(t.drive === null ? null : t.drive.screenshots.glyph))
  console.log('  pixels pane : ' + show(t.drive === null ? null : t.drive.screenshots.body))
  for (const step of t.restore === null ? [] : t.restore.steps) console.log('  restore: ' + step)
  console.log('  EXIT rail: chips ' + show((t.exit === null || t.exit.rail === null ? [] : t.exit.rail.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' selected ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.selected) + ' surfaceCount ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.surfaceCount))
  console.log('  EXIT panel: ' + show(t.exit === null ? null : t.exit.panel) + ' | lease ' + show(t.exit === null ? null : t.exit.lease) + ' | client ' + show(t.exit === null ? null : t.exit.client) + ' | git status lines ' + String(t.exit === null || t.exit.gitStatus === null ? '?' : t.exit.gitStatus.lines.length))
  console.log('  the file this gate wrote: ' + show(t.write === undefined ? null : t.write.path) + ' (' + String(t.write === undefined ? '?' : t.write.bytes) + ' bytes, inside the git-ignored scratch path ' + String(t.write === undefined ? '?' : t.write.insideScratch) + ')')
  console.log('  NOT MEASURED HERE (named): whether the pane behaves on a second click; any locale other than this one; the native browser panel (this gate never opens, places or closes it); the note write path (this gate types nothing)')
  for (const note of t.notes === undefined ? [] : t.notes) console.log('  ' + note)
  for (const problem of t.problems === undefined ? [] : t.problems) console.log('  PROBLEM ' + problem)
}

const writeTranscript = (t) => {
  try {
    const path = DUMP_OPTION === null ? join(SCRATCH_DIR, 'transcript-' + String(t.startedAt).replace(/[:.]/g, '-') + '.json') : resolve(DUMP_OPTION)
    mkdirSync(dirname(path), { recursive: true })
    t.write = { path, bytes: 0, insideScratch: resolve(path).startsWith(resolve(SCRATCH_DIR)), at: new Date().toISOString() }
    t.calls.push({ kind: 'file-write', path, purpose: 'this gate own transcript', insideScratch: t.write.insideScratch })
    let settled = -1
    for (let pass = 0; pass < 4; pass += 1) {
      writeFileSync(path, JSON.stringify(t, null, 1))
      const size = statSync(path).size
      if (size === settled) break
      settled = size
      t.write.bytes = size
    }
  } catch (error) {
    t.notes.push('note: the transcript could not be written out (' + describe(error) + ')')
  }
}

const main = async () => {
  console.log('gate 126 panel-render - what the right rail actually draws (shell ' + SHELL_ORIGIN + ', kernel ' + KERNEL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  single run only: this gate drives the rail and opens one pane; it clicks only to select its own tab and to put the world back')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const read = readJson(resolve(REPLAY_PATH))
    if (read.ok !== true) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + resolve(REPLAY_PATH) + ' (' + read.why + ')')
      return 3
    }
    transcript = read.value
    if (transcript === null || transcript === undefined || transcript.schema !== 'r191-g126-transcript/1' || transcript.entry === undefined || transcript.dictionary === undefined || transcript.inputs === undefined) {
      console.log('')
      console.log('SKIP: the file at ' + resolve(REPLAY_PATH) + ' is not a transcript this gate wrote (schema ' + show(transcript === null || transcript === undefined ? null : transcript.schema) + ')')
      return 3
    }
    console.log('  replay: judging ' + resolve(REPLAY_PATH) + ' - ZERO operations: no fetch, no CDP, no pwsh, no click')
  } else {
    const started = Date.now()
    const bag = { cdp: null }
    try {
      transcript = await runWorld(bag)
    } catch (error) {
      console.log('')
      console.log('SKIP: ' + describe(error))
      if (error instanceof NotMeasured !== true) console.log(String(error !== null && error !== undefined && error.stack !== undefined ? error.stack : '').split('\n').slice(0, 6).join('\n'))
      console.log('panel-render: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
      return 3
    } finally {
      if (bag.cdp !== null && bag.cdp !== undefined) bag.cdp.close()
    }
    transcript.elapsedMs = Date.now() - started
    if ((transcript.problems === undefined ? [] : transcript.problems).length === 0) writeTranscript(transcript)
  }
  const problems = transcript.problems === undefined ? [] : transcript.problems
  const worldMoved = (transcript.notes === undefined ? [] : transcript.notes).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
  const stopped = problems.length > 0 || worldMoved.length > 0
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
  console.log('')
  if (SELF_ATTACK === true) {
    if (failed.length > 0 || notMeasured.length > 0 || stopped) {
      console.log('panel-render: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a baseline that is not green and measured')
      for (const verdict of failed.concat(notMeasured)) console.log('    not green: ' + verdict.id + ' -> ' + clip(verdict.detail, 200))
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('panel-render --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED') + ', every reading held, 0 deviations')
    return attack === 0 ? 0 : 1
  }
  console.log('panel-render: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, 0 deviations (the DEVIATION verdict retired: R191 section 2 item 4 is judged against the seat own rule, not excused; ' + String(notMeasured.length) + ' not measured) [live shell at ' + SHELL_ORIGIN + '; clicks ' + String((transcript.inputs === undefined ? [] : transcript.inputs).length / 2) + ', kernel GETs ' + String((transcript.reads === undefined ? [] : transcript.reads).filter((read) => read.kind === 'http' && read.target === 'kernel').length) + ', panel ops ' + show([...new Set((transcript.reads === undefined ? [] : transcript.reads).filter((read) => read.kind === 'panel').map((read) => read.op))]) + ', model rounds 0]')
  if (stopped) {
    for (const problem of problems) console.log('SKIP: ' + problem)
    for (const note of worldMoved) console.log('SKIP: ' + note)
    console.log('panel-render: ' + (problems.length > 0 ? 'the drive could not be carried to the end' : 'the world moved under this gate') + ', so nothing above is a verdict on the product [exit 3]')
    return 3
  }
  if (failed.length > 0) return 1
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
    console.log('panel-render: a reading could not be measured, so this is a named third state, not a verdict on the product [exit 3]')
    return 3
  }
  return 0
}

process.exitCode = await main()
