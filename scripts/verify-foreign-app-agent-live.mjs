#!/usr/bin/env node
/**
 * Gate P1 (R200) - foreign-app-agent-live: DSH's AGENT DRIVING A FOREIGN APPLICATION, judged by the
 * application's own state and not by anything the model says.
 *
 * Contract: docs/handoff/R200-contract.md section 2 (P1, five readings). Subject: <workspace>//example-app,
 * a Vite + three.js chemistry sandbox on 127.0.0.1:4177 that publishes window.__CHEMLAB__ =
 * { controller, stage, bundle, ready, buildId, locateContainer(id), ui } (example-app
 * src/app/bootstrap.ts:171-187). This gate did not write that app and does not change it: it reads the
 * app's source for a read-only state face, drives ONE real agent round through the shell's own session
 * API, and then believes only the app itself.
 *
 * R73 alive-control: EXEMPT, with the reason - this gate boots no kernel of its own and holds no ctx: it
 * drives the RUNNING client through that client's own session API and reads the foreign application through
 * CDP, so it has no root-provided service it could take an aliveness reading from. Its witness is the shell
 * answering its session calls, the client/kernel pids being identical at entry and exit, and the app's own
 * state face moving exactly as the task asked - all three recorded in its readings.
 *
 * READ-ONLY STATE FACE (step 0, taken BEFORE the drive is written): the face this gate reads is
 * controller.getSnapshot() - an AppSnapshot of plain data (example-app src/app/controller.ts:154
 * 'getSnapshot: () => store.getSnapshot()'), reached through the hook, plus the UI handle's own published
 * root attributes (example-app src/ui/testHook.ts:28-33 publishes __CHEMLAB__.ui). Read out of the hook in
 * one expression: ready, buildId, ui.isAppReady(), mode, ui.selectedContainerId, ui.heldSid,
 * ui.activeTaskId, ui.activeExperimentId, sim.paused, ui.root.dataset.{entryOpen,shelfOpen,
 * selectedContainer}, the accepted-op count, and every container's liquid volume and solid count.
 * NOTHING here is a screenshot and nothing is a claim by the model. If either the source GETTER or the
 * live hook is missing, this gate cannot judge the attachment and says so BY NAME (exit 3, NO_STATE_FACE)
 * instead of falling back to pixels.
 *
 * THE DRIVE, and its one cost: ONE session (POST /api/session/create) and ONE prompt
 * (/api/session/prompt) through the shell's own API, the same route gates 117 and 134 use. The message
 * names the app, names the browser tools, and names ONE state-changing action a user could perform: on
 * the app's opening card choose '自由探索', then click the beaker's container chip so the beaker becomes
 * the SELECTED container. The model is told not to write code and not to touch the app's files.
 *
 * WHAT IS READ, and where (all of it measured, none of it assumed)
 *   the session log (POST /api/session/page)   every tool/call and tool/result with its event time: which
 *                                             browser tools the model really called, whether each one
 *                                             errored, and the assistant's last words when it did not
 *                                             drive at all.
 *   the app's own state face                   through the shell's own panel protocol call
 *                                             (POST /__shell/panel {op:'cdp', method:'Runtime.evaluate',
 *                                             tab:<id>}) against THE PAGE THAT CARRIES THE APP. The gate
 *                                             does NOT assume a target: every 400 ms it reads the panel's
 *                                             tab set (/__shell/panel op=state) and evaluates the face in
 *                                             whichever tab's URL is the app's - the browser tool opens
 *                                             its own tab and the gate finds it, tab id and all. The panel
 *                                             is one native child webview per tab (measured: 1280x800 CSS
 *                                             at scale 0.4063 into a 520x700 surface), so the app's
 *                                             state face is reachable only through that tab.
 *   the world                                  the shell page target (9222 /json/list), the panel's own
 *                                             report, and the client/kernel pids, at entry and at exit.
 *
 * THE FIXED VIEWPORT FACT (the contract's coordinate note, re-measured here): the panel runs in 'fixed'
 * mode, so the page's CSS viewport IS the shell's pinned 1280x800 no matter how big the surface is, and
 * the input channel divides by the fit scale (plugins/dsh-browser/lib/session.js:465-494). The gate
 * places the surface itself (op=surface) because a panel with no surface parks its tabs at 2x2 and even
 * refuses op=tab-new by name ("tab-new needs a surface", measured in the log of an earlier session this
 * gate read). The gate leaves the surface exactly as it found it.
 *
 * THE LEASE, and why it is released for the round: the panel lease is the SHELL's permit to write
 * geometry, and it refuses ANY other holder by name (src-tauri/src/core/sidebar_panel.rs:966-1000,
 * measured: "the panel is leased by X and not by dsh-browser"). The browser tools write as
 * 'dsh-browser', so a gate that held the lease through the round would refuse the very drive it is
 * judging. So: the gate claims the lease to place the surface and to restore the world, and RELEASES it
 * before the one prompt; the single-run guarantee during the round is the process guard below (no other
 * verify-/probe- consumer may be running), and the lease is read again at exit (must not be held).
 *
 * SIX READINGS, each able to fail on its own evidence:
 *   0-the-app-publishes-a-read-only-state-face-this-gate-can-read
 *        The source declares a JSON-serialisable getter at a named file and line, and the live hook
 *        answered it. This is step 0 of the contract: no state face, no judgement.
 *   1-the-app-was-open-in-a-tab-the-browser-tools-drive-with-its-hook-ready
 *        Some panel tab's URL is the app origin, and in THAT tab window.__CHEMLAB__.ready === true with a
 *        non-empty buildId string. The tab id is the gate's own discovery, printed with the reading.
 *   2-the-model-called-the-browser-tools-the-message-named
 *        From the session log: one prompt, at least one successful navigation tool (browser_open /
 *        browser_goto / browser_tab_new) that landed the app, and at least one successful real input
 *        tool (browser_pick / browser_click). Named and timed, with the errored calls if any, and with
 *        any write/pwsh call that names the foreign app's files - that would be the wrong kind of drive.
 *   3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for
 *        BEFORE (first ready face read) vs AFTER (last ready face read, taken after turn/end): the
 *        selected container went null -> 'demo-1', the opening card went open -> closed, and EVERY other
 *        field of the face is identical (mode, held substance, active task/experiment, paused, shelf,
 *        accepted-op count, every container's liquid and solids). At least one successful browser input
 *        must have landed BETWEEN the two reads. A different delta is red, not a shrug.
 *   4-nothing-else-moved-and-the-world-was-put-back
 *        The shell page target (URL, title, readyState, navigation history) is untouched; the panel's tab
 *        set, URLs and active tab are the entry ones again; a tab the model opened is closed; the surface
 *        is null again; the lease is not held; the client and kernel pids are identical; exactly one new
 *        session exists (this gate's, left open as the evidence) and no other session advanced.
 *   5-every-way-to-fail-honestly-is-a-named-third-state
 *        The meta-reading: every reading that could not be judged carries a NAME (NO_STATE_FACE,
 *        APP_NOT_UP, NO_PANEL, LEASE_BUSY, PANEL_NOT_PLACEABLE, MODEL_PROSE, MODEL_REFUSED,
 *        MODEL_TOOL_ERROR, APP_NOT_OPENED, HOOK_UNREACHABLE, DELTA_NOT_ATTRIBUTED, ROUND_NOT_ENDED,
 *        ANOTHER_CONSUMER), and a run with any unmeasured reading exits 3 rather than 0. A third state is
 *        never green.
 *
 * WHAT THIS GATE DOES NOT DO: no pixels as state, no approval driving, no restart of the client or the
 * kernel (a restart is NAMED as a third state), no second prompt, no write into the foreign app's
 * repository, and no judgement about whether the model "understood" the app: judgement is the app's own
 * state face plus the execution record.
 *
 * --replay [file] re-judges a transcript this gate wrote and touches nothing (no shell call, no CDP, no
 * lease, zero prompts); with no file it takes the newest transcript under the scratch path. The
 * transcript is written to %TEMP%/r200-p1-foreign-app/ by default (--dump <file> to put it elsewhere);
 * this gate writes no file inside the repository.
 *
 * Exit 0 every reading held | 1 a measured reading failed | 3 a reading could not be measured (named).
 *
 * Usage: node scripts/verify-foreign-app-agent-live.mjs [--port 31761] [--kernel-port 31760]
 *          [--cdp 9222] [--app-port 4177] [--app-root <workspace>//example-app]
 *          [--deadline-ms 300000] [--lease-wait-ms 60000] [--dump <file>] [--replay [file]]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The project root, found by walking up: the gate runs from scripts/ or from .tmp/. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = (() => {
  let at = HERE
  for (let step = 0; step < 8; step += 1) {
    if (existsSync(join(at, 'scripts', 'verify-all.mjs')) && existsSync(join(at, 'plugins'))) return at
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
const CDP_PORT = Number(option('--cdp', '9222'))
const APP_PORT = Number(option('--app-port', '4177'))
const APP_ROOT = resolve(option('--app-root', '<workspace>//example-app'))
const DEADLINE_MS = Number(option('--deadline-ms', '300000'))
const LEASE_WAIT_MS = Number(option('--lease-wait-ms', '60000'))
const LEASE_TTL_MS = 420000
const REPLAY = has('--replay') ? (option('--replay', null) ?? 'latest') : null
const DUMP_OPTION = option('--dump', null)

const SHELL_ORIGIN = 'http://127.0.0.1:' + String(PORT)
const CDP_ORIGIN = 'http://127.0.0.1:' + String(CDP_PORT)
const APP_ORIGIN = 'http://127.0.0.1:' + String(APP_PORT)
const APP_PATH = '/'
const TICK_MS = 400
/** The panel surface this gate declares while it works; the app's page viewport is the shell's 1280x800 anyway. */
const SURFACE = { x: 600, y: 90, w: 520, h: 700 }
const HOLDER = 'gate-r200-foreign-app-agent-live'
const SCHEMA = 'r200-p1-transcript/1'
const SESSION_POLL_EVERY = 5

