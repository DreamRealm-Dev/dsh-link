#!/usr/bin/env node
/**
 * Gate 128 (R192) - panel-contribution-render: WHAT ANOTHER PACKAGE'S CONTRIBUTION LOOKS LIKE DRAWN.
 *
 * Subject: the contribution seam R192 opened in plugins/dsh-link-panel (P1: ctx.provide('linkPanel',
 * { declare, entries })) and the one real provider this round has (P2: plugins/dsh-lan-bridge, whose
 * hand-written client bundle declares ONE kind:'status' connection item, id 'dsh-lan-bridge:connection').
 * Written from the R192 contract, from gate 126's world shape, and from the LIVE DOM - never from the
 * source comments of the thing it judges.
 *
 * WHY THIS GATE EXISTS. R192 delivered a seam (an item goes IN) and gate 127 judged it offline: the four
 * refusals, the order independence, the disposer, the marker gaining a field without moving a byte of the
 * old one. None of that is a drawn word. This gate is the other half of the sentence: the item was handed
 * in, so WHAT DID THE PANEL ACTUALLY PAINT FOR IT - the row, the title, the source, the kind, the body,
 * and is any of it on screen with ink in it.
 *
 * WHAT IT DOES (and what it is allowed to do)
 *   - premises first, self-witnessed: the three ports answer, the shell's own status says phase=ready, the
 *     kernel pid and the desktop client's pid@start-time are the same before and after, the two kernel
 *     routes the pane draws from answer 200, and the single-run guard sees no other registered live gate
 *     running (it reads the register, never writes it).
 *   - it OWNS the panel the R153 way: claim the lease (scripts/panel-lease.mjs) before touching anything,
 *     re-read the lease after every click, release it in the restore step. Claimed FIRST on purpose: the
 *     page host stands down while it is held, so selecting a rail tab during the walk cannot make the host
 *     open the native panel behind this gate, and R179's lesson - an input that lands while somebody else
 *     owns the turn is recorded against THEM.
 *   - it reaches its tab through the door the world ACTUALLY has (gate 126's shape): a tab type with
 *     priority:'extension' is not a chip in the rail's strip, it is a capsule on the guide page, reached
 *     through the guide's own chip or the strip's add control. This gate reports WHICH door it used, the
 *     rail's real tab list and the guide's real capsule list, and declines BY NAME when there is no door.
 *   - THE EXPECTED WORDS ARE THE PROVIDER'S OWN, READ AS DATA, EVERY RUN. The item's id, kind, source,
 *     order, the marker it writes its own answer into, its locale namespace, the dictionary keys its own
 *     code names, and both dictionaries are PARSED out of plugins/dsh-lan-bridge/lib/client.js - the very
 *     bytes the live page runs (that half is a hand-written bundle; nothing rebuilds it). The panel's own
 *     dictionary (the chip text, the meta template around each row) is parsed out of its own locales.ts,
 *     and the data-attribute names the pane draws rows with are parsed out of the panel's BUILT artifact.
 *     Nothing in this file is the string it compares against: a word copied into a gate is how a gate lies.
 *   - the ONLY input it sends is left mouse press/release: selecting the guide, selecting its own capsule,
 *     and the restore clicks (guide back, its own tab closed, the entry tab reselected). No key events, no
 *     typing, no navigation, no DOM write, no scroll: every Runtime.evaluate it sends is an expression
 *     whose whole body is a JSON.stringify of DOM/global reads, recorded verbatim and audited by reading 8.
 *   - it never starts, stops or rebuilds the client, never writes the live archive, never takes a model turn.
 *
 * THE READINGS (each independently failable; a reading that cannot be measured is the NAMED third state)
 *   0-premises-ports-ready-and-the-same-two-processes
 *   1-the-panel-lease-was-ours-before-every-input
 *   2-our-tab-was-reached-through-the-door-this-world-has
 *   3-the-contributed-row-draws-the-providers-own-identity-and-title
 *   4-the-row-body-is-a-reading-and-not-the-arrival-placeholder
 *   5-the-row-and-its-body-are-on-screen-with-pixels
 *   6-the-marker-was-not-polluted-and-carries-the-contribution
 *   7-the-world-was-put-back
 *   8-this-gate-only-clicked-and-never-wrote
 *
 * READING 4 IS THE ONE WITH A THIRD STATE. The row's body is a reading: non-empty, not the bare "0" the
 * provider's own README refuses, and NOT the provider's own word for "the reading has not arrived yet".
 * That word is allowed ONLY when the world itself has nothing to say - and the world's own answer is the
 * witness, read in the SAME page step: globalThis.<provider marker>.body, which the provider rewrites on
 * every store change. Both sides saying "not arrived yet" is the NAMED third state (data, not a defect).
 * The row saying "not arrived yet" while the provider answers otherwise is a FAIL, and the two strings are
 * printed. WHAT THIS GATE CANNOT SAY: it cannot say the drawn body is FRESH at every instant - a reading
 * that arrived after the last projection is a race this gate does not time. What it does say is whether
 * the words on screen are the words the provider itself answers at the same moment.
 *
 * Exit 0 every reading held | 1 a reading failed | 3 a named third state (a premise this world does not
 * meet, a reading that could not be measured, or a world that moved under the gate).
 *
 * Usage: node scripts/verify-panel-contribution-render.mjs [--port 31761] [--kernel-port 31760]
 *        [--cdp-port 9222] [--holder gate-r192-panel-contribution-render-<pid>] [--out <transcript.json>]
 *        [--replay <transcript.json>] [--self-attack]
 *   --replay   judges a transcript this gate wrote, with ZERO operations: no fetch, no CDP, no pwsh, no click.
 *   --self-attack  mutates the MEASURED transcript in memory and asks, for every mutant, which readings its
 *                  verdict MOVED - and requires that set to be exactly the set the mutant declared. The
 *                  baseline is this round's own transcript, which may itself carry a red reading (reading 4
 *                  is red in a world whose provider answers while its row does not): the attack therefore
 *                  compares each mutant with the BASELINE VERDICT rather than requiring a green baseline,
 *                  and the mutant that covers a red reading REPAIRS its subject instead of breaking it.
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
const HOLDER = String(option('--holder', 'gate-r192-panel-contribution-render-' + String(process.pid)))
const LEASE_TTL_MS = 180000

const SCRATCH_DIR = join(PROJECT, '.tmp', 'r192-g128')
/** The panel's own copy: the chip text the guide capsule is titled with, and the meta line around every row. */
const PANEL_DICTIONARY_PATH = join(PROJECT, 'plugins', 'dsh-link-panel', 'src', 'client', 'locales.ts')
/** The artifact the page runs for the panel half: it carries the data-attribute names this gate reads rows with. */
const PANEL_BUILT_PATH = join(PROJECT, 'plugins', 'dsh-link-panel', 'lib', 'client.js')
/** The provider half: a HAND-WRITTEN bundle (nothing rebuilds it), so it is both the source and the artifact. */
const PROVIDER_BUNDLE_PATH = join(PROJECT, 'plugins', 'dsh-lan-bridge', 'lib', 'client.js')
const PANEL_STATE_PATH = '/api/dsh-link-panel/state'
const NOTES_STATE_PATH = '/api/dsh-link-notes/state'
const MANIFEST_PATHS = [
  join(PROJECT, 'pack', 'pack.json'),
  join(PROJECT, 'plugins', 'dsh-link-panel', 'cordis.patch.yml'),
  join(PROJECT, 'plugins', 'dsh-lan-bridge', 'cordis.patch.yml'),
]

/** The seat's own DOM contract, measured by gate 126 and reused here as the instrument it is. */
const SEL_RAIL = '[data-rightbar-col]'
const SEL_CHIP = '[role=tab][data-dockkit-tab]'
const SEL_CHIP_TITLE = '[data-dockkit-tab-title]'
const SEL_CHIP_CLOSE = 'button[data-dockkit-tab-close]'
const SEL_GUIDE = '[data-sidebar-right-guide]'
const SEL_GUIDE_ENTRY = '[data-sidebar-right-guide-entry]'
const SEL_ADD_CONTROL = 'button[data-dockkit-add-tab]'
const SEL_SURFACE = '[data-dsh-link-surface]'
/** The purposes an input of this gate may have. Nothing else may be clicked. */
const INPUT_PURPOSES = Object.freeze(['select-guide', 'select-our-tab', 'restore-guide', 'restore-select-our-tab', 'restore-close-our-tab', 'restore-entry-tab'])
const WALK_PURPOSE = (title) => 'walk-chip:' + String(title)
const CDP_METHODS = Object.freeze(['Runtime.evaluate', 'Page.captureScreenshot', 'Input.dispatchMouseEvent'])
const PANEL_OPS = Object.freeze(['state', 'lease'])
/** How long the gate waits for the drawn body to move before it takes its second read. */
const SETTLE_MS = 2500

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
  const SELF = 'verify-panel-contribution-render.mjs'
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
// The panel's own copy, and the attribute names its artifact draws with
// ---------------------------------------------------------------------------

/** Read a \`export const zh = { ... }\` block out of a client-half source. Copied values are how a gate lies. */
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

/** The panel's own words: the chip text (which is also the guide capsule's title) and the row meta template. */
const readPanelDictionary = () => {
  const zh = readZhBlock(PANEL_DICTIONARY_PATH)
  const title = zh.table['tab.title']
  const meta = zh.table['item.meta']
  const contribHead = zh.table['contrib.title']
  if (typeof title !== 'string' || title === '') throw new NotMeasured('the panel zh dictionary carries no "tab.title" value')
  if (typeof meta !== 'string' || meta === '') throw new NotMeasured('the panel zh dictionary carries no "item.meta" value')
  if (typeof contribHead !== 'string' || contribHead === '') throw new NotMeasured('the panel zh dictionary carries no "contrib.title" value')
  return { path: zh.path, sha256: zh.sha256, keys: Object.keys(zh.table).length, title, meta, contribHead, table: zh.table }
}

/** What the artifact the page runs carries: the chip text, in its literal or its escaped form (gate 126's rule). */
const readPanelBuilt = (title) => {
  const digest = fileDigest(PANEL_BUILT_PATH)
  if (digest.exists !== true) return { ...digest, carriesTitle: null, howNamed: 'the built artifact is not there' }
  const text = readFileSync(PANEL_BUILT_PATH, 'utf8')
  let escaped = ''
  for (const character of title) {
    const code = character.codePointAt(0)
    escaped += code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : character
  }
  const lowered = text.replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => '\\u' + String(hex).toLowerCase())
  const literal = text.includes(title)
  const asEscape = escaped !== title && lowered.includes(escaped)
  return { ...digest, carriesTitle: literal || asEscape, howNamed: literal ? 'literal' : asEscape ? 'escaped as ' + escaped : 'absent from the built bytes' }
}

