#!/usr/bin/env node
/**
 * Gate 97 (R145) - does the panel tell the shell what it is SHOWING, and only while it is showing it?
 *
 * Subject: the reporter injected into the panel's own webview (src-tauri/src/core/panel_reporter.js) and
 * the shell's `content` / `contentReports` / `pageUrl` fields on POST /__shell/panel.
 *
 * Why this matters more than 'it opened': a child webview that exists and paints nothing is the one
 * failure a user cannot distinguish from a slow page, and the shell could not read it at all before.
 *
 * Readings, and the PREMISE each one needs - this gate used to run two mutually exclusive premises in one
 * pass and call the result a product failure (R181-C section 3 C-4):
 *
 *   1-clean        a panel that does not exist reports no content and no reports (nothing left behind).
 *                  PREMISE: the gate can close the panel itself, which needs the lease it just claimed to be
 *                  named on the write - the shell refuses a placement or a close that is not the holder's
 *                  (measured here: op=close carrying no holder is REFUSED with "the panel is leased by
 *                  verify-sidebar-content and not by nobody", and the panel a host left open stays open).
 *   2-self-report  once open, the panel's OWN document reports in: reports>0, a href, a readyState, a
 *                  readable title and text length
 *   3-no-stale     the reported href must describe the page the webview is on (same origin as pageUrl):
 *                  content about a page the user is not looking at is worse than no content at all
 *   5-external     a real site loaded into the panel reports its own document (origin, title, text length)
 *                  PREMISE for 1,2,3,5 together: the gate owns the panel for the stretch it holds the lease,
 *                  so these four need a lease it can win - the AWAY world is the quietest one for them.
 *   4-host-heals   a panel closed from OUTSIDE (no lease held, so this gate is not the owner any more) is
 *                  brought back by the page host. PREMISE: the host must be alive, and the host is alive only
 *                  where the selected pane declares [data-dsh-link-surface="true"] - without that anchor
 *                  panel_host.rect() answers null and its tick returns before it can open anything
 *                  (src-tauri/src/core/panel_host.js:133). This reading therefore requires an ACTIVE world:
 *                  with no anchor it is a named NOT MEASURED and the gate exits 3, never a red that pretends
 *                  the host failed and never a silent pass.
 *
 * Exit 0 all readings held | 1 a reading failed | 3 + one SKIP: line when CDP is not answering (the app is
 * not running with remote debugging, so this gate measured NOTHING) or when a reading could not be measured
 * here for a named reason (a measured red still outranks a skip).
 *
 * Usage: node scripts/verify-sidebar-content.mjs [--cdp-port 9222] [--deadline-ms 20000] [--self-attack]
 *        [--expect-origin <origin>] [--expect-content-on-closed yes|no] [--expect-reports>0 yes|no]
 *
 * --self-attack judges two labelled SYNTHETIC worlds with one expectation mutated at a time. It never
 * touches the app: it proves the judge can fail, not that the probe works.
 */
import { connect, COLUMN_PROBE } from './cdp-drive.mjs'
import { claimLease, releaseLease, openOwnPanel, settlePanelWorld } from './panel-lease.mjs'

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const CDP_PORT = Number(option('--cdp-port', '9222'))
const DEADLINE_MS = Number(option('--deadline-ms', '20000'))
// R259: four sequential waits, each with its own DEADLINE_MS, added up to 80-125 s - enough that this gate once held
// the whole suite for ten minutes. One budget for the entire collection bounds it: whatever the loops did not reach
// stays null, the judge turns null into n/a, and the gate exits 3 with the reason. A gate that cannot finish must say
// so cheaply rather than fail the run by taking forever.
// R278: raised from 30 s to 45 s for one measured reason. The page host BELIEVES an external close for ten seconds
// before it heals the panel (panel_host.js: "Somebody else closed it. Believe that for a while ... STATE.healAt =
// Date.now() + 10000"), so a heal reading needs a window longer than that grace. With a 30 s budget the heal loop
// started after the open/navigate/close waits and was clipped to a second or two - it never had the chance to see
// the heal the host is documented to perform, and reported "the panel came back but never reported" instead.
const BUDGET_MS = Number(option('--budget-ms', '60000'))
const SELF_ATTACK = has('--self-attack')
// A real site the panel is sent to: the reading is that the panel can still report its own document from an
// origin that is not the shell's. Overridable so a machine without internet can point it at something local.
// R261: the live target used to be https://example.com, so this gate paid a full network round trip (and sometimes a
// multi-minute stall) just to prove the panel can leave the shell's origin. A DIFFERENT ORIGIN is the whole point, and
// the kernel on its own port is one: same machine, no internet, same reading. --site still overrides it.
const SITE = option('--site', 'http://127.0.0.1:' + String(process.env.DSH_LINK_EXTERNAL_PORT ?? '31760') + '/')
const OPEN_LABEL = '\u6253\u5f00\u53f3\u4fa7\u8fb9\u680f'

const show = (value) => { const text = JSON.stringify(value); return text === undefined ? String(value) : text }
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const originOf = (href) => { try { return new URL(String(href)).origin } catch (error) { return null } }

