#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it drives the composer over CDP in a shell that is ALREADY RUNNING (usage line 5 takes the port); starting the shell is the operator's step and this probe never does it
/**
 * The composer's backdrop, and whether the material still shows it.
 *
 *   node scripts/probe-composer-fade.mjs [port] [--step n] [--pad n] [--out prefix]
 *
 * The composer's seat carries a fade of the client's own — a gradient from
 * transparent to the opaque page colour across its first 36px — whose whole job is
 * to dissolve the conversation before it reaches a card that does not let anything
 * through. Behind a translucent card that gradient stops being a fade and becomes
 * content: the conversation is visible at the top of the glass and gone a few
 * pixels lower, with the seam sitting where the card's own first line is. That is
 * the defect this probe exists for.
 *
 * The card is captured over four grounds, because one ground says nothing: over an
 * opaque page-coloured one (the card alone), over its own backdrop with the material
 * skipping the fade (what is really behind it), over the same backdrop with the
 * client's fade forced back on (what the app does without the material), and over
 * the material as it ships. The client's fade is forced on through an inline
 * declaration — once the material is active its rule replaces the declaration
 * itself, so removing an override no longer returns the app to the faded state — and
 * every state is read back at the shutter and asserted, because a baseline that
 * never wore the fade would compare the material with itself.
 *
 * Every measurement is a row's *spread*, never its ink: how far a scanline departs
 * from its own mean depends on the palette, and the light palette is exactly where
 * this material has been misjudged before. The card paints nothing in a quiet row,
 * so the difference between a row over content and the same row over the empty
 * ground is the pane's doing and nothing else — that is the number the checks use.
 *
 * Placement is measured too. A message's box is mostly padding, a markdown block can
 * be a thousand pixels tall with its text at the top, and the composer stack is
 * itself inside the scroller, so hit-testing behind the card reports the composer
 * rather than the conversation. So the scroller is captured with the card hidden,
 * its highest-contrast row is found in the pixels, and the scroll is moved by exactly
 * the distance that row needs to land under the card — only rows at or below the
 * card's centre qualify, since scrolling pulls content up.
 *
 * Everything is restored in a `finally` and re-read afterwards: a probe that leaves
 * the app modified is a defect of its own.
 */
import { writeFileSync } from 'node:fs'
import { decode, rowProfile, stats } from './lib/png.mjs'

const args = process.argv.slice(2)
const PORT = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const stepIndex = args.indexOf('--step')
const step = stepIndex === -1 ? 20 : Number(args[stepIndex + 1])
const outIndex = args.indexOf('--out')
const prefix = outIndex === -1 ? undefined : args[outIndex + 1]
const padIndex = args.indexOf('--pad')
/* The capture always includes a margin around the card: the lip under it is half of what
 * this probe has to say, and a rectangle clipped to the card can never show it. */
const pad = Math.max(padIndex === -1 ? 0 : Number(args[padIndex + 1]), 24)

/** The client's own declaration, quoted so the baseline can be forced back on. */
const CLIENT_FADE = 'linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-base) 0%, transparent) 0px, var(--dsw-alias-bg-base) 36px)'
/** Row spread, in values, that counts as text or graphics rather than a flat ground. */
const BUSY_SPREAD = 60
/** Values above its own noise floor by which a fade-flattened ground may still vary. */
const FLAT_MARGIN = 10
/** Mean shift, in values, that counts as the pane showing what is behind it. */
const VISIBLE_SHIFT = 4
/** Share of the backdrop's contrast that may survive the glass and still be "softened". */
const SOFTENING = 0.5

const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
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
const evaluate = async (expression) => {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true })
  if (answer.result?.exceptionDetails) throw new Error('evaluate threw: ' + JSON.stringify(answer.result.exceptionDetails).slice(0, 200))
  return answer.result?.result?.value
}

const SEAT = '[data-lg-seat]'
const SCROLLER = 'div[class*="scrollBody"]'
const CARD = '[data-composer-card]'
const MARK = 'data-probe-fade'

