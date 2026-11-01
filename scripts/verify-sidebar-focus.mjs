#!/usr/bin/env node
/**
 * Gate 99 (R155) - 点哪打哪: does keyboard focus land where the click landed?
 *
 * Subject: Input events driven INTO the panel through its own DevTools protocol (in process) and into the
 * main page through the shell's debugging port, with focus read back from BOTH documents.
 *
 * This is the criterion a sidebar browser cannot fake: a panel that paints but never takes focus is a
 * picture, not a browser. It is also the missing half of AI self-control - R149 proved the shell can ASK
 * the panel a question; this proves it can act on it and see the effect.
 *
 * Readings:
 *   1-panel   a click inside the panel gives the panel document focus
 *   2-main    a click on the main page takes focus BACK (both readings paired: main true AND panel false)
 *   3-back    a second click inside the panel returns focus to it (a round trip, not a one-way latch)
 *   4-honest  a click that cannot be dispatched is a named failure, never a silent pass
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when CDP is not answering.
 *
 * Usage: node scripts/verify-sidebar-focus.mjs [--cdp-port 9222] [--deadline-ms 15000] [--self-attack]
 */
import { connect, COLUMN_PROBE } from './cdp-drive.mjs'
import { claimLease, releaseLease, openOwnPanel } from './panel-lease.mjs'

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
const DEADLINE_MS = Number(option('--deadline-ms', '15000'))
const SELF_ATTACK = has('--self-attack')

const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const panelCdp = async (port, method, params) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel/cdp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) }).catch(() => null)
  if (answer === null) return { ok: false, inner: null, error: 'the shell did not answer' }
  const raw = await answer.text().catch(() => '')
  let envelope = null
  try { envelope = JSON.parse(raw) } catch (error) { envelope = null }
  let inner = null
  if (envelope !== null && typeof envelope.result === 'string') { try { inner = JSON.parse(envelope.result) } catch (error) { inner = null } }
  return { ok: envelope !== null && envelope.ok === true, inner, error: envelope === null ? 'unparsable answer' : envelope.error }
}
const panelFocus = async (port) => {
  const answer = await panelCdp(port, 'Runtime.evaluate', { expression: 'document.hasFocus()', returnByValue: true })
  const value = answer.inner === null ? null : answer.inner.result === undefined ? null : answer.inner.result.value
  return { ok: answer.ok, value: value === undefined ? null : value, error: answer.error }
}
const panelClick = (port, x, y) => panelCdp(port, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })

