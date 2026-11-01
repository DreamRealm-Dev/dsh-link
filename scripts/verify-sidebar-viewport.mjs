#!/usr/bin/env node
/**
 * Gate (R179-B) - the sidebar browser's VIEWPORT, its virtual-screen geometry, the shell page's own
 * controls as USER INPUT, and the tab boundary.
 *
 * Subject: POST /__shell/panel (proxy.rs dispatch) plus the chrome page the shell serves
 * (src-tauri/src/core/browser_ui.html). Written from the contract only, by somebody who did not write the
 * product side, and expected to be RED until that work lands.
 *
 * Six readings, each able to fail on its own:
 *   1-resolution-changed        op=viewport takes 1920x1080, the PAGE ITSELF says innerWidth x innerHeight =
 *                               1920x1080 (asked through op=cdp Runtime.evaluate, not read off the shell's
 *                               memory), op=state reports the same viewport with modeApplied, and the shell's
 *                               own numbers agree: scale ~= screenPane.w / 1920
 *   2-preset-and-named-refusal  a PRESET applies (the gate resets to 1280x800 first, so the change is
 *                               observable), and an unusable resolution - zero, a negative, one that is not a
 *                               number at all - is REFUSED BY NAME while viewport and modeApplied stay put
 *   3-vm-preview-geometry       the preview screen (screenPane) sits INSIDE the bay (bayPane), centred on
 *                               both axes, with the viewport's aspect ratio, and the letterbox is real: bay
 *                               minus screen > 2px on the letterbox axis. It must also be as large as it
 *                               fits (area >= 90% of the best fit), or "letterbox" would hide a tiny screen
 *   4-persisted-across-remount  the chosen resolution survives op=unmount -> op=mount: the state still
 *                               reports 1920x1080 AND the NEW page (a fresh renderer) reports it again.
 *                               WHAT THIS DOES NOT PROVE, stated rather than implied: this is an in-process
 *                               remount, NOT a client-process restart, so it does NOT prove the value reached
 *                               the disk. The cost of the cheap form: a restart takes ~30s of a 60s budget
 *                               and moves the world for every other gate in the suite, and the client's
 *                               lifecycle belongs to the shell's producer - this gate never starts or stops
 *                               or rebuilds the client.
 *   5-shell-control-is-USER-INPUT  a REAL mouse click on the shell page's own resolution control, dispatched
 *                               through op=cdp {tab:"chrome"} + Input.dispatchMouseEvent and judged AFTER the
 *                               click has COMPLETED. The takeover is caused by the control's OWN write, so
 *                               reading it at the pointerdown would be reading the wrong moment (before R179-A
 *                               the shell page's reporter reported that pointerdown, the lease was revoked by
 *                               a page-side event, and the gate's own mouseup came back 400: the click never
 *                               finished). The gate holds the lease, sends the WHOLE gesture (moved/pressed/
 *                               released, every half accepted under the gate's own lease), and then requires:
 *                                 A  the lease comes back TAKEN, and the record names the CONTROL rather than
 *                                    merely the person: held=false, revokedBy="user-input", revokedHolder=this
 *                                    gate, revokedKind starting with "shell-control", and userInputReports +1
 *                                    - the click's own op is the ONE new input the shell counted between the
 *                                    two state reads. A page-side event name is NOT accepted here, and a
 *                                    MISSING revokedKind is a NAMED FAILURE, never a silent skip.
 *                                 B  the viewport moves V0 -> the preset the control's OWN TITLE names as the
 *                                    next one (its title says "next preset <WxH>"), and the PAGE reports the
 *                                    new innerWidth x innerHeight itself.
 *                                 C  the paired control: the SAME op=cdp WITHOUT a holder is REFUSED by name
 *                                    right after the click (the refusal mentions user-input) and is 200 again
 *                                    once the gate claims the panel back.
 *                                 D  the NEGATIVE CONTROL, with no click anywhere: a bare beacon
 *                                    GET /__shell/panel/report?userInput=<fabricated> produces the SAME
 *                                    revokedBy="user-input" / revokedHolder=this gate reading. Written here on
 *                                    purpose, because that is the honest limit of this reading: revokedBy
 *                                    alone CANNOT tell "somebody clicked a control" from "somebody fabricated a
 *                                    request". Only revokedKind ("shell-control:*") attributes the takeover to
 *                                    a control, which is why the assertion is on the kind and not on the
 *                                    pointerdown. The same beacon is also what makes the click a NEW input: the
 *                                    shell counts a repeated identical kind as the SAME user input (measured),
 *                                    so a leftover "shell-control:viewport" from an earlier run would silently
 *                                    swallow the click's takeover.
 *                               A gate that only ever sees refusals cannot tell "the user's click is an input"
 *                               from "the panel is wedged"; the pair is what makes the difference attributable.
 *   6-tab-boundary              the tab cap is a NAMED boundary: at the cap the next op=tab-new is refused by
 *                               name (the error names the limit), the count does not move, the shell page's
 *                               own + button is disabled, and every tab pill stays inside the chrome bar's
 *                               own box. The gate closes the tabs it opened and puts the active tab back.
 *
 * Instrument, stated rather than assumed:
 *   - The gate OWNS the panel (R153): claim the lease, raise the browser with op=open, place it with
 *     op=set-bounds at its OWN rectangle (900,120 640x600), so the bay it judges is one it chose. While the
 *     lease is held the page host stands down (panel_host.js), which is what keeps the bay stable.
 *   - The click's coordinates are DERIVED, not copied: factor = chromePane.w / the chrome page's own
 *     innerWidth. R178-G section 8's "page CSS x scale" is the CONTENT page's rule, because that page runs
 *     under a device-metrics override that has scale; the chrome page has no override, so its CSS px are the
 *     shell's logical px and the factor is 1 there. The derived factor is right in both worlds, and the two
 *     numbers it came from are printed.
 *   - The click is dispatched WHOLE (mousePressed then mouseReleased, both under the gate's own lease) and the
 *     takeover is read AFTERWARDS: that is when the causal order is visible, and it is what the shell now does.
 *     Until R179-A the shell page's own reporter reported the pointerdown as a page-side input, the lease was
 *     revoked before the control's op could run, and the gate measured its own mouseup coming back 400
 *     ("REVOKED by user-input (pointerdown)"): the click never completed. The shell page now reports no input
 *     events (everything there sends an op of its own), so press and release are ordinary writes.
 *   - The click is STAGED so that it is a new user input, and that is measured rather than assumed: the shell
 *     counts a repeated identical kind as the SAME input (sidebar_panel.rs note_shell_control), so a leftover
 *     "shell-control:viewport" from an earlier run would silently swallow this click's takeover (measured on
 *     the live client). The negative control's beacon - a fabricated kind - clears that state, and reading 5
 *     requires userInputReports +1 between the two state reads, so "the click was the new input" is a reading
 *     rather than a hope.
 *   - The bay/screen fields may arrive in either unit. When they do not say which, the gate resolves the
 *     unit against the chrome pane the shell already reports in logical px, and reading 1 accepts the scale
 *     relation under either hypothesis (printed). Reading 3 is unit-free by construction.
 *   - No CDP on 9222, or no shell answering, means SKIP (exit 3) with the reason - never a silent green.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when nothing could be measured.
 *
 * Usage: node scripts/verify-sidebar-viewport.mjs [--port 31761] [--cdp-port 9222] [--budget-ms 55000]
 *        [--holder gate-r179-viewport-<pid>] [--self-attack]
 *        The holder defaults to a PER-PROCESS name (see the instrument notes) so two runs of this gate cannot
 *        delete each other's takeover record; --holder overrides it.
 */
import { claimLease, releaseLease } from './panel-lease.mjs'

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const PORT = Number(option('--port', '31761'))
const CDP_PORT = Number(option('--cdp-port', '9222'))
const BUDGET_MS = Number(option('--budget-ms', '55000'))
/* The holder name is THIS PROCESS'S OWN, and that is a measured instrument decision rather than a taste:
 * two instances of this gate sharing one name cannot measure the same turn. The shell's claim is a FRESH TURN
 * (it clears the revocation record), so a second instance claiming the same name erases exactly the takeover
 * the first instance is about to read - measured on the live client (15:5x): the click DID take the lease and
 * increment the counter, and 1 s later a concurrent run under the same name left held=true / revokedBy=null /
 * revokedKind=null behind it, which read as "the click was not user input" when it had been. With a per-process
 * name, two gates on one panel can only get in each other's way by HOLDING the lease - which the start of this
 * gate already reports as a named SKIP. */
const HOLDER = String(option('--holder', 'gate-r179-viewport-' + String(process.pid)))
const SELF_ATTACK = has('--self-attack')

const TARGET = { w: 1920, h: 1080 }
const RESET = { w: 1280, h: 800 }
const BOX = { x: 900, y: 120, w: 640, h: 600 }
const LEASE_TTL_MS = 180000
/* Tolerances, all of them here so a failure can be read against a number rather than a feeling. */
const TOL = { rect: 2, centre: 2, aspectRel: 0.01, scaleRel: 0.005, scaleAbs: 0.002, areaRatio: 0.90 }
const SLACK_MIN = 2

const show = (value) => JSON.stringify(value === undefined ? null : value)
const round = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null
const sleep = (ms) => new Promise((done) => setTimeout(done, Math.max(0, ms)))
const NAMED_RESOLUTION = /positive|finite|numeric|number|width|height|resolution|\u5206\u8fa8\u7387|\u5c3a\u5bf8/i
const NAMED_LIMIT = /\blimit\b|\u4e0a\u9650|\bcap\b|not opening/i
const UNKNOWN_OP = /unknown panel op/i

// --------------------------------------------------------------------------------------------- the wire
const panelPost = async (payload) => {
  const answer = await fetch('http://127.0.0.1:' + PORT + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return { status: 0, body: null, text: '' }
  const text = await answer.text().catch(() => '')
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = null }
  return { status: answer.status, body: body, text: text }
}
const answerOf = (answer) => ({
  status: answer === null || answer === undefined ? 0 : answer.status,
  ok: answer === null || answer === undefined || answer.body === null || answer.body.ok === undefined ? null : answer.body.ok === true,
  error: answer === null || answer === undefined || answer.body === null || answer.body.error === undefined ? null : answer.body.error,
  unknownOp: UNKNOWN_OP.test(String(answer === null || answer === undefined || answer.body === null ? '' : answer.body.error)),
})
const refused = (record) => record !== null && record !== undefined && (record.status !== 200 || record.error !== null)
/** A record for the evidence lines: null-safe, because a gate bug must not hide the world it collected. */
const answerBrief = (record) => record === null || record === undefined ? null : { status: record.status === undefined ? null : record.status, error: record.error === undefined ? null : record.error }
const namesUserInput = (text) => /user-input/i.test(String(text === null || text === undefined ? '' : text))

/** op=state answers with the flat report; every other op nests it under "state". One reader for both. */
const stateOf = async () => {
  const answer = await panelPost({ op: 'state' })
  const body = answer.body
  const state = body !== null && body !== undefined && body.state !== undefined && body.state !== null ? body.state : body
  return { answer: answer, state: state }
}

/* ------------------------------------------------------------------------------------ the world reset
 * R180: every reading below STAGES the world it needs and WITNESSES the staging, because the panel is one
 * shared singleton and a previous run of this same gate is part of this world. Measured on the live client
 * (R179): the shell SWALLOWS a write whose kind equals the last recorded input (sidebar_panel.rs
 * note_shell_control), and op=lease{claim} CLEARS that record as well as the revocation - so a leftover
 * "shell-control:*" from an earlier run, or a claim landing inside this gate's own click window, moves the
 * ground under reading 5 while nothing about the product changed.
 *
 * Nothing here reaches into the shell's memory: every step is an op the contract already has, and every step
 * is READ BACK. What the gate stages, it prints; what it cannot stage, it names as NOT MEASURED rather than
 * letting a reading pass or fail on a world it did not establish. What CANNOT be staged is stated, not
 * implied: userInputReports is a monotonic per-process counter, so it can never be put back; only the
 * lastUserInput MARKER can, and only through the contract's own beacon channel. */

/** The slice of op=state that reading 5's preconditions are about: the input marker and its counter, plus
 * the lease, in one envelope, so every before/after pair in the evidence comes from ONE read. */
const inputWitnessOf = (state) => state === null || state === undefined ? null : {
  lastUserInput: state.lastUserInput === undefined ? null : state.lastUserInput,
  userInputReports: state.userInputReports === undefined ? null : state.userInputReports,
  lease: state.lease === undefined ? null : state.lease,
}

/** One precondition, as the judge sees it: what it was for, whether the gate got it, and BOTH readings. */
const preconditionOf = (id, what, ok, before, after, detail) => ({
  id: id, what: what, ok: ok === true, before: before === undefined ? null : before,
  after: after === undefined ? null : after, detail: detail === undefined ? null : detail,
})

/** ONE bare beacon GET on the channel the panel's reporter uses - the contract's own way to record an input
 * with no click, which is what the fabricated-kind stage and the negative control both use. */
const beacon = async (kind) => {
  const status = await fetch('http://127.0.0.1:' + PORT + '/__shell/panel/report?userInput=' + encodeURIComponent(kind) + '&at=' + String(Date.now()), { signal: AbortSignal.timeout(4000) }).then((answer) => answer.status).catch(() => 0)
  return { kind: kind, status: status, query: 'userInput=' + kind }
}

/** Poll op=state until the viewport is the one the next reading needs. Returns the first and the last
 * reading it saw, so "the world would not settle" is printed with the numbers that say so. */
const settleViewport = async (pair, attempts, waitMs) => {
  const first = (await stateOf()).state
  let last = first
  let tries = 0
  const wanted = (state) => state !== null && state !== undefined && state.viewport !== undefined && state.viewport !== null && Number(state.viewport.w) === pair.w && Number(state.viewport.h) === pair.h
  while (tries < attempts && wanted(last) !== true) { tries += 1; await sleep(waitMs); last = (await stateOf()).state }
  return { settled: wanted(last) === true, tries: tries, first: stateBrief(first), last: stateBrief(last) }
}

/** op=cdp Runtime.evaluate. withHolder:false is the outside caller of reading 5's paired control. */
const cdpEval = async (tab, expression, withHolder = true) => {
  const payload = { op: 'cdp', method: 'Runtime.evaluate', params: { expression: expression, returnByValue: true }, timeoutMs: 12000 }
  if (tab !== null && tab !== undefined) payload.tab = tab
  if (withHolder === true) payload.holder = HOLDER
  const answer = await panelPost(payload)
  const record = answerOf(answer)
  let value = null
  if (record.ok === true && answer.body !== null && typeof answer.body.cdp === 'string') {
    try { const parsed = JSON.parse(answer.body.cdp); value = parsed !== null && parsed.result !== undefined ? parsed.result.value : null } catch (error) { value = null }
  }
  const decoded = typeof value !== 'string' ? value : (() => { try { return JSON.parse(value) } catch (error) { return value } })()
  return { status: record.status, ok: record.ok, error: record.error, value: decoded, raw: answer.body === null ? null : String(answer.body.cdp === undefined ? '' : answer.body.cdp).slice(0, 180) }
}

const PAGE_EXPRESSION = 'JSON.stringify({iw:Math.round(window.innerWidth),ih:Math.round(window.innerHeight),dpr:window.devicePixelRatio,url:location.href})'
const readPage = async (withHolder = true) => {
  const answer = await cdpEval(null, PAGE_EXPRESSION, withHolder)
  const page = answer.value !== null && typeof answer.value === 'object' ? answer.value : null
  return { status: answer.status, ok: answer.ok, error: answer.error, value: answer.value, page: page }
}

/* The chrome page's own DOM, asked of the page. A real function shipped through toString(): the page only
 * runs it, the judge reads its numbers. Attributes are folded into the searchable words on purpose: a preset
 * named in data-preset / data-resolution / title is as good as one named in the label. */
function chromeProbe() {
  const quad = (element) => { const box = element.getBoundingClientRect(); return { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10, w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 } }
  const words = (element) => {
    const parts = [String(element.textContent || ''), String(element.getAttribute('title') || ''), String(element.getAttribute('aria-label') || '')]
    const attributes = element.attributes || []
    for (let index = 0; index < attributes.length; index += 1) { parts.push(String(attributes[index].name) + '=' + String(attributes[index].value)) }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  }
  const nodes = document.querySelectorAll('button,[role="button"],select,input,label,option,[data-preset],[data-resolution],[data-viewport],[data-size]')
  const controls = []
  for (let index = 0; index < nodes.length; index += 1) {
    const element = nodes[index]
    const box = quad(element)
    controls.push({ tag: String(element.tagName || '').toLowerCase(), id: String(element.id || ''), title: String(element.getAttribute('title') || ''), words: words(element), rect: box, disabled: element.disabled === true, visible: box.w > 0 && box.h > 0 })
  }
  const bar = document.getElementById('bar')
  const pills = []
  const pillNodes = document.querySelectorAll('.tab')
  for (let index = 0; index < pillNodes.length; index += 1) { pills.push(quad(pillNodes[index])) }
  const plus = document.getElementById('new')
  return JSON.stringify({
    url: location.href,
    innerW: Math.round(window.innerWidth), innerH: Math.round(window.innerHeight), dpr: window.devicePixelRatio,
    bar: bar === null ? null : quad(bar),
    pills: pills,
    plusDisabled: plus === null ? null : plus.disabled === true,
    controls: controls,
    readings: globalThis.__DSH_BROWSER !== undefined && typeof globalThis.__DSH_BROWSER.readings === 'function' ? globalThis.__DSH_BROWSER.readings() : null,
  })
}
const CHROME_EXPRESSION = '(' + chromeProbe.toString() + ')()'
const readChrome = async () => {
  const answer = await cdpEval('chrome', CHROME_EXPRESSION)
  const chrome = answer.value !== null && typeof answer.value === 'object' ? answer.value : null
  return { status: answer.status, ok: answer.ok, error: answer.error, value: answer.value, chrome: chrome }
}

