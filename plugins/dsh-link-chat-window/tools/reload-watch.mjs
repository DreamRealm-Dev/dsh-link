#!/usr/bin/env node
/**
 * Reload the LINK shell page over CDP while capturing console/exception/network failures.
 *   node plugins/dsh-link-chat-window/tools/reload-watch.mjs [port] [waitMs]
 */
import { connect } from './cdp.mjs'
const args = process.argv.slice(2)
const port = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const waitMs = Number(args[0] ?? '15000')
const cdp = await connect({ port })
const events = []
await cdp.call('Runtime.enable')
await cdp.call('Log.enable')
await cdp.call('Page.enable')
await cdp.call('Network.enable')
cdp.socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
    events.push({ kind: 'console.' + message.params.type, text: String(text).slice(0, 400) })
  } else if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    events.push({ kind: 'exception', text: String(details.exception?.description ?? details.text).slice(0, 600) })
  } else if (message.method === 'Log.entryAdded') {
    events.push({ kind: 'log.' + message.params.entry.level, text: String(message.params.entry.text).slice(0, 400) })
  } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    events.push({ kind: 'http.' + String(message.params.response.status), text: String(message.params.response.url).slice(0, 300) })
  }
})
await cdp.call('Page.reload', { ignoreCache: false })
await new Promise(resolve => setTimeout(resolve, waitMs))
const state = await cdp.evaluate('({ title: document.title, dom: document.querySelectorAll("*").length, rootChildren: document.querySelector("#root")?.childElementCount ?? null, global: globalThis.__DSH_EVENT_WINDOW_LIMIT__ ?? null })')
console.log(JSON.stringify({ state, events: events.slice(0, 100) }, null, 2))
cdp.close()
