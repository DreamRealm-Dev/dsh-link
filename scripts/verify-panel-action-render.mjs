#!/usr/bin/env node
/**
 * Gate 129 (R193) - panel-action-render: WHAT HAPPENS WHEN A PERSON PRESSES THE ACTION THE BROWSER HALF DECLARED.
 *
 * Subject: the action seam R193 opened. P1 gave the panel's contribution seam an optional "invoke" and made a
 * kind:'action' row a BUTTON that calls it exactly once (an invoke that throws is caught and its own words are
 * shown in that row). P2 put the first real user behind it: plugins/dsh-browser's hand-written client bundle
 * declares ONE item, id 'dsh-browser:open-panel', kind 'action', whose invoke calls sidebarRight.openTab() on the
 * kind of the tab type that half itself registered. Written from the R193 contract (section 2, the row for gate
 * 129), from gate 128's world shape, and from the LIVE DOM - never from the source comments of the thing it judges.
 *
 * WHY THIS GATE EXISTS. Gate 128 judged what a status row LOOKS LIKE. An action is the other sentence: the row is
 * something to DO, and the only honest way to judge "doing it works" is to do it once, in the live client, and read
 * what moved. So this gate keeps the browser pane's own chrome out of view, presses the row the browser half
 * declared, and asks the rail whether the browser pane became the selected tab and whether the anchor the shell
 * places the native panel on appeared - then puts every one of those back.
 *
 * WHAT IT DOES (and what it is allowed to do)
 *   - premises first, self-witnessed: the shell's own status says phase=ready, the kernel registry route the panel
 *     pane draws from answers 200, the kernel pid / desktop client pid@start-time / CDP page target are the same
 *     before and after, and the single-run guard sees no other registered live gate running (it reads the
 *     register, never writes it).
 *   - it OWNS the panel the R153 way: claim the lease (scripts/panel-lease.mjs) before touching anything, re-read
 *     the lease after every input, release it in the restore step. Claimed FIRST on purpose: while it is held the
 *     page host (src-tauri/src/core/panel_host.js, a 400 ms tick) may not open, move or close the native panel,
 *     so the only thing that can move this world is this file. That is also why the "ACTIVE world" panel is
 *     MEASURED rather than assumed: if the host did win a placement the restore must take it down and prove it
 *     with a reading, and if it never appeared the reading says so.
 *   - the world it needs is the one called AWAY in .tmp/r181-owner/world.mjs: the rail is NOT on the browser pane
 *     and there is no [data-dsh-link-surface] anchor. That is a premise, not a hope: in the ACTIVE world the click
 *     this gate is about has ALREADY happened, so "the click opened the browser pane" cannot be measured there and
 *     the gate declines BY NAME instead of reporting a green it did not see.
 *   - THE EXPECTED WORDS ARE THE PROVIDER'S OWN, READ AS DATA, EVERY RUN. The item's id, kind, source, order, its
 *     locale namespace, its marker, the tab kind its invoke opens, both dictionaries and the dictionary KEY its own
 *     definition names are PARSED out of plugins/dsh-browser/lib/client.js - the very bytes the live page runs
 *     (that half is a hand-written bundle; nothing rebuilds it). The panel's own dictionary (the chip text, the
 *     section head) is parsed out of its own locales.ts, and the data-attribute names the pane draws rows with are
 *     parsed out of the panel's BUILT artifact. Nothing in this file is the string it compares against.
 *   - the ONLY input it sends is left mouse press/release: the door (the guide), the panel's capsule, the ACTION
 *     ROW - clicked once, by name - and the restore clicks. No key events, no typing, no navigation, no DOM write,
 *     no scroll: every Runtime.evaluate it sends is an expression whose whole body is a JSON.stringify of DOM /
 *     global reads, recorded verbatim and audited by reading 8.
 *   - it never starts, stops or rebuilds the client, never writes the live archive, never takes a model turn.
 *
 * THE READINGS (each independently failable; a reading that cannot be measured is the NAMED third state)
 *   0-premises-ports-ready-and-the-same-two-processes
 *   1-the-panel-lease-was-ours-before-every-input
 *   2-the-panel-tab-was-opened-through-the-door-this-world-has
 *   3-the-action-row-draws-the-browser-halves-own-declared-action
 *   4-the-chrome-before-the-click-nothing-was-opened
 *   5-one-click-through-cdp-selected-the-browser-pane-and-the-surface-anchor
 *   6-the-action-row-and-the-browser-pane-are-on-screen-with-pixels
 *   7-the-world-was-put-back-with-the-active-world-panel
 *   8-this-gate-only-clicked-and-never-wrote
 *
 * WHAT THIS GATE CANNOT SAY (named here so nobody reads it into a green line): whether the native browser renders
 * anything inside the anchor (this gate captures the PAGE's pixels, not a child webview's); whether a SECOND press
 * of the same row behaves (the contract asks for exactly one); whether the action's own word is right in any
 * locale other than the one the dictionaries are read from; whether the panel catches an invoke that THROWS (that
 * is gate 127's subject - this provider never throws); whether the other six client halves declare actions.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a named third state (a premise this world does not meet, a
 * reading that could not be measured, or a world that moved under the gate).
 *
 * Usage: node scripts/verify-panel-action-render.mjs [--port 31761] [--kernel-port 31760] [--cdp-port 9222]
 *        [--holder gate-r193-panel-action-render-<pid>] [--out <transcript.json>]
 *        [--replay <transcript.json>] [--self-attack]
 *   --replay   judges a transcript this gate wrote, with ZERO operations: no fetch, no CDP, no pwsh, no click.
 *   --self-attack  mutates the MEASURED transcript in memory and asks, for every mutant, which readings its
 *                  verdict MOVED - and requires that set to be exactly the set the mutant declared.
 *
 * This gate is SINGLE-RUN ONLY and never belongs in a segmented run: it presses a real button that opens a real
 * tab, so a live gate beside it would be judging a world this gate is moving.
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
const HOLDER = String(option('--holder', 'gate-r193-panel-action-render-' + String(process.pid)))
const LEASE_TTL_MS = 180000
const SCHEMA = 'r193-g129-transcript/1'

const SCRATCH_DIR = join(PROJECT, '.tmp', 'r193-g129')
/** The panel's own copy: the chip text the guide capsule is titled with, the section head, the meta template. */
const PANEL_DICTIONARY_PATH = join(PROJECT, 'plugins', 'dsh-link-panel', 'src', 'client', 'locales.ts')
/** The artifact the page runs for the panel half: it carries the data-attribute names this gate reads rows with. */
const PANEL_BUILT_PATH = join(PROJECT, 'plugins', 'dsh-link-panel', 'lib', 'client.js')
/** The provider half: a HAND-WRITTEN bundle (nothing rebuilds it), so it is both the source and the artifact. */
const PROVIDER_BUNDLE_PATH = join(PROJECT, 'plugins', 'dsh-browser', 'lib', 'client.js')
/** The world helper the R181 round left behind: its own fingerprint, and its own name for the two worlds. */
const WORLD_HELPER_PATH = join(PROJECT, '.tmp', 'r181-owner', 'world.mjs')
const PANEL_STATE_PATH = '/api/dsh-link-panel/state'
const NOTES_STATE_PATH = '/api/dsh-link-notes/state'
const MANIFEST_PATHS = [
  join(PROJECT, 'pack', 'pack.json'),
  join(PROJECT, 'plugins', 'dsh-link-panel', 'cordis.patch.yml'),
  join(PROJECT, 'plugins', 'dsh-browser', 'cordis.patch.yml'),
]

/** The seat's own DOM contract, measured by gate 126 and reused here as the instrument it is. */
const SEL_RAIL = '[data-rightbar-col]'
const SEL_CHIP = '[role=tab][data-dockkit-tab]'
const SEL_CHIP_TITLE = '[data-dockkit-tab-title]'
const SEL_CHIP_CLOSE = 'button[data-dockkit-tab-close]'
const SEL_GUIDE = '[data-sidebar-right-guide]'
const SEL_ADD_CONTROL = 'button[data-dockkit-add-tab]'
const SEL_SURFACE_ANY = '[data-dsh-link-surface]'
const SEL_SURFACE_TRUE = '[data-dsh-link-surface="true"]'
/** The purposes an input of this gate may have. Nothing else may be clicked. */
const INPUT_PURPOSES = Object.freeze([
  'select-guide', 'select-our-tab', 'click-the-action',
  'restore-leave-browser', 'restore-guide', 'restore-select-our-tab', 'restore-close-our-tab', 'restore-entry-tab',
])
const WALK_PURPOSE = (title) => 'walk-chip:' + String(title)
const ACTION_PURPOSE = 'click-the-action'
const CDP_METHODS = Object.freeze(['Runtime.evaluate', 'Page.captureScreenshot', 'Input.dispatchMouseEvent'])
/** state and lease are reads of the turn; close is the RESTORE of the ACTIVE world, and it must name this holder. */
const PANEL_OPS = Object.freeze(['state', 'lease', 'close'])
/** How long the gate waits for the rail to follow the press before it takes its settled look. */
const SETTLE_MS = 2000

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
  const SELF = 'verify-panel-action-render.mjs'
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

/**
 * The world, through the helper the R181 round wrote for exactly this question (.tmp/r181-owner/world.mjs).
 *
 * Run as a CHILD process on purpose: that file runs its own main() at import time, so importing it here would
 * execute a live read in --replay mode (which must make none) and print into this gate's output. Its verb "read"
 * is a read-only fingerprint: one op=state and one page probe, no writes, no clicks.
 */
const worldHelperRead = (t, purpose) => {
  if (existsSync(WORLD_HELPER_PATH) !== true) return { ok: false, why: 'the world helper is not there: ' + WORLD_HELPER_PATH, text: null, name: null }
  const command = 'node .tmp/r181-owner/world.mjs read'
  t.calls.push({ kind: 'spawn', purpose, command, at: new Date().toISOString() })
  const done = spawnSync(process.execPath, [WORLD_HELPER_PATH, 'read'], { cwd: PROJECT, encoding: 'utf8', timeout: 60000, windowsHide: true })
  const err = String(done.stderr === undefined || done.stderr === null ? '' : done.stderr)
  const text = String(done.stdout === undefined || done.stdout === null ? '' : done.stdout) + (err === '' ? '' : '\n[stderr] ' + err)
  const named = /^world:\s*(\S+)/m.exec(text)
  return { ok: done.status === 0, status: done.status, text: text.trim(), name: named === null ? null : named[1] }
}

// ---------------------------------------------------------------------------
// The panel's own copy, and the attribute names its artifact draws with
// ---------------------------------------------------------------------------

/** Read an "export const zh = { ... }" block out of a client-half source. Copied values are how a gate lies. */
const readZhBlock = (path) => {
  if (existsSync(path) !== true) throw new NotMeasured('the dictionary this gate compares against is not there: ' + path)
  const text = readFileSync(path, 'utf8')
  const start = text.indexOf('export const zh = {')
  if (start === -1) throw new NotMeasured('the dictionary source has no "export const zh = {" block: ' + path)
  const end = text.indexOf('\n}', start)
  const block = text.slice(start, end === -1 ? text.length : end)
  const table = {}
  for (const match of block.matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g)) table[match[1]] = match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  return { path, sha256: sha256(text), table }
}

/** The panel's own words: the chip text (also the guide capsule's title), the section head, the meta template. */
const readPanelDictionary = () => {
  const zh = readZhBlock(PANEL_DICTIONARY_PATH)
  const title = zh.table['tab.title']
  const contribHead = zh.table['contrib.title']
  const meta = zh.table['item.meta']
  const noBody = zh.table['contrib.noBody']
  if (typeof title !== 'string' || title === '') throw new NotMeasured('the panel zh dictionary carries no "tab.title" value')
  if (typeof contribHead !== 'string' || contribHead === '') throw new NotMeasured('the panel zh dictionary carries no "contrib.title" value')
  if (typeof meta !== 'string' || meta === '') throw new NotMeasured('the panel zh dictionary carries no "item.meta" value')
  return { path: zh.path, sha256: zh.sha256, keys: Object.keys(zh.table).length, title, contribHead, meta, noBody, table: zh.table }
}

/** What the panel's artifact the page runs carries: the chip text, literal or escaped (gate 126's rule). */
const readPanelBuilt = (title) => {
  const digest = fileDigest(PANEL_BUILT_PATH)
  if (digest.exists !== true) return { ...digest, carriesTitle: null, howNamed: 'the built artifact is not there' }
  const text = readFileSync(PANEL_BUILT_PATH, 'utf8')
  let escaped = ''
  for (const character of String(title)) {
    const code = character.codePointAt(0)
    escaped += code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : character
  }
  const lowered = text.replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => '\\u' + String(hex).toLowerCase())
  const literal = text.includes(title)
  const asEscape = escaped !== title && lowered.includes(escaped)
  return { ...digest, carriesTitle: literal || asEscape, howNamed: literal ? 'literal' : asEscape ? 'escaped as ' + escaped : 'absent from the built bytes' }
}

/**
 * The data attributes the pane draws a contributed row (and its action button) with, out of the panel's BUILT
 * artifact. This gate does not transcribe them: an attribute that moves is a NAMED third state here rather than
 * a silent empty query.
 */
const readContributionDomNames = () => {
  const digest = fileDigest(PANEL_BUILT_PATH)
  if (digest.exists !== true) throw new NotMeasured('the panel built artifact this gate reads its DOM names out of is not there: ' + PANEL_BUILT_PATH)
  const text = readFileSync(PANEL_BUILT_PATH, 'utf8')
  const all = new Set()
  for (const match of text.matchAll(/"(data-panel-[a-z-]+)":/g)) all.add(match[1])
  const need = {
    paneBody: 'data-panel-tab',
    section: 'data-panel-contributed',
    list: 'data-panel-contributed-list',
    head: 'data-panel-contributed-head',
    row: 'data-panel-contributed-row',
    kind: 'data-panel-contributed-kind',
    source: 'data-panel-contributed-source',
    hasInvoke: 'data-panel-contributed-has-invoke',
    title: 'data-panel-contributed-title',
    action: 'data-panel-contributed-action',
    meta: 'data-panel-contributed-meta',
    body: 'data-panel-contributed-body',
    error: 'data-panel-contributed-error',
    empty: 'data-panel-empty',
  }
  for (const key of Object.keys(need)) {
    if (all.has(need[key]) !== true) throw new NotMeasured('the panel built artifact no longer draws rows with "' + need[key] + '", so what an action row looks like in the DOM cannot be read out of the world: ' + PANEL_BUILT_PATH)
  }
  return { ...need, path: PANEL_BUILT_PATH, sha256: digest.sha256, all: [...all].sort() }
}

// ---------------------------------------------------------------------------
// The provider: every word and every name this gate judges, parsed out of its own bundle
// ---------------------------------------------------------------------------

/** One const COPY_XX = { "key": "value", ... } block (either quote style) out of the provider's own bundle. */
const readCopyBlock = (text, name) => {
  const start = text.indexOf('const ' + name + ' = {')
  if (start === -1) throw new NotMeasured('the provider bundle no longer states ' + name + ', so the words it contributes cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const end = text.indexOf('\n}', start)
  const block = text.slice(start, end === -1 ? text.length : end + 2)
  const table = {}
  for (const match of block.matchAll(/['"]([^'"]+)['"]\s*:\s*'((?:[^'\\]|\\.)*)'/g)) table[match[1]] = match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  for (const match of block.matchAll(/['"]([^'"]+)['"]\s*:\s*"((?:[^"\\]|\\.)*)"/g)) table[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  return { table, text: block }
}

/**
 * The provider's own declaration, read as data.
 *
 * Everything compared below travels from these bytes: the id, kind, source and order it declares, the marker it
 * records its own answers in, its locale namespace, the tab kind and tab id it registered, both dictionaries, the
 * dictionary key its own title thunk names, whether its definition carries an invoke, and where that invoke says
 * it calls openTab. A name the provider spells but its dictionary does not carry is a NAMED third state.
 */