// ------------------------------------------------------------------------------------------ the judge
const asQuad = (value) => value === null || value === undefined || typeof value !== 'object' ? null : (typeof value.w === 'number' && typeof value.h === 'number' ? value : null)
/** A quad, in the shell's logical units when it says which it is; otherwise untouched and labelled. */
const normQuad = (value, factor) => {
  const raw = asQuad(value)
  if (raw === null) return null
  const numbers = [Number(raw.x), Number(raw.y), Number(raw.w), Number(raw.h)]
  for (const number of numbers) { if (Number.isFinite(number) === false) return null }
  if (raw.units === 'physical') return { x: numbers[0] / factor, y: numbers[1] / factor, w: numbers[2] / factor, h: numbers[3] / factor, units: 'physical/divided by ' + String(factor) }
  if (raw.units === 'logical') return { x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3], units: 'logical' }
  return { x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3], units: 'undeclared' }
}
const brief = (quad) => quad === null || quad === undefined ? null : { x: round(quad.x), y: round(quad.y), w: round(quad.w), h: round(quad.h) }
const box = (value) => brief(asQuad(value))
const stateBrief = (state) => state === null || state === undefined ? null : {
  viewport: state.viewport === undefined ? null : state.viewport,
  mode: state.mode === undefined ? null : state.mode,
  modeApplied: state.modeApplied === undefined ? null : state.modeApplied,
  scale: state.scale === undefined ? null : state.scale,
  bayPane: box(state.bayPane), screenPane: box(state.screenPane),
  count: state.count === undefined ? null : state.count,
  limit: state.limit === undefined ? null : state.limit,
  mounted: state.mounted === undefined ? null : state.mounted,
  revokedBy: state.lease === undefined || state.lease === null ? null : state.lease.revokedBy,
}
const sameNumbers = (left, right) => left === null || right === null || left === undefined || right === undefined ? false : Number(left.w) === Number(right.w) && Number(left.h) === Number(right.h)
const expects = () => ({ target: { w: TARGET.w, h: TARGET.h }, reset: { w: RESET.w, h: RESET.h } })