// The anchor: the rectangle the page host places the panel on since R178, and the premise of reading 4 -
// without it the host is inert (panel_host.js:133) and nothing can heal a panel closed from outside.
const anchorProbe = () => {
  const surface = document.querySelector('[data-dsh-link-surface="true"]')
  const box = (node) => { if (node === null) return null; const b = node.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  return JSON.stringify({
    count: document.querySelectorAll('[data-dsh-link-surface]').length,
    anchor: box(surface),
    display: surface === null ? null : getComputedStyle(surface).display,
  })
}
const ANCHOR_PROBE = '(' + anchorProbe.toString() + ')()'

const panelCall = async (port, payload) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return { status: 0, body: null }
  const text = await answer.text().catch(() => '')
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = null }
  return { status: answer.status, body, text }
}

// A call into the panel's own DevTools protocol through the shell (R149). Two layers of JSON: this shell's
// envelope around the protocol's answer.
const cdpCall = async (port, method, params) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel/cdp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) }).catch(() => null)
  if (answer === null) return { status: 0, ok: false, error: 'the shell did not answer', inner: null }
  const raw = await answer.text().catch(() => '')
  let envelope = null
  try { envelope = JSON.parse(raw) } catch (error) { envelope = null }
  let inner = null
  if (envelope !== null && typeof envelope.result === 'string') { try { inner = JSON.parse(envelope.result) } catch (error) { inner = null } }
  return { status: answer.status, ok: envelope !== null && envelope.ok === true, error: envelope === null ? 'unparsable answer' : envelope.error, inner }
}

