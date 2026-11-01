#!/usr/bin/env node
/**
 * Acceptance gate for the shell's adjustable corner radius, the boot page's
 * palette, and the app's radius tokens.
 *
 *   node scripts/verify-shell-radius.mjs [cdpPort] [--selftest]
 *
 * The shell must be running with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=<port>
 * (see scripts/debug.mjs), and the skin must be active.
 *
 * Every check prints PASS/FAIL with the numbers it was decided on. Nothing here
 * is decided by looking at a screenshot, and nothing is decided by fitting a
 * radius in the abstract either: a clipped corner's anti-aliased edge makes an
 * absolute fit read about a pixel and a half small, so the gate first *renders*
 * the same radius in the same engine through every plausible corner mechanism
 * and treats those profiles as the reference the window has to match. The
 * residual reported is then a real defect signal rather than the instrument's
 * own convention.
 *
 * Exercises the frozen contract:
 *   - `PUT /__shell/window` {radius, palette} answers 200 with both echoed;
 *   - the shell persists both to `$DSH_HOME/dsh-link/shell.json`;
 *   - the boot page follows the *application* palette, not the OS theme;
 *   - `--lg-radius-window/panel/control` drive the app's own corners.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { decode, stats } from './lib/png.mjs'
import {
  CORNERS,
  dominantColor,
  TOKEN_READBACK,
  TOKEN_SURVEY,
  cornerBackdropCount,
  cornerProfile,
  fitRadius,
  isCut,
  isMagenta,
} from './lib/shell-radius-probes.js'

const args = process.argv.slice(2)
const cdpPort = /^\d+$/.test(args[0] ?? '') ? Number(args.shift()) : 9222
const selftestOnly = args.includes('--selftest')
/** True when this file is the program being run, rather than imported by a harness. */
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href

const SHELL_ORIGIN = 'http://127.0.0.1:31761'
const ENDPOINT = SHELL_ORIGIN + '/__shell/window'
const BOOT_PAGE = SHELL_ORIGIN + '/__shell/'
const RADII = [0, 12, 28]
/** The four corners of one window have to agree with each other this closely. */
const CORNER_SPREAD = 1.0
/** A profile may differ from a reference by this much on one row, and this much on average. */
const MATCH_ROW = 2
const MATCH_MEAN = 1
const ARTEFACTS = fileURLToPath(new URL('./.verify-shell-radius/', import.meta.url))

let failures = 0
const undecided = []
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  — ' + detail))
}
const info = (name, detail) => console.log('INFO  ' + name + (detail === undefined ? '' : '  — ' + detail))
const cannot = (name, why) => {
  undecided.push(name)
  console.log('UNVERIFIED  ' + name + '  — ' + why)
}
const wait = (ms) => new Promise((wake) => setTimeout(wake, ms))
const px = (value) => (value === undefined || value === null ? 'n/a' : String(value))

/* ------------------------------------------------------------------ *
 * Profile comparison — the estimator, and the offline calibration of it
 * ------------------------------------------------------------------ */

/**
 * Compare one corner profile against a reference profile.
 *
 * @param rows - the measured profile.
 * @param reference - the reference profile, same length.
 * @returns the largest single-row difference and the mean difference.
 */
export function matchProfile(rows, reference) {
  let worst = 0
  let total = 0
  for (let y = 0; y < rows.length; y += 1) {
    const difference = Math.abs(rows[y] - (reference[y] ?? 0))
    worst = Math.max(worst, difference)
    total += difference
  }
  return { worst, mean: Number((total / rows.length).toFixed(2)) }
}

/** The best reference for a profile, or null when none is close enough. */
const bestReference = (rows, library) => {
  let best = null
  for (const entry of library) {
    const score = matchProfile(rows, entry.rows)
    if (best === null || score.worst < best.score.worst ||
      (score.worst === best.score.worst && score.mean < best.score.mean)) {
      best = { entry, score }
    }
  }
  if (best === null) return null
  const accepted = best.score.worst <= MATCH_ROW && best.score.mean <= MATCH_MEAN
  return { ...best, accepted }
}

/**
 * The corner profile a controlled render produced, recorded from this engine.
 *
 * Calibrating on a *real* render is what makes the anti-aliasing convention part
 * of the instrument instead of an assumption: these rows came from a page whose
 * corner was clipped to 16 CSS px at dpr 1.5, so 24 device px is the shape a
 * correct 16 px corner has — and it is the profile the fitter reads as 22.8.
 */
const RECORDED_PROFILE = {
  label: 'controlled render, border-radius 16px at dpr 1.5',
  limit: 36,
  device: 24,
  rows: [17, 14, 12, 11, 9, 8, 7, 6, 5, 4, 4, 3, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
}

/**
 * Prove the decision logic before it is pointed at the window.
 *
 * The absolute fitter is only used for the numbers in the report; the pass or
 * fail comes from matching a profile against references, so that is what the
 * selftest has to exercise — including the two ways it could go wrong, a
 * profile that is two px off being accepted and one that is four px off being
 * mistaken for a different radius.
 */
const selftest = () => {
  let bad = 0
  const say = (name, ok, detail) => {
    if (!ok) bad += 1
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  — ' + detail))
  }
  const limit = RECORDED_PROFILE.limit
  const square = new Array(limit).fill(0)
  const library = [
    { label: 'square', rows: square },
    { label: '16 css px', rows: RECORDED_PROFILE.rows },
  ]
  const identical = bestReference(RECORDED_PROFILE.rows, library)
  say('a profile matches its own reference exactly',
    identical !== null && identical.accepted === true && identical.entry.label === '16 css px' && identical.score.worst === 0,
    JSON.stringify(identical?.score) + ' -> ' + identical?.entry.label)

  const shifted = RECORDED_PROFILE.rows.map((row) => Math.max(0, row - 2))
  const twoOff = bestReference(shifted, library)
  say('a profile whose edge moved 2 px still matches, and is reported as 2 px off',
    twoOff !== null && twoOff.entry.label === '16 css px' && twoOff.score.worst === 2,
    JSON.stringify(twoOff?.score) + ' -> ' + twoOff?.entry.label)

  const farOff = RECORDED_PROFILE.rows.map((row) => Math.max(0, Math.round(row * 0.4)))
  const fourOff = bestReference(farOff, library)
  say('a profile four device px off is not accepted as the reference radius',
    fourOff === null || fourOff.accepted === false || fourOff.score.worst > MATCH_ROW,
    fourOff === null ? 'no reference' : JSON.stringify(fourOff.score) + ' accepted=' + fourOff.accepted)

  const notSquare = bestReference(RECORDED_PROFILE.rows, [{ label: 'square', rows: square }])
  say('a rounded corner is not mistaken for a square one',
    notSquare === null || notSquare.accepted === false, notSquare === null ? 'no reference' : JSON.stringify(notSquare.score))

  const squareFits = bestReference(square, library)
  say('a square corner matches the square reference',
    squareFits !== null && squareFits.entry.label === 'square' && squareFits.score.worst === 0,
    JSON.stringify(squareFits?.score) + ' -> ' + squareFits?.entry.label)

  const model = contentInsetModel(12, 24, 12)
  say('the content model derives the inset from gap and chrome, not from constants',
    model.root.left === 12 && model.root.right === 12 && model.root.bottom === 12 && model.root.top === 36 &&
    model.sidebar.left === 24 && model.sidebar.top === 48 && model.sidebar.bottom === 24,
    'gap 12 + chrome 24 -> root ' + JSON.stringify(model.root) + ', sidebar ' + JSON.stringify(model.sidebar))
  say('the left column right edge is reported but not judged',
    model.judged.sidebar.length === 3 && model.judged.sidebar.includes('right') === false,
    JSON.stringify(model.judged))
  say('a gap of 20 moves every judged edge with it',
    contentInsetModel(20, 24, 12).root.left === 20 && contentInsetModel(20, 24, 12).root.top === 44 &&
    contentInsetModel(20, 24, 12).sidebar.top === 56,
    JSON.stringify(contentInsetModel(20, 24, 12)))

  console.log(bad === 0 ? 'selftest: the corner comparison is calibrated' : 'selftest: ' + bad + ' calibration(s) failed')
  process.exit(bad === 0 ? 0 : 1)
}

if (selftestOnly && isMain) selftest()

/* ------------------------------------------------------------------ *
 * CDP plumbing
 * ------------------------------------------------------------------ */

export const findPage = async () => {
  const deadline = Date.now() + 20000
  for (;;) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json()
      const found = targets.find((target) => target.type === 'page' && String(target.url).includes(':31761'))
      if (found !== undefined) return found
    } catch (error) {
      if (Date.now() > deadline) throw new Error('the CDP endpoint on ' + cdpPort + ' never answered: ' + error.message)
    }
    if (Date.now() > deadline) throw new Error('no page on the shell origin within 20s')
    await wait(250)
  }
}

const listTargets = async () => (await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json())

