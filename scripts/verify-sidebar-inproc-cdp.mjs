#!/usr/bin/env node
/**
 * Gate 98 (R149) - can the shell ASK the panel, not just wait to be told?
 *
 * Subject: POST /__shell/panel/cdp, which calls the panel's own ICoreWebView2 through the DevTools protocol
 * IN PROCESS (src-tauri/src/core/panel_cdp.rs). No debugging port is involved.
 *
 * Readings:
 *   1-answer      Runtime.evaluate comes back with a value, and it AGREES with the page-side channel
 *                 (two independent ways to learn the title must not disagree)
 *   2-navigate    Page.navigate moves the panel to a real site and the shell can then read where it is and
 *                 what it is called
 *   3-screenshot  Page.captureScreenshot returns actual image data (the pixel path, in process)
 *   4-refusal     with no panel the same call reports a named failure instead of an empty success
 *   5-unknown     a method the browser does not know is an error, never a silent ok
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when CDP is not answering.
 *
 * Usage: node scripts/verify-sidebar-inproc-cdp.mjs [--cdp-port 9222] [--site https://example.com]
 *        [--deadline-ms 20000] [--self-attack] [--expect-title <text>] [--expect-screenshot-min N]
 *        [--expect-refusal ok]
 *
 * --self-attack judges labelled SYNTHETIC worlds with one expectation mutated at a time: it proves the
 * judge can fail, never that the probe works.
 */
import { connect, COLUMN_PROBE } from './cdp-drive.mjs'
import { claimLease, releaseLease, openOwnPanel } from './panel-lease.mjs'

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
const SITE = option('--site', 'https://example.com')
const DEADLINE_MS = Number(option('--deadline-ms', '20000'))
const SELF_ATTACK = has('--self-attack')
const OPEN_LABEL = '\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f'

const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const originOf = (href) => { try { return new URL(String(href)).origin } catch (error) { return null } }

const panelCall = async (port, payload) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return { status: 0, body: null }
  const text = await answer.text().catch(() => '')
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = null }
  return { status: answer.status, body, text }
}
// The CDP answer is TWO layers: this shell's envelope {"ok":…,"result":"<json string>"} around the
// protocol's own answer. Measured in R149: a helper that skipped the inner parse reported "no image data"
// for a screenshot that had succeeded.
const cdpCall = async (port, method, params, timeoutMs) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel/cdp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params, timeoutMs }) }).catch(() => null)
  if (answer === null) return { status: 0, ok: false, error: 'the shell did not answer', inner: null }
  const text = await answer.text().catch(() => '')
  let envelope = null
  try { envelope = JSON.parse(text) } catch (error) { envelope = null }
  let inner = null
  if (envelope !== null && typeof envelope.result === 'string') {
    try { inner = JSON.parse(envelope.result) } catch (error) { inner = null }
  }
  return { status: answer.status, ok: envelope !== null && envelope.ok === true, error: envelope === null ? 'unparsable answer' : envelope.error, inner, envelope }
}
const valueOf = (answer) => { const value = answer?.inner?.result?.value; return value === undefined ? null : value }