const READ = `(() => {
  const card = document.querySelector('${CARD}');
  const seat = document.querySelector('${SEAT}');
  const scroller = document.querySelector('${SCROLLER}');
  if (!card || !seat || !scroller) return null;
  const c = card.getBoundingClientRect();
  const s = seat.getBoundingClientRect();
  const b = scroller.getBoundingClientRect();
  return { card: { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) },
    scroller: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height),
      scrollTop: scroller.scrollTop, range: scroller.scrollHeight - scroller.clientHeight },
    dpr: devicePixelRatio, style: document.documentElement.dataset.lgStyle,
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    phase: document.querySelector('[data-phase]')?.getAttribute('data-phase') ?? null,
    pageColour: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
    seatClass: String(seat.className), seatFade: getComputedStyle(seat).backgroundImage,
    lipProperty: seat.style.getPropertyValue('--lg-composer-lip'), lip: Math.round(s.bottom - c.bottom) };
})()`

const found = await evaluate(READ)
if (found === null) { console.error('the composer and its seated material are not both mounted'); process.exit(1) }
const card = found.card
const scale = found.dpr
const box = {
  x: Math.max(0, card.x - pad),
  y: Math.max(0, card.y - pad),
  width: card.width + pad * 2,
  height: card.height + pad * 2,
}
console.log(JSON.stringify({ card, dpr: scale, palette: found.dark ? 'dark' : 'light', style: found.style, phase: found.phase,
  seatClass: found.seatClass, seatLip: found.lip, lipProperty: found.lipProperty, seatFade: found.seatFade.slice(0, 170) }))

