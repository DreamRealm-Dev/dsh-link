#!/usr/bin/env node
/**
 * Gate (R178-U) - does a REAL USER INPUT in the panel page take the panel away from the AI side?
 *
 * Subject: POST /__shell/panel. The producer is boardfixer (task-203); this gate is written by somebody else,
 * from the contract only, and it is expected to be RED until that work lands.
 *
 * The contract, as four claims with numbers:
 *   1-baseline-ai-calls-ok       with NO user input in this run, the AI side may drive the panel: op=cdp returns
 *                              200 with ok, and op=set-bounds on the rect the panel already has is accepted
 *   2-user-input-refuses-cdp     after ONE real user input lands in the panel page (injected here as a trusted
 *                              keydown through the panel protocol, which is how the earlier gates drive real
 *                              gestures), the NEXT op=cdp is REFUSED and the refusal NAMES the cause: the error
 *                              text contains "user-input"
 *   3-user-input-refuses-bounds  the same for the next op=set-bounds
 *   4-reclaim-restores-cdp       after op=lease {leaseOp:"claim"} the AI can drive the panel again: op=cdp is 200
 *   5-negative-control           in the SAME run, the same two calls SUCCEEDED before the input and were REFUSED
 *                              after it: the difference is the input, not the environment, the clock or the
 *                              process. A gate that only ever sees refusals cannot tell "the rule works" from
 *                              "the panel is wedged", which is why this reading is PAIRED and not a second copy
 *                              of reading 1.
 *
 * Bounds, stated rather than assumed:
 *   - The injection is an AI-side op=cdp call dispatching Input.dispatchKeyEvent (keyDown Shift, which cannot
 *     activate anything in the panel page). It reaches the panel page as a trusted event only because CDP input
 *     is injected into that page own renderer; whether the producer counts it as user input is exactly what
 *     reading 2 measures. --inject wheel|pointer switches the gesture if a producer only listens for those;
 *     the strategy used is printed.
 *   - This gate does NOT take the lease for readings 1-3: it measures what an AI caller WITHOUT the lease gets.
 *     Reading 4 takes it, and the gate releases it again at the end.
 *   - R182-G: THE TREATMENT HAS TO BE OBSERVED, not assumed. The panel is taken by the PANEL DOCUMENT'S OWN
 *     BEACON (core/panel_reporter.js:85-93 listens for keydown/pointerdown/wheel and loads an image at
 *     /__shell/panel/report?userInput=<kind>, which proxy.rs:647-655 turns into note_user_input). A gesture
 *     dispatched before that document exists produces NO beacon at all, and then "the call after the input was
 *     accepted" describes a world in which nothing ever took the panel. Measured in R182-G: op=open reports
 *     exists=true after ~1.05s while the panel page's first report arrives at ~3.1s; the gate injected at
 *     ~1.4s and readings 2/3/5 went red, while the SAME gate in a world where the page was already up ran 5/5
 *     green with the named refusal (raw: .tmp/r182-live/ d5/d7/d11). So: the page is waited for, the
 *     treatment (userInputReports / lastUserInput moving) is required before any verdict is claimed, and a
 *     run where it never arrived reports a NAMED not-measured reading (ok=null, exit 3) - never a red one.
 *   - The gate mounts the browser pane with the product own start page if the pane is not up (op=state reports
 *     mounted=false) and SAYS SO in its progress lines; it never restarts the client.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when nothing could be measured (no shell,
 * no panel and the pane would not mount, or a reading that could not be reached) - never a silent green.
 *
 * Usage: node verify-user-input-reclaim.mjs [--port 31761] [--inject keydown|wheel|pointer] [--deadline-ms 8000]
 *        [--self-attack]
 */
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(option('--port', '31761'))
const DEADLINE_MS = Number(option('--deadline-ms', '8000'))
const INJECT = String(option('--inject', 'keydown'))
const SELF_ATTACK = has('--self-attack')
const HOLDER = 'gate-r178-u'

