#!/usr/bin/env node
/**
 * Read the rendered pixels of a region, over CDP, without a human looking at them.
 *
 *   node scripts/pixel.mjs [port] x,y,w,h [--scale n]
 *
 * Prints the mean colour of the clip, its darkest and lightest channel, and the
 * spread between them. That last number is the useful one: a mean says what a
 * surface *is*, and a spread says how much of what is behind it still shows
 * through — which is the quantity every judgement about this material has needed.
 * A row-by-row version of the same reading, for questions that are vertical, lives
 * in png-profile.mjs; the decoding itself is shared with it through lib/png.mjs.
 *
 * PNG rather than JPEG because the bytes have to be exact: the capture is decoded
 * here instead of handed to an image viewer, so a measurement costs no image budget.
 */
import { decode, stats } from './lib/png.mjs'

const args = process.argv.slice(2)
const port = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const box = (args.shift() ?? '0,0,8,8').split(',').map(Number)
if (box.length !== 4 || box.some(Number.isNaN)) { console.error('usage: pixel.mjs [port] x,y,w,h'); process.exit(64) }
const scaleIndex = args.indexOf('--scale')
const scale = scaleIndex === -1 ? 1 : Number(args[scaleIndex + 1])

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
const answer = await call('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box[0], y: box[1], width: box[2], height: box[3], scale },
})
socket.close()
const base64 = answer.result?.data
if (base64 === undefined) { console.error('capture failed'); process.exit(2) }

const image = decode(Buffer.from(base64, 'base64'))
console.log(JSON.stringify({ clip: box, ...stats(image) }))