/** The one message. It names the app, the tools, and the two clicks a user would make. */
const MESSAGE = [
  '请替我操作右侧栏浏览器里的 example-app（http://127.0.0.1:4177）。只用手操作：不要写代码，不要用 pwsh/write/edit，也不要改那个项目的任何文件。',
  '',
  '1) 用 browser_open 打开 http://127.0.0.1:4177（如果不该占着用户正在看的标签，可以先 browser_tab_new 开一个你自己的标签再在那里打开）；',
  '2) 用 browser_shot 看一眼页面；',
  '3) 首屏有一张「想怎么开始？」的分流卡片：用 browser_controls 找到「自由探索」按钮，再用 browser_pick 点它（只点这一个，不要点「跟着做一个实验」和「做一道题」）；',
  '4) 卡片关掉后，左侧货架底部的「操作台容器」里有一个「烧杯 1」按钮：先重新 browser_controls，再 browser_pick 点它，让这个烧杯成为当前选中的容器。',
  '',
  '就这两次点击。做完告诉我你看到了什么。',
].join('\n')

/**
 * The state face, read in the page that carries the app through the shell's own protocol call.
 * Written as an expression (not a file) so the WIRE is this gate's, and every field it returns is plain
 * JSON: nothing here is a screenshot and nothing here is the model's word.
 */
const FACE_EXPRESSION = [
  '(() => {',
  '  const h = window.__CHEMLAB__',
  '  if (h === undefined || h === null) return JSON.stringify({ hook: false })',
  '  const ui = h.ui === undefined ? null : h.ui',
  '  let snapshot = null',
  '  try { snapshot = h.controller.getSnapshot() } catch (error) { return JSON.stringify({ hook: true, error: String(error && error.message ? error.message : error) }) }',
  '  if (snapshot === null || typeof snapshot !== "object") return JSON.stringify({ hook: true, error: "getSnapshot answered no object" })',
  '  const world = snapshot.world === undefined ? {} : snapshot.world',
  '  const containers = Object.keys(world.containers === undefined ? {} : world.containers).sort().map((id) => {',
  '    const row = world.containers[id]',
  '    const liquid = row.liquid === null || row.liquid === undefined ? null : { ml: row.liquid.volumeMl, sid: row.liquid.sid === undefined ? null : row.liquid.sid, tempC: row.liquid.tempC }',
  '    return { id: id, liquid: liquid, solids: row.solids === undefined ? 0 : row.solids.length }',
  '  })',
  '  const logs = Array.isArray(snapshot.logs) ? snapshot.logs : []',
  '  const root = ui !== null && ui.root !== undefined && ui.root !== null ? ui.root : null',
  '  const dataset = root !== null && root.dataset !== undefined ? root.dataset : {}',
  '  return JSON.stringify({',
  '    hook: true,',
  '    ready: h.ready === true,',
  '    buildId: typeof h.buildId === "string" && h.buildId !== "" ? h.buildId : null,',
  '    appReady: ui === null || typeof ui.isAppReady !== "function" ? null : ui.isAppReady() === true,',
  '    hasUi: ui !== null,',
  '    mode: snapshot.mode === undefined ? null : snapshot.mode,',
  '    selected: snapshot.ui === undefined || snapshot.ui.selectedContainerId === undefined ? null : snapshot.ui.selectedContainerId,',
  '    held: snapshot.ui === undefined || snapshot.ui.heldSid === undefined ? null : snapshot.ui.heldSid,',
  '    activeTask: snapshot.ui === undefined || snapshot.ui.activeTaskId === undefined ? null : snapshot.ui.activeTaskId,',
  '    activeExperiment: snapshot.ui === undefined || snapshot.ui.activeExperimentId === undefined ? null : snapshot.ui.activeExperimentId,',
  '    paused: snapshot.sim === undefined ? null : snapshot.sim.paused === true,',
  '    entryOpen: dataset.entryOpen === undefined ? null : dataset.entryOpen,',
  '    shelfOpen: dataset.shelfOpen === undefined ? null : dataset.shelfOpen,',
  '    selectedAttr: dataset.selectedContainer === undefined ? null : dataset.selectedContainer,',
  '    accepted: logs.filter((row) => row !== null && typeof row === "object" && row.accepted === true).length,',
  '    logs: logs.length,',
  '    containers: containers,',
  '    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },',
  '    href: String(location.href)',
  '  })',
  '})()',
].join('\n')

/** The source facts step 0 reads, with the needles that prove the face is DECLARED (not inferred). */
const FACE_SOURCES = [
  { path: 'src/app/bootstrap.ts', why: 'the hook is assigned on window here', needles: ['window.__CHEMLAB__', 'controller,', 'locateContainer'] },
  { path: 'src/app/controller.ts', why: 'the controller publishes a snapshot getter', needles: ['getSnapshot: () => store.getSnapshot()'] },
  { path: 'src/ui/testHook.ts', why: 'the UI handle is published on the hook', needles: ['__CHEMLAB__.ui'] },
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const show = (value) => {
  try {
    const text = JSON.stringify(value === undefined ? null : value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}
const describe = (error) => String(error !== null && error !== undefined && error.message !== undefined ? error.message : error)
const clip = (text, n) => {
  const out = String(text === null || text === undefined ? '' : text)
  return out.length > n ? out.slice(0, n) + '...' : out
}

class NotMeasured extends Error {
  constructor(name, reason) {
    super(name + ': ' + reason)
    this.name = 'NotMeasured'
    this.code = name
    this.reason = reason
  }
}

// ---------------------------------------------------------------------------
// The machine: pids, other live consumers
// ---------------------------------------------------------------------------
const pwsh = (command, timeout = 30000) => {
  const done = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout, windowsHide: true })
  if (done.error !== undefined && done.error !== null) return { status: null, stdout: '', stderr: String(done.error.message ?? done.error), why: describe(done.error) }
  return { status: done.status, stdout: String(done.stdout ?? ''), stderr: String(done.stderr ?? '') }
}

/** Which process listens on the shell port and on the kernel port, and when it started. */
const pidFingerprint = () => {
  const query = [
    '$out = @()',
    'foreach ($port in @(' + String(PORT) + ',' + String(KERNEL_PORT) + ',' + String(APP_PORT) + ')) {',
    '  $row = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if ($row -eq $null) { $out += ($port.ToString() + "|||") ; continue }',
    '  $proc = Get-Process -Id $row.OwningProcess -ErrorAction SilentlyContinue',
    '  $name = ""; $start = ""',
    '  if ($proc -ne $null) { $name = $proc.ProcessName; $start = $proc.StartTime.ToUniversalTime().ToString("o") }',
    '  $out += ($port.ToString() + "|" + $row.OwningProcess.ToString() + "|" + $name + "|" + $start)',
    '}',
    '$out -join ([string][char]10)',
  ].join('\n')
  const done = pwsh(query)
  if (done.status !== 0) return { ok: false, why: clip(String(done.stderr ?? done.why ?? 'pwsh exited ' + String(done.status)), 240), rows: [] }
  const rows = String(done.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const parts = line.split('|')
      return {
        port: Number(parts[0]),
        pid: parts[1] === '' || parts[1] === undefined ? null : Number(parts[1]),
        name: parts[2] === '' || parts[2] === undefined ? null : parts[2],
        start: parts[3] === '' || parts[3] === undefined ? null : parts[3],
      }
    })
  return { ok: true, why: null, rows }
}
const pidRow = (fingerprint, port) => {
  const rows = fingerprint !== null && fingerprint.ok === true && Array.isArray(fingerprint.rows) ? fingerprint.rows : []
  return rows.find((row) => row.port === port) ?? null
}
const pidText = (row) => (row === null || row === undefined || row.pid === null ? '(not read)' : 'pid ' + String(row.pid) + ' ' + String(row.name) + ' since ' + String(row.start))
const pidKey = (row) => (row === null || row === undefined || row.pid === null ? null : String(row.pid) + '@' + String(row.start))

/** Every node process, so "another live consumer" is read from the machine, not assumed. */
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
/** This gate's own ancestor chain, so "another consumer" is never this process's own parent. */
const ancestorPids = () => {
  const query = '$ids = @(); $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID);'
    + ' for ($i = 0; $i -lt 12 -and $p -ne $null; $i++) { $ids += [string]$p.ProcessId;'
    + ' if ($p.ParentProcessId -eq 0) { break }; $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [string]$p.ParentProcessId) -ErrorAction SilentlyContinue }'
    + ' [string]::Join(",", $ids)'
  const done = pwsh(query, 20000)
  if (done.status !== 0) return []
  return String(done.stdout ?? '').trim().split(',').map((id) => id.trim()).filter((id) => id !== '')
}
const liveGateFiles = () => {
  const path = join(PROJECT, 'scripts', 'verify-all.mjs')
  if (existsSync(path) === false) return { files: [] }
  const files = new Set()
  const text = readFileSync(path, 'utf8')
  for (const row of text.matchAll(/\{\s*name:\s*'([^']+)',\s*kind:\s*'(offline|live|kernel)',\s*cmd:\s*\[([^\]]*)\]/g)) {
    if (row[2] !== 'live') continue
    for (const word of row[3].split(',')) {
      const clean = word.trim().replace(/^'|'$/g, '')
      if (/\.mjs$/.test(clean)) files.add(clean.split('/').pop())
    }
  }
  return { files: [...files] }
}
const otherConsumers = (rows, live, ancestors) => {
  const mine = new Set([String(process.pid), String(process.ppid), ...(ancestors ?? [])])
  for (let step = 0; step < 8; step += 1) {
    for (const row of rows) if (mine.has(row.pid) && row.ppid !== '0' && row.ppid !== '') mine.add(row.ppid)
  }
  const SELF = 'verify-foreign-app-agent-live.mjs'
  return rows
    .filter((row) => {
      if (mine.has(row.pid)) return false
      if (row.command.includes(SELF)) return false
      if (live.files.length > 0) return live.files.some((file) => row.command.includes(file))
      return /(verify|probe)-[a-z0-9-]+\.mjs/.test(row.command)
    })
    .map((row) => 'pid ' + row.pid + ' ' + clip(row.command, 140))
}

