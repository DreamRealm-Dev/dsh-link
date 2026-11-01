// The panel lease, from a gate's side. Four live gates drive the SAME panel object; R151 measured that
// without this they fail against each other (whichever ran second failed, in different directions on
// different runs, while each passed alone). A gate takes the lease, does its work, and gives it back; the
// deadline is the safety net for a gate that dies before giving it back.
const leaseCall = async (port, payload) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'lease', ...payload }) }).catch(() => null)
  if (answer === null) return { status: 0, body: null }
  const text = await answer.text().catch(() => '')
  let body = null
  try { body = JSON.parse(text) } catch (error) { body = null }
  return { status: answer.status, body }
}

// R166: the shell now ENFORCES the lease on placement, so the helper has to name its holder when it places. It
// remembers the last claim instead of making every gate pass its own name again.
let currentHolder = null

/**
 * Take the lease even when somebody else holds it, and say whose it was.
 *
 * A lease whose holder process is GONE is a leftover: gates name themselves "<gate>-<pid>", so a dead pid is
 * checkable. The shell records the revocation by name (`by: "lease-steal"`, `kind: "stale-lease"`), which is what
 * keeps this from being a silent grab. Measured need (R326): three panel gates that pass alone skipped inside one
 * full run, each reporting "the panel was already leased by <a gate that had already exited>".
 */
export const stealLease = async (port, holder, ttlMs = 60000) => {
  const answer = await leaseCall(port, { leaseOp: 'steal', holder, ttlMs })
  const held = answer.body !== null && answer.body.lease !== null && answer.body.lease !== undefined && answer.body.lease.held === true && answer.body.lease.holder === holder
  if (held === true) currentHolder = holder
  return { held, stolenFrom: answer.body && answer.body.lease ? answer.body.lease.revokedHolder : null }
}

/** The pid a gate holder names, or null when the name carries none. */
const holderPid = (name) => {
  if (typeof name !== 'string') return null
  const match = name.match(/-(\d+)$/)
  return match === null ? null : Number(match[1])
}

/** Whether the process a holder names is still alive (a pid we cannot parse counts as alive: never steal blind). */
const holderAlive = (name) => {
  const pid = holderPid(name)
  if (pid === null || pid <= 0) return true
  try { process.kill(pid, 0); return true } catch (error) { return error && error.code === 'EPERM' }
}

/**
 * Drop a STALE lease before a gate tries to take it: a holder whose pid is gone loses it, a live one keeps it.
 * @returns { held: boolean, stolenFrom: string|null } - what happened, for the caller to print.
 */
/**
 * The small half of the settle: clear a DEAD holder lease and leave everything else exactly as it was.
 *
 * This is what the suite runner calls before each live gate (R326). The full `settlePanelWorld` also parks the rail and
 * closes the panel - and a gate that inherits a world it did not choose fails its own "the world was put back" reading
 * (measured: panel-contribution-render reading 7 failed with the full settle and passes alone). The lease is the one
 * piece of world state a gate cannot repair by itself, so it is the one piece the runner touches.
 */
export const clearStaleLease = async (port, holder = 'runner-settle') => {
  const reclaimed = await reclaimStaleLease(port, holder)
  if (reclaimed.stolenFrom === null) return reclaimed
  await claimLease(port, holder, 5000)
  await releaseLease(port, holder)
  return reclaimed
}

/**
 * Close a browser panel an earlier gate left mounted, and say whether it had to.
 *
 * The panel is ONE native object: a gate that leaves it up makes the NEXT gate decline ("the world is ACTIVE ... the
 * browser pane is already open", measured on panel-action-render in R326) and makes a later gate restore reading
 * disagree with what it inherited (panel-contribution-render reading 7). The rail is deliberately NOT touched here:
 * parking it changes the world a gate records as its own (measured the same round), so this closes the panel and
 * nothing else.
 */
/**
 * Reload the shell own page and wait for the rail, so the next live gate starts from a fresh DOM.
 *
 * MEASURED HARMFUL (R329): a reloaded WebView2 page comes back with NO rail - the tabs and the surface anchors are
 * re-entered by the app, not by the reload - so this leaves a worse world than it found. Kept only as the record of the
 * experiment; the suite runner does not call it.
 *
 * The live lane is ONE page: every gate that clicks tabs, opens a pane or scrolls the rail leaves something behind, and
 * a reload is the only reset that is complete and cheap (~1-2 s). Measured across three full runs (R326-R329) with
 * between 2 and 6 reds EVERY time and every one of them green alone - the shared page was the variable, not the code.
 */