// --------------------------------------------------------------------------------------------- judge
const judge = (world, expect) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === true, detail: String(detail), evidence: evidence || [] })
  const notApplicable = (id, why, evidence) => record(id, true, 'not applicable: ' + why, evidence || [])

  {
    const problems = []
    const answer = world.answer
    if (expect.refusalOnly === true) {
      problems.push('not-applicable')
    } else if (answer === null || answer === undefined) problems.push('the evaluate call was not made')
    else if (answer.ok !== true) problems.push('the evaluate call failed: ' + show(answer.error))
    else {
      const title = valueOf(answer)
      if (typeof title !== 'string' || title.length === 0) problems.push('Runtime.evaluate returned no usable title: ' + show(answer.inner))
      if (expect.title !== null && expect.title !== undefined && title !== expect.title) problems.push('the title is ' + show(title) + ', expected ' + show(expect.title))
      // The page-side channel is a SNAPSHOT up to 2 s old, and a page may legitimately retitle itself in
      // that window - measured in R150: the client page reported "DSH Local Build" through the beacon while
      // the protocol read "DSH 本地构建" live, both correct. So the two channels are compared on WHAT PAGE
      // they are talking about, not on a mutable string; a title difference is printed as evidence.
      const beacon = world.beaconTitle
      const beaconHref = world.beaconHref
      const here = world.answerHref
      if (typeof beacon === 'string' && beacon.length === 0) problems.push('the page-side channel reported an empty title')
      if (typeof beaconHref === 'string' && typeof here === 'string' && originOf(beaconHref) !== originOf(here)) problems.push('the two channels are talking about different pages: page=' + show(beaconHref) + ' protocol=' + show(here))
    }
    const skip = problems.length === 1 && problems[0] === 'not-applicable'
    if (skip) notApplicable('1-answer', 'this world has no panel to ask', ['answer=' + show(world.answer)])
    else record('1-answer', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the shell asked the panel for a value and got one, and both channels agree on WHICH page it is', ['answer=' + show(world.answer), 'answerHref=' + show(world.answerHref), 'beaconHref=' + show(world.beaconHref), 'beaconTitle=' + show(world.beaconTitle)])
  }

  {
    const problems = []
    const nav = world.navigate
    if (expect.navigateApplicable === false) {
      problems.push('not-applicable')
    } else if (nav === null || nav === undefined) problems.push('the navigation was never attempted')
    else {
      const wanted = originOf(SITE)
      if (nav.navigateOk !== true) problems.push('Page.navigate did not answer ok: ' + show(nav.navigateError))
      const href = String(nav.href === undefined || nav.href === null ? '' : nav.href)
      if (wanted !== null && href.indexOf(wanted) !== 0) problems.push('after the navigation the panel is at ' + show(href) + ', not at ' + String(wanted))
      if (typeof nav.title !== 'string' || nav.title.length === 0) problems.push('the panel reports no title after navigating: ' + show(nav.title))
    }
    const skip = problems.length === 1 && problems[0] === 'not-applicable'
    if (skip) notApplicable('2-navigate', 'no panel to navigate', ['navigate=' + show(world.navigate)])
    else record('2-navigate', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the shell can move the panel to a real site and read where it landed', ['navigate=' + show(world.navigate)])
  }

  {
    const problems = []
    const shot = world.screenshot
    if (expect.screenshotApplicable === false) problems.push('not-applicable')
    else if (shot === null || shot === undefined) problems.push('no screenshot was attempted')
    else {
      if (shot.ok !== true) problems.push('Page.captureScreenshot failed: ' + show(shot.error))
      const length = typeof shot.dataLength === 'number' ? shot.dataLength : -1
      if (length < expect.screenshotMin) problems.push('the screenshot carried ' + String(length) + ' bytes of base64, below the ' + String(expect.screenshotMin) + ' this reading demands')
    }
    const skip = problems.length === 1 && problems[0] === 'not-applicable'
    if (skip) notApplicable('3-screenshot', 'no panel to photograph', ['screenshot=' + show(world.screenshot)])
    else record('3-screenshot', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'the panel answered with real image data, in process', ['screenshot=' + show(world.screenshot)])
  }

  {
    const problems = []
    const refusal = world.refusal
    const pre = world.refusalPrecondition
    // Synthetic worlds (the self-attack) carry a refusal and no precondition: they are judging the JUDGE, so
    // they must keep going through the same door. A live world that could not establish 'no panel' is a
    // named third state, not a verdict: nothing about the no-panel path was witnessed.
    const liveWorld = pre !== null && pre !== undefined
    const established = liveWorld && pre.before === false && pre.after === false
    const lostPrecondition = liveWorld && established === false
    if (lostPrecondition) {
      readings.push({ id: '4-refusal', ok: false, notMeasured: true, detail: 'NOT MEASURED: the shell did not have a no-panel instant for this call (panel before=' + show(pre.before) + ', after=' + show(pre.after) + ', attempt=' + show(pre.attempt) + '), so no-panel behaviour was never witnessed', evidence: ['precondition=' + show(pre), 'refusal=' + show(refusal)] })
    } else {
      if (refusal === null || refusal === undefined) problems.push('the call with no panel was never made')
      else {
        if (expect.refusal === false) {
          if (refusal.ok !== true) problems.push('this run expected the call to succeed and it failed: ' + show(refusal.error))
        } else {
          if (refusal.ok === true) problems.push('a call with no panel answered ok=true, so the failure is silent')
          if (refusal.status === 200) problems.push('a call with no panel answered HTTP 200')
          if (typeof refusal.error !== 'string' || refusal.error.length === 0) problems.push('a call with no panel carried no error text')
        }
      }
      record('4-refusal', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'with no panel the call fails by name rather than succeeding emptily', ['refusal=' + show(world.refusal), 'precondition=' + show(pre)])
    }
  }

  {
    const problems = []
    const unknown = world.unknown
    if (unknown === null || unknown === undefined) problems.push('the unknown-method call was never made')
    else {
      if (unknown.ok === true) problems.push('an unknown protocol method answered ok=true')
      if (typeof unknown.error !== 'string' || unknown.error.length === 0) problems.push('an unknown method carried no error text')
    }
    record('5-unknown', problems.length === 0, problems.length ? 'FAIL: ' + problems.join(' | ') : 'a method the browser does not know is an error, never a silent ok', ['unknown=' + show(world.unknown)])
  }

  return readings
}

const expectations = (over = {}) => ({
  title: over.title === undefined ? option('--expect-title', null) : over.title,
  screenshotMin: over.screenshotMin === undefined ? Number(option('--expect-screenshot-min', '1000')) : over.screenshotMin,
  // Default: with no panel the call MUST be refused. `--expect-refusal ok` is the mutant that expects the
  // opposite (this was inverted in the first draft, which made reading 4 red in the honest baseline).
  refusal: over.refusal === undefined ? option('--expect-refusal', 'refused') !== 'ok' : over.refusal,
  refusalOnly: over.refusalOnly === true,
  navigateApplicable: over.navigateApplicable,
  screenshotApplicable: over.screenshotApplicable,
})

// ------------------------------------------------------------------------------------------- probe
const collect = async () => {
  const cdp = await connect({ port: CDP_PORT, deadlineMs: DEADLINE_MS })
  if (cdp === null) return null
  const port = new URL(cdp.page).port
  // The holder does the whole job: take the lease, open and place the panel itself (the host stands down).
  const holdsLease = await claimLease(port, 'verify-sidebar-inproc-cdp')
  const world = { page: cdp.page, answer: null, answerHref: null, beaconTitle: null, beaconHref: null, navigate: null, screenshot: null, refusal: null, unknown: null }
  const state = async () => (await panelCall(port, { op: 'state' })).body
  let now = await state()
  if (now !== null && now.exists === true) { await panelCall(port, { op: 'close' }); await sleep(1200); now = await state() }
  // Reading 4, and the reason it is written this way. "While there is definitely no panel" was an
  // ASSUMPTION, not a measurement: the page host can raise a panel again inside the sleep above - this file's
  // own comment said so - and when it did, the call below answered correctly and reading 4 called that a
  // silent success. That red had no defect behind it, and R214 measured it twice. So the gate now (a) tries
  // to catch a real no-panel instant, (b) reads the panel state on BOTH sides of the call it is judging, and
  // (c) refuses to judge when it could not establish the precondition, as a named third state.
  const refusalRun = await (async () => {
    let lastSeen = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await panelCall(port, { op: 'close' })
      await sleep(attempt === 0 ? 320 : 140)
      const before = await state()
      if (before !== null && before.exists === true) { lastSeen = { before: true, after: 'not-called' }; continue }
      const call = await cdpCall(port, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true })
      const after = await state()
      const clean = after !== null && after.exists !== true
      lastSeen = { before: before === null ? 'unknown' : false, after: after === null ? 'unknown' : after.exists === true, attempt }
      if (clean) return { call, precondition: lastSeen }
    }
    return { call: null, precondition: lastSeen }
  })()
  world.refusal = refusalRun.call
  world.refusalPrecondition = refusalRun.precondition
  const probe = await cdp.json(COLUMN_PROBE)
  const columnOpen = probe.ok === true && probe.value.column !== null && probe.value.column.w >= 48
  const open = (probe.ok === true ? (probe.value.buttons || []) : []).find((entry) => entry.label === OPEN_LABEL)
  await openOwnPanel(port)
  const until = Date.now() + DEADLINE_MS
  while (Date.now() < until) { await sleep(800); now = await state(); if (now !== null && now.exists === true) break }
  if (now === null || now.exists !== true) {
    world.judgeOnly = true
      await releaseLease(port, 'verify-sidebar-inproc-cdp')
  cdp.close()
    return world
  }
  world.answer = await cdpCall(port, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true })
  const hereAnswer = await cdpCall(port, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true })
  world.answerHref = valueOf(hereAnswer)
  world.beaconHref = now.content !== null && now.content !== undefined && typeof now.content.href === 'string' ? now.content.href : null
  world.beaconTitle = now.content !== null && now.content !== undefined && typeof now.content.title === 'string' ? now.content.title : null
  const navigate = await cdpCall(port, 'Page.navigate', { url: SITE })
  const navUntil = Date.now() + DEADLINE_MS
  let href = null
  let title = null
  while (Date.now() < navUntil) {
    await sleep(1200)
    const here = await cdpCall(port, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true })
    const called = await cdpCall(port, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true })
    href = valueOf(here)
    title = valueOf(called)
    const wanted = originOf(SITE)
    if (typeof href === 'string' && wanted !== null && href.indexOf(wanted) === 0) break
  }
  world.navigate = { navigateOk: navigate.ok, navigateError: navigate.error, href, title, site: SITE }
  const shot = await cdpCall(port, 'Page.captureScreenshot', { format: 'png' })
  const data = shot.inner !== null && shot.inner !== undefined && typeof shot.inner.data === 'string' ? shot.inner.data : null
  world.screenshot = { ok: shot.ok, error: shot.error, dataLength: data === null ? -1 : data.length, shape: shot.inner === null ? 'no inner json' : Object.keys(shot.inner).join(',') }
  world.unknown = await cdpCall(port, 'Page.noSuchMethodAtAll', {})
  await panelCall(port, { op: 'close' })
    await releaseLease(port, 'verify-sidebar-inproc-cdp')
  cdp.close()
  return world
}