const shoot = async (clip, file) => {
  const answer = await call('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })
  const data = answer.result?.data
  if (data === undefined) throw new Error('capture failed')
  const buffer = Buffer.from(data, 'base64')
  if (file !== undefined) writeFileSync(file, buffer)
  return decode(buffer)
}
const setSeat = (fade) => evaluate(`(() => {
  const seat = document.querySelector('${SEAT}');
  seat.style.removeProperty('background-image');
  seat.style.removeProperty('background-color');
  if ('${fade}' === 'client') seat.style.backgroundImage = '${CLIENT_FADE}';
  else if ('${fade}' === 'ground') { seat.style.backgroundImage = 'none'; seat.style.backgroundColor = '${found.pageColour}'; }
  const style = getComputedStyle(seat);
  return { image: style.backgroundImage.slice(0, 80), colour: style.backgroundColor };
})()`)
const setCardHidden = (hidden) => evaluate(`document.querySelector('${CARD}').style.visibility = '${hidden ? 'hidden' : ''}'; true`)
const scrollTop = () => evaluate(`document.querySelector('${SCROLLER}').scrollTop`)

/* Rows are profiled a few pixels in from each side. A rectangle drawn round a surface
 * contains its own edges, and the antialiased boundary between a card and its ground
 * is thirty-odd values wide across every row — enough to make even an empty row look
 * busy and to hide the thing being measured inside a constant. */
const EDGE_INSET = Math.round(4 * scale)
const profile = (image) => rowProfile(image, EDGE_INSET, image.width - EDGE_INSET * 2)

const cardTop = Math.round((card.y - box.y) * scale)
const cardBottom = Math.round((card.y + card.height - box.y) * scale)
const captures = {}
const states = {}
let placement = null
let restored = null
try {
  await evaluate(`document.querySelector('${SCROLLER}').setAttribute('${MARK}-scroll', String(document.querySelector('${SCROLLER}').scrollTop)); true`)

  /* The card alone, over a ground that carries nothing: this is what the card paints
   * itself, and the rows where it paints nothing are the rows the plaster can be
   * read in. Captured first, because the placement below should aim at one of them. */
  states.emptySurface = await setSeat('ground')
  await setCardHidden(false)
  captures.emptySurface = await shoot(box, prefix === undefined ? undefined : prefix + '-empty-surface.png')
  await setSeat('material')
  await setCardHidden(true)

  /* Bring a line of conversation under the card, verifying with pixels rather than with
   * geometry: the first round that lands a contrasty row under the card wins, and the
   * report says which round that was. */
  const target = card.y + card.height / 2
  placement = { rounds: 0, busiestRowsFound: 0, eligibleRows: 0, moved: 0, contrastBehindTheCard: 0 }
  for (let round = 1; round <= 3; round += 1) {
    const before = await scrollTop()
    const view = await shoot(found.scroller)
    const rows = profile(view).map(row => ({ ...row, cssY: found.scroller.y + row.y / scale }))
    const busy = rows.filter(row => row.spread > BUSY_SPREAD)
    const eligible = busy
      .map(row => ({ ...row, landing: Math.round(before + row.cssY - target) }))
      .filter(row => row.landing >= 0 && row.landing <= found.scroller.range && row.landing !== before)
      .sort((a, b) => b.spread - a.spread)
    placement = { rounds: round, busiestRowsFound: busy.length, eligibleRows: eligible.length, moved: 0, contrastBehindTheCard: 0 }
    if (eligible.length === 0) break
    const chosen = eligible[0]
    await evaluate(`document.querySelector('${SCROLLER}').scrollTop = ${chosen.landing}; true`)
    const band = profile(await shoot(box)).slice(cardTop + 6, cardBottom - 6)
    const contrast = Math.max(...band.map(row => row.spread))
    placement = { ...placement, moved: chosen.landing - before, from: Math.round(chosen.cssY), contrastBehindTheCard: contrast }
    if (contrast > BUSY_SPREAD) break
  }
  console.log(JSON.stringify({ placement }))

  captures.materialBackdrop = await shoot(box, prefix === undefined ? undefined : prefix + '-material-backdrop.png')
  states.baselineBackdrop = await setSeat('client')
  captures.baselineBackdrop = await shoot(box, prefix === undefined ? undefined : prefix + '-baseline-backdrop.png')

  await setCardHidden(false)
  states.materialSurface = await setSeat('material')
  captures.materialSurface = await shoot(box, prefix === undefined ? undefined : prefix + '-material-surface.png')
  states.baselineSurface = await setSeat('client')
  captures.baselineSurface = await shoot(box, prefix === undefined ? undefined : prefix + '-baseline-surface.png')
  await setSeat('material')
} finally {
  restored = await evaluate(`(() => {
    const seat = document.querySelector('${SEAT}');
    const scroller = document.querySelector('${SCROLLER}');
    document.querySelector('${CARD}').style.removeProperty('visibility');
    seat.style.removeProperty('background-image');
    seat.style.removeProperty('background-color');
    if (scroller.hasAttribute('${MARK}-scroll')) {
      scroller.scrollTop = Number(scroller.getAttribute('${MARK}-scroll'));
      scroller.removeAttribute('${MARK}-scroll');
    }
    return { visibility: document.querySelector('${CARD}').style.visibility || '',
      inlineBackground: seat.style.backgroundImage, inlineColour: seat.style.backgroundColor,
      image: getComputedStyle(seat).backgroundImage.slice(0, 80), scrollTop: scroller.scrollTop };
  })()`)
  socket.close()
  if (restored.visibility !== '' || restored.inlineBackground !== '' || restored.inlineColour !== '') console.error('WARNING: the page was not restored: ' + JSON.stringify(restored))
  else console.log('page restored and re-read clean: no background left inline on the seat, scrollTop ' + restored.scrollTop)
}

console.log(JSON.stringify(Object.fromEntries(Object.entries(captures).map(([key, image]) => [key, stats(image)]))))
const profiles = Object.fromEntries(Object.entries(captures).map(([key, image]) => [key, profile(image)]))
console.log('  dev y   css y | material backdrop | client backdrop   | material surface  | over an empty ground')
for (const row of profiles.materialSurface) {
  if (row.y % step !== 0 && row.y !== profiles.materialSurface.length - 1) continue
  const cell = (key) => String(profiles[key][row.y].mean).padStart(7) + ' ' + String(profiles[key][row.y].spread).padStart(5)
  console.log('  ' + String(row.y).padStart(5) + '  ' + (box.y + row.y / scale).toFixed(1).padStart(7)
    + ' | ' + cell('materialBackdrop') + ' | ' + cell('baselineBackdrop') + ' | ' + cell('materialSurface') + ' | ' + cell('emptySurface'))
}

/* Every row inside the card, measured as differences between the four grounds.
 *
 * No row of this card is empty — the composer's own root paints a faint texture over
 * the seat across the whole rectangle, thirty-odd values wide — so "quiet" is not a
 * place to look for; it is a number the probe calibrates for itself. What varies in a
 * row with the card visible is the card's own paint plus whatever the pane lets
 * through, so subtracting the same row over an empty ground leaves the pane's
 * contribution exactly, and a mean is linear enough for the subtraction to be exact. */
const inside = (key) => profiles[key].slice(cardTop + 6, cardBottom - 6)
/* The floor is the ground's own texture, read as a median: a card row that carries the
 * card's own controls is a hugely busy outlier, and a maximum would take the floor from
 * it and retire the measurement. */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}