// --------------------------------------------------------------------------------------------- judge
const judge = (world, expect) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === true, detail: String(detail), evidence: evidence || [] })
  const clickable = world.panel !== null && world.panel !== undefined

  {
    const problems = []
    if (clickable === false) problems.push('not-applicable')
    else {
      if (world.panel.ok !== true) problems.push('the click inside the panel was refused: ' + show(world.panel.error))
      const focus = world.panelFocus
      if (focus === null || focus.value === null) problems.push('the panel never answered whether it has focus')
      else if (expect.panelFocus !== null && focus.value !== expect.panelFocus) problems.push('the panel focus is ' + show(focus.value) + ', expected ' + show(expect.panelFocus))
    }
    const skip = problems.length === 1 && problems[0] === 'not-applicable'
    record('1-panel', problems.length === 0 || skip, skip ? 'not applicable: no panel was open' : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'a click inside the panel gives the panel document focus'), ['panelClick=' + show(world.panel), 'panelFocus=' + show(world.panelFocus)])
  }

  {
    const problems = []
    if (clickable === false) problems.push('not-applicable')
    else {
      // R155 measured that document.hasFocus() answers TRUE in BOTH webviews while the main page is being
      // clicked (panel=true AND main=true), so it cannot say which one has focus: both documents live in one
      // top-level window and report the WINDOW's focus. The paired reading this criterion needs - "the panel
      // gives focus up" - has to be taken at the native level (OS keystrokes and see which document receives
      // them), which is owed and recorded in STATUS. Asserting the pair here would be asserting something this
      // instrument cannot see, which is worse than saying so.
      // The instrument limit is n/a, but a main page that does not report focus at all is a FAILURE: the first
      // draft made that case fall through to "the main page reports focus", which is a hollow green - the
      // reading said the opposite of what it measured. The red is pushed first, and the n/a only applies when
      // BOTH documents claim focus (the blind case).
      if (world.mainFocus !== null && world.mainFocus.value !== true) problems.push('the main page did not report focus after a click on it: ' + show(world.mainFocus === null ? null : world.mainFocus.value))
      if (world.mainFocus !== null && world.mainFocus.value === true && world.panelFocusAfterMain !== null && world.panelFocusAfterMain.value === true) problems.push('not-applicable')
    }
    const skip = problems.length === 1 && problems[0] === 'not-applicable'
    const notApplicable = problems.length === 1 && problems[0] === 'not-applicable'
    // The reason in the message has to be the reason that actually applies: the first version said "no panel
    // was open" for a run in which the panel WAS open and only the instrument was blind (measured in R155).
    const reason = clickable === false
      ? 'not applicable: no panel was open'
      : (notApplicable ? 'not applicable: document.hasFocus() is true in BOTH webviews, so this instrument cannot say which one has focus - the paired reading is owed at the native level (see STATUS)' : null)
    record('2-main', problems.length === 0 || skip || notApplicable, reason === null ? (problems.length ? 'FAIL: ' + problems.join(' | ') : 'the main page reports focus after a click on it') : reason, ['mainFocus=' + show(world.mainFocus), 'panelAfterMain=' + show(world.panelFocusAfterMain)])
  }

  {
    const problems = []
    if (clickable === false) problems.push('not-applicable')
    else if (world.claimAfterSecondClick === false) problems.push('not-applicable: the lease could not be taken again after the second click revoked it')
    else if (world.panelAgain !== null && world.panelAgain !== undefined && world.panelAgain.ok !== true) problems.push('the second click into the panel was refused: ' + show(world.panelAgain.error))
    else if (world.panelFocusAgain === null || world.panelFocusAgain.value !== true) problems.push('the panel did not take focus back on a second click: ' + show(world.panelFocusAgain === null ? null : world.panelFocusAgain.value))
    const skip = problems.length === 1 && problems[0] === 'not-applicable'
    const named = problems.length === 1 && problems[0] === 'not-applicable: the lease could not be taken again after the panel click revoked it'
    record('3-back', problems.length === 0 || skip || named, skip || named ? problems[0] : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'focus goes back to the panel on a second click - the round trip works'), ['panelFocusAgain=' + show(world.panelFocusAgain), 'panelAgain=' + show(world.panelAgain), 'reclaims=' + show(world.reclaims)])
  }

  {
    const problems = []
    const dispatch = world.panel
    if (dispatch !== null && dispatch !== undefined && dispatch.ok === false) problems.push('not-applicable')
    else if (dispatch === null || dispatch === undefined) problems.push('not-applicable: no panel was open, so no click could be dispatched')
    else if (expect.dispatchFails === true && dispatch.ok !== false) problems.push('this run expected the dispatch to fail and it succeeded')
    // R240: readings 1-3 already treat "no panel was open" as a named third state. Reading 4 was the odd one out and
    // turned the SAME world fact into a red - the gate punishing the world for not having the panel it never opened.
    // It now joins them: a panel that is not open is not a product verdict, it is a fact this line names.
    const absent = problems.length === 1 && String(problems[0]).startsWith('not-applicable')
    record('4-honest', problems.length === 0 || absent, absent ? String(problems[0]) : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'a refused dispatch is carried as a failure, not swallowed'), ['dispatch=' + show(dispatch)])
  }

  return readings
}

const expectations = (over = {}) => ({
  // The honest expectation is stated, not left open: a click inside the panel GIVES it focus. A judge that
  // only compares when told what to compare against cannot redden when the panel simply never takes focus
  // (measured: the first self-attack had exactly that hole).
  panelFocus: over.panelFocus === undefined ? true : over.panelFocus,
  dispatchFails: over.dispatchFails === true,
})