const show = (value) => { const text = JSON.stringify(value === undefined ? null : value); return text === undefined ? String(value) : text }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const namesInput = (text) => /user-input/i.test(String(text === null || text === undefined ? '' : text))

const panelPost = async (payload) => {
  const answer = await fetch('http://127.0.0.1:' + PORT + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return { status: 0, body: null, text: '' }
  const text = await answer.text().catch(() => '')
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = null }
  return { status: answer.status, body, text }
}
const answerOf = (answer) => answer === null || answer === undefined ? null : {
  status: answer.status,
  // null when the reply carries no ok field at all (op=set-bounds answers with the flat panel report): "absent"
  // and "false" are different facts, and printing false for every accepted placement reads like a refusal
  ok: answer.body === null || answer.body === undefined || answer.body.ok === undefined ? null : answer.body.ok === true,
  error: answer.body === null || answer.body === undefined || answer.body.error === undefined ? null : answer.body.error,
  namesUserInput: answer.body !== null && answer.body !== undefined && namesInput(answer.body.error),
  // the raw body is only carried when it did not parse: a parsed body is summarised by status/ok/error, and the
  // full panel report in every evidence line made the output unreadable
  text: answer.body === null ? String(answer.text || '').slice(0, 200) : '(json body: ' + String(answer.text || '').length + ' bytes)',
}
const refused = (record) => record !== null && (record.status !== 200 || record.error !== null)

const stateOf = async () => {
  const answer = await panelPost({ op: 'state' })
  const body = answer.body
  const st = body !== null && body !== undefined && body.state !== undefined && body.state !== null ? body.state : body
  return { answer, state: st }
}

