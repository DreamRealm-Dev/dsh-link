#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it drops a test pattern into an ALREADY RUNNING shell's page over CDP (line 16 defaults to port 9222) and captures the result; the page it edits exists before it runs
/**
 * Prove the refraction filter actually bends a backdrop.
 *
 *   node scripts/probe-refraction.mjs [port] [output.png]
 *
 * The client's own content rarely sits behind a glass surface, so the material
 * cannot be judged from the app alone: this drops a high-contrast test pattern
 * into the page and covers the right half of it with a surface wearing the same
 * backdrop filter, then captures the pair. Straight lines turning near the
 * covered edge are the lens; unchanged lines mean the filter is doing nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const PORT = /^\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222
const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const page = targets.find(target => target.type === 'page' && String(target.url).includes(':31761'))
if (!page) { console.error('no page on the shell origin'); process.exit(1) }
const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const settle = pending.get(message.id)
  if (settle) { pending.delete(message.id); settle(message) }
})
await new Promise(done => socket.addEventListener('open', done, { once: true }))
const call = (method, params) => new Promise(settle => {
  const id = nextId++
  pending.set(id, settle)
  socket.send(JSON.stringify({ id, method, params }))
})

const FIXTURE = 'lg-refraction-fixture'
const build = '(() => {'
  + "document.getElementById('" + FIXTURE + "')?.remove();"
  + "var host = document.createElement('div'); host.id = '" + FIXTURE + "';"
  + "host.style.cssText = 'position:fixed;left:40px;top:40px;width:520px;height:320px;z-index:2147483647;border-radius:14px;overflow:hidden;';"
  + "host.style.backgroundImage = 'repeating-linear-gradient(90deg, #ffffff 0 14px, #0a0a0a 14px 28px)';"
  + "var glass = document.createElement('div');"
  + "var dressed = document.querySelector('[data-lg-refract]');"
  + "var lens = dressed ? dressed.style.getPropertyValue('--lg-refraction') : '';"
  + "glass.style.cssText = 'position:absolute;left:50%;top:0;width:50%;height:100%;border-radius:18px;background:rgba(255,255,255,0.05);backdrop-filter:blur(3px) saturate(1.6) ' + (lens || 'none') + ';'"
  + "  + 'box-shadow:inset 0 1px 0 0 rgba(255,255,255,0.4), inset 0 0 0 0.5px rgba(255,255,255,0.2)';"
  + "host.appendChild(glass); document.body.appendChild(host);"
  + "return { dressed: !!dressed, lens: lens } })()"
const teardown = "document.getElementById('" + FIXTURE + "')?.remove()"
let built
let answer
try {
  built = await call('Runtime.evaluate', { expression: build, returnByValue: true })
  answer = await call('Page.captureScreenshot', { format: 'png', clip: { x: 40, y: 40, width: 520, height: 320, scale: 1 } })
} finally {
  const removed = await call('Runtime.evaluate', { expression: teardown, returnByValue: true })
  const left = await call('Runtime.evaluate', { expression: "!!document.getElementById('" + FIXTURE + "')", returnByValue: true })
  socket.close()
  if (left.result?.result?.value === true) console.error('WARNING: the fixture is still in the page')
}
const data = answer.result?.data
if (data === undefined) { console.error('capture failed'); process.exit(2) }
// The default output stays out of the tracked tree: this probe is run by the live accept gate on
// every suite run, and rewriting a committed image turns "the suite is clean" into a diff.
const output = process.argv[3] ?? '.tmp/refraction.png'
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, Buffer.from(data, 'base64'))
console.log('engine filter present: ' + JSON.stringify(built.result?.result?.value))
console.log('wrote ' + output + ' — left half bare, right half behind the glass')
console.log('fixture removed from the page')