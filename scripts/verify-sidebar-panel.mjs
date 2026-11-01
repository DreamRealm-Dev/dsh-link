#!/usr/bin/env node
/**
 * R143-G (task-189): the sidebar panel's SHELL-SIDE contract, read live.
 *
 * Subject: POST /__shell/panel (src-tauri/src/core/proxy.rs:187) driving the one native child webview in
 * src-tauri/src/core/sidebar_panel.rs. The gate owns no expectations about how the shell implements it; it drives
 * the frozen five ops and judges only the readings the task names, each of which has to be observable:
 *
 *   1-pre     op=state before any open reports exists=false
 *   2-open    op=open on a SAME-ORIGIN http url reaches exists=true inside the deadline, second by second
 *   3-pool    the panel profile is <app local data>/sidebar-panels/p0 on disk, and is NOT the main window UDF
 *   4-bounds  op=set-bounds is reported back by op=state, in physical units as Windows reports them and in the
 *             logical units the page asked in (the scale factor is MEASURED, never assumed)
 *   5-proc    the panel has its own browser process: the msedgewebview2.exe count attributed by --user-data-dir
 *             to that profile goes up by exactly one, and the new one names the profile
 *   6-close   op=close takes exists back to false, the process count falls back inside the deadline, op=focus
 *             afterwards is REFUSED BY NAME (it is the op that NEEDS a panel: sidebar_panel.rs:1005 answers
 *             "no browser: mount it before focusing it"), and the set-bounds that follows does NOT RESURRECT
 *             the browser - a state read after it must still answer exists=false.
 *
 *             Why set-bounds is NOT held to "must report an error" any more, measured in R181 - this gate used
 *             to demand it and went red for a reason that was not the product's. op=set-bounds is a SURFACE
 *             DECLARATION, not a panel op: src-tauri/src/core/sidebar_panel.rs:1507-1532 (surface()) records
 *             the rect even when nothing is mounted and answers Ok, src-tauri/src/core/panel_host.js:78
 *             declares the pane's rectangle with it on every tick, and mount() reads panel.surface back when it
 *             creates the windows. Live reading, taken with no panel and no lease held (R181):
 *               op=set-bounds -> HTTP 200, and the SAME body answers exists:false
 *               op=focus      -> HTTP 400, named
 *             R180-D read that 200 as "the page host healed the panel back". It is not: the host cannot be
 *             inside the same answer as its own exists=false. Demanding an error from a declaration is a
 *             premise this gate invented, so what is asserted here is the promise that does exist - a
 *             declaration must never bring a CLOSED browser back.
 *
 *             The window this half is judged in is bounded, and the gate says so instead of pretending:
 *             panel_host.js:104-110 re-opens a panel it finds closed from outside after a 10 s grace ("a panel
 *             lost to a crash must come back"), and scripts/verify-sidebar-content.mjs:136-144 asserts that
 *             heal GREEN as the product behaviour 4-host-heals. So the gate CLAIMS THE PANEL LEASE for the
 *             whole reading (panel_host.js:96-102: while the lease is held the host "must not reopen, move or
 *             close anything"), every write it makes names that holder, so the lease itself can never be the
 *             cause of the refusal it observes, and both whether the lease was held and how long the
 *             close-to-assert window was are printed as evidence. If the lease could not be claimed the
 *             reading still runs and prints leaseHeld=false - a lease somebody else holds is not a
 *             measurement of this product.
 *
 * Discipline: every reading proves its own observation object exists before judging it; negative claims are paired
 * (a fall in a process count prints the count before it, and the poll timeline); catches wrap only the degradable
 * operations (an HTTP request, JSON.parse, a process listing). A programming error in this file must stay loud -
 * R133 measured what a wide catch does to a defect.
 *
 * One number that decides reading 4 is deliberately NOT written in this file: the display scale (1.5 on the machine
 * this gate was measured against). The scale is MEASURED from window.devicePixelRatio in the running page, and only
 * when that answers nothing is it DERIVED from the reported physical width over the requested logical width. A
 * hardcoded 1.5 would turn a 100 percent machine red for no reason and a 200 percent machine green for a wrong one.
 *
 * The frozen shape of a panel answer (R143 ruling): a 200 carries the report FLAT, a 400 carries it NESTED under
 * `state` beside `error`, so a future `error` key inside the report cannot collide with the command error.
 * The shapes are not interchangeable here: a non-200 body without `state` is a red reading, never a fallback.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when the app is not reachable over CDP, in
 * which case this gate MEASURED NOTHING and says so rather than reporting green.
 *
 * Usage: node scripts/verify-sidebar-panel.mjs [--cdp-port 9222] [--deadline-ms 15000] [--self-attack]
 *        [--expect-data-dir <path>] [--expect-rect x,y,w,h] [--expect-close-error on|off]
 *
 *        --expect-close-error is the paired control of reading 6's declaration half, and it means what the two
 *        rules actually are: on (default) - the shell ACCEPTS the post-close set-bounds, because it is a
 *        surface declaration (sidebar_panel.rs:1512), and the reading demands that accepting it does not
 *        resurrect the browser; off - this run says the shell must instead REFUSE it as though it needed a
 *        panel, and a world that refuses it then reddens the reading.
 *
 * --self-attack never touches the app: it judges a labelled SYNTHETIC world whose honest form is green, then
 * re-judges it with one expectation mutated at a time and requires the intended reading to go red. That proves the
 * judge can fail. It does NOT exercise the probe, so the probe stays unmeasured until someone runs the app.
 */
import { existsSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// R181: the lease is the product's own way to make the page host stand down (panel_host.js:96-102), and this
// gate needs that for reading 6 - see the 6-close note in the header. It is claimed before the housekeeping
// close and given back before the process exits.
import { claimLease, releaseLease } from './panel-lease.mjs'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const index = argv.indexOf(name); return index === -1 ? fallback : argv[index + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
/** The shell's own port. The page this gate measures is the one served there, not "whatever is first on the port". */
const SHELL_PORT = Number(option('--shell-port', '31761'))
const DEADLINE_MS = Number(option('--deadline-ms', '15000'))
const APP_ID = option('--app-id', 'dev.dshlink.client')
const SELF_ATTACK = has('--self-attack')
const LOCAL = process.env.LOCALAPPDATA || ''
const APP_LOCAL = join(LOCAL, APP_ID)
const MAIN_UDF = join(APP_LOCAL, 'EBWebView')
const PANEL_PROFILE = join(APP_LOCAL, 'sidebar-panels', 'p0')
const SENT_RECT = { x: 600, y: 90, w: 420, h: 600 }
// R182-G: the rectangle this gate declares FIRST, to give reading 4 a baseline of its own. Why it cannot simply
// read the state at open: the surface is a DECLARATION, and op=close does not clear it (unmount touches mounted,
// scale, hiddenStyle, tabs and content - sidebar_panel.rs:1620-1649 - and leaves panel.surface alone), so the
// "before" value belongs to whoever declared last. Every live sidebar gate declares 600,90,420,600, which made
// "the bounds did not change after set-bounds" a fact about the PREVIOUS gate (measured: red in R182-C's segment
// run, green when prepared in isolation). The gate now declares a distinguishing rect (the shell records a
// declaration even with nothing mounted - sidebar_panel.rs:1512), reads it back, and judges the ask against that.
const BASELINE_RECT = { x: SENT_RECT.x + 60, y: SENT_RECT.y + 40, w: SENT_RECT.w, h: SENT_RECT.h }
// Two logical pixels of slack: the shell converts logical to physical and rounds to integers on the way.
// R181: the holder this gate places and closes under, and the deadline that protects the world if this process
// dies before it gives the lease back (sidebar_panel.rs:595 - expiry is decided on read, on purpose, so a gate
// that crashes cannot wedge the panel for the next one).
const HOLDER = 'verify-sidebar-panel'
const LEASE_TTL_MS = 90000

const TOLERANCE = 2
const CDP_DEADLINE_MS = 15000

const rectFrom = (text, fallback) => {
  if (typeof text !== 'string') return fallback
  const parts = text.split(',').map((piece) => Number(piece.trim()))
  if (parts.length !== 4 || parts.some((value) => Number.isFinite(value) === false)) return fallback
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
}

/** The expectations the judge compares against; each one is overridable so a mutant can name itself on the command line. */
const expectations = (over = {}) => ({
  dataDir: over.dataDir ?? option('--expect-data-dir', PANEL_PROFILE),
  mainUdf: over.mainUdf ?? MAIN_UDF,
  rect: over.rect ?? rectFrom(option('--expect-rect', null), SENT_RECT),
  sentRect: over.sentRect ?? SENT_RECT,
  closeMustError: over.closeMustError ?? option('--expect-close-error', 'on') !== 'off',
  openMustExist: over.openMustExist ?? option('--expect-open-exists', 'true') !== 'false',
})

const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase() === right.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
const clip = (text, limit) => { const value = String(text ?? ''); return value.length > limit ? value.slice(0, limit) + '...' : value }
const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }

// ---------------------------------------------------------------------------------------------------------
// The judge: pure, over an observation object. Everything the gate claims about the product is decided here.
// ---------------------------------------------------------------------------------------------------------
const judge = (obs, expect) => {
  const readings = []
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === true, detail: String(detail), evidence: evidence ?? [] })
  const state = (name) => {
    const seen = obs.state?.[name]
    return seen === undefined ? null : seen
  }

  // --- 1-pre: the state before any open, and proof the route answered at all -------------------------
  {
    const pre = state('pre')
    if (pre === null) record('1-pre', false, 'op=state was never answered before the open, so exists=false is not established')
    else if (pre.status !== 200 || pre.report === null) record('1-pre', false, 'op=state did not answer the frozen shape: HTTP ' + String(pre.status) + ' shape=' + show(pre.shape) + ' (a 200 carries the report flat; anything else nests it under state)', ['body=' + clip(show(pre.body), 300)])
    else if (pre.report?.exists !== false) record('1-pre', false, 'exists before open is ' + show(pre.report?.exists) + ', expected false', ['body=' + clip(show(pre.body), 300)])
    else record('1-pre', true, 'op=state before any open: exists=false label=' + show(pre.report?.label), ['body=' + show(pre.body)])
  }

  // --- 2-open: the open reaches exists=true inside the deadline ---------------------------------------
  {
    const open = state('open')
    const opened = obs.opened ?? null
    const timeline = (obs.polls ?? []).map((poll) => poll.at + 's exists=' + show(poll.state?.report?.exists ?? null) + ' pending=' + show(poll.state?.report?.pending ?? null))
    if (open === null) record('2-open', false, 'op=open was never sent')
    else if (open.shape === 'missing-state') record('2-open', false, 'op=open answered HTTP ' + String(open.status) + ' without the frozen state report: body=' + clip(show(open.body), 300), timeline)
    else if (opened === null) record('2-open', false, 'the panel never reported exists=true within ' + String(DEADLINE_MS / 1000) + 's (open answered HTTP ' + open.status + ')', timeline)
    else if (expect.openMustExist === false) record('2-open', false, 'exists=true was observed, but this run was told to expect open to stay absent', timeline)
    else record('2-open', true, 'op=open reached exists=true at ' + opened.at + 's (open answered HTTP ' + open.status + ') url=' + show(opened.report?.url), timeline)
  }

  // --- 3-pool: the profile is the panel OWN profile, on disk, and not the main window UDF --------------
  {
    const opened = obs.opened?.report ?? null
    const dataDir = opened?.dataDir ?? null
    const problems = []
    if (dataDir === null) problems.push('no dataDir was reported by the opened panel')
    else {
      if (samePath(dataDir, expect.mainUdf)) problems.push('dataDir IS the main window UDF: ' + dataDir)
      if (samePath(dataDir, expect.dataDir) === false) problems.push('dataDir is ' + dataDir + ', expected ' + expect.dataDir)
      if (/[/\\]sidebar-panels[/\\]/i.test(String(dataDir)) === false) problems.push('dataDir is not under a sidebar-panels directory: ' + dataDir)
      if (/[\\/]p0\\?$/i.test(String(dataDir)) === false) problems.push('dataDir does not end in the panel profile p0: ' + dataDir)
      if (existsSync(String(dataDir)) === false) problems.push('dataDir does not exist on disk, so the claim that the profile is real is unproved: ' + dataDir)
      else if (statSync(String(dataDir)).isDirectory() === false) problems.push('dataDir exists but is not a directory: ' + dataDir)
    }
    const evidence = [
      'dataDir   = ' + show(dataDir),
      'mainUdf   = ' + expect.mainUdf + ' (equal=' + String(samePath(dataDir, expect.mainUdf)) + ')',
      'expected  = ' + expect.dataDir,
      'onDisk    = ' + String(dataDir !== null && existsSync(String(dataDir))),
    ]
    if (problems.length > 0) record('3-pool', false, problems.join(' | '), evidence)
    else record('3-pool', true, 'the panel runs in its own profile on disk, distinct from the main window UDF', evidence)
  }

  // --- 4-bounds: the rectangle the page asked for comes back, in both units ---------------------------
  {
    const before = obs.boundsBefore ?? null
    const after = obs.boundsAfter?.report?.bounds ?? null
    const baseline = obs.baseline ?? null
    // The write's answer is the gate's own {status, report, body} wrapper in the live run, and the flat report in the
    // synthetic world: both shapes are accepted here, and neither is assumed.
    const baselineAnswer = baseline === null ? null : baseline.report ?? null
    const baselineInner = baselineAnswer === null ? null : baselineAnswer.report ?? baselineAnswer
    const baselineReported = baselineInner === null ? null : baselineInner.bounds ?? null
    const scale = obs.scale?.value ?? null
    const problems = []
    // R182-G: the baseline has to be the rectangle THIS gate declared, or the reading is about the last actor.
    if (baseline === null || baselineReported === null) problems.push('the gate never got a report back for the baseline rectangle it declared (' + show(BASELINE_RECT) + '), so "the reported rect is the one asked for" cannot be told from "the answer is whatever was left behind"')
    else if (scale !== null) {
      const baseLogical = baselineReported.units === 'logical' ? baselineReported : { x: baselineReported.x / scale, y: baselineReported.y / scale, w: baselineReported.w / scale, h: baselineReported.h / scale }
      const baseWorst = Math.max(Math.abs(baseLogical.x - BASELINE_RECT.x), Math.abs(baseLogical.y - BASELINE_RECT.y), Math.abs(baseLogical.w - BASELINE_RECT.w), Math.abs(baseLogical.h - BASELINE_RECT.h))
      if (baseWorst > TOLERANCE) problems.push('the rectangle this gate declared as its baseline is not the one reported back: declared=' + show(BASELINE_RECT) + ' reported=' + show(baseLogical) + ' worstDelta=' + baseWorst.toFixed(2))
    }
    if (after === null) problems.push('op=state after set-bounds carried no bounds')
    if (scale === null) problems.push('no scale factor was measured, so the units cannot be compared')
    if (after !== null && before !== null && show(before) === show(after)) problems.push('bounds did not change at all after set-bounds: ' + show(after))
    if (after !== null && samePath2(obs.sentRect, expect.sentRect) === false) problems.push('the request that was sent is not the one this run expected: sent=' + show(obs.sentRect))
    if (after !== null && scale !== null) {
      const logical = after.units === 'logical'
        ? after
        : { x: after.x / scale, y: after.y / scale, w: after.w / scale, h: after.h / scale }
      const wanted = expect.rect
      const deltas = { x: logical.x - wanted.x, y: logical.y - wanted.y, w: logical.w - wanted.w, h: logical.h - wanted.h }
      const worst = Math.max(...Object.values(deltas).map((value) => Math.abs(value)))
      if (worst > TOLERANCE) problems.push('the reported rect does not match the request in logical units: worstDelta=' + worst.toFixed(2) + ' tolerance=' + TOLERANCE)
      const evidence = [
        'baseline the gate declared first = ' + show(BASELINE_RECT) + ' -> reported ' + show(baselineReported),
        'sent            = ' + show(obs.sentRect),
        'reported        = ' + show(after) + ' (units=' + show(after.units) + ', as the shell reports them)',
        'scale           = ' + show(scale) + ' from ' + show(obs.scale?.source),
        'convertedLogical= ' + show({ x: round1(logical.x), y: round1(logical.y), w: round1(logical.w), h: round1(logical.h) }),
        'expectedLogical = ' + show(wanted),
        'delta           = ' + show({ x: round1(deltas.x), y: round1(deltas.y), w: round1(deltas.w), h: round1(deltas.h) }),
      ]
      if (problems.length > 0) record('4-bounds', false, problems.join(' | '), evidence)
      else record('4-bounds', true, 'set-bounds is reported back as the requested rectangle', evidence)
    } else {
      record('4-bounds', false, problems.join(' | '), ['after=' + show(after), 'scale=' + show(scale)])
    }
  }

  // --- 5-proc: the panel owns a browser process, named by its profile --------------------------------
  {
    const before = obs.procs?.before ?? null
    const after = obs.procs?.after ?? null
    const dataDir = obs.opened?.report?.dataDir ?? null
    const problems = []
    if (before === null || after === null) problems.push('the webview2 process list was not taken on both sides')
    else {
      const grown = after.length - before.length
      if (grown < 1) problems.push('the attributed msedgewebview2.exe count did not rise: before=' + String(before.length) + ' after=' + String(after.length))
      const added = after.filter((row) => before.some((held) => held.pid === row.pid) === false)
      // WebView2 runs a browser process plus child renderers, and every one of them repeats --user-data-dir.
      // The browser process is the one without --type=; that is the process this reading attributes the panel to.
      const browsers = added.filter((row) => /--type=/.test(String(row.cmdline)) === false)
      if (browsers.length !== 1) problems.push('the added processes do not carry exactly one browser process (a command line without --type=): added=' + String(added.length) + ' browsers=' + String(browsers.length))
      else if (namesProfile(browsers[0].cmdline, dataDir) === false) problems.push('the added browser process does not name the panel profile: --user-data-dir=' + show(userDataDirOf(browsers[0].cmdline)))
    }
    const evidence = [
      'attributedCount: before=' + String(before?.length ?? 'unmeasured') + ' after=' + String(after?.length ?? 'unmeasured') + ' (paired: the rise needs both numbers)',
      'added = ' + show((after ?? []).filter((row) => (before ?? []).some((held) => held.pid === row.pid) === false).map((row) => String(row.pid) + (/--type=/.test(String(row.cmdline)) ? ':child' : ':browser'))),
      'userDataDirs  = ' + clip((after ?? []).map((row) => String(userDataDirOf(row.cmdline))).join(' ; '), 400),
      'panelProfile  = ' + show(dataDir),
    ]
    if (problems.length > 0) record('5-proc', false, problems.join(' | '), evidence)
    else record('5-proc', true, 'the panel runs its own browser process, and that process names the panel profile', evidence)
  }

  // --- 6-close: close is clean, the op that NEEDS a panel refuses by name, and a DECLARATION never
  //             resurrects a closed browser (the whole reason, with file:lines, is in the header) ----------
  {
    const close = state('close')
    const post = obs.postClose ?? null
    const before = obs.procs?.before ?? null
    const afterClose = obs.procs?.afterClose ?? null
    const setBounds = obs.afterCloseCalls?.setBounds ?? null
    const focus = obs.afterCloseCalls?.focus ?? null
    const afterDeclaration = obs.afterCloseCalls?.stateAfterSetBounds ?? null
    const lease = obs.lease ?? null
    const problems = []
    const timeline = (obs.closePolls ?? []).map((poll) => poll.at + 's totalWebviews=' + String(poll.count))
    if (close === null) problems.push('op=close was never sent')
    else if (close.shape === 'missing-state') problems.push('op=close answered HTTP ' + String(close.status) + ' without the frozen state report: body=' + clip(show(close.body), 200))
    else if (close.report?.exists !== false) problems.push('exists after close is ' + show(close.report?.exists) + ', expected false')
    if (afterClose === null || before === null) problems.push('the process count after close was not taken')
    else if (afterClose.length !== before.length) problems.push('the attributed webview2 count did not fall back: before=' + String(before.length) + ' afterClose=' + String(afterClose.length))
    // The same frozen shape as everywhere else: the command error sits BESIDE the nested state report, so it is
    // read from the body only - never from inside the report, where a field may legitimately be called error.
    const errorOf = (answer) => {
      if (answer === null) return null
      const parsed = reportOf(answer)
      const body = parsed.body
      const error = body !== null && typeof body === 'object' ? (body.error ?? null) : null
      return { status: parsed.status, error, report: parsed.report, shape: parsed.shape }
    }
    const setBoundsSeen = errorOf(setBounds)
    const focusSeen = errorOf(focus)
    const declaration = afterDeclaration === null ? null : reportOf(afterDeclaration)
    if (setBounds === null || focus === null) problems.push('set-bounds/focus were not both called after close')
    else {
      // op=focus is the op that NEEDS a panel (sidebar_panel.rs:1005: "no browser: mount it before focusing
      // it"), so on it the demand for a NAMED refusal is the product's own promise and stays as it was.
      if (typeof focusSeen.error !== 'string' || focusSeen.error.length === 0) problems.push('focus after close answered HTTP ' + focusSeen.status + ' with no error field, so the failure was silent')
      if (focusSeen.status === 200) problems.push('focus after close answered 200, so an op that needs a live browser succeeded on a closed one')
      if (focusSeen.shape === 'missing-state') problems.push('focus after close answered HTTP ' + String(focusSeen.status) + ' without the frozen state report: body=' + clip(show(focus?.body), 200))
      // op=set-bounds is a surface DECLARATION, and the shell answers it with no panel on purpose
      // (sidebar_panel.rs:1512 surface() records panel.surface even when nothing is mounted, because mount()
      // reads it back; panel_host.js:78 uses it that way on every tick). What is asserted here is therefore not
      // "it must fail" - that was a premise this gate invented, and it went red for years of runs for it - but
      // "it must not bring the browser back". Read the world back AFTER the declaration: the status code alone
      // cannot tell a declaration apart from a resurrection.
      if (afterDeclaration === null) problems.push('the shell was not asked for op=state after the post-close set-bounds, so whether that declaration resurrected the browser is unmeasured')
      else if (declaration.shape === 'missing-state') problems.push('the op=state after the post-close set-bounds answered HTTP ' + String(declaration.status) + ' without the frozen state report: body=' + clip(show(afterDeclaration?.body), 200))
      else if (declaration.report?.exists === true) problems.push('THE DECLARATION RESURRECTED THE BROWSER: op=close reported exists=false, and the op=set-bounds that followed - a surface declaration, sidebar_panel.rs:1512 - left the shell answering exists=true again, so a closed panel is not closed')
      if (setBoundsSeen.shape === 'missing-state') problems.push('set-bounds after close answered HTTP ' + String(setBoundsSeen.status) + ' without the frozen state report: body=' + clip(show(setBounds?.body), 200))
      // --expect-close-error off is the paired control: a world in which the shell DOES treat set-bounds as a
      // panel op. It must redden HERE, or this reading could not tell the two rules apart.
      if (expect.closeMustError !== true && typeof setBoundsSeen.error === 'string' && setBoundsSeen.error.length > 0) {
        problems.push('set-bounds after close DID report an error, and this run was told to expect a declaration to be ACCEPTED: ' + setBoundsSeen.error)
      }
    }
    const evidence = [
      'existsAfterClose = ' + show(close?.report?.exists ?? null),
      'counts: before=' + String(before?.length ?? 'unmeasured') + ' afterOpen=' + String(obs.procs?.after?.length ?? 'unmeasured') + ' afterClose=' + String(afterClose?.length ?? 'unmeasured'),
      'closeTimeline    = ' + clip(timeline.join(' | '), 300),
      'leaseHeldForThisReading = ' + show(lease === null ? 'unmeasured' : lease.held) + ' (holder ' + show(lease === null ? null : lease.holder) + ') - while it is held panel_host.js:96-102 makes the host stand down, and panel_host.js:104-110 would otherwise re-open a panel closed from outside after a 10 s grace; both are printed rather than assumed',
      'closeToAssertWindowMs = ' + String(obs.closeWindowMs ?? 'unmeasured') + ' (the whole 6-close judgement happened inside the 10000 ms grace panel_host.js:110 sets, so nothing healed under this reading)',
      'setBoundsAfterClose = HTTP ' + String(setBoundsSeen?.status ?? 'unmeasured') + ' error=' + show(setBoundsSeen?.error ?? null) + ' -> this is a DECLARATION and the shell accepts it on purpose (sidebar_panel.rs:1512), so the status is evidence and not the verdict',
      'existsAfterThatDeclaration = ' + show(declaration === null ? 'unmeasured' : declaration.report?.exists ?? null) + '  <- the verdict: a declaration must not resurrect a closed browser',
      'focusAfterClose     = HTTP ' + String(focusSeen?.status ?? 'unmeasured') + ' error=' + show(focusSeen?.error ?? null),
    ]
    if (problems.length > 0) record('6-close', false, problems.join(' | '), evidence)
    else record('6-close', true, 'close drops the panel and its process, op=focus refuses by name, and the set-bounds that follows declares a rectangle without resurrecting the browser', evidence)
  }

  return readings
}

