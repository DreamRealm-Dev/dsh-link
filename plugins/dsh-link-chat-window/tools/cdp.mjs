/**
 * Minimal CDP helper for the LINK shell page (audit tooling for R493 / dsh-link-chat-window).
 *
 * Connects to the WebView2 page exposed by the running shell
 * (DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=9222), evaluates one expression with
 * awaitPromise + returnByValue, and returns the JSON value. Read-only: the audits never
 * dispatch input, navigate, or reload.
 */
const DEFAULT_PORT = 9222
const SHELL_ORIGIN = '127.0.0.1:31761'

/** @returns {Promise<{ call: (method: string, params?: object) => Promise<any>, evaluate: (expression: string) => Promise<any>, close: () => void, page: any }>} */
export const connect = async ({ port = DEFAULT_PORT, origin = SHELL_ORIGIN, deadlineMs = 15000 } = {}) => {
  const list = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json())
  const pages = list.filter(target => target.type === 'page' && String(target.url).startsWith('http'))
  const page = pages.find(target => String(target.url).includes(origin)) ?? pages[0]
  if (page === undefined) throw new Error('no CDP page target: ' + JSON.stringify(list.map(t => t.url)))
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)
    if (settle !== undefined) { pending.delete(message.id); settle(message) }
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(undefined), { once: true })
    socket.addEventListener('error', reject, { once: true })
    setTimeout(() => reject(new Error('CDP open timeout')), deadlineMs)
  })
  const call = (method, params = {}, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, timeoutMs)
    pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
    socket.send(JSON.stringify({ id, method, params }))
  })
  socket.addEventListener('close', () => {
    for (const settle of pending.values()) settle({ error: { message: 'CDP socket closed' } })
    pending.clear()
  })
  const evaluate = async (expression, timeoutMs = 30000) => {
    const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)
    const result = answer?.result?.result
    if (result === undefined) throw new Error('evaluate failed: ' + JSON.stringify(answer))
    if (answer.result.exceptionDetails !== undefined) {
      throw new Error('page exception: ' + (answer.result.exceptionDetails.exception?.description ?? answer.result.exceptionDetails.text))
    }
    return result.value
  }
  return { call, evaluate, close: () => socket.close(), page, socket }
}