// -------------------------------------------------------------------------------------- self-attack
const base = () => ({ page: 'synthetic', answer: { ok: true, status: 200, inner: { result: { type: 'string', value: 'Example Domain' } } }, answerHref: 'https://example.com/', beaconTitle: 'Example Domain', beaconHref: 'https://example.com/', navigate: { navigateOk: true, href: 'https://example.com/', title: 'Example Domain', site: SITE }, screenshot: { ok: true, dataLength: 200000, shape: 'data' }, refusal: { ok: false, status: 502, error: 'no panel: open it before asking it anything' }, unknown: { ok: false, status: 502, error: 'the protocol answered with an error' } })
const withWorld = (over) => ({ ...base(), ...over })

const selfAttack = () => {
  const honest = expectations()
  let failures = 0
  const baseline = judge(base(), honest)
  const red = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  ' + (red.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC world judged with honest expectations is green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (red.length > 0) failures += 1
  const mutants = [
    { name: 'the page-side channel is talking about a different page', world: withWorld({ beaconHref: 'http://127.0.0.1:31761/' }), expect: honest, mustRedden: ['1-answer'] },
    { name: 'the navigation never moved the panel', world: withWorld({ navigate: { navigateOk: true, href: 'http://127.0.0.1:31761/', title: 'still here', site: SITE } }), expect: honest, mustRedden: ['2-navigate'] },
    { name: 'a screenshot with no image data', world: withWorld({ screenshot: { ok: true, dataLength: 0, shape: 'data' } }), expect: honest, mustRedden: ['3-screenshot'] },
    { name: 'a call with no panel that answered ok', world: withWorld({ refusal: { ok: true, status: 200, error: null } }), expect: honest, mustRedden: ['4-refusal'] },
    { name: 'an unknown method that answered ok', world: withWorld({ unknown: { ok: true, status: 200, error: null } }), expect: honest, mustRedden: ['5-unknown'] },
  ]
  for (const mutant of mutants) {
    const seen = judge(mutant.world, mutant.expect).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const precise = seen.length === mutant.mustRedden.length && mutant.mustRedden.every((id) => seen.includes(id))
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(seen) + ' expected=' + show(mutant.mustRedden))
  }
  console.log('  note the live probe was NOT exercised in this mode: --self-attack attacks the judge only.')
  return failures === 0 ? 0 : 1
}

