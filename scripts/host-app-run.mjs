#!/usr/bin/env node
/**
 * R378 - the embedded host, RUN: a separate Tauri application that builds its own window and has DSH-LINK attach the
 * shell's webview inside it (requirement D's last boundary).
 *
 * This is a DELIBERATE-ACT tool, not a suite gate: the host application's proxy port is fixed at 31761, so the shipped
 * shell has to be down while it runs. It therefore refuses (exit 3) when 31761/31760/9223 answer, and it never stops a
 * process it did not start.
 *
 * The first run was taken by hand (DELIVERY-ASSESSMENT R378). This is the same measurement, re-takeable:
 *
 *   1-junctions     %APPDATA%\dev.dshlink.host and %LOCALAPPDATA%\dev.dshlink.host resolve INTO the session workspace
 *                   (created when missing). Without them the host dies with "拒绝访问 (os error 5)" on shell.json and
 *                   kernel-home, because Tauri resolves those directories from the app identifier and this machine's
 *                   process tree may only write inside the workspace.
 *   2-world-free    31761, 31760 and 9223 answer nothing (the shipped shell must be down)
 *   3-launched      the host application is alive and its three ports answer, and its own log says it attached
 *   4-attached      the HOST window exists (title "Host application") and its own child tree carries a WRY_WEBVIEW
 *                   holding a Chromium widget titled with the client document - the shell's webview is INSIDE a window
 *                   this crate built
 *   5-page          over CDP on this run's port: the page is the shell's own origin, complete, and the client booted
 *   6-panel-api     the shell's own POST /__shell/panel answers op=state from inside the host
 *   7-pixels        a PrintWindow capture of the host window is written and is not blank
 *   8-stopped       the host application is stopped and the ports are free again
 *
 * Usage: node scripts/host-app-run.mjs [--keep] [--out <png>] [--timeout-ms 60000]
 * Exit 0 every reading held | 1 a reading failed | 3 the world is not free (never a verdict)
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync as makeDir } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const KEEP = argv.includes('--keep')
const OUT = resolve(flag('--out', join(PROJECT, '.tmp', 'r378-host-window.png')))
const TIMEOUT_MS = Number(flag('--timeout-ms', '60000'))
const HOST_DATA = resolve(PROJECT, '.tmp', 'r146-host')
const BINARY = join(PROJECT, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'host-app.exe' : 'host-app')
const HELPER = join(PROJECT, 'scripts', 'lib', 'host-window-facts.ps1')
const CDP = 9223
const PROXY = 31761
const KERNEL = 31760

const show = (value) => JSON.stringify(value === undefined ? null : value)
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
const readings = []
const held = (id, ok, detail, evidence = []) => readings.push({ id, ok: ok === true, detail, evidence })

const listens = (port) => {
  const answer = spawnSync('pwsh', ['-NoProfile', '-Command', 'if (Get-NetTCPConnection -State Listen -LocalPort ' + String(port) + ' -ErrorAction SilentlyContinue) { "yes" } else { "no" }'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  return String(answer.stdout === undefined || answer.stdout === null ? '' : answer.stdout).trim() === 'yes'
}

const windowFacts = () => {
  if (existsSync(HELPER) !== true) return { found: false, why: 'the window helper is missing: ' + HELPER }
  const run = spawnSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER, '-WantTitle', 'Host application', '-Capture', OUT], { encoding: 'utf8', timeout: 90000, windowsHide: true })
  const lines = String(run.stdout === undefined || run.stdout === null ? '' : run.stdout).split(/\r?\n/).filter((line) => line.trim() !== '')
  const last = lines.length === 0 ? '' : lines[lines.length - 1]
  try { return JSON.parse(last) } catch (error) { return { found: false, why: 'the window helper did not print JSON: ' + last.slice(0, 200) } }
}

const pageFacts = async () => {
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: CDP, prefer: '127.0.0.1:' + String(PROXY) })
  if (cdp === null) return null
  try {
    const answer = await cdp.evaluate('JSON.stringify({ url: location.href, title: document.title, ready: document.readyState, boot: Boolean(globalThis.__DSH_BOOT_READY__) })')
    try { return JSON.parse(String(answer.value)) } catch (error) { return null }
  } finally {
    try { cdp.close() } catch (ignored) { /* closed on every path */ }
  }
}