// ---------------------------------------------------------------------------
// The wire: the shell's own HTTP surfaces
// ---------------------------------------------------------------------------
const httpFetch = async (url, init = {}, timeoutMs = 12000) => {
  try {
    const answer = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    const text = await answer.text()
    return { ok: answer.status === 200, status: answer.status, text, why: answer.status === 200 ? null : 'HTTP ' + String(answer.status) }
  } catch (error) {
    return { ok: false, status: null, text: '', why: describe(error) }
  }
}
/** One shell panel op. No throw: a refusal is a reading, and the shell's own sentence is kept. */
const panelPost = async (payload, timeoutMs = 20000) => {
  const answer = await httpFetch(SHELL_ORIGIN + '/__shell/panel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }, timeoutMs)
  let body = null
  try {
    body = JSON.parse(answer.text)
  } catch {
    body = null
  }
  return { status: answer.status, ok: answer.ok, body, text: clip(answer.text, 300), why: answer.why }
}
const panelState = async () => {
  const answer = await panelPost({ op: 'state' }, 10000)
  if (answer.ok !== true || answer.body === null) return { ok: false, why: answer.why ?? 'the shell panel answered something that is not JSON', state: null }
  return { ok: true, why: null, state: answer.body }
}
const tabsOf = (state) => {
  const rows = state !== null && state !== undefined && Array.isArray(state.tabs) ? state.tabs : []
  return rows.map((row) => ({
    id: String(row?.id ?? ''),
    url: String(row?.url ?? ''),
    active: row?.active === true,
    live: row?.live === true,
    title: row?.title === null || row?.title === undefined ? null : String(row.title),
  }))
}
/** One protocol call against ONE tab, through the shell's own panel CDP op. */
const panelCdp = async (tab, method, params, timeoutMs = 10000) => {
  const payload = { op: 'cdp', method, params, timeoutMs }
  if (tab !== null && tab !== undefined) payload.tab = tab
  const answer = await panelPost(payload, timeoutMs + 6000)
  if (answer.ok !== true || answer.body === null) return { ok: false, why: answer.why ?? 'no answer', cdp: null, state: null }
  if (answer.body.ok !== true) return { ok: false, why: String(answer.body.error ?? 'the shell refused the protocol call'), cdp: null, state: answer.body.state ?? null }
  return { ok: true, why: null, cdp: answer.body.cdp ?? null, state: answer.body.state ?? null }
}
/**
 * Runtime.evaluate in one tab, unwrapped to its value.
 *
 * The shell may hand back the whole protocol envelope ({"id":..,"result":{..}}) or the inner result
 * alone ({"type":"string","value":..}) - plugins/dsh-browser/lib/session.js:139-146 records both shapes
 * from the same route. This reads all three: no assumption about which one arrives.
 */
const unwrapEvaluate = (parsed) => {
  if (parsed === null || typeof parsed !== 'object') return { ok: false, why: 'the protocol answered no object' }
  const inner = parsed.result !== undefined && parsed.result !== null && typeof parsed.result === 'object' && parsed.id !== undefined ? parsed.result : parsed
  const details = inner.exceptionDetails ?? parsed.exceptionDetails ?? null
  if (details !== null && details !== undefined) {
    const text = String(details?.exception?.description ?? details?.text ?? 'exception')
    return { ok: false, why: 'the evaluation threw: ' + clip(text, 240) }
  }
  if (inner.result !== undefined && inner.result !== null && typeof inner.result === 'object' && inner.result.type !== undefined) return { ok: true, value: inner.result.value }
  if (inner.type !== undefined) return { ok: true, value: inner.value }
  if (inner.result !== undefined && inner.result !== null && typeof inner.result === 'object') return { ok: true, value: inner.result.value ?? null }
  return { ok: false, why: 'the protocol answered a shape this gate does not read: ' + clip(show(parsed), 160) }
}
const evaluateIn = async (tab, expression) => {
  const answer = await panelCdp(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (answer.ok !== true) return { ok: false, why: answer.why, value: null }
  let parsed = null
  try {
    parsed = JSON.parse(String(answer.cdp))
  } catch (error) {
    return { ok: false, why: 'the protocol answered something that is not JSON (' + describe(error) + ')', value: null }
  }
  const unwrapped = unwrapEvaluate(parsed)
  if (unwrapped.ok !== true) return { ok: false, why: unwrapped.why, value: null }
  return { ok: true, why: null, value: unwrapped.value ?? null }
}
/** The app's own state face, read in the tab that carries it. */
const readFace = async (tab) => {
  const answer = await evaluateIn(tab, FACE_EXPRESSION)
  if (answer.ok !== true) return { ok: false, why: answer.why, face: null }
  if (typeof answer.value !== 'string') return { ok: false, why: 'the face expression did not return a string', face: null }
  let face = null
  try {
    face = JSON.parse(answer.value)
  } catch (error) {
    return { ok: false, why: 'the face is not JSON (' + describe(error) + ')', face: null }
  }
  if (face === null || typeof face !== 'object') return { ok: false, why: 'the face is not an object', face: null }
  return { ok: true, why: null, face }
}

// ---------------------------------------------------------------------------
// The shell page: one CDP socket, and the session API called in the page's own origin
// ---------------------------------------------------------------------------
const cdpPages = async () => {
  const answer = await httpFetch(CDP_ORIGIN + '/json/list', {}, 8000)
  if (answer.ok !== true) return { ok: false, why: 'CDP ' + String(CDP_PORT) + ' did not answer /json/list (' + String(answer.why) + ')', pages: [] }
  let targets = null
  try {
    targets = JSON.parse(answer.text)
  } catch (error) {
    return { ok: false, why: 'CDP /json/list answered something that is not JSON (' + describe(error) + ')', pages: [] }
  }
  const pages = (Array.isArray(targets) ? targets : [])
    .filter((target) => target?.type === 'page')
    .map((target) => ({ id: String(target.id), url: String(target.url), title: String(target.title ?? ''), ws: String(target.webSocketDebuggerUrl ?? '') }))
  return { ok: true, why: null, pages }
}
const isShellPage = (page) => page.url === SHELL_ORIGIN || page.url === SHELL_ORIGIN + '/' || page.url.startsWith(SHELL_ORIGIN + '/')

const connectCdp = async (wsUrl, label) => {
  const socket = new WebSocket(wsUrl)
  const opened = await new Promise((settle) => {
    socket.addEventListener('open', () => settle(true), { once: true })
    socket.addEventListener('error', () => settle(false), { once: true })
    setTimeout(() => settle(false), 12000)
  })
  if (opened !== true) {
    try { socket.close() } catch { /* the OS reaps it */ }
    return { ok: false, why: 'the CDP socket of the ' + label + ' did not open' }
  }
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const settle = pending.get(message.id)
    if (settle !== undefined) {
      pending.delete(message.id)
      settle(message)
    }
  })
  const send = async (method, params = {}, timeoutMs = 12000) => {
    const id = nextId
    nextId += 1
    const answer = await new Promise((settle) => {
      pending.set(id, settle)
      socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => settle(null), timeoutMs)
    })
    if (answer === null) return { ok: false, why: method + ' never answered', result: null }
    if (answer.error !== undefined) return { ok: false, why: method + ' answered an error: ' + clip(String(answer.error.message ?? answer.error), 200), result: null }
    return { ok: true, why: null, result: answer.result }
  }
  const evaluate = async (expression, timeoutMs = 12000) => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)
    if (answer.ok !== true) return { ok: false, why: answer.why, value: null }
    const details = answer.result?.exceptionDetails ?? null
    if (details !== null) return { ok: false, why: 'the evaluation threw: ' + clip(String(details?.exception?.description ?? details?.text ?? 'exception'), 240), value: null }
    return { ok: true, why: null, value: answer.result?.result?.value ?? null }
  }
  /** One call to the shell's own /api, from the page's own origin, with the shell's own envelope. */
  const call = async (method, args, rpcId) => {
    const envelope = { type: 'client-request', rpcId, method, payload: { args } }
    const expression = '(async () => { const r = await fetch(' + JSON.stringify('/api/' + method) + ', {'
      + ' method: "POST", headers: { "content-type": "application/json" },'
      + ' body: JSON.stringify(' + JSON.stringify(envelope) + ') });'
      + ' return JSON.stringify({ status: r.status, body: await r.text() }); })()'
    const answer = await evaluate(expression)
    if (answer.ok !== true) throw new Error(method + ' evaluate failed: ' + String(answer.why))
    const parsed = JSON.parse(String(answer.value))
    const reply = JSON.parse(parsed.body)
    if (reply?.result?.ok === false) throw new Error(method + ' was refused: ' + show(reply.result.error))
    if (parsed.status !== 200) throw new Error(method + ': HTTP ' + String(parsed.status))
    return { status: parsed.status, value: reply?.result?.value ?? null }
  }
  return { ok: true, why: null, send, evaluate, call, close: () => { try { socket.close() } catch { /* the OS reaps it */ } } }
}