// --------------------------------------------------------------------------------------------- judge
const judge = (world, expect) => {
  const readings = []
  // R181-D (C-4): ok === null means "this world did not let me take this reading" and is kept as null. The
  // coercing form (ok === true) turned a named NOT MEASURED into a red, which is how a fact about the world
  // becomes a verdict about the product. Booleans behave exactly as before.
  const record = (id, ok, detail, evidence) => readings.push({ id, ok: ok === null || ok === undefined ? null : ok === true, detail: String(detail), evidence: evidence || [] })
  const closed = world.closed
  const open = world.open
  const reopened = world.reopened

  {
    const problems = []
    // A collapsed column makes the rest of this reading unmeasurable for the SAME reason, so its marker suppresses
    // the consequential "no answer" problem instead of sitting beside it and turning the pair into a red.
    if (world.columnOpen === false) problems.push('not-applicable: the column is collapsed here, so the host never opens a panel and there is no closed snapshot to judge')
    else if (closed === null || closed === undefined) problems.push('the shell did not answer op=state with no panel')
    else {
      const holds = closed.exists === true
      if (expect.contentOnClosed === true) {
        if (closed.content === null || closed.content === undefined) problems.push('this run expected content on a closed panel and there was none')
      } else {
        if (holds === true) problems.push('a panel still exists, so this reading proves nothing')
        if (closed.content !== null && closed.content !== undefined) problems.push('closed panel still reports content: ' + show(closed.content))
        if (Number(closed.contentReports) !== 0) problems.push('closed panel still reports contentReports=' + String(closed.contentReports))
      }
    }
    const skip = problems.length === 1 && String(problems[0]).startsWith('not-applicable')
    // null is the gate's own word for "this world did not let me measure it" (see reading 4): it exits 3 with a SKIP
    // line instead of claiming a green for a question nobody asked.
    record('1-clean', skip ? null : problems.length === 0, skip ? 'not applicable: the column is collapsed, so no closed snapshot exists' : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'with no panel there is no content and no reports'), ['closed=' + show(closed)])
  }

  {
    const problems = []
    // R256: readings 1 and 4 already treat a collapsed column as a named third state. Reading 2 was the odd one out:
    // when the column is collapsed the shell does not open a panel at all, so "it did not answer with a panel open"
    // is the same world fact - not a hidden product defect. It now says so in the same language.
    if (world.columnOpen === false) problems.push('not-applicable: the column is collapsed here, so the shell opens no panel to self-report')
    else if (open === null || open === undefined) problems.push('the shell did not answer op=state with a panel open')
    else {
      const content = open.content
      const reports = Number(open.contentReports)
      if (expect.reportsPositive === false) {
        if (reports > 0) problems.push('this run expected no reports and ' + String(reports) + ' arrived')
      } else if (reports <= 0 || content === null || content === undefined) {
        problems.push('the panel never reported its own document: contentReports=' + String(open.contentReports) + ' content=' + show(content))
      } else {
        if (typeof content.href !== 'string' || content.href.length === 0) problems.push('the report carries no href')
        if (typeof content.readyState !== 'string' || ['interactive', 'complete'].includes(content.readyState) === false) problems.push('readyState is ' + show(content.readyState) + ', so the document never became readable')
        if (typeof content.title !== 'string') problems.push('the report carries no title string')
        if (typeof content.textLength !== 'number' || content.textLength < 0) problems.push('the report carries no text length: ' + show(content.textLength))
        if (Array.isArray(content.failures) === false) problems.push('the report carries no failures array, so script errors cannot be seen')
      }
    }
    if ((open === null || open === undefined) && world.probeWhy !== null && world.probeWhy !== undefined) problems.push('the page probe never answered inside the deadline: ' + show(world.probeWhy))
    const skipHere = problems.length === 1 && String(problems[0]).startsWith('not-applicable')
    record('2-self-report', skipHere ? null : problems.length === 0, skipHere ? String(problems[0]) : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'the panel reports its own document: href, readyState, title, text length and errors'), ['open=' + show(open), 'probeWhy=' + show(world.probeWhy)])
  }

  {
    const problems = []
    const content = open === null || open === undefined ? null : open.content
    const pageOrigin = open === null || open === undefined ? null : originOf(open.pageUrl)
    const contentOrigin = content === null || content === undefined ? null : originOf(content.href)
    // Applicability: with no content there is nothing that could be stale, and reading 2 already reports the
    // absence. Reddening this too would hide which failure actually happened (measured: the first mutant
    // reddened both readings).
    const applicable = content !== null && content !== undefined
    if (applicable === false) problems.push('not-applicable')
    else if (pageOrigin === null) problems.push('the shell reported no usable pageUrl, so staleness cannot be judged')
    else if (contentOrigin === null) problems.push('the report href is not a URL: ' + show(content.href))
    else if (contentOrigin !== pageOrigin) problems.push('the content describes ' + contentOrigin + ' while the panel is on ' + pageOrigin + ': the shell is presenting a page the user is not looking at')
    if (applicable && expect.origin !== null && expect.origin !== undefined && pageOrigin !== expect.origin) problems.push('the page origin is ' + String(pageOrigin) + ', expected ' + String(expect.origin))
    const notApplicable = problems.length === 1 && problems[0] === 'not-applicable'
    record('3-no-stale', problems.length === 0 || notApplicable, notApplicable ? 'not applicable: no content was reported, so nothing could be stale (reading 2 carries that failure)' : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'the reported content belongs to the page the webview is actually on'), ['pageUrl=' + show(open === undefined || open === null ? null : open.pageUrl), 'contentHref=' + show(content === null || content === undefined ? null : content.href), 'pageOrigin=' + show(pageOrigin), 'contentOrigin=' + show(contentOrigin)])
  }

  {
    const problems = []
    // The host must heal: closing the panel from OUTSIDE (what this gate does, and what a future toolbar
    // button or a crash would do) used to leave the panel closed forever, because the page host still
    // believed it was open and the geometry never changed. The reading is that it comes back on its own.
    //
    // R181-D (C-4): this reading's premise is the ANCHOR, and it is named rather than assumed. The host opens
    // nothing where no pane declares [data-dsh-link-surface="true"] (panel_host.js:133), so in such a world
    // "the panel stayed closed" is not a product failure - it is this gate asking the wrong world a question.
    // The two halves of this file now say which world they need instead of one half reddening the other.
    const anchor = world.healAnchor === undefined ? null : world.healAnchor
    if (world.columnOpen !== true) problems.push('not-applicable: the column is collapsed here, so the panel is SUPPOSED to stay closed')
    else if (anchor === null) problems.push('NOT MEASURED: the shell page did not answer the anchor probe, so it is unknown whether the host was alive for this reading')
    else if (anchor.count === 0 || anchor.anchor === null || anchor.anchor.w <= 0 || anchor.anchor.h <= 0) problems.push('NOT MEASURED: this world declares no [data-dsh-link-surface="true"] anchor (measured ' + show(anchor) + '), so the page host was inert (panel_host.js:133) while this reading waited - "it never came back" would be a red about the world, not about healing. This reading belongs to an ACTIVE world: .tmp/r181-owner/prepare-world.ps1 -Action pane -Pane 浏览器 (rail on the browser pane). The other readings of this gate are the ones the AWAY world was prepared for.')
    else if (reopened === null || reopened === undefined) problems.push('the host never brought the panel back after it was closed from outside: it cannot heal a panel it did not close')
    else if (reopened.exists !== true) problems.push('the panel stayed closed after an outside close: exists=' + show(reopened.exists))
    else if (Number(reopened.contentReports) <= 0) problems.push('the panel came back but never reported its document again')
    const notApplicable = problems.length === 1 && String(problems[0]).startsWith('not-applicable')
    const notMeasured = problems.length === 1 && String(problems[0]).startsWith('NOT MEASURED')
    // ok === null means "this world did not let me measure it": the gate then exits 3 with a SKIP line, which is
    // the only honest third answer - neither a green for a claim nobody took, nor a red that blames the product.
    record('4-host-heals', notApplicable || notMeasured ? null : problems.length === 0,
      notApplicable ? 'not applicable: the column is collapsed, so the panel is supposed to stay closed'
        : (notMeasured ? problems[0] : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'closing the panel from outside is healed by the host, which brings it back with its document reported')),
      ['anchorAtHeal=' + show(anchor), 'columnOpen=' + show(world.columnOpen), 'reopened=' + show(reopened)])
  }

  {
    // The point of the whole channel exercise: a panel loaded with a REAL site says what it is showing.
    const problems = []
    const external = world.external
    if (world.wasCollapsed === true && external === null) problems.push('not-applicable: the gate could not open a panel to navigate')
    else if (external === null || external === undefined) problems.push('the shell did not answer op=state after the navigation')
    else {
      const content = external.content
      if (external.exists !== true) problems.push('the panel is gone after navigating to ' + SITE)
      else if (content === null || content === undefined) problems.push('the panel reported NOTHING from ' + SITE + ': pageUrl=' + show(external.pageUrl) + ' (a page the shell cannot hear from is a blank rectangle with a URL)')
      else {
        const wanted = originOf(SITE)
        if (originOf(content.href) !== wanted) problems.push('the report came from ' + show(content.href) + ', not from ' + String(wanted))
        if (typeof content.textLength !== 'number' || content.textLength <= 0) problems.push('the page reported ' + show(content.textLength) + ' characters of text, so nothing can be said about what is on screen')
        // R278: the report must CARRY a title, not carry a non-empty one. SITE is the kernel origin, and the kernel
        // root answers with a body that has no <title> - so the panel correctly reported title:"". Demanding a
        // non-empty title made the reading a statement about the kernel's HTML instead of about the panel's report,
        // and the href / readyState / textLength checks beside this one are what actually prove the document was read.
        if (typeof content.title !== 'string') problems.push('the page reported no title FIELD at all (' + show(content.title) + ')')
      }
    }
    const skip = problems.length === 1 && String(problems[0]).startsWith('not-applicable')
    record('5-external', problems.length === 0 || skip, skip ? 'not applicable: no panel was opened' : (problems.length ? 'FAIL: ' + problems.join(' | ') : 'a real site reports its own document: origin, title and text length all arrive'), ['site=' + SITE, 'external=' + show(external)])
  }

  return readings
}