/**
 * The data attributes the pane draws a contributed row with, out of the panel's BUILT artifact.
 *
 * This gate does not transcribe them: the names it queries with are the names the bytes the page runs
 * declare, so an attribute that moves is a NAMED third state here rather than a silent empty query.
 */
const readContributionDomNames = () => {
  const digest = fileDigest(PANEL_BUILT_PATH)
  if (digest.exists !== true) throw new NotMeasured('the panel built artifact this gate reads its DOM names out of is not there: ' + PANEL_BUILT_PATH)
  const text = readFileSync(PANEL_BUILT_PATH, 'utf8')
  const all = new Set()
  for (const match of text.matchAll(/"(data-panel-[a-z-]+)":/g)) all.add(match[1])
  const need = {
    paneBody: 'data-panel-tab',
    titleSeat: 'data-panel-title',
    empty: 'data-panel-empty',
    section: 'data-panel-contributed',
    list: 'data-panel-contributed-list',
    head: 'data-panel-contributed-head',
    row: 'data-panel-contributed-row',
    kind: 'data-panel-contributed-kind',
    source: 'data-panel-contributed-source',
    title: 'data-panel-contributed-title',
    meta: 'data-panel-contributed-meta',
    body: 'data-panel-contributed-body',
  }
  for (const key of Object.keys(need)) {
    if (all.has(need[key]) !== true) throw new NotMeasured('the panel built artifact no longer draws rows with "' + need[key] + '", so what a contribution looks like in the DOM cannot be read out of the world: ' + PANEL_BUILT_PATH)
  }
  return { ...need, path: PANEL_BUILT_PATH, sha256: digest.sha256, all: [...all].sort() }
}

// ---------------------------------------------------------------------------
// The provider: every word and every name this gate judges, parsed out of its own bundle
// ---------------------------------------------------------------------------

/** One \`const COPY_XX = { "key": "value", ... }\` block out of the provider's own bundle. */
const readCopyBlock = (text, name) => {
  const start = text.indexOf('const ' + name + ' = {')
  if (start === -1) throw new NotMeasured('the provider bundle no longer states ' + name + ', so the words it contributes cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const end = text.indexOf('\n    }', start)
  const block = text.slice(start, end === -1 ? text.length : end + 6)
  const table = {}
  for (const match of block.matchAll(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g)) table[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  return { table, text: block }
}

/**
 * The provider's own declaration, read as data.
 *
 * Everything compared below travels from these bytes: the id, kind, source and order it declares, the
 * marker it records its own answer in, its locale namespace, both dictionaries, and the dictionary KEYS
 * its own code names (the title thunk of its definition, and the two keys inside the function that
 * answers the body). A key the provider names but its dictionary does not carry is a NAMED third state.
 */
const readProviderBundle = () => {
  if (existsSync(PROVIDER_BUNDLE_PATH) !== true) throw new NotMeasured('the provider bundle the page runs is not there: ' + PROVIDER_BUNDLE_PATH)
  const text = readFileSync(PROVIDER_BUNDLE_PATH, 'utf8')
  const pick = (pattern, what) => {
    const found = pattern.exec(text)
    if (found === null) throw new NotMeasured('the provider bundle no longer states ' + what + ', so the item this gate looks for cannot be named: ' + PROVIDER_BUNDLE_PATH)
    return found[1]
  }
  const id = pick(/const PANEL_ITEM_ID = "([^"]+)"/, 'the id its one item is declared under')
  const kind = pick(/const PANEL_ITEM_KIND = "([^"]+)"/, 'the kind it declares')
  const source = pick(/const PANEL_ITEM_SOURCE = "([^"]+)"/, 'the source it declares')
  const order = Number(pick(/const PANEL_ITEM_ORDER = (\d+)/, 'the order it declares'))
  const marker = pick(/const PANEL_ITEM_MARKER = "([^"]+)"/, 'the marker it records its own answer in')
  const ns = pick(/const LOCALE_NS = "([^"]+)"/, 'its locale namespace')
  const definition = /function panelItemDefinition\(store\) \{\r?\n([\s\S]*?)\r?\n    \}/.exec(text)
  if (definition === null) throw new NotMeasured('the provider bundle no longer defines panelItemDefinition, so the item it hands the seam cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const titleKey = (() => {
    const found = /title: function \(\) \{ return t\("([^"]+)"\) \}/.exec(definition[1])
    if (found === null) throw new NotMeasured('the provider definition no longer spells its title as a thunk over one dictionary key: ' + PROVIDER_BUNDLE_PATH)
    return found[1]
  })()
  const reading = /function connectionReading\(store\) \{\r?\n([\s\S]*?)\r?\n    \}/.exec(text)
  if (reading === null) throw new NotMeasured('the provider bundle no longer defines connectionReading, so the body it contributes cannot be read: ' + PROVIDER_BUNDLE_PATH)
  const pendingKey = (() => {
    const found = /\bt\("([^"]+)"\)/.exec(reading[1])
    if (found === null) throw new NotMeasured('the provider reading no longer answers a word for "nothing read yet": ' + PROVIDER_BUNDLE_PATH)
    return found[1]
  })()
  const errorKey = (() => {
    const found = /\bt\("([^"]+)",/.exec(reading[1])
    if (found === null) throw new NotMeasured('the provider reading no longer answers a word for a failed read: ' + PROVIDER_BUNDLE_PATH)
    return found[1]
  })()
  const zh = readCopyBlock(text, 'COPY_ZH').table
  const en = readCopyBlock(text, 'COPY_EN').table
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  if (same(zhKeys, enKeys) !== true) throw new NotMeasured('the provider dictionaries do not carry the same key set: zh ' + show(zhKeys) + ' against en ' + show(enKeys))
  for (const key of [titleKey, pendingKey, errorKey]) {
    if (Object.prototype.hasOwnProperty.call(zh, key) !== true) throw new NotMeasured('the provider code names the dictionary key ' + show(key) + ' while its zh dictionary carries ' + show(zhKeys))
  }
  return {
    bundle: fileDigest(PROVIDER_BUNDLE_PATH), id, kind, source, order, marker, ns,
    titleKey, pendingKey, errorKey,
    zh: { title: zh[titleKey], pending: zh[pendingKey], error: zh[errorKey], keys: zhKeys.length },
    en: { title: en[titleKey], pending: en[pendingKey], error: en[errorKey], keys: enKeys.length },
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
 * The open pane: its chip, its body box, and EVERY word the contribution seam put on screen.
 *
 * The data attributes are passed in (sel.contrib.*) because they are read out of the panel's own built
 * artifact every run: this probe asks the DOM the question the world's own bytes spell.
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
  const chip = chips.filter((row) => row.title === sel.title)[0]
  const titleSeat = chip === undefined ? null : document.querySelector(sel.chipById.replace('__ID__', chip.id) + ' ' + sel.titleSeat)
  const body = document.querySelector(sel.body)
  const bodyBox = boxOf(body)
  const style = body === null ? null : getComputedStyle(body)
  const section = document.querySelector(sel.contrib.section)
  const list = document.querySelector(sel.contrib.list)
  const head = document.querySelector(sel.contrib.head)
  const rows = Array.from(document.querySelectorAll(sel.contrib.row)).map((row) => {
    const titleEl = row.querySelector(sel.contrib.title)
    const metaEl = row.querySelector(sel.contrib.meta)
    const bodyEl = row.querySelector(sel.contrib.body)
    const box = boxOf(row)
    const spelled = boxOf(bodyEl)
    return {
      id: row.getAttribute(sel.contrib.rowAttr),
      kind: row.getAttribute(sel.contrib.kindAttr),
      source: row.getAttribute(sel.contrib.sourceAttr),
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
      titleLength: titleEl === null ? null : titleEl.textContent.length,
      meta: textOf(metaEl),
      metaBox: boxOf(metaEl),
      body: textOf(bodyEl),
      bodyBox: spelled,
      bodyLength: bodyEl === null ? null : bodyEl.textContent.length,
      bodyCheckVisibility: shown(bodyEl),
      bodyInRail: rail !== null && bodyEl !== null && rail.contains(bodyEl),
      bodyIntersectsRow: overlap(spelled, box),
    }
  })
  const itemRows = Array.from(document.querySelectorAll('[data-panel-item]')).map((row) => {
    const titleEl = row.querySelector('[data-panel-item-title]')
    const metaEl = row.querySelector('[data-panel-item-meta]')
    return { id: row.getAttribute('data-panel-item'), kind: row.getAttribute('data-panel-item-kind'), title: textOf(titleEl), meta: textOf(metaEl), box: boxOf(row) }
  })
  const noteRows = Array.from(document.querySelectorAll('[data-note-row]')).map((row) => {
    const textEl = row.querySelector('[data-note-text]')
    return { id: row.getAttribute('data-note-row'), text: textOf(textEl) }
  })
  const reads = document.querySelector('[data-panel-reads]')
  return {
    href: location.href,
    viewport: [Math.round(window.innerWidth), Math.round(window.innerHeight)],
    dpr: window.devicePixelRatio,
    rail: railBox,
    chips: chips,
    selected: selected === undefined ? null : selected.title,
    chip: chip === undefined ? null : chip,
    chipSelected: chip === undefined ? null : chip.selected,
    chipTitleText: chip === undefined ? null : chip.title,
    titleSeatText: textOf(titleSeat),
    paneCount: document.querySelectorAll(sel.body).length,
    body: {
      box: bodyBox,
      display: style === null ? null : style.display,
      visibility: style === null ? null : style.visibility,
      opacity: style === null ? null : style.opacity,
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
    },
    rows: rows,
    itemRows: itemRows,
    noteRows: noteRows,
    refusedRows: document.querySelectorAll('[data-panel-refusal]').length,
    readsAttr: reads === null ? null : reads.getAttribute('data-panel-reads'),
  }
}

/** The two markers this gate reads back, plus the byte string the panel one holds its items as. */
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