export const attach = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const settle = pending.get(message.id)
    if (settle) { pending.delete(message.id); settle(message) }
  })
  await new Promise((done) => socket.addEventListener('open', done, { once: true }))
  // Every call is bounded. A target that goes away mid-stage — a reload, a client
  // that remounts itself when the control style changes — otherwise leaves the
  // promise pending and the whole gate simply stops, which reads as a hang rather
  // than as the failure it is.
  const call = (method, params, timeoutMs = 20000) => new Promise((settle, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('CDP ' + method + ' did not answer within ' + timeoutMs + 'ms (the target may have gone away)'))
    }, timeoutMs)
    pending.set(id, (message) => { clearTimeout(timer); settle(message) })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (answer.result?.exceptionDetails) throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 400))
    if (answer.error) throw new Error(JSON.stringify(answer.error).slice(0, 300))
    return answer.result?.result?.value
  }
  const capture = async (name) => {
    const answer = await call('Page.captureScreenshot', { format: 'png' })
    if (answer.result?.data === undefined) throw new Error('capture failed: ' + JSON.stringify(answer).slice(0, 300))
    const buffer = Buffer.from(answer.result.data, 'base64')
    if (name) {
      mkdirSync(ARTEFACTS, { recursive: true })
      writeFileSync(join(ARTEFACTS, name), buffer)
    }
    return decode(buffer)
  }
  return { call, evaluate, capture, close: () => socket.close() }
}

/**
 * A session that answers, or a fresh one when the page has gone.
 *
 * The shell is being worked on while this gate runs: a rebuild restarts it, the
 * CDP target disappears, and a measurement that was fine a second ago waits on a
 * socket nobody owns any more. That is not a defect in the app, so the gate
 * re-attaches and carries on, and only reports a failure if the page is really
 * unavailable.
 *
 * @param page - the session in hand.
 * @returns that session, or a new one for the same page.
 */
export const ensureSession = async (page) => {
  try { await page.evaluate('1'); return page } catch { /* the page has gone */ }
  const target = await findPage()
  const fresh = await attach(target)
  await waitForApp(fresh, 20000)
  return fresh
}

/* ------------------------------------------------------------------ *
 * The frozen endpoint, and the file it persists to
 * ------------------------------------------------------------------ */

const putWindow = async (radius, palette) => {
  const response = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ radius, palette }),
  })
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* the raw text is reported instead */ }
  return { status: response.status, body, text }
}

/** Every plausible home the shell could have written shell.json into. */
const shellJsonCandidates = () => {
  const roots = []
  for (const root of [process.env.DSH_HOME, process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (!root) continue
    roots.push(root, join(root, 'dsh-link'), join(root, 'dev.dshlink.client'), join(root, 'dev.dshlink.client', 'dsh-link'))
  }
  const direct = roots.map((root) => join(root, 'shell.json')).filter((path) => existsSync(path))
  const walked = []
  const walk = (directory, depth) => {
    if (depth > 3 || walked.length > 20) return
    let entries = []
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'shell.json') walked.push(join(directory, entry.name))
      else if (entry.isDirectory() && !entry.name.startsWith('.')) walk(join(directory, entry.name), depth + 1)
    }
  }
  for (const root of roots) walk(root, 0)
  return Array.from(new Set(direct.concat(walked)))
}

export const newestShellJson = () => {
  const candidates = shellJsonCandidates().map((path) => ({ path, at: statSync(path).mtimeMs }))
  candidates.sort((a, b) => b.at - a.at)
  if (candidates.length === 0) return null
  return { ...candidates[0], text: readFileSync(candidates[0].path, 'utf8') }
}

export const endpointStage = async (initial) => {
  console.log('\n--- endpoint PUT ' + ENDPOINT + ', and shell.json ---')
  if (initial === null) cannot('shell.json exists', 'no shell.json found under $DSH_HOME, %APPDATA% or %LOCALAPPDATA%')

  for (const radius of RADII) {
    const palette = radius === RADII[0] ? 'dark' : 'light'
    const before = Date.now()
    const answer = await putWindow(radius, palette)
    const echoed = answer.body
    check('PUT radius=' + radius + ' palette=' + palette + ' answers 200', answer.status === 200,
      'status ' + answer.status + ' body ' + JSON.stringify(answer.text).slice(0, 200))
    const echoRadius = echoed && typeof echoed.radius === 'number' ? echoed.radius : Number(echoed?.radius)
    check('PUT radius=' + radius + ' echoes the applied radius and palette',
      echoRadius === radius && echoed?.palette === palette,
      'echoed radius=' + px(echoed?.radius) + ' palette=' + px(echoed?.palette))

    // A second writer — another agent's PUT, or the shell's own boot page — can
    // land between the call and the read, so a single mismatch is retried before
    // it is called a persistence defect.
    let attempt = 0
    let observed = null
    for (; attempt < 4; attempt += 1) {
      await wait(250)
      const file = newestShellJson()
      if (file === null) { observed = null; break }
      let parsed = null
      try { parsed = JSON.parse(file.text) } catch (error) { cannot('shell.json parses', file.path + ': ' + error.message) }
      const fileRadius = parsed && typeof parsed.radius === 'number' ? parsed.radius : Number(parsed?.radius)
      observed = { file, parsed, fileRadius }
      if (fileRadius === radius && parsed?.palette === palette && file.at >= before - 2000) break
      await putWindow(radius, palette)
    }
    if (observed === null) { cannot('shell.json persists radius=' + radius, 'no shell.json found after the PUT'); continue }
    check('shell.json persists radius=' + radius + ' and palette=' + palette,
      observed.fileRadius === radius && observed.parsed?.palette === palette && observed.file.at >= before - 2000,
      observed.file.path + ' mtime ' + new Date(observed.file.at).toISOString() + ' content ' +
      JSON.stringify(observed.file.text).slice(0, 160) + (attempt > 0 ? ' (matched on attempt ' + (attempt + 1) + ' of 4)' : ''))
  }
}

/**
 * Wait until the client has actually mounted its surfaces.
 *
 * The settings launcher exists a moment before the skin has keyed anything off
 * `data-lg-style`, and a measurement taken in that window reads empty tokens and
 * no elements at all — which looks exactly like a broken skin. Readiness here
 * means the markers the next stages measure, not merely a mounted control.
 */
export const waitForApp = async (page, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let ready = false
    try {
      ready = (await page.evaluate('!!document.querySelector("[data-composer-card]") && !!document.querySelector("[data-lg-wide]") &&' +
        ' (document.documentElement.getAttribute("data-lg-style") !== null || getComputedStyle(document.documentElement).getPropertyValue("--lg-radius-panel").trim() !== "")')) === true
    } catch { /* the page is mid-navigation: that is the condition being waited out */ }
    if (ready) return true
    if (Date.now() > deadline) return false
    await wait(250)
  }
}

/** Open the bridge panel with its own footer control when it is closed. */
export const ensurePanelOpen = async (page, timeoutMs = 6000) => {
  const isOpen = async () => (await page.evaluate("!!document.querySelector('[data-bridge-panel=\"open\"]')")) === true
  if (await isOpen()) return { opened: false, alreadyOpen: true }
  const clicked = await page.evaluate("(() => { const slot = document.querySelector('[data-slot=\"sidebar.footer.action\"]');" +
    " const control = slot ? (slot.querySelector('button') || slot) : null; if (!control) return 'no control'; control.click(); return 'clicked' })()")
  if (clicked !== 'clicked') return { opened: false, control: clicked }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isOpen()) return { opened: true }
    await wait(150)
  }
  return { opened: false, control: 'clicked but it never opened' }
}

/* ------------------------------------------------------------------ *
 * App-side tokens
 * ------------------------------------------------------------------ */
/** `12px 12px 12px 12px` -> [12, 12, 12, 12], or null when it is not four lengths. */
const fourLengths = (value) => {
  if (!Array.isArray(value) || value.length !== 4) return null
  const numbers = value.map((part) => (/^-?[\d.]+px$/.test(String(part)) ? Number.parseFloat(part) : NaN))
  return numbers.some((number) => Number.isNaN(number)) ? null : numbers
}

