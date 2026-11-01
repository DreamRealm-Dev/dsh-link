#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it attaches over CDP to a shell that is ALREADY RUNNING (usage line 11 takes the debug port) and only drives the account menu inside that page, so it has no composition of its own whose liveness it could read
/**
 * Drive the official client's account menu over CDP and report what it offers.
 *
 * The account menu is where the shell's two page-level policies are visible: the
 * feedback entry is removed because this install is not DeepSeek, and every external
 * link must leave for the system browser instead of opening a second application
 * window. Both are checked here; the link check is opt-in because it opens a browser
 * tab on the machine running it.
 *
 *   node scripts/probe-account.mjs [port] [--open-test]
 */
const args = process.argv.slice(2)
const openTest = args.includes('--open-test')
const port = Number(args.find(arg => /^\d+$/.test(arg)) ?? 9222)

const list = () => fetch('http://127.0.0.1:' + port + '/json/list').then(response => response.json())
const targets = await list()
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
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails))
  return result.result?.result?.value
}

// The trigger is the account entry the injected bridge is what makes appear at all.
const triggerSelector = 'button[aria-label="账号菜单"]'
const clicked = await evaluate('(function () {'
  + 'var trigger = document.querySelector(' + JSON.stringify(triggerSelector) + ');'
  + 'if (!trigger) return "no account trigger";'
  + 'trigger.click(); return "clicked";'
  + '})()')
console.log('account menu:', clicked)
await new Promise(done => setTimeout(done, 600))
const items = await evaluate('JSON.stringify([].slice.call(document.querySelectorAll("[role=menu] button[role=menuitem]"))'
  + '.map(function (row) { return (row.textContent || "").trim() }))')
console.log('menu entries:', items)
const parsed = JSON.parse(items ?? '[]')
console.log('feedback entry present:', parsed.some(entry => /意见反馈|Feedback/.test(entry)))

if (args.includes('--signin')) {
  // Exactly the click the user reports, then everything observable about where the
  // authorization page ended up: the page's own URL, any dialog, any in-app tab or
  // frame, and the webview's target list.
  const opened = await evaluate('(function () {'
    + 'if (document.querySelector("[role=menu] button[role=menuitem]")) return "already open";'
    + 'var trigger = document.querySelector(' + JSON.stringify(triggerSelector) + ');'
    + 'if (trigger) trigger.click(); return "opened";'
    + '})()')
  console.log('menu:', opened)
  await new Promise(done => setTimeout(done, 500))
  const picked = await evaluate('(function () {'
    + 'var rows = document.querySelectorAll("[role=menu] button[role=menuitem]");'
    + 'for (var i = 0; i < rows.length; i++) {'
    + '  if (/登录|Sign in/.test(rows[i].textContent || "")) { rows[i].click(); return "clicked sign-in"; }'
    + '}'
    + 'return "no sign-in entry";'
    + '})()')
  console.log('sign-in:', picked)
  await new Promise(done => setTimeout(done, 7000))
  const state = await evaluate('JSON.stringify({'
    + 'href: location.href,'
    + 'dialogs: document.querySelectorAll("[role=dialog]").length,'
    + 'dialogText: ((document.querySelector("[role=dialog]") || {}).textContent || "").slice(0, 160),'
    + 'rightTabs: [].slice.call(document.querySelectorAll("[role=tab]")).map(function (t) { return (t.textContent || "").trim().slice(0, 24) }),'
    + 'iframes: [].slice.call(document.querySelectorAll("iframe,webview")).map(function (f) { return f.src || f.getAttribute("src") }),'
    + '})')
  console.log('after sign-in:', state)
  const after = await list()
  console.log('page targets:', after.filter(t => t.type === 'page').length, after.filter(t => t.type === 'page').map(t => t.url).join(' | '))
}

if (openTest) {
  await evaluate('(function () {'
    + 'var link = document.createElement("a");'
    + 'link.href = "https://example.invalid/dsh-link-probe";'
    + 'link.target = "_blank"; link.rel = "noreferrer"; link.textContent = "probe";'
    + 'document.body.appendChild(link); link.click(); return "clicked";'
    + '})()')
  await new Promise(done => setTimeout(done, 2500))
  const after = await list()
  const pages = after.filter(target => target.type === 'page')
  console.log('page targets after the blank-target click:', pages.length, pages.map(t => t.url).join(', '))
}
socket.close()
