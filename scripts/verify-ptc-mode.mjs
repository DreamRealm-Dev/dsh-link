#!/usr/bin/env node
/**
 * verify-ptc-mode.mjs - does this DSH-LINK instance actually offer Programmatic Tool Calling?
 *
 * PTC (Programmatic Tool Calling) is the built-in "ptc" Agent preset: tools are called from code,
 * so one step can use many tools. Two readings have to hold together:
 *
 *   1. the Coding-Tools document - client setting ui-settings.enabled, written into the profile
 *      patch layer - is ON. With it OFF the preset switcher hides the built-in ptc and minimal
 *      presets (that is why "PTC 模式" was absent while the host roster listed ptc as healthy).
 *   2. the RUNNING app's mode switcher lists "PTC 模式" by name.
 *
 *   node scripts/verify-ptc-mode.mjs [--port 9222] [--home <kernel-home>] [--json]
 *
 * The app must be running with the remote-debugging port. Exit 0 only when both readings hold.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(flag('--port', '9222'))
const HOME = flag('--home', join(homedir(), 'AppData', 'Roaming', 'dev.dshlink.client', 'dsh-link', 'kernel-home'))
const JSON_OUT = argv.includes('--json')
const rows = []
const hold = (id, ok, detail) => rows.push({ id, ok: ok === true, detail: String(detail ?? '') })

// Reading 1: the Coding-Tools document in the profile patch layer.
const patchPath = join(HOME, 'profiles', 'web', 'cordis.patch.yml')
let toolsEnabled = null
let patchProblem = null
try {
  const lines = readFileSync(patchPath, 'utf8').split(/\r?\n/)
  let inRow = false
  for (const line of lines) {
    if (/^- id: ui-settings$/.test(line)) { inRow = true; continue }
    if (inRow && /^- id: /.test(line)) inRow = false
    if (!inRow) continue
    const match = /^\s+enabled:\s*(true|false)\s*$/.exec(line)
    if (match !== null) { toolsEnabled = match[1] === 'true'; break }
  }
} catch (error) {
  patchProblem = String(error?.message ?? error)
}
hold('settings: Coding Tools (ui-settings.enabled) is ON', toolsEnabled === true, 'ui-settings.enabled=' + String(toolsEnabled) + (patchProblem === null ? '' : ' (' + patchProblem + ')'))

// Reading 2: the running app's mode switcher lists PTC.
const targets = await (await fetch('http://127.0.0.1:' + String(PORT) + '/json/list')).json().catch(() => [])
const page = targets.find((target) => target.type === 'page' && String(target.url).includes(':31761'))
let menu = null
let failure = null
if (page === undefined) failure = 'no shell page on the CDP endpoint (is DSH-LINK running with the debugging port?)'
else {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (resolve !== undefined) { pending.delete(message.id); resolve(message) }
  })
  await new Promise((done) => socket.addEventListener('open', done, { once: true }))
  const call = (method, params) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (source) => (await call('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true })).result?.result?.value
  try {
    menu = await evaluate(readFileSync(join(HERE, 'lib', 'ptc-mode-menu.js'), 'utf8'))
  } catch (error) {
    failure = String(error?.message ?? error)
  } finally {
    socket.close()
  }
}
const listsPtc = menu !== null && menu.found === true && String(menu.text ?? '').includes('PTC 模式')
hold('app: the mode switcher lists PTC 模式', listsPtc, failure ?? (menu === null ? 'no reading' : 'chip=' + String(menu.chip) + ' hasPtc=' + String(String(menu.text ?? '').includes('PTC 模式'))))

const held = rows.filter((row) => row.ok).length
if (JSON_OUT) console.log(JSON.stringify({ home: HOME, rows, held, failed: rows.length - held }, null, 2))
else {
  for (const row of rows) console.log((row.ok ? 'ok   ' : 'FAIL ') + row.id + (row.detail === '' ? '' : '  [' + row.detail + ']'))
  console.log('---')
  console.log('PTC mode gate: ' + held + '/' + rows.length + ' held, ' + (rows.length - held) + ' failed')
}
process.exitCode = rows.every((row) => row.ok) ? 0 : 1