export const tokenStage = async (page) => {
  console.log('\n--- app-side radius tokens ---')
  const appReady = await waitForApp(page)
  if (!appReady) check('the client has mounted the surfaces this stage measures', false, 'no [data-composer-card] with a skin style within 30s')
  const panel = await ensurePanelOpen(page)
  info('bridge panel', JSON.stringify(panel))
  const survey = await page.evaluate(TOKEN_SURVEY)
  info('app survey', JSON.stringify({
    openedPanel: survey.openedPanel, style: survey.style, tokens: survey.tokens,
    inline: survey.inlineTokens, notes: survey.notes,
  }))
  for (const probe of survey.probes) {
    info('  probe ' + probe.role, JSON.stringify({
      expectedToken: probe.expectedToken, tag: probe.tag, cls: probe.cls, attributes: probe.attributes,
      rect: probe.rect, radius: probe.radius,
    }))
  }

  for (const token of ['--lg-radius-window', '--lg-radius-panel', '--lg-radius-control']) {
    check('the skin defines ' + token, /^[\d.]+px$/.test(survey.tokens[token] ?? ''),
      token + '=' + JSON.stringify(survey.tokens[token]))
  }

  const panelToken = Number.parseFloat(survey.tokens['--lg-radius-panel'])
  for (const probe of survey.probes) {
    const tokenName = probe.expectedToken
    if (!tokenName.startsWith('--')) continue
    const tokenValue = survey.tokens[tokenName]
    const corners = fourLengths(probe.radius)
    if (corners === null) { cannot(probe.role + ' has four pixel radii', JSON.stringify(probe.radius)); continue }
    const tokenNumber = Number.parseFloat(tokenValue)
    const uniform = Math.max(...corners) - Math.min(...corners) < 0.01
    if (probe.role === 'composer-card') {
      // The card is not the panel: it is one step larger, and what a user sees as
      // its radius is its own 28px — the value the baseline records. Both numbers
      // are reported, because the offset is what makes the slider move it.
      check('the composer card keeps its own 28px radius',
        uniform && corners[0] === 28,
        'card ' + probe.radius.join(' ') + ' with --lg-radius-panel ' + tokenValue + ' (measured offset +' +
        (Number.isFinite(panelToken) ? Math.round((corners[0] - panelToken) * 100) / 100 : 'n/a') + 'px) [' + probe.tag + ' .' + probe.cls + ']')
      continue
    }
    check(probe.role + ' computed radius equals ' + tokenName + ' (' + tokenValue + ')',
      uniform && Number.isFinite(tokenNumber) && Math.abs(corners[0] - tokenNumber) < 0.01,
      probe.role + ' ' + probe.radius.join(' ') + ' vs token ' + tokenValue + ' [' + probe.tag + ' .' + probe.cls + ']')
  }

  // Reading the value is only half the contract: the token has to be what the
  // corner follows. Rewriting it on `html` is exactly what the settings slider
  // does, so the radii have to move with it and then move back.
  console.log('\n--- token follow-through (this is what the settings slider writes) ---')
  const original = await page.evaluate(TOKEN_READBACK)
  // The inline values are recorded before the write and put back verbatim after
  // it. Removing the properties instead would delete whatever the shell itself
  // had injected — measured at 14px for the panel token — and leave the app on
  // the stylesheet fallback (18px) with no way to tell that it was this gate.
  const priorInline = await page.evaluate('(() => ({ panel: document.documentElement.style.getPropertyValue("--lg-radius-panel"),' +
    ' control: document.documentElement.style.getPropertyValue("--lg-radius-control") }))()')
  const replacement = { panel: 7, control: 3 }
  await page.evaluate('document.documentElement.style.setProperty("--lg-radius-panel", "' + replacement.panel + 'px");' +
    'document.documentElement.style.setProperty("--lg-radius-control", "' + replacement.control + 'px"); "ok"')
  await wait(1800)
  const mutated = await page.evaluate(TOKEN_READBACK)
  await page.evaluate('(() => { const root = document.documentElement.style;' +
    (priorInline.panel === '' ? 'root.removeProperty("--lg-radius-panel");'
      : 'root.setProperty("--lg-radius-panel", ' + JSON.stringify(priorInline.panel) + ');') +
    (priorInline.control === '' ? 'root.removeProperty("--lg-radius-control");'
      : 'root.setProperty("--lg-radius-control", ' + JSON.stringify(priorInline.control) + ');') +
    ' return "ok" })()')
  await wait(1800)
  const restored = await page.evaluate(TOKEN_READBACK)

  for (const [role, tokenName, wanted] of [
    ['lan-panel', '--lg-radius-panel', replacement.panel],
    ['composer-card', '--lg-radius-panel', replacement.panel],
    ['sidebar-surface', '--lg-radius-panel', replacement.panel],
    ['control', '--lg-radius-control', replacement.control],
  ]) {
    const during = fourLengths(mutated.radius[role])
    const back = fourLengths(restored.radius[role])
    const before = fourLengths(original.radius[role])
    if (during === null) { cannot(role + ' follows ' + tokenName, 'no four-radius read-back for ' + role); continue }
    // The card is expected to track the token with the offset it already had, not
    // to equal it: what has to move is the corner, not the relationship.
    const originalPanel = Number.parseFloat(original.tokens.panel)
    const offset = role === 'composer-card' && before !== null && Number.isFinite(originalPanel) ? before[0] - originalPanel : 0
    const expected = wanted + offset
    check(role + ' follows ' + tokenName + ' set to ' + wanted + 'px (expected ' + expected + 'px) and returns to ' + px(before?.[0]) + 'px',
      Math.abs(during[0] - expected) < 0.01 && (back === null || before === null || Math.abs(back[0] - before[0]) < 0.01),
      'while mutated ' + during.join(' ') + ', restored ' + (back ? back.join(' ') : 'n/a') + ', originally ' + (before ? before.join(' ') : 'n/a') +
      (offset === 0 ? '' : ' (tracks the token at +' + offset + 'px)'))
  }
  info('tokens while mutated', JSON.stringify(mutated.tokens))
  info('tokens after restore', JSON.stringify(restored.tokens))
  info('inline tokens before the write, put back after it', JSON.stringify(priorInline))
  return survey
}

/* ------------------------------------------------------------------ *
 * The boot page in both palettes
 * ------------------------------------------------------------------ */

const PALETTES = ['light', 'dark']
const IFRAME = { left: 620, top: 300, width: 420, height: 260 }

/**
 * Render the served boot document and read both its styles and its pixels.
 *
 * The bytes are the shell's own, with exactly one rewrite: the hand-over
 * navigation is neutralised so the page stays measurable, and the caller reports
 * how many edits that took, so the measurement cannot quietly be of a document
 * the shell never served. The frame is same-origin with the client, so its own
 * fetches still work and a palette delivered at runtime is visible here too.
 *
 * @param page - the client's CDP session, where the frame is mounted.
 * @param dpr - the page's device pixel ratio: the captured pixels are device px.
 * @param html - the document the shell served.
 * @param palette - the requested palette, used for the artefact name.
 * @returns the frame's computed styles, the sampled region, and whether the two
 * agree; or null when the frame never became readable.
 */