const expectations = (over = {}) => ({
  origin: over.origin === undefined ? option('--expect-origin', null) : over.origin,
  contentOnClosed: over.contentOnClosed === undefined ? option('--expect-content-on-closed', 'no') === 'yes' : over.contentOnClosed,
  reportsPositive: over.reportsPositive === undefined ? option('--expect-reports-positive', 'yes') !== 'no' : over.reportsPositive,
})

// ------------------------------------------------------------------------------------------- probe
const collect = async () => {
  const cdp = await connect({ port: CDP_PORT, deadlineMs: DEADLINE_MS })
  if (cdp === null) return null
  const port = new URL(cdp.page).port
  const panelPost = async (payload) => {
    const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
    if (answer === null) return null
    const raw = await answer.text().catch(() => '')
    try { return JSON.parse(raw) } catch (error) { return null }
  }
  const state = async () => panelPost({ op: 'state' })
  const cdpCall = async (method, params) => {
    const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel/cdp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) }).catch(() => null)
    if (answer === null) return { ok: false, inner: null, error: 'the shell did not answer' }
    const raw = await answer.text().catch(() => '')
    let envelope = null
    try { envelope = JSON.parse(raw) } catch (error) { envelope = null }
    let inner = null
    if (envelope !== null && typeof envelope.result === 'string') { try { inner = JSON.parse(envelope.result) } catch (error) { inner = null } }
    return { ok: envelope !== null && envelope.ok === true, inner, error: envelope === null ? 'unparsable' : envelope.error }
  }
  const world = { page: cdp.page, probeWhy: null, closed: null, open: null, afterClose: null, reopened: null, external: null, columnOpen: null, wasCollapsed: null, healAnchor: null, healAnchorAfter: null }
  // The gate OWNS the panel while it holds the lease: it opens and places it through the shell's own API,
  // and the page host stands down for that stretch. Reading 4 is the exception - it is about the host
  // HEALING a panel that was closed from outside - so the lease is released before that reading, which is
  // exactly why the host's pause must be tied to the lease and not to the gate's lifetime.
  const budgetEnd = Date.now() + BUDGET_MS
  const HOLDER = 'verify-sidebar-content'
  // R279: the panel world is shared, so start from a state every gate can share (see settlePanelWorld): rail off the
  // browser pane, no panel open. The lease is claimed AFTER this, because a close made under somebody's lease is
  // refused by name.
  const settledWorld = await settlePanelWorld(port, { cdpPort: CDP_PORT })
  world.settled = settledWorld
  const holdsLease = await claimLease(port, HOLDER)
  // R181-D (C-4): every write this gate makes WHILE IT HOLDS ITS LEASE has to name the holder, or the shell
  // refuses it BY NAME and the world it refuses it in is the world this gate is about to judge. Measured on
  // the ACTIVE world: with the lease held, op=close without a holder is refused ("the panel is leased by
  // verify-sidebar-content and not by nobody"), the host's panel stayed open, and 1-clean reddened with
  // "a panel still exists, so this reading proves nothing" - a product red caused by the gate's own omission.
  const ownedPost = (payload) => panelPost(holdsLease ? { ...payload, holder: HOLDER } : payload)
  let now = await state()
  if (now !== null && now.exists === true) { await ownedPost({ op: 'close' }); await sleep(1200); now = await state() }
  world.closed = now
  const probe = await cdp.json(COLUMN_PROBE)
  world.columnOpen = probe.ok === true && probe.value.column !== null && probe.value.column.w >= 48
  world.wasCollapsed = probe.ok === true && probe.value.column !== null && probe.value.column.w < 48
  // R258: once the column is KNOWN collapsed, every remaining reading is unmeasurable for that one reason, and driving
  // open/close/external navigation anyway cost 78 of this gate's 81 seconds and once hung the whole suite. Stop here:
  // the judge turns the nulls into n/a and the gate exits 3, which is the same honest answer for a fraction of the time.
  if (world.columnOpen === false) { cdp.close(); return world }
  await openOwnPanel(port)
  const openUntil = Math.min(Date.now() + DEADLINE_MS, budgetEnd)
  now = await state()
  // R278: "contentReports > 0" is satisfied by the reporter's FIRST beat, which is sent while the document is
  // still `loading` - body null, textLength -1, no title. Waiting for that number alone read the earliest possible
  // snapshot and called a panel that was about to be perfectly readable a panel "that never became readable".
  // Measured on this machine right after this change: the same panel reports readyState complete, title
  // "侧边栏浏览器", textLength 89 within the first second. The wait therefore has to be for a USABLE report, and a
  // world that never produces one still reddens.
  const usable = (report) => report !== null && report !== undefined && report.content !== null && report.content !== undefined
    && ['interactive', 'complete'].includes(String(report.content.readyState))
  while (Date.now() < openUntil) {
    if (now !== null && now.exists === true && Number(now.contentReports) > 0 && usable(now)) break
    await sleep(400)
    now = await state()
  }
  world.open = now
  const wantOrigin = (function () { try { return new URL(SITE).origin } catch (error) { return null } })()
  await cdpCall('Page.navigate', { url: SITE })
  const externalUntil = Math.min(Date.now() + DEADLINE_MS, budgetEnd)
  let external = await state()
  let settled = null
  while (Date.now() < externalUntil) {
    const content = external === null || external.content === null || external.content === undefined ? null : external.content
    const href = content === null ? '' : String(content.href)
    if (external !== null && external.exists === true && wantOrigin !== null && href.indexOf(wantOrigin) === 0 && content.readyState === 'complete' && Number(content.textLength) > 0) { settled = external; break }
    await sleep(1200)
    external = await state()
  }
  world.external = settled !== null ? settled : (external !== null && external.exists === true ? external : null)
  await cdpCall('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__shell/' })
  await releaseLease(port, HOLDER)
  // Now the host is on its own again, and reading 4 can watch it heal a panel closed from outside.
  // R181-D (C-4): the ANCHOR is that reading's premise, so it is measured as part of the world instead of being
  // assumed - the host opens nothing where no pane declares [data-dsh-link-surface="true"] (panel_host.js:133).
  // R278: the host heals a panel onto an ACTIVE browser pane (panel_host.js opens nothing where no pane declares
  // [data-dsh-link-surface="true"]), so reading 4's premise is "the browser pane is the pane in front". Measured in
  // this world: the rail comes up on the LINK panel, the host therefore re-opens nothing when the panel is closed
  // from outside, and the reading reported "the panel came back but never reported" against a panel that never
  // came back at all. Bringing that pane to the front is what makes the heal observable.
  const BROWSER_WORDS = ['Browser', 'browser', '\u6d4f\u89c8\u5668']
  const railTabs = await cdp.json('(' + (function () {
    const rail = document.querySelector('[data-rightbar-col]')
    const out = []
    const all = document.querySelectorAll('[role="tab"]')
    for (let index = 0; index < all.length; index += 1) {
      const el = all[index]
      if (rail !== null && rail.contains(el) === false) continue
      const box = el.getBoundingClientRect()
      out.push({ label: String(el.textContent === null || el.textContent === undefined ? '' : el.textContent).trim(), selected: el.getAttribute('aria-selected') === 'true', x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) })
    }
    return JSON.stringify(out)
  }).toString() + ')()')
  // cdp.json() already parsed the answer: its `value` is the array, not a string of it.
  const railList = railTabs.ok === true && Array.isArray(railTabs.value) ? railTabs.value : []
  const browserTab = railList.find((tab) => BROWSER_WORDS.some((word) => tab.label.includes(word)))
  const selectedAtEntry = railList.find((tab) => tab.selected === true)
  world.healPremise = { tabs: railList, browser: browserTab === undefined ? null : browserTab.label, clicked: false, entryLabel: selectedAtEntry === undefined ? null : selectedAtEntry.label }
  if (browserTab !== undefined && browserTab.selected !== true) {
    await cdp.click({ x: browserTab.x + Math.round(browserTab.w / 2), y: browserTab.y + Math.round(browserTab.h / 2) })
    world.healPremise.clicked = true
    await sleep(1500)
  }
  const anchorSeen = await cdp.json(ANCHOR_PROBE)
  world.healAnchor = anchorSeen.ok === true ? anchorSeen.value : null
  await panelPost({ op: 'close' })
  const closeUntil = Math.min(Date.now() + 6000, budgetEnd)
  let after = await state()
  while (Date.now() < closeUntil && after !== null && after.exists === true) { await sleep(500); after = await state() }
  world.afterClose = after
  const healStart = Date.now()
  // R280: measured with the polls recorded - the host re-opens the panel at **t+13.7 s** after an external close (its
  // own 10 s grace plus the placement), and the reporter's first beat lands a second or two after that. A 14 s window
  // therefore ended 400 ms after the panel appeared and read "it came back but never reported", which was the window's
  // verdict, not the world's. The window is now 20 s, and the poll loop keeps going while the panel exists but has
  // not reported yet.
  const healUntil = Date.now() + Math.min(20000, Math.max(4000, budgetEnd - Date.now()))
  let back = await state()
  // R280: the polls themselves are evidence. Without them "came back but never reported" cannot be told apart from
  // "came back at t+11s and its report needed four more seconds", and the reading was red for that ambiguity.
  const healPolls = []
  while (Date.now() < healUntil) {
    // R278: same premise as the open above - a report has to be USABLE, not merely counted. Measured: the host
    // re-opens the panel within its own tick and the reporter's first beat lands while the document is still
    // loading, so "contentReports > 0" broke the loop on a snapshot that could not be read.
    healPolls.push({ t: Date.now() - healStart, exists: back === null ? null : back.exists === true, reports: back === null ? null : Number(back.contentReports), ready: back === null || back.content === null || back.content === undefined ? null : String(back.content.readyState), url: back === null ? null : String(back.url ?? '').slice(-26) })
    if (back !== null && back.exists === true && Number(back.contentReports) > 0 && usable(back)) break
    await sleep(400)
    back = await state()
  }
  world.healPolls = healPolls
  world.healWaitedMs = Date.now() - healStart
  console.log('  healPolls (' + String(healPolls.length) + ' poll(s), ' + String(Date.now() - healStart) + 'ms): ' + JSON.stringify(healPolls.slice(-8)))
  world.reopened = back
  // R278: give the rail back. This gate activates the browser pane to make the heal observable, and a gate that
  // leaves the rail on a pane it did not find it on has moved the world for the NEXT live gate (measured: the
  // action-render gate declined to measure for exactly this reason, "the browser pane is already open").
  const railExit = await cdp.json('(' + (function () {
    const rail = document.querySelector('[data-rightbar-col]')
    const out = []
    const all = document.querySelectorAll('[role="tab"]')
    for (let index = 0; index < all.length; index += 1) {
      const el = all[index]
      if (rail !== null && rail.contains(el) === false) continue
      const box = el.getBoundingClientRect()
      out.push({ label: String(el.textContent === null || el.textContent === undefined ? '' : el.textContent).trim(), selected: el.getAttribute('aria-selected') === 'true', x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) })
    }
    return JSON.stringify(out)
  }).toString() + ')()')
  const exitList = railExit.ok === true && Array.isArray(railExit.value) ? railExit.value : []
  // The pane to return to: the one this gate found selected, and failing that ANY pane that is not the browser pane -
  // parking the browser pane is what the next live gate needs, and a label that has drifted must not leave the world
  // moved. Measured: an exact-label restore left the browser pane in front and the next gate declined to measure.
  const wanted = world.healPremise === null || world.healPremise === undefined ? null : world.healPremise.entryLabel
  const wrong = wanted === null
    ? exitList.find((tab) => tab.selected !== true && BROWSER_WORDS.some((word) => tab.label.includes(word)) === false)
    : (exitList.find((tab) => tab.label === wanted && tab.selected !== true)
      ?? exitList.find((tab) => tab.selected !== true && BROWSER_WORDS.some((word) => tab.label.includes(word)) === false))
  if (wrong !== undefined) {
    await cdp.click({ x: wrong.x + Math.round(wrong.w / 2), y: wrong.y + Math.round(wrong.h / 2) })
    await sleep(1200)
  }
  world.railRestoredTo = wanted
  const anchorEnd = await cdp.json(ANCHOR_PROBE)
  world.healAnchorAfter = anchorEnd.ok === true ? anchorEnd.value : null
  cdp.close()
  // R279: leave the world in the state every live gate can share. The rail restore above is this gate's own attempt;
  // this is the shared one, and it also closes any panel the heal reading left standing.
  world.exitSettled = await settlePanelWorld(port, { cdpPort: CDP_PORT })
  void settledWorld
  return world
}

