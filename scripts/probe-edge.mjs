#!/usr/bin/env node
// R73 alive-control: EXEMPT, with the reason - it measures pixels in a running shell's page over CDP (usage line 6 takes the port); it paints its own backdrop inside that page and never boots anything
/**
 * Measure a glass surface's edge: how far the backdrop bends, over what band, how far
 * the channels separate there, and how bright the rim is.
 *
 *   node scripts/probe-edge.mjs [port] [selector] [--out prefix]
 *
 * "The edge reads as glass" is three quantities and no picture can settle any of them:
 * a bend, the width of the band it lives in, and the colour fringing that gives a thick
 * pane away. So the surface is given a backdrop it can be measured against — a smooth,
 * high-contrast triangle wave at 48px a period, painted opaquely on the conversation
 * area behind the composer, one axis at a time so nothing else is in the pattern — and
 * captured twice: with the card hidden, which is the pattern as drawn, and as it renders.
 *
 * The displacement is read as a *local phase*, not as a match against the drawn pattern.
 * The glass blurs what it bends and any amplitude comparison drowns in that; a symmetric
 * blur, though, leaves a periodic signal's phase exactly where it was, so a Fourier
 * coefficient over one window of a period gives the shift that survives the blur — and
 * taken per channel, the difference between the red and blue shifts *is* the chromatic
 * aberration. An earlier version matched windows instead, reported a 20px bend across the
 * whole card and then a 44-value amplitude *inside* the glass: the search had pinned at
 * its own limit, and the scanline was crossing the composer's own placeholder. So the
 * line to scan is now chosen from the pixels — the quietest row or column inside the card
 * over a flat ground — and the whole profile is printed beside the amplitude, because a
 * single number is exactly what let both of those readings look plausible.
 *
 * The rim is read from the same flat capture, where the only thing that varies is the
 * surface's own paint. Everything is restored in a `finally` and re-read afterwards.
 */
import { writeFileSync } from 'node:fs'
import { decode, rowProfile, stats } from './lib/png.mjs'

const args = process.argv.slice(2)
const PORT = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const selector = args[0] === undefined || args[0].startsWith('--') ? '[data-composer-card]' : args.shift()
const outIndex = args.indexOf('--out')
const prefix = outIndex === -1 ? undefined : args[outIndex + 1]

/** Pattern period, in CSS pixels: well above the blur, and half a period is the range. */
const PERIOD = 48
/** Quit value for a scanline where the card paints something of its own. */
const QUIET = 14

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

/* The backdrop is painted on the conversation area the composer sits in: it covers the
 * card and a margin round it, it is behind every part of the composer, and it disturbs
 * nothing — the app's own content is painted above it. */
const HOST = `document.querySelector('${selector}')?.closest('[class*="scrollBody"]') ?? document.querySelector('${selector}')?.parentElement`
const READ = `(() => {
  const card = document.querySelector('${selector}');
  const host = ${HOST};
  if (!card || !host) return null;
  const c = card.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const style = getComputedStyle(card);
  return { card: { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) },
    host: { x: Math.round(h.x), y: Math.round(h.y), width: Math.round(h.width), height: Math.round(h.height) },
    radius: parseFloat(style.borderTopLeftRadius), dpr: devicePixelRatio,
    phase: document.querySelector('[data-phase]')?.getAttribute('data-phase') ?? null,
    pageColour: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
    backdrop: style.backdropFilter || style.webkitBackdropFilter || 'none',
    style: document.documentElement.dataset.lgStyle, dark: document.body.hasAttribute('data-ds-dark-theme') };
})()`
const found = await evaluate(READ)
if (found === null) { console.error('no card, or nothing behind it to paint'); process.exit(1) }
const card = found.card
const scale = found.dpr
const margin = 30
const box = { x: card.x - margin, y: card.y - margin, width: card.width + margin * 2, height: card.height + margin * 2 }
console.log(JSON.stringify({ selector, card, host: found.host, phase: found.phase, radius: found.radius, dpr: scale,
  palette: found.dark ? 'dark' : 'light', backdropFilter: found.backdrop, period: PERIOD }))