const judge = (world, expect) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id: id, ok: ok === true, detail: String(detail), evidence: evidence || [] })
  /* R180: the preconditions the probe staged and WITNESSED for a reading. A reading whose world could not be
   * established is reported as NOT MEASURED (never as a green, never as a product verdict): the evidence lines
   * still print the before/after readings, so the state of the WORLD is auditable in the log. */
  const unstaged = (prefix) => (world.preconditions === undefined || world.preconditions === null ? [] : world.preconditions).filter((row) => row.id !== null && row.id !== undefined && String(row.id).indexOf(prefix) === 0 && row.ok !== true)
  const target = expect.target
  const factor = typeof world.factor === 'number' && world.factor > 0 ? world.factor : 1
  const unmetLine = (prefix) => {
    const rows = unstaged(prefix)
    return 'NOT MEASURED: the world this reading needs was not established: ' + rows.map((row) => row.id + ' (' + String(row.what).slice(0, 90) + ') before=' + show(row.before) + ' after=' + show(row.after)).join(' | ')
  }
  const unstagedDetail = (prefix) => unstaged(prefix).map((row) => 'precondition ' + String(row.id) + ' was NOT established: ' + String(row.detail === null || row.detail === undefined ? String(row.what) : row.detail) + ' (before=' + show(row.before) + ' after=' + show(row.after) + ')')

  { // 1-resolution-changed
    const problems = []
    const step = world.changed === null || world.changed === undefined ? null : world.changed
    if (step === null) problems.push('NOT MEASURED: the gate never got to ask for a resolution change')
    else if (unstaged('1-').length > 0) problems.push(unmetLine('1-'))
    else {
      if (step.accepted === null || step.accepted === undefined) problems.push('no op=viewport shape was accepted (' + show(step.shapes) + ')')
      const after = step.after === null || step.after === undefined ? null : step.after
      const before = step.before === null || step.before === undefined ? null : step.before
      if (after === null) problems.push('the gate never read the state after the change')
      else {
        const afterState = after.state === null || after.state === undefined ? null : after.state
        if (sameNumbers(afterState === null ? null : afterState.viewport, target) === false) problems.push('op=state does not report the viewport that was asked for: ' + show(afterState === null ? null : afterState.viewport) + ' (wanted ' + show(target) + ')')
        if (afterState !== null && afterState.modeApplied !== true) problems.push('modeApplied is ' + show(afterState.modeApplied === undefined ? null : afterState.modeApplied) + ': the shell did not report the viewport as applied')
        const page = after.page === null || after.page === undefined ? null : after.page.page
        if (page === null) problems.push('the page was never asked what size it is (op=cdp Runtime.evaluate answered ' + show(after.page === null || after.page === undefined ? null : after.page) + ')')
        else if (page.iw !== target.w || page.ih !== target.h) problems.push('the PAGE says it is ' + page.iw + 'x' + page.ih + ', not ' + target.w + 'x' + target.h + ': the shell reported a viewport the page never took')
        if (before !== null && before.page !== null && before.page !== undefined && before.page.page !== null && before.page.page !== undefined && before.page.page.iw === target.w && before.page.page.ih === target.h) problems.push('the page already reported ' + target.w + 'x' + target.h + ' BEFORE the change, so this world cannot show the change happened here')
        const screen = afterState === null ? null : normQuad(afterState.screenPane === undefined ? null : afterState.screenPane, factor)
        const scale = afterState === null || afterState.scale === undefined ? null : afterState.scale
        if (screen === null) problems.push('op=state reports no screenPane, so scale and the screen cannot be checked against each other')
        else if (typeof scale !== 'number' || Number.isFinite(scale) === false || scale <= 0) problems.push('op=state reports scale ' + show(scale) + ' in fixed mode, so the relation cannot be checked')
        else {
          const hypotheses = [
            { label: 'screen as reported', value: screen.w / target.w },
            { label: 'screen is physical', value: (screen.w / factor) / target.w },
            { label: 'screen is logical', value: (screen.w * factor) / target.w },
          ]
          const holding = hypotheses.filter((row) => Math.abs(row.value - scale) <= Math.max(TOL.scaleAbs, scale * TOL.scaleRel))
          if (holding.length === 0) problems.push('scale ' + show(scale) + ' is not screenW/' + target.w + ' under any unit: ' + show(hypotheses.map((row) => row.label + '=' + round(row.value))))
        }
      }
    }
    record('1-resolution-changed', problems.length === 0, problems.length === 0
      ? 'op=viewport ' + target.w + 'x' + target.h + ' took: the page reports ' + target.w + 'x' + target.h + ', op=state reports it with modeApplied, and scale agrees with screenPane.w/' + target.w
      : 'FAIL: ' + problems.join(' | '),
      ['acceptedShape=' + show(step === null ? null : step.accepted), 'shapesTried=' + show(step === null ? null : step.shapes),
        'beforePage=' + show(step === null || step.before === null || step.before === undefined ? null : step.before.page),
        'afterState=' + show(stateBrief(step === null || step.after === null || step.after === undefined ? null : step.after.state)),
        'afterPage=' + show(step === null || step.after === null || step.after === undefined ? null : step.after.page)])
  }

  { // 2-preset-and-named-refusal
    const problems = []
    const step = world.preset === null || world.preset === undefined ? null : world.preset
    if (step === null) problems.push('NOT MEASURED: the gate never got to apply a preset')
    else if (unstaged('2-').length > 0) problems.push(unmetLine('2-'))
    else {
      const beforeState = step.before === null || step.before === undefined || step.before.state === null || step.before.state === undefined ? null : step.before.state
      if (sameNumbers(beforeState === null ? null : beforeState.viewport, expect.reset) !== true) problems.push('the gate could not return the viewport to ' + show(expect.reset) + ' first, so a preset effect is not observable (state says ' + show(beforeState === null ? null : beforeState.viewport) + ')')
      if (step.accepted === null || step.accepted === undefined) problems.push('no preset shape was accepted (' + show(step.shapes) + ')')
      const after = step.after === null || step.after === undefined ? null : step.after
      if (after === null) problems.push('the gate never read the state after the preset')
      else {
        const afterState = after.state === null || after.state === undefined ? null : after.state
        if (sameNumbers(afterState === null ? null : afterState.viewport, target) === false) problems.push('the preset did not land on ' + show(target) + ': op=state says ' + show(afterState === null ? null : afterState.viewport))
        const page = after.page === null || after.page === undefined ? null : after.page.page
        if (page === null || page.iw !== target.w || page.ih !== target.h) problems.push('the page does not report the preset either: ' + show(page === null ? null : { iw: page.iw, ih: page.ih }))
      }
      const illegal = step.illegal === undefined || step.illegal === null ? [] : step.illegal
      if (illegal.length < 3) problems.push('the gate did not get to try the three unusable resolutions (' + String(illegal.length) + ' of 3)')
      const names = step.names === undefined || step.names === null ? null : step.names
      if (names !== null && typeof step.acceptedName === 'string') {
        if (names.indexOf(step.acceptedName) < 0) problems.push('the preset the gate applied is not one of the presets op=state declares: ' + show(step.acceptedName) + ' not in ' + show(names))
        const reported = after === null || after.state === null || after.state === undefined ? null : after.state.viewportPreset
        if (reported !== step.acceptedName) problems.push('after applying it op=state reports viewportPreset=' + show(reported) + ' instead of ' + show(step.acceptedName))
      }
      for (const attempt of illegal) {
        const answer = attempt.record === undefined ? null : attempt.record
        if (refused(answer) !== true) problems.push('the ' + attempt.label + ' resolution was ACCEPTED (status ' + String(answer === null ? 'no answer' : answer.status) + '): an unusable resolution must not reach the page')
        else if (NAMED_RESOLUTION.test(String(answer.error)) === false) problems.push('the ' + attempt.label + ' resolution was refused but not BY NAME: ' + show(answer.error))
        const seen = attempt.state === null || attempt.state === undefined ? null : attempt.state
        if (seen !== null) {
          if (sameNumbers(seen.viewport, target) !== true) problems.push('the ' + attempt.label + ' refusal moved the viewport to ' + show(seen.viewport))
          if (seen.modeApplied !== true) problems.push('the ' + attempt.label + ' refusal left modeApplied at ' + show(seen.modeApplied))
        }
      }
    }
    record('2-preset-and-named-refusal', problems.length === 0, problems.length === 0
      ? 'the preset lands on ' + target.w + 'x' + target.h + ' and all three unusable resolutions (zero, negative, not-a-number) are refused by name with viewport and modeApplied untouched'
      : 'FAIL: ' + problems.join(' | '),
      ['presetShapes=' + show(step === null ? null : step.shapes), 'presetAccepted=' + show(step === null ? null : step.accepted),
        'presetState=' + show(stateBrief(step === null || step.after === null || step.after === undefined ? null : step.after.state)),
        'illegal=' + show(step === null || step.illegal === undefined ? null : step.illegal.map((attempt) => attempt.label + ' -> ' + String(attempt.record === null || attempt.record === undefined ? 'no answer' : attempt.record.status) + ' ' + show(attempt.record === null || attempt.record === undefined ? null : attempt.record.error) + ' viewport=' + show(attempt.state === null || attempt.state === undefined ? null : attempt.state.viewport)))])
  }

  { // 3-vm-preview-geometry
    const problems = []
    const step = world.geometry === null || world.geometry === undefined ? null : world.geometry
    const bay = step === null ? null : normQuad(step.bay, factor)
    const screen = step === null ? null : normQuad(step.screen, factor)
    const viewport = step === null || step.viewport === null || step.viewport === undefined ? null : step.viewport
    if (step === null || asQuad(step.bay) === null || asQuad(step.screen) === null) {
      problems.push('op=state reports no usable bayPane/screenPane pair: ' + show(step === null ? null : { bayPane: step.bay, screenPane: step.screen }))
    } else if (unstaged('3-').length > 0) {
      problems.push(unmetLine('3-'))
    } else {
      if (viewport === null) problems.push('the viewport the screen should match is not known')
      const inside = {
        left: round(screen.x - bay.x), top: round(screen.y - bay.y),
        right: round((bay.x + bay.w) - (screen.x + screen.w)), bottom: round((bay.y + bay.h) - (screen.y + screen.h)),
      }
      for (const side of ['left', 'top', 'right', 'bottom']) { if (inside[side] < -TOL.rect) problems.push('the screen leaves the bay on its ' + side + ' by ' + String(inside[side]) + 'px') }
      const centring = { x: round(inside.left - inside.right), y: round(inside.top - inside.bottom) }
      if (Math.abs(centring.x) > TOL.centre) problems.push('the screen is not centred across the bay: left-right=' + String(centring.x) + 'px (tolerance ' + TOL.centre + ')')
      if (Math.abs(centring.y) > TOL.centre) problems.push('the screen is not centred down the bay: top-bottom=' + String(centring.y) + 'px (tolerance ' + TOL.centre + ')')
      if (viewport !== null) {
        const wanted = viewport.w / viewport.h
        const got = screen.w / screen.h
        const relative = Math.abs(got - wanted) / wanted
        if (Number.isFinite(relative) === false || relative > TOL.aspectRel) problems.push('the screen is ' + round(got) + ':1 while the viewport is ' + round(wanted) + ':1 (relative error ' + round(relative) + ' > ' + TOL.aspectRel + ')')
        const slackX = round(bay.w - screen.w)
        const slackY = round(bay.h - screen.h)
        if (slackX <= SLACK_MIN && slackY <= SLACK_MIN) problems.push('there is no letterbox at all: the bay and the screen differ by ' + String(slackX) + 'x' + String(slackY) + 'px (a bar needs more than ' + SLACK_MIN + 'px on its axis)')
        const bestW = Math.min(bay.w, bay.h * wanted)
        const bestH = bestW / wanted
        const ratio = screen.w * screen.h / (bestW * bestH)
        if (ratio < TOL.areaRatio) problems.push('the screen is only ' + round(ratio * 100) + '% of the largest screen that fits the bay (' + round(bestW) + 'x' + round(bestH) + '): it is not merely letterboxed, it is undersized')
      }
      const page = step.page === undefined ? null : step.page
      if (page !== null && page.screenAgrees === false) problems.push('the page itself draws the screen at ' + show(page.screenDrawn) + ' while the shell reports ' + show(page.screenFromShell) + ': the geometry reported is not the geometry painted')
    }
    record('3-vm-preview-geometry', problems.length === 0, problems.length === 0
      ? 'the preview screen (' + round(screen.w) + 'x' + round(screen.h) + ') sits inside and centred in the bay (' + round(bay.w) + 'x' + round(bay.h) + '), carries the viewport aspect, and leaves a real letterbox'
      : 'FAIL: ' + problems.join(' | '),
      ['bayPane=' + show(step === null ? null : step.bay) + ' units=' + show(bay === null ? null : bay.units),
        'screenPane=' + show(step === null ? null : step.screen) + ' units=' + show(screen === null ? null : screen.units),
        'viewport=' + show(viewport),
        'inside=' + show(bay === null || screen === null ? null : { left: round(screen.x - bay.x), top: round(screen.y - bay.y), right: round((bay.x + bay.w) - (screen.x + screen.w)), bottom: round((bay.y + bay.h) - (screen.y + screen.h)) }),
        'slack=' + show(bay === null || screen === null ? null : { x: round(bay.w - screen.w), y: round(bay.h - screen.h) }),
        'contentPane=' + show(step === null ? null : brief(asQuad(step.contentPane))), 'surface=' + show(step === null ? null : brief(asQuad(step.surface))),
        'pageScreen=' + show(step === null || step.page === undefined ? null : step.page)])
  }

  { // 4-persisted-across-remount
    const problems = []
    const step = world.persisted === null || world.persisted === undefined ? null : world.persisted
    if (step === null) problems.push('NOT MEASURED: the gate never got to unmount and mount the browser again')
    else if (unstaged('4-').length > 0) problems.push(unmetLine('4-'))
    else {
      const beforeState = step.before === null || step.before === undefined || step.before.state === null || step.before.state === undefined ? null : step.before.state
      if (sameNumbers(beforeState === null ? null : beforeState.viewport, target) !== true) problems.push('nothing held ' + show(target) + ' before the remount (state said ' + show(beforeState === null ? null : beforeState.viewport) + '), so there was nothing to persist')
      if (refused(step.unmount) === true) problems.push('op=unmount was refused: ' + show(step.unmount === null || step.unmount === undefined ? null : step.unmount.error))
      if (refused(step.mount) === true) problems.push('op=mount was refused: ' + show(step.mount === null || step.mount === undefined ? null : step.mount.error))
      const after = step.after === null || step.after === undefined ? null : step.after
      if (after === null) problems.push('the gate never read the state after the remount')
      else {
        const afterState = after.state === null || after.state === undefined ? null : after.state
        if (sameNumbers(afterState === null ? null : afterState.viewport, target) === false) problems.push('after unmount+mount op=state reports ' + show(afterState === null ? null : afterState.viewport) + ' instead of ' + show(target))
        if (afterState !== null && afterState.modeApplied !== true) problems.push('after the remount modeApplied is ' + show(afterState.modeApplied === undefined ? null : afterState.modeApplied) + ': the fresh renderer never took the remembered viewport')
        const page = after.page === null || after.page === undefined ? null : after.page.page
        if (page === null || page.iw !== target.w || page.ih !== target.h) problems.push('the NEW page reports ' + show(page === null ? null : { iw: page.iw, ih: page.ih }) + ' instead of ' + show(target) + ': the value was remembered but never applied again')
      }
      const prefs = step.prefs === undefined ? null : step.prefs
      if (prefs === null) problems.push('op=state reports no prefsPath, so the DISK half of persistence could not be measured')
      else if (prefs.error !== undefined && prefs.error !== null) problems.push('the persisted file could not be read: ' + show(prefs.path) + ' (' + String(prefs.error) + ')')
      else {
        const stored = prefs.json === undefined ? null : prefs.json
        const storedViewport = stored === null || stored === undefined || stored.viewport === undefined ? null : stored.viewport
        if (storedViewport === null || Number(storedViewport.w) !== target.w || Number(storedViewport.h) !== target.h) problems.push('the persisted file does not hold the chosen resolution: ' + show(prefs.path) + ' says ' + show(storedViewport))
        if (stored !== null && stored !== undefined && stored.mode !== undefined && stored.mode !== 'fixed') problems.push('the persisted file records mode ' + show(stored.mode) + ', not fixed')
      }
    }
    record('4-persisted-across-remount', problems.length === 0, problems.length === 0
      ? 'the chosen resolution is WRITTEN TO DISK (the shell own prefs file records it, so a restart would restore it) and survives op=unmount -> op=mount, where the freshly created page reports ' + target.w + 'x' + target.h + ' again. The restart ITSELF is still not measured: the client lifecycle belongs to the shell producer, and this gate never stops the client - so what is proven is the file plus the re-application, not a reboot'
      : 'FAIL: ' + problems.join(' | '),
      ['beforeRemount=' + show(stateBrief(step === null || step.before === null || step.before === undefined ? null : step.before.state)),
        'unmount=' + show(step === null ? null : answerBrief(step.unmount)),
        'mount=' + show(step === null ? null : answerBrief(step.mount)),
        'afterRemount=' + show(stateBrief(step === null || step.after === null || step.after === undefined ? null : step.after.state)),
        'afterRemountPage=' + show(step === null || step.after === null || step.after === undefined ? null : step.after.page),
        'persistedFile=' + show(step === null || step.prefs === undefined ? null : step.prefs)])
  }

  { // 5-shell-control-is-user-input
    const problems = []
    const step = world.chrome === null || world.chrome === undefined ? null : world.chrome
    /* every slice of the world this reading judges, pulled out ONCE and above the branch, so the evidence line
     * at the end can print the same numbers the verdict was made from. */
    const want = step === null || step.expected === null || step.expected === undefined ? null : step.expected
    const hold = step === null || step.holdBeforeClick === null || step.holdBeforeClick === undefined ? null : step.holdBeforeClick
    const holdLease = hold === null || hold.lease === null || hold.lease === undefined ? null : hold.lease
    const before = step === null || step.beforeClick === null || step.beforeClick === undefined ? null : step.beforeClick
    const beforeState = before === null || before.state === null || before.state === undefined ? null : before.state
    const beforeLease = beforeState === null || beforeState.lease === undefined ? null : beforeState.lease
    const v0 = beforeState === null || beforeState.viewport === undefined ? null : beforeState.viewport
    const countBefore = beforeState === null || beforeState.userInputReports === undefined ? null : beforeState.userInputReports
    const after = step === null || step.afterClick === null || step.afterClick === undefined ? null : step.afterClick
    const afterState = after === null || after.state === null || after.state === undefined ? null : after.state
    const afterLease = afterState === null || afterState.lease === undefined ? null : afterState.lease
    const countAfter = afterState === null || afterState.userInputReports === undefined ? null : afterState.userInputReports
    /* R180: THE PRECONDITIONS THIS READING STAGED AND WITNESSED. A reading whose world was not established
     * must not be reported as a product verdict: every precondition below carries the before/after readings
     * it was decided from, and a precondition the gate could not establish makes THIS reading NOT MEASURED. */
    const preconditions = world.preconditions === undefined || world.preconditions === null ? [] : world.preconditions
    const unmet = preconditions.filter((row) => row.id !== null && row.id !== undefined && String(row.id).indexOf('5-') === 0 && row.ok !== true)
    if (step === null) problems.push('NOT MEASURED: the gate never got to look at the shell page')
    else if (unmet.length > 0) problems.push('NOT MEASURED: the world this reading needs could not be staged and witnessed: ' + unmet.map((row) => row.id + ' (' + String(row.what).slice(0, 90) + ') before=' + show(row.before) + ' after=' + show(row.after)).join(' | '))
    else {
      /* what this reading needs before it can mean anything: a clickable control, the preset THE CONTROL ITSELF
       * names, and the gate's own turn for the takeover to be taken from. */
      if (step.button === null || step.button === undefined) problems.push('the shell page exposes no CLICKABLE control naming a resolution: ' + show(step.candidates))
      else if (step.clickAt === null || step.clickAt === undefined) problems.push('the control was found but never clicked')
      else if (String(step.button.title === undefined || step.button.title === null ? '' : step.button.title).length === 0) problems.push('the control carries no title of its own, so the gate cannot say which preset its click should apply: ' + show(step.button))
      if (want === null || typeof want.w !== 'number' || typeof want.h !== 'number') problems.push('the control never named the preset its click should apply - its own title/caption carries no "next preset <WxH>": ' + show(step.button === null || step.button === undefined ? null : step.button.title))
      if (hold === null || hold.claimed !== true) problems.push('the gate did not hold the panel before the click (' + show(hold) + '), so the takeover has no name of its own to take the panel from')
      else if (holdLease === null || holdLease.held !== true || holdLease.holder !== HOLDER) problems.push('the gate claimed the panel before the click, but the shell does not report it as held by this gate: ' + show(holdLease))
      if (v0 !== null && want !== null && sameNumbers(v0, want) === true) problems.push('the viewport was ALREADY ' + show(want) + ' before the click, so the click has no observable effect')

      /* A - the takeover, read AFTER the click completed, attributed to the CONTROL's own write */
      if (afterLease === null) problems.push('the gate never read the lease after the click, so the takeover has nowhere to be seen')
      else {
        if (afterLease.held === true) problems.push('the lease was still held after the click: ' + show(afterLease))
        if (afterLease.revokedBy !== 'user-input') problems.push('the click did not take the panel as user input: lease.revokedBy=' + show(afterLease.revokedBy) + ' (wanted "user-input")')
        if (afterLease.revokedHolder !== HOLDER) problems.push('the takeover does not name this gate as the holder it took the panel from: revokedHolder=' + show(afterLease.revokedHolder) + ' (this gate is ' + HOLDER + ')')
        if (afterLease.revokedKind === undefined || afterLease.revokedKind === null) problems.push('op=state lease carries no revokedKind, so "a control wrote this" cannot be told from "somebody fabricated a request": the field is REQUIRED by this reading (reported as missing, never skipped)')
        else if (String(afterLease.revokedKind).indexOf('shell-control') !== 0) problems.push('the takeover is not attributed to the control own write: revokedKind=' + show(afterLease.revokedKind) + ' (wanted the "shell-control" prefix; "user-input" alone is producible by a bare beacon - see the negative control)')
      }
      /* R180: this is the SAME question the witness above decided, so the two must agree. The witness is the
       * one that can say "the world moved under me" (a foreign claim clears the record); when it does, the
       * reading is NOT MEASURED rather than red, because the product was not what moved. */
      const post = step.postGesture === null || step.postGesture === undefined ? null : step.postGesture
      if (typeof countBefore !== 'number' || typeof countAfter !== 'number') problems.push('the shell reports no userInputReports counter, so "the click WAS the new input" cannot be told from "the click was swallowed as a repeat": ' + show({ before: countBefore, after: countAfter }))
      else if (post !== null && post.delta !== null && post.delta !== countAfter - countBefore) problems.push('the witness and the harvest disagree about how many inputs the window held: witness delta=' + show(post.delta) + ' while the two state reads differ by ' + String(countAfter - countBefore) + ' (a GATE bug, not a product verdict)')
      else if (post !== null && post.unmeasured === true) problems.push('NOT MEASURED: the click window was walked into by somebody else: userInputReports moved by ' + show(post.delta) + ' rather than exactly 1, or the takeover record was cleared by a foreign claim (op=lease{claim} clears both the record and the marker), so "this click was the one new input" cannot be decided in this world')
      else if (countAfter !== countBefore + 1) problems.push('the click was not ONE new user input: userInputReports went ' + String(countBefore) + ' -> ' + String(countAfter) + ' (the shell de-duplicates a repeated identical kind, so a leftover takeover by the same control op would swallow this click)')

      /* B - what the control itself named, applied to the shell AND reported by the page */
      if (afterState === null) problems.push('the gate never read the state after the click')
      else if (want !== null && sameNumbers(afterState.viewport, want) === false) problems.push('the click did not apply the resolution the control names: op=state says ' + show(afterState.viewport) + ' while the control names ' + show(want) + ' (' + String(want.source) + ')')
      const page = step.afterReClaimPage === null || step.afterReClaimPage === undefined || step.afterReClaimPage.page === null || step.afterReClaimPage.page === undefined ? null : step.afterReClaimPage.page
      if (want !== null && (page === null || page.iw !== want.w || page.ih !== want.h)) problems.push('the page after the click reports ' + show(page === null ? null : { iw: page.iw, ih: page.ih }) + ' instead of ' + show(want) + ': the shell applied a viewport the page never took')

      /* the gesture itself: every half dispatched, every half accepted */
      const clicks = step.clicks === undefined || step.clicks === null ? [] : step.clicks
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        const row = clicks.filter((entry) => entry.type === type)[0]
        if (row === undefined) problems.push('the ' + type + ' half of the click was never dispatched')
        else if (row.status !== 200) problems.push('the ' + type + ' half of the click was refused (' + show(row) + '), so the gesture never completed')
      }

      /* R180: WHEN THE WINDOW WAS NOT ISOLATED, NOTHING BELOW IS JUDGED. Every assertion from here on (the
       * paired control, the page, the negative control's reproduction) is about what this click did or did not
       * do, and a window somebody else moved cannot attribute any of it to this click. So the reading stops
       * here with the numbers, instead of collecting a pile of red lines about a world the gate did not have.
       * Same for a withheld gesture: no click was dispatched, so there is nothing downstream to attribute. */
      const withheld = step.gestureWithheld === null || step.gestureWithheld === undefined ? null : step.gestureWithheld
      const notIsolated = post !== null && post.unmeasured === true
      if (notIsolated === true || (withheld !== null && withheld.length > 0)) {
        problems.push('NOT MEASURED: no attributed assertion is made about this click because ' + (notIsolated === true
          ? ('the window it ran in was not isolated: userInputReports moved by ' + show(post === null ? null : post.delta) + ' across the gesture and the takeover record reads ' + show(post === null || post.lease === null || post.lease === undefined ? null : { held: post.lease.held, revokedBy: post.lease.revokedBy, revokedKind: post.lease.revokedKind }) + ' (op=lease{claim} clears both the record and the input marker, so a foreign claimant inside this window is indistinguishable from the product)')
          : ('the gate found the world unstageable before the gesture (' + show(withheld) + ') and did not dispatch one')))
      } else {
        /* C - the paired control: the SAME op=cdp, without a holder */
        if (step.bareBefore === null || step.bareBefore === undefined || step.bareBefore.ok !== true) problems.push('the control side is missing: an op=cdp WITHOUT a holder did not succeed before the click (' + show(step.bareBefore) + ')')
        if (step.bareAfter === null || step.bareAfter === undefined) problems.push('the outside caller was never tried right after the click')
        else if (refused(step.bareAfter) !== true) problems.push('an op=cdp WITHOUT a holder was still ACCEPTED after the click (status ' + String(step.bareAfter.status) + '): the panel does not actually belong to the user')
        else if (namesUserInput(step.bareAfter.error) !== true) problems.push('the outside caller was refused but not by name: ' + show(step.bareAfter.error))
        if (step.reClaimed !== true) problems.push('a fresh op=lease{claim} did not give the gate the panel back after the click: ' + show(step.reClaimed))
        else if (step.afterReClaim === null || step.afterReClaim === undefined || step.afterReClaim.ok !== true) problems.push('the SAME op=cdp did not succeed after the gate claimed the panel back: ' + show(step.afterReClaim))

        /* D - the negative control, and the honest limit of this reading */
        const neg = step.negativeControl === null || step.negativeControl === undefined ? null : step.negativeControl
        if (neg === null) problems.push('the negative control was never run: without it, this reading cannot show that "revokedBy=user-input" is reproducible with no click at all')
        else {
          const nLease = neg.leaseAfter === null || neg.leaseAfter === undefined ? null : neg.leaseAfter
          if (neg.status !== 200) problems.push('the fabricated beacon was not accepted (status ' + String(neg.status) + '), so the negative control measured nothing: ' + show({ kind: neg.kind, status: neg.status }))
          if (nLease === null) problems.push('the negative control never read the lease back')
          else {
            if (nLease.held === true || nLease.revokedBy !== 'user-input') problems.push('the negative control did NOT reproduce the click reading: with no click anywhere, a bare beacon gave held=' + show(nLease.held) + ' revokedBy=' + show(nLease.revokedBy) + ' - if a fabricated request cannot produce this reading, then this gate must say that instead of claiming the two are indistinguishable')
            if (nLease.revokedHolder !== HOLDER) problems.push('the negative control did not take the panel from this gate: revokedHolder=' + show(nLease.revokedHolder) + ' (the gate was holding it, ' + HOLDER + ')')
            if (nLease.revokedKind === undefined || nLease.revokedKind === null) problems.push('the negative control lease carries no revokedKind either, so nothing in this reading can be attributed')
            else if (String(nLease.revokedKind).indexOf('shell-control') === 0) problems.push('the negative control was recorded as a CONTROL write (revokedKind=' + show(nLease.revokedKind) + '): then the kind does not separate a fabricated request from a control, and this reading must not claim it does')
          }
        }
      }
    }
    record('5-shell-control-is-user-input', problems.length === 0, problems.length === 0
      ? 'a real click on a control of the shell page itself is USER INPUT, judged only once the click COMPLETED: the lease comes back taken with revokedBy="user-input", revokedHolder=' + HOLDER + ' and revokedKind=' + show(step.afterClick.state.lease.revokedKind) + ' - the CONTROL own write, and the one new input the shell counted - while the resolution that control own title names (' + show(step.expected) + ') lands on the shell AND on the page, and the SAME op=cdp without a holder is refused by name and 200 again after a claim. WHAT THIS DOES NOT PROVE, stated rather than implied: the negative control (kind=' + show(step.negativeControl === null || step.negativeControl === undefined ? null : step.negativeControl.kind) + ', no click anywhere) produced the SAME revokedBy="user-input" / revokedHolder reading, so revokedBy ALONE cannot tell a click from a fabricated request - the attribution to a control rests entirely on revokedKind.'
      : 'FAIL: ' + problems.join(' | '),
      /* the evidence is printed even when the world was never measured, so every reach through `step` is
       * guarded: a crashed judge would be a GATE bug, not a verdict. */
      ['shellPageInnerW=' + show(step === null ? null : step.innerW) + ' chromePane.w=' + show(step === null ? null : step.chromePaneW) + ' factor=' + show(step === null ? null : step.factor),
        'control=' + show(step === null ? null : step.button) + ' clickedAt=' + show(step === null ? null : step.clickAt),
        'expectedAfterClick=' + show(step === null ? null : step.expected) + ' setBeforeClick=' + show(step === null ? null : step.beforeSet),
        'holdBeforeClick=' + show(step === null ? null : step.holdBeforeClick),
        'clicks=' + show(step === null ? null : step.clicks),
        'beforeClick=' + show({ viewport: v0, lease: beforeLease, reports: countBefore }),
        'afterClick=' + show({ lease: afterLease, viewport: afterState === null || afterState.viewport === undefined ? null : afterState.viewport, lastUserInput: afterState === null || afterState.lastUserInput === undefined ? null : afterState.lastUserInput, reports: countAfter }),
        'negativeControl=' + show(step === null ? null : step.negativeControl),
        'bareBefore=' + show(step === null ? null : step.bareBefore) + ' bareAfter=' + show(step === null ? null : step.bareAfter),
        'reClaimed=' + show(step === null ? null : step.reClaimed) + ' afterReClaim=' + show(step === null ? null : step.afterReClaim),
        'afterReClaimPage=' + show(step === null || step.afterReClaimPage === null || step.afterReClaimPage === undefined ? null : step.afterReClaimPage.page) + ' pageReads=' + show(step === null ? null : step.pageReads)])
  }

  { // 6-tab-boundary
    const problems = []
    const step = world.tabs === null || world.tabs === undefined ? null : world.tabs
    const afterState = step === null || step.after === null || step.after === undefined ? null : step.after.state
    const countAfter = afterState === null || afterState === undefined ? null : afterState.count
    if (step === null) problems.push('NOT MEASURED: the gate never got to drive the tab set')
    else if (unstaged('6-').length > 0) problems.push(unmetLine('6-'))
    else {
      const limit = step.limit
      if (typeof limit !== 'number' || limit <= 0) problems.push('the shell reports no tab limit: ' + show(limit))
      if (countAfter !== limit) problems.push('after opening to the cap the count is ' + show(countAfter) + ', not the declared limit ' + show(limit))
      if (step.refusal === null || step.refusal === undefined) problems.push('the (limit+1)th op=tab-new was never made')
      else if (refused(step.refusal) !== true) problems.push('the (limit+1)th op=tab-new was ACCEPTED (status ' + String(step.refusal.status) + '): the cap is not enforced')
      else if (NAMED_LIMIT.test(String(step.refusal.error)) === false) problems.push('the cap refused the tab without naming the limit: ' + show(step.refusal.error))
      const chrome = step.chrome === null || step.chrome === undefined ? null : step.chrome
      if (chrome === null || chrome.chrome === null || chrome.chrome === undefined) problems.push('the shell page could not be read to check the pills and the + button')
      else {
        const bar = asQuad(chrome.chrome.bar)
        const pills = chrome.chrome.pills === undefined ? [] : chrome.chrome.pills
        if (bar === null) problems.push('the shell page reports no bar to judge the pills against')
        else {
          for (let index = 0; index < pills.length; index += 1) {
            const pill = asQuad(pills[index])
            if (pill === null) continue
            if (pill.x < bar.x - TOL.rect || pill.x + pill.w > bar.x + bar.w + TOL.rect) problems.push('tab pill[' + String(index) + '] leaves the chrome bar: pill ' + show(brief(pill)) + ' bar ' + show(brief(bar)))
            if (pill.y < bar.y - TOL.rect || pill.y + pill.h > bar.y + bar.h + TOL.rect) problems.push('tab pill[' + String(index) + '] is outside the chrome bar vertically: pill ' + show(brief(pill)) + ' bar ' + show(brief(bar)))
          }
        }
        if (chrome.chrome.plusDisabled !== true) problems.push('at the cap the shell page own + button is still enabled (plusDisabled=' + show(chrome.chrome.plusDisabled) + '), so the boundary is invisible where the user would meet it')
      }
      if (step.restored === null || step.restored === undefined || step.restored.ok !== true) problems.push('the gate did not put the tab set back: ' + show(step.restored))
    }
    record('6-tab-boundary', problems.length === 0, problems.length === 0
      ? 'the tab cap is a named boundary: the (limit+1)th tab is refused by name with the count unchanged, the shell page disables its own + at the cap, and every pill stays inside the chrome bar'
      : 'FAIL: ' + problems.join(' | '),
      ['limit=' + show(step === null ? null : step.limit),
        'countBefore=' + show(step === null || step.before === null || step.before === undefined || step.before.state === null || step.before.state === undefined ? null : step.before.state.count),
        'opened=' + show(step === null ? null : step.opened),
        'refusal=' + show(step === null ? null : answerBrief(step.refusal)),
        'countAfter=' + show(countAfter),
        'pills=' + show(step === null || step.chrome === undefined || step.chrome === null || step.chrome.chrome === null ? null : step.chrome.chrome.pills),
        'bar=' + show(step === null || step.chrome === undefined || step.chrome === null || step.chrome.chrome === null ? null : step.chrome.chrome.bar),
        'restored=' + show(step === null ? null : step.restored)])
  }
  return readings
}