// -------------------------------------------------------------------------------------- self-attack
const report = (over) => ({ exists: true, label: 'sidebar-panel', bounds: { units: 'physical', x: 1, y: 1, w: 1, h: 1 }, dataDir: 'C:/app/sidebar-panels/p0', url: 'http://127.0.0.1:31761/__shell/', lastError: null, pending: false, pageUrl: 'http://127.0.0.1:31761/', content: { href: 'http://127.0.0.1:31761/', title: 'DSH', readyState: 'complete', textLength: 74, hasFocus: false, failures: [], at: 1 }, contentReports: 5, ...over })
// R181-D (C-4): the synthetic worlds carry the anchor reading 4's premise needs, so the judge is exercising the
// same world shape the live run measures (and a world with no anchor is a mutant target, not an accident).
const ANCHOR_SYNTHETIC = { count: 1, anchor: { x: 804, y: 86, w: 612, h: 790 }, display: 'block' }
const honestWorld = () => ({ page: 'synthetic', wasCollapsed: false, external: report({ exists: true, pageUrl: 'https://example.com/', content: { href: 'https://example.com/', title: 'Example Domain', readyState: 'complete', textLength: 917, hasFocus: false, failures: [], at: 2 }, contentReports: 3 }), closed: report({ exists: false, content: null, contentReports: 0, pageUrl: null, bounds: null }), open: report({}), reopened: report({}), columnOpen: true, healAnchor: ANCHOR_SYNTHETIC })
const staleWorld = () => ({ page: 'synthetic', wasCollapsed: false, external: report({ exists: true, pageUrl: 'https://example.com/', content: { href: 'https://example.com/', title: 'Example Domain', readyState: 'complete', textLength: 917, hasFocus: false, failures: [], at: 2 }, contentReports: 3 }), closed: report({ exists: false, content: null, contentReports: 0, pageUrl: null, bounds: null }), open: report({ pageUrl: 'https://example.com/', content: { href: 'http://127.0.0.1:31761/', title: 'old page', readyState: 'complete', textLength: 74, hasFocus: false, failures: [], at: 1 } }), reopened: report({}), columnOpen: true, healAnchor: ANCHOR_SYNTHETIC })
const silentWorld = () => ({ page: 'synthetic', wasCollapsed: false, external: report({ exists: true, pageUrl: 'https://example.com/', content: { href: 'https://example.com/', title: 'Example Domain', readyState: 'complete', textLength: 917, hasFocus: false, failures: [], at: 2 }, contentReports: 3 }), closed: report({ exists: false, content: null, contentReports: 0, pageUrl: null, bounds: null }), open: report({ content: null, contentReports: 0 }), reopened: report({}), columnOpen: true, healAnchor: ANCHOR_SYNTHETIC })
// A closed panel that KEPT its content: the shell would then answer with a page nobody is looking at.
const leakyWorld = () => ({ page: 'synthetic', wasCollapsed: false, external: report({ exists: true, pageUrl: 'https://example.com/', content: { href: 'https://example.com/', title: 'Example Domain', readyState: 'complete', textLength: 917, hasFocus: false, failures: [], at: 2 }, contentReports: 3 }), columnOpen: true, closed: report({ exists: false, bounds: null }), open: report({}), reopened: report({}), healAnchor: ANCHOR_SYNTHETIC })