/** One rectangle of the live window, in device pixels. The clip is given in CSS pixels (CDP multiplies by devicePixelRatio). */
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
    schema: 'r192-g128-transcript/1',
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
  // The socket is handed to the caller so EVERY exit path closes it: an open WebSocket keeps the Node
  // event loop alive, and a gate that declines (exit 3) must still EXIT.
  if (bag !== undefined && bag !== null) bag.cdp = cdp

  // ---- premises ----
  const status = await shellStatus(t)
  if (status.ok !== true || status.body === null) throw new NotMeasured('the shell did not answer GET /__shell/status (' + String(status.why) + ')')
  if (status.body.phase !== 'ready') throw new NotMeasured('the shell reports phase=' + show(status.body.phase) + ', not ready')
  const panelRoute = await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'premise: the registry route the pane draws from')
  if (panelRoute.ok !== true || panelRoute.body === null || panelRoute.body.ok !== true) throw new NotMeasured('GET ' + PANEL_STATE_PATH + ' did not answer 200 ok=true: ' + show({ status: panelRoute.status, why: panelRoute.why }))
  const notesRoute = await httpGet(t, 'kernel', KERNEL_ORIGIN + NOTES_STATE_PATH, 'premise + the ledger the pane draws beside the contributions')
  if (notesRoute.ok !== true || notesRoute.body === null || notesRoute.body.ok !== true) throw new NotMeasured('GET ' + NOTES_STATE_PATH + ' did not answer 200 ok=true: ' + show({ status: notesRoute.status, why: notesRoute.why }))

  const panelWords = readPanelDictionary()
  const TITLE = panelWords.title
  const dom = readContributionDomNames()
  const provider = readProviderBundle()
  t.panel = {
    path: panelWords.path, sha256: panelWords.sha256, keys: panelWords.keys,
    tabTitle: TITLE, itemMeta: panelWords.meta, contribHead: panelWords.contribHead,
    built: readPanelBuilt(TITLE), readAt: new Date().toISOString(),
  }
  t.provider = {
    bundle: provider.bundle, id: provider.id, kind: provider.kind, source: provider.source, order: provider.order,
    marker: provider.marker, ns: provider.ns, titleKey: provider.titleKey, pendingKey: provider.pendingKey, errorKey: provider.errorKey,
    zh: provider.zh, en: provider.en, dictionary: provider.dictionary, readAt: new Date().toISOString(),
  }
  t.dom = {
    ...dom,
    rowSelector: '[' + dom.row + '="' + provider.id + '"]',
    anyRowSelector: '[' + dom.row + ']',
    emptySelector: '[' + dom.empty + '="contributed"]',
  }
  const sel = {
    rail: SEL_RAIL, chip: SEL_CHIP, chipTitle: SEL_CHIP_TITLE, chipClose: SEL_CHIP_CLOSE,
    chipId: 'data-dockkit-tab', chipById: '[data-dockkit-tab="__ID__"]', titleSeat: '[' + dom.titleSeat + ']',
    addControl: SEL_ADD_CONTROL, guide: SEL_GUIDE, surface: SEL_SURFACE, title: TITLE,
    body: '[' + dom.paneBody + ']',
    contrib: {
      section: '[' + dom.section + ']', list: '[' + dom.list + ']', head: '[' + dom.head + ']',
      row: '[' + dom.row + ']', title: '[' + dom.title + ']', meta: '[' + dom.meta + ']', body: '[' + dom.body + ']',
      empty: dom.empty,
      rowAttr: dom.row, kindAttr: dom.kind, sourceAttr: dom.source,
    },
  }

  let rail = await cdpJson(t, cdp, 'rail-at-entry', probeExpression(railProbe, TITLE), 'premise: the rail as this gate found it')
  if (rail.ok !== true) throw new NotMeasured('the rail could not be read: ' + String(rail.why))
  // R202: a client that was just started has its right sidebar COLLAPSED - the rail is 0 px wide and holds no
  // chip - and asserting 'no tab' there would call a fresh world broken. The gate opens the door itself, once,
  // and says so in a reading: the strip own add control is the door this shell offers even while collapsed.
  if (rail.value.chips.length === 0) {
    const door = rail.value.addControl
    if (door === null || door === undefined) throw new NotMeasured('the rail holds no tab at all and offers no add control either: ' + show(rail.value))
    await clickSpot(t, cdp, { x: door.x + Math.round(door.w / 2), y: door.y + Math.round(door.h / 2) }, 'open-the-collapsed-rail')
    await HOLD(900)
    const again = await cdpJson(t, cdp, 'rail-after-opening-it', probeExpression(railProbe, TITLE), 'the rail after this gate opened it')
    const opened = again.ok === true ? again.value : null
    if (opened === null || opened.chips.length === 0) throw new NotMeasured('this gate pressed the rail own add control and the rail still holds no tab: ' + show(opened === null ? again.why : opened))
    t.openedTheRail = true
    rail = { ok: true, value: opened }
  }
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
  t.drive = {
    claims: [], leaseAfterInput: [], door: { used: null, walk: [], guideOpenBefore: rail.value.guideOpen }, guide: null, entry: null,
    capsuleClick: null, pane: null, pane2: null, marker1: null, marker2: null, route: null,
    settle: null, screenshots: {}, shape: null, waits: [], reads: { entry: null, afterSettle: null },
  }
  await ensureLease(t, 'before the door was opened')

  /**
   * The strip re-lays itself out when a tab arrives (gate 126 measured our chip moving 52px between two
   * reads, and a close click landing on the chip body instead of its control). A box is only clicked after
   * it has been read twice and found unchanged.
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
  const railNow = rail.value
  if (railNow.ourChip !== null && railNow.ourChip !== undefined) {
    t.notes.push('note: the rail already carried our tab as a chip at entry (' + show(railNow.ourChip.title) + ')')
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
  // R214: the tab itself can be the door. The guide only offers a capsule for a panel that is NOT already in
  // the strip, so a world where our tab was already open has no capsule carrying our title - and this gate
  // read that as 'no door exists' and declined to measure, although the door was the tab in front of it.
  // Measured live: the rail carried our chip at entry, the add control opened a guide with 0 capsules, and
  // the gate exited 3 saying so. The reading was never about the guide; it is about reaching the panel.
  if (t.drive.entry === null && railNow.ourChip !== null && railNow.ourChip !== undefined) {
    t.drive.entry = { kind: 'rail-chip', titleText: railNow.ourChip.title, box: railNow.ourChip.box, text: railNow.ourChip.title, inRail: true, hasGlyph: null }
    t.drive.guide = { ...t.drive.guide, ours: t.drive.entry, oursIndex: -1 }
    t.drive.door.found = true
    t.drive.door.used = 'the rail chip that already carried our title'
    t.notes.push('the guide offered no capsule because our tab was already in the strip; the door used was the tab itself (' + show(railNow.ourChip.title) + ')')
  }
  if (t.drive.entry === null) {
    t.notes.push('the rail\'s real tab list: ' + show(railNow.chips.map((chip) => chip.title + (chip.selected ? '*' : ''))))
    t.notes.push('the guide\'s real capsule list: ' + show((t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).map((row) => row.titleText + ' [' + row.kind + ']')))
    t.problems.push('no door to our tab was found: the guide offers ' + String((t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length) + ' capsule(s), none titled ' + show(TITLE))
    return t
  }

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
    const seen = await cdpJson(t, cdp, 'pane-after-click', probeExpression(paneProbe, sel), 'the pane our click opened')
    probe = seen.ok === true ? seen.value : { error: seen.why }
    const ready = probe.chip !== null && probe.chip !== undefined && probe.chipSelected === true && probe.body !== null && probe.body !== undefined && probe.body.box !== null && probe.body.box !== undefined
    if (ready === true || Date.now() > deadline) break
  }
  t.drive.pane = probe
  t.drive.waits.push({
    until: 'our chip selected and its body box non-empty',
    reached: probe !== null && probe.chip !== null && probe.chip !== undefined && probe.chipSelected === true && probe.body !== null && probe.body !== undefined && probe.body.box !== null && probe.body.box !== undefined,
    at: new Date().toISOString(),
  })
  const firstMarker = await cdpJson(t, cdp, 'marker-after-click', probeExpression(markerProbe, provider.marker), 'the two markers, read beside the pane they are about')
  t.drive.marker1 = firstMarker.ok === true ? firstMarker.value : { error: firstMarker.why }

  // ---- the settled read: the row is re-read, and so is the provider's own line, in the same step ----
  const settleFrom = Date.now()
  await HOLD(SETTLE_MS)
  const second = await cdpJson(t, cdp, 'pane-settled', probeExpression(paneProbe, sel), 'the pane after the world had time to move')
  t.drive.pane2 = second.ok === true ? second.value : { error: second.why }
  const secondMarker = await cdpJson(t, cdp, 'marker-settled', probeExpression(markerProbe, provider.marker), 'the two markers beside the settled pane, in the same step')
  t.drive.marker2 = secondMarker.ok === true ? secondMarker.value : { error: secondMarker.why }
  t.drive.route = { panel: await httpGet(t, 'kernel', KERNEL_ORIGIN + PANEL_STATE_PATH, 'the registry as it stands while the pane is drawn') }
  const rowsOf = (pane) => (pane !== null && pane !== undefined && Array.isArray(pane.rows) ? pane.rows : [])
  const firstRows = rowsOf(t.drive.pane)
  const secondRows = rowsOf(t.drive.pane2)
  t.drive.settle = {
    ms: Date.now() - settleFrom,
    firstRowCount: firstRows.length,
    secondRowCount: secondRows.length,
    firstBody: firstRows.length > 0 ? firstRows[0].body : null,
    secondBody: secondRows.length > 0 ? secondRows[0].body : null,
    bodyMoved: firstRows.length > 0 && secondRows.length > 0 ? firstRows[0].body !== secondRows[0].body : null,
    providerMoved: t.drive.marker1 !== null && t.drive.marker2 !== null && t.drive.marker1.provider !== undefined && t.drive.marker2.provider !== undefined
      ? (t.drive.marker1.provider === null ? null : t.drive.marker1.provider.body) !== (t.drive.marker2.provider === null ? null : t.drive.marker2.provider.body)
      : null,
  }
  const ours = secondRows.filter((row) => row !== null && row !== undefined && row.id === provider.id)[0]
  const rowBox = ours === undefined ? null : ours.box
  const bodyBox = ours === undefined ? null : ours.bodyBox
  t.drive.screenshots.row = await screenshot(t, cdp, rowBox, 'the contributed row own rectangle, in pixels')
  t.drive.screenshots.body = await screenshot(t, cdp, bodyBox, 'the reading the row draws, in pixels')

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
        let chip = settled.chip
        if (chip === null || chip === undefined) {
          closed = true
          t.restore.steps.push('our chip was already gone before the close click (attempt ' + String(attempt + 1) + ')')
          break
        }
        // The product shows a chip close control on the ACTIVE chip only (measured by gate 126), so our chip
        // is selected first and only then is its own control clicked.
        if (chip.selected !== true) {
          await ensureLease(t, 'before selecting our own chip, so its own close control is the one on show')
          await clickSpot(t, cdp, { x: chip.box.x + Math.round(chip.box.w / 2), y: chip.box.y + Math.round(chip.box.h / 2) }, 'restore-select-our-tab')
          await noteLeaseAfterInput(t, 'restore-select-our-tab')
          await HOLD(450)
          const again = await stableOurChip(5)
          chip = again.chip
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
  // own transcript, inside the git-ignored scratch, and it is written AFTER this fingerprint.
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
const stableLedger = (route) => (route === null || route === undefined || route.body === null || route.body === undefined ? null : { readOnly: route.body.readOnly, path: route.body.path, limits: route.body.limits, counts: route.body.counts, notes: route.body.notes })

const factsOf = (t) => {
  const entry = (t === null || t === undefined || t.entry === undefined || t.entry === null) ? {} : t.entry
  const drive = (t === null || t === undefined || t.drive === undefined || t.drive === null) ? {} : t.drive
  const provider = (t === null || t === undefined || t.provider === undefined || t.provider === null) ? {} : t.provider
  const panel = (t === null || t === undefined || t.panel === undefined || t.panel === null) ? {} : t.panel
  const pane = (drive.pane2 === undefined || drive.pane2 === null) ? (drive.pane === undefined ? {} : drive.pane) : drive.pane2
  const paneFirst = (drive.pane === undefined || drive.pane === null) ? {} : drive.pane
  const marker = (drive.marker2 === undefined || drive.marker2 === null) ? (drive.marker1 === undefined ? null : drive.marker1) : drive.marker2
  const markerPanel = marker === null || marker === undefined ? null : (marker.panel === undefined ? null : marker.panel)
  const markerKeys = marker === null || marker === undefined ? null : (marker.panelKeys === undefined ? null : marker.panelKeys)
  const markerItemsJson = marker === null || marker === undefined ? null : (marker.itemsJson === undefined ? null : marker.itemsJson)
  const markerContributed = marker === null || marker === undefined ? null : (marker.contributed === undefined ? null : marker.contributed)
  const markerProvider = marker === null || marker === undefined ? null : (marker.provider === undefined ? null : marker.provider)
  const route = drive.route === undefined || drive.route === null ? null : (drive.route.panel === undefined ? null : drive.route.panel)
  const rows = Array.isArray(pane.rows) ? pane.rows : []
  const row = rows.filter((candidate) => candidate !== null && candidate !== undefined && candidate.id === provider.id)[0]
  const screenshots = drive.screenshots === undefined || drive.screenshots === null ? {} : drive.screenshots
  return {
    t, entry, drive, provider, panel, pane, paneFirst, marker, markerPanel, markerKeys, markerItemsJson, markerContributed, markerProvider, route,
    rows, row: row === undefined ? null : row,
    screenshotRow: screenshots.row === undefined ? null : screenshots.row,
    screenshotBody: screenshots.body === undefined ? null : screenshots.body,
  }
}

/** The meta line the panel's own template spells for this row, from the world's own values. */
const expectedMeta = (f) => {
  const template = f.panel.itemMeta
  if (typeof template !== 'string') return null
  const sinks = f.route === null || f.route.body === null || f.route.body === undefined || f.route.body.registry === null || f.route.body.registry === undefined
    ? null
    : (f.route.body.registry.kindSinks === undefined ? null : f.route.body.registry.kindSinks)
  const sink = sinks === null || typeof sinks !== 'object' ? '' : (typeof sinks[f.provider.kind] === 'string' ? sinks[f.provider.kind] : '')
  const values = { kind: f.provider.kind, sink: sink, order: String(f.provider.order), source: f.provider.source }
  return template.replace(/\{(\w+)\}/g, (whole, name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole))
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
    id: '2-our-tab-was-reached-through-the-door-this-world-has',
    judge: (t) => {
      const f = factsOf(t)
      const problems = []
      if (f.drive.door === null || f.drive.door === undefined || f.drive.door.found !== true) {
        problems.push('no door to our tab exists in this world: the rail offers ' + show((f.entry.rail === undefined || f.entry.rail === null ? [] : f.entry.rail.chips).map((chip) => chip.title)) + ' and the guide offers ' + show((f.drive.guide === null || f.drive.guide === undefined || f.drive.guide.entries === undefined ? [] : f.drive.guide.entries).map((row) => row.titleText + ' [' + row.kind + ']')) + ' - none of them is titled ' + show(f.panel.tabTitle))
      }
      if (f.drive.door !== null && f.drive.door !== undefined && (f.drive.door.used === null || f.drive.door.used === undefined)) problems.push('this gate never named the door it used')
      if (f.drive.capsuleClick === null || f.drive.capsuleClick === undefined) problems.push('the capsule carrying our title was found but never clicked')
      if (f.pane === null || f.pane === undefined || f.pane.chip === null || f.pane.chip === undefined) problems.push('after the click no rail chip carries our title (' + show(f.panel.tabTitle) + '): the tabs are ' + show((f.pane === null || f.pane === undefined || f.pane.chips === undefined ? [] : f.pane.chips).map((chip) => chip.title)))
      else if (f.pane.chipSelected !== true) problems.push('our chip exists but is not the selected tab')
      if (f.pane.chipTitleText !== f.panel.tabTitle) problems.push('the chip draws ' + show(f.pane.chipTitleText) + ' while the panel own zh dictionary says "tab.title" is ' + show(f.panel.tabTitle))
      if (f.pane.titleSeatText !== f.panel.tabTitle) problems.push('the title seat inside the chip draws ' + show(f.pane.titleSeatText) + ' while the panel own zh dictionary says ' + show(f.panel.tabTitle))
      if (f.panel.built === null || f.panel.built === undefined || f.panel.built.carriesTitle !== true) problems.push('the built artifact the page runs does not carry that title at all (' + String(f.panel.built === null || f.panel.built === undefined ? '(unread)' : f.panel.built.howNamed) + ')')
      if (f.pane.body === null || f.pane.body === undefined || f.pane.body.box === null || f.pane.body.box === undefined) problems.push('no pane body is in the document after the click')
      if (f.entry.rail !== undefined && f.entry.rail !== null && f.entry.rail.ourChip !== null && f.entry.rail.ourChip !== undefined && f.drive.shape !== 'already-open-at-entry') problems.push('the entry rail already carried our chip while this gate recorded the tab as opened by itself')
      const guide = f.drive.guide === null || f.drive.guide === undefined || f.drive.guide.entries === undefined ? [] : f.drive.guide.entries
      return problems.length === 0
        ? OK('our tab was reached through the door the world has (' + String(f.drive.door.used) + '); the rail own chips were ' + show((f.entry.rail === undefined || f.entry.rail === null ? [] : f.entry.rail.chips).map((chip) => chip.title)) + ' at entry, the guide offered ' + String(guide.length) + ' capsule(s) and the one titled ' + show(f.drive.entry === null ? null : f.drive.entry.titleText) + ' is kind=' + show(f.drive.entry === null ? null : f.drive.entry.kind) + ' - a priority:extension page type is not a chip in the strip, it is a capsule on the guide page - and the click left our chip selected with the panel own zh "tab.title" drawn twice, in the chip and in the title seat inside it')
        : BAD('no-door-or-not-our-tab', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '3-the-contributed-row-draws-the-providers-own-identity-and-title',
    judge: (t) => {
      const f = factsOf(t)
      if (f.pane === null || f.pane === undefined || f.pane.rows === undefined) return NOT_MEASURED('no-pane', 'NOT MEASURED: no pane was read (the door or the click did not settle), so there is no row to judge')
      const problems = []
      if (f.pane.contributed === null || f.pane.contributed === undefined) problems.push('the pane draws no contribution section at all (' + String(t.dom === undefined || t.dom === null ? '?' : t.dom.section) + ' is not in the document)')
      else {
        if (f.pane.contributed.head !== f.panel.contribHead) problems.push('the section head draws ' + show(f.pane.contributed.head) + ' while the panel own zh dictionary says "contrib.title" is ' + show(f.panel.contribHead))
        // R200: the seam now has more than one real provider (the browser's action and the teams action), so
        // 'exactly one row' is no longer the truth and asserting it would make a working world look broken.
        // What still has to hold: the section draws contributions at all, and no row is drawn twice.
        if (f.pane.contributed.rowCount < 1) problems.push('the section drew no contributed row at all: ' + show(f.rows.map((row) => row.id)))
        const drawnIds = f.rows.map((row) => row.id)
        if (new Set(drawnIds).size !== drawnIds.length) problems.push('a row is drawn more than once: ' + show(drawnIds))
        if (Array.isArray(f.pane.contributed.emptyMarkers) && f.pane.contributed.emptyMarkers.length > 0) problems.push('the section draws its own empty marker while a contribution was declared: ' + show(f.pane.contributed.emptyMarkers))
      }
      if (f.row === null) problems.push('no drawn row carries the id the provider declares (' + show(f.provider.id) + '); the rows are ' + show(f.rows.map((row) => row.id)))
      else {
        if (f.row.title !== f.provider.zh.title) problems.push('the row draws ' + show(f.row.title) + ' while the provider own zh dictionary, for the key its own definition names (' + show(f.provider.titleKey) + '), says ' + show(f.provider.zh.title))
        if (f.row.kind !== f.provider.kind) problems.push('the row is drawn kind=' + show(f.row.kind) + ' while the provider declares ' + show(f.provider.kind))
        const kinds = f.route === null || f.route.body === null || f.route.body === undefined || f.route.body.registry === null || f.route.body.registry === undefined ? null : f.route.body.registry.kinds
        if (Array.isArray(kinds) && kinds.includes(f.row.kind) !== true) problems.push('the row own kind ' + show(f.row.kind) + ' is outside the closed set the registry route declares: ' + show(kinds))
        if (f.row.source !== f.provider.source) problems.push('the row says it belongs to ' + show(f.row.source) + ' while the provider declares ' + show(f.provider.source))
        const meta = expectedMeta(f)
        if (meta === null) problems.push('the panel own meta template could not be read, so the row own source/kind line cannot be judged')
        else if (f.row.meta !== meta) problems.push('the row line draws ' + show(f.row.meta) + ' while the panel own template ' + show(f.panel.itemMeta) + ' with the provider own kind/source/order and the registry own sink spells ' + show(meta))
        if (f.row.attributes === undefined || f.row.attributes === null || f.row.attributes[String(t.dom.row)] !== f.provider.id) problems.push('the drawn row does not carry the id in the attribute the artifact draws rows with (' + show(t.dom === undefined || t.dom === null ? null : t.dom.row) + '): ' + show(f.row.attributes))
        if (f.row.attributes !== undefined && f.row.attributes !== null && f.row.attributes[String(t.dom.kind)] !== f.provider.kind) problems.push('the drawn row does not carry its kind in the attribute the artifact draws rows with (' + show(t.dom.kind) + ')')
        if (f.row.attributes !== undefined && f.row.attributes !== null && f.row.attributes[String(t.dom.source)] !== f.provider.source) problems.push('the drawn row does not carry its source in the attribute the artifact draws rows with (' + show(t.dom.source) + ')')
      }
      return problems.length === 0
        ? OK('the panel drew one row for the item another package declared: id ' + show(f.row.id) + ', kind ' + show(f.row.kind) + ' (inside the registry own closed set) and source ' + show(f.row.source) + ' on the row itself and in the line the panel own template spells (' + show(f.row.meta) + '), and its title is the provider own zh dictionary value ' + show(f.row.title) + ' for the key the provider own definition names (' + show(f.provider.titleKey) + ') - the panel own section head is ' + show(f.pane.contributed === null ? null : f.pane.contributed.head))
        : BAD('row-not-the-providers-own', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '4-the-row-body-is-a-reading-and-not-the-arrival-placeholder',
    judge: (t) => {
      const f = factsOf(t)
      if (f.pane === null || f.pane === undefined || f.pane.rows === undefined) return NOT_MEASURED('no-pane', 'NOT MEASURED: no pane was read, so no body was drawn for this gate to read')
      if (f.row === null) return NOT_MEASURED('no-row', 'NOT MEASURED: no drawn row carries the id the provider declares (' + show(f.provider.id) + '), so there is no body: the rows are ' + show(f.rows.map((row) => row.id)))
      const body = f.row.body
      const pending = f.provider.zh.pending
      const providerLine = f.markerProvider === null || f.markerProvider === undefined ? null : (f.markerProvider.body === undefined ? null : f.markerProvider.body)
      const providerFailed = f.markerProvider === null || f.markerProvider === undefined ? null : (f.markerProvider.failed === undefined ? null : f.markerProvider.failed)
      const first = f.paneFirst === null || f.paneFirst === undefined || Array.isArray(f.paneFirst.rows) !== true || f.paneFirst.rows.length === 0 ? null : f.paneFirst.rows[0].body
      const stayed = first === null ? null : first === body
      const settle = f.drive.settle === undefined || f.drive.settle === null ? null : f.drive.settle
      const frozen = 'read #1 drew ' + show(first) + ' and read #2 (after ' + String(settle === null ? '?' : settle.ms) + ' ms) drew ' + show(body) + (stayed === true ? ', i.e. the drawn body did not move while the provider own line is live' : ', i.e. the drawn body did move between the two reads')
      if (typeof body !== 'string' || body === '') return BAD('body-empty', 'FAIL: the row draws no body at all (' + show(body) + ')')
      if (body === '0') return BAD('body-is-zero', 'FAIL: the row draws the bare "0" the provider own README refuses (0 reads as "not connected"), so a person cannot tell an unread state from a state with no connection')
      if (body === pending) {
        if (f.markerProvider === null || f.markerProvider === undefined) return NOT_MEASURED('no-witness', 'NOT MEASURED: the row draws the provider own word for "the reading has not arrived yet" (' + show(pending) + '), and the provider own marker is not in this page, so this gate cannot tell a world that has nothing to say from a row that never caught up (' + frozen + ')')
        if (providerLine === pending && providerFailed === null) {
          return NOT_MEASURED('world-has-no-reading-either', 'NOT MEASURED (data, not a defect): the world itself has no reading at this instant - the row draws the provider own word for it (' + show(pending) + ') and the provider own marker, read in the same page step, answers the same word with failed=' + show(providerFailed) + ' - so there is nothing to draw yet (' + frozen + ')')
        }
        return BAD('the-row-says-not-arrived-while-the-provider-answers', 'FAIL: the row draws the provider own word for "the reading has not arrived yet" (' + show(pending) + ') while the provider own marker, read in the same page step, answers ' + show(providerLine) + ' (declared=' + show(f.markerProvider.declared === undefined ? null : f.markerProvider.declared) + ', failed=' + show(providerFailed) + '); ' + frozen + ' - the drawn words are not the words the provider itself answers')
      }
      if (f.markerProvider !== null && f.markerProvider !== undefined && providerLine === body) {
        return OK('the row draws the provider own reading verbatim: ' + show(body) + ' (non-empty, not the bare 0, and not the provider own word for "not arrived yet" - the provider own marker answers the same bytes in the same page step; ' + frozen + ')')
      }
      return OK('the row draws a reading: ' + show(body) + ' (non-empty, not the bare 0, and not the provider own word ' + show(pending) + ' for "not arrived yet"); the provider own marker answered ' + show(providerLine) + ' on a different read, which is what a reading that moves looks like (' + frozen + ')')
    },
  },
  {
    id: '5-the-row-and-its-body-are-on-screen-with-pixels',
    judge: (t) => {
      const f = factsOf(t)
      if (f.pane === null || f.pane === undefined || f.pane.rows === undefined) return NOT_MEASURED('no-pane', 'NOT MEASURED: no pane was read, so there is nothing to look at')
      if (f.row === null) return NOT_MEASURED('no-row', 'NOT MEASURED: no drawn row carries the id the provider declares (' + show(f.provider.id) + '), so there is no rectangle to capture')
      const problems = []
      const row = f.row
      if (row.box === null || row.box === undefined || row.box.w <= 0 || row.box.h <= 0) problems.push('the row own rectangle is empty: ' + show(row.box))
      if (row.checkVisibility !== true) problems.push('the row own element reports it is not visible (checkVisibility ' + show(row.checkVisibility) + ')')
      if (row.inRail !== true) problems.push('the row is not inside the rail element: row ' + show(row.box) + ' against rail ' + show(f.pane.rail))
      if (row.intersectsRail !== true) problems.push('the row own rectangle does not intersect the rail rectangle: row ' + show(row.box) + ' against rail ' + show(f.pane.rail))
      if (row.bodyBox === null || row.bodyBox === undefined || row.bodyBox.w <= 0 || row.bodyBox.h <= 0) problems.push('the body own rectangle is empty: ' + show(row.bodyBox))
      if (row.bodyCheckVisibility !== true) problems.push('the body own element reports it is not visible (checkVisibility ' + show(row.bodyCheckVisibility) + ')')
      if (row.bodyIntersectsRow !== true) problems.push('the body own rectangle is not inside the row own rectangle: body ' + show(row.bodyBox) + ' against row ' + show(row.box))
      if (row.bodyInRail !== true) problems.push('the body is not inside the rail element')
      if (row.inWindow !== true) return NOT_MEASURED('row-out-of-the-window', 'NOT MEASURED: the row is drawn at ' + show(row.box) + ' which is not inside the window own visible area (' + show(f.pane.viewport) + '); this gate may not scroll the rail, so it cannot capture it: ' + problems.join(' | '))
      const dpr = f.pane.dpr === undefined ? 1 : f.pane.dpr
      const want = [Math.round(row.box.w * dpr), Math.round(row.box.h * dpr)]
      const wantBody = [Math.round(row.bodyBox.w * dpr), Math.round(row.bodyBox.h * dpr)]
      const shotRow = f.screenshotRow
      const shotBody = f.screenshotBody
      if (shotRow === null || shotRow.ok !== true) problems.push('the row could not be captured: ' + show(shotRow === null ? null : shotRow.why))
      else {
        if (shotRow.width !== want[0] || shotRow.height !== want[1]) problems.push('the row capture is ' + String(shotRow.width) + 'x' + String(shotRow.height) + ' while the row rectangle at devicePixelRatio ' + String(dpr) + ' is ' + String(want[0]) + 'x' + String(want[1]))
        if (shotRow.nonBlank <= 0) problems.push('the row own rectangle is blank: ' + String(shotRow.nonBlank) + ' non-background pixel(s) in ' + String(shotRow.width) + 'x' + String(shotRow.height))
      }
      if (shotBody === null || shotBody.ok !== true) problems.push('the body could not be captured: ' + show(shotBody === null ? null : shotBody.why))
      else {
        if (shotBody.width !== wantBody[0] || shotBody.height !== wantBody[1]) problems.push('the body capture is ' + String(shotBody.width) + 'x' + String(shotBody.height) + ' while the body rectangle at devicePixelRatio ' + String(dpr) + ' is ' + String(wantBody[0]) + 'x' + String(wantBody[1]))
        if (shotBody.nonBlank <= 0) problems.push('the body own rectangle is blank: ' + String(shotBody.nonBlank) + ' non-background pixel(s)')
      }
      return problems.length === 0
        ? OK('the drawn row is on screen at ' + show(row.box) + ', inside the rail ' + show(f.pane.rail) + ' and inside the window ' + show(f.pane.viewport) + ', drawn (' + show({ checkVisibility: row.checkVisibility, inRail: row.inRail }) + '); its crop is ' + String(shotRow.width) + 'x' + String(shotRow.height) + ' device pixel(s) with ' + String(shotRow.nonBlank) + ' non-background pixel(s) (mean ' + String(shotRow.mean) + ', spread ' + String(shotRow.spread) + ', background ' + show(shotRow.background) + '); the reading inside it is at ' + show(row.bodyBox) + ' and its own crop is ' + String(shotBody.width) + 'x' + String(shotBody.height) + ' with ' + String(shotBody.nonBlank) + ' non-background pixel(s) (mean ' + String(shotBody.mean) + ', spread ' + String(shotBody.spread) + ')')
        : BAD('row-not-drawn-with-pixels', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '6-the-marker-was-not-polluted-and-carries-the-contribution',
    judge: (t) => {
      const f = factsOf(t)
      if (f.markerPanel === null || f.markerPanel === undefined) return NOT_MEASURED('no-marker', 'NOT MEASURED: globalThis.__dshLinkPanel is not in this page, so nothing can be said about what the marker reports')
      if (f.route === null || f.route === undefined || f.route.body === null || f.route.body === undefined || f.route.body.declared === undefined || Array.isArray(f.route.body.declared.visible) !== true) {
        return NOT_MEASURED('no-route', 'NOT MEASURED: the registry route was not read beside the marker (or carries no declared.visible), so the marker own items cannot be held to the route')
      }
      const problems = []
      const expected = JSON.stringify(f.route.body.declared.visible)
      const observed = f.markerItemsJson
      if (observed !== expected) problems.push('the marker own items are not the route own declared.visible byte for byte: marker ' + clip(show(observed), 300) + ' against route ' + clip(show(expected), 300))
      const items = Array.isArray(f.markerPanel.items) ? f.markerPanel.items : []
      const polluted = items.filter((item) => item !== null && item !== undefined && (item.id === f.provider.id || item.source === f.provider.source))
      if (polluted.length > 0) problems.push('the marker own items carry a contribution (' + show(polluted) + '): the two sources are mixed into the field gate 124 holds to the route')
      const contributed = Array.isArray(f.markerContributed) ? f.markerContributed : null
      if (contributed === null) problems.push('the marker carries no contributed array at all, while a provider declared into the seam')
      else {
        const mine = contributed.filter((row) => row !== null && row !== undefined && row.id === f.provider.id)
        if (mine.length !== 1) problems.push('the marker own contributed holds ' + String(mine.length) + ' row(s) for ' + show(f.provider.id) + ': ' + show(contributed.map((row) => row.id)))
        else {
          if (mine[0].kind !== f.provider.kind) problems.push('the marker own contributed row is kind=' + show(mine[0].kind) + ' while the provider declares ' + show(f.provider.kind))
          if (mine[0].source !== f.provider.source) problems.push('the marker own contributed row says source=' + show(mine[0].source) + ' while the provider declares ' + show(f.provider.source))
          if (mine[0].order !== f.provider.order) problems.push('the marker own contributed row says order=' + show(mine[0].order) + ' while the provider declares ' + show(f.provider.order))
        }
      }
      return problems.length === 0
        ? OK('globalThis.__dshLinkPanel.items is the registry route own declared.visible byte for byte (' + clip(observed, 200) + '), no item in it carries the contribution, and the new field carries the row the provider declared: ' + show(contributed))
        : BAD('marker-polluted', 'FAIL: ' + problems.join(' | '))
    },
  },
  {
    id: '7-the-world-was-put-back',
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
        if (exitRail.paneCount !== entryRail.paneCount) problems.push('the number of panes on screen moved: ' + String(entryRail.paneCount) + ' -> ' + String(exitRail.paneCount))
      }
      if (t.restore === null || t.restore === undefined || t.restore.leaseReleased !== true) problems.push('the lease was not given back')
      if (t.exit !== null && t.exit !== undefined && t.exit.lease !== null && t.exit.lease !== undefined && t.exit.lease.held === true) problems.push('the lease is held at exit: ' + show(t.exit.lease))
      const entryPanel = t.entry === null || t.entry === undefined ? null : t.entry.panel
      const exitPanel = t.exit === null || t.exit === undefined ? null : t.exit.panel
      if (same(entryPanel, exitPanel) !== true) problems.push('the panel own numbers moved: entry ' + show(entryPanel) + ' exit ' + show(exitPanel))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.client !== t.exit.client) problems.push('the desktop client changed: ' + show(t.entry === null || t.entry === undefined ? null : t.entry.client) + ' -> ' + show(t.exit === null || t.exit === undefined ? null : t.exit.client))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.status === null || t.exit.status === null || t.entry.status.pid !== t.exit.status.pid) problems.push('the kernel pid changed: ' + show(t.entry === null || t.entry === undefined || t.entry.status === null ? null : t.entry.status.pid) + ' -> ' + show(t.exit === null || t.exit === undefined || t.exit.status === null ? null : t.exit.status.pid))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(t.entry.manifest, t.exit.manifest) !== true) problems.push('the manifest changed under this gate: entry ' + show(t.entry === null || t.entry === undefined ? null : t.entry.manifest) + ' exit ' + show(t.exit === null || t.exit === undefined ? null : t.exit.manifest))
      // The routes carry a per-request counter and a timestamp (measured by gate 126: "served" grows on every
      // GET), so what is compared is what the route DECLARES, not the envelope this gate own reads move.
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(stableRoute(t.entry.routes === undefined ? null : t.entry.routes.panel), stableRoute(t.exit.routes === undefined ? null : t.exit.routes.panel)) !== true) problems.push('the live registry changed under this gate: entry ' + show(stableRoute(t.entry === null || t.entry === undefined || t.entry.routes === undefined ? null : t.entry.routes.panel)) + ' exit ' + show(stableRoute(t.exit === null || t.exit === undefined || t.exit.routes === undefined ? null : t.exit.routes.panel)))
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || same(stableLedger(t.entry.routes === undefined ? null : t.entry.routes.notes), stableLedger(t.exit.routes === undefined ? null : t.exit.routes.notes)) !== true) problems.push('the live ledger changed under this gate')
      if (t.entry === null || t.entry === undefined || t.exit === null || t.exit === undefined || t.entry.gitStatus === null || t.exit.gitStatus === null || t.entry.gitStatus.ok !== true || t.exit.gitStatus.ok !== true) problems.push('git status could not be read on one side: ' + show({ entry: t.entry === null || t.entry === undefined || t.entry.gitStatus === null ? null : t.entry.gitStatus.why === undefined ? null : t.entry.gitStatus.why, exit: t.exit === null || t.exit === undefined || t.exit.gitStatus === null ? null : t.exit.gitStatus.why === undefined ? null : t.exit.gitStatus.why }))
      else if (t.entry.gitStatus.text !== t.exit.gitStatus.text) {
        // R191 section 3: a world moved by somebody ELSE is a named third state (the note the drive wrote,
        // and the exit code main() gives it), never a product red. What reddens THIS reading is a file this
        // gate wrote turning up in the difference.
        const moved = t.worldMoved === undefined || t.worldMoved === null ? { appeared: [], vanished: [], ours: [] } : t.worldMoved
        if (moved.ours.length > 0) problems.push('a file THIS GATE wrote appeared in git status --porcelain: ' + show(moved.ours))
      }
      return problems.length === 0
        ? OK('the rail is back on the tab it was left on (' + show(t.entry === null || t.entry === undefined || t.entry.rail === null ? null : t.entry.rail.selected) + ') with the same chips ' + show(t.entry === null || t.entry === undefined || t.entry.rail === null ? null : t.entry.rail.chips.map((chip) => chip.title)) + ', the lease is given back (' + show(t.exit === null || t.exit === undefined || t.exit.lease === null ? null : t.exit.lease.held) + '), and the panel own numbers, the kernel pid, the desktop client, the manifests, both live routes and git status --porcelain are all identical before and after - and this gate records that IT OPENED the pane this round')
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
        if (read.kind === 'http' && String(read.method) !== 'GET') problems.push('a non-GET request was made: ' + show(read))
      }
      const writes = (t.calls === undefined ? [] : t.calls).filter((row) => row.kind === 'file-write')
      if (writes.length > 1) problems.push('this gate wrote ' + String(writes.length) + ' file(s): ' + show(writes.map((row) => row.path)))
      for (const row of writes) if (String(row.purpose) !== 'this gate own transcript') problems.push('this gate wrote a file that is not its transcript: ' + show(row))
      return problems.length === 0
        ? OK('the only input was ' + String(inputs.length / 2) + ' left click(s) ' + show([...new Set(inputs.map((row) => row.purpose))]) + ', every page expression was a JSON.stringify of DOM/global reads, the only CDP methods were ' + show([...new Set((t.cdpCalls === undefined ? [] : t.cdpCalls).map((call) => call.method))]) + ', the only panel ops were ' + show([...new Set((t.reads === undefined ? [] : t.reads).filter((read) => read.kind === 'panel').map((read) => read.op))]) + ', every HTTP request was a GET, and the only file written was this gate own transcript (' + show(writes.length === 0 ? null : writes[0].path) + ')')
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
// The comparand is the BASELINE VERDICT, not the baseline's colour: an attack over a transcript whose
// reading 4 is already red would otherwise be impossible (and a gate that cannot be attacked when the
// world is wrong is a gate that stops working exactly when it matters). Each mutant declares the set of
// readings whose VERDICT IT MOVES; the mutants that cover a red reading REPAIR its subject instead of
// breaking it, so the judge is still shown to be falsifiable in both directions.

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
const ROW = '3-the-contributed-row-draws-the-providers-own-identity-and-title'
const BODY = '4-the-row-body-is-a-reading-and-not-the-arrival-placeholder'
const PIXELS = '5-the-row-and-its-body-are-on-screen-with-pixels'
const MARKER = '6-the-marker-was-not-polluted-and-carries-the-contribution'
const PUTBACK = '7-the-world-was-put-back'
const AUDIT = '8-this-gate-only-clicked-and-never-wrote'