const shoot = async (file) => {
  const answer = await call('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } })
  const data = answer.result?.data
  if (data === undefined) throw new Error('capture failed')
  const buffer = Buffer.from(data, 'base64')
  if (file !== undefined) writeFileSync(file, buffer)
  return decode(buffer)
}
/* The fixture's CSS is built here rather than in the page: a value computed inside the
 * injected source is one more chance for the injected source to be malformed, which is a
 * mistake this probe has already made once. */
const paint = (mode) => {
  const declaration = mode === 'flat'
    ? `host.style.backgroundColor = ${JSON.stringify(found.pageColour)};`
    : `host.style.backgroundColor = '#000000'; host.style.backgroundImage = ${JSON.stringify(
        'repeating-linear-gradient(' + (mode === 'x' ? 90 : 0) + 'deg, #000000, #ffffff ' + (PERIOD / 2) + 'px, #000000 ' + PERIOD + 'px)')};`
  return evaluate(`(() => {
    const host = ${HOST};
    host.style.removeProperty('background-image');
    host.style.removeProperty('background-color');
    ${declaration}
    const style = getComputedStyle(host);
    return { image: style.backgroundImage.slice(0, 60), colour: style.backgroundColor };
  })()`)
}
const hide = (hidden) => evaluate(`document.querySelector('${selector}').style.visibility = '${hidden ? 'hidden' : ''}'; true`)

/* The surface's *content* is hidden for the refraction captures, not the surface: what this
 * probe measures is the material, and a card's own text and controls carry far more
 * contrast than any backdrop does. Without this, an earlier run read the composer's
 * placeholder as a 44-value amplitude "through the glass" — a number that described the
 * card, not its edge. */
const MARK = 'data-probe-edge'
const hideContent = (hidden) => evaluate(`(() => {
  const card = document.querySelector('${selector}');
  let touched = 0;
  for (const child of card.children) {
    if (${hidden}) {
      if (!child.hasAttribute('${MARK}')) child.setAttribute('${MARK}', child.style.visibility);
      child.style.visibility = 'hidden';
      touched += 1;
    } else if (child.hasAttribute('${MARK}')) {
      const previous = child.getAttribute('${MARK}');
      if (previous === '') child.style.removeProperty('visibility'); else child.style.visibility = previous;
      child.removeAttribute('${MARK}');
      touched += 1;
    }
  }
  return touched;
})()`)

const samples = (image, axis, fixed, channel) => {
  const count = axis === 'x' ? image.width : image.height
  const out = new Float64Array(count)
  for (let i = 0; i < count; i += 1) {
    const x = axis === 'x' ? i : fixed
    const y = axis === 'x' ? fixed : i
    out[i] = image.pixels[(y * image.width + x) * image.channels + channel]
  }
  return out
}
const phaseAt = (values, at, period) => {
  const half = Math.round(period / 2)
  let real = 0
  let imaginary = 0
  let weight = 0
  for (let i = -half; i < half; i += 1) {
    const value = values[at + i]
    if (value === undefined) continue
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + half)) / (2 * half))
    const angle = (-2 * Math.PI * i) / period
    real += window * value * Math.cos(angle)
    imaginary += window * value * Math.sin(angle)
    weight += window
  }
  return { phase: Math.atan2(imaginary / weight, real / weight), amplitude: Math.hypot(real, imaginary) / weight }
}
const shiftAt = (glass, drawn, at, period) => {
  const a = phaseAt(glass, at, period)
  const b = phaseAt(drawn, at, period)
  let difference = a.phase - b.phase
  while (difference > Math.PI) difference -= 2 * Math.PI
  while (difference < -Math.PI) difference += 2 * Math.PI
  return { shift: (-difference * period) / (2 * Math.PI), amplitude: a.amplitude, drawn: b.amplitude }
}