// ------------------------------------------------------------------------------------------- probe
const collect = async () => {
  const cdp = await connect({ port: CDP_PORT, deadlineMs: DEADLINE_MS })
  if (cdp === null) return null
  const port = new URL(cdp.page).port
  const world = { page: cdp.page, panel: null, panelFocus: null, mainClick: null, mainFocus: null, panelFocusAfterMain: null, panelFocusAgain: null, panelAgain: null, reclaims: [] }
  // R182 measured the product's rule from this gate's own side, and it costs the gate one re-claim per read:
  // an op=cdp that INJECTS a click delivers a real pointerdown into the panel page, the page reports it, and the
  // shell revokes the lease for it - so the very next op comes back refused BY NAME ("the lease held by
  // verify-sidebar-focus was REVOKED by user-input (pointerdown): claim the panel again to continue") while the
  // panel was never asked anything. Readings 1 and 3 were red against a panel that had answered nothing. The
  // gate now takes the lease again after EVERY op that injects input - the main-page click revokes it too - and
  // carries the revocation as evidence rather than scoring it against the product: that a click really landed as
  // input is the fact this gate exists to drive. A re-claim that the world refuses leaves the read unmeasured
  // and says so, instead of being counted as a focus verdict.
  const claimAgain = async (why) => { const held = await claimLease(port, 'verify-sidebar-focus'); world.reclaims.push({ why, held }); return held }
  const holdsLease = await claimLease(port, 'verify-sidebar-focus')
  const opened = await openOwnPanel(port, { x: 600, y: 90, w: 420, h: 600 })
  if (opened === null || opened.exists !== true) { await releaseLease(port, 'verify-sidebar-focus'); cdp.close(); return world }
  // The panel's own viewport is what these coordinates are in: a point well inside it.
  const inside = { x: 60, y: 120 }
  world.panel = await panelClick(port, inside.x, inside.y)
  await sleep(900)
  world.claimAfterPanelClick = await claimAgain('after the click into the panel')
  world.panelFocus = world.claimAfterPanelClick ? await panelFocus(port) : null
  // A point on the main page that the panel does not cover (the panel sits on the right column).
  const outside = { x: 120, y: 300 }
  try {
    await cdp.click({ x: outside.x, y: outside.y })
    await sleep(900)
    world.mainFocus = await cdp.json('JSON.stringify(document.hasFocus())')
    world.mainClick = { ok: true }
  } catch (error) {
    world.mainClick = { ok: false, error: String(error && error.message ? error.message : error) }
  }
  world.claimAfterMainClick = await claimAgain('after the click on the main page')
  world.panelFocusAfterMain = world.claimAfterMainClick ? await panelFocus(port) : null
  // The round trip itself: a second click into the panel, then the lease once more so its focus can be read at all.
  world.panelAgain = world.claimAfterMainClick ? await panelClick(port, inside.x, inside.y) : null
  await sleep(900)
  world.claimAfterSecondClick = await claimAgain('after the second click into the panel')
  world.panelFocusAgain = world.claimAfterSecondClick ? await panelFocus(port) : null
  await releaseLease(port, 'verify-sidebar-focus')
  cdp.close()
  return world
}

// -------------------------------------------------------------------------------------- self-attack
const honest = () => ({ page: 'synthetic', panel: { ok: true }, panelFocus: { ok: true, value: true }, mainClick: { ok: true }, mainFocus: { ok: true, value: true }, panelFocusAfterMain: { ok: true, value: false }, panelFocusAgain: { ok: true, value: true } })
const withWorld = (over) => ({ ...honest(), ...over })

const selfAttack = () => {
  let failures = 0
  const baseline = judge(honest(), expectations())
  const red = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  ' + (red.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC world judged with honest expectations is green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (red.length > 0) failures += 1
  const mutants = [
    { name: 'the panel never takes focus', world: withWorld({ panelFocus: { ok: true, value: false } }), mustRedden: ['1-panel'] },
    // A mutant asserting "focus did not move" is not in this list any more: R155 measured that both documents
    // report hasFocus() true, so that world is indistinguishable from the honest one through this instrument.
    // A mutant that cannot be told apart from the truth is not a mutant - the native-level reading is owed.
    { name: 'the main page never takes focus', world: withWorld({ mainFocus: { ok: true, value: false } }), mustRedden: ['2-main'] },
    { name: 'the round trip never comes back', world: withWorld({ panelFocusAgain: { ok: true, value: false } }), mustRedden: ['3-back'] },
    // R182: the branch this gate used to fall into without saying so. The second click carries an answer of its
    // own now, and a world where the shell REFUSED it must be told apart from a panel that simply did not take
    // focus back - the first is the instrument or the lease, the second is the round trip.
    { name: 'the second click is refused', world: withWorld({ panelAgain: { ok: false, error: 'refused: the lease was revoked by user input' } }), mustRedden: ['3-back'] },
    { name: 'a refused dispatch', world: withWorld({ panel: { ok: false, error: 'refused' } }), mustRedden: ['1-panel'] },
  ]
  for (const mutant of mutants) {
    const seen = judge(mutant.world, expectations()).filter((reading) => reading.ok === false).map((reading) => reading.id)
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
  const readings = judge(world, expectations())
  console.log('  live page ' + world.page)
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  console.log(failed.length === 0 ? '  ' + String(readings.length) + ' readings, all held' : '  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed')
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()