const floor = median(inside('emptySurface').map(row => row.spread))
const busy = Math.max(BUSY_SPREAD, floor * 2)
const flat = floor + FLAT_MARGIN
const analysis = inside('emptySurface').map(row => ({
  y: row.y,
  cssY: Math.round(box.y + row.y / scale),
  behind: profiles.materialBackdrop[row.y].spread,
  faded: profiles.baselineBackdrop[row.y].spread,
  added: Math.max(0, Math.round((profiles.materialSurface[row.y].spread - row.spread) * 10) / 10),
  shown: Math.round((profiles.materialSurface[row.y].mean - row.mean) * 10) / 10,
}))
const carrying = analysis.filter(row => row.behind > busy)
const recovered = carrying.filter(row => row.faded <= flat)
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
}

check('the seat found from the card is the client\'s own seat', found.seatClass.includes('composerSeat'), found.seatClass)
check('the material replaces the client\'s fade with one whose stops are all below the card',
  !found.seatFade.includes('36px') && found.lipProperty !== '', { fade: found.seatFade.slice(0, 110), lip: found.lipProperty })
check('the client\'s fade was really forced back on for the baseline', states.baselineBackdrop.image.includes('36px'), states.baselineBackdrop)
check('the empty ground really covers what is behind the card',
  states.emptySurface.image === 'none' && states.emptySurface.colour !== 'rgba(0, 0, 0, 0)', states.emptySurface)
check('conversation was actually brought behind the card', placement.contrastBehindTheCard > BUSY_SPREAD,
  { ...placement, noiseFloor: floor, busyThreshold: busy })
check('the ground varies little enough to read the pane against', floor < BUSY_SPREAD,
  { noiseFloor: floor, busyThreshold: busy, flatThreshold: flat })
check('the reported defect reproduces: the client\'s fade flattens those rows',
  recovered.length > 0, { rowsCarryingContent: carrying.length, rowsTheFadeFlattens: recovered.length })
check('through the material those rows still show what is behind them',
  recovered.length > 0 && recovered.every(row => Math.abs(row.shown) >= VISIBLE_SHIFT),
  recovered.slice(0, 6).map(row => ({ cssY: row.cssY, shownAs: row.shown })))
check('and they show it softened, not sharp',
  recovered.length > 0 && sum(recovered, 'added') < sum(recovered, 'behind') * SOFTENING,
  { contrastBehind: sum(recovered, 'behind'), contrastAddedByTheGlass: sum(recovered, 'added'),
    share: sum(recovered, 'behind') === 0 ? null : Math.round(sum(recovered, 'added') / sum(recovered, 'behind') * 100) + '%' })
/* The lip ramp starts at the card's bottom edge and completes a few pixels later, under
 * the card's own shadow; past it the client's ground is back and the conversation is
 * not left sharp under the pane. */
/* Below the card the client's fade is opaque, so its backdrop is the ground the app
 * means to show there — and the material's lip has to be the same ground. Comparing the
 * two is the only honest test: those rows also carry the window's own overlay, which is
 * painted over every state alike and would poison any threshold. */
const lipRoom = Math.round(10 * scale)
const belowMaterial = profile(captures.materialBackdrop).slice(cardBottom + lipRoom)
const belowBaseline = profile(captures.baselineBackdrop).slice(cardBottom + lipRoom)
const lipDrift = belowMaterial.map((row, index) => Math.round((row.mean - belowBaseline[index].mean) * 10) / 10)
check('the lip below the card is the client\'s own ground, not the conversation',
  belowMaterial.length > 0 && lipDrift.every(drift => Math.abs(drift) <= 2),
  { lip: found.lip, rowsBelowTheCard: belowMaterial.length, worstDriftFromTheClientGround: lipDrift.length === 0 ? null : Math.max(...lipDrift.map(Math.abs)) })
console.log(failures === 0 ? 'composer backdrop: all checks passed' : failures + ' check(s) failed')
process.exit(failures === 0 ? 0 : 1)