// ------------------------------------------------------------------------------------------------- judge
const judge = (world, expect) => {
  const readings = []
  // R181-D/R182-G: ok is THREE-valued. `ok === true` would turn a named NOT MEASURED into a FAIL, which is
  // using the world's fact as the product's sentence.
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === null ? null : ok === true, detail: String(detail), evidence: evidence || [] })
  const treated = world.treatment !== undefined && world.treatment !== null && world.treatment.observed === true
  const treatmentWhy = 'the panel document never reported a user input in this run (' + show(world.treatment === undefined ? null : world.treatment) + '), so the panel was never TAKEN: the treatment this reading is about was not applied'

  { // 1-baseline-ai-calls-ok
    const problems = []
    const a = world.before === null || world.before === undefined ? null : world.before
    if (a === null) problems.push('the gate never got to make an AI call before the input')
    else {
      if (a.cdp === null || a.cdp.ok !== true) problems.push('the AI op=cdp call was not accepted before any input: status=' + String(a.cdp === null ? 'no answer' : a.cdp.status) + ' error=' + show(a.cdp === null ? null : a.cdp.error))
      if (a.bounds === null || refused(a.bounds) === true) problems.push('the AI op=set-bounds call on the rect the panel already had was not accepted before any input: status=' + String(a.bounds === null ? 'no answer' : a.bounds.status) + ' error=' + show(a.bounds === null ? null : a.bounds.error))
      if (a.cdp !== null && a.bounds !== null && namesInput(a.cdp.error) === true) problems.push('the panel was ALREADY refusing with user-input before this run injected anything, so this world was taken over by an earlier actor: nothing here measures this run')
    }
    record('1-baseline-ai-calls-ok', problems.length === 0, problems.length === 0
      ? 'with the panel untouched by any input in this run the AI side drives it: op=cdp 200 ok and op=set-bounds accepted'
      : 'FAIL: ' + problems.join(' | '),
      ['beforeCdp=' + show(a === null ? null : a.cdp), 'beforeBounds=' + show(a === null ? null : a.bounds), 'injection=' + show(world.injection === undefined ? null : world.injection.strategy)])
  }

  { // 2-user-input-refuses-cdp
    const problems = []
    const step = world.afterInput === null || world.afterInput === undefined ? null : world.afterInput
    if (world.injectionOk !== true) problems.push('the gate could not land a user input in the panel page (' + show(world.injection === undefined ? null : world.injection) + '), so nothing about the takeover was measured')
    if (step === null || step.cdp === null) problems.push('the gate never made the op=cdp call that follows the input')
    else {
      if (refused(step.cdp) !== true) problems.push('the AI op=cdp call after the user input was ACCEPTED (status ' + String(step.cdp.status) + '), so the panel was not taken away from the AI side')
      else if (step.cdp.namesUserInput !== true) problems.push('the AI op=cdp call was refused but not by NAME: error=' + show(step.cdp.error) + ' does not contain "user-input"')
    }
    if (treated !== true) record('2-user-input-refuses-cdp', null, 'NOT MEASURED: ' + treatmentWhy + ' - this reading is about what the NEXT call gets after the panel has been taken, so an accepted call here says nothing about the rule',
      ['injection=' + show(world.injection === undefined ? null : world.injection), 'treatment=' + show(world.treatment), 'whatTheJudgeWouldHaveSaid=' + show(problems), 'afterInputCdp=' + show(step === null ? null : step.cdp)])
    else record('2-user-input-refuses-cdp', problems.length === 0, problems.length === 0
      ? 'after one user input the next AI op=cdp is refused by name: "' + String(step.cdp.error) + '"'
      : 'FAIL: ' + problems.join(' | '),
      ['injection=' + show(world.injection === undefined ? null : world.injection), 'treatment=' + show(world.treatment), 'afterInputCdp=' + show(step === null ? null : step.cdp)])
  }

  { // 3-user-input-refuses-bounds
    const problems = []
    const step = world.afterInput === null || world.afterInput === undefined ? null : world.afterInput
    if (world.injectionOk !== true) problems.push('no user input landed in the panel page, so nothing about set-bounds was measured')
    if (step === null || step.bounds === null) problems.push('the gate never made the op=set-bounds call that follows the input')
    else {
      if (refused(step.bounds) !== true) problems.push('the AI op=set-bounds call after the user input was ACCEPTED (status ' + String(step.bounds.status) + '), so the AI side can still move the panel')
      else if (step.bounds.namesUserInput !== true) problems.push('the AI op=set-bounds call was refused but not by NAME: error=' + show(step.bounds.error) + ' does not contain "user-input"')
    }
    if (treated !== true) record('3-user-input-refuses-bounds', null, 'NOT MEASURED: ' + treatmentWhy + ' - this reading is about what the NEXT call gets after the panel has been taken, so an accepted call here says nothing about the rule',
      ['treatment=' + show(world.treatment), 'whatTheJudgeWouldHaveSaid=' + show(problems), 'afterInputBounds=' + show(step === null ? null : step.bounds)])
    else record('3-user-input-refuses-bounds', problems.length === 0, problems.length === 0
      ? 'after one user input the next AI op=set-bounds is refused by name: "' + String(step.bounds.error) + '"'
      : 'FAIL: ' + problems.join(' | '),
      ['afterInputBounds=' + show(step === null ? null : step.bounds)])
  }

  { // 4-reclaim-restores-cdp
    const problems = []
    const step = world.afterClaim === null || world.afterClaim === undefined ? null : world.afterClaim
    if (step === null) problems.push('the gate never got to re-claim the lease')
    else {
      if (step.leaseHeld !== true) problems.push('the lease claim was not accepted as held by ' + HOLDER + ': ' + show(step.lease))
      if (step.cdp === null) problems.push('the op=cdp call after the claim is missing')
      else if (step.cdp.ok !== true) problems.push('the op=cdp call after the claim was not accepted: status=' + String(step.cdp.status) + ' error=' + show(step.cdp.error))
    }
    record('4-reclaim-restores-cdp', problems.length === 0, problems.length === 0
      ? 're-claiming the lease gives the AI side the panel back: op=cdp 200 ok after op=lease{claim}'
      : 'FAIL: ' + problems.join(' | '),
      ['lease=' + show(step === null ? null : step.lease), 'afterClaimCdp=' + show(step === null ? null : step.cdp)])
  }

  { // 5-negative-control
    const problems = []
    const before = world.before === null || world.before === undefined ? null : world.before
    const after = world.afterInput === null || world.afterInput === undefined ? null : world.afterInput
    const beforeOk = before !== null && before.cdp !== null && before.cdp.ok === true
    const afterRefused = after !== null && after.cdp !== null && refused(after.cdp) === true
    if (beforeOk !== true) problems.push('the control side is missing: this run never showed the SAME op=cdp call SUCCEEDING with no input in front of it')
    if (afterRefused !== true) problems.push('the treated side is missing: this run never showed the SAME op=cdp call being refused')
    if (beforeOk === true && afterRefused === true) {
      // the paired pattern is the evidence; the call is identical, so the input is the only difference
      if (world.injectionOk !== true) problems.push('the two sides differ but no input was landed in between, so the difference is not attributable')
    }
    if (treated !== true) record('5-negative-control', null, 'NOT MEASURED: ' + treatmentWhy + ' - a paired control needs BOTH sides, and the treated side never happened',
      ['treatment=' + show(world.treatment), 'whatTheJudgeWouldHaveSaid=' + show(problems), 'withoutInput=' + show(before === null ? null : before.cdp), 'withInput=' + show(after === null ? null : after.cdp)])
    else record('5-negative-control', problems.length === 0, problems.length === 0
      ? 'paired contrast: the same op=cdp call succeeded before the input and was refused after it, so the refusal is caused by the input and not by the clock, the process or the world'
      : 'FAIL: ' + problems.join(' | '),
      ['withoutInput=' + show(before === null ? null : before.cdp) + ' (this is the negative control: no input, call succeeds)', 'withInput=' + show(after === null ? null : after.cdp), 'afterReleaseCdp=' + show(world.afterRelease === null || world.afterRelease === undefined ? null : world.afterRelease.cdp)])
  }
  return readings
}