export const measureBootPalette = async (page, dpr, html, palette) => {
  const srcdoc = html.replace(/location\.replace\(/g, 'void (')
  const rect = JSON.stringify(IFRAME)
  await page.evaluate('(() => {' +
    'let frame = document.getElementById("dsh-verify-boot");' +
    'if (frame) frame.remove();' +
    'frame = document.createElement("iframe");' +
    'frame.id = "dsh-verify-boot";' +
    'const box = ' + rect + ';' +
    'frame.style.cssText = "position:fixed;left:" + box.left + "px;top:" + box.top + "px;width:" + box.width + ' +
    '"px;height:" + box.height + "px;border:0;z-index:2147483000;background:#000";' +
    'document.body.appendChild(frame);' +
    'return "ok" })()')
  await page.evaluate('(() => { const frame = document.getElementById("dsh-verify-boot");' +
    'frame.srcdoc = ' + JSON.stringify(srcdoc) + '; return "ok" })()')

  // What the page paints with is not assumed. A boot page may colour `html`,
  // `body`, or a wrapper of its own, so the readback names the element that
  // actually covers the frame — and the wait is on *that*, not on a stylesheet
  // having parsed, or a palette value that was set but never painted.
  const probe = '(() => {' +
    'const frame = document.getElementById("dsh-verify-boot");' +
    'const doc = frame && frame.contentDocument;' +
    'if (!doc || !doc.body) return null;' +
    'const htmlStyle = getComputedStyle(doc.documentElement);' +
    'const bodyStyle = getComputedStyle(doc.body);' +
    'const box = frame.getBoundingClientRect();' +
    'const opaque = (value) => {' +
    '  if (typeof value !== "string" || !value.startsWith("rgb")) return null;' +
    '  const parts = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")")).split(",").map(part => Number.parseFloat(part));' +
    '  const alpha = parts.length > 3 ? parts[3] : 1;' +
    '  return alpha >= 0.95 ? value : null };' +
    'let painter = null;' +
    'for (const node of Array.from(doc.querySelectorAll("*"))) {' +
    '  const background = opaque(getComputedStyle(node).backgroundColor);' +
    '  if (background === null) continue;' +
    '  const rect = node.getBoundingClientRect();' +
    '  if (rect.width * rect.height < frame.clientWidth * frame.clientHeight * 0.9) continue;' +
    '  painter = { tag: node.tagName.toLowerCase(), cls: String(node.className || "").slice(0, 40), background,' +
    ' rect: [rect.left, rect.top, rect.width, rect.height] };' +
    '  break }' +
    'return { ready: doc.readyState, htmlBackground: htmlStyle.backgroundColor, bodyBackground: bodyStyle.backgroundColor,' +
    ' htmlOpaque: opaque(htmlStyle.backgroundColor) !== null, bodyOpaque: opaque(bodyStyle.backgroundColor) !== null,' +
    ' bootBg: htmlStyle.getPropertyValue("--boot-bg").trim(),' +
    ' paletteAttribute: doc.documentElement.getAttribute("data-shell-palette") || doc.body.getAttribute("data-shell-palette") || doc.documentElement.getAttribute("data-palette") || doc.documentElement.getAttribute("data-theme") || "",' +
    ' prefersDark: doc.defaultView.matchMedia("(prefers-color-scheme: dark)").matches,' +
    ' painter,' +
    ' rect: [box.left, box.top, box.width, box.height] } })()'
  let readback = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(150)
    try {
      readback = await page.evaluate(probe)
      const painted = readback !== null &&
        (readback.painter !== null || readback.htmlOpaque === true || readback.bodyOpaque === true)
      if (readback !== null && readback.ready === 'complete' && painted) break
    } catch { /* the frame is mid-navigation: that is the condition being waited out */ }
  }
  const usable = readback !== null && readback.ready === 'complete' &&
    (readback.painter !== null || readback.htmlOpaque === true || readback.bodyOpaque === true)
  if (!usable) return readback === null ? null : { ...readback, unpainted: true }

  const image = await page.capture('shell-radius-boot-' + palette + '.png')
  const box = readback.rect
  // The whole interior, and the *dominant* colour of it: the boot page draws its
  // own titlebar and a centred card, so a fixed band would be a guess about a
  // layout this gate does not own. The share says whether the reading is of a
  // flat surface at all.
  const x = Math.max(0, Math.round((box[0] + 4) * dpr))
  const y = Math.max(0, Math.round((box[1] + 4) * dpr))
  const width = Math.max(1, Math.min(Math.round((box[2] - 8) * dpr), image.width - x))
  const height = Math.max(1, Math.min(Math.round((box[3] - 8) * dpr), image.height - y))
  const region = stats(image, x, y, width, height)
  const dominant = dominantColor(image, x, y, width, height)
  const channels = [1, 3, 5].map((offset) => Number.parseInt(dominant.color.slice(offset, offset + 2), 16))
  const luminance = Math.round((0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) * 10) / 10
  const expected = readback.painter?.background ??
    (readback.bodyOpaque === true ? readback.bodyBackground :
      readback.htmlOpaque === true ? readback.htmlBackground : readback.bootBg)
  const numbers = String(expected).startsWith('rgb')
    ? String(expected).slice(String(expected).indexOf('(') + 1, String(expected).lastIndexOf(')')).split(',').slice(0, 3).map(part => Number.parseFloat(part))
    : [1, 3, 5].map((offset) => Number.parseInt(String(expected).slice(offset, offset + 2), 16))
  const agrees = readback.unpainted === undefined && numbers.length === 3 && numbers.every((number) => Number.isFinite(number)) &&
    channels.every((channel, index) => Math.abs(channel - numbers[index]) <= 6)
  return { readback, region, dominant, channels, luminance, expected, agrees }
}


/* ------------------------------------------------------------------ *
 * Baseline comparison
 * ------------------------------------------------------------------ */

/**
 * The values .tmp/baseline/BASELINE.md records for the pre-change app.
 *
 * These are the numbers a "worse now" complaint has to be argued with, so each
 * one is compared here rather than described: the composer card's own radius,
 * the shell's 12px inner padding, the bridge panel's own 10px and its own fill,
 * and the boot page's light background.
 */
const BASELINE = {
  cardRadius: 28,
  sidebarInset: 12,
  panelRadiusSkinOff: 10,
  panelFill: { rgb: [67, 69, 74], alpha: 0.45 },
  bootLightBackground: '#ffffff',
}

/**
 * Where the content is *supposed* to sit, from the shell own declarations.
 *
 * The shell owns the window edge, so the padding between it and the client is a
 * declared quantity rather than a measured accident: `--dsh-shell-gap` on the
 * sides and the bottom, plus `--dsh-shell-chrome` for the title strip along the
 * top. The sidebar adds an inset of its own, which is the client layout rather
 * than the shell, so it is measured (`columnInset`) and added to the same model
 * instead of being assumed. The right-hand distance of a column pinned to the
 * left is not a shell property at all, so it is reported and not judged.
 *
 * @param gap - `--dsh-shell-gap` in CSS px.
 * @param chrome - `--dsh-shell-chrome` in CSS px.
 * @param columnInset - how far the sidebar surface sits inside its own column.
 * @returns the expected distance per edge, and which edges are judged.
 */
export function contentInsetModel(gap, chrome, columnInset) {
  return {
    root: { left: gap, right: gap, bottom: gap, top: chrome + gap },
    sidebar: {
      left: gap + columnInset,
      right: gap + columnInset,
      bottom: gap + columnInset,
      top: chrome + gap + columnInset,
    },
    judged: { root: ['left', 'top', 'right', 'bottom'], sidebar: ['left', 'top', 'bottom'] },
  }
}

/** Read the surfaces the baseline talks about, with the skin on or off. */
export const BASELINE_SURVEY = `(() => {
  const round = (node) => { const style = getComputedStyle(node); return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius] }
  const rect = (node) => { const box = node.getBoundingClientRect(); return [box.left, box.top, box.width, box.height] }
  const describe = (node) => node === null ? null : (() => {
    const style = getComputedStyle(node)
    const box = node.getBoundingClientRect()
    return {
      radius: round(node),
      rect: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)],
      margin: style.margin,
      background: style.backgroundColor,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
      boxShadow: style.boxShadow.slice(0, 140),
      isolation: style.isolation,
    }
  })()
  const column = document.querySelector('[data-lg-wide]')
  return {
    style: document.documentElement.getAttribute('data-lg-style'),
    viewport: [window.innerWidth, window.innerHeight],
    dpr: devicePixelRatio,
    tokens: {
      panel: getComputedStyle(document.documentElement).getPropertyValue('--lg-radius-panel').trim(),
      gap: getComputedStyle(document.documentElement).getPropertyValue('--lg-gap').trim(),
      window: getComputedStyle(document.documentElement).getPropertyValue('--lg-radius-window').trim(),
      shellGap: getComputedStyle(document.documentElement).getPropertyValue('--dsh-shell-gap').trim(),
      chrome: getComputedStyle(document.documentElement).getPropertyValue('--dsh-shell-chrome').trim(),
    },
    panel: describe(document.querySelector('[data-bridge-panel="open"]') || document.querySelector('[data-bridge-panel]')),
    card: describe(document.querySelector('[data-composer-card]')),
    sidebar: describe(column ? column.querySelector('[data-slot="sidebar"] > *') : null),
    column: describe(column),
    insetMechanism: {
      bodyPadding: getComputedStyle(document.body).padding,
      bodyMargin: getComputedStyle(document.body).margin,
      htmlPadding: getComputedStyle(document.documentElement).padding,
      chromeHeight: getComputedStyle(document.documentElement).getPropertyValue('--dsh-shell-chrome').trim(),
      bodyClip: getComputedStyle(document.body).clipPath,
    },
    root: describe(document.getElementById('root')),
    materialCount: document.querySelectorAll('[class*="_material_"]').length,
    dialogRows: Array.from((document.querySelector('[role="dialog"]') || document).querySelectorAll('button')).slice(0, 4)
      .map((node) => ({ label: (node.textContent || '').trim().slice(0, 12), radius: round(node) })),
    dialog: describe(document.querySelector('[role="dialog"][aria-modal="true"]') || document.querySelector('[role="dialog"]')),
    materials: Array.from(document.querySelectorAll('[class*="_material_"]')).slice(0, 5).map((node) => ({ cls: String(node.className).slice(0, 50), ...describe(node) })),
  }
})()`

/** Open 设置 → 主题, so the dialog and its material rows can be measured. */
const openSettings = async (page) => {
  const report = await page.evaluate(`(async () => {
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    const label = (node) => (node.textContent || '').trim()
    document.querySelector('[data-slot="settings.launcher"] button')?.click()
    await wait(500)
    Array.from(document.querySelectorAll('[role="menuitem"], button')).find(n => label(n).startsWith('设置'))?.click()
    await wait(900)
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return { failed: 'the settings dialog did not open' }
    const nav = Array.from(dialog.querySelectorAll('button')).find(b => label(b) === '主题')
    if (nav) { nav.click(); await wait(500) }
    return { opened: true, nav: nav !== undefined }
  })()`)
  return report
}

const closeSettings = async (page) => {
  await page.evaluate('(() => { const dialog = document.querySelector("[role=dialog]"); if (dialog) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return "ok" })()')
  await wait(400)
}

