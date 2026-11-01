#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - its own header (lines 9-10) tells the operator to start dsh-link.exe with the debugging port first and then run this against that port, so the tree it reads belongs to somebody else
/**
 * Ask the running shell what the official client's page actually sees.
 *
 * Reads the WebView2 debug endpoint and evaluates a probe in the page over CDP. This is
 * the check a served script tag cannot make: the tag proves the bytes arrived, not that
 * the Desktop-only surfaces woke up.
 *
 *   dsh-link.exe with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=9222
 *   node scripts/probe-bridge.mjs [port]
 */
const port = Number(process.argv[2] ?? 9222)

const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
const page = targets.find(target => target.type === 'page' && String(target.url).includes('31761'))
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

const expression = 'JSON.stringify({'
  + 'origin: location.origin,'
  + 'bootManifest: typeof window.__DSH_BOOT__ === "object",'
  + 'dshDesktop: typeof globalThis.dshDesktop,'
  + 'protocolVersion: globalThis.dshDesktop && globalThis.dshDesktop.protocolVersion,'
  + 'dshOnboarding: typeof globalThis.dshOnboarding,'
  + 'openRouted: String(window.open).indexOf("__shell/open") !== -1,'
  + 'rootChildren: document.body ? document.body.children.length : 0,'
  + 'labels: [].slice.call(document.querySelectorAll("button,a")).map(function (node) {'
  + '  return (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 24)'
  + '}).filter(Boolean).slice(0, 60),'
  + '})'

const probe = await call('Runtime.evaluate', { expression, returnByValue: true })
const value = probe.result?.result?.value
if (value === undefined) {
  console.error('evaluate failed:', JSON.stringify(probe))
  process.exit(2)
}
const seen = JSON.parse(value)
console.log('page:', JSON.stringify({ ...seen, labels: undefined }))
const accountish = seen.labels.filter(label => /账号|登录|Account|Sign in|更多/.test(label))
console.log('account entries in the dom:', JSON.stringify(accountish))
socket.close()