// ---------------------------------------------------------------------------------------- the live probe
const collect = async () => {
  const started = Date.now()
  const left = () => Math.max(0, BUDGET_MS - (Date.now() - started))
  const world = { kind: 'live', holder: HOLDER, progress: [], preconditions: [], start: null, snapshot: null, factor: 1, changed: null, geometry: null, preset: null, persisted: null, chrome: null, tabs: null, restore: null }
  const say = (line) => { world.progress.push(line) }
  /* The world as this run was HANDED it (filled in right after the first op=state). It is a handle for the
   * whole body, because both the staging (reading 5 asks what marker it inherited) and the closing restore
   * (does the world compare equal to what it was handed) read it. */
  let snap = null
  const pre = (id, what, ok, before, after, detail) => {
    const record = preconditionOf(id, what, ok, before, after, detail)
    world.preconditions.push(record)
    say('PRECONDITION ' + (record.ok ? 'MET  ' : 'NOT MET ') + id + ' - ' + what + ': before=' + show(record.before) + ' after=' + show(record.after) + (record.detail === null ? '' : ' | ' + String(record.detail)))
    return record
  }

  const first = await stateOf()
  if (first.answer.status === 0) { world.noShell = true; return world }
  world.shellUp = true
  const cdp = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version', { signal: AbortSignal.timeout(2500) }).then((answer) => answer.ok).catch(() => false)
  world.cdpUp = cdp === true
  if (cdp !== true) return world

  world.start = { state: first.state, page: await readPage() }
  /* R180: the world THIS GATE FOUND, kept so the end of the run can put the world back to the shape it was
   * handed. It is a reading, not an assumption: every field below came out of the op=state above. */
  world.snapshot = {
    viewport: first.state === null || first.state === undefined || first.state.viewport === undefined ? null : first.state.viewport,
    mode: first.state === null || first.state === undefined || first.state.mode === undefined ? null : first.state.mode,
    mounted: first.state === null || first.state === undefined || first.state.mounted === undefined ? null : first.state.mounted,
    exists: first.state === null || first.state === undefined || first.state.exists === undefined ? null : first.state.exists,
    count: first.state === null || first.state === undefined || first.state.count === undefined ? null : first.state.count,
    active: first.state === null || first.state === undefined || first.state.active === undefined ? null : first.state.active,
    tabs: first.state === null || first.state === undefined || first.state.tabs === undefined ? null : first.state.tabs.map((row) => row === null || row === undefined ? null : row.id),
    lease: first.state === null || first.state === undefined || first.state.lease === undefined ? null : first.state.lease,
    input: inputWitnessOf(first.state),
  }
  snap = world.snapshot
  say('world this gate was handed (R180 reset baseline): ' + show(world.snapshot))
  say('panel at start: exists=' + show(first.state === null || first.state === undefined ? null : first.state.exists) + ' mounted=' + show(first.state === null || first.state === undefined ? null : first.state.mounted) + ' count=' + show(first.state === null || first.state === undefined ? null : first.state.count) + ' mode=' + show(first.state === null || first.state === undefined ? null : first.state.mode) + ' viewport=' + show(first.state === null || first.state === undefined ? null : first.state.viewport) + ' lease=' + show(first.state === null || first.state === undefined ? null : first.state.lease))

  // ---- the gate owns the panel: claim the lease first, then raise and place it itself (R153).
  const held = await claimLease(PORT, HOLDER, LEASE_TTL_MS)
  if (held !== true) {
    const lease = world.start.state === null || world.start.state === undefined ? null : world.start.state.lease
    world.noLease = true
    world.leaseReason = lease === null || lease === undefined ? '(the shell answered no lease object)' : show(lease)
    return world
  }
  const beforeStart = world.start.state
  if (beforeStart === null || beforeStart === undefined || beforeStart.exists !== true || beforeStart.mounted !== true) {
    const opened = await panelPost({ op: 'open', url: 'http://127.0.0.1:' + PORT + '/__shell/panel-start', holder: HOLDER })
    say('the browser was not up, so the gate raised it itself with op=open: status=' + String(opened.status) + ' error=' + show(opened.body === null ? null : opened.body.error) + ' (the gate does not restart the client)')
    world.mountedByGate = true
    const until = Date.now() + Math.min(left() - 2000, 12000)
    let seen = await stateOf()
    while (Date.now() < until && (seen.state === null || seen.state === undefined || seen.state.exists !== true)) { await sleep(500); seen = await stateOf() }
    if (seen.state === null || seen.state === undefined || seen.state.exists !== true) { world.noPanel = true; return world }
  }
  const placed = await panelPost({ op: 'set-bounds', x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h, holder: HOLDER })
  world.placed = { status: placed.status, error: placed.body === null ? null : placed.body.error, state: placed.body !== null && placed.body !== undefined && placed.body.state !== undefined ? placed.body.state : placed.body }
  say('op=set-bounds ' + show(BOX) + ': status=' + String(placed.status) + ' error=' + show(placed.body === null ? null : placed.body.error))
  await sleep(700)

  // fixed mode is what makes a viewport change observable at all: in fit mode the viewport IS the content rect.
  const modeState = (await stateOf()).state
  if (modeState !== null && modeState !== undefined && modeState.mode !== 'fixed') {
    const answer = await panelPost({ op: 'mode', kind: 'fixed', holder: HOLDER })
    say('the browser was in mode ' + show(modeState.mode) + '; the gate switched it to fixed: status=' + String(answer.status) + ' error=' + show(answer.body === null ? null : answer.body.error))
    await sleep(500)
  }
  const factorOf = (state) => {
    const chromeBounds = asQuad(state === null || state === undefined ? null : state.chromeBounds)
    const chromePane = asQuad(state === null || state === undefined ? null : state.chromePane)
    if (chromeBounds === null || chromePane === null || chromePane.w <= 0) return 1
    return Math.round((chromeBounds.w / chromePane.w) * 1000) / 1000
  }
  world.factor = factorOf((await stateOf()).state)
  say('units factor (chromeBounds.w / chromePane.w) = ' + show(world.factor))

  /* The gate's own vocabulary for op=viewport, tried in order until the shell takes one. WHICH SPELLING the
   * shell accepts is instrument calibration, not a product claim: it is printed, never assumed. The verdict
   * is what the shell and the page say AFTERWARDS. */
  /* WHICH SPELLING the shell accepts is instrument calibration, but the CONTRACT names the spellings: the
   * numeric pair {width,height} and the named {preset:"WxH"}. The old {w,h} spelling was this gate's own
   * invention; on the live shell it answers a named 400 that reads like a product failure in the log while
   * saying nothing about the product. Removed rather than kept as noise (R179-B, read against the live shell). */
  const shapesFor = (w, h) => [
    { label: '{width,height}=' + w + 'x' + h, payload: { width: w, height: h } },
    { label: '{preset:"' + w + 'x' + h + '"}', payload: { preset: String(w) + 'x' + String(h) } },
  ]
  const presetShapes = [
    { label: '{preset:"' + TARGET.w + 'x' + TARGET.h + '"}', payload: { preset: TARGET.w + 'x' + TARGET.h } },
    { label: '{width,height}', payload: { width: TARGET.w, height: TARGET.h } },
  ]
  const tryShapes = async (shapes) => {
    const tries = []
    for (const shape of shapes) {
      const answer = await panelPost({ op: 'viewport', ...shape.payload, holder: HOLDER })
      const record = { label: shape.label, status: answer.status, error: answer.body === null ? null : answer.body.error, unknownOp: UNKNOWN_OP.test(String(answer.body === null ? '' : answer.body.error)) }
      tries.push(record)
      if (record.status === 200) {
        const keys = Object.keys(shape.payload)
        return { accepted: record.label, keys: keys, acceptedName: shape.payload.preset === undefined ? null : String(shape.payload.preset), tries: tries }
      }
    }
    return { accepted: null, keys: null, acceptedName: null, tries: tries }
  }

  // ---- reading 1: change the resolution and ask the page itself
  /* R180 PRECONDITION: a change is only observable if the world is NOT already at the target. This is the
   * reading the shell's own memory cannot fake - the PAGE is asked, through op=cdp, at the moment the gate
   * takes its before-snapshot. The shell's remembered viewport is printed beside it, so "the world was
   * already there / the page and the shell disagreed" can be read rather than guessed. */
  /* R180 RESET, not a preference: reading 1 must start where the change can be seen, so the gate PUTS the
   * world at the reset resolution and waits until the shell actually says so before it takes its
   * before-snapshot. "Was it already there" is asked of the PAGE, not of the shell's memory. */
  const staged = await settleViewport(RESET, 5, 400)
  pre('1-world-staged-at-reset',
    'the gate puts the viewport at the reset resolution ' + show(RESET) + ' and waits for op=state to say so, so that reading 1\'s change has somewhere to start from',
    staged.settled === true, staged.first, staged.last,
    staged.settled === true ? null : 'op=state never reported ' + show(RESET) + ' within ' + String(staged.tries) + ' polls')
  const beforePage = await readPage()
  const beforeState1 = (await stateOf()).state
  const already = beforePage.page !== null && beforePage.page !== undefined && Number(beforePage.page.iw) === TARGET.w && Number(beforePage.page.ih) === TARGET.h
  const modeWasFixed = beforeState1 === null || beforeState1 === undefined ? null : beforeState1.mode === 'fixed'
  pre('1-not-already-at-target',
    'the page must not already be ' + TARGET.w + 'x' + TARGET.h + ', or the change below shows nothing, and the browser must be in fixed mode, where a viewport change is observable at all',
    already !== true && modeWasFixed === true,
    { page: beforePage.page, stateViewport: beforeState1 === null || beforeState1 === undefined ? null : beforeState1.viewport, mode: beforeState1 === null || beforeState1 === undefined ? null : beforeState1.mode },
    { page: beforePage.page, stateViewport: beforeState1 === null || beforeState1 === undefined ? null : beforeState1.viewport, mode: beforeState1 === null || beforeState1 === undefined ? null : beforeState1.mode },
    already === true ? 'the world this gate was handed was ALREADY at the target (nothing to observe; the reset above is what fixes it)' : (modeWasFixed === true ? null : 'mode is not fixed'))
  world.changed = { before: { state: beforeState1, page: beforePage }, shapes: [], accepted: null, keys: null, acceptedName: null, after: null }
  const change = await tryShapes(shapesFor(TARGET.w, TARGET.h))
  world.changed.shapes = change.tries
  world.changed.accepted = change.accepted
  world.changed.keys = change.keys
  world.changed.acceptedName = change.acceptedName
  say('op=viewport ' + TARGET.w + 'x' + TARGET.h + ': ' + show(change.tries))
  await sleep(900)
  world.changed.after = { state: (await stateOf()).state, page: await readPage() }
  say('after the change: state=' + show(stateBrief(world.changed.after.state)) + ' page=' + show(world.changed.after.page.page))
  /* R180 PRECONDITION for readings 1 and 3: both judge the world this change was supposed to create, so both
   * need the shell AND the page to be at the target. Staged (waited for), not slept on: a fixed sleep is a
   * guess about somebody else's timer, and the page resizes asynchronously. */
  const atTarget = await settleViewport(TARGET, 6, 500)
  const targetPage = world.changed.after.page === null || world.changed.after.page === undefined ? null : world.changed.after.page.page
  pre('1-and-3-world-is-at-target',
    'after op=viewport ' + TARGET.w + 'x' + TARGET.h + ' the SHELL must say the viewport is the target and the PAGE must report its own window as the target - readings 1 and 3 both read THIS world',
    atTarget.settled === true && targetPage !== null && Number(targetPage.iw) === TARGET.w && Number(targetPage.ih) === TARGET.h,
    { state: atTarget.first, page: targetPage }, { state: atTarget.last, page: targetPage },
    atTarget.settled !== true ? ('op=state never reported ' + show(TARGET) + ' within ' + String(atTarget.tries) + ' polls') : (targetPage === null ? 'the page was never read' : null))

  // ---- reading 3: the bay/screen pair, in the world the change created, plus what the page itself draws
  await sleep(900)
  /* R180 PRECONDITION: the bay/screen pair is only interesting in the world the change created, and that world
   * is read here as well as staged above - the reading says NOT MEASURED rather than judging a geometry that
   * belongs to a viewport it did not ask for. */
  const geometryStateNow = (await stateOf()).state
  pre('3-geometry-is-in-the-world-the-change-created',
    'the state this geometry is read from must be at ' + show(TARGET) + ' with modeApplied, and in fixed mode, or the bay/screen pair below is a geometry of some other world',
    geometryStateNow !== null && geometryStateNow !== undefined && sameNumbers(geometryStateNow.viewport, TARGET) === true && geometryStateNow.modeApplied === true && geometryStateNow.mode === 'fixed',
    { viewport: geometryStateNow === null || geometryStateNow === undefined ? null : geometryStateNow.viewport, mode: geometryStateNow === null || geometryStateNow === undefined ? null : geometryStateNow.mode, modeApplied: geometryStateNow === null || geometryStateNow === undefined ? null : geometryStateNow.modeApplied },
    { viewport: geometryStateNow === null || geometryStateNow === undefined ? null : geometryStateNow.viewport, mode: geometryStateNow === null || geometryStateNow === undefined ? null : geometryStateNow.mode, modeApplied: geometryStateNow === null || geometryStateNow === undefined ? null : geometryStateNow.modeApplied },
    null)
  const chromeForGeometry = await readChrome()
  const chromeGeometry = chromeForGeometry.chrome
  const geometryState = world.changed.after.state
  const pick = (key) => geometryState === null || geometryState === undefined ? null : (geometryState[key] === undefined ? null : geometryState[key])
  const chromeReadings = chromeGeometry === null || chromeGeometry === undefined ? null : chromeGeometry.readings
  world.geometry = {
    bay: pick('bayPane'), screen: pick('screenPane'), viewport: pick('viewport'), contentPane: pick('contentPane'), surface: pick('surface'),
    page: chromeReadings === null || chromeReadings === undefined ? null : {
      screenAgrees: chromeReadings.screenAgrees === undefined ? null : chromeReadings.screenAgrees,
      screenDrawn: chromeReadings.screenDrawn === undefined ? null : chromeReadings.screenDrawn,
      screenFromShell: chromeReadings.screenFromShell === undefined ? null : chromeReadings.screenFromShell,
      bayRect: chromeReadings.bayRect === undefined ? null : chromeReadings.bayRect,
      shellScreenPane: chromeReadings.shellScreenPane === undefined ? null : chromeReadings.shellScreenPane,
      shellBayPane: chromeReadings.shellBayPane === undefined ? null : chromeReadings.shellBayPane,
    },
  }
  say('bay/screen from op=state: bayPane=' + show(world.geometry.bay) + ' screenPane=' + show(world.geometry.screen) + ' deckPane=' + show(brief(asQuad(pick('deckPane')))) + ' contentPane=' + show(brief(asQuad(world.geometry.contentPane))))
  say('what the shell page itself drew: ' + show(world.geometry.page))

  // ---- reading 2: reset so a preset effect is observable, apply a preset, then refuse unusable values
  const reset = await tryShapes(shapesFor(RESET.w, RESET.h))
  await sleep(600)
  /* R180 PRECONDITION: a preset effect is only observable if the reset actually LANDED. The gate waits for
   * the shell to say so and prints what it saw instead; the reading fails, named and with the numbers, if
   * the world would not settle - it does not judge a preset it could not observe. */
  const stagedReset = await settleViewport(RESET, 5, 400)
  pre('2-reset-landed-before-the-preset',
    'the reset to ' + show(RESET) + ' must be visible in op=state before a preset is applied, or the preset effect cannot be told from the state the gate found',
    stagedReset.settled === true, stagedReset.first, stagedReset.last,
    stagedReset.settled === true ? null : 'op=state never reported ' + show(RESET) + ' within ' + String(stagedReset.tries) + ' polls')
  const presetBefore = (await stateOf()).state
  world.preset = {
    resetShapes: reset.tries, resetAccepted: reset.accepted, before: { state: presetBefore, page: await readPage() },
    shapes: [], accepted: null, acceptedName: null, names: presetBefore === null || presetBefore === undefined || presetBefore.presets === undefined ? null : presetBefore.presets.map((row) => row.name), after: null, illegal: [],
  }
  say('reset to ' + RESET.w + 'x' + RESET.h + ': ' + show(reset.tries) + ' state=' + show(stateBrief(presetBefore)))
  const preset = await tryShapes(presetShapes)
  world.preset.shapes = preset.tries
  world.preset.accepted = preset.accepted
  world.preset.acceptedName = preset.acceptedName
  await sleep(800)
  const stagedPreset = await settleViewport(TARGET, 5, 400)
  pre('2-the-preset-landed-on-the-target',
    'the preset the gate applied must show up in op=state as ' + show(TARGET) + ' (and the page must report it) before readings 2 and 4 judge it',
    stagedPreset.settled === true, stagedPreset.first, stagedPreset.last,
    stagedPreset.settled === true ? null : 'op=state never reported ' + show(TARGET) + ' within ' + String(stagedPreset.tries) + ' polls')
  world.preset.after = { state: (await stateOf()).state, page: await readPage() }
  say('preset: ' + show(preset.tries) + ' -> state=' + show(stateBrief(world.preset.after.state)))
  /* The contract's numeric spelling is {width,height}; the old {w,h} fallback went with the shapes above, so
   * the unusable-value trials below are made in the one spelling the product recognises. */
  const keys = ['width', 'height']
  const withKeys = (a, b) => { const payload = {}; payload[keys[0]] = a; payload[keys[1]] = b; return payload }
  const illegalShapes = [
    { label: 'zero', payload: withKeys(0, 0) },
    { label: 'negative', payload: withKeys(-1920, 1080) },
    { label: 'not-a-number', payload: withKeys('NaN', 1080) },
    { label: 'neither', payload: {} },
  ]
  for (const shape of illegalShapes) {
    const answer = await panelPost({ op: 'viewport', ...shape.payload, holder: HOLDER })
    world.preset.illegal.push({ label: shape.label, payload: shape.payload, record: answerOf(answer), state: (await stateOf()).state })
  }
  say('unusable resolutions: ' + show(world.preset.illegal.map((attempt) => attempt.label + ' -> ' + String(attempt.record.status) + ' ' + show(attempt.record.error) + ' viewport=' + show(attempt.state === null || attempt.state === undefined ? null : attempt.state.viewport))))

  // ---- reading 4: the cheapest honest persistence reading - the file it is written to, plus a remount
  world.persisted = { before: { state: (await stateOf()).state, page: await readPage() }, unmount: null, mount: null, after: null, prefs: null }
  const unmount = await panelPost({ op: 'unmount', holder: HOLDER })
  world.persisted.unmount = answerOf(unmount)
  await sleep(400)
  const mount = await panelPost({ op: 'mount', url: 'http://127.0.0.1:' + PORT + '/__shell/panel-start', holder: HOLDER })
  world.persisted.mount = answerOf(mount)
  const untilMount = Date.now() + Math.min(Math.max(0, left() - 9000), 9000)
  let mountState = (await stateOf()).state
  while (Date.now() < untilMount && (mountState === null || mountState === undefined || mountState.exists !== true)) { await sleep(500); mountState = (await stateOf()).state }
  await panelPost({ op: 'set-bounds', x: BOX.x, y: BOX.y, w: BOX.w, h: BOX.h, holder: HOLDER })
  await sleep(1200)
  /* R180 PRECONDITION: the remount has to come back at the remembered resolution before the reading judges the
   * re-application, and the file half is read below from the path op=state itself reports. */
  const stagedRemount = await settleViewport(TARGET, 6, 400)
  pre('4-the-fresh-renderer-came-back-at-the-target',
    'after op=unmount -> op=mount the world must report ' + show(TARGET) + ' again before readings 4 judges the re-application',
    stagedRemount.settled === true, stagedRemount.first, stagedRemount.last,
    stagedRemount.settled === true ? null : 'op=state never reported ' + show(TARGET) + ' within ' + String(stagedRemount.tries) + ' polls after the remount')
  world.persisted.after = { state: (await stateOf()).state, page: await readPage() }
  const afterState = world.persisted.after.state
  const prefsPath = afterState === null || afterState === undefined || afterState.prefsPath === undefined ? null : afterState.prefsPath
  if (typeof prefsPath === 'string' && prefsPath.length > 0) {
    try {
      const readFileSync = (await import('node:fs')).readFileSync
      const text = readFileSync(prefsPath, 'utf8')
      world.persisted.prefs = { path: prefsPath, text: String(text).replace(/\s+/g, ' ').slice(0, 200), json: JSON.parse(text) }
    } catch (error) { world.persisted.prefs = { path: prefsPath, error: String(error && error.message ? error.message : error) } }
  }
  say('remount: unmount=' + show(world.persisted.unmount.error) + ' mount=' + show(world.persisted.mount.error) + ' -> state=' + show(stateBrief(afterState)) + ' page=' + show(world.persisted.after.page.page))
  say('persisted file: ' + show(world.persisted.prefs))

  // ---- reading 5: the shell page's own controls, driven for real
  const controlsOf = (chrome) => chrome === null || chrome === undefined || chrome.controls === undefined ? [] : chrome.controls
  const bareControl = (row) => ({ tag: row.tag, id: row.id, title: String(row.title === undefined || row.title === null ? '' : row.title).slice(0, 120), words: String(row.words).slice(0, 90), rect: row.rect, disabled: row.disabled, visible: row.visible })
  const pickControl = (chrome, paneW) => {
    const named = controlsOf(chrome).filter((row) => /(\d{3,4})\s*[x\u00d7]\s*(\d{3,4})/.test(String(row.words)))
    const clickable = named.filter((row) => row.tag !== 'option' && row.tag !== 'select' && row.disabled !== true && row.visible === true && row.rect.w > 2 && row.rect.h > 2)
    const innerW = chrome === null || chrome === undefined ? null : chrome.innerW
    const factor = paneW !== null && innerW !== null && innerW > 0 ? Math.round((paneW / innerW) * 1000) / 1000 : 1
    const chosen = clickable.length === 0 ? null : clickable[0]
    const title = chosen === null || chosen.title === undefined || chosen.title === null ? '' : String(chosen.title)
    const words = chosen === null ? '' : String(chosen.words)
    /* The expectation is the CONTROL'S OWN CAPTION, read off the element the gate is about to click: its title
     * says which preset the next click switches to ("next preset <WxH>"). The whole element's words are the
     * fallback and the shell page's own preset list the last one - each printed WITH its source, so nobody has
     * to guess where the expected resolution came from. */
    const nextOf = (from) => /(?:\u4e0b\u4e00\u4e2a\u9884\u8bbe|next[^0-9]{0,12})\s*(\d{3,4})\s*[x\u00d7]\s*(\d{3,4})/i.exec(from)
    const inTitle = nextOf(title)
    const inWords = inTitle === null ? nextOf(words) : null
    const here = /(\d{3,4})\s*[x\u00d7]\s*(\d{3,4})/.exec(words)
    const readings = chrome === null || chrome === undefined || chrome.readings === null || chrome.readings === undefined ? null : chrome.readings
    const order = readings === null || Array.isArray(readings.presets) === false ? null : readings.presets.map(String)
    const currentName = readings === null ? null : readings.viewportPreset
    let byList = null
    if (order !== null && order.length > 0 && typeof currentName === 'string') {
      const at = order.indexOf(currentName)
      if (at >= 0) byList = { name: order[(at + 1) % order.length], source: 'the shell page own preset list, the one after ' + currentName }
    }
    const fromName = (row) => {
      if (row === null || row === undefined) return null
      const pair = /^(\d{3,4})x(\d{3,4})$/.exec(String(row.name))
      return pair === null ? null : { w: Number(pair[1]), h: Number(pair[2]), source: row.source }
    }
    const expected = inTitle !== null ? { w: Number(inTitle[1]), h: Number(inTitle[2]), source: 'the control own TITLE names the next preset' }
      : inWords !== null ? { w: Number(inWords[1]), h: Number(inWords[2]), source: 'the control own words name the next preset (its title did not)' }
        : here !== null ? { w: Number(here[1]), h: Number(here[2]), source: 'the control own caption names this resolution' }
          : fromName(byList)
    return {
      innerW: innerW, factor: factor, candidates: named.slice(0, 12).map(bareControl),
      button: chosen === null ? null : { tag: chosen.tag, id: chosen.id, title: title.slice(0, 160), words: words.slice(0, 90), rect: chosen.rect },
      clickAt: chosen === null ? null : { x: Math.round((chosen.rect.x + chosen.rect.w / 2) * factor), y: Math.round((chosen.rect.y + chosen.rect.h / 2) * factor) },
      expected: expected,
    }
  }
  const setViewport = async (pair) => { const done = await tryShapes(shapesFor(pair.w, pair.h)); await sleep(900); return done }
  const paneWidth = () => { const state = world.persisted.after.state; const pane = state === null || state === undefined ? null : asQuad(state.chromePane); return pane === null ? null : pane.w }
  const nameOf = (pair) => String(pair.w) + 'x' + String(pair.h)
  let beforeSet = await setViewport({ w: RESET.w, h: RESET.h })
  let chromeRead = await readChrome()
  for (let tries = 0; tries < 5; tries += 1) {
    const readings = chromeRead.chrome === null || chromeRead.chrome === undefined ? null : chromeRead.chrome.readings
    if (readings !== null && readings !== undefined && readings.viewportPreset === nameOf({ w: RESET.w, h: RESET.h })) break
    await sleep(500)
    chromeRead = await readChrome()
  }
  let control = pickControl(chromeRead.chrome, paneWidth())
  if (control.expected !== null && sameNumbers(control.expected, { w: RESET.w, h: RESET.h }) === true) {
    beforeSet = await setViewport({ w: TARGET.w, h: TARGET.h })
    chromeRead = await readChrome()
    control = pickControl(chromeRead.chrome, paneWidth())
  }
  world.chrome = {
    status: chromeRead.status, error: chromeRead.error, innerW: control.innerW, chromePaneW: paneWidth(), factor: control.factor,
    candidates: control.candidates, button: control.button, clickAt: control.clickAt, expected: control.expected,
    beforeSet: beforeSet.accepted, beforeSetTries: beforeSet.tries, clicks: [],
    holdBeforeClick: null, negativeControl: null, beforeClick: null, bareBefore: null, preStaging: null, witness: null, postGesture: null,
    afterClick: null, bareAfter: null, reClaimed: null, afterReClaim: null, afterReClaimPage: null, pageReads: 0,
  }
  if (chromeRead.chrome === null || chromeRead.chrome === undefined) say('the shell page could not be read: ' + show({ status: chromeRead.status, error: chromeRead.error, value: chromeRead.value }))
  else say('shell page: innerW=' + show(control.innerW) + ' chromePane.w=' + show(paneWidth()) + ' factor=' + show(control.factor) + ' resolutionControls=' + show(control.candidates) + ' | the control own title says this click applies ' + show(control.expected))

  /* The gate's own turn, claimed BY NAME before the gesture: the takeover the click records names the holder it
   * took the panel from, and that holder has to be this gate for the record to be about this gate. */
  const claimToHold = async (tries) => {
    const attempts = []
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const claimed = await claimLease(PORT, HOLDER, LEASE_TTL_MS)
      attempts.push(claimed)
      if (claimed === true) return { claimed: true, attempts: attempts }
      await sleep(2000)
    }
    return { claimed: false, attempts: attempts }
  }
  const heldFirst = await claimToHold(3)
  const stateBeforeBeacon = (await stateOf()).state

  /* WHAT THIS READING NEEDS BEFORE IT CAN MEAN ANYTHING (R180). Reading 5 asks whether a click is a NEW user
   * input. Three things can make that unanswerable, and all three are read rather than assumed:
   *   (a) a leftover marker from an earlier run - the shell SWALLOWS a write whose kind equals the last
   *       recorded input (sidebar_panel.rs note_shell_control), so 'shell-control:viewport' left behind by
   *       the PREVIOUS run of this very gate would eat this run's click;
   *   (b) a claim landing between the staging and the gesture - op=lease{claim} CLEARS that marker
   *       (sidebar_panel.rs, the R179-A fix), so a foreign claimant can wipe the evidence mid-flight;
   *   (c) the viewport already being at the preset the control would apply, so the click has no effect.
   * So the gate STAGES the marker with a kind of its own making (the one channel the contract gives for
   * recording an input with no click), claims its own turn, and then - immediately before the gesture, with
   * nothing in between - HARVESTS the state and WITNESSES that the marker it left is not one the click could
   * be swallowed by. That witness is a precondition with a before and an after reading, and if it cannot be
   * established the gate says NOT MEASURED instead of reporting a product verdict. The negative control is
   * the SAME beacon, and it is expected to reproduce the click's takeover shape: revokedBy alone cannot tell
   * a click from a fabricated request - only revokedKind can, which is why the assertion is on the kind. */
  /* A KIND OF THIS PROCESS'S OWN: a shell-control kind is the only kind that can swallow a click, and this
   * one carries the pid and the clock, so it can never equal one. */
  const FABRICATED_KIND = 'gate-r180-fabricated-no-click-' + String(process.pid) + '-' + String(Date.now())
  const handedInput = snap === null || snap === undefined ? null : snap.input
  const stagedWorld = { viewport: null, mode: null, reports: null, lastUserInput: null, handed: handedInput }
  const stateStaged = (await stateOf()).state
  if (stateStaged !== null && stateStaged !== undefined) {
    stagedWorld.viewport = stateStaged.viewport === undefined ? null : stateStaged.viewport
    stagedWorld.mode = stateStaged.mode === undefined ? null : stateStaged.mode
    stagedWorld.reports = stateStaged.userInputReports === undefined ? null : stateStaged.userInputReports
    stagedWorld.lastUserInput = stateStaged.lastUserInput === undefined ? null : stateStaged.lastUserInput
  }
  world.chrome.preStaging = { 'viewport': stagedWorld.viewport, 'mode': stagedWorld.mode, 'reports': stagedWorld.reports, 'lastUserInput': stagedWorld.lastUserInput, 'target': TARGET, 'reset': RESET, 'expectedAfterClick': control.expected, 'clickAt': control.clickAt, 'handedMarker': handedInput, 'handedMarkerWasShellControl': handedInput === null || handedInput === undefined ? null : String(handedInput.lastUserInput === undefined ? null : handedInput.lastUserInput).indexOf('shell-control') === 0 }
  /* R180 - THE DEBT OF THE LAST ROUND, printed where it was measured. A previous run of THIS gate leaves
   * lastUserInput="shell-control:viewport" behind (its own click wrote it) and can leave the browser up. That
   * leftover is the marker the shell would de-duplicate the NEXT click against, and it is exactly what this
   * gate now removes before it measures anything. The reading is taken from the run's OWN input rather than
   * asked again: it is the state the gate was handed. */
  const handedMarkerWasStale = world.chrome.preStaging.handedMarkerWasShellControl === true
  say('the world as FOUND carried ' + show({ lastUserInput: handedInput === null || handedInput === undefined ? null : handedInput.lastUserInput, userInputReports: handedInput === null || handedInput === undefined ? null : handedInput.userInputReports }) + (handedMarkerWasStale ? ' - a leftover CONTROL-shaped marker from an earlier run, which is what the shell would have swallowed THIS click with. The staging below removes it before anything is measured.' : ' - no leftover control-shaped marker to remove, but it is removed the same way rather than assumed to be absent.'))
  say('PRE-CONDITION the world before reading 5 is staged: ' + show({ viewport: stagedWorld.viewport, mode: stagedWorld.mode, reports: stagedWorld.reports, lastUserInput: stagedWorld.lastUserInput }) + ' | the gate needs ' + show(TARGET) + ' with an input marker that is not the kind this click writes')
  pre('5-viewport-not-already-at-the-click-target',
    'the viewport the click would apply must NOT already be the current one, or the click has no observable effect on the shell (the control applies the next preset) - the gate places ' + show(TARGET) + ' first, which makes the click switch to ' + show(control.expected) + '. BOTH are read from the control own title before anything is clicked, so this is staged without knowing the answer in advance',
    stagedWorld.viewport !== null && control.expected !== null && sameNumbers(stagedWorld.viewport, { w: control.expected.w, h: control.expected.h }) !== true,
    { viewport: stagedWorld.viewport, expectedAfterClick: control.expected },
    { viewport: stagedWorld.viewport, expectedAfterClick: control.expected },
    control.expected === null ? 'the control never named a next preset, so what the click would apply is unknown' : null)
  /* The state this fabricated input takes the panel away from: read before the beacon, and the pair it forms
   * with the read after it IS the negative control's evidence (revokedBy/revokedHolder/revokedKind). Read
   * above rather than here so nothing but the beacon sits between the two reads. */
  const stagedLease = stateBeforeBeacon === null || stateBeforeBeacon === undefined ? null : stateBeforeBeacon.lease
  const sentinel = await beacon(FABRICATED_KIND)
  await sleep(700)
  const stateAfterBeacon = (await stateOf()).state
  world.chrome.negativeControl = {
    kind: FABRICATED_KIND, status: sentinel.status, query: sentinel.query,
    leaseBefore: stateBeforeBeacon === null || stateBeforeBeacon === undefined ? null : stateBeforeBeacon.lease,
    leaseAfter: stateAfterBeacon === null || stateAfterBeacon === undefined ? null : stateAfterBeacon.lease,
    lastUserInput: stateAfterBeacon === null || stateAfterBeacon === undefined ? null : stateAfterBeacon.lastUserInput,
    reports: stateAfterBeacon === null || stateAfterBeacon === undefined ? null : stateAfterBeacon.userInputReports,
    claimedAfter: null,
  }
  say('negative control - NO click, one bare GET /__shell/panel/report?' + world.chrome.negativeControl.query + ': status=' + String(sentinel.status) + ' lease before=' + show(world.chrome.negativeControl.leaseBefore) + ' after=' + show(world.chrome.negativeControl.leaseAfter))
  /* THE STAGING the rest of this reading needs, held open by the claim below: the beacon above left a kind
   * this click cannot collide with, and NO further claim is made between here and the witness below. That
   * is a measured discipline, not a comment: the witness reads the state and the gesture follows with
   * nothing but the two page reads in between. */
  const heldAfterNegative = await claimToHold(3)
  world.chrome.negativeControl.claimedAfter = heldAfterNegative.claimed === true
  const witness = await stateOf()
  const stateHeld = witness.state
  world.chrome.holdBeforeClick = { claimed: heldAfterNegative.claimed === true, attempts: heldAfterNegative.attempts, firstClaim: heldFirst.claimed === true, lease: stateHeld === null || stateHeld === undefined ? null : stateHeld.lease, input: inputWitnessOf(stateHeld) }
  say('the gate holds the panel again, ready to click: ' + show(world.chrome.holdBeforeClick.lease) + ' input=' + show(world.chrome.holdBeforeClick.input))
  pre('5-marker-witness-before-the-gesture',
    'the marker the shell holds IMMEDIATELY before the gesture must be either empty or a kind the click cannot be swallowed by - a marker of the shell-control shape is exactly what eats the click. The harness cannot know which kind the control will write until it writes, so the sufficient condition is checked now (this gate fabricated kind is not of that shape) and the exactly-once increment of userInputReports is read afterwards, in the same window',
    stateHeld !== null && stateHeld !== undefined && (stateHeld.lastUserInput === null || stateHeld.lastUserInput === undefined || String(stateHeld.lastUserInput).indexOf('shell-control') !== 0)
    && stateHeld.mode === 'fixed',
    { lastUserInput: stagedWorld.lastUserInput, reports: stagedWorld.reports, lease: stagedLease, handedMarker: world.chrome.preStaging.handedMarker },
    { lastUserInput: stateHeld === null || stateHeld === undefined ? null : stateHeld.lastUserInput, reports: stateHeld === null || stateHeld === undefined ? null : stateHeld.userInputReports, lease: stateHeld === null || stateHeld === undefined ? null : stateHeld.lease },
    stateHeld !== null && stateHeld !== undefined && String(stateHeld.lastUserInput).indexOf('shell-control') === 0 ? 'a leftover control-shaped marker was already recorded when the gesture was about to start: this click would be de-duplicated away (note_shell_control), so reading 5 is NOT MEASURED rather than red' : null)
  pre('5-the-gate-owns-the-turn-before-the-click',
    'the lease must be held by THIS gate when the gesture starts, because the takeover record names the holder it took the panel from and that name has to be this gate for the record to be about this gate',
    stateHeld !== null && stateHeld !== undefined && stateHeld.lease !== null && stateHeld.lease !== undefined && stateHeld.lease.held === true && stateHeld.lease.holder === HOLDER,
    { lease: stagedWorld.lease === undefined ? null : stagedWorld.lease },
    { lease: stateHeld === null || stateHeld === undefined ? null : stateHeld.lease },
    null)
  world.chrome.bareBefore = await cdpEval(null, PAGE_EXPRESSION, false)
  /* THE HARVEST, and it is deliberately the LAST read before the gesture: browser-side reads of the PAGE
   * follow (those do not touch the marker), and nothing that can move an input marker does. */
  const harvest = await stateOf()
  world.chrome.beforeClick = { state: harvest.state, page: await readPage() }
  const harvestInput = inputWitnessOf(world.chrome.beforeClick.state)
  world.chrome.witness = { staged: world.chrome.preStaging === null ? null : { reports: world.chrome.preStaging.reports, lastUserInput: world.chrome.preStaging.lastUserInput, viewport: world.chrome.preStaging.viewport }, harvest: harvestInput, sentinel: FABRICATED_KIND, beaconStatus: sentinel.status }
  say('the WITNESS immediately before the gesture: ' + show(harvestInput) + ' | staged kind=' + show(FABRICATED_KIND) + ' | outside caller (no holder) BEFORE the click: ' + show({ status: world.chrome.bareBefore.status, error: world.chrome.bareBefore.error }))
  /* R180: the gesture is NOT dispatched into a world the gate could not stage. A click sent into a world
   * whose input marker is already a control-shaped kind would be swallowed by the shell's own de-duplication,
   * and reporting that as "the click was not user input" would be blaming the product for the world. */
  const unstageable = world.preconditions.filter((row) => String(row.id).indexOf('5-') === 0 && row.ok !== true)
  const dispatch = async (type) => {
    const answer = await panelPost({ op: 'cdp', tab: 'chrome', holder: HOLDER, method: 'Input.dispatchMouseEvent', params: { type: type, x: control.clickAt.x, y: control.clickAt.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, timeoutMs: 12000 })
    const record = { type: type, status: answer.status, error: answer.body === null ? null : answer.body.error }
    world.chrome.clicks.push(record)
    return record
  }
  if (control.clickAt !== null && unstageable.length > 0) {
    world.chrome.gestureWithheld = unstageable.map((row) => row.id)
    say('the click was WITHHELD: the world could not be staged and witnessed for it (' + show(world.chrome.gestureWithheld) + '), so the gate did not dispatch a gesture into a world it did not establish')
  } else if (control.clickAt !== null) {
    world.chrome.gestureWithheld = null
    /* THE WHOLE GESTURE, in one piece, under the gate's own lease. The shell page's own reporter no longer
     * reports pointer events (panel_reporter.js, /__shell/browser), so the press revokes nothing and the
     * release is an ordinary write: the click COMPLETES, and the takeover is written by the op the control
     * itself sends. That is why every assertion about the takeover is read AFTER the gesture. */
    await dispatch('mouseMoved')
    await dispatch('mousePressed')
    await dispatch('mouseReleased')
    say('the whole gesture was dispatched under the gate own lease: ' + show(world.chrome.clicks))
    await sleep(1600)
  } else {
    say('there was no clickable resolution control in the shell page, so no click was dispatched')
  }
  const afterClickState = (await stateOf()).state
  world.chrome.afterClick = { state: afterClickState }
  say('after the click (nothing here was read before the gesture was over): lease=' + show(afterClickState === null || afterClickState === undefined ? null : afterClickState.lease) + ' viewport=' + show(afterClickState === null || afterClickState === undefined ? null : afterClickState.viewport) + ' lastUserInput=' + show(afterClickState === null || afterClickState === undefined ? null : afterClickState.lastUserInput))
  /* R180: the POST-GESTURE read, judged against the witness. this is where 'the click was ONE new input' is
   * decided, and where a window somebody else walked into is named as unmeasurable rather than as a product
   * fault: op=lease{claim} clears the takeover record, so a foreign claimant inside this window produces
   * exactly the shape the old gate reported as a red reading 5 while the product was fine. */
  const postInput = inputWitnessOf(afterClickState)
  const postLease = afterClickState === null || afterClickState === undefined || afterClickState.lease === undefined ? null : afterClickState.lease
  const delta = postInput === null || postInput.userInputReports === null || harvestInput === null || harvestInput.userInputReports === null ? null : Number(postInput.userInputReports) - Number(harvestInput.userInputReports)
  const kindOfClick = postLease === null || postLease.revokedKind === undefined || postLease.revokedKind === null ? null : String(postLease.revokedKind)
  const controlShape = kindOfClick === null ? false : kindOfClick.indexOf('shell-control') === 0
  const took = postLease !== null && postLease.held === false && postLease.revokedBy === 'user-input'
  /* THE HONEST SPLIT, decided here and printed, between "the world moved under me" and "the click did not
   * count". Nothing at all happened (delta 0, no takeover) is NOT a world problem - it is exactly the swallow
   * this reading exists to catch, so it stays red. A window that moved by more than the one click, or a
   * takeover that is there but by something that is not a control write, is the world: op=lease{claim} clears
   * BOTH the revocation record and the marker, so a foreign claim inside the window produces a reading that
   * says nothing about this click. That case is reported unmeasured rather than red. */
  const unmeasuredWindow = (delta !== 1 && delta !== 0) || (delta === 0 && took === true)
  pre('5-post-gesture-window-was-isolated',
    'between the witness and this read, nothing but this click may have moved the input marker (exactly one new input), and a takeover, if one is there, must name a control write. Signals that somebody else acted inside the window: userInputReports moved by more than one, or a takeover by a kind that is not the control\u0027s own write; the record having been CLEARED by a foreign op=lease{claim} shows up as a delta of 0 with a stale takeover shape. In those cases this reading says NOT MEASURED, because the product is not what moved',
    unmeasuredWindow !== true,
    { reports: harvestInput === null ? null : harvestInput.userInputReports, lastUserInput: harvestInput === null ? null : harvestInput.lastUserInput, lease: harvestInput === null ? null : harvestInput.lease },
    { reports: postInput === null ? null : postInput.userInputReports, lastUserInput: postInput === null ? null : postInput.lastUserInput, lease: postLease },
    unmeasuredWindow === true ? ('the window moved by ' + show(delta) + ' new input(s) with revokedKind=' + show(postLease === null ? null : postLease.revokedKind) + ', so "the click was the one new input" cannot be decided in this world') : null)
  world.chrome.postGesture = { reports: postInput === null ? null : postInput.userInputReports, lastUserInput: postInput === null ? null : postInput.lastUserInput, lease: postLease, delta: delta, attributable: controlShape === true, unmeasured: unmeasuredWindow === true }
  world.chrome.afterClickInput = postInput
  say('WITNESS-JUDGEMENT: reports ' + show(harvestInput === null ? null : harvestInput.userInputReports) + ' -> ' + show(postInput === null ? null : postInput.userInputReports) + ' (delta=' + show(delta) + ') | lastUserInput ' + show(harvestInput === null ? null : harvestInput.lastUserInput) + ' -> ' + show(postInput === null ? null : postInput.lastUserInput) + ' | revokedKind=' + show(postLease === null ? null : postLease.revokedKind) + ' | ' + (unmeasuredWindow === true ? 'NOT MEASURED: somebody else moved this window' : (delta === 1 && controlShape === true ? 'measured: exactly one new input, recorded as the control own write' : (delta === 0 && took !== true ? 'measured: NOTHING happened - the click was swallowed (this is the shape reading 5 exists to catch)' : 'measured: exactly one new input'))))
  /* ASSERTION C, first half: the SAME op=cdp WITHOUT a holder, immediately after the click. */
  world.chrome.bareAfter = await cdpEval(null, PAGE_EXPRESSION, false)
  const reclaim = await claimToHold(3)
  world.chrome.reClaimed = reclaim.claimed === true
  world.chrome.afterReClaim = await cdpEval(null, PAGE_EXPRESSION, true)
  /* ...and the page has to catch up with the new viewport (the renderer resizes asynchronously), so the SAME
   * call is repeated until the page reports what the control named - or the patience runs out. */
  let pageRead = world.chrome.afterReClaim
  const untilPage = Date.now() + 6000
  while (control.expected !== null && control.expected !== undefined && Date.now() < untilPage
    && (pageRead.value === null || typeof pageRead.value !== 'object' || Number(pageRead.value.iw) !== control.expected.w || Number(pageRead.value.ih) !== control.expected.h)) {
    await sleep(700)
    pageRead = await cdpEval(null, PAGE_EXPRESSION, true)
    world.chrome.pageReads = world.chrome.pageReads + 1
  }
  world.chrome.afterReClaimPage = { status: pageRead.status, ok: pageRead.ok, error: pageRead.error, value: pageRead.value, page: pageRead.value !== null && typeof pageRead.value === 'object' ? pageRead.value : null }
  say('ASSERTION C: the same op=cdp WITHOUT a holder right after the click: ' + show({ status: world.chrome.bareAfter.status, error: world.chrome.bareAfter.error }) + ' | after a fresh claim: ' + show({ status: world.chrome.afterReClaim.status, error: world.chrome.afterReClaim.error }) + ' | the page now reports ' + show(world.chrome.afterReClaimPage.page))

  // ---- reading 6: the tab boundary
  const tabState = (await stateOf()).state
  const limit = tabState === null || tabState === undefined ? null : tabState.limit
  const tabs = tabState === null || tabState === undefined || tabState.tabs === undefined ? [] : tabState.tabs
  const originalActive = tabState === null || tabState === undefined ? null : tabState.active
  const opened = []
  let refusal = null
  if (typeof limit === 'number' && limit > 0) {
    for (let index = tabs.length; index < limit; index += 1) {
      const answer = await panelPost({ op: 'tab-new', url: 'http://127.0.0.1:' + PORT + '/__shell/panel-start', holder: HOLDER })
      if (answer.status !== 200) { refusal = answerOf(answer); break }
      opened.push(answer.body === null || answer.body.tab === undefined ? null : answer.body.tab)
      await sleep(400)
    }
    if (refusal === null) {
      const answer = await panelPost({ op: 'tab-new', url: 'http://127.0.0.1:' + PORT + '/__shell/panel-start', holder: HOLDER })
      refusal = answerOf(answer)
    }
  }
  const afterTabs = (await stateOf()).state
  const chromeAtCap = await readChrome()
  /* R180 PRECONDITION: the boundary is judged against the limit the SHELL declares and a tab set the gate
   * filled itself; both are read here, so a world that was already at the cap when the gate arrived is named
   * rather than judged (the loop above opens tabs until the shell refuses, which is what makes this true). */
  const openedCount = afterTabs === null || afterTabs === undefined ? null : afterTabs.count
  pre('6-the-tab-set-was-opened-to-the-declared-cap',
    'the boundary needs a positive limit from the shell and a count that reached it, because the (limit+1)th op=tab-new is what the refusal is read from',
    typeof limit === 'number' && limit > 0 && openedCount === limit && opened.length === Math.max(0, limit - tabs.length),
    { limit: limit, countBefore: tabs.length, opened: opened }, { limit: limit, countAfter: openedCount, opened: opened },
    openedCount === limit ? null : 'the gate opened ' + String(opened.length) + ' tab(s) and the shell reports count=' + show(openedCount) + ' against limit=' + show(limit))
  world.tabs = { limit: limit, before: { state: tabState }, opened: opened, refusal: refusal, after: { state: afterTabs }, chrome: { status: chromeAtCap.status, error: chromeAtCap.error, chrome: chromeAtCap.chrome } }
  say('tab boundary: limit=' + show(limit) + ' opened=' + show(opened) + ' refusal=' + show(refusal === null ? null : { status: refusal.status, error: refusal.error }) + ' count=' + show(afterTabs === null || afterTabs === undefined ? null : afterTabs.count))
  const closed = []
  for (const id of opened) {
    if (typeof id !== 'string') continue
    const answer = await panelPost({ op: 'tab-close', id: id, holder: HOLDER })
    if (answer.status === 200) closed.push(id)
    await sleep(250)
  }
  if (typeof originalActive === 'string') await panelPost({ op: 'tab-activate', id: originalActive, holder: HOLDER })
  await sleep(500)
  const restoredState = (await stateOf()).state
  const restoredCount = restoredState === null || restoredState === undefined ? null : restoredState.count
  const restoredActive = restoredState === null || restoredState === undefined ? null : restoredState.active
  world.tabs.restored = { closed: closed, activated: originalActive, count: restoredCount, active: restoredActive, ok: closed.length === opened.length && (typeof originalActive !== 'string' || restoredActive === originalActive) }
  say('tab set restored: ' + show(world.tabs.restored))

  // ---- put the world back: the resolution it started with, then the browser the way it was found
  const startState = world.start.state
  const startViewport = startState === null || startState === undefined ? null : startState.viewport
  world.restore = { startViewport: startViewport === null || startViewport === undefined ? null : startViewport, handed: snap, restored: null, unrecoverable: [] }
  if (startViewport !== null && startViewport !== undefined) {
    const answer = await panelPost({ op: 'viewport', preset: String(startViewport.w) + 'x' + String(startViewport.h), holder: HOLDER })
    world.restore.viewport = { status: answer.status, error: answer.body === null ? null : answer.body.error }
    if (answer.status !== 200) {
      const retry = await panelPost({ op: 'viewport', width: startViewport.w, height: startViewport.h, holder: HOLDER })
      world.restore.viewportRetry = { status: retry.status, error: retry.body === null ? null : retry.body.error }
    }
  }
  if (world.mountedByGate === true) {
    const down = await panelPost({ op: 'unmount', holder: HOLDER })
    world.restore.unmount = { status: down.status, error: down.body === null ? null : down.body.error }
  }
  /* R180 RESET, the tab half: the gate opened tabs for the boundary reading and closed them, but a world
   * handed an empty tab set must not be handed back a tab the gate left behind. Anything that is not in the
   * snapshot's own tab list is closed here, and the snapshot's active tab is activated again if it survived -
   * so the closing read below can say "the tab set is the one this run was handed" and not merely "the
   * count looks about right". */
  const beforeClose = await stateOf()
  const liveTabs = beforeClose.state === null || beforeClose.state === undefined || beforeClose.state.tabs === undefined || beforeClose.state.tabs === null ? [] : beforeClose.state.tabs
  const openIds = liveTabs.map((row) => row === null || row === undefined ? null : row.id)
  const handedIds = snap === null || snap === undefined ? null : snap.tabs
  const strays = handedIds === null ? [] : openIds.filter((id) => typeof id === 'string' && handedIds.indexOf(id) < 0)
  const strayClosed = []
  for (const id of strays) {
    const answer = await panelPost({ op: 'tab-close', id: id, holder: HOLDER })
    if (answer.status === 200) strayClosed.push(id)
    await sleep(200)
  }
  if (strayClosed.length > 0 && snap !== null && snap !== undefined && typeof snap.active === 'string' && openIds.indexOf(snap.active) >= 0) await panelPost({ op: 'tab-activate', id: snap.active, holder: HOLDER })
  world.restore.strayTabs = { opened: strays, closed: strayClosed, handedTabs: handedIds }
  await releaseLease(PORT, HOLDER)
  world.restore.released = true
  const endState = (await stateOf()).state
  world.restore.finalState = stateBrief(endState)
  world.restore.finalRaw = endState
  /* R180 THE WORLD RESET, SAID OUT LOUD. Everything the gate can put back is put back and then READ BACK
   * against the snapshot it took at the start; everything it cannot put back is named. A restore that did
   * not take is printed as a reading of its own - a gate that silently leaves the world moved is exactly how
   * the next run of this gate ends up measuring a world it did not choose. */
  const finalTabs = endState === null || endState === undefined || endState.tabs === undefined || endState.tabs === null ? null : endState.tabs.map((row) => row === null || row === undefined ? null : row.id).slice().sort()
  const handedTabs = snap === null || snap.tabs === null || snap.tabs === undefined ? null : snap.tabs.slice().sort()
  const sameList = (left, right) => left === null || right === null ? null : (left.length === right.length && left.every((id, at) => id === right[at]))
  world.restore.restored = {
    viewport: endState === null || endState === undefined ? null : endState.viewport,
    viewportMatchesHanded: snap === null || snap === null ? null : sameNumbers(endState === null || endState === undefined ? null : endState.viewport, snap.viewport),
    mode: endState === null || endState === undefined ? null : endState.mode,
    modeMatchesHanded: snap === null ? null : (endState === null || endState === undefined ? null : endState.mode) === snap.mode,
    count: endState === null || endState === undefined ? null : endState.count,
    countMatchesHanded: snap === null ? null : (endState === null || endState === undefined ? null : endState.count) === snap.count,
    active: endState === null || endState === undefined ? null : endState.active,
    activeMatchesHanded: snap === null ? null : (endState === null || endState === undefined ? null : endState.active) === snap.active,
    tabs: finalTabs, tabsMatchHanded: sameList(finalTabs, handedTabs),
    leaseHeld: endState === null || endState === undefined || endState.lease === undefined || endState.lease === null ? null : endState.lease.held,
    lastUserInput: endState === null || endState === undefined ? null : endState.lastUserInput,
    reports: endState === null || endState === undefined ? null : endState.userInputReports,
    reportsHanded: snap === null || snap === undefined || snap.input === null || snap.input === undefined ? null : snap.input.userInputReports,
  }
  if (world.restore.restored.viewportMatchesHanded !== true && snap !== null && snap !== undefined && snap.viewport !== null && snap.viewport !== undefined) {
    const retry = await panelPost({ op: 'viewport', width: snap.viewport.w, height: snap.viewport.h, holder: HOLDER })
    world.restore.viewportSecondTry = { status: retry.status, error: retry.body === null ? null : retry.body.error }
  }
  world.restore.unrecoverable = [
    'userInputReports is a monotonic per-process counter (' + show(world.restore.restored.reportsHanded) + ' when this gate was handed the world, ' + show(world.restore.restored.reports) + ' now): it cannot be put back by any contract op. What is put back instead is the lastUserInput MARKER, which is the only input field a reading can be swallowed by (note_shell_control reads last_user_input, never the counter).',
    'the lease: this gate releases the turn it took, it does not re-lease anybody else. If the world was handed a lease, restoring THAT holder is not something this gate can do on its behalf (it would be claiming somebody else\u0027s turn).',
    world.mountedByGate === true ? 'the browser: this gate raised it with op=open, so it takes it down again - the world is handed back with the browser as it was FOUND (not up).' : 'the browser: it was already up when this gate arrived, and the gate leaves it up.',
  ]
  say('restore: ' + show(world.restore))
  say('world handed back: the gate declares what it put back and what it could not - ' + show({ restored: world.restore.restored, unrecoverable: world.restore.unrecoverable }))
  return world
}