/** The world entry tab's own fingerprint: where it is, what it says, how far its history has gone. */
const entryFingerprint = async (page) => {
  const session = await connectCdp(page.ws, 'world entry tab')
  if (session.ok !== true) return { ok: false, why: session.why, href: null, title: null, readyState: null, history: null }
  try {
    await session.send('Page.enable', {})
    const history = await session.send('Page.getNavigationHistory', {})
    const stated = await session.evaluate('JSON.stringify({ href: String(location.href), title: String(document.title), ready: String(document.readyState), chemGlobal: typeof window.__CHEMLAB__ })')
    let value = null
    try {
      value = stated.ok === true ? JSON.parse(String(stated.value)) : null
    } catch {
      value = null
    }
    const rows = history.ok === true && Array.isArray(history.result?.entries) ? history.result.entries : null
    return {
      ok: stated.ok === true,
      why: stated.ok === true ? null : stated.why,
      href: value === null ? null : value.href,
      title: value === null ? null : value.title,
      readyState: value === null ? null : value.ready,
      chemGlobal: value === null ? null : value.chemGlobal,
      history: rows === null ? null : { entries: rows.length, currentIndex: history.result?.currentIndex ?? null, last: String(rows[rows.length - 1]?.url ?? '') },
    }
  } finally {
    session.close()
  }
}

// ---------------------------------------------------------------------------
// Step 0: the read-only state face, read out of the app's own source BEFORE the drive
// ---------------------------------------------------------------------------
const readFaceSource = () => {
  if (existsSync(APP_ROOT) !== false) {
    const rows = []
    let complete = true
    for (const source of FACE_SOURCES) {
      const path = join(APP_ROOT, source.path)
      if (existsSync(path) !== true) {
        complete = false
        rows.push({ path: source.path, ok: false, why: 'not readable at ' + path, needles: [] })
        continue
      }
      const text = readFileSync(path, 'utf8')
      const lines = text.split(/\r?\n/)
      const found = source.needles.map((needle) => {
        const at = lines.findIndex((line) => line.includes(needle))
        return { needle, line: at === -1 ? null : at + 1 }
      })
      const ok = found.every((row) => row.line !== null)
      if (ok !== true) complete = false
      rows.push({ path: source.path, why: source.why, ok, bytes: Buffer.byteLength(text, 'utf8'), lines: lines.length, needles: found })
    }
    const getter = rows.find((row) => row.path === 'src/app/controller.ts') ?? null
    return { ok: complete, why: complete === true ? null : 'the app source at ' + APP_ROOT + ' does not declare every part of the face this gate reads', appRoot: APP_ROOT, rows, getter, liveProbe: null }
  }
  return { ok: false, why: 'the app source is not readable at ' + APP_ROOT + ' (the hook can still be read live, but step 0 asked for the source)', appRoot: APP_ROOT, rows: [], getter: null, liveProbe: null }
}

// ---------------------------------------------------------------------------
// The transcript this gate judges (and --replay re-judges)
// ---------------------------------------------------------------------------
const emptyTranscript = () => ({
  schema: SCHEMA,
  gate: 'foreign-app-agent-live',
  startedAt: new Date().toISOString(),
  port: PORT,
  kernelPort: KERNEL_PORT,
  cdpPort: CDP_PORT,
  appPort: APP_PORT,
  appOrigin: APP_ORIGIN,
  appRoot: APP_ROOT,
  shellOrigin: SHELL_ORIGIN,
  holder: HOLDER,
  message: MESSAGE,
  surface: SURFACE,
  faceSource: null,
  guard: null,
  lease: { entry: null, claim: null, place: null, releaseBeforeRound: null, reclaim: null, releaseAtExit: null, waitMs: null, attempts: 0 },
  world: { entry: null, exit: null },
  session: { sessionId: null, created: false, requestId: null, accepted: null, promptCount: 0, promptSentAt: null, turnEnded: false, polls: 0 },
  page: null,
  observations: [],
  ticks: [],
  restore: { steps: [], after: null, document: null },
  shellEntry: null,
  shellExit: null,
  targetSet: { entry: [], exit: [] },
  aborted: null,
  problems: [],
  notes: [],
})

