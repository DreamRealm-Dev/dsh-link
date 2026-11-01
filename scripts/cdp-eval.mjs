#!/usr/bin/env node
/**
 * Evaluate one expression inside the running shell's page over CDP.
 *
 *   node scripts/cdp-eval.mjs [port] <expression-file | --inline "js">
 *
 * The page is the official client served by the shell on 127.0.0.1:31761; the
 * shell must have been launched with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=<port>.
 * The expression's value is printed as JSON; an expression that throws prints the
 * exception text and exits non-zero, so a probe cannot pass silently.
 *
 * Kept separate from probe-bridge.mjs because that one asserts one fixed fact
 * about the bridge; this one is the general instrument.
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const port = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
let source
if (args[0] === '--inline') source = args[1]
else if (args[0] !== undefined) source = readFileSync(args[0], 'utf8')
else { console.error('usage: cdp-eval.mjs [port] <expr-file | --inline "js">'); process.exit(64) }

const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
const page = targets.find(target => target.type === 'page' && String(target.url).includes(':31761'))
if (!page) {
  console.error('no page on the shell origin; saw:', targets.map(t => t.url).join(', '))
  process.exit(1)
}

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

const answer = await call('Runtime.evaluate', {
  expression: '(() => { try { const value = (' + source + ')'
    + '; return value && typeof value.then === "function" ? value.then((settled) => JSON.stringify(settled)) : JSON.stringify(value) }'
    + ' catch (error) { return JSON.stringify({ __error: String(error) }) } })()',
  returnByValue: true,
  awaitPromise: true,
})
const value = answer.result?.result?.value
socket.close()
if (value === undefined) {
  console.error('evaluate failed:', JSON.stringify(answer))
  process.exit(2)
}
const parsed = JSON.parse(value)
if (parsed !== null && typeof parsed === 'object' && '__error' in parsed) {
  console.error('expression threw:', parsed.__error)
  process.exit(3)
}
console.log(JSON.stringify(parsed, null, 2))
