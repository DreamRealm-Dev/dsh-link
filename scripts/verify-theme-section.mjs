#!/usr/bin/env node
/**
 * Drive the Theme section over CDP and assert the control-style preference
 * reaches both the settings document and the running material.
 *
 *   node scripts/verify-theme-section.mjs [port]
 *
 * The shell must be running with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=<port>.
 * Every check prints PASS/FAIL; the process exits non-zero when any fails, so
 * this is the acceptance gate for the section rather than a screenshot to read.
 */
const port = /^\d+$/.test(process.argv[2] ?? '') ? Number(process.argv[2]) : 9222

/**
 * Find the client's page, waiting for it to exist.
 *
 * A reload replaces the CDP target: a gate that inspects the page immediately
 * after one would otherwise fail on a page that is about to be there. Waiting is
 * what makes this usable next to a reload, so it is checked in that exact
 * situation.
 */
const findPage = async () => {
  const deadline = Date.now() + 20000
  for (;;) {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
    const found = targets.find(target => target.type === 'page' && String(target.url).includes(':31761'))
    if (found !== undefined) return found
    if (Date.now() > deadline) {
      console.error('no page on the shell origin within 20s; saw: ' + targets.map(t => t.url).join(', '))
      process.exit(1)
    }
    await new Promise(wake => setTimeout(wake, 250))
  }
}
const page = await findPage()
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
const evaluate = async (expression) => {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (answer.result?.exceptionDetails) throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 400))
  return answer.result?.result?.value
}