/** Measure everything with the skin keyed off, then put the attribute back. */
const withSkinOff = async (page, action) => {
  const before = await page.evaluate('document.documentElement.getAttribute("data-lg-style")')
  let result = null
  let failure = null
  try {
    await page.evaluate('document.documentElement.setAttribute("data-lg-style", "official"); "ok"')
    // The bridge panel re-renders on its own 1.5 s cadence while it is open.
    await wait(2200)
    // A restart between the toggle and the reading replaces the target, so the
    // measurement is taken on whichever session still answers.
    page = await ensureSession(page)
    const current = await page.evaluate('document.documentElement.getAttribute("data-lg-style")')
    if (current !== 'official') {
      await page.evaluate('document.documentElement.setAttribute("data-lg-style", "official"); "ok"')
      await wait(1500)
    }
    result = await action(page)
  } catch (error) {
    failure = error.message
  } finally {
    try {
      await page.evaluate('document.documentElement.setAttribute("data-lg-style", ' + JSON.stringify(before) + '); "ok"')
      await wait(1500)
    } catch (error) {
      failure = (failure === null ? '' : failure + '; ') + 'the attribute could not be put back: ' + error.message
    }
  }
  let after = null
  try { after = await page.evaluate('document.documentElement.getAttribute("data-lg-style")') } catch { /* the page is gone */ }
  return { page, result, before, after, failure }
}

export const baselineStage = async (page) => {
  console.log('\n--- baseline comparison (.tmp/baseline/BASELINE.md) ---')
  await waitForApp(page)
  const panelOpened = await ensurePanelOpen(page)
  info('bridge panel before the baseline survey', JSON.stringify(panelOpened))
  const survey = await page.evaluate(BASELINE_SURVEY)
  const [width, height] = survey.viewport
  info('baseline survey', JSON.stringify({ style: survey.style, viewport: survey.viewport, tokens: survey.tokens }))

  // 1) What the shell's inner padding leaves between the content and the window.
  if (survey.sidebar === null) {
    cannot('the sidebar surface is present', 'no [data-lg-wide] [data-slot="sidebar"] > * element')
  } else {
    const [left, top, sidebarWidth, sidebarHeight] = survey.sidebar.rect
    const edges = {
      left, top, right: width - (left + sidebarWidth), bottom: height - (top + sidebarHeight),
    }
    const gap = Number.parseFloat(survey.tokens.shellGap)
    const chrome = Number.parseFloat(survey.tokens.chrome)
    const rootBox = survey.root === null ? null : survey.root.rect
    const rootEdges = rootBox === null ? null : {
      left: rootBox[0], top: rootBox[1], right: width - (rootBox[0] + rootBox[2]), bottom: height - (rootBox[1] + rootBox[3]),
    }
    // The sidebar surface sits inside its own column as well; that inset is the
    // client layout, so it is measured and added to the model rather than assumed.
    const columnInset = survey.column === null ? null : edges.left - survey.column.rect[0]
    const model = Number.isFinite(gap) && Number.isFinite(chrome) && columnInset !== null
      ? contentInsetModel(gap, chrome, columnInset)
      : null
    const cardEdges = survey.card === null ? null : (() => {
      const [cardLeft, cardTop, cardWidth, cardHeight] = survey.card.rect
      return { left: cardLeft, top: cardTop, right: width - (cardLeft + cardWidth), bottom: height - (cardTop + cardHeight) }
    })()
    info('where the content sits inside the window', 'content root left ' + (rootEdges === null ? 'n/a' : rootEdges.left) + ' / top ' +
      (rootEdges === null ? 'n/a' : rootEdges.top) + ' / right ' + (rootEdges === null ? 'n/a' : rootEdges.right) + ' / bottom ' +
      (rootEdges === null ? 'n/a' : rootEdges.bottom) + ' px; sidebar surface left ' + edges.left + ' / top ' + edges.top + ' / right ' + edges.right +
      ' / bottom ' + edges.bottom + ' px' + (cardEdges === null ? '' : '; composer card left ' + cardEdges.left + ' / top ' + cardEdges.top +
      ' / right ' + cardEdges.right + ' / bottom ' + cardEdges.bottom + ' px') +
      '; the shell declares --dsh-shell-gap ' + JSON.stringify(survey.tokens.shellGap) + ' and --dsh-shell-chrome ' +
      JSON.stringify(survey.tokens.chrome) + ' (body padding ' + JSON.stringify(survey.insetMechanism.bodyPadding) +
      '), the element margin is ' + survey.sidebar.margin + ', and the column sits at ' + JSON.stringify(survey.column?.rect))
    if (model === null || rootEdges === null) {
      cannot('the content inset follows the shell declarations', 'no --dsh-shell-gap (' + JSON.stringify(survey.tokens.shellGap) +') or --dsh-shell-chrome (' + JSON.stringify(survey.tokens.chrome) + ') or root element to measure against')
    } else {
      const off = (measured, expected, edge) => Math.abs(measured[edge] - expected[edge]) <= 1
      check('the content root sits --dsh-shell-gap ' + gap + 'px from the sides and bottom, and chrome + gap ' + model.root.top + 'px from the top',
        model.judged.root.every((edge) => off(rootEdges, model.root, edge)),
        'root left ' + rootEdges.left + ' / top ' + rootEdges.top + ' / right ' + rootEdges.right + ' / bottom ' + rootEdges.bottom +
        ' px against the model left ' + model.root.left + ' / top ' + model.root.top + ' / right ' + model.root.right + ' / bottom ' + model.root.bottom +
        ' px (gap ' + gap + ' + chrome ' + chrome + ')')
      check('the sidebar surface adds only its own ' + Math.round(columnInset * 100) / 100 + 'px column inset to that gap',
        model.judged.sidebar.every((edge) => off(edges, model.sidebar, edge)),
        'sidebar left ' + edges.left + ' / top ' + edges.top + ' / bottom ' + edges.bottom + ' px against the model left ' + model.sidebar.left +
        ' / top ' + model.sidebar.top + ' / bottom ' + model.sidebar.bottom + ' px; its right edge is ' + edges.right +
        ' px and is not judged, because this column is pinned to the left of the window')
      if (!model.judged.root.every((edge) => off(rootEdges, model.root, edge)) || !model.judged.sidebar.every((edge) => off(edges, model.sidebar, edge))) {
        console.log('REGRESSION  the content inset does not match --dsh-shell-gap ' + gap + ' + --dsh-shell-chrome ' + chrome +
          ': root ' + JSON.stringify(rootEdges) + ' vs ' + JSON.stringify(model.root) + ', sidebar ' + JSON.stringify(edges) + ' vs ' + JSON.stringify(model.sidebar))
      }
    }
  }

  // 2) The composer card's own radius.
  if (survey.card !== null) {
    const cardRadius = roundValue(survey.card.radius[0])
    check('the composer card keeps the baseline ' + BASELINE.cardRadius + 'px radius',
      cardRadius === BASELINE.cardRadius,
      'card ' + survey.card.radius.join('/') + ' with --lg-radius-panel=' + survey.tokens.panel +
      (cardRadius === BASELINE.cardRadius ? '' : ' — the card now follows the panel token rather than its own value'))
    if (cardRadius !== BASELINE.cardRadius) console.log('REGRESSION  composer card radius ' + cardRadius + 'px vs baseline ' + BASELINE.cardRadius + 'px')
  }

  // 3) The bridge panel's own fill and radius, with the skin off and on.
  if (survey.panel === null) {
    cannot('the bridge panel is present', 'no [data-bridge-panel] element')
  } else {
    info('panel with the skin on', JSON.stringify({ radius: survey.panel.radius.join('/'), background: survey.panel.background, backdropFilter: survey.panel.backdropFilter }))
    const parsed = parseColor(survey.panel.background)
    const baselineFill = 'rgb(' + BASELINE.panelFill.rgb.join(', ') + ') / ' + Math.round(BASELINE.panelFill.alpha * 100) + '%'
    if (parsed === null) {
      cannot('the panel fill is readable', JSON.stringify(survey.panel.background))
    } else {
      // With the skin on the panel is a *surface* the skin draws, so its fill is
      // the skin's popover grade by design. The number is still reported against
      // the baseline, because "the panel used to be this" is the whole question.
      info('panel fill, skin on', 'color(srgb ' + (parsed.rgb.map((channel) => (channel / 255).toFixed(6)).join(' ')) + ' / ' + parsed.alpha + ') = rgb(' +
        parsed.rgb.join('/') + ') at ' + Math.round(parsed.alpha * 100) + '% versus the baseline ' + baselineFill +
        (Math.abs(parsed.alpha - BASELINE.panelFill.alpha) <= 0.02 ? ' (same alpha)' : ' (alpha differs by ' +
          Math.round(Math.abs(parsed.alpha - BASELINE.panelFill.alpha) * 100) + ' points)'))
    }
    // The baseline contract is what a user sees with the skin off: the panel's
    // own material, which is exactly the state the baseline records.
    const off = await withSkinOff(page, async (session) => { await ensurePanelOpen(session); return session.evaluate(BASELINE_SURVEY) })
    page = off.page ?? page
    const offPanel = off.result?.panel ?? null
    const offRadius = offPanel === null ? null : roundValue(offPanel.radius[0])
    const offFill = offPanel === null ? null : parseColor(offPanel.background)
    const fillMatches = offFill !== null && offFill.rgb.every((channel, index) => Math.abs(channel - BASELINE.panelFill.rgb[index]) <= 2) &&
      Math.abs(offFill.alpha - BASELINE.panelFill.alpha) <= 0.02
    if (off.result === null) {
      // The shell was restarted between the toggle and the reading. That is an
      // instrument condition, not a panel defect: it is reported, not failed.
      info('this run could not measure the skin-off panel', off.failure ?? 'the survey did not complete')
      check('the skin attribute is back after the skin-off measurement',
        off.after === off.before, 'before ' + JSON.stringify(off.before) + ', after ' + JSON.stringify(off.after))
      return survey
    }
    check('with the skin off the panel keeps its own ' + BASELINE.panelRadiusSkinOff + 'px radius and ' + baselineFill + ' fill',
      offRadius === BASELINE.panelRadiusSkinOff && fillMatches,
      'skin off: radius ' + (offPanel === null ? 'no panel element' : offPanel.radius.join('/')) + ', fill ' +
      (offPanel === null ? 'n/a' : offPanel.background) + ', shadow ' + (offPanel === null ? 'n/a' : offPanel.boxShadow) +
      '; --lg-radius-panel then reads ' + JSON.stringify(off.result?.tokens.panel) + (off.failure === null ? '' : ' [' + off.failure + ']'))
    if (offRadius !== BASELINE.panelRadiusSkinOff || !fillMatches) {
      console.log('REGRESSION  skin off: panel radius ' + offRadius + 'px and fill ' + (offPanel === null ? 'n/a' : offPanel.background) +
        ' where the baseline is ' + BASELINE.panelRadiusSkinOff + 'px and ' + baselineFill)
    }
    check('the skin attribute is back after the skin-off measurement',
      off.after === off.before && off.after === 'liquid-glass', 'before ' + JSON.stringify(off.before) + ', after ' + JSON.stringify(off.after))
    info('skin off survey', JSON.stringify({
      card: off.result?.card === null ? null : off.result?.card.radius.join('/'),
      sidebar: off.result?.sidebar === null ? null : off.result?.sidebar.radius.join('/'),
      panelFill: offPanel === null ? null : offPanel.background,
    }))
  }

  // 4) The dialog and the list rows: what the client's own radius was, and what
  //    the skin makes of it. Both numbers, measured in the same dialog.
  page = await ensureSession(page)
  const opened = await openSettings(page)
  if (opened.failed !== undefined) {
    cannot('the settings dialog opens for the dialog measurement', opened.failed)
  } else {
    const on = await page.evaluate(BASELINE_SURVEY)
    const off = await withSkinOff(page, (session) => session.evaluate(BASELINE_SURVEY))
    page = off.page ?? page
    if (off.result === null) {
      cannot('the dialog is measured with the skin on and off', off.failure ?? 'the survey did not complete')
      await closeSettings(page)
      return survey
    }
    for (const surface of ['dialog']) {
      const skinOn = on[surface] === null ? null : on[surface].radius.join('/')
      const skinOff = off.result[surface] === null ? null : off.result[surface].radius.join('/')
      check('the ' + surface + ' radius is measured with the skin on and off', skinOn !== null && skinOff !== null,
        'skin on ' + skinOn + ', skin off ' + skinOff + (on[surface] === null ? '' : ' [rect ' + on[surface].rect.join(',') + ']'))
      if (skinOn !== null && skinOff !== null && skinOn !== skinOff) {
        console.log('BASELINE DIFF  ' + surface + ' radius changed from the client\\\'s own ' + skinOff + ' (skin off) to ' + skinOn + ' (skin on)')
      }
    }
    const rows = on.materials.map((entry) => entry.cls + '=' + entry.radius.join('/'))
    const rowsOff = off.result.materials.map((entry) => entry.cls + '=' + entry.radius.join('/'))
    if (on.materialCount === 0 && off.result.materialCount === 0) {
      info('the [class*=_material_] selector', 'this client build carries no element with that class (0 with the skin on and 0 with it off),' +
        ' so the dialog and its own rows are the menu-grade surfaces compared instead')
    } else {
      check('the [class*=_material_] rows are measured with the skin on and off', rows.length > 0 || rowsOff.length > 0,
        'skin on ' + JSON.stringify(rows) + ', skin off ' + JSON.stringify(rowsOff))
      info('material rows with the skin off', JSON.stringify(rowsOff))
    }
    const rowList = (entry) => (entry.dialogRows ?? []).map((row) => (row.label || '(icon)') + '=' + row.radius.join('/'))
    info('the dialog rows', 'skin on ' + JSON.stringify(rowList(on)) + ', skin off ' + JSON.stringify(rowList(off.result)))
    await closeSettings(page)
    const stillOpen = await page.evaluate('document.querySelector("[role=dialog]") !== null')
    check('the settings dialog is closed again', stillOpen === false, stillOpen ? 'a dialog is still mounted' : 'no dialog is mounted')
  }
  return survey
}

