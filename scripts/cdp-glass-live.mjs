#!/usr/bin/env node
/**
 * Apply the *source* of the Liquid Glass stylesheet to the running page, without
 * rebuilding the plugin bundle.
 *
 *   node scripts/cdp-glass-live.mjs [port] [--off]
 *
 * The plugin's bundle only changes when plugins/build.mjs runs and the page
 * reloads, which is too slow to tune a stylesheet by eye. This harness injects
 * exactly the file the bundle would carry — src/client/material.css — and sets
 * the document attribute, so the loop is one file edit per look.
 *
 * The refraction filter is *not* injected: the engine builds it from the baked
 * lens map in src/client/displacement.ts, so a change there needs a rebuild and
 * a reload. Its output is not evidence; a rebuilt bundle and a reload are.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = /^\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222
const off = process.argv.includes('--off')
const ROOT = resolve(import.meta.dirname, '..')
const css = readFileSync(resolve(ROOT, 'plugins/dsh-liquid-glass/src/client/material.css'), 'utf8')

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

const body = off
  ? "document.getElementById('lg-live')?.remove();"
    + "document.documentElement.removeAttribute('data-lg-style');"
    + "return 'off'"
  : "document.getElementById('lg-live')?.remove();"
    + "document.documentElement.setAttribute('data-lg-style', 'liquid-glass');"
    + "var tag = document.createElement('style'); tag.id = 'lg-live';"
    + "tag.textContent = " + JSON.stringify(css) + "; document.head.appendChild(tag);"
    + "var filter = document.querySelector('filter[id^=\"dsh-lg-refract\"]');"
    + "return filter ? 'css + engine filter' : 'css only (engine filter missing)'"
const answer = await call('Runtime.evaluate', { expression: '(() => { ' + body + ' })()', returnByValue: true })
socket.close()
if (answer.result?.exceptionDetails) { console.error(JSON.stringify(answer.result.exceptionDetails).slice(0, 500)); process.exit(3) }
console.log('live material: ' + answer.result?.result?.value)