const driver = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const label = (node) => (node.textContent || '').trim()
  /* Every step below waits *for the condition* rather than for a delay, and says what it
   * saw when it gives up. This gate went red once with an empty navigation on a machine
   * that was merely busy: a fixed sleep after a click is a race, and a race that reports
   * nothing but [] is indistinguishable from a broken feature. */
  const until = async (predicate, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = predicate()
      if (found) return found
      if (Date.now() > deadline) return null
      await wait(150)
    }
  }
  const snapshot = () => ({
    dialogOpen: !!document.querySelector('[role="dialog"]'),
    menus: Array.from(document.querySelectorAll('[role="menuitem"]')).map(label).slice(0, 24),
    dialogButtons: Array.from(document.querySelectorAll('[role="dialog"] button')).map(label).slice(0, 24),
  })
  document.querySelector('[data-slot="settings.launcher"] button')?.click()
  const entry = await until(() => Array.from(document.querySelectorAll('[role="menuitem"], button')).find(n => label(n).startsWith('设置')))
  if (!entry) return { failed: 'no 设置 entry appeared in the launcher menu within 8s', seen: snapshot() }
  entry.click()
  const dialog = await until(() => document.querySelector('[role="dialog"]'))
  if (!dialog) return { failed: 'the settings dialog did not open within 8s', seen: snapshot() }
  const nav = await until(() => Array.from(dialog.querySelectorAll('button')).find(b => label(b) === '主题'))
  if (!nav) return { failed: 'no 主题 entry in the settings navigation within 8s', seen: snapshot() }
  nav.click()
  const cubes = await until(() => {
    const found = Array.from(dialog.querySelectorAll('.dsh-theme-cube'))
    return found.length >= 2 ? found : null
  })
  if (!cubes) return { failed: 'the section rendered ' + dialog.querySelectorAll('.dsh-theme-cube').length + ' cubes within 8s', seen: snapshot() }
  /* The lens is only a lens when its map is really placed and its bends really have a
   * scale. Both halves were broken once and neither failure was visible: the map reached
   * feImage through a percentage subregion, which resolves against the 0 0 viewport of the
   * defs SVG rather than the surface, so the filter lost its whole bending branch and kept
   * its frost — the material looked plausible while it bent nothing at all. A filter that
   * exists is therefore not evidence; these two facts are. */
  const read = () => ({
    attribute: document.documentElement.getAttribute('data-lg-style'),
    material: !!document.querySelector('style[data-plugin-css="dsh-liquid-glass/liquid-glass"]'),
    filter: !!document.querySelector('filter[id^="dsh-lg-refract"]'),
    lenses: Array.from(document.querySelectorAll('filter[id^="dsh-lg-refract"]')).map((node) => {
      const image = node.querySelector('feImage')
      const numeric = (name) => {
        const value = image ? image.getAttribute(name) || '' : ''
        return /^[0-9.]+$/.test(value) && Number(value) > 0
      }
      return {
        id: node.id,
        placed: numeric('width') && numeric('height'),
        bends: Array.from(node.querySelectorAll('feDisplacementMap')).map(n => Number(n.getAttribute('scale') || '0')),
      }
    }),
    /* The one link nothing watched: *which* filter the card's own ::before wears. The
     * plain blur(6px) saturate(1.8) pair is a legal value that still frosts and bends
     * nothing, so a declaration moved out of order would take the lens away with every
     * other check in this file still passing. With the lens in force the computed value is
     * url(#dsh-lg-refract-*); the filter it names has to really displace. */
    card: (() => {
      const card = document.querySelector('[data-composer-card]')
      if (!card) return null
      const before = getComputedStyle(card, '::before').backdropFilter
      const clean = before.split('"').join('')
      const open = clean.indexOf('url(#')
      const id = open === -1 ? '' : clean.slice(open + 5, clean.indexOf(')', open + 5))
      const lens = id ? document.getElementById(id) : null
      const image = lens ? lens.querySelector('feImage') : null
      return {
        filter: before,
        id: id,
        bends: lens ? Array.from(lens.querySelectorAll('feDisplacementMap')).map(n => Number(n.getAttribute('scale') || '0')) : [],
        map: image ? image.getAttribute('width') + 'x' + image.getAttribute('height') : null,
      }
    })(),
    selected: cubes.filter(c => c.getAttribute('aria-pressed') === 'true').map(label),
  })
  // The selection follows the DURABLE preference, so a click's effect arrives when
  // the settings document round-trips and the mirror lands — not on a fixed delay.
  // An acceptance gate waits for the condition and fails on the timeout, because a
  // fixed sleep turns a busy machine into a false defect.
  const settled = async (predicate, timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (predicate()) return true
      if (Date.now() > deadline) return false
      await wait(120)
    }
  }
  /* When a switch does not take, the interesting fact is WHY, and the page already knows
   * two of them: the section renders its own failure line, and the preference is written by
   * the kernel's config editor, whose writes can be blocked by a writer lock left behind by a
   * process that was killed mid-write. That failure once cost an hour of reading the kernel
   * because this gate reported only "the attribute did not change".
   *
   * The lock is not read from disk here: this script has no business guessing which home the
   * running shell uses. The section's own message is read instead, and the lock question is
   * settled by scripts/verify-shell-lock-recovery.mjs, which is the gate that owns it. */
  const explain = () => ({
    refused: (() => {
      const alert = document.querySelector('[role="alert"]')
      return alert ? label(alert) : null
    })(),
    selected: read().selected,
    attribute: read().attribute,
  })
  const pick = async (prefix, attribute) => {
    const cube = cubes.find(c => label(c).startsWith(prefix))
    if (!cube) return { failed: 'no cube labelled ' + prefix }
    cube.click()
    const ok = await settled(() => {
      const now = read()
      return now.attribute === attribute && now.selected.some(text => text.startsWith(prefix))
    })
    return { ...read(), settled: ok, ...(ok ? {} : { why: explain() }) }
  }
  const before = read()
  const glass = await pick('液态玻璃', 'liquid-glass')
  const official = await pick('官方默认', 'official')
  const back = await pick('液态玻璃', 'liquid-glass')
  /* The engine re-dresses the surfaces it already has, and a surface's own lens arrives a
   * tick after the attribute does: sampled immediately, the card can still be wearing the
   * plain pair -- which is exactly the state the card assertion exists to catch, so it is
   * waited for rather than sampled. */
  const cardDressed = await settled(() => {
    const card = read().card
    return card !== null && card.filter.indexOf('url(') === 0
  })
  const afterBack = read()
  return {
    nav: Array.from(dialog.querySelectorAll('button')).map(label).slice(0, 8),
    before, glass, official, back: { ...back, card: afterBack.card }, cardDressed,
    viewport: [innerWidth, innerHeight, devicePixelRatio],
  }
})()`

/**
 * Wait until the client has mounted the surface this gate drives.
 *
 * A reload replaces the CDP target and then re-boots the client; evaluating during
 * that window fails or lands before React is mounted, which would report a defect
 * that is really just a page mid-boot. Readiness here means exactly the element the
 * driver clicks, so the wait can never be shorter than the need.
 */
const waitForClient = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const mounted = await evaluate(`!!document.querySelector('[data-slot="settings.launcher"] button')`)
      if (mounted === true) return
    } catch {
      // The page was mid-navigation: a request that cannot be evaluated yet is the
      // condition being waited out, not a failure.
    }
    await new Promise(wake => setTimeout(wake, 250))
  }
  console.error('the client never mounted its settings launcher')
  process.exit(1)
}
await waitForClient()

const report = await evaluate(driver)
socket.close()

let failures = 0
/* Every FAIL line carries the viewport: this gate once went red with an empty navigation on
 * a machine whose page viewport was 40x40 CSS px while the OS window was 1440x900, and the
 * failure message then read like a defect in the Theme section. */
const VIEWPORT = Array.isArray(report.viewport) ? report.viewport : [0, 0, 0]
const viewportNote = '  [viewport ' + VIEWPORT[0] + 'x' + VIEWPORT[1] + ' @' + VIEWPORT[2] + ']'
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail)) + (ok ? '' : viewportNote))
}
if (VIEWPORT[0] < 200 || VIEWPORT[1] < 200) {
  console.error('SKIP  verify-theme-section: the page viewport is ' + VIEWPORT[0] + 'x' + VIEWPORT[1] + ' px at devicePixelRatio '
    + VIEWPORT[2] + ', which is not the window (1440x900 on this machine): a 40px-wide page cannot render the settings navigation.'
    + ' Resize the real window and re-run. Nothing was verified, so this is not a pass.')
  process.exit(3)
}

if (typeof report.failed === 'string') {
  console.error('FAIL  ' + report.failed)
  if (report.nav) console.error('      navigation was: ' + JSON.stringify(report.nav))
  process.exit(1)
}
check('the Theme section is in the navigation', report.nav.includes('主题'), report.nav)
check('liquid glass applies the material stylesheet and filter',
  report.glass.settled === true && report.glass.material === true && report.glass.filter === true && report.glass.attribute === 'liquid-glass', report.glass)
check('the glass cube is the selected one while glass is applied',
  report.glass.selected.some(text => text.startsWith('液态玻璃')), report.glass.selected)
check('official removes the material stylesheet and the filter',
  report.official.settled === true && report.official.material === false && report.official.filter === false && report.official.attribute === 'official', report.official)
check('the official cube is the selected one while official is applied',
  report.official.selected.some(text => text.startsWith('官方默认')), report.official.selected)
check('switching back re-applies glass, lens and all',
  report.back.settled === true && report.back.material === true && report.back.filter === true
    && report.back.attribute === 'liquid-glass', report.back)
const lenses = report.glass.lenses ?? []
check('every lens places its map by user-space numbers, not percentages',
  report.glass.filter === false || (lenses.length > 0 && lenses.every(lens => lens.placed === true)),
  lenses.map(lens => lens.id + ': placed=' + lens.placed).join(', '))
check('every lens bends its backdrop, not just blurs it',
  report.glass.filter === false || (lenses.length > 0 && lenses.every(lens => lens.bends.length === 3 && lens.bends.every(scale => scale !== 0))),
  lenses.map(lens => lens.id + ': scales=' + lens.bends.join('/')).join(', '))
/* The card's own filter, read off the live page while each style is in force. The first
 * two are the regression this assertion exists for; the third is the other direction of
 * the same fact. */
const cardOk = (card) => card !== null && card !== undefined
  && card.filter.indexOf('url(') === 0 && card.id.indexOf('dsh-lg-refract') === 0
  && card.bends.length > 0 && card.bends.every(scale => scale !== 0) && card.map !== null
const cardOff = (card) => card === null || card === undefined || card.filter.indexOf('url(') !== 0
const describeCard = (card) => card === null || card === undefined
  ? 'no [data-composer-card] on the page'
  : 'computed backdrop-filter ' + card.filter + ', lens "' + card.id + '", bends ' + card.bends.join('/') + ', map ' + card.map
check('the composer card wears the lens itself, and the lens bends', cardOk(report.glass.card), describeCard(report.glass.card))
check('the official style takes the lens off the card', cardOff(report.official.card), describeCard(report.official.card))
check('the card wears the lens again after the round trip', report.cardDressed === true && cardOk(report.back.card), describeCard(report.back.card))

console.log(failures === 0 ? 'theme section: all checks passed' : failures + ' check(s) failed')
process.exit(failures === 0 ? 0 : 1)