#!/usr/bin/env node
/**
 * Measure what the material costs in frame time, with and without it applied.
 *
 *   node scripts/perf.mjs [port]
 *
 * Each run scrolls the conversation for a fixed number of frames and reports the
 * rAF delta distribution. The tail is what matters: the median says the material is
 * smooth, p95 and the long-frame count say whether a backdrop-filter plus a
 * displacement filter can be absorbed while content moves underneath. Measured in
 * the page, so it costs no image budget.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FRAMES = 240
const port = /^\\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222
const css = readFileSync(resolve(import.meta.dirname, '../plugins/dsh-liquid-glass/src/client/material.css'), 'utf8')

const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
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
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (answer.result?.exceptionDetails) throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 300))
  return answer.result?.result?.value
}

const MEASURE = '(async () => {'
  + 'const scroller = document.querySelector(\'[class*="scrollBody"]\');'
  + 'const deltas = []; let last = performance.now(); let step = 0;'
  + 'await new Promise((done) => {'
  + '  const tick = () => {'
  + '    const now = performance.now(); deltas.push(now - last); last = now;'
  + '    if (scroller) { const max = scroller.scrollHeight - scroller.clientHeight; scroller.scrollTop = (Math.sin(step / 30) / 2 + 0.5) * max }'
  + '    step += 1;'
  + '    if (step >= ' + FRAMES + ') done(); else requestAnimationFrame(tick);'
  + '  };'
  + '  requestAnimationFrame(tick);'
  + '});'
  + 'const sorted = deltas.slice(3).sort((a, b) => a - b);'
  + 'const at = (q) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1));'
  + 'return { frames: sorted.length, median: at(0.5), p95: at(0.95), worst: Number(sorted[sorted.length - 1].toFixed(1)), over33: sorted.filter(d => d > 33).length, scrolled: !!scroller }'
  + '})()'

const setMaterial = (on) => evaluate(on
  ? "document.getElementById('lg-live')?.remove();"
    + "document.documentElement.setAttribute('data-lg-style', 'liquid-glass');"
    + "var t = document.createElement('style'); t.id = 'lg-live'; t.textContent = " + JSON.stringify(css) + "; document.head.appendChild(t); 'on'"
  : "document.getElementById('lg-live')?.remove(); document.documentElement.removeAttribute('data-lg-style'); 'off'")

await setMaterial(false)
const off = await evaluate(MEASURE)
await setMaterial(true)
const on = await evaluate(MEASURE)
await setMaterial(true)
socket.close()
console.log(JSON.stringify({ materialOff: off, materialOn: on }, null, 2))