/** '18px' -> 18, or null. */
const roundValue = (value) => {
  const match = /^(-?[\d.]+)px$/.exec(String(value))
  return match === null ? null : Number.parseFloat(match[1])
}

/** Parse 'rgb(r, g, b)', 'rgba(r, g, b, a)' or 'color(srgb r g b / a)'. */
const parseColor = (value) => {
  const text = String(value)
  if (text.startsWith('rgb')) {
    const parts = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')).split(',').map((part) => Number.parseFloat(part))
    return parts.length < 3 ? null : { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 }
  }
  if (text.startsWith('color(')) {
    const parts = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')).split(/[\s/]+/).filter((part) => part.length > 0)
    const numbers = parts.slice(1).map((part) => Number.parseFloat(part))
    if (numbers.length < 3) return null
    return {
      rgb: numbers.slice(0, 3).map((channel) => Math.round(channel * 255)),
      alpha: numbers.length > 3 ? numbers[3] : 1,
    }
  }
  return null
}

export const bootStage = async (page, radius, dpr) => {
  console.log('\n--- boot page palette (the application preference, not the OS theme) ---')
  const served = {}
  const measured = {}
  for (const palette of PALETTES) {
    const answer = await putWindow(radius, palette)
    check('PUT palette=' + palette + ' answers 200', answer.status === 200, 'status ' + answer.status)
    const response = await fetch(BOOT_PAGE, { redirect: 'manual' })
    const html = await response.text()
    const rewrites = (html.match(/location\.replace\(/g) ?? []).length
    served[palette] = {
      status: response.status, length: html.length,
      hash: createHash('sha1').update(html).digest('hex').slice(0, 12), rewrites,
    }

    // The served bytes are rendered as they are, with exactly one rewrite: the
    // hand-over navigation is neutralised so the page stays measurable. The count
    // of edits is printed with the result, so the measurement cannot quietly be
    // of a document the shell did not serve.
    const measurement = await measureBootPalette(page, dpr, html, palette)
    if (measurement === null) { cannot('boot page renders for palette=' + palette, 'the iframe never became readable'); continue }
    const { readback, region, channels, luminance, expected, agrees } = measurement
    measured[palette] = { ...readback, mean: region.mean, luminance, spread: region.spread, pixels: region.pixels }

    // What the pixels say has to be what the document says it painted, or the
    // frame was covered and the measurement is of something else.
    if (!agrees) cannot('boot page pixels for palette=' + palette,
      'sampled ' + region.mean + ' but the frame reports ' + expected + ': the iframe was covered by another layer')

    check('boot page palette=' + palette + ' paints a ' + (palette === 'light' ? 'light' : 'dark') + ' background',
      palette === 'light' ? luminance >= 200 : luminance <= 60,
      'sampled ' + region.mean + ' (luminance ' + luminance + ') over ' + region.pixels + ' device px, body ' +
      readback.bodyBackground + ', --boot-bg ' + JSON.stringify(readback.bootBg) + ', data-palette ' + JSON.stringify(readback.paletteAttribute) +
      ', OS prefers dark=' + readback.prefersDark)
  }

  if (served.light && served.dark) {
    check('the served boot document differs between the two palettes', served.light.hash !== served.dark.hash,
      'light ' + served.light.hash + ' (' + served.light.length + ' bytes) vs dark ' + served.dark.hash + ' (' + served.dark.length + ' bytes)')
    check('the served boot document answers 200 for both palettes',
      served.light.status === 200 && served.dark.status === 200,
      'light ' + served.light.status + ', dark ' + served.dark.status)
    info('boot page bytes edited for measurement', 'location.replace( neutralised: light ' + served.light.rewrites + ', dark ' + served.dark.rewrites)
  }
  if (measured.light && measured.dark) {
    const delta = Math.round((measured.light.luminance - measured.dark.luminance) * 10) / 10
    check('the boot page follows the application palette, not the OS theme',
      measured.light.prefersDark === measured.dark.prefersDark && delta >= 100,
      'luminance ' + measured.light.luminance + ' vs ' + measured.dark.luminance + ' (delta ' + delta + '), OS prefers dark ' +
      measured.light.prefersDark + ' in both runs, mean ' + measured.light.mean + ' vs ' + measured.dark.mean)
  }
  await page.evaluate('(() => { const frame = document.getElementById("dsh-verify-boot"); if (frame) frame.remove(); return "ok" })()')
  return { served, measured }
}

/* ------------------------------------------------------------------ *
 * The window's own corners
 * ------------------------------------------------------------------ */

/**
 * The ways a page can put a rounded corner on a rectangle.
 *
 * Which one the shell uses is its business; that all of them produce the same
 * shape is what makes a library of them a fair reference for the window.
 */
export const mechanisms = (radius) => [
  ['div-border-radius', '<style>html,body{margin:0;height:100%;background:transparent}' +
    '#f{position:absolute;inset:0;border-radius:' + radius + 'px;background:#123456}</style><div id="f"></div>'],
  ['root-border-radius', '<style>html{margin:0;height:100%;background:#123456;border-radius:' + radius + 'px;overflow:hidden}' +
    'body{margin:0;height:100%;background:transparent}</style>'],
  ['clip-path-inset-round', '<style>html,body{margin:0;height:100%;background:transparent}' +
    '#f{position:absolute;inset:0;background:#123456;clip-path:inset(0 round ' + radius + 'px)}</style><div id="f"></div>'],
  ['rounded-overflow-container', '<style>html,body{margin:0;height:100%;background:transparent}' +
    '#o{position:absolute;inset:0;overflow:hidden;border-radius:' + radius + 'px}' +
    '#i{position:absolute;inset:0;background:#123456}</style><div id="o"><div id="i"></div></div>'],
]

export const cornerLimit = (dpr) => Math.max(24, Math.ceil(RADII[RADII.length - 1] * dpr) + 16)

/** Render every mechanism at every radius, and keep the profiles as references. */
export const referenceLibrary = async (dpr) => {
  const created = await (async () => {
    const host = await findPage()
    const socket = await attach(host)
    const answer = await socket.call('Target.createTarget', { url: 'about:blank' })
    socket.close()
    if (answer.result?.targetId === undefined) throw new Error('Target.createTarget refused: ' + JSON.stringify(answer).slice(0, 200))
    return answer.result.targetId
  })()
  let target = null
  for (let attempt = 0; attempt < 40 && target === null; attempt += 1) {
    target = (await listTargets()).find((entry) => entry.id === created || entry.targetId === created) ?? null
    if (target === null) await wait(200)
  }
  if (target === null) throw new Error('the scratch target never appeared in /json/list')
  const scratch = await attach(target)
  await scratch.call('Emulation.setDeviceMetricsOverride', { width: 600, height: 420, deviceScaleFactor: dpr, mobile: false })
  await scratch.call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 0, b: 255, a: 1 } })
  const limit = cornerLimit(dpr)
  const broken = []
  const library = [{ label: 'square', radius: 0, mechanism: 'square', rows: new Array(limit).fill(0) }]
  for (const radius of RADII) {
    if (radius === 0) continue
    for (const [mechanism, body] of mechanisms(radius)) {
      const html = '<html><head><meta charset="utf-8">' + body.slice(0, body.indexOf('</style>') + 8) + '</head><body>' + body.slice(body.indexOf('</style>') + 8) + '</body></html>'
      await scratch.call('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) })
      await wait(350)
      const image = await scratch.capture('shell-radius-reference-r' + radius + '-' + mechanism + '.png')
      const rows = cornerProfile(image, 'tl', isMagenta, limit)
      const fit = fitRadius(rows, limit)
      // A mechanism whose page never painted is a broken test page rather than a
      // square corner: keeping it would drag the spread between references and
      // could let a wrong radius match the wrong shape.
      if (fit.radius < 2) {
        const magenta = rows.reduce((sum, row) => sum + (row >= limit ? limit : row), 0)
        broken.push(mechanism + ' at ' + radius + 'px painted nothing (' + magenta + ' px of backdrop left)')
        continue
      }
      library.push({ label: radius + ' css px via ' + mechanism, radius, mechanism, rows, fit: fit.radius })
    }
  }
  const spread = {}
  for (const radius of RADII) {
    if (radius === 0) continue
    const fits = library.filter((entry) => entry.radius === radius).map((entry) => entry.fit / dpr)
    spread[radius] = Math.round((Math.max(...fits) - Math.min(...fits)) * 100) / 100
  }
  return {
    library,
    spread,
    broken,
    limit,
    targetId: created,
    close: async () => {
      await scratch.call('Target.closeTarget', { targetId: created })
      scratch.close()
    },
  }
}