// ---------------------------------------------------------------------------
// The drive
// ---------------------------------------------------------------------------
const runWorld = async () => {
  const transcript = emptyTranscript()
  let cdp = null
  let sessionId = ''
  try {
    // --- step 0: the state face, from the app's own source ------------------------------------------
    transcript.faceSource = readFaceSource()

    // --- the instrument ---------------------------------------------------------------------------
    const pages = await cdpPages()
    if (pages.ok !== true) throw new NotMeasured('NO_CDP_SHELL', pages.why)
    transcript.targetSet.entry = pages.pages.map((page) => page.id + '|' + page.url).sort()
    const shellTab = pages.pages.find(isShellPage) ?? null
    if (shellTab === null) throw new NotMeasured('NO_CDP_SHELL', 'CDP has no page target on ' + SHELL_ORIGIN + ' (targets: ' + show(pages.pages.map((page) => page.url)) + ')')
    cdp = await connectCdp(shellTab.ws, 'world entry tab')
    if (cdp.ok !== true) throw new NotMeasured('NO_CDP_SHELL', cdp.why)
    transcript.shellEntry = await entryFingerprint(shellTab)

    const entryPids = pidFingerprint()
    const client = pidRow(entryPids, PORT)
    const kernel = pidRow(entryPids, KERNEL_PORT)
    if (client === null || client.pid === null) throw new NotMeasured('NO_PIDS', 'no process listens on the shell port ' + String(PORT) + ' (' + String(entryPids.why ?? 'no listener') + ')')
    if (kernel === null || kernel.pid === null) throw new NotMeasured('NO_PIDS', 'no process listens on the kernel port ' + String(KERNEL_PORT) + ' (' + String(entryPids.why ?? 'no listener') + ')')

    // --- the world before anything is touched ------------------------------------------------------
    // R279: THE PREMISE. This gate needs a panel because that is where the browser tools drive, and the page host
    // only places one while a pane declares its surface - measured by hand: with the rail on our own LINK panel the
    // shell reports exists=false / mounted=false and this gate threw NO_PANEL, while one click on the rail's browser
    // chip put an anchor at 808,86 614x790 and the whole gate then measured 6 of 6. Opening the door is part of
    // finding the world, not part of the answer, and it is recorded so a reader can see the gate did it.
    const brought = await cdp.evaluate(`(() => {
      const rail = document.querySelector('[data-rightbar-col]')
      const tabs = document.querySelectorAll('[role="tab"]')
      for (let index = 0; index < tabs.length; index += 1) {
        const el = tabs[index]
        if (rail !== null && rail.contains(el) === false) continue
        const label = String(el.textContent === null || el.textContent === undefined ? '' : el.textContent)
        if (!/Browser|browser|\u6d4f\u89c8\u5668/.test(label)) continue
        if (el.getAttribute('aria-selected') === 'true') return 'already'
        el.click()
        return 'clicked'
      }
      return 'no-browser-chip'
    })()`)
    transcript.panelPremise = { at: new Date().toISOString(), brought: brought.ok === true ? brought.value : null, why: brought.why }
    if (brought.ok === true && brought.value === 'clicked') await sleep(1500)
    const entryPanel = await panelState()
    if (entryPanel.ok !== true) throw new NotMeasured('NO_PANEL', 'the shell panel API did not answer op=state on ' + SHELL_ORIGIN + ' (' + String(entryPanel.why) + ')')
    const entryState = entryPanel.state
    const entryTabs = tabsOf(entryState)
    if (entryState.exists !== true && entryState.mounted !== true) throw new NotMeasured('NO_PANEL', 'the shell reports no panel (exists and mounted are both false), so there is no browser the agent could drive')
    const appUp = await httpFetch(APP_ORIGIN + APP_PATH, {}, 8000)
    if (appUp.ok !== true) throw new NotMeasured('APP_NOT_UP', 'GET ' + APP_ORIGIN + APP_PATH + ' answered ' + String(appUp.status) + ' (' + String(appUp.why) + '); the foreign app is not up')
    const sessionsBefore = await readSessions(cdp, 'r200-list-before')
    transcript.world.entry = {
      at: new Date().toISOString(),
      pages: pages.pages,
      shellTab,
      pids: { ok: entryPids.ok, why: entryPids.why, rows: entryPids.rows },
      panel: {
        exists: entryState.exists === true,
        mounted: entryState.mounted === true,
        active: entryState.active ?? null,
        surface: entryState.surface ?? null,
        bounds: entryState.bounds ?? null,
        mode: entryState.mode ?? null,
        viewport: entryState.viewport ?? null,
        lease: entryState.lease ?? null,
        tabs: entryTabs,
      },
      app: { status: appUp.status, bytes: Buffer.byteLength(appUp.text, 'utf8') },
      sessions: sessionsBefore,
    }
    transcript.lease.entry = entryState.lease ?? null
    const leaseHeld = entryState.lease !== null && entryState.lease !== undefined && entryState.lease.held === true
    if (leaseHeld) throw new NotMeasured('LEASE_BUSY', 'the panel lease is already held by ' + show(entryState.lease?.holder) + ' before this gate claims it')

    // --- alone? -----------------------------------------------------------------------------------
    const processes = nodeProcesses()
    if (processes.ok !== true) throw new NotMeasured('ANOTHER_CONSUMER', 'the process list could not be read (' + String(processes.why) + '), so this gate cannot promise it is alone')
    const live = liveGateFiles()
    const others = otherConsumers(processes.rows, live, ancestorPids())
    transcript.guard = { liveFiles: live.files, others, nodeProcesses: processes.rows.length }
    if (others.length > 0) throw new NotMeasured('ANOTHER_CONSUMER', 'another live consumer is running and this gate must run alone: ' + others.join(' | '))

    // --- the lease, and the surface the panel needs to be a browser at all -------------------------
    const claim = await takeLease()
    transcript.lease.claim = claim.answer
    if (claim.ok !== true) throw new NotMeasured('LEASE_BUSY', claim.why)
    const placed = await panelPost({ op: 'surface', ...SURFACE, holder: HOLDER }, 25000)
    transcript.lease.place = { status: placed.status, ok: placed.ok, text: placed.text, state: placed.body !== null ? { surface: placed.body.surface ?? null, scale: placed.body.scale ?? null, mode: placed.body.mode ?? null, modeApplied: placed.body.modeApplied ?? null } : null, error: placed.body?.error ?? null }
    if (placed.ok !== true) throw new NotMeasured('PANEL_NOT_PLACEABLE', 'the shell refused to place the panel surface: ' + String(placed.body?.error ?? placed.text))
    if (placed.body?.modeApplied === false) transcript.notes.push('note: the shell placed the surface but reports modeApplied=false (' + show(placed.body?.modeError) + '), so the page viewport may not follow')

    // --- release before the round: the shell refuses any other holder's write ----------------------
    const releaseBefore = await releaseLease()
    transcript.lease.releaseBeforeRound = releaseBefore
    transcript.notes.push('the lease is released BEFORE the one prompt, because the shell refuses any holder but the lease holder and the browser tools write as "dsh-browser" (measured: src-tauri/src/core/sidebar_panel.rs:966-1000); the gate takes it back for the restore')

    // --- ONE session, ONE prompt ------------------------------------------------------------------
    const created = await cdp.call('session/create', { request: {} }, 'r200-create')
    sessionId = String(created.value?.sessionId ?? '')
    if (sessionId === '') throw new NotMeasured('SHELL_REFUSED', 'the shell created no session (session/create answered ' + show(created.value) + ')')
    transcript.session.sessionId = sessionId
    transcript.session.created = true
    const requestId = crypto.randomUUID()
    transcript.session.requestId = requestId
    const accepted = await cdp.call('session/prompt', { request: { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: MESSAGE }] } }, 'r200-prompt')
    transcript.session.promptCount += 1
    transcript.session.accepted = accepted.value?.accepted === true
    transcript.session.promptSentAt = new Date().toISOString()
    if (transcript.session.accepted !== true) throw new NotMeasured('SHELL_REFUSED', 'the one prompt this gate sends was not accepted (' + show(accepted.value) + ')')

    // --- the round: poll the session AND the app's own state face ---------------------------------
    const until = Date.now() + DEADLINE_MS
    let tick = 0
    let page = null
    while (Date.now() < until) {
      tick += 1
      const at = Date.now()
      const state = await panelState()
      if (state.ok === true) {
        const rows = tabsOf(state.state)
        transcript.ticks.push({
          at,
          mounted: state.state.mounted === true,
          surface: state.state.surface ?? null,
          leaseHeld: state.state.lease?.held === true,
          tabs: rows.map((row) => ({ id: row.id, url: row.url, active: row.active, live: row.live })),
        })
        const appTabs = rows.filter((row) => row.url.startsWith(APP_ORIGIN))
        for (const tab of appTabs) {
          const read = await readFace(tab.id)
          transcript.observations.push({
            i: transcript.observations.length,
            at: Date.now(),
            phase: 'during',
            tab: tab.id,
            url: tab.url,
            ok: read.ok === true,
            why: read.why,
            face: read.face,
          })
        }
      } else {
        transcript.ticks.push({ at, panel: null, why: state.why })
      }
      if (tick % SESSION_POLL_EVERY === 1) {
        transcript.session.polls += 1
        const list = await readSessions(cdp, 'r200-list-' + String(tick))
        const row = list.rows.find((one) => one.sessionId === sessionId) ?? null
        if (row !== null && row.asOfSeq > 0) {
          page = await readPage(cdp, sessionId, row.asOfSeq, 'r200-page-' + String(tick))
          transcript.page = page
          const types = (page?.records ?? []).map((record) => record?.event?.type)
          if (types.includes('turn/end') === true) {
            transcript.session.turnEnded = true
            break
          }
        }
      }
      await sleep(TICK_MS)
    }

    // --- one last read of the app, taken AFTER the turn ended -------------------------------------
    await sleep(900)
    const stateAfter = await panelState()
    if (stateAfter.ok === true) {
      const appTabs = tabsOf(stateAfter.state).filter((row) => row.url.startsWith(APP_ORIGIN))
      for (const tab of appTabs) {
        const read = await readFace(tab.id)
        transcript.observations.push({
          i: transcript.observations.length,
          at: Date.now(),
          phase: 'after',
          tab: tab.id,
          url: tab.url,
          ok: read.ok === true,
          why: read.why,
          face: read.face,
        })
      }
    }
    transcript.faceSource.liveProbe = transcript.observations.filter((row) => row.ok === true && row.face?.hook === true).length

    // --- restore the world -----------------------------------------------------------------------
    const reclaim = await takeLease()
    transcript.lease.reclaim = reclaim.answer
    if (reclaim.ok === true) {
      await restorePanel(transcript)
      const releaseAtExit = await releaseLease()
      transcript.lease.releaseAtExit = releaseAtExit
      // One last read AFTER the release: the restore's own read was taken while the gate still held the
      // lease, so the lease fact (and the tab set) is judged on this one.
      const finalState = await panelState()
      transcript.restore.final = finalState.ok === true ? {
        mounted: finalState.state.mounted === true,
        active: finalState.state.active ?? null,
        surface: finalState.state.surface ?? null,
        bounds: finalState.state.bounds ?? null,
        lease: finalState.state.lease ?? null,
        tabs: tabsOf(finalState.state),
      } : { error: finalState.why }
    } else {
      transcript.notes.push('the lease could not be taken back for the restore: ' + reclaim.why)
    }
  } catch (error) {
    if (error instanceof NotMeasured) {
      transcript.aborted = { code: error.code, reason: error.reason }
      transcript.notes.push('NOT MEASURED: ' + error.code + ' - ' + error.reason)
    } else {
      transcript.aborted = { code: 'UNEXPECTED', reason: describe(error) }
      transcript.problems.push('the drive stopped on an unexpected error: ' + describe(error) + (error?.stack === undefined ? '' : ' | ' + String(error.stack).split('\n').slice(0, 3).join(' ')))
    }
  } finally {
    // --- the world after: the exit fingerprint ---------------------------------------------------
    try {
      transcript.world.exit = { at: new Date().toISOString() }
      const exitPids = pidFingerprint()
      transcript.world.exit.pids = { ok: exitPids.ok, why: exitPids.why, rows: exitPids.rows }
      transcript.world.exit.client = pidRow(exitPids, PORT)
      transcript.world.exit.kernel = pidRow(exitPids, KERNEL_PORT)
      const exitPanel = await panelState()
      transcript.world.exit.panel = exitPanel.ok === true ? {
        exists: exitPanel.state.exists === true,
        mounted: exitPanel.state.mounted === true,
        active: exitPanel.state.active ?? null,
        surface: exitPanel.state.surface ?? null,
        bounds: exitPanel.state.bounds ?? null,
        lease: exitPanel.state.lease ?? null,
        tabs: tabsOf(exitPanel.state),
      } : { error: exitPanel.why }
      if (transcript.restore.after === null) transcript.restore.after = transcript.world.exit.panel
      if (cdp !== null && cdp.ok === true) {
        const pages = await cdpPages()
        transcript.targetSet.exit = pages.ok === true ? pages.pages.map((page) => page.id + '|' + page.url).sort() : []
        const shellTab = pages.ok === true ? pages.pages.find(isShellPage) ?? null : null
        transcript.shellExit = shellTab === null ? null : await entryFingerprint(shellTab)
        transcript.world.exit.sessions = await readSessions(cdp, 'r200-list-after').catch(() => null)
      }
    } catch (error) {
      transcript.problems.push('the exit fingerprint could not be read: ' + describe(error))
    }
    if (cdp !== null && cdp.ok === true) cdp.close()
    try {
      const dir = DUMP_OPTION === null ? join(tmpdir(), 'r200-p1-foreign-app') : dirname(resolve(DUMP_OPTION))
      mkdirSync(dir, { recursive: true })
      const path = DUMP_OPTION === null ? join(dir, 'transcript-' + String(sessionId === '' ? 'none' : sessionId) + '.json') : resolve(DUMP_OPTION)
      writeFileSync(path, JSON.stringify(transcript, null, 1))
      transcript.dumpPath = path
    } catch (error) {
      transcript.notes.push('note: the transcript could not be written out (' + describe(error) + ')')
    }
  }
  return transcript
}

/** One session/list, normalized: what moved since the last read is asOfSeq, and that is the check. */
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
const readPage = async (cdp, sessionId, throughSeq, rpcId) => {
  const answer = await cdp.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq, maxMessages: 600 } }, rpcId)
  return answer.value ?? null
}

