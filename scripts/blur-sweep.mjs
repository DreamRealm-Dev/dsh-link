#!/usr/bin/env node
/**
 * Inject the material's source stylesheet with `--lg-blur` and `--lg-tint`
 * overridden, for measuring how much of a backdrop survives each combination.
 *
 *   node scripts/blur-sweep.mjs [port] <blur px> <fill %>
 *
 * The measurement itself is scripts/pixel.mjs; this only sets the state, so a
 * parameter sweep costs no image budget.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const port = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const blur = Number(args.shift() ?? 18)
const fill = Number(args.shift() ?? 30)
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
const body = "document.getElementById('lg-live')?.remove();"
  + "document.documentElement.setAttribute('data-lg-style', 'liquid-glass');"
  + "var tag = document.createElement('style'); tag.id = 'lg-live';"
  + "tag.textContent = " + JSON.stringify(css)
  + " + '\\nhtml[data-lg-style=\\'liquid-glass\\'] body, html[data-lg-style=\\'liquid-glass\\'] { --lg-blur: " + blur + "px; --lg-tint: " + fill + "%; }';"
  + "document.head.appendChild(tag);"
  + "return 'blur=" + blur + " fill=" + fill + "'"
await call('Runtime.evaluate', { expression: '(() => { ' + body + ' })()', returnByValue: true })
socket.close()
console.log('swept to blur=' + blur + 'px fill=' + fill + '%')