export const reloadShellPage = async (cdpPort = 9222, options = {}) => {
  const waitMs = options.waitMs === undefined ? 6000 : options.waitMs
  const { connect } = await import('./cdp-drive.mjs')
  const cdp = await connect({ port: cdpPort })
  await cdp.evaluate('location.reload()').catch(() => null)
  const deadline = Date.now() + waitMs
  let ready = false
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const probe = await cdp.evaluate('({ tabs: document.querySelectorAll(\'[role="tab"]\').length, panels: document.querySelectorAll(\'[data-dsh-link-surface]\').length })').catch(() => null)
    const value = probe !== null && probe !== undefined && probe.exception === undefined ? probe.value : null
    if (value !== null && value !== undefined && value.tabs > 0) { ready = true; break }
  }
  return { reloaded: true, ready }
}

export const closeMountedPanel = async (port, holder = 'runner-settle') => {
  const before = await fetch('http://127.0.0.1:' + String(port) + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'state' }) }).then((answer) => answer.json()).catch(() => null)
  if (before === null || before.exists !== true) return { closed: false, was: null }
  await panelPost(port, { op: 'close', holder })
  const after = await fetch('http://127.0.0.1:' + String(port) + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'state' }) }).then((answer) => answer.json()).catch(() => null)
  return { closed: after !== null && after.exists !== true, was: before.label ?? null }
}

export const reclaimStaleLease = async (port, holder) => {
  const seen = await fetch('http://127.0.0.1:' + String(port) + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'state' }) }).then((answer) => answer.json()).catch(() => null)
  const lease = seen === null || seen.lease === undefined ? null : seen.lease
  if (lease === null || lease.held !== true) return { held: false, stolenFrom: null }
  if (holderAlive(lease.holder)) return { held: false, stolenFrom: null }
  const stolen = await stealLease(port, holder, 30000)
  if (stolen.held === true) console.log('        (the panel lease was reclaimed from a dead holder: ' + String(lease.holder) + ')')
  return stolen
}

export const claimLease = async (port, holder, ttlMs = 60000) => {
  const answer = await leaseCall(port, { leaseOp: 'claim', holder, ttlMs })
  const held = answer.body !== null && answer.body.lease !== null && answer.body.lease !== undefined && answer.body.lease.held === true && answer.body.lease.holder === holder
  if (held === false) console.log('        (the panel lease was refused: ' + ((answer.body && answer.body.error) || answer.status) + ')')
  if (held === true) currentHolder = holder
  return held
}

export const releaseLease = async (port, holder) => {
  await leaseCall(port, { leaseOp: 'release', holder })
  if (currentHolder === holder) currentHolder = null
}