const round1 = (value) => Math.round(value * 10) / 10
const samePath2 = (left, right) => show(left) === show(right)
const userDataDirOf = (cmdline) => {
  const match = /--user-data-dir=(?:"([^"]*)"|([^\s"]*))/i.exec(String(cmdline ?? ''))
  return match === null ? null : (match[1] ?? match[2] ?? null)
}

/**
 * Whether a process names the panel profile. WebView2 appends its own EBWebView under the directory the shell
 * hands it: the profile the API reports is <app local>/sidebar-panels/p0, while the measured command lines carry
 * <app local>/sidebar-panels/p0\EBWebView. Both are the panel, and neither is the main window UDF.
 */
const namesProfile = (cmdline, dataDir) => {
  if (typeof dataDir !== 'string') return false
  const held = userDataDirOf(cmdline)
  return samePath(held, dataDir) || samePath(held, join(dataDir, 'EBWebView'))
}

// ---------------------------------------------------------------------------------------------------------
// The probe: what the live app actually said. Returns null when CDP is unreachable (the caller SKIPs).
// ---------------------------------------------------------------------------------------------------------
const httpGet = (path) => new Promise((settle) => {
  const req = request({ host: '127.0.0.1', port: CDP_PORT, path, method: 'GET', timeout: 2000 }, (res) => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => { text += chunk })
    res.on('end', () => {
      let json = null
      try { json = JSON.parse(text) } catch { json = null }
      settle({ status: res.statusCode ?? 0, json, text })
    })
  })
  req.on('error', (error) => settle({ status: 0, json: null, text: '', error: String(error?.message ?? error) }))
  req.on('timeout', () => { req.destroy(); settle({ status: 0, json: null, text: '', error: 'timed out after 2000ms' }) })
  req.end()
})