/** Take the single-run lease, waiting up to the deadline for another consumer to let go. */
const takeLease = async () => {
  const started = Date.now()
  for (;;) {
    const answer = await panelPost({ op: 'lease', leaseOp: 'claim', holder: HOLDER, ttlMs: LEASE_TTL_MS })
    const held = answer.ok === true && answer.body !== null && answer.body.lease !== undefined && answer.body.lease !== null && answer.body.lease.held === true && answer.body.lease.holder === HOLDER
    if (held === true) return { ok: true, why: null, answer: { status: answer.status, lease: answer.body.lease, waitMs: Date.now() - started } }
    if (Date.now() - started >= LEASE_WAIT_MS) {
      const holder = answer.body?.lease?.holder ?? null
      return { ok: false, why: 'the single-run lease stayed busy for ' + String(Math.round((Date.now() - started) / 1000)) + 's: it is held by ' + show(holder) + ', and this gate does not take it from anybody', answer: { status: answer.status, lease: answer.body?.lease ?? null, error: answer.body?.error ?? answer.text } }
    }
    await sleep(1500)
  }
}
const releaseLease = async () => {
  const answer = await panelPost({ op: 'lease', leaseOp: 'release', holder: HOLDER })
  const state = answer.body?.state ?? null
  const lease = answer.body?.lease ?? (state === null ? null : state.lease ?? null)
  return { status: answer.status, ok: answer.ok, lease: lease, state: state === null ? null : { mounted: state.mounted === true, active: state.active ?? null, tabs: tabsOf(state), surface: state.surface ?? null } }
}

/** Put the panel back the way it was found: close what the round opened, restore what it replaced. */
const restorePanel = async (transcript) => {
  const entry = transcript.world.entry.panel
  const entryIds = entry.tabs.map((tab) => tab.id)
  const steps = transcript.restore.steps
  const current = await panelState()
  if (current.ok !== true) {
    steps.push({ op: 'state', ok: false, why: current.why })
    return
  }
  for (const tab of tabsOf(current.state)) {
    if (entryIds.includes(tab.id)) continue
    const closed = await panelPost({ op: 'tab-close', id: tab.id, holder: HOLDER }, 25000)
    steps.push({ op: 'tab-close', id: tab.id, status: closed.status, ok: closed.ok, error: closed.body?.error ?? null })
  }
  const afterClose = await panelState()
  if (afterClose.ok === true) {
    for (const tab of entry.tabs) {
      const now = tabsOf(afterClose.state).find((row) => row.id === tab.id) ?? null
      if (now === null || now.url === tab.url) continue
      const back = await panelPost({ op: 'tab-goto', id: tab.id, url: tab.url, holder: HOLDER }, 25000)
      steps.push({ op: 'tab-goto', id: tab.id, url: tab.url, status: back.status, ok: back.ok, error: back.body?.error ?? null })
      transcript.restore.document = await waitDocument(tab.id, tab.url)
    }
  }
  if (entry.surface === null) {
    const zero = await panelPost({ op: 'surface', x: 0, y: 0, w: 0, h: 0, holder: HOLDER }, 25000)
    steps.push({ op: 'surface-zero', status: zero.status, ok: zero.ok, error: zero.body?.error ?? null })
    const up = await panelPost({ op: 'mount', url: '', holder: HOLDER }, 30000)
    steps.push({ op: 'mount', status: up.status, ok: up.ok, error: up.body?.error ?? null })
    // A panel that had no tabs at entry can come back with one the shell creates on mount; close it.
    const mountedState = await panelState()
    if (mountedState.ok === true) {
      for (const tab of tabsOf(mountedState.state)) {
        if (entryIds.includes(tab.id)) continue
        const closed = await panelPost({ op: 'tab-close', id: tab.id, holder: HOLDER }, 25000)
        steps.push({ op: 'tab-close-after-mount', id: tab.id, status: closed.status, ok: closed.ok, error: closed.body?.error ?? null })
      }
    }
  } else {
    const back = await panelPost({ op: 'surface', x: entry.surface.x, y: entry.surface.y, w: entry.surface.w, h: entry.surface.h, holder: HOLDER }, 25000)
    steps.push({ op: 'surface', rect: entry.surface, status: back.status, ok: back.ok, error: back.body?.error ?? null })
  }
  await sleep(1400)
  const after = await panelState()
  transcript.restore.after = after.ok === true ? {
    exists: after.state.exists === true,
    mounted: after.state.mounted === true,
    active: after.state.active ?? null,
    surface: after.state.surface ?? null,
    bounds: after.state.bounds ?? null,
    lease: after.state.lease ?? null,
    tabs: tabsOf(after.state),
  } : { error: after.why }
}
/** Wait for one tab's document to be the URL the gate put back (bounded). */
const waitDocument = async (tab, url) => {
  const until = Date.now() + 12000
  let last = null
  while (Date.now() < until) {
    const answer = await evaluateIn(tab, 'JSON.stringify({ href: String(location.href), ready: String(document.readyState) })')
    if (answer.ok === true) {
      try {
        last = JSON.parse(String(answer.value))
      } catch {
        last = null
      }
      if (last !== null && last.href === url && last.ready === 'complete') return last
    }
    await sleep(400)
  }
  return last
}

// ---------------------------------------------------------------------------
// The judge: a pure function of the transcript
// ---------------------------------------------------------------------------
const readJsonFile = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return null
  }
}

const FACE_KEYS = ['ready', 'appReady', 'buildId', 'hasUi', 'mode', 'selected', 'held', 'activeTask', 'activeExperiment', 'paused', 'entryOpen', 'shelfOpen', 'selectedAttr', 'accepted', 'logs', 'containers']
/** The only transitions the task asked for: the opening card closing and the beaker becoming selected. */
const ALLOWED_DELTA = {
  selected: [null, 'demo-1'],
  selectedAttr: ['', 'demo-1'],
  entryOpen: ['true', 'false'],
}
const faceValue = (face, key) => {
  const value = face === null || face === undefined ? null : face[key]
  return value === undefined ? null : value
}
const faceDiff = (before, after) => {
  const rows = []
  for (const key of FACE_KEYS) {
    const a = faceValue(before, key)
    const b = faceValue(after, key)
    if (show(a) === show(b)) continue
    rows.push({ key, before: a, after: b })
  }
  return rows
}

const BROWSER_NAV = ['browser_open', 'browser_goto', 'browser_tab_new']
const BROWSER_INPUT = ['browser_pick', 'browser_click']

const factsOf = (transcript) => {
  const records = Array.isArray(transcript?.page?.records) ? transcript.page.records : []
  const events = records.map((record) => record?.event).filter((event) => event !== null && typeof event === 'object')
  const calls = events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({
      seq: Number(event.seq ?? -1),
      time: Number(event.time ?? 0),
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
        time: Number(event.time ?? 0),
        callId: String(message.toolCallId ?? ''),
        isError: message.isError === true,
        text: content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '[' + String(part?.type) + ']')).join('\n'),
      }
    })
  const assistants = events
    .filter((event) => event.type === 'assistant/message')
    .map((event) => {
      const message = event.data?.message === null || typeof event.data?.message !== 'object' ? {} : event.data.message
      const content = Array.isArray(message.content) ? message.content : []
      return {
        seq: Number(event.seq ?? -1),
        time: Number(event.time ?? 0),
        text: content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '')).join('\n'),
      }
    })
  const withResult = calls.map((call) => {
    const result = results.find((row) => row.callId !== '' && row.callId === call.callId) ?? null
    return { ...call, result, errored: result === null ? null : result.isError === true }
  })
  const observations = Array.isArray(transcript?.observations) ? transcript.observations : []
  const ready = observations.filter((row) => row?.ok === true && row.face !== null && row.face.hook === true && row.face.ready === true && typeof row.face.buildId === 'string')
  const tabs = [...new Set(ready.map((row) => row.tab))]
  const byTab = tabs.map((tab) => ({ tab, rows: ready.filter((row) => row.tab === tab).sort((a, b) => a.at - b.at) }))
  const series = byTab.sort((a, b) => b.rows.length - a.rows.length)[0] ?? null
  const before = series === null ? null : series.rows[0]
  const after = series === null ? null : series.rows[series.rows.length - 1]
  return {
    events,
    calls: withResult,
    assistants,
    observations,
    ready,
    appTab: series === null ? null : series.tab,
    before,
    after,
    turnEnd: events.find((event) => event.type === 'turn/end') ?? null,
  }
}

