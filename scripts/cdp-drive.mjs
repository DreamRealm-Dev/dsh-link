// A small CDP driver for the LIVE gates: connect to the shell's page target, evaluate JavaScript in it,
// and dispatch REAL mouse input. Extracted for gate 96 (R144) so a gate can be about verdicts rather
// than about websockets. Every function returns a plain object and never throws on a bad answer.
//
// Why input events rather than a scripted element.click(): the geometry gate is about the real gesture -
// the official button and the divider handle are driven the way a user drives them, so an implementation
// that only follows a synthetic layout poke must not pass.
//
//   const cdp = await connect({ port: 9222 })   // null when CDP is not answering
//   await cdp.json(COLUMN_PROBE)                // { ok, value }: this file's probe of the right column
//   await cdp.click({ x: 1396, y: 72 })
//   await cdp.drag({ from: { x: 791, y: 400 }, to: { x: 691, y: 400 }, steps: 5 })
//   cdp.close()
export const COLUMN_SELECTOR = '[data-rightbar-col]'

const opened = (socket, deadlineMs) => new Promise((settle) => {
  const done = (value) => settle(value)
  socket.addEventListener('open', () => done(true), { once: true })
  socket.addEventListener('error', () => done(false), { once: true })
  setTimeout(() => done(false), deadlineMs)
})

export const connect = async ({ port = 9222, prefer = '127.0.0.1:31761', deadlineMs = 15000 } = {}) => {
  const list = await fetch('http://127.0.0.1:' + port + '/json/list').then((r) => r.json()).catch(() => null)
  if (list === null || Array.isArray(list) === false) return null
  const pages = list.filter((target) => target.type === 'page' && /^https?:\/\//.test(String(target.url)))
  // R277: WHICH page this driver attaches to is not "the first one". The DRSS rig runs its own shell with its own
  // CDP-exposed webviews, so /json/list now answers with several pages and the first one is another application's.
  // Every gate that derives the shell's port from `cdp.page` (the panel API lives on the shell origin) silently
  // talked to the wrong app: measured as "the shell did not answer op=state" on three readings of one gate while
  // the same POST answered 200 when made by hand. The shell's own origin is preferred, and the first http page is
  // still the fallback for a machine that runs only one of them.
  const page = pages.find((target) => String(target.url).includes(prefer)) ?? pages[0]
  if (page === undefined) return null
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)
    if (settle !== undefined) { pending.delete(message.id); settle(message) }
  })
  const ready = await opened(socket, deadlineMs)
  if (ready !== true || socket.readyState !== 1) { try { socket.close() } catch (error) { } return null }
  const call = (method, params) => new Promise((settle) => {
    const id = nextId++
    pending.set(id, settle)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    const result = answer?.result?.result
    return {
      value: result?.value ?? null,
      description: result?.description ?? null,
      exception: answer?.result?.exceptionDetails?.text ?? answer?.error?.message ?? null,
    }
  }
  // json() is the one degradable step: a page that answers something unparsable is a reading, not a crash.
  const json = async (expression) => {
    const answer = await evaluate(expression)
    if (typeof answer.value !== 'string') return { ok: false, why: 'expression did not return a string', answer }
    try { return { ok: true, value: JSON.parse(answer.value), answer } }
    catch (error) { return { ok: false, why: 'not JSON: ' + error.message, answer } }
  }
  const mouse = (type, spot, buttons) => call('Input.dispatchMouseEvent', {
    type, x: spot.x, y: spot.y, button: 'left', buttons, pointerType: 'mouse',
    clickCount: type === 'mouseMoved' ? 0 : 1,
  })
  const click = async (spot) => {
    await mouse('mousePressed', spot, 1)
    await mouse('mouseReleased', spot, 0)
    return true
  }
  // A drag is a sequence a UI reacts to, not a teleport: the first version fired every move back to back and
  // the client (which drags on rAF) sometimes saw only the press and the release. Each step now also gets a
  // moment to be processed, and the caller can find out how many steps it took.
  const drag = async ({ from, to, steps = 6, settleMs = 80 }) => {
    await mouse('mouseMoved', from, 0)
    await new Promise((done) => setTimeout(done, settleMs))
    await mouse('mousePressed', from, 1)
    for (let step = 1; step <= steps; step += 1) {
      await mouse('mouseMoved', { x: Math.round(from.x + ((to.x - from.x) * step) / steps), y: Math.round(from.y + ((to.y - from.y) * step) / steps) }, 1)
      await new Promise((done) => setTimeout(done, settleMs))
    }
    await mouse('mouseReleased', to, 0)
    return steps
  }
  return { page: page.url, port, evaluate, json, click, drag, call, close: () => { try { socket.close() } catch (error) { } } }
}

/**
 * The page-side probe, written as a REAL function and shipped to the page through toString(): the labels
 * it matches are Chinese and the expression is full of quotes, and quoting an expression by hand is how a
 * probe silently stops matching. Here the local parser checks it and the page only runs it.
 *
 * It reports what it finds and never invents a box: no column is null, not a zero rectangle.
 */
export const columnProbe = (selector) => {
  const column = document.querySelector(selector)
  const box = column ? column.getBoundingClientRect() : null
  const buttons = []
  const all = document.querySelectorAll('button')
  for (let index = 0; index < all.length; index += 1) {
    const label = String(all[index].getAttribute('aria-label') || all[index].getAttribute('title') || '').trim()
    if (label === '\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f' || label === '\u6536\u8d77\u53f3\u4fa7\u8fb9\u680f') {
      const spot = all[index].getBoundingClientRect()
      buttons.push({ label: label, x: Math.round(spot.x + spot.width / 2), y: Math.round(spot.y + spot.height / 2) })
    }
  }
  // The divider that belongs to THIS column is the one on its left edge. An earlier version asked for a
  // handle right of the window centre, which silently found NOTHING once the column was wide enough to put
  // its own divider left of centre - a probe that stops matching exactly when the thing it measures grows.
  let handle = null
  let handleDistance = null
  const candidates = document.querySelectorAll('[class*=handle]')
  for (let index = 0; index < candidates.length; index += 1) {
    const spot = candidates[index].getBoundingClientRect()
    if (spot.width <= 0 || spot.width >= 40 || spot.height < 100) continue
    if (getComputedStyle(candidates[index]).cursor !== 'col-resize') continue
    if (box === null) continue
    const distance = Math.abs(spot.x + spot.width / 2 - box.x)
    if (distance > 40) continue
    if (handleDistance === null || distance < handleDistance) {
      handleDistance = distance
      handle = { x: Math.round(spot.x + spot.width / 2), y: Math.round(spot.y + spot.height / 2), w: Math.round(spot.width), cls: String(candidates[index].className).slice(0, 40) }
    }
  }
  const host = globalThis.__DSH_LINK_PANEL_HOST
  return JSON.stringify({
    url: location.href,
    innerWidth: Math.round(window.innerWidth),
    innerHeight: Math.round(window.innerHeight),
    column: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
    buttons: buttons,
    handle: handle,
    scale: window.devicePixelRatio,
    hostState: host ? host.state() : null,
  })
}

export const COLUMN_PROBE = '(' + columnProbe.toString() + ')(' + JSON.stringify(COLUMN_SELECTOR) + ')'