/** Match one radius's four window profiles against the references for that radius. */
export const matchRadius = (profiles, library, radius, dpr) => {
  const scored = library
    .filter((entry) => entry.radius === radius || (radius === 0 && entry.mechanism === 'square'))
    .map((entry) => {
      const scores = profiles.map((rows) => matchProfile(rows, entry.rows))
      return {
        label: entry.label,
        mechanism: entry.mechanism,
        referenceFitCss: entry.fit === undefined ? 0 : Math.round((entry.fit / dpr) * 100) / 100,
        worst: Math.max(...scores.map((score) => score.worst)),
        mean: Number((scores.reduce((sum, score) => sum + score.mean, 0) / scores.length).toFixed(2)),
      }
    })
    .sort((a, b) => (a.worst - b.worst) || (a.mean - b.mean))
  const best = scored[0] ?? null
  return { best, scored, accepted: best !== null && best.worst <= MATCH_ROW && best.mean <= MATCH_MEAN }
}

/**
 * Capture the shell's own window rectangle off the screen.
 *
 * This is the only instrument that can see a rounded window edge: inside the
 * page the corners are painted like everything else, so a page-level capture
 * shows no rounding at all, and what the desktop sees is the composited window.
 *
 * @param margin - how much desktop to include around the window, in device px.
 * @param output - where the PNG goes.
 * @returns the helper's report: the window rectangle, the image rectangle, and
 * the process it picked.
 */
export const screenCapture = (margin, output) => {
  const helper = fileURLToPath(new URL('./lib/window-shot.ps1', import.meta.url))
  const raw = execFileSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Margin', String(margin), '-Output', output, '-Match', 'dsh-link'], { encoding: 'utf8', timeout: 60000 })
  const report = JSON.parse(raw.trim().split(/\r?\n/).filter((line) => line.length > 0).pop())
  if (report.error !== undefined) throw new Error(report.error)
  return report
}

/**
 * Where the window's edge moved between two screen captures, one row at a time.
 *
 * A differential measurement, not an absolute one. The desktop behind a rounded
 * corner is not a colour this gate gets to assume — a wallpaper may be the same
 * dark grey as the window — but the *same pixel* captured at radius 0 and at
 * radius 12 differs exactly where the rounding cut the window away, and nowhere
 * else. That mask is the arc, whatever the desktop looks like.
 *
 * @param image - the capture at the radius being measured.
 * @param reference - the capture at radius 0, the square corner.
 * @param corner - 'tl' | 'tr' | 'bl' | 'br'.
 * @param origin - the window's outer edges inside the images.
 * @param limit - how many device pixels of the corner to profile.
 * @param threshold - per-channel difference that counts as moved.
 * @returns the first moved column per row, in the corner's own frame.
 */
export const edgeProfile = (image, reference, corner, origin, limit, threshold = 12) => {
  const rows = []
  for (let row = 0; row < limit; row += 1) {
    let found = limit
    for (let step = 0; step < limit; step += 1) {
      const fromLeft = corner === 'tl' || corner === 'bl'
      const fromTop = corner === 'tl' || corner === 'tr'
      const x = fromLeft ? origin.left + step : origin.right - 1 - step
      const y = fromTop ? origin.top + row : origin.bottom - 1 - row
      const i = (y * image.width + x) * image.channels
      const j = (y * reference.width + x) * reference.channels
      const difference = Math.max(
        Math.abs(image.pixels[i] - reference.pixels[j]),
        Math.abs(image.pixels[i + 1] - reference.pixels[j + 1]),
        Math.abs(image.pixels[i + 2] - reference.pixels[j + 2]))
      if (difference > threshold) { found = step; break }
    }
    rows.push(found)
  }
  return rows
}