const expectations = () => ({})

// ------------------------------------------------------------------------------------------------- probe
const collect = async () => {
  const started = Date.now()
  const left = () => Math.max(0, 60000 - (Date.now() - started))
  const world = { progress: [], before: null, injection: null, injectionOk: false, afterInput: null, afterClaim: null, afterRelease: null, stateKeys: [] }
  const first = await stateOf()
  if (first.answer.status === 0) { world.noShell = true; return world }
  const see = (state) => { const row = stateOf0(state); if (row.length > 0) world.stateKeys = row }
  const stateOf0 = (state) => state === null || state === undefined ? [] : Object.keys(state).filter((key) => /input|user|takeover/i.test(key))
  const st = first.state
  world.shellUp = true
  world.mountedAtStart = st !== null && st !== undefined && st.mounted === true
  world.existsAtStart = st !== null && st !== undefined && st.exists === true
  world.progress.push('panel at start: exists=' + show(world.existsAtStart) + ' mounted=' + show(world.mountedAtStart) + ' bounds=' + show(st === null || st === undefined ? null : st.bounds) + ' lease=' + show(st === null || st === undefined ? null : st.lease))
  see(st)
  if (world.mountedAtStart !== true || world.existsAtStart !== true) {
    // The pane has to be UP for a user to touch it at all. Mount it with the product own start page and say so.
    const opened = await panelPost({ op: 'open', url: 'http://127.0.0.1:' + PORT + '/__shell/panel-start' })
    world.progress.push('the browser pane was not up, so the gate mounted it itself with op=open: status=' + String(opened.status) + ' error=' + show(opened.body === null ? null : opened.body.error) + ' (the gate does not restart the client)')
    world.openedByGate = true
    const until = Date.now() + Math.min(left(), 12000)
    let seen = await stateOf()
    while (Date.now() < until && (seen.state === null || seen.state === undefined || seen.state.exists !== true)) { await sleep(500); seen = await stateOf() }
    world.existsAtStart = seen.state !== null && seen.state !== undefined && seen.state.exists === true
    world.boundsAtStart = seen.state === null || seen.state === undefined ? null : seen.state.bounds
    see(seen.state)
  } else {
    world.boundsAtStart = st.bounds
  }
  if (world.existsAtStart !== true) { world.noPanel = true; return world }

  // R182-G: WAIT FOR THE PANEL'S OWN DOCUMENT. `exists` is about a webview existing; the TREATMENT this gate
  // measures lives in the document (its reporter beacons the gesture back, core/panel_reporter.js:85-93), and the
  // two arrive about two seconds apart (measured: exists=true at ~1.05s, the page's first report at ~3.1s). A
  // gesture dispatched in between reaches a document with no listener: no beacon, no takeover, and "the call was
  // accepted" would describe a world where the treatment was never applied.
  const countersOf = (state) => state === null || state === undefined ? null : {
    userInputReports: Number(state.userInputReports || 0),
    lastUserInput: state.lastUserInput === undefined ? null : state.lastUserInput,
    revokedBy: state.lease === null || state.lease === undefined ? null : state.lease.revokedBy,
  }
  const pageWaitStarted = Date.now()
  const expectedHref = 'http://127.0.0.1:' + PORT + '/__shell/panel-start'
  let pageReady = null
  while (Date.now() - pageWaitStarted < Math.min(left(), 20000)) {
    const seen = await stateOf()
    const href = seen.state !== null && seen.state !== undefined && seen.state.content !== null && seen.state.content !== undefined ? String(seen.state.content.href) : null
    const reports = seen.state === null || seen.state === undefined ? 0 : Number(seen.state.contentReports || 0)
    if (href !== null && reports > 0) { pageReady = { afterMs: Date.now() - pageWaitStarted, href: href, contentReports: reports, isTheStartPageThisGateOpened: href === expectedHref }; break }
    await sleep(400)
  }
  world.pageReady = pageReady
  world.progress.push(pageReady === null
    ? 'the panel page never reported itself within 20s, so the document a user would touch did not come up'
    : 'the panel page is up and reporting after ' + String(pageReady.afterMs) + 'ms: href=' + show(pageReady.href) + ' contentReports=' + String(pageReady.contentReports) + (pageReady.isTheStartPageThisGateOpened ? '' : ' (NOT the start page this gate asked for, but still the panel document whose reporter carries the gesture)'))
  if (pageReady === null) { world.noPage = true; return world }

  const cdpCall = async (method, params) => answerOf(await panelPost({ op: 'cdp', method: method, params: params, timeoutMs: DEADLINE_MS }))
  const boundsCall = async () => {
    const box = world.boundsAtStart !== null && world.boundsAtStart !== undefined ? world.boundsAtStart : { x: 600, y: 90, w: 420, h: 600 }
    return answerOf(await panelPost({ op: 'set-bounds', x: box.x, y: box.y, w: box.w, h: box.h }))
  }

  // ---- reading 1: the AI side may drive the panel while no input has landed
  world.before = { cdp: await cdpCall('Runtime.evaluate', { expression: 'JSON.stringify({probe:"before-input"})' }), bounds: await boundsCall() }
  world.progress.push('before any input: cdp=' + show(world.before.cdp) + ' set-bounds=' + show(world.before.bounds))

  // ---- the input itself: ONE trusted gesture, injected through the panel protocol
  const gesture = INJECT === 'wheel'
    ? ['Input.dispatchMouseEvent', { type: 'mouseWheel', x: 20, y: 20, deltaX: 0, deltaY: 120 }]
    : INJECT === 'pointer'
      ? ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', buttons: 1, clickCount: 1 }]
      : ['Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 }]
  // The treatment is the panel document's OWN beacon, so it is observed where the shell records it: the
  // userInputReports counter and the lastUserInput name in op=state.
  const beforeCounters = countersOf((await stateOf()).state)
  world.treatment = { before: beforeCounters, observed: false, afterMs: null, after: null }
  // R184-D ruled - and the product now implements - that a gesture injected through op=cdp is the SHELL'S OWN
  // injection rather than the user's hand; that was the defect the round fixed. Driving op=cdp here would leave
  // this gate waiting for a treatment the product deliberately no longer applies to its own injections, which is
  // the named NOT MEASURED the producer flagged rather than a red. The treatment is the panel document's OWN
  // beacon - the channel this file's header already names and R182-G recorded as 'the treatment': a bare report.
  const beaconKind = INJECT === 'wheel' ? 'wheel' : INJECT === 'pointer' ? 'pointerdown' : 'keydown'
  const beacon = await fetch('http://127.0.0.1:' + PORT + '/__shell/panel/report?userInput=' + beaconKind).catch(() => null)
  const injected = beacon === null ? null : { status: beacon.status, kind: beaconKind }
  world.injection = { strategy: INJECT, via: 'report-beacon', kind: beaconKind, answer: injected }
  world.injectionOk = injected !== null && injected.status === 200
  world.progress.push('reported one user input through the panel document own beacon (' + beaconKind + '): ' + show(injected))
  if (world.injectionOk !== true) world.progress.push('the beacon itself was refused: if that refusal names user-input the panel had ALREADY been taken over before this run')
  { // wait for the TREATMENT, and say so when it never arrives
    const until = Date.now() + 6000
    while (Date.now() < until) {
      const now = countersOf((await stateOf()).state)
      world.treatment.after = now
      const moved = now !== null && beforeCounters !== null && (now.userInputReports > beforeCounters.userInputReports || (now.lastUserInput !== null && now.lastUserInput !== beforeCounters.lastUserInput))
      if (moved) { world.treatment.observed = true; world.treatment.afterMs = 6000 - (until - Date.now()); break }
      await sleep(250)
    }
    world.progress.push('the treatment (the panel document reporting a user input) was ' + (world.treatment.observed ? 'OBSERVED after ' + String(world.treatment.afterMs) + 'ms' : 'NEVER OBSERVED within 6s') + ': before=' + show(beforeCounters) + ' after=' + show(world.treatment.after))
  }
  await sleep(700)

  // ---- readings 2 and 3: the NEXT AI call of each kind must be refused by name
  world.afterInput = { cdp: await cdpCall('Runtime.evaluate', { expression: 'JSON.stringify({probe:"after-input"})' }), bounds: await boundsCall() }
  world.progress.push('after the input: cdp=' + show(world.afterInput.cdp) + ' set-bounds=' + show(world.afterInput.bounds))
  const afterState = await stateOf()
  see(afterState.state)

  // ---- reading 4: re-claiming the lease must give the AI side the panel back
  const claimed = await panelPost({ op: 'lease', leaseOp: 'claim', holder: HOLDER, ttlMs: 30000 })
  const lease = claimed.body === null || claimed.body === undefined ? null : claimed.body.lease
  world.afterClaim = {
    lease: lease === undefined ? null : lease,
    leaseHeld: lease !== undefined && lease !== null && lease.held === true && lease.holder === HOLDER,
    cdp: await cdpCall('Runtime.evaluate', { expression: 'JSON.stringify({probe:"after-claim"})' }),
  }
  world.progress.push('after op=lease{claim}: lease=' + show(world.afterClaim.lease) + ' cdp=' + show(world.afterClaim.cdp))

  // ---- reading 5 support: give the lease back and show the AI side is still alive with no NEW input
  await panelPost({ op: 'lease', leaseOp: 'release', holder: HOLDER })
  world.afterRelease = { cdp: await cdpCall('Runtime.evaluate', { expression: 'JSON.stringify({probe:"after-release"})' }) }
  world.progress.push('after op=lease{release}: cdp=' + show(world.afterRelease.cdp))
  world.stateKeys = see((await stateOf()).state) || world.stateKeys
  return world
}

// ------------------------------------------------------------------------------------------- self-attack
const HONEST = () => ({
  kind: 'synthetic', shellUp: true, mountedAtStart: true, existsAtStart: true, injectionOk: true,
  pageReady: { afterMs: 3100, href: 'http://127.0.0.1:31761/__shell/panel-start', contentReports: 4, isTheStartPageThisGateOpened: true },
  treatment: { before: { userInputReports: 4, lastUserInput: null, revokedBy: null }, observed: true, afterMs: 120, after: { userInputReports: 5, lastUserInput: 'keydown', revokedBy: 'user-input' } },
  injection: { strategy: 'keydown', method: 'Input.dispatchKeyEvent', answer: { status: 200, ok: true, error: null, namesUserInput: false } },
  before: { cdp: { status: 200, ok: true, error: null, namesUserInput: false }, bounds: { status: 200, ok: null, error: null, namesUserInput: false } },
  afterInput: {
    cdp: { status: 400, ok: null, error: 'the panel is held by a user-input: re-claim the lease', namesUserInput: true },
    bounds: { status: 400, ok: null, error: 'the panel is held by a user-input: re-claim the lease', namesUserInput: true },
  },
  afterClaim: { lease: { held: true, holder: HOLDER }, leaseHeld: true, cdp: { status: 200, ok: true, error: null, namesUserInput: false } },
  afterRelease: { cdp: { status: 200, ok: true, error: null, namesUserInput: false } },
})

const selfAttack = () => {
  const honest = expectations()
  let failures = 0
  const baseline = judge(HONEST(), honest)
  const baselineRed = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  ' + (baselineRed.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC taken-over world judged honestly is green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (baselineRed.length > 0) failures += 1
  console.log('          (SYNTHETIC, not the app: this exercises the judge, never the probe.)')
  const withAfter = (patch) => ({ ...HONEST(), afterInput: { ...HONEST().afterInput, ...patch } })
  const mutants = [
    { name: 'no takeover at all: the AI calls after the input still succeed', world: withAfter({ cdp: { status: 200, ok: true, error: null, namesUserInput: false }, bounds: { status: 200, ok: null, error: null, namesUserInput: false } }), mustRedden: ['2-user-input-refuses-cdp', '3-user-input-refuses-bounds', '5-negative-control'] },
    { name: 'refused, but not by name (no user-input in the text)', world: withAfter({ cdp: { status: 400, ok: null, error: 'the panel is busy', namesUserInput: false }, bounds: { status: 400, ok: null, error: 'the panel is busy', namesUserInput: false } }), mustRedden: ['2-user-input-refuses-cdp', '3-user-input-refuses-bounds'] },
    { name: 'only op=cdp is refused, set-bounds still moves the panel', world: withAfter({ bounds: { status: 200, ok: null, error: null, namesUserInput: false } }), mustRedden: ['3-user-input-refuses-bounds'] },
    { name: 'an unconditional refusal: the panel refuses BEFORE any input too', world: { ...HONEST(), before: { cdp: { status: 400, ok: null, error: 'the panel is held by a user-input', namesUserInput: true }, bounds: { status: 400, ok: null, error: 'the panel is held by a user-input', namesUserInput: true } } }, mustRedden: ['1-baseline-ai-calls-ok', '5-negative-control'] },
    { name: 're-claiming the lease does not give the panel back', world: { ...HONEST(), afterClaim: { lease: { held: true, holder: HOLDER }, leaseHeld: true, cdp: { status: 400, ok: null, error: 'the panel is held by a user-input', namesUserInput: true } } }, mustRedden: ['4-reclaim-restores-cdp'] },
    // with no input landed, the paired control has nothing to contrast either: measured [2,3,5], declared so
    { name: 'no input ever landed in the page', world: { ...HONEST(), injectionOk: false, injection: { strategy: 'keydown', method: 'Input.dispatchKeyEvent', answer: { status: 400, ok: null, error: 'no webview is up', namesUserInput: false } }, treatment: { before: { userInputReports: 4, lastUserInput: null, revokedBy: null }, observed: false, afterMs: null, after: { userInputReports: 4, lastUserInput: null, revokedBy: null } } }, mustRedden: [], mustBeUnmeasured: ['2-user-input-refuses-cdp', '3-user-input-refuses-bounds', '5-negative-control'] },
    // R182-G: THE arm this round added - the gesture is accepted by the protocol but the panel document never
    // reports it, so the treatment was not applied and no product verdict may be claimed from an accepted call.
    { name: 'the gesture was accepted but the panel document never reported it (the treatment was not applied)', world: { ...HONEST(), treatment: { before: { userInputReports: 4, lastUserInput: null, revokedBy: null }, observed: false, afterMs: null, after: { userInputReports: 4, lastUserInput: null, revokedBy: null } } }, mustRedden: [], mustBeUnmeasured: ['2-user-input-refuses-cdp', '3-user-input-refuses-bounds', '5-negative-control'] },
  ]
  for (const mutant of mutants) {
    const judged = judge(mutant.world, mutant.expect === undefined ? honest : mutant.expect)
    const seen = judged.filter((reading) => reading.ok === false).map((reading) => reading.id)
    const unseen = judged.filter((reading) => reading.ok === null).map((reading) => reading.id)
    const declaredUn = mutant.mustBeUnmeasured === undefined ? [] : mutant.mustBeUnmeasured
    const preciseRed = seen.length === mutant.mustRedden.length && mutant.mustRedden.every((id) => seen.includes(id))
    const preciseUn = unseen.length === declaredUn.length && declaredUn.every((id) => unseen.includes(id))
    const precise = preciseRed && preciseUn
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(seen) + ' declared=' + show(mutant.mustRedden) + ' notMeasured=' + show(unseen) + ' declaredNotMeasured=' + show(declaredUn))
  }
  console.log('  note the live probe was NOT exercised in this mode: --self-attack attacks the judge only.')
  return failures === 0 ? 0 : 1
}