const judge = (transcript) => {
  const facts = factsOf(transcript)
  const readings = []
  const add = (id, status, detail, code) => readings.push({ id, status, detail, code: code ?? null })
  const third = (id, code, detail) => add(id, 'not-measured', detail, code)

  // ---- 0: the read-only state face ---------------------------------------------------------------
  const source = transcript?.faceSource ?? null
  const aborted = transcript?.aborted ?? null
  const stopped = aborted === null ? '' : ' | the run stopped: ' + aborted.code + ' - ' + aborted.reason
  const liveFaces = facts.ready.length
  if (source === null || source.ok !== true) {
    third('0-the-app-publishes-a-read-only-state-face-this-gate-can-read', 'NO_STATE_FACE', String(source?.why ?? 'the app source was not read') + stopped)
  } else if (liveFaces === 0) {
    third('0-the-app-publishes-a-read-only-state-face-this-gate-can-read', aborted === null ? 'NO_STATE_FACE' : aborted.code, 'the source declares the face (' + source.rows.filter((row) => row.ok === true).map((row) => row.path + ':' + (row.needles.find((n) => n.needle === 'getSnapshot: () => store.getSnapshot()')?.line ?? row.needles[0]?.line ?? '?')).join(', ') + ') but the live hook never answered it in ' + String(facts.observations.length) + ' observation(s)' + stopped)
  } else {
    const getter = source.getter
    const line = getter === null || getter === null ? null : (getter.needles?.[0]?.line ?? null)
    add('0-the-app-publishes-a-read-only-state-face-this-gate-can-read', 'green', 'the face is DECLARED at ' + (getter === null ? '(not found)' : getter.path + ':' + String(line)) + ' and the live hook answered it ' + String(liveFaces) + ' time(s); fields read: ' + FACE_KEYS.join(','))
  }

  // ---- 1: the app open in a tab, hook ready ------------------------------------------------------
  const appOrigin = String(transcript?.appOrigin ?? '')
  const appTabRows = (Array.isArray(transcript?.ticks) ? transcript.ticks : []).flatMap((tick) => Array.isArray(tick.tabs) ? tick.tabs : []).filter((row) => String(row.url ?? '').startsWith(appOrigin))
  const appTabIds = [...new Set(appTabRows.map((row) => row.id))]
  if (facts.appTab === null) {
    if (appTabIds.length === 0) third('1-the-app-was-open-in-a-tab-the-browser-tools-drive-with-its-hook-ready', 'APP_NOT_OPENED', 'no panel tab ever carried ' + appOrigin + ' during the round (tabs seen: ' + show([...new Set((Array.isArray(transcript?.ticks) ? transcript.ticks : []).flatMap((tick) => (tick.tabs ?? []).map((row) => row.url)))]) + ')')
    else third('1-the-app-was-open-in-a-tab-the-browser-tools-drive-with-its-hook-ready', 'HOOK_UNREACHABLE', 'tab ' + appTabIds.join(',') + ' carried the app but window.__CHEMLAB__ never answered ready:true with a buildId (last observation: ' + show(facts.observations.slice(-1)[0]?.why) + ')' + stopped)
  } else {
    const face = facts.after?.face ?? facts.before?.face ?? null
    add('1-the-app-was-open-in-a-tab-the-browser-tools-drive-with-its-hook-ready', 'green', 'tab ' + facts.appTab + ' carried ' + appOrigin + '; __CHEMLAB__.ready=' + String(face?.ready) + ', buildId=' + show(face?.buildId) + ', appReady=' + show(face?.appReady) + ', viewport=' + show(face?.viewport))
  }

  // ---- 2: the model called the tools the message named ------------------------------------------
  const navigations = facts.calls.filter((call) => BROWSER_NAV.includes(call.name))
  const inputs = facts.calls.filter((call) => BROWSER_INPUT.includes(call.name))
  const okNav = navigations.filter((call) => call.errored === false)
  const okInput = inputs.filter((call) => call.errored === false)
  const writes = facts.calls.filter((call) => ['write', 'edit', 'apply_patch'].includes(call.name) && /example-app|<workspace>[\\/]example-app/i.test(call.arguments))
  const shells = facts.calls.filter((call) => ['pwsh', 'bash'].includes(call.name) && /example-app|<workspace>[\\/]example-app/i.test(call.arguments))
  const finalText = facts.assistants.slice(-1)[0]?.text ?? ''
  const refusal = /(我不能|无法|不能帮|拒绝|抱歉|I can(?:no|')t|I won't|refuse)/i.test(finalText)
  if (transcript?.session?.promptCount !== 1) {
    third('2-the-model-called-the-browser-tools-the-message-named', 'ROUND_NOT_SENT', 'the gate sent ' + String(transcript?.session?.promptCount ?? 0) + ' prompt(s); this reading judges exactly one')
  } else if (navigations.length === 0 && inputs.length === 0) {
    third('2-the-model-called-the-browser-tools-the-message-named', refusal === true ? 'MODEL_REFUSED' : 'MODEL_PROSE', (refusal === true ? 'the model refused in prose' : 'the model answered in prose without one browser call') + '; its last words: ' + clip(finalText.replace(/\s+/g, ' ').trim(), 240))
  } else if (okNav.length === 0 || okInput.length === 0) {
    const failed = facts.calls.filter((call) => call.errored !== false).map((call) => call.name + ': ' + clip(String(call.result?.text ?? 'no result'), 140))
    third('2-the-model-called-the-browser-tools-the-message-named', 'MODEL_TOOL_ERROR', 'the calls the task needs did not succeed (' + String(failed.length) + ' errored: ' + (failed.slice(0, 4).join(' | ') || 'no result arrived') + ')')
  } else if (writes.length > 0) {
    add('2-the-model-called-the-browser-tools-the-message-named', 'red', 'the model wrote to the foreign app instead of driving it: ' + writes.map((call) => call.name + ' ' + clip(call.arguments, 120)).join(' | '))
  } else {
    add('2-the-model-called-the-browser-tools-the-message-named', 'green', 'navigation: ' + okNav.map((call) => call.name).join(',') + ' (' + String(okNav.length) + '); input: ' + okInput.map((call) => call.name).join(',') + ' (' + String(okInput.length) + '); errored: ' + String(facts.calls.filter((call) => call.errored === true).length) + '; no write to the app' + (shells.length === 0 ? '' : ' (a pwsh call named the app, read-only as far as this gate can see: ' + clip(shells.map((call) => call.arguments).join(' '), 120) + ')'))
  }

  // ---- 3: the app's own state changed by exactly the asked delta ---------------------------------
  if (facts.before === null || facts.after === null) {
    third('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', aborted === null ? 'NO_STATE_FACE' : aborted.code, 'no ready face was read before and after the round, so no delta can be attributed' + stopped)
  } else if (facts.before.at === facts.after.at) {
    third('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', 'DELTA_NOT_ATTRIBUTED', 'the gate read the app only once (tab ' + facts.appTab + '), so there is no before/after to compare')
  } else {
    const before = facts.before.face
    const after = facts.after.face
    const diff = faceDiff(before, after)
    const unexpected = diff.filter((row) => ALLOWED_DELTA[row.key] === undefined)
    const wrongTransition = diff.filter((row) => ALLOWED_DELTA[row.key] !== undefined && (show(row.before) !== show(ALLOWED_DELTA[row.key][0]) || show(row.after) !== show(ALLOWED_DELTA[row.key][1])))
    // A read is stamped when it RETURNS, so the window opens one tick early: the state it carries is the app's
    // state at the moment the call was sent, not the moment it came back.
    const between = okInput.filter((call) => call.time > facts.before.at - TICK_MS && call.time < facts.after.at)
    const selectedOk = faceValue(before, 'selected') === null && faceValue(after, 'selected') === 'demo-1'
    if (faceValue(before, 'selected') !== null) {
      third('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', 'DELTA_NOT_ATTRIBUTED', 'the first ready read already showed selected=' + show(faceValue(before, 'selected')) + '; the gate missed the before it would have to attribute the change to')
    } else if (selectedOk !== true) {
      add('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', 'red', 'the task asked for selected null -> demo-1 and the app reports ' + show(faceValue(before, 'selected')) + ' -> ' + show(faceValue(after, 'selected')) + ' (diff: ' + show(diff) + ')')
    } else if (unexpected.length > 0 || wrongTransition.length > 0) {
      add('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', 'red', 'the delta was not the one asked for: ' + show([...unexpected, ...wrongTransition]))
    } else if (between.length === 0) {
      third('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', 'DELTA_NOT_ATTRIBUTED', 'the app changed between the two reads but no successful browser input landed between them (' + show(okInput.map((call) => ({ name: call.name, time: call.time }))) + ')')
    } else {
      add('3-the-app-own-state-changed-by-exactly-the-delta-the-task-asked-for', 'green', 'tab ' + facts.appTab + ': ' + diff.map((row) => row.key + ' ' + show(row.before) + ' -> ' + show(row.after)).join('; ') + ' | every other face field identical (' + String(FACE_KEYS.length - diff.length) + ') | inputs between the reads: ' + between.map((call) => call.name).join(','))
    }
  }

  // ---- 4: nothing else moved, and the world was put back -----------------------------------------
  const parts = []
  let red = false
  let unmeasured = null
  const entryShell = transcript?.shellEntry ?? null
  const exitShell = transcript?.shellExit ?? null
  if (entryShell === null || exitShell === null) {
    unmeasured = 'the shell page target could not be fingerprinted at both ends'
  } else if (show({ href: entryShell.href, title: entryShell.title, ready: entryShell.readyState, history: entryShell.history }) !== show({ href: exitShell.href, title: exitShell.title, ready: exitShell.readyState, history: exitShell.history })) {
    red = true
    parts.push('the world entry tab moved: ' + show({ before: { href: entryShell.href, history: entryShell.history }, after: { href: exitShell.href, history: exitShell.history } }))
  } else {
    parts.push('world entry tab untouched (' + String(exitShell.href) + ', history ' + show(exitShell.history?.entries) + ')')
  }
  const entryPanel = transcript?.world?.entry?.panel ?? null
  // The exit read is taken AFTER the lease is released (the restore's own read is not: it is taken while
  // this gate still holds the lease, which is why the lease is judged on the exit read, not on that one).
  const exitPanel = transcript?.restore?.final ?? transcript?.world?.exit?.panel ?? transcript?.restore?.after ?? null
  if (entryPanel === null || exitPanel === null || exitPanel.error !== undefined) {
    unmeasured = unmeasured ?? 'the panel could not be read at both ends'
  } else {
    const key = (panel) => panel.tabs.map((tab) => tab.id + '=' + tab.url).sort().join('|') + '#' + String(panel.active) + '#mounted:' + String(panel.mounted)
    if (key(entryPanel) !== key(exitPanel)) {
      red = true
      parts.push('the panel did not come back: ' + key(entryPanel) + ' -> ' + key(exitPanel))
    } else {
      parts.push('panel back to the entry tab set (' + key(exitPanel) + ')')
    }
    const surfaceNull = entryPanel.surface === null ? exitPanel.surface === null : exitPanel.surface !== null
    if (surfaceNull !== true) {
      red = true
      parts.push('the surface was not put back: entry ' + show(entryPanel.surface) + ' -> exit ' + show(exitPanel.surface))
    } else {
      parts.push('surface ' + (entryPanel.surface === null ? 'null again' : 'restored'))
    }
    const leaseHeld = exitPanel.lease !== null && exitPanel.lease !== undefined && exitPanel.lease.held === true
    if (leaseHeld === true) {
      red = true
      parts.push('the lease is still held by ' + show(exitPanel.lease?.holder))
    } else {
      parts.push('lease not held')
    }
  }
  const entryPids = transcript?.world?.entry?.pids?.rows ?? []
  const entryClient = entryPids.find((row) => row.port === Number(transcript?.port)) ?? null
  const entryKernel = entryPids.find((row) => row.port === Number(transcript?.kernelPort)) ?? null
  const exitClient = transcript?.world?.exit?.client ?? null
  const exitKernel = transcript?.world?.exit?.kernel ?? null
  if (pidKey(entryClient) === null || pidKey(exitClient) === null || pidKey(entryKernel) === null || pidKey(exitKernel) === null) {
    unmeasured = unmeasured ?? 'the client/kernel pids could not be read at both ends'
  } else if (pidKey(entryClient) !== pidKey(exitClient) || pidKey(entryKernel) !== pidKey(exitKernel)) {
    red = true
    parts.push('a pid changed: client ' + pidText(entryClient) + ' -> ' + pidText(exitClient) + ', kernel ' + pidText(entryKernel) + ' -> ' + pidText(exitKernel))
  } else {
    parts.push('client ' + pidText(exitClient) + ', kernel ' + pidText(exitKernel) + ' (identical)')
  }
  const beforeSessions = transcript?.world?.entry?.sessions ?? null
  const afterSessions = transcript?.world?.exit?.sessions ?? null
  const ownSession = String(transcript?.session?.sessionId ?? '')
  if (beforeSessions === null || afterSessions === null) {
    unmeasured = unmeasured ?? 'the session list could not be read at both ends'
  } else {
    const beforeIds = new Set(beforeSessions.rows.map((row) => row.sessionId))
    const created = afterSessions.rows.filter((row) => beforeIds.has(row.sessionId) === false)
    const advanced = afterSessions.rows
      .filter((row) => beforeIds.has(row.sessionId) === true)
      .map((row) => {
        const was = beforeSessions.rows.find((one) => one.sessionId === row.sessionId)
        return { sessionId: row.sessionId, from: was?.asOfSeq ?? 0, to: row.asOfSeq }
      })
      .filter((row) => row.to !== row.from)
    if (created.length !== 1 || created[0].sessionId !== ownSession) {
      red = true
      parts.push('sessions created: ' + show(created.map((row) => row.sessionId)) + ' (this gate own is ' + show(ownSession) + ')')
    } else {
      parts.push('exactly one new session (' + ownSession + ', left open as the evidence)')
    }
    if (advanced.length > 0) {
      unmeasured = unmeasured ?? 'other sessions advanced during the run (' + advanced.map((row) => row.sessionId + ' ' + String(row.from) + '->' + String(row.to)).join(', ') + '): the shell was writing them, not this gate'
    } else {
      parts.push('no other session advanced')
    }
  }
  const entryTargets = transcript?.targetSet?.entry ?? []
  const exitTargets = transcript?.targetSet?.exit ?? []
  if (show(entryTargets) !== show(exitTargets)) {
    red = true
    parts.push('the CDP page target set changed: ' + show(entryTargets) + ' -> ' + show(exitTargets))
  } else {
    parts.push('CDP page targets unchanged (' + String(exitTargets.length) + ')')
  }
  if (red === true) add('4-nothing-else-moved-and-the-world-was-put-back', 'red', parts.join(' | '))
  else if (unmeasured !== null) third('4-nothing-else-moved-and-the-world-was-put-back', 'WORLD_NOT_QUIET', unmeasured + ' | ' + parts.join(' | '))
  else add('4-nothing-else-moved-and-the-world-was-put-back', 'green', parts.join(' | '))

  // ---- 5: the third-state discipline --------------------------------------------------------------
  const unmeasuredReadings = readings.filter((row) => row.status === 'not-measured')
  const missingCode = unmeasuredReadings.filter((row) => row.code === null || row.code === '')
  if (missingCode.length > 0) {
    add('5-every-way-to-fail-honestly-is-a-named-third-state', 'red', 'reading(s) could not be measured and were not named: ' + missingCode.map((row) => row.id).join(','))
  } else {
    const names = unmeasuredReadings.map((row) => row.code)
    add('5-every-way-to-fail-honestly-is-a-named-third-state', 'green', (aborted === null ? '' : 'this run stopped by name (' + aborted.code + ': ' + aborted.reason + '); ') + (names.length === 0
      ? 'nothing was unmeasurable here; the gate publishes its names for the ways it could be (NO_STATE_FACE, APP_NOT_UP, NO_PANEL, LEASE_BUSY, PANEL_NOT_PLACEABLE, MODEL_PROSE, MODEL_REFUSED, MODEL_TOOL_ERROR, APP_NOT_OPENED, HOOK_UNREACHABLE, DELTA_NOT_ATTRIBUTED, ROUND_NOT_ENDED, ANOTHER_CONSUMER)'
      : 'named, not green: ' + names.join(', ')) + ')')
  }

  return readings
}

const exitOf = (readings) => {
  if (readings.some((row) => row.status === 'not-measured')) return 3
  if (readings.some((row) => row.status === 'red')) return 1
  return 0
}

const printReadings = (transcript, readings, exitCode) => {
  const green = readings.filter((row) => row.status === 'green').length
  const red = readings.filter((row) => row.status === 'red').length
  const none = readings.filter((row) => row.status === 'not-measured').length
  console.log('')
  for (const row of readings) {
    const tag = row.status === 'green' ? 'PASS' : row.status === 'red' ? 'FAIL' : 'NOT MEASURED'
    console.log('  ' + tag + '  ' + row.id)
    console.log('        ' + row.detail)
  }
  console.log('')
  if (transcript !== null) {
    const face = transcript?.faceSource ?? null
    if (face !== null && face.ok === true) {
      console.log('  state face (declared): ' + face.rows.filter((row) => row.ok === true).map((row) => row.path + ':' + String(row.needles[0]?.line ?? '?')).join(', '))
    }
    console.log('  state face (live):     ' + String(transcript?.faceSource?.liveProbe ?? 0) + ' ready read(s) of ' + String((transcript?.observations ?? []).length) + ' observation(s)')
    console.log('  session:               ' + String(transcript?.session?.sessionId ?? '(none)') + ' (one prompt, turn/end ' + String(transcript?.session?.turnEnded === true) + ')')
    console.log('  transcript:            ' + String(transcript?.dumpPath ?? '(replayed)'))
    if ((transcript?.notes ?? []).length > 0) for (const note of transcript.notes) console.log('  note: ' + note)
    if ((transcript?.problems ?? []).length > 0) for (const problem of transcript.problems) console.log('  problem: ' + problem)
  }
  console.log('')
  console.log('gate P1 foreign-app-agent-live: ' + String(readings.length) + ' readings, ' + String(green) + ' green, ' + String(red) + ' red, ' + String(none) + ' not measured [exit ' + String(exitCode) + ']')
}

// ---------------------------------------------------------------------------
// Replay: judge a transcript this gate wrote, and touch nothing
// ---------------------------------------------------------------------------
const newestTranscript = () => {
  const dir = DUMP_OPTION === null ? join(tmpdir(), 'r200-p1-foreign-app') : dirname(resolve(DUMP_OPTION))
  if (existsSync(dir) !== true) return null
  const files = readdirSync(dir)
    .filter((name) => /^transcript-.*\.json$/.test(name))
    .map((name) => ({ path: join(dir, name), at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
  return files.length === 0 ? null : files[0].path
}

const main = async () => {
  if (REPLAY !== null) {
    const path = REPLAY === 'latest' ? newestTranscript() : resolve(REPLAY)
    if (path === null || existsSync(path) !== true) {
      console.log('replay: no transcript to re-judge (' + String(REPLAY === 'latest' ? 'nothing under the scratch dir' : path) + ')')
      return 3
    }
    const transcript = readJsonFile(path)
    if (transcript === null) {
      console.log('replay: ' + path + ' is not readable JSON')
      return 3
    }
    const readings = judge(transcript)
    const exitCode = exitOf(readings)
    console.log('gate P1 foreign-app-agent-live (R200, replay of ' + path + ') - the agent, the foreign app, and the app own state')
    printReadings({ ...transcript, dumpPath: path }, readings, exitCode)
    return exitCode
  }
  console.log('gate P1 foreign-app-agent-live (R200) - the agent of DSH driving ' + APP_ORIGIN + ', judged by that app own state (shell ' + SHELL_ORIGIN + ', CDP ' + String(CDP_PORT) + ', kernel ' + String(KERNEL_PORT) + ')')
  console.log('one session, one prompt, one model round; the app is read through the shell panel CDP op; nothing is restarted and nothing is written into ' + APP_ROOT)
  const transcript = await runWorld()
  const readings = judge(transcript)
  const exitCode = exitOf(readings)
  printReadings(transcript, readings, exitCode)
  return exitCode
}

const code = await main()
process.exitCode = code
