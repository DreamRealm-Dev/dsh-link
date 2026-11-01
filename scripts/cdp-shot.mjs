#!/usr/bin/env node
/**
 * Capture the running shell's page to a PNG over CDP.
 *
 *   node scripts/cdp-shot.mjs [port] <output.png> [--full] [--clip x,y,w,h]
 *
 * Screenshots are how a visual change gets reviewed: the computed styles say the
 * material is mounted, only the pixels say whether it reads as glass. `--clip`
 * takes a device-pixel rect (multiply CSS pixels by devicePixelRatio).
 */
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const port = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const output = args.shift()
if (output === undefined) { console.error('usage: cdp-shot.mjs [port] <output.png> [--full] [--clip x,y,w,h]'); process.exit(64) }
const full = args.includes('--full')
const clipIndex = args.indexOf('--clip')
const clip = clipIndex === -1 ? undefined : (() => {
  const [x, y, width, height] = args[clipIndex + 1].split(',').map(Number)
  return { x, y, width, height, scale: 1 }
})()

const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
const page = targets.find(target => target.type === 'page' && String(target.url).includes(':31761'))
if (!page) { console.error('no page on the shell origin'); process.exit(1) }

const socket = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 1
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const resolve = pending.get(message.id)
  if (resolve) { pending.delete(message.id); resolve(message) }
})
await new Promise(done => socket.addEventListener('open', done, { once: true }))
const call = (method, params) => new Promise(resolve => {
  const id = nextId++
  pending.set(id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})

const answer = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip === undefined ? {} : { clip }) })
socket.close()
const data = answer.result?.data
if (data === undefined) { console.error('capture failed:', JSON.stringify(answer).slice(0, 400)); process.exit(2) }
writeFileSync(output, Buffer.from(data, 'base64'))
console.log('wrote ' + output)