export const cornerStage = async (page, dpr) => {
  console.log('\n--- window corners at radius 0/12/28, device pixels at dpr ' + dpr + ' ---')
  mkdirSync(ARTEFACTS, { recursive: true })
  const limit = cornerLimit(dpr)

  let references = null
  try {
    references = await referenceLibrary(dpr)
    info('corner reference library', references.library
      .map((entry) => (entry.mechanism === 'square' ? 'square' : 'r' + entry.radius + ' ' + entry.mechanism + ' -> fit ' +
        Math.round((entry.fit / dpr) * 100) / 100 + 'px')).join(', '))
    info('spread between mechanisms at the same radius', JSON.stringify(references.spread) + ' px')
  } catch (error) {
    cannot('the corner reference library renders', error.message)
  }

  const summaries = {}
  const screenShots = {}
  let screenOrigin = null
  for (const radius of RADII) {
    const answer = await putWindow(radius, 'dark')
    if (answer.status !== 200) { cannot('radius ' + radius + ' corner pixels', 'the endpoint answered ' + answer.status); continue }
    await wait(400)
    const shellState = await page.evaluate(TOKEN_READBACK)
    const shellRadius = Number.parseFloat(shellState.shell.radiusToken)
    check('the shell reports --dsh-shell-radius=' + radius + ' after the PUT',
      shellRadius === radius,
      '--dsh-shell-radius=' + JSON.stringify(shellState.shell.radiusToken) + ', window ' + (shellState.shell.maximized ? 'maximized' : 'restored'))
    await page.call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 255, g: 0, b: 255, a: 1 } })
    let image = null
    try {
      image = await page.capture('shell-radius-corner-r' + radius + '.png')
    } catch (error) {
      cannot('radius ' + radius + ' corner pixels', error.message)
    } finally {
      await page.call('Emulation.setDefaultBackgroundColorOverride', {})
    }
    if (image === null) continue

    const corners = {}
    const profiles = []
    let backdrop = 0
    for (const corner of CORNERS) {
      // Transparent is the backdrop here: the window paints nothing outside its
      // own arc, and the capture carries that as alpha 0 (a capture with nothing
      // transparent in it comes back as RGB, which is evidence of its own).
      const rows = cornerProfile(image, corner, isCut, limit)
      const fit = fitRadius(rows, limit)
      const count = cornerBackdropCount(image, corner, isCut, limit)
      backdrop += count
      corners[corner] = { device: fit.radius, css: Math.round((fit.radius / dpr) * 100) / 100, worstRow: fit.worstRow, edge: fit.edge, backdrop: count }
      profiles.push(rows)
    }
    const values = CORNERS.map((corner) => corners[corner].css)
    const spread = Math.round((Math.max(...values) - Math.min(...values)) * 100) / 100
    const worstRow = Math.max(...CORNERS.map((corner) => corners[corner].worstRow))
    const expectedDevice = radius * dpr
    const area = Math.round(4 * 0.2146 * expectedDevice * expectedDevice)
    const sees = radius === 0 ? true : backdrop >= Math.max(20, Math.round(area * 0.25))

    if (radius > 0 && !sees) {
      info('radius ' + radius + ' corners', CORNERS.map((corner) => corner + ' ' + values[CORNERS.indexOf(corner)] + 'px').join(', ') +
        ' — backdrop ' + backdrop + ' px in the corner squares (expected about ' + area + ')')
      cannot('radius ' + radius + ' corner radius from pixels',
        'only ' + backdrop + ' px of the four corner squares are transparent, expected about ' + area +
        ': the window paints its corners, so the rounding is either native (not page-drawn) or absent. Artefact ' +
        join(ARTEFACTS, 'shell-radius-corner-r' + radius + '.png'))
      continue
    }

    const match = references === null ? null : matchRadius(profiles, references.library, radius, dpr)
    const detail = 'corners ' + values.join('/') + 'px (fitted, uncorrected), spread ' + spread + 'px, worst row ' + worstRow +
      'px, backdrop ' + backdrop + 'px vs about ' + area + 'px' +
      (match === null ? ', no reference library' : ', best reference ' + match.best.label + ' (worst row ' + match.best.worst + 'px, mean ' + match.best.mean + 'px)')
    info('radius ' + radius + ' measurement', detail + ', artefact ' + join(ARTEFACTS, 'shell-radius-corner-r' + radius + '.png'))

    if (match === null) {
      const absolute = values.every((value) => Math.abs(value - radius) <= 2) && spread <= CORNER_SPREAD && worstRow <= 2
      check('radius ' + radius + ' measures as ' + radius + 'px in all four corners (absolute fit, no calibration)', absolute, detail)
    } else {
      check('radius ' + radius + ' draws the corner a ' + radius + 'px radius renders as',
        match.accepted && spread <= CORNER_SPREAD && worstRow <= 2, detail)
    }
    summaries[radius] = { values, backdrop, spread }
  }

  const measured = RADII.filter((radius) => summaries[radius] !== undefined)
    .map((radius) => Math.round((summaries[radius].values.reduce((sum, value) => sum + value, 0) / 4) * 100) / 100)
  if (measured.length === RADII.length) {
    check('the endpoint actually moves the drawn corner (0 < 12 < 28)',
      measured[0] < measured[1] && measured[1] < measured[2],
      'mean fitted corners ' + measured.join(' < ') + 'px for requested ' + RADII.join(' < ') + 'px')
  }
  // One cross-check off the screen itself: the page says the corner is
  // transparent, so the pixels *there* on the monitor have to be something other
  // than the window's own fill.
  const largest = RADII[RADII.length - 1]
  if (summaries[largest] !== undefined) {
    try {
      const report = screenCapture(60, join(ARTEFACTS, 'shell-radius-screen-r' + largest + '.png'))
      const image = decode(readFileSync(report.output))
      const at = (x, y) => {
        const i = (y * image.width + x) * image.channels
        return '#' + [0, 1, 2].map((offset) => image.pixels[i + offset].toString(16).padStart(2, '0')).join('')
      }
      const x = report.window.left - report.capture.left
      const y = report.window.top - report.capture.top
      const corner = at(x, y)
      const inside = at(x + 40, y + 40)
      info('on screen at radius ' + largest, 'the window corner pixel is ' + corner + ' while 40 px inside it is ' + inside +
        (corner === inside ? ' — identical, so the corner is painted by the window' : ' — different, so the desktop, not the window, is at the corner'))
    } catch (error) {
      info('on-screen cross-check skipped', error.message)
    }
  }
  if (references) await references.close()
  return summaries
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

/** Run every stage against the live shell. */
const main = async () => {
console.log('dsh-link shell-radius gate — CDP ' + cdpPort + ', shell ' + SHELL_ORIGIN)
console.log('artefacts go to ' + ARTEFACTS)

let page = null
let previous = null
const started = newestShellJson()
if (started) {
  try { previous = JSON.parse(started.text) } catch { previous = null }
  info('shell.json before the run', started.path + ' ' + JSON.stringify(started.text).slice(0, 200))
} else {
  info('shell.json before the run', 'not found')
}

try {
  const target = await findPage()
  page = await attach(target)
  info('page', target.url + ' — ' + target.title)

  let mounted = false
  for (let attempt = 0; attempt < 120 && !mounted; attempt += 1) {
    try { mounted = (await page.evaluate('!!document.querySelector("[data-slot=\'settings.launcher\'] button")')) === true } catch { /* mid-boot */ }
    if (!mounted) await wait(250)
  }
  if (!mounted) {
    check('the client is mounted', false, 'the settings launcher never appeared on the page in 30s')
  } else {
    const dpr = await page.evaluate('devicePixelRatio')
    info('devicePixelRatio', String(dpr))

    await endpointStage(started)
    await tokenStage(page)
    const radiusForBoot = previous && Number.isFinite(Number(previous.radius)) ? Number(previous.radius) : 12
    await bootStage(page, radiusForBoot, dpr)
    await cornerStage(page, dpr)
    // Last, because it opens the settings modal: a dialog left over this stage
    // would sit on top of the boot frame the palette check has to sample.
    await baselineStage(page)

    if (previous && Number.isFinite(Number(previous.radius)) && (previous.palette === 'light' || previous.palette === 'dark')) {
      const restore = await putWindow(Number(previous.radius), previous.palette)
      check('the shell is left in the state the gate found it in',
        restore.status === 200 && Number(restore.body?.radius) === Number(previous.radius) && restore.body?.palette === previous.palette,
        'restored radius=' + px(previous.radius) + ' palette=' + px(previous.palette) + ' (status ' + restore.status + ')')
    } else {
      info('restore skipped', 'no initial radius and palette could be read from shell.json')
    }
  }
} catch (error) {
  check('the gate ran to the end', false, error.message)
} finally {
  if (page !== null) {
    try { await page.call('Emulation.setDefaultBackgroundColorOverride', {}) } catch { /* nothing to clear */ }
    try { await page.evaluate('(() => { const frame = document.getElementById("dsh-verify-boot"); if (frame) frame.remove(); return "ok" })()') } catch { /* not mounted */ }
    page.close()
  }
}

console.log('')
if (undecided.length > 0) console.log(undecided.length + ' check(s) the instruments could not decide: ' + undecided.join('; '))
console.log(failures === 0 && undecided.length === 0
  ? 'shell radius gate: all checks passed'
  : failures + ' check(s) failed, ' + undecided.length + ' undecided')
process.exit(failures === 0 && undecided.length === 0 ? 0 : 1)
}

if (isMain) await main()