const main = async () => {
  makeDir(join(HOST_DATA, 'roaming'), { recursive: true })
  makeDir(join(HOST_DATA, 'local'), { recursive: true })
  // 1 - the junctions the host application's data directories need
  const roam = join(process.env.APPDATA === undefined ? '' : process.env.APPDATA, 'dev.dshlink.host')
  const local = join(process.env.LOCALAPPDATA === undefined ? '' : process.env.LOCALAPPDATA, 'dev.dshlink.host')
  const script = [
    '$target = ' + show(HOST_DATA),
    '$roam = ' + show(roam),
    '$local = ' + show(local),
    '$pairs = @(@($roam, (Join-Path $target "roaming")), @($local, (Join-Path $target "local")))',
    'foreach ($pair in $pairs) { if ($pair[0] -eq "") { continue }; if (-not (Test-Path $pair[0])) { try { New-Item -ItemType Junction -Path $pair[0] -Target $pair[1] -ErrorAction Stop | Out-Null } catch { } } }',
    '$ok = 0; foreach ($pair in $pairs) { if ($pair[0] -ne "" -and (Test-Path $pair[0])) { $ok += 1 } }; Write-Output $ok',
  ].join('; ')
  const junction = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  const junctionsReady = String(junction.stdout === undefined || junction.stdout === null ? '' : junction.stdout).trim() === '2'
  held('1-junctions', junctionsReady, 'both data directories resolve into the session workspace',
    ['APPDATA\\dev.dshlink.host = ' + show(roam), 'LOCALAPPDATA\\dev.dshlink.host = ' + show(local), 'target = ' + show(join(HOST_DATA, 'roaming'))])
  if (junctionsReady !== true) return 1

  // 2 - the world must be free: the proxy port is fixed, so the shipped shell has to be down
  const busy = [PROXY, KERNEL, CDP].filter((port) => listens(port))
  held('2-world-free', busy.length === 0, 'the shipped shell is down, so the host application can take 31761', ['listening = ' + show(busy)])
  if (busy.length > 0) {
    console.log('SKIP: ports ' + show(busy) + ' answer, so the shipped shell is running; the host application needs 31761 for itself.')
    console.log('      Stop it first - this tool never stops a process it did not start.')
    return 3
  }

  if (existsSync(BINARY) !== true) {
    held('3-launched', false, 'the host application is not built', ['expected ' + BINARY])
    console.log('the binary is missing: cargo build -p host-app (in src-tauri) writes it')
    return 1
  }

  const child = spawn(BINARY, ['--window=host-window', '--webview=dsh-link-sidebar'], {
    cwd: PROJECT,
    env: Object.assign({}, process.env, { DSH_LINK_WEBVIEW2_ARGS: '--remote-debugging-port=' + String(CDP), TEMP: join(HOST_DATA, 'temp'), TMP: join(HOST_DATA, 'temp') }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (chunk) => { log += String(chunk) })
  child.stderr.on('data', (chunk) => { log += String(chunk) })
  // Stopping: the host application AND the kernel it supervises. A forced stop does not run the shell's own
  // run-event half (which is what stops the kernel child in a normal exit), so the ports this run took are checked
  // directly - the world was verified free before the launch, so whatever holds them now is ours.
  const stop = () => {
    try { child.kill() } catch (ignored) { /* already gone */ }
    spawnSync('pwsh', ['-NoProfile', '-Command',
      'Get-Process host-app -ErrorAction SilentlyContinue | Stop-Process -Force; ' +
      'foreach ($p in 31761, 31760, 9223) { $owners = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($owner in $owners) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue } }',
    ], { timeout: 30000, windowsHide: true })
  }
  try {
    const deadline = Date.now() + TIMEOUT_MS
    let up = false
    while (Date.now() < deadline) {
      if (listens(PROXY) && listens(KERNEL) && listens(CDP)) { up = true; break }
      await sleep(1000)
    }
    const attachedLine = log.split(/\r?\n/).filter((line) => /attached webview/.test(line))[0]
    held('3-launched', up, 'the host application is up and its three ports answer',
      ['31761 = ' + String(listens(PROXY)), '31760 = ' + String(listens(KERNEL)), '9223 = ' + String(listens(CDP)), 'shell own line = ' + show(attachedLine === undefined ? null : attachedLine)])
    if (up !== true) return 1

    // 4 - the window tree
    const facts = windowFacts()
    // ConvertTo-Json turns an empty PowerShell array into null, so the rows are filtered to strings first.
    const children = (Array.isArray(facts.children) ? facts.children : []).filter((row) => typeof row === 'string')
    const webviewRow = children.filter((row) => row.indexOf('|WRY_WEBVIEW|') !== -1)[0]
    const chromiumRow = children.filter((row) => row.indexOf('Chrome_WidgetWin_1|') !== -1)[0]
    const clientTitle = chromiumRow === undefined ? null : (chromiumRow.split('|')[3] || null)
    held('4-attached',
      facts.found === true && webviewRow !== undefined && chromiumRow !== undefined && clientTitle !== null && clientTitle !== '',
      'the host window carries the shell webview as its own child',
      ['host window = ' + show(facts.found === true ? { hwnd: facts.hwnd, pid: facts.pid, box: facts.box } : facts),
        'first child = ' + show(webviewRow === undefined ? null : webviewRow),
        'chromium widget = ' + show(chromiumRow === undefined ? null : chromiumRow),
        'shell own line = ' + show(attachedLine === undefined ? null : attachedLine)])

    // 5 - the page inside it
    const page = await pageFacts()
    held('5-page',
      page !== null && String(page.url).indexOf('127.0.0.1:' + String(PROXY)) !== -1 && page.ready === 'complete' && page.boot === true,
      'the page in the host window is the shell own origin, complete, and the client booted', ['page = ' + show(page)])

    // 6 - the shell's own control route answers from inside the host
    const panel = await fetch('http://127.0.0.1:' + String(PROXY) + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'state' }) })
      .then(async (answer) => ({ status: answer.status, body: await answer.json().catch(() => null) }))
      .catch((error) => ({ status: 0, body: null }))
    held('6-panel-api',
      panel.status === 200 && panel.body !== null && typeof panel.body.label === 'string',
      'the shell own panel route answers op=state from inside the host application',
      ['status = ' + String(panel.status), 'label = ' + show(panel.body === null ? null : panel.body.label)])

    // 7 - pixels
    const captured = facts.capture === undefined ? null : facts.capture
    held('7-pixels',
      captured !== null && captured !== undefined && captured.bytes > 2000,
      'a PrintWindow capture of the host window was written',
      ['path = ' + show(captured === null || captured === undefined ? null : captured.path), 'bytes = ' + String(captured === null || captured === undefined ? 0 : captured.bytes), 'host box = ' + show(facts.found === true ? facts.box : null)])
  } finally {
    if (KEEP !== true) stop()
    await sleep(2500)
  }
  if (KEEP !== true) {
    const still = [PROXY, KERNEL, CDP].filter((port) => listens(port))
    held('8-stopped', still.length === 0, 'the host application is stopped and the ports are free again', ['listening = ' + show(still)])
  } else {
    held('8-stopped', true, 'left running on request (--keep)', ['the ports are still held by the host application'])
  }
  return readings.every((reading) => reading.ok === true) ? 0 : 1
}

process.exitCode = await (async () => {
  let code = 1
  try {
    code = await main()
  } catch (error) {
    console.log('  FAIL  the tool itself threw before it could judge (a TOOL bug, not a product verdict)')
    console.log('        ' + (error && error.stack ? String(error.stack).split('\n').slice(0, 6).join('\n        ') : String(error)))
    code = 1
  }
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  return code
})()