const captures = {}
const paints = {}
let restored = null
const cardTop = Math.round((card.y - box.y) * scale)
const cardBottom = Math.round((card.y + card.height - box.y) * scale)
const cardLeft = Math.round((card.x - box.x) * scale)
const cardRight = Math.round((card.x + card.width - box.x) * scale)
try {
  paints.flat = await paint('flat')
  await hide(true)
  captures.flatDrawn = await shoot(prefix === undefined ? undefined : prefix + '-flat-drawn.png')
  await hide(false)
  await hideContent(true)
  captures.flatGlass = await shoot(prefix === undefined ? undefined : prefix + '-flat-glass.png')
  await hideContent(false)

  paints.x = await paint('x')
  await hide(true)
  captures.xDrawn = await shoot(prefix === undefined ? undefined : prefix + '-x-drawn.png')
  await hide(false)
  await hideContent(true)
  captures.xGlass = await shoot(prefix === undefined ? undefined : prefix + '-x-glass.png')
  await hideContent(false)

  paints.y = await paint('y')
  await hide(true)
  captures.yDrawn = await shoot(prefix === undefined ? undefined : prefix + '-y-drawn.png')
  await hide(false)
  await hideContent(true)
  captures.yGlass = await shoot(prefix === undefined ? undefined : prefix + '-y-glass.png')
  await hideContent(false)
} finally {
  restored = await evaluate(`(() => {
    const host = ${HOST};
    host.style.removeProperty('background-image');
    host.style.removeProperty('background-color');
    document.querySelector('${selector}').style.removeProperty('visibility');
    const left = document.querySelectorAll('${selector} [${MARK}]').length;
    return { image: host.style.backgroundImage, colour: host.style.backgroundColor,
      visible: document.querySelector('${selector}').style.visibility || '', hiddenChildren: left };
  })()`)
  socket.close()
  if (restored.image !== '' || restored.colour !== '' || restored.visible !== '' || restored.hiddenChildren !== 0) console.error('WARNING: the page was not restored: ' + JSON.stringify(restored))
  else console.log('page restored and re-read clean')
}

/* Where to scan: the quietest line inside the card, read off the flat capture, so the
 * card's own text and controls cannot contribute to a displacement measurement. */
const insideCard = (row) => ({
  span: Math.max(cardLeft + Math.round(10 * scale), 0),
  width: Math.min(cardRight - Math.round(10 * scale), captures.flatGlass.width) - Math.max(cardLeft + Math.round(10 * scale), 0),
  row: row.y,
})
const rows = rowProfile(captures.flatGlass).slice(cardTop + Math.round(8 * scale), cardBottom - Math.round(8 * scale))
const quietRows = rows.map(row => ({ ...insideCard(row), spread: stats(captures.flatGlass, insideCard(row).span, row.y, insideCard(row).width, 1).spread }))
const quietestRow = quietRows.reduce((best, row) => (best === null || row.spread < best.spread ? row : best), null)
const columns = []
for (let x = cardLeft + Math.round(14 * scale); x < Math.min(cardRight - Math.round(14 * scale), captures.flatGlass.width); x += Math.round(2 * scale)) {
  const spread = stats(captures.flatGlass, x, cardTop + Math.round(2 * scale), 1, Math.round(20 * scale)).spread
  columns.push({ x, spread })
}
const quietestColumn = columns.reduce((best, column) => (best === null || column.spread < best.spread ? column : best), null)
console.log('  scanlines: left edge at device row ' + (quietestRow === null ? null : quietestRow.row) + ' (spread ' + (quietestRow === null ? null : quietestRow.spread) + ')'
  + ', top edge at device column ' + (quietestColumn === null ? null : quietestColumn.x) + ' (spread ' + (quietestColumn === null ? null : quietestColumn.spread) + ')')