// The panel was navigated to a real site and said nothing about it: a blank rectangle with a URL.
const silentExternalWorld = () => {
  const world = honestWorld()
  world.external = report({ exists: true, pageUrl: 'https://example.com/', content: null, contentReports: 0 })
  world.wasCollapsed = false
  return world
}

// A host that never brings the panel back - and a world whose host was never alive to: the first must redden
// reading 4, the second must NOT (it is a named NOT MEASURED, which is the whole point of R181-D's C-4).
const noHealWorld = () => {
  const world = honestWorld()
  world.reopened = report({ exists: false, content: null, contentReports: 0, pageUrl: null, bounds: null })
  return world
}
const noAnchorWorld = () => {
  const world = honestWorld()
  world.healAnchor = { count: 0, anchor: null, display: null }
  return world
}

const selfAttack = () => {
  const honest = expectations()
  let failures = 0
  const baseline = judge(honestWorld(), honest)
  const red = baseline.filter((reading) => reading.ok === false).map((reading) => reading.id)
  console.log('  ' + (red.length === 0 ? 'ok  ' : 'FAIL') + '  baseline. the labelled SYNTHETIC world judged with honest expectations is green: ' + baseline.map((reading) => reading.id + '=' + (reading.ok ? 'ok' : 'FAIL')).join(' '))
  if (red.length > 0) failures += 1
  const mutants = [
    { name: 'a panel that never reported anything', world: silentWorld(), expect: honest, mustRedden: ['2-self-report'] },
    { name: 'content about a page the panel has left', world: staleWorld(), expect: honest, mustRedden: ['3-no-stale'] },
    { name: 'a closed panel that kept its content', world: leakyWorld(), expect: honest, mustRedden: ['1-clean'] },
    { name: 'this run told to expect content on a closed panel', world: honestWorld(), expect: expectations({ contentOnClosed: true }), mustRedden: ['1-clean'] },
    { name: 'a real site the panel never reported from', world: silentExternalWorld(), expect: honest, mustRedden: ['5-external'] },
    { name: 'a host that never brings the panel back', world: noHealWorld(), expect: honest, mustRedden: ['4-host-heals'] },
  ]
  // The premise branch, judged for what it is: a world whose host was never alive must NOT redden reading 4.
  const skipped = judge(noAnchorWorld(), honest).filter((reading) => reading.ok === false).map((reading) => reading.id)
  const premiseHeld = skipped.length === 0
  if (premiseHeld === false) failures += 1
  console.log('  ' + (premiseHeld ? 'ok  ' : 'FAIL') + '  mutant. a world with no anchor: red=' + show(skipped) + ' expected=[] (4-host-heals must be a named NOT MEASURED there, never a red)')
  const notMeasured = judge(noAnchorWorld(), honest).filter((reading) => /NOT MEASURED/.test(reading.detail)).map((reading) => reading.id)
  const named = notMeasured.length === 1 && notMeasured[0] === '4-host-heals'
  if (named === false) failures += 1
  console.log('  ' + (named ? 'ok  ' : 'FAIL') + '  mutant. a world with no anchor names the reading it could not take: NOT MEASURED=' + show(notMeasured) + ' expected=["4-host-heals"]')
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
  // R260: the collection gets a HARD deadline, not just per-wait deadlines. Measured: with every loop bounded the gate
  // still hung for minutes inside an await that has no budget of its own (CDP connect, Page.navigate, lease claim),
  // which held the whole suite twice. A gate that cannot finish in time must say so and exit in its third state -
  // the file's own note below already records that an open CDP socket keeps the process alive forever.
  const hard = new Promise((settle) => setTimeout(() => settle('timeout'), BUDGET_MS + 15000))
  try {
    const raced = await Promise.race([collect(), hard])
    if (raced === 'timeout') {
      console.log('SKIP: the collection did not finish within ' + String(BUDGET_MS + 15000) + ' ms, so this gate measured NOTHING (an instrument limit, not a product verdict)')
      process.exit(3)
    }
    world = raced
  }
  catch (error) {
    console.log('  FAIL  collect(): the judge itself failed before judging anything (a GATE bug, not a data verdict)')
    console.log('        ' + (error && error.stack ? error.stack : String(error)))
    // A gate whose CDP socket is still open never lets the process exit: measured in R148, the failing run
    // printed this message and then sat there. An explicit exit is honest here - the verdict is already out.
    process.exit(1)
  }
  if (world === null) {
    console.log('SKIP: no CDP on 127.0.0.1:' + String(CDP_PORT) + ', so the app is not running with remote debugging; this gate measured NOTHING')
    return 3
  }
  const readings = judge(world, expectations())
  console.log('  live page ' + world.page + ' | reports=' + show(world.open && world.open.contentReports) + ' | pageUrl=' + show(world.open && world.open.pageUrl))
  for (const reading of readings) {
    // Three verdicts, as in verify-teams-panel.mjs: a reading this world did not let the gate take prints as
    // n/a (and the gate exits 3), so nobody reads a FAIL for a question that was never asked.
    const verdict = reading.ok === true ? 'ok  ' : reading.ok === false ? 'FAIL' : 'n/a '
    console.log('  ' + verdict + '  ' + reading.id + '. ' + reading.detail)
    for (const line of reading.evidence) console.log('        ' + line)
  }
  const failed = readings.filter((reading) => reading.ok === false)
  // R181-D (C-4): a reading that could not be measured in THIS world is a named skip, not a pass and not a red.
  // A measured red still outranks a skip: a gate that reports a skip over a red it did see is hiding a fact.
  const unmeasured = readings.filter((reading) => reading.ok === null)
  console.log(failed.length > 0
    ? '  ' + String(readings.length) + ' readings, ' + String(failed.length) + ' failed'
    : (unmeasured.length > 0 ? '  ' + String(readings.length) + ' readings, ' + String(unmeasured.length) + ' not measured in this world' : '  ' + String(readings.length) + ' readings, all held'))
  if (failed.length > 0) return 1
  if (unmeasured.length > 0) {
    console.log('SKIP: ' + String(unmeasured.length) + ' of ' + String(readings.length) + ' readings could not be measured here (' + unmeasured.map((reading) => reading.id).join(', ') + '); each names the world it needs in its own detail and in the header PREMISE notes')
    return 3
  }
  return 0
}

// R262: `process.exitCode = await main()` only sets a NUMBER - node then waits for the event loop to drain, and an
// open CDP socket kept this gate alive for ~100 s AFTER it had printed its verdict (measured: 144 s wall for a 30 s
// budget). Every path that returns a world closes the socket first, so exiting here is clean; the abrupt-exit assert
// that this call produced once was the early return skipping cdp.close(), which is fixed at the return site.
// R262: the answer is the SOCKET, not the exit call. `process.exit()` here raced libuv's own handle teardown on
// Windows (assert in src/win/async.c, exit 0xC0000409), and `process.exitCode` alone waited ~100 s for the loop to
// drain. Every returning path now calls cdp.close() first, and the loop then drains at once - measured below.
process.exitCode = await main()