const readProviderBundle = () => {
  if (existsSync(PROVIDER_BUNDLE_PATH) !== true) throw new NotMeasured('the provider bundle the page runs is not there: ' + PROVIDER_BUNDLE_PATH)
  const text = readFileSync(PROVIDER_BUNDLE_PATH, 'utf8')
  const pick = (pattern, what) => {
    const found = pattern.exec(text)
    if (found === null) throw new NotMeasured('the provider bundle no longer states ' + what + ', so the item this gate looks for cannot be named: ' + PROVIDER_BUNDLE_PATH)
    return found[1]
  }
  const Q = '[\'"]'
  const id = pick(new RegExp('const PANEL_ITEM_ID = ' + Q + '([^\'"]+)' + Q), 'the id its one item is declared under')
  const kind = pick(new RegExp('const PANEL_ITEM_KIND = ' + Q + '([^\'"]+)' + Q), 'the kind it declares')
  const source = pick(new RegExp('const PANEL_ITEM_SOURCE = ' + Q + '([^\'"]+)' + Q), 'the source it declares')
  const order = Number(pick(/const PANEL_ITEM_ORDER = (\d+)/, 'the order it declares'))
  const marker = pick(new RegExp('const PANEL_MARKER = ' + Q + '([^\'"]+)' + Q), 'the marker it records its own answers in')
  const ns = pick(new RegExp('const LOCALE_NS = ' + Q + '([^\'"]+)' + Q), 'its locale namespace')
  const tabKind = pick(new RegExp('const TAB_KIND = ' + Q + '([^\'"]+)' + Q), 'the kind of the tab type it registered')
  const tabId = pick(new RegExp('const TAB_ID = ' + Q + '([^\'"]+)' + Q), 'the id of the tab type it registered')
  const definition = /function panelItemDefinition\((.+?)\) \{\r?\n([\s\S]*?)\r?\n\}/.exec(text)
  if (definition === null) throw new NotMeasured('the provider bundle no longer defines panelItemDefinition, so the item it hands the seam cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const body = definition[2]
  const titleFound = /title: function \(\) \{ return t\(['"]([^'"]+)['"]\) \}/.exec(body)
  if (titleFound === null) throw new NotMeasured('the provider definition no longer spells its title as a thunk over one dictionary key: ' + PROVIDER_BUNDLE_PATH)
  const titleKey = titleFound[1]
  const hasInvoke = /\binvoke:\s*function\s*\(/.test(body)
  if (hasInvoke !== true) throw new NotMeasured('the provider definition carries no invoke, so the item this gate presses is not an action: ' + PROVIDER_BUNDLE_PATH)
  const invokeFound = /invoke:\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}/.exec(body)
  const invokeBody = invokeFound === null ? '' : invokeFound[1]
  const opened = /(\w+)\(ctx, tabType\)/.exec(invokeBody)
  if (opened === null) throw new NotMeasured('the provider invoke no longer names the step it runs, so what this action opens cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const step = new RegExp('function ' + opened[1] + '\\((.+?)\\) \\{\\r?\\n([\\s\\S]*?)\\r?\\n\\}').exec(text)
  if (step === null) throw new NotMeasured('the provider bundle no longer defines ' + opened[1] + ', so what the action calls cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const openTabCalled = /\.openTab\(tabType\.kind\)/.test(step[2])
  const zh = readCopyBlock(text, 'COPY_ZH').table
  const en = readCopyBlock(text, 'COPY_EN').table
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  if (same(zhKeys, enKeys) !== true) throw new NotMeasured('the provider dictionaries do not carry the same key set: zh ' + show(zhKeys) + ' against en ' + show(enKeys))
  if (Object.prototype.hasOwnProperty.call(zh, titleKey) !== true) throw new NotMeasured('the provider code names the dictionary key ' + show(titleKey) + ' while its zh dictionary carries ' + show(zhKeys))
  if (Object.prototype.hasOwnProperty.call(zh, 'tab.title') !== true) throw new NotMeasured('the provider dictionary carries no "tab.title", so the chip its action selects cannot be named: ' + PROVIDER_BUNDLE_PATH)
  return {
    bundle: fileDigest(PROVIDER_BUNDLE_PATH), id, kind, source, order, marker, ns, tabKind, tabId,
    titleKey, hasInvoke, defineStep: opened[1], openTabCalled,
    zh: { title: zh[titleKey], titleKey, tabTitle: zh['tab.title'], keys: zhKeys.length },
    en: { title: en[titleKey], tabTitle: en['tab.title'], keys: enKeys.length },
    dictionary: { zh, en },
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

/** One panel op, recorded. The ops this gate may send are state, lease and the restore's close. */
const panelOp = async (t, op, payload, purpose) => {
  if (PANEL_OPS.includes(op) !== true) throw new NotMeasured('this gate tried to send a panel op outside its allowlist: ' + show(op))
  const entry = { kind: 'panel', op, purpose, holder: payload === undefined || payload === null ? null : (payload.holder === undefined ? null : payload.holder), status: null, ok: false, error: null, body: null }
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

/** Every page read this gate makes is a JSON.stringify of DOM/global reads: reading 8 audits exactly that. */
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
// (The same instrument decision cdp-drive.mjs made for its column probe: an expression assembled from quoted
// strings stops matching the moment the DOM moves, and the labels here are Chinese. The page only RUNS what
// this file parses. Every probe below reports what it finds and invents nothing: a missing element is null,
// never a zero rectangle.)

/** The rail: its box, its chips, whether the guide is on screen, and whether the browser pane's anchor is. */
function railProbe() {
  const boxOf = (el) => {
    if (el === null || el === undefined) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const shown = (el) => (el === null || el === undefined ? null : (typeof el.checkVisibility === 'function' ? el.checkVisibility() : null))
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
  const guide = document.querySelector('[data-sidebar-right-guide]')
  const surface = document.querySelector('[data-dsh-link-surface="true"]')
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
    surfaceBox: boxOf(surface),
    surfaceCheckVisibility: shown(surface),
    paneCount: document.querySelectorAll('[data-panel-tab]').length,
  }
}

/** The guide page: every capsule the world offers, and the one that is ours. */
function guideProbe(ourTitle) {
  const boxOf = (el) => {
    if (el === null || el === undefined) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const rail = document.querySelector('[data-rightbar-col]')
  const entries = Array.from(document.querySelectorAll('[data-sidebar-right-guide-entry]')).map((entry) => {
    const children = Array.from(entry.children)
    const iconHolder = children[0] === undefined ? null : children[0]
    const textHolder = children[1] === undefined ? null : children[1]
    const titleEl = textHolder === null ? null : textHolder.children[0]
    const descriptionEl = textHolder === null ? null : textHolder.children[1]
    return {
      kind: entry.getAttribute('data-sidebar-right-guide-entry'),
      box: boxOf(entry),
      text: entry.textContent,
      titleText: titleEl === undefined || titleEl === null ? null : titleEl.textContent,
      descriptionText: descriptionEl === undefined || descriptionEl === null ? null : descriptionEl.textContent,
      hasGlyph: iconHolder !== null && iconHolder.querySelector('svg') !== null,
      inRail: rail !== null && rail.contains(entry),
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

/**
 * The rail, the open pane, and EVERY word the action seam put on screen - including the button itself.
 *
 * The data attributes are passed in (sel.contrib.*) because they are read out of the panel's own built artifact
 * every run: this probe asks the DOM the question the world's own bytes spell. The two chip titles it matches
 * with are the panel's and the browser half's own dictionary values, also read every run.
 */
function paneProbe(sel) {
  const boxOf = (el) => {
    if (el === null || el === undefined) return null
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const shown = (el) => (el === null || el === undefined ? null : (typeof el.checkVisibility === 'function' ? el.checkVisibility() : null))
  const overlap = (left, right) => (left === null || right === null ? null : (left.x + left.w > right.x && right.x + right.w > left.x && left.y + left.h > right.y && right.y + right.h > left.y))
  const inWindow = (box) => (box === null ? null : (box.w > 0 && box.h > 0 && box.x + box.w > 0 && box.y + box.h > 0 && box.x < window.innerWidth && box.y < window.innerHeight))
  const textOf = (el) => (el === null || el === undefined ? null : el.textContent)
  const attributesOf = (el) => {
    const out = {}
    const list = Array.from(el.attributes)
    for (let at = 0; at < list.length; at += 1) out[list[at].name] = list[at].value
    return out
  }
  const rail = document.querySelector(sel.rail)
  const railBox = boxOf(rail)
  const chips = Array.from(document.querySelectorAll(sel.chip)).map((tab) => {
    const titleEl = tab.querySelector(sel.chipTitle)
    return {
      id: tab.getAttribute(sel.chipId),
      title: textOf(titleEl),
      selected: tab.getAttribute('aria-selected') === 'true',
      box: boxOf(tab),
      closeBox: boxOf(tab.querySelector(sel.chipClose)),
    }
  })
  const selected = chips.filter((chip) => chip.selected)[0]
  const oursIndex = chips.map((chip) => chip.title).indexOf(sel.panelTitle)
  const chromeIndex = chips.map((chip) => (chip.title !== null && String(chip.title).indexOf(sel.browserTitle) !== -1 ? 1 : 0)).indexOf(1)
  const chip = oursIndex === -1 ? null : chips[oursIndex]
  const chrome = chromeIndex === -1 ? null : chips[chromeIndex]
  const titleSeat = chip === null ? null : document.querySelector(sel.chipById.replace('__ID__', chip.id) + ' ' + sel.titleSeat)
  const body = document.querySelector(sel.paneBody)
  const bodyBox = boxOf(body)
  const style = body === null ? null : getComputedStyle(body)
  const section = document.querySelector(sel.contrib.section)
  const list = document.querySelector(sel.contrib.list)
  const head = document.querySelector(sel.contrib.head)
  const rows = Array.from(document.querySelectorAll(sel.contrib.row)).map((row) => {
    const titleEl = row.querySelector(sel.contrib.title)
    const actionEl = row.querySelector(sel.contrib.action)
    const metaEl = row.querySelector(sel.contrib.meta)
    const bodyEl = row.querySelector(sel.contrib.body)
    const box = boxOf(row)
    return {
      id: row.getAttribute(sel.contrib.rowAttr),
      kind: row.getAttribute(sel.contrib.kindAttr),
      source: row.getAttribute(sel.contrib.sourceAttr),
      hasInvoke: row.getAttribute(sel.contrib.hasInvokeAttr),
      attributes: attributesOf(row),
      box: box,
      line: row.textContent,
      cells: row.children.length,
      inRail: rail !== null && rail.contains(row),
      intersectsRail: overlap(box, railBox),
      inWindow: inWindow(box),
      checkVisibility: shown(row),
      title: textOf(titleEl),
      titleBox: boxOf(titleEl),
      titleTag: titleEl === null ? null : titleEl.tagName,
      titleType: titleEl === null ? null : titleEl.getAttribute('type'),
      titleIsButton: titleEl !== null && titleEl.tagName === 'BUTTON',
      titleLength: titleEl === null ? null : titleEl.textContent.length,
      actionElBox: boxOf(actionEl),
      actionElPresent: actionEl !== null,
      meta: textOf(metaEl),
      metaBox: boxOf(metaEl),
      body: textOf(bodyEl),
      bodyBox: boxOf(bodyEl),
      bodyCheckVisibility: shown(bodyEl),
      error: textOf(row.querySelector(sel.contrib.error)),
      errorCount: row.querySelectorAll(sel.contrib.error).length,
    }
  })
  const surface = document.querySelector(sel.surfaceTrue)
  return {
    href: location.href,
    viewport: [Math.round(window.innerWidth), Math.round(window.innerHeight)],
    dpr: window.devicePixelRatio,
    rail: railBox,
    chips: chips,
    selected: selected === undefined ? null : selected.title,
    chipIndex: oursIndex,
    chip: chip,
    chipSelected: chip === null ? null : chip.selected,
    titleSeatText: textOf(titleSeat),
    browserIndex: chromeIndex,
    browserChip: chrome,
    browserChipSelected: chrome === null ? null : chrome.selected,
    paneCount: document.querySelectorAll(sel.paneBody).length,
    body: {
      box: bodyBox,
      display: style === null ? null : style.display,
      visibility: style === null ? null : style.visibility,
      checkVisibility: shown(body),
      textLength: body === null ? null : body.textContent.length,
      inRail: rail !== null && body !== null && rail.contains(body),
      intersectsRail: overlap(bodyBox, railBox),
      inWindow: inWindow(bodyBox),
    },
    contributed: section === null ? null : {
      box: boxOf(section),
      head: textOf(head),
      listBox: boxOf(list),
      rowCount: rows.length,
      emptyMarkers: Array.from(section.querySelectorAll('[' + sel.contrib.empty + ']')).map((el) => el.getAttribute(sel.contrib.empty)),
      boxInRail: rail !== null && rail.contains(section),
      inWindow: inWindow(boxOf(section)),
    },
    rows: rows,
    surface: {
      count: document.querySelectorAll(sel.surfaceAny).length,
      box: boxOf(surface),
      display: surface === null ? null : getComputedStyle(surface).display,
      checkVisibility: shown(surface),
      inWindow: inWindow(boxOf(surface)),
      intersectsRail: overlap(boxOf(surface), railBox),
      inRail: rail !== null && surface !== null && rail.contains(surface),
    },
    refusedRows: document.querySelectorAll('[data-panel-refusal]').length,
    readsAttr: (document.querySelector('[data-panel-reads]') === null ? null : document.querySelector('[data-panel-reads]').getAttribute('data-panel-reads')),
  }
}

/** The two markers: the provider's own record of what its action did, and the panel's own projection. */
function markerProbe(providerMarkerKey) {
  const panel = globalThis.__dshLinkPanel === undefined ? null : globalThis.__dshLinkPanel
  const provider = globalThis[providerMarkerKey] === undefined ? null : globalThis[providerMarkerKey]
  const items = panel === null || panel.items === undefined ? null : panel.items
  return {
    panel: panel,
    panelKeys: panel === null ? null : Object.keys(panel),
    itemsJson: items === null ? null : JSON.stringify(items),
    contributed: panel === null || panel.contributed === undefined ? null : panel.contributed,
    provider: provider,
  }
}

const probeExpression = (fn, argument) => '(' + fn.toString() + ')(' + JSON.stringify(argument) + ')'

/**
 * Park the browser pane by clicking another rail tab, and report what the rail says afterwards.
 *
 * R279: "the world is ACTIVE" is a world a gate can leave behind, not a fact about the product. Another live gate
 * that just used the browser pane hands this one a rail whose anchor already exists, and the press this gate exists
 * to observe then has nothing to open. One click on a non-browser tab closes the pane (and the host closes the panel
 * with it), so the gate does it and says so instead of declining.
 * @param t - the transcript being built.
 * @param cdp - the page connection.
 * @param railProbe - the rail probe.
 * @param atEntry - the rail as it was found.
 * @returns { clicked, onto, surfaceBefore, surfaceAfter }.
 */
const parkBrowserPane = async (t, cdp, railProbe, atEntry) => {
  const BROWSER = /Browser|browser|\u6d4f\u89c8\u5668/
  const target = (atEntry.chips ?? []).find((chip) => chip.selected !== true && BROWSER.test(String(chip.title ?? '')) === false)
  const out = { clicked: false, onto: target === undefined ? null : target.title, surfaceBefore: atEntry.surfaceCount, surfaceAfter: atEntry.surfaceCount, closed: false, waitedMs: 0 }
  // R329: PARKING IS NOT CLOSING, and the rail can hold TWO panes (measured: a 智能体团队 tab selected in one group and
  // 🌐浏览器 selected in another, so clicking a "non-browser" tab in the first group never touches the pane the anchor
  // comes from). The close control is a real button - `_tabClose_…`, aria-label 关闭, `data-dockkit-tab-close=<tab>` - so
  // press THAT, and keep pressing while the anchor count stays above zero.
  if (target !== undefined && target.box !== null && target.box !== undefined && target.box.w > 0) {
    await cdp.click({ x: Math.round(target.box.x + target.box.w / 2), y: Math.round(target.box.y + target.box.h / 2) })
    out.clicked = true
    await new Promise((done) => setTimeout(done, 900))
    const after = await cdpJson(t, cdp, 'rail-after-park', probeExpression(railProbe), 'the rail after this gate parked the browser pane')
    if (after.ok === true) out.surfaceAfter = after.value.surfaceCount
  }
  const startedAt = Date.now()
  while (out.surfaceAfter > 0 && Date.now() - startedAt < 8000) {
    const shut = await cdp.evaluate('(' + (function () {
      const BROWSER = /Browser|browser|\u6d4f\u89c8\u5668/
      const rail = document.querySelector('[data-rightbar-col]')
      const tabs = []
      const all = document.querySelectorAll('[role="tab"]')
      for (const el of all) {
        if (rail !== null && rail.contains(el) === false) continue
        if (BROWSER.test(String(el.textContent || ''))) tabs.push(el)
      }
      const withClose = tabs.filter((el) => el.querySelector('[data-dockkit-tab-close], [aria-label="\u5173\u95ed"]') !== null)
      if (withClose.length === 0) return { tabs: tabs.length, box: null }
      const control = withClose[0].querySelector('[data-dockkit-tab-close], [aria-label="\u5173\u95ed"]')
      const rect = control.getBoundingClientRect()
      return { tabs: tabs.length, box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }
    }).toString() + ')()')
    const box = shut !== null && shut !== undefined && shut.exception === undefined && shut.exception === null && shut.value !== undefined ? shut.value.box : null
    if (box === null || box === undefined || box.w <= 0 || box.h <= 0) break
    await cdp.click({ x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) })
    out.closed = true
    await new Promise((done) => setTimeout(done, 500))
    const again = await cdpJson(t, cdp, 'rail-after-close', probeExpression(railProbe), 'the rail after this gate closed the browser pane')
    if (again.ok === true) out.surfaceAfter = again.value.surfaceCount
    out.waitedMs = Date.now() - startedAt
  }
  return out
}

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

/** One rectangle of the live window, in device pixels. The clip is given in CSS pixels (CDP multiplies by dpr). */
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
    schema: SCHEMA,
    startedAt: new Date().toISOString(),
    shellOrigin: SHELL_ORIGIN, kernelOrigin: KERNEL_ORIGIN,
    ports: { shell: PORT, kernel: KERNEL_PORT, cdp: CDP_PORT },
    holder: HOLDER, gatePid: process.pid,
    panel: null, provider: null, dom: null,
    entry: null, drive: null, restore: null, exit: null,
    inputs: [], cdpCalls: [], probes: [], reads: [], calls: [], notes: [], problems: [],
  }
  const cdp = await connectCdp({ port: CDP_PORT })
  if (cdp === null) throw new NotMeasured('no CDP page on port ' + String(CDP_PORT) + ', so nothing can be looked at')
  // The socket is handed to the caller so EVERY exit path closes it: an open WebSocket keeps the Node event
  // loop alive, and a gate that declines (exit 3) must still EXIT.
  if (bag !== undefined && bag !== null) bag.cdp = cdp

  // ---- premises ----
  const status = await shellStatus(t)
  if (status.ok !== true || status.body === null) throw new NotMeasured('the shell did not answer GET /__shell/status (' + String(status.why) + ')')
  if (status.body.phase !== 'ready') throw new NotMeasured('the shell reports phase=' + show(status.body.phase) + ', not ready')
  const panelRoute = await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'premise: the registry route the pane draws from')
  if (panelRoute.ok !== true || panelRoute.body === null || panelRoute.body.ok !== true) throw new NotMeasured('GET ' + PANEL_STATE_PATH + ' did not answer 200 ok=true: ' + show({ status: panelRoute.status, why: panelRoute.why }))
  const notesRoute = await httpGet(t, 'kernel', KERNEL_ORIGIN + NOTES_STATE_PATH, 'the ledger the pane draws beside the contributions (read, not required)')

  const panelWords = readPanelDictionary()
  const TITLE = panelWords.title
  const dom = readContributionDomNames()
  const provider = readProviderBundle()
  t.panel = {
    path: panelWords.path, sha256: panelWords.sha256, keys: panelWords.keys,
    tabTitle: TITLE, contribHead: panelWords.contribHead, itemMeta: panelWords.meta, contribNoBody: panelWords.noBody,
    built: readPanelBuilt(TITLE), readAt: new Date().toISOString(),
  }
  t.provider = {
    bundle: provider.bundle, id: provider.id, kind: provider.kind, source: provider.source, order: provider.order,
    marker: provider.marker, ns: provider.ns, tabKind: provider.tabKind, tabId: provider.tabId,
    titleKey: provider.titleKey, hasInvoke: provider.hasInvoke, defineStep: provider.defineStep, openTabCalled: provider.openTabCalled,
    zh: provider.zh, en: provider.en, dictionary: provider.dictionary, readAt: new Date().toISOString(),
  }
  t.dom = {
    ...dom,
    rowSelector: '[' + dom.row + '="' + provider.id + '"]',
    actionSelector: '[' + dom.action + ']',
    hasInvokeSelector: '[' + dom.hasInvoke + ']',
  }
  const sel = {
    rail: SEL_RAIL, chip: SEL_CHIP, chipTitle: SEL_CHIP_TITLE, chipClose: SEL_CHIP_CLOSE,
    chipId: 'data-dockkit-tab', chipById: '[data-dockkit-tab="__ID__"]', titleSeat: '[data-panel-title]',
    addControl: SEL_ADD_CONTROL, guide: SEL_GUIDE, surfaceAny: SEL_SURFACE_ANY, surfaceTrue: SEL_SURFACE_TRUE,
    panelTitle: TITLE, browserTitle: provider.zh.tabTitle,
    paneBody: '[' + dom.paneBody + ']',
    contrib: {
      section: '[' + dom.section + ']', list: '[' + dom.list + ']', head: '[' + dom.head + ']',
      row: '[' + dom.row + ']', title: '[' + dom.title + ']', action: '[' + dom.action + ']',
      meta: '[' + dom.meta + ']', body: '[' + dom.body + ']', error: '[' + dom.error + ']',
      empty: dom.empty,
      rowAttr: dom.row, kindAttr: dom.kind, sourceAttr: dom.source, hasInvokeAttr: dom.hasInvoke,
    },
  }

  const rail = await cdpJson(t, cdp, 'rail-at-entry', probeExpression(railProbe), 'premise: the rail as this gate found it')
  if (rail.ok !== true) throw new NotMeasured('the rail could not be read: ' + String(rail.why))
  // R279: THE GATE PARKS THE WORLD ITSELF. This premise used to DECLINE ("the world is ACTIVE") whenever another live
  // gate had left the browser pane in front, which in the full suite is most of the time: the gate before this one
  // had just used that pane. But the gate needs the pane CLOSED, and that is one click away - parking it is part of
  // finding the world, not part of the answer. The decline below still fires if the click does not take.
  let entrySurfaceCount = rail.value.surfaceCount
  if (rail.value.surfaceCount > 0) {
    const parked = await parkBrowserPane(t, cdp, railProbe, rail.value)
    entrySurfaceCount = parked.surfaceAfter
    t.notes.push('note: the rail arrived with ' + String(rail.value.surfaceCount) + ' surface anchor(s) (the browser pane in front); this gate parked it: ' + show(parked))
  }
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
    world: worldHelperRead(t, 'world fingerprint at entry (through .tmp/r181-owner/world.mjs read)'),
  }
  t.entry.guard = guardRead(t)
  // ---- the premises this world must meet, by name ----
  if (t.entry.lease !== null && t.entry.lease.held === true && t.entry.lease.holder !== HOLDER) throw new NotMeasured('the panel was already leased by ' + show(t.entry.lease.holder) + ' when this gate arrived')
  if (t.entry.guard.others.length > 0) throw new NotMeasured('another live consumer is running beside this gate: ' + t.entry.guard.others.join(' | '))
  if (provider.openTabCalled !== true) throw new NotMeasured('the provider invoke no longer calls openTab on the kind it registered, so what this gate is about cannot be pressed: ' + show(provider.defineStep))
  // THE WORLD THIS GATE NEEDS. In the ACTIVE world the browser pane is already selected and its anchor already
  // exists, so "the press opened it" is unmeasurable there: decline by name instead of reporting a green.
  if (entrySurfaceCount > 0) throw new NotMeasured('the world is ACTIVE (the rail already carries ' + String(entrySurfaceCount) + ' [data-dsh-link-surface] anchor(s) at ' + show(rail.value.surfaceBox) + '): the browser pane is already open, so the press this gate is about has no effect left to measure - prepare the AWAY world first (node .tmp/r181-owner/world.mjs pane ' + provider.zh.tabTitle + ' switches AWAY; this gate needs the rail on any other tab)')
  const chromeAtEntry = rail.value.chips.filter((chip) => chip.title !== null && String(chip.title).indexOf(provider.zh.tabTitle) !== -1)[0]
  if (chromeAtEntry === undefined) t.notes.push('note: no rail chip is titled like the browser half own "tab.title" (' + show(provider.zh.tabTitle) + ') at entry; the chips are ' + show(rail.value.chips.map((chip) => chip.title)) + ' - the press is still judged by what the rail shows after it')

  // ---- the lease, before anything that clicks ----
  t.drive = {
    claims: [], leaseAfterInput: [], door: { used: null, walk: [], guideOpenBefore: rail.value.guideOpen }, guide: null, entry: null,
    guideChip: null, capsuleClick: null, pane: null, pane2: null, marker1: null, marker2: null, route: null,
    before: null, beforeMarker: null, beforeState: null, actionClick: null, after: null, after2: null, afterMarker: null, afterMarker2: null, afterState: null,
    settle: null, screenshots: {}, shape: null, waits: [], nativePanel: { existsBeforeClick: null, closedByThisGate: null, existsAfter: null },
  }
  await ensureLease(t, 'before the door was opened')

  /**
   * The strip re-lays itself out when a tab arrives (gate 126 measured our chip moving 52px between two reads,
   * and a close click landing on the chip body instead of its control). A box is only clicked after it has been
   * read twice and found unchanged.
   */
  const stableOurChip = async (rounds) => {
    let previous = null
    let seen = null
    for (let round = 0; round < rounds; round += 1) {
      const answer = await cdpJson(t, cdp, 'our-chip-stable', probeExpression(railProbe), 'our own chip, read twice, so only a box that is not moving is clicked')
      const found = answer.ok === true ? answer.value.chips.filter((chip) => chip.title === TITLE)[0] : undefined
      seen = found === undefined ? null : found
      if (seen !== null && previous !== null && same(seen, previous) === true) return { chip: seen, rounds: round + 1, stable: true }
      previous = seen
      if (seen === null) return { chip: null, rounds: round + 1, stable: false }
      await HOLD(400)
    }
    return { chip: seen, rounds, stable: false }
  }

  // ---- the door: the world's own way into an extension tab ----
  const railNow = rail.value
  const ourChipAtEntry = railNow.chips.filter((chip) => chip.title === TITLE)[0]
  if (ourChipAtEntry !== undefined) {
    t.drive.shape = 'already-open-at-entry'
    t.drive.door.used = 'the rail already carried our tab as a chip at entry'
    const selectedChip = railNow.chips.filter((chip) => chip.selected)[0]
    t.drive.guideChip = selectedChip === undefined ? null : { title: selectedChip.title, id: selectedChip.id }
    t.notes.push('note: the rail already carried our tab as a chip at entry (' + show(ourChipAtEntry.title) + '), so this gate did not open it')
  } else {
    t.drive.shape = 'opened-by-this-gate'
    if (railNow.guideOpen !== true) {
      if (railNow.addControl !== null && railNow.addControl !== undefined) {
        t.drive.door.used = 'the strip own add control (button[data-dockkit-add-tab])'
        await ensureLease(t, 'before opening the guide with the add control')
        await clickSpot(t, cdp, { x: railNow.addControl.x + Math.round(railNow.addControl.w / 2), y: railNow.addControl.y + Math.round(railNow.addControl.h / 2) }, 'select-guide')
        await noteLeaseAfterInput(t, 'select-guide')
        await HOLD(700)
        const opened = await cdpJson(t, cdp, 'guide-after-add-control', probeExpression(railProbe), 'did the add control open the guide')
        const afterAdd = opened.ok === true ? opened.value : null
        const guideChipNow = afterAdd === null ? undefined : afterAdd.chips.filter((chip) => chip.selected)[0]
        t.drive.guideChip = guideChipNow === undefined ? null : { title: guideChipNow.title, id: guideChipNow.id }
      } else {
        t.drive.door.used = 'the rail own chips, walked from the last to the first'
        const order = [...railNow.chips].reverse()
        for (const chip of order) {
          if (chip.box === null || chip.box === undefined) continue
          await ensureLease(t, 'before walking to the chip ' + show(chip.title))
          await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, WALK_PURPOSE(chip.title))
          await noteLeaseAfterInput(t, 'walk-chip:' + String(chip.title))
          const seen = await cdpJson(t, cdp, 'guide-after-walk', probeExpression(railProbe), 'did this chip open the guide')
          const openedHere = seen.ok === true && seen.value.guideOpen === true
          t.drive.door.walk.push({ chip: chip.title, clicked: true, guideOpen: openedHere })
          if (openedHere === true) {
            t.drive.guideChip = { title: chip.title, id: chip.id }
            break
          }
        }
      }
    } else {
      t.drive.door.used = 'the guide was already the selected tab when this gate arrived'
      const selectedChip = railNow.chips.filter((chip) => chip.selected)[0]
      t.drive.guideChip = selectedChip === undefined ? null : { title: selectedChip.title, id: selectedChip.id }
    }
  }
  const guide = await cdpJson(t, cdp, 'guide-page', probeExpression(guideProbe, TITLE), 'the guide page and its capsules')
  t.drive.guide = guide.ok === true ? guide.value : { error: guide.why, entries: [], ours: null }
  t.drive.entry = t.drive.guide.ours === undefined ? null : t.drive.guide.ours
  t.drive.door.found = t.drive.entry !== null || t.drive.shape === 'already-open-at-entry'
  if (t.drive.door.found !== true) {
    t.notes.push('the rail own tab list: ' + show(railNow.chips.map((chip) => chip.title + (chip.selected ? '*' : ''))))
    t.notes.push('the guide own capsule list: ' + show((t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).map((row) => row.titleText + ' [' + row.kind + ']')))
    t.problems.push('no door to our tab was found: the rail offers ' + show(railNow.chips.map((chip) => chip.title)) + ' and the guide offers ' + String((t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length) + ' capsule(s), none titled ' + show(TITLE))
    return t
  }

  // ---- the click that opens our tab ----
  if (t.drive.shape === 'opened-by-this-gate') {
    const capsule = t.drive.entry
    await ensureLease(t, 'before clicking our capsule')
    const landed = await clickSpot(t, cdp, { x: capsule.box.x + Math.round(capsule.box.w / 2), y: capsule.box.y + Math.round(capsule.box.h / 2) }, 'select-our-tab')
    await noteLeaseAfterInput(t, 'select-our-tab')
    t.drive.capsuleClick = { x: landed.x, y: landed.y, box: capsule.box, title: capsule.titleText }
  } else {
    const settledChip = await stableOurChip(5)
    const chip = settledChip.chip
    if (chip !== null && chip.box !== null && chip.selected !== true) {
      await ensureLease(t, 'before selecting our tab, which was already in the rail')
      await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, 'select-our-tab')
      await noteLeaseAfterInput(t, 'select-our-tab')
    }
    t.drive.capsuleClick = { x: null, y: null, box: chip === null ? null : chip.box, title: TITLE, shape: 'the chip that was already there' }
  }

  const readyOf = (probe) => probe !== null && probe !== undefined && probe.chip !== undefined && probe.chip !== null && probe.chipSelected === true && probe.body !== undefined && probe.body !== null && probe.body.box !== null && probe.body.box !== undefined && probe.body.box.w > 0
  const deadline = Date.now() + 12000
  let probe = null
  for (;;) {
    await HOLD(600)
    const seen = await cdpJson(t, cdp, 'pane-after-click', probeExpression(paneProbe, sel), 'the pane our click opened')
    probe = seen.ok === true ? seen.value : { error: seen.why }
    if (readyOf(probe) === true || Date.now() > deadline) break
  }
  t.drive.pane = probe
  t.drive.waits.push({ until: 'our chip selected and its body box non-empty', reached: readyOf(probe), at: new Date().toISOString() })
  const firstMarker = await cdpJson(t, cdp, 'marker-after-open', probeExpression(markerProbe, provider.marker), 'the two markers, read beside the pane they are about')
  t.drive.marker1 = firstMarker.ok === true ? firstMarker.value : { error: firstMarker.why }

  // ---- the settled read: the row is re-read, so a row that is still arriving is not judged on one look ----
  await HOLD(900)
  const second = await cdpJson(t, cdp, 'pane-settled', probeExpression(paneProbe, sel), 'the pane after the world had time to move')
  t.drive.pane2 = second.ok === true ? second.value : { error: second.why }
  const secondMarker = await cdpJson(t, cdp, 'marker-settled', probeExpression(markerProbe, provider.marker), 'the two markers beside the settled pane, in the same step')
  t.drive.marker2 = secondMarker.ok === true ? secondMarker.value : { error: secondMarker.why }
  t.drive.route = { panel: await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'the registry as it stands while the pane is drawn') }

  // ---- THE CHROME BEFORE THE PRESS: nothing of the browser tab is open ----
  const beforeRail = await cdpJson(t, cdp, 'chrome-before-the-click', probeExpression(railProbe), 'the rail before the press: is the browser pane already open')
  t.drive.before = beforeRail.ok === true ? beforeRail.value : { error: beforeRail.why }
  const beforeMarker = await cdpJson(t, cdp, 'marker-before-the-click', probeExpression(markerProbe, provider.marker), 'the provider own marker before its action is pressed')
  t.drive.beforeMarker = beforeMarker.ok === true ? beforeMarker.value : { error: beforeMarker.why }
  const beforeState = await readPanelState(t, 'the native panel before the press')
  t.drive.beforeState = { status: beforeState.status, panel: panelFingerprint(beforeState.state) }
  t.drive.nativePanel.existsBeforeClick = t.drive.beforeState.panel === null ? null : t.drive.beforeState.panel.exists

  const settledRows = t.drive.pane2 !== null && t.drive.pane2 !== undefined && Array.isArray(t.drive.pane2.rows) ? t.drive.pane2.rows : (t.drive.pane !== null && t.drive.pane !== undefined && Array.isArray(t.drive.pane.rows) ? t.drive.pane.rows : [])
  const ourRow = settledRows.filter((row) => row !== null && row !== undefined && row.id === provider.id)[0]
  // The action's own rectangle, captured BEFORE the press: a button that cannot be seen is not pressable, and
  // this gate may not scroll the rail to reach one.
  t.drive.screenshots.row = await screenshot(t, cdp, ourRow === undefined ? null : ourRow.box, 'the action row own rectangle, in pixels, before it is pressed')
  t.drive.screenshots.button = await screenshot(t, cdp, ourRow === undefined ? null : ourRow.titleBox, 'the action BUTTON own rectangle, in pixels, before it is pressed')
  t.drive.screenshots.beforePane = await screenshot(t, cdp, t.drive.before === null || t.drive.before === undefined ? null : t.drive.before.rail, 'the rail before the press, in pixels, so the "nothing opened" reading has its own picture')

  const pressable = ourRow !== undefined && ourRow.titleBox !== null && ourRow.titleBox !== undefined && ourRow.titleBox.w > 0 && ourRow.titleBox.h > 0 && ourRow.inWindow === true
  if (pressable !== true) {
    t.problems.push('the action row this gate must press is ' + (ourRow === undefined ? 'not drawn at all' : 'drawn at ' + show(ourRow.titleBox) + ', which is not inside the window own visible area (' + show(t.drive.before === null || t.drive.before === undefined ? null : t.drive.before.viewport) + ')') + '; this gate may not scroll the rail, so it cannot press it')
    t.drive.actionClick = { clicked: false, why: 'the button is not inside the window' }
  } else if (ourRow.titleIsButton !== true) {
    t.problems.push('the row for ' + show(provider.id) + ' is not drawn as a button (its title element is ' + show(ourRow.titleTag) + '), so there is nothing this gate may press')
    t.drive.actionClick = { clicked: false, why: 'the row is not a button' }
  } else {
    // ---- THE PRESS: once, by name, through CDP's real mouse input ----
    await ensureLease(t, 'before pressing the action')
    const landed = await clickSpot(t, cdp, { x: ourRow.titleBox.x + Math.round(ourRow.titleBox.w / 2), y: ourRow.titleBox.y + Math.round(ourRow.titleBox.h / 2) }, ACTION_PURPOSE)
    const afterLease = await noteLeaseAfterInput(t, ACTION_PURPOSE)
    t.drive.actionClick = { clicked: true, x: landed.x, y: landed.y, box: ourRow.titleBox, title: ourRow.title, pressedAt: new Date().toISOString(), leaseAfter: afterLease }
    const followDeadline = Date.now() + 15000
    let after = null
    for (;;) {
      await HOLD(500)
      const seen = await cdpJson(t, cdp, 'chrome-after-the-click', probeExpression(paneProbe, sel), 'the rail after the press: is the browser pane selected and is its anchor there')
      after = seen.ok === true ? seen.value : { error: seen.why }
      const done = after !== null && after !== undefined && ((after.surface !== null && after.surface !== undefined && after.surface.count > 0) || after.browserChipSelected === true)
      if (done === true || Date.now() > followDeadline) break
    }
    t.drive.after = after
    t.drive.waits.push({ until: 'the browser chip selected or the surface anchor present', reached: after !== null && after !== undefined && (after.browserChipSelected === true || (after.surface !== null && after.surface !== undefined && after.surface.count > 0)), at: new Date().toISOString() })
    const afterMarker = await cdpJson(t, cdp, 'marker-after-the-click', probeExpression(markerProbe, provider.marker), 'the provider own record of how many times its action was asked for')
    t.drive.afterMarker = afterMarker.ok === true ? afterMarker.value : { error: afterMarker.why }
    const afterState = await readPanelState(t, 'the native panel after the press')
    t.drive.afterState = { status: afterState.status, panel: panelFingerprint(afterState.state) }
    t.drive.nativePanel.existsAfterClick = t.drive.afterState.panel === null ? null : t.drive.afterState.panel.exists
    // The settled second look, so the reading is not one frame of a transition.
    const settleFrom = Date.now()
    await HOLD(SETTLE_MS)
    const again = await cdpJson(t, cdp, 'chrome-settled', probeExpression(paneProbe, sel), 'the rail again, after the world had time to move')
    t.drive.after2 = again.ok === true ? again.value : { error: again.why }
    const againMarker = await cdpJson(t, cdp, 'marker-settled-after-the-click', probeExpression(markerProbe, provider.marker), 'the provider own marker beside the settled rail')
    t.drive.afterMarker2 = againMarker.ok === true ? againMarker.value : { error: againMarker.why }
    t.drive.settle = {
      ms: Date.now() - settleFrom,
      anchorFirst: t.drive.after !== null && t.drive.after !== undefined && t.drive.after.surface !== null && t.drive.after.surface !== undefined ? t.drive.after.surface.box : null,
      anchorSettled: t.drive.after2 !== null && t.drive.after2 !== undefined && t.drive.after2.surface !== null && t.drive.after2.surface !== undefined ? t.drive.after2.surface.box : null,
      invokesFirst: t.drive.afterMarker !== null && t.drive.afterMarker !== undefined && t.drive.afterMarker.provider !== null && t.drive.afterMarker.provider !== undefined ? (t.drive.afterMarker.provider.invokes === undefined ? 0 : t.drive.afterMarker.provider.invokes) : null,
      invokesSettled: t.drive.afterMarker2 !== null && t.drive.afterMarker2 !== undefined && t.drive.afterMarker2.provider !== null && t.drive.afterMarker2.provider !== undefined ? (t.drive.afterMarker2.provider.invokes === undefined ? 0 : t.drive.afterMarker2.provider.invokes) : null,
    }
    // ---- the pixels AFTER the press: the browser pane and the anchor the shell places the panel on ----
    const anchor = t.drive.after2 !== null && t.drive.after2 !== undefined && t.drive.after2.surface !== null && t.drive.after2.surface !== undefined ? t.drive.after2.surface.box : null
    t.drive.screenshots.anchor = await screenshot(t, cdp, anchor, 'the surface anchor own rectangle, in pixels, after the press')
    const chromeChip = t.drive.after2 !== null && t.drive.after2 !== undefined ? t.drive.after2.browserChip : null
    t.drive.screenshots.chip = await screenshot(t, cdp, chromeChip === null || chromeChip === undefined ? null : chromeChip.box, 'the browser chip own rectangle, in pixels, after the press')
  }

  // ---- the restore ----
  t.restore = {
    steps: [], openedByThisGate: t.drive.shape === 'opened-by-this-gate',
    leaseReleased: false, guideBack: false, guideEntries: null, guideVia: null, ourTabClosed: false, entryTabReselected: false,
    panelClosed: null, railAfter: null, leaseAfter: null, panelAfter: null,
  }
  const wantEntry = t.entry.rail.selected
  try {
    // 1. leave the browser pane: the anchor (and with it the page host's reason to keep a panel placed) goes away.
    const railBeforeRestore = await cdpJson(t, cdp, 'rail-before-restore', probeExpression(railProbe), 'the rail before it is put back')
    const now = railBeforeRestore.ok === true ? railBeforeRestore.value : null
    t.restore.steps.push('the rail before the restore: ' + show(now === null ? null : { selected: now.selected, chips: now.chips.map((chip) => chip.title), surfaceCount: now.surfaceCount }))
    if (now !== null && now.surfaceCount > 0 && wantEntry !== null && wantEntry !== undefined) {
      const entryChip = now.chips.filter((chip) => chip.title === wantEntry)[0]
      if (entryChip !== undefined && entryChip.box !== null && entryChip.box !== undefined) {
        await ensureLease(t, 'before leaving the browser pane')
        await clickSpot(t, cdp, { x: entryChip.box.x + Math.round(entryChip.box.w / 2), y: entryChip.box.y + Math.round(entryChip.box.h / 2) }, 'restore-leave-browser')
        await noteLeaseAfterInput(t, 'restore-leave-browser')
        await HOLD(500)
        const left = await cdpJson(t, cdp, 'anchor-after-leaving-browser', probeExpression(railProbe), 'did the anchor go away with the pane')
        t.restore.steps.push('left the browser pane by selecting ' + show(wantEntry) + ': anchor count now ' + show(left.ok === true ? left.value.surfaceCount : null))
      } else {
        t.restore.steps.push('the entry tab ' + show(wantEntry) + ' is not in the rail any more, so this gate could not leave the browser pane by that door')
      }
    }
    // 2. the ACTIVE world's panel: if the press mounted it, take it back down and prove it. The holder is named
    //    because this is a WRITE against the shell's panel, and the whole point of the lease is that it says who.
    const stateNow = await readPanelState(t, 'the native panel before it is put back')
    const existed = stateNow.state === null || stateNow.state === undefined ? null : stateNow.state.exists === true
    t.restore.panelClosed = { before: existed, closed: null, answer: null }
    if (existed === true) {
      const closed = await panelOp(t, 'close', { holder: HOLDER }, 'the ACTIVE world panel this press mounted, taken back down by name')
      t.restore.panelClosed.closed = closed.status
      t.restore.panelClosed.answer = closed.error === null ? (closed.body === null ? null : { exists: closed.body.exists === undefined ? null : closed.body.exists }) : closed.error
      t.restore.steps.push('the native panel existed after the press and op=close under ' + HOLDER + ' answered ' + String(closed.status))
      await HOLD(500)
      const gone = await readPanelState(t, 'the native panel after the close')
      const stillThere = gone.state === null || gone.state === undefined ? null : gone.state.exists === true
      t.restore.panelClosed.stillThere = stillThere
      t.restore.steps.push('the native panel after the close: exists=' + show(stillThere))
    } else {
      t.restore.steps.push('the native panel never appeared after the press (exists=' + show(existed) + '): nothing to take down, and this gate does not open one')
    }
    // 3. our own tab, closed through its own close control (the product shows one on the ACTIVE chip only).
    if (t.restore.openedByThisGate === true) {
      let closed = false
      for (let attempt = 0; attempt < 3 && closed !== true; attempt += 1) {
        const settledChip = await stableOurChip(5)
        let chip = settledChip.chip
        if (chip === null || chip === undefined) {
          closed = true
          t.restore.steps.push('our chip was already gone before the close click (attempt ' + String(attempt + 1) + ')')
          break
        }
        if (chip.selected !== true) {
          await ensureLease(t, 'before selecting our own chip, so its own close control is the one on show')
          await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, 'restore-select-our-tab')
          await noteLeaseAfterInput(t, 'restore-select-our-tab')
          await HOLD(450)
          const againChip = await stableOurChip(5)
          chip = againChip.chip
          if (chip === null || chip === undefined) {
            closed = true
            t.restore.steps.push('our chip went away while it was being selected (attempt ' + String(attempt + 1) + ')')
            break
          }
        }
        const close = chip.closeBox === undefined ? null : chip.closeBox
        if (close === null) {
          t.restore.steps.push('our chip carried no close control, so this gate could not close the tab it opened (chip box ' + show(chip.box) + ')')
          break
        }
        await ensureLease(t, 'before closing our own tab')
        await clickSpot(t, cdp, { x: close.x + Math.round(close.w / 2), y: close.y + Math.round(close.h / 2) }, 'restore-close-our-tab')
        await noteLeaseAfterInput(t, 'restore-close-our-tab')
        await HOLD(500)
        const gone = await cdpJson(t, cdp, 'our-tab-gone', probeExpression(railProbe), 'did our chip go')
        closed = gone.ok === true && gone.value.chips.filter((row) => row.title === TITLE).length === 0
        t.restore.steps.push('our own tab closed through its chip own close control: ' + show(closed) + ' (attempt ' + String(attempt + 1) + ', close box ' + show(close) + ', box unchanged over ' + String(settledChip.rounds) + ' read(s)=' + show(settledChip.stable) + ')')
      }
      t.restore.ourTabClosed = closed
    } else {
      t.restore.steps.push('this gate did not open our tab, so it leaves it open')
      t.restore.ourTabClosed = true
    }
    // 4. the door, put back: the guide is asked for again - by the chip that opened it - and read.
    const guideChip = t.drive.guideChip
    // R278: whether there is a door to put back is a fact about the world this gate ARRIVED in, not about its own
    // patience. Measured in the active world: the rail came up on our own tab with the guide CLOSED (guides open by
    // kind, and a capsule replaces the guide page once opened), so this gate never used the door - and then went
    // looking for a chip to bring it back, found our own tab's chip, clicked it, and reported "the guide was not put
    // back". A door that was never open cannot be put back, and saying so is the honest reading.
    const entryGuideOpen = t.entry === null || t.entry === undefined || t.entry.rail === null || t.entry.rail === undefined
      ? null : t.entry.rail.guideOpen === true
    if (entryGuideOpen !== true) {
      t.restore.guideBack = true
      t.restore.guideNeverOpen = true
      t.restore.steps.push('the guide was NOT open when this gate arrived (entry guideOpen=' + show(entryGuideOpen) + '), so this world had no door to put back')
    } else if (guideChip !== null && guideChip !== undefined) {
      const railThen = await cdpJson(t, cdp, 'rail-before-guide-back', probeExpression(railProbe), 'the rail before the guide is asked for again')
      if (railThen.ok === true && railThen.value.guideOpen === true) {
        t.restore.guideBack = true
        t.restore.guideEntries = (t.drive.guide === null || t.drive.guide === undefined || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length
        t.restore.steps.push('the guide was already on screen again')
      } else {
        const chip = railThen.ok === true ? railThen.value.chips.filter((row) => row.title === guideChip.title)[0] : undefined
        if (chip !== undefined && chip.box !== null && chip.box !== undefined) {
          await ensureLease(t, 'before bringing the guide back')
          await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, 'restore-guide')
          await noteLeaseAfterInput(t, 'restore-guide')
          await HOLD(600)
          const back = await cdpJson(t, cdp, 'guide-back', probeExpression(guideProbe, TITLE), 'did the guide come back, and does it still offer the same capsules')
          t.restore.guideBack = back.ok === true && back.value.guideOpen === true
          t.restore.guideEntries = back.ok === true ? back.value.entries.length : null
          t.restore.steps.push('the guide was brought back through the chip that opened it (' + show(guideChip.title) + '): ' + show(t.restore.guideBack) + ' with ' + show(t.restore.guideEntries) + ' capsule(s)')
        } else {
          // THE GUIDE CHIP IS GONE, and that is the product's own behaviour: opening a capsule REPLACES the guide
          // page with the tab it opened, so closing our tab does not bring the door back by itself. The door is
          // opened again through the strip own add control, which opens the guide BY KIND
          // (packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx: addTab -> openTab(GUIDE_KIND)),
          // and its answer is read like every other step's.
          const addNow = railThen.ok === true ? railThen.value.addControl : null
          if (addNow !== null && addNow !== undefined) {
            await ensureLease(t, 'before putting the door back with the add control')
            await clickSpot(t, cdp, { x: addNow.x + Math.round(addNow.w / 2), y: addNow.y + Math.round(addNow.h / 2) }, 'restore-guide')
            await noteLeaseAfterInput(t, 'restore-guide')
            await HOLD(700)
            const back = await cdpJson(t, cdp, 'guide-back', probeExpression(guideProbe, TITLE), 'did the add control bring the guide back')
            t.restore.guideBack = back.ok === true && back.value.guideOpen === true
            t.restore.guideEntries = back.ok === true ? back.value.entries.length : null
            t.restore.guideVia = 'the strip own add control (button[data-dockkit-add-tab])'
            t.restore.steps.push('the guide was brought back through the strip own add control (button[data-dockkit-add-tab] at ' + show(addNow) + '): guideOpen=' + show(t.restore.guideBack) + ' with ' + show(t.restore.guideEntries) + ' capsule(s) - the chip that opened it (' + show(guideChip.title) + ') had been replaced by our tab')
          } else {
            t.restore.guideUnreachable = { chipTitle: guideChip.title, addControl: railThen.ok === true ? railThen.value.addControl : null, addControlMissing: true }
            t.restore.steps.push('the chip that opened the guide (' + show(guideChip.title) + ') is gone from the rail AND the strip offers no add control (' + show(railThen.ok === true ? railThen.value.addControl : null) + '), so this gate cannot put the door back by itself')
          }
        }
      }
    } else {
      t.restore.steps.push('this gate never opened the guide (door: ' + show(t.drive.door.used) + '), so there was no door to put back')
      t.restore.guideBack = true
    }
    // 5. the entry tab, reselected.
    const beforeEntry = await cdpJson(t, cdp, 'rail-before-reselect', probeExpression(railProbe), 'the rail before the entry tab is reselected')
    if (beforeEntry.ok === true && beforeEntry.value.selected !== wantEntry && wantEntry !== null && wantEntry !== undefined) {
      const chip = beforeEntry.value.chips.filter((row) => row.title === wantEntry)[0]
      if (chip !== undefined && chip.box !== null && chip.box !== undefined) {
        await ensureLease(t, 'before reselecting the entry tab')
        await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, 'restore-entry-tab')
        await noteLeaseAfterInput(t, 'restore-entry-tab')
        t.restore.entryTabReselected = true
        t.restore.steps.push('the entry tab ' + show(wantEntry) + ' was reselected')
      } else {
        t.restore.steps.push('the entry tab ' + show(wantEntry) + ' is no longer in the rail, so it could not be reselected')
      }
    } else {
      t.restore.entryTabReselected = true
      t.restore.steps.push('the entry tab was already selected again: ' + show(wantEntry))
    }
    const afterRail = await cdpJson(t, cdp, 'rail-after-restore', probeExpression(railProbe), 'the rail as this gate leaves it')
    t.restore.railAfter = afterRail.ok === true ? afterRail.value : null
  } catch (error) {
    t.restore.steps.push('the restore stopped: ' + describe(error))
  } finally {
    await releaseLease(PORT, HOLDER)
    const released = await readPanelState(t, 'lease after release')
    t.restore.leaseReleased = released.state === null || released.state.lease === undefined || released.state.lease.held !== true
    t.restore.leaseAfter = leaseLine(released.state)
    if (t.restore.railAfter === null || t.restore.railAfter === undefined) {
      const afterRail = await cdpJson(t, cdp, 'rail-after-release', probeExpression(railProbe), 'the rail as this gate leaves it, read after the lease went back')
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
    world: worldHelperRead(t, 'world fingerprint at exit (through .tmp/r181-owner/world.mjs read)'),
  }
  // The tree is shared: another author editing a tracked file while this gate runs moves git status, and R191
  // section 3 says a world moved by somebody else is a NAMED THIRD STATE, never a product red. What stays
  // judgeable is whether a file THIS GATE wrote shows up in the difference - its only write is its own
  // transcript, inside the git-ignored scratch, and it is written AFTER this fingerprint.
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
  t.notes.push('this round PRESSED a real action row once: kind=action (' + String(provider.id) + ') was pressed through CDP mouse input, the rail followed it to the browser pane, and the rail was then put back on the tab that was selected when this gate arrived (' + show(t.entry.rail.selected) + ')')
  t.finishedAt = new Date().toISOString()
  cdp.close()
  return t
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript
// ---------------------------------------------------------------------------

const OK = (detail) => ({ ok: true, code: 'ok', detail })
const BAD = (code, detail) => ({ ok: false, code, detail })
const NOT_MEASURED = (code, detail) => ({ ok: false, notMeasured: true, code, detail })

/** The verdict's machine-comparable shape: two verdicts differ when this differs (the self-attack reads it). */
const signature = (verdict) => (verdict === null || verdict === undefined
  ? 'none'
  : verdict.ok === true ? 'ok' : (verdict.notMeasured === true ? 'n/a:' : 'FAIL:') + String(verdict.code))

/** What a registry answer DECLARES, without the per-request counter and timestamp this gate own reads move. */
const stableRoute = (route) => (route === null || route === undefined || route.body === null || route.body === undefined ? null : { readOnly: route.body.readOnly, path: route.body.path, registry: route.body.registry, declared: route.body.declared, mounted: route.body.mounted })
/** What a ledger answer DECLARES, without its per-request counter and timestamp. */
const stableLedger = (ledger) => (ledger === null || ledger === undefined || ledger.body === null || ledger.body === undefined ? null : { readOnly: ledger.body.readOnly, path: ledger.body.path, limits: ledger.body.limits, counts: ledger.body.counts, notes: ledger.body.notes })

const factsOf = (t) => {
  const entry = (t === null || t === undefined || t.entry === undefined || t.entry === null) ? {} : t.entry
  const drive = (t === null || t === undefined || t.drive === undefined || t.drive === null) ? {} : t.drive
  const provider = (t === null || t === undefined || t.provider === undefined || t.provider === null) ? {} : t.provider
  const panel = (t === null || t === undefined || t.panel === undefined || t.panel === null) ? {} : t.panel
  const pane = (drive.pane2 === undefined || drive.pane2 === null) ? (drive.pane === undefined ? {} : drive.pane) : drive.pane2
  const marker = (drive.marker2 === undefined || drive.marker2 === null) ? (drive.marker1 === undefined ? null : drive.marker1) : drive.marker2
  const markerPanel = marker === null || marker === undefined ? null : (marker.panel === undefined ? null : marker.panel)
  const markerKeys = marker === null || marker === undefined ? null : (marker.panelKeys === undefined ? null : marker.panelKeys)
  const markerItemsJson = marker === null || marker === undefined ? null : (marker.itemsJson === undefined ? null : marker.itemsJson)
  const markerContributed = marker === null || marker === undefined ? null : (marker.contributed === undefined ? null : marker.contributed)
  const markerProvider = marker === null || marker === undefined ? null : (marker.provider === undefined ? null : marker.provider)
  const route = drive.route === undefined || drive.route === null ? null : (drive.route.panel === undefined ? null : drive.route.panel)
  const rows = Array.isArray(pane.rows) ? pane.rows : []
  const row = rows.filter((candidate) => candidate !== null && candidate !== undefined && candidate.id === provider.id)[0]
  const after = (drive.after2 === undefined || drive.after2 === null) ? (drive.after === undefined ? {} : drive.after) : drive.after2
  const before = (drive.before === undefined || drive.before === null) ? {} : drive.before
  const afterMarker = (drive.afterMarker2 === undefined || drive.afterMarker2 === null) ? (drive.afterMarker === undefined ? null : drive.afterMarker) : drive.afterMarker2
  const screenshots = drive.screenshots === undefined || drive.screenshots === null ? {} : drive.screenshots
  return {
    t, entry, drive, provider, panel, pane, marker, markerPanel, markerProvider, markerKeys, markerItemsJson, markerContributed, route,
    rows, row: row === undefined ? null : row,
    after, afterMarker, before,
    beforeProvider: drive.beforeMarker === undefined || drive.beforeMarker === null ? null : (drive.beforeMarker.provider === undefined ? null : drive.beforeMarker.provider),
    afterProvider: afterMarker === null || afterMarker === undefined ? null : (afterMarker.provider === undefined ? null : afterMarker.provider),
    screenshots,
    shotRow: screenshots.row === undefined ? null : screenshots.row,
    shotButton: screenshots.button === undefined ? null : screenshots.button,
    shotAnchor: screenshots.anchor === undefined ? null : screenshots.anchor,
    shotBeforePane: screenshots.beforePane === undefined ? null : screenshots.beforePane,
  }
}

/** The kinds the registry route declares, or null when it was not read or carries none. */
const registryKinds = (f) => {
  const registry = f.route === null || f.route === undefined || f.route.body === null || f.route.body === undefined ? null : f.route.body.registry
  return registry === null || registry === undefined || Array.isArray(registry.kinds) !== true ? null : registry.kinds
}

/** How many times the provider's own marker says its action was asked for (absent means none yet). */
const invokeCount = (providerMarker) => (providerMarker === null || providerMarker === undefined ? null : (providerMarker.invokes === undefined ? 0 : providerMarker.invokes))

/** The browser half's own word for the chip its action selects, or null when it was never read. */
const browserWord = (f) => (f.provider.zh === undefined || f.provider.zh === null || f.provider.zh.tabTitle === undefined ? null : f.provider.zh.tabTitle)

const READINGS = [
  {
    id: '0-premises-ports-ready-and-the-same-two-processes',
    judge: (t) => {
      const problems = []
      const entry = t.entry === null || t.entry === undefined ? {} : t.entry
      if (entry.status === undefined || entry.status === null || entry.status.phase !== 'ready') problems.push('the shell did not report phase=ready at entry: ' + show(entry.status === undefined || entry.status === null ? null : entry.status.phase))
      if (t.exit === null || t.exit === undefined || t.exit.status === null || t.exit.status.phase !== 'ready') problems.push('the shell did not report phase=ready at exit: ' + show(t.exit === null || t.exit === undefined || t.exit.status === null ? null : t.exit.status.phase))
      if (entry.status === undefined || entry.status === null || entry.status.pid === null || entry.status.pid === undefined) problems.push('the shell reports no kernel pid, so a restart could not be told from a steady world')
      else if (t.exit === null || t.exit.status === null || t.exit.status.pid !== entry.status.pid) problems.push('the kernel pid moved during this gate: ' + show(entry.status.pid) + ' -> ' + show(t.exit === null || t.exit.status === null ? null : t.exit.status.pid))
      if (entry.client === null || entry.client === undefined) problems.push('the desktop client own pid@start-time could not be read at entry: the world own process is not witnessed')
      else if (t.exit === null || t.exit.client !== entry.client) problems.push('the desktop client was replaced during this gate: ' + show(entry.client) + ' -> ' + show(t.exit === null ? null : t.exit.client))
      if (entry.cdp === undefined || entry.cdp === null || t.exit === null || t.exit.cdp === null || t.exit.cdp.targetId !== entry.cdp.targetId) problems.push('the CDP page target was replaced during this gate: ' + show(entry.cdp === undefined || entry.cdp === null ? null : entry.cdp.targetId) + ' -> ' + show(t.exit === null || t.exit.cdp === null ? null : t.exit.cdp.targetId))
      if (entry.guard !== undefined && entry.guard !== null && entry.guard.others !== undefined && entry.guard.others.length > 0) problems.push('another live consumer was running beside this gate: ' + entry.guard.others.join(' | '))
      const panelStatus = entry.routes === undefined || entry.routes === null || entry.routes.panel === undefined ? null : entry.routes.panel.status
      if (panelStatus !== 200) problems.push('the kernel registry route the pane draws from did not answer 200 at entry: ' + show(panelStatus))
      return problems.length === 0
        ? OK('phase=ready at both ends, the kernel pid, the desktop client own pid@start-time and the CDP page target are the same process throughout, no other live gate was running, and the registry route the pane draws from answered 200 (the ledger route answered ' + show(entry.routes === undefined || entry.routes === null || entry.routes.notes === undefined ? null : entry.routes.notes.status) + ')')
        : BAD('premise-not-met', 'FAIL: ' + problems.join(' | '))
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
      const sample = after[0] === undefined ? {} : after[0]
      return problems.length === 0
        ? OK('the lease was held by ' + String(t.holder) + ' before every one of the ' + String(inputs.length / 2) + ' click(s) this gate sent, re-read after each one (revokedKind stayed ' + show(sample.revokedKind === undefined ? null : sample.revokedKind) + ' and userInputReports stayed ' + show(sample.userInputReports === undefined ? null : sample.userInputReports) + '), and it was released at the end')
        : BAD('lease-not-ours', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '2-the-panel-tab-was-opened-through-the-door-this-world-has',
    judge: (t) => {
      const f = factsOf(t)
      const problems = []
      if (f.drive.door === null || f.drive.door === undefined || f.drive.door.found !== true) problems.push('no door to our tab exists in this world: the rail offers ' + show((f.entry.rail === undefined || f.entry.rail === null ? [] : f.entry.rail.chips).map((chip) => chip.title)) + ' and the guide offers ' + show((f.drive.guide === null || f.drive.guide === undefined || f.drive.guide.entries === undefined ? [] : f.drive.guide.entries).map((row) => row.titleText + ' [' + row.kind + ']')) + ' - none of them is titled ' + show(f.panel.tabTitle))
      if (f.drive.door !== null && f.drive.door !== undefined && (f.drive.door.used === null || f.drive.door.used === undefined)) problems.push('this gate never named the door it used')
      if (f.drive.capsuleClick === null || f.drive.capsuleClick === undefined) problems.push('our tab was found but never opened')
      if (f.pane === null || f.pane === undefined || f.pane.chip === null || f.pane.chip === undefined) problems.push('the panel tab is never the selected rail tab: the chips are ' + show((f.pane === null || f.pane === undefined || f.pane.chips === undefined ? [] : f.pane.chips).map((chip) => chip.title)))
      else if (f.pane.chipSelected !== true) problems.push('our chip exists but is not the selected tab')
      if (f.pane.chip !== null && f.pane.chip !== undefined && f.pane.chip.title !== f.panel.tabTitle) problems.push('the chip is titled ' + show(f.pane.chip.title) + ' while the panel own zh dictionary says "tab.title" is ' + show(f.panel.tabTitle))
      if (f.panel.built === null || f.panel.built === undefined || f.panel.built.carriesTitle !== true) problems.push('the built artifact the page runs does not carry that title at all (' + String(f.panel.built === null || f.panel.built === undefined ? '(unread)' : f.panel.built.howNamed) + ')')
      if (f.pane.body === null || f.pane.body === undefined || f.pane.body.box === null || f.pane.body.box === undefined) problems.push('no pane body is in the document after the tab was opened')
      const guideEntries = f.drive.guide === null || f.drive.guide === undefined || f.drive.guide.entries === undefined ? [] : f.drive.guide.entries
      return problems.length === 0
        ? OK('the panel tab was reached through the door the world has (' + String(f.drive.door.used) + '); at entry the rail held ' + show((f.entry.rail === undefined || f.entry.rail === null ? [] : f.entry.rail.chips).map((chip) => chip.title)) + ' and the guide offered ' + String(guideEntries.length) + ' capsule(s), and the one titled ' + show(f.drive.entry === null || f.drive.entry === undefined ? null : f.drive.entry.titleText) + ' is kind=' + show(f.drive.entry === null || f.drive.entry === undefined ? null : f.drive.entry.kind) + '; the panel tab is now the selected chip, titled with the panel own zh "tab.title" ' + show(f.panel.tabTitle) + ' (the title seat inside it reads ' + show(f.pane.titleSeatText) + '), and its pane body is at ' + show(f.pane.body === undefined ? null : f.pane.body.box))
        : BAD('no-door-or-not-our-tab', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '3-the-action-row-draws-the-browser-halves-own-declared-action',
    judge: (t) => {
      const f = factsOf(t)
      if (f.pane === null || f.pane === undefined || f.pane.rows === undefined) return NOT_MEASURED('no-pane', 'NOT MEASURED: no panel pane was read (the door or the tab did not settle), so there is no action row to judge')
      const problems = []
      if (f.pane.contributed === null || f.pane.contributed === undefined) problems.push('the pane draws no contribution section at all (' + String(t.dom === undefined || t.dom === null ? '?' : t.dom.section) + ' is not in the document)')
      else {
        if (f.pane.contributed.head !== f.panel.contribHead) problems.push('the section head draws ' + show(f.pane.contributed.head) + ' while the panel own zh dictionary says "contrib.title" is ' + show(f.panel.contribHead))
        if (Array.isArray(f.pane.contributed.emptyMarkers) && f.pane.contributed.emptyMarkers.length > 0) problems.push('the section draws its own empty marker while a contribution was declared: ' + show(f.pane.contributed.emptyMarkers))
      }
      if (f.row === null) problems.push('no drawn row carries the id the provider declares (' + show(f.provider.id) + '); the rows are ' + show(f.rows.map((row) => row.id)))
      else {
        if (f.row.title !== f.provider.zh.title) problems.push('the row draws ' + show(f.row.title) + ' while the provider own zh dictionary, for the key its own definition names (' + show(f.provider.titleKey) + '), says ' + show(f.provider.zh.title))
        if (f.row.kind !== f.provider.kind) problems.push('the row is drawn kind=' + show(f.row.kind) + ' while the provider declares ' + show(f.provider.kind))
        const kinds = registryKinds(f)
        if (kinds === null) problems.push('the registry route was not read (or declares no kinds), so the row own kind cannot be held to the closed set')
        else if (kinds.includes(f.row.kind) !== true) problems.push('the row own kind ' + show(f.row.kind) + ' is outside the closed set the registry route declares: ' + show(kinds))
        if (f.row.source !== f.provider.source) problems.push('the row says it belongs to ' + show(f.row.source) + ' while the provider declares ' + show(f.provider.source))
        if (f.row.hasInvoke !== String(f.provider.hasInvoke === true)) problems.push('the row says has-invoke=' + show(f.row.hasInvoke) + ' while the provider definition carries an invoke (' + show(f.provider.hasInvoke === true) + ')')
        if (f.row.titleIsButton !== true) problems.push('the row is NOT drawn as a button: its title element is ' + show(f.row.titleTag) + ' (an action is something to press)')
        if (f.row.actionElPresent !== true) problems.push('the row carries no element with the attribute the artifact gives an action (' + show(t.dom === undefined || t.dom === null ? null : t.dom.action) + ')')
        if (f.row.attributes === undefined || f.row.attributes === null || f.row.attributes[String(t.dom.row)] !== f.provider.id) problems.push('the drawn row does not carry the id in the attribute the artifact draws rows with (' + show(t.dom === undefined || t.dom === null ? null : t.dom.row) + '): ' + show(f.row.attributes))
        if (f.row.attributes !== undefined && f.row.attributes !== null && f.row.attributes[String(t.dom.kind)] !== f.provider.kind) problems.push('the drawn row does not carry its kind in the attribute the artifact draws rows with (' + show(t.dom.kind) + ')')
        if (f.row.attributes !== undefined && f.row.attributes !== null && f.row.attributes[String(t.dom.source)] !== f.provider.source) problems.push('the drawn row does not carry its source in the attribute the artifact draws rows with (' + show(t.dom.source) + ')')
        if (f.row.attributes !== undefined && f.row.attributes !== null && f.row.attributes[String(t.dom.hasInvoke)] !== String(f.provider.hasInvoke === true)) problems.push('the drawn row does not carry has-invoke in the attribute the artifact draws rows with (' + show(t.dom.hasInvoke) + ')')
        if (f.row.errorCount !== 0) problems.push('the row shows ' + String(f.row.errorCount) + ' invoke failure line(s) before it was ever pressed: ' + show(f.row.error))
      }
      return problems.length === 0
        ? OK('the panel drew the action another package declared: id ' + show(f.row.id) + ', kind ' + show(f.row.kind) + ' (inside the registry own closed set ' + show(registryKinds(f)) + ') and source ' + show(f.row.source) + ' on the row itself and in the attributes the artifact draws rows with; has-invoke=' + show(f.row.hasInvoke) + ' says the seam holds a function for it; and its title is the provider own zh dictionary value ' + show(f.row.title) + ' for the key its own definition names (' + show(f.provider.titleKey) + ') drawn inside a <' + String(f.row.titleTag) + ' type=' + show(f.row.titleType) + '> - the panel own section head is ' + show(f.pane.contributed === null ? null : f.pane.contributed.head) + ', and the other contributions beside it are ' + show(f.rows.filter((row) => row.id !== f.provider.id).map((row) => row.id + ' [' + row.kind + ']')))
        : BAD('row-not-the-providers-own-action', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '4-the-chrome-before-the-click-nothing-was-opened',
    judge: (t) => {
      const f = factsOf(t)
      if (f.before === null || f.before === undefined || Array.isArray(f.before.chips) !== true) return NOT_MEASURED('no-before-read', 'NOT MEASURED: the rail was not read before the press, so "nothing was opened" cannot be said')
      const problems = []
      const word = browserWord(f)
      if (word === null) problems.push('the provider own dictionary carries no "tab.title", so the browser chip cannot be named')
      const chipsBefore = f.before.chips === undefined ? [] : f.before.chips
      const chrome = chipsBefore.filter((chip) => chip.title !== null && String(chip.title).indexOf(String(word)) !== -1)[0]
      if (chrome === undefined) problems.push('no rail chip is titled like the browser half own "tab.title" (' + show(word) + ') before the press: the chips are ' + show(chipsBefore.map((chip) => chip.title)))
      else if (chrome.selected === true) problems.push('the browser pane was ALREADY the selected tab before the press (' + show(chrome.title) + '): there is nothing for the press to open')
      if (f.before.surfaceCount !== 0) problems.push('the rail already carried ' + String(f.before.surfaceCount) + ' [data-dsh-link-surface] anchor(s) at ' + show(f.before.surfaceBox) + ' before the press, so the browser pane was already open')
      // The panel's OWN pane is of course in the document (the row this gate presses lives in it): what must not be
      // there is the BROWSER pane, and the three checks above are what says so. The pane count is reported, not judged.
      if (f.drive.beforeState === null || f.drive.beforeState === undefined || f.drive.beforeState.panel === null) problems.push('the shell own panel state was not read before the press')
      else if (f.drive.beforeState.panel.exists === true) problems.push('the shell already had a native panel open before the press (' + show(f.drive.beforeState.panel) + ')')
      // The provider own count of asks is a PER-PAGE counter, not a per-gate one: the page lives as long as the client
      // does, so it need not start at 0 when this gate arrives. What reading 4 can witness is that it did not move while
      // this gate walked the door and opened the panel - i.e. that nothing asked the action before the press below.
      const asked = invokeCount(f.beforeProvider)
      const askedWhenPaneWasDrawn = invokeCount(f.markerProvider)
      if (asked === null) problems.push('the provider own marker (globalThis.' + String(f.provider.marker) + ') was not in the page before the press, so how many times its action has been asked for cannot be witnessed')
      else if (askedWhenPaneWasDrawn !== null && asked !== askedWhenPaneWasDrawn) problems.push('the provider own running count of asks moved from ' + String(askedWhenPaneWasDrawn) + ' to ' + String(asked) + ' between the panel pane being drawn and the press, so something asked for the action before this gate pressed it: ' + show(f.beforeProvider))
      return problems.length === 0
        ? OK('before the press nothing of the browser tab was open: the rail was on ' + show(f.before.selected) + ' with the browser chip ' + show(chrome === undefined ? null : chrome.title) + ' NOT selected, ' + String(f.before.surfaceCount) + ' surface anchor(s), ' + String(f.before.paneCount) + ' panel pane(s) in the document (the panel own, where the row lives), the shell own panel exists=' + show(f.drive.beforeState === null || f.drive.beforeState === undefined || f.drive.beforeState.panel === null ? null : f.drive.beforeState.panel.exists) + ', and the provider own running count of asks stayed at ' + String(asked) + ' from the moment the panel pane was drawn to the press itself (it is a per-PAGE counter, so it need not start at 0 here: reading 5 judges the delta across this gate own press) - globalThis.' + String(f.provider.marker) + ' = ' + clip(show(f.beforeProvider), 200))
        : BAD('the-chrome-was-already-open', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '5-one-click-through-cdp-selected-the-browser-pane-and-the-surface-anchor',
    judge: (t) => {
      const f = factsOf(t)
      const inputs = Array.isArray(t.inputs) ? t.inputs : []
      const pressed = inputs.filter((row) => row.type === 'mousePressed' && row.purpose === ACTION_PURPOSE)
      const click = f.drive.actionClick === undefined || f.drive.actionClick === null ? null : f.drive.actionClick
      if (click === null) return NOT_MEASURED('no-click', 'NOT MEASURED: this gate never reached the action row, so what a press does cannot be said')
      if (click.clicked !== true) return NOT_MEASURED('not-pressable', 'NOT MEASURED: the action row could not be pressed (' + String(click.why) + '), so the rail after a press was never observed')
      if (f.after === null || f.after === undefined || Array.isArray(f.after.chips) !== true) return NOT_MEASURED('no-after-read', 'NOT MEASURED: the rail was not read after the press, so nothing can be said about what the press did')
      const problems = []
      const word = browserWord(f)
      if (pressed.length !== 1) problems.push('the action was pressed ' + String(pressed.length) + ' time(s), and this gate presses it exactly once')
      if (f.after.browserChip === null || f.after.browserChip === undefined) problems.push('after the press no rail chip is titled like the browser half own "tab.title" (' + show(word) + '): the chips are ' + show((f.after.chips === undefined ? [] : f.after.chips).map((chip) => chip.title)))
      else if (f.after.browserChipSelected !== true) problems.push('the browser chip exists but is NOT the selected tab after the press: the rail is on ' + show(f.after.selected))
      if (f.after.surface === null || f.after.surface === undefined || f.after.surface.count !== 1) problems.push('after the press the rail carries ' + String(f.after.surface === undefined || f.after.surface === null ? null : f.after.surface.count) + ' [data-dsh-link-surface] anchor(s), not exactly one: the browser pane did not come on screen')
      else {
        if (f.after.surface.box === null || f.after.surface.box === undefined || f.after.surface.box.w <= 0 || f.after.surface.box.h <= 0) problems.push('the anchor is present with an empty rectangle: ' + show(f.after.surface.box))
        if (f.after.surface.inRail !== true) problems.push('the anchor is not inside the rail element')
        if (f.after.surface.inWindow !== true) problems.push('the anchor rectangle ' + show(f.after.surface.box) + ' is not inside the window own visible area ' + show(f.after.viewport))
        if (f.after.surface.checkVisibility !== true) problems.push('the anchor element reports it is not visible (checkVisibility ' + show(f.after.surface.checkVisibility) + ')')
      }
      // ONE PRESS MUST MOVE THE PROVIDER OWN COUNT BY EXACTLY ONE. The count is per page, so the reading is the delta
      // across this gate's own press, read on both sides of it - not an absolute 1, which a second gate run in the same
      // page could never satisfy.
      const asked = invokeCount(f.afterProvider)
      const askedBefore = invokeCount(f.beforeProvider)
      if (asked === null || askedBefore === null) problems.push('the provider own marker was not in the page on BOTH sides of the press, so how far its action count moved cannot be read')
      else {
        const moved = asked - askedBefore
        if (moved !== 1) problems.push('the provider own count of asks moved by ' + String(moved) + ' across one press (' + String(askedBefore) + ' -> ' + String(asked) + '), and one press must call the action exactly once: ' + show(f.afterProvider))
        const last = f.afterProvider === null || f.afterProvider.lastInvoke === undefined ? null : f.afterProvider.lastInvoke
        if (last === null || last === undefined) problems.push('the provider own marker holds no record of what the press did (lastInvoke is absent)')
        else {
          if (last.ok !== true) problems.push('the provider own record says the press FAILED: ' + show(last))
          if (last.kind !== f.provider.tabKind) problems.push('the provider own record says the press opened kind=' + show(last.kind) + ' while the tab type it registered is kind=' + show(f.provider.tabKind))
        }
      }
      return problems.length === 0
        ? OK('the row was pressed ONCE through CDP mouse input at ' + show({ x: click.x, y: click.y }) + ' (box ' + show(click.box) + '); the provider own count of asks moved by exactly one across that press (' + String(invokeCount(f.beforeProvider)) + ' -> ' + String(invokeCount(f.afterProvider)) + ') and answers ' + show(f.afterProvider === null ? null : f.afterProvider.lastInvoke) + '; and the rail followed it: the browser chip ' + show(f.after.browserChip === null ? null : f.after.browserChip.title) + ' is now the selected tab (' + show(f.after.selected) + ') with exactly one [data-dsh-link-surface="true"] anchor at ' + show(f.after.surface === null ? null : f.after.surface.box) + ' inside the rail ' + show(f.after.rail) + ' - before the press the rail was on ' + show(f.before === undefined || f.before === null ? null : f.before.selected) + ' with ' + String(f.before === undefined || f.before === null ? null : f.before.surfaceCount) + ' anchor(s)')
        : BAD('press-did-not-open-the-browser-pane', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '6-the-action-row-and-the-browser-pane-are-on-screen-with-pixels',
    judge: (t) => {
      const f = factsOf(t)
      if (f.row === null) return NOT_MEASURED('no-row', 'NOT MEASURED: no drawn row carries the id the provider declares (' + show(f.provider.id) + '), so there is no rectangle to capture')
      if (f.after === null || f.after === undefined || f.after.surface === undefined || f.after.surface === null) return NOT_MEASURED('no-anchor', 'NOT MEASURED: no anchor was read after the press, so the browser pane own rectangle cannot be captured')
      const problems = []
      if (f.row.box === null || f.row.box === undefined || f.row.box.w <= 0 || f.row.box.h <= 0) problems.push('the action row own rectangle is empty: ' + show(f.row.box))
      if (f.row.checkVisibility !== true) problems.push('the action row own element reports it is not visible (checkVisibility ' + show(f.row.checkVisibility) + ')')
      if (f.row.inRail !== true) problems.push('the action row is not inside the rail element: row ' + show(f.row.box) + ' against rail ' + show(f.pane.rail))
      if (f.row.titleBox === null || f.row.titleBox === undefined || f.row.titleBox.w <= 0 || f.row.titleBox.h <= 0) problems.push('the button own rectangle is empty: ' + show(f.row.titleBox))
      if (f.row.inWindow !== true) return NOT_MEASURED('row-out-of-the-window', 'NOT MEASURED: the action row is drawn at ' + show(f.row.box) + ' which is not inside the window own visible area (' + show(f.pane.viewport) + '); this gate may not scroll the rail, so it cannot capture it and it could not press it: ' + problems.join(' | '))
      const dpr = f.pane.dpr === undefined ? 1 : f.pane.dpr
      const wantRow = [Math.round(f.row.box.w * dpr), Math.round(f.row.box.h * dpr)]
      const wantButton = [Math.round(f.row.titleBox.w * dpr), Math.round(f.row.titleBox.h * dpr)]
      if (f.shotRow === null || f.shotRow.ok !== true) problems.push('the action row could not be captured: ' + show(f.shotRow === null ? null : f.shotRow.why))
      else {
        if (f.shotRow.width !== wantRow[0] || f.shotRow.height !== wantRow[1]) problems.push('the row capture is ' + String(f.shotRow.width) + 'x' + String(f.shotRow.height) + ' while the row rectangle at devicePixelRatio ' + String(dpr) + ' is ' + String(wantRow[0]) + 'x' + String(wantRow[1]))
        if (f.shotRow.nonBlank <= 0) problems.push('the action row own rectangle is blank: ' + String(f.shotRow.nonBlank) + ' non-background pixel(s) in ' + String(f.shotRow.width) + 'x' + String(f.shotRow.height))
      }
      if (f.shotButton === null || f.shotButton.ok !== true) problems.push('the button could not be captured: ' + show(f.shotButton === null ? null : f.shotButton.why))
      else {
        if (f.shotButton.width !== wantButton[0] || f.shotButton.height !== wantButton[1]) problems.push('the button capture is ' + String(f.shotButton.width) + 'x' + String(f.shotButton.height) + ' while the button rectangle at devicePixelRatio ' + String(dpr) + ' is ' + String(wantButton[0]) + 'x' + String(wantButton[1]))
        if (f.shotButton.nonBlank <= 0) problems.push('the button own rectangle is blank: ' + String(f.shotButton.nonBlank) + ' non-background pixel(s)')
      }
      const anchor = f.after.surface.box
      if (anchor === null || anchor === undefined || anchor.w <= 0 || anchor.h <= 0) return NOT_MEASURED('anchor-empty', 'NOT MEASURED: the anchor after the press has no rectangle to capture: ' + show(anchor))
      const wantAnchor = [Math.round(anchor.w * dpr), Math.round(anchor.h * dpr)]
      if (f.shotAnchor === null || f.shotAnchor.ok !== true) problems.push('the anchor could not be captured: ' + show(f.shotAnchor === null ? null : f.shotAnchor.why))
      else if (f.shotAnchor.width !== wantAnchor[0] || f.shotAnchor.height !== wantAnchor[1]) problems.push('the anchor capture is ' + String(f.shotAnchor.width) + 'x' + String(f.shotAnchor.height) + ' while the anchor rectangle at devicePixelRatio ' + String(dpr) + ' is ' + String(wantAnchor[0]) + 'x' + String(wantAnchor[1]))
      return problems.length === 0
        ? OK('the action row is on screen at ' + show(f.row.box) + ' inside the rail ' + show(f.pane.rail) + ' and the window ' + show(f.pane.viewport) + '; its crop is ' + String(f.shotRow.width) + 'x' + String(f.shotRow.height) + ' device pixel(s) with ' + String(f.shotRow.nonBlank) + ' non-background pixel(s) (mean ' + String(f.shotRow.mean) + ', spread ' + String(f.shotRow.spread) + ', background ' + show(f.shotRow.background) + '); the BUTTON inside it is at ' + show(f.row.titleBox) + ' and its own crop is ' + String(f.shotButton.width) + 'x' + String(f.shotButton.height) + ' with ' + String(f.shotButton.nonBlank) + ' non-background pixel(s); after the press the browser pane anchor is at ' + show(anchor) + ' and its own crop is ' + String(f.shotAnchor.width) + 'x' + String(f.shotAnchor.height) + ' with ' + String(f.shotAnchor.nonBlank) + ' non-background pixel(s) (a child webview draws over that rectangle in the real window, so its ink is reported, not required)')
        : BAD('row-not-drawn-with-pixels', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '7-the-world-was-put-back-with-the-active-world-panel',
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
        if (exitRail.surfaceCount !== entryRail.surfaceCount) problems.push('the number of sidebar surface anchors moved: ' + String(entryRail.surfaceCount) + ' -> ' + String(exitRail.surfaceCount))
        if (exitRail.paneCount !== entryRail.paneCount) problems.push('the number of panes on screen moved: ' + String(entryRail.paneCount) + ' -> ' + String(exitRail.paneCount))
        // R278: the door is only judged when THIS WORLD offers a way to open it again (see `guideUnreachable` below).
        const doorUnreachable = t.restore !== null && t.restore !== undefined && t.restore.guideUnreachable !== undefined && t.restore.guideUnreachable !== null
        if (doorUnreachable !== true && exitRail.guideOpen !== entryRail.guideOpen) problems.push('the guide is ' + show(exitRail.guideOpen) + ' at exit while it was ' + show(entryRail.guideOpen) + ' at entry')
      }
      if (t.restore === null || t.restore === undefined || t.restore.leaseReleased !== true) problems.push('the lease was not given back')
      if (t.exit !== null && t.exit !== undefined && t.exit.lease !== null && t.exit.lease !== undefined && t.exit.lease.held === true) problems.push('the lease is held at exit: ' + show(t.exit.lease))
      if (t.restore === null || t.restore === undefined || t.restore.ourTabClosed !== true) problems.push('the tab this gate opened was left open: ' + show(t.restore === null || t.restore === undefined ? null : t.restore.ourTabClosed))
      // R278: opening a capsule REPLACES the guide page with the tab it opened, and this world's tab strip exposes no
      // add control ("the rail offers no [data-dockkit-add-tab]"), so once the guide chip is gone there is nothing
      // left to click. The gate tried both routes and recorded both; a world that offers no door must not be
      // reported as a product that fails to close it, so this becomes the reading's own third state.
      const guideUnreachable = t.restore !== null && t.restore !== undefined && t.restore.guideUnreachable !== undefined && t.restore.guideUnreachable !== null
      if (guideUnreachable !== true && (t.restore === null || t.restore === undefined || t.restore.guideBack !== true)) problems.push('the door this gate used (the guide) was not put back: ' + show(t.restore === null || t.restore === undefined ? null : t.restore.guideBack))
      if (t.restore === null || t.restore === undefined || t.restore.entryTabReselected !== true) problems.push('the entry tab was not reselected: ' + show(t.restore === null || t.restore === undefined ? null : t.restore.entryTabReselected))
      // THE ACTIVE WORLD. The press may have let the page host mount the native panel; if it did, this gate must
      // have taken it back down and read that it went. A panel left standing is the one thing R181 and R193 say
      // must not happen, because the next live gate would be judging a world a press moved.
      const native = t.drive === null || t.drive === undefined || t.drive.nativePanel === undefined ? null : t.drive.nativePanel
      const closed = t.restore === null || t.restore === undefined || t.restore.panelClosed === undefined ? null : t.restore.panelClosed
      const exitPanel = t.exit === null || t.exit === undefined ? null : t.exit.panel
      const entryPanel = t.entry === null || t.entry === undefined ? null : t.entry.panel
      if (exitPanel !== null && exitPanel !== undefined && exitPanel.exists === true) problems.push('a native panel is open at exit: ' + show(exitPanel))
      if (closed !== null && closed !== undefined && closed.before === true && closed.stillThere !== false) problems.push('the native panel was open before the restore and is not shown to be closed: ' + show(closed))
      if (same(entryPanel, exitPanel) !== true) problems.push('the panel own numbers moved: entry ' + show(entryPanel) + ' exit ' + show(exitPanel))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.client !== t.exit.client) problems.push('the desktop client changed: ' + show(t.entry === null || t.entry === undefined ? null : t.entry.client) + ' -> ' + show(t.exit === null || t.exit === undefined ? null : t.exit.client))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.status === null || t.exit.status === null || t.entry.status.pid !== t.exit.status.pid) problems.push('the kernel pid changed: ' + show(t.entry === null || t.entry === undefined || t.entry.status === null ? null : t.entry.status.pid) + ' -> ' + show(t.exit === null || t.exit === undefined || t.exit.status === null ? null : t.exit.status.pid))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(t.entry.manifest, t.exit.manifest) !== true) problems.push('the manifest changed under this gate: entry ' + show(t.entry === null || t.entry === undefined ? null : t.entry.manifest) + ' exit ' + show(t.exit === null || t.exit === undefined ? null : t.exit.manifest))
      // The routes carry a per-request counter and a timestamp (measured by gate 126: the served counter grows on
      // every GET), so what is compared is what the route DECLARES, not the envelope this gate own reads move.
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(stableRoute(t.entry.routes === undefined ? null : t.entry.routes.panel), stableRoute(t.exit.routes === undefined ? null : t.exit.routes.panel)) !== true) problems.push('the live registry changed under this gate: entry ' + show(stableRoute(t.entry === null || t.entry === undefined || t.entry.routes === undefined ? null : t.entry.routes.panel)) + ' exit ' + show(stableRoute(t.exit === null || t.exit === undefined || t.exit.routes === undefined ? null : t.exit.routes.panel)))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(stableLedger(t.entry.routes === undefined ? null : t.entry.routes.notes), stableLedger(t.exit.routes === undefined ? null : t.exit.routes.notes)) !== true) problems.push('the live ledger changed under this gate')
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.gitStatus === null || t.exit.gitStatus === null || t.entry.gitStatus.ok !== true || t.exit.gitStatus.ok !== true) problems.push('git status could not be read on one side: ' + show({ entry: t.entry === null || t.entry === undefined || t.entry.gitStatus === null ? null : t.entry.gitStatus.why === undefined ? null : t.entry.gitStatus.why, exit: t.exit === null || t.exit === undefined || t.exit.gitStatus === null ? null : t.exit.gitStatus.why === undefined ? null : t.exit.gitStatus.why }))
      else if (t.entry.gitStatus.text !== t.exit.gitStatus.text) {
        // R191 section 3: a world moved by somebody ELSE is a named third state (the note the drive wrote, and
        // the exit code main() gives it), never a product red. What reddens THIS reading is a file this gate wrote.
        const moved = t.worldMoved === undefined || t.worldMoved === null ? { appeared: [], vanished: [], ours: [] } : t.worldMoved
        if (moved.ours.length > 0) problems.push('a file THIS GATE wrote appeared in git status --porcelain: ' + show(moved.ours))
      }
      const worldName = (row) => (row === null || row === undefined || row.world === null || row.world === undefined ? null : row.world.name)
      return problems.length === 0 && guideUnreachable === true
        ? NOT_MEASURED('door-unreachable', 'NOT MEASURED: every other part of the world was put back, but this world offers no way to reopen the guide: the chip that opened it (' + show(t.restore.guideUnreachable.chipTitle) + ') is gone from the rail and the strip exposes no add control (' + show(t.restore.guideUnreachable.addControl) + ')')
        : problems.length === 0
        ? OK('the rail is back on the tab it was left on (`' + show(t.entry === null || t.entry === undefined || t.entry.rail === null ? null : t.entry.rail.selected) + ') with the same chips ' + show(t.entry === null || t.entry === undefined || t.entry.rail === null ? null : t.entry.rail.chips.map((chip) => chip.title)) + ', the guide is back on screen through the same chip (' + show(t.restore.guideBack) + ', ' + show(t.restore.guideEntries) + ' capsule(s)), the tab this gate opened is closed (' + show(t.restore.ourTabClosed) + '), the native panel was ' + (native === null || native === undefined ? 'not read' : (native.existsBeforeClick === true ? 'open before the press' : 'never opened by the press (exists=' + show(native.existsAfterClick) + ' after it)')) + ' and exists=' + show(exitPanel === null || exitPanel === undefined ? null : exitPanel.exists) + ' at exit, the lease is given back (' + show(t.exit === null || t.exit === undefined || t.exit.lease === null ? null : t.exit.lease.held) + '), and the panel own numbers, the kernel pid, the desktop client, the manifests, both live routes and git status --porcelain are all identical before and after - the world helper names the world ' + show(worldName(t.entry)) + ' -> ' + show(worldName(t.exit)) + ' (this gate records that IT PRESSED the action this round)')
        : BAD('world-not-put-back', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '8-this-gate-only-clicked-and-never-wrote',
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
        if (read.kind === 'panel' && read.op === 'close' && read.holder !== t.holder) problems.push('a close was sent without naming this gate as the holder: ' + show(read))
        if (read.kind === 'http' && String(read.method) !== 'GET') problems.push('a non-GET request was made: ' + show(read))
      }
      const writes = (t.calls === undefined ? [] : t.calls).filter((row) => row.kind === 'file-write')
      if (writes.length > 1) problems.push('this gate wrote ' + String(writes.length) + ' file(s): ' + show(writes.map((row) => row.path)))
      for (const row of writes) if (String(row.purpose) !== 'this gate own transcript') problems.push('this gate wrote a file that is not its transcript: ' + show(row))
      return problems.length === 0
        ? OK('the only input was ' + String(inputs.length / 2) + ' left click(s) ' + show([...new Set(inputs.map((row) => row.purpose))]) + ' - and the action row itself exactly once; every page expression was a JSON.stringify of DOM/global reads; the only CDP methods were ' + show([...new Set((t.cdpCalls === undefined ? [] : t.cdpCalls).map((call) => call.method))]) + '; the only panel ops were ' + show([...new Set((t.reads === undefined ? [] : t.reads).filter((read) => read.kind === 'panel').map((read) => read.op))]) + ' (a close, if one was sent, named ' + String(t.holder) + '); every HTTP request was a GET; and the only file written was this gate own transcript (' + show(writes.length === 0 ? null : writes[0].path) + ')')
        : BAD('wrote-or-typed', 'FAIL: ' + problems.join(' | '))
    },
  },

]

const runJudges = (transcript) => READINGS.map((reading) => {
  let verdict
  try {
    verdict = reading.judge(transcript)
  } catch (error) {
    verdict = { ok: false, code: 'judge-threw', detail: 'the reading itself threw: ' + describe(error) }
  }
  return { id: reading.id, ...verdict }
})

// ---------------------------------------------------------------------------
// Self-attack: mutate the MEASURED transcript, not a fixture
// ---------------------------------------------------------------------------
//
// The comparand is the BASELINE VERDICT, not the baseline's colour: a mutant that covers a red (or a not-measured)
// reading REPAIRS its subject instead of breaking it, so the judge is shown to be falsifiable in both directions.

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
const DOOR = '2-the-panel-tab-was-opened-through-the-door-this-world-has'
const ROW = '3-the-action-row-draws-the-browser-halves-own-declared-action'
const CHROME = '4-the-chrome-before-the-click-nothing-was-opened'
const CLICK = '5-one-click-through-cdp-selected-the-browser-pane-and-the-surface-anchor'
const PIXELS = '6-the-action-row-and-the-browser-pane-are-on-screen-with-pixels'
const PUTBACK = '7-the-world-was-put-back-with-the-active-world-panel'
const AUDIT = '8-this-gate-only-clicked-and-never-wrote'

/** The row the pane reads of this transcript hold, wherever it is. */
const drawnRow = (t) => {
  const panes = [t.drive === undefined ? null : t.drive.pane2, t.drive === undefined ? null : t.drive.pane]
  for (const pane of panes) {
    if (pane === null || pane === undefined || Array.isArray(pane.rows) !== true) continue
    const id = t.provider === undefined || t.provider === null ? null : t.provider.id
    const found = pane.rows.filter((row) => row !== null && row !== undefined && (id === null || row.id === id))[0]
    if (found !== undefined) return found
  }
  return null
}

/** Whichever of the two after-reads of the provider's marker this transcript carries. */
const providerAfterMarker = (t) => {
  if (t.drive === undefined || t.drive === null) return null
  const marker = t.drive.afterMarker2 === null || t.drive.afterMarker2 === undefined ? t.drive.afterMarker : t.drive.afterMarker2
  return marker === null || marker === undefined ? null : marker
}

const MUTANTS = [
  { name: 'the-shell-is-not-ready', declared: [PREMISES], what: 'the world is not the one this gate requires', apply: (t) => { t.entry.status.phase = 'failed' } },
  { name: 'the-kernel-restarted-mid-run', declared: [PREMISES, PUTBACK], what: 'a restart under the gate: the premise moved and the world is not the one found', apply: (t) => { t.exit.status.pid = Number(t.entry.status.pid) + 1 } },
  { name: 'the-desktop-client-was-replaced', declared: [PREMISES, PUTBACK], what: 'a different desktop client answered the exit read', apply: (t) => { t.exit.client = '99999@2000-01-01T00:00:00.0000000Z' } },
  { name: 'another-live-consumer-ran-beside-us', declared: [PREMISES], what: 'two live gates on one world', apply: (t) => { t.entry.guard.others = ['pid 4242 node scripts/verify-panel-render.mjs'] } },
  { name: 'the-lease-was-never-ours', declared: [LEASE], what: 'the gate pressed a real button without owning the turn', apply: (t) => { const claim = t.drive.claims[0]; claim.action = 'claim'; claim.after = { held: false, holder: null, revokedBy: null, revokedHolder: null, revokedKind: null } } },
  { name: 'an-input-was-recorded-against-a-taken-turn', declared: [LEASE], what: 'somebody else input was recorded while this gate held the turn', apply: (t) => { const line = t.drive.leaseAfterInput.filter((row) => row.held === true)[0] === undefined ? t.drive.leaseAfterInput[0] : t.drive.leaseAfterInput.filter((row) => row.held === true)[0]; line.held = false; line.revokedBy = 'user-input'; line.revokedKind = 'pointerdown'; line.revokedHolder = t.holder } },
  { name: 'the-lease-was-left-held', declared: [LEASE, PUTBACK], what: 'a gate that walks away still holding the panel', apply: (t) => { t.restore.leaseReleased = false; t.exit.lease = { held: true, holder: t.holder, revokedBy: null, revokedHolder: null, revokedKind: null } } },
  { name: 'the-door-was-never-named', declared: [DOOR], what: 'how our tab was reached was never recorded', apply: (t) => { t.drive.door.used = null } },
  { name: 'no-door-carries-our-title', declared: [DOOR], what: 'the rail and the guide offer no capsule titled like the panel own dictionary', apply: (t) => { t.drive.door.found = false } },
  { name: 'our-chip-is-not-selected', declared: [DOOR], what: 'the panel tab exists without being the selected tab', apply: (t) => { if (t.drive.pane !== null && t.drive.pane !== undefined) t.drive.pane.chipSelected = false; if (t.drive.pane2 !== null && t.drive.pane2 !== undefined) t.drive.pane2.chipSelected = false } },
  { name: 'the-row-draws-the-browser-halves-english-title', declared: [ROW], what: 'the drawn title is the provider own en word rather than the zh one', apply: (t) => { const row = drawnRow(t); if (row !== null) row.title = t.provider.en.title } },
  { name: 'the-row-loses-its-source', declared: [ROW], what: 'a row that cannot say where it comes from', apply: (t) => { const row = drawnRow(t); if (row !== null) row.source = '' } },
  { name: 'the-row-is-drawn-with-another-kind', declared: [ROW], what: 'the row drawn as a kind its provider never declared', apply: (t) => { const row = drawnRow(t); if (row !== null) row.kind = t.provider.kind === 'action' ? 'status' : 'action' } },
  { name: 'the-row-forgets-its-invoke', declared: [ROW], what: 'a row that claims the seam holds no function for it', apply: (t) => { const row = drawnRow(t); if (row !== null) row.hasInvoke = 'false' } },
  { name: 'the-row-is-drawn-as-a-span', declared: [ROW], what: 'an action drawn as a reading rather than a button', apply: (t) => { const row = drawnRow(t); if (row !== null) { row.titleIsButton = false; row.titleTag = 'SPAN'; row.actionElPresent = false } } },
  { name: 'the-chrome-was-already-open', declared: [CHROME], what: 'the browser pane was open before the press, so the press proved nothing', apply: (t) => { t.drive.before.surfaceCount = 1; t.drive.before.surfaceBox = { x: 800, y: 86, w: 600, h: 790 } } },
  { name: 'the-browser-chip-was-already-selected', declared: [CHROME], what: 'the rail was already on the browser pane at the point the press was made', apply: (t) => { const chip = (t.drive.before.chips || []).filter((row) => row.title !== null && String(row.title).indexOf(String(t.provider.zh.tabTitle)) !== -1)[0]; if (chip !== undefined) chip.selected = true } },
  { name: 'the-provider-count-moved-before-the-press', declared: [CHROME], what: 'something asked for the action between the panel pane being drawn and the press this gate is about', apply: (t) => { const marker = t.drive.marker2 === null || t.drive.marker2 === undefined ? t.drive.marker1 : t.drive.marker2; if (marker !== null && marker !== undefined && marker.provider !== null && marker.provider !== undefined) marker.provider.invokes = (marker.provider.invokes === undefined ? 0 : marker.provider.invokes) + 5 } },
  { name: 'the-click-did-not-invoke', declared: [CLICK], what: 'a button that draws the action but never calls it', apply: (t) => { const marker = providerAfterMarker(t); if (marker !== null && marker.provider !== null && marker.provider !== undefined) marker.provider.invokes = 0 } },
  { name: 'the-click-invoked-it-twice', declared: [CLICK], what: 'one press that calls the provider twice', apply: (t) => { const marker = providerAfterMarker(t); if (marker !== null && marker.provider !== null && marker.provider !== undefined) marker.provider.invokes = 2 } },
  { name: 'the-browser-pane-was-not-selected', declared: [CLICK], what: 'the press landed nothing on the rail', apply: (t) => { if (t.drive.after2 !== null && t.drive.after2 !== undefined) t.drive.after2.browserChipSelected = false; if (t.drive.after !== null && t.drive.after !== undefined) t.drive.after.browserChipSelected = false } },
  { name: 'the-surface-anchor-never-appeared', declared: [CLICK, PIXELS], what: 'the browser pane came up with no anchor for the shell to place a panel on - and with no anchor there is no pane rectangle to capture either', apply: (t) => { for (const pane of [t.drive.after2, t.drive.after]) { if (pane !== null && pane !== undefined && pane.surface !== null && pane.surface !== undefined) { pane.surface.count = 0; pane.surface.box = null } } } },
  { name: 'the-action-was-pressed-twice', declared: [CLICK], what: 'two presses where the contract asks for exactly one', apply: (t) => { t.inputs.push({ kind: 'mouse', type: 'mousePressed', x: 900, y: 400, purpose: 'click-the-action' }); t.inputs.push({ kind: 'mouse', type: 'mouseReleased', x: 900, y: 400, purpose: 'click-the-action' }) } },
  { name: 'the-button-rectangle-is-blank', declared: [PIXELS], what: 'nothing inked where the button should be', apply: (t) => { if (t.drive.screenshots.button !== null && t.drive.screenshots.button !== undefined) t.drive.screenshots.button.nonBlank = 0 } },
  { name: 'the-action-row-left-the-rail', declared: [PIXELS], what: 'a row drawn outside the column it belongs to', apply: (t) => { const row = drawnRow(t); if (row !== null) { row.inRail = false; row.intersectsRail = false } } },
  { name: 'the-row-had-no-button-rectangle', declared: [PIXELS], what: 'an action with no rectangle of its own to press', apply: (t) => { const row = drawnRow(t); if (row !== null) row.titleBox = { x: 0, y: 0, w: 0, h: 0 } } },
  { name: 'the-rail-is-left-on-another-tab', declared: [PUTBACK], what: 'the world handed to the next gate on a different tab', apply: (t) => { const other = t.entry.rail.chips.filter((chip) => chip.title !== t.entry.rail.selected)[0]; t.exit.rail.selected = other === undefined ? null : other.title } },
  { name: 'our-tab-was-left-open', declared: [PUTBACK], what: 'a tab this gate opened and never closed', apply: (t) => { t.exit.rail.chips = t.exit.rail.chips.concat([{ id: 'tab99', title: t.panel.tabTitle, selected: false, box: { x: 1, y: 1, w: 10, h: 10 } }]) } },
  { name: 'the-guide-never-came-back', declared: [PUTBACK], what: 'the door this gate used left shut', apply: (t) => { t.restore.guideBack = false } },
  { name: 'the-native-panel-was-left-open', declared: [PUTBACK], what: 'the ACTIVE-world panel a press mounted, still standing at exit', apply: (t) => { t.exit.panel.exists = true; t.exit.panel.mounted = true } },
  { name: 'this-gate-wrote-a-tracked-file', declared: [PUTBACK, AUDIT], what: 'a gate that leaves a tracked file of its own behind: the world fingerprint and the write audit both see it', apply: (t) => { t.calls.push({ kind: 'file-write', path: '<workspace>//dsh-link/scripts/verify-panel-action-render.mjs', purpose: 'a second write' }); t.exit.gitStatus.text = String(t.exit.gitStatus.text) + '\n M dsh-link/scripts/verify-panel-action-render.mjs'; t.exit.gitStatus.lines = t.exit.gitStatus.lines.concat([' M dsh-link/scripts/verify-panel-action-render.mjs']); t.worldMoved = { appeared: [' M dsh-link/scripts/verify-panel-action-render.mjs'], vanished: [], ours: [' M dsh-link/scripts/verify-panel-action-render.mjs'], ourWrites: t.calls.filter((row) => row.kind === 'file-write').map((row) => row.path) } } },
  { name: 'a-key-event-was-sent', declared: [AUDIT], what: 'typing, which this gate may never do', apply: (t) => { t.inputs.push({ kind: 'key', type: 'keyDown', x: 0, y: 0, purpose: 'type-a-note' }); t.inputs.push({ kind: 'key', type: 'keyUp', x: 0, y: 0, purpose: 'type-a-note' }) } },
  { name: 'a-page-expression-was-not-a-read', declared: [AUDIT], what: 'an evaluate that could write the DOM', apply: (t) => { t.probes.push({ name: 'invented', purpose: 'dom-write', source: 'document.body.innerHTML = "x"' }) } },
  { name: 'a-navigating-cdp-method-was-sent', declared: [AUDIT], what: 'navigation, which this gate may never do', apply: (t) => { t.cdpCalls.push({ method: 'Page.navigate', purpose: 'go-elsewhere' }) } },
  { name: 'a-panel-op-outside-the-allowlist', declared: [AUDIT], what: 'a panel operation that is neither a read of the turn nor the restore close', apply: (t) => { t.reads.push({ kind: 'panel', op: 'open', purpose: 'open-it-myself' }) } },
  { name: 'a-close-under-another-name', declared: [AUDIT], what: 'a close that does not name this gate: somebody else hand on the panel', apply: (t) => { t.reads.push({ kind: 'panel', op: 'close', holder: 'somebody-else', purpose: 'close-it-as-them' }) } },
  { name: 'a-non-get-request-was-made', declared: [AUDIT], what: 'a write sent over HTTP', apply: (t) => { t.reads.push({ kind: 'http', method: 'POST', target: 'kernel', url: t.kernelOrigin + '/api/dsh-link-notes/add', purpose: 'write-a-note' }) } },
]

const selfAttack = (transcript) => {
  const baseline = runJudges(transcript)
  const before = new Map(baseline.map((entry) => [entry.id, signature(entry)]))
  const green = baseline.filter((entry) => entry.ok === true)
  const red = baseline.filter((entry) => entry.ok !== true)
  console.log('')
  console.log('== self-attack: ' + String(MUTANTS.length) + ' mutants over the MEASURED transcript ==')
  console.log('  baseline: ' + String(green.length) + ' green, ' + String(red.length) + ' not green (the comparand is each reading own baseline verdict, so a red reading is attacked by REPAIRING it)')
  for (const entry of red) console.log('    not green: ' + entry.id + ' -> ' + show(signature(entry)) + ' ' + clip(entry.detail, 160))
  const coverage = new Map(READINGS.map((reading) => [reading.id, 0]))
  let problems = 0
  for (const mutant of MUTANTS) {
    const copy = clone(transcript)
    mutant.apply(copy)
    const verdicts = runJudges(copy)
    const after = new Map(verdicts.map((entry) => [entry.id, signature(entry)]))
    const observed = [...after].filter((row) => before.get(row[0]) !== row[1]).map((row) => row[0])
    for (const id of mutant.declared) coverage.set(id, (coverage.get(id) === undefined ? 0 : coverage.get(id)) + 1)
    const exact = same([...observed].sort(), [...mutant.declared].sort())
    if (exact !== true) problems += 1
    console.log('  ' + (exact ? 'exact ' : 'OFF   ') + pad(mutant.name, 48) + ' declared=' + show(mutant.declared) + ' observed=' + show(observed))
    console.log('        ' + mutant.what)
    if (exact !== true) {
      const unexpected = observed.filter((id) => mutant.declared.includes(id) === false)
      const missed = mutant.declared.filter((id) => observed.includes(id) === false)
      for (const id of unexpected) console.log('        UNEXPECTED red: ' + id + ' ' + show(before.get(id)) + ' -> ' + show(after.get(id)))
      for (const id of missed) console.log('        MISSED red: ' + id + ' stayed ' + show(before.get(id)))
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
  const f = factsOf(t)
  const lines = (text) => String(text === null || text === undefined ? '(unread)' : text).split('\n')
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell ' + SHELL_ORIGIN + ' | kernel ' + KERNEL_ORIGIN + ' | CDP ' + String(CDP_PORT) + ' (the client was already running: this gate never starts, stops or rebuilds it)')
  console.log('  holder ' + String(t.holder) + ' | transcript schema ' + String(t.schema) + (t.elapsedMs === undefined ? '' : ' | elapsed ' + String(t.elapsedMs) + ' ms'))
  console.log('  the panel own dictionary ' + String(t.panel === null ? '(unread)' : t.panel.path) + ' sha256 ' + clip(String(t.panel === null ? '' : t.panel.sha256), 12) + ' | "tab.title" = ' + show(t.panel === null ? null : t.panel.tabTitle) + ' | "contrib.title" = ' + show(t.panel === null ? null : t.panel.contribHead))
  console.log('  the panel built artifact carries that title: ' + show(t.panel === null ? null : t.panel.built.carriesTitle) + ' (' + String(t.panel === null ? '(unread)' : t.panel.built.howNamed) + ')')
  console.log('  the DOM names this gate queried with are the artifact own: ' + show(t.dom === null ? null : t.dom.all))
  console.log('  the provider own bundle ' + String(t.provider === null ? '(unread)' : t.provider.bundle.path) + ' sha256 ' + clip(String(t.provider === null ? '' : t.provider.bundle.sha256), 12) + ' (' + String(t.provider === null ? '?' : t.provider.bundle.bytes) + ' bytes)')
  console.log('  the provider own declaration: id ' + show(t.provider === null ? null : t.provider.id) + ' kind ' + show(t.provider === null ? null : t.provider.kind) + ' source ' + show(t.provider === null ? null : t.provider.source) + ' order ' + show(t.provider === null ? null : t.provider.order) + ' marker ' + show(t.provider === null ? null : t.provider.marker) + ' ns ' + show(t.provider === null ? null : t.provider.ns))
  console.log('  the provider own tab type: kind ' + show(t.provider === null ? null : t.provider.tabKind) + ' id ' + show(t.provider === null ? null : t.provider.tabId) + ' | its invoke runs ' + show(t.provider === null ? null : t.provider.defineStep) + ' which calls openTab(tabType.kind): ' + show(t.provider === null ? null : t.provider.openTabCalled))
  console.log('  the provider own words: title ' + show(t.provider === null ? null : [t.provider.titleKey, t.provider.zh.title]) + ' | its "tab.title" (the chip its action selects) ' + show(t.provider === null ? null : t.provider.zh.tabTitle) + ' | en title ' + show(t.provider === null ? null : t.provider.en.title) + ' | key sets zh=' + show(t.provider === null ? null : t.provider.zh.keys) + ' en=' + show(t.provider === null ? null : t.provider.en.keys) + ' equal=' + show(t.provider === null ? null : same(Object.keys(t.provider.dictionary.zh).sort(), Object.keys(t.provider.dictionary.en).sort())))
  console.log('  ENTRY: phase=' + show(t.entry === null ? null : t.entry.status.phase) + ' kernel pid=' + show(t.entry === null ? null : t.entry.status.pid) + ' version=' + show(t.entry === null ? null : t.entry.status.version) + ' | client ' + show(t.entry === null ? null : t.entry.client) + ' | CDP target ' + show(t.entry === null ? null : t.entry.cdp.targetId))
  console.log('  ENTRY world (through .tmp/r181-owner/world.mjs read, verbatim): ' + show(t.entry === null || t.entry.world === null || t.entry.world === undefined ? null : t.entry.world.name))
  for (const line of lines(t.entry === null || t.entry.world === null || t.entry.world === undefined ? null : t.entry.world.text)) console.log('    | ' + line)
  console.log('  ENTRY rail: box ' + show(t.entry === null ? null : t.entry.rail.rail) + ' chips ' + show((t.entry === null ? [] : t.entry.rail.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' selected ' + show(t.entry === null ? null : t.entry.rail.selected) + ' guideOpen ' + show(t.entry === null ? null : t.entry.rail.guideOpen) + ' surfaceCount ' + show(t.entry === null ? null : t.entry.rail.surfaceCount) + ' paneCount ' + show(t.entry === null ? null : t.entry.rail.paneCount))
  console.log('  ENTRY panel: ' + show(t.entry === null ? null : t.entry.panel) + ' | lease ' + show(t.entry === null ? null : t.entry.lease))
  console.log('  ENTRY routes: registry kinds=' + show(t.entry === null || t.entry.routes === null ? null : (t.entry.routes.panel.body.registry === undefined ? null : t.entry.routes.panel.body.registry.kinds)) + ' declared.visible=' + show((t.entry === null || t.entry.routes === null ? [] : (t.entry.routes.panel.body.declared === undefined ? [] : t.entry.routes.panel.body.declared.visible)).map((row) => row.id + ':' + row.kind + ':' + row.title)) + ' | notes route ' + show(t.entry === null || t.entry.routes === null ? null : t.entry.routes.notes.status))
  console.log('  single-run guard: ' + String(t.entry === null ? '?' : t.entry.guard.liveFiles) + ' live gate file(s) in the register, other node processes running them: ' + String(t.entry === null ? '?' : t.entry.guard.others.length) + (t.entry !== null && t.entry.guard.others.length > 0 ? ' -> ' + t.entry.guard.others.join(' | ') : ''))
  for (const claim of t.drive === null ? [] : t.drive.claims) console.log('  lease [' + pad(claim.purpose, 44) + '] -> ' + String(claim.action) + ' status=' + String(claim.status) + ' after=' + show(claim.after === undefined ? claim.before : claim.after))
  for (const line of t.drive === null ? [] : t.drive.leaseAfterInput) console.log('    after ' + pad(line.purpose, 32) + ' status=' + String(line.status) + ' held=' + show(line.held) + ' holder=' + show(line.holder) + ' revokedBy=' + show(line.revokedBy) + ' revokedKind=' + show(line.revokedKind) + ' userInputReports=' + show(line.userInputReports))
  console.log('  the door: ' + String(t.drive === null ? null : t.drive.door.used) + (t.drive !== null && t.drive.door.walk.length > 0 ? ' | walk: ' + show(t.drive.door.walk.map((row) => row.chip + ' => guideOpen=' + row.guideOpen)) : '') + ' | the chip this gate can put the door back through: ' + show(t.drive === null || t.drive.guideChip === null ? null : t.drive.guideChip))
  console.log('  the guide offers ' + String((t.drive === null || t.drive.guide === null || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length) + ' capsule(s):')
  for (const row of (t.drive === null || t.drive.guide === null || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries)) console.log('    kind=' + pad(show(row.kind), 14) + ' title=' + pad(show(row.titleText), 22) + ' description=' + pad(clip(show(row.descriptionText), 30), 32) + ' box=' + show(row.box) + ' glyph=' + show(row.hasGlyph))
  console.log('  our capsule: ' + show(t.drive === null || t.drive.entry === null ? null : { kind: t.drive.entry.kind, title: t.drive.entry.titleText, box: t.drive.entry.box, clickedAt: t.drive.capsuleClick }) + ' | shape ' + String(t.drive === null ? null : t.drive.shape))
  console.log('  the panel tab: chip=' + show(t.drive === null || t.drive.pane2 === null || t.drive.pane2 === undefined ? null : t.drive.pane2.chip) + ' titleSeat=' + show(t.drive === null || t.drive.pane2 === null || t.drive.pane2 === undefined ? null : t.drive.pane2.titleSeatText) + ' selected=' + show(t.drive === null || t.drive.pane2 === null || t.drive.pane2 === undefined ? null : t.drive.pane2.chipSelected))
  console.log('    body ' + show(f.pane === null || f.pane === undefined ? null : f.pane.body) + ' rail=' + show(f.pane === null || f.pane === undefined ? null : f.pane.rail))
  console.log('    the contribution section the seam draws: ' + show(f.pane === null || f.pane === undefined ? null : f.pane.contributed))
  for (const row of f.rows) console.log('    CONTRIBUTED ROW: id=' + show(row.id) + ' kind=' + show(row.kind) + ' source=' + show(row.source) + ' hasInvoke=' + show(row.hasInvoke) + ' box=' + show(row.box) + ' line=' + show(row.line))
  for (const row of f.rows) {
    console.log('      title   ' + show(row.title) + ' at ' + show(row.titleBox) + ' drawn as <' + String(row.titleTag) + ' type=' + show(row.titleType) + '> (' + String(row.titleLength) + ' chars, action element ' + show(row.actionElPresent) + ' at ' + show(row.actionElBox) + ')')
    console.log('      meta    ' + show(row.meta) + ' | body ' + show(row.body) + ' | invoke failure line ' + show(row.error) + ' (' + String(row.errorCount) + ')')
    console.log('      drawn   checkVisibility=' + show(row.checkVisibility) + ' inRail=' + show(row.inRail) + ' intersectsRail=' + show(row.intersectsRail) + ' inWindow=' + show(row.inWindow) + ' attributes=' + show(row.attributes))
  }
  console.log('  pixels before the press: row ' + show(t.drive === null ? null : t.drive.screenshots.row))
  console.log('  pixels before the press: BUTTON ' + show(t.drive === null ? null : t.drive.screenshots.button))
  console.log('  pixels before the press: rail ' + show(t.drive === null ? null : t.drive.screenshots.beforePane))
  console.log('  THE PRESS: ' + show(t.drive === null ? null : t.drive.actionClick))
  console.log('  the chrome BEFORE the press: ' + show(t.drive === null || t.drive.before === null || t.drive.before === undefined ? null : { selected: t.drive.before.selected, chips: t.drive.before.chips.map((chip) => chip.title + (chip.selected ? '*' : '')), surfaceCount: t.drive.before.surfaceCount, surfaceBox: t.drive.before.surfaceBox, paneCount: t.drive.before.paneCount, guideOpen: t.drive.before.guideOpen }))
  console.log('    the shell own panel before the press: ' + show(t.drive === null ? null : t.drive.beforeState))
  console.log('    the provider own marker before the press: ' + show(t.drive === null || t.drive.beforeMarker === null || t.drive.beforeMarker === undefined ? null : t.drive.beforeMarker.provider))
  console.log('  the rail AFTER the press: selected ' + show(t.drive === null || t.drive.after2 === null || t.drive.after2 === undefined ? null : t.drive.after2.selected) + ' chips ' + show((t.drive === null || t.drive.after2 === null || t.drive.after2 === undefined ? [] : t.drive.after2.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' browserChip=' + show(t.drive === null || t.drive.after2 === null || t.drive.after2 === undefined ? null : { title: (t.drive.after2.browserChip || {}).title, selected: t.drive.after2.browserChipSelected }))
  console.log('    the surface anchor: ' + show(t.drive === null || t.drive.after2 === null || t.drive.after2 === undefined ? null : t.drive.after2.surface) + ' rail=' + show(t.drive === null || t.drive.after2 === null || t.drive.after2 === undefined ? null : t.drive.after2.rail))
  console.log('    the shell own panel after the press: ' + show(t.drive === null ? null : t.drive.afterState))
  console.log('    the provider own marker after the press: ' + show(t.drive === null || t.drive.afterMarker2 === null || t.drive.afterMarker2 === undefined ? null : t.drive.afterMarker2.provider))
  console.log('    the two looks ' + String(t.drive === null || t.drive.settle === null || t.drive.settle === undefined ? '?' : t.drive.settle.ms) + ' ms apart: anchor ' + show(t.drive === null || t.drive.settle === null || t.drive.settle === undefined ? null : t.drive.settle.anchorFirst) + ' -> ' + show(t.drive === null || t.drive.settle === null || t.drive.settle === undefined ? null : t.drive.settle.anchorSettled) + ', invokes ' + show(t.drive === null || t.drive.settle === null || t.drive.settle === undefined ? null : t.drive.settle.invokesFirst) + ' -> ' + show(t.drive === null || t.drive.settle === null || t.drive.settle === undefined ? null : t.drive.settle.invokesSettled))
  console.log('  pixels after the press: anchor ' + show(t.drive === null ? null : t.drive.screenshots.anchor) + ' | browser chip ' + show(t.drive === null ? null : t.drive.screenshots.chip))
  console.log('  the markers beside the panel pane: __dshLinkPanel keys ' + show(f.markerKeys) + ' contributed ' + show(f.markerContributed))
  for (const step of t.restore === null ? [] : t.restore.steps) console.log('  restore: ' + step)
  console.log('  EXIT rail: chips ' + show((t.exit === null || t.exit.rail === null ? [] : t.exit.rail.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' selected ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.selected) + ' surfaceCount ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.surfaceCount) + ' guideOpen ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.guideOpen) + ' paneCount ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.paneCount))
  console.log('  EXIT panel: ' + show(t.exit === null ? null : t.exit.panel) + ' | lease ' + show(t.exit === null ? null : t.exit.lease) + ' | client ' + show(t.exit === null ? null : t.exit.client) + ' | git status lines ' + String(t.exit === null || t.exit.gitStatus === null ? '?' : t.exit.gitStatus.lines.length))
  console.log('  EXIT world (through .tmp/r181-owner/world.mjs read, verbatim): ' + show(t.exit === null || t.exit.world === null || t.exit.world === undefined ? null : t.exit.world.name))
  for (const line of lines(t.exit === null || t.exit.world === null || t.exit.world === undefined ? null : t.exit.world.text)) console.log('    | ' + line)
  console.log('  the file this gate wrote: ' + show(t.write === undefined ? null : t.write.path) + ' (' + String(t.write === undefined ? '?' : t.write.bytes) + ' bytes, inside the git-ignored scratch path ' + String(t.write === undefined ? '?' : t.write.insideScratch) + ')')
  console.log('  NOT MEASURED HERE (named): whether the native browser renders anything inside the anchor (this gate captures the PAGE own pixels, not a child webview own); a SECOND press of the same row (the contract asks for exactly one); the action own word in any locale other than the one the dictionaries are read from; whether the panel catches an invoke that THROWS (gate 127 own subject - this provider never throws); whether the other six client halves declare actions; what the panel row does while the page host is not standing down (this gate holds the lease throughout)')
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
  console.log('gate 129 panel-action-render - what ONE press of a declared action row does to the live rail (shell ' + SHELL_ORIGIN + ', kernel ' + KERNEL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  single run only: this gate opens the LINK panel, presses the action dsh-browser declared once, and puts the rail, the door, the lease and the world back')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const read = readJson(resolve(REPLAY_PATH))
    if (read.ok !== true) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + resolve(REPLAY_PATH) + ' (' + read.why + ')')
      return 3
    }
    transcript = read.value
    if (transcript === null || transcript === undefined || transcript.schema !== SCHEMA || transcript.entry === undefined || transcript.provider === undefined || transcript.inputs === undefined) {
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
      console.log('panel-action-render: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
      return 3
    } finally {
      if (bag.cdp !== null && bag.cdp !== undefined) bag.cdp.close()
    }
    transcript.elapsedMs = Date.now() - started
    if ((transcript.problems === undefined ? [] : transcript.problems).length === 0) writeTranscript(transcript)
  }
  const problems = transcript.problems === undefined ? [] : transcript.problems
  const worldMoved = (transcript.notes === undefined ? [] : transcript.notes).filter((note) => String(note).startsWith('NOT MEASURED in the world'))
  // The tree is shared with other authors, and nothing this gate's subject depends on lives in it: a TRACKED file this
  // gate wrote is reading 7's red (it writes only its git-ignored transcript), while somebody else's file is recorded
  // and printed, never turned into a verdict about the rail. A world that genuinely moved under this gate - a lease
  // taken away, a tab gone, a process replaced - is caught by readings 0/1/7 out of their own readings.
  const stopped = problems.length > 0
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
    if (stopped) {
      console.log('panel-action-render: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a drive that did not reach the end or a world that moved')
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('panel-action-render --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED') + ', ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured')
    return attack === 0 ? (failed.length > 0 ? 1 : notMeasured.length > 0 ? 3 : 0) : 1
  }
  console.log('panel-action-render: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live shell at ' + SHELL_ORIGIN + '; clicks ' + String((transcript.inputs === undefined ? [] : transcript.inputs).length / 2) + ', of which the action row ' + String((transcript.inputs === undefined ? [] : transcript.inputs).filter((row) => row.type === 'mousePressed' && row.purpose === ACTION_PURPOSE).length) + ', kernel GETs ' + String((transcript.reads === undefined ? [] : transcript.reads).filter((read) => read.kind === 'http' && read.target === 'kernel').length) + ', panel ops ' + show([...new Set((transcript.reads === undefined ? [] : transcript.reads).filter((read) => read.kind === 'panel').map((read) => read.op))]) + ', model rounds 0]')
  if (stopped) {
    for (const problem of problems) console.log('SKIP: ' + problem)
    for (const note of worldMoved) console.log('note (recorded, not a verdict): ' + note)
    console.log('panel-action-render: ' + 'the drive could not be carried to the end' + ', so nothing above is a verdict on the product [exit 3]')
    return 3
  }
  if (failed.length > 0) return 1
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
    console.log('panel-action-render: a reading could not be measured, so this is a named third state, not a verdict on the product [exit 3]')
    return 3
  }
  return 0
}

process.exitCode = await main()