// ------------------------------------------------------------------------------------------- self-attack
const HONEST = () => {
  const bay = { units: 'logical', x: 900, y: 156, w: 640, h: 552 }
  const screen = { units: 'logical', x: 900, y: 252, w: 640, h: 360 }
  const names = ['1280x800', '1024x768', '1366x768', '1440x900', '1600x900', '1920x1080', '834x1194', '390x844']
  const state1920 = { viewport: { w: 1920, h: 1080 }, viewportPreset: '1920x1080', mode: 'fixed', modeApplied: true, scale: 0.3333, bayPane: bay, screenPane: screen, count: 1, limit: 4, mounted: true, lease: { held: true, holder: HOLDER, revokedBy: null } }
  const ok200 = { status: 200, ok: true, error: null }
  const page1920 = { status: 200, ok: true, error: null, value: { iw: 1920, ih: 1080 }, page: { iw: 1920, ih: 1080, dpr: 1, url: 'http://127.0.0.1:31761/__shell/panel-start' } }
  const page1280 = { status: 200, ok: true, error: null, value: { iw: 1280, ih: 800 }, page: { iw: 1280, ih: 800, dpr: 1, url: 'http://127.0.0.1:31761/__shell/panel-start' } }
  const refusedBad = { status: 400, error: 'named refusal: op=viewport got a size of 0x0: both numbers must be finite and between 200 and 5120 px, and the state was not changed' }
  return {
    kind: 'synthetic', holder: HOLDER, shellUp: true, cdpUp: true, factor: 1.5, preconditions: [],
    start: { state: { mounted: false, exists: false, count: 0, mode: 'fixed', viewport: { w: 1280, h: 800 } }, page: page1280 },
    changed: {
      before: { state: { viewport: { w: 1280, h: 800 }, scale: 0.5 }, page: page1280 },
      shapes: [{ label: '{width,height}=1920x1080', status: 200, error: null, unknownOp: false }], accepted: '{width,height}=1920x1080', keys: ['width', 'height'], acceptedName: null,
      after: { state: state1920, page: page1920 },
    },
    geometry: {
      bay: bay, screen: screen, viewport: { w: 1920, h: 1080 }, contentPane: bay, surface: { units: 'logical', x: 900, y: 120, w: 640, h: 600 },
      page: { screenAgrees: true, screenDrawn: { x: 0, y: 96, w: 640, h: 360 }, screenFromShell: { x: 0, y: 96, w: 640, h: 360 }, bayRect: { x: 0, y: 36, w: 640, h: 552 } },
    },
    preset: {
      resetShapes: [{ label: '{width,height}=1280x800', status: 200, error: null }], resetAccepted: '{width,height}=1280x800',
      before: { state: { viewport: { w: 1280, h: 800 }, presets: names.map((name) => ({ name: name })) }, page: page1280 },
      names: names,
      shapes: [{ label: '{preset:"1920x1080"}', status: 200, error: null }], accepted: '{preset:"1920x1080"}', acceptedName: '1920x1080',
      after: { state: state1920, page: page1920 },
      illegal: [
        { label: 'zero', payload: { width: 0, height: 0 }, record: refusedBad, state: state1920 },
        { label: 'negative', payload: { width: -1920, height: 1080 }, record: refusedBad, state: state1920 },
        { label: 'not-a-number', payload: { width: 'NaN', height: 1080 }, record: { status: 400, error: 'named refusal: op=viewport needs either preset (one of [1280x800, 1920x1080]) or both width and height' }, state: state1920 },
        { label: 'neither', payload: {}, record: { status: 400, error: 'named refusal: op=viewport needs either preset (one of [1280x800, 1920x1080]) or both width and height' }, state: state1920 },
      ],
    },
    persisted: {
      before: { state: state1920, page: page1920 }, unmount: { status: 200, ok: null, error: null }, mount: { status: 200, ok: null, error: null },
      after: { state: state1920, page: page1920 },
      prefs: { path: 'C:/Users/<user>/AppData/Roaming/dev.dshlink.client/dsh-link/browser.json', json: { viewport: { w: 1920, h: 1080 }, mode: 'fixed' }, text: '{ "viewport": { "w": 1920.0, "h": 1080.0 }, "mode": "fixed" }' },
    },
    chrome: {
      status: 200, error: null, innerW: 640, chromePaneW: 640, factor: 1,
      candidates: [{ tag: 'button', id: 'res', title: '当前分辨率 1280×800（1280x800）；点击切到下一个预设 1024x768；用 ✎ 输入自定义尺寸', words: 'button id=res 1280×800 当前分辨率 1280×800（1280x800）', rect: { x: 419, y: 6, w: 82, h: 24 }, disabled: false, visible: true }],
      button: { tag: 'button', id: 'res', title: '当前分辨率 1280×800（1280x800）；点击切到下一个预设 1024x768；用 ✎ 输入自定义尺寸', words: 'button id=res 1280×800 当前分辨率 1280×800（1280x800）', rect: { x: 419, y: 6, w: 82, h: 24 } },
      clickAt: { x: 460, y: 18 },
      expected: { w: 1024, h: 768, source: 'the control own TITLE names the next preset' },
      beforeSet: '{width,height}=1280x800', beforeSetTries: [{ label: '{width,height}=1280x800', status: 200, error: null }],
      clicks: [{ type: 'mouseMoved', status: 200, error: null }, { type: 'mousePressed', status: 200, error: null }, { type: 'mouseReleased', status: 200, error: null }],
      holdBeforeClick: { claimed: true, attempts: [true], firstClaim: true, lease: { held: true, holder: HOLDER, expiresInMs: 179000, revokedBy: null, revokedHolder: null, revokedKind: null }, input: { lastUserInput: 'gate-r179-fabricated-no-click', userInputReports: 5, lease: { held: true, holder: HOLDER, revokedBy: null } } },
      preStaging: { viewport: { w: 1280, h: 800 }, mode: 'fixed', reports: 5, lastUserInput: 'gate-r179-fabricated-no-click', target: { w: 1920, h: 1080 }, reset: { w: 1280, h: 800 }, expectedAfterClick: { w: 1024, h: 768, source: 'the control own TITLE names the next preset' }, clickAt: { x: 460, y: 18 } },
      witness: { staged: { reports: 5, lastUserInput: 'gate-r179-fabricated-no-click', viewport: { w: 1280, h: 800 } }, harvest: { lastUserInput: null, userInputReports: 5, lease: { held: true, holder: HOLDER, revokedBy: null } }, sentinel: 'gate-r180-fabricated-no-click', beaconStatus: 200 },
      gestureWithheld: null,
      postGesture: { reports: 6, lastUserInput: 'shell-control:viewport', lease: { held: false, holder: null, expiresInMs: 0, revokedBy: 'user-input', revokedHolder: HOLDER, revokedKind: 'shell-control:viewport' }, delta: 1, attributable: true, unmeasured: false },
      negativeControl: {
        kind: 'gate-r179-fabricated-no-click', status: 200, query: 'userInput=gate-r179-fabricated-no-click',
        leaseBefore: { held: true, holder: HOLDER, expiresInMs: 179000, revokedBy: null, revokedHolder: null, revokedKind: null },
        leaseAfter: { held: false, holder: null, expiresInMs: 0, revokedBy: 'user-input', revokedHolder: HOLDER, revokedKind: 'gate-r179-fabricated-no-click' },
        lastUserInput: 'gate-r179-fabricated-no-click', reports: 5, claimedAfter: true,
      },
      beforeClick: { state: { viewport: { w: 1280, h: 800 }, userInputReports: 5, lastUserInput: 'gate-r179-fabricated-no-click', lease: { held: true, holder: HOLDER, revokedBy: null } }, page: page1280 },
      bareBefore: ok200,
      afterClick: { state: { viewport: { w: 1024, h: 768 }, viewportPreset: '1024x768', userInputReports: 6, lastUserInput: 'shell-control:viewport', lease: { held: false, holder: null, expiresInMs: 0, revokedBy: 'user-input', revokedHolder: HOLDER, revokedKind: 'shell-control:viewport' } } },
      bareAfter: { status: 400, ok: null, error: 'the lease held by gate-r179-viewport was REVOKED by user-input (shell-control:viewport): claim the panel again to continue' },
      reClaimed: true,
      afterReClaim: ok200,
      afterReClaimPage: { status: 200, ok: true, error: null, value: { iw: 1024, ih: 768 }, page: { iw: 1024, ih: 768, dpr: 1 } },
      pageReads: 0,
    },
    tabs: {
      limit: 4, before: { state: { count: 1, limit: 4, active: 't1' } }, opened: ['t2', 't3', 't4'],
      refusal: { status: 400, error: 'named refusal: op=tab-new is not opening tab t5 because the limit is 4 tabs and 4 are live (t1, t2, t3, t4); close one first' },
      after: { state: { count: 4, limit: 4, active: 't4' } },
      chrome: { status: 200, error: null, chrome: { bar: { x: 0, y: 0, w: 640, h: 36 }, pills: [{ x: 34, y: 6, w: 100, h: 24 }, { x: 137, y: 6, w: 100, h: 24 }, { x: 240, y: 6, w: 100, h: 24 }, { x: 343, y: 6, w: 100, h: 24 }], plusDisabled: true } },
      restored: { closed: ['t2', 't3', 't4'], activated: 't1', count: 1, active: 't1', ok: true },
    },
    restore: { released: true, finalState: { viewport: { w: 1280, h: 800 } } },
  }
}