/** Any of the shell's panel ops, so a gate can do the whole job itself instead of waiting for the page host. */
export const panelPost = async (port, payload) => {
  const answer = await fetch('http://127.0.0.1:' + port + '/__shell/panel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null)
  if (answer === null) return null
  const text = await answer.text().catch(() => '')
  try { return JSON.parse(text) } catch (error) { return null }
}

/**
 * Put the PANEL WORLD back into a state every live gate can start from, and say what it found.
 *
 * The panel is ONE native object shared by every gate, so a gate that leaves it open, on another page, or parks the
 * rail on a different pane changes the premise of the gate that follows. Measured across three full suite runs of
 * the same code (R279): panel-surface read worstDelta=190px for one beat after another gate handed over a panel still
 * carrying a different surface's rectangle, sidebar-content took 60.1 s and lost its heal reading, and the
 * action-render gate declined to measure at all ("the browser pane is already open").
 *
 * What it does, in this order, and nothing else: park the rail on a pane that is NOT the browser pane (the host only
 * places a panel while a browser pane declares its surface), close any panel, and read the result back.
 *
 * @param port - the shell's port.
 * @param options.cdpPort - the CDP port to reach the shell's own page through.
 * @param options.waitMs - how long to wait for the closed state to be reached.
 * @returns { parked, closed, rail, state } - what it did and what the shell said afterwards.
 */
export const settlePanelWorld = async (port, options = {}) => {
  const cdpPort = options.cdpPort === undefined ? 9222 : options.cdpPort
  const waitMs = options.waitMs === undefined ? 4000 : options.waitMs
  const out = { parked: null, rail: null, closed: false, state: null, stolenFrom: null }
  // R326: a lease left by a gate that exited without releasing parks the NEXT gate behind it (measured: three panel
  // gates that pass alone skipped inside one full run). Clear a stale one here, take it under our own name and let
  // it go again at once, so the gate that follows can claim normally.
  try {
    const reclaimed = await reclaimStaleLease(port, 'world-settle')
    if (reclaimed.stolenFrom !== null) {
      out.stolenFrom = reclaimed.stolenFrom
      // A fresh CLAIM clears the shell own `revoked` record (sidebar_panel.rs: claim sets revoked = None), so the
      // world a gate inherits after this carries no trace of the steal. Without this the gates pass but their
      // "the world was put back" reading fails against a revocation this settle left behind (measured R326).
      await claimLease(port, 'world-settle', 5000)
      await releaseLease(port, 'world-settle')
    }
  } catch (error) { out.leaseError = String(error && error.message ? error.message : error) }
  let cdp = null
  try {
    const { connect } = await import('./cdp-drive.mjs')
    cdp = await connect({ port: cdpPort })
  } catch (error) { cdp = null }
  if (cdp !== null) {
    // Park the rail: a browser pane in front is a panel the host keeps placing, and the next gate's premise may be
    // "no panel". Any non-browser tab will do; the one titled like the guide is preferred because it is the tab the
    // rail comes up on.
    const parked = await cdp.evaluate('(' + (function () {
      const BROWSER = /Browser|browser|\u6d4f\u89c8\u5668/
      const rail = document.querySelector('[data-rightbar-col]')
      const tabs = []
      const all = document.querySelectorAll('[role="tab"]')
      for (let index = 0; index < all.length; index += 1) {
        const el = all[index]
        if (rail !== null && rail.contains(el) === false) continue
        tabs.push(el)
      }
      const selected = tabs.find((el) => el.getAttribute('aria-selected') === 'true') ?? null
      const selectedLabel = selected === null ? null : String(selected.textContent || '').trim()
      const target = tabs.find((el) => el !== selected && BROWSER.test(String(el.textContent || '')) === false) ?? null
      if (selected !== null && BROWSER.test(String(selected.textContent || '')) === false) return { action: 'already', selected: selectedLabel }
      if (target === null) return { action: 'no-target', selected: selectedLabel, counts: tabs.length }
      target.click()
      return { action: 'clicked', selected: selectedLabel, onto: String(target.textContent || '').trim() }
    }).toString() + ')()')
    // cdp-drive's evaluate answers { value, description, exception } - not { ok, value } - so a helper written
    // against the gate-local shape would call every probe unreadable. Measured exactly that on the first run.
    out.parked = parked === null || parked === undefined ? null
      : (parked.exception === null || parked.exception === undefined ? parked.value : { action: 'threw', why: String(parked.exception) })
    // R328: parking the rail is not enough - the browser PANE keeps declaring its surface while it is merely hidden,
    // so the page host keeps placing the native panel and a gate that needs the AWAY world still sees it ("the world
    // is ACTIVE ... the browser pane is already open", measured on panel-action-render twice). Close the browser
    // pane(s) too, then read the anchor count back: that count, not the rail selection, is the gate premise.
    const closedPane = await cdp.evaluate('(' + (function () {
      const BROWSER = /Browser|browser|\u6d4f\u89c8\u5668/
      const rail = document.querySelector('[data-rightbar-col]')
      const all = document.querySelectorAll('[role="tab"]')
      const victims = []
      for (const el of all) {
        if (rail !== null && rail.contains(el) === false) continue
        if (BROWSER.test(String(el.textContent || '')) === false) continue
        victims.push(el)
      }
      let closed = 0
      for (const tab of victims) {
        const shut = tab.querySelector('[aria-label="\u5173\u95ed"], [class*="tabClose"], [class*="close"]')
        if (shut !== null) { shut.click(); closed += 1 }
      }
      return { victims: victims.length, closed, anchors: document.querySelectorAll('[data-dsh-link-surface]').length }
    }).toString() + ')()')
    out.closedPane = closedPane === null || closedPane === undefined ? null
      : (closedPane.exception === null || closedPane.exception === undefined ? closedPane.value : { threw: String(closedPane.exception) })
    // The anchor count is the premise. Wait for it to reach 0 rather than assuming the click landed.
    const anchorDeadline = Date.now() + waitMs
    while (Date.now() < anchorDeadline) {
      const anchors = await cdp.evaluate('document.querySelectorAll(\'[data-dsh-link-surface]\').length')
      const count = anchors !== null && anchors !== undefined && anchors.exception === undefined && anchors.exception === null ? anchors.value : null
      out.surfaceAnchors = count
      if (count === 0) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    // R282: a COLD rail has no browser chip at all - the pane is only a tab once somebody opened it - so a premise that
    // only clicks an existing chip leaves the world exactly as cold as it found it (measured: five live gates skipped
    // in one suite run for this). The guide is the door: press it, then the capsule that names the browser.
    if (out.parked !== null && typeof out.parked === 'object' && out.parked.action === 'no-target') {
      const viaGuide = await cdp.evaluate('(' + (function () {
        const BROWSER = /Browser|browser|\u6d4f\u89c8\u5668/
        const guideTab = [...document.querySelectorAll('[role="tab"]')].find((el) => String(el.textContent || '').includes('\u5f00\u59cb'))
        if (guideTab === undefined) return { action: 'no-guide-tab' }
        guideTab.click()
        return { action: 'guide-opened' }
      }).toString() + ')()')
      // cdp-drive's evaluate answers { value, description, exception }: an exception means the probe threw, and a
      // null answer means there was no page to ask. Both are reported rather than folded into a guess.
      const guideOpen = viaGuide === null || viaGuide === undefined ? null
        : (viaGuide.exception === null || viaGuide.exception === undefined ? viaGuide.value : { action: 'threw', why: String(viaGuide.exception) })
      await new Promise((done) => setTimeout(done, 1200))
      const capsule = await cdp.evaluate('(' + (function () {
        const BROWSER = /Browser|browser|\u6d4f\u89c8\u5668/
        const candidates = [...document.querySelectorAll('button,[role="button"],a,[data-dockkit-capsule]')]
        const hit = candidates.find((el) => BROWSER.test(String(el.textContent || '').trim()))
        if (hit === undefined) return { action: 'no-browser-capsule' }
        hit.click()
        return { action: 'capsule-pressed', onto: String(hit.textContent || '').trim().slice(0, 24) }
      }).toString() + ')()')
      await new Promise((done) => setTimeout(done, 1800))
      out.guide = { opened: guideOpen, capsule: capsule === null || capsule === undefined || capsule.exception !== null && capsule.exception !== undefined ? capsule : capsule.value }
      out.parked = { action: 'opened-through-the-guide', onto: out.guide.capsule === null || out.guide.capsule === undefined ? null : out.guide.capsule.onto }
    }
    if (out.parked !== null && typeof out.parked === 'object' && out.parked.action === 'clicked') await new Promise((done) => setTimeout(done, 1200))
    cdp.close()
  }
  const before = await panelPost(port, { op: 'state' })
  out.rail = before === null ? null : { exists: before.exists === true, url: before.url ?? null }
  if (before !== null && before.exists === true) await panelPost(port, { op: 'close' })
  const until = Date.now() + waitMs
  let seen = before
  while (Date.now() < until) {
    seen = await panelPost(port, { op: 'state' })
    if (seen === null || seen.exists !== true) break
    await new Promise((done) => setTimeout(done, 400))
  }
  out.state = seen
  out.closed = seen !== null && seen.exists !== true
  return out
}

/**
 * Open the panel and place it, using the shell's own API. This is what makes a lease meaningful: the holder
 * does the whole job (open, place, measure, close) instead of waiting for the page host, so the host can
 * stand down while the lease is held. R152 measured the other order - pausing the host while the gates still
 * depended on it - and all four live gates went red.
 */
export const openOwnPanel = async (port, rect = { x: 600, y: 90, w: 420, h: 600 }) => {
  // R169: the panel's own start page (same URL the page host uses), so the gates exercise what the product opens.
  const url = 'http://127.0.0.1:' + port + '/__shell/panel-start'
  // R181-C, measured: `open` went out WITHOUT the holder while `set-bounds` below sent it, so a gate that had
  // just claimed the lease could not open a panel at all - the shell answered 400 "the panel is leased by
  // <gate> and not by nobody: the placement was refused" and the gate reported "the shell would not open a
  // panel". That SKIP was read as a fact about the world (R180-D blamed the page host) until the ownership
  // matrix separated the two: the refusal was the gate's own missing holder. Every write this helper makes
  // now carries the holder, which is what "the holder does the whole job" means.
  await panelPost(port, { op: 'open', url, ...(currentHolder === null ? {} : { holder: currentHolder }) })
  const until = Date.now() + 20000
  let seen = null
  while (Date.now() < until) {
    seen = await panelPost(port, { op: 'state' })
    if (seen !== null && seen.exists === true) {
      // R161: return the state AFTER the placement - the set-bounds answer IS a report. Until now this returned the
      // state read BEFORE calling set-bounds, so every live gate that trusted `opened.bounds` got the page host's last
      // rect instead of the rect it asked for: gate 100 printed x=1038 and then x=1158 that way while its own panel
      // window sat at the 900 it asked for. Both are live column rects, which is what made it look like a race.
      // (An extra `op=report` read here looked equivalent and was not: it cost sidebar-content its 2-self-report and
      // 3-no-stale readings, deterministically and alone. Use the answer the placement already gives.)
      const placed = await panelPost(port, { op: 'set-bounds', ...rect, ...(currentHolder === null ? {} : { holder: currentHolder }) })
      return placed === null ? seen : placed
    }
    await new Promise((r) => setTimeout(r, 700))
  }
  return seen
}