/** The row the two pane reads of this transcript hold, wherever it is. */
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

/** A value the judge of reading 4 accepts as a reading: non-empty, not the bare 0, not the provider own arrival word. */
const repairValue = (t) => {
  const pending = t.provider === undefined || t.provider === null ? null : t.provider.zh.pending
  const line = t.drive === undefined || t.drive.marker2 === undefined || t.drive.marker2 === null || t.drive.marker2.provider === undefined || t.drive.marker2.provider === null
    ? null
    : t.drive.marker2.provider.body
  if (typeof line === 'string' && line !== '' && line !== '0' && line !== pending) return line
  return 'a reading a repaired row draws'
}

const MUTANTS = [
  { name: 'the-shell-is-not-ready', declared: [PREMISES], what: 'the world is not the one this gate requires', apply: (t) => { t.entry.status.phase = 'failed' } },
  { name: 'the-kernel-restarted-mid-run', declared: [PREMISES, PUTBACK], what: 'a restart under the gate: the premise moved and the world is not the one found', apply: (t) => { t.exit.status.pid = Number(t.entry.status.pid) + 1 } },
  { name: 'the-desktop-client-was-replaced', declared: [PREMISES, PUTBACK], what: 'a different desktop client answered the exit read', apply: (t) => { t.exit.client = '99999@2000-01-01T00:00:00.0000000Z' } },
  { name: 'another-live-consumer-ran-beside-us', declared: [PREMISES], what: 'two live gates on one world', apply: (t) => { t.entry.guard.others = ['pid 4242 node scripts/verify-panel-render.mjs'] } },
  { name: 'the-lease-was-never-ours', declared: [LEASE], what: 'the gate touched the rail without owning the turn', apply: (t) => { const claim = t.drive.claims[0]; claim.action = 'claim'; claim.after = { held: false, holder: null, revokedBy: null, revokedHolder: null, revokedKind: null } } },
  { name: 'an-input-was-recorded-against-a-taken-turn', declared: [LEASE], what: 'somebody else input was recorded while this gate held the turn', apply: (t) => { const line = t.drive.leaseAfterInput.filter((row) => row.held === true)[0] === undefined ? t.drive.leaseAfterInput[0] : t.drive.leaseAfterInput.filter((row) => row.held === true)[0]; line.held = false; line.revokedBy = 'user-input'; line.revokedKind = 'pointerdown'; line.revokedHolder = t.holder } },
  { name: 'the-lease-was-left-held', declared: [LEASE, PUTBACK], what: 'a gate that walks away still holding the panel', apply: (t) => { t.restore.leaseReleased = false; t.exit.lease = { held: true, holder: t.holder, revokedBy: null, revokedHolder: null, revokedKind: null } } },
  { name: 'the-door-was-never-named', declared: [DOOR], what: 'how our tab was reached was never recorded', apply: (t) => { t.drive.door.used = null } },
  { name: 'no-door-carries-our-title', declared: [DOOR], what: 'the rail and the guide offer no capsule titled like the panel own dictionary', apply: (t) => { t.drive.door.found = false } },
  { name: 'our-chip-exists-but-is-not-selected', declared: [DOOR], what: 'the click landed our tab without selecting it', apply: (t) => { t.drive.pane.chipSelected = false; if (t.drive.pane2 !== null && t.drive.pane2 !== undefined) t.drive.pane2.chipSelected = false } },
  { name: 'the-chip-draws-the-providers-english-word', declared: [DOOR], what: 'the pane was reached through a title that is not the panel own zh dictionary value', apply: (t) => { t.drive.pane.chipTitleText = 'LINK panel'; t.drive.pane.titleSeatText = 'LINK panel'; if (t.drive.pane2 !== null && t.drive.pane2 !== undefined) { t.drive.pane2.chipTitleText = 'LINK panel'; t.drive.pane2.titleSeatText = 'LINK panel' } } },
  { name: 'the-row-draws-the-english-title', declared: [ROW], what: 'the drawn title is the provider own en word rather than the zh one', apply: (t) => { const row = drawnRow(t); if (row !== null) row.title = t.provider.en.title } },
  { name: 'the-row-loses-its-source', declared: [ROW], what: 'a row that cannot say where it comes from', apply: (t) => { const row = drawnRow(t); if (row !== null) row.source = '' } },
  { name: 'the-row-is-drawn-with-another-kind', declared: [ROW], what: 'the row drawn as a kind its provider never declared', apply: (t) => { const row = drawnRow(t); if (row !== null) row.kind = t.provider.kind === 'action' ? 'pane' : 'action' } },
  { name: 'the-row-line-forgets-its-source', declared: [ROW], what: 'the meta line the panel own template spells with nothing in the source slot', apply: (t) => { const row = drawnRow(t); if (row !== null) row.meta = '' } },
  { name: 'the-row-draws-no-body', declared: [BODY], what: 'a drawn row with nothing in the body slot', apply: (t) => { const row = drawnRow(t); if (row !== null) row.body = '' } },
  { name: 'the-row-draws-a-reading-at-last', declared: [BODY], what: 'REPAIR: the row draws a reading the judge accepts, so the reading that is red in this world is shown to go green when its subject is right', apply: (t) => { const row = drawnRow(t); if (row !== null) row.body = repairValue(t) } },
  { name: 'the-marker-merges-the-contribution-into-its-items', declared: [MARKER], what: 'the two sources mixed into the field gate 124 holds to the route', apply: (t) => { const marker = t.drive.marker2 === null || t.drive.marker2 === undefined ? t.drive.marker1 : t.drive.marker2; const row = marker.contributed === null || marker.contributed === undefined ? null : marker.contributed[0]; marker.panel.items = (Array.isArray(marker.panel.items) ? marker.panel.items : []).concat(row === null || row === undefined ? [] : [row]); marker.itemsJson = JSON.stringify(marker.panel.items) } },
  { name: 'the-marker-lost-the-contribution', declared: [MARKER], what: 'a seam that never reached the marker', apply: (t) => { const marker = t.drive.marker2 === null || t.drive.marker2 === undefined ? t.drive.marker1 : t.drive.marker2; marker.contributed = [] } },
  { name: 'the-row-left-the-rail', declared: [PIXELS], what: 'a row drawn outside the column it belongs to', apply: (t) => { const row = drawnRow(t); if (row !== null) { row.inRail = false; row.intersectsRail = false } } },
  { name: 'the-row-rectangle-is-blank', declared: [PIXELS], what: 'nothing inked where the row should be', apply: (t) => { t.drive.screenshots.row.nonBlank = 0 } },
  { name: 'the-body-span-was-not-drawn', declared: [PIXELS], what: 'a reading with no rectangle of its own', apply: (t) => { const row = drawnRow(t); if (row !== null) { row.bodyBox = { x: 0, y: 0, w: 0, h: 0 }; row.bodyCheckVisibility = false } } },
  { name: 'the-rail-is-left-on-another-tab', declared: [PUTBACK], what: 'the world handed to the next gate on a different tab', apply: (t) => { const other = t.entry.rail.chips.filter((chip) => chip.title !== t.entry.rail.selected)[0]; t.exit.rail.selected = other === undefined ? null : other.title } },
  { name: 'our-tab-was-left-open', declared: [PUTBACK], what: 'a pane this gate opened and never took down', apply: (t) => { t.exit.rail.chips = t.exit.rail.chips.concat([{ id: 'tab99', title: t.panel.tabTitle, selected: false, box: { x: 1, y: 1, w: 10, h: 10 } }]); t.exit.rail.paneCount = (t.exit.rail.paneCount === undefined ? 0 : t.exit.rail.paneCount) + 1 } },
  { name: 'this-gate-wrote-a-tracked-file', declared: [PUTBACK, AUDIT], what: 'a gate that leaves a tracked file of its own behind: the world fingerprint and the write audit both see it', apply: (t) => { t.calls.push({ kind: 'file-write', path: '<workspace>//dsh-link/scripts/verify-panel-contribution-render.mjs', purpose: 'a second write' }); t.exit.gitStatus.text = String(t.exit.gitStatus.text) + '\n M dsh-link/scripts/verify-panel-contribution-render.mjs'; t.exit.gitStatus.lines = t.exit.gitStatus.lines.concat([' M dsh-link/scripts/verify-panel-contribution-render.mjs']); t.worldMoved = { appeared: [' M dsh-link/scripts/verify-panel-contribution-render.mjs'], vanished: [], ours: [' M dsh-link/scripts/verify-panel-contribution-render.mjs'], ourWrites: t.calls.filter((row) => row.kind === 'file-write').map((row) => row.path) } } },
  { name: 'the-manifest-moved-under-the-gate', declared: [PUTBACK], what: 'the delivered roster changed mid-run', apply: (t) => { t.exit.manifest[0].sha256 = 'deadbeef' } },
  { name: 'a-key-event-was-sent', declared: [AUDIT], what: 'typing, which this gate may never do', apply: (t) => { t.inputs.push({ kind: 'key', type: 'keyDown', x: 0, y: 0, purpose: 'type-a-note' }); t.inputs.push({ kind: 'key', type: 'keyUp', x: 0, y: 0, purpose: 'type-a-note' }) } },
  { name: 'a-page-expression-was-not-a-read', declared: [AUDIT], what: 'an evaluate that could write the DOM', apply: (t) => { t.probes.push({ name: 'invented', purpose: 'dom-write', source: 'document.body.innerHTML = "x"' }) } },
  { name: 'a-navigating-cdp-method-was-sent', declared: [AUDIT], what: 'navigation, which this gate may never do', apply: (t) => { t.cdpCalls.push({ method: 'Page.navigate', purpose: 'go-elsewhere' }) } },
  { name: 'a-panel-op-outside-the-allowlist', declared: [AUDIT], what: 'a panel operation that is not a read of the turn', apply: (t) => { t.reads.push({ kind: 'panel', op: 'open', purpose: 'open-it-myself' }) } },
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
  console.log('')
  console.log('== the world this gate measured ==')
  console.log('  shell ' + SHELL_ORIGIN + ' | kernel ' + KERNEL_ORIGIN + ' | CDP ' + String(CDP_PORT) + ' (the client was already running: this gate never starts, stops or rebuilds it)')
  console.log('  holder ' + String(t.holder) + ' | transcript schema ' + String(t.schema) + (t.elapsedMs === undefined ? '' : ' | elapsed ' + String(t.elapsedMs) + ' ms'))
  console.log('  the panel own dictionary ' + String(t.panel === null ? '(unread)' : t.panel.path) + ' sha256 ' + clip(String(t.panel === null ? '' : t.panel.sha256), 12) + ' | "tab.title" = ' + show(t.panel === null ? null : t.panel.tabTitle) + ' | "item.meta" = ' + show(t.panel === null ? null : t.panel.itemMeta) + ' | "contrib.title" = ' + show(t.panel === null ? null : t.panel.contribHead))
  console.log('  the panel built artifact carries that title: ' + show(t.panel === null ? null : t.panel.built.carriesTitle) + ' (' + String(t.panel === null ? '(unread)' : t.panel.built.howNamed) + ')')
  console.log('  the DOM names this gate queried with are the artifact own: ' + show(t.dom === null ? null : t.dom.all))
  console.log('  the provider own bundle ' + String(t.provider === null ? '(unread)' : t.provider.bundle.path) + ' sha256 ' + clip(String(t.provider === null ? '' : t.provider.bundle.sha256), 12) + ' (' + String(t.provider === null ? '?' : t.provider.bundle.bytes) + ' bytes)')
  console.log('  the provider own declaration: id ' + show(t.provider === null ? null : t.provider.id) + ' kind ' + show(t.provider === null ? null : t.provider.kind) + ' source ' + show(t.provider === null ? null : t.provider.source) + ' order ' + show(t.provider === null ? null : t.provider.order) + ' marker ' + show(t.provider === null ? null : t.provider.marker) + ' ns ' + show(t.provider === null ? null : t.provider.ns))
  console.log('  the provider own keys and words: title ' + show(t.provider === null ? null : [t.provider.titleKey, t.provider.zh.title]) + ' | pending ' + show(t.provider === null ? null : [t.provider.pendingKey, t.provider.zh.pending]) + ' | error ' + show(t.provider === null ? null : [t.provider.errorKey, t.provider.zh.error]) + ' | key sets zh=' + show(t.provider === null ? null : t.provider.zh.keys) + ' en=' + show(t.provider === null ? null : t.provider.en.keys) + ' and equal=' + show(t.provider === null ? null : same(Object.keys(t.provider.dictionary.zh).sort(), Object.keys(t.provider.dictionary.en).sort())))
  console.log('  ENTRY: phase=' + show(t.entry === null ? null : t.entry.status.phase) + ' kernel pid=' + show(t.entry === null ? null : t.entry.status.pid) + ' version=' + show(t.entry === null ? null : t.entry.status.version) + ' | client ' + show(t.entry === null ? null : t.entry.client) + ' | CDP target ' + show(t.entry === null ? null : t.entry.cdp.targetId))
  console.log('  ENTRY rail: box ' + show(t.entry === null ? null : t.entry.rail.rail) + ' chips ' + show((t.entry === null ? [] : t.entry.rail.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' selected ' + show(t.entry === null ? null : t.entry.rail.selected) + ' guideOpen ' + show(t.entry === null ? null : t.entry.rail.guideOpen) + ' surfaceCount ' + show(t.entry === null ? null : t.entry.rail.surfaceCount))
  console.log('  ENTRY panel: ' + show(t.entry === null ? null : t.entry.panel) + ' | lease ' + show(t.entry === null ? null : t.entry.lease))
  console.log('  ENTRY routes: panel declared.visible=' + show((t.entry === null || t.entry.routes === null ? [] : (t.entry.routes.panel.body.declared === undefined ? [] : t.entry.routes.panel.body.declared.visible)).map((row) => row.id + ':' + row.title)) + ' kinds=' + show(t.entry === null || t.entry.routes === null ? null : (t.entry.routes.panel.body.registry === undefined ? null : t.entry.routes.panel.body.registry.kinds)) + ' kindSinks=' + show(t.entry === null || t.entry.routes === null ? null : (t.entry.routes.panel.body.registry === undefined ? null : t.entry.routes.panel.body.registry.kindSinks)))
  console.log('  single-run guard: ' + String(t.entry === null ? '?' : t.entry.guard.liveFiles) + ' live gate file(s) in the register, other node processes running them: ' + String(t.entry === null ? '?' : t.entry.guard.others.length) + (t.entry !== null && t.entry.guard.others.length > 0 ? ' -> ' + t.entry.guard.others.join(' | ') : ''))
  for (const claim of t.drive === null ? [] : t.drive.claims) console.log('  lease [' + pad(claim.purpose, 44) + '] -> ' + String(claim.action) + ' status=' + String(claim.status) + ' after=' + show(claim.after === undefined ? claim.before : claim.after))
  for (const line of t.drive === null ? [] : t.drive.leaseAfterInput) console.log('    after ' + pad(line.purpose, 32) + ' status=' + String(line.status) + ' held=' + show(line.held) + ' holder=' + show(line.holder) + ' revokedBy=' + show(line.revokedBy) + ' revokedKind=' + show(line.revokedKind) + ' userInputReports=' + show(line.userInputReports))
  console.log('  the door: ' + String(t.drive === null ? null : t.drive.door.used) + (t.drive !== null && t.drive.door.walk.length > 0 ? ' | walk: ' + show(t.drive.door.walk.map((row) => row.chip + ' => guideOpen=' + row.guideOpen)) : ''))
  console.log('  the guide offers ' + String((t.drive === null || t.drive.guide === null || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries).length) + ' capsule(s):')
  for (const row of (t.drive === null || t.drive.guide === null || t.drive.guide.entries === undefined ? [] : t.drive.guide.entries)) console.log('    kind=' + pad(row.kind, 14) + ' title=' + pad(show(row.titleText), 22) + ' description=' + pad(clip(show(row.descriptionText), 30), 32) + ' box=' + show(row.box) + ' glyph=' + show(row.hasGlyph))
  console.log('  our capsule: ' + show(t.drive === null || t.drive.entry === null ? null : { kind: t.drive.entry.kind, title: t.drive.entry.titleText, box: t.drive.entry.box, clickedAt: t.drive.capsuleClick }))
  console.log('  the pane our click opened: chip=' + show(t.drive === null || t.drive.pane === null ? null : t.drive.pane.chip.id) + ' chipText=' + show(t.drive === null || t.drive.pane === null ? null : t.drive.pane.chipTitleText) + ' titleSeat=' + show(t.drive === null || t.drive.pane === null ? null : t.drive.pane.titleSeatText) + ' selected=' + show(t.drive === null || t.drive.pane === null ? null : t.drive.pane.chipSelected) + ' shape=' + String(t.drive === null ? null : t.drive.shape))
  console.log('    body box ' + show(f.pane === null || f.pane === undefined ? null : f.pane.body.box) + ' display=' + show(f.pane === null || f.pane === undefined ? null : f.pane.body.display) + ' visibility=' + show(f.pane === null || f.pane === undefined ? null : f.pane.body.visibility) + ' checkVisibility=' + show(f.pane === null || f.pane === undefined ? null : f.pane.body.checkVisibility) + ' intersectsRail=' + show(f.pane === null || f.pane === undefined ? null : f.pane.body.intersectsRail) + ' rail=' + show(f.pane === null || f.pane === undefined ? null : f.pane.rail))
  console.log('    its own read state: ' + show(f.pane === null || f.pane === undefined ? null : f.pane.readsAttr) + ' | refusals drawn ' + show(f.pane === null || f.pane === undefined ? null : f.pane.refusedRows))
  console.log('    registry item rows drawn: ' + show((f.pane === null || f.pane === undefined ? [] : f.pane.itemRows).map((row) => row.id + ':' + row.title + ' [' + row.kind + ']')))
  console.log('    note rows drawn: ' + show((f.pane === null || f.pane === undefined ? [] : f.pane.noteRows).map((row) => row.id + ':' + clip(String(row.text), 40))))
  console.log('    the contribution section the seam draws: ' + show(f.pane === null || f.pane === undefined ? null : f.pane.contributed))
  for (const row of f.rows) console.log('    CONTRIBUTED ROW: id=' + show(row.id) + ' kind=' + show(row.kind) + ' source=' + show(row.source) + ' box=' + show(row.box) + ' line=' + show(row.line))
  for (const row of f.rows) {
    console.log('      title   ' + show(row.title) + ' at ' + show(row.titleBox) + ' (' + String(row.titleLength) + ' chars)')
    console.log('      meta    ' + show(row.meta) + ' at ' + show(row.metaBox))
    console.log('      body    ' + show(row.body) + ' at ' + show(row.bodyBox) + ' (' + String(row.bodyLength) + ' chars, checkVisibility ' + show(row.bodyCheckVisibility) + ', inRail ' + show(row.bodyInRail) + ')')
    console.log('      drawn   checkVisibility=' + show(row.checkVisibility) + ' inRail=' + show(row.inRail) + ' intersectsRail=' + show(row.intersectsRail) + ' inWindow=' + show(row.inWindow) + ' attributes=' + show(row.attributes))
  }
  if (t.drive !== null && t.drive.settle !== null && t.drive.settle !== undefined) console.log('  the two reads ' + String(t.drive.settle.ms) + ' ms apart: body #1 ' + show(t.drive.settle.firstBody) + ' -> body #2 ' + show(t.drive.settle.secondBody) + ' (moved=' + show(t.drive.settle.bodyMoved) + ') while the provider own line moved=' + show(t.drive.settle.providerMoved))
  console.log('  the two markers beside the settled pane:')
  console.log('    __dshLinkPanel keys ' + show(f.markerKeys) + ' itemsJson ' + clip(show(f.markerItemsJson), 200))
  console.log('    __dshLinkPanel.items byte-for-byte the route own declared.visible: ' + show(f.route === null || f.route === undefined ? null : f.markerItemsJson === JSON.stringify(f.route.body.declared.visible)))
  console.log('    __dshLinkPanel.contributed ' + show(f.markerContributed))
  console.log('    ' + String(t.provider === null ? '(the provider marker)' : '__' + 'dshLanBridgePanel') + ' ' + show(f.markerProvider))
  console.log('  pixels row : ' + show(t.drive === null ? null : t.drive.screenshots.row))
  console.log('  pixels body: ' + show(t.drive === null ? null : t.drive.screenshots.body))
  for (const step of t.restore === null ? [] : t.restore.steps) console.log('  restore: ' + step)
  console.log('  EXIT rail: chips ' + show((t.exit === null || t.exit.rail === null ? [] : t.exit.rail.chips).map((chip) => chip.title + (chip.selected ? '*' : ''))) + ' selected ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.selected) + ' surfaceCount ' + show(t.exit === null || t.exit.rail === null ? null : t.exit.rail.surfaceCount))
  console.log('  EXIT panel: ' + show(t.exit === null ? null : t.exit.panel) + ' | lease ' + show(t.exit === null ? null : t.exit.lease) + ' | client ' + show(t.exit === null ? null : t.exit.client) + ' | git status lines ' + String(t.exit === null || t.exit.gitStatus === null ? '?' : t.exit.gitStatus.lines.length))
  console.log('  the file this gate wrote: ' + show(t.write === undefined ? null : t.write.path) + ' (' + String(t.write === undefined ? '?' : t.write.bytes) + ' bytes, inside the git-ignored scratch path ' + String(t.write === undefined ? '?' : t.write.insideScratch) + ')')
  console.log('  NOT MEASURED HERE (named): whether the drawn body is fresh at every instant (this gate reads two moments, not a clock); any locale other than this one; the native browser panel (this gate never opens, places or closes it); the note write path (this gate types nothing); whether a second click on the same tab behaves')
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
  console.log('gate 128 panel-contribution-render - what the panel draws for ANOTHER package contribution (shell ' + SHELL_ORIGIN + ', kernel ' + KERNEL_ORIGIN + ', CDP ' + String(CDP_PORT) + ')')
  console.log('  single run only: this gate drives the rail, opens the LINK panel and reads the contributed row; it clicks only to select its own tab and to put the world back')
  let transcript = null
  if (REPLAY_PATH !== null) {
    const read = readJson(resolve(REPLAY_PATH))
    if (read.ok !== true) {
      console.log('')
      console.log('SKIP: the transcript to replay could not be read at ' + resolve(REPLAY_PATH) + ' (' + read.why + ')')
      return 3
    }
    transcript = read.value
    if (transcript === null || transcript === undefined || transcript.schema !== 'r192-g128-transcript/1' || transcript.entry === undefined || transcript.provider === undefined || transcript.inputs === undefined) {
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
      console.log('panel-contribution-render: 0 readings, 0 failed, 0 measured - this gate declined to measure [exit 3]')
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
    if (stopped) {
      console.log('panel-contribution-render: ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured - the self-attack does not start on a drive that did not reach the end or a world that moved')
      return 1
    }
    const attack = selfAttack(transcript)
    console.log('panel-contribution-render --self-attack: ' + String(MUTANTS.length) + ' mutants, ' + (attack === 0 ? 'every declared set == observed set' : 'SOME MUTANTS DID NOT LAND WHERE DECLARED') + ', ' + String(held.length) + ' readings held, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured')
    return attack === 0 ? (failed.length > 0 ? 1 : notMeasured.length > 0 ? 3 : 0) : 1
  }
  console.log('panel-contribution-render: ' + String(verdicts.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured [live shell at ' + SHELL_ORIGIN + '; clicks ' + String((transcript.inputs === undefined ? [] : transcript.inputs).length / 2) + ', kernel GETs ' + String((transcript.reads === undefined ? [] : transcript.reads).filter((read) => read.kind === 'http' && read.target === 'kernel').length) + ', panel ops ' + show([...new Set((transcript.reads === undefined ? [] : transcript.reads).filter((read) => read.kind === 'panel').map((read) => read.op))]) + ', model rounds 0]')
  if (stopped) {
    for (const problem of problems) console.log('SKIP: ' + problem)
    for (const note of worldMoved) console.log('SKIP: ' + note)
    console.log('panel-contribution-render: ' + (problems.length > 0 ? 'the drive could not be carried to the end' : 'the world moved under this gate') + ', so nothing above is a verdict on the product [exit 3]')
    return 3
  }
  if (failed.length > 0) return 1
  if (notMeasured.length > 0) {
    for (const verdict of notMeasured) console.log('SKIP: ' + verdict.id + ' -> ' + clip(verdict.detail, 300))
    console.log('panel-contribution-render: a reading could not be measured, so this is a named third state, not a verdict on the product [exit 3]')
    return 3
  }
  return 0
}

process.exitCode = await main()