/** One HTTP POST to the shell origin. Degradable by design: the answer object carries the failure. */
const postPanel = (origin, payload) => new Promise((settle) => {
  const body = JSON.stringify(payload)
  const url = new URL('/__shell/panel', origin)
  const req = request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', timeout: 5000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => { text += chunk })
    res.on('end', () => {
      let json = null
      try { json = JSON.parse(text) } catch { json = { __unparsable: text.slice(0, 200) } }
      settle({ status: res.statusCode ?? 0, body: json, text })
    })
  })
  req.on('error', (error) => settle({ status: 0, body: null, text: '', error: String(error?.message ?? error) }))
  req.on('timeout', () => { req.destroy(); settle({ status: 0, body: null, text: '', error: 'timed out after 5000ms' }) })
  req.write(body)
  req.end()
})

/**
 * The report inside a panel answer, in the ONE frozen shape (R143 ruling): a 200 carries the report FLAT, and a
 * non-200 carries it NESTED under `state` beside `error`. The nesting is deliberate - it keeps a future
 * `error` key inside the report from colliding with the command error - so it is the only shape accepted here.
 * A non-200 body WITHOUT `state` is reported as missing-state and is never read as the flat form: the readings
 * that see it turn red and print the body they actually got.
 */
const reportOf = (answer) => {
  const body = answer?.body
  const status = answer?.status ?? 0
  if (status === 200) {
    return { status, report: body !== null && typeof body === 'object' ? body : null, body, shape: 'flat-200' }
  }
  const nested = body !== null && typeof body === 'object' && body.state !== null && typeof body.state === 'object'
  return nested
    ? { status, report: body.state, body, shape: 'nested-error' }
    : { status, report: null, body, shape: 'missing-state' }
}