const main = async () => {
  if (SELF_ATTACK) return selfAttack()
  let world
  try { world = await collect() }
  catch (error) {
    console.log('  FAIL  collect(): the probe itself failed before collecting (a GATE bug, not a data verdict)')
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    return 1
  }
  if (world.noShell === true) { console.log('SKIP: no shell answered on 127.0.0.1:' + String(PORT) + '/__shell/panel, so the user-input takeover measured NOTHING'); return 3 }
  if (world.noPanel === true) { console.log('SKIP: the shell holds no panel and op=open did not raise one, so there is no page a user could touch; this gate measured NOTHING'); return 3 }
  if (world.noPage === true) { console.log('SKIP: the panel exists but its own document never reported itself within 20s (op=state content/contentReports), so there is no document in which a user input could take the panel; this gate measured NOTHING'); return 3 }
  const readings = judge(world, expectations())
  console.log('  shell 127.0.0.1:' + String(PORT) + ' | panel exists=' + show(world.existsAtStart) + ' mounted at start=' + show(world.mountedAtStart) + (world.openedByGate === true ? ' (the GATE mounted it with op=open)' : '') + ' | injection=' + INJECT)
  for (const line of world.progress) console.log('        ' + line)
  if (world.stateKeys.length > 0) console.log('        panel state keys mentioning input/user: ' + world.stateKeys.join(','))
  for (const reading of readings) {
    console.log('  ' + (reading.ok === true ? 'ok  ' : reading.ok === null ? 'n/a ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const unmeasured = readings.filter((reading) => reading.ok === null)
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed' + (unmeasured.length > 0 ? ', ' + String(unmeasured.length) + ' not measured in this world' : ''))
  if (unmeasured.length > 0) { console.log('SKIP: ' + String(unmeasured.length) + ' of ' + String(readings.length) + ' readings could not be measured here (' + unmeasured.map((reading) => reading.id).join(', ') + '); each names what was missing - whenever the TREATMENT was never applied, the accepted call behind it is not a product verdict'); return 3 }
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()