const period = PERIOD * scale
const scans = [
  { name: 'left edge', axis: 'x', fixed: quietestRow === null ? Math.round((cardTop + cardBottom) / 2) : quietestRow.row, edge: cardLeft, available: box.width, quiet: quietestRow === null ? null : quietestRow.spread },
  { name: 'top edge', axis: 'y', fixed: quietestColumn === null ? Math.round((cardLeft + cardRight) / 2) : quietestColumn.x, edge: cardTop, available: box.height, quiet: quietestColumn === null ? null : quietestColumn.spread },
]
const summary = {}
for (const scan of scans) {
  const drawn = [0, 1, 2].map(channel => samples(captures[scan.axis + 'Drawn'], scan.axis, scan.fixed, channel))
  const glass = [0, 1, 2].map(channel => samples(captures[scan.axis + 'Glass'], scan.axis, scan.fixed, channel))
  const profile = []
  const from = Math.max(Math.round(period / 2) + 1, scan.edge - Math.round(4 * scale))
  const to = Math.min(scan.available - 1 - Math.round(period / 2), scan.edge + Math.round(40 * scale))
  for (let at = from; at <= to; at += Math.round(2 * scale)) {
    const red = shiftAt(glass[0], drawn[0], at, period)
    const green = shiftAt(glass[1], drawn[1], at, period)
    const blue = shiftAt(glass[2], drawn[2], at, period)
    profile.push({
      inside: Math.round(((at - scan.edge) / scale) * 10) / 10,
      bend: Math.round(((red.shift + green.shift + blue.shift) / 3) * 10) / 10,
      chroma: Math.round((red.shift - blue.shift) * 10) / 10,
      amplitude: Math.round(red.amplitude),
      drawn: Math.round(red.drawn),
    })
  }
  console.log('\n' + scan.name + ' (edge at device ' + scan.edge + ', pattern period ' + period + ' device px, quiet ' + scan.quiet + '):')
  console.log('  inside px |  bend | chroma | amplitude through / drawn')
  for (const row of profile) {
    console.log('  ' + String(row.inside).padStart(9) + ' | ' + String(row.bend).padStart(5) + ' | ' + String(row.chroma).padStart(6)
      + ' | ' + String(row.amplitude).padStart(4) + ' / ' + String(row.drawn).padStart(4))
  }
  const inward = profile.filter(row => row.inside >= -1)
  const bends = inward.map(row => Math.abs(row.bend))
  summary[scan.name] = {
    maxBendPx: Math.max(...bends),
    bandWhereBendExceeds1px: Math.round(bends.filter(value => value > 1).length * 2 / scale * 10) / 10,
    maxChromaPx: Math.max(...inward.map(row => Math.abs(row.chroma))),
    amplitudeThroughTheGlass: Math.max(...inward.map(row => row.amplitude)),
    amplitudeDrawn: Math.max(...inward.map(row => row.drawn)),
  }
  console.log('  ' + JSON.stringify(summary[scan.name]))
}

/* The rim: the same scan over a flat ground, where the only thing that varies is the
 * surface's own paint. Averaged over three lines so the highlight's shape, not the noise,
 * is what shows, and printed from just outside the edge inward. */
for (const scan of scans) {
  const lines = [scan.fixed - 2, scan.fixed, scan.fixed + 2].filter(line => line >= 0 && line < (scan.axis === 'x' ? captures.flatGlass.height : captures.flatGlass.width))
  const from = Math.max(0, scan.edge - Math.round(6 * scale))
  const to = Math.min(scan.available - 1, scan.edge + Math.round(14 * scale))
  const through = []
  const ground = []
  for (let at = from; at <= to; at += 1) {
    for (const [image, into] of [[captures.flatGlass, through], [captures.flatDrawn, ground]]) {
      let total = 0
      for (const line of lines) {
        const x = scan.axis === 'x' ? at : line
        const y = scan.axis === 'x' ? line : at
        const index = (y * image.width + x) * image.channels
        total += (image.pixels[index] + image.pixels[index + 1] + image.pixels[index + 2]) / 3
      }
      into.push(Math.round(total / lines.length))
    }
  }
  console.log('\n' + scan.name + ' rim, device ' + from + '..' + to + ', the edge at ' + scan.edge)
  console.log('  through the glass: ' + JSON.stringify(through))
  console.log('  ground alone:      ' + JSON.stringify(ground))
}
console.log('\n' + JSON.stringify({ summary, paints, ...Object.fromEntries(Object.entries(captures).map(([key, image]) => [key, stats(image)])) }))