const selfAttack = () => {
  const honest = expects()
  let failures = 0
  const rows = []
  const baseline = judge(HONEST(), honest)
  const baselineRed = baseline.filter((reading) => reading.ok === false)
  console.log('  ' + (baselineRed.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC green world judged honestly is green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (baselineRed.length > 0) { failures += 1; for (const reading of baselineRed) console.log('        baseline red: ' + reading.id + '. ' + reading.detail) }
  console.log('          (SYNTHETIC, not the app: this exercises the judge, never the probe.)')
  const H = HONEST()
  const bay = { units: 'logical', x: 900, y: 156, w: 640, h: 552 }
  const screen = { units: 'logical', x: 900, y: 252, w: 640, h: 360 }
  const shown = (bayBox, screenBox) => ({ ...H, geometry: { ...H.geometry, bay: bayBox, screen: screenBox } })
  const mutants = [
    { name: 'op=viewport is accepted but the page never takes it (the shell reports a viewport the page does not have)', world: { ...H, changed: { ...H.changed, after: { state: H.changed.after.state, page: { status: 200, ok: true, error: null, page: { iw: 1280, ih: 800 } } } } }, mustRedden: ['1-resolution-changed'] },
    { name: 'the preview screen carries the BAY aspect instead of the viewport aspect (stretched)', world: shown(bay, { units: 'logical', x: 900, y: 156, w: 640, h: 552 }), mustRedden: ['3-vm-preview-geometry'] },
    { name: 'the preview screen is 80px off-centre down the bay', world: shown(bay, { units: 'logical', x: 900, y: 212, w: 640, h: 360 }), mustRedden: ['3-vm-preview-geometry'] },
    { name: 'the geometry reading is handed no bay/screen pair at all', world: { ...H, geometry: { bay: null, screen: null, viewport: { w: 1920, h: 1080 }, contentPane: null, surface: null, page: null } }, mustRedden: ['3-vm-preview-geometry'] },
    { name: 'the page paints the screen somewhere else than the shell reports', world: { ...H, geometry: { ...H.geometry, page: { ...H.geometry.page, screenAgrees: false, screenDrawn: { x: 40, y: 40, w: 400, h: 225 } } } }, mustRedden: ['3-vm-preview-geometry'] },
    { name: 'the preset is accepted and does nothing (the viewport stays where the gate put it)', world: { ...H, preset: { ...H.preset, after: { state: { ...H.preset.after.state, viewport: { w: 1280, h: 800 } }, page: H.preset.after.page } } }, mustRedden: ['2-preset-and-named-refusal'] },
    { name: 'the preset applies but the state never reports it as the current preset', world: { ...H, preset: { ...H.preset, after: { state: { ...H.preset.after.state, viewportPreset: null }, page: H.preset.after.page } } }, mustRedden: ['2-preset-and-named-refusal'] },
    { name: 'an unusable resolution is accepted silently (zero reaches the page)', world: { ...H, preset: { ...H.preset, illegal: H.preset.illegal.map((attempt, index) => index === 0 ? { ...attempt, record: { status: 200, error: null } } : attempt) } }, mustRedden: ['2-preset-and-named-refusal'] },
    { name: 'the refusal never names the problem (a bare 400 with no number in it)', world: { ...H, preset: { ...H.preset, illegal: H.preset.illegal.map((attempt) => ({ ...attempt, record: { status: 400, error: 'bad request' } })) } }, mustRedden: ['2-preset-and-named-refusal'] },
    { name: 'the resolution is never written to disk (the shell reports no file)', world: { ...H, persisted: { ...H.persisted, prefs: null } }, mustRedden: ['4-persisted-across-remount'] },
    { name: 'the file on disk still holds the OLD resolution', world: { ...H, persisted: { ...H.persisted, prefs: { path: 'C:/x/browser.json', json: { viewport: { w: 1280, h: 800 }, mode: 'fixed' } } } }, mustRedden: ['4-persisted-across-remount'] },
    { name: 'the resolution is forgotten across the remount (the fresh page comes back at 1280x800)', world: { ...H, persisted: { ...H.persisted, after: { state: { ...H.persisted.after.state, viewport: { w: 1280, h: 800 }, modeApplied: false }, page: { status: 200, ok: true, error: null, page: { iw: 1280, ih: 800 } } } } }, mustRedden: ['4-persisted-across-remount'] },
    { name: 'the shell page is clicked but nothing is treated as user input (no takeover, no kind, and the outside caller is let in)', world: { ...H, chrome: { ...H.chrome, afterClick: { state: { ...H.chrome.afterClick.state, lease: { held: true, holder: HOLDER, expiresInMs: 170000, revokedBy: null, revokedHolder: null, revokedKind: null } } }, bareAfter: { status: 200, ok: true, error: null } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the click own op is swallowed by the shell own de-duplication (the same kind is already the last recorded input), so the panel stays with the AI', world: { ...H, chrome: { ...H.chrome, afterClick: { state: { ...H.chrome.afterClick.state, viewport: { w: 1280, h: 800 }, userInputReports: H.chrome.beforeClick.state.userInputReports, lastUserInput: 'shell-control:viewport', lease: { held: true, holder: HOLDER, expiresInMs: 170000, revokedBy: null, revokedHolder: null, revokedKind: null } } }, afterReClaimPage: { status: 200, ok: true, error: null, value: { iw: 1280, ih: 800 }, page: { iw: 1280, ih: 800, dpr: 1 } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the takeover is recorded as a page-side EVENT instead of the control own write (revokedKind="pointerdown": the shape before R179-A)', world: { ...H, chrome: { ...H.chrome, afterClick: { state: { ...H.chrome.afterClick.state, lease: { ...H.chrome.afterClick.state.lease, revokedKind: 'pointerdown' } } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'op=state stopped carrying revokedKind at all (the field this reading REQUIRES is absent, not wrong)', world: { ...H, chrome: { ...H.chrome, afterClick: { state: { ...H.chrome.afterClick.state, lease: { held: false, holder: null, revokedBy: 'user-input', revokedHolder: HOLDER } } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the negative control does NOT reproduce: a bare beacon with no click no longer reads as user input', world: { ...H, chrome: { ...H.chrome, negativeControl: { ...H.chrome.negativeControl, leaseAfter: { held: true, holder: HOLDER, expiresInMs: 170000, revokedBy: null, revokedHolder: null, revokedKind: null } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the negative control is itself recorded as a CONTROL write, so the kind no longer separates a fabricated request from a control', world: { ...H, chrome: { ...H.chrome, negativeControl: { ...H.chrome.negativeControl, leaseAfter: { ...H.chrome.negativeControl.leaseAfter, revokedKind: 'shell-control:viewport' } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the click is cut in half: the mouseup is refused once the user has taken the panel, so the control never fires', world: { ...H, chrome: { ...H.chrome, clicks: [{ type: 'mouseMoved', status: 200, error: null }, { type: 'mousePressed', status: 200, error: null }, { type: 'mouseReleased', status: 400, error: 'the lease held by gate-r179-viewport was REVOKED by user-input (pointerdown): claim the panel again to continue' }], afterClick: { state: { ...H.chrome.afterClick.state, viewport: { w: 1280, h: 800 }, userInputReports: H.chrome.beforeClick.state.userInputReports, lease: { held: false, holder: null, revokedBy: 'user-input', revokedHolder: HOLDER, revokedKind: 'pointerdown' } } }, afterReClaimPage: { status: 200, ok: true, error: null, value: { iw: 1280, ih: 800 }, page: { iw: 1280, ih: 800, dpr: 1 } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the panel is taken by the click but the resolution the control names never reaches the PAGE', world: { ...H, chrome: { ...H.chrome, afterReClaimPage: { status: 200, ok: true, error: null, value: { iw: 1280, ih: 800 }, page: { iw: 1280, ih: 800, dpr: 1 } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'anybody can still write after the user took the panel (an op=cdp with no holder is accepted)', world: { ...H, chrome: { ...H.chrome, bareAfter: { status: 200, ok: true, error: null } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'a fresh claim does not give the gate the panel back after the click', world: { ...H, chrome: { ...H.chrome, reClaimed: false, afterReClaim: { status: 400, ok: null, error: 'the panel is leased by somebody else' } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the gate did not hold the panel before the click, so the takeover names somebody else', world: { ...H, chrome: { ...H.chrome, holdBeforeClick: { claimed: false, attempts: [false, false, false], lease: null }, afterClick: { state: { ...H.chrome.afterClick.state, lease: { ...H.chrome.afterClick.state.lease, revokedHolder: 'some-other-holder' } } } } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the control never names the next preset in its own title (the expectation would have to be guessed)', world: { ...H, chrome: { ...H.chrome, button: { ...H.chrome.button, title: '当前分辨率 1280×800（1280x800）' }, expected: null } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the shell page names the resolution only inside a select, which a click cannot open', world: { ...H, chrome: { ...H.chrome, candidates: [{ tag: 'option', id: '', title: '', words: 'option 1920x1080', rect: { x: 0, y: 0, w: 0, h: 0 }, disabled: false, visible: false }], button: null, clickAt: null } }, mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the tab cap is not enforced (the (limit+1)th tab opens)', world: { ...H, tabs: { ...H.tabs, refusal: { status: 200, error: null }, after: { state: { count: 5, limit: 4, active: 't5' } } } }, mustRedden: ['6-tab-boundary'] },
    { name: 'the cap refuses without naming the limit', world: { ...H, tabs: { ...H.tabs, refusal: { status: 400, error: 'no' } } }, mustRedden: ['6-tab-boundary'] },
    { name: 'a tab pill overflows the chrome bar', world: { ...H, tabs: { ...H.tabs, chrome: { status: 200, error: null, chrome: { bar: { x: 0, y: 0, w: 400, h: 36 }, pills: [{ x: 34, y: 6, w: 100, h: 24 }, { x: 137, y: 6, w: 100, h: 24 }, { x: 240, y: 6, w: 100, h: 24 }, { x: 343, y: 6, w: 100, h: 24 }], plusDisabled: true } } } }, mustRedden: ['6-tab-boundary'] },
    /* R180: the two worlds the NEXT run of this gate can inherit. Both are the world moving under the
     * reading, not the product failing, and both must be reported as NOT MEASURED rather than as a red
     * reading 5 - that distinction is the whole point of the staging this round added. */
    { name: 'R180 - the world was handed over with a leftover CONTROL-shaped input marker (the shell de-duplicates a repeated kind, so this click is swallowed before it can be new)', world: (() => {
      const base = HONEST()
      const afterClick = { state: { ...base.chrome.afterClick.state, userInputReports: base.chrome.beforeClick.state.userInputReports, viewport: { w: 1280, h: 800 }, lastUserInput: 'shell-control:viewport', lease: { held: true, holder: HOLDER, expiresInMs: 170000, revokedBy: null, revokedHolder: null, revokedKind: null } } }
      return {
        ...base,
        preconditions: base.preconditions.concat([preconditionOf('5-marker-witness-before-the-gesture', 'the marker the shell holds immediately before the gesture must not be a kind the click can be swallowed by', false, { lastUserInput: 'shell-control:viewport' }, { lastUserInput: 'shell-control:viewport' }, 'a leftover control-shaped marker was already recorded')]),
        chrome: { ...base.chrome, afterClick: afterClick, afterReClaimPage: { status: 200, ok: true, error: null, value: { iw: 1280, ih: 800 }, page: { iw: 1280, ih: 800, dpr: 1 } }, postGesture: { reports: base.chrome.beforeClick.state.userInputReports, lastUserInput: 'shell-control:viewport', lease: { held: true, holder: HOLDER, revokedBy: null, revokedKind: null }, delta: 0, attributable: false, unmeasured: false } },
      }
    })(), mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'R180 - somebody else claimed the panel inside the click window (op=lease{claim} clears the takeover record AND the marker): the window moved by 2, so this reading cannot be attributed and must say so', world: (() => {
      const base = HONEST()
      const afterClick = { state: { ...base.chrome.afterClick.state, userInputReports: base.chrome.beforeClick.state.userInputReports + 2, lastUserInput: null, lease: { held: true, holder: HOLDER, expiresInMs: 170000, revokedBy: null, revokedHolder: null, revokedKind: null } } }
      return {
        ...base,
        preconditions: base.preconditions.concat([preconditionOf('5-post-gesture-window-was-isolated', 'between the witness and this read, nothing but this click may have moved the input marker', false, { reports: base.chrome.beforeClick.state.userInputReports }, { reports: base.chrome.beforeClick.state.userInputReports + 2 }, 'the window moved by 2 new input(s)')]),
        chrome: { ...base.chrome, afterClick: afterClick, postGesture: { reports: base.chrome.beforeClick.state.userInputReports + 2, lastUserInput: null, lease: afterClick.state.lease, delta: 2, attributable: false, unmeasured: true } },
      }
    })(), mustRedden: ['5-shell-control-is-user-input'] },
    { name: 'the PRE-R179 world as a labelled fixture (no op=viewport at all, no bayPane/screenPane, no resolution control in the shell page): the shape this gate was written against', world: (() => {
      const page1280 = { status: 200, ok: true, error: null, value: { iw: 1280, ih: 800 }, page: { iw: 1280, ih: 800, dpr: 1 } }
      const unknown = { status: 400, error: 'unknown panel op "viewport"', unknownOp: true }
      const flat1280 = { viewport: { w: 1280, h: 800 }, mode: 'fixed', modeApplied: true, scale: 0.5, count: 1, limit: 4, mounted: true, lease: { held: true, holder: HOLDER, revokedBy: null } }
      return {
        ...H,
        changed: { before: { state: flat1280, page: page1280 }, shapes: [unknown], accepted: null, keys: null, acceptedName: null, after: { state: flat1280, page: page1280 } },
        geometry: { bay: null, screen: null, viewport: { w: 1280, h: 800 }, contentPane: null, surface: null, page: null },
        preset: {
          resetShapes: [unknown], resetAccepted: null, before: { state: flat1280, page: page1280 }, names: null,
          shapes: [unknown], accepted: null, acceptedName: null, after: { state: flat1280, page: page1280 },
          illegal: [{ label: 'zero', payload: { width: 0, height: 0 }, record: unknown, state: flat1280 }, { label: 'negative', payload: { width: -1920, height: 1080 }, record: unknown, state: flat1280 }, { label: 'not-a-number', payload: { width: 'NaN', height: 1080 }, record: unknown, state: flat1280 }],
        },
        persisted: { before: { state: flat1280, page: page1280 }, unmount: { status: 200, ok: null, error: null }, mount: { status: 200, ok: null, error: null }, after: { state: flat1280, page: page1280 }, prefs: null },
        chrome: {
          ...H.chrome, candidates: [{ tag: 'button', id: 'mode', title: '页面尺寸：恒定缩放 / 自适应跟随画面区', words: 'button id=mode 恒定', rect: { x: 534, y: 6, w: 43, h: 24 }, disabled: false, visible: true }],
          button: null, clickAt: null, expected: null, clicks: [],
          holdBeforeClick: { claimed: true, attempts: [true], lease: { held: true, holder: HOLDER, revokedBy: null } },
          negativeControl: null,
          beforeClick: { state: { ...flat1280, userInputReports: 2 }, page: page1280 },
          bareBefore: { status: 200, ok: true, error: null }, bareAfter: { status: 200, ok: true, error: null },
          afterClick: { state: { ...flat1280, userInputReports: 2 } }, reClaimed: false, afterReClaim: null, afterReClaimPage: null,
        },
      }
    })(), mustRedden: ['1-resolution-changed', '2-preset-and-named-refusal', '3-vm-preview-geometry', '4-persisted-across-remount', '5-shell-control-is-user-input'] },
    { name: 'a world where the gate could not raise a browser at all', world: { ...H, changed: null, geometry: null, preset: null, persisted: null, chrome: null, tabs: null }, mustRedden: ['1-resolution-changed', '2-preset-and-named-refusal', '3-vm-preview-geometry', '4-persisted-across-remount', '5-shell-control-is-user-input', '6-tab-boundary'] },
  ]
  for (const mutant of mutants) {
    const seen = judge(mutant.world, mutant.expect === undefined ? honest : mutant.expect).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const precise = seen.length === mutant.mustRedden.length && mutant.mustRedden.every((id) => seen.includes(id))
    if (precise === false) failures += 1
    rows.push({ declared: mutant.mustRedden, observed: seen, precise: precise })
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(seen) + ' declared=' + show(mutant.mustRedden))
  }
  const agree = rows.every((row) => row.precise === true)
  const declaredSet = Array.from(new Set(rows.flatMap((row) => row.declared))).sort()
  const observedSet = Array.from(new Set(rows.flatMap((row) => row.observed))).sort()
  const setsAgree = declaredSet.length === observedSet.length && declaredSet.every((id) => observedSet.includes(id))
  console.log('  ' + (setsAgree ? 'ok  ' : 'FAIL') + '  the gate can be reddened in exactly the readings it claims: declared set=' + show(declaredSet) + ' observed set=' + show(observedSet))
  console.log('  ' + (agree ? 'ok  ' : 'FAIL') + '  declaration set == observation set (\u58f0\u660e\u96c6 == \u89c2\u6d4b\u96c6): ' + String(mutants.length) + ' mutants, every mutant reddened exactly what it declared')
  console.log('  note the live probe was NOT exercised in this mode: --self-attack attacks the judge only.')
  return failures === 0 ? 0 : 1
}

// ------------------------------------------------------------------------------------------------ main
const main = async () => {
  if (SELF_ATTACK) return selfAttack()
  let world
  try { world = await collect() }
  catch (error) {
    console.log('  FAIL  collect(): the probe itself failed before collecting (a GATE bug, not a data verdict)')
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    return 1
  }
  if (world.noShell === true) { console.log('SKIP: no shell answered on 127.0.0.1:' + String(PORT) + '/__shell/panel, so the sidebar viewport measured NOTHING (the client is not up; this gate never starts it)'); return 3 }
  if (world.cdpUp === false) { console.log('SKIP: the shell answers but CDP is not on 127.0.0.1:' + String(CDP_PORT) + ', so this is not the live client this gate measures; nothing was measured'); return 3 }
  if (world.noLease === true) { console.log('SKIP: the panel lease could not be claimed (' + String(world.leaseReason) + ') and this gate must own the panel to place the bay it judges; nothing was measured'); return 3 }
  if (world.noPanel === true) { console.log('SKIP: op=open did not raise a browser, so there is no page, no shell page and no bay to measure; the gate touched no layout'); return 3 }
  console.log('  shell 127.0.0.1:' + String(PORT) + ' | cdp 9222=' + show(world.cdpUp === true) + ' | holder=' + HOLDER + ' | bay ' + show(BOX) + ' | ' + (world.mountedByGate === true ? 'the GATE raised the browser with op=open' : 'the world already had a browser up'))
  for (const line of world.progress) console.log('        ' + line)
  let readings
  try { readings = judge(world, expects()) }
  catch (error) {
    console.log('  FAIL  judge(): the judgement itself threw (a GATE bug, not a data verdict) - the world above is still printed')
    console.log('        ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join(' / ') : String(error)))
    return 1
  }
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const unmeasured = readings.filter((reading) => /NOT MEASURED/.test(reading.detail))
  const failed = readings.filter((reading) => reading.ok === false)
  console.log('  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed' + (unmeasured.length > 0 ? ' (' + String(unmeasured.length) + ' of them not measured in this world)' : ''))
  console.log('  reading 4 reads the file the choice is written to AND an in-process remount; the client restart itself is NOT measured (its lifecycle belongs to the shell producer).')
  if (unmeasured.length > 0) { console.log('SKIP: ' + String(unmeasured.length) + ' of ' + String(readings.length) + ' readings could not be measured in this world'); return 3 }
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()