const main = async () => {
  if (SELF_ATTACK) return selfAttack()
  let world
  try { world = await collect() }
  catch (error) {
    console.log('  FAIL  collect(): the judge itself failed before judging anything (a GATE bug, not a data verdict)')
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    process.exit(1)
  }
  if (world === null) {
    console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING')
    return 3
  }
  const expect = expectations()
  if (world.judgeOnly === true) {
    expect.navigateApplicable = false
    expect.screenshotApplicable = false
    expect.refusalOnly = false
  }
  const readings = judge(world, expect)
  console.log('  live page ' + world.page + ' | site=' + SITE)
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const notMeasured = readings.filter((reading) => reading.notMeasured === true)
  const failed = readings.filter((reading) => reading.ok === false && reading.notMeasured !== true)
  if (notMeasured.length > 0) console.log('  ' + String(notMeasured.length) + ' reading(s) NOT MEASURED - a third state, not a verdict: ' + notMeasured.map((reading) => reading.id).join(','))
  console.log(failed.length === 0 && notMeasured.length === 0 ? '  ' + String(readings.length) + ' readings, all held' : '  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed, ' + String(notMeasured.length) + ' not measured')
  if (failed.length > 0) return 1
  return notMeasured.length > 0 ? 3 : 0
}

process.exitCode = await main()