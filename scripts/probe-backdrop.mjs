#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it hides an element and captures it in a page of an ALREADY RUNNING shell over CDP (usage line 5 takes the port, line 34 opens the debugger socket); the app is a precondition, not a thing it starts
/**
 * Look at what a surface is actually sitting on.
 *
 *   node scripts/probe-backdrop.mjs [port] <css-selector> [--step n] [--out prefix]
 *
 * A translucent surface is only as good as its backdrop, and the backdrop is the
 * one thing the app never shows you: it is hidden behind the very surface being
 * judged. So the element is captured twice — once hidden, which is the raw
 * backdrop, and once as it renders — and the two are printed row by row. A step
 * in the backdrop column is the client's own ground showing through the glass; a
 * step in both columns is the material failing to keep up with it. Rows are
 * device rows, because the capture is at device resolution; the CSS row is the
 * same row divided by the device pixel ratio.
 *
 * The element is restored in a `finally` and re-read afterwards to confirm it: a
 * probe that leaves the app modified is a defect of its own.
 */
import { writeFileSync } from 'node:fs'
import { decode, rowProfile, stats } from './lib/png.mjs'

const args = process.argv.slice(2)
const PORT = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const selector = args.shift()
if (selector === undefined) { console.error('usage: probe-backdrop.mjs [port] <css-selector> [--step n] [--out prefix]'); process.exit(64) }
const stepIndex = args.indexOf('--step')
const step = stepIndex === -1 ? 3 : Number(args[stepIndex + 1])
const outIndex = args.indexOf('--out')
const prefix = outIndex === -1 ? undefined : args[outIndex + 1]

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
const evaluate = async (expression) => {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true })
  if (answer.result?.exceptionDetails) throw new Error('evaluate threw: ' + JSON.stringify(answer.result.exceptionDetails).slice(0, 200))
  return answer.result?.result?.value
}

const MARK = 'data-probe-backdrop'
const found = await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null;'
  + ' const r = el.getBoundingClientRect();'
  + ' return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), dpr: devicePixelRatio, style: document.documentElement.dataset.lgStyle } })()')
if (found === null) { console.error('no element matches ' + selector); process.exit(1) }
const box = { x: found.x, y: found.y, width: found.width, height: found.height }
console.log(JSON.stringify({ selector, box, dpr: found.dpr, style: found.style }))

const shoot = async (file) => {
  const answer = await call('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } })
  const data = answer.result?.data
  if (data === undefined) throw new Error('capture failed')
  const buffer = Buffer.from(data, 'base64')
  if (file !== undefined) writeFileSync(file, buffer)
  return decode(buffer)
}

let backdrop
let surface
let restored = 'not-attempted'
try {
  await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + ');'
    + ' el.setAttribute("' + MARK + '", el.style.visibility);'
    + ' el.style.visibility = "hidden"; return true })()')
  backdrop = await shoot(prefix === undefined ? undefined : prefix + '-backdrop.png')
  restored = await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + ');'
    + ' if (!el.hasAttribute("' + MARK + '")) return "gone";'
    + ' const previous = el.getAttribute("' + MARK + '");'
    + ' if (previous === "") el.style.removeProperty("visibility"); else el.style.visibility = previous;'
    + ' el.removeAttribute("' + MARK + '");'
    + ' return el.style.visibility || "" })()')
  surface = await shoot(prefix === undefined ? undefined : prefix + '-surface.png')
} finally {
  const left = await evaluate('(() => { const el = document.querySelector(' + JSON.stringify(selector) + ');'
    + ' return el === null ? "gone" : (el.hasAttribute("' + MARK + '") ? "marked" : (el.style.visibility === "hidden" ? "hidden" : "clean")) })()')
  socket.close()
  if (left !== 'clean') console.error('WARNING: the element was left as ' + left)
  else console.log('element restored, page re-read as clean (inline visibility ' + JSON.stringify(restored) + ')')
}

console.log(JSON.stringify({ backdrop: stats(backdrop), surface: stats(surface) }))
const upper = rowProfile(backdrop)
const lower = rowProfile(surface)
console.log('  dev y   css y | backdrop mean   ink | surface mean   ink')
for (const row of upper) {
  if (row.y % step !== 0 && row.y !== upper.length - 1) continue
  const mirrored = lower[row.y]
  console.log('  ' + String(row.y).padStart(5) + '  ' + (found.y + row.y / found.dpr).toFixed(1).padStart(7)
    + ' | ' + String(row.mean).padStart(13) + ' ' + String(row.ink).padStart(4)
    + ' | ' + String(mirrored.mean).padStart(12) + ' ' + String(mirrored.ink).padStart(4))
}