// R143 hardening (second pass): the COUNT comes from `tasklist`, which never reads command lines, and command
// lines are fetched only when a caller has to NAME a process - in one Get-CimInstance filtered to this single
// image, reused for count and attribution in the same round, so a count and its attribution can never describe
// two different moments. Every spawn is counted: a native fail-fast prints nothing, and this count is then the
// only clue about how far the run actually got.
const tooling = { tasklist: 0, pwsh: 0, cim: 0 }
let snapshots = 0
const WEBVIEW_IMAGE = 'msedgewebview2.exe'

const runTasklist = () => {
  tooling.tasklist += 1
  const done = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ' + WEBVIEW_IMAGE, '/FO', 'CSV', '/NH'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 })
  if (done.status !== 0 || typeof done.stdout !== 'string') return null
  return done.stdout.split(/\r?\n/)
    .map((line) => line.replace(/^"|^"|"$/g, '').split('","'))
    .filter((fields) => fields.length >= 2 && /^[0-9]+$/.test(fields[1] ?? ''))
    .map((fields) => Number(fields[1]))
}

const runCim = () => {
  tooling.pwsh += 1
  tooling.cim += 1
  const script = "Get-CimInstance Win32_Process -Filter \"Name='" + WEBVIEW_IMAGE + "'\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"
  const done = ['pwsh', 'powershell'].map((exe) => spawnSync(exe, ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 })).find((run) => run.status === 0)
  return done === undefined ? null : String(done.stdout)
}

/**
 * One round of process observation.
 *
 * The count is always the tasklist one, which reads no command lines at all; the lines are fetched only when
 * `withCmdline` asks for them, in a single filtered query. Both numbers in a round come from that same round.
 * @param {{ withCmdline: boolean }} options - whether this round has to name processes.
 * @returns {{ count: number, rows: Array<{ pid: number|null, cmdline: string }>|null }|null} null when the
 * instrument refused to answer, which is not the same thing as zero processes.
 */
const processSnapshot = ({ withCmdline }) => {
  snapshots += 1
  const pids = runTasklist()
  if (pids === null) return null
  if (withCmdline !== true) return { count: pids.length, rows: null }
  const text = runCim()
  const rows = text === null ? null : text.split(/\r?\n/).map((line) => {
    const cut = line.indexOf('|')
    if (cut === -1) return null
    const pid = Number(line.slice(0, cut))
    return { pid: Number.isFinite(pid) ? pid : null, cmdline: line.slice(cut + 1) }
  }).filter((row) => row !== null)
  return { count: pids.length, rows }
}

/** A process belongs to the panel when its command line names the panel profile tree at all. Null in, null out:
 * an instrument that did not answer must not be turned into an empty list. */
const attributedWebviews = (rows) => (rows === null ? null : rows.filter((row) => /sidebar-panels/i.test(String(row.cmdline))))

const cdpPage = async () => {
  const targets = await httpGet('/json/list')
  if (targets.status !== 200 || Array.isArray(targets.json) === false) return null
  const pages = targets.json.filter((target) => target.type === 'page' && typeof target.url === 'string' && /^https?:\/\//.test(target.url))
  if (pages.length === 0) return null
  // R242: this used to take pages[0]. Any other page on the debugging port - a second kernel, a foreign host, another
  // tab - then became "the shell", and every op was answered 405 by THAT origin's server. The shell is identified by
  // its own port; the fallback stays loud rather than silently measuring a stranger.
  const shell = pages.filter((target) => String(target.url).indexOf('127.0.0.1:' + String(SHELL_PORT)) !== -1)
  const page = shell.length > 0 ? shell[0] : pages[0]
  if (shell.length === 0) console.log('      (no page on 127.0.0.1:' + String(SHELL_PORT) + ' - falling back to ' + String(page.url) + ', which is not the shell)')
  const origin = new URL(page.url).origin
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const resolve = pending.get(message.id)
    if (resolve !== undefined) { pending.delete(message.id); resolve(message) }
  })
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', () => fail(new Error('the CDP socket refused the connection')), { once: true })
  })
  const evaluate = (expression) => new Promise((settle) => {
    const id = nextId++
    pending.set(id, settle)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
  return { page, origin, evaluate, close: () => socket.close() }
}

/** The stage collect() reached, printed if it throws: a phase name localises what a bare stack does not. */
let collectPhase = 'not-started'
const mark = (name) => { collectPhase = name }

const collect = async () => {
  let cdp = null
  try {
    cdp = await Promise.race([cdpPage(), new Promise((settle) => setTimeout(() => settle(null), CDP_DEADLINE_MS))])
  } catch (error) {
    console.log('  (CDP refused: ' + String(error?.message ?? error) + ')')
    cdp = null
  }
  if (cdp === null) return null
  const { origin, evaluate, close } = cdp
  const obs = { kind: 'live', origin, state: {}, polls: [], closePolls: [], procs: {}, afterCloseCalls: {}, opened: null, sentRect: SENT_RECT }
  const spent = () => round1((Date.now() - started) / 1000)
  const started = Date.now()
  const dpr = await evaluate('window.devicePixelRatio')
  const dprValue = typeof dpr?.result?.result?.value === 'number' ? dpr.result.result.value : null
  obs.scale = dprValue === null
    ? { value: null, source: 'window.devicePixelRatio did not answer a number' }
    : { value: dprValue, source: 'window.devicePixelRatio, measured in the page' }
  const call = async (payload) => reportOf(await postPanel(origin, payload))

  // R181: take the turn BEFORE touching the panel, and name the holder on every write from here on.
  // Two reasons, both readable in the shell:
  //   (a) panel_host.js:96-102 - the 400 ms page host stands down only while a lease it can SEE is held, and
  //       panel_host.js:104-110 would otherwise re-open, after a 10 s grace, a panel it finds closed from
  //       outside. That grace is correct product behaviour (scripts/verify-sidebar-content.mjs:136-144 asserts
  //       it green as 4-host-heals); reading 6 is simply not allowed to race it.
  //   (b) sidebar_panel.rs:777-801 - a write under somebody else's lease is refused BY NAME, so naming the
  //       holder is also what stops the lease from becoming the cause of the refusals this gate reads. The
  //       post-close reads below therefore assert the PANEL's absence, never the LEASE's.
  // A refused claim is recorded and printed, not fatal: another gate holding the lease is not a measurement of
  // this product, and reading 6 says so in its own evidence (leaseHeldForThisReading).
  const shellPort = Number(new URL(origin).port)
  const leaseHeld = await claimLease(shellPort, HOLDER, LEASE_TTL_MS)
  obs.lease = { held: leaseHeld === true, holder: HOLDER }
  const write = (payload) => call(leaseHeld === true ? { ...payload, holder: HOLDER } : payload)
  const rawWrite = (payload) => postPanel(origin, leaseHeld === true ? { ...payload, holder: HOLDER } : payload)
  // R182-G: establish the baseline for reading 4 BEFORE anything else touches the panel, and with a rectangle
  // that is deliberately not the one reading 4 asks for. The answer to this write is itself a report.
  obs.baseline = { sent: BASELINE_RECT, report: await write({ op: 'set-bounds', ...BASELINE_RECT }) }

  mark('pre-state')
  // Reading 1 says "a state before any open reports exists=false", so the gate has to START from that state:
  // another live gate, or the page host itself (which re-opens a panel whenever the column is wide enough),
  // can leave one behind. Measured in R146: this gate failed inside the suite because gate 97 ran first.
  // Closing it here establishes the precondition; it does not weaken the reading.
  {
    const housekeeping = await call({ op: 'state' })
    if (housekeeping !== null && housekeeping.report !== null && housekeeping.report.exists === true) {
      await write({ op: 'close' })
      const until = Date.now() + 5000
      while (Date.now() < until) {
        const seen = await call({ op: 'state' })
        if (seen === null || seen.report === null || seen.report.exists !== true) break
        await new Promise((done) => setTimeout(done, 500))
      }
    }
  }
  obs.state.pre = await call({ op: 'state' })
  // Paired baseline for reading 5: the attributed count has to be taken before the panel exists.
  mark('snapshot-before-open')
  const beforeSnapshot = processSnapshot({ withCmdline: true })
  obs.procs.beforeAll = attributedWebviews(beforeSnapshot === null ? null : beforeSnapshot.rows)
  mark('open')
  obs.state.open = await write({ op: 'open', url: origin + '/__shell/' })
  mark('open-poll')
  const deadline = Date.now() + DEADLINE_MS
  while (Date.now() < deadline) {
    const answer = await call({ op: 'state' })
    obs.polls.push({ at: spent(), state: answer })
    if (answer?.report?.exists === true) { obs.opened = { at: spent(), report: answer.report }; break }
    await new Promise((done) => setTimeout(done, 800))
  }
  if (obs.opened === null) obs.opened = null
  const panelProfile = obs.opened?.report?.dataDir ?? PANEL_PROFILE
  // The baseline was taken BEFORE the open; reading it here again would erase the very rise being judged.
  obs.procs.before = attributedWebviews(obs.procs.beforeAll)
  obs.boundsBefore = obs.opened?.report?.bounds ?? null
  mark('set-bounds')
  await write({ op: 'set-bounds', ...SENT_RECT })
  obs.sentRect = SENT_RECT
  const afterBounds = await call({ op: 'state' })
  obs.boundsAfter = afterBounds
  if (obs.scale.value === null && afterBounds?.report?.bounds?.w > 0) {
    obs.scale = { value: round1(afterBounds.report.bounds.w / SENT_RECT.w), source: 'DERIVED from reported physical w / requested logical w (devicePixelRatio did not answer)' }
  }
  await call({ op: 'focus' })
  mark('snapshot-after-open')
  const afterSnapshot = processSnapshot({ withCmdline: true })
  obs.procs.after = attributedWebviews(afterSnapshot === null ? null : afterSnapshot.rows)
  mark('close')
  const closeSentAt = Date.now()
  obs.state.close = await write({ op: 'close' })
  const closeDeadline = Date.now() + DEADLINE_MS
  const baselineTotal = beforeSnapshot === null ? null : beforeSnapshot.count
  // The wait only needs a COUNT, so it asks for one: a tasklist per poll, no command lines, and a printed
  // second-by-second timeline. The attribution is taken once after the wait, not once per poll.
  while (Date.now() < closeDeadline) {
    mark('close-poll')
    const cheap = processSnapshot({ withCmdline: false })
    const total = cheap === null ? null : cheap.count
    obs.closePolls.push({ at: spent(), count: total === null ? 'unmeasured' : total })
    if (cheap === null || (baselineTotal !== null && total <= baselineTotal)) break
    await new Promise((done) => setTimeout(done, 800))
  }
  mark('snapshot-after-close')
  const closedSnapshot = processSnapshot({ withCmdline: true })
  obs.procs.afterClose = attributedWebviews(closedSnapshot === null ? null : closedSnapshot.rows)
  mark('after-close-calls')
  obs.postClose = await call({ op: 'state' })
  obs.afterCloseCalls.setBounds = await rawWrite({ op: 'set-bounds', ...SENT_RECT })
  obs.afterCloseCalls.focus = await postPanel(origin, { op: 'focus' })
  // R181: the verdict for the declaration is not its status code, it is the world AFTER it. Read it back.
  obs.afterCloseCalls.stateAfterSetBounds = await call({ op: 'state' })
  obs.closeWindowMs = Date.now() - closeSentAt
  if (leaseHeld === true) await releaseLease(shellPort, HOLDER)
    close()
  return obs
}

// ---------------------------------------------------------------------------------------------------------
// --self-attack: a labelled synthetic world, judged once honestly and once per mutant.
// ---------------------------------------------------------------------------------------------------------
const synthetic = (expect, profile) => {
  const physical = { units: 'physical', x: SENT_RECT.x * 1.5, y: SENT_RECT.y * 1.5, w: SENT_RECT.w * 1.5, h: SENT_RECT.h * 1.5 }
  const report = (over) => ({ exists: false, label: 'sidebar-panel', bounds: null, dataDir: profile, url: null, lastError: null, pending: false, ...over })
  const cmdline = (dir) => '"C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\141.0.3537.57\\msedgewebview2.exe" --embedded-browser-webview=1 --user-data-dir="' + dir + '" --webview-exe-name=dsh-link-client.exe'
  const before = [{ pid: 100, cmdline: cmdline(profile) }, { pid: 101, cmdline: 'dsh-link-client.exe --user-data-dir="' + MAIN_UDF + '"' }]
  const after = [...before, { pid: 202, cmdline: cmdline(profile) }]
  return {
    kind: 'synthetic',
    origin: 'http://127.0.0.1:31761',
    scale: { value: 1.5, source: 'window.devicePixelRatio, measured in the page' },
    state: {
      pre: { status: 200, body: report({}), report: report({}) },
      open: { status: 200, body: report({ pending: true, url: 'http://127.0.0.1:31761/__shell/' }), report: report({ pending: true, url: 'http://127.0.0.1:31761/__shell/' }) },
      close: { status: 200, body: report({}), report: report({}) },
    },
    polls: [
      { at: 0.4, state: { status: 200, report: report({ pending: true }) } },
      { at: 0.9, state: { status: 200, report: report({ exists: true, bounds: physical, url: 'http://127.0.0.1:31761/__shell/' }) } },
    ],
    opened: { at: 0.9, report: report({ exists: true, bounds: physical, url: 'http://127.0.0.1:31761/__shell/' }) },
    procs: { before, after, afterClose: before },
    // R182-G: the baseline the gate declares itself, and the state at open agreeing with it (one world, one story).
    baseline: { sent: BASELINE_RECT, report: report({ bounds: { units: 'physical', x: BASELINE_RECT.x * 1.5, y: BASELINE_RECT.y * 1.5, w: BASELINE_RECT.w * 1.5, h: BASELINE_RECT.h * 1.5 } }) },
    // A DIFFERENT rect than the one set-bounds asks for: a panel that never moved must not read as moved.
    boundsBefore: { units: 'physical', x: BASELINE_RECT.x * 1.5, y: BASELINE_RECT.y * 1.5, w: BASELINE_RECT.w * 1.5, h: BASELINE_RECT.h * 1.5 },
    sentRect: SENT_RECT,
    boundsAfter: { status: 200, report: report({ exists: true, bounds: physical }) },
    postClose: { status: 200, body: report({}), report: report({}) },
    // R181: the honest world puts the DECLARATION where the shell puts it - ACCEPTED, with no panel behind it
    // (sidebar_panel.rs:1512) - and the state read AFTER it is what reading 6 judges. focus, the op that needs
    // a panel, is the one that refuses by name (sidebar_panel.rs:1005).
    afterCloseCalls: {
      setBounds: { status: 200, body: report({}), report: report({}) },
      focus: { status: 400, body: { error: 'no browser: mount it before focusing it', state: report({}) } },
      stateAfterSetBounds: { status: 200, body: report({}), report: report({}) },
    },
    lease: { held: true, holder: HOLDER },
    closeWindowMs: 2400,
    closePolls: [{ at: 0.4, count: 2 }, { at: 0.8, count: 1 }],
  }
}

const selfAttack = () => {
  const honest = expectations()
  const world = synthetic(honest, honest.dataDir)
  const mutants = [
    {
      name: 'expected dataDir set to the MAIN WINDOW UDF (EBWebView)',
      expect: expectations({ dataDir: join(APP_LOCAL, 'EBWebView') }),
      mustRedden: ['3-pool'],
    },
    {
      name: 'expected rectangle set to 999,999,999,999',
      expect: expectations({ rect: { x: 999, y: 999, w: 999, h: 999 } }),
      mustRedden: ['4-bounds'],
    },
    {
      // R182-G: the premise arm the round added. A shell that answers with the LAST declaration instead of the one
      // just made (which is what a stale leftover surface looks like) must redden reading 4 on its own baseline.
      name: 'the shell reports the previous declaration back instead of the one just made',
      expect: honest,
      world: (w) => ({ ...w, baseline: { sent: BASELINE_RECT, report: { exists: false, label: 'sidebar-panel', bounds: w.boundsAfter.report.bounds } } }),
      mustRedden: ['4-bounds'],
    },
    {
      // The paired control of reading 6's declaration half: a world in which the shell DOES refuse set-bounds
      // as though it needed a panel. Run with --expect-close-error off (this run says a declaration is
      // accepted), that world must redden - otherwise this reading could not tell the two rules apart.
      name: '--expect-close-error off, against a world that refuses the declaration',
      expect: expectations({ closeMustError: false }),
      world: (base) => ({
        ...base,
        afterCloseCalls: {
          ...base.afterCloseCalls,
          setBounds: { status: 400, body: { error: 'the panel does not exist', state: base.afterCloseCalls.stateAfterSetBounds.body } },
        },
      }),
      mustRedden: ['6-close'],
    },
    {
      // R181's new failure mode, and the one that used to be read wrongly: a set-bounds that takes a CLOSED
      // panel and leaves the shell answering exists=true. The status code cannot show this; the read-back can.
      name: 'the declaration resurrects the browser (op=state after it answers exists=true)',
      expect: honest,
      world: (base) => ({
        ...base,
        afterCloseCalls: {
          ...base.afterCloseCalls,
          stateAfterSetBounds: { status: 200, body: { ...base.afterCloseCalls.stateAfterSetBounds.body, exists: true }, report: { ...base.afterCloseCalls.stateAfterSetBounds.body, exists: true } },
        },
      }),
      mustRedden: ['6-close'],
    },
    {
      name: 'expect open to stay absent',
      expect: expectations({ openMustExist: false }),
      mustRedden: ['2-open'],
    },
    {
      name: 'a 400 body with no nested state report ({"error":"x"})',
      expect: honest,
      world: (base) => ({
        ...base,
        afterCloseCalls: { ...base.afterCloseCalls, setBounds: { status: 400, body: { error: 'x' } }, focus: { status: 400, body: { error: 'x' } } },
      }),
      mustRedden: ['6-close'],
    },
  ]
  let failures = 0
  const baseline = judge(world, honest)
  const baselineRed = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  const baselineShown = baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' ')
  console.log('  ' + (baselineRed.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC world judged with honest expectations is green: ' + baselineShown)
  if (baselineRed.length > 0) failures += 1
  console.log('          (SYNTHETIC, not the app: this exercises the judge, never the probe. The probe stays unmeasured until someone runs the app.)')
  for (const mutant of mutants) {
    const red = judge(mutant.world === undefined ? world : mutant.world(world), mutant.expect).filter((reading) => reading.ok === false).map((reading) => reading.id)
    const caught = mutant.mustRedden.every((id) => red.includes(id))
    const precise = red.length === mutant.mustRedden.length && caught
    if (precise === false) failures += 1
    console.log('  ' + (precise ? 'ok  ' : 'FAIL') + '  mutant. ' + mutant.name + ': red=' + show(red) + ' expected=' + show(mutant.mustRedden))
  }
  console.log('  note ' + 'the live probe was NOT exercised in this mode: --self-attack attacks the judge only. Run the gate without it for the six live readings.')
  return failures === 0 ? 0 : 1
}

const main = async () => {
  if (SELF_ATTACK) return selfAttack()
  // A judge that dies without a word cannot be told apart from a judge that measured nothing
  // (R141/R143 discipline). A JS failure is printed in full and exits 1. This does NOT cover a
  // native fail-fast (0xC0000409 was seen once in four live runs, cause unproven) — nothing in
  // JavaScript catches that, which is exactly why the snapshot count is printed below.
  let obs
  try {
    obs = await collect()
  } catch (error) {
    console.log('  FAIL  collect(): the judge itself failed before it could judge anything (a GATE bug, not a data verdict)')
    console.log('        phase = ' + collectPhase)
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    return 1
  }
  if (obs === null) {
    console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING')
    return 3
  }
  const readings = judge(obs, expectations())
  console.log('  live origin ' + obs.origin + ' | scale=' + show(obs.scale.value) + ' (' + obs.scale.source + ') | profile=' + show(obs.opened?.report?.dataDir ?? null))
  console.log('  instrument: tasklist spawns=' + String(tooling.tasklist) + ' pwsh spawns=' + String(tooling.pwsh) + ' Get-CimInstance=' + String(tooling.cim) + ' snapshot rounds=' + String(snapshots))
  for (const reading of readings) {
    console.log('  ' + (reading.ok ? 'ok  ' : 'FAIL') + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  console.log(failed.length === 0 ? '  ' + String(readings.length) + ' readings, all held' : '  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed')
  return failed.length === 0 ? 0 : 1
}

process.exitCode = await main()
